// Supplier accounts (what is owed, overdue, next due, payments, statement) and price comparison.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowDownUp, FileText, Plus, Scale, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, mad, rpc, toCents } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, Modal, inputCls } from '../components/ui';

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

export function SupplierAccounts({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [bal, setBal] = useState<Bal[] | null>(null);
  const [cmp, setCmp] = useState<Cmp[]>([]);
  const [pay, setPay] = useState<Bal | null>(null);
  const [stmt, setStmt] = useState<Bal | null>(null);
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
        <h2 className="mb-1 font-display text-xl font-semibold">{t('Comptes fournisseurs')}</h2>
        <p className="mb-4 text-sm text-muted">{t('Les achats notés dans Amplify, moins vos paiements et avoirs. Les paiements règlent d’abord les achats les plus anciens.')}</p>
        {bal === null ? <p className="text-muted">{t('Chargement…')}</p> : !bal.length ? <p className="text-sm text-muted">{t('Aucun fournisseur. Ajoutez-les dans Commandes fournisseurs.')}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead><tr className="text-xs uppercase tracking-wider text-muted">{[t('Fournisseur'), t('Paiement'), t('Solde'), t('En retard'), t('Prochaine échéance'), t('30 derniers jours'), ''].map((h, i) => <th key={i} className="pb-2 pe-3 text-start font-semibold">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line/10">
                {bal.map(b => (
                  <tr key={b.id}>
                    <td className="py-2.5 pe-3 font-semibold">{b.name}</td>
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
