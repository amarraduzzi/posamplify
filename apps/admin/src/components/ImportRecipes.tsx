// Recipes in one go, from a CSV or Excel file: one line per ingredient of a recipe.
//   Produit ; Ingrédient ; Quantité ; Unité ; Rendement ; Préparé à l'avance
// * A product found on the menu gets its recipe (quantities for ONE portion).
// * Any other product becomes a preparation (quantities for ONE batch, "Rendement" = what the batch
//   gives: "60 pc", "2 kg"). With a yield in pieces and a menu item of the same name, the menu item
//   is linked to it (1 piece sold = 1 piece out of the preparation's stock).
// * A preparation can use another one from the same file (croissant -> pâte feuilletée).
// * Unknown ingredients are created without a price (to fill in with "Saisie rapide").
// * An empty product cell repeats the product above (the usual Excel layout).
// Everything is checked and shown before anything is written; re-importing a product replaces its recipe.
import { useRef, useState } from 'react';
import { Check, Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, errorMessage } from '../lib/api';
import { decodeText, parseCsv, norm, type Cell } from '../lib/menuImport';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { BaseUnit, I18n, Ingredient, Restaurant } from '../lib/types';
import { fmtQty } from '../lib/profit';
import { Btn, Modal, inputCls } from './ui';
import { catOf, detect, num, txt, yes, type Field } from './ImportData';

const FIELDS: Field[] = [
  { key: 'ingredient', label: 'Ingrédient', re: /ingred|matiere|composant|component|مكون|مادة/, required: true },
  { key: 'yield', label: 'Rendement', re: /rendement|donne|yield|fournee|batch|production|مردود/ },
  { key: 'ahead', label: 'Préparé à l’avance', re: /avance|ahead|stock/ },
  { key: 'product', label: 'Produit', re: /produit|recette|recipe|plat|article|product|fiche|منتج|وصفة/, required: true },
  { key: 'qty', label: 'Quantité', re: /quantit|qty|qte|dose|poids|grammage|كمية/, required: true },
  { key: 'unit', label: 'Unité', re: /unit|mesure|uom|وحدة/ },
];
// i18n:values
const LABELS = ['Ingrédient', 'Rendement', 'Préparé à l’avance', 'Produit', 'Quantité', 'Unité'];
// i18n:end
void LABELS;
const TEMPLATE = 'Produit;Ingrédient;Quantité;Unité;Rendement;Préparé à l\'avance\n'
  + 'Pâte feuilletée;Farine;1;kg;2 kg;non\n;Beurre;800;g;;\n;Eau;300;ml;;\n;Sel;20;g;;\n'
  + 'Croissant;Pâte feuilletée;3;kg;60 pc;oui\n;Oeufs;4;pc;;\n'
  + 'Café crème;Café en grains;18;g;;\n;Lait;150;ml;;\n';

/** "250 g", "1,5 kg", "3 pc" -> base unit and quantity in it (null when not understood) */
function measure(qtyCell: Cell, unitCell: Cell): { base: BaseUnit; qty: number } | null {
  let q = num(qtyCell), u = norm(unitCell).replace(/\s/g, '');
  const m = txt(qtyCell).match(/^([\d.,]+)\s*([^\d\s].*)$/);
  if (m) { q = num(m[1]); if (!u) u = norm(m[2]).replace(/\s/g, ''); }
  if (q == null || !(q > 0)) return null;
  if (/^(kg|kilos?|kilogrammes?|كلغ|كيلو)$/.test(u)) return { base: 'g', qty: q * 1000 };
  if (/^(g|gr|grs|grammes?|غ|غرام)$/.test(u)) return { base: 'g', qty: q };
  if (/^(l|lt|litres?|liters?|لتر)$/.test(u)) return { base: 'ml', qty: q * 1000 };
  if (/^(dl)$/.test(u)) return { base: 'ml', qty: q * 100 };
  if (/^(cl)$/.test(u)) return { base: 'ml', qty: q * 10 };
  if (/^(ml)$/.test(u)) return { base: 'ml', qty: q };
  if (!u || /^(pc|pcs|piece|pieces|p|u|unite|unites|x|oeufs?|unit|units|portions?|حبة|قطعة)$/.test(u)) return { base: 'pc', qty: q };
  return null;
}
const PURCHASE: Record<BaseUnit, { unit: string; qty: number }> = { g: { unit: 'kg', qty: 1000 }, ml: { unit: 'L', qty: 1000 }, pc: { unit: 'pièce', qty: 1 } };

interface Line { ingredient: string; key: string; base: BaseUnit; qty: number }
interface Product {
  name: string; key: string; lines: Line[]; errors: string[];
  kind: 'dish' | 'prep'; itemId: string | null; prepId: string | null; yieldBase: BaseUnit; yieldQty: number; yieldGuessed: boolean; ahead: boolean;
  linkItem: string | null; replaces: boolean;
}
interface Plan { products: Product[]; newIngredients: { name: string; key: string; base: BaseUnit }[]; bad: number }

export function ImportRecipes({ r, ings, onClose, onDone }: { r: Restaurant; ings: Ingredient[]; onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<Cell[][]>([]);
  const [header, setHeader] = useState(0);
  const [roles, setRoles] = useState<string[]>([]);
  const [items, setItems] = useState<{ id: string; name: I18n }[]>([]);
  const [used, setUsed] = useState<{ items: Set<string>; preps: Set<string> }>({ items: new Set(), preps: new Set() });
  const [fileName, setFileName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ dishes: number; preps: number; ingredients: number; linked: number } | null>(null);

  const read = async (f: File) => {
    setErr(''); setFileName(f.name);
    try {
      let data: Cell[][];
      if (/\.(xlsx|xlsm)$/i.test(f.name)) { const { readSheet } = await import('read-excel-file/browser'); data = (await readSheet(f)) as Cell[][]; }
      else if (/\.xls$/i.test(f.name)) { setErr(t("Ancien format Excel (.xls) : ouvrez-le dans Excel et choisissez « Enregistrer sous » > .xlsx ou CSV.")); return; }
      else data = parseCsv(decodeText(await f.arrayBuffer()));
      data = data.filter(row => row.some(c => txt(c) !== ''));
      if (data.length < 2) { setErr(t('Ce fichier est vide.')); return; }
      const [mi, rl, pl] = await Promise.all([
        supabase.from('menu_items').select('id, name').eq('restaurant_id', r.id),
        supabase.from('recipe_lines').select('menu_item_id').eq('restaurant_id', r.id).not('menu_item_id', 'is', null).is('variant_id', null),
        supabase.from('preparation_lines').select('preparation_id').eq('restaurant_id', r.id),
      ]);
      setItems(check(mi) as { id: string; name: I18n }[]);
      setUsed({ items: new Set((check(rl) as { menu_item_id: string }[]).map(x => x.menu_item_id)), preps: new Set((check(pl) as { preparation_id: string }[]).map(x => x.preparation_id)) });
      const d = detect(data, FIELDS);
      setSheet(data); setHeader(d.header); setRoles(d.roles);
    } catch (e) { setErr(t('Lecture du fichier impossible : {m}', { m: errorMessage(e) })); }
  };

  const missing = FIELDS.filter(f => f.required && !roles.includes(f.key));
  const plan: Plan | null = sheet.length && !missing.length ? build() : null;

  function build(): Plan {
    const col = (k: string) => roles.indexOf(k);
    const at = (row: Cell[], k: string) => (col(k) >= 0 ? row[col(k)] : null);
    const byName = new Map(ings.map(g => [norm(g.name), g]));
    const itemByName = new Map<string, string>();
    for (const it of items) for (const v of Object.values(it.name ?? {})) if (v) itemByName.set(norm(v), it.id);

    // the lines grouped by product (an empty product cell repeats the one above)
    const products = new Map<string, Product>();
    let current: Product | null = null, bad = 0;
    for (const row of sheet.slice(header + 1)) {
      const pn = txt(at(row, 'product'));
      if (pn) {
        const key = norm(pn);
        current = products.get(key) ?? null;
        if (!current) {
          current = { name: pn.slice(0, 80), key, lines: [], errors: [], kind: 'prep', itemId: null, prepId: null, yieldBase: 'g', yieldQty: 0, yieldGuessed: false, ahead: true, linkItem: null, replaces: false };
          products.set(key, current);
        }
        const y = txt(at(row, 'yield'));
        if (y) { const m = measure(y, null); if (m) { current.yieldBase = m.base; current.yieldQty = m.qty; } else current.errors.push(t('Rendement illisible : {v}', { v: y })); }
        if (col('ahead') >= 0 && txt(at(row, 'ahead'))) current.ahead = yes(at(row, 'ahead'));
      }
      const gn = txt(at(row, 'ingredient'));
      if (!gn) continue;
      if (!current) { bad++; continue; }
      const m = measure(at(row, 'qty'), at(row, 'unit'));
      if (!m) { current.errors.push(t('Quantité ou unité illisible pour {i}', { i: gn })); continue; }
      current.lines.push({ ingredient: gn.slice(0, 80), key: norm(gn), base: m.base, qty: Math.round(m.qty * 1000) / 1000 });
    }

    // what each product is
    for (const p of products.values()) {
      const item = itemByName.get(p.key) ?? null;
      const existing = byName.get(p.key);
      if (item && !p.yieldQty) { p.kind = 'dish'; p.itemId = item; p.replaces = used.items.has(item); }
      else {
        p.kind = 'prep';
        if (existing && !existing.is_preparation) p.errors.push(t('« {n} » existe déjà comme ingrédient acheté', { n: p.name }));
        if (existing?.is_preparation) { p.prepId = existing.id; p.replaces = used.preps.has(existing.id); }
        if (!p.yieldQty) {
          // no yield given: the total weight of the batch (liquids counted as grams)
          const w = p.lines.filter(l => l.base !== 'pc').reduce((s, l) => s + l.qty, 0);
          if (w > 0) { p.yieldBase = 'g'; p.yieldQty = w; p.yieldGuessed = true; } else p.errors.push(t('Indiquez le rendement (ce que donne une fournée)'));
        }
        if (existing?.is_preparation && existing.base_unit !== p.yieldBase) p.errors.push(t('Le rendement doit rester en {u}', { u: existing.base_unit }));
        if (item && p.yieldBase === 'pc') p.linkItem = item;
      }
      if (!p.lines.length) p.errors.push(t('Aucun ingrédient'));
      const seen = new Set<string>();
      for (const l of p.lines) { if (seen.has(l.key)) p.errors.push(t('{i} apparaît deux fois', { i: l.ingredient })); seen.add(l.key); }
      if (p.lines.some(l => l.key === p.key)) p.errors.push(t('La recette se contient elle-même'));
    }

    // the ingredients: known ones (their unit must match), preparations of this file, or new
    const newIngredients = new Map<string, { name: string; key: string; base: BaseUnit }>();
    for (const p of products.values()) for (const l of p.lines) {
      const g = byName.get(l.key), sub = products.get(l.key);
      const base = g?.base_unit ?? (sub && sub.kind === 'prep' ? sub.yieldBase : newIngredients.get(l.key)?.base);
      if (base && base !== l.base && !(base === 'g' && l.base === 'ml') && !(base === 'ml' && l.base === 'g')) {
        p.errors.push(t('{i} : unité {u} alors qu’il se mesure en {b}', { i: l.ingredient, u: l.base, b: base }));
      } else if (base && base !== l.base) l.base = base;   // grams and millilitres: same number (density ~1)
      if (!g && !(sub && sub.kind === 'prep') && !newIngredients.has(l.key)) newIngredients.set(l.key, { name: l.ingredient, key: l.key, base: l.base });
      if (sub && sub.kind === 'dish') p.errors.push(t('{i} est un plat de la carte, pas un ingrédient', { i: l.ingredient }));
    }
    return { products: [...products.values()], newIngredients: [...newIngredients.values()], bad };
  }

  const okProducts = plan?.products.filter(p => !p.errors.length) ?? [];
  const run = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const id = new Map(ings.map(g => [norm(g.name), g.id]));
      // ingredients used only by products with errors are not created
      const needed = new Set(okProducts.flatMap(p => p.lines.map(l => l.key)));
      const fresh = plan.newIngredients.filter(x => needed.has(x.key));
      for (let i = 0; i < fresh.length; i += 200) {
        const made = check(await supabase.from('ingredients').insert(fresh.slice(i, i + 200).map(x => ({
          restaurant_id: r.id, name: x.name, base_unit: x.base, purchase_unit: PURCHASE[x.base].unit, purchase_qty: PURCHASE[x.base].qty,
          category: catOf(x.name), purchase_price_cents: null, price_estimated: false,
        }))).select('id, name')) as { id: string; name: string }[];
        for (const m of made) id.set(norm(m.name), m.id);
      }
      // the preparations (new or updated), then their lines
      const preps = okProducts.filter(p => p.kind === 'prep');
      for (const p of preps) {
        const row = { name: p.name, base_unit: p.yieldBase, purchase_unit: 'fournée', purchase_qty: p.yieldQty, waste_bp: 0, is_preparation: true, made_ahead: p.ahead, category: 'preparation' };
        if (p.prepId) { check(await supabase.from('ingredients').update(row).eq('id', p.prepId).select('id')); id.set(p.key, p.prepId); }
        else { const made = check(await supabase.from('ingredients').insert({ ...row, restaurant_id: r.id }).select('id').single()) as unknown as { id: string }; id.set(p.key, made.id); }
      }
      for (const p of preps) {
        const pid = id.get(p.key)!;
        check(await supabase.from('preparation_lines').delete().eq('preparation_id', pid).select('id'));
        check(await supabase.from('preparation_lines').insert(p.lines.map((l, i) => ({ restaurant_id: r.id, preparation_id: pid, ingredient_id: id.get(l.key)!, qty: l.qty, sort_order: i }))).select('id'));
      }
      // the dishes: their recipe (one portion) replaced
      const dishes = okProducts.filter(p => p.kind === 'dish');
      for (const p of dishes) {
        check(await supabase.from('recipe_lines').delete().eq('menu_item_id', p.itemId!).is('variant_id', null).is('modifier_option_id', null).select('id'));
        check(await supabase.from('recipe_lines').insert(p.lines.map((l, i) => ({ restaurant_id: r.id, menu_item_id: p.itemId, ingredient_id: id.get(l.key)!, qty: l.qty, sort_order: i }))).select('id'));
      }
      // a menu item with the name of a preparation in pieces: 1 sold = 1 piece of it
      let linked = 0;
      for (const p of preps.filter(x => x.linkItem && !used.items.has(x.linkItem))) {
        check(await supabase.from('recipe_lines').insert({ restaurant_id: r.id, menu_item_id: p.linkItem, ingredient_id: id.get(p.key)!, qty: 1, sort_order: 0 }).select('id'));
        linked++;
      }
      setDone({ dishes: dishes.length, preps: preps.length, ingredients: fresh.length, linked });
      onDone();
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      a.toast(m.includes('preparation loop') ? t('Deux préparations se contiennent l’une l’autre : corrigez le fichier.') : errorMessage(e), 'error');
    }
    setBusy(false);
  };

  const template = () => {
    const url = URL.createObjectURL(new Blob(['﻿' + TEMPLATE], { type: 'text/csv;charset=utf-8' }));
    const l = document.createElement('a'); l.href = url; l.download = 'modele-recettes.csv'; l.click(); URL.revokeObjectURL(url);
  };
  const cols = sheet[header] ?? [];
  const errs = plan?.products.filter(p => p.errors.length) ?? [];

  return (
    <Modal wide title={t('Importer vos recettes')} onClose={onClose}
      footer={done ? <div className="flex justify-end"><Btn tone="brand" onClick={onClose}>{t('Terminé')}</Btn></div>
        : sheet.length ? <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="me-auto text-sm text-muted">{t('{n} recette(s) prête(s)', { n: okProducts.length })}{errs.length ? ` · ${t('{n} à corriger', { n: errs.length })}` : ''}</p>
          <Btn onClick={() => { setSheet([]); setDone(null); }}>{t('Autre fichier')}</Btn>
          <Btn tone="brand" disabled={busy || !okProducts.length} onClick={run}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t('Importer {n} recette(s)', { n: okProducts.length })}</Btn>
        </div> : undefined}>
      <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls,.csv,.txt,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ''; }} />
      {done ? (
        <div className="py-6 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-ok/15 text-ok"><Check className="h-7 w-7" /></span>
          <p className="mt-4 font-display text-2xl font-semibold">{t('{d} plat(s) et {p} préparation(s) importés', { d: done.dishes, p: done.preps })}</p>
          {done.ingredients > 0 && <p className="text-muted">{t('{n} nouvel(s) ingrédient(s) créé(s) sans prix : remplissez-les avec « Saisie rapide ».', { n: done.ingredients })}</p>}
          {done.linked > 0 && <p className="text-muted">{t('{n} article(s) de la carte reliés à leur préparation.', { n: done.linked })}</p>}
        </div>
      ) : !sheet.length ? (
        <div className="space-y-4">
          <p className="text-muted">{t('Une ligne par ingrédient : Produit, Ingrédient, Quantité, Unité. Laissez la case Produit vide pour continuer la même recette.')}</p>
          <ul className="space-y-1.5 rounded-xl bg-surface-2 p-3 text-sm">
            <li>• {t('Un produit de la carte reçoit sa fiche technique : les quantités pour une portion.')}</li>
            <li>• {t('Tout autre produit devient une préparation : les quantités pour une fournée, et dans « Rendement » ce qu’elle donne (60 pc, 2 kg).')}</li>
            <li>• {t('Une préparation peut en utiliser une autre du même fichier. Les ingrédients inconnus sont créés, vous ajoutez leur prix ensuite.')}</li>
            <li>• {t('Rien n’est enregistré avant l’aperçu. Réimporter un produit remplace sa recette.')}</li>
          </ul>
          <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full items-center gap-4 rounded-2xl border-2 border-dashed border-line/30 p-6 text-start transition hover:border-brand">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand/15 text-brand"><FileSpreadsheet className="h-6 w-6" /></span>
            <span><span className="block font-bold">{t('Choisir un fichier CSV ou Excel')}</span><span className="block text-sm text-muted">.csv, .xlsx</span></span>
          </button>
          <button type="button" onClick={template} className="inline-flex items-center gap-2 text-sm font-semibold text-brand"><Download className="h-4 w-4" /> {t('Télécharger un modèle')}</button>
          {err && <p className="text-sm text-danger">{err}</p>}
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-muted">{fileName}</p>
          <div>
            <p className="mb-2 font-semibold">{t('Colonnes')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {cols.map((c, i) => (
                <label key={i} className="flex items-center gap-2 rounded-xl bg-surface-2 p-2 ps-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={txt(c)}>{txt(c) || t('Colonne {n}', { n: i + 1 })}</span>
                  <select className={`${inputCls} !w-48 !py-1.5 text-sm`} value={roles[i] ?? ''} onChange={e => setRoles(rs => rs.map((x, j) => (j === i ? e.target.value : x === e.target.value && e.target.value ? '' : x)))}>
                    <option value="">{t('Ignorer')}</option>
                    {FIELDS.map(f => <option key={f.key} value={f.key}>{t(f.label)}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {missing.length > 0 && <p className="mt-2 text-sm font-semibold text-danger">{t('Choisissez la colonne : {c}', { c: missing.map(f => t(f.label)).join(', ') })}</p>}
          </div>
          {plan && <>
            <div className="grid gap-3 rounded-2xl bg-brand/10 p-4 sm:grid-cols-3">
              <div><p className="text-xs text-muted">{t('Plats de la carte')}</p><p className="font-display text-2xl font-semibold tabular">{okProducts.filter(p => p.kind === 'dish').length}</p></div>
              <div><p className="text-xs text-muted">{t('Préparations')}</p><p className="font-display text-2xl font-semibold tabular">{okProducts.filter(p => p.kind === 'prep').length}</p></div>
              <div><p className="text-xs text-muted">{t('Nouveaux ingrédients (sans prix)')}</p><p className="font-display text-2xl font-semibold tabular">{plan.newIngredients.length}</p></div>
            </div>
            <div className="max-h-[22rem] overflow-y-auto rounded-2xl ring-1 ring-line/10">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-2 text-muted"><tr><th className="px-3 py-2 text-start">{t('Produit')}</th><th className="px-3 py-2 text-start">{t('Type')}</th><th className="px-3 py-2 text-end">{t('Ingrédients')}</th><th className="px-3 py-2 text-start">{t('Remarque')}</th></tr></thead>
                <tbody>{[...errs, ...okProducts].map(p => (
                  <tr key={p.key} className="border-t border-line/10 align-top">
                    <td className="px-3 py-2 font-semibold">{p.name}</td>
                    <td className="px-3 py-2">{p.kind === 'dish' ? t('Plat de la carte') : p.ahead ? t('Préparation, en stock') : t('Préparation, à la minute')}
                      {p.kind === 'prep' && p.yieldQty > 0 && <span className="block text-xs text-muted">{t('fournée de {q}', { q: fmtQty(p.yieldQty, p.yieldBase) })}{p.yieldGuessed ? ` (${t('poids total')})` : ''}</span>}</td>
                    <td className="px-3 py-2 text-end tabular">{p.lines.length}</td>
                    <td className="px-3 py-2 text-xs">
                      {p.errors.map((e, i) => <span key={i} className="block font-semibold text-danger">{e}</span>)}
                      {!p.errors.length && p.replaces && <span className="block text-warn">{t('remplace la recette actuelle')}</span>}
                      {!p.errors.length && p.linkItem && !used.items.has(p.linkItem) && <span className="block text-muted">{t('relié à l’article de la carte')}</span>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {plan.bad > 0 && <p className="text-xs text-muted">{t('{n} ligne(s) sans produit au-dessus : ignorées.', { n: plan.bad })}</p>}
            {plan.newIngredients.length > 0 && <p className="text-xs text-muted">{t('Nouveaux ingrédients')}: {plan.newIngredients.slice(0, 30).map(x => x.name).join(', ')}{plan.newIngredients.length > 30 ? '…' : ''}</p>}
          </>}
        </div>
      )}
    </Modal>
  );
}
