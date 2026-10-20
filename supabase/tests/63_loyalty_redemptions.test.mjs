// Loyalty step 3: every reward on a bill is its own record. Several rewards per bill (owner sets the maximum), a free
// dish only for the units that are ordered, any reward can be taken back (points return), and the points also return
// when the bill is cancelled, a manager discount replaces them, the customer changes or the dish leaves the bill.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, A, rid;
before(async () => { w = await world(); A = w.A; rid = A.r.id; });
after(() => pool.end());
const setLoyalty = (obj) => as(w.users.ownerA, `update public.restaurants set loyalty = $2::jsonb where id = $1`, [rid, JSON.stringify(obj)]);
const base = { customers: true, enabled: true, per_dh: 10, reward_points: 100, reward_cents: 5000 };
const JUS = { id: 'jus', kind: 'item', points: 10, item_id: null, label: 'Jus' };
const R30 = { id: 'r30', kind: 'discount', points: 20, cents: 3000 };
const config = (max) => setLoyalty({ ...base, max_per_order: max, rewards: [{ ...JUS, item_id: A.items.jus.id }, R30] });
const PHONE = '0612000222';
const attach = async (o, points, phone = PHONE) => {
  await rpc(w.users.deviceA, 'pos_attach_customer', [o.id, phone, 'Hind Alaoui', null]);
  await sql(`update public.customers set points = $3 where restaurant_id = $1 and phone = $2`, [rid, phone, points]);
};
const pts = async (phone = PHONE) => (await sql(`select points from public.customers where restaurant_id = $1 and phone = $2`, [rid, phone]))[0].points;
const order = async (id) => (await sql(`select * from public.orders where id = $1`, [id]))[0];
const active = (id) => sql(`select * from public.order_rewards where order_id = $1 and released_at is null order by created_at, id`, [id]);
const ledger = (id) => sql(`select * from public.loyalty_ledger where order_id = $1 and reason = 'redeem'`, [id]);
const cancel = (o) => rpc(w.users.deviceA, 'cancel_order', [o.id, 'test', A.staff.karim.id, '9999']);
const d = () => w.users.deviceA;

test('the maximum per bill is checked when saved', async () => {
  const bad = async (v) => await assert.rejects(setLoyalty({ ...base, max_per_order: v }), /invalid rewards/);
  await bad(0); await bad(11); await bad('3'); await bad(2.5); await bad(null);
  await setLoyalty({ ...base, max_per_order: 3 });
});

test('default is one reward per bill: nothing changes until the owner raises it', async () => {
  await setLoyalty({ ...base, rewards: [{ ...JUS, item_id: A.items.jus.id }, R30] });
  const o = await tillOrder(d(), rid, [{ item_id: A.items.tajine.id }, { item_id: A.items.jus.id }]);
  await attach(o, 100);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'jus']);
  await assert.rejects(rpc(d(), 'pos_redeem_reward', [o.id, 'r30']), /max_rewards_reached/);
  await cancel(o);
});

test('two different rewards on one bill: the discount is the sum, each has its record and ledger line', async () => {
  await config(3);
  const o = await tillOrder(d(), rid, [{ item_id: A.items.tajine.id }, { item_id: A.items.jus.id }]);
  await attach(o, 100);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'jus']);
  const res = await rpc(d(), 'pos_redeem_reward', [o.id, 'r30']);
  assert.equal(Number(res.discount_cents), 2000 + 3000);
  assert.equal(res.points, 100 - 10 - 20); assert.equal(await pts(), 70);
  const x = await order(o.id);
  assert.equal(x.discount_kind, 'loyalty'); assert.equal(Number(x.discount_cents), 5000); assert.equal(Number(x.total_cents), 8500 + 2000 - 5000);
  assert.deepEqual((await active(o.id)).map(r => r.reward_id), ['jus', 'r30']);
  assert.equal((await ledger(o.id)).length, 2);
  await cancel(o);
});

test('free units: never more than ordered, and the maximum per bill holds', async () => {
  await config(3);
  const o = await tillOrder(d(), rid, [{ item_id: A.items.tajine.id }, { item_id: A.items.jus.id, qty: 2 }]);
  await attach(o, 100);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'jus']);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'jus']);
  assert.equal(Number((await order(o.id)).discount_cents), 4000);        // both coffees free
  await assert.rejects(rpc(d(), 'pos_redeem_reward', [o.id, 'jus']), /reward_item_all_free/);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'r30']);                   // third reward: the last allowed
  await assert.rejects(rpc(d(), 'pos_redeem_reward', [o.id, 'r30']), /max_rewards_reached/);
  assert.equal(await pts(), 100 - 10 - 10 - 20);
  await cancel(o);
});

test('together the rewards must stay below the bill', async () => {
  await config(3);
  const o = await tillOrder(d(), rid, [{ item_id: A.items.pizza.id }, { item_id: A.items.jus.id }]);   // 6000 + 2000
  await attach(o, 100);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'r30']);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'jus']);                                                // 5000 of 8000
  await assert.rejects(rpc(d(), 'pos_redeem_reward', [o.id, 'r30']), /order_too_small/);            // would be 8000 = free bill
  await cancel(o);
});

test('one reward can be taken back: points return, ledger line goes, discount follows', async () => {
  await config(3);
  const o = await tillOrder(d(), rid, [{ item_id: A.items.tajine.id }, { item_id: A.items.jus.id }]);
  await attach(o, 100);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'jus']);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'r30']);
  const [first] = await active(o.id);                                      // the free dish
  const res = await rpc(d(), 'pos_release_reward', [first.id]);
  assert.equal(Number(res.discount_cents), 3000); assert.equal(res.points, 80); assert.equal(await pts(), 80);
  assert.equal(Number((await order(o.id)).discount_cents), 3000);
  assert.equal((await ledger(o.id)).length, 1);
  assert.equal((await sql(`select released_at from public.order_rewards where id = $1`, [first.id]))[0].released_at !== null, true);
  await assert.rejects(rpc(d(), 'pos_release_reward', [first.id]), /reward_not_found/);   // not twice: no double refund
  assert.equal(await pts(), 80);
  // the last one goes: the bill has no discount at all any more
  const [last] = await active(o.id);
  await rpc(d(), 'pos_release_reward', [last.id]);
  const x = await order(o.id);
  assert.equal(Number(x.discount_cents), 0); assert.equal(x.discount_kind, null); assert.equal(await pts(), 100);
  await cancel(o);
});

test('no taking back once there is a payment, and not on someone else\'s restaurant', async () => {
  await config(3);
  const o = await tillOrder(d(), rid, [{ item_id: A.items.tajine.id }, { item_id: A.items.jus.id }]);
  await attach(o, 100);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'r30']);
  const [rw] = await active(o.id);
  await as(d(), `insert into public.payments (restaurant_id, order_id, method, amount_cents) values ($1, $2, 'cash', 1000)`, [rid, o.id]);
  await assert.rejects(rpc(d(), 'pos_release_reward', [rw.id]), /remove_payments_first/);
  await assert.rejects(rpc(w.users.deviceB, 'pos_release_reward', [rw.id]), /not allowed/);
  await sql(`delete from public.payments where order_id = $1`, [o.id]);
  await cancel(o);
});

test('cancelling the bill gives all the points back', async () => {
  await config(3);
  const o = await tillOrder(d(), rid, [{ item_id: A.items.tajine.id }, { item_id: A.items.jus.id }]);
  await attach(o, 100);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'jus']);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'r30']);
  assert.equal(await pts(), 70);
  await cancel(o);
  assert.equal(await pts(), 100);
  assert.equal((await active(o.id)).length, 0);
  assert.equal((await ledger(o.id)).length, 0);
});

test('a manager discount replaces the rewards and the points come back', async () => {
  await config(3);
  const o = await tillOrder(d(), rid, [{ item_id: A.items.tajine.id }, { item_id: A.items.jus.id }]);
  await attach(o, 100);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'r30']);
  assert.equal(await pts(), 80);
  await rpc(d(), 'apply_discount', [o.id, 1000, A.staff.karim.id, '9999']);
  const x = await order(o.id);
  assert.equal(Number(x.discount_cents), 1000); assert.equal(x.discount_kind, null);
  assert.equal(await pts(), 100); assert.equal((await active(o.id)).length, 0);
  await assert.rejects(rpc(d(), 'pos_redeem_reward', [o.id, 'r30']), /remove_discount_first/);   // and they still exclude each other
  await cancel(o);
});

test('changing the customer gives the points back to the first one', async () => {
  await config(3);
  const o = await tillOrder(d(), rid, [{ item_id: A.items.tajine.id }, { item_id: A.items.jus.id }]);
  await attach(o, 100);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'r30']);
  await rpc(d(), 'pos_attach_customer', [o.id, '0612000333', 'Someone Else', null]);
  assert.equal(await pts(), 100);
  const x = await order(o.id);
  assert.equal(Number(x.discount_cents), 0); assert.equal(x.discount_kind, null);
  await cancel(o);
});

test('a free dish that leaves the bill goes back', async () => {
  await config(3);
  const o = await tillOrder(d(), rid, [{ item_id: A.items.tajine.id }, { item_id: A.items.jus.id }]);
  await attach(o, 100);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'jus']);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'r30']);
  assert.equal(await pts(), 70);
  await as(d(), `delete from public.order_lines where order_id = $1 and menu_item_id = $2`, [o.id, A.items.jus.id]);
  assert.deepEqual((await active(o.id)).map(r => r.reward_id), ['r30']);          // the free dish went, the money reward stays
  assert.equal(await pts(), 80);
  const x = await order(o.id);
  assert.equal(Number(x.discount_cents), 3000); assert.equal(Number(x.total_cents), 8500 - 3000);
  await cancel(o);
});

test('when the bill shrinks below the rewards, the newest rewards go back until they fit', async () => {
  await config(3);
  const o = await tillOrder(d(), rid, [{ item_id: A.items.pizza.id }, { item_id: A.items.jus.id }]);   // 6000 + 2000
  await attach(o, 100);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'jus']);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'r30']);                                                // 5000 of 8000
  assert.equal(await pts(), 70);
  await as(d(), `delete from public.order_lines where order_id = $1 and menu_item_id = $2`, [o.id, A.items.pizza.id]);   // bill is now 2000
  const x = await order(o.id);
  assert.equal(Number(x.discount_cents), 0); assert.equal(x.discount_kind, null);
  assert.equal(await pts(), 100); assert.equal((await active(o.id)).length, 0);
  await cancel(o);
});

test('a paid bill keeps its rewards: frozen, and it still earns points on what is paid', async () => {
  await config(3);
  const o = await tillOrder(d(), rid, [{ item_id: A.items.tajine.id }, { item_id: A.items.jus.id }]);
  await attach(o, 100);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'jus']);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'r30']);
  const x = await order(o.id);
  await as(d(), `insert into public.payments (restaurant_id, order_id, method, amount_cents) values ($1, $2, 'cash', $3)`, [rid, o.id, x.total_cents]);
  await rpc(d(), 'close_order', [o.id, null, null]);
  const [rw] = await active(o.id);
  await assert.rejects(rpc(d(), 'pos_release_reward', [rw.id]), /order_not_open/);
  assert.equal((await active(o.id)).length, 2);
  const closed = await order(o.id);
  assert.equal(Number(closed.discount_cents), 5000);
  assert.equal(await pts(), 70 + Math.floor(Number(x.total_cents) / 100 / 10));   // spent 30, earned on the paid amount
});

test('the card lists the rewards used and not the taken-back ones', async () => {
  await config(3);
  const [c] = await sql(`select card_key from public.customers where restaurant_id = $1 and phone = $2`, [rid, PHONE]);
  const o = await tillOrder(d(), rid, [{ item_id: A.items.tajine.id }, { item_id: A.items.jus.id }]);
  await attach(o, 100);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'jus']);
  const [rw] = await active(o.id);
  await rpc(d(), 'pos_release_reward', [rw.id]);
  const card = await rpc(null, 'customer_card', [A.r.slug, c.card_key]);
  assert.equal(card.recent.filter(m => m.reason === 'redeem' && m.name === 'Jus').length, 1, 'only the paid bill from before');
  await cancel(o);
});
