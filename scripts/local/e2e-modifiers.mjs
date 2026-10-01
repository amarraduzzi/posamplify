// End-to-end: extras and set-menu choices. Created in the back office, chosen on the till
// and on the guest QR menu, priced by the database. Local stack + admin :5175, till :5174, menu :5173, printhost.
import { chromium } from 'playwright';
import pg from 'pg';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const OUT = process.env.OUT ?? '/tmp/profit';
const TICKETS = process.env.TICKETS ?? '/tmp/tickets.txt';
const db = new pg.Pool({ connectionString: 'postgres://postgres@localhost:54332/postgres' });
const q = async (s, p = []) => (await db.query(s, p)).rows;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
const DISH = 'Pizza Margarita';
try {
  const [{ id: rid }] = await q(`select id from restaurants where slug = 'doms-cafe'`);
  await q(`delete from modifier_groups where restaurant_id = $1`, [rid]);
  const [dish] = await q(`select id, price_cents from menu_items where restaurant_id = $1 and name->>'fr' = $2`, [rid, DISH]);

  // ---- back office: two groups
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  const dlg = () => page.getByRole('dialog').last();
  await page.goto('http://localhost:5175/');
  await page.getByLabel('E-mail').fill('eigenaar@doms.test'); await page.getByLabel('Mot de passe').fill('eigenaar-test-123');
  await page.getByLabel('Mot de passe').press('Enter'); await page.locator('aside').waitFor();
  if (await page.locator('aside select').isVisible()) await page.locator('aside select').selectOption({ label: "Dom's Café" });
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Suppléments et formules' }).click();
  const group = async (name, kind, options) => {
    await page.getByRole('button', { name: 'Nouveau groupe' }).click();
    await dlg().getByLabel('Nom du groupe (Français)').fill(name);
    if (kind) await dlg().getByRole('button', { name: new RegExp(kind) }).click();
    for (const [k, [n, p]] of options.entries()) {
      if (k > 0) await dlg().getByRole('button', { name: 'Ajouter une option' }).click();
      await dlg().getByLabel(`Option ${k + 1} (Français)`).fill(n);
      if (p) await dlg().getByLabel('Prix en plus (DH)').nth(k).fill(p);
    }
    await dlg().getByLabel(DISH).check();
    await dlg().getByRole('button', { name: 'Enregistrer' }).click();
    await page.getByText('Groupe enregistré').last().waitFor();
  };
  await group('Suppléments', null, [['Fromage', '5'], ['Oeuf', '3']]);
  await group('Cuisson', 'Un choix obligatoire', [['Bien cuite'], ['Normale']]);
  await page.screenshot({ path: `${OUT}/x1-groups.png` });
  const gs = await q(`select g.name->>'fr' n, g.min_select, g.max_select, count(o.*)::int opts from modifier_groups g join modifier_options o on o.group_id = g.id
                      where g.restaurant_id = $1 group by g.id order by g.sort_order`, [rid]);
  assert.deepEqual(gs.map(g => [g.n, g.min_select, g.max_select, g.opts]), [['Suppléments', 0, null, 2], ['Cuisson', 1, 1, 2]]);

  // ---- the till: Margarita + Fromage, Bien cuite
  const before = existsSync(TICKETS) ? readFileSync(TICKETS, 'utf8').length : 0;
  const till = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  till.on('pageerror', e => errors.push(e.message));
  await till.goto('http://localhost:5174');
  await till.getByRole('button', { name: /Se connecter avec un e-mail/ }).click();
  await till.getByLabel('E-mail du poste').fill('kassa@doms.test');
  await till.getByLabel('Mot de passe').fill('kassa-test-123');
  await till.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await till.getByRole('button', { name: /^Sara/ }).click();
  for (const d of '1111') await till.getByRole('button', { name: d, exact: true }).click();
  await till.getByRole('button', { name: '✓' }).click();
  await till.getByRole('button', { name: /^7\b/ }).first().click();
  await till.getByPlaceholder('Rechercher un article').fill('Margarita');
  await till.getByRole('button', { name: new RegExp(DISH) }).first().click();
  const add = till.getByRole('dialog').getByRole('button', { name: /^Ajouter/ });
  assert.equal(await add.isDisabled(), true, 'cooking must be chosen first');
  await till.getByRole('dialog').getByRole('button', { name: /^Fromage/ }).click();
  await till.getByRole('dialog').getByRole('button', { name: /^Bien cuite/ }).click();
  await till.screenshot({ path: `${OUT}/x2-till-pick.png` });
  await add.click();
  await till.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await till.getByText('Bon envoyé en cuisine').waitFor();
  const [l1] = await q(`select l.name, l.unit_price_cents from order_lines l join orders o on o.id = l.order_id join dining_tables t on t.id = o.table_id
                        where t.label = '7' and o.closed_at is null and l.menu_item_id = $1`, [dish.id]);
  assert.equal(Number(l1.unit_price_cents), Number(dish.price_cents) + 500);
  assert.equal(l1.name, `${DISH} + Fromage, Bien cuite`);
  await till.waitForTimeout(800);
  assert.match(readFileSync(TICKETS, 'utf8').slice(before), /Pizza Margarita \+ Fromage, Bien cuite/);

  // ---- the guest QR menu: Margarita + Oeuf, Normale
  const [{ token }] = await q(`select qr_token token from dining_tables where restaurant_id = $1 and label = '8'`, [rid]);
  const guest = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'fr-FR' });
  guest.on('pageerror', e => errors.push(e.message));
  await guest.goto(`http://localhost:5173/doms-cafe/t/${token}`);
  await guest.getByRole('button', { name: /Voir le panier|Rechercher/ }).first().waitFor();
  await guest.getByRole('button', { name: new RegExp('Rechercher') }).click();
  await guest.getByPlaceholder('Rechercher un plat').fill('Margarita');
  await guest.getByRole('button', { name: new RegExp(`^Ajouter: ${DISH}`) }).first().click();
  const sheetAdd = guest.getByRole('dialog').getByRole('button', { name: /Choisissez|Ajouter/ }).last();
  assert.equal(await sheetAdd.isDisabled(), true);
  await guest.getByRole('dialog').getByText('Oeuf', { exact: true }).click();
  await guest.getByRole('dialog').getByText('Normale', { exact: true }).click();
  await guest.screenshot({ path: `${OUT}/x3-guest-sheet.png` });
  await sheetAdd.click();
  await guest.getByRole('button', { name: 'Effacer' }).click();
  await guest.getByRole('button', { name: /Voir le panier/ }).click();
  await guest.getByText('+ Oeuf, Normale').waitFor();
  await guest.getByRole('button', { name: /^Commander/ }).click();
  await guest.getByText('Merci ! Commande reçue').waitFor();
  const [l2] = await q(`select l.name, l.unit_price_cents from order_lines l join orders o on o.id = l.order_id join dining_tables t on t.id = o.table_id
                        where t.label = '8' and o.source = 'qr' and l.menu_item_id = $1 order by l.created_at desc limit 1`, [dish.id]);
  assert.equal(Number(l2.unit_price_cents), Number(dish.price_cents) + 300);
  assert.equal(l2.name, `${DISH} + Oeuf, Normale`);
  assert.deepEqual(errors, []);
  console.log('MODIFIERS E2E OK');
} catch (e) {
  for (const c of browser.contexts()) for (const p of c.pages()) await p.screenshot({ path: `${OUT}/99-mod-fail-${c.pages().indexOf(p)}.png` }).catch(() => {});
  console.error(e); process.exitCode = 1;
} finally { await browser.close(); await db.end(); }
