import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';
const S = '/tmp/claude-0/-home-claude/25041e0e-6893-5876-a87d-c58f250d8058/scratchpad/shots', IMG = '/home/claude/amplifygrowthstudio2/public/img';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errs = [];
const local = { 'cover.webp': 'photos/metier-cafe-1600.webp', 'g1.webp': 'photos/mk-terrasse-1600.webp', 'g2.webp': 'photos/mk-salle-pleine-1600.webp', 'g3.webp': 'photos/metier-restaurant-1600.webp', 'g4.webp': 'photos/mk-degustation-1600.webp' };
async function page(vp, dsf = 2, ctx) {
  const c = ctx ?? await b.newContext({ viewport: vp, deviceScaleFactor: dsf, locale: 'fr-FR' });
  const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.route(/^https:\/\/(img\.local|i\.ibb\.co)\//, r => {
    const u = new URL(r.request().url());
    if (u.hostname !== 'img.local') return r.abort();
    const f = u.pathname.startsWith('/menu/') ? 'menu' + u.pathname.slice(5) : local[u.pathname.slice(1)];
    return f && fs.existsSync(IMG + '/' + f) ? r.fulfill({ path: IMG + '/' + f, contentType: 'image/webp' }) : r.abort();
  });
  return p;
}
// A. online ordering
let p = await page({ width: 390, height: 844 });
await p.goto('http://localhost:5173/doms-cafe?lang=fr'); await p.waitForTimeout(1500);
for (const n of ['Cappuccino', 'Cappuccino', 'Thé à la menthe', 'Chocolat chaud']) { await p.getByRole('button', { name: new RegExp('Ajouter: ' + n) }).first().click(); await p.waitForTimeout(150); }
await p.getByRole('button', { name: /panier|Voir/i }).last().click(); await p.waitForTimeout(700);
await p.getByRole('button', { name: 'À emporter' }).click(); await p.waitForTimeout(300);
await p.screenshot({ path: S + '/order.png' });
await p.getByPlaceholder('Code promo').fill('BIENVENUE10'); await p.getByRole('button', { name: 'Appliquer' }).click(); await p.waitForTimeout(800);
await p.locator('[role=dialog] .overflow-y-auto, [role=dialog]').first().evaluate(el => { const s = el.querySelector('.overflow-y-auto') || el; s.scrollTop = 9999; });
await p.waitForTimeout(400); await p.screenshot({ path: S + '/order-code.png' });
// B. booking
p = await page({ width: 390, height: 844 });
await p.goto('http://localhost:5173/doms-cafe?reserver&lang=fr'); await p.waitForTimeout(1800);
await p.getByRole('button', { name: 'Demain' }).click(); await p.waitForTimeout(1000);
await p.locator('[role=dialog] .grid button').nth(5).click(); await p.waitForTimeout(300);
await p.screenshot({ path: S + '/book.png' });
// C. kiosk
const tok = execSync("psql postgres://postgres@localhost:54332/postgres -Atc \"select kiosk_token from restaurants where slug='doms-cafe'\"").toString().trim();
p = await page({ width: 1180, height: 864 }, 1.5);
await p.goto('http://localhost:5173/doms-cafe?lang=fr&borne=' + tok); await p.waitForTimeout(1800);
await p.screenshot({ path: S + '/kiosk-menu.png' });
for (const n of ['Cappuccino', 'Thé à la menthe']) await p.getByRole('button', { name: new RegExp('Ajouter: ' + n) }).first().click();
await p.getByRole('button', { name: /panier|Voir/i }).last().click(); await p.waitForTimeout(600);
await p.getByPlaceholder('Votre prénom (pour vous appeler)').fill('Yassine');
await p.getByRole('button', { name: /^Commander/ }).click(); await p.waitForTimeout(1600);
await p.screenshot({ path: S + '/kiosk-done.png' });
// D. customer display + till
const ctx = await b.newContext({ viewport: { width: 1280, height: 936 }, deviceScaleFactor: 1.5, locale: 'fr-FR' });
await ctx.addInitScript(() => localStorage.setItem('display-code', 'testecran1234'));
const d = await page(null, 1.5, ctx); await d.goto('http://localhost:5174/?ecran=testecran1234'); await d.waitForTimeout(800);
p = await page(null, 1.5, ctx);
const btn = (n, o = {}) => p.getByRole('button', { name: n, ...o });
await p.goto('http://localhost:5174/');
await btn(/Se connecter avec un e-mail/).click();
await p.getByLabel('E-mail du poste').fill('kassa@doms.test'); await p.getByLabel('Mot de passe').fill('kassa-test-123');
await btn('Se connecter').click(); await btn(/^Sara/).click();
for (const x of '1111') await btn(x, { exact: true }).click();
await btn('✓').click(); await p.waitForTimeout(1500);
await btn('Emporter').first().click(); await p.waitForTimeout(800);
await btn(/Boissons Chaudes/).first().click();
for (const n of ['Cappuccino', 'Cappuccino', 'Chocolat chaud', 'Thé à la menthe']) await btn(new RegExp(n)).first().click();
await p.waitForTimeout(900);
await d.screenshot({ path: S + '/display.png' });
await p.screenshot({ path: S + '/till.png' });
// E. owner live
p = await page({ width: 1280, height: 900 }, 2);
await p.goto('http://localhost:5175/');
await p.getByLabel('E-mail').fill('eigenaar@doms.test'); await p.getByLabel('Mot de passe').fill('eigenaar-test-123');
await p.getByLabel('Mot de passe').press('Enter'); await p.locator('aside').waitFor(); await p.waitForTimeout(800);
await p.getByRole('button', { name: 'En direct', exact: true }).click(); await p.waitForTimeout(1500);
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(800);
await p.screenshot({ path: S + '/live.png' });
// F. website
p = await page({ width: 1440, height: 900 }, 1);
await p.goto('http://localhost:5180/doms-cafe'); await p.waitForTimeout(1200);
await p.evaluate(() => document.querySelectorAll('.rv').forEach(n => n.classList.add('in'))); await p.waitForTimeout(1200);
await p.screenshot({ path: S + '/site.png' });
p = await page({ width: 390, height: 844 });
await p.goto('http://localhost:5180/doms-cafe'); await p.waitForTimeout(1200);
await p.screenshot({ path: S + '/site-phone.png' });
console.log(errs.slice(0, 5)); await b.close();
