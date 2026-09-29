// Usage: node shot.mjs <url> <out.png> [width] [height] [fullPage] [clickSelector...]
import { chromium } from 'playwright';
const [url, out, w = '390', h = '844', full = '0', ...clicks] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
// Local screenshots only: external photos are unreachable here, serve placeholders instead.
if (process.env.PH) {
  const fs = await import('node:fs');
  let n = 0; const seen = new Map();
  await page.route(/i\.ibb\.co|logo\.webp|supabase\.co\/storage/, route => {
    const u = route.request().url();
    if (u.includes('logo')) return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(process.env.PH + '/logo.png') });
    if (!seen.has(u)) seen.set(u, n++ % 6);
    route.fulfill({ contentType: 'image/jpeg', body: fs.readFileSync(`${process.env.PH}/food${seen.get(u)}.jpg`) });
  });
}
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
for (const c of clicks) {
  if (c.startsWith('wait:')) { await page.waitForTimeout(+c.slice(5)); continue; }
  if (c.startsWith('scroll:')) { await page.mouse.wheel(0, +c.slice(7)); await page.waitForTimeout(600); continue; }
  if (c.startsWith('eval:')) { await page.evaluate(c.slice(5)); await page.waitForTimeout(300); continue; }
  await page.locator(c).first().click(); await page.waitForTimeout(600);
}
await page.screenshot({ path: out, fullPage: full === '1' });
await browser.close();
