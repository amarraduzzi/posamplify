// Till support: merging table bills, paying in one step, guest tracking after merge.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, uuid, tillOrder, guestOrder } from './helpers.mjs';

let w, dev;
before(async () => { w = await world(); dev = w.users.deviceA; });
after(() => pool.end());

test('a QR order merges into the table bill and the guest keeps tracking it', async () => {
  const bill = await tillOrder(dev, w.A.r.id, [{ item_id: w.A.items.tajine.id }], { order_type: 'dine_in', table_id: w.A.tables.t1.id });
  const qr = await rpc(null, 'place_order', [w.A.r.slug, JSON.stringify(guestOrder(w.A.tables.t1.qr_token,
    [{ item_id: w.A.items.jus.id, quantity: 2 }], { note: 'sans sucre' }))]);
  const res = await rpc(dev, 'pos_merge_orders', [bill.id, [qr.order_id]]);
  assert.equal(Number(res.total_cents), 8500 + 4000);
  const [o] = await sql(`select note from public.orders where id = $1`, [bill.id]);
  assert.equal(o.note, 'sans sucre');
  assert.equal((await sql(`select 1 from public.orders where id = $1`, [qr.order_id])).length, 0);
  await as(dev, `update public.orders set status = 'preparing' where id = $1`, [bill.id]);
  const s = await rpc(null, 'get_order_status', [qr.order_id]);
  assert.equal(s.status, 'preparing', 'guest follows the merged bill');
});

test('clients cannot move lines between orders themselves', async () => {
  const a = await tillOrder(dev, w.A.r.id, [{ item_id: w.A.items.jus.id }]);
  const b = await tillOrder(dev, w.A.r.id, []);
  await assert.rejects(as(dev, `update public.order_lines set order_id = $1 where order_id = $2`, [b.id, a.id]), /only quantity/);
});

test('merge refuses paid, closed or foreign orders', async () => {
  const a = await tillOrder(dev, w.A.r.id, [{ item_id: w.A.items.jus.id }]);
  const paid = await tillOrder(dev, w.A.r.id, [{ item_id: w.A.items.jus.id }]);
  await as(dev, `insert into public.payments (restaurant_id, order_id, method, amount_cents) values ($1,$2,'cash',100)`, [w.A.r.id, paid.id]);
  await assert.rejects(rpc(dev, 'pos_merge_orders', [a.id, [paid.id]]), /remove_payments_first/);
  const foreign = await tillOrder(w.users.deviceB, w.B.r.id, [{ item_id: w.B.items.jus.id }]);
  await assert.rejects(rpc(dev, 'pos_merge_orders', [a.id, [foreign.id]]), /not_found/);
  await assert.rejects(rpc(w.users.deviceB, 'pos_merge_orders', [a.id, [foreign.id]]), /not allowed/);
});

test('pay and close in one step, with mixed payment and tip', async () => {
  const o = await tillOrder(dev, w.A.r.id, [{ item_id: w.A.items.tajine.id }, { item_id: w.A.items.jus.id }]);
  await assert.rejects(rpc(dev, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: 100 }]), null, null]), /payment_mismatch/);
  assert.equal((await sql(`select count(*)::int n from public.payments where order_id = $1`, [o.id]))[0].n, 0, 'failed attempt leaves nothing behind');
  await assert.rejects(rpc(dev, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'bitcoin', amount_cents: 10500 }]), null, null]), /invalid_request/);
  const d = await rpc(dev, 'pos_pay_order', [o.id, JSON.stringify([
    { method: 'cash', amount_cents: 5000, tip_cents: 500 }, { method: 'card', amount_cents: 5500 }]), w.A.staff.sara.id, null]);
  assert.equal(Number(d.total_ttc_cents), 10500);
  assert.equal(d.payments.length, 2);
  assert.equal(d.staff_id, w.A.staff.sara.id);
  await assert.rejects(rpc(dev, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: 1 }]), null, null]), /order_already_closed/);
});

test('owner stores printer settings, device cannot', async () => {
  const s = { printers: { receipt: 'TICKET', stations: { bar: 'BAR', kitchen: 'CUISINE' } } };
  const r = await as(w.users.ownerA, `update public.restaurants set pos_settings = $2 where id = $1 returning pos_settings`, [w.A.r.id, s]);
  assert.deepEqual(r[0].pos_settings, s);
  const d = await as(dev, `update public.restaurants set pos_settings = '{}' where id = $1 returning id`, [w.A.r.id]);
  assert.equal(d.length, 0);
});
