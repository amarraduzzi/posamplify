// Expiry dates, step 2: FEFO when something is sold, the warnings of the briefing (expiry_alerts) and the
// loss report (expiry_losses). Amounts are in cents; a lot with no price has no amount ("unpriced").
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, A, rid, m, poulet, creme, yaourt, sans_prix, beurre;
const lots = (g) => sql(`select * from public.stock_lots where ingredient_id = $1 and qty_remaining > 0 order by expires_on`, [g.id]);
const stock = async (g) => Number((await sql(`select stock_qty from public.ingredients where id = $1`, [g.id]))[0].stock_qty);
const inDays = async (n) => (await sql(`select (current_date + $1::int)::text d`, [n]))[0].d;
const buy = (g, qty, exp, total = null) => as(m, `insert into public.stock_purchases (restaurant_id, ingredient_id, purchased_on, qty, total_cents, expires_on)
  values ($1, $2, current_date, $3, $4, $5) returning *`, [rid, g.id, qty, total, exp]);

before(async () => {
  w = await world(); A = w.A; rid = A.r.id; m = w.users.managerA;
  await sql(`update public.restaurants set day_cutoff_hour = 0 where id = $1`, [rid]);
  // price per kg in cents; the unit cost of a lot comes from what was paid, else from this price
  const ing = async (name, price, extra = '', vals = '') => (await sql(
    `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents, track_expiry ${extra})
     values ($1, $2, 'g', 'kg', 1000, $3, true ${vals}) returning *`, [rid, name, price]))[0];
  poulet = await ing('Poulet', 6000);                       // 6 cents per g
  creme = await ing('Crème', 4000, ', expiry_warn_days', ', 3');   // warns 3 days ahead
  yaourt = await ing('Yaourt', 2000);                       // default warning: 2 days
  sans_prix = (await sql(`insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, track_expiry)
                          values ($1, 'Épice sans prix', 'g', 'kg', 1000, true) returning *`, [rid]))[0];
  beurre = (await sql(`insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents)
                       values ($1, 'Beurre', 'g', 'kg', 1000, 9000) returning *`, [rid]))[0];   // not tracked
  for (const g of [poulet, creme, yaourt, sans_prix, beurre]) await rpc(m, 'stock_set', [g.id, 0, null]);
});
after(() => pool.end());

test('FEFO on a real sale: the lot that expires first is used first, then the next one', async () => {
  // tajine = 250 g of chicken per portion
  await as(m, `insert into public.recipe_lines (restaurant_id, menu_item_id, ingredient_id, qty) values ($1, $2, $3, 250)`, [rid, A.items.tajine.id, poulet.id]);
  await buy(poulet, 1000, await inDays(5));                // later lot, bought first
  await buy(poulet, 600, await inDays(1));                 // sooner lot, bought second
  const sell = async (qty) => {
    const o = await tillOrder(w.users.deviceA, rid, [{ item_id: A.items.tajine.id, qty, price: 8500 }]);
    return rpc(w.users.deviceA, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: Number(o.total_cents) }]), null, null]);
  };
  await sell(2);                                           // 500 g: all from the sooner lot
  assert.deepEqual((await lots(poulet)).map(l => Number(l.qty_remaining)), [100, 1000]);
  await sell(1);                                           // 250 g: 100 g left of the sooner lot, 150 g of the later one
  assert.deepEqual((await lots(poulet)).map(l => Number(l.qty_remaining)), [850]);
  assert.equal(await stock(poulet), 850);
  // a credit note puts the stock back but does not invent a date: it is undated stock now
  const doc = await sell(1);
  await rpc(w.users.deviceA, 'issue_credit_note', [doc.id, 'erreur', A.staff.karim.id, '9999']);
  assert.equal(await stock(poulet), 850);
  assert.deepEqual((await lots(poulet)).map(l => Number(l.qty_remaining)), [600], 'the sale took 250 g of the 850 g lot, the refund added undated stock');
  // empty it again for the next tests
  await sql(`delete from public.stock_lots where ingredient_id = $1`, [poulet.id]);
  await rpc(m, 'stock_set', [poulet.id, 0, null]);
});

test('alerts: expired, today and soon are told apart and valued; far dates and untracked stock stay out', async () => {
  await buy(creme, 2000, await inDays(-1), 8000);          // expired yesterday, paid 80 DH for 2 kg = 4 cents per g (a purchase also sets the price of the ingredient)
  await buy(creme, 1000, await inDays(0));                 // today, no price paid: the price of the ingredient, 4 cents per g -> 4000
  await buy(creme, 500, await inDays(3));                  // within its 3 warning days: soon
  await buy(creme, 800, await inDays(4));                  // beyond its warning days: not listed
  await buy(yaourt, 1500, await inDays(2));                // soon (default warning 2 days) -> 30 DH
  await buy(yaourt, 1500, await inDays(3));                // beyond 2 days: not listed
  await buy(sans_prix, 400, await inDays(0));              // today but no price at all
  await buy(beurre, 1000, await inDays(0));                // not tracked: no lot
  const a = await rpc(m, 'expiry_alerts', [rid]);
  assert.equal(a.expired.count, 1);
  assert.equal(Number(a.expired.value_cents), 8000, '2 kg at 4 cents per g');
  assert.deepEqual(a.expired.items.map(i => [i.name, Number(i.qty), i.days_left]), [['Crème', 2000, -1]]);
  assert.equal(a.today.count, 2);
  assert.equal(Number(a.today.value_cents), 4000, 'only the priced one counts in the amount');
  assert.equal(a.today.unpriced, 1);
  assert.deepEqual(a.today.items.map(i => i.name), ['Crème', 'Épice sans prix'], 'highest amount first, unpriced last');
  assert.equal(a.soon.count, 2);
  assert.equal(Number(a.soon.value_cents), 2000 + 3000, '500 g of cream at 4 cents + 1.5 kg of yoghurt at 2 cents');
  assert.deepEqual(a.soon.items.map(i => [i.name, i.days_left]), [['Yaourt', 2], ['Crème', 3]], 'soonest date first');
  assert.ok(![...a.expired.items, ...a.today.items, ...a.soon.items].some(i => i.name === 'Beurre'));
});

test('alerts: lots of one ingredient are added up, and a lot that is used up disappears', async () => {
  await buy(yaourt, 500, await inDays(2));                 // second lot of yoghurt on the same day
  let a = await rpc(m, 'expiry_alerts', [rid]);
  const y = a.soon.items.find(i => i.name === 'Yaourt');
  assert.deepEqual([Number(y.qty), y.lots, Number(y.value_cents)], [2000, 2, 4000]);
  const [lot] = await lots(yaourt);
  await rpc(m, 'stock_lot_discard', [lot.id, Number(lot.qty_remaining), 'expired', null]);
  a = await rpc(m, 'expiry_alerts', [rid]);
  assert.equal(a.soon.items.find(i => i.name === 'Yaourt')?.lots, 1);
});

test('alerts: only managers of the restaurant can ask', async () => {
  await assert.rejects(rpc(w.users.ownerB, 'expiry_alerts', [rid]), /not allowed/);
  await assert.rejects(rpc(w.users.stranger, 'expiry_alerts', [rid]), /not allowed/);
  await assert.rejects(rpc(null, 'expiry_alerts', [rid]), /./);
  const empty = await rpc(w.users.ownerB, 'expiry_alerts', [w.B.r.id]);
  assert.deepEqual([empty.expired.count, empty.today.count, empty.soon.count], [0, 0, 0]);
});

test('losses: what was thrown away because it expired, valued, by ingredient, by day and by reason', async () => {
  // the yoghurt lot thrown away in the test above already counts: measure from that figure
  const first = await rpc(m, 'expiry_losses', [rid, 30]);
  assert.ok(Number(first.expired_cents) > 0 && first.expired_count === 1);
  const base = Number(first.expired_cents);
  const [c] = await lots(creme);                           // soonest: the one that expired yesterday (2 kg at 4 cents per g)
  await rpc(m, 'stock_lot_discard', [c.id, 1500, 'expired', null]);
  const [sp] = await lots(sans_prix);
  await rpc(m, 'stock_lot_discard', [sp.id, 100, 'expired', null]);   // no price: counted, but no amount
  const [c2] = (await lots(creme)).slice(1);
  await rpc(m, 'stock_lot_discard', [c2.id, 200, 'damaged', null]);   // another reason: not part of the expired figure
  const l = await rpc(m, 'expiry_losses', [rid, 30]);
  assert.equal(Number(l.expired_cents) - base, 6000, '1.5 kg at 4 cents per g');
  assert.equal(l.expired_unpriced, 1);
  assert.equal(Number(l.other_cents), 800, '200 g of cream at 4 cents per g');
  const cream = l.by_ingredient.find(i => i.name === 'Crème');
  assert.deepEqual([Number(cream.qty), Number(cream.cents), cream.n], [1500, 6000, 1]);
  assert.ok(l.by_ingredient.some(i => i.name === 'Épice sans prix' && Number(i.cents) === 0));
  assert.deepEqual(l.by_reason.map(x => x.reason).sort(), ['damaged', 'expired']);
  assert.equal(l.by_day.length, 1, 'all of it today');
  assert.equal(l.tracking, 4);
  // the loss report and the stock agree: the moves are normal waste moves
  const moves = await sql(`select count(*)::int n from public.stock_moves where restaurant_id = $1 and kind = 'waste' and waste_reason = 'expired'`, [rid]);
  assert.equal(moves[0].n, l.expired_count);
});

test('losses: the period before is counted apart; the expired stock still on the shelf is "at stake"', async () => {
  // move the expired cream move 45 days back: outside the last 30 days, inside the 30 days before them
  const [mv] = await sql(`select id from public.stock_moves where restaurant_id = $1 and waste_reason = 'expired' and ingredient_id = $2`, [rid, creme.id]);
  const cur = await rpc(m, 'expiry_losses', [rid, 30]);
  await sql(`update public.stock_moves set business_date = current_date - 45 where id = $1`, [mv.id]);
  const moved = await rpc(m, 'expiry_losses', [rid, 30]);
  assert.equal(Number(cur.expired_cents) - Number(moved.expired_cents), 6000);
  assert.equal(Number(moved.previous_cents), 6000, 'it is now in the 30 days before');
  const wide = await rpc(m, 'expiry_losses', [rid, 90]);
  assert.equal(Number(wide.expired_cents), Number(cur.expired_cents), 'a longer period sees it again');
  // 500 g of cream expired yesterday is still in stock (the 2 kg lot minus the 1.5 kg thrown away)
  const s = moved.at_stake;
  assert.equal(s.count, 1);
  assert.equal(Number(s.cents), 2000, '500 g at 4 cents per g');
  assert.equal(s.unpriced, 0);
  // a loss keeps the cost of its own lot: a later price change of the ingredient does not rewrite history
  await sql(`update public.ingredients set purchase_price_cents = 1000 where id = $1`, [creme.id]);
  const later = await rpc(m, 'expiry_losses', [rid, 90]);
  assert.equal(Number(later.expired_cents), Number(wide.expired_cents));
  assert.equal(Number(later.at_stake.cents), 2000);
});

test('losses: bad period refused; private to the restaurant', async () => {
  for (const d of [0, -3, 400, null]) await assert.rejects(rpc(m, 'expiry_losses', [rid, d]), /invalid_request/);
  await assert.rejects(rpc(w.users.ownerB, 'expiry_losses', [rid, 30]), /not allowed/);
  const other = await rpc(w.users.ownerB, 'expiry_losses', [w.B.r.id, 30]);
  assert.deepEqual([Number(other.expired_cents), other.tracking, other.at_stake.count], [0, 0, 0]);
});
