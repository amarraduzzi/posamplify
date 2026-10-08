// Amplify Site sold on its own: sign-up, platform demo, pause page when unpaid.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world } from './helpers.mjs';

let w;
before(async () => { w = await world(); });
after(() => pool.end());

test('sign-up for the website alone: site on, no colour, no till', async () => {
  const [u] = await sql(`insert into auth.users (email) values ($1) returning id, email`, [`site-${w.tag}@test.ma`]);
  const id = await rpc(u, 'signup_restaurant', [`Chez Site ${w.tag}`, `chez-site-${w.tag}`, 'Rabat', '{site}']);
  const [r] = await sql(`select products, site, branding, status from public.restaurants where id = $1`, [id]);
  assert.deepEqual(r.products, ['site']);
  assert.equal(r.site.enabled, true);
  assert.equal(r.branding.primary_color, undefined);
  assert.equal(r.status, 'trial');
  const s = await rpc(null, 'get_site', [`chez-site-${w.tag}`, null]);
  assert.equal(s.noindex, false);
  assert.equal(s.can_order, false, 'no till: orders go to WhatsApp');
  // the site comes with POS or Profit, never next to them
  const id2 = await rpc(u, 'signup_restaurant', [`Deux ${w.tag}`, `deux-${w.tag}`, null, '{site,pos}']);
  assert.deepEqual((await sql(`select products from public.restaurants where id = $1`, [id2]))[0].products, ['pos']);
});

test('unpaid site-only restaurant shows the pause page, a POS restaurant keeps its site', async () => {
  const id = await rpc(w.users.admin, 'admin_create_restaurant', [`demo-site-${w.tag}`, 'Démo Site', null, true, '{site}', 'Fès', 'nuit']);
  const [r] = await sql(`select products, site, city from public.restaurants where id = $1`, [id]);
  assert.deepEqual(r.products, ['site']);
  assert.equal(r.site.theme, 'nuit');
  assert.equal(r.city, 'Fès');
  assert.equal((await rpc(null, 'get_site', [`demo-site-${w.tag}`, null])).noindex, true, 'a demo is not on Google');
  await sql(`update public.restaurants set status = 'trial', trial_ends_at = now() - interval '10 days' where id = $1`, [id]);
  const p = await rpc(null, 'get_site', [`demo-site-${w.tag}`, null]);
  assert.equal(p.paused, true);
  assert.equal(p.items, undefined, 'nothing else is shown');
  await sql(`update public.restaurants set status = 'paused' where id = $1`, [w.A.r.id]);
  assert.equal((await rpc(null, 'get_site', [w.A.r.slug, null])).paused, undefined);
  await sql(`update public.restaurants set status = 'active' where id = $1`, [w.A.r.id]);
  // upgrading: the platform switches on POS, the site stays
  const res = await rpc(w.users.admin, 'admin_set_products', [id, '{site,pos}', null]);
  assert.deepEqual(res.products, ['pos']);
  await assert.rejects(rpc(w.users.ownerA, 'admin_create_restaurant', [`x-${w.tag}`, 'X', null, false, '{site}', null, null]), /not allowed/);
});
