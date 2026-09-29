// QR guest flow: public menu and placing orders without an account.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, uuid, guestOrder } from './helpers.mjs';

let w;
before(async () => { w = await world(); });
after(() => pool.end());

const place = (slug, order) => rpc(null, 'place_order', [slug, JSON.stringify(order)]);

test('get_menu returns the published menu and nothing internal', async () => {
  const m = await rpc(null, 'get_menu', [w.A.r.slug, w.A.tables.t1.qr_token]);
  assert.equal(m.restaurant.name, 'Resto A');
  assert.equal(m.ordering_enabled, true);
  assert.deepEqual(m.table, { label: '1', token: w.A.tables.t1.qr_token });

  const ids = m.items.map(i => i.id);
  assert.ok(ids.includes(w.A.items.tajine.id));
  assert.ok(ids.includes(w.A.items.soldout.id), 'sold out items are shown (greyed out)');
  assert.ok(!ids.includes(w.A.items.inactive.id), 'inactive items are hidden');
  assert.ok(!ids.includes(w.A.items.hiddenCat.id), 'items of inactive categories are hidden');
  assert.deepEqual(m.categories.map(c => c.name.fr), ['Plats', 'Boissons']);

  const pizza = m.items.find(i => i.id === w.A.items.pizza.id);
  assert.deepEqual(pizza.variants.map(v => v.name.fr), ['S', 'L'], 'inactive variant hidden');

  const text = JSON.stringify(m);
  for (const secret of ['001234567000089', 'SARL', 'RC 1234', 'Karim', w.B.r.id]) {
    assert.ok(!text.includes(secret), `menu leaks ${secret}`);
  }
});

test('get_menu: unknown slug gives null, a table token of B is ignored on A', async () => {
  assert.equal(await rpc(null, 'get_menu', ['does-not-exist', null]), null);
  const m = await rpc(null, 'get_menu', [w.A.r.slug, w.B.tables.t1.qr_token]);
  assert.equal(m.table, null);
  const off = await rpc(null, 'get_menu', [w.A.r.slug, w.A.tables.t9.qr_token]);
  assert.equal(off.table, null, 'inactive table');
});

test('prices always come from the database, never from the browser', async () => {
  const res = await place(w.A.r.slug, guestOrder(w.A.tables.t1.qr_token, [
    { item_id: w.A.items.tajine.id, quantity: 2, price_cents: 1, unit_price: 1 },
    { item_id: w.A.items.pizza.id, variant_id: w.A.variants.pizzaL.id, quantity: 1 },
  ], { total_cents: 100 }));
  assert.equal(Number(res.total_cents), 2 * 8500 + 8000);
  const lines = await sql(`select name, unit_price_cents, quantity, vat_bp, station from public.order_lines
                           where order_id = $1 order by unit_price_cents`, [res.order_id]);
  assert.deepEqual(lines.map(l => [l.name, Number(l.unit_price_cents), l.quantity, l.vat_bp, l.station]), [
    ['Pizza (L)', 8000, 1, 1000, 'kitchen'],
    ['Tajine', 8500, 2, 1000, 'kitchen'],
  ]);
  const [o] = await sql(`select * from public.orders where id = $1`, [res.order_id]);
  assert.equal(o.source, 'qr');
  assert.equal(o.table_id, w.A.tables.t1.id);
  assert.equal(o.status, 'new');
  assert.ok(o.ticket_number >= 1);
});

test('station and VAT follow the menu (bar item, 20% VAT)', async () => {
  const res = await place(w.A.r.slug, guestOrder(w.A.tables.t2.qr_token, [{ item_id: w.A.items.jus.id, quantity: 1 }]));
  const [l] = await sql(`select station, vat_bp from public.order_lines where order_id = $1`, [res.order_id]);
  assert.deepEqual([l.station, l.vat_bp], ['bar', 2000]);
});

test('same client_id twice gives the same order (safe retries)', async () => {
  const order = guestOrder(w.A.tables.t1.qr_token, [{ item_id: w.A.items.tajine.id, quantity: 1 }]);
  const a = await place(w.A.r.slug, order);
  const b = await place(w.A.r.slug, order);
  assert.equal(a.order_id, b.order_id);
  assert.equal(b.duplicate, true);
  const [{ n }] = await sql(`select count(*)::int n from public.orders where client_id = $1`, [order.client_id]);
  assert.equal(n, 1);
});

test('invalid orders are rejected', async () => {
  const t = w.A.tables.t1.qr_token;
  const cases = [
    [guestOrder(t, [{ item_id: w.A.items.pizza.id, quantity: 1 }]), /variant_required/],
    [guestOrder(t, [{ item_id: w.A.items.pizza.id, variant_id: w.A.variants.pizzaOff.id, quantity: 1 }]), /variant_required/],
    [guestOrder(t, [{ item_id: w.A.items.pizza.id, variant_id: w.B.variants.pizzaL.id, quantity: 1 }]), /variant_required/],
    [guestOrder(t, [{ item_id: w.A.items.tajine.id, variant_id: w.A.variants.pizzaS.id, quantity: 1 }]), /invalid_request/],
    [guestOrder(t, [{ item_id: w.A.items.soldout.id, quantity: 1 }]), /item_sold_out/],
    [guestOrder(t, [{ item_id: w.A.items.inactive.id, quantity: 1 }]), /item_unavailable/],
    [guestOrder(t, [{ item_id: w.A.items.hiddenCat.id, quantity: 1 }]), /item_unavailable/],
    [guestOrder(t, [{ item_id: w.B.items.tajine.id, quantity: 1 }]), /item_unavailable/],
    [guestOrder(t, [{ item_id: w.A.items.tajine.id, quantity: 0 }]), /invalid_request/],
    [guestOrder(t, [{ item_id: w.A.items.tajine.id, quantity: 21 }]), /invalid_request/],
    [guestOrder(t, [{ item_id: w.A.items.tajine.id, quantity: -1 }]), /invalid_request/],
    [guestOrder(t, [{ item_id: w.A.items.tajine.id, quantity: '1; drop table orders' }]), /invalid_request/],
    [guestOrder(t, []), /invalid_request/],
    [guestOrder(w.B.tables.t1.qr_token, [{ item_id: w.A.items.tajine.id, quantity: 1 }]), /invalid_table/],
    [guestOrder(w.A.tables.t9.qr_token, [{ item_id: w.A.items.tajine.id, quantity: 1 }]), /invalid_table/],
    [guestOrder(null, [{ item_id: w.A.items.tajine.id, quantity: 1 }]), /invalid_table/],
    [{ ...guestOrder(t, [{ item_id: w.A.items.tajine.id, quantity: 1 }]), client_id: 'nope' }, /invalid_request/],
    [{ ...guestOrder(t, [{ item_id: w.A.items.tajine.id, quantity: 1 }]), order_type: 'delivery' }, /order_type_unavailable/],
    [{ ...guestOrder(t, [{ item_id: w.A.items.tajine.id, quantity: 1 }]), order_type: 'takeaway' }, /customer_required/],
    [{ ...guestOrder(t, [{ item_id: w.A.items.tajine.id, quantity: 1 }]), note: 'x'.repeat(301) }, /invalid_request/],
  ];
  for (const [order, err] of cases) {
    await assert.rejects(place(w.A.r.slug, order), err, JSON.stringify(order).slice(0, 160));
  }
  await assert.rejects(place('does-not-exist', guestOrder(t, [{ item_id: w.A.items.tajine.id, quantity: 1 }])),
    /restaurant_not_found/);
});

test('takeaway with name and phone works', async () => {
  const res = await place(w.A.r.slug, {
    client_id: uuid(), order_type: 'takeaway', items: [{ item_id: w.A.items.tajine.id, quantity: 1 }],
    customer: { name: 'Youssef', phone: '0600000000' },
  });
  const [o] = await sql(`select order_type, customer_name, table_id from public.orders where id = $1`, [res.order_id]);
  assert.deepEqual([o.order_type, o.customer_name, o.table_id], ['takeaway', 'Youssef', null]);
});

test('guests cannot create orders directly, only through place_order', async () => {
  await assert.rejects(as(null,
    `insert into public.orders (restaurant_id, client_id, business_date, ticket_number, source, order_type)
     values ($1, $2, current_date, 0, 'qr', 'dine_in')`, [w.A.r.id, uuid()]), /permission denied/);
  // a till cannot fake a QR order either
  await assert.rejects(as(w.users.deviceA,
    `insert into public.orders (restaurant_id, client_id, business_date, ticket_number, source, order_type)
     values ($1, $2, current_date, 0, 'qr', 'dine_in')`, [w.A.r.id, uuid()]), /place_order/);
});

test('order status tracking for the guest', async () => {
  const res = await place(w.A.r.slug, guestOrder(w.A.tables.t2.qr_token, [{ item_id: w.A.items.tajine.id, quantity: 1 }]));
  let s = await rpc(null, 'get_order_status', [res.order_id]);
  assert.equal(s.status, 'new');
  await as(w.users.deviceA, `update public.orders set status = 'preparing' where id = $1`, [res.order_id]);
  s = await rpc(null, 'get_order_status', [res.order_id]);
  assert.equal(s.status, 'preparing');
  assert.equal(await rpc(null, 'get_order_status', [uuid()]), null);
});

test('paused restaurant or ended trial: menu visible, ordering off', async () => {
  const order = () => guestOrder(w.B.tables.t1.qr_token, [{ item_id: w.B.items.tajine.id, quantity: 1 }]);
  await sql(`update public.restaurants set status = 'paused' where id = $1`, [w.B.r.id]);
  let m = await rpc(null, 'get_menu', [w.B.r.slug, null]);
  assert.equal(m.ordering_enabled, false);
  await assert.rejects(place(w.B.r.slug, order()), /ordering_unavailable/);
  // the till is read only too
  await assert.rejects(as(w.users.deviceB,
    `insert into public.orders (restaurant_id, client_id, business_date, ticket_number, source, order_type)
     values ($1, $2, current_date, 0, 'pos', 'takeaway')`, [w.B.r.id, uuid()]), /row-level security/);

  await sql(`update public.restaurants set status = 'trial', trial_ends_at = now() - interval '1 day' where id = $1`, [w.B.r.id]);
  await assert.rejects(place(w.B.r.slug, order()), /ordering_unavailable/);

  await sql(`update public.restaurants set status = 'trial', trial_ends_at = now() + interval '5 days' where id = $1`, [w.B.r.id]);
  const ok = await place(w.B.r.slug, order());
  assert.ok(ok.order_id);

  await sql(`update public.restaurants set status = 'cancelled' where id = $1`, [w.B.r.id]);
  assert.equal(await rpc(null, 'get_menu', [w.B.r.slug, null]), null);
  await sql(`update public.restaurants set status = 'active' where id = $1`, [w.B.r.id]);
});

test('rate limit: at most 8 QR orders per table per 10 minutes', async () => {
  const t = w.A.tables.t2.qr_token;
  const [{ n }] = await sql(`select count(*)::int n from public.orders where table_id = $1 and source = 'qr'`, [w.A.tables.t2.id]);
  for (let i = n; i < 8; i++) {
    await place(w.A.r.slug, guestOrder(t, [{ item_id: w.A.items.tajine.id, quantity: 1 }]));
  }
  await assert.rejects(place(w.A.r.slug, guestOrder(t, [{ item_id: w.A.items.tajine.id, quantity: 1 }])), /rate_limited/);
});

test('ticket numbers are sequential per restaurant and day', async () => {
  const rows = await sql(`select ticket_number from public.orders where restaurant_id = $1 order by created_at, ticket_number`, [w.A.r.id]);
  const nums = rows.map(r => r.ticket_number);
  assert.deepEqual(nums, nums.map((_, i) => i + 1));
});
