// The salon's products: the catalogue (for sale or for the salon's own use), the stock that only
// moves with an explanation, the till that takes sold products off and puts them back on a cancel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, A, rid, d, m, sara, shampoo, tube;
const stock = async (id) => (await sql(`select stock from public.agenda_products where id = $1`, [id]))[0].stock;
before(async () => {
  w = await world(); A = w.A; rid = A.r.id; d = w.users.deviceA; m = w.users.managerA; sara = A.staff.sara.id;
  let off = 12 - new Date().getUTCHours(); if (off > 12) off -= 24;
  const tz = off === 0 ? 'UTC' : `Etc/GMT${off > 0 ? '-' : '+'}${Math.abs(off)}`;
  await sql(`update public.restaurants set products = '{agenda}', timezone = $2, day_cutoff_hour = 0 where id = $1`, [rid, tz]);
});
after(() => pool.end());

test('the manager makes the catalogue; the till only reads it', async () => {
  [{ id: shampoo }] = await as(m, `insert into public.agenda_products (restaurant_id, name, category, kind, price_cents, cost_cents, min_stock) values ($1, 'Shampoing Kératine', 'Soin', 'retail', 12000, 6000, 3) returning id`, [rid]);
  [{ id: tube }] = await as(m, `insert into public.agenda_products (restaurant_id, name, kind, cost_cents) values ($1, 'Tube 6.1', 'usage', 4500) returning id`, [rid]);
  await assert.rejects(as(m, `insert into public.agenda_products (restaurant_id, name, kind) values ($1, 'Sans prix', 'retail')`, [rid]));
  await assert.rejects(as(d, `insert into public.agenda_products (restaurant_id, name, kind, price_cents) values ($1, 'X', 'retail', 100)`, [rid]));
  assert.equal((await as(d, `select count(*)::int n from public.agenda_products where restaurant_id = $1`, [rid]))[0].n, 2);
  // the stock is never typed over: only through a move
  await assert.rejects(as(m, `update public.agenda_products set stock = 50 where id = $1`, [shampoo]));
  assert.equal((await as(w.users.ownerB, `select count(*)::int n from public.agenda_products where restaurant_id = $1`, [rid]))[0].n, 0);
});

test('starting stock, a delivery updates the purchase price, a correction needs a reason', async () => {
  await rpc(m, 'agenda_stock_add', [rid, shampoo, 'start', 5, null, null]);
  const x = await rpc(m, 'agenda_stock_add', [rid, shampoo, 'delivery', 6, 6500, 'Facture 12']);
  assert.equal(x.stock, 11);
  assert.equal((await sql(`select cost_cents from public.agenda_products where id = $1`, [shampoo]))[0].cost_cents, '6500');
  await assert.rejects(rpc(m, 'agenda_stock_add', [rid, shampoo, 'correction', -1, null, ' ']), /reason_required/);
  await assert.rejects(rpc(m, 'agenda_stock_add', [rid, shampoo, 'delivery', -2, null, null]), /invalid_request/);
  await assert.rejects(rpc(d, 'agenda_stock_add', [rid, shampoo, 'delivery', 2, null, null]));
  await rpc(m, 'agenda_stock_add', [rid, tube, 'start', 10, null, null]);
});

test('the till sells a product: the stock goes down; a cancelled ticket puts it back', async () => {
  const s = await rpc(d, 'agenda_checkout', [rid, { name: 'Nadia', lines: [{ service_id: null, kind: 'service', name: 'Brushing', unit_cents: 8000, staff_id: sara }, { product_id: shampoo, quantity: 2, unit_cents: 12000 }], cash_cents: 32000 }]);
  assert.equal(await stock(shampoo), 9);
  const [l] = await sql(`select name, kind from public.agenda_sale_lines where sale_id = $1 and product_id = $2`, [s.id, shampoo]);
  assert.deepEqual([l.name, l.kind], ['Shampoing Kératine', 'product']);
  // a product for the salon's own use is not sold
  await assert.rejects(rpc(d, 'agenda_checkout', [rid, { lines: [{ product_id: tube, unit_cents: 100 }], cash_cents: 100 }]), /invalid_request/);
  await assert.rejects(rpc(d, 'agenda_checkout', [rid, { lines: [{ product_id: w.B.r.id, unit_cents: 100 }], cash_cents: 100 }]), /invalid_request/);
  await rpc(m, 'agenda_sale_cancel', [rid, s.id, 'Erreur', null, null]);
  assert.equal(await stock(shampoo), 11);
  const moves = await as(m, `select kind, qty from public.agenda_stock_moves where product_id = $1 order by created_at`, [shampoo]);
  assert.deepEqual(moves.map(x => [x.kind, x.qty]), [['start', 5], ['delivery', 6], ['sale', -2], ['cancel', 2]]);
  assert.equal((await as(d, `select count(*)::int n from public.agenda_stock_moves where restaurant_id = $1`, [rid]))[0].n, 0);
  // a product already sold is not deleted (its history stays); one never sold is
  await as(m, `delete from public.agenda_products where id = $1`, [shampoo]);
  assert.equal((await sql(`select count(*)::int n from public.agenda_products where id = $1`, [shampoo]))[0].n, 1);
});

test('the inventory: blind count, the leak for products for sale, the consumption for the salon', async () => {
  // shampoo: 11 in stock, 9 found (2 missing at 65 DH); tube: 10, 7 left (3 used at 45 DH)
  await assert.rejects(rpc(d, 'agenda_stock_count', [rid, JSON.stringify([{ product_id: shampoo, counted: 9 }]), null]));
  await assert.rejects(rpc(m, 'agenda_stock_count', [rid, JSON.stringify([{ product_id: shampoo, counted: -1 }]), null]), /invalid_request/);
  const c = await rpc(m, 'agenda_stock_count', [rid, JSON.stringify([{ product_id: shampoo, counted: 9 }, { product_id: tube, counted: 7 }]), 'Fin de mois']);
  assert.equal(Number(c.missing_cents), 13000); assert.equal(Number(c.used_cents), 13500); assert.equal(Number(c.extra_cents), 0);
  assert.equal(await stock(shampoo), 9); assert.equal(await stock(tube), 7);
  const day = new Date().toISOString().slice(0, 10);
  const ago = new Date(Date.now() - 86400_000).toISOString().slice(0, 10), next = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  const rep = await rpc(m, 'agenda_stock_report', [rid, ago, next]);
  const sh = rep.products.find(x => x.product_id === shampoo);
  assert.equal(sh.sold, 0); assert.equal(sh.received, 6); assert.equal(sh.count_diff, -2); assert.equal(Number(sh.count_value_cents), -13000);
  assert.equal(rep.counts.length, 1); assert.equal(rep.counts[0].lines.length, 2);
  await assert.rejects(rpc(w.users.ownerB, 'agenda_stock_report', [rid, day, day]));
  assert.equal((await as(w.users.ownerB, `select count(*)::int n from public.agenda_stock_counts where restaurant_id = $1`, [rid]))[0].n, 0);
});
