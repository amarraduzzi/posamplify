// Amplify Fidélité without a till: the counter. Points from a bill amount (same per_dh rule as the till), a reward
// for points, the wallet of won rewards, undo the same day with a manager PIN, never counted twice, a daily cap.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, A, rid, dev, sara, karim;
before(async () => {
  w = await world(); A = w.A; rid = A.r.id; dev = w.users.deviceA; sara = A.staff.sara.id; karim = A.staff.karim.id;
  await as(w.users.ownerA, `update public.restaurants set loyalty = $2::jsonb where id = $1`, [rid, JSON.stringify(
    { customers: true, enabled: true, per_dh: 10, rewards: [{ id: 'r30', kind: 'discount', points: 20, cents: 3000, label: 'Remise 30 DH' }] })]);
});
after(() => pool.end());
const earn = (phone, cents, id = randomUUID(), pin = '1111') => rpc(dev, 'loyalty_counter_earn', [rid, phone, cents, sara, pin, id, 'Test']);
const pts = async phone => (await sql(`select points from public.customers where restaurant_id = $1 and phone = $2`, [rid, phone]))[0]?.points;

test('a bill amount gives points; a retried request counts once; a wrong PIN changes nothing', async () => {
  const id = randomUUID();
  const r1 = await earn('0612345001', 12000, id);
  assert.equal(r1.ok, true); assert.equal(r1.points_added, 12);
  const r2 = await earn('0612345001', 12000, id);
  assert.equal(r2.duplicate, true);
  assert.equal(await pts('0612345001'), 12);
  const bad = await earn('0612345001', 5000, randomUUID(), '0000');
  assert.equal(bad.ok, false);
  assert.equal(await pts('0612345001'), 12);
  const found = await rpc(dev, 'loyalty_counter_find', [rid, '0612345001']);
  assert.equal(found.points, 12);
});

test('at most 3 bills per customer per day', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await earn('0612345002', 2000)).ok, true);
  await assert.rejects(earn('0612345002', 2000), /daily_limit/);
});

test('a reward for points goes through the wallet as used; undo needs a manager and gives the points back', async () => {
  await earn('0612345003', 25000);
  const c = await rpc(dev, 'loyalty_counter_find', [rid, '0612345003']);
  const r = await rpc(dev, 'loyalty_counter_redeem', [rid, c.id, 'r30', sara, '1111', randomUUID()]);
  assert.equal(r.ok, true); assert.equal(await pts('0612345003'), 5);
  const [wl] = await sql(`select status from public.loyalty_wallet where id = $1`, [r.wallet_id]);
  assert.equal(wl.status, 'used');
  const asStaff = await rpc(dev, 'loyalty_counter_undo', [rid, r.ledger_id, sara, '1111']);
  assert.equal(asStaff.ok, false);
  const u = await rpc(dev, 'loyalty_counter_undo', [rid, r.ledger_id, karim, '9999']);
  assert.equal(u.ok, true); assert.equal(await pts('0612345003'), 25);
  const [wl2] = await sql(`select status from public.loyalty_wallet where id = $1`, [r.wallet_id]);
  assert.equal(wl2.status, 'cancelled');
});

test('a won reward is used once at the counter and shows on the card until then', async () => {
  await earn('0612345004', 3000);
  const [c] = await sql(`select id, card_key from public.customers where restaurant_id = $1 and phone = '0612345004'`, [rid]);
  const [g] = await sql(`select app.loyalty_wallet_add($1, $2, 'wheel', '{"kind":"item"}', 'Café offert') id`, [rid, c.id]);
  if (c.card_key) {
    const card = await rpc(null, 'customer_card_wallet', [A.r.slug, c.card_key]);
    assert.equal(card.length, 1);
  }
  const u1 = await rpc(dev, 'loyalty_wallet_use', [rid, g.id, sara, '1111']);
  assert.equal(u1.ok, true); assert.equal(u1.label, 'Café offert');
  const u2 = await rpc(dev, 'loyalty_wallet_use', [rid, g.id, sara, '1111']);
  assert.equal(u2.error, 'already_used');
});

test('loyalty off, or another restaurant: refused', async () => {
  await assert.rejects(rpc(w.users.deviceB, 'loyalty_counter_find', [rid, '0612345001']));
  await as(w.users.ownerA, `update public.restaurants set loyalty = loyalty || '{"enabled": false}' where id = $1`, [rid]);
  await assert.rejects(rpc(dev, 'loyalty_counter_find', [rid, '0612345001']), /loyalty_off/);
});
