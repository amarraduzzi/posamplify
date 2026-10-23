// The supplier sheet: Moroccan identifiers checked, several suppliers per product with one usual one that the
// product follows (both ways), and the agreed price on order lines.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, world } from './helpers.mjs';

let w, rid, m, s1, s2, flour;
const ingSup = async () => (await sql(`select supplier_id from public.ingredients where id = $1`, [flour.id]))[0].supplier_id;
before(async () => {
  w = await world(); rid = w.A.r.id; m = w.users.managerA;
  [s1] = await as(m, `insert into public.suppliers (restaurant_id, name) values ($1, 'Moulin A') returning *`, [rid]);
  [s2] = await as(m, `insert into public.suppliers (restaurant_id, name) values ($1, 'Moulin B') returning *`, [rid]);
  [flour] = await as(m, `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents, supplier_id)
                         values ($1, 'Farine', 'g', 'sac', 25000, 20000, $2) returning *`, [rid, s1.id]);
});
after(() => pool.end());

test('identifiers are checked', async () => {
  await as(m, `update public.suppliers set ice = '001234567000089', rib = '011780000012345678901234', if_number = '12345678', pay_method = 'transfer', min_order_cents = 50000 where id = $1`, [s1.id]);
  await assert.rejects(as(m, `update public.suppliers set ice = '12' where id = $1`, [s1.id]), /check/);
  await assert.rejects(as(m, `update public.suppliers set rib = 'abc' where id = $1`, [s1.id]), /check/);
});

test('the product sheet supplier becomes the usual link, and a usual link moves the product', async () => {
  const links = await sql(`select supplier_id, is_main from public.supplier_products where ingredient_id = $1`, [flour.id]);
  assert.deepEqual(links.map(l => [l.supplier_id, l.is_main]), [[s1.id, true]]);
  await as(m, `insert into public.supplier_products (restaurant_id, supplier_id, ingredient_id, price_cents, ref) values ($1, $2, $3, 18500, 'FAR-25')`, [rid, s2.id, flour.id]);
  assert.equal(await ingSup(), s1.id, 'a second supplier does not change the usual one');
  await as(m, `update public.supplier_products set is_main = true where supplier_id = $1 and ingredient_id = $2`, [s2.id, flour.id]);
  assert.equal(await ingSup(), s2.id);
  const mains = await sql(`select supplier_id from public.supplier_products where ingredient_id = $1 and is_main`, [flour.id]);
  assert.deepEqual(mains.map(x => x.supplier_id), [s2.id]);
  await as(m, `update public.ingredients set supplier_id = $2 where id = $1`, [flour.id, s1.id]);
  const back = await sql(`select supplier_id from public.supplier_products where ingredient_id = $1 and is_main`, [flour.id]);
  assert.deepEqual(back.map(x => x.supplier_id), [s1.id]);
  await as(m, `delete from public.supplier_products where supplier_id = $1 and ingredient_id = $2`, [s1.id, flour.id]);
  assert.equal(await ingSup(), null, 'no usual link left: no usual supplier');
});

test('an order line gets the agreed price unless a price was typed', async () => {
  const [po] = await as(m, `insert into public.purchase_orders (restaurant_id, supplier_id) values ($1, $2) returning id`, [rid, s2.id]);
  const [a1] = await as(m, `insert into public.purchase_order_lines (restaurant_id, order_id, ingredient_id, units, unit_price_cents) values ($1, $2, $3, 2, 20000) returning unit_price_cents`, [rid, po.id, flour.id]);
  assert.equal(Number(a1.unit_price_cents), 18500);
  await as(m, `delete from public.purchase_order_lines where order_id = $1`, [po.id]);
  const [a2] = await as(m, `insert into public.purchase_order_lines (restaurant_id, order_id, ingredient_id, units, unit_price_cents) values ($1, $2, $3, 2, 19000) returning unit_price_cents`, [rid, po.id, flour.id]);
  assert.equal(Number(a2.unit_price_cents), 19000);
  const seen = await as(w.users.ownerB, `select count(*)::int n from public.supplier_products where restaurant_id = $1`, [rid]);
  assert.equal(seen[0].n, 0);
});
