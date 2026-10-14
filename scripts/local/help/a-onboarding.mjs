// Part 1: a new restaurant (Café Atlas, fictional) from sign-up to its menu, staff, tables and till.
import { page, btn, snap, state, saveState, q, db, done } from './lib.mjs';
import { fileURLToPath } from 'node:url';

const EMAIL = 'patron@cafe-atlas.ma', PASS = 'atlas-demo-2026', SLUG = 'cafe-atlas';
// start clean
{
  const c = await db.connect();
  await c.query(`begin; select set_config('app.purge','on',true);
    delete from public.restaurants where slug = '${SLUG}';
    delete from auth.users where email = '${EMAIL}';
    commit;`);
  c.release();
}
const admin = await page(860, 780);

// ---- sign up ----------------------------------------------------------------
await admin.goto('http://localhost:5176/?inscription=1');
await admin.getByLabel('E-mail').fill(EMAIL);
await admin.getByLabel('Mot de passe').fill(PASS);
await snap(admin, 'signup', { target: btn(admin, 'Créer mon compte') });
await btn(admin, 'Créer mon compte').click();

// ---- wizard -------------------------------------------------------------------
await admin.getByText('Bienvenue !').waitFor();
await admin.getByLabel('Nom du restaurant').fill('Café Atlas');
await admin.getByLabel('Ville').fill('Rabat');
await admin.getByText(`/${SLUG}`).first().waitFor();
await snap(admin, 'wizard-restaurant', { target: btn(admin, /Créer mon restaurant/) });
await btn(admin, /Créer mon restaurant/).click();
await admin.getByText("Votre type d'établissement").waitFor();
await snap(admin, 'wizard-menu', { target: btn(admin, /Importer ma carte/) });
await btn(admin, /Je commence vide/).click();
await admin.getByText('Combien de tables ?').waitFor();
await btn(admin, '10').click();
await snap(admin, 'wizard-tables', { target: btn(admin, '10') });
await btn(admin, /Continuer/).click();
await admin.getByText('Votre code de caisse').waitFor();
await admin.getByLabel('Votre prénom').fill('Yasmine');
await admin.getByLabel('Code (4 à 6 chiffres)').fill('2468');
await snap(admin, 'wizard-you', { target: admin.getByLabel('Code (4 à 6 chiffres)') });
await btn(admin, /Continuer/).click();
await admin.getByText('Relier votre caisse').waitFor();
await btn(admin, 'Créer un code de connexion').click();
const code = (await admin.locator('p.font-mono').first().innerText()).trim();
await snap(admin, 'wizard-till-code', { target: admin.locator('p.font-mono').first() });
state.code = code; state.slug = SLUG; state.email = EMAIL; state.pass = PASS; saveState();

// ---- the till links with the code ---------------------------------------------
const till = await page(1280, 800);
await till.goto('http://localhost:5174');
await till.getByLabel('Code de connexion').fill(code.toLowerCase());
await snap(till, 'till-link', { target: btn(till, /Relier ce poste/) });
await btn(till, /Relier ce poste/).click();
await btn(till, /^Yasmine/).waitFor();
await snap(till, 'till-who', { target: btn(till, /^Yasmine/) });
await btn(till, /^Yasmine/).click();
await till.waitForTimeout(400);
for (const d of '24') await btn(till, d).click();
await snap(till, 'till-pin', { target: btn(till, '✓') });
for (const d of '68') await btn(till, d).click();
await btn(till, '✓').click();
await till.getByText(/Tables 0\/10/).waitFor();
await snap(till, 'till-home-empty', { target: btn(till, /Tables 0\/10/) });

await btn(admin, /Continuer/).click();
await admin.getByText("C'est prêt").waitFor();
await snap(admin, 'wizard-done', { target: btn(admin, 'Ajouter mes articles') });

// ---- import the menu (Excel/CSV route: the photo route needs the AI service) ----
await admin.setViewportSize({ width: 1280, height: 800 });
await btn(admin, 'Ajouter mes articles').click();
await admin.getByRole('heading', { name: 'Menu' }).waitFor();
await snap(admin, 'menu-empty', { target: admin.getByText('Importer mon menu').first() });
await btn(admin, 'Importer').click();
const dlg = admin.getByRole('dialog');
await dlg.getByText('Fichier Excel ou CSV').waitFor();
await snap(admin, 'import-choose', { clip: dlg, target: dlg.getByText('Photo ou PDF de la carte').first() });
const file = fileURLToPath(new URL('./menu-cafe-atlas.csv', import.meta.url));
await dlg.locator('input[type=file]').last().setInputFiles(file);
await dlg.getByText(/Importer \d+ articles/).waitFor({ timeout: 15000 });
await snap(admin, 'import-review', { clip: dlg, target: btn(admin, /Importer \d+ articles/, false) });
await btn(admin, /Importer \d+ articles/, false).click();
await admin.getByText(/articles importés/).waitFor({ timeout: 15000 });
await snap(admin, 'import-done', { clip: admin.getByRole('dialog'), target: btn(admin, 'Voir le menu') });
await btn(admin, 'Voir le menu').click();
await admin.waitForTimeout(1200);
saveState();
await done();
