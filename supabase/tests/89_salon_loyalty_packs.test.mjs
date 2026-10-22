// Loyalty, packs and gift cards at the salon's till: stamps per paid visit and the reward; a pack
// sold (at once or in parts), its sessions used at their value (the commission follows), what is
// still due; a gift card sold with a code and spent in parts; a cancelled ticket gives all back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world } from './helpers.mjs';

let w, A, rid, d, m, sara, brush, pack, cpId, gcCode;
const PH = '0612340000';
const pay = (body) => {
  const sub = body.lines.reduce((s, l) => s + (l.unit_cents ?? 0) * (l.quantity ?? 1), 0);
  return rpc(d, 'agenda_checkout', [rid, { phone: PH, name: 'Nadia', cash_cents: sub - (body.prepaid ?? 0), ...body }]);
};
before(async () => {
  w = await world(); A = w.A; rid = A.r.id; d = w.users.deviceA; m = w.users.managerA; sara = A.staff.sara.id;
  let off = 12 - new Date().getUTCHours(); if (off > 12) off -= 24;
  const tz = off === 0 ? 'UTC' : `Etc/GMT${off > 0 ? '-' : '+'}${Math.abs(off)}`;
  await sql(`update public.restaurants set products = '{agenda}', timezone = $2, day_cutoff_hour = 0,
               agenda = '{"enabled": true, "loyalty": {"enabled": true, "every": 3, "type": "amount", "value": 80, "name": "Brushing offert"}}' where id = $1`, [rid, tz]);
  [{ id: brush }] = await sql(`insert into public.agenda_services (restaurant_id, name, duration_min, price_cents) values ($1, '{"fr":"Brushing"}', 30, 8000) returning id`, [rid]);
});
after(() => pool.end());

test('loyalty: a stamp per paid visit, the reward at the third, then the card starts again', async () => {
  await assert.rejects(pay({ loyalty: true, lines: [{ service_id: brush, unit_cents: 8000, staff_id: sara }] }), /loyalty_not_ready/);
  for (let i = 0; i < 3; i++) await pay({ lines: [{ service_id: brush, unit_cents: 8000, staff_id: sara }] });
  const wl = await rpc(d, 'agenda_client_wallet', [rid, PH]);
  assert.equal(wl.loyalty.stamps, 3); assert.equal(wl.loyalty.ready, true);
  const s = await rpc(d, 'agenda_checkout', [rid, { phone: PH, loyalty: true, lines: [{ service_id: brush, unit_cents: 8000, staff_id: sara }] }]);
  assert.equal(Number(s.total_cents), 0); assert.equal(Number(s.loyalty_cents), 8000); assert.equal(s.stamps, 0);
  assert.equal((await rpc(d, 'agenda_client_wallet', [rid, PH])).loyalty.ready, false);
  // cancelling the reward ticket gives the stamps back
  await rpc(m, 'agenda_sale_cancel', [rid, s.id, 'Erreur', null, null]);
  assert.equal((await rpc(d, 'agenda_client_wallet', [rid, PH])).loyalty.stamps, 3);
});

test('a pack paid in two parts; its sessions used at their value, with the commission', async () => {
  [{ id: pack }] = await as(m, `insert into public.agenda_packs (restaurant_id, name, service_id, sessions, price_cents) values ($1, '5 brushings', $2, 5, 30000) returning id`, [rid, brush]);
  await assert.rejects(as(d, `insert into public.agenda_packs (restaurant_id, name, service_id, sessions, price_cents) values ($1, 'X', $2, 5, 30000)`, [rid, brush]));
  await assert.rejects(rpc(d, 'agenda_checkout', [rid, { lines: [{ kind: 'pack', pack_id: pack, unit_cents: 30000 }], cash_cents: 30000 }]), /phone_required/);
  const s = await pay({ lines: [{ kind: 'pack', pack_id: pack, unit_cents: 10000 }] });
  assert.equal(s.made[0].kind, 'pack'); assert.equal(Number(s.made[0].due_cents), 20000); cpId = s.made[0].id;
  let wl = await rpc(d, 'agenda_client_wallet', [rid, PH]);
  assert.equal(wl.packs.length, 1); assert.equal(wl.packs[0].left, 5); assert.equal(Number(wl.packs[0].session_cents), 6000);
  await assert.rejects(pay({ lines: [{ kind: 'pack_payment', client_pack_id: cpId, unit_cents: 25000 }] }), /invalid_request/);
  await pay({ lines: [{ kind: 'pack_payment', client_pack_id: cpId, unit_cents: 20000 }] });
  // a session: the line is worth 60 DH, paid by the pack, the person gets her commission on it
  const u = await rpc(d, 'agenda_checkout', [rid, { phone: PH, lines: [{ service_id: brush, unit_cents: 0, staff_id: sara, use_pack: cpId }], cash_cents: 0 }]);
  assert.equal(Number(u.prepaid_cents), 6000); assert.equal(Number(u.total_cents), 6000);
  wl = await rpc(d, 'agenda_client_wallet', [rid, PH]);
  assert.equal(wl.packs[0].left, 4); assert.equal(Number(wl.packs[0].due_cents), 0);
  const [ln] = await sql(`select unit_cents, staff_id from public.agenda_sale_lines where sale_id = $1`, [u.id]);
  assert.equal(Number(ln.unit_cents), 6000); assert.equal(ln.staff_id, sara);
  // only the client's own pack
  await assert.rejects(rpc(d, 'agenda_checkout', [rid, { phone: '0699999999', lines: [{ service_id: brush, unit_cents: 0, use_pack: cpId }], cash_cents: 0 }]), /pack_not_client/);
  await rpc(m, 'agenda_sale_cancel', [rid, u.id, 'Erreur', null, null]);
  assert.equal((await rpc(d, 'agenda_client_wallet', [rid, PH])).packs[0].left, 5);
});

test('a gift card: sold with a code, spent in parts, never more than its balance', async () => {
  const s = await rpc(d, 'agenda_checkout', [rid, { lines: [{ kind: 'giftcard', unit_cents: 20000, name: 'Maman' }], card_cents: 20000 }]);
  gcCode = s.made[0].code; assert.match(gcCode, /^KDO-/);
  const [ln] = await sql(`select staff_id, kind from public.agenda_sale_lines where sale_id = $1`, [s.id]);
  assert.equal(ln.kind, 'giftcard'); assert.equal(ln.staff_id, null);
  assert.equal(Number((await rpc(d, 'agenda_giftcard_check', [rid, gcCode.toLowerCase()])).balance_cents), 20000);
  // 80 brushing: 50 by the card, 30 cash
  await rpc(d, 'agenda_checkout', [rid, { lines: [{ service_id: brush, unit_cents: 8000, staff_id: sara }], giftcard_code: gcCode, giftcard_cents: 5000, cash_cents: 3000 }]);
  assert.equal(Number((await rpc(d, 'agenda_giftcard_check', [rid, gcCode])).balance_cents), 15000);
  await assert.rejects(rpc(d, 'agenda_checkout', [rid, { lines: [{ service_id: brush, unit_cents: 8000 }], giftcard_code: gcCode, giftcard_cents: 16000, cash_cents: 0 }]), /giftcard_balance/);
  await assert.rejects(rpc(d, 'agenda_checkout', [rid, { lines: [{ service_id: brush, unit_cents: 8000 }], giftcard_code: gcCode, giftcard_cents: 5000, cash_cents: 5000 }]), /payment_mismatch/);
  const l = await rpc(m, 'agenda_prepaid_list', [rid]);
  assert.equal(l.giftcards.length, 1); assert.equal(l.packs.length, 1);
  assert.equal(Number(l.outstanding_cents), 15000 + 30000);
  await assert.rejects(rpc(d, 'agenda_prepaid_list', [rid]));
  // the commission counts the brushing, not the gift card sale
  await sql(`insert into public.agenda_pay_plans (restaurant_id, staff_id, service_rate_bp) values ($1, $2, 5000)`, [rid, sara]);
  const [{ m: month }] = await sql(`select to_char(date_trunc('month', now()), 'YYYY-MM-DD') m`);
  const p = (await rpc(w.users.ownerA, 'agenda_payroll', [rid, month])).staff.find(x => x.staff_id === sara);
  assert.equal(Number(p.products_cents), 0);
});
