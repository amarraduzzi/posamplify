// Owner briefing: exact facts of the day for owners and managers, nobody else.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, as, rpc, world, tillOrder } from './helpers.mjs';

let w, dev;
before(async () => { w = await world(); dev = w.users.deviceA; });
after(() => pool.end());

test('briefing sums sales, dishes, staff and cancellations of the day', async () => {
  const a = await tillOrder(dev, w.A.r.id, [{ item_id: w.A.items.tajine.id }, { item_id: w.A.items.jus.id, qty: 2 }]);
  await as(dev, `update public.orders set staff_id = $2 where id = $1`, [a.id, w.A.staff.sara.id]);
  await rpc(dev, 'pos_pay_order', [a.id, JSON.stringify([{ method: 'cash', amount_cents: Number(a.total_cents) }]), w.A.staff.sara.id, null]);
  const fresh = (await as(dev, `select * from public.orders where id = $1`, [a.id]))[0];
  const c = await tillOrder(dev, w.A.r.id, [{ item_id: w.A.items.jus.id }]);
  await rpc(dev, 'cancel_order', [c.id, 'Client parti', w.A.staff.karim.id, '9999']);

  const b = await rpc(w.users.ownerA, 'owner_briefing', [w.A.r.id, null]);
  assert.equal(b.today.tickets, 1);
  assert.equal(Number(b.today.revenue_ttc_cents), Number(fresh.total_cents));
  assert.ok(b.top_items.length >= 2, 'dishes sold');
  const jus = b.top_items.find(i => i.qty === 2);
  assert.ok(jus, 'quantities from the fiscal ticket');
  const sara = b.staff.find(s => s.name === 'Sara');
  assert.equal(sara.orders, 1);
  assert.equal(b.cancel_reasons[0].reason, 'Client parti');
  assert.equal(b.channels.pos, 1);
  assert.equal(b.hours.length, 1);

  const m = await rpc(w.users.managerA, 'owner_briefing', [w.A.r.id, null]);
  assert.equal(m.today.tickets, 1, 'managers see it too');
});

test('tills and other restaurants cannot read the briefing', async () => {
  await assert.rejects(rpc(dev, 'owner_briefing', [w.A.r.id, null]), /not allowed/);
  await assert.rejects(rpc(w.users.ownerB, 'owner_briefing', [w.A.r.id, null]), /not allowed/);
});
