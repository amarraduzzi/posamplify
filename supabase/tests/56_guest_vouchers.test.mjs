// Guest story actions: a one-time code for the next visit, built from the owner's settings.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world, tillOrder, guestOrder } from './helpers.mjs';

let w, A, rid, m;
before(async () => {
  w = await world(); A = w.A; rid = A.r.id; m = w.users.managerA;
  await sql(`update public.restaurants set timezone = 'Africa/Casablanca', opening_hours = '{}' where id = $1`, [rid]);
  const actions = [
    { id: 'a1', on: true, name: '-10 % prochaine visite', when: 'next', type: 'percent', value: 10, min: 50, valid_days: 30, delay: 'next_day' },
    { id: 'a2', on: true, name: '20 DH offerts', when: 'next', type: 'amount', value: 20, valid_days: 7, max_per_week: 1, in_store_only: true },
    { id: 'a3', on: true, name: 'Un café offert', when: 'table', type: 'gift' },
    { id: 'a4', on: false, name: 'Éteinte', when: 'next', type: 'percent', value: 50 },
  ];
  await sql(`update public.restaurants set branding = branding || jsonb_build_object('guest_actions', $2::jsonb) where id = $1`, [rid, JSON.stringify(actions)]);
});
after(() => pool.end());

let n = 0;
const guest = async () => {
  n += 1;
  const g = await rpc(null, 'place_order', [A.r.slug, JSON.stringify(guestOrder(null, [{ item_id: A.items.tajine.id, quantity: 1 }],
    { order_type: 'takeaway', customer: { name: `Guest ${n}`, phone: `067000010${n}` } }))]);
  return g.order_id;
};
const today = async () => (await sql(`select (now() at time zone 'Africa/Casablanca')::date::text d, ((now() at time zone 'Africa/Casablanca')::date + 1)::text nxt`))[0];

test('a voucher is unique, valid from tomorrow, and the same code comes back on a refresh', async () => {
  const id = await guest();
  const a = await rpc(null, 'issue_guest_voucher', [id, 'a1']);
  assert.equal(a.status, 'ok');
  const v = a.voucher;
  assert.match(v.code, /^[A-Z0-9]{0,2}-[A-Z2-9]{6}$/);
  assert.equal(v.discount_type, 'percent'); assert.equal(Number(v.value), 1000); assert.equal(Number(v.min_order_cents), 5000);
  const t = await today();
  assert.equal(v.starts_on, t.nxt);
  assert.equal(new Date(v.ends_on) - new Date(v.starts_on), 29 * 86400_000);
  assert.deepEqual(v.channels.sort(), ['online', 'pos']);
  const again = await rpc(null, 'issue_guest_voucher', [id, 'a1']);
  assert.equal(again.voucher.code, v.code, 'a refresh gives the same code');
  assert.equal(Number((await sql(`select count(*) c from public.promotions where voucher_order_id = $1`, [id]))[0].c), 1);
  // it is a normal one-use code, marked as a voucher
  const p = (await sql(`select * from public.promotions where code = $1`, [v.code]))[0];
  assert.equal(p.voucher, true); assert.equal(p.max_uses, 1); assert.equal(p.kind, 'code');
});

test('the till: not usable today, usable from its start day, once only, with the minimum', async () => {
  const id = await guest();
  const v = (await rpc(null, 'issue_guest_voucher', [id, 'a1'])).voucher;
  const o = await tillOrder(w.users.deviceA, rid, [{ item_id: A.items.tajine.id }, { item_id: A.items.tajine.id }]);
  await assert.rejects(rpc(w.users.deviceA, 'pos_apply_promo', [o.id, v.code]), /promo_invalid/, 'not before the next day');
  const t = await today();
  await sql(`update public.promotions set starts_on = $2 where code = $1`, [v.code, t.d]);
  const small = await tillOrder(w.users.deviceA, rid, [{ item_id: A.items.jus.id }]);
  await assert.rejects(rpc(w.users.deviceA, 'pos_apply_promo', [small.id, v.code]), /promo_minimum/);
  const res = await rpc(w.users.deviceA, 'pos_apply_promo', [o.id, v.code.toLowerCase()]);
  assert.equal(Number(res.discount_cents), Math.round(Number((await sql(`select subtotal_cents s from public.orders where id = $1`, [o.id]))[0].s) * 0.1));
  const o2 = await tillOrder(w.users.deviceA, rid, [{ item_id: A.items.tajine.id }, { item_id: A.items.tajine.id }]);
  await assert.rejects(rpc(w.users.deviceA, 'pos_apply_promo', [o2.id, v.code]), /promo_used_up/, 'one use only');
});

test('limits: weekly cap, till-only, gifts and switched-off actions give no code', async () => {
  const g1 = await guest(), g2 = await guest();
  const b = await rpc(null, 'issue_guest_voucher', [g1, 'a2']);
  assert.equal(b.status, 'ok'); assert.equal(b.voucher.discount_type, 'amount'); assert.equal(Number(b.voucher.value), 2000);
  assert.deepEqual(b.voucher.channels, ['pos'], 'till only');
  assert.equal((await rpc(null, 'issue_guest_voucher', [g2, 'a2'])).status, 'full', 'max 1 per week');
  assert.equal((await rpc(null, 'issue_guest_voucher', [g2, 'a3'])).status, 'none', 'a gift is handed over by the waiter, no code');
  assert.equal((await rpc(null, 'issue_guest_voucher', [g2, 'a4'])).status, 'none', 'switched off');
  assert.equal((await rpc(null, 'issue_guest_voucher', [g2, 'nope'])).status, 'none');
  assert.equal((await rpc(null, 'issue_guest_voucher', ['00000000-0000-4000-8000-000000000000', 'a1'])).status, 'none');
});

test('no story sharing, no voucher; old orders get none; vouchers stay out of the promotions report; stats for managers', async () => {
  const id = await guest();
  await sql(`update public.restaurants set branding = branding || '{"guest_share": false}'::jsonb where id = $1`, [rid]);
  assert.equal((await rpc(null, 'issue_guest_voucher', [id, 'a1'])).status, 'none');
  await sql(`update public.restaurants set branding = branding || '{"guest_share": true}'::jsonb where id = $1`, [rid]);
  const old = await guest();
  await sql(`alter table public.orders disable trigger user`);
  await sql(`update public.orders set created_at = now() - interval '20 hours' where id = $1`, [old]);
  await sql(`alter table public.orders enable trigger user`);
  assert.equal((await rpc(null, 'issue_guest_voucher', [old, 'a1'])).status, 'none', 'only for a fresh order');

  const day = (await rpc(w.users.deviceA, 'day_report', [rid, null])).business_date;
  const rep = await rpc(m, 'promo_report', [rid, day, day]);
  const ids = (await sql(`select id from public.promotions where voucher`)).map(x => x.id);
  assert.ok(ids.length >= 2);
  assert.ok(!rep.some(x => ids.includes(x.id)), 'vouchers are not in the report');

  const stats = await rpc(m, 'guest_voucher_stats', [rid, 30]);
  assert.ok(Number(stats.issued) >= 2); assert.ok(Number(stats.used) >= 1); assert.ok(Number(stats.given_cents) > 0);
  await assert.rejects(rpc(null, 'guest_voucher_stats', [rid, 30]));
});
