// The owner's live view: today's figures and the alerts worth a look.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, A, rid, dev;
before(async () => { w = await world(); A = w.A; rid = A.r.id; dev = w.users.deviceA; });
after(() => pool.end());

test('owner_live: revenue, open orders and alerts', async () => {
  const o = await tillOrder(dev, rid, [{ item_id: A.items.tajine.id }]);
  const d = await rpc(dev, 'apply_discount', [o.id, 3000, A.staff.karim.id, '9999']);
  assert.equal(d.ok, true);
  await rpc(dev, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: 5500 }]), A.staff.sara.id, null]);
  await tillOrder(dev, rid, [{ item_id: A.items.jus.id }]);
  const day = (await sql(`select business_date::text d from public.orders where id = $1`, [o.id]))[0].d;
  await as(dev, `insert into public.cash_movements (restaurant_id, business_date, kind, amount_cents, reason) values ($1, $2, 'payout', 20000, 'Fournisseur pain')`, [rid, day]);
  const live = await rpc(w.users.ownerA, 'owner_live', [rid]);
  assert.equal(Number(live.revenue_cents), 5500);
  assert.equal(Number(live.tickets), 1);
  assert.equal(Number(live.open_orders), 1);
  const kinds = live.alerts.map(a => a.kind).sort();
  assert.ok(kinds.includes('discount'), 'a 30 DH discount on 85 DH is flagged');
  assert.ok(kinds.includes('payout'));
  await assert.rejects(rpc(dev, 'owner_live', [rid]), /not_allowed|not allowed/);
  await as(w.users.ownerA, `update public.restaurants set owner_whatsapp = '+212 600 000 000' where id = $1`, [rid]);
});
