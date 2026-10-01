// End-to-end: split a table's bill by items at the till; the part gets its own ticket, the rest stays on the table.
import { chromium } from 'playwright';
import pg from 'pg';
import assert from 'node:assert/strict';

const OUT = process.env.OUT ?? '/tmp/profit';
const db = new pg.Pool({ connectionString: 'postgres://postgres@localhost:54332/postgres' });
const q = async (s, p = []) => (await db.query(s, p)).rows;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const btn = (n) => page.getByRole('button', typeof n === 'string' ? { name: n, exact: true } : { name: n });
const dlg = () => page.getByRole('dialog').last();
try {
  await page.goto('http://localhost:5174');
  await btn(/Se connecter avec un e-mail/).click();
  await page.getByLabel('E-mail du poste').fill('kassa@doms.test');
  await page.getByLabel('Mot de passe').fill('kassa-test-123');
  await btn('Se connecter').click();
  await btn(/^Sara/).click();
  for (const d of '1111') await btn(d).click();
  await btn('✓').click();
  await btn(/^9\b/).first().click();
  await page.getByPlaceholder('Rechercher un article').fill('Café noir');
  const cafe = btn(/Café noir/).first();
  await cafe.click(); await cafe.click(); await cafe.click();
  await page.getByPlaceholder('Rechercher un article').fill('menthe');
  await btn(/Thé à la menthe/).first().click();
  await btn('Envoyer').click();
  await page.getByText('Bon envoyé en cuisine').waitFor();

  await btn('Partager').click();
  const cafeRow = dlg().locator('li', { hasText: 'Café noir' });
  await cafeRow.getByRole('button', { name: 'Plus' }).click();
  await cafeRow.getByRole('button', { name: 'Plus' }).click();
  await page.screenshot({ path: `${OUT}/s1-split.png` });
  await dlg().getByRole('button', { name: 'Encaisser cette part' }).click();
  await dlg().getByRole('button', { name: 'Exact' }).click();
  await dlg().getByRole('button', { name: /^Valider \d/ }).click();
  await dlg().getByText('Encaissé').waitFor();
  await page.screenshot({ path: `${OUT}/s2-part-paid.png` });
  await dlg().getByRole('button', { name: 'Terminé' }).click();
  await page.getByText('Table 9').first().waitFor();

  const rows = await q(`select o.closed_at is not null closed, o.total_cents, (select string_agg(l.quantity || 'x ' || l.name, ', ' order by l.name) from order_lines l where l.order_id = o.id) what
                        from orders o join dining_tables t on t.id = o.table_id where t.label = '9' and o.status <> 'cancelled' order by o.closed_at nulls last`);
  const paid = rows.find(r => r.closed), open = rows.find(r => !r.closed);
  assert.equal(paid.what, '2x Café noir');
  assert.equal(Number(paid.total_cents), 3200);
  assert.match(open.what, /1x Café noir/);
  assert.match(open.what, /Thé à la menthe/);
  const [doc] = await q(`select count(*)::int n from fiscal_documents f join orders o on o.fiscal_document_id = f.id join dining_tables t on t.id = o.table_id where t.label = '9'`);
  assert.equal(doc.n, 1, 'the part has its own fiscal ticket');
  await page.screenshot({ path: `${OUT}/s3-rest.png` });
  assert.deepEqual(errors, []);
  console.log('SPLIT E2E OK');
} catch (e) {
  await page.screenshot({ path: `${OUT}/99-split-fail.png` }).catch(() => {});
  console.error(e); process.exitCode = 1;
} finally { await browser.close(); await db.end(); }
