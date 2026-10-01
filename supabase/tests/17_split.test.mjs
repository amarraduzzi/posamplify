// Splitting a bill by items at the till.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world, tillOrder } from './helpers.mjs';

let w;
before(async () => { w = await world(); });
after(() => pool.end());

test('split the bill by items: own order, own ticket, exact prices kept', async () => {
  const dev = w.users.deviceA, rid = w.A.r.id;
  const o = await tillOrder(dev, rid, [{ item_id: w.A.items.tajine.id, qty: 3 }, { item_id: w.A.items.jus.id }], { order_type: 'dine_in', table_id: w.A.tables.t2.id });
  const lines = await sql(`select id, menu_item_id, quantity from public.order_lines where order_id = $1`, [o.id]);
  const taj = lines.find(l => l.menu_item_id === w.A.items.tajine.id), jus = lines.find(l => l.menu_item_id === w.A.items.jus.id);
  // the menu price changes meanwhile: the split part keeps what was ordered
  await sql(`update public.menu_items set price_cents = 9900 where id = $1`, [w.A.items.tajine.id]);
  const res = await rpc(dev, 'pos_split_order', [o.id, JSON.stringify([{ line_id: taj.id, quantity: 2 }, { line_id: jus.id, quantity: 1 }])]);
  await sql(`update public.menu_items set price_cents = 8500 where id = $1`, [w.A.items.tajine.id]);
  assert.equal(Number(res.total_cents), 2 * 8500 + 2000);
  const [left] = await sql(`select total_cents, table_id from public.orders where id = $1`, [o.id]);
  assert.equal(Number(left.total_cents), 8500, 'one tajine stays');
  const [part] = await sql(`select table_id, closed_at from public.orders where id = $1`, [res.order_id]);
  assert.equal(part.table_id, w.A.tables.t2.id, 'same table');
  const paid = await rpc(dev, 'pos_pay_order', [res.order_id, JSON.stringify([{ method: 'card', amount_cents: Number(res.total_cents) }]), null, null]);
  assert.ok(paid.doc_number || paid.ok !== false);
  // wrong quantities, discounts
  await assert.rejects(rpc(dev, 'pos_split_order', [o.id, JSON.stringify([{ line_id: taj.id, quantity: 5 }])]), /invalid_request/);
  assert.equal((await rpc(dev, 'apply_discount', [o.id, 500, w.A.staff.karim.id, '9999'])).ok, true);
  await assert.rejects(rpc(dev, 'pos_split_order', [o.id, JSON.stringify([{ line_id: taj.id, quantity: 1 }])]), /remove_discount_first/);
  await assert.rejects(rpc(w.users.deviceB, 'pos_split_order', [o.id, JSON.stringify([{ line_id: taj.id, quantity: 1 }])]), /not allowed/);
  // moving everything: the old order goes away
  const o2 = await tillOrder(dev, rid, [{ item_id: w.A.items.jus.id }]);
  const [l2] = await sql(`select id from public.order_lines where order_id = $1`, [o2.id]);
  const all = await rpc(dev, 'pos_split_order', [o2.id, JSON.stringify([{ line_id: l2.id, quantity: 1 }])]);
  assert.equal((await sql(`select id from public.orders where id = $1`, [o2.id])).length, 0);
  await rpc(dev, 'cancel_order', [all.order_id, 'test', w.A.staff.karim.id, '9999']);
});
