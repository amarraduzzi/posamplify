// Cabins and equipment: a massage needs one free cabin, the hammam takes 2 clients at once; online
// free times need the person and a resource; the agenda screen warns when no cabin is free and can
// confirm anyway; moving an appointment takes another free cabin.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, uuid } from './helpers.mjs';

let w, A, rid, slug, d, m, sara, karim, c1, c2, ham, massage, hammam, D;
const week = JSON.stringify(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(x => [x, [['09:00', '18:00']]])));
const at = (hm) => new Date(`${D}T${hm}:00Z`).toISOString();
const book = (b) => rpc(null, 'agenda_book', [slug, { client_id: uuid(), name: 'Nadia', phone: `06${Math.floor(10000000 + Math.random() * 89999999)}`, ...b }]);
const slots = async (svc, staff) => (await rpc(null, 'agenda_slots', [slug, svc, staff, D])).map(x => new Date(x).toISOString().slice(11, 16));

before(async () => {
  w = await world(); A = w.A; rid = A.r.id; slug = A.r.slug; d = w.users.deviceA; m = w.users.managerA; sara = A.staff.sara.id; karim = A.staff.karim.id;
  await sql(`update public.restaurants set products = '{agenda}', timezone = 'UTC', agenda = '{"enabled": true}' where id = $1`, [rid]);
  await sql(`update public.staff set agenda = true, agenda_hours = $2 where id = any ($1)`, [[sara, karim], week]);
  [{ id: c1 }] = await as(m, `insert into public.agenda_resources (restaurant_id, name, sort_order) values ($1, 'Cabine 1', 1) returning id`, [rid]);
  [{ id: c2 }] = await as(m, `insert into public.agenda_resources (restaurant_id, name, sort_order) values ($1, 'Cabine 2', 2) returning id`, [rid]);
  [{ id: ham }] = await as(m, `insert into public.agenda_resources (restaurant_id, name, kind, capacity) values ($1, 'Hammam', 'room', 2) returning id`, [rid]);
  await assert.rejects(as(d, `insert into public.agenda_resources (restaurant_id, name) values ($1, 'X')`, [rid]));
  [{ id: massage }] = await sql(`insert into public.agenda_services (restaurant_id, name, duration_min, price_cents, resource_ids) values ($1, '{"fr":"Massage"}', 60, 40000, $2) returning id`, [rid, [c1, c2, uuid()]]);
  [{ id: hammam }] = await sql(`insert into public.agenda_services (restaurant_id, name, duration_min, price_cents, resource_ids) values ($1, '{"fr":"Hammam"}', 60, 20000, $2) returning id`, [rid, [ham]]);
  D = (await sql(`select (current_date + 6)::text d`))[0].d;
});
after(() => pool.end());

test('a prestation keeps only the salon’s own resources', async () => {
  const [x] = await sql(`select resource_ids from public.agenda_services where id = $1`, [massage]);
  assert.deepEqual(x.resource_ids, [c1, c2]);
});

test('online: two cabins, so the third massage at the same time is not offered', async () => {
  await sql(`insert into public.staff (restaurant_id, name, role, agenda, agenda_hours) values ($1, 'Lina', 'staff', true, $2)`, [rid, week]);
  const a1 = await book({ service_id: massage, staff_id: sara, starts_at: at('10:00') });
  const a2 = await book({ service_id: massage, staff_id: karim, starts_at: at('10:00') });
  const res = await sql(`select resource_id from public.agenda_appointments where token = any ($1) order by resource_id`, [[a1.token, a2.token]]);
  assert.deepEqual(res.map(x => x.resource_id).sort(), [c1, c2].sort());
  // Lina is free at 10:00 but no cabin is
  const lina = (await sql(`select id from public.staff where restaurant_id = $1 and name = 'Lina'`, [rid]))[0].id;
  assert.ok(!(await slots(massage, lina)).includes('10:00'));
  assert.ok((await slots(massage, lina)).includes('11:00'));
  await assert.rejects(book({ service_id: massage, staff_id: lina, starts_at: at('10:00') }), /slot_unavailable/);
});

test('the hammam takes two clients at once', async () => {
  await book({ service_id: hammam, staff_id: sara, starts_at: at('14:00') });
  await book({ service_id: hammam, staff_id: karim, starts_at: at('14:00') });
  const lina = (await sql(`select id from public.staff where restaurant_id = $1 and name = 'Lina'`, [rid]))[0].id;
  assert.ok(!(await slots(hammam, lina)).includes('14:00'));
});

test('the agenda screen: a warning when no cabin is free, confirm anyway, a move takes another cabin', async () => {
  const lina = (await sql(`select id from public.staff where restaurant_id = $1 and name = 'Lina'`, [rid]))[0].id;
  await assert.rejects(rpc(d, 'agenda_save', [rid, { service_id: massage, staff_id: lina, starts_at: at('10:00'), name: 'Hind' }, false]), /no_resource/);
  const f = await rpc(d, 'agenda_save', [rid, { service_id: massage, staff_id: lina, starts_at: at('10:00'), name: 'Hind' }, true]);
  assert.equal(f.resource_id, null);
  // moved to 16:00: a cabin is free there
  const mv = await rpc(d, 'agenda_save', [rid, { id: f.id, starts_at: at('16:00') }, false]);
  assert.ok([c1, c2].includes(mv.resource_id));
  // the salon picks cabin 2 for a new one at 16:00: free, kept
  const p = await rpc(d, 'agenda_save', [rid, { service_id: massage, staff_id: sara, starts_at: at('16:00'), name: 'Salma', resource_id: c2 }, false]);
  assert.equal(p.resource_id, mv.resource_id === c2 ? c1 : c2);
  // marking arrived never fails on the cabin
  await as(d, `update public.agenda_appointments set status = 'arrived' where id = $1`, [p.id]);
});
