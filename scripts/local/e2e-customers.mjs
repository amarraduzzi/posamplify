// End-to-end: customer file and loyalty are OFF by default. The owner switches them on
// in the back office, the till attaches a customer by phone, points come with payment,
// the reward is used as a discount, and the back office shows the customer.
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
  await q(`update restaurants set loyalty = '{}' where id = $1`, [rid]);
  await q(`delete from customers where restaurant_id = $1`, [rid]);

  // ---- back office: off by default, the owner switches it on
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  const dlg = () => page.getByRole('dialog').last();
  await page.goto('http://localhost:5175/');
  await page.getByLabel('E-mail').fill('eigenaar@doms.test'); await page.getByLabel('Mot de passe').fill('eigenaar-test-123');
  await page.getByLabel('Mot de passe').press('Enter'); await page.locator('aside').waitFor();
  if (await page.locator('aside select').isVisible()) await page.locator('aside select').selectOption({ label: "Dom's Café" });
  await page.getByRole('button', { name: 'Clients', exact: true }).click();
  await page.getByText('Désactivé par défaut').waitFor();
  await page.screenshot({ path: `${OUT}/c1-off.png` });
  await page.getByRole('button', { name: 'Activer le fichier clients' }).click();
  await page.getByText('Fichier clients actif. Points de fidélité désactivés.').waitFor();
  await page.getByRole('button', { name: 'Fidélité', exact: true }).click();
  await dlg().getByRole('button', { name: 'Points de fidélité', exact: true }).click();
  await dlg().getByLabel('Récompense à (points)').fill('20');
  await dlg().getByLabel('Valeur offerte (DH)').fill('30');
  await page.screenshot({ path: `${OUT}/c2-settings.png` });
  await dlg().getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText(/Points de fidélité : 1 point par 10 DH, 20 points/).waitFor();
  const [{ loyalty }] = await q(`select loyalty from restaurants where id = $1`, [rid]);
  assert.deepEqual([loyalty.customers, loyalty.enabled, loyalty.per_dh, loyalty.reward_points, loyalty.reward_cents], [true, true, 10, 20, 3000]);

  // ---- the till: attach a new customer, pay
  const till = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  till.on('pageerror', e => errors.push(e.message));
  const tb = (n) => till.getByRole('button', typeof n === 'string' ? { name: n, exact: true } : { name: n });
  const tdlg = () => till.getByRole('dialog').last();
  await till.goto('http://localhost:5174');
  await tb(/Se connecter avec un e-mail/).click();
  await till.getByLabel('E-mail du poste').fill('kassa@doms.test');
  await till.getByLabel('Mot de passe').fill('kassa-test-123');
  await tb('Se connecter').click();
  await tb(/^Sara/).click();
  for (const d of '1111') await tb(d).click();
  await tb('✓').click();
  const order = async (table, item, times) => {
    await tb(new RegExp(`^${table}\\b`)).first().click();
    await till.getByPlaceholder('Rechercher un article').fill(item);
    for (let i = 0; i < times; i++) await tb(new RegExp(item)).first().click();
    await tb('Envoyer').click();
    await till.getByText('Bon envoyé en cuisine').waitFor();
  };
  const payExact = async () => {
    await tb('Encaisser').click();
    await tdlg().getByRole('button', { name: 'Exact' }).click();
    await tdlg().getByRole('button', { name: /^Valider \d/ }).click();
    await tb('Terminé').click();
    await till.getByRole('dialog').waitFor({ state: 'detached' });
  };
  const [{ price }] = await q(`select price_cents price from menu_items where restaurant_id = $1 and name->>'fr' = 'Café noir'`, [rid]);
  const times = Math.ceil(25000 / Number(price)); // enough for 25+ points
  await order(6, 'Café noir', times);
  await tb('Client').click();
  await tdlg().getByLabel('Téléphone').fill('06 61 22 33 44');
  await tdlg().getByRole('button', { name: 'Chercher' }).click();
  await tdlg().getByText('Nouveau client.').waitFor();
  await tdlg().getByLabel('Prénom (facultatif)').fill('Yasmine');
  await tdlg().getByText('Le client accepte de recevoir nos offres sur WhatsApp').click();
  await till.screenshot({ path: `${OUT}/c3-till-new.png` });
  await tdlg().getByRole('button', { name: 'Associer à la commande' }).click();
  await till.getByText('Yasmine').first().waitFor();
  await payExact();
  const pts1 = Math.floor(times * Number(price) / 100 / 10);
  let [c] = await q(`select * from customers where restaurant_id = $1`, [rid]);
  assert.deepEqual([c.phone, c.name, c.points, c.visits, c.marketing_ok], ['0661223344', 'Yasmine', pts1, 1, true]);

  // ---- second visit: find by phone, use the reward
  await order(6, 'Café noir', 3);
  await tb('Client').click();
  await tdlg().getByLabel('Téléphone').fill('0661223344');
  await tdlg().getByRole('button', { name: 'Chercher' }).click();
  await tdlg().getByText(`${pts1} points`).waitFor();
  await tdlg().getByRole('button', { name: 'Associer à la commande' }).click();
  await tb(/^Utiliser 20 pts/).click();
  await till.getByText('Récompense appliquée').waitFor();
  await till.screenshot({ path: `${OUT}/c4-till-reward.png` });
  const [open] = await q(`select discount_cents, discount_kind, total_cents from orders where restaurant_id = $1 and customer_id = $2 and closed_at is null`, [rid, c.id]);
  assert.equal(open.discount_kind, 'loyalty');
  assert.equal(Number(open.discount_cents), 3000);
  await payExact();
  [c] = await q(`select * from customers where id = $1`, [c.id]);
  assert.equal(c.visits, 2);
  assert.equal(c.points, pts1 - 20 + Math.floor(Number(open.total_cents) / 100 / 10));

  // ---- back office: the customer is in the list
  await page.reload(); await page.locator('aside').waitFor();
  await page.getByRole('button', { name: 'Clients', exact: true }).click();
  await page.getByRole('cell', { name: /Yasmine/ }).waitFor();
  await page.getByRole('button', { name: 'D’accord pour WhatsApp' }).click();
  await page.getByRole('button', { name: 'Copier les numéros' }).waitFor();
  await page.screenshot({ path: `${OUT}/c5-list.png` });
  assert.deepEqual(errors, []);
  console.log('CUSTOMERS E2E OK');
} catch (e) {
  for (const c of browser.contexts()) for (const p of c.pages()) await p.screenshot({ path: `${OUT}/99-cust-fail-${c.pages().indexOf(p)}.png` }).catch(() => {});
  console.error(e); process.exitCode = 1;
} finally { await browser.close(); await db.end(); }
