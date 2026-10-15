// Customers sign up with a QR: only when the customer file is on; one customer per number; consent only
// turns on; a tasting keeps who came and sees a second sign-up; nothing personal comes back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, slug, rid;
before(async () => { w = await world(); rid = w.A.r.id; slug = w.A.r.slug; });
after(() => pool.end());

test('QR sign-up: off by default, then in the customer file', async () => {
  await sql(`update public.restaurants set loyalty = '{}' where id = $1`, [rid]);
  let info = await rpc(null, 'signup_info', [slug, null]);
  assert.equal(info.enabled, false);
  await assert.rejects(rpc(null, 'customer_signup', [slug, 'Salma', '0661 23 45 67', true, null]), /signup_off/);
  await sql(`update public.restaurants set loyalty = '{"customers": true}' where id = $1`, [rid]);
  info = await rpc(null, 'signup_info', [slug, null]);
  assert.equal(info.enabled, true); assert.equal(info.event, null);
  await assert.rejects(rpc(null, 'customer_signup', [slug, '', '0661234567', true, null]), /customer_required/);
  await assert.rejects(rpc(null, 'customer_signup', [slug, 'Salma', '12', true, null]), /customer_required/);
  const x = await rpc(null, 'customer_signup', [slug, ' Salma ', '+212 661 23 45 67', true, null]);
  assert.equal(x.name, 'Salma'); assert.equal(x.existed, false);
  const [c] = await sql(`select phone, name, marketing_ok, source from public.customers where restaurant_id = $1 and phone = '0661234567'`, [rid]);
  assert.deepEqual(c, { phone: '0661234567', name: 'Salma', marketing_ok: true, source: 'qr' });
  // the same number again: no second customer, the name kept, consent never switched off by a sign-up
  const y = await rpc(null, 'customer_signup', [slug, 'Autre', '0661234567', false, null]);
  assert.equal(y.existed, true); assert.equal(y.name, 'Autre'); // only what was typed comes back
  const rows = await sql(`select name, marketing_ok from public.customers where restaurant_id = $1 and phone = '0661234567'`, [rid]);
  assert.equal(rows.length, 1); assert.equal(rows[0].name, 'Salma'); assert.equal(rows[0].marketing_ok, true);
  // a guest cannot read the customer file
  await assert.rejects(as(null, `select * from public.customers`));
});

test('QR sign-up at a tasting: who came, and a second sign-up is flagged', async () => {
  const [e] = await as(w.users.managerA, `insert into public.signup_events (restaurant_id, name, offer) values ($1, 'Dégustation', 'Une assiette offerte') returning key`, [rid]);
  const info = await rpc(null, 'signup_info', [slug, e.key]);
  assert.equal(info.event.name, 'Dégustation'); assert.equal(info.event.offer, 'Une assiette offerte');
  const a1 = await rpc(null, 'customer_signup', [slug, 'Karim', '0770112233', true, e.key]);
  assert.equal(a1.again, false); assert.equal(a1.offer, 'Une assiette offerte');
  const a2 = await rpc(null, 'customer_signup', [slug, 'Karim', '0770112233', true, e.key]);
  assert.equal(a2.again, true);
  const [n] = await as(w.users.managerA, `select count(*)::int n from public.signup_event_people p join public.signup_events e on e.id = p.event_id where e.key = $1`, [e.key]);
  assert.equal(n.n, 1);
  assert.equal((await as(w.users.ownerB, `select count(*)::int n from public.signup_events where restaurant_id = $1`, [rid]))[0].n, 0);
  // the key of another restaurant's tasting does not work here; a closed tasting refuses
  await assert.rejects(rpc(null, 'customer_signup', [w.B.r.slug, 'X', '0660000000', true, e.key]));
  await as(w.users.managerA, `update public.signup_events set active = false where key = $1`, [e.key]);
  await assert.rejects(rpc(null, 'customer_signup', [slug, 'Nadia', '0660998877', true, e.key]), /event_closed/);
});
