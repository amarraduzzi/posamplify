// Own online ordering: opening hours or a later time, pause, delivery minimum and fee,
// the guest's location, the ready time from the till, and a limit per phone number.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, guestOrder } from './helpers.mjs';

let w, A;
before(async () => {
  w = await world(); A = w.A;
  await sql(`update public.restaurants set accept_delivery = true, timezone = 'Africa/Casablanca' where id = $1`, [A.r.id]);
});
after(() => pool.end());
let n = 0;
const order = (type, items, extra = {}) => rpc(null, 'place_order', [A.r.slug, JSON.stringify(guestOrder(null, items,
  { order_type: type, customer: { name: 'Sara', phone: `06000000${String(++n).padStart(2, '0')}`, address: 'Rue 1, Agdal' }, ...extra }))]);
const jus = (q = 1) => [{ item_id: A.items.jus.id, quantity: q }];
const setOnline = (o) => as(w.users.ownerA, `update public.restaurants set online = $2 where id = $1`, [A.r.id, JSON.stringify(o)]);
const hours = async (h) => sql(`update public.restaurants set opening_hours = $2 where id = $1`, [A.r.id, JSON.stringify(h)]);

test('closed now: refused, unless the guest asks for a time when it is open', async () => {
  const [{ dow, nowh }] = await sql(`select lower(to_char(now() at time zone 'Africa/Casablanca', 'dy')) dow, extract(hour from now() at time zone 'Africa/Casablanca')::int nowh`);
  // open only in a 1-hour window 3 hours from now (same day when possible)
  const start = (nowh + 3) % 24, end = (nowh + 4) % 24;
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  await hours(Object.fromEntries(days.map(d => [d, [[`${String(start).padStart(2, '0')}:10`, `${String(end).padStart(2, '0')}:00`]]])));
  const menu = await rpc(null, 'get_menu', [A.r.slug, null]);
  assert.equal(menu.online.open_now, false);
  await assert.rejects(order('takeaway', jus()), /closed/);
  const [{ x: at }] = await sql(`select date_trunc('hour', now()) + interval '3 hours 30 minutes' x`);
  const res = await order('takeaway', jus(), { wanted_at: at.toISOString() });
  const [o] = await sql(`select wanted_at from public.orders where id = $1`, [res.order_id]);
  assert.equal(o.wanted_at.toISOString(), at.toISOString());
  // too soon (before the preparation time) is refused
  await assert.rejects(order('takeaway', jus(), { wanted_at: new Date(Date.now() + 60000).toISOString() }), /invalid_request/);
  await hours({});
  void dow;
});

test('pause, delivery minimum and fee, location, ready time', async () => {
  await setOnline({ paused_until: new Date(Date.now() + 1800e3).toISOString() });
  assert.equal((await rpc(null, 'get_menu', [A.r.slug, null])).online.paused, true);
  await assert.rejects(order('takeaway', jus()), /online_paused/);
  await setOnline({ prep_minutes: 25, delivery_fee_cents: 1500, delivery_min_cents: 5000, delivery_free_from_cents: 15000, delivery_area: 'Agdal, Hay Riad' });
  const m = (await rpc(null, 'get_menu', [A.r.slug, null])).online;
  assert.deepEqual([m.prep_minutes, Number(m.delivery_fee_cents), m.delivery_area, m.paused], [25, 1500, 'Agdal, Hay Riad', false]);
  await assert.rejects(order('delivery', jus(2)), /below_minimum/, '40 DH < 50 DH');
  const res = await order('delivery', jus(3), { location: { lat: 33.99, lng: -6.85 } });
  assert.equal(Number(res.total_cents), 6000 + 1500, 'fee added');
  const lines = await sql(`select name, unit_price_cents, kitchen_sent_at from public.order_lines where order_id = $1 order by created_at`, [res.order_id]);
  assert.deepEqual(lines.map(l => l.name), ['Jus', 'Livraison']);
  assert.ok(lines[1].kitchen_sent_at, 'the fee never goes to the kitchen');
  const [o] = await sql(`select delivery_location from public.orders where id = $1`, [res.order_id]);
  assert.deepEqual(o.delivery_location, { lat: 33.99, lng: -6.85 });
  const free = await order('delivery', jus(8));
  assert.equal(Number(free.total_cents), 16000, 'free from 150 DH');
  // the till accepts with a ready time; the guest sees it
  const eta = new Date(Date.now() + 25 * 60000).toISOString();
  await as(w.users.deviceA, `update public.orders set status = 'preparing', eta_at = $2 where id = $1`, [res.order_id, eta]);
  const st = await rpc(null, 'get_order_status', [res.order_id]);
  assert.equal(st.order_type, 'delivery');
  assert.equal(new Date(st.eta_at).toISOString(), eta);
});

test('one phone number cannot flood the restaurant', async () => {
  await setOnline({});
  const one = (i) => rpc(null, 'place_order', [A.r.slug, JSON.stringify(guestOrder(null, jus(), { order_type: 'takeaway', customer: { name: 'X', phone: '0699999999' } }))]);
  for (let i = 0; i < 4; i++) await one(i);
  await assert.rejects(one(5), /rate_limited/);
});

test('the till can pause and resume online orders', async () => {
  const res = await rpc(w.users.deviceA, 'online_pause', [A.r.id, 30]);
  assert.ok(res.paused_until);
  assert.equal((await rpc(null, 'get_menu', [A.r.slug, null])).online.paused, true);
  await rpc(w.users.deviceA, 'online_pause', [A.r.id, 0]);
  assert.equal((await rpc(null, 'get_menu', [A.r.slug, null])).online.paused, false);
  await assert.rejects(rpc(w.users.deviceB, 'online_pause', [A.r.id, 30]), /not allowed/);
});
