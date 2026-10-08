// Supplier accounts: balance, overdue (oldest first), statement, and price comparison.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, A, rid, m;
before(async () => { w = await world(); A = w.A; rid = A.r.id; m = w.users.managerA; });
after(() => pool.end());

test('supplier balance, overdue and statement', async () => {
  const [s1] = await as(m, `insert into public.suppliers (restaurant_id, name, payment_terms_days) values ($1, 'Boucherie Atlas', 15) returning *`, [rid]);
  const [s2] = await as(m, `insert into public.suppliers (restaurant_id, name) values ($1, 'Marché central') returning *`, [rid]);
  const [g] = await as(w.users.ownerA, `insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents) values ($1, 'Poulet', 'g', 'kg', 1000, 3000) returning *`, [rid]);
  const buy = (sid, daysAgo, qty, cents) => as(m, `insert into public.stock_purchases (restaurant_id, ingredient_id, purchased_on, qty, total_cents, supplier_id) values ($1, $2, current_date - $3::int, $4, $5, $6)`, [rid, g.id, daysAgo, qty, cents, sid]);
  await buy(s1.id, 40, 10000, 30000);  // due 25 days ago
  await buy(s1.id, 5, 10000, 32000);   // due in 10 days
  await buy(s2.id, 3, 5000, 14000);    // paid on delivery: due 3 days ago
  await as(m, `insert into public.supplier_entries (restaurant_id, supplier_id, kind, amount_cents, method) values ($1, $2, 'payment', 20000, 'cash')`, [rid, s1.id]);
  await as(m, `insert into public.supplier_entries (restaurant_id, supplier_id, kind, amount_cents, entry_on) values ($1, $2, 'opening', 5000, current_date - 60)`, [rid, s1.id]);
  const bal = await rpc(m, 'supplier_balances', [rid]);
  const a = bal.find(x => x.id === s1.id), b = bal.find(x => x.id === s2.id);
  assert.equal(Number(a.balance_cents), 5000 + 30000 + 32000 - 20000);
  assert.equal(Number(a.overdue_cents), 5000 + 30000 - 20000, 'the payment covers the oldest debts first');
  assert.equal(Number(a.next_due_cents), 32000);
  assert.equal(Number(b.overdue_cents), 14000);
  const st = await rpc(m, 'supplier_statement', [s1.id]);
  assert.equal(st.length, 4);
  assert.equal(Number(st[0].balance_cents), 47000, 'newest first, running balance');
  // comparison: Atlas avg 31 DH/kg, Marché 28 DH/kg
  const cmp = await rpc(m, 'supplier_compare', [rid]);
  const c = cmp.find(x => x.ingredient_id === g.id);
  assert.equal(Number(c.best_cents), 2800);
  assert.equal(Number(c.saving_cents), (30000 + 32000 + 14000) - 2800 * 25);
  await assert.rejects(rpc(w.users.deviceA, 'supplier_balances', [rid]), /not_allowed|not allowed/);
});
