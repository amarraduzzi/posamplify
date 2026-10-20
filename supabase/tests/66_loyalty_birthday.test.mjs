// Loyalty step 5: the birthday message. Settings checked when saved, only in the month of the birthday, once per
// year, bonus points from the saved settings (once per year, only with points on), consent and role required.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, A, rid;
before(async () => { w = await world(); A = w.A; rid = A.r.id; });
after(() => pool.end());
const setLoyalty = (obj) => as(w.users.ownerA, `update public.restaurants set loyalty = $2::jsonb where id = $1`, [rid, JSON.stringify(obj)]);
const base = { customers: true, enabled: true, per_dh: 10, reward_points: 100, reward_cents: 5000 };
const gift = (bonus) => ({ ...base, birthday: { offer: 'un dessert offert', bonus_points: bonus } });
const person = async (phone, { consent = true, monthOffset = 0, points = 10 } = {}) => {
  const [c] = await sql(`insert into public.customers (restaurant_id, phone, name, marketing_ok, points, birthday)
    values ($1, $2, 'Hind Alaoui', $3, $4, (date_trunc('month', current_date) + ($5 || ' months')::interval + interval '9 days')::date - interval '20 years')
    on conflict (restaurant_id, phone) do update set marketing_ok = $3, points = $4, birthday_msg_at = null returning id`, [rid, phone, consent, points, monthOffset]);
  return c.id;
};
const row = async (id) => (await sql(`select points, birthday_msg_at from public.customers where id = $1`, [id]))[0];
const adjusts = (id) => sql(`select points from public.loyalty_ledger where customer_id = $1 and reason = 'adjust'`, [id]);
const send = (id, user = w.users.managerA) => rpc(user, 'customer_birthday_sent', [id]);

test('the birthday settings are checked when saved', async () => {
  const bad = async (b) => await assert.rejects(setLoyalty({ ...base, birthday: b }), /invalid birthday/);
  await bad({ bonus_points: 1001 }); await bad({ bonus_points: -1 }); await bad({ bonus_points: '5' }); await bad({ offer: 'x'.repeat(121) });
  await bad({ message: 'x'.repeat(501) }); await bad({ offer: 3 }); await bad('nope');
  await setLoyalty({ ...base, birthday: { offer: 'x'.repeat(120), bonus_points: 1000, message: 'y'.repeat(500) } });
  await setLoyalty(base);
});

test('bonus points once per year, with a line in the ledger', async () => {
  await setLoyalty(gift(30));
  const id = await person('0612000401');
  const x = await send(id);
  assert.deepEqual([x.bonus, x.points], [30, 40]);
  assert.deepEqual((await adjusts(id)).map(l => l.points), [30]);
  assert.ok((await row(id)).birthday_msg_at);
  assert.equal((await send(id)).bonus, 0);                         // same year: the day is noted again, no new points
  assert.equal((await row(id)).points, 40);
  await sql(`update public.customers set birthday_msg_at = now() - interval '1 year' where id = $1`, [id]);
  assert.equal((await send(id)).bonus, 30);                        // last year's message: this year counts again
  assert.equal((await row(id)).points, 70);
});

test('no bonus with the points off or a bonus of 0; the caller cannot ask for more', async () => {
  await setLoyalty({ ...gift(30), enabled: false });
  assert.equal((await send(await person('0612000402'))).bonus, 0);
  await setLoyalty(gift(0));
  assert.equal((await send(await person('0612000403'))).bonus, 0);
  await assert.rejects(as(w.users.managerA, `select public.customer_birthday_sent($1, 500)`, [await person('0612000404')]), /does not exist/);
});

test('only in the month of the birthday, only with consent, only with the customer file on', async () => {
  await setLoyalty(gift(30));
  const other = await person('0612000405', { monthOffset: 3 });
  await assert.rejects(send(other), /invalid_request/);
  const noConsent = await person('0612000406', { consent: false });
  await assert.rejects(send(noConsent), /invalid_request/);
  const [nob] = await sql(`insert into public.customers (restaurant_id, phone, name, marketing_ok) values ($1, '0612000407', 'Sans', true) returning id`, [rid]);
  await assert.rejects(send(nob.id), /invalid_request/);           // no birthday known
  const ok = await person('0612000408');
  await setLoyalty({ ...gift(30), customers: false });
  await assert.rejects(send(ok), /invalid_request/);
  for (const id of [other, noConsent, nob.id, ok]) { assert.equal((await row(id)).birthday_msg_at, null); }
});

test('only a manager of that restaurant', async () => {
  await setLoyalty(gift(30));
  const id = await person('0612000409');
  await assert.rejects(send(id, null));
  await assert.rejects(send(id, w.users.deviceA));
  await assert.rejects(send(id, w.users.ownerB));
  await assert.rejects(rpc(w.users.managerA, 'customer_birthday_sent', ['00000000-0000-0000-0000-000000000000']), /not_found/);
  assert.equal((await send(id, w.users.ownerA)).ok, true);
});
