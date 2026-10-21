// Le service discret: the guest calls from the table QR, the till sees it and answers. Amplify Maître only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world } from './helpers.mjs';

let w, A, rid, d, tok, tid;
before(async () => {
  w = await world(); A = w.A; rid = A.r.id; d = w.users.deviceA;
  [{ qr_token: tok, id: tid }] = await sql(`select qr_token, id from public.dining_tables where restaurant_id = $1 order by label limit 1`, [rid]);
});
after(() => pool.end());

test('without Amplify Maître the service is off', async () => {
  assert.equal((await rpc(null, 'table_service', [A.r.slug, tok])).enabled, false);
  await assert.rejects(rpc(null, 'call_service', [A.r.slug, tok, 'bill']), /service_off/);
});

test('the guest calls; tapping twice rings once; the till answers; the guest sees it', async () => {
  await sql(`update public.restaurants set products = array_append(products, 'maitre') where id = $1`, [rid]);
  const a = await rpc(null, 'call_service', [A.r.slug, tok, 'bill']);
  assert.equal(a.again, false);
  assert.equal((await rpc(null, 'call_service', [A.r.slug, tok, 'bill'])).again, true);
  await rpc(null, 'call_service', [A.r.slug, tok, 'water']);
  let s = await rpc(null, 'table_service', [A.r.slug, tok]);
  assert.deepEqual(s.open.map(x => x.kind).sort(), ['bill', 'water']);
  // the till sees the calls of its restaurant only
  assert.equal((await sql(`select count(*)::int n from public.service_calls where table_id = $1 and done_at is null`, [tid]))[0].n, 2);
  await assert.rejects(rpc(w.users.deviceB, 'pos_service_done', [rid, null, tid, null]));
  const r = await rpc(d, 'pos_service_done', [rid, null, tid, A.staff.sara.id]);
  assert.equal(r.done, 2);
  s = await rpc(null, 'table_service', [A.r.slug, tok]);
  assert.equal(s.open.length, 0); assert.equal(s.done.length, 2);
  await assert.rejects(rpc(null, 'call_service', [A.r.slug, 'wrong-token', 'waiter']), /service_off/);
  await assert.rejects(rpc(null, 'call_service', [A.r.slug, tok, 'champagne']), /invalid_request/);
});
