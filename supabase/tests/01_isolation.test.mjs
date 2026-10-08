// Tenant isolation: restaurant A must never see or touch anything of B.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, uuid, tillOrder, guestOrder } from './helpers.mjs';

let w;
before(async () => {
  w = await world();
  // give B some sales data so every table has rows on both sides
  const o = await tillOrder(w.users.deviceB, w.B.r.id, [{ item_id: w.B.items.tajine.id }]);
  await as(w.users.deviceB, `insert into public.payments (restaurant_id, order_id, method, amount_cents) values ($1,$2,'cash',$3)`,
    [w.B.r.id, o.id, o.total_cents]);
  await rpc(w.users.deviceB, 'close_order', [o.id, null, null]);
  await as(w.users.deviceB, `insert into public.cash_movements (restaurant_id, business_date, kind, amount_cents, reason)
                             values ($1, current_date, 'float', 50000, 'fond de caisse')`, [w.B.r.id]);
  const [gB] = await as(w.users.ownerB, `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents)
    values ($1, 'Farine B', 'g', 'kg', 1000, 500) returning id`, [w.B.r.id]);
  await as(w.users.ownerB, `insert into public.recipe_lines (restaurant_id, menu_item_id, ingredient_id, qty) values ($1, $2, $3, 100)`,
    [w.B.r.id, w.B.items.pizza.id, gB.id]);
  const [cB] = await as(w.users.ownerB, `insert into public.stock_counts (restaurant_id, counted_on) values ($1, current_date) returning id`, [w.B.r.id]);
  await as(w.users.ownerB, `insert into public.stock_count_lines (restaurant_id, count_id, ingredient_id, qty) values ($1, $2, $3, 500)`, [w.B.r.id, cB.id, gB.id]);
  await as(w.users.ownerB, `insert into public.stock_purchases (restaurant_id, ingredient_id, purchased_on, qty) values ($1, $2, current_date, 1000)`, [w.B.r.id, gB.id]);
  await as(w.users.ownerB, `insert into public.staff_shifts (restaurant_id, staff_id, clock_in, clock_out) values ($1, $2, now() - interval '2 hours', now())`, [w.B.r.id, w.B.staff.sara.id]);
  await as(w.users.ownerB, `insert into public.staff_rates (restaurant_id, staff_id, hourly_cost_cents) values ($1, $2, 2000)`, [w.B.r.id, w.B.staff.sara.id]);
  const [mgB] = await as(w.users.ownerB, `insert into public.modifier_groups (restaurant_id, name) values ($1, '{"fr":"Extras B"}') returning id`, [w.B.r.id]);
  await as(w.users.ownerB, `insert into public.modifier_options (restaurant_id, group_id, name, price_cents) values ($1, $2, '{"fr":"Fromage B"}', 100)`, [w.B.r.id, mgB.id]);
  await as(w.users.ownerB, `insert into public.item_modifier_groups (restaurant_id, menu_item_id, group_id) values ($1, $2, $3)`, [w.B.r.id, w.B.items.pizza.id, mgB.id]);
  const [cuB] = await as(w.users.ownerB, `insert into public.customers (restaurant_id, phone, name) values ($1, '0600000000', 'Client B') returning id`, [w.B.r.id]);
  await sql(`insert into public.loyalty_ledger (restaurant_id, customer_id, points, reason) values ($1, $2, 5, 'adjust')`, [w.B.r.id, cuB.id]);
  await sql(`insert into public.stock_moves (restaurant_id, ingredient_id, kind, qty, stock_after, business_date) select $1, id, 'adjust', 1, 1, current_date from public.ingredients where restaurant_id = $1 limit 1`, [w.B.r.id]);
  await sql(`insert into public.customer_account_ledger (restaurant_id, customer_id, kind, amount_cents, business_date, balance_after) values ($1, $2, 'adjust', 100, current_date, 0)`, [w.B.r.id, cuB.id]);
  const [suB] = await as(w.users.ownerB, `insert into public.suppliers (restaurant_id, name, phone) values ($1, 'Grossiste B', '212600000000') returning id`, [w.B.r.id]);
  const [poB] = await as(w.users.ownerB, `insert into public.purchase_orders (restaurant_id, supplier_id) values ($1, $2) returning id`, [w.B.r.id, suB.id]);
  await as(w.users.ownerB, `insert into public.purchase_order_lines (restaurant_id, order_id, ingredient_id, units) values ($1, $2, $3, 2)`, [w.B.r.id, poB.id, gB.id]);
  await as(w.users.deviceB, `insert into public.reservations (restaurant_id, kind, starts_at, party_size, name) values ($1, 'booking', now() + interval '1 day', 2, 'Client B')`, [w.B.r.id]);
  await as(w.users.ownerB, `insert into public.promotions (restaurant_id, kind, name, value) values ($1, 'happy_hour', 'HH B', 1000)`, [w.B.r.id]);
  await as(w.users.ownerB, `insert into public.staff_schedule (restaurant_id, staff_id, day, start_time, end_time) values ($1, $2, current_date, '09:00', '17:00')`, [w.B.r.id, w.B.staff.sara.id]);
  { const [sb] = await sql(`insert into public.suppliers (restaurant_id, name) values ($1, 'Fournisseur B') returning id`, [w.B.r.id]);
    await sql(`insert into public.supplier_entries (restaurant_id, supplier_id, kind, amount_cents) values ($1, $2, 'payment', 1000)`, [w.B.r.id, sb.id]); }
  await sql(`insert into public.couriers (restaurant_id, name) values ($1, 'Livreur B')`, [w.B.r.id]);
  await sql(`insert into public.site_events (restaurant_id, day, kind, n) values ($1, current_date, 'view', 3)`, [w.B.r.id]);
  await sql(`insert into public.sales_history_days (restaurant_id, day, revenue_cents) values ($1, date '2025-01-01', 100)`, [w.B.r.id]);
  await sql(`insert into public.sales_history_items (restaurant_id, day, name, qty) values ($1, date '2025-01-01', 'Plat B', 1)`, [w.B.r.id]);
  await sql(`insert into public.tip_payouts (restaurant_id, period_from, period_to, rule, total_cents, lines) values ($1, current_date, current_date, 'equal', 0, '[]')`, [w.B.r.id]);
  await as(w.users.ownerB, `insert into public.fixed_costs (restaurant_id, name, amount_cents) values ($1, 'Loyer B', 100)`, [w.B.r.id]);
  await as(w.users.ownerB, `insert into public.month_figures (restaurant_id, month, revenue_ttc_cents) values ($1, date_trunc('month', now())::date, 100)`, [w.B.r.id]);
  await rpc(w.users.ownerB, 'import_menu', [w.B.r.id, 'file', 'b.csv',
    JSON.stringify([{ category: { fr: 'Import B' }, name: { fr: 'Plat B' }, price_cents: 100 }])]);
});
after(() => pool.end());

test('every table in public has RLS enabled', async () => {
  const rows = await sql(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'app') and c.relkind = 'r' and not c.relrowsecurity`);
  assert.deepEqual(rows, [], 'tables without RLS: ' + rows.map(r => r.relname).join(', '));
});

test('guests (anon) have no table privileges at all', async () => {
  const rows = await sql(`
    select table_name, privilege_type from information_schema.role_table_grants
    where grantee = 'anon' and table_schema in ('public', 'app')`);
  assert.deepEqual(rows, []);
  await assert.rejects(as(null, 'select * from public.orders'), /permission denied/);
  await assert.rejects(as(null, 'select * from public.menu_items'), /permission denied/);
});

test('only the intended functions are callable by guests', async () => {
  const rows = await sql(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    order by 1`);
  assert.deepEqual(rows.map(r => r.proname), ['book_table', 'booking_slots', 'check_promo_code', 'courier_orders', 'courier_update', 'get_booking_info', 'get_menu', 'get_order_status', 'get_site', 'place_order', 'reservation_cancel', 'reservation_status', 'site_track', 'waitlist_join']);
});

test('restaurant A users see zero rows of restaurant B, in every tenant table', async () => {
  const tables = (await sql(`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'restaurant_id'
    order by 1`)).map(r => r.table_name);
  assert.ok(tables.length >= 14, 'expected all tenant tables, got ' + tables.join(','));

  for (const t of tables) {
    const [{ n: bRows }] = await sql(`select count(*)::int n from public.${t} where restaurant_id = $1`, [w.B.r.id]);
    for (const u of ['ownerA', 'managerA', 'deviceA', 'stranger']) {
      const [{ n }] = await as(w.users[u], `select count(*)::int n from public.${t} where restaurant_id = $1`, [w.B.r.id]);
      assert.equal(n, 0, `${u} can see ${n} row(s) of restaurant B in ${t}`);
    }
    // and the B owner does see them (the test would be meaningless otherwise)
    if (!['fiscal_submissions', 'day_closures'].includes(t)) {
      assert.ok(bRows > 0, `fixture has no B rows in ${t}`);
      const [{ n }] = await as(w.users.ownerB, `select count(*)::int n from public.${t} where restaurant_id = $1`, [w.B.r.id]);
      assert.equal(n, bRows, `owner B should see all own rows in ${t}`);
    }
  }
  const rs = await as(w.users.deviceA, `select id from public.restaurants`);
  assert.deepEqual(rs.map(r => r.id), [w.A.r.id]);
});

test('A cannot write into B, even with B ids', async () => {
  const d = w.users.ownerA;
  await assert.rejects(as(d,
    `insert into public.categories (restaurant_id, name) values ($1, '{"fr":"hack"}')`, [w.B.r.id]),
    /row-level security/);
  await assert.rejects(as(w.users.deviceA,
    `insert into public.orders (restaurant_id, client_id, business_date, ticket_number, source, order_type)
     values ($1, $2, current_date, 0, 'pos', 'takeaway')`, [w.B.r.id, uuid()]),
    /not allowed/);
  await assert.rejects(as(w.users.deviceA,
    `insert into public.cash_movements (restaurant_id, business_date, kind, amount_cents, reason)
     values ($1, current_date, 'payout', 100, 'hack')`, [w.B.r.id]), /not allowed/);
  const upd = await as(d, `update public.menu_items set price_cents = 1 where id = $1 returning id`, [w.B.items.tajine.id]);
  assert.equal(upd.length, 0);
  const del = await as(d, `delete from public.menu_items where id = $1 returning id`, [w.B.items.jus.id]);
  assert.equal(del.length, 0);
  const [{ price_cents }] = await sql(`select price_cents from public.menu_items where id = $1`, [w.B.items.tajine.id]);
  assert.equal(Number(price_cents), 8500);
});

test('a row of A can never reference a row of B (composite foreign keys)', async () => {
  const o = await tillOrder(w.users.deviceA, w.A.r.id, []);
  await assert.rejects(tillOrder(w.users.deviceA, w.A.r.id, [{ item_id: w.B.items.tajine.id }]));
  await assert.rejects(as(w.users.deviceA,
    `insert into public.order_lines (restaurant_id, order_id, menu_item_id, name, unit_price_cents, quantity, vat_bp)
     values ($1, $2, $3, '-', 0, 1, 0)`, [w.A.r.id, o.id, w.B.items.tajine.id]));
  await assert.rejects(as(w.users.ownerA,
    `insert into public.menu_items (restaurant_id, category_id, name, price_cents) values ($1, $2, '{"fr":"x"}', 100)`,
    [w.A.r.id, w.B.cats.plats.id]), /foreign key/);
  // moving a row to another restaurant is blocked
  await assert.rejects(as(w.users.ownerA, `update public.categories set restaurant_id = $1 where id = $2`,
    [w.B.r.id, w.A.cats.plats.id]));
});

test('A users cannot use B through server functions', async () => {
  const oB = (await sql(`select id from public.orders where restaurant_id = $1 limit 1`, [w.B.r.id]))[0];
  await assert.rejects(rpc(w.users.deviceA, 'close_order', [oB.id, null, null]), /not allowed/);
  await assert.rejects(rpc(w.users.deviceA, 'day_report', [w.B.r.id, null]), /not allowed/);
  await assert.rejects(rpc(w.users.deviceA, 'verify_staff_pin', [w.B.r.id, w.B.staff.karim.id, '9999']), /not allowed/);
  await assert.rejects(rpc(w.users.ownerA, 'set_staff_pin', [w.B.staff.karim.id, '0000']), /not allowed/);
  // A manager PIN of restaurant A cannot authorise actions in B
  const oA = await tillOrder(w.users.deviceA, w.A.r.id, [{ item_id: w.A.items.tajine.id }]);
  const res = await rpc(w.users.deviceA, 'apply_discount', [oA.id, 100, w.B.staff.karim.id, '9999']);
  assert.deepEqual(res, { ok: false, error: 'invalid' });
});

test('PIN hashes are unreachable for every client role', async () => {
  for (const u of ['ownerA', 'deviceA', 'admin']) {
    await assert.rejects(as(w.users[u], 'select * from app.staff_pins'), /permission denied/);
  }
  await assert.rejects(as(null, 'select * from app.staff_pins'), /permission denied/);
});

test('roles: device cannot edit the menu or staff, manager can', async () => {
  await assert.rejects(as(w.users.deviceA,
    `insert into public.categories (restaurant_id, name) values ($1, '{"fr":"x"}')`, [w.A.r.id]), /row-level security/);
  const upd = await as(w.users.deviceA, `update public.menu_items set price_cents = 1 where id = $1 returning id`, [w.A.items.tajine.id]);
  assert.equal(upd.length, 0);
  await assert.rejects(rpc(w.users.deviceA, 'set_staff_pin', [w.A.staff.sara.id, '2222']), /not allowed/);
  const ok = await as(w.users.managerA, `update public.menu_items set available = false where id = $1 returning id`, [w.A.items.jus.id]);
  assert.equal(ok.length, 1);
  await as(w.users.managerA, `update public.menu_items set available = true where id = $1`, [w.A.items.jus.id]);
});

test('owner edits profile and branding, but never status or billing fields', async () => {
  const r = await as(w.users.ownerA,
    `update public.restaurants set branding = '{"primary_color":"#000000"}' where id = $1 returning branding`, [w.A.r.id]);
  assert.equal(r[0].branding.primary_color, '#000000');
  await assert.rejects(as(w.users.ownerA, `update public.restaurants set status = 'active', trial_ends_at = null where id = $1`,
    [w.A.r.id]), /permission denied/);
  await assert.rejects(as(w.users.ownerA, `update public.restaurants set slug = 'hijack' where id = $1`, [w.A.r.id]),
    /permission denied/);
  const dev = await as(w.users.managerA, `update public.restaurants set name = 'x' where id = $1 returning id`, [w.A.r.id]);
  assert.equal(dev.length, 0, 'manager must not edit the restaurant profile');
});

test('platform admin sees every restaurant, regular users only their own', async () => {
  const all = await as(w.users.admin, `select id from public.restaurants where id = any($1)`, [[w.A.r.id, w.B.r.id]]);
  assert.equal(all.length, 2);
  const none = await as(w.users.stranger, `select id from public.restaurants`);
  assert.equal(none.length, 0);
});
