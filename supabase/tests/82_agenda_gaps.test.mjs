// The client's language is kept for the messages; the board knows who works now.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world, uuid } from './helpers.mjs';

let w, A, rid, slug, cut, sara, karim;
before(async () => {
  w = await world(); A = w.A; rid = A.r.id; slug = A.r.slug; sara = A.staff.sara.id; karim = A.staff.karim.id;
  let off = 12 - new Date().getUTCHours(); if (off > 12) off -= 24;
  const tz = off === 0 ? 'UTC' : `Etc/GMT${off > 0 ? '-' : '+'}${Math.abs(off)}`;
  await sql(`update public.restaurants set products = '{agenda}', timezone = $2, agenda = '{"enabled": true, "queue": true, "lead_minutes": 0}' where id = $1`, [rid, tz]);
  [{ id: cut }] = await sql(`insert into public.agenda_services (restaurant_id, name, duration_min) values ($1, '{"fr":"Coupe"}', 30) returning id`, [rid]);
  const all = JSON.stringify(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(x => [x, [['00:00', '24:00']]])));
  await sql(`update public.staff set agenda = true, agenda_hours = $2 where id = $1`, [sara, all]);
  // Karim takes appointments but not today
  await sql(`update public.staff set agenda = true, agenda_hours = '{}' where id = $1`, [karim]);
  await sql(`update public.restaurants set opening_hours = '{}' where id = $1`, [rid]);
});
after(() => pool.end());

test('the Nouba keeps the language; the board lists only who works now', async () => {
  const j = await rpc(null, 'nouba_join', [slug, { client_id: uuid(), name: 'Amine', phone: '0611111111', here: true, lang: 'ar' }]);
  const [q] = await sql(`select lang from public.agenda_queue where token = $1`, [j.token]);
  assert.equal(q.lang, 'ar');
  const b = await rpc(w.users.deviceA, 'nouba_board', [rid]);
  assert.deepEqual(b.staff, [sara]); assert.equal(b.queue[0].lang, 'ar'); assert.equal(typeof b.wait_min, 'number');
});

test('an online booking keeps the language', async () => {
  const day = (await sql(`select ((now() at time zone (select timezone from public.restaurants where id = $1))::date + 1)::text as d`, [rid]))[0].d;
  const d = day;
  const slots = await rpc(null, 'agenda_slots', [slug, cut, sara, d]);
  const b = await rpc(null, 'agenda_book', [slug, { client_id: uuid(), service_id: cut, staff_id: sara, starts_at: slots[0], name: 'Nadia', phone: '0612345678', lang: 'en' }]);
  const [x] = await sql(`select lang from public.agenda_appointments where token = $1`, [b.token]);
  assert.equal(x.lang, 'en');
});
