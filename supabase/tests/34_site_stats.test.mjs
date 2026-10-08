// Website statistics: anonymous counters, the owner's figures, Amplify's warm leads.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world } from './helpers.mjs';

let w;
before(async () => { w = await world(); });
after(() => pool.end());

test('the site counts visits and clicks, the owner sees them, nobody else', async () => {
  const slug = w.A.r.slug;
  for (const k of ['view', 'view', 'view', 'menu', 'call', 'wa_order', 'wa_order', 'nonsense']) await rpc(null, 'site_track', [slug, null, k]);
  await rpc(null, 'site_track', ['does-not-exist', null, 'view']);
  const s = await rpc(w.users.ownerA, 'site_stats', [w.A.r.id, 30]);
  assert.equal(Number(s.totals.view), 3);
  assert.equal(Number(s.totals.wa_order), 2);
  assert.equal(s.totals.nonsense, undefined);
  assert.equal(s.daily.length, 30);
  assert.equal(Number(s.daily.at(-1).views), 4, 'pages of the site and the menu page');
  await assert.rejects(rpc(w.users.ownerB, 'site_stats', [w.A.r.id, 30]), /not_allowed|not allowed/);
  await assert.rejects(rpc(null, 'site_stats', [w.A.r.id, 30]), /denied|not allowed/);
  const rows = await sql(`set local role anon; select * from public.site_events`).catch(e => e);
  assert.ok(rows instanceof Error || rows.length === 0);
});

test('warm leads for Amplify: most WhatsApp orders first, platform only', async () => {
  for (let i = 0; i < 5; i++) await rpc(null, 'site_track', [w.B.r.slug, null, 'wa_order']);
  const leads = await rpc(w.users.admin, 'admin_site_leads', [30]);
  const ids = leads.map(l => l.id);
  assert.ok(ids.indexOf(w.B.r.id) < ids.indexOf(w.A.r.id));
  assert.equal(Number(leads.find(l => l.id === w.B.r.id).wa_order), 5);
  await assert.rejects(rpc(w.users.ownerA, 'admin_site_leads', [30]), /not allowed/);
});
