// Guest profile: allergies, tags and preferences on the customer file, seen and completed at the till.
// The allergies follow the guest's open orders (kitchen bon); the customer's own pages never show them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, A, rid, d;
before(async () => {
  w = await world(); A = w.A; rid = A.r.id; d = w.users.deviceA;
  // Amplify Maître switched on for this restaurant
  await sql(`update public.restaurants set products = array_append(products, 'maitre') where id = $1`, [rid]);
});
after(() => pool.end());
const save = (cid, phone, name, note, allergies, tags, user = d) =>
  rpc(user, 'pos_guest_save', [rid, cid, phone, name, note, allergies, tags, null]);

test('off without a customer file: the till sees nothing and cannot write', async () => {
  assert.deepEqual(await rpc(d, 'pos_guests', [rid, [], ['0612345678']]), []);
  await assert.rejects(save(null, '0612345678', 'Leila', null, null, []), /customers_off/);
});

test('a first booking: the guest is added by phone, tags cleaned, the profile comes back in full', async () => {
  await as(w.users.ownerA, `update public.restaurants set loyalty = '{"customers": true}' where id = $1`, [rid]);
  const g = await save(null, '+212 6 12 34 56 78', 'Leila', 'Table près de la fenêtre', ' Noix ', [' VIP', 'VIP', 'Habitué', '']);
  assert.equal(g.phone, '0612345678');
  assert.equal(g.allergies, 'Noix');
  assert.deepEqual(g.tags, ['VIP', 'Habitué']);
  assert.equal(g.note, 'Table près de la fenêtre');
  assert.deepEqual(g.favorites, []);
  const list = await rpc(d, 'pos_guests', [rid, [], ['06 12 34 56 78', '0700000000']]);
  assert.equal(list.length, 1); assert.equal(list[0].id, g.id);
  await assert.rejects(save(null, '0612', 'X', null, null, ['a'.repeat(21)]), /invalid_request/);
  await assert.rejects(save(null, '0612345678', 'X', null, null, ['1', '2', '3', '4', '5', '6', '7', '8', '9']), /invalid_request/);
});

test('the allergies follow the open orders of the guest, and only the server writes them', async () => {
  const [c] = await sql(`select id from public.customers where restaurant_id = $1 and phone = '0612345678'`, [rid]);
  const o = await tillOrder(d, rid, [{ item_id: A.items.tajine.id, qty: 2 }]);
  await rpc(d, 'pos_attach_customer', [o.id, '0612345678', null, null]);
  let [x] = await sql(`select guest_alert from public.orders where id = $1`, [o.id]);
  assert.equal(x.guest_alert, 'Noix');
  // the profile changes during the meal: the open order follows
  await save(c.id, null, null, 'Table près de la fenêtre', 'Noix, arachides', ['VIP']);
  [x] = await sql(`select guest_alert from public.orders where id = $1`, [o.id]);
  assert.equal(x.guest_alert, 'Noix, arachides');
  // the back office changes it: the open order follows too
  await as(w.users.managerA, `update public.customers set allergies = 'Lait' where id = $1`, [c.id]);
  [x] = await sql(`select guest_alert from public.orders where id = $1`, [o.id]);
  assert.equal(x.guest_alert, 'Lait');
  await save(c.id, null, null, 'Table près de la fenêtre', 'Noix, arachides', ['VIP']);
  // the till itself cannot rewrite it
  await as(d, `update public.orders set guest_alert = 'rien' where id = $1`, [o.id]).catch(() => {});
  [x] = await sql(`select guest_alert from public.orders where id = $1`, [o.id]);
  assert.equal(x.guest_alert, 'Noix, arachides');
  // a new order with the guest's phone gets it at once
  const [n] = await as(d, `insert into public.orders (restaurant_id, client_id, business_date, ticket_number, source, order_type, customer_phone, customer_name)
                          values ($1, gen_random_uuid(), current_date, 0, 'pos', 'dine_in', '0612345678', 'Leila') returning guest_alert, customer_id, customer_phone`, [rid]);
  assert.equal(n.guest_alert, 'Noix, arachides');
  // paid: the visit and the favourite dish show on the profile
  const fresh = (await sql(`select * from public.orders where id = $1`, [o.id]))[0];
  await rpc(d, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: Number(fresh.total_cents) }]), null, null]);
  const g = await rpc(d, 'pos_guest', [rid, c.id, null]);
  assert.equal(g.visits, 1);
  assert.equal(g.recent.length, 1);
  assert.equal(g.favorites[0].qty, 2);
  // the order card at the till carries the profile
  const card = await rpc(d, 'pos_find_customer', [rid, '0612345678']);
  assert.equal(card.allergies, 'Noix, arachides'); assert.deepEqual(card.tags, ['VIP']);
});

test('another restaurant sees nothing', async () => {
  const [c] = await sql(`select id from public.customers where restaurant_id = $1 and phone = '0612345678'`, [rid]);
  await assert.rejects(rpc(w.users.deviceB, 'pos_guest', [rid, c.id, null]));
  await assert.rejects(rpc(w.users.deviceB, 'pos_guest_save', [rid, c.id, null, 'X', null, null, [], null]));
  await assert.rejects(rpc(w.users.deviceB, 'pos_guest_save', [w.B.r.id, c.id, null, 'X', null, null, [], null]));
});
