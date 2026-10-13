// One shared QR for the whole restaurant: the guest types the table number (restaurants.qr_shared).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, guestOrder } from './helpers.mjs';

let w, A, B, items;
before(async () => {
  w = await world(); A = w.A; B = w.B;
  items = [{ item_id: A.items.tajine.id, quantity: 1 }];
  await sql(`update public.restaurants set opening_hours = '{}' where id = $1`, [A.r.id]);
});
after(() => pool.end());

const place = (order) => rpc(null, 'place_order', [A.r.slug, JSON.stringify(order)]);
const row = async (id) => (await sql(`select table_id, table_by_guest, source from public.orders where id = $1`, [id]))[0];

test('off by default: a typed table number is refused and the menu does not ask for it', async () => {
  const menu = await rpc(null, 'get_menu', [A.r.slug, null]);
  assert.equal(menu.table_entry, false);
  await assert.rejects(place(guestOrder(null, items, { table_number: '1' })), /invalid_table/);
  // the table QR still works and is not flagged
  const o = await place(guestOrder(A.tables.t1.qr_token, items));
  assert.deepEqual(await row(o.order_id), { table_id: A.tables.t1.id, table_by_guest: false, source: 'qr' });
});

test('only the owner of the restaurant can switch it on', async () => {
  await as(w.users.ownerB, `update public.restaurants set qr_shared = true where id = $1`, [A.r.id]);
  assert.equal((await sql(`select qr_shared from public.restaurants where id = $1`, [A.r.id]))[0].qr_shared, false, 'owner of B did not change A');
  await as(w.users.ownerA, `update public.restaurants set qr_shared = true where id = $1`, [A.r.id]);
  assert.equal((await sql(`select qr_shared from public.restaurants where id = $1`, [A.r.id]))[0].qr_shared, true);
  const menu = await rpc(null, 'get_menu', [A.r.slug, null]);
  assert.equal(menu.table_entry, true);
});

test('on: the typed number finds the table and the order is flagged', async () => {
  const o = await place(guestOrder(null, items, { table_number: '2' }));
  assert.deepEqual(await row(o.order_id), { table_id: A.tables.t2.id, table_by_guest: true, source: 'qr' });
  // spaces and capitals do not matter
  await sql(`insert into public.dining_tables (restaurant_id, label) values ($1, 'Bar 1')`, [A.r.id]);
  const o2 = await place(guestOrder(null, items, { table_number: '  bar 1 ' }));
  const t = (await sql(`select label from public.dining_tables where id = $1`, [(await row(o2.order_id)).table_id]))[0];
  assert.equal(t.label, 'Bar 1');
});

test('on: unknown, inactive, empty, too long and the other restaurant\'s tables are refused', async () => {
  await sql(`insert into public.dining_tables (restaurant_id, label) values ($1, 'VIP-B')`, [B.r.id]);
  for (const n of ['77', '9', '', '   ', 'VIP-B', 'x'.repeat(40)]) {
    await assert.rejects(place(guestOrder(null, items, { table_number: n })), /invalid_table/, `refused: "${n}"`);
  }
  await assert.rejects(place(guestOrder(null, items, { table_number: 5 })), /invalid_table/, 'a number that is not text');
});

test('on: a table QR wins over a typed number and is not flagged', async () => {
  const o = await place(guestOrder(A.tables.t1.qr_token, items, { table_number: '2' }));
  assert.deepEqual(await row(o.order_id), { table_id: A.tables.t1.id, table_by_guest: false, source: 'qr' });
});

test('on: take-away and delivery are unaffected', async () => {
  const o = await place(guestOrder(null, items, { order_type: 'takeaway', customer: { name: 'Sara', phone: '0600000000' }, table_number: '1' }));
  assert.deepEqual(await row(o.order_id), { table_id: null, table_by_guest: false, source: 'qr' });
});

test('switching it off again closes the door', async () => {
  await as(w.users.ownerA, `update public.restaurants set qr_shared = false where id = $1`, [A.r.id]);
  await assert.rejects(place(guestOrder(null, items, { table_number: '2' })), /invalid_table/);
});
