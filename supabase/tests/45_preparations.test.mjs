// Preparations and production (pâtisserie): costs roll up through preparations, a loop is refused,
// production takes the ingredients out and puts the preparation in, a sale takes the preparation out,
// a preparation made on the spot is replaced by its ingredients, a production can be undone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, A, rid, m, butter, flour, pate, croissant, item;
const ing = async (name, base, qty, price, extra = '') => (await as(m,
  `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents${extra ? ', is_preparation, made_ahead' : ''})
   values ($1, $2, $3, 'kg', $4, $5${extra ? ', ' + extra : ''}) returning *`, [rid, name, base, qty, price]))[0];
const get = async g => (await sql(`select * from public.ingredients where id = $1`, [g.id]))[0];
const line = (p, g, qty) => as(m, `insert into public.preparation_lines (restaurant_id, preparation_id, ingredient_id, qty) values ($1, $2, $3, $4) returning *`, [rid, p.id, g.id, qty]);

before(async () => {
  w = await world(); A = w.A; rid = A.r.id; m = w.users.managerA;
  await sql(`update public.restaurants set day_cutoff_hour = 0 where id = $1`, [rid]);
  butter = await ing('Beurre', 'g', 1000, 8000);          // 80 DH / kg
  flour = await ing('Farine', 'g', 1000, 800);            // 8 DH / kg
  pate = await ing('Pâte feuilletée', 'g', 2000, 999999, 'true, false');   // a batch of 2 kg, made on the spot
  croissant = await ing('Croissant maison', 'pc', 60, null, 'true, true'); // a batch of 60, made ahead
  [item] = await as(m, `insert into public.menu_items (restaurant_id, category_id, name, price_cents) values ($1, $2, '{"fr":"Croissant"}', 800) returning *`, [rid, A.cats.boissons.id]);
  await as(m, `insert into public.recipe_lines (restaurant_id, menu_item_id, ingredient_id, qty) values ($1, $2, $3, 1)`, [rid, item.id, croissant.id]);
});
after(() => pool.end());

test('the cost of a preparation is calculated and follows the prices', async () => {
  assert.equal((await get(pate)).purchase_price_cents, null, 'a typed price is ignored');
  await line(pate, butter, 1000); await line(pate, flour, 1000);
  assert.equal(Number((await get(pate)).purchase_price_cents), 8800, '1 kg butter + 1 kg flour');
  assert.equal((await get(pate)).category, 'preparation');
  await line(croissant, pate, 3000);
  assert.equal(Number((await get(croissant)).purchase_price_cents), 13200, '3 kg of pâte for 60 croissants');
  await as(m, `update public.ingredients set purchase_price_cents = 10000 where id = $1`, [butter.id]);
  assert.equal(Number((await get(pate)).purchase_price_cents), 10800, 'butter up: the pâte follows');
  assert.equal(Number((await get(croissant)).purchase_price_cents), 16200, 'and the croissant too');
  // the owner cannot type the price of a preparation
  await as(m, `update public.ingredients set purchase_price_cents = 1 where id = $1`, [croissant.id]);
  assert.equal(Number((await get(croissant)).purchase_price_cents), 16200);
  // a preparation inside itself is refused
  await assert.rejects(line(pate, croissant, 10), /preparation loop/);
  await assert.rejects(line(butter, flour, 10), /not a preparation/);
});

test('production: ingredients out, preparation in; sales take the preparation; undo puts everything back', async () => {
  await rpc(m, 'stock_set', [butter.id, 10000, 'start']);
  await rpc(m, 'stock_set', [flour.id, 10000, 'start']);
  await assert.rejects(rpc(m, 'production_record', [pate.id, 2000, null, null]), /made_on_the_spot/);
  await assert.rejects(rpc(w.users.deviceA, 'production_record', [croissant.id, 60, null, null]), /not allowed/);
  const p = await rpc(m, 'production_record', [croissant.id, 60, 'fournée du matin', null]);
  assert.equal(Number(p.stock_qty), 60, 'the croissants start their stock');
  // 3 kg of pâte made on the spot = 1.5 kg butter + 1.5 kg flour
  assert.equal(Number((await get(butter)).stock_qty), 8500);
  assert.equal(Number((await get(flour)).stock_qty), 8500);
  assert.equal(Number(p.cost_cents), 16200);

  // a sale: 2 croissants out of the croissant stock, the butter stays
  const o = await tillOrder(w.users.deviceA, rid, [{ item_id: item.id, qty: 2 }]);
  const [ord] = await sql(`select total_cents from public.orders where id = $1`, [o.id]);
  await rpc(w.users.deviceA, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: Number(ord.total_cents) }]), null, null]);
  assert.equal(Number((await get(croissant)).stock_qty), 58);
  assert.equal(Number((await get(butter)).stock_qty), 8500);

  const plan = await rpc(m, 'production_plan', [rid, null]);
  const row = plan.items.find(x => x.ingredient_id === croissant.id);
  assert.equal(Number(row.made_today), 60);
  assert.ok(!plan.items.some(x => x.ingredient_id === pate.id), 'made on the spot: not in the plan');

  await rpc(m, 'production_cancel', [p.id]);
  assert.equal(Number((await get(croissant)).stock_qty), -2);
  assert.equal(Number((await get(butter)).stock_qty), 10000);
  await assert.rejects(rpc(m, 'production_cancel', [p.id]), /already_cancelled/);
});

test('a dish using a preparation made on the spot takes its ingredients', async () => {
  const [tarte] = await as(m, `insert into public.menu_items (restaurant_id, category_id, name, price_cents) values ($1, $2, '{"fr":"Chausson"}', 1200) returning *`, [rid, A.cats.boissons.id]);
  await as(m, `insert into public.recipe_lines (restaurant_id, menu_item_id, ingredient_id, qty) values ($1, $2, $3, 100)`, [rid, tarte.id, pate.id]);
  const before = Number((await get(butter)).stock_qty);
  const o = await tillOrder(w.users.deviceA, rid, [{ item_id: tarte.id }]);
  const [ord] = await sql(`select total_cents from public.orders where id = $1`, [o.id]);
  await rpc(w.users.deviceA, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: Number(ord.total_cents) }]), null, null]);
  assert.equal(Number((await get(butter)).stock_qty), before - 50, '100 g of pâte = 50 g of butter');
  assert.equal((await get(pate)).stock_qty, null, 'no stock of its own');
});
