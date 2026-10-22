// Acomptes: what an appointment's deposit is (to receive, received, to settle) and what the salon
// can do with it: ask one (the rule proposes the amount), send the client how to pay on WhatsApp,
// mark it received (cash or card on the till, or a transfer, CashPlus, a payment link), and after a
// cancellation give it back or keep it as a credit.
import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Clock, Coins, MessageCircle, Undo2, Wallet } from 'lucide-react';
import { supabase, MENU_URL } from '../lib/supabase';
import { rpc } from '../lib/api';
import { waLink } from '../lib/whatsapp';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Field, inputCls } from './ui';

export type DepositStatus = 'pending' | 'paid' | 'expired' | 'cancelled' | 'to_settle' | 'kept' | 'credited' | 'refunded';
export interface Deposit {
  id: string; appointment_id: string; amount_cents: number; reason: 'service' | 'no_shows' | 'manual'; status: DepositStatus; due_at: string | null;
  method: string | null; paid_at: string | null; reported: boolean; client_ref: string | null; provider_ref: string | null; settle_note: string | null;
  code: string | null; balance_cents: number | null; name: string; phone: string | null; starts_at: string; service: Record<string, string>;
  staff_id: string | null; appt_status: string; token: string;
}
export interface DepositPay { rib?: string; rib_name?: string; bank?: string; cashplus?: string; link?: string; note?: string }
export interface DepositCfg { enabled: boolean; after_no_shows: number; noshow_cents: number; hours: number }

const mad = (c: number) => `${(Number(c) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} DH`;
// i18n:values
const METHOD: Record<string, string> = { cash: 'Espèces', card: 'Carte', transfer: 'Virement', cashplus: 'CashPlus', link: 'Lien de paiement', other: 'Autre' };
// i18n:end
export const methodLabel = (m: string | null) => (m ? t(METHOD[m] ?? m) : '');

export function useDeposits(r: Restaurant) {
  const [data, setData] = useState<{ list: Deposit[]; cfg: DepositCfg; pay: DepositPay } | null>(null);
  const load = useCallback(async () => {
    const { data: x } = await supabase.rpc('agenda_deposits', { p_restaurant_id: r.id });
    setData((x as { list: Deposit[]; cfg: DepositCfg; pay: DepositPay } | null) ?? null);
  }, [r.id]);
  useEffect(() => { load(); }, [load]);
  return { data, reload: load };
}

/** the WhatsApp message with how to pay (in the client's language when it is Arabic) */
export function depositText(r: Restaurant, d: Pick<Deposit, 'amount_cents' | 'due_at' | 'token' | 'name' | 'starts_at'>, pay: DepositPay, lang?: string | null) {
  const tz = r.timezone || 'UTC';
  const when = new Date(d.starts_at).toLocaleString(lang === 'ar' ? 'ar-MA' : 'fr-FR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const due = d.due_at ? new Date(d.due_at).toLocaleString(lang === 'ar' ? 'ar-MA' : 'fr-FR', { timeZone: tz, weekday: 'long', hour: '2-digit', minute: '2-digit' }) : '';
  const link = `${MENU_URL}/${r.slug}?rdv=${d.token}`;
  const ar = lang === 'ar';
  const ways = [
    pay.link ? `${ar ? 'الدفع أونلاين' : 'Paiement en ligne'} : ${pay.link}` : null,
    pay.rib ? `${ar ? 'تحويل بنكي' : 'Virement'} : ${pay.rib}${pay.rib_name ? ` (${pay.rib_name}${pay.bank ? `, ${pay.bank}` : ''})` : ''}` : null,
    pay.cashplus ? `CashPlus : ${pay.cashplus}` : null,
    ar ? 'ولا فالمحل.' : 'Ou directement sur place.',
  ].filter(Boolean);
  return ar
    ? [`السلام ${d.name}،`, `باش نأكدو موعدك ف ${r.name} (${when})، خاصك تخلص عربون ديال ${mad(d.amount_cents)}${due ? ` قبل ${due}` : ''}.`, '', ...ways, '', `من بعد الخلاص، ضغطي على "خلصت" هنا: ${link}`, 'شكرا!'].join('\n')
    : [`Bonjour ${d.name},`, `Pour confirmer votre rendez-vous chez ${r.name} (${when}), un acompte de ${mad(d.amount_cents)} est demandé${due ? `, à régler avant ${due}` : ''}.`, '', ...ways, '',
       `Après le paiement, appuyez sur « J’ai payé » ici : ${link}`, 'Il sera déduit le jour du rendez-vous. Merci !'].join('\n');
}

/** the deposit part of an appointment's sheet */
export function DepositBox({ r, appt, dep, pay, onChanged }: {
  r: Restaurant; dep: Deposit | null; pay: DepositPay | null; onChanged: () => void;
  appt: { id: string; status: string; starts_at: string; service_id: string | null; phone: string | null; name: string; lang?: string | null };
}) {
  const a = useAdminCtx();
  const tz = r.timezone || 'UTC';
  const [ask, setAsk] = useState<{ amount: string; hours: string } | null>(null);
  const [receive, setReceive] = useState(false);
  const [busy, setBusy] = useState(false);
  const upcoming = (appt.status === 'requested' || appt.status === 'confirmed') && new Date(appt.starts_at).getTime() > Date.now();
  const boss = a.role === 'owner' || a.role === 'manager' || a.isAdmin;
  const go = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); a.toast(ok); setAsk(null); setReceive(false); onChanged(); } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const openAsk = async () => {
    try {
      const x = await rpc<{ amount_cents: number; hours: number }>('agenda_deposit_rule', { p_restaurant_id: r.id, p_service: appt.service_id, p_phone: appt.phone });
      setAsk({ amount: x.amount_cents ? String(x.amount_cents / 100) : '', hours: String(x.hours || 24) });
    } catch (e) { a.fail(e); }
  };
  const due = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const amount = ask ? Math.round((Number(ask.amount.replace(',', '.')) || 0) * 100) : 0;

  if (!dep || dep.status === 'cancelled' || dep.status === 'expired') {
    if (!upcoming) return dep?.status === 'expired' ? <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">{t('Acompte non payé à temps : le rendez-vous a été annulé.')}</p> : null;
    return ask ? (
      <div className="space-y-3 rounded-2xl bg-amber-500/10 p-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('Acompte (DH)')}><input className={inputCls} inputMode="decimal" value={ask.amount} onChange={e => setAsk({ ...ask, amount: e.target.value })} placeholder="100" /></Field>
          <Field label={t('À payer dans (heures)')}><input className={inputCls} inputMode="numeric" value={ask.hours} onChange={e => setAsk({ ...ask, hours: e.target.value.replace(/\D/g, '') })} /></Field>
        </div>
        <div className="flex gap-2">
          <Btn className="flex-1" onClick={() => setAsk(null)}>{t('Annuler')}</Btn>
          <Btn tone="brand" className="flex-1" disabled={busy || amount < 1000 || !Number(ask.hours)}
            onClick={() => go(() => rpc('agenda_deposit_request', { p_restaurant_id: r.id, p_appointment: appt.id, p_amount_cents: amount, p_hours: Math.min(72, Math.max(1, Number(ask.hours))) }), t('Acompte demandé'))}>{t('Demander')}</Btn>
        </div>
      </div>
    ) : <Btn className="w-full" onClick={openAsk}><Coins className="h-4 w-4" /> {t('Demander un acompte')}</Btn>;
  }

  if (dep.status === 'pending') {
    const late = dep.due_at && new Date(dep.due_at).getTime() < Date.now();
    return (
      <div className="space-y-3 rounded-2xl bg-amber-500/10 p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-amber-700" />
          <span className="font-semibold">{t('Acompte à recevoir : {m}', { m: mad(dep.amount_cents) })}</span>
          <span className={late ? 'font-semibold text-danger' : 'text-muted'}>{late ? t('délai dépassé') : t('avant {d}', { d: due(dep.due_at) })}</span>
        </div>
        {dep.reported && <p className="rounded-xl bg-surface px-3 py-2 text-sm"><BadgeCheck className="me-1 inline h-4 w-4 text-emerald-600" />{t('La cliente dit avoir payé')}{dep.client_ref ? ` · ${t('réf. {r}', { r: dep.client_ref })}` : ''}</p>}
        {receive ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold">{t('Reçu comment ?')}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {['cash', 'card', 'transfer', 'cashplus', 'link', 'other'].map(m => (
                <Btn key={m} disabled={busy} onClick={() => go(() => rpc('agenda_deposit_paid', { p_restaurant_id: r.id, p_appointment: appt.id, p_method: m }), t('Acompte reçu'))}>{t(METHOD[m])}</Btn>
              ))}
            </div>
            <p className="text-xs text-muted">{t('Espèces et carte entrent dans la caisse du jour. Le reste est noté à part.')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Btn tone="brand" onClick={() => setReceive(true)}><Wallet className="h-4 w-4" /> {t('Acompte reçu')}</Btn>
            {appt.phone && pay ? <a href={waLink(appt.phone, depositText(r, { ...dep, name: appt.name }, pay, appt.lang))} target="_blank" rel="noopener"
              className="flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-3 py-2 text-sm font-semibold text-white"><MessageCircle className="h-4 w-4" />{t('Envoyer comment payer')}</a> : <span />}
            {upcoming && <button className="col-span-2 py-1 text-xs font-semibold text-muted hover:text-danger" disabled={busy}
              onClick={() => go(() => rpc('agenda_deposit_request', { p_restaurant_id: r.id, p_appointment: appt.id, p_amount_cents: 0 }), t('Acompte retiré'))}>{t('Ne plus demander d’acompte')}</button>}
          </div>
        )}
      </div>
    );
  }

  if (dep.status === 'to_settle') return (
    <div className="space-y-2 rounded-2xl bg-amber-500/10 p-3">
      <p className="text-sm font-semibold">{t('Rendez-vous annulé : l’acompte de {m} est à régler.', { m: mad(dep.amount_cents) })}</p>
      {boss ? <div className="grid gap-2 sm:grid-cols-3">
        <Btn disabled={busy} onClick={() => go(() => rpc('agenda_deposit_settle', { p_restaurant_id: r.id, p_deposit: dep.id, p_action: 'credit' }), t('Gardé comme avoir'))}>{t('Avoir pour la prochaine fois')}</Btn>
        <Btn disabled={busy} onClick={() => go(() => rpc('agenda_deposit_settle', { p_restaurant_id: r.id, p_deposit: dep.id, p_action: 'refund' }), t('Remboursé'))}><Undo2 className="h-4 w-4" /> {t('Rembourser')}</Btn>
        <Btn disabled={busy} onClick={() => go(() => rpc('agenda_deposit_settle', { p_restaurant_id: r.id, p_deposit: dep.id, p_action: 'keep' }), t('Gardé par le salon'))}>{t('Le salon le garde')}</Btn>
      </div> : <p className="text-xs text-muted">{t('Un responsable décide : avoir, remboursement ou gardé.')}</p>}
    </div>
  );

  const text = dep.status === 'paid'
    ? t('Acompte payé : {m} ({how}). Déduit à l’encaissement.', { m: mad(dep.amount_cents), how: methodLabel(dep.method) })
    : dep.status === 'kept' ? t('Acompte gardé par le salon : {m}.', { m: mad(dep.amount_cents) })
    : dep.status === 'credited' ? t('Acompte gardé comme avoir : {code}, solde {m}.', { code: dep.code ?? '', m: mad(dep.balance_cents ?? 0) })
    : t('Acompte remboursé : {m}.', { m: mad(dep.amount_cents) });
  return <p className={`rounded-xl px-3 py-2 text-sm font-semibold ${dep.status === 'paid' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-surface-2'}`}>{text}</p>;
}
