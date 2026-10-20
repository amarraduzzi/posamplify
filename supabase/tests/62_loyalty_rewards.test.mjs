// Loyalty step 2: several rewards. A list of rewards (free dish or money off), checked when saved; a free dish
// is the price of one unit that is on the open order; the old single reward keeps working with no list;
// the customer's card shows the list with the names of the dishes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, A, rid;
before(async () => { w = await world(); A = w.A; rid = A.r.id; });
after(() => pool.end());
const setLoyalty = (obj) => as(w.users.ownerA, `update public.restaurants set loyalty = $2::jsonb where id = $1`, [rid, JSON.stringify(obj)]);
const base = { customers: true, enabled: true, per_dh: 10, reward_points: 100, reward_cents: 5000 };
const withRewards = (rewards) => ({ ...base, rewards });
const JUS = () => ({ id: 'jus', kind: 'item', points: 10, item_id: A.items.jus.id, label: 'Jus' });
const R30 = { id: 'r30', kind: 'discount', points: 20, cents: 3000 };
const attach = async (o, points) => {
  await rpc(w.users.deviceA, 'pos_attach_customer', [o.id, '0612000111', 'Salma Benani', null]);
  await sql(`update public.customers set points = $2 where restaurant_id = $1 and phone = '0612000111'`, [rid, points]);
};
const points = async () => (await sql(`select points from public.customers where restaurant_id = $1 and phone = '0612000111'`, [rid]))[0].points;

test('the list is checked when it is saved', async () => {
  const bad = async (rewards) => await assert.rejects(setLoyalty(withRewards(rewards)), /invalid reward/);
  await bad([{ id: 'x', kind: 'gift', points: 10 }]);
  await bad([{ id: 'x', kind: 'discount', points: 0, cents: 100 }]);
  await bad([{ id: 'x', kind: 'discount', points: 10 }]);
  await bad([{ id: 'x', kind: 'item', points: 10, item_id: '00000000-0000-0000-0000-000000000000' }]);
  await bad([{ id: 'x', kind: 'item', points: 10, item_id: w.B.items.jus.id }]);   // a dish of another restaurant
  await bad([R30, { ...R30 }]);                                                       // the same id twice
  await bad([{ ...R30, id: 'Bad Id!' }]);
  await assert.rejects(setLoyalty(withRewards(Array.from({ length: 9 }, (_, i) => ({ ...R30, id: `r${i}` })))), /invalid reward/);
  await setLoyalty(withRewards([JUS(), R30]));
});

test('a free dish: the guest must be ordering it, then it costs one unit and the points', async () => {
  const d = w.users.deviceA;
  const o = await tillOrder(d, rid, [{ item_id: A.items.tajine.id }]);
  await attach(o, 50);
  await assert.rejects(rpc(d, 'pos_redeem_reward', [o.id, 'jus']), /reward_item_not_in_order/);
  await as(d, `insert into public.order_lines (restaurant_id, order_id, menu_item_id, name, unit_price_cents, quantity, vat_bp) values ($1, $2, $3, 'Jus', 2000, 2, 2000)`, [rid, o.id, A.items.jus.id]);
  const res = await rpc(d, 'pos_redeem_reward', [o.id, 'jus']);
  assert.equal(Number(res.discount_cents), 2000);                    // one unit, not both
  assert.equal(res.points, 40); assert.equal(await points(), 40);
  const x = (await sql(`select * from public.orders where id = $1`, [o.id]))[0];
  assert.equal(x.discount_kind, 'loyalty'); assert.equal(Number(x.discount_cents), 2000);
  const [l] = await sql(`select * from public.loyalty_ledger where order_id = $1 and reason = 'redeem'`, [o.id]);
  assert.equal(l.points, -10); assert.equal(l.reward_name, 'Jus');
  await assert.rejects(rpc(d, 'pos_redeem_reward', [o.id, 'r30']), /max_rewards_reached/);   // one reward per order, unless the owner raises the maximum
  await rpc(d, 'cancel_order', [o.id, 'test', A.staff.karim.id, '9999']);
});

test('not enough points, unknown reward, and a reward bigger than the bill', async () => {
  const d = w.users.deviceA;
  const o = await tillOrder(d, rid, [{ item_id: A.items.tajine.id }, { item_id: A.items.jus.id }]);
  await attach(o, 5);
  await assert.rejects(rpc(d, 'pos_redeem_reward', [o.id, 'jus']), /not_enough_points/);
  await assert.rejects(rpc(d, 'pos_redeem_reward', [o.id, 'nope']), /reward_not_found/);
  await rpc(d, 'cancel_order', [o.id, 'test', A.staff.karim.id, '9999']);
  const small = await tillOrder(d, rid, [{ item_id: A.items.jus.id }]);
  await attach(small, 50);
  await assert.rejects(rpc(d, 'pos_redeem_reward', [small.id, 'r30']), /order_too_small/);   // a reward of more than the bill
  await rpc(d, 'cancel_order', [small.id, 'test', A.staff.karim.id, '9999']);
});

test('a money reward still works, and the old till call uses the first money reward', async () => {
  const d = w.users.deviceA;
  const o = await tillOrder(d, rid, [{ item_id: A.items.tajine.id }, { item_id: A.items.pizza.id }]);
  await attach(o, 25);
  const res = await rpc(d, 'pos_redeem_points', [o.id]);
  assert.equal(Number(res.discount_cents), 3000); assert.equal(res.points, 5);
  await rpc(d, 'cancel_order', [o.id, 'test', A.staff.karim.id, '9999']);
});

test('without a list the single reward of before is the only one', async () => {
  await setLoyalty(base);
  const d = w.users.deviceA;
  const o = await tillOrder(d, rid, [{ item_id: A.items.tajine.id }, { item_id: A.items.pizza.id }]);
  await attach(o, 100);
  assert.equal(Number((await rpc(d, 'pos_redeem_reward', [o.id, 'legacy'])).discount_cents), 5000);
  await rpc(d, 'cancel_order', [o.id, 'test', A.staff.karim.id, '9999']);
});

test('the card lists the rewards with the dish names, and the last reward used by name', async () => {
  await setLoyalty(withRewards([R30, JUS()]));
  const [c] = await sql(`select card_key from public.customers where restaurant_id = $1 and phone = '0612000111'`, [rid]);
  const d = w.users.deviceA;
  const o = await tillOrder(d, rid, [{ item_id: A.items.tajine.id }, { item_id: A.items.jus.id }]);
  await attach(o, 30);
  await rpc(d, 'pos_redeem_reward', [o.id, 'jus']);
  const card = await rpc(null, 'customer_card', [A.r.slug, c.card_key]);
  assert.deepEqual(card.loyalty.rewards.map(x => x.id), ['jus', 'r30']);         // by points
  assert.equal(card.loyalty.rewards[0].name.fr, 'Jus'); assert.equal(card.loyalty.rewards[0].name.en, 'Jus EN');
  assert.equal(card.loyalty.rewards[1].name, null); assert.equal(Number(card.loyalty.rewards[1].cents), 3000);
  assert.equal(card.recent.find(m => m.reason === 'redeem').name, 'Jus');
  assert.ok(!JSON.stringify(card).includes(A.items.jus.id), 'no internal ids besides the reward ids');
  await rpc(d, 'cancel_order', [o.id, 'test', A.staff.karim.id, '9999']);
});
