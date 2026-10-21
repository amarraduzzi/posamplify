// The salon's agenda: put in, warn on overlap or outside hours, force, move; another salon cannot.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world } from './helpers.mjs';

let w, A, rid, d, cut, sara, karim, D;
const at = (hm) => new Date(`${D}T${hm}:00Z`).toISOString();
const week = JSON.stringify(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(x => [x, [['09:00', '18:00']]])));

before(async () => {
  w = await world(); A = w.A; rid = A.r.id; d = w.users.deviceA; sara = A.staff.sara.id; karim = A.staff.karim.id;
  await sql(`update public.restaurants set products = '{agenda}', timezone = 'UTC' where id = $1`, [rid]);
  [{ id: cut }] = await sql(`insert into public.agenda_services (restaurant_id, name, duration_min, buffer_min, price_cents) values ($1, '{"fr":"Coupe"}', 45, 15, 15000) returning id`, [rid]);
  await sql(`update public.staff set agenda = true, agenda_hours = $2 where id = any ($1)`, [[sara, karim], week]);
  D = (await sql(`select (current_date + 3)::text d`))[0].d;
});
after(() => pool.end());

test('the salon puts an appointment in from the prestation', async () => {
  const x = await rpc(d, 'agenda_save', [rid, { service_id: cut, staff_id: sara, starts_at: at('10:00'), name: 'Nadia', phone: '+212 612-345678', source: 'phone' }, false]);
  assert.equal(x.duration_min, 45); assert.equal(x.buffer_min, 15); assert.equal(x.phone, '0612345678'); assert.equal(x.source, 'phone');
  assert.equal(Number(x.price_cents), 15000); assert.equal(x.token, undefined);
});

test('on top of another appointment or outside the hours: a warning, then the salon may confirm', async () => {
  await assert.rejects(rpc(d, 'agenda_save', [rid, { service_id: cut, staff_id: sara, starts_at: at('10:30'), name: 'Leila' }, false]), /overlap/);
  await assert.rejects(rpc(d, 'agenda_save', [rid, { service_id: cut, staff_id: sara, starts_at: at('17:45'), name: 'Leila' }, false]), /outside_hours/);
  const x = await rpc(d, 'agenda_save', [rid, { service_id: cut, staff_id: sara, starts_at: at('10:30'), name: 'Leila' }, true]);
  assert.equal(x.name, 'Leila');
});

test('moving to another time and person; the reminder no longer counts', async () => {
  const [a] = await sql(`select id from public.agenda_appointments where restaurant_id = $1 and name = 'Leila'`, [rid]);
  await sql(`update public.agenda_appointments set reminded_at = now(), client_confirmed_at = now() where id = $1`, [a.id]);
  const x = await rpc(d, 'agenda_save', [rid, { id: a.id, staff_id: karim, starts_at: at('11:30') }, false]);
  assert.equal(x.staff_id, karim); assert.equal(x.reminded_at, null); assert.equal(x.client_confirmed_at, null);
  assert.equal(x.duration_min, 45); // the prestation stays
  // moving onto itself is not an overlap
  await rpc(d, 'agenda_save', [rid, { id: a.id, starts_at: at('11:45') }, false]);
});

test('another salon cannot', async () => {
  await assert.rejects(rpc(w.users.deviceB, 'agenda_save', [rid, { service_id: cut, staff_id: sara, starts_at: at('15:00'), name: 'X' }, true]));
  await assert.rejects(rpc(null, 'agenda_save', [rid, { service_id: cut, staff_id: sara, starts_at: at('15:00'), name: 'X' }, true]));
});
