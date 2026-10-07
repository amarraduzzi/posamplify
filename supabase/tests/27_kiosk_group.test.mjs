// Kiosk orders (secret token, no table, no phone) and groups: overview and menu copy.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, guestOrder } from './helpers.mjs';

let w, A, B;
before(async () => {
  w = await world(); A = w.A; B = w.B;
  await sql(`update public.restaurants set opening_hours = '{}' where id = $1`, [A.r.id]);
});
after(() => pool.end());

test('kiosk: dine-in without table and take-away without phone, only with the token', async () => {
  const items = [{ item_id: A.items.tajine.id, quantity: 1 }];
  await assert.rejects(rpc(null, 'place_order', [A.r.slug, JSON.stringify(guestOrder(null, items, { order_type: 'dine_in', kiosk: 'x'.repeat(20) }))]), /invalid_table/);
  await as(w.users.ownerA, `update public.restaurants set kiosk_token = 'Kiosk1234567890abcd' where id = $1`, [A.r.id]);
  const d = await rpc(null, 'place_order', [A.r.slug, JSON.stringify(guestOrder(null, items, { order_type: 'dine_in', kiosk: 'Kiosk1234567890abcd' }))]);
  const t = await rpc(null, 'place_order', [A.r.slug, JSON.stringify(guestOrder(null, items, { order_type: 'takeaway', customer: { name: 'Yassine' }, kiosk: 'Kiosk1234567890abcd' }))]);
  const rows = await sql(`select order_type, table_id, external_ref, customer_name, source from public.orders where id = any($1) order by order_type`, [[d.order_id, t.order_id]]);
  assert.deepEqual(rows.map(r => [r.order_type, r.table_id, r.external_ref, r.source]), [['dine_in', null, 'borne', 'qr'], ['takeaway', null, 'borne', 'qr']]);
  assert.equal(rows[1].customer_name, 'Yassine');
  await assert.rejects(rpc(null, 'place_order', [A.r.slug, JSON.stringify(guestOrder(null, items, { order_type: 'delivery', customer: { name: 'a', phone: '0600000000', address: 'x' }, kiosk: 'Kiosk1234567890abcd' }))]), /order_type_unavailable/);
});

test('groups: an owner of two restaurants sees both and copies the menu', async () => {
  await sql(`insert into public.memberships (user_id, restaurant_id, role) values ($1, $2, 'owner')`, [w.users.ownerA.id, B.r.id]);
  const ov = await rpc(w.users.ownerA, 'group_overview', ['2026-01-01', '2026-12-31']);
  assert.deepEqual(ov.map(x => x.id).sort(), [A.r.id, B.r.id].sort());
  assert.equal((await rpc(w.users.ownerB, 'group_overview', ['2026-01-01', '2026-12-31'])).length, 1, 'owner B only sees B');
  const before = Number((await sql(`select count(*) n from public.menu_items where restaurant_id = $1`, [B.r.id]))[0].n);
  const res = await rpc(w.users.ownerA, 'menu_copy', [A.r.id, B.r.id, false]);
  const after1 = Number((await sql(`select count(*) n from public.menu_items where restaurant_id = $1`, [B.r.id]))[0].n);
  assert.equal(after1, before + res.added);
  assert.ok(res.added + res.updated > 0);
  // again: nothing new, everything updated
  const res2 = await rpc(w.users.ownerA, 'menu_copy', [A.r.id, B.r.id, true]);
  assert.equal(res2.added, 0);
  const pa = await sql(`select price_cents from public.menu_items where id = $1`, [A.items.tajine.id]);
  const pb = await sql(`select price_cents from public.menu_items where restaurant_id = $1 and name->>'fr' = (select name->>'fr' from public.menu_items where id = $2)`, [B.r.id, A.items.tajine.id]);
  assert.equal(Number(pb[0].price_cents), Number(pa[0].price_cents));
  // not the owner of the source: refused
  await assert.rejects(rpc(w.users.ownerB, 'menu_copy', [A.r.id, B.r.id, false]), /not_allowed|not allowed/);
});
