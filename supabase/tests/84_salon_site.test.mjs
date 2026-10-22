// The salon's website: only with the module, the prestations instead of a menu, before/after photos
// only with the client's consent, the live wait.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world } from './helpers.mjs';

let w, rid, slug;
before(async () => {
  w = await world(); rid = w.A.r.id; slug = w.A.r.slug;
  await sql(`update public.restaurants set products = '{agenda}', agenda = '{"enabled": true, "queue": true}' where id = $1`, [rid]);
  await sql(`insert into public.agenda_services (restaurant_id, name, category, duration_min, price_cents, price_from) values ($1, '{"fr":"Brushing"}', 'Coupe', 30, 8000, true)`, [rid]);
  await sql(`insert into public.agenda_services (restaurant_id, name, duration_min, active) values ($1, '{"fr":"Ancienne"}', 30, false)`, [rid]);
  await sql(`update public.staff set agenda = true where id = $1`, [w.A.staff.sara.id]);
});
after(() => pool.end());

test('no site without the module', async () => {
  assert.equal(await rpc(null, 'get_site', [slug, null]), null);
});

test('with the module: the prestations, the team, only the photos with consent', async () => {
  const ba = [
    { before: 'https://x.test/a1.jpg', after: 'https://x.test/a2.jpg', caption: 'Balayage', consent: true },
    { before: 'https://x.test/b1.jpg', after: 'https://x.test/b2.jpg', caption: 'Sans accord', consent: false },
    { before: 'https://x.test/c1.jpg', after: 'https://x.test/c2.jpg' },
  ];
  await sql(`update public.restaurants set products = '{agenda,site}', site = $2 where id = $1`, [rid, JSON.stringify({ enabled: true, before_after: ba, domain: 'salon.test' })]);
  const s = await rpc(null, 'get_site', [slug, null]);
  assert.equal(s.kind, 'salon');
  assert.deepEqual(s.services.map(x => x.name.fr), ['Brushing']);
  assert.equal(s.staff.length, 1); assert.equal(s.booking, true); assert.equal(s.nouba, true); assert.equal(s.noindex, false);
  assert.equal(s.site.before_after.length, 1); assert.equal(s.site.before_after[0].caption, 'Balayage'); assert.equal(s.site.before_after[0].consent, undefined);
  assert.equal(s.site.domain, undefined); assert.equal(s.domain, 'salon.test');
  assert.equal((await rpc(null, 'get_site', [null, 'www.salon.test'])).kind, 'salon');
  assert.equal((await rpc(null, 'salon_wait', [null, 'salon.test'])).enabled, true);
});

test('a restaurant keeps its own site', async () => {
  const b = await rpc(null, 'get_site', [w.B.r.slug, null]);
  assert.notEqual(b?.kind, 'salon');
});

test('the salon page counts places taken in the Nouba', async () => {
  await rpc(null, 'site_track', [slug, null, 'queue']);
  await rpc(null, 'site_track', [slug, null, 'nope']);
  const [{ n }] = await sql(`select coalesce(sum(n), 0)::int n from public.site_events where restaurant_id = $1 and kind = 'queue'`, [rid]);
  assert.equal(n, 1);
});
