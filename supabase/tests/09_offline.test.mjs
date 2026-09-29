// Offline till: orders sent later keep their real time, replays never duplicate.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, uuid } from './helpers.mjs';

let w, dev;
before(async () => { w = await world(); dev = w.users.deviceA; });
after(() => pool.end());

const insertOrder = (id, clientId, createdAt) => as(dev,
  `insert into public.orders (id, restaurant_id, client_id, business_date, ticket_number, source, order_type, created_at)
   values ($1, $2, $3, current_date, 0, 'pos', 'takeaway', $4) returning *`,
  [id, w.A.r.id, clientId, createdAt]);

test('an order synced later keeps the time the till took it', async () => {
  const t = new Date(Date.now() - 3 * 3600_000).toISOString();
  const [o] = await insertOrder(uuid(), uuid(), t);
  assert.equal(new Date(o.created_at).toISOString(), t);
  assert.ok(o.ticket_number > 0, 'ticket number still from the server');
});

test('implausible times fall back to the server time', async () => {
  for (const t of [new Date(Date.now() + 3600_000), new Date(Date.now() - 72 * 3600_000)]) {
    const [o] = await insertOrder(uuid(), uuid(), t.toISOString());
    assert.ok(Math.abs(new Date(o.created_at).getTime() - Date.now()) < 60_000, `${t.toISOString()} replaced by now`);
  }
});

test('replaying the same order or lines never creates duplicates', async () => {
  const id = uuid(), clientId = uuid(), lineId = uuid();
  await insertOrder(id, clientId, new Date().toISOString());
  await assert.rejects(insertOrder(id, clientId, new Date().toISOString()), /duplicate key/);
  const addLine = () => as(dev,
    `insert into public.order_lines (id, restaurant_id, order_id, menu_item_id, name, unit_price_cents, quantity)
     values ($1, $2, $3, $4, '-', 0, 2) on conflict (id) do nothing`,
    [lineId, w.A.r.id, id, w.A.items.jus.id]);
  await addLine(); await addLine();
  const [o] = await sql(`select total_cents, (select count(*)::int from public.order_lines where order_id = $1) n from public.orders where id = $1`, [id]);
  assert.equal(o.n, 1);
  assert.equal(Number(o.total_cents), 4000);
  const d = await rpc(dev, 'pos_pay_order', [id, JSON.stringify([{ method: 'cash', amount_cents: 4000 }]), null, null]);
  assert.equal(Number(d.total_ttc_cents), 4000);
  // a lost answer makes the till retry: refused, and the order is known to be closed
  await assert.rejects(rpc(dev, 'pos_pay_order', [id, JSON.stringify([{ method: 'cash', amount_cents: 4000 }]), null, null]), /order_already_closed/);
  const [c] = await sql(`select fiscal_document_id from public.orders where id = $1`, [id]);
  assert.equal(c.fiscal_document_id, d.id);
});
