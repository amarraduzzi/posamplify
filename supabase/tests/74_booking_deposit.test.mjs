// Booking guarantee: the rule asks a deposit, the till receives it (the booking is confirmed), the bill
// uses it once, the rest is refunded or kept with a manager PIN; the drawer of the day counts the cash.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, A, rid, d;
before(async () => {
  w = await world(); A = w.A; rid = A.r.id; d = w.users.deviceA;
  // Amplify Maître switched on for this restaurant
  await sql(`update public.restaurants set products = array_append(products, 'maitre') where id = $1`, [rid]);
});
after(() => pool.end());
const book = async (party, extra = '') => (await as(d,
  `insert into public.reservations (restaurant_id, kind, status, source, starts_at, party_size, name, phone ${extra ? ', occasion' : ''})
   values ($1, 'booking', 'requested', 'online', now() + interval '1 hour', $2, 'Groupe', '0612121212' ${extra ? ", '" + extra + "'" : ''}) returning *`, [rid, party]))[0];
const left = async id => Number((await sql(`select app.deposit_left($1, $2) n`, [rid, id]))[0].n);
const day = async () => rpc(d, 'day_report', [rid, null]);

test('the rule asks a deposit from N guests online; the till cannot change the state of the money', async () => {
  await as(w.users.ownerA, `update public.restaurants set booking = booking || '{"enabled": true, "deposit_party": 6, "deposit_cents": 10000}' where id = $1`, [rid]);
  const small = await book(4);
  assert.equal(small.deposit_cents, null); assert.equal(small.deposit_state, null);
  const big = await book(8, 'birthday');
  assert.equal(Number(big.deposit_cents), 80000); assert.equal(big.deposit_state, 'due'); assert.equal(big.occasion, 'birthday');
  await as(d, `update public.reservations set deposit_state = 'paid' where id = $1`, [big.id]);
  assert.equal((await sql(`select deposit_state from public.reservations where id = $1`, [big.id]))[0].deposit_state, 'due');
  // the host lowers the amount asked while nothing came in
  await as(d, `update public.reservations set deposit_cents = 50000 where id = $1`, [big.id]);
  assert.equal(Number((await sql(`select deposit_cents from public.reservations where id = $1`, [big.id]))[0].deposit_cents), 50000);
  // at the host stand the till decides (no rule applied by the server)
  const [desk] = await as(d, `insert into public.reservations (restaurant_id, kind, status, source, starts_at, party_size, name) values ($1, 'booking', 'confirmed', 'phone', now() + interval '1 hour', 8, 'Comptoir') returning deposit_cents`, [rid]);
  assert.equal(desk.deposit_cents, null);
  const info = await rpc(null, 'get_booking_info', [A.r.slug]);
  assert.equal(info.deposit_party, 6); assert.equal(Number(info.deposit_cents), 10000);
});

test('received in cash: confirmed, in the drawer; used once at the bill; the rest refunded with a PIN', async () => {
  const before = await day();
  const b = await book(8);
  const r1 = await rpc(d, 'pos_deposit_receive', [b.id, 50000, 'cash', null, A.staff.sara.id]);
  assert.equal(r1.status, 'confirmed'); assert.equal(Number(r1.left_cents), 50000);
  let after = await day();
  assert.equal(Number(after.expected_cash_cents) - Number(before.expected_cash_cents), 50000);
  assert.equal(Number(after.advances_received_cents) - Number(before.advances_received_cents || 0), 50000);
  // the evening: a bill of 2 tajines, the order of the guest's phone finds the deposit
  const o = await tillOrder(d, rid, [{ item_id: A.items.tajine.id, qty: 2 }]);
  await as(d, `update public.orders set customer_phone = '0612121212' where id = $1`, [o.id]);
  const found = await rpc(d, 'pos_order_deposits', [o.id]);
  assert.equal(found.length, 1); assert.equal(found[0].reservation_id, b.id);
  const [fresh] = await sql(`select total_cents from public.orders where id = $1`, [o.id]);
  const tot = Number(fresh.total_cents); // less than the deposit
  await assert.rejects(rpc(d, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'deposit', amount_cents: tot + 50000, tip_cents: 0, reservation_id: b.id }]), null, null]), /deposit_too_small|payment_mismatch/);
  await assert.rejects(rpc(d, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'deposit', amount_cents: tot, tip_cents: 0 }]), null, null]), /invalid_request/);
  const paid = await rpc(d, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'deposit', amount_cents: tot, tip_cents: 0, reservation_id: b.id }]), null, null]);
  assert.ok(paid);
  assert.equal(await left(b.id), 50000 - tot);
  // the cash of the drawer does not count the deposit twice
  after = await day();
  assert.equal(Number(after.expected_cash_cents) - Number(before.expected_cash_cents), 50000);
  assert.equal(Number(after.payments.deposit), tot);
  // the rest goes back: wrong PIN, then the manager
  const bad = await rpc(d, 'pos_deposit_close', [b.id, 'refund', 'cash', A.staff.sara.id, '1111']);
  assert.equal(bad.ok, false);
  const ok = await rpc(d, 'pos_deposit_close', [b.id, 'refund', 'cash', A.staff.karim.id, '9999']);
  assert.equal(Number(ok.amount_cents), 50000 - tot);
  assert.equal(await left(b.id), 0);
  after = await day();
  assert.equal(Number(after.expected_cash_cents) - Number(before.expected_cash_cents), tot);
  assert.equal((await sql(`select deposit_state from public.reservations where id = $1`, [b.id]))[0].deposit_state, 'refunded');
});

test('a no-show: the deposit is kept, only after the booking is closed', async () => {
  const b = await book(6);
  await rpc(d, 'pos_deposit_receive', [b.id, 60000, 'transfer', 'VIR-123', null]);
  await assert.rejects(rpc(d, 'pos_deposit_close', [b.id, 'kept', null, A.staff.karim.id, '9999']), /booking_not_closed/);
  await as(d, `update public.reservations set status = 'no_show' where id = $1`, [b.id]);
  const k = await rpc(d, 'pos_deposit_close', [b.id, 'kept', null, A.staff.karim.id, '9999']);
  assert.equal(Number(k.amount_cents), 60000);
  const rep = await day();
  assert.ok(Number(rep.advances_kept_cents) >= 60000);
  await assert.rejects(rpc(d, 'pos_deposit_receive', [b.id, 100, 'cash', null, null]), /booking_closed/);
});

test('another restaurant cannot touch it', async () => {
  const b = await book(6);
  await assert.rejects(rpc(w.users.deviceB, 'pos_deposit_receive', [b.id, 100, 'cash', null, null]));
});

test('without Amplify Maître: no new deposit, no rule online, no briefing, no profile; money already received still works', async () => {
  const b = await book(8);
  await rpc(d, 'pos_deposit_receive', [b.id, 10000, 'cash', null, null]);
  await sql(`update public.restaurants set products = array_remove(products, 'maitre') where id = $1`, [rid]);
  const nb = await book(8);
  assert.equal(nb.deposit_cents, null);
  await assert.rejects(rpc(d, 'pos_deposit_receive', [nb.id, 100, 'cash', null, null]), /maitre_off/);
  await assert.rejects(rpc(d, 'pos_briefing', [rid, null]), /maitre_off/);
  assert.deepEqual(await rpc(d, 'pos_guests', [rid, [], ['0612121212']]), []);
  const info = await rpc(null, 'get_booking_info', [A.r.slug]);
  assert.equal(info.deposit_party, null);
  const ok = await rpc(d, 'pos_deposit_close', [b.id, 'refund', 'cash', A.staff.karim.id, '9999']);
  assert.equal(Number(ok.amount_cents), 10000);
  // the platform cannot give Maître without the till
  const [prod] = await sql(`select products from public.restaurants where id = $1`, [rid]);
  assert.ok(!prod.products.includes('maitre'));
});
