// Reviews after the visit: the client's page from the ticket's link, stars and a word (once, can
// change the same day), Google offered to every client whatever the stars; the salon's list of who
// to ask (one ask per client in 60 days), what clients said, the stars per person.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world } from './helpers.mjs';

let w, A, rid, d, m, sara, karim, svc, s1, s2;
const pay = (ph, staff) => rpc(d, 'agenda_checkout', [rid, { phone: ph, name: 'Nadia', lines: [{ service_id: svc, unit_cents: 8000, staff_id: staff }], cash_cents: 8000 }]);
before(async () => {
  w = await world(); A = w.A; rid = A.r.id; d = w.users.deviceA; m = w.users.managerA; sara = A.staff.sara.id; karim = A.staff.karim.id;
  await sql(`update public.restaurants set products = '{agenda}', timezone = 'UTC', day_cutoff_hour = 0,
               branding = branding || '{"review_url": "https://g.page/r/salon-a/review"}' where id = $1`, [rid]);
  [{ id: svc }] = await sql(`insert into public.agenda_services (restaurant_id, name, duration_min, price_cents) values ($1, '{"fr":"Brushing"}', 30, 8000) returning id`, [rid]);
  s1 = await pay('0612340001', sara); s2 = await pay('0612340002', karim);
});
after(() => pool.end());

test('the salon sees who to ask and marks it asked', async () => {
  const x = await rpc(m, 'agenda_reviews', [rid, 90]);
  assert.equal(x.review_url, 'https://g.page/r/salon-a/review');
  assert.equal(x.todo.length, 2);
  await assert.rejects(rpc(d, 'agenda_reviews', [rid, 90]));
  await rpc(d, 'agenda_review_asked', [rid, s1.id]);
  assert.equal((await rpc(m, 'agenda_reviews', [rid, 90])).todo.length, 1);
  // the same client paying again is not asked twice
  await pay('0612340001', sara);
  assert.deepEqual((await rpc(m, 'agenda_reviews', [rid, 90])).todo.map(t => t.phone), ['0612340002']);
});

test('the client gives stars; Google is offered whatever the stars', async () => {
  const info = await rpc(null, 'salon_feedback_info', [s1.share_token]);
  assert.equal(info.review_url, 'https://g.page/r/salon-a/review'); assert.deepEqual(info.staff, ['Sara']); assert.equal(info.done, null);
  await assert.rejects(rpc(null, 'salon_feedback', [s1.share_token, 6, null]));
  const low = await rpc(null, 'salon_feedback', [s2.share_token, 2, 'Trop d’attente']);
  assert.equal(low.review_url, 'https://g.page/r/salon-a/review');
  const hi = await rpc(null, 'salon_feedback', [s1.share_token, 4, null]);
  await rpc(null, 'salon_feedback', [s1.share_token, 5, 'Parfait']);
  assert.equal(hi.review_url, 'https://g.page/r/salon-a/review');
  await rpc(null, 'salon_feedback_google', [s1.share_token]);
  assert.equal((await rpc(null, 'salon_feedback_info', [s1.share_token])).done.rating, 5);
  const x = await rpc(m, 'agenda_reviews', [rid, 90]);
  assert.equal(x.stats.count, 2); assert.equal(Number(x.stats.avg), 3.5); assert.equal(x.stats.google, 1);
  assert.equal(Number(x.staff.find(s => s.staff_id === sara).avg), 5);
  assert.equal(x.todo.length, 0);
  // an answer older than a day stays
  await sql(`update public.agenda_feedback set created_at = now() - interval '2 days' where sale_id = $1`, [s2.id]);
  await assert.rejects(rpc(null, 'salon_feedback', [s2.share_token, 5, null]), /already_done/);
});
