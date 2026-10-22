// The salon's client card: the appointment puts the client in the list, "done" counts the visit,
// the colour formulas, the no-shows; only the salon's managers see it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, A, rid, m, sara;
before(async () => {
  w = await world(); A = w.A; rid = A.r.id; m = w.users.managerA; sara = A.staff.sara.id;
  await sql(`update public.restaurants set products = '{agenda}' where id = $1`, [rid]);
});
after(() => pool.end());

test('an appointment puts the client in the list; done counts the visit once', async () => {
  const x = await rpc(w.users.deviceA, 'agenda_save', [rid, { staff_id: sara, starts_at: new Date(Date.now() - 86400_000).toISOString(), name: 'Nadia', phone: '0612345678', duration_min: 60 }, true]);
  await sql(`update public.agenda_appointments set price_cents = 25000 where id = $1`, [x.id]);
  await as(w.users.deviceA, `update public.agenda_appointments set status = 'done' where id = $1`, [x.id]);
  await as(w.users.deviceA, `update public.agenda_appointments set status = 'done' where id = $1`, [x.id]);
  const c = await rpc(m, 'agenda_client', [rid, '+212612345678']);
  assert.equal(c.name, 'Nadia'); assert.equal(c.visits, 1); assert.equal(Number(c.spent_cents), 25000); assert.equal(c.appointments.length, 1);
  const y = await rpc(w.users.deviceA, 'agenda_save', [rid, { staff_id: sara, starts_at: new Date(Date.now() - 2 * 86400_000).toISOString(), name: 'Nadia', phone: '0612345678' }, true]);
  await as(w.users.deviceA, `update public.agenda_appointments set status = 'no_show' where id = $1`, [y.id]);
  const list = await rpc(m, 'agenda_clients', [rid, 'nad']);
  assert.equal(list.length, 1); assert.equal(list[0].no_shows, 1);
  assert.equal((await rpc(m, 'agenda_clients', [rid, '345678'])).length, 1);
  assert.equal((await rpc(m, 'agenda_clients', [rid, 'zzz'])).length, 0);
});

test('the colour formulas are kept per client; only the salon sees them', async () => {
  const c = await rpc(m, 'agenda_client', [rid, '0612345678']);
  await as(m, `insert into public.agenda_formulas (restaurant_id, customer_id, staff_id, service, formula) values ($1, $2, $3, 'Couleur racines', '6.1 + 7.1, oxydant 20 vol, 35 min')`, [rid, c.id, sara]);
  const d = await rpc(m, 'agenda_client', [rid, '0612345678']);
  assert.equal(d.formulas.length, 1); assert.match(d.formulas[0].formula, /6\.1/);
  assert.equal((await as(w.users.ownerB, `select count(*)::int n from public.agenda_formulas where restaurant_id = $1`, [rid]))[0].n, 0);
  await assert.rejects(rpc(w.users.ownerB, 'agenda_client', [rid, '0612345678']));
  await assert.rejects(rpc(null, 'agenda_clients', [rid, null]));
});
