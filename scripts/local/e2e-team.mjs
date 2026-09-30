// End-to-end: clock-in on the till (:5174) and the team page in the back office (:5175).
import { chromium } from 'playwright';
import pg from 'pg';
import assert from 'node:assert/strict';

const OUT = process.env.OUT ?? '/tmp/profit';
const db = new pg.Pool({ connectionString: 'postgres://postgres@localhost:54332/postgres' });
const q = async (s, p = []) => (await db.query(s, p)).rows;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
try {
  const [{ id: rid }] = await q(`select id from restaurants where slug = 'doms-cafe'`);
  await q(`delete from staff_shifts where restaurant_id = $1`, [rid]);
  await q(`delete from staff_rates where restaurant_id = $1`, [rid]);
  const [sara] = await q(`select id from staff where restaurant_id = $1 and name = 'Sara'`, [rid]);

  // ---- the till: Sara clocks in
  const till = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  till.on('pageerror', e => errors.push(e.message));
  await till.goto('http://localhost:5174');
  await till.getByRole('button', { name: /Se connecter avec un e-mail/ }).click();
  await till.getByLabel('E-mail du poste').fill('kassa@doms.test');
  await till.getByLabel('Mot de passe').fill('kassa-test-123');
  await till.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await till.getByRole('button', { name: 'Pointer arrivée / départ' }).click();
  await till.getByRole('dialog').getByRole('button', { name: /Sara/ }).click();
  for (const d of '1111') await till.getByRole('dialog').getByRole('button', { name: d, exact: true }).click();
  await till.getByRole('dialog').getByRole('button', { name: '✓' }).click();
  await till.getByText('Bonjour Sara !').waitFor();
  await till.screenshot({ path: `${OUT}/t1-till-clock.png` });
  const open = await q(`select source from staff_shifts where staff_id = $1 and clock_out is null`, [sara.id]);
  assert.deepEqual(open.map(x => x.source), ['pos']);

  // ---- the back office
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  const dlg = () => page.getByRole('dialog').last();
  await page.goto('http://localhost:5175/');
  await page.getByLabel('E-mail').fill('eigenaar@doms.test'); await page.getByLabel('Mot de passe').fill('eigenaar-test-123');
  await page.getByLabel('Mot de passe').press('Enter'); await page.locator('aside').waitFor();
  if (await page.locator('aside select').isVisible()) await page.locator('aside select').selectOption({ label: "Dom's Café" });
  await page.getByRole('button', { name: 'Équipe', exact: true }).click();
  await page.getByText('présent', { exact: true }).waitFor();
  await page.getByRole('cell', { name: /^Sara/ }).click();
  // cost per hour from the salary: 3 000 DH, 48 h a week -> 3000 x 1.21 / 208 = 17,45
  await dlg().getByLabel('Salaire mensuel (DH)').fill('3000');
  await dlg().getByRole('button', { name: 'Calculer' }).click();
  await dlg().getByRole('button', { name: 'Enregistrer' }).first().click();
  await page.getByText('Coût horaire enregistré').waitFor();
  const [rate] = await q(`select hourly_cost_cents from staff_rates where staff_id = $1`, [sara.id]);
  assert.equal(Number(rate.hourly_cost_cents), 1745);
  // yesterday's 8 hours, typed
  await dlg().getByRole('button', { name: 'Ajouter des heures' }).click();
  const y = new Date(Date.now() - 864e5); const yd = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  await dlg().getByLabel('Date').fill(yd);
  await dlg().getByLabel('Arrivée').fill('09:00');
  await dlg().getByLabel('Départ').fill('17:00');
  await dlg().getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText('Heures enregistrées').waitFor();
  const [m] = await q(`select extract(epoch from clock_out - clock_in) / 3600 h from staff_shifts where staff_id = $1 and source = 'manual'`, [sara.id]);
  assert.equal(Number(m.h), 8);
  await page.screenshot({ path: `${OUT}/t2-person.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Ce mois' }).click();
  await page.getByText(/^8 h 0\d$/).first().waitFor();
  await page.screenshot({ path: `${OUT}/t3-team.png`, fullPage: true });
  await page.getByRole('button', { name: 'العربية' }).first().click();
  await page.getByText('ساعات العمل').waitFor();
  await page.screenshot({ path: `${OUT}/t4-arabic.png` });
  assert.deepEqual(errors, []);
  console.log('TEAM E2E OK');
} catch (e) {
  for (const p of browser.contexts().flatMap(c => c.pages())) await p.screenshot({ path: `${OUT}/99-team-fail-${browser.contexts().indexOf(p.context())}.png` }).catch(() => {});
  console.error(e); process.exitCode = 1;
} finally { await browser.close(); await db.end(); }
