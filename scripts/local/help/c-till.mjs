// Part 3: a service at Café Atlas on the till (linking, orders, options, payment, Glovo, refund,
// printers, kitchen screen, waiter phone, guest QR order, end of day). Sections fail independently.
import { page, btn, snap, state, saveState, q, done } from './lib.mjs';

const R = state.rid;
const fails = [];
let recover = async () => {};
const section = async (name, p, fn) => { try { await fn(); } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`); await recover().catch(() => {}); } };
// start the day clean: no orders yet, day not closed
await q(`begin; select set_config('app.purge','on',true);
  delete from public.payments where restaurant_id = '${R}'; delete from public.order_lines where restaurant_id = '${R}';
  with t as (delete from public.fiscal_documents where restaurant_id = '${R}' returning 1) delete from public.orders where restaurant_id = '${R}';
  delete from public.day_closures where restaurant_id = '${R}'; delete from public.cash_movements where restaurant_id = '${R}'; commit;`).catch(e => console.log('reset', e.message));

// ---- a pairing code from the admin (Caisses > Relier une caisse) ----------------
const a = await page(1280, 900);
await a.goto('http://localhost:5176/');
await a.getByLabel('E-mail').fill(state.email); await a.getByLabel('Mot de passe').fill(state.pass);
await btn(a, 'Se connecter').click(); await a.waitForTimeout(2500);
async function newCode(name, shotId) {
  await btn(a, 'Caisses').first().click(); await a.waitForTimeout(1000);
  await btn(a, /Relier une caisse/, false).click();
  const d = a.getByRole('dialog').last();
  await d.getByLabel(/Nom de l'appareil/).fill(name);
  await d.getByRole('button', { name: 'Créer un code de connexion' }).click();
  const code = (await d.locator('p.font-mono').first().innerText()).trim();
  if (shotId) await snap(a, shotId, { clip: d, target: d.locator('p.font-mono').first() });
  await a.keyboard.press('Escape'); await a.waitForTimeout(400);
  return code.replace(/\s/g, '');
}
async function linkTill(p, code, who = 'Yasmine', pin = '2468') {
  await p.goto('http://localhost:5174');
  await p.getByLabel('Code de connexion').fill(code.toLowerCase());
  await btn(p, /Relier ce poste/).click();
  await btn(p, new RegExp('^' + who)).click();
  await p.waitForTimeout(300);
  for (const d of pin) await btn(p, d).click();
  await btn(p, '✓').click();
  await p.waitForTimeout(2500);
}
const t = await page(1280, 800);
await linkTill(t, await newCode('Caisse comptoir', 'devices-pair'));
// after a failed section: reload the till and unlock it again
recover = async () => {
  await t.goto('http://localhost:5174'); await t.waitForTimeout(2000);
  const y = btn(t, /^Yasmine/);
  if (await y.isVisible().catch(() => false)) {
    await y.click(); await t.waitForTimeout(300);
    for (const d of '2468') await btn(t, d).click();
    await btn(t, '✓').click(); await t.waitForTimeout(2000);
  }
};

const table = (n) => t.getByRole('button', { name: new RegExp(`^${n}(\\s|$)`) }).first();
const cat = async (n) => { await t.getByRole('button', { name: new RegExp(n) }).first().click(); await t.waitForTimeout(250); };
const item = async (n) => { await t.getByText(n, { exact: true }).first().click(); await t.waitForTimeout(300); };
const back = async () => { await btn(t, /Retour/, false).first().click().catch(() => {}); await t.waitForTimeout(800); };

await section('order', t, async () => {
  await table(3).click(); await t.waitForTimeout(800);
  await cat('Petit-déjeuner'); await item('Petit-déjeuner Atlas');
  const d = t.getByRole('dialog').last();
  await d.getByText('Nous-nous').waitFor();
  await snap(t, 'till-options', { clip: d, target: d.getByText('Nous-nous') });
  await d.getByText('Nous-nous').click();
  await d.getByRole('button', { name: /Ajouter/ }).click(); await t.waitForTimeout(400);
  await cat('Boissons froides'); await item("Jus d'orange pressé");
  await cat('Viennoiseries'); await item('Croissant'); await item('Croissant');
  await btn(t, /\+ précision/, false).nth(1).click();
  const n = t.getByRole('dialog').last();
  await n.getByRole('button', { name: 'Sans sucre' }).click();
  await snap(t, 'till-note', { clip: n, target: n.getByRole('button', { name: 'Sans sucre' }) });
  await n.getByRole('button', { name: 'OK' }).click(); await t.waitForTimeout(300);
  await snap(t, 'till-order', { target: btn(t, 'Envoyer') });
  await btn(t, 'Envoyer').click(); await t.waitForTimeout(2500);
  await snap(t, 'till-sent', { target: btn(t, 'Encaisser'), toasts: true, wait: 100 });
  await btn(t, 'Encaisser').click();
  const p = t.getByRole('dialog').last();
  await p.getByRole('button', { name: /^100/ }).click().catch(() => {});
  await snap(t, 'till-pay', { clip: p, target: p.getByRole('button', { name: /^Valider\s*\d/ }).last() });
  await p.getByRole('button', { name: /^Valider\s*\d/ }).last().click(); await t.waitForTimeout(2500);
  await snap(t, 'till-paid', { clip: t.getByRole('dialog').last(), target: t.getByRole('button', { name: 'Terminé' }) });
  await btn(t, 'Terminé').click(); await t.waitForTimeout(800);
});

await section('discount-split', t, async () => {
  await table(5).click(); await t.waitForTimeout(800);
  await cat('Snacks'); await item('Burger Atlas'); await item('Panini poulet');
  await cat('Boissons froides'); await item('Soda'); await item('Soda');
  await btn(t, 'Envoyer').click(); await t.waitForTimeout(2500);
  await btn(t, /Remise/, false).first().click();
  const d = t.getByRole('dialog').last();
  await d.getByRole('button', { name: '10 %' }).click().catch(() => {});
  await snap(t, 'till-discount', { clip: d });
  await t.keyboard.press('Escape'); await t.waitForTimeout(400);
  await btn(t, /Partager/, false).first().click();
  const s = t.getByRole('dialog').last();
  await snap(t, 'till-split', { clip: s, target: s.getByRole('button', { name: /En parts égales/ }) });
  await t.keyboard.press('Escape'); await t.waitForTimeout(400);
  await back();
  await table(2).click(); await t.waitForTimeout(800);
  await cat('Boissons chaudes'); await item('Café noir'); await item('Café noir');
  await btn(t, 'Envoyer').click(); await t.waitForTimeout(2000);
  await back();
  await snap(t, 'till-tables', { target: table(5) });
});

await section('glovo', t, async () => {
  await btn(t, 'Emporter').first().click(); await t.waitForTimeout(800);
  await snap(t, 'till-takeaway', { target: t.getByRole('button', { name: 'À emporter' }).first() });
  await t.getByRole('button', { name: 'Glovo', exact: true }).first().click();
  await t.getByPlaceholder('Réf. Glovo').fill('GLV-4821');
  await cat('Snacks'); await item('Tacos poulet'); await item('Frites');
  await snap(t, 'till-glovo', { target: t.getByRole('button', { name: 'Glovo', exact: true }).first() });
  await btn(t, 'Encaisser').click();
  const p = t.getByRole('dialog').last();
  await p.getByRole('button', { name: 'Carte' }).click();
  await snap(t, 'till-pay-card', { clip: p, target: p.getByRole('button', { name: 'Carte' }) });
  await p.getByRole('button', { name: /^Valider\s*\d/ }).last().click(); await t.waitForTimeout(2500);
  await btn(t, 'Terminé').click(); await t.waitForTimeout(800);
});

await section('history', t, async () => {
  await btn(t, /Historique/, false).first().click(); await t.waitForTimeout(1500);
  await snap(t, 'till-history-list', { target: t.locator('tbody tr').first() });
  await t.locator('tbody tr').first().click(); await t.waitForTimeout(800);
  const m = t.getByRole('dialog').last();
  await snap(t, 'till-history', { clip: m, target: m.getByRole('button', { name: /Avoir/ }) });
  await m.getByRole('button', { name: /Avoir/ }).click(); await t.waitForTimeout(600);
  const d = t.getByRole('dialog').last();
  await snap(t, 'till-refund', { clip: d, target: d.getByText(/Motif/).first() });
  await t.keyboard.press('Escape'); await t.waitForTimeout(400);
});

await section('commandes', t, async () => {
  await btn(t, /^Commandes/, false).first().click(); await t.waitForTimeout(1200);
  await snap(t, 'till-orders');
});

await section('printers', t, async () => {
  await t.getByRole('button', { name: 'Réglages', exact: true }).click(); await t.waitForTimeout(1500);
  const d = t.getByRole('dialog').last();
  await snap(t, 'till-printers', { clip: d, target: d.getByRole('button', { name: 'Test' }).first() });
  await t.keyboard.press('Escape'); await t.waitForTimeout(400);
});

await section('reports', t, async () => {
  await btn(t, /Caisse & rapports/, false).first().click(); await t.waitForTimeout(1800);
  await snap(t, 'till-reports', { target: btn(t, /Clôturer la journée/, false) });
  await btn(t, /Fond de caisse/, false).first().click();
  const d = t.getByRole('dialog').last();
  await d.locator('input').first().fill('500');
  await snap(t, 'till-float', { clip: d });
  await d.getByRole('button', { name: 'Enregistrer' }).click(); await t.waitForTimeout(800);
});

// ---- guest QR order at table 7 (phone) ----------------------------------------
await section('guest', t, async () => {
  const tok = (await q(`select qr_token from public.dining_tables where restaurant_id = $1 and label = '7'`, [R]))[0].qr_token;
  const g = await page(390, 844, 2);
  await g.goto(`http://localhost:5173/${state.slug}/t/${tok}`); await g.waitForTimeout(2500);
  await snap(g, 'guest-menu');
  await g.getByText('Cappuccino', { exact: true }).first().click(); await g.waitForTimeout(600);
  await snap(g, 'guest-item');
  await g.getByRole('button', { name: /^Ajouter/ }).last().click(); await g.waitForTimeout(800);
  await snap(g, 'guest-bar');
  await g.getByRole('button', { name: /panier|commande|voir/i }).last().click().catch(() => {}); await g.waitForTimeout(800);
  await snap(g, 'guest-cart');
  await g.getByRole('button', { name: /Commander|Envoyer|Valider/ }).last().click().catch(() => {}); await g.waitForTimeout(2500);
  await snap(g, 'guest-sent');
  await t.waitForTimeout(3000);
  await btn(t, /^Commandes/, false).first().click(); await t.waitForTimeout(1500);
  await snap(t, 'till-qr', { target: btn(t, 'Accepter').first() });
  await btn(t, 'Accepter').first().click().catch(() => {}); await t.waitForTimeout(1500);
});

// ---- the waiter's phone ----------------------------------------------------------
await section('phone', t, async () => {
  const ph = await page(390, 844, 2);
  await linkTill(ph, await newCode('Téléphone Karim'), 'Karim', '1357');
  await snap(ph, 'phone-tables');
  await ph.getByRole('button', { name: /^4(\s|$)/ }).first().click(); await ph.waitForTimeout(800);
  await ph.getByText('Cappuccino', { exact: true }).first().click().catch(() => {});
  await ph.getByText('Croissant', { exact: true }).first().click().catch(() => {});
  await snap(ph, 'phone-order', { target: ph.getByRole('button', { name: 'Envoyer' }).last() });
});

// ---- kitchen screen --------------------------------------------------------------
await section('kitchen', t, async () => {
  const k = await page(1280, 800);
  await k.goto('http://localhost:5174');
  await k.getByLabel('Code de connexion').fill((await newCode('Écran cuisine')).toLowerCase());
  await btn(k, /Relier ce poste/).click(); await k.waitForTimeout(1500);
  await k.getByText('Écran cuisine').first().click(); await k.waitForTimeout(800);
  await snap(k, 'kitchen-setup');
  await k.getByRole('button', { name: /Ouvrir l’écran cuisine/ }).click(); await k.waitForTimeout(2500);
  await snap(k, 'kitchen', { target: k.getByRole('button', { name: 'Prêt' }).first() });
});

// ---- end of day: settle what is open, then the Z ----------------------------------
await section('z', t, async () => {
  for (const n of [5, 2, 7, 4]) {
    await btn(t, /^Tables/, false).first().click(); await t.waitForTimeout(800);
    const tb = table(n);
    await tb.click(); await t.waitForTimeout(1000);
    const enc = btn(t, 'Encaisser');
    if (await enc.isEnabled().catch(() => false)) {
      await enc.click();
      const p = t.getByRole('dialog').last();
      await p.getByRole('button', { name: /^Exact/ }).click().catch(() => {});
      await p.getByRole('button', { name: /^Valider\s*\d/ }).last().click(); await t.waitForTimeout(2500);
      await btn(t, 'Terminé').click().catch(() => {}); await t.waitForTimeout(800);
    } else await back();
  }
  await btn(t, /Caisse & rapports/, false).first().click(); await t.waitForTimeout(1800);
  await btn(t, /Clôturer la journée/, false).click(); await t.waitForTimeout(800);
  const d = t.getByRole('dialog').last();
  await snap(t, 'till-z-count', { clip: d });
  // count exactly what is expected, so the example shows a balanced till
  const exp = (await q(`select coalesce(sum(case when kind = 'float' then amount_cents else -amount_cents end), 0)
      + (select coalesce(sum(amount_cents + coalesce(tip_cents, 0)), 0) from public.payments where restaurant_id = $1 and method = 'cash') as c
      from public.cash_movements where restaurant_id = $1`, [R]))[0].c;
  await d.locator('input').first().fill(String(Number(exp) / 100)).catch(() => {});
  await d.getByRole('button', { name: 'Continuer' }).click(); await t.waitForTimeout(600);
  await d.getByRole('button', { name: /Yasmine/ }).click().catch(() => {});
  for (const x of '2468') await d.getByRole('button', { name: x, exact: true }).click().catch(() => {});
  await d.getByRole('button', { name: /✓|Valider|Clôturer/ }).last().click().catch(() => {}); await t.waitForTimeout(2500);
  await snap(t, 'till-z-done', { clip: t.getByRole('dialog').last() });
});

console.log('fails:', fails);
await a.close();
await done();
