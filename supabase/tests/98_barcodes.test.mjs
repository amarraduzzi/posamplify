// Barcodes and scale labels (step 3): an option, off by default. The database keeps the switch, the scale format
// and the code of a product; the reading of a code is in packages/shared/src/barcode.ts (its own tests).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, world } from './helpers.mjs';

let w, rid, ridB, ownerA, managerA, ownerB, item, item2, itemB;
before(async () => {
  w = await world(); rid = w.A.r.id; ridB = w.B.r.id; ownerA = w.users.ownerA; managerA = w.users.managerA; ownerB = w.users.ownerB;
  item = w.A.items.tajine; item2 = w.A.items.pizza; itemB = Object.values(w.B.items)[0];
});
after(() => pool.end());

test('off by default, and the scale format starts as the common EAN-13 label (2 + 6 + 5 + check digit)', async () => {
  const [r] = await sql(`select barcode_scan, scale_prefix, scale_code_len, scale_value_len, scale_value from public.restaurants where id = $1`, [rid]);
  assert.deepEqual(r, { barcode_scan: false, scale_prefix: '2', scale_code_len: 6, scale_value_len: 5, scale_value: 'weight_g' });
  assert.equal((await sql(`select count(*)::int n from public.menu_items where barcode is not null`))[0].n, 0);
});

test('only the owner switches it on', async () => {
  assert.equal((await as(managerA, `update public.restaurants set barcode_scan = true where id = $1 returning id`, [rid]).catch(() => [])).length, 0);
  assert.equal((await sql(`select barcode_scan from public.restaurants where id = $1`, [rid]))[0].barcode_scan, false);
  assert.equal((await as(ownerA, `update public.restaurants set barcode_scan = true where id = $1 returning id`, [rid])).length, 1);
  assert.equal((await sql(`select barcode_scan from public.restaurants where id = $1`, [rid]))[0].barcode_scan, true);
  // another shop is not touched
  assert.equal((await sql(`select barcode_scan from public.restaurants where id = $1`, [ridB]))[0].barcode_scan, false);
  assert.equal((await as(ownerB, `update public.restaurants set barcode_scan = true where id = $1 returning id`, [rid]).catch(() => [])).length, 0);
});

test('the scale format must make 12 digits before the check digit, with a known kind of value', async () => {
  const set = (c, v, p = '2', k = 'weight_g') => as(ownerA, `update public.restaurants set scale_prefix = $2, scale_code_len = $3, scale_value_len = $4, scale_value = $5 where id = $1`, [rid, p, c, v, k]);
  await set(5, 5, '28');                                  // 2 + 5 + 5 = 12 with a two-digit prefix
  await set(6, 5, '2', 'price_cents');
  await assert.rejects(set(5, 5), /check/);               // 1 + 5 + 5 = 11
  await assert.rejects(set(6, 5, '2', 'ounces'), /check/);
  await assert.rejects(set(6, 5, 'x'), /check/);
  await assert.rejects(set(9, 2, '1'), /check/);
  await set(6, 5, '2', 'weight_g');
});

test('a product code: letters, digits and hyphen, 3 to 32 characters, unique in the shop, free in another shop', async () => {
  const put = (id, code) => as(managerA, `update public.menu_items set barcode = $2 where id = $1`, [id, code]);
  await put(item.id, '6111234567890');
  await assert.rejects(put(item2.id, '6111234567890'), /menu_items_barcode_uq/);
  await put(item2.id, '000777');
  await assert.rejects(put(item.id, 'ab'), /check/);
  await assert.rejects(put(item.id, 'has space'), /check/);
  await assert.rejects(put(item.id, 'x'.repeat(33)), /check/);
  // the same code in another shop is fine, and an item without code is always fine
  await as(ownerB, `update public.menu_items set barcode = '6111234567890' where id = $1`, [itemB.id]);
  await put(item.id, null);
  await put(item2.id, null);
  await put(item.id, '6111234567890');                    // free again after it was cleared
});
