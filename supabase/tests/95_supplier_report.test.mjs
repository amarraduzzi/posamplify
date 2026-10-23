// Situation fournisseurs: per period, opening and closing balance, purchases, payments, the period before;
// the detail per product and per delivery (ordered against received).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, rid, m, sup, flour;
before(async () => {
  w = await world(); rid = w.A.r.id; m = w.users.managerA;
  [sup] = await as(m, `insert into public.suppliers (restaurant_id, name) values ($1, 'Moulin Atlas') returning *`, [rid]);
  [flour] = await as(m, `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents, supplier_id)
                         values ($1, 'Farine', 'g', 'sac 25 kg', 25000, 20000, $2) returning *`, [rid, sup.id]);
  const buy = (d, qty, cents) => as(m, `insert into public.stock_purchases (restaurant_id, ingredient_id, purchased_on, qty, total_cents, supplier_id) values ($1, $2, $3::date, $4, $5, $6)`, [rid, flour.id, d, qty, cents, sup.id]);
  await as(m, `insert into public.supplier_entries (restaurant_id, supplier_id, kind, amount_cents, entry_on) values ($1, $2, 'opening', 10000, '2026-08-01')`, [rid, sup.id]);
  await buy('2026-08-20', 50000, 40000);   // before: 2 bags at 200
  await buy('2026-09-05', 50000, 44000);   // in: 2 bags at 220
  await buy('2026-09-18', 25000, 22000);
  await as(m, `insert into public.supplier_entries (restaurant_id, supplier_id, kind, amount_cents, entry_on, method) values ($1, $2, 'payment', 30000, '2026-09-10', 'cash')`, [rid, sup.id]);
});
after(() => pool.end());

test('the situation of the period: opening, purchases, payments, closing, the period before', async () => {
  const rep = await rpc(m, 'supplier_report', [rid, '2026-09-01', '2026-09-30']);
  const s = rep.suppliers.find(x => x.id === sup.id);
  assert.equal(Number(s.opening_cents), 10000 + 40000);
  assert.equal(Number(s.purchased_cents), 66000);
  assert.equal(Number(s.paid_cents), 30000);
  assert.equal(Number(s.closing_cents), 50000 + 66000 - 30000);
  assert.equal(s.deliveries, 2);
  assert.equal(rep.prev_from, '2026-08-02');
  assert.equal(Number(s.prev_purchased_cents), 40000);
});

test('the detail: per product with the average price and the one before, deliveries, payments', async () => {
  const d = await rpc(m, 'supplier_report_detail', [rid, sup.id, '2026-09-01', '2026-09-30']);
  assert.equal(d.products.length, 1);
  assert.equal(Number(d.products[0].units), 3);
  assert.equal(Number(d.products[0].avg_unit_cents), 22000);
  assert.equal(Number(d.products[0].prev_avg_unit_cents), 20000);
  assert.equal(d.deliveries.length, 2);
  assert.equal(d.payments.length, 1);
  await assert.rejects(rpc(w.users.ownerB, 'supplier_report', [rid, '2026-09-01', '2026-09-30']), /not allowed/);
  await assert.rejects(rpc(m, 'supplier_report', [rid, '2026-09-30', '2026-09-01']), /invalid_request/);
});
