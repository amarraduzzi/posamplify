// Live stock: sales take ingredients out at once (recipes, sizes and options), credit notes
// put them back, purchases and losses move it, a count resets it, dishes go sold out and come back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder, guestOrder } from './helpers.mjs';

let w, A, rid, poulet, citron, fromage, optFromage;
before(async () => {
  w = await world(); A = w.A; rid = A.r.id;
  await sql(`update public.restaurants set day_cutoff_hour = 0 where id = $1`, [rid]);
  const m = w.users.managerA;
  [poulet] = await as(m, `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents, waste_bp)
    values ($1, 'Poulet', 'g', 'kg', 1000, 6000, 2000) returning *`, [rid]);
  [citron] = await as(m, `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents)
    values ($1, 'Citron confit', 'pc', 'pièce', 1, 200) returning *`, [rid]);
  [fromage] = await as(m, `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty)
    values ($1, 'Fromage', 'g', 'kg', 1000) returning *`, [rid]);
  // tajine: 200 g of chicken on the plate (250 g bought, 20 % lost) and 1 lemon
  await as(m, `insert into public.recipe_lines (restaurant_id, menu_item_id, ingredient_id, qty) values ($1, $2, $3, 200), ($1, $2, $4, 1)`,
    [rid, A.items.tajine.id, poulet.id, citron.id]);
  const [g] = await as(m, `insert into public.modifier_groups (restaurant_id, name, min_select, max_select) values ($1, '{"fr":"Extras"}', 0, 2) returning *`, [rid]);
  [optFromage] = await as(m, `insert into public.modifier_options (restaurant_id, group_id, name, price_cents) values ($1, $2, '{"fr":"Fromage"}', 500) returning *`, [rid, g.id]);
  await as(m, `insert into public.item_modifier_groups (restaurant_id, menu_item_id, group_id) values ($1, $2, $3)`, [rid, A.items.tajine.id, g.id]);
  await as(m, `insert into public.recipe_lines (restaurant_id, modifier_option_id, ingredient_id, qty) values ($1, $2, $3, 30)`, [rid, optFromage.id, fromage.id]);
});
after(() => pool.end());

const stock = async (g) => (await sql(`select stock_qty from public.ingredients where id = $1`, [g.id]))[0].stock_qty;
const num = async (g) => { const q = await stock(g); return q === null ? null : Number(q); };
const pay = (o) => rpc(w.users.deviceA, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: Number(o.total_cents) }]), null, null]);
const sell = async (qty, mods = []) => {
  const o = await tillOrder(w.users.deviceA, rid, []);
  await as(w.users.deviceA, `insert into public.order_lines (restaurant_id, order_id, menu_item_id, name, unit_price_cents, quantity, vat_bp, modifiers)
    values ($1, $2, $3, '-', 1, $4, 0, $5)`, [rid, o.id, A.items.tajine.id, qty, JSON.stringify(mods.map(id => ({ id })))]);
  return pay((await sql(`select * from public.orders where id = $1`, [o.id]))[0]);
};
const avail = async () => (await sql(`select available, sold_out_by_stock from public.menu_items where id = $1`, [A.items.tajine.id]))[0];

test('not tracked until counted or set; then every sale takes it out at once', async () => {
  const m = w.users.managerA;
  await sell(1);
  assert.equal(await num(poulet), null, 'never counted: not tracked, nothing happens');
  // nobody can write the stock by hand
  await assert.rejects(as(m, `update public.ingredients set stock_qty = 5 where id = $1`, [poulet.id]), /only change through/);
  // start: 1 kg of chicken, 4 lemons, 100 g of cheese
  await rpc(m, 'stock_set', [poulet.id, 1000, null]);
  await rpc(m, 'stock_set', [citron.id, 4, null]);
  await rpc(m, 'stock_set', [fromage.id, 100, null]);
  assert.equal(await num(poulet), 1000);
  // 2 tajines, one... both with cheese: 2 x 250 g, 2 lemons, 2 x 30 g cheese
  const doc = await sell(2, [optFromage.id]);
  assert.equal(await num(poulet), 500);
  assert.equal(await num(citron), 2);
  assert.equal(await num(fromage), 40);
  const moves = await sql(`select kind, qty, doc_number from public.stock_moves where ingredient_id = $1 order by id`, [poulet.id]);
  assert.deepEqual(moves.map(x => [x.kind, Number(x.qty)]), [['adjust', 1000], ['sale', -500]]);
  assert.equal(moves[1].doc_number, doc.doc_number);
  // a credit note puts it back
  await rpc(w.users.deviceA, 'issue_credit_note', [doc.id, 'erreur', A.staff.karim.id, '9999']);
  assert.equal(await num(poulet), 1000);
  assert.equal(await num(fromage), 100);
  await sell(2);
  assert.equal(await num(poulet), 500);
});

test('sold out by stock, and back when a purchase arrives', async () => {
  const m = w.users.managerA;
  await as(w.users.ownerA, `update public.restaurants set profit_settings = profit_settings || '{"auto_sold_out": true}' where id = $1`, [rid]);
  await rpc(m, 'stock_set', [poulet.id, 5000, 'livraison']);   // plenty of chicken: the lemons decide
  // 2 lemons left: one more tajine leaves 1, the next leaves 0 -> sold out
  await sell(1);
  assert.equal((await avail()).available, true);
  const lv = await rpc(w.users.deviceA, 'pos_stock_levels', [rid]);
  assert.equal(lv.low[A.items.tajine.id], 1, 'one portion left (one lemon)');
  await sell(1);
  assert.deepEqual(await avail(), { available: false, sold_out_by_stock: true });
  assert.ok((await rpc(w.users.deviceA, 'pos_stock_levels', [rid])).sold_out.includes(A.items.tajine.id));
  // guests cannot order it any more
  await assert.rejects(rpc(null, 'place_order', [A.r.slug, JSON.stringify(guestOrder(null, [{ item_id: A.items.tajine.id, quantity: 1 }], { order_type: 'takeaway', customer: { name: 'X', phone: '0612345678' } }))]), /sold_out/);
  // 10 lemons bought today: back on the menu by itself
  await as(m, `insert into public.stock_purchases (restaurant_id, ingredient_id, purchased_on, qty, total_cents) values ($1, $2, current_date, 10, 2000)`, [rid, citron.id]);
  assert.equal(await num(citron), 10);
  assert.deepEqual(await avail(), { available: true, sold_out_by_stock: false });
  // deleting the purchase takes it back out (and hides the dish again)
  const [p] = await sql(`select id from public.stock_purchases where ingredient_id = $1`, [citron.id]);
  await as(m, `delete from public.stock_purchases where id = $1`, [p.id]);
  assert.equal(await num(citron), 0);
  assert.equal((await avail()).available, false);
  // the manager switches it on by hand anyway: it stays on (no new crossing)
  await as(m, `update public.menu_items set available = true where id = $1`, [A.items.tajine.id]);
  assert.deepEqual(await avail(), { available: true, sold_out_by_stock: false });
  await rpc(m, 'stock_set', [citron.id, 20, 'livraison du matin']);
});

test('losses at the till and in the back office, a count resets, the live picture', async () => {
  const m = w.users.managerA, d = w.users.deviceA;
  const before = await num(poulet);
  const res = await rpc(d, 'pos_stock_waste', [rid, A.items.tajine.id, null, 2, 'tombé par terre', A.staff.karim.id]);
  assert.equal(res.ingredients, 3 - 1, 'chicken and lemon (cheese is an option)');
  assert.equal(await num(poulet), before - 500);
  assert.equal(Number(res.cost_cents), 3000 + 400, '500 g at 60 DH/kg + 2 lemons');
  const [wm] = await sql(`select note, staff_id from public.stock_moves where ingredient_id = $1 and kind = 'waste'`, [poulet.id]);
  assert.match(wm.note, /2 x Tajine : tombé par terre/);
  assert.equal(wm.staff_id, A.staff.karim.id);
  await assert.rejects(rpc(d, 'pos_stock_waste', [rid, A.items.jus.id, null, 1, 'x', null]), /no_recipe/);
  await assert.rejects(rpc(m, 'stock_waste', [poulet.id, 100, '']), /reason_required/);
  await rpc(m, 'stock_waste', [poulet.id, 100, 'périmé']);
  // a count of today (end of day): the counted quantity becomes the stock
  const [c] = await as(m, `insert into public.stock_counts (restaurant_id, counted_on) values ($1, current_date) returning *`, [rid]);
  await as(m, `insert into public.stock_count_lines (restaurant_id, count_id, ingredient_id, qty) values ($1, $2, $3, 3000)`, [rid, c.id, poulet.id]);
  await as(m, `update public.stock_counts set status = 'closed', closed_at = now() where id = $1`, [c.id]);
  assert.equal(await num(poulet), 3000);
  // an older count than the current starting point changes nothing
  const [old] = await as(m, `insert into public.stock_counts (restaurant_id, counted_on) values ($1, current_date - 5) returning *`, [rid]);
  await as(m, `insert into public.stock_count_lines (restaurant_id, count_id, ingredient_id, qty) values ($1, $2, $3, 1)`, [rid, old.id, poulet.id]);
  await as(m, `update public.stock_counts set status = 'closed', closed_at = now() where id = $1`, [old.id]);
  assert.equal(await num(poulet), 3000);
  // the live picture for the manager, with a minimum
  await as(m, `update public.ingredients set stock_min = 5000 where id = $1`, [poulet.id]);
  const live = await rpc(m, 'stock_live', [rid]);
  const p = live.items.find(i => i.ingredient_id === poulet.id);
  assert.equal(p.status, 'low');
  assert.equal(Number(p.value_cents), 18000);
  assert.equal(p.dishes[0].portions, 12);
  assert.ok(Number(p.sold_today) > 0);
  assert.ok(Number(live.waste_today_cents) >= 3600);
  // the forecast now starts from the live stock
  const f = await rpc(m, 'stock_forecast', [rid]);
  const fp = f.items.find(i => i.ingredient_id === poulet.id);
  assert.equal(fp.live, true);
  assert.equal(Number(fp.estimate), 3000);
  // private: the till and restaurant B see no moves, B cannot waste A's stock
  assert.equal((await as(d, `select * from public.stock_moves`)).length, 0);
  await assert.rejects(rpc(w.users.deviceB, 'pos_stock_waste', [rid, A.items.tajine.id, null, 1, 'x', null]), /not allowed/);
  await assert.rejects(rpc(d, 'stock_live', [rid]), /not allowed/);
});
