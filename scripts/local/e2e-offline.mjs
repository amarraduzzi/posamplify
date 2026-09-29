// Offline till, end to end (local stack + setup-till.mjs + fake-printhost.mjs + vite on :5174).
// The internet "goes down" (every call to the Supabase gateway fails), the till
// keeps taking orders, printing bons and cashing in, survives a page reload,
// then everything reaches the database once the connection is back.
import { chromium } from 'playwright';
import pg from 'pg';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:5174';
const OUT = process.env.OUT ?? '/tmp/pos';
const TICKETS = process.env.TICKETS ?? '/tmp/tickets.txt';
const db = new pg.Pool({ connectionString: 'postgres://postgres@localhost:54332/postgres' });
const q = async (s, p = []) => (await db.query(s, p)).rows;
writeFileSync(TICKETS, '');
const tickets = () => (existsSync(TICKETS) ? readFileSync(TICKETS, 'utf8') : '');

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const shot = n => page.screenshot({ path: `${OUT}/${n}.png` });
const fail = async e => { await shot('OFFLINE-FAIL').catch(() => {}); console.error('FAILED:', (e?.message ?? String(e)).split('\n')[0]); process.exit(1); };
process.on('unhandledRejection', fail);
const btn = n => page.getByRole('button', typeof n === 'string' ? { name: n, exact: true } : { name: n });
const pin = async code => { for (const d of code) await btn(d).click(); await btn('✓').click(); };

let cut = false;
await page.route('**/localhost:54331/**', route => (cut ? route.abort('internetdisconnected') : route.continue()));
const goOffline = () => { cut = true; };
const goOnline = () => { cut = false; };

const [{ id: rid }] = await q(`select id from restaurants where slug = 'doms-cafe'`);
const openOrders = async label => q(`select o.* from orders o join dining_tables t on t.id = o.table_id
  where o.restaurant_id = $1 and t.label = $2 and o.closed_at is null and o.status <> 'cancelled'`, [rid, label]);
const before = Number((await q(`select count(*) n from orders where restaurant_id = $1`, [rid]))[0].n);

try {
  // 1. online login: Sara unlocks once, so this till remembers her PIN
  await page.goto(BASE);
  await page.getByRole('button', { name: /Se connecter avec un e-mail/ }).click();
  await page.getByLabel('E-mail du poste').fill('kassa@doms.test');
  await page.getByLabel('Mot de passe').fill('kassa-test-123');
  await btn('Se connecter').click();
  await btn(/^Sara/).click();
  await pin('1111');
  await page.getByText(/Tables \d+\/\d+/).waitFor();
  await page.waitForTimeout(1500); // PIN remembered in the background (PBKDF2)
  await btn('Verrouiller').click();

  // 2. internet goes down
  goOffline();
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await btn(/^Youssef/).click();
  await pin('2222');
  await page.getByText(/Première connexion de Youssef/).waitFor();
  await btn(/Changer d'employé/).click();
  await btn(/^Sara/).click();
  await pin('9999');
  await page.getByText('Code incorrect.').waitFor();
  await pin('1111');
  await page.getByText(/Tables \d+\/\d+/).waitFor();
  await page.getByText(/Hors ligne : commandes, bons et encaissements continuent/).waitFor();
  await shot('20-offline-tables');

  // 3. table 5: order, send to the kitchen, cash in
  await btn(/^5\b/).first().click();
  await btn(/Boissons Chaudes/).click();
  await btn(/^Café noir/).click(); await btn(/^Café noir/).click();
  await btn('Envoyer').click();
  await page.getByText('Bon envoyé en cuisine').last().waitFor();
  assert.match(tickets(), /\[BAR\][\s\S]*Table 5 +H\d+[\s\S]*2x Cafe noir/, 'bar bon printed offline with a local reference');
  await shot('21-offline-order');
  await btn('Encaisser').click();
  await page.getByText('Total à payer').waitFor();
  await page.getByRole('button', { name: /^Valider \d/ }).click();
  await page.getByText('Reçu provisoire').waitFor({ timeout: 30000 });
  assert.match(tickets(), /RECU PROVISOIRE[\s\S]*Paiement enregistre hors connexion/);
  await shot('22-offline-paid');
  await btn('Terminé').click();

  // 4. table 6 stays open; a line removed before sending
  await btn(/^6\b/).first().click();
  await btn(/Boissons Chaudes/).click();
  await btn(/^Café noir/).click();
  await btn('Envoyer').click();
  await page.getByText('Bon envoyé en cuisine').last().waitFor();
  await page.waitForFunction(() => true);
  assert.match(tickets(), /Table 6 +H\d+[\s\S]*1x Cafe noir/, 'table 6 bon printed');
  await btn('Retour').click();
  assert.equal(Number((await q(`select count(*) n from orders where restaurant_id = $1`, [rid]))[0].n), before, 'nothing reached the server yet');

  // 5. the page is reloaded while offline: the till comes back with its work
  await page.reload();
  await btn(/^Sara/).click();
  await pin('1111');
  await page.getByText(/Tables \d+\/\d+/).waitFor();
  await page.getByText(/en attente/).first().waitFor();
  const t6 = page.getByRole('button', { name: /^6\b/ }).first();
  assert.match(await t6.innerText(), /MAD/, 'table 6 still shows its running bill after a reload');
  await shot('23-offline-after-reload');

  // 6. internet is back: everything is sent, in order, once
  goOnline();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByText(/Ticket T-\d{4}-\d+ émis \(Table 5, payé hors ligne\)/).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Connexion : En direct' }).or(page.getByRole('button', { name: 'Connexion : En ligne' })).first().waitFor({ timeout: 20000 });
  await shot('24-back-online');

  const five = await q(`select o.*, d.doc_number from orders o join dining_tables t on t.id = o.table_id join fiscal_documents d on d.id = o.fiscal_document_id
    where o.restaurant_id = $1 and t.label = '5' order by o.created_at desc limit 1`, [rid]);
  assert.equal(five.length, 1, 'table 5 paid on the server with a fiscal ticket');
  assert.ok(five[0].ticket_number > 0);
  assert.ok(Date.now() - new Date(five[0].created_at).getTime() > 5000, 'keeps the time the order was taken offline');
  const [{ n: lines5 }] = await q(`select sum(quantity)::int n from order_lines where order_id = $1`, [five[0].id]);
  assert.equal(lines5, 2);
  const six = await openOrders('6');
  assert.equal(six.length, 1, 'table 6 open on the server');
  const [{ sent }] = await q(`select bool_and(kitchen_sent_at is not null) sent from order_lines where order_id = $1`, [six[0].id]);
  assert.equal(sent, true, 'kitchen status synced');
  assert.equal(Number((await q(`select count(*) n from orders where restaurant_id = $1`, [rid]))[0].n), before + 2, 'no duplicates');

  // 7. a second reconnect changes nothing (idempotent)
  await page.reload();
  await btn(/^Sara/).click();
  await pin('1111');
  await page.getByText(/Tables \d+\/\d+/).waitFor();
  await page.waitForTimeout(3000);
  assert.equal(Number((await q(`select count(*) n from orders where restaurant_id = $1`, [rid]))[0].n), before + 2);
  const queue = await page.evaluate(r => JSON.parse(localStorage.getItem(`pos-outbox:${r}`) || '[]').filter(x => x.state !== 'done').length, rid);
  assert.equal(queue, 0, 'queue empty');

  assert.deepEqual(errors, [], 'browser errors: ' + errors.join('\n'));
  await q(`delete from orders where id = $1`, [six[0].id]); // leave the day clean for the other tests
  console.log('OFFLINE E2E OK');
  await browser.close(); await db.end();
} catch (e) { await fail(e); }
