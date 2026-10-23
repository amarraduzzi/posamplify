// Production planning: the evening plan for a day moves no stock; "Fait" on the day takes the ingredients
// out (a normal production), "Pas fait" keeps the reason, undo gives the stock back. Weekdays per preparation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, rid, m, flour, sugar, icing, dough, pancake;
const ing = async (name, base, qty, price, prep = false) => (await as(m,
  `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents${prep ? ', is_preparation, made_ahead' : ''})
   values ($1, $2, $3, 'kg', $4, $5${prep ? ', true, true' : ''}) returning *`, [rid, name, base, qty, price]))[0];
const stock = async g => { const v = (await sql(`select stock_qty from public.ingredients where id = $1`, [g.id]))[0].stock_qty; return v == null ? 0 : Number(v); };
const line = (p, g, qty) => as(m, `insert into public.preparation_lines (restaurant_id, preparation_id, ingredient_id, qty) values ($1, $2, $3, $4)`, [rid, p.id, g.id, qty]);
const J = x => JSON.stringify(x);
const today = () => sql(`select current_date::text d`).then(r => r[0].d);
const tomorrow = () => sql(`select (current_date + 1)::text d`).then(r => r[0].d);

before(async () => {
  w = await world(); rid = w.A.r.id; m = w.users.managerA;
  await sql(`update public.restaurants set day_cutoff_hour = 0, timezone = 'UTC' where id = $1`, [rid]);
  flour = await ing('Farine', 'g', 1000, 800);
  sugar = await ing('Sucre glace', 'g', 1000, 1200);
  icing = await ing('Icing', 'g', 1000, null, true);         // 1 kg: 800 g sugar
  dough = await ing('Pâte cinnamon', 'g', 2000, null, true); // 2 kg: 1500 g flour
  pancake = await ing('Mix pancakes', 'g', 1000, null, true);
  await line(icing, sugar, 800); await line(dough, flour, 1500); await line(pancake, flour, 600);
  await rpc(m, 'stock_set', [flour.id, 5000, 'start']);
  await rpc(m, 'stock_set', [sugar.id, 500, 'start']);
});
after(() => pool.end());

test('weekdays: a preparation proposes itself only on its days', async () => {
  const d = await today();
  const dow = Number((await sql(`select extract(isodow from current_date)::int d`))[0].d);
  const other = dow === 7 ? 1 : dow + 1;
  await rpc(m, 'production_make_days', [pancake.id, [other]]);
  const day = await rpc(m, 'production_day', [rid, d]);
  const p = new Map(day.proposals.map(x => [x.ingredient_id, x]));
  assert.equal(p.get(pancake.id).on_day, false);
  assert.equal(p.get(icing.id).on_day, true);
  const all = await rpc(m, 'production_make_days', [pancake.id, [1, 2, 3, 4, 5, 6, 7]]);
  assert.equal(all.make_days, null, 'all seven days is every day');
  await assert.rejects(rpc(m, 'production_make_days', [flour.id, [1]]), /not_a_preparation/);
  await assert.rejects(rpc(m, 'production_make_days', [icing.id, [8]]), /check|invalid/);
});

test('saving the evening plan moves no stock; the needs show what is missing', async () => {
  const d = await tomorrow();
  const day = await rpc(m, 'production_plan_save', [rid, d, J([{ ingredient_id: icing.id, qty: 1000 }, { ingredient_id: dough.id, qty: 4000, note: 'pour 40 rolls' }]), 'Samedi']);
  assert.equal(day.plan.lines.length, 2);
  assert.equal(day.plan.lines[0].ingredient_id, icing.id, 'the order of the day is kept');
  assert.equal(day.plan.note, 'Samedi');
  assert.equal(await stock(flour), 5000);
  assert.equal(await stock(sugar), 500);
  const n = new Map(day.needs.map(x => [x.ingredient_id, x]));
  assert.equal(Number(n.get(sugar.id).need), 800);
  assert.equal(Number(n.get(sugar.id).short), 300);
  assert.equal(Number(n.get(flour.id).need), 3000);
  assert.equal(Number(n.get(flour.id).short), 0);
  // tomorrow cannot be confirmed today
  await assert.rejects(rpc(m, 'production_plan_done', [day.plan.lines[0].id, 1000]), /not_today/);
  // not in the past
  await assert.rejects(rpc(m, 'production_plan_save', [rid, '2020-01-01', J([])]), /past_date/);
  await assert.rejects(rpc(m, 'production_plan_save', [rid, d, J([{ ingredient_id: flour.id, qty: 1 }])]), /not_a_preparation/);
});

test('the morning: Fait takes the stock out, Pas fait keeps the reason, undo gives it back', async () => {
  const d = await today();
  let day = await rpc(m, 'production_plan_save', [rid, d, J([{ ingredient_id: dough.id, qty: 2000 }, { ingredient_id: icing.id, qty: 1000 }])]);
  const [ld, li] = day.plan.lines;
  const res = await rpc(m, 'production_plan_done', [ld.id, 1800]);   // made a bit less than planned
  assert.ok(res.id);
  assert.equal(await stock(dough), 1800);
  assert.equal(await stock(flour), 5000 - 1350, 'ingredients for what was really made');
  await rpc(m, 'production_plan_skip', [li.id, 'Pas assez de sucre']);
  assert.equal(await stock(sugar), 500, 'not made: nothing moves');
  day = await rpc(m, 'production_day', [rid, d]);
  const s = new Map(day.plan.lines.map(x => [x.id, x]));
  assert.equal(s.get(ld.id).status, 'done');
  assert.equal(Number(s.get(ld.id).done_qty), 1800);
  assert.equal(s.get(li.id).status, 'skipped');
  assert.equal(s.get(li.id).skip_reason, 'Pas assez de sucre');
  assert.deepEqual(day.needs, [], 'nothing left to do');
  await assert.rejects(rpc(m, 'production_plan_done', [ld.id, 1]), /not_pending/);
  // saving again keeps the done line as it was
  day = await rpc(m, 'production_plan_save', [rid, d, J([{ ingredient_id: dough.id, qty: 9000 }, { ingredient_id: icing.id, qty: 1000 }])]);
  assert.equal(Number(day.plan.lines.find(x => x.id === ld.id).planned_qty), 2000);
  // undo the Fait: stock back, line to do
  await rpc(m, 'production_plan_undo', [ld.id]);
  assert.equal(await stock(flour), 5000);
  assert.equal(await stock(dough), 0);
  await rpc(m, 'production_plan_undo', [li.id]);
  day = await rpc(m, 'production_day', [rid, d]);
  assert.ok(day.plan.lines.every(x => x.status === 'pending'));
  // cancelling the production from the list of the day also puts the line back
  const r2 = await rpc(m, 'production_plan_done', [ld.id, 2000]);
  await rpc(m, 'production_cancel', [r2.id]);
  day = await rpc(m, 'production_day', [rid, d]);
  assert.equal(day.plan.lines.find(x => x.id === ld.id).status, 'pending');
});

test('the last plan of the same weekday can be copied; other restaurants and staff cannot touch it', async () => {
  const d = (await sql(`select (current_date + 7)::text d`))[0].d;
  const day = await rpc(m, 'production_day', [rid, d]);
  assert.equal(day.previous.date, await today());
  assert.equal(day.previous.lines.length, 2);
  const [l] = (await rpc(m, 'production_day', [rid, await today()])).plan.lines;
  await assert.rejects(rpc(w.users.ownerB, 'production_plan_done', [l.id, 1]), /not allowed/);
  await assert.rejects(rpc(w.users.ownerB, 'production_day', [rid, d]), /not allowed/);
  const seen = await as(w.users.ownerB, `select count(*)::int n from public.production_plan_lines where restaurant_id = $1`, [rid]);
  assert.equal(seen[0].n, 0);
  // an empty plan is removed
  await rpc(m, 'production_plan_save', [rid, await tomorrow(), J([])]);
  assert.equal((await rpc(m, 'production_day', [rid, await tomorrow()])).plan, null);
});
