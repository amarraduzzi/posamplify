// Run: node --import tsx --test packages/shared/test/barcode.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCALE, ean13Valid, resolveScan, scaleFormatOf, scaleFormatOk } from '../src/barcode.ts';

// a scale label: prefix 2, product 123456, 450 g, check digit computed here
const check = d12 => { let s = 0; for (let i = 0; i < 12; i++) s += Number(d12[i]) * (i % 2 ? 3 : 1); return d12 + ((10 - (s % 10)) % 10); };
const label = (plu, v, f = DEFAULT_SCALE) => check(f.prefix + plu.padStart(f.codeLen, '0') + String(v).padStart(f.valueLen, '0'));

const items = [
  { id: 'a', barcode: '123456', sold_by_weight: true, price_cents: 20000 },   // 200 MAD / kg
  { id: 'b', barcode: '6111234567890', price_cents: 1500 },
  { id: 'c', barcode: null, price_cents: 500 },
  { id: 'd', barcode: '000777', sold_by_weight: true, price_cents: 10000 },
];

test('EAN-13 check digit', () => {
  assert.equal(ean13Valid('4006381333931'), true);
  assert.equal(ean13Valid('4006381333932'), false);
  assert.equal(ean13Valid('123'), false);
});

test('a scale label gives the product and the weight in grams', () => {
  const r = resolveScan(label('123456', 450), items, DEFAULT_SCALE);
  assert.equal(r.kind, 'item'); assert.equal(r.item.id, 'a'); assert.equal(r.weight_g, 450);
});
test('leading zeros of the product number do not matter', () => {
  assert.equal(resolveScan(label('777', 1200), items, DEFAULT_SCALE).item.id, 'd');
  assert.equal(resolveScan(label('000777', 1200), items, DEFAULT_SCALE).weight_g, 1200);
});
test('weight in tens of grams, and a price label turns into a weight', () => {
  const f10 = { ...DEFAULT_SCALE, value: 'weight_10g' };
  assert.equal(resolveScan(label('123456', 45, f10), items, f10).weight_g, 450);
  const fp = { ...DEFAULT_SCALE, value: 'price_cents' };
  const r = resolveScan(label('123456', 9000, fp), items, fp);          // 90 MAD at 200 MAD/kg = 450 g
  assert.equal(r.weight_g, 450);
});
test('another format: prefix 28, code 5, value 5', () => {
  const f = { prefix: '28', codeLen: 5, valueLen: 5, value: 'weight_g' };
  assert.equal(scaleFormatOk(f), true);
  const it = [{ id: 'z', barcode: '12345', sold_by_weight: true, price_cents: 100 }];
  const r = resolveScan(label('12345', 250, f), it, f);
  assert.equal(r.item.id, 'z'); assert.equal(r.weight_g, 250);
});
test('a normal product code finds the product; a weighed product scanned without weight has none', () => {
  const r = resolveScan('6111234567890', items, DEFAULT_SCALE);
  assert.equal(r.item.id, 'b'); assert.equal(r.weight_g, null);
  const w = resolveScan('123456', items, DEFAULT_SCALE);
  assert.equal(w.item.id, 'a'); assert.equal(w.weight_g, null);
});
test('a misread (wrong check digit) or an impossible weight is refused, an unknown code is unknown', () => {
  const ok = label('123456', 450);
  const bad = ok.slice(0, 12) + String((Number(ok[12]) + 1) % 10);
  assert.equal(resolveScan(bad, items, DEFAULT_SCALE).kind, 'bad');
  assert.equal(resolveScan(label('123456', 0), items, DEFAULT_SCALE).kind, 'bad');
  assert.equal(resolveScan(label('999999', 450), items, DEFAULT_SCALE).kind, 'unknown');
  assert.equal(resolveScan('5449000000996', items, DEFAULT_SCALE).kind, 'unknown');
  assert.equal(resolveScan('  ', items, DEFAULT_SCALE).kind, 'unknown');
});
test('a scale label for a product that is not sold by weight is not accepted', () => {
  const it = [{ id: 'x', barcode: '123456', price_cents: 100 }];
  assert.equal(resolveScan(label('123456', 450), it, DEFAULT_SCALE).kind, 'unknown');
});
test('a wrong stored format falls back to the default', () => {
  assert.deepEqual(scaleFormatOf({ scale_prefix: '2', scale_code_len: 9, scale_value_len: 5, scale_value: 'weight_g' }), DEFAULT_SCALE);
  assert.deepEqual(scaleFormatOf({}), DEFAULT_SCALE);
});
