// Deposits (acomptes) and no-show rules: a prestation or a client's no-shows ask a deposit when
// booking; the client sees how to pay and says she paid; the salon marks it received (cash on the
// till, or a transfer: not in the drawer); unpaid in time, the time is free and the appointment is
// cancelled; the till takes the deposit off the bill; a no-show keeps it; a cancellation is given
// back (the ticket of the day is cancelled) or kept as a credit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, uuid } from './helpers.mjs';

let w, A, rid, slug, d, m, sara, bal, cut, D;
const week = JSON.stringify(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(x => [x, [['09:00', '18:00']]])));
const at = (hm) => new Date(`${D}T${hm}:00Z`).toISOString();
const book = (b) => rpc(null, 'agenda_book', [slug, { client_id: uuid(), name: 'Nadia', phone: '0612345678', staff_id: sara, ...b }]);
const apptOf = async (token) => (await sql(`select id from public.agenda_appointments where token = $1`, [token]))[0].id;

before(async () => {
  w = await world(); A = w.A; rid = A.r.id; slug = A.r.slug; d = w.users.deviceA; m = w.users.managerA; sara = A.staff.sara.id;
  await sql(`update public.restaurants set products = '{agenda}', timezone = 'UTC', day_cutoff_hour = 0,
               agenda = '{"enabled": true, "deposit": {"enabled": true, "after_no_shows": 2, "noshow_cents": 5000, "hours": 12,
                          "rib": "011 780 0000123456789 12", "rib_name": "Salon A", "link": "https://pay.example.ma/salon-a", "cashplus": "Salon A, 0612000000"}}' where id = $1`, [rid]);
  [{ id: bal }] = await sql(`insert into public.agenda_services (restaurant_id, name, duration_min, price_cents, deposit_cents) values ($1, '{"fr":"Balayage"}', 120, 60000, 10000) returning id`, [rid]);
  [{ id: cut }] = await sql(`insert into public.agenda_services (restaurant_id, name, duration_min, price_cents) values ($1, '{"fr":"Coupe"}', 30, 15000) returning id`, [rid]);
  await sql(`update public.staff set agenda = true, agenda_hours = $2 where id = $1`, [sara, week]);
  D = (await sql(`select (current_date + 5)::text d`))[0].d;
});
after(() => pool.end());

test('a prestation asks a deposit; the client sees how to pay and says she paid', async () => {
  const info = await rpc(null, 'agenda_info', [slug]);
  assert.equal(info.services.find(s => s.id === bal).deposit_cents, 10000);
  const b = await book({ service_id: bal, starts_at: at('09:00') });
  assert.equal(b.deposit.amount_cents, 10000); assert.equal(b.deposit.reason, 'service');
  const st = await rpc(null, 'agenda_status', [b.token]);
  assert.equal(st.deposit.status, 'pending'); assert.equal(st.deposit.pay.link, 'https://pay.example.ma/salon-a'); assert.ok(st.deposit.pay.rib);
  await rpc(null, 'agenda_deposit_report', [b.token, 'VIR 12345']);
  assert.equal((await rpc(null, 'agenda_status', [b.token])).deposit.reported, true);
  // a prestation without deposit
  const c = await book({ service_id: cut, starts_at: at('12:00') });
  assert.equal(c.deposit, null);
});

test('received by transfer: a credit, not in the drawer; then taken off the bill', async () => {
  const [{ id: aid, token }] = await sql(`select a.id, a.token from public.agenda_appointments a join public.agenda_deposits x on x.appointment_id = a.id where a.restaurant_id = $1`, [rid]);
  await assert.rejects(rpc(null, 'agenda_deposit_paid', [rid, aid, 'transfer']));
  const p = await rpc(d, 'agenda_deposit_paid', [rid, aid, 'transfer', null, null, null]);
  assert.match(p.code, /^ACP-/);
  await assert.rejects(rpc(d, 'agenda_deposit_paid', [rid, aid, 'cash', null, null, null]), /deposit_paid/);
  const [x] = await sql(`select status, method, provider_ref from public.agenda_deposits where appointment_id = $1`, [aid]);
  assert.equal(x.status, 'paid'); assert.equal(x.method, 'transfer'); assert.equal(x.provider_ref, 'VIR 12345');
  const till = await rpc(m, 'agenda_day_till', [rid, null]);
  assert.equal(Number(till.totals.other_cents), 10000); assert.equal(Number(till.totals.cash_cents), 0);
  assert.equal((await rpc(null, 'agenda_status', [token])).deposit.status, 'paid');
  // the day of the visit: 600 DH, 100 already paid
  const dep = await rpc(d, 'agenda_appt_deposit', [rid, aid]);
  assert.equal(Number(dep.balance_cents), 10000);
  await rpc(d, 'agenda_checkout', [rid, { appointment_id: aid, lines: [{ service_id: bal, unit_cents: 60000, staff_id: sara }],
    giftcard_code: dep.code, giftcard_cents: 10000, cash_cents: 50000 }]);
  assert.equal(Number((await rpc(d, 'agenda_appt_deposit', [rid, aid])).balance_cents), 0);
});

test('two no-shows: every booking of that client asks the rule’s deposit', async () => {
  for (const hm of ['08:00', '08:30']) {
    await sql(`insert into public.agenda_appointments (restaurant_id, staff_id, status, starts_at, duration_min, name, phone)
               values ($1, $2, 'no_show', now() - interval '3 days', 30, 'Hind', '0611111111')`, [rid, sara]);
  }
  const b = await book({ service_id: cut, starts_at: at('14:00'), name: 'Hind', phone: '0611111111' });
  assert.equal(b.deposit.amount_cents, 5000); assert.equal(b.deposit.reason, 'no_shows');
  const rule = await rpc(d, 'agenda_deposit_rule', [rid, cut, '0611111111']);
  assert.equal(Number(rule.amount_cents), 5000); assert.equal(rule.no_shows, 2);
});

test('unpaid in time: the time is free again and the appointment cancelled', async () => {
  const b = await book({ service_id: bal, starts_at: at('15:00'), phone: '0622222222' });
  const aid = await apptOf(b.token);
  const slots = async () => (await rpc(null, 'agenda_slots', [slug, cut, sara, D])).map(x => new Date(x).toISOString().slice(11, 16));
  assert.ok(!(await slots()).includes('15:00'));
  await sql(`update public.agenda_deposits set due_at = now() - interval '1 minute' where appointment_id = $1`, [aid]);
  assert.ok((await slots()).includes('15:00'));
  assert.equal((await rpc(null, 'agenda_status', [b.token])).deposit.status, 'expired');
  await rpc(d, 'agenda_deposits', [rid]);
  const [a] = await sql(`select status from public.agenda_appointments where id = $1`, [aid]);
  assert.equal(a.status, 'cancelled');
  assert.equal((await sql(`select status from public.agenda_deposits where appointment_id = $1`, [aid]))[0].status, 'expired');
});

test('asked by the salon; a no-show keeps it; a cancellation is given back or kept as credit', async () => {
  const mk = async (hm, ph) => (await rpc(d, 'agenda_save', [rid, { service_id: cut, staff_id: sara, starts_at: at(hm), name: 'Salma', phone: ph }, true])).id;
  const a1 = await mk('16:00', '0633333333');
  await rpc(d, 'agenda_deposit_request', [rid, a1, 5000, 6]);
  await rpc(d, 'agenda_deposit_request', [rid, a1, 0, null]);
  assert.equal((await sql(`select count(*)::int n from public.agenda_deposits where appointment_id = $1`, [a1]))[0].n, 0);
  await rpc(d, 'agenda_deposit_request', [rid, a1, 5000, 6]);
  const p1 = await rpc(d, 'agenda_deposit_paid', [rid, a1, 'cash', null, null, null]);
  // no-show: kept, the credit is gone; put back by mistake: it comes back
  await as(d, `update public.agenda_appointments set status = 'no_show' where id = $1`, [a1]);
  assert.equal((await sql(`select status from public.agenda_deposits where appointment_id = $1`, [a1]))[0].status, 'kept');
  assert.equal((await rpc(d, 'agenda_giftcard_check', [rid, p1.code])).ok, false);
  await as(d, `update public.agenda_appointments set status = 'confirmed' where id = $1`, [a1]);
  assert.equal((await rpc(d, 'agenda_giftcard_check', [rid, p1.code])).ok, true);
  // cancelled: to settle; given back the same day: the ticket is cancelled, the drawer stays right
  await as(d, `update public.agenda_appointments set status = 'cancelled' where id = $1`, [a1]);
  const [x1] = await sql(`select id, status from public.agenda_deposits where appointment_id = $1`, [a1]);
  assert.equal(x1.status, 'to_settle');
  await assert.rejects(rpc(d, 'agenda_deposit_settle', [rid, x1.id, 'refund', null]));
  const cashBefore = Number((await rpc(m, 'agenda_day_till', [rid, null])).totals.cash_cents);
  const s1 = await rpc(m, 'agenda_deposit_settle', [rid, x1.id, 'refund', 'Annulé à temps']);
  assert.equal(s1.ticket_cancelled, true);
  assert.equal(Number((await rpc(m, 'agenda_day_till', [rid, null])).totals.cash_cents), cashBefore - 5000);
  assert.equal((await sql(`select status from public.agenda_deposits where id = $1`, [x1.id]))[0].status, 'refunded');
  // another one kept as a credit for the next visit
  const a2 = await mk('17:00', '0644444444');
  await rpc(d, 'agenda_deposit_request', [rid, a2, 5000, null]);
  const p2 = await rpc(d, 'agenda_deposit_paid', [rid, a2, 'card', null, null, null]);
  await as(d, `update public.agenda_appointments set status = 'cancelled' where id = $1`, [a2]);
  const [x2] = await sql(`select id from public.agenda_deposits where appointment_id = $1`, [a2]);
  await rpc(m, 'agenda_deposit_settle', [rid, x2.id, 'credit', null]);
  assert.equal(Number((await rpc(d, 'agenda_giftcard_check', [rid, p2.code])).balance_cents), 5000);
  const l = await rpc(d, 'agenda_deposits', [rid]);
  assert.ok(l.list.some(x => x.status === 'credited' && x.code === p2.code));
  // the deposits are not in the list of gift cards sold
  const pl = await rpc(m, 'agenda_prepaid_list', [rid]);
  assert.ok(pl.giftcards.every(g => g.kind === 'deposit' || !g.code.startsWith('ACP-')));
});
