// Self sign-up of a restaurant and pairing tills with a one-time code.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, uuid } from './helpers.mjs';

let w;
before(async () => { w = await world(); });
after(() => pool.end());

// an anonymous Supabase session: role authenticated, is_anonymous claim true
async function anonUser() {
  const [u] = await sql(`insert into auth.users (email) values (null) returning id`);
  return { id: u.id, anonymous: true };
}
async function asAnon(u, text, params = []) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('role','authenticated',true), set_config('request.jwt.claims',$1,true)`,
      [JSON.stringify({ sub: u.id, role: 'authenticated', is_anonymous: true })]);
    const r = await c.query(text, params);
    await c.query('commit');
    return r.rows;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
const pair = (u, code) => asAnon(u, `select public.pair_device($1) r`, [code]).then(r => r[0].r);

test('a new user creates their own restaurant on a 30 day trial', async () => {
  const [u] = await sql(`insert into auth.users (email) values ($1) returning id`, [`new-${w.tag}@t.ma`]);
  const slug = `mon-resto-${w.tag}`;
  assert.equal(await rpc(u, 'slug_available', [slug]), true);
  const rid = await rpc(u, 'signup_restaurant', ['Mon Resto', slug, 'Fès']);
  const [r] = await as(u, `select slug, status, trial_ends_at > now() + interval '29 days' ok, timezone from public.restaurants where id = $1`, [rid]);
  assert.deepEqual(r, { slug, status: 'trial', ok: true, timezone: 'UTC' });
  assert.equal(await rpc(u, 'slug_available', [slug]), false);
  await assert.rejects(rpc(u, 'signup_restaurant', ['Autre', slug, null]), /slug_taken/);
  await assert.rejects(rpc(u, 'signup_restaurant', ['Autre', 'Bad Slug', null]), /slug_taken/);
  // can immediately build the menu
  const [c] = await as(u, `insert into public.categories (restaurant_id, name) values ($1, '{"fr":"Cafés"}') returning id`, [rid]);
  assert.ok(c.id);
  // limit of 3 restaurants per account
  await rpc(u, 'signup_restaurant', ['R2', `r2-${w.tag}`, null]);
  await rpc(u, 'signup_restaurant', ['R3', `r3-${w.tag}`, null]);
  await assert.rejects(rpc(u, 'signup_restaurant', ['R4', `r4-${w.tag}`, null]), /too_many_restaurants/);
});

test('anonymous sessions and guests cannot create restaurants', async () => {
  const a = await anonUser();
  await assert.rejects(asAnon(a, `select public.signup_restaurant('X', $1, null)`, [`anon-${w.tag}`]), /not allowed/);
  await assert.rejects(as(null, `select public.signup_restaurant('X', $1, null)`, [`anon2-${w.tag}`]), /permission denied/);
});

test('pairing a till with a one-time code', async () => {
  await assert.rejects(rpc(w.users.deviceA, 'create_pairing_code', [w.A.r.id, 'Comptoir']), /not allowed/);
  const { code } = await rpc(w.users.managerA, 'create_pairing_code', [w.A.r.id, 'Comptoir']);
  assert.match(code, /^[A-Z2-9]{8}$/);

  const till = await anonUser();
  const res = await pair(till, code.toLowerCase());
  assert.equal(res.name, 'Resto A');
  const [m] = await sql(`select role, label from public.memberships where user_id = $1`, [till.id]);
  assert.deepEqual(m, { role: 'device', label: 'Comptoir' });

  // the till now works like any device: sees A's menu, nothing of B
  const own = await asAnon(till, `select count(*)::int n from public.menu_items where restaurant_id = $1`, [w.A.r.id]);
  const other = await asAnon(till, `select count(*)::int n from public.menu_items where restaurant_id = $1`, [w.B.r.id]);
  assert.ok(own[0].n > 0); assert.equal(other[0].n, 0);
  // and cannot edit the menu
  const upd = await asAnon(till, `update public.menu_items set price_cents = 1 where restaurant_id = $1 returning id`, [w.A.r.id]);
  assert.equal(upd.length, 0);

  // single use
  await assert.rejects(pair(await anonUser(), code), /invalid_code/);
  await assert.rejects(pair(await anonUser(), 'ZZZZZZZZ'), /invalid_code/);
});

test('expired codes do not work, owners cannot be downgraded', async () => {
  const { code } = await rpc(w.users.ownerA, 'create_pairing_code', [w.A.r.id, null]);
  await sql(`update app.device_pairings set expires_at = now() - interval '1 minute' where code = $1`, [code]);
  await assert.rejects(pair(await anonUser(), code), /invalid_code/);
  const { code: c2 } = await rpc(w.users.ownerA, 'create_pairing_code', [w.A.r.id, null]);
  await assert.rejects(rpc(w.users.ownerA, 'pair_device', [c2]), /already_member/);
  const [m] = await sql(`select role from public.memberships where user_id = $1 and restaurant_id = $2`, [w.users.ownerA.id, w.A.r.id]);
  assert.equal(m.role, 'owner');
});

test('owner revokes a till, which then loses all access', async () => {
  const { code } = await rpc(w.users.ownerA, 'create_pairing_code', [w.A.r.id, 'Terrasse']);
  const till = await anonUser();
  await pair(till, code);
  await assert.rejects(rpc(w.users.managerA, 'revoke_member', [w.A.r.id, till.id]), /not allowed/);
  await assert.rejects(rpc(w.users.ownerA, 'revoke_member', [w.A.r.id, w.users.ownerA.id]), /cannot_remove_yourself/);
  await rpc(w.users.ownerA, 'revoke_member', [w.A.r.id, till.id]);
  const n = await asAnon(till, `select count(*)::int n from public.orders where restaurant_id = $1`, [w.A.r.id]);
  assert.equal(n[0].n, 0);
  await assert.rejects(asAnon(till, `select public.day_report($1, null)`, [w.A.r.id]), /not allowed/);
});
