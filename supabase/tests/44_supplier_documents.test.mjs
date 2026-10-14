// Supplier invoices (photo or PDF): only owners and managers of the restaurant see or add them,
// in a private bucket; the file must sit in the restaurant's folder; deleting the supplier keeps the invoice.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, world } from './helpers.mjs';

let w, A, B, sup;
before(async () => {
  w = await world(); A = w.A.r.id; B = w.B.r.id;
  [sup] = await as(w.users.managerA, `insert into public.suppliers (restaurant_id, name) values ($1, 'Primeur Agdal') returning *`, [A]);
});
after(() => pool.end());

const doc = (rid, path, extra = {}) => [
  `insert into public.supplier_documents (restaurant_id, supplier_id, doc_date, amount_cents, file_path, mime_type, size_bytes)
   values ($1, $2, '2026-10-14', $3, $4, 'image/jpeg', 120000) returning *`,
  [rid, extra.supplier ?? null, extra.amount ?? null, path]];

test('managers add and read invoices of their own restaurant only', async () => {
  const [d] = await as(w.users.managerA, ...doc(A, `${A}/2026/a.jpg`, { supplier: sup.id, amount: 45000 }));
  assert.equal(d.supplier_id, sup.id);
  assert.equal((await as(w.users.ownerA, `select id from public.supplier_documents where id = $1`, [d.id])).length, 1);
  // the till and the other restaurant see nothing
  assert.equal((await as(w.users.deviceA, `select id from public.supplier_documents`)).length, 0);
  assert.equal((await as(w.users.ownerB, `select id from public.supplier_documents where id = $1`, [d.id])).length, 0);
  await assert.rejects(as(w.users.deviceA, ...doc(A, `${A}/2026/b.jpg`)), /row-level security/);
  await assert.rejects(as(w.users.ownerB, ...doc(A, `${A}/2026/c.jpg`)), /row-level security/);
  // a file outside the restaurant's folder is refused
  await assert.rejects(as(w.users.managerA, ...doc(A, `${B}/2026/d.jpg`)), /check constraint/);
});

test('deleting the supplier keeps the invoice', async () => {
  const [s2] = await as(w.users.managerA, `insert into public.suppliers (restaurant_id, name) values ($1, 'Boucherie Hassan') returning *`, [A]);
  const [d] = await as(w.users.managerA, ...doc(A, `${A}/2026/e.jpg`, { supplier: s2.id }));
  await as(w.users.managerA, `delete from public.suppliers where id = $1`, [s2.id]);
  const [left] = await sql(`select supplier_id from public.supplier_documents where id = $1`, [d.id]);
  assert.equal(left.supplier_id, null);
});

test('private bucket: managers of the restaurant only, in its own folder', async () => {
  const [b] = await sql(`select public from storage.buckets where id = 'supplier-docs'`);
  assert.equal(b.public, false);
  await as(w.users.managerA, `insert into storage.objects (bucket_id, name) values ('supplier-docs', $1)`, [`${A}/2026/f.jpg`]);
  await assert.rejects(as(w.users.managerA, `insert into storage.objects (bucket_id, name) values ('supplier-docs', $1)`, [`${B}/2026/g.jpg`]), /row-level security/);
  await assert.rejects(as(w.users.deviceA, `insert into storage.objects (bucket_id, name) values ('supplier-docs', $1)`, [`${A}/2026/h.jpg`]), /row-level security/);
  assert.equal((await as(w.users.managerA, `select name from storage.objects where bucket_id = 'supplier-docs' and name = $1`, [`${A}/2026/f.jpg`])).length, 1);
  assert.equal((await as(w.users.deviceA, `select name from storage.objects where bucket_id = 'supplier-docs'`)).length, 0);
  assert.equal((await as(w.users.ownerB, `select name from storage.objects where bucket_id = 'supplier-docs'`)).length, 0);
});
