// Amplify's billing of its customers: only platform admins write; a payment moves the paid date on
// and switches a trial or suspended restaurant to active; owners read their own payments only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, rid;
before(async () => { w = await world(); rid = w.A.r.id; });
after(() => pool.end());

test('billing: agreement, payments, receipts, cancel', async () => {
  await assert.rejects(rpc(w.users.ownerA, 'admin_set_billing', [rid, '2026-10-16', 29900, 'month', 'cash']));
  await assert.rejects(as(w.users.ownerA, `update public.restaurants set paid_until = '2030-01-01' where id = $1`, [rid]));
  await rpc(w.users.admin, 'admin_set_billing', [rid, '2026-10-16', 29900, 'month', 'cash']);
  let [r] = await sql(`select billing_start::text, paid_until, billing_amount_cents::int from public.restaurants where id = $1`, [rid]);
  assert.equal(r.billing_start, '2026-10-16'); assert.equal(r.paid_until, null); assert.equal(r.billing_amount_cents, 29900);
  await sql(`update public.restaurants set status = 'paused' where id = $1`, [rid]);
  const p1 = await rpc(w.users.admin, 'admin_record_payment', [rid, 29900, 'cash', '2026-10-16', 1, null]);
  assert.equal(p1.period_from, '2026-10-16'); assert.equal(p1.period_to, '2026-11-16');
  [r] = await sql(`select status::text, paid_until::text from public.restaurants where id = $1`, [rid]);
  assert.equal(r.status, 'active'); assert.equal(r.paid_until, '2026-11-16');
  const p2 = await rpc(w.users.admin, 'admin_record_payment', [rid, 59800, 'transfer', '2026-11-15', 2, 'deux mois']);
  assert.equal(p2.period_from, '2026-11-16'); assert.equal(p2.period_to, '2027-01-16');
  assert.ok(Number(p2.number) > Number(p1.number));
  // the owner sees his payments, another restaurant does not
  assert.equal((await as(w.users.ownerA, `select count(*)::int n from public.platform_payments where restaurant_id = $1`, [rid]))[0].n, 2);
  assert.equal((await as(w.users.ownerB, `select count(*)::int n from public.platform_payments where restaurant_id = $1`, [rid]))[0].n, 0);
  await assert.rejects(as(w.users.ownerA, `insert into public.platform_payments (restaurant_id, amount_cents, method, paid_on, period_from, period_to) values ($1, 1, 'cash', now(), now(), now() + interval '1 day')`, [rid]));
  // only the latest payment can be cancelled
  await assert.rejects(rpc(w.users.admin, 'admin_cancel_payment', [p1.id]), /invalid_request/);
  await rpc(w.users.admin, 'admin_cancel_payment', [p2.id]);
  [r] = await sql(`select paid_until::text from public.restaurants where id = $1`, [rid]);
  assert.equal(r.paid_until, '2026-11-16');
  await rpc(w.users.admin, 'admin_cancel_payment', [p1.id]);
  [r] = await sql(`select paid_until from public.restaurants where id = $1`, [rid]);
  assert.equal(r.paid_until, null);
});
