// Labels (step 2): every production gets its own lot number, the dated lot carries it, and production_label gives the
// facts for the label, with the allergens calculated by step 1 (never an old copy, never "none" for something unchecked).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, rid, m, flour, egg, almond, cream, cake, shell;
const mk = async (name, extra = {}) => (await sql(
  `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents, allergens, may_contain,
                                   is_preparation, made_ahead, track_expiry, shelf_life_days, expiry_type)
   values ($1, $2, 'g', 'kg', 1000, 1000, $3, $4, $5, $5, $6, $7, $8) returning *`,
  [rid, name, extra.allergens ?? null, extra.traces ?? [], !!extra.prep, !!extra.shelf, extra.shelf ?? null, extra.type ?? 'dlc']))[0];
const pline = (p, g, qty = 100) => sql(`insert into public.preparation_lines (restaurant_id, preparation_id, ingredient_id, qty) values ($1, $2, $3, $4)`, [rid, p.id, g.id, qty]);

before(async () => {
  w = await world(); rid = w.A.r.id; m = w.users.managerA;
  await sql(`update public.restaurants set day_cutoff_hour = 0 where id = $1`, [rid]);
  flour = await mk('Farine', { allergens: ['gluten'] });
  egg = await mk('Oeufs', { allergens: ['eggs'], traces: ['sesame'] });
  almond = await mk('Amandes', { allergens: null });                       // not filled in yet
  cream = await mk('Crème', { prep: true, shelf: 2 });
  shell = await mk('Fond', { prep: true, shelf: 5, type: 'ddm' });
  await pline(cream, egg); await pline(shell, flour); await pline(shell, cream);
  for (const g of [flour, egg, almond]) await rpc(m, 'stock_set', [g.id, 100000, null]);
});
after(() => pool.end());

test('every production gets its own number: P + day + number of the day', async () => {
  const a = await rpc(m, 'production_record', [cream.id, 500, null, null]);
  const b = await rpc(m, 'production_record', [cream.id, 500, null, null]);
  const c = await rpc(m, 'production_record', [shell.id, 800, null, null]);
  const codes = (await sql(`select lot_code from public.production_batches where id = any ($1) order by created_at, id`, [[a.id, b.id, c.id]])).map(x => x.lot_code);
  const day = (await sql(`select to_char(produced_on, 'YYMMDD') d from public.production_batches where id = $1`, [a.id]))[0].d;
  assert.deepEqual(codes, [`P${day}-01`, `P${day}-02`, `P${day}-03`]);
});

test('the dated lot of a batch carries the number of the batch', async () => {
  const { id } = await rpc(m, 'production_record', [cream.id, 300, null, null]);
  const [b] = await sql(`select lot_code from public.production_batches where id = $1`, [id]);
  const [l] = await sql(`select lot_code from public.stock_lots where production_id = $1`, [id]);
  assert.ok(b.lot_code);
  assert.equal(l.lot_code, b.lot_code);
});

test('a number given by hand is kept', async () => {
  const [x] = await sql(`insert into public.production_batches (restaurant_id, ingredient_id, qty, produced_on, lot_code)
                         values ($1, $2, 10, current_date, 'MIJN-1') returning lot_code`, [rid, cream.id]);
  assert.equal(x.lot_code, 'MIJN-1');
});

test('the label: product, days, number and the allergens of every level of the recipe', async () => {
  const { id } = await rpc(m, 'production_record', [shell.id, 800, null, null]);
  const l = await rpc(m, 'production_label', [id]);
  assert.equal(l.name, 'Fond');
  assert.equal(l.restaurant, w.A.r.name);
  assert.equal(l.expiry_type, 'ddm');
  assert.deepEqual(l.allergens, ['eggs', 'gluten']);                  // the egg is inside the cream inside the shell
  assert.deepEqual(l.may_contain, ['sesame']);
  assert.equal(l.allergens_complete, true);
  assert.equal(l.cancelled, false);
  const [r] = await sql(`select (produced_on + 5)::text e, produced_on::text p, lot_code from public.production_batches where id = $1`, [id]);
  assert.equal(String(l.expires_on).slice(0, 10), r.e);
  assert.equal(String(l.produced_on).slice(0, 10), r.p);
  assert.equal(l.lot_code, r.lot_code);
});

test('a gap in the recipe makes the label incomplete, and a change of an ingredient follows at once', async () => {
  await pline(cream, almond);
  const { id } = await rpc(m, 'production_record', [cream.id, 400, null, null]);
  assert.equal((await rpc(m, 'production_label', [id])).allergens_complete, false);
  await sql(`update public.ingredients set allergens = '{almonds}' where id = $1`, [almond.id]);
  const l = await rpc(m, 'production_label', [id]);
  assert.equal(l.allergens_complete, true);
  assert.deepEqual(l.allergens, ['almonds', 'eggs']);
});

test('without a shelf life there is no date (the app asks for it), and a cancelled batch is marked', async () => {
  const plain = await mk('Pâte nature', { prep: true });
  await pline(plain, flour);
  const { id } = await rpc(m, 'production_record', [plain.id, 200, null, null]);
  assert.equal((await rpc(m, 'production_label', [id])).expires_on, null);
  await rpc(m, 'production_cancel', [id]);
  assert.equal((await rpc(m, 'production_label', [id])).cancelled, true);
});

test('private to the managers of the shop', async () => {
  const [p] = await sql(`select id from public.production_batches where restaurant_id = $1 limit 1`, [rid]);
  await assert.rejects(rpc(w.users.ownerB, 'production_label', [p.id]), /not allowed/);
  await assert.rejects(rpc(m, 'production_label', [(await sql(`select gen_random_uuid() id`))[0].id]), /not_found/);
});
