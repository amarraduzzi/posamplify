// Supplier accounts (what is owed, overdue, next due, payments, statement) and price comparison.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowDownUp, FileText, Pencil, Phone, Plus, Receipt, Scale, Star, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, mad, rpc, toCents } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, Modal, inputCls } from '../components/ui';
import { InvoiceGallery } from '../components/Invoices';
import { SupplierSheet } from '../components/SupplierSheet';

interface Bal { id: string; name: string; phone: string | null; terms: number; purchased_cents: number; paid_cents: number; credit_cents: number; opening_cents: number;
  balance_cents: number; overdue_cents: number; oldest_overdue: string | null; next_due: string | null; next_due_cents: number | null; last_purchase: string | null; last_30d_cents: number }
interface Row { on_date: string; kind: 'purchase' | 'payment' | 'credit' | 'opening'; id: string | null; label: string; signed: number; method: string | null; balance_cents: number }
interface Cmp { ingredient_id: string; name: string; purchase_unit: string; suppliers: { supplier_id: string; supplier: string; last_cents: number; avg_cents: number; last_on: string }[]; best_cents: number; saving_cents: number }
// i18n:values
const KIND: Record<string, string> = { purchase: 'Achat', payment: 'Paiement', credit: 'Avoir', opening: 'Solde de départ' };
const METHOD: Record<string, string> = { cash: 'Espèces', transfer: 'Virement', check: 'Chèque', card: 'Carte' };
const TERMS: [number, string][] = [[0, 'À la livraison'], [7, '7 jours'], [15, '15 jours'], [30, '30 jours'], [45, '45 jours'], [60, '60 jours']];
// i18n:end
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' }) : '–');

export function SupplierAccounts({ r, onOrders }: { r: Restaurant; onOrders?: () => void }) {
  const a = useAdminCtx();
  const [bal, setBal] = useState<Bal[] | null>(null);
  const [cmp, setCmp] = useState<Cmp[]>([]);
  const [pay, setPay] = useState<Bal | null>(null);
  const [stmt, setStmt] = useState<Bal | null>(null);
  const [det, setDet] = useState<Bal | null>(null);
  // the supplier sheet: an id, 'new', or closed
  const [sheet, setSheet] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [b, c] = await Promise.all([rpc<Bal[]>('supplier_balances', { p_restaurant_id: r.id }), rpc<Cmp[]>('supplier_compare', { p_restaurant_id: r.id })]);
      setBal(b); setCmp(c);
    } catch (e) { a.fail(e); setBal([]); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);
  const setTerms = async (b: Bal, days: number) => {
    try { check(await supabase.from('suppliers').update({ payment_terms_days: days }).eq('id', b.id).select('id')); load(); } catch (e) { a.fail(e); }
  };
  const owed = (bal ?? []).reduce((s, x) => s + Math.max(0, Number(x.balance_cents)), 0);
  const late = (bal ?? []).reduce((s, x) => s + Number(x.overdue_cents), 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card rounded-3xl p-5"><p className="text-sm text-muted">{t('Vous devez à vos fournisseurs')}</p><p className="font-display text-4xl font-semibold tabular">{mad(owed)}</p></div>
        <div className={`card rounded-3xl p-5 ${late > 0 ? 'ring-2 ring-danger/40' : ''}`}><p className="text-sm text-muted">{t('Dont en retard')}</p><p className={`font-display text-4xl font-semibold tabular ${late > 0 ? 'text-danger' : 'text-ok'}`}>{mad(late)}</p></div>
      </div>

      <Card>
        <div className="flex flex-wrap items-start gap-3">
          <h2 className="me-auto mb-1 font-display text-xl font-semibold">{t('Comptes fournisseurs')}</h2>
          <Btn tone="brand" className="px-3 py-2 text-sm" onClick={() => setSheet('new')}><Plus className="h-4 w-4" /> {t('Nouveau fournisseur')}</Btn>
        </div>
        <p className="mb-4 text-sm text-muted">{t('Les achats notés dans Amplify, moins vos paiements et avoirs. Les paiements règlent d’abord les achats les plus anciens.')}</p>
        {bal === null ? <p className="text-muted">{t('Chargement…')}</p> : !bal.length ? <p className="text-sm text-muted">{t('Aucun fournisseur. Ajoutez-les dans Commandes fournisseurs.')}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead><tr className="text-xs uppercase tracking-wider text-muted">{[t('Fournisseur'), t('Paiement'), t('Solde'), t('En retard'), t('Prochaine échéance'), t('30 derniers jours'), ''].map((h, i) => <th key={i} className="pb-2 pe-3 text-start font-semibold">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line/10">
                {bal.map(b => (
                  <tr key={b.id}>
                    <td className="py-2.5 pe-3 font-semibold"><button type="button" onClick={() => setDet(b)} className="text-start underline-offset-2 hover:text-brand hover:underline">{b.name}</button></td>
                    <td className="py-2.5 pe-3"><select className="rounded-lg bg-surface-2 px-2 py-1 text-sm" value={b.terms} onChange={e => setTerms(b, Number(e.target.value))}>{TERMS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select></td>
                    <td className="whitespace-nowrap py-2.5 pe-3 font-semibold tabular">{mad(Number(b.balance_cents))}</td>
                    <td className="py-2.5 pe-3 tabular">{Number(b.overdue_cents) > 0 ? <span className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-danger"><AlertTriangle className="h-3.5 w-3.5" />{mad(Number(b.overdue_cents))}<span className="font-normal text-muted">· {t('depuis le {d}', { d: day(b.oldest_overdue) })}</span></span> : '–'}</td>
                    <td className="py-2.5 pe-3 tabular">{b.next_due ? `${day(b.next_due)} · ${mad(Number(b.next_due_cents))}` : '–'}</td>
                    <td className="py-2.5 pe-3 tabular text-muted">{mad(Number(b.last_30d_cents))}</td>
                    <td className="py-2.5 text-end whitespace-nowrap">
                      <Btn className="px-2.5 py-1.5 text-sm" onClick={() => setStmt(b)}><FileText className="h-4 w-4" /> {t('Relevé')}</Btn>{' '}
                      <Btn tone="brand" className="px-2.5 py-1.5 text-sm" onClick={() => setPay(b)}><Plus className="h-4 w-4" /> {t('Paiement')}</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-semibold"><Scale className="h-5 w-5 text-brand" />{t('Comparer les fournisseurs')}</h2>
        <p className="mb-4 text-sm text-muted">{t('Pour les produits achetés chez plusieurs fournisseurs ces 6 derniers mois : prix moyen et dernier prix, et ce que vous auriez économisé chez le moins cher.')}</p>
        {!cmp.length ? <p className="text-sm text-muted">{t('Rien à comparer pour l’instant : notez vos achats avec le fournisseur, et un même produit chez au moins deux fournisseurs.')}</p> : (
          <ul className="divide-y divide-line/10">
            {cmp.map(c => (
              <li key={c.ingredient_id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="w-40 font-semibold">{c.name}</span>
                <span className="flex flex-1 flex-wrap gap-2">
                  {c.suppliers.map(s => (
                    <span key={s.supplier_id} className={`rounded-xl px-3 py-1.5 text-sm ${Number(s.avg_cents) === Number(c.best_cents) ? 'bg-ok/15 font-semibold text-ok' : 'bg-surface-2'}`}>
                      {s.supplier} · <b className="tabular">{mad(Number(s.avg_cents))}</b>/{c.purchase_unit}
                      <span className="text-xs opacity-70"> ({t('dernier {m}', { m: mad(Number(s.last_cents)) })})</span>
                    </span>
                  ))}
                </span>
                {Number(c.saving_cents) > 0 && <span className="flex items-center gap-1 text-sm font-semibold text-warn"><ArrowDownUp className="h-4 w-4" />{t('{m} de plus payés en 6 mois', { m: mad(Number(c.saving_cents)) })}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-semibold"><Receipt className="h-5 w-5 text-brand" />{t('Factures et bons de livraison')}</h2>
        <p className="mb-4 text-sm text-muted">{t('Toutes vos factures en photo, au même endroit. Ajoutez-les en notant un achat, en réceptionnant une commande, ou ici.')}</p>
        <InvoiceGallery r={r} />
      </Card>

      {sheet && <SupplierSheet r={r} supplierId={sheet === 'new' ? null : sheet} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); setDet(null); load(); }} />}
      {det && !sheet && <SupplierDetail r={r} b={det} cmp={cmp} onEdit={() => setSheet(det.id)} onClose={() => setDet(null)} onStatement={() => { setStmt(det); setDet(null); }}
        onPay={() => { setPay(det); setDet(null); }} onOrders={onOrders ? () => { setDet(null); onOrders(); } : undefined} />}
      {pay && <PayModal r={r} b={pay} onClose={() => setPay(null)} onSaved={() => { setPay(null); load(); }} />}
      {stmt && <Statement b={stmt} onClose={() => setStmt(null)} onChanged={load} />}
    </div>
  );
}

function PayModal({ r, b, onClose, onSaved }: { r: Restaurant; b: Bal; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ kind: 'payment', amount: Number(b.overdue_cents) > 0 ? String(Number(b.overdue_cents) / 100) : '', on: today, method: 'cash', ref: '' });
  const [busy, setBusy] = useState(false);
  const cents = toCents(f.amount);
  const save = async () => {
    setBusy(true);
    try {
      check(await supabase.from('supplier_entries').insert({ restaurant_id: r.id, supplier_id: b.id, kind: f.kind, amount_cents: cents, entry_on: f.on,
        method: f.kind === 'payment' ? f.method : null, reference: f.ref.trim() || null }).select('id'));
      a.toast(t('Enregistré')); onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={b.name} onClose={onClose} footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy || cents <= 0 || !f.on} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <div className="flex rounded-xl bg-surface-2 p-1">
          {(['payment', 'credit', 'opening'] as const).map(k => <button key={k} type="button" onClick={() => setF({ ...f, kind: k })} className={`flex-1 rounded-lg py-2 text-sm font-semibold ${f.kind === k ? 'bg-night text-white' : 'text-muted'}`}>{t(KIND[k])}</button>)}
        </div>
        <p className="text-sm text-muted">{f.kind === 'payment' ? t('Ce que vous avez payé à ce fournisseur.') : f.kind === 'credit' ? t('Un retour de marchandise ou un avoir du fournisseur : il réduit ce que vous devez.') : t('Ce que vous deviez déjà à ce fournisseur avant Amplify.')}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Montant (DH)')}><input autoFocus className={inputCls} inputMode="decimal" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label={t('Date')}><input type="date" className={inputCls} value={f.on} onChange={e => setF({ ...f, on: e.target.value })} /></Field>
          {f.kind === 'payment' && <Field label={t('Moyen de paiement')}><select className={inputCls} value={f.method} onChange={e => setF({ ...f, method: e.target.value })}>{Object.entries(METHOD).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></Field>}
          <Field label={t('Référence (facultatif)')}><input className={inputCls} maxLength={60} value={f.ref} onChange={e => setF({ ...f, ref: e.target.value })} placeholder={t('N° de facture, de chèque…')} /></Field>
        </div>
        {f.kind === 'payment' && f.method === 'cash' && <p className="rounded-xl bg-surface-2 p-3 text-xs text-muted">{t('Payé avec l’argent de la caisse ? Notez aussi une sortie de caisse sur la caisse, pour que le comptage du soir reste juste.')}</p>}
      </div>
    </Modal>
  );
}

function Statement({ b, onClose, onChanged }: { b: Bal; onClose: () => void; onChanged: () => void }) {
  const a = useAdminCtx();
  const [rows, setRows] = useState<Row[] | null>(null);
  const load = useCallback(async () => { try { setRows(await rpc<Row[]>('supplier_statement', { p_supplier_id: b.id })); } catch (e) { a.fail(e); setRows([]); } }, [b.id, a]);
  useEffect(() => { load(); }, [load]);
  const del = async (id: string) => { try { check(await supabase.from('supplier_entries').delete().eq('id', id).select('id')); load(); onChanged(); } catch (e) { a.fail(e); } };
  return (
    <Modal wide title={`${t('Relevé')} · ${b.name}`} onClose={onClose}>
      {rows === null ? <p className="text-muted">{t('Chargement…')}</p> : !rows.length ? <p className="text-muted">{t('Aucune opération.')}</p> : (
        <table className="w-full text-sm">
          <thead><tr className="text-xs uppercase tracking-wider text-muted">{[t('Date'), t('Opération'), t('Montant'), t('Solde'), ''].map((h, i) => <th key={i} className="pb-2 pe-3 text-start font-semibold">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line/10">
            {rows.map((x, i) => (
              <tr key={i}>
                <td className="py-2 pe-3 tabular text-muted">{day(x.on_date)}</td>
                <td className="py-2 pe-3"><b>{t(KIND[x.kind])}</b>{x.method ? ` · ${t(METHOD[x.method] ?? x.method)}` : ''}{x.label ? <span className="text-muted"> · {x.label}</span> : ''}</td>
                <td className={`py-2 pe-3 tabular font-semibold ${x.signed < 0 ? 'text-ok' : ''}`}>{x.signed < 0 ? '−' : '+'}{mad(Math.abs(Number(x.signed)))}</td>
                <td className="py-2 pe-3 tabular">{mad(Number(x.balance_cents))}</td>
                <td className="py-2 text-end">{x.id && <button aria-label={t('Supprimer')} onClick={() => del(x.id!)} className="text-muted hover:text-danger"><Trash2 className="h-4 w-4" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------ one supplier on one screen
interface SupRow { id: string; name: string; phone: string | null; email: string | null; contact: string | null; delivery_days: number[]; lead_days: number; note: string | null;
  address: string | null; city: string | null; ice: string | null; if_number: string | null; rc: string | null; rib: string | null; min_order_cents: number | null }
interface SupIng { id: string; name: string; purchase_unit: string; purchase_price_cents: number | null; price_estimated: boolean; ref: string | null; pack: string | null; agreed: number | null; main: boolean }
interface SupPo { id: string; doc_number: string; status: 'draft' | 'sent' | 'received' | 'cancelled'; expected_on: string | null; received_on: string | null; created_at: string }
// i18n:values
const WD = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const PO_ST: Record<SupPo['status'], string> = { draft: 'Brouillon', sent: 'Envoyée', received: 'Reçue', cancelled: 'Annulée' };
// i18n:end

function SupplierDetail({ r, b, cmp, onClose, onStatement, onPay, onOrders, onEdit }: { r: Restaurant; b: Bal; cmp: Cmp[]; onClose: () => void; onStatement: () => void; onPay: () => void; onOrders?: () => void; onEdit: () => void }) {
  const a = useAdminCtx();
  const [s, setS] = useState<SupRow | null>(null);
  const [ings, setIngs] = useState<SupIng[] | null>(null);
  const [pos, setPos] = useState<SupPo[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const [x, g, o] = await Promise.all([
          supabase.from('suppliers').select('id, name, phone, email, contact, delivery_days, lead_days, note, address, city, ice, if_number, rc, rib, min_order_cents').eq('id', b.id).single(),
          supabase.from('supplier_products').select('is_main, ref, pack_label, price_cents, ingredients(id, name, purchase_unit, purchase_price_cents, price_estimated)').eq('restaurant_id', r.id).eq('supplier_id', b.id),
          supabase.from('purchase_orders').select('id, doc_number, status, expected_on, received_on, created_at').eq('restaurant_id', r.id).eq('supplier_id', b.id).order('created_at', { ascending: false }).limit(5),
        ]);
        type L = { is_main: boolean; ref: string | null; pack_label: string | null; price_cents: number | null; ingredients: Omit<SupIng, 'ref' | 'pack' | 'agreed' | 'main'> | null };
        setS(check(x) as unknown as SupRow);
        setIngs((check(g) as unknown as L[]).filter(l => l.ingredients).map(l => ({ ...l.ingredients!, ref: l.ref, pack: l.pack_label, agreed: l.price_cents, main: l.is_main }))
          .sort((p, q) => Number(q.main) - Number(p.main) || p.name.localeCompare(q.name)));
        setPos(check(o) as SupPo[]);
      } catch (e) { a.fail(e); setIngs([]); }
    })();
  }, [b.id, r.id, a]);
  // how this supplier's average price compares with the other suppliers of the same product
  const price = (g: SupIng) => {
    const c = cmp.find(x => x.ingredient_id === g.id), me = c?.suppliers.find(y => y.supplier_id === b.id);
    if (!c || !me) return null;
    if (Number(me.avg_cents) === Number(c.best_cents)) return { best: true, pct: 0 };
    return { best: false, pct: Math.round((Number(me.avg_cents) - Number(c.best_cents)) * 100 / Number(c.best_cents)) };
  };
  const missing = (ings ?? []).filter(g => g.purchase_price_cents == null).length;
  return (
    <Modal wide title={b.name} onClose={onClose}
      footer={<div className="flex flex-wrap justify-end gap-2">
        <Btn tone="ghost" className="me-auto" onClick={onEdit}><Pencil className="h-4 w-4" /> {t('Modifier la fiche')}</Btn>
        <Btn onClick={onStatement}><FileText className="h-4 w-4" /> {t('Relevé')}</Btn>
        <Btn onClick={onPay}><Plus className="h-4 w-4" /> {t('Paiement')}</Btn>
        {onOrders && <Btn tone="brand" onClick={onOrders}>{t('Commandes fournisseurs')}</Btn>}
      </div>}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-surface-2 p-4"><p className="text-xs text-muted">{t('Solde')}</p><p className="font-display text-2xl font-semibold tabular">{mad(Number(b.balance_cents))}</p></div>
          <div className={`rounded-2xl p-4 ${Number(b.overdue_cents) > 0 ? 'bg-danger/10' : 'bg-surface-2'}`}><p className="text-xs text-muted">{t('En retard')}</p><p className={`font-display text-2xl font-semibold tabular ${Number(b.overdue_cents) > 0 ? 'text-danger' : ''}`}>{mad(Number(b.overdue_cents))}</p></div>
          <div className="rounded-2xl bg-surface-2 p-4"><p className="text-xs text-muted">{t('30 derniers jours')}</p><p className="font-display text-2xl font-semibold tabular">{mad(Number(b.last_30d_cents))}</p></div>
        </div>

        {s && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted">
            {s.contact && <span>{s.contact}</span>}
            {s.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" /><span dir="ltr">{s.phone}</span></span>}
            {s.email && <span dir="ltr">{s.email}</span>}
            <span>{s.delivery_days.length ? t('Livre : {d}', { d: s.delivery_days.map(d => t(WD[d - 1])).join(', ') }) : t('Jours de livraison non indiqués')}{' · '}{t('{n} j après la commande', { n: s.lead_days })}</span>
            {s.note && <span>{s.note}</span>}
            {(s.address || s.city) && <span>{[s.address, s.city].filter(Boolean).join(', ')}</span>}
            {s.min_order_cents != null && <span>{t('Minimum {m}', { m: mad(Number(s.min_order_cents)) })}</span>}
            {(s.ice || s.if_number || s.rc || s.rib) && <span dir="ltr" className="tabular">{[s.ice && `ICE ${s.ice}`, s.if_number && `IF ${s.if_number}`, s.rc && `RC ${s.rc}`, s.rib && `RIB ${s.rib}`].filter(Boolean).join(' · ')}</span>}
            {!s.ice && <button type="button" onClick={onEdit} className="font-semibold text-warn underline">{t('ICE manquant : compléter la fiche')}</button>}
          </div>
        )}

        <div>
          <p className="mb-2 font-semibold">{t('Ses produits')}{ings ? ` (${ings.length})` : ''}</p>
          {ings === null ? <p className="text-muted">{t('Chargement…')}</p> : !ings.length ? (
            <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">{t('Aucun produit relié. Ajoutez-les dans « Modifier la fiche ».')}</p>
          ) : (<>
            {missing > 0 && <p className="mb-2 text-sm font-semibold text-warn">{t('{n} prix manquant(s)', { n: missing })}</p>}
            <ul className="divide-y divide-line/10 rounded-2xl ring-1 ring-line/10">
              {ings.map(g => {
                const c = price(g);
                return (
                  <li key={g.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    {g.main ? <Star className="h-4 w-4 shrink-0 fill-current text-brand" aria-label={t('Fournisseur habituel')} /> : <span className="w-4" />}
                    <span className="min-w-0 flex-1 truncate font-semibold">{g.name}{(g.ref || g.pack) && <span className="ms-2 text-xs font-normal text-muted">{[g.ref, g.pack].filter(Boolean).join(' · ')}</span>}</span>
                    {c && (c.best ? <span className="rounded-full bg-ok/15 px-2 py-0.5 text-xs font-semibold text-ok">{t('prix le plus bas')}</span>
                      : <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-semibold text-warn">{t('+{p} % vs le moins cher', { p: c.pct })}</span>)}
                    <span className="tabular">{g.agreed != null ? <>{mad(Number(g.agreed))} <span className="text-muted">/ {g.purchase_unit} · {t('convenu')}</span></> : g.purchase_price_cents == null ? <span className="text-danger">{t('Prix manquant')}</span> : <>{mad(g.purchase_price_cents)} <span className="text-muted">/ {g.purchase_unit}</span></>}</span>
                  </li>
                );
              })}
            </ul>
          </>)}
        </div>

        <InvoiceGallery r={r} supplierId={b.id} supplierName={b.name} limit={12} compact />

        {pos.length > 0 && (
          <div>
            <p className="mb-2 font-semibold">{t('Dernières commandes')}</p>
            <ul className="divide-y divide-line/10 rounded-2xl ring-1 ring-line/10">
              {pos.map(o => (
                <li key={o.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="font-semibold">{o.doc_number}</span>
                  <span className="flex-1 text-muted">{o.received_on ? t('reçue le {d}', { d: day(o.received_on) }) : o.expected_on ? t('livraison prévue {d}', { d: day(o.expected_on) }) : day(o.created_at.slice(0, 10))}</span>
                  <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-bold">{t(PO_ST[o.status])}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
