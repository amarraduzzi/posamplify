// End-to-end: menu import from an Excel export and from a (mocked) AI photo reading,
// then undo. Local stack + admin vite on :5175. Excel file: /tmp/imp/export.xlsx.
import { chromium } from 'playwright';
import pg from 'pg';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:5175';
const OUT = process.env.OUT ?? '/tmp/imp';
const db = new pg.Pool({ connectionString: 'postgres://postgres@localhost:54332/postgres' });
const q = async (s, p = []) => (await db.query(s, p)).rows;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const shot = n => page.screenshot({ path: `${OUT}/${n}.png` });
const dlg = () => page.getByRole('dialog');

try {
  await page.goto(BASE);
  await page.getByLabel('E-mail').fill('eigenaar@doms.test');
  await page.getByLabel('Mot de passe').fill('eigenaar-test-123');
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.getByRole('heading', { name: 'Briefing' }).waitFor();
  if (await page.locator('select').first().isVisible()) await page.locator('select').first().selectOption({ label: "Dom's Café" });
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('heading', { name: 'Menu' }).waitFor();
  const [{ id: rid }] = await q(`select id from public.restaurants where name = 'Dom''s Café' limit 1`);
  const count = async () => (await q(`select count(*)::int n from public.menu_items where restaurant_id = $1`, [rid]))[0].n;
  const before = await count();

  // --- Excel ---------------------------------------------------------------
  await page.getByRole('button', { name: 'Importer', exact: true }).click();
  await dlg().getByText('Fichier Excel ou CSV').waitFor();
  await shot('10-choose');
  await dlg().locator('input[type=file][accept*=xlsx]').setInputFiles('/tmp/imp/export.xlsx');
  await dlg().getByText('Prix manquant').waitFor();
  await shot('11-preview-excel');
  await dlg().getByText('En double').waitFor();
  const imp = dlg().getByRole('button', { name: /Importer \d+ articles/ });
  assert.ok(await imp.isDisabled(), 'missing price blocks the import');
  // fix Harira's price
  const harira = dlg().locator('li', { has: page.locator('input[value="Harira"]') });
  await harira.getByLabel('Prix (DH)').fill('15');
  await dlg().getByText('Tout est prêt.').waitFor();
  assert.equal(await dlg().locator('input[value="حريرة"]').count(), 1, 'Arabic column recognised');
  await imp.click();
  await dlg().getByText(/articles importés/).waitFor();
  await shot('12-done');
  const added = (await count()) - before;
  assert.equal(added, 5, 'Espresso twice: once; 5 new dishes');
  const [h] = await q(`select i.price_cents, i.name from public.menu_items i where restaurant_id = $1 and name->>'fr' = 'Harira'`, [rid]);
  assert.equal(Number(h.price_cents), 1500);
  assert.equal(h.name.ar, 'حريرة');
  // undo from the done screen
  await dlg().getByRole('button', { name: 'Annuler cet import' }).click();
  await page.getByText(/articles retirés/).waitFor();
  assert.equal(await count(), before, 'undo removes all of it');
  const [{ n: newCats }] = await q(`select count(*)::int n from public.categories where restaurant_id = $1 and name->>'fr' = 'Petit-déjeuner'`, [rid]);
  assert.equal(newCats, 0, 'new category removed too');

  // --- photo (AI mocked) ----------------------------------------------------
  await page.route('**/functions/v1/menu-extract', async route => {
    const body = route.request().postDataJSON();
    assert.equal(body.files.length, 1); assert.equal(body.files[0].mime, 'image/jpeg');
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({
      categories: [
        { name: { fr: 'Jus frais', ar: 'عصائر طازجة', en: 'Fresh juices' }, icon: '🍹', station: 'bar', items: [
          { name: { fr: "Jus d'orange", ar: 'عصير البرتقال', en: 'Orange juice' }, description: '', price: 15 },
          { name: { fr: 'Panaché maison', ar: 'باناشي', en: 'Mixed juice' }, description: 'Banane, fraise, avocat', price: null,
            variants: [{ name: { fr: 'Verre', ar: 'كأس', en: 'Glass' }, price: 20 }, { name: { fr: 'Grand', ar: 'كبير', en: 'Large' }, price: 28 }] },
        ] },
      ],
    }) });
  });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  writeFileSync(`${OUT}/carte.png`, png);
  await page.getByRole('button', { name: 'Importer', exact: true }).click();
  await dlg().locator('input[type=file][accept*=pdf]').setInputFiles(`${OUT}/carte.png`);
  await dlg().getByText(/Lu par l'IA/).waitFor();
  await shot('13-preview-photo');
  await dlg().getByRole('button', { name: /Importer 2 articles/ }).click();
  await dlg().getByText(/2 articles importés/).waitFor();
  await dlg().getByRole('button', { name: 'Voir le menu' }).click();
  const [pan] = await q(`select i.*, c.station from public.menu_items i join public.categories c on c.id = i.category_id where i.restaurant_id = $1 and i.name->>'fr' = 'Panaché maison'`, [rid]);
  assert.equal(pan.station, 'bar'); assert.equal(Number(pan.price_cents), 2000);
  const vars = await q(`select name->>'ar' ar, price_cents from public.item_variants where menu_item_id = $1 order by sort_order`, [pan.id]);
  assert.deepEqual(vars.map(v => [v.ar, Number(v.price_cents)]), [['كأس', 2000], ['كبير', 2800]]);
  await page.getByText('Jus frais').first().waitFor();
  await shot('14-menu-after');

  // history + undo from the list, in Arabic
  await page.getByRole('button', { name: 'Importer', exact: true }).click();
  await dlg().getByText('Imports précédents').waitFor();
  await shot('15-history');
  await dlg().getByRole('button', { name: 'Annuler', exact: true }).first().click();
  await page.getByText('2 articles retirés.').waitFor();
  assert.equal(await count(), before);
  assert.deepEqual(errors, []);
  console.log('E2E IMPORT OK');
} catch (e) {
  await shot('99-fail').catch(() => {});
  console.error(e); process.exitCode = 1;
} finally { await browser.close(); await db.end(); }
