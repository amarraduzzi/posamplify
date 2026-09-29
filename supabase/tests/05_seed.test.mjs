// The generated Dom's Café seed loads cleanly and serves through get_menu.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pool, sql, rpc, uuid } from './helpers.mjs';

after(() => pool.end());
const seedPath = new URL('../seed.sql', import.meta.url);

test('seed.sql loads twice (idempotent) and the menu is served', { skip: !existsSync(seedPath) }, async () => {
  const seed = readFileSync(seedPath, 'utf8');
  await pool.query(seed);
  await pool.query(seed);
  const m = await rpc(null, 'get_menu', ['doms-cafe', null]);
  assert.equal(m.restaurant.name, "Dom's Café");
  assert.ok(m.items.length >= 90, `items: ${m.items.length}`);
  assert.ok(m.categories.every(c => c.icon), 'categories have icons');
  const [{ n }] = await sql(`select count(*)::int n from public.menu_items m join public.restaurants r on r.id = m.restaurant_id where r.slug = 'doms-cafe'`);
  assert.equal(n, m.items.length, "no duplicates after loading twice");
  const [{ token }] = await sql(`select qr_token token from public.dining_tables t join public.restaurants r on r.id = t.restaurant_id
                                 where r.slug = 'doms-cafe' and t.label = '1'`);
  const item = m.items.find(i => i.variants.length === 0 && i.available);
  const res = await rpc(null, 'place_order', ['doms-cafe', JSON.stringify({
    client_id: uuid(), order_type: 'dine_in', table_token: token, items: [{ item_id: item.id, quantity: 2 }] })]);
  assert.equal(Number(res.total_cents), 2 * Number(item.price_cents));
});
