// La Nouba: the live queue of a salon. How busy, take a place from home or at the door, "Suivant".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world, uuid } from './helpers.mjs';

let w, A, rid, slug, cut, sara, karim, d;
const allDay = JSON.stringify(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(x => [x, [['00:00', '24:00']]])));
const join = (b) => rpc(null, 'nouba_join', [slug, { client_id: uuid(), ...b }]);

before(async () => {
  w = await world(); A = w.A; rid = A.r.id; slug = A.r.slug; d = w.users.deviceA;
  sara = A.staff.sara.id; karim = A.staff.karim.id;
  // a time zone where it is around midday now, so the working day never ends during the test
  let off = 12 - new Date().getUTCHours(); if (off > 12) off -= 24;
  const tz = off === 0 ? 'UTC' : `Etc/GMT${off > 0 ? '-' : '+'}${Math.abs(off)}`;
  await sql(`update public.restaurants set products = '{agenda}', timezone = $2 where id = $1`, [rid, tz]);
  [{ id: cut }] = await sql(`insert into public.agenda_services (restaurant_id, name, duration_min, price_cents) values ($1, '{"fr":"Coupe homme"}', 20, 6000) returning id`, [rid]);
});
after(() => pool.end());

test('off until the salon turns the Nouba on; closed when nobody works', async () => {
  assert.equal((await rpc(null, 'nouba_info', [slug])).enabled, false);
  await assert.rejects(join({ name: 'Amine', phone: '0611111111' }), /queue_off/);
  await sql(`update public.restaurants set agenda = '{"queue": true, "queue_remote_max": 2, "queue_default_min": 20}' where id = $1`, [rid]);
  const i = await rpc(null, 'nouba_info', [slug]);
  assert.equal(i.enabled, true); assert.equal(i.open, false);
  await assert.rejects(join({ name: 'Amine', phone: '0611111111' }), /closed/);
});

test('one barber: the wait grows with each client; two barbers share the queue', async () => {
  await sql(`update public.staff set agenda = true, agenda_hours = $2 where id = $1`, [sara, allDay]);
  let i = await rpc(null, 'nouba_info', [slug]);
  assert.equal(i.open, true); assert.equal(i.working, 1); assert.equal(i.wait_min, 0); assert.equal(i.waiting, 0);
  const a = await join({ name: 'Amine', phone: '0611111111', service_id: cut });
  await join({ name: 'Omar', phone: '0622222222', here: true });
  i = await rpc(null, 'nouba_info', [slug]);
  assert.equal(i.waiting, 2); assert.equal(i.wait_min, 40);
  let s = await rpc(null, 'nouba_status', [a.token]);
  assert.equal(s.ahead, 0); assert.equal(s.soon, true);
  await sql(`update public.staff set agenda = true, agenda_hours = $2 where id = $1`, [karim, allDay]);
  i = await rpc(null, 'nouba_info', [slug]);
  assert.equal(i.working, 2); assert.equal(i.wait_min, 20);
  // the same number twice
  await assert.rejects(join({ name: 'Amine', phone: '0611111111' }), /already_waiting/);
});

test('places from home are limited; at the door always', async () => {
  await join({ name: 'Yassine', phone: '0633333333' }); // second remote: limit 2 reached
  await assert.rejects(join({ name: 'Hamza', phone: '0644444444' }), /remote_full/);
  assert.equal((await rpc(null, 'nouba_info', [slug])).remote, false);
  await join({ name: 'Hamza', phone: '0644444444', here: true });
});

test('"Suivant": the barber takes the next client; the next press ends it', async () => {
  const r1 = await rpc(d, 'nouba_next', [rid, sara, null]);
  assert.equal(r1.next.name, 'Amine'); assert.equal(r1.next.status, 'serving');
  const r2 = await rpc(d, 'nouba_next', [rid, karim, null]);
  assert.equal(r2.next.name, 'Omar');
  const r3 = await rpc(d, 'nouba_next', [rid, sara, null]);
  assert.equal(r3.next.name, 'Yassine');
  const [{ status }] = await sql(`select status from public.agenda_queue where id = $1`, [r1.next.id]);
  assert.equal(status, 'done');
  const b = await rpc(d, 'nouba_board', [rid]);
  assert.equal(b.queue.filter(x => x.status === 'serving').length, 2);
  assert.equal(b.queue.filter(x => x.status === 'waiting').length, 1);
  await assert.rejects(rpc(w.users.deviceB, 'nouba_next', [rid, sara, null]));
  await assert.rejects(rpc(w.users.deviceB, 'nouba_board', [rid]));
});

test('the client answers "j\'arrive" or leaves; the desk adds a walk-in', async () => {
  const a = await join({ name: 'Ilyas', phone: '0655555555', here: true });
  await rpc(null, 'nouba_answer', [a.token, 'coming']);
  assert.equal((await rpc(null, 'nouba_status', [a.token])).coming, true);
  await rpc(null, 'nouba_answer', [a.token, 'leave']);
  assert.equal((await rpc(null, 'nouba_status', [a.token])).status, 'left');
  const x = await rpc(d, 'nouba_add', [rid, { name: '' }]);
  assert.equal(x.name, 'Client'); assert.equal(x.token, undefined);
  await rpc(d, 'nouba_set', [rid, x.id, 'no_show']);
});
