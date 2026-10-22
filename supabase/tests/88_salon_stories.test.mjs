// The salon's clients on Instagram: the mirror frame of a paid ticket, the code for the next visit
// after sharing (the owner's actions), the code used once at the till, given back on a cancel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world } from './helpers.mjs';

let w, A, rid, d, m, sara, cut, token, code;
before(async () => {
  w = await world(); A = w.A; rid = A.r.id; d = w.users.deviceA; m = w.users.managerA; sara = A.staff.sara.id;
  let off = 12 - new Date().getUTCHours(); if (off > 12) off -= 24;
  const tz = off === 0 ? 'UTC' : `Etc/GMT${off > 0 ? '-' : '+'}${Math.abs(off)}`;
  const actions = [
    { id: 'pct', on: true, name: '-10 % prochaine visite', when: 'next', type: 'percent', value: 10, min: 50, valid_days: 30, delay: 'now', max_per_week: 2 },
    { id: 'off', on: false, name: 'Désactivée', when: 'next', type: 'amount', value: 20 },
  ];
  await sql(`update public.restaurants set products = '{agenda}', timezone = $2, day_cutoff_hour = 0,
               branding = branding || jsonb_build_object('instagram', '@salon.test', 'guest_actions', $3::jsonb) where id = $1`, [rid, tz, JSON.stringify(actions)]);
  [{ id: cut }] = await sql(`insert into public.agenda_services (restaurant_id, name, duration_min, price_cents) values ($1, '{"fr":"Brushing"}', 30, 10000) returning id`, [rid]);
  const s = await rpc(d, 'agenda_checkout', [rid, { name: 'Nadia', lines: [{ service_id: cut, unit_cents: 10000, staff_id: sara }], cash_cents: 10000 }]);
  token = s.share_token;
});
after(() => pool.end());

test('the mirror frame of a paid ticket: the salon, the prestation, who did it, the active actions', async () => {
  assert.ok(token && token.length >= 16);
  const x = await rpc(null, 'salon_mirror', [token]);
  assert.equal(x.salon.handle, 'salon.test'); assert.deepEqual(x.services, ['Brushing']); assert.deepEqual(x.staff, ['Sara']);
  assert.deepEqual(x.actions.map(a => a.id), ['pct']); assert.equal(x.salon.branding.guest_actions, undefined);
  assert.equal(await rpc(null, 'salon_mirror', ['nope']), null);
});

test('after sharing: one code per ticket, weekly cap, switched-off actions give nothing', async () => {
  const a = await rpc(null, 'salon_voucher', [token, 'pct']);
  assert.equal(a.status, 'ok'); code = a.code;
  assert.equal((await rpc(null, 'salon_voucher', [token, 'pct'])).code, code);
  const s2 = await rpc(d, 'agenda_checkout', [rid, { lines: [{ service_id: cut, unit_cents: 10000 }], cash_cents: 10000 }]);
  assert.equal((await rpc(null, 'salon_voucher', [s2.share_token, 'off'])).status, 'none');
  assert.equal((await rpc(null, 'salon_voucher', [s2.share_token, 'pct'])).status, 'ok');
  const s3 = await rpc(d, 'agenda_checkout', [rid, { lines: [{ service_id: cut, unit_cents: 10000 }], cash_cents: 10000 }]);
  assert.equal((await rpc(null, 'salon_voucher', [s3.share_token, 'pct'])).status, 'full');
  assert.equal((await rpc(null, 'salon_mirror', [token])).voucher.code, code);
});

test('at the till: the code works once, with its minimum; a cancel gives it back', async () => {
  assert.equal((await rpc(d, 'agenda_voucher_check', [rid, code.toLowerCase()])).ok, true);
  assert.equal((await rpc(d, 'agenda_voucher_check', [rid, 'XX-NOPE'])).error, 'voucher_unknown');
  await assert.rejects(rpc(d, 'agenda_checkout', [rid, { voucher_code: code, lines: [{ kind: 'other', name: 'Petit', unit_cents: 4000 }], cash_cents: 3600 }]), /voucher_min/);
  // 10 % of 120 = 12 off
  const s = await rpc(d, 'agenda_checkout', [rid, { voucher_code: code, lines: [{ service_id: cut, unit_cents: 12000 }], cash_cents: 10800 }]);
  assert.equal(Number(s.total_cents), 10800); assert.equal(Number(s.voucher_cents), 1200);
  const [row] = await sql(`select discount_cents, discount_reason from public.agenda_sales where id = $1`, [s.id]);
  assert.equal(Number(row.discount_cents), 1200); assert.match(row.discount_reason, new RegExp(code));
  await assert.rejects(rpc(d, 'agenda_checkout', [rid, { voucher_code: code, lines: [{ service_id: cut, unit_cents: 12000 }], cash_cents: 10800 }]), /voucher_used/);
  await rpc(m, 'agenda_sale_cancel', [rid, s.id, 'Erreur', null, null]);
  assert.equal((await rpc(d, 'agenda_voucher_check', [rid, code])).ok, true);
  const st = await rpc(m, 'agenda_voucher_stats', [rid, 30]);
  assert.equal(st.issued, 2); assert.equal(st.used, 0);
  await assert.rejects(rpc(w.users.deviceB, 'agenda_voucher_check', [rid, code]));
});

test('the booking page carries the salon\'s @ for its story', async () => {
  const x = await rpc(d, 'agenda_save', [rid, { staff_id: sara, service_id: cut, starts_at: new Date(Date.now() + 86400_000).toISOString(), name: 'Imane' }, true]);
  const [{ token: t }] = await sql(`select token from public.agenda_appointments where id = $1`, [x.id]);
  const st = await rpc(null, 'agenda_status', [t]);
  assert.equal(st.salon.handle, 'salon.test'); assert.equal(st.salon.branding.guest_actions, undefined);
});
