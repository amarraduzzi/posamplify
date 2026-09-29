// Till flow, manager PIN, payments, fiscal documents, credit notes, Z report.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, uuid, tillOrder } from './helpers.mjs';

let w, dev;
before(async () => { w = await world(); dev = w.users.deviceA; });
after(() => pool.end());

const pay = (orderId, method, amount, tip = 0) => as(dev,
  `insert into public.payments (restaurant_id, order_id, method, amount_cents, tip_cents) values ($1, $2, $3, $4, $5) returning *`,
  [w.A.r.id, orderId, method, amount, tip]);

test('staff login with PIN, wrong PIN counted, lockout after 5 tries', async () => {
  const ok = await rpc(dev, 'verify_staff_pin', [w.A.r.id, w.A.staff.sara.id, '1111']);
  assert.deepEqual(ok.staff, { id: w.A.staff.sara.id, name: 'Sara', role: 'staff' });

  for (let i = 0; i < 5; i++) {
    const r = await rpc(dev, 'verify_staff_pin', [w.A.r.id, w.A.staff.sara.id, '0000']);
    assert.deepEqual(r, { ok: false, error: 'invalid' });
  }
  const locked = await rpc(dev, 'verify_staff_pin', [w.A.r.id, w.A.staff.sara.id, '1111']);
  assert.deepEqual(locked, { ok: false, error: 'locked' }, 'correct PIN refused while locked');

  // owner resets the PIN, which also unlocks
  await rpc(w.users.ownerA, 'set_staff_pin', [w.A.staff.sara.id, '1111']);
  assert.equal((await rpc(dev, 'verify_staff_pin', [w.A.r.id, w.A.staff.sara.id, '1111'])).ok, true);
  await assert.rejects(rpc(w.users.ownerA, 'set_staff_pin', [w.A.staff.sara.id, '12']), /invalid_pin_format/);
});

test('discount only through a manager PIN, never by editing the order', async () => {
  const o = await tillOrder(dev, w.A.r.id, [{ item_id: w.A.items.tajine.id, qty: 2 }]);
  assert.equal(Number(o.total_cents), 17000);

  await assert.rejects(as(dev, `update public.orders set discount_cents = 5000 where id = $1`, [o.id]), /dedicated function/);
  await assert.rejects(as(dev, `update public.orders set total_cents = 1 where id = $1`, [o.id]).then(async () => {
    const [x] = await sql(`select total_cents from public.orders where id = $1`, [o.id]);
    if (Number(x.total_cents) !== 17000) throw new Error('total was changed');
    throw new Error('ignored');
  }), /ignored/);

  const bySara = await rpc(dev, 'apply_discount', [o.id, 2000, w.A.staff.sara.id, '1111']);
  assert.deepEqual(bySara, { ok: false, error: 'not_manager' });
  const wrong = await rpc(dev, 'apply_discount', [o.id, 2000, w.A.staff.karim.id, '1234']);
  assert.deepEqual(wrong, { ok: false, error: 'invalid' });
  const good = await rpc(dev, 'apply_discount', [o.id, 2000, w.A.staff.karim.id, '9999']);
  assert.equal(good.ok, true);
  assert.equal(Number(good.total_cents), 15000);
  await assert.rejects(rpc(dev, 'apply_discount', [o.id, 99999, w.A.staff.karim.id, '9999']), /invalid_amount/);

  const [audit] = await as(w.users.ownerA,
    `select changes from public.audit_log where table_name = 'orders' and row_id = $1 order by id desc limit 1`, [o.id]);
  assert.equal(audit.changes.discount_cents.new, 2000);
  await assert.rejects(as(dev, `select * from public.audit_log`).then(r => { if (r.length === 0) throw new Error('hidden'); }), /hidden/,
    'devices cannot read the audit log');
});

test('line prices cannot be changed at the till, free lines can be typed', async () => {
  const o = await tillOrder(dev, w.A.r.id, [
    { item_id: w.A.items.tajine.id, price: 1 },            // price ignored
    { name: 'Divers', price: 1500, qty: 2 },               // free line
  ]);
  assert.equal(Number(o.total_cents), 8500 + 3000);
  const [line] = await as(dev, `select id from public.order_lines where order_id = $1 and menu_item_id is not null`, [o.id]);
  await assert.rejects(as(dev, `update public.order_lines set unit_price_cents = 1 where id = $1`, [line.id]), /only quantity/);
  await as(dev, `update public.order_lines set quantity = 3 where id = $1`, [line.id]);
  const [x] = await as(dev, `select total_cents from public.orders where id = $1`, [o.id]);
  assert.equal(Number(x.total_cents), 3 * 8500 + 3000);
});

test('closing requires exact payment and produces a numbered fiscal ticket', async () => {
  const o = await tillOrder(dev, w.A.r.id, [
    { item_id: w.A.items.tajine.id },                                // 85.00 @10%
    { item_id: w.A.items.jus.id, qty: 2 },                           // 40.00 @20%
  ]);
  assert.equal(Number(o.total_cents), 12500);
  await assert.rejects(rpc(dev, 'close_order', [o.id, w.A.staff.sara.id, null]), /payment_mismatch/);
  await pay(o.id, 'cash', 5000);
  await pay(o.id, 'card', 7500, 1000);
  const d = await rpc(dev, 'close_order', [o.id, w.A.staff.sara.id, null]);

  assert.match(d.doc_number, /^T-\d{4}-000001$/);
  assert.equal(d.doc_type, 'ticket');
  assert.equal(Number(d.total_ttc_cents), 12500);
  // 85.00 TTC at 10% -> 77.27 HT + 7.73 VAT ; 40.00 TTC at 20% -> 33.33 HT + 6.67 VAT
  assert.deepEqual(d.vat_breakdown, [
    { vat_bp: 1000, ht: 7727, vat: 773, ttc: 8500 },
    { vat_bp: 2000, ht: 3333, vat: 667, ttc: 4000 },
  ]);
  assert.equal(Number(d.total_ht_cents) + Number(d.total_vat_cents), 12500);
  assert.equal(d.seller.ice, '001234567000089');
  assert.equal(d.prev_hash, null);
  assert.match(d.hash, /^[0-9a-f]{64}$/);

  const d2o = await tillOrder(dev, w.A.r.id, [{ item_id: w.A.items.jus.id }]);
  await pay(d2o.id, 'cash', 2000);
  const d2 = await rpc(dev, 'close_order', [d2o.id, null, null]);
  assert.match(d2.doc_number, /-000002$/);
  assert.equal(d2.prev_hash, d.hash, 'hash chain links to previous document');

  await assert.rejects(rpc(dev, 'close_order', [o.id, null, null]), /order_already_closed/);
});

test('a closed order is frozen: no line, payment, discount or cancel changes', async () => {
  const o = await tillOrder(dev, w.A.r.id, [{ item_id: w.A.items.tajine.id }]);
  const [p] = await pay(o.id, 'cash', 8500);
  await rpc(dev, 'close_order', [o.id, null, null]);
  const [l] = await as(dev, `select id from public.order_lines where order_id = $1`, [o.id]);

  await assert.rejects(as(dev, `update public.order_lines set quantity = 5 where id = $1`, [l.id]), /closed/);
  await assert.rejects(as(dev, `delete from public.order_lines where id = $1`, [l.id]), /closed/);
  await assert.rejects(tillOrderLine(o.id), /closed/);
  await assert.rejects(as(dev, `delete from public.payments where id = $1`, [p.id]), /closed/);
  await assert.rejects(pay(o.id, 'cash', 100), /closed/);
  await assert.rejects(as(dev, `update public.orders set note = 'x' where id = $1`, [o.id]), /credit note/);
  await assert.rejects(rpc(dev, 'cancel_order', [o.id, 'oops', w.A.staff.karim.id, '9999']), /order_closed_use_credit_note/);
  // the kitchen can still mark it served
  await as(dev, `update public.orders set status = 'served' where id = $1`, [o.id]);
});

function tillOrderLine(orderId) {
  return as(dev, `insert into public.order_lines (restaurant_id, order_id, menu_item_id, name, unit_price_cents, quantity, vat_bp)
                  values ($1, $2, $3, '-', 0, 1, 0)`, [w.A.r.id, orderId, w.A.items.jus.id]);
}

test('fiscal documents are immutable, even for the database superuser', async () => {
  const [d] = await sql(`select id from public.fiscal_documents where restaurant_id = $1 limit 1`, [w.A.r.id]);
  await assert.rejects(sql(`update public.fiscal_documents set total_ttc_cents = 1 where id = $1`, [d.id]), /immutable/);
  await assert.rejects(sql(`delete from public.fiscal_documents where id = $1`, [d.id]), /immutable/);
  await assert.rejects(as(w.users.ownerA, `update public.fiscal_documents set reason = 'x' where id = $1`, [d.id]), /permission denied/);
});

test('discount is spread over lines and VAT stays consistent', async () => {
  const o = await tillOrder(dev, w.A.r.id, [
    { item_id: w.A.items.tajine.id },      // 8500 @10%
    { item_id: w.A.items.jus.id },         // 2000 @20%
  ]);
  await rpc(dev, 'apply_discount', [o.id, 1001, w.A.staff.karim.id, '9999']);
  await pay(o.id, 'card', 9499);
  const d = await rpc(dev, 'close_order', [o.id, null, null]);
  assert.equal(Number(d.total_ttc_cents), 9499);
  const lineDiscounts = d.lines.reduce((s, l) => s + Number(l.discount), 0);
  assert.equal(lineDiscounts, 1001);
  const vb = d.vat_breakdown.reduce((s, v) => s + Number(v.ttc), 0);
  assert.equal(vb, 9499);
  for (const l of d.lines) assert.equal(Number(l.ht) + Number(l.vat), Number(l.net_ttc));
});

test('invoice with buyer ICE for business customers', async () => {
  const o = await tillOrder(dev, w.A.r.id, [{ item_id: w.A.items.tajine.id }]);
  await pay(o.id, 'transfer', 8500);
  await assert.rejects(rpc(dev, 'close_order', [o.id, null, JSON.stringify({ name: 'X', ice: '123' })]), /invalid_buyer/);
  const d = await rpc(dev, 'close_order', [o.id, null, JSON.stringify({ name: 'Société X', ice: '000111222000033' })]);
  assert.equal(d.doc_type, 'invoice');
  assert.match(d.doc_number, /^F-\d{4}-000001$/);
});

test('credit note: manager PIN, negative mirror, only once', async () => {
  const [src] = await sql(`select * from public.fiscal_documents where restaurant_id = $1 and doc_type = 'ticket'
                           order by chain_index limit 1`, [w.A.r.id]);
  const noPin = await rpc(dev, 'issue_credit_note', [src.id, 'client mécontent', w.A.staff.sara.id, '1111']);
  assert.deepEqual(noPin, { ok: false, error: 'not_manager' });
  await assert.rejects(rpc(dev, 'issue_credit_note', [src.id, ' ', w.A.staff.karim.id, '9999']), /reason_required/);

  const res = await rpc(dev, 'issue_credit_note', [src.id, 'client mécontent', w.A.staff.karim.id, '9999']);
  const cn = res.document;
  assert.equal(cn.doc_type, 'credit_note');
  assert.match(cn.doc_number, /^A-\d{4}-000001$/);
  assert.equal(Number(cn.total_ttc_cents), -Number(src.total_ttc_cents));
  assert.equal(Number(cn.total_vat_cents), -Number(src.total_vat_cents));
  assert.equal(cn.original_document_id, src.id);
  assert.equal(cn.payments.reduce((s, p) => s + Number(p.amount), 0), -12500);

  await assert.rejects(rpc(dev, 'issue_credit_note', [src.id, 'again', w.A.staff.karim.id, '9999']), /already_credited/);
  await assert.rejects(rpc(dev, 'issue_credit_note', [cn.id, 'x', w.A.staff.karim.id, '9999']), /cannot_credit_a_credit_note/);
});

test('hash chain verifies, and detects tampering', async () => {
  const ok = await rpc(w.users.managerA, 'verify_fiscal_chain', [w.A.r.id]);
  assert.equal(ok.ok, true);
  assert.ok(ok.checked >= 5);
  await assert.rejects(rpc(dev, 'verify_fiscal_chain', [w.A.r.id]), /not allowed/);

  // simulate someone with raw database access editing an amount
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('alter table public.fiscal_documents disable trigger fiscal_documents_immutable');
    await c.query(`update public.fiscal_documents set total_ttc_cents = total_ttc_cents - 100
                   where restaurant_id = $1 and chain_index = 2`, [w.A.r.id]);
    const [{ r }] = (await c.query(
      `select public.verify_fiscal_chain($1) r from (select set_config('request.jwt.claims', $2, true)) s`,
      [w.A.r.id, JSON.stringify({ sub: w.users.ownerA.id })])).rows;
    assert.equal(r.ok, false);
    assert.equal(r.error, 'hash');
    assert.match(r.broken_at, /000002$/);
  } finally {
    await c.query('rollback');
    c.release();
  }
});

test('cancel: empty order freely, with lines only with manager PIN and reason', async () => {
  const empty = await tillOrder(dev, w.A.r.id, []);
  assert.equal((await rpc(dev, 'cancel_order', [empty.id, null, null, null])).ok, true);

  const o = await tillOrder(dev, w.A.r.id, [{ item_id: w.A.items.tajine.id }]);
  await assert.rejects(as(dev, `update public.orders set status = 'cancelled' where id = $1`, [o.id]), /dedicated function/);
  await assert.rejects(rpc(dev, 'cancel_order', [o.id, '', w.A.staff.karim.id, '9999']), /reason_required/);
  const [p] = await pay(o.id, 'cash', 100);
  await assert.rejects(rpc(dev, 'cancel_order', [o.id, 'erreur', w.A.staff.karim.id, '9999']), /remove_payments_first/);
  await as(dev, `delete from public.payments where id = $1`, [p.id]);
  assert.deepEqual(await rpc(dev, 'cancel_order', [o.id, 'erreur', w.A.staff.sara.id, '1111']), { ok: false, error: 'not_manager' });
  assert.equal((await rpc(dev, 'cancel_order', [o.id, 'erreur de saisie', w.A.staff.karim.id, '9999'])).ok, true);
  await assert.rejects(tillOrderLine(o.id), /cancelled/);
  await assert.rejects(as(dev, `update public.orders set status = 'new' where id = $1`, [o.id]), /reopened/);
});

test('X report and Z closing of the day', async () => {
  await as(dev, `insert into public.cash_movements (restaurant_id, business_date, kind, amount_cents, reason)
                 values ($1, '2000-01-01', 'float', 50000, 'fond de caisse')`, [w.A.r.id]);
  await as(dev, `insert into public.cash_movements (restaurant_id, business_date, kind, amount_cents, reason)
                 values ($1, '2000-01-01', 'payout', 3000, 'fournisseur pain')`, [w.A.r.id]);
  await assert.rejects(as(dev, `update public.cash_movements set amount_cents = 1 where restaurant_id = $1`, [w.A.r.id]),
    /append only|permission denied/);

  const x = await rpc(dev, 'day_report', [w.A.r.id, null]);
  assert.notEqual(x.business_date, '2000-01-01', 'business date is set by the server');
  // docs: T1 12500 (5000 cash + 7500 card, tip 1000), T2 2000 cash, T3 8500 cash, T4 9499 card,
  //       F1 8500 transfer, A1 -12500 (-5000 cash, -7500 card)
  assert.equal(x.tickets, 5);
  assert.equal(x.credit_notes, 1);
  assert.equal(Number(x.revenue_ttc_cents), 2000 + 8500 + 9499 + 8500);
  assert.deepEqual(x.payments, { cash: 10500, card: 9499, transfer: 8500 });
  assert.equal(Number(x.expected_cash_cents), 50000 + 10500 - 3000);
  assert.equal(x.closed, false);

  // an open order with lines blocks the Z
  const open = (await sql(`select count(*)::int n from public.orders where restaurant_id = $1 and closed_at is null
                           and status <> 'cancelled' and total_cents > 0`, [w.A.r.id]))[0].n;
  assert.ok(open > 0);
  const wrongPin = await rpc(dev, 'close_day', [w.A.r.id, x.business_date, w.A.staff.karim.id, '0000']);
  assert.equal(wrongPin.ok, false);
  await assert.rejects(rpc(dev, 'close_day', [w.A.r.id, x.business_date, w.A.staff.karim.id, '9999']), /open_orders/);

  // close or cancel everything still open, then Z
  const opens = await sql(`select id, total_cents from public.orders where restaurant_id = $1 and closed_at is null
                           and status <> 'cancelled' and total_cents > 0`, [w.A.r.id]);
  for (const o of opens) {
    await pay(o.id, 'cash', Number(o.total_cents));
    await rpc(dev, 'close_order', [o.id, null, null]);
  }
  const z = await rpc(dev, 'close_day', [w.A.r.id, x.business_date, w.A.staff.karim.id, '9999']);
  assert.equal(z.ok, true);
  await assert.rejects(rpc(dev, 'close_day', [w.A.r.id, x.business_date, w.A.staff.karim.id, '9999']), /day_closed/);

  // after the Z, no more sales or cash movements on that day
  const late = await tillOrder(dev, w.A.r.id, [{ item_id: w.A.items.jus.id }]);
  await pay(late.id, 'cash', 2000);
  await assert.rejects(rpc(dev, 'close_order', [late.id, null, null]), /day_closed/);
  await assert.rejects(as(dev, `insert into public.cash_movements (restaurant_id, business_date, kind, amount_cents, reason)
                                values ($1, current_date, 'payout', 100, 'late')`, [w.A.r.id]), /day already closed/);
  await assert.rejects(sql(`delete from public.day_closures where restaurant_id = $1`, [w.A.r.id]), /cannot be changed/);
  assert.equal((await rpc(dev, 'day_report', [w.A.r.id, null])).closed, true);
});
