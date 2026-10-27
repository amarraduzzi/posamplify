// Allergens: stored per ingredient, calculated for every product through recipes and preparations.
// A product with a gap is never reported as "no allergens"; the guest menu only shows them when switched on.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, rid, m, ownerA, managerB;
const ing = async (name, allergens, extra = {}) => (await as(m,
  `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents, allergens, may_contain, is_preparation, made_ahead)
   values ($1, $2, 'g', 'kg', 1000, 1000, $3, $4, $5, true) returning *`,
  [rid, name, allergens, extra.traces ?? [], !!extra.prep]))[0];
const pline = (p, g, qty = 100) => as(m, `insert into public.preparation_lines (restaurant_id, preparation_id, ingredient_id, qty) values ($1, $2, $3, $4)`, [rid, p.id, g.id, qty]);
const rline = (item, g, qty = 100) => as(m, `insert into public.recipe_lines (restaurant_id, menu_item_id, ingredient_id, qty) values ($1, $2, $3, $4)`, [rid, item.id, g.id, qty]);
const overview = async () => rpc(m, 'allergen_overview', [rid]);
const of = async item => (await overview()).items.find(x => x.item_id === item.id);

let flour, egg, almond, sugar, unknown, sesame, cream, filling, cake, plain;
before(async () => {
  w = await world(); rid = w.A.r.id; m = w.users.managerA; ownerA = w.users.ownerA; managerB = w.users.ownerB;
  flour = await ing('Farine', ['gluten']);
  egg = await ing('Oeufs', ['eggs']);
  almond = await ing('Amandes', ['almonds'], { traces: ['nuts', 'peanuts'] });
  sugar = await ing('Sucre', []);                       // checked: none
  unknown = await ing('Arôme', null);                   // not filled in yet
  sesame = await ing('Sésame', ['sesame']);
  cream = await ing('Crème pâtissière', null, { prep: true });
  filling = await ing('Garniture', null, { prep: true });
  await pline(cream, egg); await pline(cream, sugar);
  await pline(filling, cream); await pline(filling, sesame); // a preparation inside a preparation
  cake = w.A.items.tajine; plain = w.A.items.pizza;
});
after(() => pool.end());

test('only known allergen codes are accepted', async () => {
  await assert.rejects(as(m, `update public.ingredients set allergens = '{poisson}' where id = $1`, [flour.id]), /check/);
  await assert.rejects(as(m, `update public.menu_items set allergens_add = '{xyz}' where id = $1`, [cake.id]), /check/);
});

test('the allergens of a product come from every level of its recipe', async () => {
  await rline(cake, flour); await rline(cake, filling); await rline(cake, almond);
  const a = await of(cake);
  assert.deepEqual(a.allergens, ['almonds', 'eggs', 'gluten', 'sesame']);
  assert.deepEqual(a.may_contain, ['nuts', 'peanuts']);
  assert.equal(a.state, 'complete');
  assert.equal(a.has_recipe, true);
});

test('changing an ingredient changes every product that uses it (nothing is copied)', async () => {
  await as(m, `update public.ingredients set allergens = '{eggs,milk}' where id = $1`, [egg.id]);
  assert.ok((await of(cake)).allergens.includes('milk'));
  await as(m, `update public.ingredients set allergens = '{eggs}' where id = $1`, [egg.id]);
  assert.ok(!(await of(cake)).allergens.includes('milk'));
});

test('a gap makes the product incomplete, never "no allergens"', async () => {
  await rline(plain, flour); await rline(plain, unknown);
  let a = await of(plain);
  assert.equal(a.state, 'incomplete');
  assert.ok((await overview()).missing.includes(unknown.id));
  await as(m, `update public.ingredients set allergens = '{}' where id = $1`, [unknown.id]);
  a = await of(plain);
  assert.equal(a.state, 'complete');
  assert.deepEqual(a.allergens, ['gluten']);
  assert.ok(!(await overview()).missing.includes(unknown.id));
});

test('a product without recipe is incomplete until the owner confirms it by hand', async () => {
  const jus = w.A.items.jus;
  assert.equal((await of(jus)).state, 'incomplete');
  assert.equal((await of(jus)).has_recipe, false);
  await as(m, `update public.menu_items set allergens_confirmed = true, allergens_add = '{sulphites}' where id = $1`, [jus.id]);
  const a = await of(jus);
  assert.equal(a.state, 'complete');
  assert.deepEqual(a.allergens, ['sulphites']);
});

test('manual add and remove correct the calculated result', async () => {
  await as(m, `update public.menu_items set allergens_add = '{soy}', allergens_remove = '{sesame}' where id = $1`, [cake.id]);
  const a = await of(cake);
  assert.ok(a.allergens.includes('soy'));
  assert.ok(!a.allergens.includes('sesame'));
  assert.ok(a.calculated.includes('sesame'), 'the calculated list stays visible for the owner');
});

test('preparations show their own result', async () => {
  const p = (await overview()).preparations.find(x => x.ingredient_id === filling.id);
  assert.deepEqual(p.allergens, ['eggs', 'sesame']);
  assert.equal(p.complete, true);
});

test('guests see nothing until the owner switches it on, then only complete products show details', async () => {
  const slug = w.A.r.slug;
  assert.equal(await rpc(null, 'get_menu_allergens', [slug]), null);
  await as(ownerA, `update public.restaurants set show_allergens = true where id = $1`, [rid]);
  const g = await rpc(null, 'get_menu_allergens', [slug]);
  assert.equal(g.items[cake.id].ok, true);
  assert.ok(g.items[cake.id].a.includes('gluten'));
  const pizzaOff = w.A.items.soldout; // no recipe, not confirmed
  assert.equal(g.items[pizzaOff.id].ok, false);
  assert.ok(!(w.A.items.inactive.id in g.items), 'inactive products are not exposed');
  assert.equal(await rpc(null, 'get_menu_allergens', ['does-not-exist']), null);
});

test('a manager cannot read another restaurant, and a guest cannot call the overview', async () => {
  await assert.rejects(rpc(managerB, 'allergen_overview', [rid]), /not allowed|forbidden|permission|denied/i);
  await assert.rejects(rpc(null, 'allergen_overview', [rid]), /permission|denied/i);
});

test('a device (till) cannot switch the guest display on', async () => {
  // row level security hides the row from a device: the update changes nothing (or is refused)
  await as(w.users.deviceA, `update public.restaurants set show_allergens = false where id = $1`, [rid]).catch(() => {});
  assert.equal((await sql(`select show_allergens from public.restaurants where id = $1`, [rid]))[0].show_allergens, true);
});
