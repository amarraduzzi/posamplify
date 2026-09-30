// Amplify Profit: exact recipe costs and margins, price history, and cost data
// only for managers/owners of that restaurant.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, A;
before(async () => { w = await world(); A = w.A; });
after(() => pool.end());

const ing = (user, rid, o) => as(user,
  `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents, waste_bp)
   values ($1, $2, $3, $4, $5, $6, $7) returning *`,
  [rid, o.name, o.base, o.unit, o.qty, o.price ?? null, o.waste ?? 0]).then(r => r[0]);
const line = (user, rid, item, ingredient, qty, variant = null) => as(user,
  `insert into public.recipe_lines (restaurant_id, menu_item_id, variant_id, ingredient_id, qty) values ($1, $2, $3, $4, $5)`,
  [rid, item, variant, ingredient, qty]);
const dish = (res, item, variant = null) => res.dishes.find(d => d.item_id === item && d.variant_id === variant);

test('recipe cost, food cost and margin are exact', async () => {
  const m = w.users.managerA, rid = A.r.id;
  // chicken 60 DH/kg with 25 % bones; lemons: a crate of 10 kg for 80 DH; olives 40 DH/kg
  const poulet = await ing(m, rid, { name: 'Poulet', base: 'g', unit: 'kg', qty: 1000, price: 6000, waste: 2500 });
  const citron = await ing(m, rid, { name: 'Citron', base: 'g', unit: 'caisse', qty: 10000, price: 8000 });
  const olive = await ing(m, rid, { name: 'Olives', base: 'g', unit: 'kg', qty: 1000, price: 4000 });
  // tajine: 300 g chicken, 50 g lemon, 30 g olives
  await line(m, rid, A.items.tajine.id, poulet.id, 300);
  await line(m, rid, A.items.tajine.id, citron.id, 50);
  await line(m, rid, A.items.tajine.id, olive.id, 30);

  const res = await rpc(m, 'profit_dishes', [rid, 30]);
  const t = dish(res, A.items.tajine.id);
  // 300 * 6000 / (1000 * 0.75) = 2400 ; 50 * 8000 / 10000 = 40 ; 30 * 4000 / 1000 = 120  -> 2560 c
  assert.equal(Number(t.cost_cents), 2560);
  // price 85 DH incl. 10 % VAT -> 7727 c excl. VAT
  assert.equal(Number(t.price_ht_cents), 7727);
  assert.equal(t.food_cost_bp, 3313, '25.60 / 77.27 = 33.13 %');
  assert.equal(Number(t.margin_cents), 7727 - 2560);
  // target 30 %: 25.60 / 0.30 = 85.33 excl. VAT -> 93.87 incl. -> 94 DH
  assert.equal(Number(t.suggested_price_cents), 9400);
  assert.equal(res.target_food_cost_bp, 3000);

  const jus = dish(res, A.items.jus.id);
  assert.equal(jus.cost_cents, null, 'no recipe yet');
  assert.equal(jus.lines, 0);
});

test('sizes: shared lines plus lines for one size', async () => {
  const m = w.users.managerA, rid = A.r.id;
  const pate = await ing(m, rid, { name: 'Pâte', base: 'pc', unit: 'pièce', qty: 1, price: 300 });
  const fromage = await ing(m, rid, { name: 'Mozzarella', base: 'g', unit: 'kg', qty: 1000, price: 9000 });
  await line(m, rid, A.items.pizza.id, pate.id, 1);                          // every size
  await line(m, rid, A.items.pizza.id, fromage.id, 80, A.variants.pizzaS.id);
  await line(m, rid, A.items.pizza.id, fromage.id, 150, A.variants.pizzaL.id);
  const res = await rpc(m, 'profit_dishes', [rid, 30]);
  assert.equal(Number(dish(res, A.items.pizza.id, A.variants.pizzaS.id).cost_cents), 300 + 720);
  assert.equal(Number(dish(res, A.items.pizza.id, A.variants.pizzaL.id).cost_cents), 300 + 1350);
  assert.equal(dish(res, A.items.pizza.id, A.variants.pizzaOff.id), undefined, 'inactive size left out');
  assert.equal(dish(res, A.items.pizza.id), undefined, 'a dish with sizes is shown per size');
});

test('unknown price is flagged, sales from the till give the profit', async () => {
  const m = w.users.managerA, rid = A.r.id;
  const sauce = await ing(m, rid, { name: 'Sauce maison', base: 'ml', unit: 'litre', qty: 1000 });
  await line(m, rid, A.items.tajine.id, sauce.id, 20);
  let t = dish(await rpc(m, 'profit_dishes', [rid, 30]), A.items.tajine.id);
  assert.equal(t.unpriced, 1);
  assert.equal(Number(t.cost_cents), 2560, 'unknown price counts as 0 but is flagged');

  // two tajines sold and paid at the till, one cancelled order does not count
  const o = await tillOrder(w.users.deviceA, rid, [{ item_id: A.items.tajine.id, name: 'Tajine', price: 8500, qty: 2 }]);
  await rpc(w.users.deviceA, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: Number(o.total_cents) }]), A.staff.sara.id, null]);
  const c = await tillOrder(w.users.deviceA, rid, [{ item_id: A.items.tajine.id, name: 'Tajine', price: 8500, qty: 5 }]);
  await rpc(w.users.deviceA, 'cancel_order', [c.id, 'test', A.staff.karim.id, '9999']);
  t = dish(await rpc(m, 'profit_dishes', [rid, 30]), A.items.tajine.id);
  assert.equal(Number(t.sold_qty), 2);
  assert.equal(Number(t.profit_cents), 2 * (7727 - 2560));
});

test('price changes are kept, target can be changed by the owner', async () => {
  const m = w.users.managerA, rid = A.r.id;
  const tomate = await ing(m, rid, { name: 'Tomate', base: 'g', unit: 'kg', qty: 1000, price: 600 });
  await as(m, `update public.ingredients set purchase_price_cents = 800 where id = $1`, [tomate.id]);
  await as(m, `update public.ingredients set supplier = 'Souk' where id = $1`, [tomate.id]);
  const h = await as(m, `select purchase_price_cents p from public.ingredient_prices where ingredient_id = $1 order by recorded_at`, [tomate.id]);
  assert.deepEqual(h.map(x => Number(x.p)), [600, 800], 'only real price changes');

  await as(w.users.ownerA, `update public.restaurants set profit_settings = '{"target_food_cost_bp": 2800}' where id = $1`, [rid]);
  assert.equal((await rpc(m, 'profit_dishes', [rid, 30])).target_food_cost_bp, 2800);
  await assert.rejects(as(w.users.ownerA, `update public.restaurants set products = '{pos}' where id = $1`, [rid]), /permission denied/,
    'products are not for the owner to change');
});

test('costs are for managers and owners of that restaurant only', async () => {
  const rid = A.r.id;
  const seen = await as(w.users.deviceA, `select count(*)::int n from public.ingredients where restaurant_id = $1`, [rid]);
  assert.equal(seen[0].n, 0, 'the till does not see purchase prices');
  await assert.rejects(rpc(w.users.deviceA, 'profit_dishes', [rid, 30]), /not allowed/);
  await assert.rejects(rpc(w.users.ownerB, 'profit_dishes', [rid, 30]), /not allowed/);
  await assert.rejects(ing(w.users.ownerB, rid, { name: 'Hack', base: 'g', unit: 'kg', qty: 1000, price: 1 }));
  const [g] = await as(w.users.managerA, `select id from public.ingredients where restaurant_id = $1 and name = 'Poulet'`, [rid]);
  await assert.rejects(as(w.users.managerA, `delete from public.ingredients where id = $1`, [g.id]), /foreign key|violates/,
    'an ingredient used in a recipe cannot be deleted');
  // B cannot put its ingredient into A's recipe (composite keys)
  const bIng = await ing(w.users.ownerB, w.B.r.id, { name: 'Poulet B', base: 'g', unit: 'kg', qty: 1000, price: 1 });
  await assert.rejects(line(w.users.ownerB, w.B.r.id, A.items.tajine.id, bIng.id, 1));
});

test('sign-up for Amplify Profit only', async () => {
  const [u] = await sql(`insert into auth.users (email) values ('profit-only-${Date.now()}@test.ma') returning id`);
  const user = { id: u.id };
  const rid = await rpc(user, 'signup_restaurant', ['Chez Test', `chez-test-${Date.now().toString(36)}`, 'Rabat', '{profit,bogus}']);
  const [r] = await sql(`select products from public.restaurants where id = $1`, [rid]);
  assert.deepEqual(r.products, ['profit']);
  const rid2 = await rpc(user, 'signup_restaurant', ['Chez Test 2', `chez-test2-${Date.now().toString(36)}`, null]);
  assert.deepEqual((await sql(`select products from public.restaurants where id = $1`, [rid2]))[0].products, ['pos', 'profit'], 'default: both (trial)');
});

test('AI suggestions: fill empty recipes only, prices as estimates until confirmed', async () => {
  const m = w.users.managerA, rid = A.r.id;
  const res = await rpc(m, 'apply_recipe_suggestions', [rid, JSON.stringify([
    { item_id: A.items.jus.id, lines: [
      { name: 'Orange', name_ar: 'برتقال', category: 'fruits', base_unit: 'g', qty: 400, purchase_unit: 'kg', purchase_qty: 1000, price_cents: 500 },
      { name: 'poulet', base_unit: 'g', qty: 999, price_cents: 1 },   // exists (Poulet): reused, its real price kept
      { name: 'Sucre', base_unit: 'g', qty: 0 },                      // bad line: skipped
    ] },
    { item_id: A.items.tajine.id, lines: [{ name: 'Sel', base_unit: 'g', qty: 5 }] }, // has a recipe: untouched
  ])]);
  assert.deepEqual(res, { dishes: 1, lines: 2, ingredients: 1 });
  const d = (await rpc(m, 'profit_dishes', [rid, 30])).dishes.find(x => x.item_id === A.items.jus.id);
  assert.equal(d.estimated, 1);
  const [orange] = await as(m, `select * from public.ingredients where restaurant_id = $1 and name = 'Orange'`, [rid]);
  assert.equal(orange.price_estimated, true);
  assert.equal(orange.name_ar, 'برتقال');
  const [poulet] = await as(m, `select * from public.ingredients where restaurant_id = $1 and name = 'Poulet'`, [rid]);
  assert.equal(Number(poulet.purchase_price_cents), 6000, 'a known price is never replaced by an estimate');
  const src = await as(m, `select source from public.ingredient_prices where ingredient_id = $1`, [orange.id]);
  assert.deepEqual(src.map(x => x.source), ['ai']);
  // owner confirms a real price: no longer an estimate
  await as(m, `update public.ingredients set purchase_price_cents = 600 where id = $1`, [orange.id]);
  const [o2] = await as(m, `select price_estimated from public.ingredients where id = $1`, [orange.id]);
  assert.equal(o2.price_estimated, false);
  assert.equal((await as(m, `select count(*)::int n from public.recipe_lines where menu_item_id = $1`, [A.items.tajine.id]))[0].n, 4);
  await assert.rejects(rpc(w.users.ownerB, 'apply_recipe_suggestions', [rid, '[]']), /not allowed/);
});
