// End-to-end: Amplify Profit "Charges" (fixed costs, month result, break-even). Local stack + admin :5175.
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
  await q(`delete from fixed_costs where restaurant_id = $1`, [rid]);
  await q(`delete from month_figures where restaurant_id = $1`, [rid]);
  await page.goto('http://localhost:5175/');
  await page.getByLabel('E-mail').fill('eigenaar@doms.test'); await page.getByLabel('Mot de passe').fill('eigenaar-test-123');
  await page.getByLabel('Mot de passe').press('Enter'); await page.locator('aside').waitFor();
  if (await page.locator('aside select').isVisible()) await page.locator('aside select').selectOption({ label: "Dom's Café" });
  await page.getByRole('button', { name: 'Charges', exact: true }).click();
  await page.getByText('Ajoutez vos charges fixes (loyer, salaires…) pour le calculer.').waitFor();
  await page.screenshot({ path: `${OUT}/c1-empty.png` });

  const add = async (type, amount, freq) => {
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await dlg().getByLabel('Type').selectOption(type);
    await dlg().getByLabel('Montant (DH)').fill(amount);
    if (freq) await dlg().getByLabel('Payé').selectOption(freq);
    await dlg().getByRole('button', { name: 'Enregistrer' }).click();
    await page.getByText('Charge enregistrée').last().waitFor();
    await dlg().waitFor({ state: 'detached' });
  };
  await add('loyer', '12000');
  await add('salaires', '18000');
  await add('assurance', '6000', 'year');
  await page.getByText('Charges sociales oubliées ?').click();
  await page.getByText('Charge ajoutée').waitFor();
  const rows = await q(`select category, amount_cents from fixed_costs where restaurant_id = $1 order by category`, [rid]);
  assert.deepEqual(rows.map(x => [x.category, Number(x.amount_cents)]), [['assurance', 600000], ['charges_sociales', 378000], ['loyer', 1200000], ['salaires', 1800000]]);

  await page.getByText('—').first().waitFor();
  await page.getByLabel('Chiffre d’affaires TTC (DH)').fill('110000');
  await page.getByLabel('Achats de marchandises (DH)').fill('20000');
  await page.getByRole('button', { name: 'Enregistrer' }).last().click();
  await page.getByText('Chiffres enregistrés').waitFor();
  await page.getByText('vos achats du mois').waitFor();
  // 110 000 TTC at 10 % VAT = 100 000 HT, minus 20 000 goods, minus 34 280 fixed = +45 720
  await page.getByText(/\+45\s?720/).first().waitFor();
  await page.getByText(/\/ jour/).first().waitFor();
  const [f] = await q(`select purchases_cents from month_figures where restaurant_id = $1`, [rid]);
  assert.equal(Number(f.purchases_cents), 2000000);
  await page.screenshot({ path: `${OUT}/c2-filled.png`, fullPage: true });

  await page.getByRole('button', { name: 'العربية' }).first().click();
  await page.getByText('عتبة المردودية').first().waitFor();
  await page.screenshot({ path: `${OUT}/c3-arabic.png` });
  assert.deepEqual(errors, []);
  console.log('CHARGES E2E OK');
} catch (e) {
  await page.screenshot({ path: `${OUT}/99-charges-fail.png` }).catch(() => {});
  console.error(e); process.exitCode = 1;
} finally { await browser.close(); await db.end(); }
