// End-to-end: Amplify Profit inventory (purchase, count on the phone, report). Local stack + admin :5175.
import { chromium } from 'playwright';
import pg from 'pg';
import assert from 'node:assert/strict';

const OUT = process.env.OUT ?? '/tmp/profit';
const db = new pg.Pool({ connectionString: 'postgres://postgres@localhost:54332/postgres' });
const q = async (s, p = []) => (await db.query(s, p)).rows;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const dlg = () => page.getByRole('dialog');
try {
  const [{ id: rid }] = await q(`select id from restaurants where slug = 'doms-cafe'`);
  await q(`delete from stock_counts where restaurant_id = $1`, [rid]);
  await q(`delete from stock_purchases where restaurant_id = $1`, [rid]);
  const ing = async (name, base, unit, qty, price, cat) => (await q(
    `insert into ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents, category)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (restaurant_id, lower(btrim(name))) do update set purchase_price_cents = excluded.purchase_price_cents, active = true
     returning id`, [rid, name, base, unit, qty, price, cat]))[0].id;
  const poulet = await ing('Poulet fermier', 'g', 'kg', 1000, 6000, 'viande');
  const huile = await ing('Huile de tournesol', 'ml', 'litre', 1000, 2000, 'epicerie');
  const [cA] = await q(`insert into stock_counts (restaurant_id, counted_on) values ($1, current_date - 1) returning id`, [rid]);
  await q(`insert into stock_count_lines (restaurant_id, count_id, ingredient_id, qty) values ($1,$2,$3,5000), ($1,$2,$4,2000)`, [rid, cA.id, poulet, huile]);
  await q(`update stock_counts set status = 'closed', closed_at = now() where id = $1`, [cA.id]);

  await page.goto('http://localhost:5175/');
  await page.getByLabel('E-mail').fill('eigenaar@doms.test'); await page.getByLabel('Mot de passe').fill('eigenaar-test-123');
  await page.getByLabel('Mot de passe').press('Enter'); await page.locator('aside').waitFor();
  if (await page.locator('aside select').isVisible()) await page.locator('aside select').selectOption({ label: "Dom's Café" });
  await page.getByRole('button', { name: 'Inventaire', exact: true }).click();
  await page.getByText('Trois gestes, et vous savez où part votre marchandise').waitFor();
  await page.screenshot({ path: `${OUT}/s1-start.png` });

  // a purchase: 3 kg of chicken for 195 DH
  await page.getByRole('button', { name: 'Noter un achat' }).first().click();
  await dlg().getByLabel('Produit').selectOption({ label: 'Poulet fermier' });
  await dlg().getByLabel('Quantité').fill('3');
  await dlg().getByLabel('Prix payé au total (DH)').fill('195');
  await dlg().getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText('Achat enregistré, prix mis à jour').waitFor();
  const [pp] = await q(`select purchase_price_cents from ingredients where id = $1`, [poulet]);
  assert.equal(Number(pp.purchase_price_cents), 6500);

  // the count, on a phone
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Nouveau comptage' }).click();
  await page.getByLabel('Poulet fermier').fill('2'); await page.getByLabel('Poulet fermier').press('Enter');
  await page.getByLabel('Huile de tournesol').fill('1,5'); await page.getByLabel('Huile de tournesol').press('Enter');
  await page.getByText(/2 \/ \d+ comptés/).waitFor();
  await page.screenshot({ path: `${OUT}/s2-count-phone.png` });
  await page.getByRole('button', { name: 'Valider le comptage' }).click();
  await dlg().getByRole('button', { name: 'Valider', exact: true }).click();
  await page.getByText('Comptage validé').waitFor();
  const lines = await q(`select g.name, l.qty from stock_count_lines l join stock_counts c on c.id = l.count_id join ingredients g on g.id = l.ingredient_id
                          where c.restaurant_id = $1 and c.status = 'closed' and c.id <> $2 order by 1`, [rid, cA.id]);
  assert.deepEqual(lines.map(l => [l.name, Number(l.qty)]), [['Huile de tournesol', 1500], ['Poulet fermier', 2000]]);

  // the report: 6 kg chicken at 65 + 0.5 l oil at 20 = 400 DH used; nothing sold -> all of it "disappeared"
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.getByText('Disparu sans être vendu').waitFor();
  await page.getByText(/^400(,00)?\sMAD$/).first().waitFor();
  await page.getByText('Poulet fermier').first().waitFor();
  await page.screenshot({ path: `${OUT}/s3-report.png`, fullPage: true });
  await page.getByRole('button', { name: 'العربية' }).first().click();
  await page.getByText('اختفى دون أن يباع', { exact: true }).waitFor();
  await page.screenshot({ path: `${OUT}/s4-arabic.png` });
  assert.deepEqual(errors, []);
  console.log('STOCK E2E OK');
} catch (e) {
  await page.screenshot({ path: `${OUT}/99-stock-fail.png` }).catch(() => {});
  console.error(e); process.exitCode = 1;
} finally { await browser.close(); await db.end(); }
