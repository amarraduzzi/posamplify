// Amplify Agenda (salons): free times, booking online per person or "peu importe", the client's page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, uuid } from './helpers.mjs';

let w, A, rid, slug, cut, color, sara, karim, D;
const at = (hm) => new Date(`${D}T${hm}:00Z`).toISOString();
const times = (xs) => xs.map(x => new Date(x).toISOString().slice(11, 16));
const book = (b) => rpc(null, 'agenda_book', [slug, { client_id: uuid(), name: 'Nadia', phone: '0612345678', ...b }]);
const week = JSON.stringify(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => [d, [['09:00', '12:00']]])));

before(async () => {
  w = await world(); A = w.A; rid = A.r.id; slug = A.r.slug;
  sara = A.staff.sara.id; karim = A.staff.karim.id;
  await sql(`update public.restaurants set products = '{agenda}', timezone = 'UTC' where id = $1`, [rid]);
  [{ id: cut }] = await sql(`insert into public.agenda_services (restaurant_id, name, duration_min, buffer_min, price_cents) values ($1, '{"fr":"Coupe"}', 45, 15, 15000) returning id`, [rid]);
  [{ id: color }] = await sql(`insert into public.agenda_services (restaurant_id, name, duration_min, price_cents, online) values ($1, '{"fr":"Couleur"}', 90, 30000, false) returning id`, [rid]);
  await sql(`update public.staff set agenda = true, agenda_hours = $2 where id = any ($1)`, [[sara, karim], week]);
  D = (await sql(`select (current_date + 7)::text d`))[0].d;
});
after(() => pool.end());

test('closed until the salon opens online booking', async () => {
  await assert.rejects(rpc(null, 'agenda_slots', [slug, cut, null, D]), /booking_off/);
  assert.equal((await rpc(null, 'agenda_info', [slug])).enabled, false);
  await as(w.users.ownerA, `update public.restaurants set agenda = '{"enabled": true}' where id = $1`, [rid]);
  const info = await rpc(null, 'agenda_info', [slug]);
  assert.equal(info.enabled, true);
  assert.deepEqual(info.services.map(s => s.name.fr), ['Coupe']); // the colour is not online
  assert.equal(info.staff.length, 2);
  await assert.rejects(rpc(null, 'agenda_slots', [slug, color, null, D]), /service_not_found/);
});

test('free times: the prestation fits in the hours; booked time and the time to prepare are taken', async () => {
  let s = times(await rpc(null, 'agenda_slots', [slug, cut, sara, D]));
  assert.deepEqual(s, ['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00', '11:15']);
  const b = await book({ service_id: cut, staff_id: sara, starts_at: at('09:00') });
  assert.equal(b.status, 'confirmed'); assert.equal(b.staff, 'Sara');
  s = times(await rpc(null, 'agenda_slots', [slug, cut, sara, D]));
  assert.equal(s[0], '10:00'); // 45 min + 15 min to prepare
  // the same time again, or a time off the grid
  await assert.rejects(book({ service_id: cut, staff_id: sara, starts_at: at('09:30') }), /slot_unavailable/);
  await assert.rejects(book({ service_id: cut, staff_id: sara, starts_at: at('10:07') }), /slot_unavailable/);
  // "peu importe" still has 09:00 with Karim
  assert.equal(times(await rpc(null, 'agenda_slots', [slug, cut, null, D]))[0], '09:00');
  assert.ok((await rpc(null, 'agenda_days', [slug, cut, sara])).includes(D));
});

test('"peu importe" goes to the person with the least booked that day', async () => {
  const b = await book({ service_id: cut, staff_id: null, starts_at: at('10:30') });
  assert.equal(b.staff, 'Karim');
  const [x] = await sql(`select any_staff, service_name, price_cents, busy_until - starts_at as kept from public.agenda_appointments where token = $1`, [b.token]);
  assert.equal(x.any_staff, true); assert.equal(x.service_name.fr, 'Coupe'); assert.equal(Number(x.price_cents), 15000);
  await sql(`update public.restaurants set agenda = agenda || '{"any_staff": false}' where id = $1`, [rid]);
  await assert.rejects(rpc(null, 'agenda_slots', [slug, cut, null, D]), /staff_required/);
  await sql(`update public.restaurants set agenda = agenda - 'any_staff' where id = $1`, [rid]);
});

test('a day off of the whole salon empties the day', async () => {
  await sql(`insert into public.agenda_time_off (restaurant_id, staff_id, starts_at, ends_at) values ($1, null, $2, $3)`, [rid, at('00:00'), at('23:59')]);
  assert.deepEqual(await rpc(null, 'agenda_slots', [slug, cut, null, D]), []);
  assert.ok(!(await rpc(null, 'agenda_days', [slug, cut, null])).includes(D));
  await sql(`delete from public.agenda_time_off where restaurant_id = $1`, [rid]);
});

test('the same tap twice books once; one number cannot fill the agenda', async () => {
  const client_id = uuid();
  const a = await rpc(null, 'agenda_book', [slug, { client_id, service_id: cut, staff_id: karim, starts_at: at('09:00'), name: 'Leila', phone: '0699999999' }]);
  const b = await rpc(null, 'agenda_book', [slug, { client_id, service_id: cut, staff_id: karim, starts_at: at('09:00'), name: 'Leila', phone: '0699999999' }]);
  assert.equal(b.duplicate, true); assert.equal(a.token, b.token);
  await book({ service_id: cut, staff_id: sara, starts_at: at('11:15') }); // Nadia's third
  await assert.rejects(book({ service_id: cut, staff_id: sara, starts_at: at('10:00') }), /rate_limited/);
});

test('the client sees and cancels; too late a few hours before', async () => {
  const [{ token }] = await sql(`select token from public.agenda_appointments where restaurant_id = $1 and name = 'Leila'`, [rid]);
  let s = await rpc(null, 'agenda_status', [token]);
  assert.equal(s.staff, 'Karim'); assert.equal(s.can_cancel, true); assert.equal(s.salon.slug, slug);
  await rpc(null, 'agenda_cancel', [token]);
  s = await rpc(null, 'agenda_status', [token]);
  assert.equal(s.status, 'cancelled'); assert.equal(s.cancelled_by, 'client'); assert.equal(s.can_cancel, false);
  assert.ok(times(await rpc(null, 'agenda_slots', [slug, cut, karim, D])).includes('09:00')); // free again
  const [{ token: soon }] = await sql(`insert into public.agenda_appointments (restaurant_id, staff_id, starts_at, duration_min, name) values ($1, $2, now() + interval '2 hours', 30, 'X') returning token`, [rid, sara]);
  await assert.rejects(rpc(null, 'agenda_cancel', [soon]), /too_late/);
});

test('the salon sees its appointments; another salon sees nothing', async () => {
  assert.ok((await as(w.users.deviceA, `select count(*)::int n from public.agenda_appointments where restaurant_id = $1`, [rid]))[0].n >= 3);
  assert.equal((await as(w.users.deviceB, `select count(*)::int n from public.agenda_appointments where restaurant_id = $1`, [rid]))[0].n, 0);
  await assert.rejects(as(w.users.deviceB, `insert into public.agenda_appointments (restaurant_id, starts_at, duration_min, name) values ($1, now(), 30, 'X')`, [rid]));
  await assert.rejects(rpc(null, 'agenda_info', ['nope-nope']).then(x => { if (x === null) throw new Error('null'); }), /null/);
});
