// Amplify Profit: the team. Clock-in with the till PIN, labour cost, and per
// person what left the bill (discounts, cancellations, lines removed after the
// kitchen got them), exact. Pay rates never reach the till.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, A;
before(async () => { w = await world(); A = w.A; });
after(() => pool.end());

const pay = (o) => rpc(w.users.deviceA, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: Number(o.total_cents) }]), null, null]);
const fresh = async (o) => (await sql(`select * from public.orders where id = $1`, [o.id]))[0];

test('clock in and out on the till with the PIN; a forgotten clock-out is flagged', async () => {
  const d = w.users.deviceA, rid = A.r.id, k = A.staff.karim.id;
  assert.deepEqual(await rpc(d, 'pos_clock', [rid, k, '0000']), { ok: false, error: 'invalid' });
  let res = await rpc(d, 'pos_clock', [rid, k, '9999']);
  assert.equal(res.action, 'in');
  res = await rpc(d, 'pos_clock', [rid, k, '9999']);
  assert.equal(res.action, 'out');
  assert.equal(Number(res.minutes), 1, 'at least one minute');
  // in again, then "forgot" for 20 hours
  await rpc(d, 'pos_clock', [rid, k, '9999']);
  await sql(`update public.staff_shifts set clock_in = now() - interval '20 hours' where staff_id = $1 and clock_out is null`, [k]);
  res = await rpc(d, 'pos_clock', [rid, k, '9999']);
  assert.equal(res.action, 'in', 'a new shift starts');
  assert.equal(res.forgot, true);
  const [{ n }] = await sql(`select count(*)::int n from public.staff_shifts where staff_id = $1 and note = 'départ oublié'`, [k]);
  assert.equal(n, 1);
  // B's till cannot clock A's staff
  await assert.rejects(rpc(w.users.deviceB, 'pos_clock', [rid, k, '9999']), /not allowed/);
});

test('pay rates and shifts are for managers only, never the till', async () => {
  const rid = A.r.id;
  await as(w.users.managerA, `insert into public.staff_rates (restaurant_id, staff_id, hourly_cost_cents) values ($1, $2, 2500)`, [rid, A.staff.sara.id]);
  assert.equal((await as(w.users.deviceA, `select * from public.staff_rates`)).length, 0);
  assert.equal((await as(w.users.deviceA, `select * from public.staff_shifts`)).length, 0);
  await assert.rejects(as(w.users.deviceA, `insert into public.staff_shifts (restaurant_id, staff_id, clock_in) values ($1, $2, now())`, [rid, A.staff.sara.id]), /row-level security/);
  await assert.rejects(rpc(w.users.deviceA, 'staff_report', [rid, '2026-01-01', '2026-01-31']), /not allowed/);
  await assert.rejects(rpc(w.users.ownerB, 'staff_report', [rid, '2026-01-01', '2026-01-31']), /not allowed/);
});

test('hours, labour cost and who lets money leave the bill', async () => {
  const d = w.users.deviceA, m = w.users.managerA, rid = A.r.id, sara = A.staff.sara.id, karim = A.staff.karim.id;
  // Sara worked 8 hours yesterday (typed by the manager), 25 DH an hour
  await as(m, `insert into public.staff_shifts (restaurant_id, staff_id, clock_in, clock_out)
               values ($1, $2, date_trunc('day', now()) - interval '15 hours', date_trunc('day', now()) - interval '7 hours')`, [rid, sara]);

  const take = async (who, items) => {
    const o = await tillOrder(d, rid, items);
    await sql(`update public.orders set staff_id = $1 where id = $2`, [who, o.id]);
    return fresh(o);
  };
  // Sara: 2 tajines, clean
  await pay(await take(sara, [{ item_id: A.items.tajine.id, qty: 2 }]));
  // Sara: 1 tajine with 10 DH off, approved by Karim
  let o = await take(sara, [{ item_id: A.items.tajine.id }]);
  assert.equal((await rpc(d, 'apply_discount', [o.id, 1000, karim, '9999'])).ok, true);
  await pay(await fresh(o));
  // Sara: a juice, cancelled with Karim's PIN
  o = await take(sara, [{ item_id: A.items.jus.id }]);
  assert.equal((await rpc(d, 'cancel_order', [o.id, 'client parti', karim, '9999'])).ok, true);
  // Sara: a tajine sent to the kitchen, then removed from the bill
  o = await take(sara, []);
  const [l] = await as(d, `insert into public.order_lines (restaurant_id, order_id, menu_item_id, name, unit_price_cents, quantity, vat_bp, staff_id)
                           values ($1, $2, $3, '-', 0, 1, 0, $4) returning id`, [rid, o.id, A.items.tajine.id, sara]);
  await sql(`update public.order_lines set kitchen_sent_at = now() where id = $1`, [l.id]);
  await as(d, `delete from public.order_lines where id = $1`, [l.id]);
  // Karim: 10 tajines, clean
  await pay(await take(karim, [{ item_id: A.items.tajine.id, qty: 10 }]));

  const rep = await rpc(m, 'staff_report', [rid, new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10), new Date(Date.now() + 864e5).toISOString().slice(0, 10)]);
  assert.equal(rep.uses_pos, true);
  const s = rep.people.find(p => p.staff_id === sara);
  const k = rep.people.find(p => p.staff_id === karim);
  assert.equal(Number(s.hours), 8);
  assert.equal(Number(s.labour_cents), 20000);
  assert.equal(s.orders, 2);
  assert.equal(Number(s.sales_cents), 17000 + 7500);
  assert.equal(Number(s.avg_ticket_cents), 12250);
  assert.equal(Number(s.discount_cents), 1000);
  assert.equal(s.cancellations, 1);
  assert.equal(Number(s.cancelled_cents), 2000);
  assert.equal(s.removed_lines, 1);
  assert.equal(Number(s.removed_cents), 8500);
  assert.equal(Number(s.leak_cents), 1000 + 2000 + 8500);
  assert.equal(s.watch, true, '43 % of her bills left, the team is at 10 %');
  assert.equal(k.discounts_approved, 1);
  assert.equal(k.cancellations_approved, 1);
  assert.equal(k.watch, false);
  assert.equal(k.labour_cents, null, 'no rate for Karim');
  assert.equal(Number(rep.team.labour_cents), 20000);
  assert.equal(rep.revenue_source, 'pos');
  assert.equal(rep.labour_bp, Math.round(20000 * 10000 / Number(rep.revenue_ht_cents)));
});

test('without the till: hours and labour against the revenue typed in Charges', async () => {
  const m = w.users.managerA, rid = A.r.id;
  await sql(`update public.restaurants set products = '{profit}' where id = $1`, [rid]);
  // 110 000 DH TTC in the month, 10 % VAT -> 100 000 HT; over the whole month
  const d = new Date(); const first = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  await as(m, `insert into public.month_figures (restaurant_id, month, revenue_ttc_cents) values ($1, $2, 11000000)`, [rid, first]);
  const to = `${first.slice(0, 8)}${String(last).padStart(2, '0')}`;
  const rep = await rpc(m, 'staff_report', [rid, first, to]);
  assert.equal(rep.uses_pos, false);
  assert.equal(rep.revenue_source, 'manual');
  assert.ok(Math.abs(Number(rep.revenue_ht_cents) - 10000000) <= 1);
  const s = rep.people.find(p => p.staff_id === A.staff.sara.id);
  assert.equal(s.orders, 0, 'no till figures without the till');
  assert.equal(rep.labour_bp, Math.round(Number(rep.team.labour_cents) * 10000 / Number(rep.revenue_ht_cents)));
});

test('Z closing with a blind cash count: the difference is kept and shown per person', async () => {
  const d = w.users.deviceA, rid = A.r.id;
  await sql(`update public.restaurants set products = '{pos,profit}' where id = $1`, [rid]);
  const day = (await rpc(d, 'day_report', [rid, null]));
  // the open order of the removed-line test must go first
  for (const o of await sql(`select id from public.orders where restaurant_id = $1 and closed_at is null and status <> 'cancelled'`, [rid])) {
    await rpc(d, 'cancel_order', [o.id, 'test', A.staff.karim.id, '9999']);
  }
  const expected = Number((await rpc(d, 'day_report', [rid, null])).expected_cash_cents);
  await assert.rejects(rpc(d, 'close_day', [rid, day.business_date, A.staff.karim.id, '9999', -5]), /invalid_request/);
  const z = await rpc(d, 'close_day', [rid, day.business_date, A.staff.karim.id, '9999', expected - 12000]);
  assert.equal(z.ok, true);
  assert.equal(Number(z.totals.cash_diff_cents), -12000, '120 DH missing');
  const [c] = await sql(`select counted_cash_cents, cash_diff_cents from public.day_closures where restaurant_id = $1`, [rid]);
  assert.equal(Number(c.cash_diff_cents), -12000);
  const rep = await rpc(d, 'day_report', [rid, day.business_date]);
  assert.equal(rep.closed, true);
  assert.equal(Number(rep.cash_diff_cents), -12000);
  const team = await rpc(w.users.managerA, 'staff_report', [rid, day.business_date, day.business_date]);
  const k = team.people.find(p => p.staff_id === A.staff.karim.id);
  assert.equal(k.closings, 1);
  assert.equal(Number(k.cash_short_cents), -12000);
  assert.equal(Number(team.team.cash_short_cents), -12000);
});
