// Menu import: turns an Excel/CSV export of another till, or the AI reading of a
// paper menu, into draft rows the owner checks before import_menu() saves them.
// Pure functions (no React, no network), so they can be tested on messy files.

import type { I18n } from '@resto/shared';

export type Cell = string | number | boolean | Date | null | undefined;
export type Role = 'ignore' | 'category' | 'name' | 'name_ar' | 'name_en' | 'price' | 'variant' | 'description';
export const ROLES: Role[] = ['ignore', 'category', 'name', 'name_ar', 'name_en', 'price', 'variant', 'description'];

export interface DraftVariant { name: I18n; price: number | null }
export interface DraftRow {
  id: string;
  category: I18n;
  icon?: string;
  station?: 'kitchen' | 'bar';
  name: I18n;
  description: I18n;
  price: number | null;          // centimes, null = unknown
  variants: DraftVariant[];
  include: boolean;
  target?: string;               // existing category id chosen by the owner
  orig?: I18n;                   // category as read, to go back to "new category"
}
export interface Mapping { headerRow: number; roles: Role[]; priceNames: string[] }

// ---------------------------------------------------------------------------
// reading files
// ---------------------------------------------------------------------------

/** CSV text from bytes: UTF-8, or Windows-1252 (French Excel "CSV") when UTF-8 fails. */
export function decodeText(buf: ArrayBuffer): string {
  let s: string;
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { s = new TextDecoder('windows-1252').decode(buf); }
  return s.replace(/^﻿/, '');
}

/** CSV with ; , or tab, quotes and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const head = text.split(/\r?\n/, 20).join('\n'); // the first lines may be titles without separators
  const count = (c: string) => head.split(c).length - 1;
  const sep = [';', '\t', ','].reduce((b, c) => (count(c) > count(b) ? c : b), ',');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ---------------------------------------------------------------------------
// understanding columns
// ---------------------------------------------------------------------------

export const norm = (s: unknown) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ').trim();
const AR_RE = /[\u0600-\u06ff]/;
const isArabic = (s: unknown) => { const t = String(s ?? ''); return AR_RE.test(t) && (t.match(/[\u0600-\u06ff]/g)!.length > t.replace(/\s/g, '').length / 2); };

// header words (already normalised: no accents, lower case)
const H: [Role, RegExp][] = [
  ['ignore', /\b(achat|cout|cost|revient|marge|margin|stock|qte|quantite|qty|quantity|tva|vat|taxe|code|ref|reference|sku|ean|barcode|id|image|photo|actif|active|statut|status)\b|التكلفة|الكمية|المخزون/],
  ['category', /\b(categorie|categories|category|famille|family|rayon|groupe|group|section|rubrique|type)\b|الفئة|القسم|الصنف|فئة/],
  ['name_ar', /\b(arabe|arabic)\b|^ar$|العربية|بالعربية/],
  ['name_en', /\b(anglais|english)\b|^en$/],
  ['description', /\b(description|desc|details|detail|ingredients|composition)\b|الوصف|المكونات/],
  ['variant', /\b(taille|format|variante|variant|size|option|declinaison|contenance)\b|الحجم/],
  ['price', /\b(prix|price|pu|tarif|ttc|pvp|montant|dh|mad|dhs)\b|السعر|الثمن|ثمن/],
  ['name', /\b(nom|name|article|articles|produit|produits|product|designation|libelle|intitule|item|plat|plats|dish)\b|الاسم|المنتج|اسم/],
];

const priceOf = (v: Cell): number | null => {
  if (v == null || v === '' || typeof v === 'boolean' || v instanceof Date) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
  let s = v.replace(/\s| | /g, '').replace(/(dhs?|mad|درهم|د\.م\.?)/gi, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  // "1.200,50" / "1,200.50" / "12,5" / "12.50"
  const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (lastSep >= 0 && s.length - lastSep - 1 <= 2) s = s.slice(0, lastSep).replace(/[.,]/g, '') + '.' + s.slice(lastSep + 1);
  else s = s.replace(/[.,]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
export const parsePrice = priceOf;

const text = (v: Cell) => (v instanceof Date ? '' : String(v ?? '').replace(/\s+/g, ' ').trim());

/** Finds the header row and a role per column. Works without a header too. */
export function detect(rows: Cell[][]): Mapping {
  const width = Math.max(0, ...rows.slice(0, 50).map(r => r.length));
  let headerRow = -1, best = 0;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    if (rows[i].some(c => priceOf(c) != null)) continue; // a header holds no amounts
    const hits = rows[i].filter(c => typeof c === 'string' && H.some(([role, re]) => role !== 'ignore' && re.test(norm(c)))).length;
    if (hits > best) { best = hits; headerRow = i; }
  }
  const roles: Role[] = Array(width).fill('ignore');
  const priceNames: string[] = Array(width).fill('');
  const skip = new Set<number>(); // columns the header says to leave out (cost, stock, VAT...)
  const body = rows.slice(headerRow + 1).filter(r => r.some(c => text(c) !== ''));

  if (headerRow >= 0 && best >= 1) {
    rows[headerRow].forEach((c, i) => {
      const h = norm(c);
      if (!h) return;
      const hit = H.find(([, re]) => re.test(h));
      if (hit) roles[i] = hit[0];
      if (hit?.[0] === 'ignore') skip.add(i);
      if (roles[i] === 'price') priceNames[i] = text(c).replace(/\b(prix|price|tarif|pu|ttc|dhs?|mad)\b/gi, '').replace(/[()\-:]/g, ' ').replace(/\s+/g, ' ').trim();
    });
    // "S", "M", "L", "Petit", "Grand"... as headers next to a name: price columns per size
    rows[headerRow].forEach((c, i) => {
      if (roles[i] !== 'ignore' || skip.has(i) || !text(c)) return;
      const numeric = body.filter(r => priceOf(r[i]) != null).length;
      if (numeric >= Math.max(1, body.length * 0.5) && text(c).length <= 20) { roles[i] = 'price'; priceNames[i] = text(c); }
    });
  }
  // columns the header did not name: guess from the content
  const col = (i: number) => body.map(r => r[i]).filter(c => text(c) !== '');
  if (!roles.includes('price')) {
    let bi = -1, bs = 0;
    for (let i = 0; i < width; i++) {
      if (roles[i] !== 'ignore' || skip.has(i)) continue;
      const v = col(i); const s = v.filter(c => priceOf(c) != null).length / (v.length || 1);
      if (s > 0.7 && s > bs) { bs = s; bi = i; }
    }
    if (bi >= 0) roles[bi] = 'price';
  }
  if (!roles.includes('name')) {
    let bi = -1, bs = 0;
    for (let i = 0; i < width; i++) {
      if (roles[i] !== 'ignore' || skip.has(i)) continue;
      const v = col(i).map(text);
      const uniq = new Set(v).size;
      const s = v.filter(x => priceOf(x) == null && !isArabic(x)).length * (uniq / (v.length || 1));
      if (s > bs) { bs = s; bi = i; }
    }
    if (bi >= 0) roles[bi] = 'name';
  }
  if (!roles.includes('name_ar')) {
    for (let i = 0; i < width; i++) {
      if (roles[i] !== 'ignore' || skip.has(i)) continue;
      const v = col(i); if (v.length && v.filter(isArabic).length / v.length > 0.6) { roles[i] = 'name_ar'; break; }
    }
  }
  // a "name" column that is Arabic while there is no other name: it is the Arabic name
  const ni = roles.indexOf('name');
  if (ni >= 0 && !roles.includes('name_ar')) {
    const v = col(ni); if (v.length && v.filter(isArabic).length / v.length > 0.6) roles[ni] = 'name_ar';
  }
  // only one price column: no variant name needed
  if (roles.filter(r => r === 'price').length === 1) priceNames.fill('');
  return { headerRow, roles, priceNames };
}

// ---------------------------------------------------------------------------
// building draft rows
// ---------------------------------------------------------------------------

let seq = 0;
const nid = () => `d${++seq}`;

/** Guesses an emoji and a preparation station from a category name. */
export function guessCategory(name: string): { icon: string; station: 'kitchen' | 'bar' } {
  const n = norm(name);
  const G: [RegExp, string, 'kitchen' | 'bar'][] = [
    [/cafe|coffee|espresso|قهوة/, '☕', 'bar'], [/the\b|thes|infusion|tea|أتاي|شاي/, '🫖', 'bar'],
    [/jus|juice|smoothie|milkshake|عصير/, '🍹', 'bar'], [/cocktail|mocktail|mojito/, '🍹', 'bar'],
    [/boisson|drink|soda|eau|water|froid|chaud|مشروب/, '🥤', 'bar'],
    [/pizza|بيتزا/, '🍕', 'kitchen'], [/burger|برغر/, '🍔', 'kitchen'], [/tacos|wrap/, '🌮', 'kitchen'],
    [/sandwich|panini|ساندويتش/, '🥪', 'kitchen'], [/salade|salad|سلطة/, '🥗', 'kitchen'],
    [/petit dej|petit-dej|breakfast|فطور/, '🍳', 'kitchen'], [/crepe|pancake|gaufre|waffle/, '🥞', 'kitchen'],
    [/dessert|gateau|patisserie|cake|sucre|حلويات/, '🍰', 'kitchen'], [/glace|ice cream|gelato|مثلجات/, '🍦', 'kitchen'],
    [/pate|pasta|spaghetti|معكرونة/, '🍝', 'kitchen'], [/tajine|tagine|طاجين/, '🍲', 'kitchen'], [/couscous|كسكس/, '🥘', 'kitchen'],
    [/poulet|chicken|دجاج/, '🍗', 'kitchen'], [/poisson|fish|fruits de mer|seafood|سمك/, '🐟', 'kitchen'],
    [/viennoiserie|croissant/, '🥐', 'bar'], [/frite|fries|snack/, '🍟', 'kitchen'],
  ];
  const hit = G.find(([re]) => re.test(n) || re.test(name));
  return hit ? { icon: hit[1], station: hit[2] } : { icon: '', station: 'kitchen' };
}

/**
 * Rows of a spreadsheet -> draft rows.
 * - lines with only a text in the first cell and no price are category titles
 * - the same dish on several lines with a size column becomes one dish with variants
 * - several price columns (S / M / L) become variants
 */
export function buildRows(rows: Cell[][], m: Mapping, latin: string, fallbackCategory: string): DraftRow[] {
  const idx = (r: Role) => m.roles.map((x, i) => (x === r ? i : -1)).filter(i => i >= 0);
  const [ci] = idx('category'), [ni] = idx('name'), [ai] = idx('name_ar'), [ei] = idx('name_en'), [di] = idx('description'), [vi] = idx('variant');
  const pis = idx('price');
  const primary = latin; // language key for texts that are not Arabic script
  const out: DraftRow[] = [];
  const byKey = new Map<string, DraftRow>();
  let section = '';

  for (const r of rows.slice(m.headerRow + 1)) {
    const cells = r.map(text);
    if (!cells.some(Boolean)) continue;
    const name = ni != null ? cells[ni] : '';
    const nameAr = ai != null ? cells[ai] : '';
    const prices = pis.map(i => priceOf(r[i]));
    const hasPrice = prices.some(p => p != null);
    // category title line: one text, no price
    if (!hasPrice && ci == null && cells.filter(Boolean).length === 1 && (name || nameAr)) {
      const only = cells.find(Boolean)!;
      if (priceOf(only) == null) { section = only; continue; }
    }
    if (!name && !nameAr) continue;
    const catText = (ci != null && cells[ci]) || section || fallbackCategory;
    const nm: I18n = {};
    if (name) nm[isArabic(name) ? 'ar' : primary] = name;
    if (nameAr) nm.ar = nameAr;
    if (ei != null && cells[ei]) nm.en = cells[ei];
    const cat: I18n = isArabic(catText) ? { ar: catText } : { [primary]: catText };

    const variantsHere: DraftVariant[] = [];
    let price: number | null = null;
    if (pis.length > 1) {
      pis.forEach((pi, k) => { if (prices[k] != null) variantsHere.push({ name: { [primary]: m.priceNames[pi] || String(k + 1) }, price: prices[k] }); });
    } else price = prices[0] ?? null;
    if (vi != null && cells[vi]) { variantsHere.push({ name: isArabic(cells[vi]) ? { ar: cells[vi] } : { [primary]: cells[vi] }, price }); price = null; }

    const key = norm(catText) + '|' + norm(name || nameAr);
    const prev = byKey.get(key);
    if (prev && variantsHere.length) {
      for (const v of variantsHere) if (!prev.variants.some(x => norm(Object.values(x.name)[0]) === norm(Object.values(v.name)[0]))) prev.variants.push(v);
      continue;
    }
    const g = guessCategory(catText);
    const row: DraftRow = {
      id: nid(), category: cat, icon: g.icon, station: g.station, name: nm,
      description: di != null && cells[di] ? { [isArabic(cells[di]) ? 'ar' : primary]: cells[di] } : {},
      price, variants: variantsHere, include: true,
    };
    byKey.set(key, row);
    out.push(row);
  }
  // single sizes collected over several lines stay variants only when there are 2+
  for (const row of out) if (row.variants.length === 1 && row.price == null) { row.price = row.variants[0].price; row.variants = []; }
  return out;
}

/** The AI reading of a paper menu -> draft rows (keeps only the restaurant's languages). */
export function fromAi(categories: unknown[], langs: string[]): DraftRow[] {
  const keep = (v: unknown): I18n => {
    const o: I18n = {};
    if (v && typeof v === 'object') for (const [k, s] of Object.entries(v as Record<string, unknown>)) {
      if (langs.includes(k) && typeof s === 'string' && s.trim()) o[k] = s.trim().slice(0, 80);
    }
    return o;
  };
  const cents = (p: unknown) => (typeof p === 'number' && Number.isFinite(p) && p >= 0 ? Math.round(p * 100) : null);
  const out: DraftRow[] = [];
  for (const c of categories as { name?: unknown; icon?: string; station?: string; items?: unknown[] }[]) {
    const cat = keep(c?.name);
    if (!Object.keys(cat).length || !Array.isArray(c.items)) continue;
    for (const it of c.items as { name?: unknown; description?: string; price?: unknown; variants?: { name?: unknown; price?: unknown }[] }[]) {
      const name = keep(it?.name);
      if (!Object.keys(name).length) continue;
      const variants = (Array.isArray(it.variants) ? it.variants : [])
        .map(v => ({ name: keep(v?.name), price: cents(v?.price) })).filter(v => Object.keys(v.name).length);
      const desc = typeof it.description === 'string' && it.description.trim() ? it.description.trim().slice(0, 500) : '';
      out.push({
        id: nid(), category: cat, icon: typeof c.icon === 'string' ? [...c.icon].slice(0, 2).join('') : undefined,
        station: c.station === 'bar' ? 'bar' : 'kitchen', name,
        description: desc ? { [isArabic(desc) ? 'ar' : langs.find(l => l !== 'ar') ?? 'fr']: desc } : {},
        price: variants.length >= 2 ? null : variants[0]?.price ?? cents(it.price),
        variants: variants.length >= 2 ? variants : [], include: true,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// checks and the payload for import_menu()
// ---------------------------------------------------------------------------

/** The existing category that most looks like this one ("Beef Burgers" -> "Burgers"), or null. */
export function suggestCategory<C extends { id: string; name: I18n }>(cat: I18n, existing: C[]): C | null {
  const words = (v: I18n) => new Set(Object.values(v).flatMap(x => norm(x).split(' ')).filter(w => w.length >= 3).map(w => w.replace(/s$/, '')));
  const mine = words(cat);
  let best: C | null = null, score = 0;
  for (const c of existing) {
    const theirs = words(c.name);
    const common = [...mine].filter(w => theirs.has(w)).length;
    const sc = common / Math.max(1, theirs.size);
    if (common && sc > score) { score = sc; best = c; }
  }
  return best;
}

export type Issue = 'no_name' | 'no_price' | 'zero_price' | 'duplicate' | 'exists' | 'too_long';

export function issuesOf(rows: DraftRow[], existing: { category: I18n; name: I18n }[]): Map<string, Issue[]> {
  const same = (a: I18n, b: I18n) => Object.values(a).some(x => Object.values(b).some(y => norm(x) && norm(x) === norm(y)));
  const seen: DraftRow[] = [];
  const res = new Map<string, Issue[]>();
  for (const r of rows) {
    const is: Issue[] = [];
    if (!Object.values(r.name).some(s => s.trim())) is.push('no_name');
    if (Object.values(r.name).some(s => s.length > 80) || Object.values(r.category).some(s => s.length > 60)) is.push('too_long');
    if (r.variants.length ? r.variants.some(v => v.price == null) : r.price == null) is.push('no_price');
    else if (!r.variants.length && r.price === 0) is.push('zero_price');
    if (r.include && seen.some(s => same(s.category, r.category) && same(s.name, r.name))) is.push('duplicate');
    if (existing.some(e => same(e.category, r.category) && same(e.name, r.name))) is.push('exists');
    if (r.include) seen.push(r);
    res.set(r.id, is);
  }
  return res;
}
/** Issues that stop the import (the rest are warnings). */
export const BLOCKING: Issue[] = ['no_name', 'no_price', 'too_long'];

export function payload(rows: DraftRow[]) {
  return rows.filter(r => r.include).map(r => ({
    category: r.category, category_icon: r.icon || null, category_station: r.station ?? 'kitchen',
    name: r.name, description: r.description,
    price_cents: r.variants.length ? null : r.price,
    variants: r.variants.map(v => ({ name: v.name, price_cents: v.price })),
  }));
}

/** An empty model file owners can fill in (semicolon CSV opens right in French Excel). */
export function templateCsv(withArabic: boolean): string {
  const head = ['Catégorie', 'Article', ...(withArabic ? ['Nom arabe'] : []), 'Prix', 'Taille', 'Description'];
  const ex = [
    ['Boissons chaudes', 'Café noir', ...(withArabic ? ['قهوة سوداء'] : []), '12', '', ''],
    ['Boissons chaudes', 'Thé à la menthe', ...(withArabic ? ['أتاي بالنعناع'] : []), '10', 'Verre', ''],
    ['Boissons chaudes', 'Thé à la menthe', ...(withArabic ? ['أتاي بالنعناع'] : []), '25', 'Théière', ''],
    ['Plats', 'Tajine poulet citron', ...(withArabic ? ['طاجين الدجاج بالحامض'] : []), '75', '', 'Olives, citron confit'],
  ];
  return '﻿' + [head, ...ex].map(r => r.map(c => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\r\n');
}
