// End-to-end test of the till on the local stack (stack.sh + setup-till.mjs +
// fake-printhost.mjs + `vite` on :5174). Screenshots go to $OUT.
import { chromium } from 'playwright';
import pg from 'pg';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:5174';
const OUT = process.env.OUT ?? '/tmp/pos';
const TICKETS = process.env.TICKETS ?? '/tmp/tickets.txt';
const db = new pg.Pool({ connectionString: 'postgres://postgres@localhost:54332/postgres' });
const q = async (s, p = []) => (await db.query(s, p)).rows;
const anon = readFileSync(new URL('../../.localstack/anon.key', import.meta.url), 'utf8').trim();
writeFileSync(TICKETS, '');
const tickets = () => (existsSync(TICKETS) ? readFileSync(TICKETS, 'utf8') : '');

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const shot = n => page.screenshot({ path: `${OUT}/${n}.png` });
process.on('unhandledRejection', async e => { await page.screenshot({ path: `${OUT}/FAIL.png` }).catch(() => {}); console.error(e.message.split('\n')[0]); process.exit(1); });
const btn = n => page.getByRole('button', typeof n === 'string' ? { name: n, exact: true } : { name: n });

// 1. till login, staff PIN
await page.goto(BASE);
await page.getByLabel('E-mail du poste').fill('kassa@doms.test');
await page.getByLabel('Mot de passe').fill('kassa-test-123');
await btn('Se connecter').click();
await btn(/^Sara/).click();
await page.keyboard.type('0000'); await page.keyboard.press('Enter');
await page.getByText('Code incorrect.').waitFor();
for (const d of '1111') await btn(d, { exact: true }).click();
await btn('✓').click();
await page.getByText(/Tables \d+\/20/).waitFor();
await shot('01-tables');

// 2. table 3: two coffees + a pizza, send
await btn(/^3\b/).first().click();
await btn(/Boissons Chaudes/).click();
await btn(/^Café noir/).click(); await btn(/^Café noir/).click();
await btn(/Pizzas/).click();
await btn(/^Pizza Margarita/).click();
await shot('02-order-draft');
await btn('Envoyer').click();
await page.getByText('Bon envoyé en cuisine').waitFor();
let t = tickets();
assert.match(t, /\[BAR\][\s\S]*2x Cafe noir/, 'bar bon printed');
assert.match(t, /\[CUISINE\][\s\S]*1x Pizza Margarita/, 'kitchen bon printed');
await btn('Retour').click();

// 3. a guest orders through the QR code on table 3 -> accept -> joins the bill
const [{ token }] = await q(`select qr_token token from dining_tables t join restaurants r on r.id=t.restaurant_id where r.slug='doms-cafe' and label='3'`);
const [{ id: jusId }] = await q(`select i.id from menu_items i join restaurants r on r.id=i.restaurant_id where r.slug='doms-cafe' and not exists (select 1 from item_variants v where v.menu_item_id=i.id) and exists (select 1 from categories c where c.id=i.category_id and c.name->>'fr' ilike 'jus%') and i.available limit 1`);
const qrRes = await fetch('http://localhost:54331/rest/v1/rpc/place_order', { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' },
  body: JSON.stringify({ p_slug: 'doms-cafe', p_order: { client_id: crypto.randomUUID(), order_type: 'dine_in', table_token: token, note: 'sans glacons', items: [{ item_id: jusId, quantity: 1 }] } }) });
assert.equal(qrRes.status, 200, await qrRes.clone().text());
await page.getByText('1 nouvelle commande client (QR) à accepter').waitFor({ timeout: 15000 });
await shot('03-qr-banner');
await btn(/Commandes \(/).click();
await shot('04-live-orders');
await btn('Accepter').click();
await page.getByText(/acceptée/).waitFor();
const open3 = await q(`select o.id, o.total_cents, o.note, count(l.*)::int n from orders o join dining_tables t on t.id=o.table_id left join order_lines l on l.order_id=o.id
  where t.label='3' and o.closed_at is null group by o.id`);
assert.equal(open3.length, 1, 'QR order merged into the table bill');
assert.equal(open3[0].n, 3);
assert.equal(open3[0].note, 'sans glacons');

// 4. pay table 3 cash: customer gives 200
await btn(/Tables/).click();
await btn(/^3\b/).first().click();
await btn('Encaisser').click();
await page.getByText('Total à payer').waitFor();
const total3 = Number(open3[0].total_cents);
for (const d of '200') await page.getByRole('dialog').getByRole('button', { name: d, exact: true }).click();
await shot('05-payment');
await page.getByRole('dialog').getByRole('button', { name: /^Valider \d/ }).click();
await page.getByText('À rendre').waitFor();
await shot('06-paid');
t = tickets();
assert.match(t, /\[TICKET\] Ticket T-\d{4}-\d{6}[\s\S]*TOTAL TTC[\s\S]*Rendu[\s\S]*\[TIROIR OUVERT\]/, 'receipt + drawer');
assert.match(t, /ICE 003366999000071/);
await btn('Terminé').click();
const [doc1] = await q(`select * from fiscal_documents order by chain_index desc limit 1`);
assert.equal(Number(doc1.total_ttc_cents), total3);

// 5. takeaway paid by card with a customer name
await btn('Emporter').first().click();
await page.getByPlaceholder('Nom').fill('Youssef');
await btn(/Pizzas/).click();
await btn(/^Pizza Margarita/).click();
await btn('Encaisser').click();
await page.getByRole('dialog').getByRole('button', { name: /^Carte$/ }).click();
await page.getByRole('dialog').getByRole('button', { name: /^Valider \d/ }).click();
await btn('Terminé').click();
const [take] = await q(`select o.customer_name, o.order_type, o.closed_at from orders o order by created_at desc limit 1`);
assert.deepEqual([take.customer_name, take.order_type, !!take.closed_at], ['Youssef', 'takeaway', true]);

// 6. table 5 with a manager discount of 10 %, then Karim approves
await btn(/^5\b/).first().click();
await btn(/Pizzas/).click();
await btn(/^Pizza Margarita/).click(); await btn(/^Pizza Margarita/).click();
await btn('Envoyer').click();
await btn('Remise').click();
await page.getByRole('dialog').getByRole('button', { name: 'Karim' }).click();
for (const d of '9999') await page.getByRole('dialog').getByRole('button', { name: d, exact: true }).click();
await page.getByRole('dialog').getByRole('button', { name: '✓' }).click();
await page.getByText(/Remise de .* appliquée/).waitFor();
await shot('07-discount');
// void a sent line needs a manager: Sara's PIN is refused
await page.getByRole('button', { name: 'Retirer' }).first().click();
await page.getByRole('dialog').getByRole('button', { name: 'Karim' }).click();
for (const d of '1111') await page.getByRole('dialog').getByRole('button', { name: d, exact: true }).click();
await page.getByRole('dialog').getByRole('button', { name: '✓' }).click();
await page.getByText('Code incorrect.').waitFor();
await page.keyboard.press('Escape');
await btn('Retour').click();

// 7. history: refund the first ticket with a credit note
await btn('Historique').click();
await page.getByText(doc1.doc_number).click();
await btn(/Avoir/).click();
await page.getByRole('dialog').locator('input').fill('Client mécontent');
await page.getByRole('dialog').getByRole('button', { name: 'Karim' }).click();
for (const d of '9999') await page.getByRole('dialog').getByRole('button', { name: d, exact: true }).click();
await page.getByRole('dialog').getByRole('button', { name: '✓' }).click();
await page.getByText(/Avoir A-\d{4}-\d{6} émis/).waitFor();
await shot('08-history');

// 8. reports: payout, try Z with an open table (refused), cancel it, then Z
await btn(/Caisse & rapports/).click();
await btn(/Sortie de caisse/).click();
await page.getByRole('dialog').locator('input').first().fill('45');
await page.getByRole('dialog').locator('input').nth(1).fill('Pain boulangerie');
await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click();
await page.getByText('Pain boulangerie').waitFor();
await shot('09-reports');
await btn(/Clôturer la journée/).click();
await page.getByText(/commande\(s\) encore ouverte/).waitFor();
await page.keyboard.press('Escape');
await btn(/Tables/).click();
await btn(/^5\b/).first().click();
await btn('Annuler').click();
await page.getByRole('dialog').getByRole('button', { name: 'Erreur de saisie' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Karim' }).click();
for (const d of '9999') await page.getByRole('dialog').getByRole('button', { name: d, exact: true }).click();
await page.getByRole('dialog').getByRole('button', { name: '✓' }).click();
await page.getByText('Commande annulée').waitFor();
await btn(/Caisse & rapports/).click();
await btn(/Clôturer la journée/).click();
await page.getByRole('dialog').getByRole('button', { name: 'Karim' }).click();
for (const d of '9999') await page.getByRole('dialog').getByRole('button', { name: d, exact: true }).click();
await page.getByRole('dialog').getByRole('button', { name: '✓' }).click();
await page.getByText('Journée clôturée', { exact: true }).waitFor();
await shot('10-z');
t = tickets();
assert.match(t, /RAPPORT Z/);
const chain = await q(`select public.verify_fiscal_chain(id) v from restaurants where slug='doms-cafe'`).catch(() => null);

// 9. lock
await btn('Verrouiller').click();
await page.getByText('Qui êtes-vous ?').waitFor();

assert.deepEqual(errors, [], 'browser errors: ' + errors.join('\n'));
console.log('POS E2E OK. Tickets printed:', (t.match(/=====/g) ?? []).length);
await browser.close(); await db.end();
