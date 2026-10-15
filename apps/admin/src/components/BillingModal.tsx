// Amplify's billing of one customer: the agreement (from when, how much, per month or year), a payment
// received (moves the paid date on, gives a numbered receipt) and the list of payments.
import { useCallback, useEffect, useState } from 'react';
import { MessageCircle, Printer, Undo2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, fromCents, mad, rpc, toCents } from '../lib/api';
import { t } from '../lib/i18n';
import { billing, fmtDay, intlPhone, METHODS, printReceipt, receiptNo, receiptText, reminderText, today, waTo, type PlatformPayment } from '../lib/billing';
import type { PayMethod, Restaurant } from '../lib/types';
import { useAdminCtx } from '../store';
import { Btn, Field, Modal, inputCls } from './ui';

export function BillingModal({ r, onClose, onChanged }: { r: Restaurant; onClose: () => void; onChanged: () => void }) {
  const a = useAdminCtx();
  const [start, setStart] = useState(r.billing_start ?? today());
  const [amount, setAmount] = useState(fromCents(r.billing_amount_cents ?? null));
  const [period, setPeriod] = useState<'month' | 'year'>(r.billing_period ?? 'month');
  const [method, setMethod] = useState<PayMethod>(r.billing_method ?? 'cash');
  const [pay, setPay] = useState({ amount: fromCents(r.billing_amount_cents ?? null), method: (r.billing_method ?? 'cash') as PayMethod, date: today(), periods: '1', note: '' });
  const [list, setList] = useState<PlatformPayment[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [cur, setCur] = useState(r);
  const b = billing(cur);
  const phone = intlPhone(cur.owner_whatsapp || cur.phone);

  const load = useCallback(async () => {
    try {
      setList(check(await supabase.from('platform_payments').select('*').eq('restaurant_id', r.id).order('period_to', { ascending: false })) as PlatformPayment[]);
      const [x] = check(await supabase.from('restaurants').select('*').eq('id', r.id)) as Restaurant[];
      if (x) setCur(x);
      return x;
    } catch (e) { a.fail(e); return undefined; }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);

  const saveAgreement = async () => {
    setBusy(true);
    try {
      await rpc('admin_set_billing', { p_restaurant_id: r.id, p_start: start || null, p_amount_cents: amount ? toCents(amount) : null, p_period: period, p_method: method });
      a.toast(t('Enregistré')); await load(); onChanged();
      if (!pay.amount && amount) setPay(p => ({ ...p, amount, method }));
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const record = async () => {
    setBusy(true);
    try {
      await rpc('admin_record_payment', { p_restaurant_id: r.id, p_amount_cents: toCents(pay.amount), p_method: pay.method, p_paid_on: pay.date, p_periods: Number(pay.periods) || 1, p_note: pay.note || null });
      setPay(x => ({ ...x, note: '', periods: '1' }));
      const x = await load(); onChanged();
      a.toast(x?.paid_until ? t('Paiement enregistré, payé jusqu’au {d}', { d: fmtDay(x.paid_until, true) }) : t('Enregistré'));
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const cancel = async (p: PlatformPayment) => {
    if (!window.confirm(t('Annuler le reçu {n} ?', { n: receiptNo(p) }))) return;
    try { await rpc('admin_cancel_payment', { p_payment_id: p.id }); await load(); onChanged(); } catch (e) { a.fail(e); }
  };

  const status = b.state === 'late' ? t('En retard de {n} j', { n: -(b.left ?? 0) }) : b.state === 'setup' ? (cur.billing_start ? t('En préparation, paiement à partir du {d}', { d: fmtDay(cur.billing_start, true) }) : t('En préparation : pas encore de date de paiement'))
    : b.state === 'trial' ? t('Essai, sans accord de paiement') : b.due ? t('Prochain paiement le {d}', { d: fmtDay(b.due, true) }) : '';
  const tone = b.state === 'late' ? 'bg-danger/10 text-danger' : b.state === 'soon' ? 'bg-warn/15 text-warn' : b.state === 'ok' ? 'bg-ok/15 text-ok' : 'bg-surface-2 text-muted';

  return (
    <Modal wide title={t('Paiements : {name}', { name: r.name })} onClose={onClose}>
      <div className="space-y-6">
        <div className={`flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold ${tone}`}>
          <span className="flex-1">{status}{cur.paid_until ? ` · ${t('payé jusqu’au {d}', { d: fmtDay(cur.paid_until, true) })}` : ''}</span>
          {b.due && phone && (b.state === 'late' || b.state === 'soon') && <a href={waTo(phone, reminderText(cur, b.due, b.amount))} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-xl bg-surface px-3 py-1.5 text-ink"><MessageCircle className="h-4 w-4" />{t('Rappel WhatsApp')}</a>}
        </div>

        <section>
          <h3 className="mb-3 font-semibold">{t('L’accord')}</h3>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label={t('Paie à partir du')}><input type="date" className={inputCls} value={start} onChange={e => setStart(e.target.value)} /></Field>
            <Field label={t('Montant (DH)')}><input className={inputCls} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="299" /></Field>
            <Field label={t('Rythme')}><select className={inputCls} value={period} onChange={e => setPeriod(e.target.value as 'month' | 'year')}><option value="month">{t('Par mois')}</option><option value="year">{t('Par an')}</option></select></Field>
            <Field label={t('Paie en')}><select className={inputCls} value={method} onChange={e => setMethod(e.target.value as PayMethod)}>{(Object.keys(METHODS) as PayMethod[]).map(k => <option key={k} value={k}>{t(METHODS[k])}</option>)}</select></Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Btn disabled={busy} onClick={saveAgreement}>{t('Enregistrer l’accord')}</Btn>
            <p className="text-xs text-muted">{t('Pas encore installé ? Mettez la date du jour où il commence à payer. Avant cette date, tout fonctionne et rien n’est dû.')}</p>
          </div>
        </section>

        <section className="rounded-2xl bg-surface-2/60 p-4">
          <h3 className="mb-3 font-semibold">{t('Paiement reçu')}</h3>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label={t('Montant (DH)')}><input className={inputCls} inputMode="decimal" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} /></Field>
            <Field label={t('Mode')}><select className={inputCls} value={pay.method} onChange={e => setPay({ ...pay, method: e.target.value as PayMethod })}>{(Object.keys(METHODS) as PayMethod[]).map(k => <option key={k} value={k}>{t(METHODS[k])}</option>)}</select></Field>
            <Field label={t('Reçu le')}><input type="date" className={inputCls} value={pay.date} onChange={e => setPay({ ...pay, date: e.target.value })} /></Field>
            <Field label={cur.billing_period === 'year' ? t('Nombre d’années') : t('Nombre de mois')}><input className={inputCls} inputMode="numeric" value={pay.periods} onChange={e => setPay({ ...pay, periods: e.target.value.replace(/\D/g, '').slice(0, 2) })} /></Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input className={`${inputCls} min-w-0 flex-1`} maxLength={200} value={pay.note} onChange={e => setPay({ ...pay, note: e.target.value })} placeholder={t('Note (facultatif)')} />
            <Btn tone="brand" disabled={busy || toCents(pay.amount) <= 0} onClick={record}>{t('Enregistrer le paiement')}</Btn>
          </div>
        </section>

        <section>
          <h3 className="mb-2 font-semibold">{t('Reçus')}</h3>
          {list === null ? <p className="text-sm text-muted">{t('Chargement…')}</p> : !list.length ? <p className="text-sm text-muted">{t('Aucun paiement pour le moment.')}</p> : (
            <ul className="divide-y divide-line/10">
              {list.map((p, i) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
                  <span className="w-28 font-semibold tabular">{receiptNo(p)}</span>
                  <span className="w-24 tabular">{fmtDay(p.paid_on)}</span>
                  <span className="w-28 font-semibold tabular">{mad(p.amount_cents)}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{t(METHODS[p.method])} · {fmtDay(p.period_from)} → {fmtDay(p.period_to)}</span>
                  <span className="flex gap-1">
                    <button type="button" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-surface-2" title={t('Imprimer le reçu')} aria-label={t('Imprimer le reçu')} onClick={() => printReceipt(cur, p)}><Printer className="h-4 w-4" /></button>
                    {phone && <a className="grid h-8 w-8 place-items-center rounded-lg hover:bg-surface-2" title={t('Envoyer le reçu sur WhatsApp')} aria-label={t('Envoyer le reçu sur WhatsApp')} href={waTo(phone, receiptText(cur, p))} target="_blank" rel="noopener"><MessageCircle className="h-4 w-4" /></a>}
                    {i === 0 && <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-danger hover:bg-danger/10" title={t('Annuler ce reçu')} aria-label={t('Annuler ce reçu')} onClick={() => cancel(p)}><Undo2 className="h-4 w-4" /></button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!phone && <p className="mt-2 text-xs text-muted">{t('Ajoutez le téléphone ou le WhatsApp du restaurant pour envoyer les reçus et les rappels.')}</p>}
        </section>
      </div>
    </Modal>
  );
}
