// Production in two steps: production_start takes the ingredients out for the planned quantity (batch 'running'),
// production_finish puts what came out into stock and gives the yield. Cancelling works for both.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, sql, as, rpc, world } from './helpers.mjs';

// a DATE comes back as local midnight: format it locally
const ymd = (d) => d.toLocaleDateString('sv');
let w, A, rid, m, flour, butter, croissant, crema;
const ing = async (name, base, qty, price, prep = false) => (await as(m,
  `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents${prep ? ', is_preparation, made_ahead' : ''})
   values ($1, $2, $3, 'kg', $4, $5${prep ? ', true, true' : ''}) returning *`, [rid, name, base, qty, price]))[0];
const stock = async g => { const v = (await sql(`select stock_qty from public.ingredients where id = $1`, [g.id]))[0].stock_qty; return v == null ? 0 : Number(v); };
const batch = async id => (await sql(`select * from public.production_batches where id = $1`, [id]))[0];
const line = (p, g, qty) => as(m, `insert into public.preparation_lines (restaurant_id, preparation_id, ingredient_id, qty) values ($1, $2, $3, $4) returning *`, [rid, p.id, g.id, qty]);
const today = () => sql(`select current_date::text d`).then(r => r[0].d);
const lots = (g) => sql(`select * from public.stock_lots where ingredient_id = $1 and qty_remaining > 0 order by expires_on`, [g.id]);

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

test('start: the ingredients for the planned quantity leave the stock, the preparation does not move yet', async () => {
  const s = await rpc(m, 'production_start', [croissant.id, 60]);
  assert.equal(Number(s.planned_qty), 60);
  assert.equal(Number(s.cost_cents), 8800);
  assert.equal(await stock(flour), 9000);
  assert.equal(await stock(butter), 9000);
  assert.equal(await stock(croissant), 0, 'nothing in the stock yet: it is in the oven');
  const b = await batch(s.id);
  assert.equal(b.status, 'running');
  assert.equal(Number(b.qty), 0);
  assert.equal(Number(b.planned_qty), 60);
  assert.equal(b.finished_at, null);
  // a running batch is not a result: the report leaves it out
  const d = await today();
  const rep = await rpc(m, 'production_yield_report', [rid, d, d]);
  assert.deepEqual(rep.items, []);
  assert.equal(Number(rep.totals.loss_cents), 0);
});

test('finish: the stock gets what came out, the yield is known, the report counts it', async () => {
  const [run] = await sql(`select id from public.production_batches where restaurant_id = $1 and status = 'running'`, [rid]);
  const f = await rpc(m, 'production_finish', [run.id, 54]);
  assert.equal(Number(f.stock_qty), 54);
  assert.equal(f.yield_bp, 9000);
  assert.equal(Number(f.cost_cents), 8800);
  assert.equal(await stock(flour), 9000, 'the flour is not taken out a second time');
  const b = await batch(run.id);
  assert.equal(b.status, 'done');
  assert.equal(Number(b.qty), 54);
  assert.notEqual(b.finished_at, null);
  const d = await today();
  const rep = await rpc(m, 'production_yield_report', [rid, d, d]);
  assert.equal(rep.items.length, 1);
  assert.equal(rep.items[0].batches, 1);
  assert.equal(rep.items[0].measured, 1);
  assert.equal(rep.items[0].yield_bp, 9000);
  assert.equal(Number(rep.items[0].loss_cents), 880);
  // finishing twice is refused
  await assert.rejects(rpc(m, 'production_finish', [run.id, 54]), /not_running/);
});

test('cancelling a running batch gives the ingredients back; it cannot be finished afterwards', async () => {
  const s = await rpc(m, 'production_start', [croissant.id, 30]);
  assert.equal(await stock(flour), 8500);
  await rpc(m, 'production_cancel', [s.id]);
  assert.equal(await stock(flour), 9000);
  assert.equal(await stock(butter), 9000);
  assert.equal(await stock(croissant), 54, 'the preparation stock did not move');
  assert.notEqual((await batch(s.id)).cancelled_at, null);
  await assert.rejects(rpc(m, 'production_finish', [s.id, 30]), /already_cancelled/);
});

test('cancelling a finished batch takes the preparation and gives all ingredients back', async () => {
  const [done] = await sql(`select id from public.production_batches where restaurant_id = $1 and status = 'done' and cancelled_at is null`, [rid]);
  await rpc(m, 'production_cancel', [done.id]);
  assert.equal(await stock(croissant), 0);
  assert.equal(await stock(flour), 10000);
  assert.equal(await stock(butter), 10000);
  const d = await today();
  const rep = await rpc(m, 'production_yield_report', [rid, d, d]);
  assert.deepEqual(rep.items, [], 'a cancelled batch leaves the report');
});

test('a surplus: more came out than planned', async () => {
  const s = await rpc(m, 'production_start', [croissant.id, 60]);
  const f = await rpc(m, 'production_finish', [s.id, 66]);
  assert.equal(f.yield_bp, 11000);
  assert.equal(Number(f.stock_qty), 66);
  const d = await today();
  const rep = await rpc(m, 'production_yield_report', [rid, d, d]);
  assert.equal(Number(rep.items[0].loss_cents), -880, 'net: the surplus counts against the loss');
});

test('the quick route (everything in one go) still works next to the two steps', async () => {
  const p = await rpc(m, 'production_record', [croissant.id, 54, null, null, 60]);
  assert.equal(p.yield_bp, 9000);
  assert.equal((await batch(p.id)).status, 'done', 'a one-step production is done at once');
});

test('invalid input and other restaurants are refused', async () => {
  await assert.rejects(rpc(m, 'production_start', [croissant.id, 0]), /invalid_request/);
  await assert.rejects(rpc(m, 'production_start', [croissant.id, -3]), /invalid_request/);
  await assert.rejects(rpc(m, 'production_start', [flour.id, 10]), /not_a_preparation/);
  await assert.rejects(rpc(m, 'production_finish', [randomUUID(), 10]), /not_found/);
  const s = await rpc(m, 'production_start', [croissant.id, 10]);
  await assert.rejects(rpc(m, 'production_finish', [s.id, 0]), /invalid_request/);
  await assert.rejects(rpc(m, 'production_finish', [s.id, -2]), /invalid_request/);
  await assert.rejects(rpc(w.users.deviceA, 'production_start', [croissant.id, 10]), /not allowed/);
  await assert.rejects(rpc(w.users.deviceA, 'production_finish', [s.id, 10]), /not allowed/);
  await assert.rejects(rpc(w.users.ownerB, 'production_finish', [s.id, 10]), /not allowed/);
  assert.equal((await batch(s.id)).status, 'running', 'still running after the refusals');
  await rpc(m, 'production_finish', [s.id, 10]);
});

test('lots: the lot of a preparation with a shelf life is made at finish, with what came out', async () => {
  crema = await ing('Crème pâtissière', 'g', 1000, 4000, true);
  await sql(`update public.ingredients set track_expiry = true, shelf_life_days = 2 where id = $1`, [crema.id]);
  await line(crema, flour, 500);
  await rpc(m, 'stock_set', [flour.id, 20000, null]);
  const s = await rpc(m, 'production_start', [crema.id, 1000]);
  assert.equal((await lots(crema)).length, 0, 'no lot while it is running');
  assert.equal(await stock(flour), 19500);
  await rpc(m, 'production_finish', [s.id, 900]);
  const [l] = await lots(crema);
  assert.equal(Number(l.qty_remaining), 900);
  const inTwo = (await sql(`select (current_date + 2)::text d`))[0].d;
  assert.equal(ymd(l.expires_on), inTwo);
  assert.equal(l.source, 'production');
  await rpc(m, 'production_cancel', [s.id]);
  assert.equal((await lots(crema)).length, 0, 'the lot goes away with the cancelled production');
  assert.equal(await stock(crema), 0);
  assert.equal(await stock(flour), 20000);
});
