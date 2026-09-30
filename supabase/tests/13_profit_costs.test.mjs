// Amplify Profit: fixed costs, result of the month and break-even, exact.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, A;
before(async () => { w = await world(); A = w.A; });
after(() => pool.end());
const month = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };

test('without the till: typed revenue and purchases, fixed costs, break-even', async () => {
  const m = w.users.managerA, rid = A.r.id;
  await sql(`update public.restaurants set products = '{profit}', profit_settings = '{"days_open_per_month": 26}' where id = $1`, [rid]);
  await as(m, `insert into public.fixed_costs (restaurant_id, name, category, amount_cents, frequency) values
    ($1, 'Loyer', 'loyer', 1000000, 'month'),           -- 10 000 DH / month
    ($1, 'Salaires', 'salaires', 1500000, 'month'),     -- 15 000 DH
    ($1, 'Assurance', 'assurance', 1200000, 'year'),    -- 12 000 DH / year = 1 000 / month
    ($1, 'Ancien', 'autre', 999999, 'month')`, [rid]);
  await as(m, `update public.fixed_costs set active = false where name = 'Ancien'`);
  let p = await rpc(m, 'profit_month', [rid, null]);
  assert.equal(Number(p.fixed_cents), 2600000);
  assert.equal(p.revenue_source, null);
  assert.equal(p.cogs_source, 'target');

  await as(m, `insert into public.month_figures (restaurant_id, month, revenue_ttc_cents, purchases_cents) values ($1, $2, 8800000, 2400000)`, [rid, month()]);
  p = await rpc(m, 'profit_month', [rid, null]);
  // 88 000 TTC at 10 % = 80 000 HT; goods 24 000 (30 %); fixed 26 000 -> +30 000
  assert.equal(p.revenue_source, 'manual');
  assert.equal(Number(p.revenue_ht_cents), 8000000);
  assert.equal(p.food_cost_bp, 3000);
  assert.equal(Number(p.result_cents), 3000000);
  // break-even: 26 000 / (1 - 0.30) = 37 142.86 HT a month -> x 1.10 / 26 days = 1 571.43 TTC a day
  assert.equal(Number(p.breakeven_month_ht_cents), 3714286);
  assert.equal(Number(p.breakeven_day_ttc_cents), 157143);
  assert.deepEqual(Object.keys(p.fixed_by_category).sort(), ['assurance', 'loyer', 'salaires']);
});

test('with the till: revenue comes from the fiscal tickets', async () => {
  const rid = A.r.id;
  await sql(`update public.restaurants set products = '{pos,profit}' where id = $1`, [rid]);
  const o = await tillOrder(w.users.deviceA, rid, [{ item_id: A.items.tajine.id, name: 'Tajine', price: 8500, qty: 2 }]);
  await rpc(w.users.deviceA, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: Number(o.total_cents) }]), A.staff.sara.id, null]);
  // a typed revenue wins (month of the switch); empty it and the till counts
  let p = await rpc(w.users.managerA, 'profit_month', [rid, null]);
  assert.equal(p.revenue_source, 'manual', 'typed number beats the till');
  assert.equal(Number(p.revenue_ttc_cents), 8800000);
  await sql(`update public.month_figures set revenue_ttc_cents = null where restaurant_id = $1`, [rid]);
  p = await rpc(w.users.managerA, 'profit_month', [rid, null]);
  assert.equal(p.revenue_source, 'pos');
  assert.equal(Number(p.revenue_ttc_cents), Number(o.total_cents));
  assert.equal(Number(p.revenue_today_ttc_cents), Number(o.total_cents));
  assert.equal(p.cogs_source, 'purchases', 'typed purchases still win');
});

test('costs are for managers and owners of that restaurant only', async () => {
  await assert.rejects(rpc(w.users.deviceA, 'profit_month', [A.r.id, null]), /not allowed/);
  await assert.rejects(rpc(w.users.ownerB, 'profit_month', [A.r.id, null]), /not allowed/);
  const seen = await as(w.users.deviceA, `select count(*)::int n from public.fixed_costs where restaurant_id = $1`, [A.r.id]);
  assert.equal(seen[0].n, 0, 'the till does not see rent or salaries');
  await assert.rejects(as(w.users.ownerB, `insert into public.fixed_costs (restaurant_id, name, amount_cents) values ($1, 'x', 1)`, [A.r.id]));
});
