// End-to-end test of the back office on the local stack (stack.sh + setup-till.mjs
// + `vite` in apps/admin on :5175). eigenaar@doms.test must be owner (+ platform admin).
import { chromium } from 'playwright';
import pg from 'pg';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:5175';
const OUT = process.env.OUT ?? '/tmp/admin';
const db = new pg.Pool({ connectionString: 'postgres://postgres@localhost:54332/postgres' });
const q = async (s, p = []) => (await db.query(s, p)).rows;
const anon = readFileSync(new URL('../../.localstack/anon.key', import.meta.url), 'utf8').trim();
const tag = Date.now().toString(36).slice(-4);
const T1 = String(100 + Math.floor(Math.random() * 800)), T2 = String(Number(T1) + 1);

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const shot = n => page.screenshot({ path: `${OUT}/${n}.png` });
const btn = n => page.getByRole('button', typeof n === 'string' ? { name: n, exact: true } : { name: n });
const dlg = () => page.getByRole('dialog');

try {
await page.goto(BASE);
await page.getByLabel('E-mail').fill('eigenaar@doms.test');
await page.getByLabel('Mot de passe').fill('eigenaar-test-123');
await btn('Se connecter').click();
await page.getByRole('heading', { name: 'Menu' }).waitFor();
if (await page.locator('select').first().isVisible()) await page.locator('select').first().selectOption({ label: "Dom's Café" });
await page.getByText(/Boissons Chaudes/).first().waitFor();
await shot('01-menu');

// --- category + items ----------------------------------------------------
await page.locator('section').first().getByRole('button', { name: 'Ajouter' }).click();
await dlg().locator('input').first().fill(`Glaces ${tag}`);
await dlg().getByRole('button', { name: '🍦' }).click();
await dlg().getByRole('button', { name: 'Enregistrer' }).click();
await page.getByText('Catégorie enregistrée').waitFor();

await btn(/Ajouter un article/).click();
await dlg().getByLabel('Nom (Français)').fill(`Glace vanille ${tag}`);
await dlg().getByRole('button', { name: /English/ }).first().click();
await dlg().getByLabel('Nom (English)').fill(`Vanilla ice cream ${tag}`);
await dlg().getByPlaceholder('35').fill('25');
await dlg().getByRole('button', { name: 'Nouveau' }).click();
await shot('02-item-editor');
await dlg().getByRole('button', { name: 'Enregistrer' }).click();
await page.getByText('Article enregistré').waitFor();

await btn(/Ajouter un article/).click();
await dlg().getByLabel('Nom (Français)').fill(`Coupe ${tag}`);
await dlg().getByRole('button', { name: /Option/ }).click();
await dlg().getByRole('button', { name: /Option/ }).click();
await dlg().getByLabel('Option 1 (Français)').fill('2 boules'); await dlg().getByLabel('Prix option 1').fill('30');
await dlg().getByLabel('Option 2 (Français)').fill('3 boules'); await dlg().getByLabel('Prix option 2').fill('40,50');
await shot('02b-variants');
await dlg().getByRole('button', { name: 'Enregistrer' }).click();
await page.getByText('Article enregistré').waitFor();
await page.getByText('2 boules 30 MAD').waitFor();

// sold out toggle on the vanilla ice cream
await page.getByRole('listitem').filter({ hasText: `Glace vanille ${tag}` }).getByRole('button', { name: /Disponible/ }).click();
await page.getByRole('listitem').filter({ hasText: `Glace vanille ${tag}` }).getByText('Épuisé').waitFor();
await shot('03-items');

// the guest menu shows it, with variants and server prices
const menu = await (await fetch('http://localhost:54331/rest/v1/rpc/get_menu', { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ p_slug: 'doms-cafe' }) })).json();
const van = menu.items.find(i => i.name.fr === `Glace vanille ${tag}`);
const cup = menu.items.find(i => i.name.fr === `Coupe ${tag}`);
assert.ok(van && cup, 'new items visible on the guest menu');
assert.equal(van.name.en, `Vanilla ice cream ${tag}`);
assert.equal(van.available, false);
assert.deepEqual(van.tags, ['new']);
assert.deepEqual(cup.variants.map(v => [v.name.fr, Number(v.price_cents)]), [['2 boules', 3000], ['3 boules', 4050]]);
assert.ok(menu.categories.some(c => c.icon === '🍦'));

// --- staff ------------------------------------------------------------------
await btn(/Personnel/).click();
await btn(/Ajouter/).click();
await dlg().locator('input').first().fill(`Nadia${tag}`);
await dlg().getByRole('button', { name: 'Manager' }).click();
await dlg().locator('input').nth(1).fill('5831');
await dlg().getByRole('button', { name: 'Enregistrer' }).click();
await page.getByText(`Nadia${tag}`).waitFor();
const [{ ok }] = await q(`select extensions.crypt('5831', p.pin_hash) = p.pin_hash ok from app.staff_pins p join staff s on s.id=p.staff_id where s.name=$1`, [`Nadia${tag}`]);
assert.equal(ok, true, 'PIN stored hashed and correct');
await shot('04-staff');

// --- tables + QR -------------------------------------------------------------
await btn(/Tables & QR/).click();
await btn(/Ajouter des tables/).click();
const inputs = dlg().locator('input');
await inputs.nth(0).fill(T1); await inputs.nth(1).fill(T2); await inputs.nth(2).fill('Terrasse');
await dlg().getByRole('button', { name: /Ajouter 2 table/ }).click();
await page.getByText('2 table(s) ajoutée(s)').waitFor();
const [t41] = await q(`select qr_token from dining_tables t join restaurants r on r.id=t.restaurant_id where r.slug='doms-cafe' and label=$1`, [T1]);
await page.getByText(T1, { exact: true }).first().locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]').getByRole('button', { name: /QR/ }).click();
await page.locator('svg').first().waitFor();
await shot('05-qr');
const qrDisplayed = await page.locator('svg path').count();
assert.ok(qrDisplayed > 0, 'QR code rendered');
assert.ok(t41.qr_token.length >= 10);
await btn(/Fermer/).click();

// --- settings ------------------------------------------------------------------
await btn(/Restaurant/).click();
await page.getByRole('heading', { name: 'Informations', exact: true }).waitFor();
const colorBox = page.locator('input[type="text"], input:not([type])').filter({ has: page.locator('xpath=self::*[starts-with(@value,"#")]') });
await page.locator('input[value^="#"]').last().fill('#1F6F4A');
await btn(/Enregistrer/).first().click();
await page.getByText('Restaurant enregistré').waitFor();
const [rr] = await q(`select branding->>'primary_color' c from restaurants where slug='doms-cafe'`);
assert.equal(rr.c, '#1F6F4A');
await shot('06-settings');
await page.locator('input[value^="#"]').last().fill('#C9A15A');
await btn(/Enregistrer/).first().click();
await page.getByText('Restaurant enregistré').waitFor();

// --- reports -------------------------------------------------------------------
await btn(/Ventes/).click();
await page.getByText("Chiffre d'affaires TTC").waitFor();
await shot('07-reports');

// --- platform ------------------------------------------------------------------
await btn(/Plateforme/).click();
await btn(/Nouveau restaurant/).click();
await dlg().locator('input').first().fill(`Le Jardin ${tag}`);
await dlg().getByRole('button', { name: 'Créer' }).click();
await page.getByText('Restaurant créé (essai de 30 jours)').waitFor();
const row = page.getByRole('row').filter({ hasText: `Le Jardin ${tag}` });
await row.getByRole('button', { name: 'Suspendre' }).click();
await row.getByText('Suspendu').waitFor();
await shot('08-platform');
const [j] = await q(`select status from restaurants where slug = $1`, [`le-jardin-${tag}`]);
assert.equal(j.status, 'paused');

assert.deepEqual(errors, [], 'browser errors: ' + errors.join('\n'));
console.log('ADMIN E2E OK');
} catch (e) { await shot('FAIL').catch(() => {}); console.error('FAILED:', e.message.split('\n')[0]); await browser.close(); await db.end(); process.exit(1); }
await browser.close(); await db.end();
