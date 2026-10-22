// Accounting export: balanced entries (sales per day, supplier invoices, supplier payments, cash),
// the summary, own account numbers, and the accountant's private link.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, rid, dev, day;
before(async () => {
  w = await world(); rid = w.A.r.id; dev = w.users.deviceA;
  // the business day ends at midnight here, so the till's day and the calendar day are the same at any hour
  await sql(`update public.restaurants set day_cutoff_hour = 0 where id = $1`, [rid]);
  day = (await sql(`select current_date::text d`))[0].d;
  for (const method of ['cash', 'card']) {
    const o = await tillOrder(dev, rid, [{ item_id: w.A.items.tajine.id }]);
    const [x] = await sql(`select total_cents from public.orders where id = $1`, [o.id]);
    await rpc(dev, 'pos_pay_order', [o.id, JSON.stringify([{ method, amount_cents: Number(x.total_cents) }]), null, null]);
  }
  const [s] = await sql(`insert into public.suppliers (restaurant_id, name) values ($1, 'Primeur Agdal') returning id`, [rid]);
  // one invoice photographed on two pages, with its VAT; one without VAT
  for (const p of ['a', 'b']) await sql(`insert into public.supplier_documents (restaurant_id, supplier_id, doc_date, amount_cents, vat_cents, doc_number, file_path, mime_type, size_bytes) values ($1, $2, current_date, 12000, 2000, 'F-778', $3, 'image/jpeg', 10)`, [rid, s.id, `${rid}/x-${p}.jpg`]);
  await sql(`insert into public.supplier_documents (restaurant_id, supplier_name, doc_date, amount_cents, file_path, mime_type, size_bytes) values ($1, 'Souk', current_date, 5000, $2, 'image/jpeg', 10)`, [rid, `${rid}/y.jpg`]);
  await sql(`insert into public.supplier_entries (restaurant_id, supplier_id, kind, amount_cents, entry_on, method) values ($1, $2, 'payment', 12000, current_date, 'cash')`, [rid, s.id]);
});
after(() => pool.end());

test('entries balance per piece, invoices are counted once, summary adds up', async () => {
  const x = await rpc(w.users.managerA, 'accounting_export', [rid, day, day]);
  const by = {};
  for (const e of x.entries) { const k = `${e.journal}|${e.piece}`; by[k] = (by[k] ?? 0) + Number(e.debit) - Number(e.credit); }
  for (const [k, v] of Object.entries(by)) assert.equal(v, 0, `unbalanced ${k}`);
  const ha = x.entries.filter(e => e.journal === 'HA');
  assert.equal(ha.filter(e => e.account === '4411').reduce((s, e) => s + Number(e.credit), 0), 17000); // 120 + 50, the two pages once
  assert.equal(ha.find(e => e.account === '34552').debit, 2000);
  assert.ok(ha.some(e => /TVA non renseignée/.test(e.label)));
  assert.ok(x.entries.some(e => e.journal === 'CA' && e.account === '5161' && Number(e.credit) === 12000));
  const ve = x.entries.filter(e => e.journal === 'VE');
  assert.ok(ve.some(e => e.account === '5161') && ve.some(e => e.account === '5141'));
  const vat = x.vat.reduce((s, v) => s + Number(v.vat), 0);
  assert.equal(ve.filter(e => e.account === '4455').reduce((s, e) => s + Number(e.credit) - Number(e.debit), 0), vat);
  assert.equal(x.purchases.length, 2);
});

test('own account numbers; only the owner manages the link; the link works without login', async () => {
  await as(w.users.ownerA, `update public.restaurants set accounting = '{"sales":"712400","cash":"516100","bad":"x y"}' where id = $1`, [rid]);
  const x = await rpc(w.users.ownerA, 'accounting_export', [rid, day, day]);
  assert.ok(x.entries.some(e => e.account === '712400'));
  await assert.rejects(rpc(w.users.ownerB, 'accounting_export', [rid, day, day]));
  await assert.rejects(rpc(w.users.managerA, 'accounting_link', [rid, true]));
  const { key } = await rpc(w.users.ownerA, 'accounting_link', [rid, true]);
  assert.ok(key.length >= 30);
  const y = await rpc(null, 'accounting_export_by_key', [key, day, day]);
  assert.equal(y.restaurant.name, w.A.r.name);
  await assert.rejects(rpc(null, 'accounting_export_by_key', ['x'.repeat(32), day, day]), /not_found/);
  await rpc(w.users.ownerA, 'accounting_link', [rid, false]);
  await assert.rejects(rpc(null, 'accounting_export_by_key', [key, day, day]), /not_found/);
  await assert.rejects(rpc(w.users.ownerA, 'accounting_export', [rid, '2025-01-01', '2026-12-31']), /invalid_request/);
});

test('the accountant sets his account numbers from his link', async () => {
  const { key } = await rpc(w.users.ownerA, 'accounting_link', [rid, true]);
  const res = await rpc(null, 'accounting_set_accounts_by_key', [key, JSON.stringify({ sales: '71240000', hack: '1', cash: 'a b' })]);
  assert.equal(res.accounts.sales, '71240000'); assert.equal(res.accounts.cash, '5161'); assert.equal(res.accounts.hack, undefined);
  await assert.rejects(rpc(null, 'accounting_set_accounts_by_key', ['y'.repeat(30), '{}']), /not_found/);
});
