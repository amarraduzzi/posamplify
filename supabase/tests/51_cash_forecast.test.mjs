// Cash forecast: sales per weekday from the history, purchases as a share of sales, fixed costs on
// their day or spread, supplier debts on their due date, the lowest point and the first day below zero.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world } from './helpers.mjs';

let w, rid, today;
before(async () => {
  w = await world(); rid = w.A.r.id;
  await sql(`update public.restaurants set opening_hours = '{}' where id = $1`, [rid]);
  today = (await sql(`select app.business_date(r)::text d from public.restaurants r where id = $1`, [rid]))[0].d;
  // 8 weeks of 1 000 DH a day; Sundays 2 000 DH
  await sql(`insert into public.sales_history_days (restaurant_id, day, revenue_cents)
             select $1, d, case when extract(isodow from d) = 7 then 200000 else 100000 end
               from generate_series($2::date - 56, $2::date - 1, interval '1 day') d`, [rid, today]);
  // purchases: 25 % of sales over the 8 weeks, half from a supplier paid at 30 days, half paid at once
  const [g] = await sql(`insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty) values ($1, 'Farine', 'g', 'kg', 1000) returning id`, [rid]);
  const [s] = await sql(`insert into public.suppliers (restaurant_id, name, payment_terms_days) values ($1, 'Moulin', 30) returning id`, [rid]);
  const [tot] = await sql(`select sum(revenue_cents)::bigint t from public.sales_history_days where restaurant_id = $1`, [rid]);
  await sql(`insert into public.stock_purchases (restaurant_id, ingredient_id, purchased_on, qty, total_cents, supplier_id) values ($1, $2, $3::date - 20, 1000, $4, $5)`,
    [rid, g.id, today, Math.round(Number(tot.t) * 0.125), s.id]);
  await sql(`insert into public.stock_purchases (restaurant_id, ingredient_id, purchased_on, qty, total_cents) values ($1, $2, $3::date - 3, 1000, $4)`,
    [rid, g.id, today, Math.round(Number(tot.t) * 0.125)]);
  // rent of 20 000 DH on day 5 of the month, electricity spread
  await sql(`insert into public.fixed_costs (restaurant_id, name, category, amount_cents, frequency, due_day) values ($1, 'Loyer', 'loyer', 2000000, 'month', 5), ($1, 'Lydec', 'energie', 300000, 'month', null)`, [rid]);
});
after(() => pool.end());

test('cash forecast: sales, purchases, fixed costs, suppliers, lowest point', async () => {
  await assert.rejects(rpc(w.users.ownerB, 'cash_forecast', [rid, 30]));
  await assert.rejects(rpc(w.users.ownerB, 'set_cash_position', [rid, 100]));
  await rpc(w.users.managerA, 'set_cash_position', [rid, 500000]);
  const f = await rpc(w.users.managerA, 'cash_forecast', [rid, 30]);
  assert.equal(f.source, 'history'); assert.equal(f.basis_days, 56);
  assert.equal(f.start_cents, 500000); assert.equal(f.start_as_of, today);
  assert.equal(f.ratio_source, 'purchases'); assert.equal(Number(f.purchase_ratio), 0.25);
  assert.equal(f.rows.length, 30);
  assert.equal(f.purchase_lag_days, 15);
  const dow = d => new Date(d + 'T12:00:00Z').getUTCDay();
  f.rows.forEach((x, i) => {
    assert.equal(x.sales, dow(x.date) === 0 ? 200000 : 100000);
    // bought from today on, paid 15 days later
    assert.equal(x.purchases, i < 15 ? 0 : dow(f.rows[i - 15].date) === 0 ? 50000 : 25000);
  });
  // the rent once, on the 5th
  const rent = f.big_payments.filter(p => p.name === 'Loyer');
  assert.equal(rent.length, 1); assert.equal(rent[0].date.slice(8), '05'); assert.equal(Number(rent[0].amount), 2000000);
  // the supplier invoice (bought 20 days ago, 30 days to pay) falls in 10 days, unpaid
  const sup = f.big_payments.find(p => p.kind === 'supplier');
  assert.equal(sup.name, 'Moulin');
  assert.equal(sup.date, new Date(Date.parse(today + 'T00:00:00Z') + 10 * 864e5).toISOString().slice(0, 10));
  // the balance adds up
  let bal = 500000;
  for (const x of f.rows) { bal += x.sales - x.purchases - x.fixed - x.suppliers; assert.equal(Number(x.balance), bal); }
  assert.equal(Number(f.end_cents), bal);
  const low = f.rows.reduce((m, x) => (Number(x.balance) < Number(m.balance) ? x : m));
  assert.equal(Number(f.low.balance), Number(low.balance));
  const neg = f.rows.find(x => Number(x.balance) < 0);
  assert.equal(f.first_negative ?? null, neg?.date ?? null);
  // a payment to the supplier takes the debt out of the forecast
  const [s] = await sql(`select id from public.suppliers where restaurant_id = $1`, [rid]);
  await sql(`insert into public.supplier_entries (restaurant_id, supplier_id, kind, amount_cents, entry_on, method) values ($1, $2, 'payment', 300000, current_date, 'cash')`, [rid, s.id]);
  const total = Number(f.totals.suppliers);
  const f2 = await rpc(w.users.managerA, 'cash_forecast', [rid, 30]);
  assert.equal(Number(f2.totals.suppliers), total - 300000);
});

test('cash forecast: closed days bring nothing; no history gives a clear empty basis', async () => {
  await sql(`update public.restaurants set opening_hours = '{"mon":[],"tue":[["09:00","23:00"]],"wed":[["09:00","23:00"]],"thu":[["09:00","23:00"]],"fri":[["09:00","23:00"]],"sat":[["09:00","23:00"]],"sun":[["09:00","23:00"]]}' where id = $1`, [rid]);
  const f = await rpc(w.users.managerA, 'cash_forecast', [rid, 14]);
  for (const x of f.rows) if (new Date(x.date + 'T12:00:00Z').getUTCDay() === 1) assert.equal(x.sales, 0);
  const e = await rpc(w.users.ownerB, 'cash_forecast', [w.B.r.id, 30]);
  assert.equal(e.source, 'none'); assert.equal(e.start_cents, null); assert.equal(e.ratio_source, 'default');
});
