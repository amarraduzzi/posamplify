// Platform admin functions: create tenants, pause/activate, purge demos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, guestOrder, tillOrder } from './helpers.mjs';

let w;
before(async () => { w = await world(); });
after(() => pool.end());

test('only platform admins can use admin functions', async () => {
  for (const u of ['ownerA', 'deviceA', 'stranger']) {
    await assert.rejects(rpc(w.users[u], 'admin_create_restaurant', ['x-' + w.tag, 'X', null, false]), /not allowed/);
    await assert.rejects(rpc(w.users[u], 'admin_set_status', [w.A.r.id, 'active', null]), /not allowed/);
    await assert.rejects(rpc(w.users[u], 'admin_add_member', [w.A.r.id, w.users.stranger.email, 'owner']), /not allowed/);
  }
  await assert.rejects(as(null, `select public.admin_set_status($1, 'active', null)`, [w.A.r.id]), /permission denied/);
});

test('admin creates a restaurant with its owner, owner can start right away', async () => {
  const id = await rpc(w.users.admin, 'admin_create_restaurant', ['nouveau-' + w.tag, 'Nouveau Café', w.users.stranger.email, false]);
  const [r] = await as(w.users.stranger, `select slug, status, trial_ends_at > now() as trial_running from public.restaurants where id = $1`, [id]);
  assert.deepEqual(r, { slug: 'nouveau-' + w.tag, status: 'trial', trial_running: true });
  const [c] = await as(w.users.stranger,
    `insert into public.categories (restaurant_id, name) values ($1, '{"fr":"Entrées"}') returning id`, [id]);
  assert.ok(c.id);
  await assert.rejects(rpc(w.users.admin, 'admin_create_restaurant', ['Bad Slug!', 'X', null, false]), /check constraint/);
  await assert.rejects(rpc(w.users.admin, 'admin_create_restaurant', ['nouveau-' + w.tag, 'Dup', null, false]), /duplicate key/);
});

test('admin pauses for non-payment and reactivates', async () => {
  await rpc(w.users.admin, 'admin_set_status', [w.A.r.id, 'paused', null]);
  await assert.rejects(tillOrder(w.users.deviceA, w.A.r.id, []), /row-level security/);
  await assert.rejects(
    rpc(null, 'place_order', [w.A.r.slug, JSON.stringify(guestOrder(w.A.tables.t1.qr_token, [{ item_id: w.A.items.tajine.id, quantity: 1 }]))]),
    /ordering_unavailable/);
  // reading history keeps working while paused
  const rows = await as(w.users.ownerA, `select id from public.menu_items where restaurant_id = $1`, [w.A.r.id]);
  assert.ok(rows.length > 0);
  await rpc(w.users.admin, 'admin_set_status', [w.A.r.id, 'active', null]);
  assert.ok((await tillOrder(w.users.deviceA, w.A.r.id, [])).id);
});

test('demo restaurants can be purged with all their data, real ones never', async () => {
  const demo = await rpc(w.users.admin, 'admin_create_restaurant', ['demo-' + w.tag, 'Démo', w.users.ownerA.email, true]);
  await sql(`insert into public.staff (restaurant_id, name, role) values ($1, 'Boss', 'manager')`, [demo]);
  const [cat] = await sql(`insert into public.categories (restaurant_id, name) values ($1, '{"fr":"P"}') returning id`, [demo]);
  const [it] = await sql(`insert into public.menu_items (restaurant_id, category_id, name, price_cents) values ($1, $2, '{"fr":"x"}', 1000) returning id`, [demo, cat.id]);
  const o = await tillOrder(w.users.ownerA, demo, [{ item_id: it.id }]);
  await as(w.users.ownerA, `insert into public.payments (restaurant_id, order_id, method, amount_cents) values ($1, $2, 'cash', 1000)`, [demo, o.id]);
  await rpc(w.users.ownerA, 'close_order', [o.id, null, null]);

  await assert.rejects(rpc(w.users.admin, 'admin_purge_demo_restaurant', [w.A.r.id]), /only_demo/);
  await assert.rejects(rpc(w.users.ownerA, 'admin_purge_demo_restaurant', [demo]), /not allowed/);
  await rpc(w.users.admin, 'admin_purge_demo_restaurant', [demo]);
  for (const t of ['restaurants', 'orders', 'fiscal_documents', 'audit_log', 'staff']) {
    const col = t === 'restaurants' ? 'id' : 'restaurant_id';
    const [{ n }] = await sql(`select count(*)::int n from public.${t} where ${col} = $1`, [demo]);
    assert.equal(n, 0, `${t} not purged`);
  }
  // the protection is back on after the purge (setting was transaction local)
  const o2 = await tillOrder(w.users.deviceA, w.A.r.id, [{ item_id: w.A.items.jus.id }]);
  await as(w.users.deviceA, `insert into public.payments (restaurant_id, order_id, method, amount_cents) values ($1, $2, 'cash', 2000)`, [w.A.r.id, o2.id]);
  const d = await rpc(w.users.deviceA, 'close_order', [o2.id, null, null]);
  await assert.rejects(sql(`delete from public.fiscal_documents where id = $1`, [d.id]), /immutable/);
});
