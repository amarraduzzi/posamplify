// End-to-end check of the guest flow in a real browser (phone viewport).
// Needs: local db + api (scripts/local) and the menu dev server on :5173.
import { chromium } from 'playwright';
import pg from 'pg';
import assert from 'node:assert/strict';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? '/tmp/shots';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:54322/postgres' });
const [{ token }] = (await db.query(`select qr_token token from dining_tables t join restaurants r on r.id = t.restaurant_id
                                     where r.slug = 'doms-cafe' and t.label = '1'`)).rows;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'fr-FR', hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });

await page.goto(`${BASE}/doms-cafe/t/${token}`);
await page.getByRole('heading', { name: "Dom's Café" }).waitFor();
await page.getByText('Table 1').first().waitFor();
await page.screenshot({ path: `${OUT}/01-menu.png` });

// quick add an item without variants, twice
const firstAdd = page.getByRole('button', { name: /^Ajouter: / }).first();
const firstName = (await firstAdd.getAttribute('aria-label')).replace('Ajouter: ', '');
await firstAdd.click();
await firstAdd.click();
await page.getByRole('button', { name: /Voir le panier/ }).waitFor();

// category chip navigation
await page.getByRole('button', { name: /Pizzas/ }).first().click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/02-pizzas.png` });

// open an item with variants if any, else any item sheet
const [{ vitem }] = (await db.query(`select i.name->>'fr' vitem from menu_items i join restaurants r on r.id = i.restaurant_id
   where r.slug='doms-cafe' and exists (select 1 from item_variants v where v.menu_item_id = i.id) limit 1`)).rows;
await page.getByRole('button', { name: new RegExp('Rechercher') }).click();
await page.getByPlaceholder('Rechercher un plat').fill(vitem.slice(0, 6));
await page.getByRole('button', { name: new RegExp(`^Ajouter: ${vitem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click();
await page.getByRole('dialog').waitFor();
const radios = page.getByRole('radio');
if (await radios.count() > 1) await radios.nth(1).check();
await page.getByPlaceholder(/Une précision/).fill('bien chaud');
await page.screenshot({ path: `${OUT}/03-item-sheet.png` });
await page.getByRole('dialog').getByRole('button', { name: /^Ajouter/ }).click();
await page.getByRole('button', { name: 'Effacer' }).click();

// cart
await page.getByRole('button', { name: /Voir le panier/ }).click();
await page.getByRole('dialog').waitFor();
await page.getByPlaceholder(/Allergies/).fill('Sans gluten si possible');
await page.screenshot({ path: `${OUT}/04-cart.png` });
const shownTotal = (await page.getByRole('button', { name: /^Commander/ }).innerText()).replace(/\s+/g, ' ');

await page.getByRole('button', { name: /^Commander/ }).click();
await page.getByText('Merci ! Commande reçue').waitFor();
await page.screenshot({ path: `${OUT}/05-confirmation.png` });

// verify in the database: server-side prices, table, notes
const { rows: [o] } = await db.query(`select o.*, (select json_agg(l order by l.created_at) from order_lines l where l.order_id = o.id) lines
                                      from orders o order by created_at desc limit 1`);
assert.equal(o.source, 'qr');
assert.equal(o.note, 'Sans gluten si possible');
assert.ok(o.lines.some(l => l.name === firstName && l.quantity === 2), 'quick-added item x2');
assert.ok(o.lines.some(l => l.note === 'bien chaud'), 'item note kept');
const dbTotal = Number(o.total_cents) / 100;
assert.ok(shownTotal.includes(String(dbTotal).replace('.', ',')), `UI total "${shownTotal}" vs db ${dbTotal}`);

// kitchen moves the order forward -> guest screen follows
await db.query(`update orders set status = 'preparing' where id = $1`, [o.id]);
await page.getByText('La cuisine s’en occupe.').waitFor({ timeout: 15000 });
await page.screenshot({ path: `${OUT}/06-preparing.png` });

// back to menu, cart must be empty, tracking pill present
await page.getByRole('button', { name: 'Retour au menu' }).click();
await page.getByText(`Commande #${o.ticket_number}`).waitFor();
assert.equal(await page.getByRole('button', { name: /Voir le panier/ }).count(), 0);

// Arabic, right to left
await page.getByRole('button', { name: 'ع' }).click();
assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: `${OUT}/07-arabic.png` });

// sold-out mid-order: the item is removed from the cart with a clear message
await page.getByRole('button', { name: 'FR' }).click();
const addBtn = page.getByRole('button', { name: /^Ajouter: / }).first();
const soldName = (await addBtn.getAttribute('aria-label')).replace('Ajouter: ', '');
await addBtn.click();
await db.query(`update menu_items set available = false where name->>'fr' = $1`, [soldName]);
await page.getByRole('button', { name: /Voir le panier/ }).click();
await page.getByRole('button', { name: /^Commander/ }).click();
await page.getByText(`${soldName} : Un article est épuisé`).waitFor();
await page.screenshot({ path: `${OUT}/08-sold-out.png` });
await db.query(`update menu_items set available = true where name->>'fr' = $1`, [soldName]);

// no table token: browse only (Dom's accepts takeaway -> takeaway form)
const p2 = await ctx.newPage();
await p2.goto(`${BASE}/doms-cafe`);
await p2.getByRole('heading', { name: "Dom's Café" }).waitFor();
await p2.getByRole('button', { name: /^Ajouter: / }).first().click();
await p2.getByRole('button', { name: /Voir le panier/ }).click();
await p2.getByPlaceholder('Prénom').waitFor();
await p2.screenshot({ path: `${OUT}/09-takeaway.png` });

// unknown restaurant
await p2.goto(`${BASE}/nope-nope`);
await p2.getByText('Restaurant introuvable').waitFor();

assert.deepEqual(errors, [], 'browser errors: ' + errors.join('\n'));
console.log('E2E OK, order', o.ticket_number, 'total', dbTotal, 'MAD');
await browser.close();
await db.end();
