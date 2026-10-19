// Expiry dates, step 4: throw away what expired (button and automatic at day close), catering check on the
// day of the event, and traceability of the lots that went into a production.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, A, rid, m, farine, sucre, pate, lait, creme, oeufs;
const lots = (g) => sql(`select * from public.stock_lots where ingredient_id = $1 and qty_remaining > 0 order by expires_on`, [g.id]);
const stock = async (g) => Number((await sql(`select stock_qty from public.ingredients where id = $1`, [g.id]))[0].stock_qty);
const inDays = async (n) => (await sql(`select (current_date + $1::int)::text d`, [n]))[0].d;
const buy = (g, qty, exp, extra = {}) => as(m, `insert into public.stock_purchases (restaurant_id, ingredient_id, purchased_on, qty, expires_on, lot_code, supplier)
  values ($1, $2, current_date, $3, $4, $5, $6) returning *`, [rid, g.id, qty, exp, extra.code ?? null, extra.supplier ?? null]);

before(async () => {
  w = await world(); A = w.A; rid = A.r.id; m = w.users.managerA;
  await sql(`update public.restaurants set day_cutoff_hour = 0 where id = $1`, [rid]);
  const mk = async (name, price, extra = '', vals = '') => (await sql(
    `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents ${extra})
     values ($1, $2, 'g', 'kg', 1000, $3 ${vals}) returning *`, [rid, name, price]))[0];
  farine = await mk('Farine', 800, ', track_expiry', ', true');
  sucre = await mk('Sucre', 1000, ', track_expiry', ', true');
  pate = await mk('Pâte', 4000, ', is_preparation, made_ahead', ', true, true');
  lait = await mk('Lait', 200, ', track_expiry', ', true');
  creme = await mk('Crème', 400, ', track_expiry', ', true');
  oeufs = await mk('Œufs', 1000, ', track_expiry', ', true');
  await sql(`insert into public.preparation_lines (restaurant_id, preparation_id, ingredient_id, qty) values ($1, $2, $3, 500), ($1, $2, $4, 100)`, [rid, pate.id, farine.id, sucre.id]);
  for (const g of [farine, sucre, lait, creme, oeufs]) await rpc(m, 'stock_set', [g.id, 0, null]);
});
after(() => pool.end());

test('traceability: the lots that went into a production, soonest first; what came from undated stock is "untraced"', async () => {
  await buy(farine, 300, await inDays(3), { code: 'F-1', supplier: 'Minoterie A' });
  await buy(farine, 1000, await inDays(10), { code: 'F-2', supplier: 'Minoterie B' });
  await rpc(m, 'stock_set', [sucre.id, 150, null]);                 // no date: before the tracking
  const { id } = await rpc(m, 'production_record', [pate.id, 1000, null, null]);   // 500 g flour, 100 g sugar
  const t = await rpc(m, 'production_trace', [id]);
  assert.deepEqual([t.name, t.base_unit], ['Pâte', 'g']);
  assert.equal(t.cancelled, false);
  const f = t.ingredients.find(i => i.name === 'Farine');
  assert.deepEqual([Number(f.used), Number(f.traced), Number(f.untraced)], [500, 500, 0]);
  assert.deepEqual(f.lots.map(l => [l.lot_code, l.supplier, Number(l.qty)]), [['F-1', 'Minoterie A', 300], ['F-2', 'Minoterie B', 200]]);
  const s = t.ingredients.find(i => i.name === 'Sucre');
  assert.deepEqual([Number(s.used), Number(s.traced), Number(s.untraced), s.lots.length], [100, 0, 100, 0]);
  // the other way round, for a recall
  const [f1] = await sql(`select id from public.stock_lots where lot_code = 'F-1'`);
  const back = await rpc(m, 'lot_trace', [f1.id]);
  assert.deepEqual(back.productions.map(p => [p.name, Number(p.qty_used), p.cancelled]), [['Pâte', 300, false]]);
  // a sale takes from lots too, but it is not a production: nothing is traced for it
  const before = (await sql(`select count(*)::int n from public.stock_lot_uses`))[0].n;
  await rpc(m, 'stock_waste', [farine.id, 100, 'test']);
  assert.equal((await sql(`select count(*)::int n from public.stock_lot_uses`))[0].n, before);
  // a cancelled production stays in the trace, marked as cancelled
  await rpc(m, 'production_cancel', [id]);
  assert.equal((await rpc(m, 'production_trace', [id])).cancelled, true);
  assert.equal((await rpc(m, 'lot_trace', [f1.id])).productions[0].cancelled, true);
});

test('traceability: private to the managers of the restaurant', async () => {
  const [p] = await sql(`select id from public.production_batches where restaurant_id = $1 limit 1`, [rid]);
  const [l] = await sql(`select id from public.stock_lots where lot_code = 'F-2'`);
  await assert.rejects(rpc(w.users.ownerB, 'production_trace', [p.id]), /not allowed/);
  await assert.rejects(rpc(w.users.ownerB, 'lot_trace', [l.id]), /not allowed/);
  await assert.rejects(rpc(w.users.ownerB, 'lot_trace', [(await sql(`select gen_random_uuid() id`))[0].id]), /not_found/);
  assert.equal((await as(w.users.ownerB, `select * from public.stock_lot_uses`, [])).length, 0);
});

test('the button throws away everything past its date (not what expires today), valued, and only once', async () => {
  await buy(lait, 1000, await inDays(-2));
  await buy(lait, 500, await inDays(0));
  await buy(lait, 400, await inDays(3));
  const res = await rpc(m, 'expiry_sweep', [rid]);
  assert.deepEqual([res.lots, Number(res.cents)], [1, 200], '1 kg at 0.2 cent per g');
  assert.deepEqual((await lots(lait)).map(l => Number(l.qty_remaining)), [500, 400]);
  assert.equal(await stock(lait), 900);
  const [mv] = await sql(`select * from public.stock_moves where ingredient_id = $1 and waste_reason = 'expired'`, [lait.id]);
  assert.deepEqual([mv.kind, Number(mv.qty), mv.note], ['waste', -1000, 'Périmé (nettoyage)']);
  assert.ok(mv.lot_id);
  assert.equal((await rpc(m, 'expiry_sweep', [rid])).lots, 0);
  // the loss report sees it as an expired loss
  const l = await rpc(m, 'expiry_losses', [rid, 30]);
  assert.ok(Number(l.expired_cents) >= 200);
  await assert.rejects(rpc(w.users.ownerB, 'expiry_sweep', [rid]), /not allowed/);
});

test('closing a day clears what expired, only when the setting is on, and never blocks the closing', async () => {
  await buy(creme, 1000, await inDays(-1));
  await buy(creme, 500, await inDays(0));
  await buy(creme, 400, await inDays(3));
  const close = (d) => sql(`insert into public.day_closures (restaurant_id, business_date, totals) values ($1, current_date + $2::int, '{}')`, [rid, d]);
  await close(-1);                                                   // setting off: nothing happens
  assert.equal((await lots(creme)).length, 3);
  await sql(`update public.restaurants set profit_settings = coalesce(profit_settings, '{}'::jsonb) || '{"expiry_auto_discard": true}' where id = $1`, [rid]);
  await close(0);                                                    // setting on: what expires today or before goes
  assert.deepEqual((await lots(creme)).map(l => Number(l.qty_remaining)), [400]);
  assert.equal(await stock(creme), 400);
  const moves = await sql(`select note, waste_reason from public.stock_moves where ingredient_id = $1 and kind = 'waste' order by id`, [creme.id]);
  assert.deepEqual(moves.map(x => [x.note, x.waste_reason]), [['Périmé (clôture de la journée)', 'expired'], ['Périmé (clôture de la journée)', 'expired']]);
  // nothing expired left: closing another day is fine and changes nothing
  await close(1);
  assert.equal(await stock(creme), 400);
});

test('catering: only the stock that is still good on the day of the event counts', async () => {
  await sql(`insert into public.recipe_lines (restaurant_id, menu_item_id, ingredient_id, qty) values ($1, $2, $3, 100)`, [rid, A.items.tajine.id, oeufs.id]);
  const [c] = await sql(`insert into public.catering_orders (restaurant_id, customer_name, event_date, status) values ($1, 'Mariage', current_date + 5, 'confirmed') returning id`, [rid]);
  await sql(`insert into public.catering_lines (restaurant_id, catering_id, menu_item_id, name, unit_price_cents, qty) values ($1, $2, $3, 'Tajine', 8500, 10)`, [rid, c.id, A.items.tajine.id]);
  await buy(oeufs, 600, await inDays(2));                            // expires before the event
  await buy(oeufs, 700, await inDays(9));
  const day = await inDays(5);
  const x = await rpc(m, 'catering_expiry_check', [rid, day]);
  const e = x.items.find(i => i.name === 'Œufs');
  assert.deepEqual([Number(e.need), Number(e.usable), Number(e.expiring), Number(e.short)], [1000, 700, 600, 300]);
  assert.equal(x.short_count, 1);
  // a day before the first lot expires: everything counts
  const early = await rpc(m, 'catering_expiry_check', [rid, await inDays(1)]);
  assert.equal(early.items.length, 0, 'no catering order that day: nothing needed');
  await sql(`update public.catering_orders set event_date = current_date + 1 where id = $1`, [c.id]);
  const ok = await rpc(m, 'catering_expiry_check', [rid, await inDays(1)]);
  assert.deepEqual([Number(ok.items[0].usable), Number(ok.items[0].short)], [1300, 0]);
  assert.equal(ok.short_count, 0);
  await assert.rejects(rpc(m, 'catering_expiry_check', [rid, null]), /invalid_request/);
  await assert.rejects(rpc(w.users.ownerB, 'catering_expiry_check', [rid, day]), /not allowed/);
});
