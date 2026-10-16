// Quick picks for the waiter's phone: the dishes sold most per part of the day, and the remarks typed
// most often per dish; only for the restaurant's own devices and staff.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world, tillOrder } from './helpers.mjs';

let w, rid;
before(async () => { w = await world(); rid = w.A.r.id; });
after(() => pool.end());

test('quick picks: popular dishes and learned remarks', async () => {
  await assert.rejects(rpc(w.users.ownerB, 'pos_quick_picks', [rid]));
  for (let i = 0; i < 3; i++) await tillOrder(w.users.deviceA, rid, [{ item_id: w.A.items.tajine.id, qty: 2, price: 9000 }]);
  const o = await tillOrder(w.users.deviceA, rid, [{ item_id: w.A.items.tajine.id, qty: 1, price: 9000 }]);
  await sql(`update public.order_lines set note = 'Sans oignon' where order_id in (select id from public.orders where restaurant_id = $1)`, [rid]);
  const x = await rpc(w.users.deviceA, 'pos_quick_picks', [rid]);
  const all = Object.values(x.popular).flat();
  assert.ok(all.includes(w.A.items.tajine.id));
  assert.deepEqual(x.notes[w.A.items.tajine.id], ['Sans oignon']);
  assert.deepEqual(x.common_notes, ['Sans oignon']);
  assert.ok(o.id);
});

test('welcome screen: who is on duty and the bookings left today', async () => {
  await assert.rejects(rpc(w.users.ownerB, 'pos_gate_info', [rid]));
  const [s] = await sql(`select id from public.staff where restaurant_id = $1 limit 1`, [rid]);
  await sql(`insert into public.staff_shifts (restaurant_id, staff_id, clock_in, source) values ($1, $2, now() - interval '1 hour', 'pos')`, [rid, s.id]);
  const g = await rpc(w.users.deviceA, 'pos_gate_info', [rid]);
  assert.deepEqual(g.on_duty, [s.id]);
  assert.equal(typeof g.bookings_today, 'number');
});
