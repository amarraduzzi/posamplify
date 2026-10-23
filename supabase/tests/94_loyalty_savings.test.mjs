// Loyalty as savings: 1 point = 1 DH, the owner picks a percentage, the customer pays with his savings
// (everything up to his savings is free, a dearer dish is paid partly), from a minimum on.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, A, rid;
before(async () => { w = await world(); A = w.A; rid = A.r.id; });
after(() => pool.end());
const setLoyalty = (obj) => as(w.users.ownerA, `update public.restaurants set loyalty = $2::jsonb where id = $1`, [rid, JSON.stringify(obj)]);
const lo = async () => (await sql(`select loyalty from public.restaurants where id = $1`, [rid]))[0].loyalty;
const PHONE = '0612000333';
const d = () => w.users.deviceA;
const attach = async (o, points) => {
  await rpc(d(), 'pos_attach_customer', [o.id, PHONE, 'Salma', null]);
  await sql(`update public.customers set points = $3 where restaurant_id = $1 and phone = $2`, [rid, PHONE, points]);
};
const pts = async () => (await sql(`select points from public.customers where restaurant_id = $1 and phone = $2`, [rid, PHONE]))[0].points;
const cancel = (o) => rpc(d(), 'cancel_order', [o.id, 'test', A.staff.karim.id, '9999']);

test('the percentage sets the earning rule; bad values are refused', async () => {
  await setLoyalty({ customers: true, enabled: true, mode: 'value', percent: 5, min_points: 20 });
  assert.equal((await lo()).per_dh, 20);
  await setLoyalty({ customers: true, enabled: true, mode: 'value', percent: 10 });
  assert.equal((await lo()).per_dh, 10);
  assert.equal((await lo()).min_points, 0);
  await assert.rejects(setLoyalty({ customers: true, enabled: true, mode: 'value', percent: 0 }), /invalid percent/);
  await assert.rejects(setLoyalty({ customers: true, enabled: true, mode: 'value', percent: 50 }), /invalid percent/);
  await assert.rejects(setLoyalty({ customers: true, enabled: true, mode: 'other' }), /invalid loyalty mode/);
});

test('savings pay part of a dearer bill, or all of a small one; the minimum holds', async () => {
  await setLoyalty({ customers: true, enabled: true, mode: 'value', percent: 5, min_points: 20 });
  const o = await tillOrder(d(), rid, [{ item_id: A.items.tajine.id }]);   // 85 DH
  await attach(o, 15);
  await assert.rejects(rpc(d(), 'pos_redeem_value', [o.id, null]), /not_enough_points/);
  await sql(`update public.customers set points = 25 where restaurant_id = $1 and phone = $2`, [rid, PHONE]);
  const res = await rpc(d(), 'pos_redeem_value', [o.id, null]);
  assert.equal(Number(res.cents), 2500);
  assert.equal(Number(res.total_cents), 6000);
  assert.equal(await pts(), 0);
  await assert.rejects(rpc(d(), 'pos_redeem_value', [o.id, null]), /already_used|not_enough/);
  // a mistake: taken back, the savings return
  const [x] = await sql(`select id from public.order_rewards where order_id = $1 and released_at is null`, [o.id]);
  await rpc(d(), 'pos_release_reward', [x.id]);
  assert.equal(await pts(), 25);
  await cancel(o);

  const s = await tillOrder(d(), rid, [{ item_id: A.items.jus.id }]);      // 20 DH, less than the savings
  await attach(s, 100);
  const r2 = await rpc(d(), 'pos_redeem_value', [s.id, null]);
  assert.equal(Number(r2.cents), 2000);
  assert.equal(Number(r2.total_cents), 0);
  assert.equal(await pts(), 80);
  await cancel(s);
  assert.equal(await pts(), 100, 'a cancelled bill gives the savings back');
});

test('only in savings mode; the card shows what the savings buy', async () => {
  await setLoyalty({ customers: true, enabled: true, per_dh: 10, reward_points: 100, reward_cents: 5000 });
  const o = await tillOrder(d(), rid, [{ item_id: A.items.jus.id }]);
  await attach(o, 100);
  await assert.rejects(rpc(d(), 'pos_redeem_value', [o.id, null]), /not_value_mode/);
  await cancel(o);
  await setLoyalty({ customers: true, enabled: true, mode: 'value', percent: 5 });
  await sql(`update public.customers set points = 25, card_key = 'k-savings-test-0001' where restaurant_id = $1 and phone = $2`, [rid, PHONE]);
  const card = (await sql(`select public.customer_card($1, 'k-savings-test-0001') c`, [A.r.slug]))[0].c;
  assert.equal(card.loyalty.mode, 'value');
  assert.ok(card.loyalty.menu.length > 0);
  assert.ok(card.loyalty.menu.every(m => Number(m.price_cents) <= 2500));
  assert.ok(card.loyalty.next.every(m => Number(m.price_cents) > 2500));
});
