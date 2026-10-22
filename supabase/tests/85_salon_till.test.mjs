// The salon's till: paying from the appointment or the Nouba, one line per person, cash/card/tip,
// "offert" only with a reason; the closing wants every client seen paid or explained, and the drawer
// counted blind. Only a manager cancels a ticket.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, A, rid, d, m, sara, karim, color, cut, appt, past, q;
before(async () => {
  w = await world(); A = w.A; rid = A.r.id; d = w.users.deviceA; m = w.users.managerA;
  sara = A.staff.sara.id; karim = A.staff.karim.id;
  // around midday in the salon, so the day does not change during the test
  let off = 12 - new Date().getUTCHours(); if (off > 12) off -= 24;
  const tz = off === 0 ? 'UTC' : `Etc/GMT${off > 0 ? '-' : '+'}${Math.abs(off)}`;
  await sql(`update public.restaurants set products = '{agenda}', timezone = $2, day_cutoff_hour = 0, agenda = '{"enabled": true, "queue": true}' where id = $1`, [rid, tz]);
  [{ id: color }] = await sql(`insert into public.agenda_services (restaurant_id, name, duration_min, price_cents) values ($1, '{"fr":"Couleur racines"}', 90, 25000) returning id`, [rid]);
  [{ id: cut }] = await sql(`insert into public.agenda_services (restaurant_id, name, duration_min, price_cents) values ($1, '{"fr":"Brushing"}', 30, 8000) returning id`, [rid]);
  const at = (h) => new Date(Date.now() - h * 3600_000).toISOString();
  appt = (await rpc(d, 'agenda_save', [rid, { staff_id: sara, service_id: color, starts_at: at(2), name: 'Nadia', phone: '0612345678', duration_min: 90 }, true])).id;
  past = (await rpc(d, 'agenda_save', [rid, { staff_id: karim, service_id: cut, starts_at: at(1), name: 'Salma', phone: '0623456789', duration_min: 30 }, true])).id;
  [{ id: q }] = await sql(`insert into public.agenda_queue (restaurant_id, name, phone, status, served_by, service_id, started_at) values ($1, 'Amine', '0634567890', 'serving', $2, $3, now()) returning id`, [rid, karim, cut]);
});
after(() => pool.end());

const pay = (body) => rpc(d, 'agenda_checkout', [rid, body]);

test('pay an appointment: lines per person, cash and card, a tip; the visit counts what was really paid', async () => {
  await assert.rejects(pay({ appointment_id: appt, lines: [{ service_id: color, unit_cents: 25000 }], cash_cents: 20000 }), /payment_mismatch/);
  await assert.rejects(pay({ appointment_id: appt, lines: [{ service_id: color, unit_cents: 25000, staff_id: w.B.staff.sara.id }], cash_cents: 25000 }), /invalid_request/);
  const s = await pay({ appointment_id: appt, lines: [{ service_id: color, unit_cents: 25000 }, { service_id: cut, unit_cents: 8000, staff_id: karim }, { kind: 'product', name: 'Shampoing', unit_cents: 12000 }],
    cash_cents: 30000, card_cents: 20000, tip_cents: 5000 });
  assert.equal(s.number, 1); assert.equal(s.total_cents, 45000);
  const [a] = await sql(`select status from public.agenda_appointments where id = $1`, [appt]);
  assert.equal(a.status, 'done');
  const c = await rpc(m, 'agenda_client', [rid, '0612345678']);
  assert.equal(c.visits, 1); assert.equal(Number(c.spent_cents), 45000);
  await assert.rejects(pay({ appointment_id: appt, lines: [{ unit_cents: 100 }], cash_cents: 100 }), /already_paid/);
  const lines = await sql(`select name, staff_id from public.agenda_sale_lines where restaurant_id = $1 order by sort`, [rid]);
  assert.deepEqual(lines.map(l => [l.name, l.staff_id]), [['Couleur racines', sara], ['Brushing', karim], ['Shampoing', null]]);
});

test('pay from the Nouba; offert only with a reason; a discount is kept', async () => {
  await assert.rejects(pay({ queue_id: q, lines: [{ service_id: cut, unit_cents: 8000 }], discount_cents: 8000 }), /free_reason_required/);
  const s = await pay({ queue_id: q, lines: [{ service_id: cut, unit_cents: 8000 }], discount_cents: 1000, discount_reason: 'Fidélité', cash_cents: 7000 });
  assert.equal(s.number, 2);
  const [e] = await sql(`select status from public.agenda_queue where id = $1`, [q]);
  assert.equal(e.status, 'done');
  const f = await pay({ name: 'Maman', lines: [{ service_id: cut, unit_cents: 8000, staff_id: sara }], discount_cents: 8000, free_reason: 'Famille' });
  assert.equal(f.total_cents, 0);
});

test('the screen of the salon does not see the cash before the closing; the manager does', async () => {
  const dv = await rpc(d, 'agenda_day_till', [rid, null]);
  assert.equal(dv.totals.tickets, 3); assert.equal(dv.totals.cash_cents, null); assert.equal(dv.sales[0].cash_cents, null);
  assert.equal(Number(dv.totals.card_cents), 20000); assert.equal(Number(dv.totals.tip_cents), 5000);
  const mg = await rpc(m, 'agenda_day_till', [rid, null]);
  assert.equal(Number(mg.totals.cash_cents), 37000);
  const k = mg.staff.find(x => x.staff_id === karim);
  assert.equal(Number(k.total_cents), 8000 + 7000);
  // Salma's appointment is past and never marked: she is to be paid or explained
  assert.deepEqual(dv.unpaid.map(x => x.id), [past]);
});

test('only a manager cancels a ticket, with a reason; the client is to be paid again', async () => {
  const [{ id }] = await sql(`select id from public.agenda_sales where restaurant_id = $1 and number = 1`, [rid]);
  await assert.rejects(rpc(d, 'agenda_sale_cancel', [rid, id, 'erreur']));
  await assert.rejects(rpc(m, 'agenda_sale_cancel', [rid, id, ' ']), /reason_required/);
  await rpc(m, 'agenda_sale_cancel', [rid, id, 'Erreur de prix']);
  const c = await rpc(m, 'agenda_client', [rid, '0612345678']);
  assert.equal(Number(c.spent_cents), 25000);
  const t = await rpc(m, 'agenda_day_till', [rid, null]);
  assert.equal(t.totals.cancelled, 1); assert.equal(t.unpaid.length, 2);
  // paid again, right this time
  await pay({ appointment_id: appt, lines: [{ service_id: color, unit_cents: 25000 }], cash_cents: 25000 });
  assert.equal(Number((await rpc(m, 'agenda_client', [rid, '0612345678'])).spent_cents), 25000);
});

test('the closing: every client explained, the count blind, then the day is shut', async () => {
  await assert.rejects(rpc(d, 'agenda_close_day', [rid, null, 30000, '[]']), /unpaid/);
  await assert.rejects(rpc(w.users.ownerB, 'agenda_close_day', [rid, null, 30000, '[]']));
  const r = await rpc(d, 'agenda_close_day', [rid, null, 30000, JSON.stringify([{ kind: 'appointment', id: past, reason: 'Paiera demain' }]), 'RAS']);
  assert.equal(Number(r.expected_cash_cents), 32000); assert.equal(Number(r.cash_diff_cents), -2000);
  const t = await rpc(d, 'agenda_day_till', [rid, null]);
  assert.equal(Number(t.closed.cash_diff_cents), -2000); assert.equal(t.closed.unpaid[0].reason, 'Paiera demain');
  assert.equal(Number(t.totals.cash_cents), 32000);
  await assert.rejects(pay({ name: 'X', lines: [{ unit_cents: 100 }], cash_cents: 100 }), /day_closed/);
  await assert.rejects(rpc(d, 'agenda_close_day', [rid, null, 0, '[]']), /day_closed/);
  const [{ id }] = await sql(`select id from public.agenda_sales where restaurant_id = $1 and number = 2`, [rid]);
  await assert.rejects(rpc(m, 'agenda_sale_cancel', [rid, id, 'x']), /day_closed/);
});

test('another salon sees nothing', async () => {
  for (const t of ['agenda_sales', 'agenda_sale_lines', 'agenda_closings']) {
    assert.equal((await as(w.users.ownerB, `select count(*)::int n from public.${t} where restaurant_id = $1`, [rid]))[0].n, 0);
  }
  assert.equal((await as(d, `select count(*)::int n from public.agenda_sales where restaurant_id = $1`, [rid]))[0].n, 0);
  await assert.rejects(rpc(w.users.ownerB, 'agenda_day_till', [rid, null]));
  await assert.rejects(rpc(null, 'agenda_checkout', [rid, { lines: [{ unit_cents: 1 }], cash_cents: 1 }]));
});

test('on the till: the ticket keeps who took the money; a manager PIN cancels', async () => {
  await sql(`delete from public.agenda_closings where restaurant_id = $1`, [rid]);
  const s = await rpc(d, 'agenda_checkout_by', [rid, { name: 'Walk-in', lines: [{ service_id: cut, unit_cents: 8000, staff_id: sara }], card_cents: 8000 }, sara]);
  const [row] = await sql(`select cashier_id from public.agenda_sales where id = $1`, [s.id]);
  assert.equal(row.cashier_id, sara);
  await assert.rejects(rpc(d, 'agenda_checkout_by', [rid, { lines: [{ unit_cents: 1 }], cash_cents: 1 }, w.B.staff.sara.id]), /invalid_request/);
  // the next ticket without a cashier does not inherit one
  const s2 = await rpc(d, 'agenda_checkout', [rid, { name: 'X', lines: [{ unit_cents: 100 }], cash_cents: 100 }]);
  assert.equal((await sql(`select cashier_id from public.agenda_sales where id = $1`, [s2.id]))[0].cashier_id, null);
  await assert.rejects(rpc(d, 'agenda_sale_cancel', [rid, s.id, 'erreur', null, null]), /not_allowed/);
  assert.equal((await rpc(d, 'agenda_sale_cancel', [rid, s.id, 'erreur', sara, '1111'])).error, 'not_manager');
  assert.equal((await rpc(d, 'agenda_sale_cancel', [rid, s.id, 'erreur', karim, '0000'])).error, 'invalid');
  assert.equal((await rpc(d, 'agenda_sale_cancel', [rid, s.id, 'Erreur', karim, '9999'])).ok, true);
  const [c] = await sql(`select cancelled_by_staff from public.agenda_sales where id = $1`, [s.id]);
  assert.equal(c.cancelled_by_staff, karim);
  const r = await rpc(d, 'agenda_close_day', [rid, null, 0, JSON.stringify([{ kind: 'appointment', id: past, reason: 'x' }]), null, sara]);
  assert.equal(r.ok, true);
  const t = await rpc(d, 'agenda_day_till', [rid, null]);
  assert.equal(t.closed.staff_id, sara);
});
