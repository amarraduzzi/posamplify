// Formules (ftour, groups): booked online for a day at a fixed time, covers per day, choices per guest,
// deposit per guest; the briefing gives the kitchen its list. Only with Amplify Maître.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, A, rid, d, offer, day;
before(async () => {
  w = await world(); A = w.A; rid = A.r.id; d = w.users.deviceA;
  await sql(`update public.restaurants set products = array_append(products, 'maitre') where id = $1`, [rid]);
  [{ day }] = await sql(`select ((now() at time zone timezone)::date + 2)::text as day from public.restaurants where id = $1`, [rid]);
});
after(() => pool.end());
const book = (b, user = null) => rpc(user, 'book_offer', [A.r.slug, JSON.stringify({ client_id: crypto.randomUUID(), name: 'Salma', phone: '0611111111', ...b })]);

test('the manager creates a ftour; the booking page shows it and the days left', async () => {
  [offer] = await as(w.users.managerA, `insert into public.booking_offers (restaurant_id, kind, name, price_cents, deposit_cents, options, min_party, max_party, at_time, covers)
     values ($1, 'ftour', 'Ftour royal', 25000, 10000, '{Classique,Végétarien}', 2, 12, '18:30', 10) returning *`, [rid]);
  const info = await rpc(null, 'get_booking_info', [A.r.slug]);
  assert.equal(info.offers.length, 1); assert.equal(info.offers[0].at_time, '18:30');
  const days = await rpc(null, 'offer_days', [A.r.slug, offer.id, 4]);
  assert.ok(days.some(x => x.day === day && x.left === 10));
  // the till cannot write formules
  await assert.rejects(as(d, `insert into public.booking_offers (restaurant_id, name) values ($1, 'X')`, [rid]));
});

test('booking: fixed time, deposit per guest, choices checked, covers per day respected', async () => {
  const b = await book({ offer_id: offer.id, day, party_size: 6, choices: { Classique: 4, 'Végétarien': 2 } });
  const [x] = await sql(`select * from public.reservations where token = $1`, [b.token]);
  assert.equal(Number(x.deposit_cents), 60000); assert.equal(x.status, 'requested'); assert.equal(x.offer_id, offer.id);
  const [{ hm }] = await sql(`select to_char(starts_at at time zone r.timezone, 'HH24:MI') hm from public.reservations x join public.restaurants r on r.id = x.restaurant_id where x.id = $1`, [x.id]);
  assert.equal(hm, '18:30');
  await assert.rejects(book({ offer_id: offer.id, day, party_size: 2, choices: { Poisson: 2 } }), /invalid_request/);
  await assert.rejects(book({ offer_id: offer.id, day, party_size: 1 }), /party_size/);
  await assert.rejects(book({ offer_id: offer.id, day, party_size: 6, phone: '0622222222' }), /slot_unavailable/); // 6 + 6 > 10
  const left = await rpc(null, 'offer_days', [A.r.slug, offer.id, 4]);
  assert.equal(left.find(y => y.day === day).left, 4);
  // the briefing: the formule and the choices of each booking
  const br = await rpc(d, 'pos_briefing', [rid, day]);
  const mine = br.bookings.find(y => y.id === x.id);
  assert.equal(mine.offer.name, 'Ftour royal'); assert.equal(mine.offer_choices['Végétarien'], 2);
  const st = await rpc(null, 'reservation_status', [b.token]);
  assert.equal(st.offer, 'Ftour royal');
});

test('closed days and without Amplify Maître: nothing to book', async () => {
  await as(w.users.managerA, `update public.booking_offers set weekdays = '{}', ends_on = (now()::date - 1) where id = $1`, [offer.id]);
  await assert.rejects(book({ offer_id: offer.id, day, party_size: 2 }), /slot_unavailable/);
  await as(w.users.managerA, `update public.booking_offers set ends_on = null where id = $1`, [offer.id]);
  await sql(`update public.restaurants set products = array_remove(products, 'maitre') where id = $1`, [rid]);
  await assert.rejects(book({ offer_id: offer.id, day, party_size: 2 }), /booking_off/);
  assert.deepEqual((await rpc(null, 'get_booking_info', [A.r.slug])).offers, []);
});
