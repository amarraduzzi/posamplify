// Reservations and waitlist: free times from hours and seats, booking checked again,
// the guest's private link, the host stand, no-shows, the queue with its position.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, A, slug, tomorrow;
before(async () => {
  w = await world(); A = w.A; slug = A.r.slug;
  await sql(`update public.restaurants set timezone = 'Africa/Casablanca', opening_hours = '{}' where id = $1`, [A.r.id]);
  [{ d: tomorrow }] = await sql(`select ((now() at time zone 'Africa/Casablanca')::date + 1)::text d`);
});
after(() => pool.end());
const cfg = (b) => as(w.users.ownerA, `update public.restaurants set booking = $2 where id = $1`, [A.r.id, JSON.stringify(b)]);
const at = async (hhmm) => (await sql(`select ($1::date + $2::time) at time zone 'Africa/Casablanca' t`, [tomorrow, hhmm]))[0].t.toISOString();
let n = 0;
const book = (t, party, extra = {}) => rpc(null, 'book_table', [slug, JSON.stringify({ starts_at: t, party_size: party, name: 'Amine', phone: `06612300${String(++n).padStart(2, '0')}`, ...extra })]);

test('off by default; then free times by hours and seats', async () => {
  await assert.rejects(rpc(null, 'booking_slots', [slug, tomorrow, 2]), /booking_off/);
  assert.equal((await rpc(null, 'get_booking_info', [slug])).enabled, false);
  await cfg({ enabled: true, capacity: 10, duration_min: 120, slot_minutes: 30 });
  await sql(`update public.restaurants set opening_hours = $2 where id = $1`, [A.r.id, JSON.stringify(Object.fromEntries(['mon','tue','wed','thu','fri','sat','sun'].map(d => [d, [['19:00', '23:00']]])))]);
  let s = await rpc(null, 'booking_slots', [slug, tomorrow, 2]);
  assert.equal(s.length, 7, '19:00 .. 22:00 (still open 45 minutes later)');
  assert.equal(new Date(s[0]).toISOString(), await at('19:00'));
  await assert.rejects(rpc(null, 'booking_slots', [slug, tomorrow, 9]), /party_too_big/);
  // 8 seats taken at 20:00 for 2 hours: a party of 4 cannot sit from 18:30 to 21:30
  const r1 = await book(await at('20:00'), 8);
  assert.equal(r1.status, 'requested');
  s = (await rpc(null, 'booking_slots', [slug, tomorrow, 4])).map(x => new Date(x).toISOString());
  assert.ok(!s.includes(await at('20:00')) && !s.includes(await at('19:00')) && s.includes(await at('22:00')));
  // two at once: the second one is refused
  await assert.rejects(book(await at('20:30'), 4), /slot_unavailable/);
  await book(await at('20:30'), 2);
  // the same request twice (client_id) gives the same booking
  const cid = '11111111-2222-3333-4444-555555555555';
  const a1 = await book(await at('22:00'), 2, { client_id: cid });
  const a2 = await book(await at('22:00'), 2, { client_id: cid });
  assert.equal(a1.token, a2.token); assert.equal(a2.duplicate, true);
  // closed hours and too soon are refused
  await assert.rejects(book(await at('12:00'), 2), /slot_unavailable/);
});

test('the guest page, cancel, the host stand, no-show history', async () => {
  await cfg({ enabled: true, capacity: 30, auto_confirm: true, note: 'Table gardée 15 minutes.' });
  const b = await book(await at('19:30'), 2, { phone: '0661999888' });
  assert.equal(b.status, 'confirmed');
  const st = await rpc(null, 'reservation_status', [b.token]);
  assert.deepEqual([st.status, st.party_size, st.restaurant.note], ['confirmed', 2, 'Table gardée 15 minutes.']);
  // the till sees the list and marks no-show
  const [x] = await as(w.users.deviceA, `select * from public.reservations where token = $1`, [b.token]);
  assert.ok(x.confirmed_at);
  await as(w.users.deviceA, `update public.reservations set status = 'no_show' where id = $1`, [x.id]);
  const h = await rpc(w.users.deviceA, 'guest_history', [A.r.id, '+212 661 999 888']);
  assert.equal(h.no_shows, 1);
  await assert.rejects(rpc(null, 'reservation_cancel', [b.token]), /too_late/);
  const b2 = await book(await at('21:00'), 2);
  await rpc(null, 'reservation_cancel', [b2.token]);
  assert.equal((await rpc(null, 'reservation_status', [b2.token])).status, 'cancelled');
  // a phone booking by the staff
  await as(w.users.deviceA, `insert into public.reservations (restaurant_id, kind, status, source, starts_at, party_size, name, phone) values ($1, 'booking', 'confirmed', 'phone', $2, 4, 'Karim', '0611')`.replace("'0611'", "'0612345678'"), [A.r.id, await at('20:00')]);
  // privacy: B sees nothing, guests cannot read the table
  assert.equal((await as(w.users.deviceB, `select * from public.reservations where restaurant_id = $1`, [A.r.id])).length, 0);
  await assert.rejects(as(null, `select * from public.reservations`), /permission denied/);
});

test('waitlist: join at the door, position, called, seated', async () => {
  await cfg({ enabled: true, waitlist: true });
  await sql(`update public.restaurants set opening_hours = '{}' where id = $1`, [A.r.id]);
  const join = (name, phone) => rpc(null, 'waitlist_join', [slug, JSON.stringify({ name, phone, party_size: 3 })]);
  const a = await join('Leila', '0677000001');
  const b = await join('Omar', '0677000002');
  await assert.rejects(join('Omar', '0677000002'), /already_waiting/);
  assert.equal((await rpc(null, 'reservation_status', [b.token])).ahead, 1);
  const [xa] = await as(w.users.deviceA, `select id from public.reservations where token = $1`, [a.token]);
  await as(w.users.deviceA, `update public.reservations set status = 'called' where id = $1`, [xa.id]);
  const sa = await rpc(null, 'reservation_status', [a.token]);
  assert.equal(sa.status, 'called'); assert.ok(sa.called_at);
  assert.equal((await rpc(null, 'reservation_status', [b.token])).ahead, 0, 'Leila was called: Omar is next');
  await as(w.users.deviceA, `update public.reservations set status = 'seated' where id = $1`, [xa.id]);
  await cfg({ enabled: true, waitlist: false });
  await assert.rejects(join('X', '0677000003'), /waitlist_off/);
});
