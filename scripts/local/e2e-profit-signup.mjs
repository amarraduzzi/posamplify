// End-to-end: the Amplify Profit website page and a "Profit only" sign-up
// (local stack + menu vite :5173 + admin vite :5175).
import { chromium } from 'playwright';
import pg from 'pg';
import assert from 'node:assert/strict';

const OUT = process.env.OUT ?? '/tmp/profit';
const db = new pg.Pool({ connectionString: 'postgres://postgres@localhost:54332/postgres' });
const q = async (s, p = []) => (await db.query(s, p)).rows;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const tag = Date.now().toString(36);
try {
  // website: /profit is the product page, its buttons sign up for Profit only
  await page.goto('http://localhost:5173/profit');
  await page.getByText('Mais combien vous gagnez ?').waitFor();
  const href = await page.getByRole('link', { name: 'Essayer 30 jours gratuits' }).getAttribute('href');
  assert.match(href, /inscription=1.*produit=profit/);
  await page.screenshot({ path: `${OUT}/site-profit.png` });
  await page.goto('http://localhost:5173/');
  await page.getByText('Vendez mieux. Gagnez plus.').waitFor();
  const plans = await page.locator('#pricing a').evaluateAll(as => as.map(a => a.getAttribute('href')));
  assert.equal(plans.length, 4);
  assert.match(plans[0], /produit=pos/); assert.match(plans[2], /produit=profit/); assert.doesNotMatch(plans[3], /produit=/);

  // sign up for Profit only
  await page.goto(`http://localhost:5175/?inscription=1&produit=profit`);
  await page.getByLabel('E-mail').fill(`profit-${tag}@test.ma`);
  await page.getByLabel('Mot de passe').fill('profit-test-123');
  await page.getByRole('button', { name: 'Créer mon compte', exact: true }).click();
  await page.getByLabel('Nom du restaurant').fill(`Café Profit ${tag}`);
  await page.getByRole('button', { name: /Créer mon restaurant/ }).click();
  await page.getByText('Importer ma carte (photo ou Excel)').waitFor();
  const steps = await page.locator('ol li').allTextContents();
  assert.equal(steps.length, 3, 'Profit only: Restaurant, Menu, Terminé');
  const [r] = await q(`select products from restaurants where name = $1`, [`Café Profit ${tag}`]);
  assert.deepEqual(r.products, ['profit']);
  await page.getByRole('button', { name: /^Café/ }).click();          // café template
  await page.getByRole('button', { name: 'Calculer mes marges' }).click();
  await page.getByRole('heading', { name: 'Marges' }).waitFor();
  const nav = await page.locator('aside nav button').allTextContents();
  assert.deepEqual(nav.map(s => s.trim()), ['Menu', 'Marges', 'Ingrédients', 'Restaurant'], 'no till parts');
  await page.getByText('PROFIT').first().waitFor();
  await page.screenshot({ path: `${OUT}/profit-only-admin.png` });
  assert.deepEqual(errors, []);
  console.log('PROFIT SIGNUP E2E OK');
} catch (e) {
  await page.screenshot({ path: `${OUT}/99-signup-fail.png` }).catch(() => {});
  console.error(e); process.exitCode = 1;
} finally { await browser.close(); await db.end(); }
