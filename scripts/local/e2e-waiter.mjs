// End-to-end: a waiter takes an order on a phone (no printer), the till with the printer prints the kitchen bon.
// Local stack + setup-till.mjs + fake-printhost.mjs + vite on :5174.
import { chromium } from 'playwright';
import pg from 'pg';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const BASE = 'http://localhost:5174';
const OUT = process.env.OUT ?? '/tmp/profit';
const TICKETS = process.env.TICKETS ?? '/tmp/tickets.txt';
const db = new pg.Pool({ connectionString: 'postgres://postgres@localhost:54332/postgres' });
const q = async (s, p = []) => (await db.query(s, p)).rows;
const tickets = () => (existsSync(TICKETS) ? readFileSync(TICKETS, 'utf8') : '');
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
async function open(viewport, name, pin, noPrinter) {
  const ctx = await browser.newContext({ viewport, hasTouch: !!noPrinter });
  if (noPrinter) await ctx.route(/127\.0\.0\.1:8934/, r => r.abort()); // a phone has no printhost
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE);
  await p.getByRole('button', { name: /Se connecter avec un e-mail/ }).click();
  await p.getByLabel('E-mail du poste').fill('kassa@doms.test');
  await p.getByLabel('Mot de passe').fill('kassa-test-123');
  await p.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await p.getByRole('button', { name: new RegExp('^' + name) }).first().click();
  for (const d of pin) await p.getByRole('button', { name: d, exact: true }).click();
  await p.getByRole('button', { name: '✓' }).click();
  return p;
}
try {
  const before = tickets().length;
  const till = await open({ width: 1366, height: 768 }, 'Sara', '1111');
  await till.getByText(/Tables \d+\/\d+/).waitFor();
  const phone = await open({ width: 390, height: 844 }, 'Youssef', '2222', true);
  await phone.getByText('Emporter', { exact: true }).waitFor();
  await phone.screenshot({ path: `${OUT}/w1-phone-tables.png` });

  // table 6, two of the first dish
  await phone.getByRole('button', { name: /^6\b/ }).first().click();
  const first = phone.locator('ul li button').first();
  const dish = (await first.locator('span span').first().innerText()).trim();
  await first.click(); await first.click();
  await phone.screenshot({ path: `${OUT}/w2-phone-menu.png` });
  await phone.getByRole('button', { name: /Ticket ·/ }).click();
  await phone.screenshot({ path: `${OUT}/w3-phone-ticket.png` });
  await phone.getByRole('button', { name: 'Envoyer en cuisine' }).click();
  await phone.getByText('Envoyé : le bon s’imprime à la caisse').waitFor();

  // the till prints it
  for (let i = 0; i < 40 && !tickets().slice(before).includes(dish.normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 10)); i++) await till.waitForTimeout(500);
  const printed = tickets().slice(before);
  assert.match(printed, /Table 6/);
  assert.match(printed, /2x /);
  assert.match(printed, /Youssef/, 'the bon says who took the order');
  const lines = await q(`select l.print_requested_at, l.kitchen_sent_at from order_lines l join orders o on o.id = l.order_id
                          join dining_tables t on t.id = o.table_id where t.label = '6' and o.closed_at is null`);
  assert.ok(lines.length && lines.every(l => l.print_requested_at && l.kitchen_sent_at));
  await phone.waitForTimeout(1500);
  await phone.screenshot({ path: `${OUT}/w4-phone-sent.png` });
  assert.deepEqual(errors, []);
  console.log('WAITER E2E OK');
} catch (e) {
  for (const c of browser.contexts()) for (const p of c.pages()) await p.screenshot({ path: `${OUT}/99-waiter-fail-${c.pages().indexOf(p)}-${browser.contexts().indexOf(c)}.png` }).catch(() => {});
  console.error(e); process.exitCode = 1;
} finally { await browser.close(); await db.end(); }
