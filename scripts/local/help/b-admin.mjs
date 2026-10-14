// Part 2: the owner sets up Café Atlas in the admin (menu details, options, staff, tables, tills, settings).
// Each section runs on its own: a failure is reported and the next section still runs.
import { page, btn, snap, state, saveState, q, done } from './lib.mjs';

const R = (await q(`select id from public.restaurants where slug = 'cafe-atlas'`))[0].id;
state.rid = R; saveState();
await q(`delete from public.staff where restaurant_id = $1 and name = 'Karim'`, [R]);
const a = await page(1280, 900);
await a.goto('http://localhost:5176/');
await a.getByLabel('E-mail').fill(state.email);
await a.getByLabel('Mot de passe').fill(state.pass);
await btn(a, 'Se connecter').click();
await a.waitForTimeout(2500);
const nav = async (n) => { await btn(a, n).first().click(); await a.waitForTimeout(1200); };
const dialog = () => a.getByRole('dialog').last();
const close = async () => { await a.keyboard.press('Escape'); await a.waitForTimeout(400); };
const fails = [];
const CARD = `xpath=ancestor::div[contains(concat(' ',@class,' '),' card ')][1]`;
const section = async (name, fn) => { try { await fn(); } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`); await close(); } };

await section('category', async () => {
  await nav('Menu');
  await snap(a, 'menu-list', { target: btn(a, /Ajouter un article/, false) });
  // the pencil next to the selected category
  await a.getByText('Boissons chaudes').first().click();
  await a.getByRole('button', { name: /Modifier/ }).first().click();
  const d = dialog();
  await d.getByText('Préparé à').waitFor();
  await d.locator('select').first().selectOption({ label: 'Bar' }).catch(() => {});
  await snap(a, 'category-edit', { clip: d, target: d.getByText('Préparé à').first() });
  await d.getByRole('button', { name: 'Enregistrer' }).click();
  await a.waitForTimeout(800);
});
await q(`update public.categories set station = 'bar' where restaurant_id = $1 and name->>'fr' in ('Boissons chaudes', 'Boissons froides')`, [R]);

await section('item', async () => {
  await a.getByText('Café noir', { exact: true }).first().click();
  const d = dialog();
  await d.getByText('Prix (MAD)').waitFor();
  await snap(a, 'item-edit', { clip: d, target: d.getByText('Prix (MAD)').first() });
  await close();
});

await section('glovo', async () => {
  await btn(a, /Prix Glovo/, false).click();
  const d = dialog();
  await d.locator('input').first().fill('20');
  await snap(a, 'glovo-markup', { clip: d, target: d.locator('input').first() });
  await d.getByRole('button', { name: 'Enregistrer' }).click();
  await a.waitForTimeout(800);
});

await section('modifiers', async () => {
  await btn(a, /Suppléments et formules/, false).click();
  await btn(a, 'Nouveau groupe').click();
  const d = dialog();
  await d.getByLabel('Nom du groupe (Français)').fill('Boisson du petit-déjeuner');
  await d.getByRole('button', { name: /Un choix obligatoire/ }).click();
  const names = ['Café noir', 'Nous-nous', 'Thé à la menthe'];
  for (let i = 0; i < names.length; i++) {
    if (i > 0) await d.getByRole('button', { name: 'Ajouter une option' }).click();
    await d.getByLabel(`Option ${i + 1} (Français)`).fill(names[i]);
  }
  await d.getByLabel('Petit-déjeuner Atlas').check().catch(async () => { await d.getByText('Petit-déjeuner Atlas').click(); });
  await snap(a, 'modifier-group', { clip: d, target: d.getByRole('button', { name: /Un choix obligatoire/ }) });
  await d.getByRole('button', { name: 'Enregistrer' }).click();
  await a.waitForTimeout(1000);
  await close();
});

await section('staff', async () => {
  await nav('Personnel');
  await btn(a, 'Ajouter').first().click();
  const d = dialog();
  await d.getByLabel(/Prénom/).fill('Karim');
  await d.getByLabel(/Code/).fill('1357');
  await snap(a, 'staff-new', { clip: d, target: d.getByLabel(/Rôle/) });
  await d.getByRole('button', { name: /Enregistrer|Ajouter/ }).last().click();
  await a.waitForTimeout(1000);
  await snap(a, 'staff-list', { target: btn(a, 'Ajouter').first() });
});

await section('tables', async () => {
  await nav('Tables & QR codes');
  await btn(a, 'Ajouter des tables').click();
  const d = dialog();
  const ins = d.locator('input');
  await ins.nth(0).fill('11'); await ins.nth(1).fill('14');
  await d.getByLabel(/Zone/).fill('Terrasse');
  await snap(a, 'tables-add', { clip: d, target: d.getByLabel(/Zone/) });
  await d.getByRole('button', { name: /Ajouter \d+ table/ }).click();
  await a.waitForTimeout(1200);
  await snap(a, 'tables-list', { target: btn(a, 'Imprimer tous les QR codes') });
  await btn(a, 'Imprimer tous les QR codes').click();
  await a.waitForTimeout(1500);
  await snap(a, 'tables-qr-sheet', { target: btn(a, 'Imprimer').last() });
  await close();
});

await section('devices', async () => {
  await nav('Caisses');
  await snap(a, 'devices', { target: btn(a, /Relier une caisse/, false) });
});

await section('settings', async () => {
  await nav('Restaurant');
  await a.getByLabel(/Raison sociale/).fill('Café Atlas SARL');
  await a.getByLabel(/ICE/).fill('001234567000089');
  await a.getByLabel(/Identifiant fiscal/).fill('12345678');
  await a.getByLabel(/Registre de commerce/).fill('RC 123456 Rabat');
  const fiscal = a.getByText('Informations fiscales').first();
  const card = fiscal.locator(CARD);
  await card.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await snap(a, 'settings-fiscal', { clip: card, target: a.getByLabel(/ICE/) });
  await btn(a, /Enregistrer/, false).first().click();
  await a.waitForTimeout(1000);
  const caisse = a.getByRole('heading', { name: 'Caisse', exact: true });
  const card2 = caisse.locator(CARD);
  await card2.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await snap(a, 'settings-caisse', { clip: card2, target: a.getByText(/Télécharger le programme d’impression/).first() });
  const st = a.getByRole('heading', { name: 'Postes de préparation' });
  await st.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await snap(a, 'settings-stations', { clip: st.locator(CARD) });
});

console.log('fails:', fails);
await done();
