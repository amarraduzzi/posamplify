// Catering: numbered orders, confirmed orders feed the production plan, invoicing only when fully paid,
// the invoice is a real closed order (ticket or ICE invoice) that takes the stock out, then it is frozen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, A, rid, m, butter, croissant, item, c1;
const get = async id => (await sql(`select * from public.ingredients where id = $1`, [id]))[0];

before(async () => {
  w = await world(); A = w.A; rid = A.r.id; m = w.users.managerA;
  await sql(`update public.restaurants set day_cutoff_hour = 0 where id = $1`, [rid]);
  [butter] = await as(m, `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents) values ($1, 'Beurre', 'g', 'kg', 1000, 8000) returning *`, [rid]);
  [croissant] = await as(m, `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, is_preparation, made_ahead) values ($1, 'Mini croissant', 'pc', 'fournée', 100, true, true) returning *`, [rid]);
  await as(m, `insert into public.preparation_lines (restaurant_id, preparation_id, ingredient_id, qty) values ($1, $2, $3, 1000)`, [rid, croissant.id, butter.id]);
  [item] = await as(m, `insert into public.menu_items (restaurant_id, category_id, name, price_cents) values ($1, $2, '{"fr":"Tarte citron"}', 3000) returning *`, [rid, A.cats.boissons.id]);
  await as(m, `insert into public.recipe_lines (restaurant_id, menu_item_id, ingredient_id, qty) values ($1, $2, $3, 2)`, [rid, item.id, croissant.id]);
  await rpc(m, 'stock_set', [butter.id, 10000, 'start']);
});
after(() => pool.end());

test('a catering order gets its number and feeds the production plan once confirmed', async () => {
  [c1] = await as(m, `insert into public.catering_orders (restaurant_id, number, customer_name, company, ice, event_date, mode, address, delivery_fee_cents)
    values ($1, 999, 'Salma', 'Atlas Events', '001234567000089', current_date, 'delivery', 'Hay Riad', 5000) returning *`, [rid]);
  const [c2] = await as(m, `insert into public.catering_orders (restaurant_id, customer_name, event_date) values ($1, 'Omar', current_date) returning *`, [rid]);
  assert.equal(c1.number, 1, 'the number is given by the server');
  assert.equal(c2.number, 2);
  await as(m, `insert into public.catering_lines (restaurant_id, catering_id, ingredient_id, name, unit_price_cents, qty) values ($1, $2, $3, 'Mini croissants', 400, 1500)`, [rid, c1.id, croissant.id]);
  await as(m, `insert into public.catering_lines (restaurant_id, catering_id, menu_item_id, name, unit_price_cents, qty, sort_order) values ($1, $2, $3, 'Tarte citron', 2500, 10, 1)`, [rid, c1.id, item.id]);

  let plan = await rpc(m, 'production_plan', [rid, null]);
  assert.equal(Number(plan.items.find(x => x.ingredient_id === croissant.id).catering), 0, 'a quote is not produced');
  await as(m, `update public.catering_orders set status = 'confirmed' where id = $1`, [c1.id]);
  plan = await rpc(m, 'production_plan', [rid, null]);
  const row = plan.items.find(x => x.ingredient_id === croissant.id);
  assert.equal(Number(row.catering), 1520, '1500 mini croissants + 10 tarts x 2');
  assert.equal(Number(row.suggested), 1520);
});

test('invoicing: only when fully paid; a closed ICE invoice; stock out; then frozen', async () => {
  // 1500 x 4 DH + 10 x 25 DH + 50 DH delivery = 6300 DH
  await as(m, `insert into public.catering_payments (restaurant_id, catering_id, method, amount_cents) values ($1, $2, 'transfer', 300000)`, [rid, c1.id]);
  await assert.rejects(rpc(m, 'catering_invoice', [c1.id, null]), /not_fully_paid/);
  await assert.rejects(rpc(w.users.deviceA, 'catering_invoice', [c1.id, null]), /not allowed/);
  await as(m, `insert into public.catering_payments (restaurant_id, catering_id, kind, method, amount_cents) values ($1, $2, 'balance', 'cash', 330000)`, [rid, c1.id]);

  await rpc(m, 'production_record', [croissant.id, 1600, null, c1.id]);
  assert.equal(Number((await get(croissant.id)).stock_qty), 1600);

  const res = await rpc(m, 'catering_invoice', [c1.id, null]);
  assert.equal(res.document.doc_type, 'invoice', 'the ICE makes it an invoice');
  const [o] = await sql(`select * from public.orders where id = $1`, [res.order_id]);
  assert.equal(o.source, 'catering');
  assert.equal(Number(o.total_cents), 630000);
  assert.ok(o.closed_at);
  const lines = await sql(`select quantity from public.order_lines where order_id = $1 order by quantity desc`, [o.id]);
  assert.deepEqual(lines.map(x => x.quantity), [999, 501, 10, 1], 'big lines split, delivery fee as a line');
  const [doc] = await sql(`select lines from public.fiscal_documents where order_id = $1`, [o.id]);
  assert.deepEqual(doc.lines.map(x => x.qty), [999, 501, 10, 1], 'in the order of the catering order, delivery last');
  assert.equal(Number((await get(croissant.id)).stock_qty), 1600 - 1500 - 20, 'the croissants and the tarts left the stock');

  const [c] = await sql(`select * from public.catering_orders where id = $1`, [c1.id]);
  assert.equal(c.status, 'delivered');
  await assert.rejects(rpc(m, 'catering_invoice', [c1.id, null]), /already_invoiced/);
  await assert.rejects(as(m, `update public.catering_lines set qty = 1 where catering_id = $1`, [c1.id]), /catering invoiced/);
  await assert.rejects(as(m, `update public.catering_orders set note = 'x' where id = $1`, [c1.id]), /catering invoiced/);
  await assert.rejects(as(m, `insert into public.catering_payments (restaurant_id, catering_id, method, amount_cents) values ($1, $2, 'cash', 1)`, [rid, c1.id]), /catering invoiced/);

  const plan = await rpc(m, 'production_plan', [rid, null]);
  assert.equal(Number(plan.items.find(x => x.ingredient_id === croissant.id).catering), 0, 'invoiced: nothing left to make');
});

test('a quote cannot be invoiced; the client cannot link an order itself', async () => {
  const [c] = await as(m, `insert into public.catering_orders (restaurant_id, customer_name, event_date) values ($1, 'Nadia', current_date + 3) returning *`, [rid]);
  await as(m, `insert into public.catering_lines (restaurant_id, catering_id, name, unit_price_cents, qty) values ($1, $2, 'Plateau sucré', 20000, 1)`, [rid, c.id]);
  await as(m, `insert into public.catering_payments (restaurant_id, catering_id, method, amount_cents) values ($1, $2, 'cash', 20000)`, [rid, c.id]);
  await assert.rejects(rpc(m, 'catering_invoice', [c.id, null]), /not_confirmed/);
  const [o] = await sql(`select id from public.orders where restaurant_id = $1 limit 1`, [rid]);
  await as(m, `update public.catering_orders set order_id = $2, status = 'confirmed' where id = $1`, [c.id, o.id]);
  const [x] = await sql(`select order_id from public.catering_orders where id = $1`, [c.id]);
  assert.equal(x.order_id, null);
  const res = await rpc(m, 'catering_invoice', [c.id, null]);
  assert.equal(res.document.doc_type, 'ticket', 'without ICE: a ticket');
});
