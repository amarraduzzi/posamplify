// Promotions: happy hour prices on lines (till and online), promo codes with rules,
// a percentage that follows the order, categories with a schedule.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder, guestOrder } from './helpers.mjs';

let w, A, rid, m;
before(async () => {
  w = await world(); A = w.A; rid = A.r.id; m = w.users.managerA;
  await sql(`update public.restaurants set timezone = 'Africa/Casablanca', opening_hours = '{}' where id = $1`, [rid]);
});
after(() => pool.end());
const promo = async (row) => (await as(m, `insert into public.promotions (restaurant_id, kind, name, value, discount_type, category_ids, item_ids, days, start_time, end_time, code, min_order_cents, max_uses, once_per_phone, channels, starts_on, ends_on)
  values ($1, $2, $3, $4, coalesce($5, 'percent'), coalesce($6, '{}')::uuid[], coalesce($7, '{}')::uuid[], coalesce($8, '{1,2,3,4,5,6,7}')::int[], $9, $10, $11, coalesce($12, 0), $13, coalesce($14, false), coalesce($15, '{pos,online}')::text[], $16, $17) returning *`,
  [rid, row.kind, row.name ?? 'P', row.value, row.type, row.cats, row.items, row.days, row.from, row.to, row.code, row.min, row.max, row.once, row.channels, row.d1, row.d2]))[0];
const fresh = async (id) => (await sql(`select * from public.orders where id = $1`, [id]))[0];
const nowLocal = async () => (await sql(`select to_char(now() at time zone 'Africa/Casablanca', 'HH24:MI') t, extract(isodow from now() at time zone 'Africa/Casablanca')::int d`))[0];

test('happy hour: drinks -30 % now, the line keeps the list price', async () => {
  const { d } = await nowLocal();
  const hh = await promo({ kind: 'happy_hour', name: 'Happy hour', value: 3000, cats: `{${A.cats.boissons.id}}`, days: `{${d}}` });
  const o = await tillOrder(w.users.deviceA, rid, [{ item_id: A.items.jus.id, qty: 2 }, { item_id: A.items.tajine.id }]);
  const lines = await sql(`select menu_item_id, unit_price_cents, list_price_cents, promo_id from public.order_lines where order_id = $1`, [o.id]);
  const jus = lines.find(l => l.menu_item_id === A.items.jus.id), taj = lines.find(l => l.menu_item_id === A.items.tajine.id);
  assert.deepEqual([Number(jus.unit_price_cents), Number(jus.list_price_cents), jus.promo_id], [1400, 2000, hh.id]);
  assert.equal(taj.promo_id, null);
  assert.equal(Number(o.total_cents), 2800 + 8500);
  // the menu shows it
  const menu = await rpc(null, 'get_menu', [A.r.slug, null]);
  assert.equal(menu.items.find(i => i.id === A.items.jus.id).promo_bp, 3000);
  assert.equal(menu.promotions[0].name, 'Happy hour');
  // another day: no discount
  await as(m, `update public.promotions set days = $2 where id = $1`, [hh.id, `{${d % 7 + 1}}`]);
  const o2 = await tillOrder(w.users.deviceA, rid, [{ item_id: A.items.jus.id }]);
  assert.equal(Number(o2.total_cents), 2000);
  await as(m, `update public.promotions set active = false where id = $1`, [hh.id]);
});

test('promo codes: rules, a percentage that follows the order, online', async () => {
  await promo({ kind: 'code', name: 'Bienvenue', code: 'BIENVENUE', value: 1000, min: 5000, once: true });
  await promo({ kind: 'code', name: 'Fixe', code: 'MOINS20', type: 'amount', value: 2000, max: 1, channels: '{pos}' });
  const o = await tillOrder(w.users.deviceA, rid, [{ item_id: A.items.jus.id }]);
  await assert.rejects(rpc(w.users.deviceA, 'pos_apply_promo', [o.id, 'NOPE']), /promo_invalid/);
  await assert.rejects(rpc(w.users.deviceA, 'pos_apply_promo', [o.id, 'bienvenue']), /promo_minimum/);
  await as(w.users.deviceA, `insert into public.order_lines (restaurant_id, order_id, menu_item_id, name, unit_price_cents, quantity, vat_bp) values ($1, $2, $3, '-', 0, 1, 0)`, [rid, o.id, A.items.tajine.id]);
  await assert.rejects(rpc(w.users.deviceA, 'pos_apply_promo', [o.id, 'bienvenue']), /promo_phone_required/, 'once per phone needs a phone');
  const res = await rpc(w.users.deviceA, 'pos_apply_promo', [o.id, 'moins20']);
  assert.equal(Number(res.total_cents), 10500 - 2000);
  // a percentage code follows the order: 10 % of 105 DH, then of 190 DH
  const g = await rpc(null, 'place_order', [A.r.slug, JSON.stringify(guestOrder(null, [{ item_id: A.items.tajine.id, quantity: 1 }],
    { order_type: 'takeaway', customer: { name: 'Nora', phone: '0670000001' }, promo_code: 'BIENVENUE' }))]);
  assert.equal(Number(g.total_cents), 8500 - 850);
  await as(w.users.deviceA, `insert into public.order_lines (restaurant_id, order_id, menu_item_id, name, unit_price_cents, quantity, vat_bp) values ($1, $2, $3, '-', 0, 1, 0)`, [rid, g.order_id, A.items.tajine.id]);
  assert.equal(Number((await fresh(g.order_id)).discount_cents), 1700);
  // the same phone cannot use it twice; a POS-only code does not work online
  await assert.rejects(rpc(null, 'place_order', [A.r.slug, JSON.stringify(guestOrder(null, [{ item_id: A.items.tajine.id, quantity: 1 }],
    { order_type: 'takeaway', customer: { name: 'Nora', phone: '+212 670 000 001' }, promo_code: 'BIENVENUE' }))]), /promo_already_used/);
  await assert.rejects(rpc(null, 'check_promo_code', [A.r.slug, 'MOINS20', 10000]), /promo_invalid/);
  assert.equal((await rpc(null, 'check_promo_code', [A.r.slug, 'bienvenue', 6000])).value, 1000);
  // max uses: MOINS20 already on one order
  const o3 = await tillOrder(w.users.deviceA, rid, [{ item_id: A.items.tajine.id }]);
  await assert.rejects(rpc(w.users.deviceA, 'pos_apply_promo', [o3.id, 'MOINS20']), /promo_used_up/);
  // the till cannot write a discount itself, the code can be removed
  await rpc(w.users.deviceA, 'pos_remove_promo', [o.id]);
  assert.equal(Number((await fresh(o.id)).discount_cents), 0);
  // the report
  const pay = (x) => rpc(w.users.deviceA, 'pos_pay_order', [x.id, JSON.stringify([{ method: 'cash', amount_cents: Number(x.total_cents) }]), null, null]);
  await pay(await fresh(g.order_id));
  const day = (await rpc(w.users.deviceA, 'day_report', [rid, null])).business_date;
  const rep = await rpc(m, 'promo_report', [rid, day, day]);
  const b = rep.find(x => x.name === 'Bienvenue');
  assert.deepEqual([b.orders, Number(b.given_cents)], [1, 1700]);
});

test('categories by time: hidden and refused outside the schedule', async () => {
  const { d } = await nowLocal();
  const other = d % 7 + 1;
  await as(m, `update public.categories set schedule = $2 where id = $1`, [A.cats.boissons.id, JSON.stringify({ days: [other] })]);
  const menu = await rpc(null, 'get_menu', [A.r.slug, null]);
  assert.ok(!menu.categories.some(c => c.id === A.cats.boissons.id));
  assert.ok(!menu.items.some(i => i.id === A.items.jus.id));
  await assert.rejects(rpc(null, 'place_order', [A.r.slug, JSON.stringify(guestOrder(null, [{ item_id: A.items.jus.id, quantity: 1 }],
    { order_type: 'takeaway', customer: { name: 'X', phone: '0670000009' } }))]), /item_unavailable/);
  // Ramadan-like dates: a range that ended yesterday hides it too, today opens it
  const [{ y, t }] = await sql(`select ((now() at time zone 'Africa/Casablanca')::date - 1)::text y, (now() at time zone 'Africa/Casablanca')::date::text t`);
  await as(m, `update public.categories set schedule = $2 where id = $1`, [A.cats.boissons.id, JSON.stringify({ start_on: y, end_on: y })]);
  assert.ok(!(await rpc(null, 'get_menu', [A.r.slug, null])).items.some(i => i.id === A.items.jus.id));
  await as(m, `update public.categories set schedule = $2 where id = $1`, [A.cats.boissons.id, JSON.stringify({ start_on: y, end_on: t })]);
  assert.ok((await rpc(null, 'get_menu', [A.r.slug, null])).items.some(i => i.id === A.items.jus.id));
  // a window past midnight
  const [{ ok }] = await sql(`select app.in_window('{1,2,3,4,5,6,7}', '22:00', '02:00', null, null, 'UTC', '2026-10-08 01:00+00') ok`);
  assert.equal(ok, true);
});
