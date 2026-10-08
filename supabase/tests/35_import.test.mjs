// Importing customers from another system.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world } from './helpers.mjs';

let w;
before(async () => { w = await world(); });
after(() => pool.end());

test('import customers: phone is the key, nothing is lost, points in the ledger', async () => {
  const rid = w.A.r.id;
  const rows = [
    { phone: '+212 6 61 22 33 44', name: 'Yassine', points: '120', visits: 8, spent_cents: 64000, birthday: '1990-05-02', marketing_ok: true },
    { phone: '0661223344', name: 'Autre nom', points: 50 },
    { phone: 'pas de numéro', name: 'X' },
    { phone: '0700112233', note: 'Allergie noix' },
  ];
  const res = await rpc(w.users.managerA, 'import_customers', [rid, JSON.stringify(rows)]);
  assert.deepEqual(res, { created: 2, updated: 1, skipped: 1 });
  const [c] = await sql(`select name, points, visits, spent_cents, marketing_ok from public.customers where restaurant_id = $1 and phone = '0661223344'`, [rid]);
  assert.equal(c.name, 'Yassine');
  assert.equal(c.points, 120, 'points never go down');
  assert.equal(c.marketing_ok, true);
  const led = await sql(`select sum(points)::int s from public.loyalty_ledger where restaurant_id = $1`, [rid]);
  assert.equal(led[0].s, 120);
  await assert.rejects(rpc(w.users.ownerB, 'import_customers', [rid, '[]']), /not_allowed|not allowed/);
  await assert.rejects(rpc(w.users.deviceA, 'import_customers', [rid, '[]']), /not_allowed|not allowed/);
});
