// Start fresh before going live: sales, tickets and stock go, the menu, recipes, ingredients and customers stay.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w;
before(async () => { w = await world(); });
after(() => pool.end());
const n = async (t, rid) => (await sql(`select count(*)::int n from public.${t} where restaurant_id = $1`, [rid]))[0].n;

test('reset activity: only a platform admin, slug typed again; everything sold goes, everything built stays', async () => {
  const A = w.A, rid = A.r.id, m = w.users.managerA;
  const [g] = await as(m, `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty) values ($1, 'Lait', 'ml', 'l', 1000) returning *`, [rid]);
  await as(m, `insert into public.recipe_lines (restaurant_id, menu_item_id, ingredient_id, qty) values ($1, $2, $3, 100)`, [rid, A.items.jus.id, g.id]);
  await rpc(m, 'stock_set', [g.id, 5000, 'start']);
  const o = await tillOrder(w.users.deviceA, rid, [{ item_id: A.items.jus.id }]);
  const [ord] = await sql(`select * from public.orders where id = $1`, [o.id]);
  await rpc(w.users.deviceA, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: Number(ord.total_cents) }]), null, null]);
  assert.ok(await n('fiscal_documents', rid) >= 1);
  const items = await n('menu_items', rid), lines = await n('recipe_lines', rid), ings = await n('ingredients', rid);

  await assert.rejects(rpc(w.users.ownerA, 'admin_reset_activity', [rid, A.r.slug]), /not allowed/);
  await assert.rejects(rpc(w.users.admin, 'admin_reset_activity', [rid, 'autre']), /confirm_slug_mismatch/);
  const res = await rpc(w.users.admin, 'admin_reset_activity', [rid, A.r.slug.toUpperCase()]);
  assert.equal(res.ok, true);
  for (const t of ['orders', 'order_lines', 'payments', 'fiscal_documents', 'stock_moves', 'day_closures', 'cash_movements']) assert.equal(await n(t, rid), 0, `${t} left`);
  assert.deepEqual([await n('menu_items', rid), await n('recipe_lines', rid), await n('ingredients', rid)], [items, lines, ings]);
  assert.equal((await sql(`select stock_qty from public.ingredients where id = $1`, [g.id]))[0].stock_qty, null, 'stock not counted yet');
  assert.equal((await sql(`select count(*)::int n from public.audit_log where restaurant_id = $1 and changes ? 'reset_activity'`, [rid]))[0].n, 1);

  // the till keeps working and numbering starts again
  const o2 = await tillOrder(w.users.deviceA, rid, [{ item_id: A.items.jus.id }]);
  const [ord2] = await sql(`select * from public.orders where id = $1`, [o2.id]);
  await rpc(w.users.deviceA, 'pos_pay_order', [o2.id, JSON.stringify([{ method: 'cash', amount_cents: Number(ord2.total_cents) }]), null, null]);
  assert.equal(await n('fiscal_documents', rid), 1);
  // the other restaurant is untouched
  assert.ok(await n('menu_items', w.B.r.id) > 0);
});
