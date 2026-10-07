// Local demo data for the live stock (Dom's café on the local stack): ingredients, recipe cards,
// a starting stock, a morning of sales at the till and one loss. Run after setup-till.mjs.
import pg from 'pg';
const db = new pg.Pool({ connectionString: 'postgres://postgres@localhost:54332/postgres' });
const q = async (s, p = []) => (await db.query(s, p)).rows;
const as = async (uid, text, params = []) => {
  const c = await db.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    const r = await c.query(text, params); await c.query('commit'); return r.rows;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
};
const [{ id: rid }] = await q(`select id from restaurants where slug = 'doms-cafe'`);
const [{ id: owner }] = await q(`select id from auth.users where email = 'eigenaar@doms.test'`);
const [{ id: device }] = await q(`select id from auth.users where email = 'kassa@doms.test'`);
const item = async (name) => (await q(`select id, price_cents from menu_items where restaurant_id = $1 and name->>'fr' = $2`, [rid, name]))[0];
await q(`delete from stock_moves where restaurant_id = $1`, [rid]);
await q(`delete from recipe_lines where restaurant_id = $1`, [rid]);
const ing = async (name, base, unit, qty, price, cat) => (await q(
  `insert into ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents, category)
   values ($1, $2, $3, $4, $5, $6, $7)
   on conflict (restaurant_id, lower(btrim(name))) do update set purchase_price_cents = excluded.purchase_price_cents, active = true, stock_qty = null, stock_since = null
   returning id`, [rid, name, base, unit, qty, price, cat]))[0].id;
const G = {
  oeufs: await ing('Œufs', 'pc', 'plateau de 30', 30, 4500, 'laitier'),
  fromage: await ing('Fromage râpé', 'g', 'kg', 1000, 9000, 'laitier'),
  lait: await ing('Lait entier', 'ml', 'litre', 1000, 900, 'laitier'),
  croissant: await ing('Croissant surgelé', 'pc', 'carton de 50', 50, 7500, 'boulangerie'),
  nutella: await ing('Pâte à tartiner', 'g', 'pot 3 kg', 3000, 21000, 'epicerie'),
  champi: await ing('Champignons', 'g', 'kg', 1000, 3000, 'legumes'),
};
const rec = async (dish, lines) => { const it = await item(dish); for (const [g, n] of lines) await q(`insert into recipe_lines (restaurant_id, menu_item_id, ingredient_id, qty) values ($1, $2, $3, $4)`, [rid, it.id, g, n]); };
await rec('Omelette Nature', [[G.oeufs, 3]]);
await rec('Omelette Fromage', [[G.oeufs, 3], [G.fromage, 40]]);
await rec('Omelette Champignons', [[G.oeufs, 3], [G.champi, 60]]);
await rec('Croissant', [[G.croissant, 1]]);
await rec('Crêpe Nutella', [[G.nutella, 40], [G.lait, 100], [G.oeufs, 1]]);
await rec('Toast Fromage', [[G.fromage, 50]]);
await q(`update menu_items set available = true, sold_out_by_stock = false where restaurant_id = $1`, [rid]);
await q(`update restaurants set profit_settings = profit_settings || '{"auto_sold_out": true}' where id = $1`, [rid]);
for (const [g, n, min] of [[G.oeufs, 60, 30], [G.fromage, 2500, null], [G.lait, 4000, 2000], [G.croissant, 14, 10], [G.nutella, 900, null], [G.champi, 300, 500]]) {
  await as(owner, `select public.stock_set($1, $2, null)`, [g, n]);
  if (min != null) await q(`update ingredients set stock_min = $2 where id = $1`, [g, min]);
}
const sell = async (dish, qty) => {
  const it = await item(dish);
  const [o] = await as(device, `insert into orders (restaurant_id, client_id, business_date, ticket_number, source, order_type) values ($1, gen_random_uuid(), current_date, 0, 'pos', 'takeaway') returning id`, [rid]);
  await as(device, `insert into order_lines (restaurant_id, order_id, menu_item_id, name, unit_price_cents, quantity, vat_bp) values ($1, $2, $3, $4, $5, $6, 1000)`, [rid, o.id, it.id, dish, it.price_cents, qty]);
  const [{ total_cents }] = await q(`select total_cents from orders where id = $1`, [o.id]);
  await as(device, `select public.pos_pay_order($1, $2, null, null)`, [o.id, JSON.stringify([{ method: 'cash', amount_cents: Number(total_cents) }])]);
};
await sell('Omelette Fromage', 5); await sell('Croissant', 3); await sell('Crêpe Nutella', 2); await sell('Omelette Champignons', 5); await sell('Croissant', 2);
await as(device, `select public.pos_stock_waste($1, $2, null, 1, 'Tombé', null)`, [rid, (await item('Croissant')).id]);
console.log('live stock demo ready');
await db.end();
