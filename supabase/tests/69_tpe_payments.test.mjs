// Card terminal (TPE): an approved card payment keeps what the terminal answered, never the card number.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world, tillOrder } from './helpers.mjs';

let w, rid, dev;
before(async () => { w = await world(); rid = w.A.r.id; dev = w.users.deviceA; });
after(() => pool.end());
const order = async () => {
  const o = await tillOrder(dev, rid, [{ item_id: w.A.items.tajine.id, price: 9000 }]);
  o.total = Number((await sql(`select total_cents from public.orders where id = $1`, [o.id]))[0].total_cents);
  return o;
};
const pay = (id, ps) => rpc(dev, 'pos_pay_order', [id, JSON.stringify(ps), null, null]);
const pays = async id => sql(`select method, amount_cents, tpe_status, tpe_ref, card_last4, card_brand, tpe_terminal from public.payments where order_id = $1 order by method`, [id]);

test('an approved card payment keeps the terminal answer', async () => {
  const o = await order();
  await pay(o.id, [{ method: 'card', amount_cents: o.total, tip_cents: 0,
    tpe: { status: 'approved', ref: 'AUT123456', last4: '4242', brand: 'VISA', terminal: 'TPE test' } }]);
  const [p] = await pays(o.id);
  assert.deepEqual([p.tpe_status, p.tpe_ref, p.card_last4, p.card_brand, p.tpe_terminal], ['approved', 'AUT123456', '4242', 'VISA', 'TPE test']);
});

test('mixed: cash without terminal, the card part with it; manual entry is recorded as manual', async () => {
  const o = await order();
  await pay(o.id, [{ method: 'cash', amount_cents: 4000, tip_cents: 0 },
    { method: 'card', amount_cents: o.total - 4000, tip_cents: 0, tpe: { status: 'manual' } }]);
  const ps = await pays(o.id);
  assert.equal(ps.find(p => p.method === 'cash').tpe_status, null);
  const card = ps.find(p => p.method === 'card');
  assert.equal(card.tpe_status, 'manual'); assert.equal(card.card_last4, null);
});

test('a card payment without terminal works as before', async () => {
  const o = await order();
  await pay(o.id, [{ method: 'card', amount_cents: o.total, tip_cents: 0 }]);
  assert.equal((await pays(o.id))[0].tpe_status, null);
});

test('refused: terminal data on cash, a full card number, an unknown status', async () => {
  for (const bad of [
    { method: 'cash', amount_cents: 1, tip_cents: 0, tpe: { status: 'approved' } },
    { method: 'card', amount_cents: 1, tip_cents: 0, tpe: { status: 'approved', last4: '4242424242424242' } },
    { method: 'card', amount_cents: 1, tip_cents: 0, tpe: { status: 'declined' } },
  ]) {
    const o = await order();
    await assert.rejects(pay(o.id, [{ ...bad, amount_cents: o.total }]), /invalid_request/);
  }
});
