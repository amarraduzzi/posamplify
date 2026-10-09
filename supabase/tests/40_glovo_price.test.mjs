// Glovo prices: an exact Glovo price per dish or size, otherwise the restaurant price plus the Glovo markup
// (rounded up to the dirham). No happy hour on Glovo; restaurant orders keep the restaurant price.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, world, tillOrder } from './helpers.mjs';

let w, A, rid;
before(async () => { w = await world(); A = w.A; rid = A.r.id; });
after(() => pool.end());
const prices = async o => Object.fromEntries((await sql(`select menu_item_id, unit_price_cents from public.order_lines where order_id = $1`, [o.id])).map(l => [l.menu_item_id, Number(l.unit_price_cents)]));

test('glovo: markup, exact prices per dish and size, no happy hour; the restaurant keeps its prices', async () => {
  const m = w.users.managerA, items = [{ item_id: A.items.jus.id }, { item_id: A.items.tajine.id }, { item_id: A.items.pizza.id, variant_id: A.variants.pizzaL.id }];
  // nothing set: Glovo costs the same as the restaurant
  const same = await prices(await tillOrder(w.users.deviceA, rid, items, { order_type: 'delivery', source: 'glovo' }));
  assert.deepEqual([same[A.items.jus.id], same[A.items.tajine.id]], [2000, 8500]);

  await as(w.users.ownerA, `update public.restaurants set glovo_markup_bp = 2000 where id = $1`, [rid]);
  await as(m, `update public.menu_items set glovo_price_cents = 9900 where id = $1`, [A.items.tajine.id]);
  const d = (await sql(`select extract(isodow from now())::int d`))[0].d;
  await as(m, `insert into public.promotions (restaurant_id, kind, name, value, category_ids, days) values ($1, 'happy_hour', 'HH', 3000, $2::uuid[], $3::int[])`,
    [rid, `{${A.cats.boissons.id}}`, `{${d}}`]);
  const g = await prices(await tillOrder(w.users.deviceA, rid, items, { order_type: 'delivery', source: 'glovo' }));
  assert.equal(g[A.items.jus.id], 2400, '+20 %, no happy hour');
  assert.equal(g[A.items.tajine.id], 9900, 'exact Glovo price');
  const pizzaL = Number((await sql(`select price_cents from public.item_variants where id = $1`, [A.variants.pizzaL.id]))[0].price_cents);
  assert.equal(g[A.items.pizza.id], Math.ceil(pizzaL * 1.2 / 100) * 100, 'size + 20 %, whole dirham');
  await as(m, `update public.item_variants set glovo_price_cents = 9000 where id = $1`, [A.variants.pizzaL.id]);
  assert.equal((await prices(await tillOrder(w.users.deviceA, rid, items.slice(2), { order_type: 'delivery', source: 'glovo' })))[A.items.pizza.id], 9000);

  // a restaurant order: menu price with the happy hour
  const r = await prices(await tillOrder(w.users.deviceA, rid, items.slice(0, 2), { order_type: 'dine_in', table_id: A.tables.t1.id }));
  assert.deepEqual([r[A.items.jus.id], r[A.items.tajine.id]], [1400, 8500]);
});
