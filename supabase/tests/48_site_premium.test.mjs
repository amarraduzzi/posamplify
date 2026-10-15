// Premium websites: only the platform sets the plan; a request from the website arrives as a catering
// quote marked "site", only on a premium site, with abuse limits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, A, rid, slug;
const day = async () => (await sql(`select (now() at time zone 'Africa/Casablanca')::date + 5 as d`))[0].d;
before(async () => { w = await world(); A = w.A; rid = A.r.id; slug = A.r.slug; });
after(() => pool.end());

test('the owner cannot set the premium plan, the platform can', async () => {
  await assert.rejects(as(w.users.ownerA, `update public.restaurants set site_plan = 'premium' where id = $1`, [rid]));
  await assert.rejects(rpc(w.users.ownerA, 'admin_set_site_plan', [rid, 'premium']));
  await sql(`update public.restaurants set site_plan = 'premium' where id = $1`, [rid]);
  const site = await rpc(null, 'get_site', [slug, null]);
  if (site) assert.equal(site.site_plan, 'premium');
});

test('a request from the website becomes a quote; limits and traps', async () => {
  const d = await day();
  await sql(`update public.restaurants set site_plan = 'basic' where id = $1`, [rid]);
  await assert.rejects(rpc(null, 'site_request', [slug, null, 'Salma', '0661223344', d, 40, 'private', 'Anniversaire', null]), /not_found/);
  await sql(`update public.restaurants set site_plan = 'premium' where id = $1`, [rid]);
  const res = await rpc(null, 'site_request', [slug, null, 'Salma', '06 61 22 33 44', d, 40, 'private', 'Anniversaire', null]);
  assert.equal(res.ok, true);
  const [c] = await sql(`select * from public.catering_orders where restaurant_id = $1 and source = 'site'`, [rid]);
  assert.equal(c.status, 'quote'); assert.equal(c.kind, 'private'); assert.equal(c.customer_phone, '0661223344'); assert.equal(c.guests, 40);
  // a robot: accepted, nothing kept
  await rpc(null, 'site_request', [slug, null, 'Bot', '0600000000', d, 2, 'other', 'x', 'http://spam']);
  assert.equal((await sql(`select count(*)::int n from public.catering_orders where restaurant_id = $1 and source = 'site'`, [rid]))[0].n, 1);
  await assert.rejects(rpc(null, 'site_request', [slug, null, 'Salma', 'abc', d, 4, 'group', '', null]), /invalid_request/);
  await assert.rejects(rpc(null, 'site_request', [slug, null, 'Salma', '0661223344', '2020-01-01', 4, 'group', '', null]), /invalid_request/);
  await rpc(null, 'site_request', [slug, null, 'Salma', '0661223344', d, 4, 'group', '', null]);
  await rpc(null, 'site_request', [slug, null, 'Salma', '0661223344', d, 4, 'group', '', null]);
  await assert.rejects(rpc(null, 'site_request', [slug, null, 'Salma', '0661223344', d, 4, 'group', '', null]), /too_many_requests/);
  // anonymous visitors still cannot read catering orders
  await assert.rejects(as(null, `select count(*) from public.catering_orders`), /permission denied/);
});
