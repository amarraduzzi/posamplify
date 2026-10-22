// Loyalty step 4: a bill of 0 DH. A reward (or an approved discount) covers everything; the bill closes with no payment,
// still gets its fiscal number and place in the hash chain, and cannot be forgotten at the Z.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, A, rid;
before(async () => { w = await world(); A = w.A; rid = A.r.id; });
after(() => pool.end());
const d = () => w.users.deviceA;
const PHONE = '0612000444';
const JUS = { id: 'jus', kind: 'item', points: 10, label: 'Jus' };
const config = () => as(w.users.ownerA, `update public.restaurants set loyalty = $2::jsonb where id = $1`,
  [rid, JSON.stringify({ customers: true, enabled: true, per_dh: 10, reward_points: 100, reward_cents: 5000, max_per_order: 3, rewards: [{ ...JUS, item_id: A.items.jus.id }] })]);
const attach = async (o, points) => {
  await rpc(d(), 'pos_attach_customer', [o.id, PHONE, 'Nadia Tazi', null]);
  await sql(`update public.customers set points = $3, visits = 0, spent_cents = 0 where restaurant_id = $1 and phone = $2`, [rid, PHONE, points]);
};
const cust = async () => (await sql(`select * from public.customers where restaurant_id = $1 and phone = $2`, [rid, PHONE]))[0];

test('a free dish covers the whole bill: closed at 0 DH with no payment', async () => {
  await config();
  const o = await tillOrder(d(), rid, [{ item_id: A.items.jus.id }]);
  await attach(o, 50);
  const res = await rpc(d(), 'pos_redeem_reward', [o.id, 'jus']);
  assert.equal(Number(res.total_cents), 0);
  const doc = await rpc(d(), 'pos_pay_order', [o.id, '[]', null, null]);
  assert.equal(Number(doc.total_ttc_cents), 0); assert.equal(Number(doc.total_ht_cents), 0); assert.equal(Number(doc.total_vat_cents), 0);
  assert.equal(Number(doc.discount_cents), 2000); assert.deepEqual(doc.payments, []);
  assert.match(doc.doc_number, /^T-\d{4}-\d{6}$/);
  assert.equal((await sql(`select count(*)::int n from public.payments where order_id = $1`, [o.id]))[0].n, 0);
  assert.equal((await sql(`select closed_at is not null c from public.orders where id = $1`, [o.id]))[0].c, true);
  assert.deepEqual(await rpc(w.users.ownerA, 'verify_fiscal_chain', [rid]), { ok: true, checked: (await sql(`select count(*)::int n from public.fiscal_documents where restaurant_id = $1`, [rid]))[0].n });
  const c = await cust();
  assert.equal(c.points, 40); assert.equal(c.visits, 1); assert.equal(Number(c.spent_cents), 0);   // 10 spent, 0 earned, the visit counts
  const rep = await rpc(d(), 'day_report', [rid, null]);
  assert.ok(Number(rep.discounts_cents) >= 2000);
  // the ticket can be credited like any other
  const cn = await rpc(d(), 'issue_credit_note', [doc.id, 'test', A.staff.karim.id, '9999']);
  assert.ok(cn);
});

test('an empty payment list is only accepted for a bill of 0 DH, and a payment of 0 never', async () => {
  const o = await tillOrder(d(), rid, [{ item_id: A.items.tajine.id }]);
  await assert.rejects(rpc(d(), 'pos_pay_order', [o.id, '[]', null, null]), /invalid_request/);
  await assert.rejects(rpc(d(), 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: 0, tip_cents: 0 }]), null, null]), /invalid_request/);
  await rpc(d(), 'cancel_order', [o.id, 'test', A.staff.karim.id, '9999']);
});

test('a manager discount of 100% closes the same way', async () => {
  const o = await tillOrder(d(), rid, [{ item_id: A.items.tajine.id }]);
  await rpc(d(), 'apply_discount', [o.id, Number(o.subtotal_cents), A.staff.karim.id, '9999']);
  const doc = await rpc(d(), 'pos_pay_order', [o.id, '[]', null, null]);
  assert.equal(Number(doc.total_ttc_cents), 0); assert.equal(Number(doc.discount_cents), 8500);
});

test('the Z cannot forget an open bill of 0 DH, but an empty open bill does not block it', async () => {
  // the business day ends at midnight here, so the test works at any hour
  await sql(`update public.restaurants set day_cutoff_hour = 0 where id = $1`, [rid]);
  const empty = await tillOrder(d(), rid, []);
  const o = await tillOrder(d(), rid, [{ item_id: A.items.jus.id }]);
  await rpc(d(), 'apply_discount', [o.id, Number(o.subtotal_cents), A.staff.karim.id, '9999']);
  assert.equal(Number((await rpc(d(), 'day_report', [rid, null])).open_orders) >= 1, true);
  const day = (await sql(`select current_date::text d`))[0].d;
  await assert.rejects(rpc(d(), 'close_day', [rid, day, A.staff.karim.id, '9999']), /open_orders/);
  await rpc(d(), 'cancel_order', [o.id, 'test', A.staff.karim.id, '9999']);
  await rpc(d(), 'cancel_order', [empty.id, 'test', A.staff.karim.id, '9999']);
});

test('rewards cannot make a bill pay less than nothing, with or without a list of payments', async () => {
  await config();
  const o = await tillOrder(d(), rid, [{ item_id: A.items.jus.id }, { item_id: A.items.tajine.id }]);
  await attach(o, 50);
  await rpc(d(), 'pos_redeem_reward', [o.id, 'jus']);          // 8500 left to pay
  await assert.rejects(rpc(d(), 'pos_pay_order', [o.id, '[]', null, null]), /invalid_request/);
  const x = (await sql(`select total_cents from public.orders where id = $1`, [o.id]))[0];
  const doc = await rpc(d(), 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: Number(x.total_cents), tip_cents: 0 }]), null, null]);
  assert.equal(Number(doc.total_ttc_cents), 8500);
});
