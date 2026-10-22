// Acomptes et no-shows: the rules (which prestations ask a deposit, from how many no-shows every
// booking of a client asks one, how long the client has to pay), how clients pay (RIB, CashPlus,
// the salon's own payment link), and the deposits to receive, to settle, and the recent ones.
import { useState } from 'react';
import { Clock, Coins, ExternalLink, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, Toggle, inputCls } from '../components/ui';
import { DepositBox, methodLabel, useDeposits, type Deposit } from '../components/Deposit';

const mad = (c: number) => `${(Number(c) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} DH`;

export function SalonDepositsPage({ r, onServices }: { r: Restaurant; onServices: () => void }) {
  const deps = useDeposits(r);
  const [open, setOpen] = useState<string | null>(null);
  const list = deps.data?.list ?? [];
  const pending = list.filter(d => d.status === 'pending');
  const settle = list.filter(d => d.status === 'to_settle');
  const done = list.filter(d => d.status !== 'pending' && d.status !== 'to_settle');
  const row = (d: Deposit) => {
    const when = new Date(d.starts_at).toLocaleString('fr-FR', { timeZone: r.timezone || 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return (
      <li key={d.id} className="py-3">
        <button className="flex w-full flex-wrap items-center gap-3 text-start" onClick={() => setOpen(open === d.id ? null : d.id)}>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{d.name}</p>
            <p className="text-sm text-muted first-letter:uppercase">{when} · {d.service?.fr || d.service?.ar || ''}</p>
          </div>
          {d.reported && d.status === 'pending' && <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700">{t('Dit avoir payé')}</span>}
          {d.status !== 'pending' && d.status !== 'to_settle' && <span className="text-sm text-muted">{STATUS_LABEL(d)}</span>}
          <span className="font-semibold tabular">{mad(d.amount_cents)}</span>
        </button>
        {open === d.id && <div className="mt-3"><DepositBox r={r} dep={d} pay={deps.data?.pay ?? null} onChanged={deps.reload}
          appt={{ id: d.appointment_id, status: d.appt_status, starts_at: d.starts_at, service_id: null, phone: d.phone, name: d.name }} /></div>}
      </li>
    );
  };
  return (
    <div className="space-y-5">
      <h1 className="font-display text-3xl font-semibold">{t('Acomptes et no-shows')}</h1>
      <p className="max-w-2xl text-sm text-muted">{t('Un acompte bloque le créneau jusqu’au paiement. Pas payé à temps : le créneau se libère et le rendez-vous est annulé. Le jour du rendez-vous, la caisse le déduit.')}</p>

      <Rules r={r} onServices={onServices} />

      <Card className="space-y-3">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold"><Clock className="h-5 w-5 text-amber-600" />{t('À recevoir')} <span className="text-base font-normal text-muted">{pending.length}</span></h2>
        {pending.length ? <ul className="divide-y divide-line/10">{pending.map(row)}</ul> : <p className="text-sm text-muted">{t('Aucun acompte en attente.')}</p>}
      </Card>
      {settle.length > 0 && <Card className="space-y-3">
        <h2 className="font-display text-xl font-semibold">{t('À régler après une annulation')} <span className="text-base font-normal text-muted">{settle.length}</span></h2>
        <ul className="divide-y divide-line/10">{settle.map(row)}</ul>
      </Card>}
      <Card className="space-y-3">
        <h2 className="font-display text-xl font-semibold">{t('Récents')}</h2>
        {done.length ? <ul className="divide-y divide-line/10">{done.map(row)}</ul> : <p className="text-sm text-muted">{t('Rien pour le moment.')}</p>}
      </Card>
    </div>
  );
}

const STATUS_LABEL = (d: Deposit) => ({
  paid: t('Payé ({how})', { how: methodLabel(d.method) }), kept: t('Gardé'), credited: t('Avoir {code}', { code: d.code ?? '' }),
  refunded: t('Remboursé'), expired: t('Pas payé à temps'), cancelled: t('Plus demandé'), pending: '', to_settle: '',
} as Record<string, string>)[d.status];

function Rules({ r, onServices }: { r: Restaurant; onServices: () => void }) {
  const a = useAdminCtx();
  const c = (r.agenda?.deposit ?? {}) as NonNullable<NonNullable<Restaurant['agenda']>['deposit']>;
  const [f, setF] = useState({
    enabled: !!c.enabled, after: String(c.after_no_shows ?? 2), noshow: String((c.noshow_cents ?? 10000) / 100), hours: String(c.hours ?? 24),
    rib: c.rib ?? '', rib_name: c.rib_name ?? '', bank: c.bank ?? '', cashplus: c.cashplus ?? '', link: c.link ?? '', note: c.note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const after = Number(f.after), noshow = Math.round((Number(f.noshow.replace(',', '.')) || 0) * 100), hours = Number(f.hours);
  const linkOk = !f.link.trim() || /^https:\/\/\S{4,}$/.test(f.link.trim());
  const bad = f.enabled && (!Number.isInteger(after) || after < 0 || after > 10 || (after > 0 && noshow < 1000) || !Number.isInteger(hours) || hours < 1 || hours > 72 || !linkOk);
  const save = async () => {
    setBusy(true);
    try {
      const deposit = { enabled: f.enabled, after_no_shows: after, noshow_cents: noshow || 10000, hours, rib: f.rib.trim(), rib_name: f.rib_name.trim(), bank: f.bank.trim(),
        cashplus: f.cashplus.trim(), link: f.link.trim(), note: f.note.trim() };
      check(await supabase.from('restaurants').update({ agenda: { ...(r.agenda ?? {}), deposit } }).eq('id', r.id).select('id'));
      a.toast(t('Enregistré')); await a.reload();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Coins className="h-5 w-5 text-brand" />
        <div className="me-auto"><h2 className="font-display text-xl font-semibold">{t('Règles')}</h2>
          <p className="text-sm text-muted">{t('Le montant par prestation se règle dans Prestations.')} <button className="font-semibold text-brand underline" onClick={onServices}>{t('Ouvrir les prestations')}</button></p></div>
        <Toggle checked={f.enabled} onChange={v => setF({ ...f, enabled: v })} label={t('Activés')} />
      </div>
      {f.enabled && <>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('Acompte pour tout RDV après')} hint={t('absences (0 = jamais)')}><input className={inputCls} inputMode="numeric" value={f.after} onChange={set('after')} /></Field>
          <Field label={t('Montant dans ce cas (DH)')}><input className={inputCls} inputMode="decimal" value={f.noshow} onChange={set('noshow')} disabled={after === 0} /></Field>
          <Field label={t('Délai pour payer (heures)')} hint={t('Au plus tard 1 h avant le RDV')}><input className={inputCls} inputMode="numeric" value={f.hours} onChange={set('hours')} /></Field>
        </div>
        <h3 className="pt-2 font-semibold">{t('Comment la cliente paie')}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('RIB')}><input className={inputCls} dir="ltr" maxLength={40} value={f.rib} onChange={set('rib')} placeholder="011 780 0000123456789 12" /></Field>
          <Field label={t('Au nom de')}><input className={inputCls} maxLength={60} value={f.rib_name} onChange={set('rib_name')} /></Field>
          <Field label={t('Banque')}><input className={inputCls} maxLength={40} value={f.bank} onChange={set('bank')} placeholder="CIH, Attijariwafa…" /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('CashPlus (nom et numéro)')}><input className={inputCls} maxLength={80} value={f.cashplus} onChange={set('cashplus')} /></Field>
          <Field label={t('Votre lien de paiement (facultatif)')} hint={linkOk ? t('Un lien YouCan Pay, PayZone, CMI… commençant par https://') : t('Le lien doit commencer par https://')}>
            <input className={inputCls} dir="ltr" maxLength={300} value={f.link} onChange={set('link')} placeholder="https://" /></Field>
        </div>
        <Field label={t('Note pour la cliente (facultatif)')}><input className={inputCls} maxLength={300} value={f.note} onChange={set('note')} placeholder={t('Indiquez votre nom dans le motif du virement.')} /></Field>
        <p className="flex gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted"><Info className="mt-0.5 h-4 w-4 shrink-0" />{t('Le paiement en ligne automatique demande un contrat du salon avec CMI, PayZone ou YouCan Pay. En attendant, vous confirmez la réception en un clic. Avec un contrat, nous branchons la confirmation automatique.')}
          {f.link.trim() && linkOk && <a className="ms-auto shrink-0 text-brand" href={f.link.trim()} target="_blank" rel="noopener" aria-label={t('Tester le lien')}><ExternalLink className="h-4 w-4" /></a>}</p>
      </>}
      <div className="flex justify-end"><Btn tone="brand" disabled={busy || bad} onClick={save}>{t('Enregistrer')}</Btn></div>
    </Card>
  );
}
