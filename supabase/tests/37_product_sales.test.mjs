// Sales per product over a period, and one product in detail.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, sql, rpc, world } from './helpers.mjs';

let w;
before(async () => { w = await world(); });
after(() => pool.end());

const closed = async (lines, day, extra = {}) => {
  // past days: written directly (the till only opens orders on today's business date)
  const [o] = await sql(`insert into public.orders (restaurant_id, client_id, business_date, ticket_number, source, order_type)
    values ($1, $2, $3, (select coalesce(max(ticket_number), 0) + 1 from public.orders where restaurant_id = $1 and business_date = $3), 'pos', 'takeaway') returning id`,
    [w.A.r.id, randomUUID(), day]);
  for (const l of lines) await sql(`insert into public.order_lines (restaurant_id, order_id, menu_item_id, variant_id, name, unit_price_cents, quantity, vat_bp)
    values ($1, $2, $3, $4, $5, $6, $7, 1000)`, [w.A.r.id, o.id, l.item_id ?? null, l.variant_id ?? null, l.name, l.price, l.qty ?? 1]);
  if (extra.discount) await sql(`update public.orders set discount_cents = $2 where id = $1`, [o.id, extra.discount]);
  await sql(`update public.orders set closed_at = now(), status = $2 where id = $1`, [o.id, extra.status ?? 'served']);
  // the order triggers pin the business date to today: move it to the past day (test only)
  await sql(`begin; set local session_replication_role = replica; update public.orders set business_date = '${day}' where id = '${o.id}'; commit;`);
  return o;
};

test('product sales: per product, previous period, discount spread, cancelled ignored, detail per day/weekday/size', async () => {
  const { items, variants, r } = w.A;
  const tajine = { item_id: items.tajine.id, name: 'Tajine', price: 8500, qty: 2 };
  // current period 2026-09-07 (Monday) .. 2026-09-13
  await closed([tajine, { item_id: items.jus.id, name: 'Jus', price: 2000 }], '2026-09-07', { discount: 1900 }); // 19000 -> 17100 (x0.9)
  await closed([{ ...tajine, qty: 1 }], '2026-09-12');
  await closed([{ item_id: items.pizza.id, variant_id: variants.pizzaL.id, name: 'Pizza L', price: 8000 }], '2026-09-12');
  await closed([{ item_id: items.pizza.id, variant_id: variants.pizzaS.id, name: 'Pizza S', price: 5000, qty: 3 }], '2026-09-13');
  await closed([{ name: 'Divers', price: 1000 }], '2026-09-13');
  await closed([{ ...tajine, qty: 5 }], '2026-09-10', { status: 'cancelled' });
  // previous period 2026-08-31 .. 2026-09-06
  await closed([{ ...tajine, qty: 1 }], '2026-09-01');

  const s = await rpc(w.users.managerA, 'product_sales', [r.id, '2026-09-07', '2026-09-13']);
  assert.equal(s.prev_from, '2026-08-31');
  const by = k => s.items.find(x => x.name.fr === k);
  assert.equal(by('Tajine').qty, 3);
  assert.equal(by('Tajine').prev_qty, 1);
  assert.equal(Number(by('Tajine').revenue_cents), 15300 + 8500, 'discount spread in proportion');
  assert.equal(Number(by('Jus').revenue_cents), 1800);
  assert.equal(by('Pizza').qty, 4);
  assert.equal(by('Divers').qty, 1, 'free lines are listed by name');
  assert.equal(by('Épuisé').qty, 0, 'products that did not sell are listed');
  assert.equal(s.totals.tickets, 5);
  assert.equal(Number(s.totals.discount_cents), 1900);
  assert.equal(s.items[0].name.fr, 'Tajine', 'sorted by revenue');

  const d = await rpc(w.users.managerA, 'product_detail', [r.id, items.pizza.id, null, '2026-09-07', '2026-09-13']);
  assert.equal(d.qty, 4);
  assert.equal(d.daily.length, 7);
  assert.equal(d.daily[6].qty, 3);
  assert.equal(d.weekdays.find(x => x.dow === 7).qty, 3, 'Sunday');
  assert.equal(d.weekdays[0].days, 1);
  assert.equal(d.hours.length, 24);
  assert.deepEqual(d.variants.map(v => [v.name.fr, Number(v.qty)]), [['S', 3], ['L', 1]]);
  assert.equal(d.tickets, 2); assert.equal(d.all_tickets, 5);
  const free = await rpc(w.users.managerA, 'product_detail', [r.id, null, 'divers', '2026-09-07', '2026-09-13']);
  assert.equal(free.qty, 1);

  // step 2: bought together, channel, staff
  const tj = await rpc(w.users.managerA, 'product_detail', [r.id, items.tajine.id, null, '2026-09-07', '2026-09-13']);
  assert.deepEqual(tj.together.map(x => [x.name.fr, x.tickets]), [['Jus', 1]]);
  assert.deepEqual(tj.channels.map(x => [x.channel, Number(x.qty)]), [['takeaway', 3]]);
  assert.equal(tj.staff.length, 1);

  // the old till joins in: quantities matched on the dish name, day totals in the totals
  await rpc(w.users.managerA, 'import_sales', [r.id, JSON.stringify([{ day: '2026-09-08', revenue_cents: 50000, tickets: 10 }]),
    JSON.stringify([{ day: '2026-09-08', name: 'tajine ', qty: 4 }, { day: '2026-09-08', name: 'Thé spécial', qty: 2 }])]);
  const s2 = await rpc(w.users.managerA, 'product_sales', [r.id, '2026-09-07', '2026-09-13']);
  const t2 = s2.items.find(x => x.name.fr === 'Tajine');
  assert.equal(t2.qty, 7); assert.equal(t2.history_qty, 4);
  assert.equal(Number(t2.revenue_cents), 15300 + 8500, 'revenue per product stays Amplify only');
  const the = s2.items.find(x => x.name.fr === 'Thé spécial');
  assert.equal(the.history_only, true); assert.equal(the.qty, 2);
  assert.equal(Number(s2.totals.revenue_cents), Number(s.totals.revenue_cents) + 50000);
  assert.equal(s2.totals.tickets, 15);
  const tj2 = await rpc(w.users.managerA, 'product_detail', [r.id, items.tajine.id, null, '2026-09-07', '2026-09-13']);
  assert.equal(tj2.history_qty, 4);
  assert.equal(tj2.daily.find(x => x.day === '2026-09-08').history_qty, 4);
  const th = await rpc(w.users.managerA, 'product_detail', [r.id, null, 'Thé spécial', '2026-09-07', '2026-09-13']);
  assert.equal(th.history_qty, 2);

  await assert.rejects(rpc(w.users.ownerB, 'product_sales', [r.id, '2026-09-07', '2026-09-13']), /not_allowed|not allowed/);
  await assert.rejects(rpc(w.users.deviceA, 'product_detail', [r.id, items.pizza.id, null, '2026-09-07', '2026-09-13']), /not_allowed|not allowed/);
  await assert.rejects(rpc(w.users.managerA, 'product_sales', [r.id, '2026-09-13', '2026-09-07']), /invalid_request/);
});
