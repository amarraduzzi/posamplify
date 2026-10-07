// The owner's live view: today's figures and the alerts worth a look.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, tillOrder } from './helpers.mjs';

let w, A, rid, dev;
before(async () => { w = await world(); A = w.A; rid = A.r.id; dev = w.users.deviceA; });
after(() => pool.end());

test('owner_live: revenue, open orders and alerts', async () => {
  const o = await tillOrder(dev, rid, [{ item_id: A.items.tajine.id }]);
  const d = await rpc(dev, 'apply_discount', [o.id, 3000, A.staff.karim.id, '9999']);
  assert.equal(d.ok, true);
  await rpc(dev, 'pos_pay_order', [o.id, JSON.stringify([{ method: 'cash', amount_cents: 5500 }]), A.staff.sara.id, null]);
  await tillOrder(dev, rid, [{ item_id: A.items.jus.id }]);
  const day = (await sql(`select business_date::text d from public.orders where id = $1`, [o.id]))[0].d;
  await as(dev, `insert into public.cash_movements (restaurant_id, business_date, kind, amount_cents, reason) values ($1, $2, 'payout', 20000, 'Fournisseur pain')`, [rid, day]);
  const live = await rpc(w.users.ownerA, 'owner_live', [rid]);
  assert.equal(Number(live.revenue_cents), 5500);
  assert.equal(Number(live.tickets), 1);
  assert.equal(Number(live.open_orders), 1);
  const kinds = live.alerts.map(a => a.kind).sort();
  assert.ok(kinds.includes('discount'), 'a 30 DH discount on 85 DH is flagged');
  assert.ok(kinds.includes('payout'));
  await assert.rejects(rpc(dev, 'owner_live', [rid]), /not_allowed|not allowed/);
  await as(w.users.ownerA, `update public.restaurants set owner_whatsapp = '+212 600 000 000' where id = $1`, [rid]);
});

test('get_site: by slug or own domain, noindex until switched on', async () => {
  const s0 = await rpc(null, 'get_site', [A.r.slug, null]);
  assert.equal(s0.noindex, true);
  assert.ok(s0.items.length > 0);
  await as(w.users.ownerA, `update public.restaurants set site = '{"enabled": true, "domain": "www.resto-a.ma", "theme": "riad"}' where id = $1`, [rid]);
  const s1 = await rpc(null, 'get_site', [null, 'resto-a.ma']);
  assert.equal(s1.noindex, false);
  assert.equal(s1.site.theme, 'riad');
  assert.equal(await rpc(null, 'get_site', [null, 'autre.ma']), null);
  await assert.rejects(as(w.users.ownerB, `update public.restaurants set site = '{"domain": "WWW.resto-a.ma"}' where id = $1`, [w.B.r.id]), /restaurants_site_domain_idx|duplicate/);
});
