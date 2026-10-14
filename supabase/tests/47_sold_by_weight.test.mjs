// Selling by weight: the server prices the weight, writes it on the ticket, and the stock goes out
// for the weight sold (recipe for 1 kg); a weighed item without a weight is refused.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, A, rid, m, dev, gateaux, item, plain;
const get = async id => (await sql(`select * from public.ingredients where id = $1`, [id]))[0];
const pay = async o => {
  const [x] = await sql(`select total_cents from public.orders where id = $1`, [o.id]);
  return rpc(dev, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: Number(x.total_cents) }]), null, null]);
};

before(async () => {
  w = await world(); A = w.A; rid = A.r.id; m = w.users.managerA; dev = w.users.deviceA;
  await sql(`update public.restaurants set day_cutoff_hour = 0 where id = $1`, [rid]);
  [gateaux] = await as(m, `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents) values ($1, 'Gâteaux secs (maison)', 'g', 'kg', 1000, 4000) returning *`, [rid]);
  await rpc(m, 'stock_set', [gateaux.id, 5000, 'start']);
  [item] = await as(m, `insert into public.menu_items (restaurant_id, category_id, name, price_cents, sold_by_weight) values ($1, $2, '{"fr":"Gâteaux secs"}', 12000, true) returning *`, [rid, A.cats.boissons.id]);
  await as(m, `insert into public.recipe_lines (restaurant_id, menu_item_id, ingredient_id, qty) values ($1, $2, $3, 1000)`, [rid, item.id, gateaux.id]);
  [plain] = await as(m, `insert into public.menu_items (restaurant_id, category_id, name, price_cents) values ($1, $2, '{"fr":"Thé"}', 1500) returning *`, [rid, A.cats.boissons.id]);
});
after(() => pool.end());

test('the till sends the weight, the server prices it and names it', async () => {
  const o = await tillOrder(dev, rid, [{ item_id: item.id, weight_g: 450 }, { item_id: plain.id, weight_g: 300 }]);
  const lines = await sql(`select name, unit_price_cents, quantity, weight_g, units from public.order_lines where order_id = $1 order by unit_price_cents desc`, [o.id]);
  assert.equal(Number(lines[0].unit_price_cents), 5400, '450 g at 120 DH/kg');
  assert.match(lines[0].name, /0,450 kg/);
  assert.equal(Number(lines[0].units), 0.45);
  assert.equal(lines[1].weight_g, null, 'a normal item keeps no weight');
  assert.equal(Number(lines[1].units), 1);
  const [ord] = await sql(`select total_cents from public.orders where id = $1`, [o.id]);
  assert.equal(Number(ord.total_cents), 6900);
  const doc = await pay(o);
  assert.ok(doc.lines.some(l => /0,450 kg/.test(l.name) && Number(l.unit_ttc) === 5400), 'on the ticket');
  assert.equal(Number((await get(gateaux.id)).stock_qty), 4550, '450 g out of the stock');
  // the weight cannot be changed afterwards
  await assert.rejects(as(dev, `update public.order_lines set weight_g = 1 where order_id = $1 and weight_g is not null`, [o.id]));
});

test('two boxes of 250 g; a weighed item without weight is refused', async () => {
  const o = await tillOrder(dev, rid, [{ item_id: item.id, weight_g: 250, qty: 2 }]);
  const [l] = await sql(`select unit_price_cents, units from public.order_lines where order_id = $1`, [o.id]);
  assert.equal(Number(l.unit_price_cents), 3000);
  assert.equal(Number(l.units), 0.5);
  await pay(o);
  assert.equal(Number((await get(gateaux.id)).stock_qty), 4050);
  await assert.rejects(tillOrder(dev, rid, [{ item_id: item.id }]), /weight required/);
});

test('dish profit counts kilos', async () => {
  const res = await rpc(m, 'profit_dishes', [rid, 30]);
  const row = res.dishes.find(x => x.item_id === item.id);
  assert.equal(Number(row.sold_qty), 0.95, '450 g + 2 x 250 g');
});
