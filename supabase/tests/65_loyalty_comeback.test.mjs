// Loyalty step 4: the message that brings back customers who no longer come. The settings are checked when saved,
// the day of the message is remembered, the bonus points of an "offer" message are given once per absence (and
// come from the saved settings, never from the caller), and only customers who agreed to WhatsApp are reached.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, A, rid;
before(async () => { w = await world(); A = w.A; rid = A.r.id; });
after(() => pool.end());
const setLoyalty = (obj) => as(w.users.ownerA, `update public.restaurants set loyalty = $2::jsonb where id = $1`, [rid, JSON.stringify(obj)]);
const base = { customers: true, enabled: true, per_dh: 10, reward_points: 100, reward_cents: 5000 };
const offer = (bonus) => ({ ...base, comeback: { days: 30, mode: 'offer', offer: 'un café offert', bonus_points: bonus } });
const invite = { ...base, comeback: { days: 45, mode: 'invite', offer: 'ignoré', bonus_points: 50 } };

const lost = async (phone, { consent = true, points = 10, lastVisitDaysAgo = 60 } = {}) => {
  const [c] = await sql(`insert into public.customers (restaurant_id, phone, name, marketing_ok, points, visits, last_visit_at)
    values ($1, $2, 'Hind Alaoui', $3, $4, 5, now() - ($5 || ' days')::interval)
    on conflict (restaurant_id, phone) do update set marketing_ok = $3, points = $4, last_visit_at = now() - ($5 || ' days')::interval, comeback_at = null
    returning id`, [rid, phone, consent, points, lastVisitDaysAgo]);
  return c.id;
};
const row = async (id) => (await sql(`select points, comeback_at, last_visit_at from public.customers where id = $1`, [id]))[0];
const adjusts = (id) => sql(`select points from public.loyalty_ledger where customer_id = $1 and reason = 'adjust' order by id`, [id]);
const send = (id, user = w.users.managerA) => rpc(user, 'customer_comeback_sent', [id]);

test('the comeback settings are checked when saved', async () => {
  const bad = async (cb) => await assert.rejects(setLoyalty({ ...base, comeback: cb }), /invalid comeback/);
  await bad({ days: 3 }); await bad({ days: 181 }); await bad({ days: '30' }); await bad({ days: 12.5 });
  await bad({ mode: 'spam' }); await bad({ bonus_points: 1001 }); await bad({ bonus_points: -5 }); await bad({ bonus_points: '50' });
  await bad({ offer: 'x'.repeat(121) }); await bad({ message: 'x'.repeat(501) }); await bad({ offer: 12 }); await bad('nope');
  await setLoyalty({ ...base, comeback: { days: 7, mode: 'invite' } });
  await setLoyalty({ ...base, comeback: { days: 180, mode: 'offer', offer: 'x'.repeat(120), bonus_points: 1000, message: 'y'.repeat(500) } });
  await setLoyalty(base);                                          // a restaurant without comeback settings is still fine
});

test('an invitation only marks the day: no points', async () => {
  await setLoyalty(invite);
  const id = await lost('0612000301');
  const x = await send(id);
  assert.deepEqual([x.ok, x.bonus, x.points], [true, 0, 10]);
  const c = await row(id);
  assert.equal(c.points, 10); assert.ok(c.comeback_at);
  assert.equal((await adjusts(id)).length, 0);
});

test('an offer with bonus points adds them once, with a line in the ledger', async () => {
  await setLoyalty(offer(25));
  const id = await lost('0612000302');
  const x = await send(id);
  assert.deepEqual([x.bonus, x.points], [25, 35]);
  assert.equal((await row(id)).points, 35);
  assert.deepEqual((await adjusts(id)).map(l => l.points), [25]);
  // a second message to someone who has not been back: the day is updated, no new points
  const y = await send(id);
  assert.deepEqual([y.bonus, y.points], [0, 35]);
  assert.equal((await row(id)).points, 35);
  assert.equal((await adjusts(id)).length, 1);
});

test('after a new visit he can be contacted, with the bonus, again', async () => {
  await setLoyalty(offer(25));
  const id = await lost('0612000303');
  await send(id);
  await sql(`update public.customers set comeback_at = now() - interval '10 days', last_visit_at = now() - interval '35 days' where id = $1`, [id]);
  assert.equal((await send(id)).bonus, 0);                         // his last visit is older than the message: not back yet
  await sql(`update public.customers set comeback_at = now() - interval '40 days', last_visit_at = now() - interval '5 days' where id = $1`, [id]);
  const x = await send(id);                                        // he came back after the message, then left again
  assert.equal(x.bonus, 25);
  assert.equal((await row(id)).points, 10 + 25 + 25);
});

test('no bonus when the points are off or the mode is an invitation; the caller cannot ask for more', async () => {
  await setLoyalty({ ...offer(25), enabled: false });
  const a = await lost('0612000304');
  assert.equal((await send(a)).bonus, 0);
  await setLoyalty({ ...offer(0) });
  const b = await lost('0612000305');
  assert.equal((await send(b)).bonus, 0);
  await setLoyalty(invite);
  const c = await lost('0612000306');
  assert.equal((await send(c)).bonus, 0);                          // invite mode: the saved bonus is ignored
  // there is no argument to pass: a second argument is refused by the database
  await assert.rejects(as(w.users.managerA, `select public.customer_comeback_sent($1, 500)`, [c]), /does not exist/);
});

test('only customers who agreed to WhatsApp, and only with the customer file on', async () => {
  await setLoyalty(offer(25));
  const noConsent = await lost('0612000307', { consent: false });
  await assert.rejects(send(noConsent), /invalid_request/);
  assert.equal((await row(noConsent)).comeback_at, null);
  assert.equal((await row(noConsent)).points, 10);
  const ok = await lost('0612000308');
  await setLoyalty({ ...offer(25), customers: false });
  await assert.rejects(send(ok), /invalid_request/);
  assert.equal((await row(ok)).comeback_at, null);
});

test('only a manager of that restaurant, never a guest, the till or another restaurant', async () => {
  await setLoyalty(offer(25));
  const id = await lost('0612000309');
  await assert.rejects(send(id, null));                            // a guest
  await assert.rejects(send(id, w.users.deviceA));                 // the till device
  await assert.rejects(send(id, w.users.ownerB));                  // the owner of another restaurant
  await assert.rejects(rpc(w.users.managerA, 'customer_comeback_sent', ['00000000-0000-0000-0000-000000000000']), /not_found/);
  assert.equal((await row(id)).comeback_at, null);
  assert.equal((await send(id, w.users.ownerA)).ok, true);         // the owner can
});
