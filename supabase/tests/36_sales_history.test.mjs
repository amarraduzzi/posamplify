// Sales imported from the old till: kept apart from the fiscal tickets.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world } from './helpers.mjs';

let w;
before(async () => { w = await world(); });
after(() => pool.end());

test('import sales history: per day, items, re-import replaces, never touches fiscal documents', async () => {
  const rid = w.A.r.id;
  const docsBefore = (await sql(`select count(*)::int n from public.fiscal_documents where restaurant_id = $1`, [rid]))[0].n;
  const days = [
    { day: '2025-09-01', revenue_cents: 420000, tickets: 110 },
    { day: '2025-09-02', revenue_cents: 310000, tickets: 90 },
    { day: '2999-01-01', revenue_cents: 1 },
    { day: 'pas une date', revenue_cents: 1 },
  ];
  const items = [
    { day: '2025-09-01', name: 'Café noir', qty: 60 },
    { day: '2025-09-01', name: 'Café noir', qty: 4 },
    { day: '2025-09-02', name: 'Thé à la menthe', qty: 30, revenue_cents: 48000 },
    { day: '2025-08-01', name: 'Pas dans les jours', qty: 1 },
  ];
  const res = await rpc(w.users.managerA, 'import_sales', [rid, JSON.stringify(days), JSON.stringify(items)]);
  assert.equal(res.days, 2);
  assert.equal(res.items, 3);
  assert.equal(res.from, '2025-09-01');
  const h = await rpc(w.users.managerA, 'sales_history', [rid]);
  assert.equal(Number(h.total_cents), 730000);
  assert.equal(Number(h.tickets), 200);
  assert.equal(h.top[0].name, 'Café noir');
  assert.equal(Number(h.top[0].qty), 64);
  const sep = h.months.find(m => m.month === '2025-09');
  assert.equal(Number(sep.history_cents), 730000);
  assert.ok(h.months.length >= 2, 'months up to today');

  // importing the same day again replaces it (no double count)
  await rpc(w.users.managerA, 'import_sales', [rid, JSON.stringify([{ day: '2025-09-01', revenue_cents: 100000 }]), '[]']);
  const h2 = await rpc(w.users.managerA, 'sales_history', [rid]);
  assert.equal(Number(h2.total_cents), 410000);
  assert.equal(h2.top[0].name, 'Thé à la menthe', 'items of a re-imported day are replaced');

  // a day that already has Amplify tickets is skipped
  const [fd] = await sql(`select business_date::text d from public.fiscal_documents where restaurant_id = $1 limit 1`, [rid]);
  if (fd) {
    const r3 = await rpc(w.users.managerA, 'import_sales', [rid, JSON.stringify([{ day: fd.d, revenue_cents: 5 }]), '[]']);
    assert.equal(r3.skipped, 1);
    assert.equal(r3.days, 0);
  }
  assert.equal((await sql(`select count(*)::int n from public.fiscal_documents where restaurant_id = $1`, [rid]))[0].n, docsBefore);

  // others cannot read or write, a manager cannot clear, the owner can
  await assert.rejects(rpc(w.users.ownerB, 'import_sales', [rid, '[]', '[]']), /not_allowed|not allowed/);
  await assert.rejects(rpc(w.users.deviceA, 'sales_history', [rid]), /not_allowed|not allowed/);
  await assert.rejects(rpc(w.users.managerA, 'sales_history_clear', [rid]), /not_allowed|not allowed/);
  await rpc(w.users.ownerA, 'sales_history_clear', [rid]);
  assert.equal(Number((await rpc(w.users.ownerA, 'sales_history', [rid])).total_cents), 0);
});
