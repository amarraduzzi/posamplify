// Products and plans: POS and Profit alone or together, set by the platform;
// Essentiel = one till and a QR menu to read only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world, guestOrder } from './helpers.mjs';

let w, A;
before(async () => { w = await world(); A = w.A; });
after(() => pool.end());
const newUser = async (n) => (await sql(`insert into auth.users (email) values ($1) returning id`, [`${n}-${Math.random().toString(36).slice(2, 8)}@test.ma`]))[0];
const pair = async (u) => { const c = await rpc(w.users.managerA, 'create_pairing_code', [A.r.id, 'Poste']); return rpc(u, 'pair_device', [c.code]); };
const takeaway = () => rpc(null, 'place_order', [A.r.slug, JSON.stringify(guestOrder(null, [{ item_id: A.items.jus.id, quantity: 1 }], { order_type: 'takeaway', customer: { name: 'Y', phone: '0611111111' } }))]);

test('only the platform sets products and plan; the owner cannot', async () => {
  await assert.rejects(rpc(w.users.ownerA, 'admin_set_products', [A.r.id, '{pos}', 'essentiel']), /not allowed|platform/i);
  await assert.rejects(sql(`set role authenticated; update public.restaurants set pos_plan = 'essentiel'`).finally(() => sql('reset role')), /permission/);
  const res = await rpc(w.users.admin, 'admin_set_products', [A.r.id, '{pos,pos,other}', 'essentiel']);
  assert.deepEqual(res.products, ['pos']);
  assert.equal(res.pos_plan, 'essentiel');
  await assert.rejects(rpc(w.users.admin, 'admin_set_products', [A.r.id, '{}', null]), /invalid_request/);
});

test('Essentiel: QR menu to read only, one till', async () => {
  const menu = await rpc(null, 'get_menu', [A.r.slug, null]);
  assert.equal(menu.ordering_enabled, false);
  await assert.rejects(takeaway(), /qr_ordering_off/);
  // restaurant A already has one till (deviceA): a second one is refused, the same one may pair again
  await assert.rejects(pair(await newUser('second')), /plan_device_limit/);
  await pair(w.users.deviceA);
  // Restaurant plan: ordering and more tills
  await rpc(w.users.admin, 'admin_set_products', [A.r.id, '{pos,profit}', 'restaurant']);
  assert.equal((await rpc(null, 'get_menu', [A.r.slug, null])).ordering_enabled, true);
  await takeaway();
  await pair(await newUser('third'));
  // Profit alone: no QR ordering either
  await rpc(w.users.admin, 'admin_set_products', [A.r.id, '{profit}', null]);
  assert.equal((await rpc(null, 'get_menu', [A.r.slug, null])).ordering_enabled, false);
});
