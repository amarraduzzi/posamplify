// Amplify Profit: inventory. Counts, purchases (which update the price) and the
// variance between what was used and what the sales say, exact.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, A, poulet, huile, cA, cB;
before(async () => { w = await world(); A = w.A; });
after(() => pool.end());

const count = async (m, rid, day, lines) => {
  const [c] = await as(m, `insert into public.stock_counts (restaurant_id, counted_on) values ($1, current_date + $2::int) returning *`, [rid, day]);
  for (const [g, qty] of lines) {
    await as(m, `insert into public.stock_count_lines (restaurant_id, count_id, ingredient_id, qty) values ($1, $2, $3, $4)`, [rid, c.id, g, qty]);
  }
  await as(m, `update public.stock_counts set status = 'closed', closed_at = now() where id = $1`, [c.id]);
  return c;
};

test('without the till: used = opening + purchases - closing, purchases set the price', async () => {
  const m = w.users.managerA, rid = A.r.id;
  await sql(`update public.restaurants set products = '{profit}' where id = $1`, [rid]);
  [poulet] = await as(m, `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents, waste_bp)
    values ($1, 'Poulet', 'g', 'kg', 1000, 6000, 2500) returning *`, [rid]);
  [huile] = await as(m, `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents)
    values ($1, 'Huile', 'ml', 'litre', 1000, 2000) returning *`, [rid]);

  cA = await count(m, rid, -1, [[poulet.id, 5000], [huile.id, 2000]]);
  // today: 3 kg of chicken for 195 DH (65 DH/kg) -> new price
  await as(m, `insert into public.stock_purchases (restaurant_id, ingredient_id, purchased_on, qty, total_cents) values ($1, $2, current_date, 3000, 19500)`, [rid, poulet.id]);
  let [g] = await sql(`select purchase_price_cents, price_estimated from public.ingredients where id = $1`, [poulet.id]);
  assert.equal(Number(g.purchase_price_cents), 6500);
  const [h] = await sql(`select source from public.ingredient_prices where ingredient_id = $1 order by recorded_at desc limit 1`, [poulet.id]);
  assert.equal(h.source, 'invoice');
  // an old purchase typed later does not overwrite the newer price
  await as(m, `insert into public.stock_purchases (restaurant_id, ingredient_id, purchased_on, qty, total_cents) values ($1, $2, current_date - 10, 1000, 9900)`, [rid, poulet.id]);
  [g] = await sql(`select purchase_price_cents from public.ingredients where id = $1`, [poulet.id]);
  assert.equal(Number(g.purchase_price_cents), 6500);

  cB = await count(m, rid, 0, [[poulet.id, 2000], [huile.id, 1500]]);
  const r = await rpc(m, 'stock_report', [rid, cB.id, cA.id]); // any order
  assert.equal(r.days, 1);
  assert.equal(r.uses_pos, false);
  const p = r.items.find(i => i.ingredient_id === poulet.id);
  assert.equal(Number(p.used), 6000, '5000 + 3000 - 2000');
  assert.equal(Number(p.used_cents), 39000, '6 kg at 65 DH');
  assert.equal(p.theoretical, null);
  const o = r.items.find(i => i.ingredient_id === huile.id);
  assert.equal(Number(o.used_cents), 1000);
  assert.equal(Number(r.totals.used_cents), 40000);
  assert.equal(Number(r.totals.purchases_cents), 19500, 'only purchases inside the period');
  assert.equal(r.totals.gap_cents, null);
});

test('a closed count cannot change; open counts cannot be compared', async () => {
  const m = w.users.managerA, rid = A.r.id;
  await assert.rejects(as(m, `update public.stock_count_lines set qty = 1 where count_id = $1`, [cA.id]), /count closed/);
  await assert.rejects(as(m, `delete from public.stock_count_lines where count_id = $1`, [cA.id]), /count closed/);
  const [open] = await as(m, `insert into public.stock_counts (restaurant_id, counted_on) values ($1, current_date + 1) returning id`, [rid]);
  await assert.rejects(rpc(m, 'stock_report', [rid, cA.id, open.id]), /not closed/);
  await as(m, `delete from public.stock_counts where id = $1`, [open.id]);
  // deleting an ingredient still works (its count lines go with it)
  const [x] = await as(m, `insert into public.ingredients (restaurant_id, name, base_unit, purchase_qty) values ($1, 'Jetable', 'g', 1000) returning id`, [rid]);
  const [c] = await as(m, `insert into public.stock_counts (restaurant_id, counted_on) values ($1, current_date - 3) returning id`, [rid]);
  await as(m, `insert into public.stock_count_lines (restaurant_id, count_id, ingredient_id, qty) values ($1, $2, $3, 1)`, [rid, c.id, x.id]);
  await as(m, `update public.stock_counts set status = 'closed' where id = $1`, [c.id]);
  await as(m, `delete from public.ingredients where id = $1`, [x.id]);
  await as(m, `delete from public.stock_counts where id = $1`, [c.id]);
});

test('with the till: sold (recipe x sales, waste added back) and the gap in dirhams', async () => {
  const m = w.users.managerA, rid = A.r.id;
  await sql(`update public.restaurants set products = '{pos,profit}' where id = $1`, [rid]);
  // tajine: 300 g of chicken on the plate, 25 % bones -> 400 g bought per tajine
  await as(m, `insert into public.recipe_lines (restaurant_id, menu_item_id, ingredient_id, qty) values ($1, $2, $3, 300)`,
    [rid, A.items.tajine.id, poulet.id]);
  const o = await tillOrder(w.users.deviceA, rid, [{ item_id: A.items.tajine.id, name: 'Tajine', price: 8500, qty: 2 }]);
  await rpc(w.users.deviceA, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: Number(o.total_cents) }]), A.staff.sara.id, null]);

  const r = await rpc(m, 'stock_report', [rid, cA.id, cB.id]);
  const p = r.items.find(i => i.ingredient_id === poulet.id);
  assert.equal(Number(p.theoretical), 800);
  assert.equal(Number(p.gap), 5200, '6000 used, 800 sold');
  assert.equal(Number(p.gap_cents), 33800, '5.2 kg at 65 DH');
  const hu = r.items.find(i => i.ingredient_id === huile.id);
  assert.equal(Number(hu.theoretical), 0, 'nothing sold uses oil');
  assert.equal(Number(r.totals.gap_cents), 33800 + 1000);
  const [{ ht }] = await sql(`select sum(total_ht_cents)::bigint ht from public.fiscal_documents where restaurant_id = $1 and business_date = current_date`, [rid]);
  assert.equal(Number(r.revenue_ht_cents), Number(ht));
  assert.equal(r.real_food_cost_bp, Math.round(40000 * 10000 / Number(ht)));
});

test('inventory is for managers and owners of that restaurant only', async () => {
  await assert.rejects(rpc(w.users.deviceA, 'stock_report', [A.r.id, cA.id, cB.id]), /not allowed/);
  await assert.rejects(rpc(w.users.ownerB, 'stock_report', [A.r.id, cA.id, cB.id]), /not allowed/);
  const seen = await as(w.users.deviceA, `select id from public.stock_counts where restaurant_id = $1`, [A.r.id]);
  assert.equal(seen.length, 0);
  await assert.rejects(as(w.users.deviceA, `insert into public.stock_purchases (restaurant_id, ingredient_id, purchased_on, qty) values ($1, $2, current_date, 1)`,
    [A.r.id, poulet.id]), /row-level security/);
  // B cannot use A's count with its own report
  await assert.rejects(rpc(w.users.ownerB, 'stock_report', [w.B.r.id, cA.id, cB.id]), /unknown count/);
});
