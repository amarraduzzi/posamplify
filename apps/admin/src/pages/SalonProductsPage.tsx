// Produits et stock du salon: the products for sale (sold at the till, on the ticket) and the ones
// for the salon's own use (colour, oxidant, foil). Each stock change is a move with its reason: a
// delivery, a correction after counting, a sale at the till. Below the alert level it shows in red.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardCheck, History, Package, PackagePlus, Pencil, Plus, Scale, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, rpc } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, Modal, Toggle, inputCls } from '../components/ui';

export interface Product {
  id: string; name: string; category: string | null; kind: 'retail' | 'usage'; price_cents: number | null; cost_cents: number | null;
  stock: number; min_stock: number | null; active: boolean; sort_order: number;
}
interface Move { id: string; kind: string; qty: number; unit_cost_cents: number | null; note: string | null; created_at: string }
const mad = (c: number) => `${(c / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} DH`;
const cents = (s: string) => { const n = Number(s.replace(',', '.').replace(/\s/g, '')); return s.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };
const low = (p: Product) => p.min_stock != null && p.stock <= p.min_stock;
// i18n:values
const MOVE: Record<string, string> = { sale: 'Vente', cancel: 'Ticket annulé', delivery: 'Réception', correction: 'Correction', start: 'Stock de départ', count: 'Inventaire' };
// i18n:end

export function SalonProductsPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [list, setList] = useState<Product[] | null>(null);
  const [tab, setTab] = useState<'retail' | 'usage' | 'low' | 'gaps'>('retail');
  const [counting, setCounting] = useState(false);
  const [edit, setEdit] = useState<Product | 'new' | null>(null);
  const [move, setMove] = useState<{ p: Product; kind: 'delivery' | 'correction' } | null>(null);
  const load = useCallback(async () => {
    try { setList(check(await supabase.from('agenda_products').select('*').eq('restaurant_id', r.id).order('sort_order').order('name')) as Product[]); } catch (e) { a.fail(e); setList([]); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);
  const active = (list ?? []).filter(p => p.active);
  const shown = tab === 'gaps' ? [] : (list ?? []).filter(p => (tab === 'low' ? p.active && low(p) : p.kind === tab));
  const value = active.reduce((s, p) => s + Math.max(0, p.stock) * (p.cost_cents ?? 0), 0);
  const lows = active.filter(low).length;
  const groups = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of shown) { const k = p.category || t('Sans catégorie'); m.set(k, [...(m.get(k) ?? []), p]); }
    return [...m.entries()];
  }, [shown]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold">{t('Produits et stock')}</h1>
        <div className="flex gap-2">
          <Btn disabled={!active.length} onClick={() => setCounting(true)}><ClipboardCheck className="h-4 w-4" /> {t('Inventaire')}</Btn>
          <Btn tone="brand" onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> {t('Nouveau produit')}</Btn>
        </div>
      </div>
      <p className="text-sm text-muted">{t('Les produits à vendre apparaissent à la caisse. Chaque vente retire le produit du stock, chaque réception l’ajoute.')}</p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div className="card rounded-3xl p-4"><p className="text-sm text-muted">{t('Valeur du stock (prix d’achat)')}</p><p className="mt-1 font-display text-2xl font-semibold tabular">{mad(value)}</p></div>
        <button onClick={() => setTab('low')} className={`card rounded-3xl p-4 text-start ${lows ? 'ring-2 ring-red-500/40' : ''}`}><p className="text-sm text-muted">{t('Stock bas')}</p>
          <p className={`mt-1 font-display text-2xl font-semibold tabular ${lows ? 'text-red-600' : ''}`}>{lows}</p></button>
        <div className="card col-span-2 rounded-3xl p-4 lg:col-span-1"><p className="text-sm text-muted">{t('Produits actifs')}</p><p className="mt-1 font-display text-2xl font-semibold tabular">{active.length}</p></div>
      </div>

      <div className="flex gap-1 rounded-xl bg-surface-2 p-1 sm:w-fit">
        {([['retail', t('À vendre')], ['usage', t('Usage salon')], ['low', t('Stock bas')], ['gaps', t('Écarts')]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold sm:flex-none ${tab === k ? 'bg-surface shadow-sm' : 'text-muted'}`}>{l}</button>
        ))}
      </div>

      {tab === 'gaps' ? <Gaps r={r} /> : list === null ? <p className="text-muted">{t('Chargement…')}</p> : !shown.length ? (
        <Card><p className="py-6 text-center text-muted">{tab === 'low' ? t('Aucun produit en stock bas.') : tab === 'retail' ? t('Ajoutez les produits que vous vendez : shampoings, masques, sérums…') : t('Ajoutez ce que le salon utilise : tubes de couleur, oxydant, papier…')}</p></Card>
      ) : groups.map(([g, ps]) => (
        <section key={g}>
          <h2 className="mb-2 text-sm font-semibold text-muted">{g}</h2>
          <ul className="card divide-y divide-line/10 overflow-hidden rounded-3xl">
            {ps.map(p => {
              const margin = p.price_cents && p.cost_cents != null ? Math.round((1 - p.cost_cents / p.price_cents) * 100) : null;
              return (
                <li key={p.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${p.active ? '' : 'opacity-50'}`}>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"><Package className="h-5 w-5" /></span>
                  <div className="min-w-[160px] flex-1">
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-sm text-muted">{[p.price_cents != null && p.kind === 'retail' ? mad(p.price_cents) : '', p.cost_cents != null ? t('achat {m}', { m: mad(p.cost_cents) }) : '', margin != null ? t('marge {n} %', { n: margin }) : ''].filter(Boolean).join(' · ')}</p>
                  </div>
                  <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold tabular ${low(p) ? 'bg-red-500/15 text-red-600' : 'bg-surface-2'}`}>
                    {low(p) && <AlertTriangle className="h-3.5 w-3.5" />}{t('{n} en stock', { n: p.stock })}</span>
                  <div className="flex gap-1.5">
                    <Btn className="px-3" onClick={() => setMove({ p, kind: 'delivery' })} title={t('Réception')}><PackagePlus className="h-4 w-4" /><span className="hidden md:inline">{t('Réception')}</span></Btn>
                    <Btn className="px-3" onClick={() => setMove({ p, kind: 'correction' })} title={t('Corriger le stock')}><Scale className="h-4 w-4" /></Btn>
                    <Btn className="px-3" onClick={() => setEdit(p)} aria-label={t('Modifier {name}', { name: p.name })}><Pencil className="h-4 w-4" /></Btn>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {edit && <ProductEditor r={r} p={edit === 'new' ? null : edit} kind={tab === 'usage' ? 'usage' : 'retail'} categories={[...new Set((list ?? []).map(x => x.category).filter(Boolean) as string[])]} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {counting && <Inventory r={r} products={active} onClose={() => setCounting(false)} onDone={() => { load(); }} />}
      {move && <StockMove r={r} p={move.p} kind={move.kind} onClose={() => setMove(null)} onDone={() => { setMove(null); load(); }} />}
    </div>
  );
}

function ProductEditor({ r, p, kind, categories, onClose, onSaved }: { r: Restaurant; p: Product | null; kind: 'retail' | 'usage'; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [f, setF] = useState({
    name: p?.name ?? '', category: p?.category ?? '', kind: p?.kind ?? kind, price: p?.price_cents != null ? String(p.price_cents / 100) : '',
    cost: p?.cost_cents != null ? String(p.cost_cents / 100) : '', min: p?.min_stock != null ? String(p.min_stock) : '', active: p?.active ?? true, start: '',
  });
  const [moves, setMoves] = useState<Move[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (p) supabase.from('agenda_stock_moves').select('id,kind,qty,unit_cost_cents,note,created_at').eq('product_id', p.id).order('created_at', { ascending: false }).limit(15).then(x => setMoves((x.data ?? []) as Move[]));
  }, [p]);
  const price = cents(f.price), cost = cents(f.cost);
  const ok = f.name.trim() && (f.kind === 'usage' || price != null) && (!f.cost.trim() || cost != null) && (!f.min.trim() || /^\d+$/.test(f.min)) && (!f.start.trim() || /^\d+$/.test(f.start));
  const save = async () => {
    setBusy(true);
    try {
      const row = { name: f.name.trim(), category: f.category.trim() || null, kind: f.kind, price_cents: f.kind === 'retail' ? price : null, cost_cents: cost, min_stock: f.min.trim() ? Number(f.min) : null, active: f.active };
      if (p) check(await supabase.from('agenda_products').update(row).eq('id', p.id).select('id'));
      else {
        const x = check(await supabase.from('agenda_products').insert({ ...row, restaurant_id: r.id }).select('id').single()) as { id: string };
        if (Number(f.start) > 0) await rpc('agenda_stock_add', { p_restaurant_id: r.id, p_product: x.id, p_kind: 'start', p_qty: Number(f.start), p_unit_cost_cents: null, p_note: null });
      }
      a.toast(t('Enregistré')); onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const remove = async () => {
    if (!p) return;
    try {
      const res = await supabase.from('agenda_products').delete().eq('id', p.id).select('id');
      if (res.error) throw res.error;
      if (!res.data?.length) { a.toast(t('Ce produit a déjà été vendu : désactivez-le plutôt, son historique reste.'), 'error'); return; }
      a.toast(t('Produit supprimé')); onSaved();
    } catch (e) { a.fail(e); }
  };
  return (
    <Modal title={p ? p.name : t('Nouveau produit')} onClose={onClose} wide
      footer={<div className="flex items-center gap-2">{p && <Btn tone="danger" onClick={remove}><Trash2 className="h-4 w-4" /></Btn>}<span className="flex-1" /><Btn onClick={onClose}>{t('Annuler')}</Btn><Btn tone="brand" disabled={busy || !ok} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <div className="flex gap-2">{(['retail', 'usage'] as const).map(k => (
          <button key={k} type="button" onClick={() => setF({ ...f, kind: k })} className={`flex-1 rounded-xl py-2.5 text-sm font-semibold ${f.kind === k ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>{k === 'retail' ? t('À vendre') : t('Usage salon')}</button>
        ))}</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Nom')}><input className={inputCls} maxLength={80} autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder={f.kind === 'retail' ? t('Shampoing kératine 250 ml') : t('Tube couleur 6.1')} /></Field>
          <Field label={t('Catégorie (facultatif)')}><input className={inputCls} maxLength={40} list="prod-cats" value={f.category} onChange={e => setF({ ...f, category: e.target.value })} placeholder={t('Soin, coloration, barbe…')} />
            <datalist id="prod-cats">{categories.map(c => <option key={c} value={c} />)}</datalist></Field>
          {f.kind === 'retail' && <Field label={t('Prix de vente (DH)')}><input className={inputCls} inputMode="decimal" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} /></Field>}
          <Field label={t('Prix d’achat (DH, facultatif)')}><input className={inputCls} inputMode="decimal" value={f.cost} onChange={e => setF({ ...f, cost: e.target.value })} /></Field>
          <Field label={t('Alerte stock bas à (facultatif)')} hint={t('Le produit passe en rouge à ce nombre ou moins.')}><input className={inputCls} inputMode="numeric" value={f.min} onChange={e => setF({ ...f, min: e.target.value.replace(/\D/g, '') })} placeholder="3" /></Field>
          {!p && <Field label={t('Stock de départ')}><input className={inputCls} inputMode="numeric" value={f.start} onChange={e => setF({ ...f, start: e.target.value.replace(/\D/g, '') })} placeholder="0" /></Field>}
        </div>
        {p && <Toggle checked={f.active} onChange={v => setF({ ...f, active: v })} label={f.kind === 'retail' ? t('Proposé à la caisse') : t('Actif')} />}
        {p && moves.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted"><History className="h-4 w-4" />{t('Derniers mouvements')}</p>
            <ul className="divide-y divide-line/10 rounded-2xl bg-surface-2 px-3 text-sm">
              {moves.map(x => (
                <li key={x.id} className="flex items-center gap-3 py-2">
                  <span className="w-24 text-muted tabular">{new Date(x.created_at).toLocaleDateString('fr-FR', { timeZone: r.timezone, day: '2-digit', month: '2-digit' })}</span>
                  <span className="flex-1">{t(MOVE[x.kind] ?? x.kind)}{x.note ? ` · ${x.note}` : ''}</span>
                  <span className={`font-bold tabular ${x.qty < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{x.qty > 0 ? '+' : ''}{x.qty}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

function StockMove({ r, p, kind, onClose, onDone }: { r: Restaurant; p: Product; kind: 'delivery' | 'correction'; onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState(p.cost_cents != null ? String(p.cost_cents / 100) : '');
  const [note, setNote] = useState('');
  const n = qty.trim() === '' ? null : Number(qty);
  // a correction is typed as the real count: the difference is the move
  const delta = kind === 'delivery' ? n : n == null ? null : n - p.stock;
  const ok = n != null && Number.isInteger(n) && n >= 0 && (kind === 'delivery' ? n > 0 : delta !== 0 && note.trim()) && (kind !== 'delivery' || !cost.trim() || cents(cost) != null);
  const go = async () => {
    try {
      await rpc('agenda_stock_add', { p_restaurant_id: r.id, p_product: p.id, p_kind: kind, p_qty: delta, p_unit_cost_cents: kind === 'delivery' && cost.trim() ? cents(cost) : null, p_note: note.trim() || null });
      a.toast(kind === 'delivery' ? t('Réception enregistrée') : t('Stock corrigé')); onDone();
    } catch (e) { a.fail(e); }
  };
  return (
    <Modal title={kind === 'delivery' ? t('Réception · {name}', { name: p.name }) : t('Corriger · {name}', { name: p.name })} onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Btn onClick={onClose}>{t('Annuler')}</Btn><Btn tone="brand" disabled={!ok} onClick={go}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">{t('En stock maintenant : {n}', { n: p.stock })}</p>
        {kind === 'delivery' ? <>
          <Field label={t('Quantité reçue')}><input className={`${inputCls} text-lg font-semibold`} inputMode="numeric" autoFocus value={qty} onChange={e => setQty(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label={t('Prix d’achat à l’unité (DH, facultatif)')}><input className={inputCls} inputMode="decimal" value={cost} onChange={e => setCost(e.target.value)} /></Field>
          <Field label={t('Note (facultatif)')}><input className={inputCls} maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder={t('Fournisseur, n° de facture…')} /></Field>
        </> : <>
          <Field label={t('Combien y en a-t-il vraiment ?')}><input className={`${inputCls} text-lg font-semibold`} inputMode="numeric" autoFocus value={qty} onChange={e => setQty(e.target.value.replace(/\D/g, ''))} /></Field>
          {delta != null && delta !== 0 && <p className={`text-sm font-semibold ${delta < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{delta < 0 ? t('{n} manquant(s)', { n: -delta }) : t('{n} en plus', { n: delta })}</p>}
          <Field label={t('Raison')}><input className={inputCls} maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder={t('Comptage, casse, utilisé au salon…')} /></Field>
        </>}
      </div>
    </Modal>
  );
}

interface CountLine { product_id: string; name: string; kind: 'retail' | 'usage'; expected: number; counted: number; diff: number; cost_cents: number | null; value_cents: number }
interface CountResult { lines: CountLine[]; missing_cents: number; extra_cents: number; used_cents: number }

/** The inventory: every product counted at once, without seeing what should be there. */
function Inventory({ r, products, onClose, onDone }: { r: Restaurant; products: Product[]; onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const [n, setN] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<CountResult | null>(null);
  const counted = products.filter(p => (n[p.id] ?? '').trim() !== '');
  const go = async () => {
    setBusy(true);
    try {
      setRes(await rpc<CountResult>('agenda_stock_count', { p_restaurant_id: r.id, p_lines: counted.map(p => ({ product_id: p.id, counted: Number(n[p.id]) })), p_note: note.trim() || null }));
      onDone();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  if (res) {
    const gaps = res.lines.filter(l => l.diff !== 0);
    return (
      <Modal title={t('Résultat de l’inventaire')} onClose={onClose} wide footer={<div className="flex justify-end"><Btn tone="brand" onClick={onClose}>{t('Fermer')}</Btn></div>}>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={`rounded-2xl p-4 ${res.missing_cents ? 'bg-red-500/10' : 'bg-emerald-500/10'}`}><p className="text-sm text-muted">{t('Manquant (produits à vendre)')}</p><p className={`font-display text-2xl font-semibold tabular ${res.missing_cents ? 'text-red-600' : 'text-emerald-700'}`}>{mad(res.missing_cents)}</p></div>
            <div className="rounded-2xl bg-surface-2 p-4"><p className="text-sm text-muted">{t('Consommé par le salon')}</p><p className="font-display text-2xl font-semibold tabular">{mad(res.used_cents)}</p></div>
            <div className="rounded-2xl bg-surface-2 p-4"><p className="text-sm text-muted">{t('En trop')}</p><p className="font-display text-2xl font-semibold tabular">{mad(res.extra_cents)}</p></div>
          </div>
          {!gaps.length ? <p className="rounded-2xl bg-emerald-500/10 p-4 font-semibold text-emerald-700">{t('Tout est juste : aucun écart.')}</p> : (
            <ul className="divide-y divide-line/10 rounded-2xl bg-surface-2 px-3">
              {gaps.map(l => (
                <li key={l.product_id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <span className="min-w-[160px] flex-1 font-semibold">{l.name} <span className="font-normal text-muted">{l.kind === 'usage' ? t('Usage salon') : ''}</span></span>
                  <span className="text-muted tabular">{t('attendu {a} · compté {b}', { a: l.expected, b: l.counted })}</span>
                  <span className={`w-14 text-end font-bold tabular ${l.diff < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{l.diff > 0 ? '+' : ''}{l.diff}</span>
                  <span className="w-24 text-end tabular">{l.cost_cents != null ? mad(l.value_cents) : '–'}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">{t('Le stock est maintenant celui que vous avez compté. Valeurs au prix d’achat.')}</p>
        </div>
      </Modal>
    );
  }
  const group = (k: 'retail' | 'usage') => products.filter(p => p.kind === k);
  return (
    <Modal title={t('Inventaire')} onClose={onClose} wide
      footer={<div className="flex items-center gap-3"><span className="me-auto text-sm text-muted">{t('{a} sur {b} comptés', { a: counted.length, b: products.length })}</span><Btn onClick={onClose}>{t('Annuler')}</Btn><Btn tone="brand" disabled={busy || !counted.length} onClick={go}><ClipboardCheck className="h-4 w-4" /> {t('Valider l’inventaire')}</Btn></div>}>
      <div className="space-y-5">
        <p className="text-sm text-muted">{t('Comptez ce qu’il y a vraiment sur les étagères et dans la réserve. Le stock attendu n’est pas affiché : c’est ce qui rend le comptage honnête. Un produit laissé vide n’est pas compté.')}</p>
        {(['retail', 'usage'] as const).map(k => group(k).length > 0 && (
          <div key={k}>
            <p className="mb-2 text-sm font-semibold text-muted">{k === 'retail' ? t('À vendre') : t('Usage salon')}</p>
            <ul className="divide-y divide-line/10 rounded-2xl border border-line/10 px-3">
              {group(k).map(p => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 font-semibold">{p.name}{p.category ? <span className="ms-2 text-sm font-normal text-muted">{p.category}</span> : null}</span>
                  <input className={`${inputCls} w-24 text-center text-lg font-semibold`} inputMode="numeric" aria-label={p.name} value={n[p.id] ?? ''} onChange={e => setN(x => ({ ...x, [p.id]: e.target.value.replace(/\D/g, '').slice(0, 6) }))} />
                </li>
              ))}
            </ul>
          </div>
        ))}
        <Field label={t('Note (facultatif)')}><input className={inputCls} maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder={t('Inventaire de fin de mois…')} /></Field>
      </div>
    </Modal>
  );
}

interface Report {
  products: { product_id: string; name: string; kind: 'retail' | 'usage'; cost_cents: number | null; sold: number; received: number; count_diff: number; count_value_cents: number }[];
  counts: { id: string; at: string; missing_cents: number; extra_cents: number; used_cents: number; note: string | null; lines: CountLine[] }[];
}
/** What went missing over the last 30 days, and the inventories. */
function Gaps({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [rep, setRep] = useState<Report | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const day = (n: number) => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA', { timeZone: r.timezone });
    rpc<Report>('agenda_stock_report', { p_restaurant_id: r.id, p_from: day(30), p_to: day(0) }).then(setRep).catch(e => { a.fail(e); setRep({ products: [], counts: [] }); });
  }, [r.id, r.timezone, a]);
  if (!rep) return <p className="text-muted">{t('Chargement…')}</p>;
  const miss = rep.counts.reduce((s, c) => s + Number(c.missing_cents), 0);
  const used = rep.counts.reduce((s, c) => s + Number(c.used_cents), 0);
  const top = rep.products.filter(p => p.kind === 'retail' && p.count_diff < 0).sort((x, y) => x.count_value_cents - y.count_value_cents).slice(0, 5);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={`card rounded-3xl p-4 ${miss ? 'ring-2 ring-red-500/30' : ''}`}><p className="text-sm text-muted">{t('Manquant sur 30 jours (produits à vendre)')}</p><p className={`mt-1 font-display text-2xl font-semibold tabular ${miss ? 'text-red-600' : ''}`}>{mad(miss)}</p></div>
        <div className="card rounded-3xl p-4"><p className="text-sm text-muted">{t('Consommé par le salon sur 30 jours')}</p><p className="mt-1 font-display text-2xl font-semibold tabular">{mad(used)}</p></div>
      </div>
      {top.length > 0 && (
        <Card>
          <h2 className="mb-3 font-display text-xl font-semibold">{t('Ce qui manque le plus')}</h2>
          <ul className="space-y-2">{top.map(p => (
            <li key={p.product_id} className="flex items-center gap-3 text-sm"><span className="flex-1 font-semibold">{p.name}</span><span className="text-muted">{t('{n} vendu(s)', { n: p.sold })}</span>
              <span className="font-bold text-red-600 tabular">{p.count_diff}</span><span className="w-24 text-end tabular">{mad(-p.count_value_cents)}</span></li>
          ))}</ul>
        </Card>
      )}
      <Card>
        <h2 className="mb-3 font-display text-xl font-semibold">{t('Inventaires')}</h2>
        {!rep.counts.length ? <p className="text-sm text-muted">{t('Aucun inventaire ces 30 derniers jours. Faites-en un par semaine ou par mois : c’est lui qui montre ce qui disparaît.')}</p> : (
          <ul className="divide-y divide-line/10">
            {rep.counts.map(c => (
              <li key={c.id} className="py-2.5">
                <button onClick={() => setOpen(open === c.id ? null : c.id)} className="flex w-full flex-wrap items-center gap-3 text-start">
                  <span className="font-semibold">{new Date(c.at).toLocaleDateString('fr-FR', { timeZone: r.timezone, weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  {c.note && <span className="text-sm text-muted">{c.note}</span>}
                  <span className="ms-auto text-sm tabular"><span className={Number(c.missing_cents) ? 'font-bold text-red-600' : 'text-muted'}>{t('manquant {m}', { m: mad(Number(c.missing_cents)) })}</span> · {t('consommé {m}', { m: mad(Number(c.used_cents)) })}</span>
                </button>
                {open === c.id && <ul className="mt-2 space-y-1 rounded-2xl bg-surface-2 p-3 text-sm">{c.lines.filter(l => l.diff !== 0).map(l => (
                  <li key={l.product_id} className="flex gap-3"><span className="flex-1">{l.name}</span><span className={`font-bold tabular ${l.diff < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{l.diff > 0 ? '+' : ''}{l.diff}</span></li>
                ))}{!c.lines.some(l => l.diff !== 0) && <li className="text-muted">{t('Tout est juste : aucun écart.')}</li>}</ul>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
