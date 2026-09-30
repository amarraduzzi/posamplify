// End-to-end: menu analysis (stars, popular-but-poor, profitable-but-unknown, to remove). Local stack + admin :5175.
import { chromium } from 'playwright';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const OUT = process.env.OUT ?? '/tmp/profit';
const db = new pg.Pool({ connectionString: 'postgres://postgres@localhost:54332/postgres' });
const q = async (s, p = []) => (await db.query(s, p)).rows;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  const [{ id: rid, default_vat_bp: vat }] = await q(`select id, default_vat_bp from restaurants where slug = 'doms-cafe'`);
  const pizzas = await q(`select i.id, i.name->>'fr' name, i.price_cents, coalesce(i.vat_bp, $2) vat from menu_items i join categories c on c.id = i.category_id
                          where i.restaurant_id = $1 and c.name->>'fr' = 'Pizzas' and i.active order by i.sort_order, i.id limit 4`, [rid, vat]);
  await q(`delete from recipe_lines where restaurant_id = $1 and menu_item_id = any($2)`, [rid, pizzas.map(p => p.id)]);
  // cheap recipes for A and C, recipes costing 90 % of the price for B and D
  for (const [i, p] of pizzas.entries()) {
    const ht = Math.round(p.price_cents * 10000 / (10000 + p.vat));
    const cost = i % 2 === 0 ? 1 : Math.round(ht * 0.9);
    const [g] = await q(`insert into ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents)
                         values ($1, $2, 'g', 'kg', 1000, $3)
                         on conflict (restaurant_id, lower(btrim(name))) do update set purchase_price_cents = excluded.purchase_price_cents returning id`, [rid, `Matrice ${i}`, cost]);
    await q(`insert into recipe_lines (restaurant_id, menu_item_id, ingredient_id, qty) values ($1, $2, $3, 1000)`, [rid, p.id, g.id]);
    // A and B sell a lot, C and D hardly
    const [o] = await q(`insert into orders (restaurant_id, client_id, business_date, ticket_number, source, order_type) values ($1, $2, current_date, 0, 'pos', 'takeaway') returning id`, [rid, randomUUID()]);
    await q(`insert into order_lines (restaurant_id, order_id, menu_item_id, name, unit_price_cents, quantity, vat_bp) values ($1, $2, $3, '-', 0, $4, 0)`, [rid, o.id, p.id, i < 2 ? 30 : 2]);
    await q(`update orders set status = 'served', closed_at = now() where id = $1`, [o.id]);
  }
  await page.goto('http://localhost:5175/');
  await page.getByLabel('E-mail').fill('eigenaar@doms.test'); await page.getByLabel('Mot de passe').fill('eigenaar-test-123');
  await page.getByLabel('Mot de passe').press('Enter'); await page.locator('aside').waitFor();
  if (await page.locator('aside select').isVisible()) await page.locator('aside select').selectOption({ label: "Dom's Café" });
  await page.getByRole('button', { name: 'Marges', exact: true }).click();
  await page.getByRole('button', { name: 'Analyse du menu' }).click();
  const box = (title) => page.locator('section', { has: page.getByRole('heading', { name: title, exact: true }) });
  await box('Stars').getByText(pizzas[0].name, { exact: true }).waitFor();
  await box('Populaires, peu rentables').getByText(pizzas[1].name, { exact: true }).waitFor();
  await box('Rentables, peu vendus').getByText(pizzas[2].name, { exact: true }).waitFor();
  await box('Ni populaires ni rentables').getByText(pizzas[3].name, { exact: true }).waitFor();
  await page.screenshot({ path: `${OUT}/m1-matrix.png`, fullPage: true });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('MATRIX E2E OK');
} catch (e) {
  await page.screenshot({ path: `${OUT}/99-matrix-fail.png` }).catch(() => {});
  console.error(e); process.exitCode = 1;
} finally { await browser.close(); await db.end(); }
