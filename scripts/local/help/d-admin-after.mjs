// Part 4 (after the service): sales reports, the opening inventory, and the options group (scrolled to the top).
import { page, btn, snap, state, q, done } from './lib.mjs';

const R = state.rid;
const fails = [];
const section = async (name, p, fn) => { try { await fn(); } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`); await p.keyboard.press('Escape').catch(() => {}); } };
// a few ingredients to count (the owner would import or type them)
const have = await q(`select count(*)::int n from public.ingredients where restaurant_id = $1`, [R]);
if (!have[0].n) {
  for (const [name, bu, pu, pq] of [['Lait', 'ml', 'l', 1000], ['Café en grains', 'g', 'kg', 1000], ['Oranges', 'g', 'kg', 1000], ['Croissants', 'pc', 'pièce', 1], ['Pain panini', 'pc', 'pièce', 1], ['Poulet', 'g', 'kg', 1000]])
    await q(`insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty) values ($1, $2, $3, $4, $5)`, [R, name, bu, pu, pq]);
}
await q(`begin; select set_config('app.purge','on',true); delete from public.stock_count_lines where restaurant_id = '${R}'; delete from public.stock_counts where restaurant_id = '${R}'; commit;`).catch(() => {});

const a = await page(1280, 900);
await a.goto('http://localhost:5176/');
await a.getByLabel('E-mail').fill(state.email); await a.getByLabel('Mot de passe').fill(state.pass);
await btn(a, 'Se connecter').click(); await a.waitForTimeout(2500);
const nav = async (n) => { await btn(a, n).first().click(); await a.waitForTimeout(1500); };

await section('sales', a, async () => {
  await nav('Ventes');
  await snap(a, 'sales-day', { target: btn(a, /Export comptable/, false) });
  await btn(a, 'Produits').first().click(); await a.waitForTimeout(1500);
  await snap(a, 'sales-products');
});

await section('count', a, async () => {
  await nav('Inventaire');
  await snap(a, 'stock-start', { target: btn(a, /Nouveau comptage/, false) });
  await btn(a, /Nouveau comptage/, false).click(); await a.waitForTimeout(1500);
  const ins = a.locator('input[inputmode=decimal]');
  const vals = ['6', '2.5', '8', '24'];
  for (let i = 0; i < vals.length; i++) { await ins.nth(i).fill(vals[i]); await ins.nth(i).press('Enter'); await a.waitForTimeout(300); }
  await snap(a, 'stock-count', { target: btn(a, /^Valider/, false).first() });
});

await section('modifiers', a, async () => {
  await nav('Menu');
  await btn(a, /Suppléments et formules/, false).click(); await a.waitForTimeout(800);
  await a.getByText('Boisson du petit-déjeuner').first().click(); await a.waitForTimeout(800);
  const d = a.getByRole('dialog').last();
  await d.getByRole('button', { name: /Un choix obligatoire/ }).scrollIntoViewIfNeeded();
  await d.evaluate(el => el.querySelectorAll('*').forEach(x => { if (x.scrollHeight > x.clientHeight + 5) x.scrollTop = 0; }));
  await snap(a, 'modifier-group', { clip: d, target: d.getByRole('button', { name: /Un choix obligatoire/ }) });
});

console.log('fails:', fails);
await done();
