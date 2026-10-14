// A forgotten Z: a past day with sales and no closure is listed, and a manager can close it afterwards
// (without a cash count). Today is never listed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world, tillOrder } from './helpers.mjs';

let w;
before(async () => { w = await world(); });
after(() => pool.end());

test('unclosed past days are listed and can be closed later without a count', async () => {
  const dev = w.users.deviceA, rid = w.A.r.id;
  const o = await tillOrder(dev, rid, [{ item_id: w.A.items.jus.id }]);
  const [ord] = await sql(`select * from public.orders where id = $1`, [o.id]);
  await rpc(dev, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: Number(ord.total_cents) }]), null, null]);
  assert.deepEqual(await rpc(dev, 'unclosed_days', [rid]), [], 'today is not a forgotten day');

  // the sale happened three days ago and nobody closed that day
  const [{ d }] = await sql(`select (app.business_date(r) - 3)::text d from public.restaurants r where id = $1`, [rid]);
  await sql(`begin; set local session_replication_role = replica;
    update public.orders set business_date = '${d}' where id = '${o.id}';
    update public.fiscal_documents set business_date = '${d}' where order_id = '${o.id}'; commit;`);
  const late = await rpc(dev, 'unclosed_days', [rid]);
  assert.equal(late.length, 1);
  assert.equal(late[0].business_date, d);
  assert.equal(late[0].tickets, 1);

  // other restaurants cannot read it
  await assert.rejects(rpc(w.users.deviceB, 'unclosed_days', [rid]), /not allowed/);

  const z = await rpc(dev, 'close_day', [rid, d, w.A.staff.karim.id, '9999', null]);
  assert.equal(z.ok, true);
  assert.equal(z.totals.tickets, 1);
  assert.deepEqual(await rpc(dev, 'unclosed_days', [rid]), []);
});
