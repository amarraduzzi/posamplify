// Demand forecast: dishes from the same weekday, the ingredients they use against the stock,
// confirmed catering on top, closed days, and who may see it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world } from './helpers.mjs';

let w, rid, today, tomorrow, g;
before(async () => {
  w = await world(); rid = w.A.r.id;
  await sql(`update public.restaurants set opening_hours = '{}' where id = $1`, [rid]);
  today = (await sql(`select app.business_date(r)::text d from public.restaurants r where id = $1`, [rid]))[0].d;
  tomorrow = (await sql(`select ($1::date + 1)::text d`, [today]))[0].d;
  // the same weekday as tomorrow, one and two weeks back: 4 then 6 tajines
  // past days (the till only writes today): straight in, without the triggers
  const c = await pool.connect();
  try {
    await c.query('begin'); await c.query(`set local session_replication_role = replica`);
    for (const [back, qty] of [[6, 4], [13, 6]]) {
      const { rows: [o] } = await c.query(`insert into public.orders (restaurant_id, client_id, business_date, ticket_number, source, order_type, status, closed_at, total_cents)
                                           values ($1, gen_random_uuid(), $2::date - $3::int, 1, 'pos', 'takeaway', 'served', now(), $4 * 9000) returning id`, [rid, today, back, qty]);
      await c.query(`insert into public.order_lines (restaurant_id, order_id, menu_item_id, name, unit_price_cents, quantity, vat_bp) values ($1, $2, $3, 'Tajine', 9000, $4, 1000)`,
        [rid, o.id, w.A.items.tajine.id, qty]);
    }
    await c.query('commit');
  } finally { c.release(); }
  // a tajine uses 250 g of chicken; 600 g in stock
  [g] = await sql(`insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty) values ($1, 'Poulet', 'g', 'kg', 1000) returning id`, [rid]);
  await sql(`insert into public.recipe_lines (restaurant_id, menu_item_id, ingredient_id, qty) values ($1, $2, $3, 250)`, [rid, w.A.items.tajine.id, g.id]);
  await sql(`update public.ingredients set stock_qty = 600 where id = $1`, [g.id]);
});
after(() => pool.end());

test('demand forecast: same weekday average, ingredients short, last week', async () => {
  await assert.rejects(rpc(w.users.ownerB, 'demand_forecast', [rid, tomorrow]));
  await assert.rejects(rpc(w.users.managerA, 'demand_forecast', [rid, '2000-01-01']), /invalid_request/);
  const f = await rpc(w.users.managerA, 'demand_forecast', [rid, tomorrow]);
  assert.equal(f.basis, 'weekday'); assert.equal(f.basis_days, 2); assert.equal(f.closed, false);
  const d = f.dishes.find(x => x.menu_item_id === w.A.items.tajine.id);
  assert.equal(Number(d.expected), 5); assert.equal(Number(d.last_week), 4);
  assert.equal(Number(f.tickets), 1);
  const c = f.ingredients.find(x => x.ingredient_id === g.id);
  assert.equal(Number(c.need), 1250); assert.equal(Number(c.short), 650);
  // today has no same-weekday history: fewer than 7 days, so no basis
  const t = await rpc(w.users.managerA, 'demand_forecast', [rid, today]);
  assert.equal(t.basis, 'none'); assert.equal(t.dishes.length, 0);
});

test('demand forecast: catering on top, closed days sell nothing', async () => {
  await sql(`with c as (insert into public.catering_orders (restaurant_id, customer_name, event_date, status) values ($1, 'Mariage', $2, 'confirmed') returning id)
             insert into public.catering_lines (restaurant_id, catering_id, menu_item_id, name, qty, unit_price_cents) select $1, c.id, $3, 'Tajine', 20, 9000 from c`,
    [rid, tomorrow, w.A.items.tajine.id]);
  let f = await rpc(w.users.managerA, 'demand_forecast', [rid, tomorrow]);
  const d = f.dishes.find(x => x.menu_item_id === w.A.items.tajine.id);
  assert.equal(Number(d.catering), 20);
  assert.equal(Number(f.ingredients.find(x => x.ingredient_id === g.id).need), 1250 + 5000);
  const key = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(tomorrow + 'T12:00:00Z').getUTCDay()];
  await sql(`update public.restaurants set opening_hours = jsonb_build_object('mon', '[["09:00","22:00"]]'::jsonb, 'tue', '[["09:00","22:00"]]'::jsonb, 'wed', '[["09:00","22:00"]]'::jsonb, 'thu', '[["09:00","22:00"]]'::jsonb, 'fri', '[["09:00","22:00"]]'::jsonb, 'sat', '[["09:00","22:00"]]'::jsonb, 'sun', '[["09:00","22:00"]]'::jsonb) - $2::text where id = $1`, [rid, key]);
  f = await rpc(w.users.managerA, 'demand_forecast', [rid, tomorrow]);
  assert.equal(f.closed, true); assert.equal(f.revenue_cents, null);
  assert.equal(Number(f.dishes.find(x => x.menu_item_id === w.A.items.tajine.id).expected), 0); // only the catering is left
  assert.equal(Number(f.ingredients.find(x => x.ingredient_id === g.id).need), 5000);
});
