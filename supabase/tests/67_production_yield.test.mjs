// Production yield (pâtisserie): the ingredients taken out are the ones for the PLANNED quantity, the stock
// gets what really came out, and the report shows the yield and what the loss cost.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, A, rid, m, flour, butter, croissant;
const ing = async (name, base, qty, price, prep = false) => (await as(m,
  `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents${prep ? ', is_preparation, made_ahead' : ''})
   values ($1, $2, $3, 'kg', $4, $5${prep ? ', true, true' : ''}) returning *`, [rid, name, base, qty, price]))[0];
const get = async g => (await sql(`select * from public.ingredients where id = $1`, [g.id]))[0];
const line = (p, g, qty) => as(m, `insert into public.preparation_lines (restaurant_id, preparation_id, ingredient_id, qty) values ($1, $2, $3, $4) returning *`, [rid, p.id, g.id, qty]);
const today = () => sql(`select current_date::text d`).then(r => r[0].d);

before(async () => {
  w = await world(); A = w.A; rid = A.r.id; m = w.users.managerA;
  await sql(`update public.restaurants set day_cutoff_hour = 0 where id = $1`, [rid]);
  flour = await ing('Farine', 'g', 1000, 800);                 // 8 DH / kg
  butter = await ing('Beurre', 'g', 1000, 8000);               // 80 DH / kg
  croissant = await ing('Croissant maison', 'pc', 60, null, true);   // a batch of 60
  await line(croissant, flour, 1000); await line(croissant, butter, 1000);   // one batch: 88 DH
  await rpc(m, 'stock_set', [flour.id, 10000, 'start']);
  await rpc(m, 'stock_set', [butter.id, 10000, 'start']);
});
after(() => pool.end());

test('without a planned quantity everything works as before (four values still work)', async () => {
  const p = await rpc(m, 'production_record', [croissant.id, 60, null, null]);
  assert.equal(Number(p.stock_qty), 60);
  assert.equal(Number((await get(flour)).stock_qty), 9000);
  assert.equal(Number(p.cost_cents), 8800);
  assert.equal(p.planned_qty, null);
  assert.equal(p.yield_bp, null);
});

test('a batch that came out short: ingredients for the planned quantity, stock for what came out', async () => {
  // meant to make 60, 54 came out of the oven
  const p = await rpc(m, 'production_record', [croissant.id, 54, 'brûlé', null, 60]);
  assert.equal(Number(p.stock_qty), 114, '60 + 54 croissants');
  assert.equal(Number((await get(flour)).stock_qty), 8000, 'the flour of 60 left the stock');
  assert.equal(Number((await get(butter)).stock_qty), 8000);
  assert.equal(Number(p.cost_cents), 8800, 'the cost is what the ingredients really cost');
  assert.equal(Number(p.planned_qty), 60);
  assert.equal(p.yield_bp, 9000);
  // a perfect measured batch
  const q = await rpc(m, 'production_record', [croissant.id, 30, null, null, 30]);
  assert.equal(q.yield_bp, 10000);
  assert.equal(Number(q.cost_cents), 4400);
});

test('the report: yield and the cost of the loss, measured productions only', async () => {
  const d = await today();
  const rep = await rpc(m, 'production_yield_report', [rid, d, d]);
  assert.equal(rep.items.length, 1);
  const it = rep.items[0];
  assert.equal(it.name, 'Croissant maison');
  assert.equal(it.batches, 3);
  assert.equal(it.measured, 2, 'the first production had no planned quantity: not measured');
  assert.equal(Number(it.produced_qty), 84);
  assert.equal(Number(it.planned_qty), 90);
  assert.equal(it.yield_bp, 9333);
  assert.equal(it.lowest_yield_bp, 9000);
  assert.equal(Number(it.loss_qty), 6);
  assert.equal(Number(it.loss_cents), 880, '6 of 60 croissants = a tenth of 88 DH');
  assert.equal(Number(rep.totals.loss_cents), 880);
  assert.equal(rep.totals.measured, 2);
});

test('a cancelled production leaves the report', async () => {
  const d = await today();
  const [short] = await sql(`select id from public.production_batches where restaurant_id = $1 and planned_qty = 60 and qty = 54`, [rid]);
  await rpc(m, 'production_cancel', [short.id]);
  const rep = await rpc(m, 'production_yield_report', [rid, d, d]);
  assert.equal(rep.items[0].batches, 2);
  assert.equal(rep.items[0].measured, 1);
  assert.equal(Number(rep.items[0].loss_cents), 0);
  assert.equal(Number((await get(flour)).stock_qty), 8500, 'the flour of the cancelled batch is back (10000 - 1000 - 500 + 1000)');
});

test('a surplus counts against the loss; empty periods give an empty report', async () => {
  const d = await today();
  await rpc(m, 'production_record', [croissant.id, 66, null, null, 60]);   // 66 came out of ingredients for 60
  const rep = await rpc(m, 'production_yield_report', [rid, d, d]);
  assert.equal(Number(rep.items[0].loss_cents), -880, 'net: the surplus cancels what was lost');
  const old = await rpc(m, 'production_yield_report', [rid, '2020-01-01', '2020-01-31']);
  assert.deepEqual(old.items, []);
  assert.equal(Number(old.totals.loss_cents), 0);
});

test('invalid input and other restaurants are refused', async () => {
  const d = await today();
  await assert.rejects(rpc(m, 'production_record', [croissant.id, 10, null, null, 0]), /invalid_request/);
  await assert.rejects(rpc(m, 'production_record', [croissant.id, 10, null, null, -5]), /invalid_request/);
  await assert.rejects(rpc(m, 'production_yield_report', [rid, d, '2000-01-01']), /invalid_request/);
  await assert.rejects(rpc(m, 'production_yield_report', [rid, '2019-01-01', d]), /invalid_request/, 'period over 400 days');
  await assert.rejects(rpc(w.users.deviceA, 'production_yield_report', [rid, d, d]), /not allowed/);
  await assert.rejects(rpc(w.users.deviceA, 'production_record', [croissant.id, 10, null, null, 12]), /not allowed/);
  await assert.rejects(rpc(w.users.ownerB, 'production_yield_report', [rid, d, d]), /not allowed/);
});
