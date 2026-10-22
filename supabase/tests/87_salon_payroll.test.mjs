// The salon's pay: rules per person (salary plus or as a minimum, commission flat / by brackets /
// per prestation, products on price or margin, tips), advances and bonuses, the month marked paid.
// Owner only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, A, rid, d, o, m, sara, karim, color, cut, shampoo, month;
const sale = (lines, extra = {}) => {
  const total = lines.reduce((s, l) => s + l.unit_cents * (l.quantity ?? 1), 0) - (extra.discount_cents ?? 0);
  return rpc(d, 'agenda_checkout', [rid, { lines, cash_cents: total + (extra.tip_cents ?? 0), ...extra }]);
};
const pay = async (id) => (await rpc(o, 'agenda_payroll', [rid, month])).staff.find(x => x.staff_id === id);
before(async () => {
  w = await world(); A = w.A; rid = A.r.id; d = w.users.deviceA; o = w.users.ownerA; m = w.users.managerA;
  sara = A.staff.sara.id; karim = A.staff.karim.id;
  let off = 12 - new Date().getUTCHours(); if (off > 12) off -= 24;
  const tz = off === 0 ? 'UTC' : `Etc/GMT${off > 0 ? '-' : '+'}${Math.abs(off)}`;
  await sql(`update public.restaurants set products = '{agenda}', timezone = $2, day_cutoff_hour = 0 where id = $1`, [rid, tz]);
  [{ id: color }] = await sql(`insert into public.agenda_services (restaurant_id, name, duration_min, price_cents) values ($1, '{"fr":"Couleur"}', 90, 40000) returning id`, [rid]);
  [{ id: cut }] = await sql(`insert into public.agenda_services (restaurant_id, name, duration_min, price_cents) values ($1, '{"fr":"Coupe"}', 30, 10000) returning id`, [rid]);
  [{ id: shampoo }] = await sql(`insert into public.agenda_products (restaurant_id, name, kind, price_cents, cost_cents) values ($1, 'Shampoing', 'retail', 10000, 4000) returning id`, [rid]);
  [{ m: month }] = await sql(`select to_char(date_trunc('month', (now() at time zone $1)::date), 'YYYY-MM-DD') m`, [tz]);
  // Sara: a colour (400) and a cut (100) with a 50 discount on the ticket, a shampoo sold, a 20 tip
  await sale([{ service_id: color, unit_cents: 40000, staff_id: sara }, { service_id: cut, unit_cents: 10000, staff_id: sara }], { discount_cents: 5000, staff_id: sara, tip_cents: 2000 });
  await sale([{ product_id: shampoo, unit_cents: 10000, staff_id: sara }]);
  // Karim: 3 cuts (300)
  await sale([{ service_id: cut, unit_cents: 10000, staff_id: karim, quantity: 3 }]);
  // a cancelled ticket counts for nobody
  const x = await sale([{ service_id: color, unit_cents: 40000, staff_id: karim }]);
  await rpc(m, 'agenda_sale_cancel', [rid, x.id, 'Erreur', null, null]);
});
after(() => pool.end());

test('only the owner sees and sets the pay', async () => {
  await assert.rejects(rpc(m, 'agenda_payroll', [rid, month]));
  await assert.rejects(rpc(d, 'agenda_payroll', [rid, month]));
  await assert.rejects(rpc(w.users.ownerB, 'agenda_payroll', [rid, month]));
  await assert.rejects(rpc(m, 'agenda_pay_plan_save', [rid, sara, { service_rate_bp: 4000 }]));
  const s = await pay(sara);
  assert.equal(s.has_plan, false); assert.equal(Number(s.services_cents), 45000); assert.equal(Number(s.products_cents), 10000); assert.equal(Number(s.net_cents), 2000);
});

test('salary plus a flat rate; products on the margin; tips with the pay', async () => {
  await rpc(o, 'agenda_pay_plan_save', [rid, sara, { base_cents: 200000, base_mode: 'plus', service_mode: 'flat', service_rate_bp: 4000, product_rate_bp: 1000, product_basis: 'margin' }]);
  const s = await pay(sara);
  // 40 % of 450 = 180; 10 % of the margin (100 - 40) = 6; salary 2000; tip 20
  assert.equal(Number(s.service_commission_cents), 18000); assert.equal(Number(s.product_commission_cents), 600);
  assert.equal(Number(s.earned_cents), 218600); assert.equal(Number(s.net_cents), 220600);
  await rpc(o, 'agenda_pay_plan_save', [rid, sara, { base_cents: 200000, service_rate_bp: 4000, product_rate_bp: 1000, product_basis: 'margin', tips_in_pay: false }]);
  assert.equal(Number((await pay(sara)).net_cents), 218600);
});

test('the higher of salary and commission; brackets; a rate per prestation', async () => {
  await rpc(o, 'agenda_pay_plan_save', [rid, karim, { base_cents: 5000, base_mode: 'max', service_mode: 'flat', service_rate_bp: 5000 }]);
  assert.equal(Number((await pay(karim)).earned_cents), 15000);   // 50 % of 300 = 150 > 50
  await rpc(o, 'agenda_pay_plan_save', [rid, karim, { base_cents: 20000, base_mode: 'max', service_mode: 'flat', service_rate_bp: 5000 }]);
  assert.equal(Number((await pay(karim)).earned_cents), 20000);   // the minimum
  // nothing up to 200, then 50 %: (300 - 200) x 50 % = 50
  await rpc(o, 'agenda_pay_plan_save', [rid, karim, { service_mode: 'tiers', tiers: [{ from_cents: 0, rate_bp: 0 }, { from_cents: 20000, rate_bp: 5000 }] }]);
  assert.equal(Number((await pay(karim)).commission_cents), 5000);
  await assert.rejects(rpc(o, 'agenda_pay_plan_save', [rid, karim, { service_mode: 'tiers', tiers: [{ from_cents: 100, rate_bp: 10 }] }]), /invalid_request/);
  await assert.rejects(rpc(o, 'agenda_pay_plan_save', [rid, karim, { service_mode: 'tiers', tiers: [] }]), /invalid_request/);
  await assert.rejects(rpc(o, 'agenda_pay_plan_save', [rid, karim, { service_rates: { [w.B.r.id]: 100 } }]), /invalid_request/);
  // per prestation: colour 20 %, the rest 40 % (Sara: 360 colour after discount, 90 cut)
  await rpc(o, 'agenda_pay_plan_save', [rid, sara, { service_mode: 'by_service', service_rate_bp: 4000, service_rates: { [color]: 2000 } }]);
  assert.equal(Number((await pay(sara)).service_commission_cents), 7200 + 3600);
});

test('advances and bonuses; the month marked paid keeps its figures', async () => {
  await as(o, `insert into public.agenda_pay_items (restaurant_id, staff_id, month, kind, amount_cents, note) values ($1, $2, $3, 'advance', 3000, 'Avance'), ($1, $2, $3, 'bonus', 1000, 'Prime')`, [rid, karim, month]);
  await assert.rejects(as(m, `insert into public.agenda_pay_items (restaurant_id, staff_id, month, kind, amount_cents) values ($1, $2, $3, 'bonus', 100)`, [rid, karim, month]));
  const before = await pay(karim);
  assert.equal(Number(before.net_cents), 5000 + 1000 - 3000);
  await rpc(o, 'agenda_payout_set', [rid, karim, month, true]);
  // a new sale after the month is paid does not change it, nor can items be added to it
  await sale([{ service_id: cut, unit_cents: 10000, staff_id: karim, quantity: 2 }]);
  const after = await pay(karim);
  assert.ok(after.paid_at); assert.equal(Number(after.net_cents), 3000);
  await assert.rejects(as(o, `insert into public.agenda_pay_items (restaurant_id, staff_id, month, kind, amount_cents) values ($1, $2, $3, 'bonus', 100)`, [rid, karim, month]));
  await rpc(o, 'agenda_payout_set', [rid, karim, month, false]);
  assert.equal(Number((await pay(karim)).commission_cents), 15000);   // (500 - 200) x 50 %
  assert.equal((await as(m, `select count(*)::int n from public.agenda_pay_plans where restaurant_id = $1`, [rid]))[0].n, 0);
});

test('"Mes chiffres" on the till: with the own PIN, never the salary or the advances', async () => {
  assert.equal((await rpc(d, 'agenda_my_month', [rid, karim, '0000', null])).error, 'invalid');
  const x = await rpc(d, 'agenda_my_month', [rid, karim, '9999', null]);
  assert.equal(x.ok, true); assert.equal(Number(x.services_cents), 50000); assert.equal(Number(x.commission_cents), 15000);
  assert.equal(x.days.length, 1); assert.equal(Number(x.days[0].cents), 50000);
  assert.equal(x.net_cents, undefined); assert.equal(x.advance_cents, undefined); assert.equal(x.base_cents, undefined);
  await assert.rejects(rpc(d, 'agenda_my_month', [rid, karim, '9999', '2099-01-01']), /invalid_date/);
  await assert.rejects(rpc(w.users.deviceB, 'agenda_my_month', [rid, karim, '9999', null]));
});
