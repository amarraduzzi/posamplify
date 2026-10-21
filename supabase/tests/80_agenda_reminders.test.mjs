// WhatsApp reminders by hand: the salon marks a reminder sent, the client confirms from the link.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, A, rid;
before(async () => { w = await world(); A = w.A; rid = A.r.id; await sql(`update public.restaurants set products = '{agenda}', agenda = '{"queue": true}' where id = $1`, [rid]); });
after(() => pool.end());

test('the client confirms; the salon sees it and marks the reminder sent', async () => {
  const [x] = await sql(`insert into public.agenda_appointments (restaurant_id, starts_at, duration_min, name, phone) values ($1, now() + interval '1 day', 30, 'Nadia', '0612345678') returning id, token`, [rid]);
  assert.equal((await rpc(null, 'agenda_status', [x.token])).client_confirmed, false);
  await rpc(null, 'agenda_confirm', [x.token]);
  const s = await rpc(null, 'agenda_status', [x.token]);
  assert.equal(s.client_confirmed, true); assert.equal(s.can_confirm, true);
  await as(w.users.deviceA, `update public.agenda_appointments set reminded_at = now() where id = $1`, [x.id]);
  const [y] = await as(w.users.deviceA, `select reminded_at, client_confirmed_at from public.agenda_appointments where id = $1`, [x.id]);
  assert.ok(y.reminded_at && y.client_confirmed_at);
  await sql(`update public.agenda_appointments set status = 'cancelled' where id = $1`, [x.id]);
  await assert.rejects(rpc(null, 'agenda_confirm', [x.token]), /too_late/);
});

test('the board gives the link of each client; the salon marks them told', async () => {
  const [q] = await sql(`insert into public.agenda_queue (restaurant_id, name, phone, remote) values ($1, 'Amine', '0611111111', true) returning id, token`, [rid]);
  let b = await rpc(w.users.deviceA, 'nouba_board', [rid]);
  assert.equal(b.queue[0].token, q.token); assert.equal(b.queue[0].notified, false);
  await rpc(w.users.deviceA, 'nouba_notified', [rid, q.id]);
  b = await rpc(w.users.deviceA, 'nouba_board', [rid]);
  assert.equal(b.queue[0].notified, true);
  await assert.rejects(rpc(w.users.deviceB, 'nouba_notified', [rid, q.id]));
});
