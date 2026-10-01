// Platform: a client restaurant can be deleted for good, but only by a platform admin,
// only once suspended, and only by typing its slug again.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w;
before(async () => { w = await world(); });
after(() => pool.end());

test('delete a client restaurant with all its data and till logins', async () => {
  const slug = 'gone-' + w.tag;
  const rid = await rpc(w.users.admin, 'admin_create_restaurant', [slug, 'Parti', w.users.ownerA.email, false]);
  const [dev] = await sql(`insert into auth.users (email) values ($1) returning id, email`, [`till-${w.tag}@test.ma`]);
  await sql(`insert into public.memberships (restaurant_id, user_id, role) values ($1, $2, 'device')`, [rid, dev.id]);
  const [cat] = await sql(`insert into public.categories (restaurant_id, name) values ($1, '{"fr":"P"}') returning id`, [rid]);
  const [it] = await sql(`insert into public.menu_items (restaurant_id, category_id, name, price_cents) values ($1, $2, '{"fr":"x"}', 1000) returning id`, [rid, cat.id]);
  const o = await tillOrder(w.users.ownerA, rid, [{ item_id: it.id }]);
  await as(w.users.ownerA, `insert into public.payments (restaurant_id, order_id, method, amount_cents) values ($1, $2, 'cash', 1000)`, [rid, o.id]);
  await rpc(w.users.ownerA, 'close_order', [o.id, null, null]);

  await assert.rejects(rpc(w.users.ownerA, 'admin_delete_restaurant', [rid, slug]), /not allowed/);
  await assert.rejects(rpc(w.users.admin, 'admin_delete_restaurant', [rid, slug]), /suspend_first/);
  await rpc(w.users.admin, 'admin_set_status', [rid, 'paused', null]);
  await assert.rejects(rpc(w.users.admin, 'admin_delete_restaurant', [rid, 'autre']), /confirm_slug_mismatch/);
  const res = await rpc(w.users.admin, 'admin_delete_restaurant', [rid, slug.toUpperCase()]);
  assert.deepEqual([res.tickets_deleted, res.till_logins_deleted], [1, 1]);
  for (const t of ['restaurants', 'orders', 'fiscal_documents', 'memberships', 'menu_items']) {
    const col = t === 'restaurants' ? 'id' : 'restaurant_id';
    assert.equal((await sql(`select count(*)::int n from public.${t} where ${col} = $1`, [rid]))[0].n, 0, `${t} left`);
  }
  assert.equal((await sql(`select count(*)::int n from auth.users where id = $1`, [dev.id]))[0].n, 0, 'till login left');
  assert.equal((await sql(`select count(*)::int n from auth.users where id = $1`, [w.users.ownerA.id]))[0].n, 1, 'owner keeps the account');
  // the other restaurants are untouched and still protected
  assert.ok((await tillOrder(w.users.deviceA, w.A.r.id, [])).id);
});
