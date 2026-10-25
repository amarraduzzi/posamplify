// Boccadillos mode, step A: the switch is platform-only, and a QR order is paid (cash) before it
// goes to the kitchen; afterwards it is closed with close_order() at handover.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, uuid } from './helpers.mjs';

let w, rid, dev;
before(async () => { w = await world(); rid = w.A.r.id; dev = w.users.deviceA; });
after(() => pool.end());

// a pending QR order, created like place_order() would (as a server-side insert)
async function qrOrder(price = 4500, qty = 2) {
  const [o] = await sql(
    `insert into public.orders (restaurant_id, client_id, business_date, ticket_number, source, order_type, customer_name)
     values ($1, $2, current_date, 0, 'qr', 'takeaway', 'Test') returning *`, [rid, uuid()]);
  await sql(
    `insert into public.order_lines (restaurant_id, order_id, name, unit_price_cents, quantity, vat_bp)
     values ($1, $2, 'Boccadillo', $3, $4, 1000)`, [rid, o.id, price, qty]);
  return (await sql(`select * from public.orders where id = $1`, [o.id]))[0];
}
const mode = async () => (await sql(`select boccadillos from public.restaurants where id = $1`, [rid]))[0].boccadillos;

test('the mode is off by default and only the platform admin can switch it', async () => {
  assert.equal(await mode(), false);
  await assert.rejects(rpc(w.users.ownerA, 'admin_set_boccadillos', [rid, true]), /not allowed|platform/i);
  await assert.rejects(as(w.users.ownerA, `update public.restaurants set boccadillos = true where id = $1`, [rid]), /permission denied/i);
  assert.equal(await mode(), false);
});

test('with the mode off, collecting is refused', async () => {
  const o = await qrOrder();
  await assert.rejects(rpc(dev, 'pos_collect_prepaid', [o.id, null]), /mode_off/);
});

test('with the mode on: cash first, then kitchen, then closed at handover', async () => {
  const r0 = await rpc(w.users.admin, 'admin_set_boccadillos', [rid, true]);
  assert.equal(r0.boccadillos, true);
  const o = await qrOrder(4500, 2);
  assert.equal(o.status, 'new');
  assert.equal(Number(o.total_cents), 9000);

  const res = await rpc(dev, 'pos_collect_prepaid', [o.id, null]);
  assert.equal(res.ok, true);
  const after1 = (await sql(`select * from public.orders where id = $1`, [o.id]))[0];
  assert.equal(after1.status, 'preparing');
  assert.ok(after1.prepaid_at);
  const pays = await sql(`select method, amount_cents from public.payments where order_id = $1`, [o.id]);
  assert.equal(pays.length, 1);
  assert.equal(pays[0].method, 'cash');
  assert.equal(Number(pays[0].amount_cents), 9000);

  // idempotent: a second tap does not take the money twice
  const again = await rpc(dev, 'pos_collect_prepaid', [o.id, null]);
  assert.equal(again.already, true);
  assert.equal((await sql(`select count(*)::int n from public.payments where order_id = $1`, [o.id]))[0].n, 1);

  // handover: the existing close_order() issues the ticket
  const doc = await rpc(dev, 'close_order', [o.id, null, null]);
  assert.ok(doc.id);
  assert.ok((await sql(`select closed_at from public.orders where id = $1`, [o.id]))[0].closed_at);
});

test('a prepaid order is protected: no prepaid_at tampering, no line or payment changes, no free cancel', async () => {
  const o = await qrOrder(3000, 1);
  await rpc(dev, 'pos_collect_prepaid', [o.id, null]);
  await assert.rejects(as(dev, `update public.orders set prepaid_at = null where id = $1`, [o.id]), /pos_collect_prepaid/);
  const [line] = await sql(`select id from public.order_lines where order_id = $1`, [o.id]);
  await assert.rejects(as(dev, `update public.order_lines set quantity = 5 where id = $1`, [line.id]), /already paid/);
  await assert.rejects(as(dev, `delete from public.order_lines where id = $1`, [line.id]), /already paid/);
  await assert.rejects(as(dev, `delete from public.payments where order_id = $1`, [o.id]), /already paid/);
  // cancelling a prepaid order is a refund: it needs a reason and a manager PIN (see test 98)
  await assert.rejects(rpc(dev, 'cancel_order', [o.id, '', w.A.staff.karim.id, '9999']), /reason_required/);
  // the kitchen can still change the line status
  await as(dev, `update public.order_lines set kitchen_sent_at = now() where id = $1`, [line.id]);
});

test('only a pending QR order can be collected, and only by its own restaurant', async () => {
  const till = await (await import('./helpers.mjs')).tillOrder(dev, rid, [{ name: 'Café', price: 2000, vat_bp: 1000 }]);
  await assert.rejects(rpc(dev, 'pos_collect_prepaid', [till.id, null]), /invalid_request|not_pending/);
  const o = await qrOrder();
  await assert.rejects(rpc(w.users.deviceB, 'pos_collect_prepaid', [o.id, null]), /not allowed|not_found|permission/i);
});
