// Expiry dates, step 1: a delivery with its date becomes a lot; what leaves the stock leaves the
// lots soonest expiry first; a lot can be discarded with a reason; the dated lots never exceed the stock.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

// a DATE comes back as local midnight: format it locally (toISOString shifts it a day east of UTC, e.g. in Morocco)
const ymd = (d) => d.toLocaleDateString('sv');
let w, A, rid, m, lait, yaourt, beurre;
before(async () => {
  w = await world(); A = w.A; rid = A.r.id; m = w.users.managerA;
  await sql(`update public.restaurants set day_cutoff_hour = 0 where id = $1`, [rid]);
  const ing = async (name, extra = '') => (await as(m, `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents ${extra ? ', ' + extra.split('=')[0] : ''})
    values ($1, $2, 'g', 'kg', 1000, 5000 ${extra ? ', ' + extra.split('=')[1] : ''}) returning *`, [rid, name]))[0];
  lait = await ing('Crème', 'track_expiry=true');
  yaourt = await ing('Yaourt', 'track_expiry=true');
  beurre = await ing('Beurre');                      // not tracked for expiry
  for (const g of [lait, yaourt, beurre]) await rpc(m, 'stock_set', [g.id, 2000, null]);   // 2 kg with no date
});
after(() => pool.end());

const stock = async (g) => Number((await sql(`select stock_qty from public.ingredients where id = $1`, [g.id]))[0].stock_qty);
const lots = (g) => sql(`select * from public.stock_lots where ingredient_id = $1 and qty_remaining > 0 order by expires_on`, [g.id]);
const buy = (g, qty, exp, extra = {}) => as(m, `insert into public.stock_purchases (restaurant_id, ingredient_id, purchased_on, qty, total_cents, expires_on, lot_code)
  values ($1, $2, current_date, $3, $4, $5, $6) returning *`, [rid, g.id, qty, extra.total ?? null, exp, extra.code ?? null]);
const inDays = async (n) => (await sql(`select (current_date + $1::int)::text d`, [n]))[0].d;

test('a purchase with a date makes a lot; the undated stock stays outside the lots', async () => {
  const d5 = await inDays(5), d2 = await inDays(2);
  await buy(lait, 4000, d5, { total: 2000, code: 'L-77' });
  await buy(lait, 3000, d2);
  const ls = await lots(lait);
  assert.deepEqual(ls.map(l => [ymd(l.expires_on), Number(l.qty_remaining), l.estimated]), [[d2, 3000, false], [d5, 4000, false]]);
  assert.equal(ls[1].lot_code, 'L-77');
  assert.equal(Number(ls[1].unit_cost_cents), 0.5, 'paid 20 DH for 4 kg');
  assert.equal(await stock(lait), 9000, '2 kg undated + 7 kg dated');
});

test('no date given: the shelf life of the ingredient is used and marked estimated; none at all: no lot', async () => {
  await as(m, `update public.ingredients set shelf_life_days = 3 where id = $1`, [yaourt.id]);
  await as(m, `insert into public.stock_purchases (restaurant_id, ingredient_id, purchased_on, qty) values ($1, $2, current_date, 1000)`, [rid, yaourt.id]);
  const [l] = await lots(yaourt);
  assert.equal(ymd(l.expires_on), await inDays(3));
  assert.equal(l.estimated, true);
  await as(m, `update public.ingredients set shelf_life_days = null where id = $1`, [yaourt.id]);
  await as(m, `insert into public.stock_purchases (restaurant_id, ingredient_id, purchased_on, qty) values ($1, $2, current_date, 500)`, [rid, yaourt.id]);
  assert.equal((await lots(yaourt)).length, 1, 'no date and no shelf life: the stock goes up, no lot');
  assert.equal(await stock(yaourt), 3500);
  // not tracked: a date on the purchase changes nothing
  await buy(beurre, 1000, await inDays(10));
  assert.equal((await sql(`select count(*)::int n from public.stock_lots where ingredient_id = $1`, [beurre.id]))[0].n, 0);
});

test('what leaves the stock leaves the undated stock first, then the lots soonest expiry first; lots never exceed the stock', async () => {
  await rpc(m, 'stock_waste', [lait.id, 3500, 'test']);                   // 2 kg undated go first, then 1.5 kg of the soonest lot
  let ls = await lots(lait);
  assert.deepEqual(ls.map(l => Number(l.qty_remaining)), [1500, 4000]);
  assert.equal(await stock(lait), 5500);
  // a count far below: the soonest lots go, the stock and the lots agree again
  await rpc(m, 'stock_set', [lait.id, 1000, null]);
  ls = await lots(lait);
  assert.deepEqual(ls.map(l => Number(l.qty_remaining)), [1000]);
  assert.equal(await stock(lait), 1000);
});

test('discard a lot with a reason: a normal waste move linked to the lot, valued, bad input refused', async () => {
  await buy(lait, 2000, await inDays(1), { total: 1000 });                 // 0.5 DH... 10 DH for 2 kg
  const [soon] = await lots(lait);
  await assert.rejects(rpc(m, 'stock_lot_discard', [soon.id, 99999, 'expired', null]), /invalid_request/);
  await assert.rejects(rpc(m, 'stock_lot_discard', [soon.id, 100, 'because', null]), /invalid_request/);
  const before = await stock(lait);
  const res = await rpc(m, 'stock_lot_discard', [soon.id, 500, 'expired', null]);
  assert.equal(res.stock_qty, before - 500);
  assert.equal(Number(res.cost_cents), 250, '500 g at 0.5 cent per g');
  const [mv] = await sql(`select * from public.stock_moves where lot_id = $1`, [soon.id]);
  assert.deepEqual([mv.kind, Number(mv.qty), mv.waste_reason, mv.note], ['waste', -500, 'expired', 'Périmé']);
  assert.equal(Number((await sql(`select qty_remaining from public.stock_lots where id = $1`, [soon.id]))[0].qty_remaining), 1500);
  // the lots still follow the stock exactly after a discard (no double counting)
  const total = Number((await sql(`select coalesce(sum(qty_remaining), 0) t from public.stock_lots where ingredient_id = $1`, [lait.id]))[0].t);
  assert.ok(total <= await stock(lait));
});

test('date the undated stock; correct a date', async () => {
  const [{ dated }] = await sql(`select coalesce(sum(qty_remaining), 0) dated from public.stock_lots where ingredient_id = $1`, [yaourt.id]);
  const rest = (await stock(yaourt)) - Number(dated);
  assert.ok(rest > 0);
  await assert.rejects(rpc(m, 'stock_lot_from_rest', [yaourt.id, rest + 1, await inDays(4), null]), /invalid_request/);
  const res = await rpc(m, 'stock_lot_from_rest', [yaourt.id, rest, await inDays(4), 'OUV-1']);
  assert.ok(res.id);
  assert.equal((await lots(yaourt)).length, 2);
  const d9 = await inDays(9);
  await rpc(m, 'stock_lot_set_expiry', [res.id, d9, null]);
  const [l] = await sql(`select expires_on, estimated, lot_code from public.stock_lots where id = $1`, [res.id]);
  assert.deepEqual([ymd(l.expires_on), l.estimated, l.lot_code], [d9, false, 'OUV-1']);
  await assert.rejects(rpc(m, 'stock_lot_from_rest', [beurre.id, 10, await inDays(4), null]), /expiry_not_tracked/);
});

test('editing or deleting a purchase moves its lot with it', async () => {
  const [p] = await buy(yaourt, 1000, await inDays(6));
  const [lot] = await sql(`select * from public.stock_lots where purchase_id = $1`, [p.id]);
  await rpc(m, 'stock_waste', [yaourt.id, 1, 'x']);                          // uses the soonest lot (not this one)
  await as(m, `update public.stock_purchases set qty = 1400 where id = $1`, [p.id]);
  const [after] = await sql(`select qty_initial, qty_remaining from public.stock_lots where purchase_id = $1`, [p.id]);
  assert.equal(Number(after.qty_initial), 1400);
  assert.equal(Number(after.qty_remaining), 1400);
  const s = await stock(yaourt);
  await as(m, `delete from public.stock_purchases where id = $1`, [p.id]);
  assert.equal((await sql(`select count(*)::int n from public.stock_lots where purchase_id = $1`, [p.id]))[0].n, 0);
  assert.equal(await stock(yaourt), s - 1400);
  assert.ok(lot.id);
});

test('a delivery received through a purchase order carries the date of each line', async () => {
  const [po] = await as(m, `insert into public.purchase_orders (restaurant_id) values ($1) returning *`, [rid]);
  const [line] = await as(m, `insert into public.purchase_order_lines (restaurant_id, order_id, ingredient_id, units, unit_price_cents) values ($1, $2, $3, 3, 5000) returning *`, [rid, po.id, lait.id]);
  const d8 = await inDays(8);
  await rpc(m, 'po_receive', [po.id, JSON.stringify([{ line_id: line.id, units: 3, total_cents: 15000, expires_on: d8, lot_code: 'BC-1' }]), null, true]);
  const got = (await lots(lait)).find(l => l.lot_code === 'BC-1');
  assert.ok(got && ymd(got.expires_on) === d8 && Number(got.qty_remaining) === 3000);
});

test('lots are private to the restaurant and its managers; switching the tracking off forgets them', async () => {
  const other = await as(w.users.ownerB, `select * from public.stock_lots`, []);
  assert.equal(other.length, 0);
  await assert.rejects(rpc(w.users.ownerB, 'stock_lot_discard', [(await lots(lait))[0].id, 1, 'expired', null]), /./);
  await assert.rejects(as(m, `insert into public.stock_lots (restaurant_id, ingredient_id, qty_initial, qty_remaining, expires_on, received_on) values ($1, $2, 1, 1, current_date, current_date)`, [rid, lait.id]), /./);
  await as(m, `update public.ingredients set track_expiry = false where id = $1`, [lait.id]);
  assert.equal((await sql(`select count(*)::int n from public.stock_lots where ingredient_id = $1`, [lait.id]))[0].n, 0);
});
