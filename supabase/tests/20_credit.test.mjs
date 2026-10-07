// Customer credit ("ardoise"): put a paid ticket on a customer's account, within a
// limit; settle later; credit notes lower the balance; the drawer expects cash settlements.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, A, cid;
before(async () => {
  w = await world(); A = w.A;
  await as(w.users.ownerA, `update public.restaurants set loyalty = '{"customers": true}' where id = $1`, [A.r.id]);
});
after(() => pool.end());
const fresh = async (id) => (await sql(`select * from public.orders where id = $1`, [id]))[0];
const onAccount = (o, extra = []) => rpc(w.users.deviceA, 'pos_pay_order',
  [o.id, JSON.stringify([{ method: 'account', amount_cents: Number(o.total_cents) - extra.reduce((s, x) => s + x.amount_cents, 0) }, ...extra]), null, null]);
const order = async (qty = 1) => {
  const o = await tillOrder(w.users.deviceA, A.r.id, [{ item_id: A.items.tajine.id, qty }]);
  await rpc(w.users.deviceA, 'pos_attach_customer', [o.id, '0661000001', 'Hamid', null]);
  return fresh(o.id);
};
const balance = async () => Number((await sql(`select balance_cents from public.customers where id = $1`, [cid]))[0].balance_cents);

test('refused unless the restaurant and the customer allow it, and within the limit', async () => {
  let o = await order();
  cid = o.customer_id;
  await assert.rejects(onAccount(o), /credit_off/);
  await as(w.users.ownerA, `update public.restaurants set loyalty = '{"customers": true, "credit": true}' where id = $1`, [A.r.id]);
  await assert.rejects(onAccount(o), /credit_not_allowed/);
  // the till does not see the ardoise when off, it does when on
  const card = await rpc(w.users.deviceA, 'pos_order_customer', [o.id]);
  assert.equal(card.credit_allowed, false);
  // the manager allows Hamid up to 200 DH
  await as(w.users.managerA, `update public.customers set credit_allowed = true, credit_limit_cents = 20000 where id = $1`, [cid]);
  // the manager cannot write the balance itself, nor create a customer with one
  await assert.rejects(as(w.users.managerA, `update public.customers set balance_cents = 0 - 5000 where id = $1`, [cid]), /only change through the till/);
  const [x] = await as(w.users.managerA, `insert into public.customers (restaurant_id, phone, balance_cents) values ($1, '0661999999', 9999) returning balance_cents`, [A.r.id]);
  assert.equal(Number(x.balance_cents), 0);
  // a tip cannot go on the ardoise
  await assert.rejects(rpc(w.users.deviceA, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'account', amount_cents: Number(o.total_cents), tip_cents: 500 }]), null, null]), /invalid_request/);
  const doc = await onAccount(o);
  assert.equal(doc.payments[0].method, 'account');
  assert.equal(await balance(), Number(o.total_cents));
  // 2 more tajines would pass 200 DH
  o = await order(2);
  await assert.rejects(onAccount(o), /credit_limit/);
  // half on the ardoise, the rest in cash is fine if it fits
  const part = Number(o.total_cents) - 10000;
  await onAccount(o, [{ method: 'cash', amount_cents: part }]);
  assert.equal(await balance(), 8500 + 10000);
  // an order without customer cannot go on an ardoise
  const anon = await tillOrder(w.users.deviceA, A.r.id, [{ item_id: A.items.jus.id }]);
  await assert.rejects(onAccount(await fresh(anon.id)), /no_customer/);
  await rpc(w.users.deviceA, 'cancel_order', [anon.id, 'test', A.staff.karim.id, '9999']);
});

test('settling, credit notes, the drawer and the statement', async () => {
  const d = w.users.deviceA, rid = A.r.id;
  const before = await rpc(d, 'day_report', [rid, null]);
  // cannot pay back more than owed
  await assert.rejects(rpc(d, 'pos_account_payment', [rid, cid, 999999, 'cash', null]), /more_than_balance/);
  await assert.rejects(rpc(d, 'pos_account_payment', [rid, cid, 1000, 'other', null]), /invalid_request/);
  const res = await rpc(d, 'pos_account_payment', [rid, cid, 5000, 'cash', A.staff.karim.id]);
  assert.equal(Number(res.balance_cents), 13500);
  await rpc(d, 'pos_account_payment', [rid, cid, 3500, 'card', null]);
  assert.equal(await balance(), 10000);
  // the day: ardoise sales are revenue, settlements are not; cash settlements are expected in the drawer
  const day = await rpc(d, 'day_report', [rid, null]);
  assert.equal(Number(day.account_sales_cents), 18500);
  assert.equal(Number(day.account_received.cash), 5000);
  assert.equal(Number(day.account_received_cents), 8500);
  assert.equal(Number(day.expected_cash_cents) - Number(before.expected_cash_cents), 5000);
  assert.equal(Number(day.payments.account), 18500);
  // a credit note on an ardoise ticket lowers the balance
  const [first] = await sql(`select id, doc_number from public.fiscal_documents where restaurant_id = $1 and payments @> '[{"method":"account"}]' order by chain_index limit 1`, [rid]);
  await rpc(d, 'issue_credit_note', [first.id, 'erreur', A.staff.karim.id, '9999']);
  assert.equal(await balance(), 1500);
  // a customer with an open balance cannot be deleted
  await assert.rejects(as(w.users.managerA, `delete from public.customers where id = $1`, [cid]), /open balance/);
  // the manager corrects by hand, with a reason
  await assert.rejects(rpc(w.users.managerA, 'customer_account_adjust', [cid, -1500, '']), /reason_required/);
  await assert.rejects(rpc(d, 'customer_account_adjust', [cid, -1500, 'geste']), /not allowed/);
  await rpc(w.users.managerA, 'customer_account_adjust', [cid, -1500, 'geste commercial']);
  assert.equal(await balance(), 0);
  // the statement of the month
  const today = day.business_date;
  const st = await rpc(w.users.managerA, 'customer_statement', [cid, today.slice(0, 8) + '01', today]);
  assert.equal(Number(st.opening_cents), 0);
  assert.equal(Number(st.closing_cents), 0);
  assert.deepEqual(st.lines.map(l => [l.kind, Number(l.amount_cents)]),
    [['sale', 8500], ['sale', 10000], ['payment', -5000], ['payment', -3500], ['refund', -8500], ['adjust', -1500]]);
  assert.equal(st.lines[0].doc_number, first.doc_number);
  assert.equal(Number(st.debits_cents), 18500);
  // private: the till and the other restaurant see no ledger, B cannot settle A's customer
  assert.equal((await as(d, `select * from public.customer_account_ledger`)).length, 0);
  await assert.rejects(rpc(w.users.deviceB, 'pos_account_payment', [rid, cid, 100, 'cash', null]), /not allowed/);
  await assert.rejects(rpc(d, 'customer_statement', [cid, today, today]), /not allowed/);
  // now it can be forgotten
  await as(w.users.managerA, `delete from public.customers where id = $1`, [cid]);
});
