// End-to-end: kitchen screen. The till sends a table's order; the kitchen tablet shows only its
// station's lines, one tap marks them ready; a fully ready order becomes "ready".
import { chromium } from 'playwright';
import pg from 'pg';
import assert from 'node:assert/strict';

const OUT = process.env.OUT ?? '/tmp/profit';
const db = new pg.Pool({ connectionString: 'postgres://postgres@localhost:54332/postgres' });
const q = async (s, p = []) => (await db.query(s, p)).rows;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
async function device(viewport) {
  const p = await (await browser.newContext({ viewport })).newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.goto('http://localhost:5174');
  await p.getByRole('button', { name: /Se connecter avec un e-mail/ }).click();
  await p.getByLabel('E-mail du poste').fill('kassa@doms.test');
  await p.getByLabel('Mot de passe').fill('kassa-test-123');
  await p.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await p.getByText('Qui êtes-vous ?').waitFor();
  return p;
}
try {
  const [{ id: rid }] = await q(`select id from restaurants where slug = 'doms-cafe'`);
  const pick = async (station) => (await q(`select i.name->>'fr' n from menu_items i join categories c on c.id = i.category_id
    where i.restaurant_id = $1 and i.active and i.available and coalesce(i.station, c.station) = $2
      and not exists (select 1 from item_variants v where v.menu_item_id = i.id and v.active) order by i.sort_order limit 1`, [rid, station]))[0].n;
  const food = await pick('kitchen'), drink = await pick('bar');

  // the kitchen tablet
  const kds = await device({ width: 1280, height: 800 });
  await kds.getByRole('button', { name: 'Écran cuisine' }).click();
  await kds.getByRole('button', { name: 'Ouvrir l’écran cuisine' }).click();
  await kds.getByText('Rien à préparer pour le moment.').waitFor();

  // the till: table 10, one dish and one drink
  const till = await device({ width: 1366, height: 768 });
  await till.getByRole('button', { name: /^Sara/ }).click();
  for (const d of '1111') await till.getByRole('button', { name: d, exact: true }).click();
  await till.getByRole('button', { name: '✓' }).click();
  await till.getByRole('button', { name: /^10\b/ }).first().click();
  for (const n of [food, drink]) {
    await till.getByPlaceholder('Rechercher un article').fill(n);
    await till.getByRole('button', { name: new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
  }
  await till.getByRole('button', { name: 'Envoyer', exact: true }).click();

  // the kitchen sees the dish, not the drink
  const card = kds.locator('article', { hasText: 'Table 10' });
  await card.getByText(food).waitFor({ timeout: 20000 });
  assert.equal(await card.getByText(drink).count(), 0, 'drinks go to the bar screen');
  await kds.screenshot({ path: `${OUT}/k1-kitchen.png` });
  await card.getByRole('button', { name: 'Prêt' }).click();
  await kds.getByText('Rien à préparer pour le moment.').waitFor();
  await kds.waitForTimeout(1500);
  const lines = await q(`select l.name, l.station, l.ready_at is not null ready, o.status from order_lines l join orders o on o.id = l.order_id
                         join dining_tables t on t.id = o.table_id where t.label = '10' and o.closed_at is null order by l.station`);
  assert.deepEqual(lines.map(l => [l.station, l.ready]), [['bar', false], ['kitchen', true]]);
  assert.notEqual(lines[0].status, 'ready', 'the drink is not ready yet');
  await kds.screenshot({ path: `${OUT}/k2-done.png` });

  // switch the screen to the bar: the drink, then the whole order is ready
  await kds.getByRole('button', { name: 'Quitter l’écran cuisine' }).click();
  await kds.getByRole('button', { name: 'Quitter', exact: true }).click();
  await kds.getByRole('button', { name: 'Écran cuisine' }).click();
  await kds.getByRole('button', { name: 'Cuisine', exact: true }).click();
  await kds.getByRole('button', { name: 'Bar', exact: true }).click();
  await kds.getByRole('button', { name: 'Ouvrir l’écran cuisine' }).click();
  await kds.locator('article', { hasText: 'Table 10' }).getByText(drink).waitFor();
  await kds.locator('article', { hasText: 'Table 10' }).getByRole('button', { name: 'Prêt' }).click();
  await kds.waitForTimeout(1500);
  const [o] = await q(`select o.status from orders o join dining_tables t on t.id = o.table_id where t.label = '10' and o.closed_at is null`);
  assert.equal(o.status, 'ready');
  assert.deepEqual(errors, []);
  console.log('KDS E2E OK');
} catch (e) {
  for (const c of browser.contexts()) for (const p of c.pages()) await p.screenshot({ path: `${OUT}/99-kds-fail-${browser.contexts().indexOf(c)}.png` }).catch(() => {});
  console.error(e); process.exitCode = 1;
} finally { await browser.close(); await db.end(); }
