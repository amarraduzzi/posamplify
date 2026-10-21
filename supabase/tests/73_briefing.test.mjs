// Le Briefing: the bookings of a day with what the team must know about each guest.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, A, rid, d, day;
before(async () => {
  w = await world(); A = w.A; rid = A.r.id; d = w.users.deviceA;
  [{ day }] = await sql(`select (now() at time zone timezone)::date::text as day from public.restaurants where id = $1`, [rid]);
});
after(() => pool.end());
const book = (name, phone, at, status = 'confirmed', party = 2) => sql(
  `insert into public.reservations (restaurant_id, kind, status, source, starts_at, party_size, name, phone)
   values ($1, 'booking', $2, 'staff', ($3::date + $4::time) at time zone (select timezone from public.restaurants where id = $1), $5, $6, $7) returning id`,
  [rid, status, day, at, party, name, phone]);

test('the day: bookings in order, cancelled ones left out, guests known by phone', async () => {
  await as(w.users.ownerA, `update public.restaurants set loyalty = '{"customers": true}' where id = $1`, [rid]);
  await sql(`insert into public.customers (restaurant_id, phone, name, visits, tags, allergies, birthday)
             values ($1, '0611111111', 'Salma', 9, '{VIP}', 'Noix', ($2::date - interval '30 years' + interval '2 days')::date)`, [rid, day]);
  await book('Salma', '0611111111', '20:30');
  await book('Omar', '0622222222', '19:00', 'requested', 4);
  await book('Parti', '0633333333', '21:00', 'cancelled');
  await book('Omar', '0622222222', '12:00', 'no_show');
  const b = await rpc(d, 'pos_briefing', [rid, day]);
  assert.equal(b.day, day);
  assert.deepEqual(b.bookings.map(x => x.name), ['Omar', 'Salma']);
  const salma = b.bookings[1];
  assert.equal(salma.guest.allergies, 'Noix');
  assert.deepEqual(salma.guest.tags, ['VIP']);
  assert.equal(salma.birthday_in, 2);
  assert.equal(b.bookings[0].guest, null);
  assert.equal(b.bookings[0].no_shows, 1);
});

test('without a customer file: the bookings, no profile', async () => {
  await as(w.users.ownerA, `update public.restaurants set loyalty = '{}' where id = $1`, [rid]);
  const b = await rpc(d, 'pos_briefing', [rid, null]);
  assert.equal(b.files, false);
  assert.equal(b.bookings.length, 2);
  assert.equal(b.bookings[1].guest, null);
  assert.equal(b.bookings[1].birthday_in, null);
});

test('another restaurant cannot read it', async () => {
  await assert.rejects(rpc(w.users.deviceB, 'pos_briefing', [rid, null]));
});
