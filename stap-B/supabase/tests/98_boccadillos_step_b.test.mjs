// Boccadillos mode, step B: name required, unpaid QR orders expire, a paid order is refunded through cancel_order.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, uuid } from './helpers.mjs';

let w, rid, dev;
before(async () => { w = await world(); rid = w.A.r.id; dev = w.users.deviceA; });
after(() => pool.end());

const setMode = on => sql(`update public.restaurants set boccadillos = $2 where id = $1`, [rid, on]);
async function qrOrder(name = 'Test', price = 4500) {
  const [o] = await sql(
    `insert into public.orders (restaurant_id, client_id, business_date, ticket_number, source, order_type, customer_name)
     values ($1, $2, current_date, 0, 'qr', 'takeaway', $3) returning *`, [rid, uuid(), name]);
  await sql(`insert into public.order_lines (restaurant_id, order_id, name, unit_price_cents, quantity, vat_bp)
             values ($1, $2, 'Boccadillo', $3, 1, 1000)`, [rid, o.id, price]);
  return o;
}

test('name is required for QR orders only when the mode is on', async () => {
  await setMode(false);
  await sql(`insert into public.orders (restaurant_id, client_id, business_date, ticket_number, source, order_type)
             values ($1, $2, current_date, 0, 'qr', 'takeaway')`, [rid, uuid()]);
  await setMode(true);
  await assert.rejects(sql(`insert into public.orders (restaurant_id, client_id, business_date, ticket_number, source, order_type)
             values ($1, $2, current_date, 0, 'qr', 'takeaway')`, [rid, uuid()]), /customer_required/);
  await qrOrder('Sara');
});

test('the guest flag is public and follows the switch', async () => {
  const slug = (await sql(`select slug from public.restaurants where id = $1`, [rid]))[0].slug;
  await setMode(true);
  assert.equal((await as(null, `select public.get_boccadillos($1) r`, [slug]))[0].r, true);
  await setMode(false);
  assert.equal((await as(null, `select public.get_boccadillos($1) r`, [slug]))[0].r, false);
});

test('unpaid QR orders expire after the delay; paid ones never do', async () => {
  await setMode(true);
  const old = await qrOrder('Oud');
  const fresh = await qrOrder('Nieuw');
  const paid = await qrOrder('Betaald');
  await rpc(dev, 'pos_collect_prepaid', [paid.id, null]);
  await sql(`update public.orders set created_at = now() - interval '30 minutes' where id = any($1)`, [[old.id, paid.id]]);
  const n = await rpc(dev, 'expire_unpaid_qr', [rid]);
  assert.equal(Number(n), 1);
  const st = async id => (await sql(`select status from public.orders where id = $1`, [id]))[0].status;
  assert.equal(await st(old.id), 'cancelled');
  assert.equal(await st(fresh.id), 'new');
  assert.equal(await st(paid.id), 'preparing');
  // mode off: nothing expires
  await setMode(false);
  assert.equal(Number(await rpc(dev, 'expire_unpaid_qr', [rid])), 0);
});

test('refund: cancelling a paid order needs a reason and a manager PIN, and removes the payment', async () => {
  await setMode(true);
  const o = await qrOrder('Refund');
  await rpc(dev, 'pos_collect_prepaid', [o.id, null]);
  await assert.rejects(rpc(dev, 'cancel_order', [o.id, '', w.A.staff.karim.id, '9999']), /reason_required/);
  const bad = await rpc(dev, 'cancel_order', [o.id, 'Client parti', w.A.staff.karim.id, '0000']);
  assert.equal(bad.ok, false);
  assert.equal((await sql(`select count(*)::int n from public.payments where order_id = $1`, [o.id]))[0].n, 1);
  const ok = await rpc(dev, 'cancel_order', [o.id, 'Client parti', w.A.staff.karim.id, '9999']);
  assert.equal(ok.ok, true);
  assert.equal((await sql(`select count(*)::int n from public.payments where order_id = $1`, [o.id]))[0].n, 0);
  assert.equal((await sql(`select status from public.orders where id = $1`, [o.id]))[0].status, 'cancelled');
});

test('an order without a prepayment still follows the old rule (remove payments first)', async () => {
  const o = await qrOrder('Oud-gedrag');
  await sql(`insert into public.payments (restaurant_id, order_id, method, amount_cents) values ($1, $2, 'cash', 1000)`, [rid, o.id]);
  await assert.rejects(rpc(dev, 'cancel_order', [o.id, 'erreur', w.A.staff.karim.id, '9999']), /remove_payments_first/);
});
