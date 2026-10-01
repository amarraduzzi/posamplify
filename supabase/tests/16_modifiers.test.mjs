// Extras and set menus: only options of the dish's groups, min/max enforced,
// prices always from the database (till and QR menu alike).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, rpc, world, guestOrder } from './helpers.mjs';

let w, A, sup, cuisson, opt;
before(async () => {
  w = await world(); A = w.A;
  const m = w.users.managerA, rid = A.r.id;
  const grp = async (name, min, max, sort) => (await as(m, `insert into public.modifier_groups (restaurant_id, name, min_select, max_select, sort_order) values ($1, $2, $3, $4, $5) returning *`,
    [rid, JSON.stringify({ fr: name }), min, max, sort]))[0];
  const option = async (g, name, price) => (await as(m, `insert into public.modifier_options (restaurant_id, group_id, name, price_cents) values ($1, $2, $3, $4) returning *`,
    [rid, g.id, JSON.stringify({ fr: name }), price]))[0];
  cuisson = await grp('Cuisson', 1, 1, 0);
  sup = await grp('Suppléments', 0, 2, 1);
  opt = {
    saignant: await option(cuisson, 'Saignant', 0), bien: await option(cuisson, 'Bien cuit', 0),
    fromage: await option(sup, 'Fromage', 500), bacon: await option(sup, 'Bacon', 800), oeuf: await option(sup, 'Oeuf', 300),
  };
  for (const [g, i] of [[cuisson, 0], [sup, 1]]) {
    await as(m, `insert into public.item_modifier_groups (restaurant_id, menu_item_id, group_id, sort_order) values ($1, $2, $3, $4)`, [rid, A.items.tajine.id, g.id, i]);
  }
});
after(() => pool.end());

const order = async () => (await as(w.users.deviceA, `insert into public.orders (restaurant_id, client_id, business_date, ticket_number, source, order_type)
  values ($1, gen_random_uuid(), current_date, 0, 'pos', 'takeaway') returning *`, [A.r.id]))[0];
const line = (o, item, mods) => as(w.users.deviceA, `insert into public.order_lines (restaurant_id, order_id, menu_item_id, name, unit_price_cents, quantity, vat_bp, modifiers)
  values ($1, $2, $3, '-', 1, 1, 0, $4) returning *`, [A.r.id, o.id, item, JSON.stringify(mods)]).then(r => r[0]);

test('the till: options priced and named by the database', async () => {
  const o = await order();
  // the browser even tries a price of 0 for bacon: ignored
  const l = await line(o, A.items.tajine.id, [{ id: opt.bien.id }, { id: opt.fromage.id }, { id: opt.bacon.id, price_cents: 0 }]);
  assert.equal(Number(l.unit_price_cents), 8500 + 500 + 800);
  assert.equal(l.name, 'Tajine + Bien cuit, Fromage, Bacon');
  assert.deepEqual(l.modifiers.map(x => [x.name, Number(x.price_cents)]), [['Bien cuit', 0], ['Fromage', 500], ['Bacon', 800]]);
  const [{ total_cents }] = await sql(`select total_cents from public.orders where id = $1`, [o.id]);
  assert.equal(Number(total_cents), 9800);
  await assert.rejects(as(w.users.deviceA, `update public.order_lines set modifiers = '[]' where id = $1`, [l.id]), /only quantity/);
});

test('min and max per group, and only the dish own options', async () => {
  const o = await order();
  await assert.rejects(line(o, A.items.tajine.id, [{ id: opt.fromage.id }]), /choice required/, 'cooking is required');
  await assert.rejects(line(o, A.items.tajine.id, [{ id: opt.bien.id }, { id: opt.saignant.id }]), /choice required/, 'only one cooking');
  await assert.rejects(line(o, A.items.tajine.id, [{ id: opt.bien.id }, { id: opt.fromage.id }, { id: opt.bacon.id }, { id: opt.oeuf.id }]), /choice required/, 'max 2 extras');
  await assert.rejects(line(o, A.items.jus.id, [{ id: opt.fromage.id }]), /not available/, 'not a juice option');
  const l = await line(o, A.items.jus.id, []);
  assert.equal(Number(l.unit_price_cents), 2000);
  await as(w.users.managerA, `update public.modifier_options set active = false where id = $1`, [opt.oeuf.id]);
  await assert.rejects(line(o, A.items.tajine.id, [{ id: opt.bien.id }, { id: opt.oeuf.id }]), /not available/, 'switched off');
});

test('the QR menu shows the groups and guest orders are priced the same way', async () => {
  const menu = await rpc(null, 'get_menu', [A.r.slug, null]);
  const taj = menu.items.find(i => i.id === A.items.tajine.id);
  assert.deepEqual(taj.modifier_groups.map(g => [g.name.fr, g.min, g.max, g.options.length]), [['Cuisson', 1, 1, 2], ['Suppléments', 0, 2, 2]]);
  assert.deepEqual(menu.items.find(i => i.id === A.items.jus.id).modifier_groups, []);
  const place = (items) => rpc(null, 'place_order', [A.r.slug, JSON.stringify(guestOrder(A.tables.t1.qr_token, items))]);
  await assert.rejects(place([{ item_id: A.items.tajine.id, quantity: 1, modifiers: [opt.fromage.id] }]), /choice required/);
  const res = await place([{ item_id: A.items.tajine.id, quantity: 2, modifiers: [opt.saignant.id, opt.bacon.id] }]);
  assert.equal(Number(res.total_cents), 2 * (8500 + 800));
});

test('only managers edit options; the till reads them; B never sees them', async () => {
  await assert.rejects(as(w.users.deviceA, `insert into public.modifier_groups (restaurant_id, name) values ($1, '{"fr":"x"}')`, [A.r.id]), /row-level security/);
  assert.ok((await as(w.users.deviceA, `select id from public.modifier_options`)).length >= 4);
  assert.equal((await as(w.users.deviceB, `select id from public.modifier_options where restaurant_id = $1`, [A.r.id])).length, 0);
});
