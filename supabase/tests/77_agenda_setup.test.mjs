// Amplify Agenda (salons), the foundation: prestations, who works when, days off. Switched on by the platform.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, A, rid;
before(async () => { w = await world(); A = w.A; rid = A.r.id; });
after(() => pool.end());

test('the platform switches Agenda on, alone or with the till', async () => {
  let r = await rpc(w.users.admin, 'admin_set_products', [rid, '{agenda}', null]);
  assert.deepEqual(r.products, ['agenda']);
  r = await rpc(w.users.admin, 'admin_set_products', [rid, '{pos,agenda,maitre}', null]);
  assert.deepEqual(r.products, ['agenda', 'maitre', 'pos']);
  r = await rpc(w.users.admin, 'admin_set_products', [rid, '{agenda,maitre}', null]);
  assert.deepEqual(r.products, ['agenda']); // Maître needs the till
});

test('the manager sets the prestations and the hours; the till reads them; another salon sees nothing', async () => {
  const [s] = await as(w.users.managerA, `insert into public.agenda_services (restaurant_id, name, category, duration_min, buffer_min, price_cents, price_from)
    values ($1, '{"fr":"Coupe femme","ar":"قص الشعر"}', 'Coupe', 45, 10, 15000, true) returning *`, [rid]);
  assert.equal(s.duration_min, 45);
  await assert.rejects(as(w.users.managerA, `insert into public.agenda_services (restaurant_id, name, duration_min) values ($1, '{"fr":"X"}', 2)`, [rid]));
  await assert.rejects(as(w.users.deviceA, `insert into public.agenda_services (restaurant_id, name) values ($1, '{"fr":"X"}')`, [rid]));
  const hours = { mon: [['09:00', '13:00'], ['14:00', '19:00']], sat: [['10:00', '18:00']] };
  await as(w.users.managerA, `update public.staff set agenda = true, agenda_hours = $2, agenda_services = $3 where id = $1`,
    [A.staff.sara.id, JSON.stringify(hours), [s.id]]);
  await assert.rejects(as(w.users.managerA, `update public.staff set agenda_hours = '{"mon": [["14:00","09:00"]]}' where id = $1`, [A.staff.sara.id]), /check/);
  await assert.rejects(as(w.users.managerA, `update public.staff set agenda_hours = '{"lundi": [["09:00","10:00"]]}' where id = $1`, [A.staff.sara.id]), /check/);
  await as(w.users.managerA, `insert into public.agenda_time_off (restaurant_id, staff_id, starts_at, ends_at, reason) values ($1, $2, now() + interval '1 day', now() + interval '2 days', 'Congé')`, [rid, A.staff.sara.id]);
  await as(w.users.managerA, `insert into public.agenda_time_off (restaurant_id, staff_id, starts_at, ends_at, reason) values ($1, null, now() + interval '5 days', now() + interval '6 days', 'Aïd')`, [rid]);
  assert.equal((await as(w.users.deviceA, `select count(*)::int n from public.agenda_time_off where restaurant_id = $1`, [rid]))[0].n, 2);
  assert.equal((await as(w.users.deviceB, `select count(*)::int n from public.agenda_services where restaurant_id = $1`, [rid]))[0].n, 0);
  await assert.rejects(as(w.users.managerB, `insert into public.agenda_time_off (restaurant_id, staff_id, starts_at, ends_at) values ($1, null, now(), now() + interval '1 hour')`, [rid]));
});
