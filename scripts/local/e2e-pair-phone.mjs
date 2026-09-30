// End-to-end: link a waiter's phone by scanning the QR code shown in the back office (the code travels in the link).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const OUT = process.env.OUT ?? '/tmp/profit';
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:5175/');
  await page.getByLabel('E-mail').fill('eigenaar@doms.test'); await page.getByLabel('Mot de passe').fill('eigenaar-test-123');
  await page.getByLabel('Mot de passe').press('Enter'); await page.locator('aside').waitFor();
  if (await page.locator('aside select').isVisible()) await page.locator('aside select').selectOption({ label: "Dom's Café" });
  await page.getByRole('button', { name: 'Caisses', exact: true }).click();
  await page.getByRole('button', { name: 'Relier une caisse' }).click();
  await page.getByRole('dialog').getByLabel("Nom de l'appareil").fill('Téléphone Youssef');
  await page.getByRole('button', { name: 'Créer un code de connexion' }).click();
  const img = page.getByAltText('QR code de connexion');
  await img.waitFor();
  await page.screenshot({ path: `${OUT}/p1-qr.png` });
  const code = (await page.locator('p.font-mono').innerText()).trim();

  // what the phone camera opens
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  phone.on('pageerror', e => errors.push(e.message));
  await phone.goto(`http://localhost:5174/?code=${encodeURIComponent(code)}`);
  const input = phone.locator('input').first();
  await input.waitFor();
  assert.equal((await input.inputValue()).replace(/-/g, ''), code.replace(/-/g, ''));
  await phone.getByRole('button', { name: 'Relier ce poste' }).click();
  await phone.getByText('Qui êtes-vous ?').waitFor();
  assert.ok(!phone.url().includes('code='), 'the one-time code leaves the address');
  await phone.screenshot({ path: `${OUT}/p2-phone-linked.png` });
  assert.deepEqual(errors, []);
  console.log('PAIR PHONE E2E OK');
} catch (e) { console.error(e); process.exitCode = 1; } finally { await browser.close(); }
