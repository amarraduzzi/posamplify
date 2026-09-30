// End-to-end: Google review link (settings -> guest menu button) and the "all included" block on the site.
import { chromium } from 'playwright';
import pg from 'pg';
import assert from 'node:assert/strict';

const OUT = process.env.OUT ?? '/tmp/profit';
const db = new pg.Pool({ connectionString: 'postgres://postgres@localhost:54332/postgres' });
const q = async (s, p = []) => (await db.query(s, p)).rows;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const URL_ = 'https://g.page/r/CdomsTest/review';
try {
  await q(`update restaurants set branding = branding - 'review_url' where slug = 'doms-cafe'`);
  await page.goto('http://localhost:5175/');
  await page.getByLabel('E-mail').fill('eigenaar@doms.test'); await page.getByLabel('Mot de passe').fill('eigenaar-test-123');
  await page.getByLabel('Mot de passe').press('Enter'); await page.locator('aside').waitFor();
  if (await page.locator('aside select').isVisible()) await page.locator('aside select').selectOption({ label: "Dom's Café" });
  await page.getByRole('button', { name: 'Restaurant', exact: true }).click();
  await page.getByLabel('Lien pour laisser un avis').fill('http://pas-bon');
  await page.getByText('Le lien doit commencer par https://').waitFor();
  await page.getByLabel('Lien pour laisser un avis').fill(URL_);
  await page.getByAltText('QR code avis Google').waitFor();
  await page.getByAltText('QR code avis Google').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/r1-settings.png` });
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  await page.getByText('Restaurant enregistré').waitFor();
  const [b] = await q(`select branding from restaurants where slug = 'doms-cafe'`);
  assert.equal(b.branding.review_url, URL_);

  // guest menu: the button at the bottom
  const guest = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'fr-FR' });
  guest.on('pageerror', e => errors.push(e.message));
  await guest.goto('http://localhost:5173/doms-cafe');
  const link = guest.getByRole('link', { name: /Laissez-nous un avis Google/ });
  await link.scrollIntoViewIfNeeded();
  assert.equal(await link.getAttribute('href'), URL_);
  await guest.screenshot({ path: `${OUT}/r2-menu.png` });

  // the website: everything included
  await page.goto('http://localhost:5173/');
  await page.getByText('Tout est inclus. Aucune option payante.').scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 300); await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/r3-site.png` });
  assert.deepEqual(errors, []);
  console.log('REVIEW E2E OK');
} catch (e) {
  await page.screenshot({ path: `${OUT}/99-review-fail.png` }).catch(() => {});
  console.error(e); process.exitCode = 1;
} finally { await browser.close(); await db.end(); }
