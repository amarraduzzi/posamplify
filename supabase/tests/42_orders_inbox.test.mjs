// Amplify Commandes: guest orders without the till, handled on a web page by the owner or a manager.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, guestOrder } from './helpers.mjs';

let w, A, B;
before(async () => {
  w = await world(); A = w.A; B = w.B;
  await sql(`update public.restaurants set opening_hours = '{}' where id = any($1)`, [[A.r.id, B.r.id]]);
});
after(() => pool.end());

const setProducts = (rid, prods, plan = null) => rpc(w.users.admin, 'admin_set_products', [rid, prods, plan]);
const takeaway = (r = A) => rpc(null, 'place_order', [r.r.slug, JSON.stringify(guestOrder(null, [{ item_id: r.items.jus.id, quantity: 2, note: 'sans sucre' }], { order_type: 'takeaway', customer: { name: 'Yassine', phone: '0611111111' } }))]);
// guest-order rows made directly (place_order itself is rate limited per restaurant, which is covered elsewhere)
const qrOrder = async () => ({ order_id: (await sql(`insert into public.orders (restaurant_id, client_id, business_date, ticket_number, source, order_type, customer_name, customer_phone)
  values ($1, gen_random_uuid(), current_date, 0, 'qr', 'takeaway', 'Yassine', '0611111111') returning id`, [A.r.id]))[0].id });
const status = async (id) => (await sql(`select status, eta_at, cancel_reason from public.orders where id = $1`, [id]))[0];

test('products: orders alone, with others, and what the platform keeps', async () => {
  assert.deepEqual((await setProducts(A.r.id, '{orders}')).products, ['orders']);
  assert.deepEqual((await setProducts(A.r.id, '{orders,pos}')).products, ['pos'], 'orders is included with POS');
  assert.deepEqual((await setProducts(A.r.id, '{orders,site}')).products, ['orders', 'site'], 'the website can come with orders');
  assert.deepEqual((await setProducts(A.r.id, '{profit,site}')).products, ['profit'], 'unchanged: site is included with Profit');
  assert.deepEqual((await setProducts(A.r.id, '{orders,profit}')).products, ['orders', 'profit']);
  await assert.rejects(rpc(w.users.ownerA, 'admin_set_products', [A.r.id, '{orders}', null]), /not allowed|platform/i);
});

test('guests can order with Commandes, also on the Essentiel plan, and not with Profit alone', async () => {
  await setProducts(A.r.id, '{orders}', 'essentiel');
  assert.equal((await rpc(null, 'get_menu', [A.r.slug, null])).ordering_enabled, true);
  await takeaway();
  await setProducts(A.r.id, '{profit}', 'restaurant');
  assert.equal((await rpc(null, 'get_menu', [A.r.slug, null])).ordering_enabled, false);
  await assert.rejects(takeaway(), /qr_ordering_off/);
  await setProducts(A.r.id, '{pos}', 'essentiel');
  assert.equal((await rpc(null, 'get_menu', [A.r.slug, null])).ordering_enabled, false, 'POS Essentiel is still read-only');
});

test('the owner follows an order: accept, ready, served; the guest sees it', async () => {
  await setProducts(A.r.id, '{orders}', 'restaurant');
  const o = await takeaway();
  const mine = await as(w.users.ownerA, `select id, status from public.orders where id = $1`, [o.order_id]);
  assert.equal(mine.length, 1, 'owner sees the order');
  await as(w.users.ownerA, `update public.orders set status = 'preparing', eta_at = now() + interval '20 minutes' where id = $1`, [o.order_id]);
  assert.equal((await status(o.order_id)).status, 'preparing');
  assert.ok((await status(o.order_id)).eta_at);
  assert.equal((await rpc(null, 'get_order_status', [o.order_id])).status, 'preparing');
  await as(w.users.ownerA, `update public.orders set status = 'ready' where id = $1`, [o.order_id]);
  await as(w.users.managerA, `update public.orders set status = 'served' where id = $1`, [o.order_id]);
  assert.equal((await status(o.order_id)).status, 'served');
  // the other restaurant's owner cannot touch it
  await as(w.users.ownerB, `update public.orders set status = 'new' where id = $1`, [o.order_id]);
  assert.equal((await status(o.order_id)).status, 'served');
  assert.equal((await as(w.users.ownerB, `select id from public.orders where id = $1`, [o.order_id])).length, 0);
});

test('refuse: owner and manager can, with a reason; not after it is ready, not other restaurants, not a till', async () => {
  const o1 = await qrOrder(), o2 = await qrOrder(), o3 = await qrOrder();
  await rpc(w.users.ownerA, 'inbox_refuse', [o1.order_id, 'Plus de jus']);
  assert.deepEqual(await status(o1.order_id), { status: 'cancelled', eta_at: null, cancel_reason: 'Plus de jus' });
  await rpc(w.users.ownerA, 'inbox_refuse', [o1.order_id, 'again']);                 // idempotent
  assert.equal((await status(o1.order_id)).cancel_reason, 'Plus de jus');
  await rpc(w.users.managerA, 'inbox_refuse', [o2.order_id, null]);
  assert.equal((await status(o2.order_id)).status, 'cancelled');
  await assert.rejects(rpc(w.users.ownerB, 'inbox_refuse', [o3.order_id, 'x']), /not allowed/);
  await assert.rejects(rpc(w.users.deviceA, 'inbox_refuse', [o3.order_id, 'x']), /not allowed/);
  await assert.rejects(rpc(null, 'inbox_refuse', [o3.order_id, 'x']), /not allowed|permission/i);
  await as(w.users.ownerA, `update public.orders set status = 'ready' where id = $1`, [o3.order_id]);
  await assert.rejects(rpc(w.users.ownerA, 'inbox_refuse', [o3.order_id, 'x']), /invalid_request/);
  // a till order (source pos) is not an inbox order
  const till = (await sql(`insert into public.orders (restaurant_id, client_id, business_date, ticket_number, source, order_type)
    values ($1, gen_random_uuid(), current_date, 0, 'pos', 'takeaway') returning id`, [A.r.id]))[0];
  await assert.rejects(rpc(w.users.ownerA, 'inbox_refuse', [till.id, 'x']), /invalid_request/);
});

test('a refused order cannot be reopened and the owner still cannot cancel or discount directly', async () => {
  const o = await qrOrder();
  await assert.rejects(as(w.users.ownerA, `update public.orders set status = 'cancelled' where id = $1`, [o.order_id]), /dedicated function/);
  await rpc(w.users.ownerA, 'inbox_refuse', [o.order_id, 'x']);
  await assert.rejects(as(w.users.ownerA, `update public.orders set status = 'new' where id = $1`, [o.order_id]), /cannot be reopened/);
});
