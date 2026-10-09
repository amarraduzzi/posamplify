// Takeaway: a reduction per category or dish, and recipe lines that only go with dine-in.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, A, rid, eau, cafe;
before(async () => {
  w = await world(); A = w.A; rid = A.r.id;
  await sql(`update public.restaurants set day_cutoff_hour = 0 where id = $1`, [rid]);
  const m = w.users.managerA;
  await as(m, `update public.categories set takeaway_discount_cents = 100 where id = $1`, [A.cats.boissons.id]);
  await as(m, `update public.categories set takeaway_discount_cents = 500 where id = $1`, [A.cats.plats.id]);
  await as(m, `update public.menu_items set takeaway_discount_cents = 0 where id = $1`, [A.items.tajine.id]);
  [eau] = await as(m, `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty) values ($1, 'Eau 25cl', 'pc', 'pièce', 1) returning *`, [rid]);
  [cafe] = await as(m, `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty) values ($1, 'Café', 'g', 'kg', 1000) returning *`, [rid]);
  await as(m, `insert into public.recipe_lines (restaurant_id, menu_item_id, ingredient_id, qty, dine_in_only) values ($1, $2, $3, 8, false), ($1, $2, $4, 1, true)`,
    [rid, A.items.jus.id, cafe.id, eau.id]);
  await rpc(m, 'stock_set', [eau.id, 100, 'start']);
  await rpc(m, 'stock_set', [cafe.id, 1000, 'start']);
});
after(() => pool.end());

const stock = async g => Number((await sql(`select stock_qty from public.ingredients where id = $1`, [g.id]))[0].stock_qty);
const order = async (type, lines) => {
  const o = await tillOrder(w.users.deviceA, rid, lines, { order_type: type, table_id: type === 'dine_in' ? A.tables.t1.id : null });
  return (await sql(`select * from public.orders where id = $1`, [o.id]))[0];
};
const pay = o => rpc(w.users.deviceA, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: Number(o.total_cents) }]), null, null]);

test('takeaway: category reduction, dish override, sizes; dine-in pays the menu price', async () => {
  const t = await order('takeaway', [{ item_id: A.items.jus.id }, { item_id: A.items.tajine.id }, { item_id: A.items.pizza.id, variant_id: A.variants.pizzaL.id }]);
  const lines = await sql(`select menu_item_id, unit_price_cents from public.order_lines where order_id = $1`, [t.id]);
  const p = id => Number(lines.find(l => l.menu_item_id === id).unit_price_cents);
  assert.equal(p(A.items.jus.id), 1900, 'drinks 1 DH less');
  assert.equal(p(A.items.tajine.id), 8500, 'dish set to no reduction');
  assert.equal(p(A.items.pizza.id), 7500, 'size price minus the category reduction');
  const d = await order('dine_in', [{ item_id: A.items.jus.id }]);
  assert.equal(Number(d.total_cents), 2000);
  const menu = await rpc(null, 'get_menu', [A.r.slug, null]);
  assert.equal(menu.items.find(i => i.id === A.items.jus.id).takeaway_off_cents, 100);
});

test('dine-in only recipe lines: the water bottle goes with the coffee at the table, not with takeaway', async () => {
  await pay(await order('takeaway', [{ item_id: A.items.jus.id, qty: 2 }]));
  assert.equal(await stock(eau), 100, 'takeaway: no water');
  assert.equal(await stock(cafe), 1000 - 16);
  await pay(await order('dine_in', [{ item_id: A.items.jus.id, qty: 3 }]));
  assert.equal(await stock(eau), 97, 'dine-in: one bottle per coffee');
  assert.equal(await stock(cafe), 1000 - 40);
});
