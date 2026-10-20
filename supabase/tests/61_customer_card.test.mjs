// The customer's points card: a private key opens it, a phone number never does; only the first name, the
// points, the visits and the last movements come back; a new QR sign-up gets its key, an existing number
// gets nothing; the card is closed when the customer file is off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, slug, rid;
before(async () => {
  w = await world(); rid = w.A.r.id; slug = w.A.r.slug;
  await sql(`update public.restaurants set loyalty = '{"customers": true, "enabled": true, "per_dh": 10, "reward_points": 100, "reward_cents": 5000}' where id = $1`, [rid]);
});
after(() => pool.end());

test('a new QR sign-up gets the key of his card, an existing number gets none', async () => {
  const x = await rpc(null, 'customer_signup', [slug, 'Salma Benani', '0661234567', true, null]);
  assert.equal(x.existed, false);
  assert.match(x.card_key, /^[a-z2-9]{16}$/);
  const [c] = await sql(`select card_key from public.customers where restaurant_id = $1 and phone = '0661234567'`, [rid]);
  assert.equal(c.card_key, x.card_key);
  const y = await rpc(null, 'customer_signup', [slug, 'Autre', '0661234567', false, null]);
  assert.equal(y.existed, true); assert.equal(y.card_key, null);
});

test('the card shows the first name, points and visits, and nothing else', async () => {
  const [c] = await sql(`select id, card_key from public.customers where restaurant_id = $1 and phone = '0661234567'`, [rid]);
  await sql(`update public.customers set points = 42, visits = 5, spent_cents = 123400, note = 'allergie noix', birthday = '1990-05-05' where id = $1`, [c.id]);
  await sql(`insert into public.loyalty_ledger (restaurant_id, customer_id, points, reason) values ($1, $2, 50, 'earn'), ($1, $2, -100, 'redeem'), ($1, $2, 9, 'adjust')`, [rid, c.id]);
  const card = await rpc(null, 'customer_card', [slug, c.card_key]);
  assert.equal(card.customer.name, 'Salma'); assert.equal(card.customer.points, 42); assert.equal(card.customer.visits, 5);
  assert.equal(card.restaurant.name, w.A.r.name);
  assert.deepEqual(card.loyalty, { enabled: true, per_dh: 10, reward_points: 100, reward_cents: 5000 });
  // earn and redeem only, never the manual corrections
  assert.deepEqual(card.recent.map(m => m.reason).sort(), ['earn', 'redeem']);
  const text = JSON.stringify(card);
  for (const secret of ['0661234567', '123400', 'allergie', '1990-05-05', 'Benani']) assert.ok(!text.includes(secret), `leaks ${secret}`);
});

test('only the right key opens a card, in the right restaurant', async () => {
  const [c] = await sql(`select card_key from public.customers where restaurant_id = $1 and phone = '0661234567'`, [rid]);
  assert.equal(await rpc(null, 'customer_card', [slug, 'aaaaaaaaaaaaaaaa']), null);
  assert.equal(await rpc(null, 'customer_card', [slug, '0661234567']), null);      // a phone number is not a key
  assert.equal(await rpc(null, 'customer_card', [slug, '']), null);
  assert.equal(await rpc(null, 'customer_card', [w.B.r.slug, c.card_key]), null);  // the key of another restaurant's customer
  assert.equal(await rpc(null, 'customer_card', ['nope-nope', c.card_key]), null);
  // a guest cannot read the customer file or its keys
  await assert.rejects(as(null, `select card_key from public.customers`));
});

test('two customers never share a key, and the owner can read it to send the link', async () => {
  await rpc(null, 'customer_signup', [slug, 'Karim', '0770112233', true, null]);
  const rows = await sql(`select card_key from public.customers where restaurant_id = $1`, [rid]);
  assert.equal(new Set(rows.map(r => r.card_key)).size, rows.length);
  const mine = await as(w.users.managerA, `select card_key from public.customers where restaurant_id = $1 and phone = '0770112233'`, [rid]);
  assert.equal(mine.length, 1);
  assert.equal((await as(w.users.ownerB, `select card_key from public.customers where restaurant_id = $1`, [rid])).length, 0);
});

test('a customer who exists without a QR sign-up (import, till) already has a key', async () => {
  const [c] = await sql(`insert into public.customers (restaurant_id, phone, name) values ($1, '0655443322', 'Nadia') returning card_key`, [rid]);
  assert.match(c.card_key, /^[a-z2-9]{16}$/);
  const card = await rpc(null, 'customer_card', [slug, c.card_key]);
  assert.equal(card.customer.name, 'Nadia'); assert.equal(card.customer.points, 0);
});

test('the card is closed when the customer file is off, and points off still shows the card', async () => {
  const [c] = await sql(`select card_key from public.customers where restaurant_id = $1 and phone = '0661234567'`, [rid]);
  await sql(`update public.restaurants set loyalty = '{"customers": true}' where id = $1`, [rid]);
  const card = await rpc(null, 'customer_card', [slug, c.card_key]);
  assert.equal(card.loyalty.enabled, false);
  assert.equal(card.loyalty.reward_points, 100);
  await sql(`update public.restaurants set loyalty = '{}' where id = $1`, [rid]);
  assert.equal(await rpc(null, 'customer_card', [slug, c.card_key]), null);
});
