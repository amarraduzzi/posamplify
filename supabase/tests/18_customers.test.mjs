// Customer file and loyalty points: off by default, then by phone number,
// points on paid orders, a reward as discount, private to managers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder, guestOrder } from './helpers.mjs';

let w, A;
before(async () => { w = await world(); A = w.A; });
after(() => pool.end());
const pay = (o) => rpc(w.users.deviceA, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: Number(o.total_cents) }]), null, null]);
const fresh = async (id) => (await sql(`select * from public.orders where id = $1`, [id]))[0];

test('off by default: nothing is kept', async () => {
  const d = w.users.deviceA, rid = A.r.id;
  await rpc(null, 'place_order', [A.r.slug, JSON.stringify(guestOrder(null, [{ item_id: A.items.jus.id, quantity: 1 }],
    { order_type: 'takeaway', customer: { name: 'Leila', phone: '0612345678' } }))]);
  assert.equal((await sql(`select count(*)::int n from public.customers where restaurant_id = $1`, [rid]))[0].n, 0);
  const o = await tillOrder(d, rid, [{ item_id: A.items.jus.id }]);
  await assert.rejects(rpc(d, 'pos_attach_customer', [o.id, '0612345678', 'Leila', true]), /customers_off/);
  await assert.rejects(rpc(d, 'pos_find_customer', [rid, '0612345678']), /customers_off/);
  await rpc(d, 'cancel_order', [o.id, 'test', A.staff.karim.id, '9999']);
});

test('switched on: by phone, points on paid orders, reward as discount', async () => {
  const d = w.users.deviceA, rid = A.r.id;
  await as(w.users.ownerA, `update public.restaurants set loyalty = '{"customers": true, "enabled": true, "per_dh": 10, "reward_points": 20, "reward_cents": 3000}' where id = $1`, [rid]);
  // a QR take-away order with a phone joins the file (+212 format becomes 06...)
  await rpc(null, 'place_order', [A.r.slug, JSON.stringify(guestOrder(null, [{ item_id: A.items.jus.id, quantity: 1 }],
    { order_type: 'takeaway', customer: { name: 'Leila', phone: '+212 612-345-678' } }))]);
  const [c] = await sql(`select * from public.customers where restaurant_id = $1`, [rid]);
  assert.equal(c.phone, '0612345678');
  assert.equal(c.name, 'Leila');
  // at the till: 2 tajines (170 DH) -> 17 points
  let o = await tillOrder(d, rid, [{ item_id: A.items.tajine.id, qty: 2 }]);
  const found = await rpc(d, 'pos_attach_customer', [o.id, '06 12 34 56 78', null, true]);
  assert.equal(found.id, c.id);
  await pay(await fresh(o.id));
  let [cc] = await sql(`select points, visits, spent_cents, marketing_ok from public.customers where id = $1`, [c.id]);
  assert.deepEqual([cc.points, cc.visits, Number(cc.spent_cents), cc.marketing_ok], [17, 1, 17000, true]);
  // not enough for the reward yet
  o = await tillOrder(d, rid, [{ item_id: A.items.tajine.id }]);
  await rpc(d, 'pos_attach_customer', [o.id, '0612345678', null, null]);
  await assert.rejects(rpc(d, 'pos_redeem_points', [o.id]), /not_enough_points/);
  await pay(await fresh(o.id)); // +8 -> 25
  // the reward: 20 points = 30 DH off
  o = await tillOrder(d, rid, [{ item_id: A.items.tajine.id }]);
  await rpc(d, 'pos_attach_customer', [o.id, '0612345678', null, null]);
  const red = await rpc(d, 'pos_redeem_points', [o.id]);
  assert.equal(Number(red.discount_cents), 3000);
  assert.equal(red.points, 5);
  o = await fresh(o.id);
  assert.equal(o.discount_kind, 'loyalty');
  await pay(o); // 55 DH -> +5
  [cc] = await sql(`select points, visits from public.customers where id = $1`, [c.id]);
  assert.deepEqual([cc.points, cc.visits], [10, 3]);
  const ledger = await sql(`select reason, points from public.loyalty_ledger where customer_id = $1 order by id`, [c.id]);
  assert.deepEqual(ledger.map(x => [x.reason, x.points]), [['earn', 17], ['earn', 8], ['redeem', -20], ['earn', 5]]);
  // the team report does not count the reward as a staff discount
  const day = (await rpc(d, 'day_report', [rid, null])).business_date;
  const team = await rpc(w.users.managerA, 'staff_report', [rid, day, day]);
  assert.equal(team.people.reduce((s, p) => s + Number(p.discount_cents), 0), 0);
});

test('customer data is for managers only; the till only looks one up', async () => {
  assert.equal((await as(w.users.deviceA, `select * from public.customers`)).length, 0);
  assert.ok((await as(w.users.managerA, `select * from public.customers`)).length >= 1);
  const c = await rpc(w.users.deviceA, 'pos_find_customer', [A.r.id, '0612345678']);
  assert.equal(c.name, 'Leila');
  await assert.rejects(rpc(w.users.deviceB, 'pos_find_customer', [A.r.id, '0612345678']), /not allowed/);
  // a manual correction by the manager is logged as 'adjust'
  await as(w.users.managerA, `update public.customers set points = 50 where id = $1`, [c.id]);
  const [last] = await sql(`select reason, points from public.loyalty_ledger where customer_id = $1 order by id desc limit 1`, [c.id]);
  assert.deepEqual([last.reason, last.points], ['adjust', 40]);
  // a reward on an order worth less than the reward is refused (a 0 DH ticket cannot be paid)
  const small = await tillOrder(w.users.deviceA, A.r.id, [{ item_id: A.items.jus.id }]);
  await rpc(w.users.deviceA, 'pos_attach_customer', [small.id, '0612345678', null, null]);
  await assert.rejects(rpc(w.users.deviceA, 'pos_redeem_points', [small.id]), /order_too_small/);
  // the till cannot link a customer by writing the column itself
  await assert.rejects(as(w.users.deviceA, `update public.orders set customer_id = null where id = $1`, [small.id]), /only be set by the till/);
  await rpc(w.users.deviceA, 'cancel_order', [small.id, 'test', A.staff.karim.id, '9999']);
  // right to be forgotten: the customer goes, the paid tickets stay untouched
  await as(w.users.managerA, `delete from public.customers where id = $1`, [c.id]);
  assert.equal((await sql(`select count(*)::int n from public.customers where id = $1`, [c.id]))[0].n, 0);
  assert.equal((await sql(`select count(*)::int n from public.loyalty_ledger where customer_id = $1`, [c.id]))[0].n, 0);
  assert.ok((await sql(`select count(*)::int n from public.orders where customer_id = $1 and closed_at is not null`, [c.id]))[0].n >= 3);
});
