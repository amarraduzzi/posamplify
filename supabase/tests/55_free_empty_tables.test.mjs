// A table frees itself when its last line is removed; a 0 MAD order is freed without a PIN;
// an order with money still needs a reason and a manager.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, rid, dev;
before(async () => { w = await world(); rid = w.A.r.id; dev = w.users.deviceA; });
after(() => pool.end());
const status = async id => (await sql(`select status from public.orders where id = $1`, [id]))[0].status;

test('the last line removed frees the table', async () => {
  const o = await tillOrder(dev, rid, [{ item_id: w.A.items.tajine.id, price: 9000 }, { item_id: w.A.items.tajine.id, price: 9000 }]);
  const lines = await sql(`select id from public.order_lines where order_id = $1`, [o.id]);
  await as(dev, `delete from public.order_lines where id = $1`, [lines[0].id]);
  assert.notEqual(await status(o.id), 'cancelled');
  await as(dev, `delete from public.order_lines where id = $1`, [lines[1].id]);
  assert.equal(await status(o.id), 'cancelled');
});

test('0 MAD frees without a PIN; money still needs a reason and a manager', async () => {
  const free = await tillOrder(dev, rid, [{ name: 'Eau offerte', price: 0, vat_bp: 1000 }]);
  const r1 = await rpc(dev, 'cancel_order', [free.id, null, null, null]);
  assert.equal(r1.ok, true); assert.equal(await status(free.id), 'cancelled');
  const paid = await tillOrder(dev, rid, [{ item_id: w.A.items.tajine.id, price: 9000 }]);
  await assert.rejects(rpc(dev, 'cancel_order', [paid.id, null, null, null]), /reason_required/);
  const r2 = await rpc(dev, 'cancel_order', [paid.id, 'Test', null, null]);
  assert.equal(r2.ok, false);
  assert.notEqual(await status(paid.id), 'cancelled');
});
