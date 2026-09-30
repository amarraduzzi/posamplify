// End-to-end: Amplify Profit in the back office (local stack + admin vite :5175).
// Recipe card by hand (with a new ingredient), AI filling (mocked), numbers checked in the DB.
import { chromium } from 'playwright';
import pg from 'pg';
import assert from 'node:assert/strict';

const BASE = process.env.BASE ?? 'http://localhost:5175';
const OUT = process.env.OUT ?? '/tmp/profit';
const db = new pg.Pool({ connectionString: 'postgres://postgres@localhost:54332/postgres' });
const q = async (s, p = []) => (await db.query(s, p)).rows;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const shot = n => page.screenshot({ path: `${OUT}/${n}.png` });
const dlg = () => page.getByRole('dialog').last();

try {
  const [{ id: rid }] = await q(`select id from restaurants where slug = 'doms-cafe'`);
  await q(`delete from recipe_lines where restaurant_id = $1`, [rid]);
  await q(`delete from ingredients where restaurant_id = $1`, [rid]);

  await page.goto(BASE);
  await page.getByLabel('E-mail').fill('eigenaar@doms.test');
  await page.getByLabel('Mot de passe').fill('eigenaar-test-123');
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.getByRole('heading', { name: 'Briefing' }).waitFor();
  if (await page.locator('select').first().isVisible()) await page.locator('select').first().selectOption({ label: "Dom's Café" });
  await page.getByRole('button', { name: 'Marges', exact: true }).click();
  await page.getByRole('heading', { name: 'Marges' }).waitFor();
  await page.getByText('Food cost moyen').waitFor();
  await shot('1-marges-empty');

  // --- recipe card by hand: Café noir = 8 g coffee (new ingredient: 180 DH / kg) + 1 sugar stick
  const [cafe] = await q(`select i.id, i.price_cents from menu_items i where restaurant_id = $1 and name->>'fr' = 'Café noir'`, [rid]);
  await page.getByRole('button', { name: /^Café noir/ }).first().click();
  await dlg().getByPlaceholder('Ajouter un ingrédient (tapez son nom)').fill('Café en grains');
  await dlg().getByRole('button', { name: 'Nouveau' }).click();
  await dlg().getByRole('heading', { name: 'Nouvel ingrédient' }).waitFor();
  await dlg().getByLabel('Prix d’achat (DH)').fill('180');
  await dlg().getByLabel('Catégorie').selectOption('epicerie');
  await dlg().getByText('Coût réel').waitFor();
  await shot('2-new-ingredient');
  await dlg().getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByRole('dialog').getByText('Café en grains').waitFor();
  const qty = page.getByRole('dialog').getByLabel('Quantité').first();
  await qty.fill('8');
  await page.getByRole('dialog').getByText('1,44 MAD').first().waitFor(); // 8 g x 180 DH/kg
  await shot('3-recipe');
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText('Fiche enregistrée').waitFor();
  const [ln] = await q(`select qty from recipe_lines where menu_item_id = $1`, [cafe.id]);
  assert.equal(Number(ln.qty), 8);

  // --- AI filling, mocked answer for every dish it is asked about
  await page.route('**/functions/v1/profit-ai', async route => {
    const body = route.request().postDataJSON();
    assert.ok(body.ingredients.includes('Café en grains'), 'known ingredients sent for reuse');
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({
      dishes: body.dishes.map(d => ({ key: d.key, lines: /pizza/i.test(d.name)
        ? [{ name: 'Mozzarella', name_ar: 'موزاريلا', category: 'laitier', base_unit: 'g', qty: 120, purchase_unit: 'kg', purchase_qty: 1000, price_dh: 85 },
           { name: 'Pâte à pizza', category: 'boulangerie', base_unit: 'pc', qty: 1, purchase_unit: 'pièce', purchase_qty: 1, price_dh: 4 }]
        : [{ name: 'Café en grains', base_unit: 'g', qty: 7, purchase_unit: 'kg', purchase_qty: 1000, price_dh: 999 }] })),
    }) });
  });
  await page.getByRole('button', { name: 'Remplir avec l’IA' }).click();
  await dlg().getByRole('button', { name: 'Lancer l’IA' }).click();
  await dlg().getByText('Mozzarella').first().waitFor();
  await shot('4-ai-review');
  await dlg().getByRole('button', { name: 'Enregistrer les fiches' }).click();
  await page.getByText(/fiches créées/).waitFor();
  const [mozz] = await q(`select * from ingredients where restaurant_id = $1 and name = 'Mozzarella'`, [rid]);
  assert.equal(mozz.price_estimated, true);
  assert.equal(Number(mozz.purchase_price_cents), 8500);
  const [grains] = await q(`select * from ingredients where restaurant_id = $1 and name = 'Café en grains'`, [rid]);
  assert.equal(Number(grains.purchase_price_cents), 18000, 'the owner’s real price is kept');
  assert.equal(Number((await q(`select count(*)::int n from recipe_lines where menu_item_id = $1`, [cafe.id]))[0].n), 1, 'hand-made card untouched');
  await page.waitForTimeout(800);
  await shot('5-marges-filled');

  // --- ingredients page: confirm the estimated price
  await page.getByRole('button', { name: 'Ingrédients', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Ingrédients' }).waitFor();
  await page.getByText(/prix à vérifier/).waitFor();
  await shot('6-ingredients');
  const row = page.locator('tr', { hasText: 'Mozzarella' });
  await row.getByRole('button', { name: 'Confirmer' }).click();
  await page.getByText('Prix confirmé').waitFor();
  assert.equal((await q(`select price_estimated from ingredients where id = $1`, [mozz.id]))[0].price_estimated, false);

  // --- Arabic
  await page.getByRole('button', { name: 'العربية' }).first().click();
  await page.getByRole('button', { name: 'الهوامش', exact: true }).click();
  await page.getByText('متوسط تكلفة المواد').waitFor();
  await shot('7-arabic');
  assert.deepEqual(errors, []);
  console.log('PROFIT E2E OK');
} catch (e) {
  await shot('99-fail').catch(() => {});
  console.error(e); process.exitCode = 1;
} finally { await browser.close(); await db.end(); }
