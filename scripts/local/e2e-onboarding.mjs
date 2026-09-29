// A brand-new restaurant from zero to its first paid order, without SQL:
// sign up in the back office, wizard, pair a till with a code, sell, revoke.
// Needs: stack.sh (with anonymous sign-ins), admin on :5175, till on :5174.
import { chromium } from 'playwright';
import pg from 'pg';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const OUT = process.env.OUT ?? '/tmp/onb';
const db = new pg.Pool({ connectionString: 'postgres://postgres@localhost:54332/postgres' });
const q = async (s, p = []) => (await db.query(s, p)).rows;
const anon = readFileSync(new URL('../../.localstack/anon.key', import.meta.url), 'utf8').trim();
const tag = Date.now().toString(36).slice(-5);
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
const mk = async () => { const p = await browser.newPage({ viewport: { width: 1366, height: 800 } }); p.on('pageerror', e => errors.push(e.message)); return p; };
const admin = await mk();
const till = await mk();
const b = (p, n) => p.getByRole('button', typeof n === 'string' ? { name: n, exact: true } : { name: n });
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });

try {
  // ---- sign up ----------------------------------------------------------
  await admin.goto('http://localhost:5175');
  await b(admin, /Créer un compte/).click();
  await admin.getByLabel('E-mail').fill(`patron-${tag}@test.ma`);
  await admin.getByLabel('Mot de passe').fill('motdepasse123');
  await shot(admin, '01-signup');
  await b(admin, 'Créer mon compte').click();

  // ---- wizard -----------------------------------------------------------
  await admin.getByText('Bienvenue !').waitFor();
  await admin.getByLabel('Nom du restaurant').fill(`Café Atlas ${tag}`);
  await admin.getByLabel('Ville').fill('Marrakech');
  await admin.getByText(`/cafe-atlas-${tag}`).waitFor();
  await shot(admin, '02-wizard-restaurant');
  await b(admin, /Créer mon restaurant/).click();
  await admin.getByText("Votre type d'établissement").waitFor();
  await b(admin, /^Café/).click();
  await admin.getByText('Combien de tables ?').waitFor();
  await b(admin, '5').click();
  await b(admin, /Continuer/).click();
  await admin.getByText('Votre code de caisse').waitFor();
  await admin.getByLabel('Votre prénom').fill('Samir');
  await admin.getByLabel('Code (4 à 6 chiffres)').fill('2468');
  await b(admin, /Continuer/).click();
  await admin.getByText('Relier votre caisse').waitFor();
  await b(admin, 'Créer un code de connexion').click();
  const code = (await admin.locator('p.font-mono').innerText()).trim();
  assert.match(code, /^[A-Z2-9]{8}$/);
  await shot(admin, '03-wizard-code');

  // ---- the till pairs with the code ------------------------------------
  await till.goto('http://localhost:5174');
  await till.getByLabel('Code de connexion').fill(code.toLowerCase());
  await shot(till, '04-till-code');
  await b(till, /Relier ce poste/).click();
  await b(till, /^Samir/).click();
  await till.keyboard.type('2468'); await till.keyboard.press('Enter');
  await till.getByText(/Tables 0\/5/).waitFor();
  await shot(till, '05-till-tables');

  // ---- wizard end, add an item ------------------------------------------
  await b(admin, /Continuer/).click();
  await admin.getByText("C'est prêt").waitFor();
  await b(admin, 'Ajouter mes articles').click();
  await admin.getByRole('heading', { name: 'Menu' }).waitFor();
  await admin.getByText('Boissons chaudes').first().click();
  await b(admin, /Ajouter un article/).click();
  await admin.getByRole('dialog').getByLabel('Nom (Français)').fill('Café noir');
  await admin.getByRole('dialog').getByPlaceholder('35').fill('12');
  await admin.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click();
  await admin.getByText('Article enregistré').waitFor();
  await shot(admin, '06-menu');

  // ---- guest menu is live -----------------------------------------------
  const menu = await (await fetch('http://localhost:54331/rest/v1/rpc/get_menu', { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ p_slug: `cafe-atlas-${tag}` }) })).json();
  assert.equal(menu.restaurant.name, `Café Atlas ${tag}`);
  assert.equal(menu.ordering_enabled, true);
  assert.deepEqual(menu.items.map(i => [i.name.fr, Number(i.price_cents)]), [['Café noir', 1200]]);

  // ---- first sale at the till --------------------------------------------
  await till.reload();
  await b(till, /^Samir/).click().catch(() => {});
  if (await till.getByText('Qui êtes-vous ?').isVisible().catch(() => false)) { await b(till, /^Samir/).click(); }
  if (await till.getByText('Code de Samir').isVisible().catch(() => false)) { await till.keyboard.type('2468'); await till.keyboard.press('Enter'); }
  await b(till, /^2\b/).first().click();
  await b(till, /Boissons chaudes/).click();
  await b(till, /^Café noir/).click(); await b(till, /^Café noir/).click();
  await b(till, 'Encaisser').click();
  await till.getByRole('dialog').getByRole('button', { name: /^Valider \d/ }).click();
  await till.getByText('T-').first().waitFor();
  await shot(till, '07-first-sale');
  const [doc] = await q(`select f.doc_number, f.total_ttc_cents from fiscal_documents f join restaurants r on r.id=f.restaurant_id where r.slug=$1`, [`cafe-atlas-${tag}`]);
  assert.equal(Number(doc.total_ttc_cents), 2400);
  assert.match(doc.doc_number, /-000001$/);
  await b(till, 'Terminé').click();

  // ---- owner sees and revokes the till ------------------------------------
  await b(admin, /Caisses/).click();
  await admin.getByText('Caisse principale').waitFor();
  await shot(admin, '08-devices');
  await b(admin, /Retirer/).first().click();
  await admin.getByText('Accès retiré').waitFor();
  await till.reload();
  await till.getByText("Ce poste n'est relié à aucun restaurant.").waitFor();
  await shot(till, '09-till-revoked');

  assert.deepEqual(errors, [], 'browser errors: ' + errors.join('\n'));
  console.log('ONBOARDING E2E OK:', doc.doc_number);
} catch (e) {
  await shot(admin, 'FAIL-admin').catch(() => {}); await shot(till, 'FAIL-till').catch(() => {});
  console.error('FAILED:', e.message.split('\n').slice(0,3).join(' | '), e.stack.split('\n').find(l => l.includes('e2e-onboarding'))); process.exitCode = 1;
} finally { await browser.close(); await db.end(); }
