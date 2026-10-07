// Purchasing: suppliers, orders made from "what to buy" (one per supplier), received with the real
// quantities and prices: purchases written, live stock up, price alert, received orders final.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, A, rid, m, metro, souk, poulet, tomate, sel;
before(async () => {
  w = await world(); A = w.A; rid = A.r.id; m = w.users.managerA;
  await sql(`update public.restaurants set day_cutoff_hour = 0 where id = $1`, [rid]);
  [metro] = await as(m, `insert into public.suppliers (restaurant_id, name, phone, lead_days) values ($1, 'Metro', '212661000000', 2) returning *`, [rid]);
  [souk] = await as(m, `insert into public.suppliers (restaurant_id, name) values ($1, 'Souk') returning *`, [rid]);
  const ing = async (name, base, unit, qty, price, sup) => (await as(m, `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents, supplier_id)
    values ($1, $2, $3, $4, $5, $6, $7) returning *`, [rid, name, base, unit, qty, price, sup]))[0];
  poulet = await ing('Poulet', 'g', 'kg', 1000, 6000, metro.id);
  tomate = await ing('Tomate', 'g', 'kg', 1000, 800, souk.id);
  sel = await ing('Sel', 'g', 'kg', 1000, 300, null);
  for (const g of [poulet, tomate, sel]) await rpc(m, 'stock_set', [g.id, 1000, null]);
});
after(() => pool.end());

test('from what to buy: one draft order per supplier, numbered', async () => {
  const res = await rpc(m, 'po_from_forecast', [rid, `{${poulet.id},${tomate.id},${sel.id}}`]);
  assert.equal(res.orders.length, 3, 'Metro, Souk and without supplier');
  const pos = await as(m, `select o.*, (select count(*)::int from public.purchase_order_lines l where l.order_id = o.id) n from public.purchase_orders o where restaurant_id = $1 order by number`, [rid]);
  assert.deepEqual(pos.map(p => [p.doc_number, p.status, p.n]), [['BC-0001', 'draft', 1], ['BC-0002', 'draft', 1], ['BC-0003', 'draft', 1]]);
  const metroPo = pos.find(p => p.supplier_id === metro.id);
  const [{ d }] = await sql(`select ($1::date - current_date) d`, [metroPo.expected_on]);
  assert.equal(d, 2, 'expected after the lead time');
  const [l] = await sql(`select * from public.purchase_order_lines where order_id = $1`, [metroPo.id]);
  assert.equal(Number(l.unit_price_cents), 6000);
  assert.ok(Number(l.units) >= 0.5);
});

test('send, receive: purchases, stock and price follow; a received order is final', async () => {
  const [po] = await as(m, `select * from public.purchase_orders where restaurant_id = $1 and supplier_id = $2`, [rid, metro.id]);
  const [l] = await as(m, `update public.purchase_order_lines set units = 5 where order_id = $1 returning *`, [po.id]);
  await as(m, `update public.purchase_orders set status = 'sent' where id = $1`, [po.id]);
  const [sent] = await sql(`select status, sent_at from public.purchase_orders where id = $1`, [po.id]);
  assert.equal(sent.status, 'sent'); assert.ok(sent.sent_at);
  // the client cannot set "received" itself
  await assert.rejects(as(m, `update public.purchase_orders set status = 'received' where id = $1`, [po.id]), /po_receive/);
  // 4 kg came instead of 5, for 264 DH (66 DH/kg, +10 %)
  const res = await rpc(m, 'po_receive', [po.id, JSON.stringify([{ line_id: l.id, units: 4, total_cents: 26400 }]), null, true]);
  assert.equal(res.purchases, 1);
  assert.equal(res.price_alerts.length, 1);
  assert.equal(res.price_alerts[0].bp, 1000);
  assert.equal(Number((await sql(`select stock_qty from public.ingredients where id = $1`, [poulet.id]))[0].stock_qty), 5000);
  assert.equal(Number((await sql(`select purchase_price_cents from public.ingredients where id = $1`, [poulet.id]))[0].purchase_price_cents), 6600);
  const [p] = await sql(`select supplier, supplier_id, purchase_order_id from public.stock_purchases where ingredient_id = $1`, [poulet.id]);
  assert.deepEqual([p.supplier, p.supplier_id, p.purchase_order_id], ['Metro', metro.id, po.id]);
  await assert.rejects(rpc(m, 'po_receive', [po.id, '[]', null, true]), /po_closed/);
  await assert.rejects(as(m, `update public.purchase_order_lines set units = 1 where id = $1`, [l.id]), /closed/);
  await assert.rejects(as(m, `update public.purchase_orders set note = 'x' where id = $1`, [po.id]), /received/);
  // prices per supplier: the Souk sells chicken cheaper
  await as(m, `insert into public.stock_purchases (restaurant_id, ingredient_id, purchased_on, qty, total_cents, supplier_id) values ($1, $2, current_date - 3, 2000, 11000, $3)`, [rid, poulet.id, souk.id]);
  const prices = await rpc(m, 'supplier_prices', [poulet.id]);
  assert.deepEqual(prices.map(x => [x.supplier, Number(x.unit_cents)]), [['Souk', 5500], ['Metro', 6600]]);
});

test('cancel, and privacy', async () => {
  const [po] = await as(m, `select * from public.purchase_orders where restaurant_id = $1 and supplier_id = $2`, [rid, souk.id]);
  await as(m, `update public.purchase_orders set status = 'cancelled' where id = $1`, [po.id]);
  await assert.rejects(rpc(m, 'po_receive', [po.id, '[]', null, true]), /po_closed/);
  assert.equal((await as(w.users.deviceA, `select * from public.purchase_orders`)).length, 0);
  assert.equal((await as(w.users.deviceA, `select * from public.suppliers`)).length, 0);
  await assert.rejects(rpc(w.users.ownerB, 'po_from_forecast', [rid, `{${poulet.id}}`]), /not allowed/);
  await assert.rejects(rpc(w.users.ownerB, 'supplier_prices', [poulet.id]), /not allowed/);
});
