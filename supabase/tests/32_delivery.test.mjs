// Own delivery: assign a courier, the courier's page by token, proof of delivery with the guest's code.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, guestOrder } from './helpers.mjs';

let w, A, rid, dev;
before(async () => { w = await world(); A = w.A; rid = A.r.id; dev = w.users.deviceA;
  await sql(`update public.restaurants set opening_hours = '{}', online = '{}', accept_delivery = true, pos_plan = 'restaurant' where id = $1`, [rid]); });
after(() => pool.end());
const deliver = async (phone) => (await rpc(null, 'place_order', [A.r.slug, JSON.stringify(guestOrder(null, [{ item_id: A.items.tajine.id, quantity: 1 }],
  { order_type: 'delivery', customer: { name: 'Salma', phone, address: '12 rue Oued Fès, Agdal' } }))])).order_id;

test('courier flow with proof of delivery', async () => {
  const [c] = await as(w.users.managerA, `insert into public.couriers (restaurant_id, name, phone) values ($1, 'Hamza Livreur', '0611223344') returning *`, [rid]);
  const id = await deliver('0670000101');
  const [o0] = await sql(`select delivery_code from public.orders where id = $1`, [id]);
  assert.match(o0.delivery_code, /^\d{4}$/);
  await as(dev, `update public.orders set courier_id = $2 where id = $1`, [id, c.id]);
  assert.equal((await sql(`select delivery_status from public.orders where id = $1`, [id]))[0].delivery_status, 'assigned');
  const page = await rpc(null, 'courier_orders', [c.token]);
  assert.equal(page.orders.length, 1);
  assert.equal(page.orders[0].address, '12 rue Oued Fès, Agdal');
  const st = await rpc(null, 'get_order_status', [id]);
  assert.equal(st.delivery_code, o0.delivery_code); assert.equal(st.courier, 'Hamza');
  await rpc(null, 'courier_update', [c.token, id, 'picked_up', null, null]);
  const wrong = await rpc(null, 'courier_update', [c.token, id, 'delivered', '0000' === o0.delivery_code ? '1111' : '0000', null]);
  assert.deepEqual([wrong.ok, wrong.error], [false, 'wrong_code']);
  assert.equal((await rpc(null, 'courier_update', [c.token, id, 'delivered', o0.delivery_code, null])).ok, true);
  const [o1] = await sql(`select status, delivery_status, delivered_at is not null d from public.orders where id = $1`, [id]);
  assert.deepEqual([o1.status, o1.delivery_status, o1.d], ['served', 'delivered', true]);
  assert.equal((await rpc(null, 'get_order_status', [id])).delivery_code, null, 'no code once delivered');
  // a prepaid order is delivered after payment
  const id2 = await deliver('0670000102');
  await as(dev, `update public.orders set courier_id = $2 where id = $1`, [id2, c.id]);
  const tot = (await sql(`select total_cents from public.orders where id = $1`, [id2]))[0].total_cents;
  await rpc(dev, 'pos_pay_order', [id2, JSON.stringify([{ method: 'card', amount_cents: Number(tot) }]), null, null]);
  const code2 = (await sql(`select delivery_code from public.orders where id = $1`, [id2]))[0].delivery_code;
  assert.equal((await rpc(null, 'courier_update', [c.token, id2, 'delivered', code2, null])).ok, true);
  // a wrong token sees nothing; the report counts the cash still with the courier
  await assert.rejects(rpc(null, 'courier_orders', ['x'.repeat(32)]), /not_found/);
  const rep = await rpc(w.users.managerA, 'courier_report', [rid, '2000-01-01', '2100-01-01']);
  const me = rep.find(x => x.id === c.id);
  assert.equal(Number(me.delivered), 2);
  assert.ok(Number(me.cash_to_return_cents) > 0, 'the first order is still unpaid');
});
