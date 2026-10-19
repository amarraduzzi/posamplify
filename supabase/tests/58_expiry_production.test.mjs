// Expiry dates, step 3: a production of a preparation with a shelf life makes a lot; cancelling it takes the lot
// away again; the production plan does not count expired stock.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

// a DATE comes back as local midnight: format it locally (toISOString shifts it a day east of UTC, e.g. in Morocco)
const ymd = (d) => d.toLocaleDateString('sv');
let w, A, rid, m, flour, crema, cake;
const lots = (g) => sql(`select * from public.stock_lots where ingredient_id = $1 and qty_remaining > 0 order by expires_on`, [g.id]);
const stock = async (g) => Number((await sql(`select stock_qty from public.ingredients where id = $1`, [g.id]))[0].stock_qty);
const inDays = async (n) => (await sql(`select (current_date + $1::int)::text d`, [n]))[0].d;

before(async () => {
  w = await world(); A = w.A; rid = A.r.id; m = w.users.managerA;
  await sql(`update public.restaurants set day_cutoff_hour = 0 where id = $1`, [rid]);
  const mk = async (name, base, price, extra = '', vals = '') => (await sql(
    `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents ${extra})
     values ($1, $2, $3, 'kg', 1000, $4 ${vals}) returning *`, [rid, name, base, price]))[0];
  flour = await mk('Farine', 'g', 800);
  crema = await mk('Crème pâtissière', 'g', 4000, ', is_preparation, made_ahead, track_expiry, shelf_life_days', ', true, true, true, 2');
  cake = await mk('Gâteau sec', 'g', 4000, ', is_preparation, made_ahead', ', true, true');   // no tracking
  for (const p of [crema, cake]) await sql(`insert into public.preparation_lines (restaurant_id, preparation_id, ingredient_id, qty) values ($1, $2, $3, 500)`, [rid, p.id, flour.id]);
  await rpc(m, 'stock_set', [flour.id, 20000, null]);
});
after(() => pool.end());

test('a production makes a lot with day produced + shelf life; no tracking: no lot', async () => {
  await rpc(m, 'production_record', [crema.id, 1000, null, null]);
  const [l] = await lots(crema);
  assert.equal(ymd(l.expires_on), await inDays(2));
  assert.equal(Number(l.qty_remaining), 1000);
  assert.equal(l.source, 'production');
  assert.equal(Number(l.unit_cost_cents), 0.4, 'cost of the recipe: 500 g flour (4 DH) per 1000 g');
  await rpc(m, 'production_record', [cake.id, 1000, null, null]);
  assert.equal((await lots(cake)).length, 0);
});

test('a sale-sized loss takes from the lots, a cancelled production takes its own lot away', async () => {
  const p1 = await rpc(m, 'production_record', [crema.id, 500, null, null]);   // second lot, same expiry
  assert.equal((await lots(crema)).length, 2);
  await sql(`update public.stock_lots set expires_on = current_date + 1 where id = (select id from public.stock_lots where ingredient_id = $1 and production_id is not null order by created_at limit 1)`, [crema.id]);
  await rpc(m, 'production_cancel', [p1.id]);
  const ls = await lots(crema);
  assert.equal(ls.length, 1, 'the lot of the cancelled production is gone');
  assert.equal(Number(ls[0].qty_remaining), 1000, 'the other lot is untouched');
  assert.equal(await stock(crema), 1000);
});

test('the plan does not count expired stock', async () => {
  let plan = await rpc(m, 'production_plan', [rid, null]);
  let it = plan.items.find(i => i.ingredient_id === crema.id);
  assert.equal(Number(it.expired_qty), 0);
  await sql(`update public.stock_lots set expires_on = current_date - 1 where ingredient_id = $1`, [crema.id]);
  plan = await rpc(m, 'production_plan', [rid, null]);
  it = plan.items.find(i => i.ingredient_id === crema.id);
  assert.equal(Number(it.expired_qty), 1000);
  assert.equal(Number(it.stock_qty), 1000, 'the stock still shows it until it is discarded');
});

test('a manager can switch the tracking on for a preparation (what the editor does)', async () => {
  const [g] = await as(m, `update public.ingredients set track_expiry = true, expiry_type = 'dlc', shelf_life_days = 3, expiry_warn_days = 1 where id = $1 returning *`, [cake.id]);
  assert.equal(g.track_expiry, true);
  await rpc(m, 'production_record', [cake.id, 400, null, null]);
  const [l] = await lots(cake);
  assert.equal(ymd(l.expires_on), await inDays(3));
});
