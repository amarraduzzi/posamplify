// Boccadillos mode, step D: the fixed "Sur place" table. Other restaurants are not affected.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, world } from './helpers.mjs';

let w, rid, other;
before(async () => { w = await world(); rid = w.A.r.id; other = w.B.r.id; });
after(() => pool.end());

test('no table code while the mode is off', async () => {
  await sql(`update public.restaurants set boccadillos = false where id = $1`, [rid]);
  const [row] = await sql(`select public.get_boccadillos_table((select slug from public.restaurants where id = $1)) as t`, [rid]);
  assert.equal(row.t, null);
});

test('with the mode on and the table present the code is returned; the other restaurant stays null', async () => {
  await sql(`update public.restaurants set boccadillos = true where id = $1`, [rid]);
  await sql(`select app.ensure_boccadillos_table($1)`, [rid]);
  await sql(`select app.ensure_boccadillos_table($1)`, [rid]); // twice: no error, one row
  const [n] = await sql(`select count(*)::int as n from public.dining_tables where restaurant_id = $1 and label = 'Sur place'`, [rid]);
  assert.equal(n.n, 1);
  const [a] = await sql(`select public.get_boccadillos_table((select slug from public.restaurants where id = $1)) as t`, [rid]);
  assert.ok(a.t && a.t.length >= 8);
  const [b] = await sql(`select public.get_boccadillos_table((select slug from public.restaurants where id = $1)) as t`, [other]);
  assert.equal(b.t, null);
  const [c] = await sql(`select count(*)::int as n from public.dining_tables where restaurant_id = $1 and label = 'Sur place'`, [other]);
  assert.equal(c.n, 0);
});

test('a deactivated table gives no code (the guest app falls back to the normal question)', async () => {
  await sql(`update public.dining_tables set active = false where restaurant_id = $1 and label = 'Sur place'`, [rid]);
  const [row] = await sql(`select public.get_boccadillos_table((select slug from public.restaurants where id = $1)) as t`, [rid]);
  assert.equal(row.t, null);
  await sql(`update public.dining_tables set active = true where restaurant_id = $1 and label = 'Sur place'`, [rid]);
  await sql(`update public.restaurants set boccadillos = false where id = $1`, [rid]);
});
