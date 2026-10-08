// Moving over from another system: a CSV or Excel export of customers, ingredients or suppliers.
// The columns are recognised by their header (French, English, Arabic), the owner can correct
// each one, sees what will be imported and what is skipped, then imports in one go.
// The menu has its own importer (ImportMenu, with photos and variants).
import { useMemo, useRef, useState } from 'react';
import { Check, Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, errorMessage, rpc } from '../lib/api';
import { decodeText, parseCsv, norm, type Cell } from '../lib/menuImport';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Modal, inputCls } from './ui';

export type ImportKind = 'customers' | 'ingredients' | 'suppliers';
type Rec = Record<string, Cell>;
interface Field { key: string; label: string; re: RegExp; required?: boolean }

const txt = (v: Cell) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').replace(/\s+/g, ' ').trim());
const num = (v: Cell) => {
  if (typeof v === 'number') return v;
  const s = txt(v).replace(/[^\d,.-]/g, '');
  if (!s) return null;
  const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const yes = (v: Cell) => /^(1|oui|yes|y|true|vrai|x|✓|نعم)$/i.test(txt(v));
/** "02/05/1990", "1990-05-02" or a date cell -> "1990-05-02" */
const dateOf = (v: Cell) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = txt(v); let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};
/** a Moroccan number as the database keeps it for suppliers: international digits (2126...) */
const intl = (v: Cell) => { let d = txt(v).replace(/\D/g, '').replace(/^00/, ''); if (/^0[5-7]\d{8}$/.test(d)) d = `212${d.slice(1)}`; return /^\d{6,15}$/.test(d) ? d : null; };
const phoneOk = (v: Cell) => { const d = txt(v).replace(/\D/g, ''); return d.length >= 6 && d.length <= 15; };

const FIELDS: Record<ImportKind, Field[]> = {
  customers: [
    { key: 'marketing_ok', label: 'Accepte les messages', re: /opt|consent|accept|marketing|newsletter|promo|موافق/ },
    { key: 'phone', label: 'Téléphone', re: /t[eé]l|phone|mobile|gsm|portable|whats|num[eé]ro|هاتف|رقم|جوال/, required: true },
    { key: 'name', label: 'Nom', re: /nom|name|client|pr[eé]nom|customer|اسم|زبون/ },
    { key: 'birthday', label: 'Anniversaire', re: /anniv|naissance|birth|dob|ميلاد/ },
    { key: 'points', label: 'Points de fidélité', re: /point|fid[eé]l|loyal|نقط|نقاط/ },
    { key: 'visits', label: 'Nombre de visites', re: /visit|passage|nb.*command|orders?\b|زيار/ },
    { key: 'spent', label: 'Total dépensé (DH)', re: /d[eé]pens|spent|total|montant|chiffre|revenue|مبلغ|مجموع/ },
    { key: 'note', label: 'Remarque', re: /note|remarq|comment|ملاحظ/ },
  ],
  ingredients: [
    { key: 'name', label: 'Nom', re: /nom|name|article|ingr[eé]d|produit|d[eé]sign|libell|item|اسم|مادة|منتج/, required: true },
    { key: 'unit', label: 'Unité d’achat', re: /unit|mesure|uom|وحدة/ },
    { key: 'price', label: 'Prix d’achat (DH)', re: /prix|price|co[uû]t|cost|achat|tarif|ثمن|سعر|تكلفة/ },
    { key: 'category', label: 'Catégorie', re: /cat[eé]g|famille|family|type|group|صنف|فئة/ },
    { key: 'supplier', label: 'Fournisseur', re: /fournis|supplier|vendor|مورد/ },
    { key: 'stock', label: 'Stock actuel', re: /stock|quantit|qty|qt[eé]|كمية|مخزون/ },
  ],
  suppliers: [
    { key: 'name', label: 'Nom', re: /nom|name|fournis|supplier|soci[eé]t|company|raison|اسم|مورد|شركة/, required: true },
    { key: 'phone', label: 'Téléphone', re: /t[eé]l|phone|mobile|gsm|whats|هاتف|رقم/ },
    { key: 'email', label: 'E-mail', re: /mail|courriel|بريد/ },
    { key: 'contact', label: 'Contact', re: /contact|interlocut|responsable|person|مسؤول/ },
    { key: 'note', label: 'Remarque', re: /note|remarq|comment|adresse|address|ملاحظ/ },
  ],
};
// i18n:values
const LABELS = [
  'Accepte les messages',
  'Anniversaire',
  'Catégorie',
  'Contact',
  'E-mail',
  'Fournisseur',
  'L',
  'Nom',
  'Nombre de visites',
  'Points de fidélité',
  'Prix d’achat (DH)',
  'Remarque',
  'Stock actuel',
  'Total dépensé (DH)',
  'Téléphone',
  'Unité d’achat',
  'cl',
  'g',
  'kg',
  'ml',
];
void LABELS;
const TITLE: Record<ImportKind, string> = { customers: 'Importer vos clients', ingredients: 'Importer vos ingrédients', suppliers: 'Importer vos fournisseurs' };
// i18n:end
const TEMPLATE: Record<ImportKind, string> = {
  customers: 'Téléphone;Nom;Anniversaire;Points de fidélité;Nombre de visites;Total dépensé;Accepte les messages;Remarque\n0661223344;Yassine;02/05/1990;120;8;640;oui;\n',
  ingredients: 'Nom;Unité;Prix;Catégorie;Fournisseur;Stock\nTomates;kg;8;Légumes;Souk Agdal;12\nLait;L;9,5;Laitier;Centrale;20\nOeufs;pièce;1,2;Laitier;;180\n',
  suppliers: 'Nom;Téléphone;E-mail;Contact;Remarque\nSouk Agdal;0661223344;;Hassan;Livre le matin\n',
};

// "kg", "L", "pièce", "botte" -> recipe unit and how many of it one purchase unit holds
function unitOf(raw: string): { base: 'g' | 'ml' | 'pc'; qty: number; label: string } {
  const u = norm(raw).replace(/\./g, '');
  if (/^(kg|kilo|kilos|kilogramme?s?|كلغ|كيلو)$/.test(u)) return { base: 'g', qty: 1000, label: 'kg' };
  if (/^(g|gr|gramme?s?|غ|غرام)$/.test(u)) return { base: 'g', qty: 1, label: 'g' };
  if (/^(l|lt|litre?s?|liter?s?|لتر)$/.test(u)) return { base: 'ml', qty: 1000, label: 'L' };
  if (/^(cl)$/.test(u)) return { base: 'ml', qty: 10, label: 'cl' };
  if (/^(ml)$/.test(u)) return { base: 'ml', qty: 1, label: 'ml' };
  if (!u) return { base: 'g', qty: 1000, label: 'kg' };
  return { base: 'pc', qty: 1, label: raw.trim().slice(0, 20) || 'pièce' };
}
const CATS: [string, RegExp][] = [['legumes', /l[eé]gum|vegetab|خضر/], ['fruits', /fruit|فواكه/], ['viande', /viande|meat|volaille|poulet|boeuf|لحم|دجاج/], ['poisson', /poisson|fish|fruits de mer|سمك/],
  ['laitier', /lait|dairy|fromage|cr[eè]me|beurre|oeuf|حليب|جبن/], ['boissons', /boisson|drink|bev|jus|soda|مشروب/], ['boulangerie', /boulang|pain|bread|patiss|خبز/], ['emballage', /emball|packag|carton|sac|تغليف/], ['epicerie', /[eé]pic|grocery|sec|conserve|بقالة/]];
const catOf = (v: string) => CATS.find(([, re]) => re.test(norm(v)))?.[0] ?? 'autre';

function detect(rows: Cell[][], fields: Field[]) {
  // the header is the first line in which at least one column is recognised
  let header = 0, best = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const hits = rows[i].filter(c => fields.some(f => f.re.test(norm(c)))).length;
    if (hits > best) { best = hits; header = i; }
    if (hits >= 2) break;
  }
  const used = new Set<string>();
  const roles = rows[header].map(c => {
    const h = norm(c);
    const f = fields.find(x => !used.has(x.key) && x.re.test(h));
    if (f) used.add(f.key);
    return f?.key ?? '';
  });
  return { header, roles };
}

export function ImportData({ kind, r, existing = [], onClose, onDone }: { kind: ImportKind; r: Restaurant; existing?: string[]; onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const fields = FIELDS[kind];
  const fileRef = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<Cell[][]>([]);
  const [header, setHeader] = useState(0);
  const [roles, setRoles] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ created: number; updated?: number; skipped: number } | null>(null);

  const read = async (f: File) => {
    setErr(''); setFileName(f.name);
    try {
      let data: Cell[][];
      if (/\.(xlsx|xlsm)$/i.test(f.name)) { const { readSheet } = await import('read-excel-file/browser'); data = (await readSheet(f)) as Cell[][]; }
      else if (/\.xls$/i.test(f.name)) { setErr(t("Ancien format Excel (.xls) : ouvrez-le dans Excel et choisissez « Enregistrer sous » > .xlsx ou CSV.")); return; }
      else data = parseCsv(decodeText(await f.arrayBuffer()));
      data = data.filter(row => row.some(c => txt(c) !== ''));
      if (data.length < 2) { setErr(t('Ce fichier est vide.')); return; }
      const d = detect(data, fields);
      setSheet(data); setHeader(d.header); setRoles(d.roles);
    } catch (e) { setErr(t('Lecture du fichier impossible : {m}', { m: errorMessage(e) })); }
  };

  // the lines as records, with what is wrong
  const recs = useMemo(() => sheet.slice(header + 1).map(row => {
    const o: Rec = {};
    roles.forEach((k, i) => { if (k && o[k] == null) o[k] = row[i]; });
    return o;
  }), [sheet, header, roles]);
  const seen = new Set(existing.map(norm));
  const checked = useMemo(() => {
    const dup = new Set<string>();
    return recs.map(o => {
      if (kind === 'customers') {
        if (!phoneOk(o.phone)) return { o, why: t('Pas de numéro') };
        return { o, why: '' };
      }
      const n = norm(o.name);
      if (!n) return { o, why: t('Pas de nom') };
      if (seen.has(n)) return { o, why: t('Existe déjà') };
      if (dup.has(n)) return { o, why: t('En double') };
      dup.add(n); return { o, why: '' };
    });
  }, [recs, kind, existing]); // eslint-disable-line react-hooks/exhaustive-deps
  const good = checked.filter(x => !x.why);
  const missing = fields.filter(f => f.required && !roles.includes(f.key));

  const run = async () => {
    setBusy(true);
    try {
      if (kind === 'customers') {
        const rows = good.map(({ o }) => ({ phone: txt(o.phone), name: txt(o.name) || null, birthday: dateOf(o.birthday), points: num(o.points) ?? 0, visits: num(o.visits) ?? 0,
          spent_cents: Math.round((num(o.spent) ?? 0) * 100), note: txt(o.note) || null, marketing_ok: o.marketing_ok != null ? yes(o.marketing_ok) : false }));
        let created = 0, updated = 0, skipped = checked.length - good.length;
        for (let i = 0; i < rows.length; i += 1000) {
          const res = await rpc<{ created: number; updated: number; skipped: number }>('import_customers', { p_restaurant_id: r.id, p_rows: rows.slice(i, i + 1000) });
          created += res.created; updated += res.updated; skipped += res.skipped;
        }
        setDone({ created, updated, skipped });
      } else if (kind === 'ingredients') {
        const rows = good.map(({ o }) => {
          const u = unitOf(txt(o.unit)), price = num(o.price), stock = num(o.stock);
          return { row: { restaurant_id: r.id, name: txt(o.name).slice(0, 80), category: catOf(txt(o.category) || txt(o.name)), base_unit: u.base, purchase_unit: u.label, purchase_qty: u.qty,
            purchase_price_cents: price != null && price >= 0 ? Math.round(price * 100) : null, price_estimated: false, supplier: txt(o.supplier).slice(0, 80) || null },
            stock: stock != null && stock >= 0 ? Math.round(stock * u.qty * 1000) / 1000 : null };
        });
        for (let i = 0; i < rows.length; i += 200) {
          const part = rows.slice(i, i + 200);
          const ids = check(await supabase.from('ingredients').insert(part.map(x => x.row)).select('id, name')) as { id: string; name: string }[];
          // the counted stock goes in through the stock ledger (start of live stock)
          for (const x of part) {
            const id = ids.find(g => g.name === x.row.name)?.id;
            if (id && x.stock != null) await rpc('stock_set', { p_ingredient_id: id, p_qty: x.stock, p_note: t('Import') });
          }
        }
        setDone({ created: rows.length, skipped: checked.length - rows.length });
      } else {
        const rows = good.map(({ o }) => ({ restaurant_id: r.id, name: txt(o.name).slice(0, 80), phone: intl(o.phone), email: txt(o.email).slice(0, 120) || null, contact: txt(o.contact).slice(0, 80) || null, note: txt(o.note).slice(0, 300) || null }));
        for (let i = 0; i < rows.length; i += 200) check(await supabase.from('suppliers').insert(rows.slice(i, i + 200)).select('id'));
        setDone({ created: rows.length, skipped: checked.length - rows.length });
      }
      onDone();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };

  const template = () => {
    const url = URL.createObjectURL(new Blob(['﻿' + TEMPLATE[kind]], { type: 'text/csv;charset=utf-8' }));
    const l = document.createElement('a'); l.href = url; l.download = `modele-${kind}.csv`; l.click(); URL.revokeObjectURL(url);
  };

  const cols = sheet[header] ?? [];
  return (
    <Modal wide title={t(TITLE[kind])} onClose={onClose}
      footer={done ? <div className="flex justify-end"><Btn tone="brand" onClick={onClose}>{t('Terminé')}</Btn></div>
        : sheet.length ? <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="me-auto text-sm text-muted">{t('{n} à importer', { n: good.length })}{checked.length - good.length ? ` · ${t('{n} ignorée(s)', { n: checked.length - good.length })}` : ''}</p>
          <Btn onClick={() => { setSheet([]); setDone(null); }}>{t('Autre fichier')}</Btn>
          <Btn tone="brand" disabled={busy || !good.length || missing.length > 0} onClick={run}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t('Importer {n} ligne(s)', { n: good.length })}</Btn>
        </div> : undefined}>
      <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls,.csv,.txt,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ''; }} />
      {done ? (
        <div className="py-6 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-ok/15 text-ok"><Check className="h-7 w-7" /></span>
          <p className="mt-4 font-display text-2xl font-semibold">{t('{n} ajouté(s)', { n: done.created })}</p>
          {!!done.updated && <p className="text-muted">{t('{n} complété(s) (déjà connus)', { n: done.updated })}</p>}
          {!!done.skipped && <p className="text-muted">{t('{n} ligne(s) ignorée(s)', { n: done.skipped })}</p>}
        </div>
      ) : !sheet.length ? (
        <div className="space-y-4">
          <p className="text-muted">{t('Exportez la liste depuis votre ancienne caisse ou votre tableur (CSV ou Excel). Les colonnes sont reconnues automatiquement, vous pourrez les corriger.')}</p>
          <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full items-center gap-4 rounded-2xl border-2 border-dashed border-line/30 p-6 text-start transition hover:border-brand">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand/15 text-brand"><FileSpreadsheet className="h-6 w-6" /></span>
            <span><span className="block font-bold">{t('Choisir un fichier CSV ou Excel')}</span><span className="block text-sm text-muted">.csv, .xlsx</span></span>
          </button>
          <button type="button" onClick={template} className="inline-flex items-center gap-2 text-sm font-semibold text-brand"><Download className="h-4 w-4" /> {t('Télécharger un modèle')}</button>
          {kind === 'customers' && <p className="rounded-xl bg-surface-2 p-3 text-xs text-muted">{t('Le numéro de téléphone sert de clé : un client déjà connu est complété, rien n’est effacé. Les points et les visites ne baissent jamais.')}</p>}
          {err && <p className="text-sm text-danger">{err}</p>}
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-muted">{fileName} · {t('{n} ligne(s)', { n: recs.length })}</p>
          <div>
            <p className="mb-2 font-semibold">{t('Colonnes')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {cols.map((c, i) => (
                <label key={i} className="flex items-center gap-2 rounded-xl bg-surface-2 p-2 ps-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={txt(c)}>{txt(c) || t('Colonne {n}', { n: i + 1 })}</span>
                  <select className={`${inputCls} !w-48 !py-1.5 text-sm`} value={roles[i] ?? ''} onChange={e => setRoles(rs => rs.map((x, j) => (j === i ? e.target.value : x === e.target.value && e.target.value ? '' : x)))}>
                    <option value="">{t('Ignorer')}</option>
                    {fields.map(f => <option key={f.key} value={f.key}>{t(f.label)}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {missing.length > 0 && <p className="mt-2 text-sm font-semibold text-danger">{t('Choisissez la colonne : {c}', { c: missing.map(f => t(f.label)).join(', ') })}</p>}
          </div>
          <div>
            <p className="mb-2 font-semibold">{t('Aperçu')}</p>
            <div className="overflow-x-auto rounded-2xl ring-1 ring-line/10">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-muted"><tr>{fields.filter(f => roles.includes(f.key)).map(f => <th key={f.key} className="px-3 py-2 text-start">{t(f.label)}</th>)}<th /></tr></thead>
                <tbody>{checked.slice(0, 8).map((x, i) => (
                  <tr key={i} className={`border-t border-line/10 ${x.why ? 'opacity-50' : ''}`}>
                    {fields.filter(f => roles.includes(f.key)).map(f => <td key={f.key} className="max-w-[12rem] truncate px-3 py-2">{txt(x.o[f.key])}</td>)}
                    <td className="px-3 py-2 text-end text-xs font-semibold text-danger">{x.why}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {checked.length > 8 && <p className="mt-1 text-xs text-muted">{t('… et {n} autre(s)', { n: checked.length - 8 })}</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}
