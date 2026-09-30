// End-to-end: "mot de passe oublié" in the back office. The local auth server
// sends no email, so the recovery link is made with the admin API (same link
// Supabase puts in the email). Local stack + admin vite on :5175.
import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';

const BASE = process.env.BASE ?? 'http://localhost:5175';
const AUTH = 'http://localhost:54331/auth/v1';
const SECRET = 'local-dev-jwt-secret-at-least-32-characters-long';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const head = b64({ alg: 'HS256', typ: 'JWT' }), body = b64({ role: 'service_role', iss: 'local', exp: 2000000000 });
const SERVICE = `${head}.${body}.${createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')}`;
const admin = (path, payload) => fetch(`${AUTH}${path}`, { method: 'POST', headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) }).then(async r => ({ status: r.status, json: await r.json() }));

const email = `reset-${Date.now().toString(36)}@test.ma`;
const created = await admin('/admin/users', { email, password: 'ancien-mot-de-passe', email_confirm: true });
assert.equal(created.status, 200, JSON.stringify(created.json));

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const OUT = process.env.OUT ?? '/tmp/reset';
try {
  // 1. ask for the link
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Mot de passe oublié ?' }).click();
  await page.getByRole('heading', { name: 'Mot de passe oublié' }).waitFor();
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Envoyer le lien' }).click();
  await page.getByText(/Si un compte existe|Erreur/).waitFor();
  await page.screenshot({ path: `${OUT}/1-forgot.png` });

  // 2. open the link from the "email"
  const link = await admin('/admin/generate_link', { type: 'recovery', email, redirect_to: `${BASE}/?reset=1` });
  assert.equal(link.status, 200, JSON.stringify(link.json));
  // the local auth server leaves /auth/v1 out of its links (Supabase includes it)
  link.json.action_link = link.json.action_link.replace(/:54331\/verify/, ':54331/auth/v1/verify');
  await page.goto(link.json.action_link);
  await page.getByRole('heading', { name: 'Nouveau mot de passe' }).waitFor();
  await page.getByText(email).waitFor();
  await page.getByLabel('Nouveau mot de passe').fill('nouveau-123');
  await page.getByLabel('Confirmer le mot de passe').fill('autre-chose');
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
  await page.getByText('Les deux mots de passe ne sont pas identiques.').waitFor();
  await page.getByLabel('Confirmer le mot de passe').fill('nouveau-123');
  await page.screenshot({ path: `${OUT}/2-new-password.png` });
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
  await page.getByText('Mot de passe modifié.').waitFor();
  assert.ok(!page.url().includes('reset'), 'address cleaned up');

  // 3. the new password works, the old one not
  const login = pw => fetch(`${AUTH}/token?grant_type=password`, { method: 'POST', headers: { apikey: SERVICE, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pw }) }).then(r => r.status);
  assert.equal(await login('nouveau-123'), 200);
  assert.notEqual(await login('ancien-mot-de-passe'), 200);

  // 4. a used link says so instead of failing silently
  await page.evaluate(() => localStorage.clear());
  await page.goto(link.json.action_link);
  await page.getByText(/a expiré ou a déjà été utilisé|ne fonctionne pas/).waitFor();
  await page.screenshot({ path: `${OUT}/3-used-link.png` });
  assert.deepEqual(errors, []);
  console.log('RESET E2E OK');
} catch (e) {
  await page.screenshot({ path: `${OUT}/99-fail.png` }).catch(() => {});
  console.error(e); process.exitCode = 1;
} finally { await browser.close(); }
