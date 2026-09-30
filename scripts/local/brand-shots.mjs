// Screenshots of the Amplify look on every app (local stack). Usage: node scripts/local/brand-shots.mjs [admin|pos|site]...
import { chromium } from 'playwright';
const OUT = process.env.OUT ?? '/tmp/brand';
const which = process.argv.slice(2).length ? process.argv.slice(2) : ['admin', 'pos', 'site'];
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });

if (which.includes('admin')) {
  for (const lang of ['fr', 'ar']) {
    const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
    await p.goto(`http://localhost:5175/?lang=${lang}`);
    await p.locator('input[type=email]').waitFor();
    await shot(p, `admin-${lang}-0-login`);
    await p.locator('input[type=email]').fill('eigenaar@doms.test');
    await p.locator('input[type=password]').fill('eigenaar-test-123');
    await p.locator('input[type=password]').press('Enter');
    await p.waitForTimeout(2500);
    if (await p.locator('select').first().isVisible()) await p.locator('select').first().selectOption({ label: "Dom's Café" });
    await p.waitForTimeout(1500);
    await shot(p, `admin-${lang}-1-briefing`);
    if (lang === 'fr') {
      await p.getByRole('button', { name: 'Menu', exact: true }).click(); await p.waitForTimeout(1200);
      await shot(p, 'admin-fr-2-menu');
      await p.getByRole('button', { name: 'Importer', exact: true }).click(); await p.waitForTimeout(700);
      await shot(p, 'admin-fr-3-import');
      await p.keyboard.press('Escape');
      await p.getByRole('button', { name: 'Ventes', exact: true }).click(); await p.waitForTimeout(1500);
      await shot(p, 'admin-fr-4-ventes');
    }
    await p.close();
  }
}
if (which.includes('pos')) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto('http://localhost:5174/');
  await p.waitForTimeout(2500);
  await shot(p, 'pos-0-start');
  await p.close();
}
if (which.includes('site')) {
  for (const [w, h, n] of [[1440, 900, 'desk'], [390, 844, 'mob']]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto('http://localhost:5173/');
    await p.waitForTimeout(2500);
    await shot(p, `site-${n}-0`);
    for (let y = 0; y < 9000; y += 500) { await p.mouse.wheel(0, 500); await p.waitForTimeout(90); }
    await p.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('in')));
    await p.waitForTimeout(1000);
    await p.screenshot({ path: `${OUT}/site-${n}-full.png`, fullPage: true });
    await p.close();
  }
}
await b.close();
