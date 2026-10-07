// Staff planning (week, cost against expected revenue, late arrivals, copy) and tips shared by hours.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, A, rid, m;
before(async () => { w = await world(); A = w.A; rid = A.r.id; m = w.users.managerA;
  await sql(`update public.restaurants set timezone = 'Africa/Casablanca' where id = $1`, [rid]); });
after(() => pool.end());
const monday = async () => (await sql(`select (date_trunc('week', now() at time zone 'Africa/Casablanca'))::date::text d`))[0].d;
const plus7 = async d => (await sql(`select ($1::date + 7)::text d`, [d]))[0].d;

test('planning: hours, cost, late arrival, copy to next week', async () => {
  const mon = await monday();
  await sql(`insert into public.staff_rates (staff_id, restaurant_id, hourly_cost_cents) values ($1, $2, 2000)`, [A.staff.sara.id, rid]);
  await as(m, `insert into public.staff_schedule (restaurant_id, staff_id, day, start_time, end_time) values ($1, $2, $3, '09:00', '17:00'), ($1, $4, $3, '18:00', '02:00')`,
    [rid, A.staff.sara.id, mon, A.staff.karim.id]);
  // Sara clocks in at 09:25 local time
  await sql(`insert into public.staff_shifts (restaurant_id, staff_id, clock_in, clock_out) values ($1, $2, ($3::date + time '09:25') at time zone 'Africa/Casablanca', ($3::date + time '17:00') at time zone 'Africa/Casablanca')`, [rid, A.staff.sara.id, mon]);
  const wk = await rpc(m, 'planning_week', [rid, mon]);
  assert.equal(wk.shifts.length, 2);
  assert.equal(Number(wk.days[0].planned_hours), 16, '8 h + 8 h past midnight');
  assert.equal(Number(wk.days[0].planned_cost_cents), 16000, 'only Sara has a rate');
  assert.equal(Number(wk.days[0].missing_rates), 1);
  assert.deepEqual(wk.late.map(x => [x.staff_id, Number(x.minutes)]), [[A.staff.sara.id, 25]]);
  await assert.rejects(rpc(w.users.deviceA, 'planning_week', [rid, mon]), /not_allowed|not allowed/);
  const next = await plus7(mon);
  assert.equal(await rpc(m, 'planning_copy_week', [rid, mon, next]), 2);
  assert.equal((await rpc(m, 'planning_week', [rid, next])).shifts.length, 2);
});

test('tips: shared by hours, once per period', async () => {
  const o = await tillOrder(w.users.deviceA, rid, [{ item_id: A.items.tajine.id }]);
  await rpc(w.users.deviceA, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: 8500, tip_cents: 1001 }]), A.staff.sara.id, null]);
  const d = (await sql(`select business_date::text d from public.orders where id = $1`, [o.id]))[0].d;
  await sql(`delete from public.staff_shifts where restaurant_id = $1`, [rid]);
  await sql(`insert into public.staff_shifts (restaurant_id, staff_id, clock_in, clock_out) values
    ($1, $2, ($4::date + time '10:00') at time zone 'Africa/Casablanca', ($4::date + time '16:00') at time zone 'Africa/Casablanca'),
    ($1, $3, ($4::date + time '10:00') at time zone 'Africa/Casablanca', ($4::date + time '13:00') at time zone 'Africa/Casablanca')`, [rid, A.staff.sara.id, A.staff.karim.id, d]);
  const p = await rpc(m, 'tips_preview', [rid, d, d, 'hours', '{}']);
  assert.equal(Number(p.total_cents), 1001);
  assert.deepEqual(p.lines.map(l => [l.name, Number(l.amount_cents)]), [['Sara', 668], ['Karim', 333]], '6 h and 3 h, the centime to who worked most');
  const eq = await rpc(m, 'tips_preview', [rid, d, d, 'equal', '{}']);
  assert.deepEqual(eq.lines.map(l => Number(l.amount_cents)), [501, 500]);
  await rpc(m, 'tips_distribute', [rid, d, d, 'hours', '{}']);
  await assert.rejects(rpc(m, 'tips_distribute', [rid, d, d, 'equal', '{}']), /tips_already_shared/);
  assert.equal((await as(m, `select * from public.tip_payouts`)).length, 1);
});
