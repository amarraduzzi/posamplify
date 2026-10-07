// The owner's live view, made for a phone: today so far and what deserves a look. Refreshes itself.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Ban, Banknote, Boxes, Clock, MessageCircle, PauseCircle, Percent, RefreshCw, Trash2, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, mad, rpc } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card, Field, inputCls } from '../components/ui';

interface Alert { kind: 'discount' | 'cancel' | 'removed' | 'payout' | 'cash_gap' | 'stock' | 'paused'; at: string; amount: number | null; staff: string | null; ref: string | null }
interface Live {
  today: string; revenue_cents: number; tickets: number; last_week_same_time_cents: number; last_week_total_cents: number;
  open_orders: number; open_cents: number; tables_busy: number; guests_waiting: number; day_closed: boolean;
  on_duty: { name: string; since: string }[]; payments: Record<string, number>; last_sales: { at: string; total: number; staff: string | null }[]; alerts: Alert[];
}
// i18n:values
const METHOD: Record<string, string> = { cash: 'Espèces', card: 'Carte', transfer: 'Virement', account: 'Ardoise' };
// i18n:end
const ICON = { discount: Percent, cancel: Ban, removed: Trash2, payout: Banknote, cash_gap: AlertTriangle, stock: Boxes, paused: PauseCircle };

export function LivePage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [d, setD] = useState<Live | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const load = useCallback(async () => { try { setD(await rpc<Live>('owner_live', { p_restaurant_id: r.id })); setAt(new Date()); } catch (e) { a.fail(e); } }, [r.id, a]);
  useEffect(() => { load(); const iv = setInterval(() => { if (!document.hidden) load(); }, 30_000); return () => clearInterval(iv); }, [load]);
  const hm = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { timeZone: r.timezone, hour: '2-digit', minute: '2-digit' });
  const delta = d && d.last_week_same_time_cents > 0 ? Math.round((d.revenue_cents / d.last_week_same_time_cents - 1) * 100) : null;
  const text = (x: Alert) => {
    const who = x.staff ? ` · ${x.staff}` : '';
    switch (x.kind) {
      case 'discount': return t('Remise de {m} sur le ticket {n}', { m: mad(Number(x.amount)), n: x.ref ?? '' }) + who;
      case 'cancel': return t('Commande {n} annulée après envoi en cuisine ({m})', { n: x.ref ?? '', m: mad(Number(x.amount)) }) + who;
      case 'removed': return t('« {p} » retiré après la cuisine ({m})', { p: x.ref ?? '', m: mad(Number(x.amount)) }) + who;
      case 'payout': return t('Sortie de caisse de {m} : {r}', { m: mad(Number(x.amount)), r: x.ref ?? '' }) + who;
      case 'cash_gap': return t('Écart de caisse de {m} à la clôture du {d}', { m: mad(Number(x.amount)), d: x.ref ?? '' }) + who;
      case 'stock': return t('Stock bas : {p}', { p: x.ref ?? '' });
      case 'paused': return t('Commandes en ligne en pause jusqu’à {h}', { h: x.ref ? hm(x.ref) : '' });
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-end gap-3">
        <div className="me-auto">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-brand"><span className="h-2 w-2 animate-pulse rounded-full bg-brand" />{t('En direct')}</p>
          <h1 className="font-display text-3xl font-semibold">{r.name}</h1>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-sm text-muted"><RefreshCw className="h-4 w-4" />{at ? at.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' }) : '…'}</button>
      </div>

      {!d ? <p className="text-muted">{t('Chargement…')}</p> : <>
        <div className="night rounded-[2rem] p-6">
          <p className="text-sm text-white/60">{t('Chiffre d’affaires aujourd’hui')}{d.day_closed ? ` · ${t('journée clôturée')}` : ''}</p>
          <p className="font-display text-5xl font-semibold tabular text-white">{mad(d.revenue_cents)}</p>
          <p className="mt-1 text-sm text-white/70">
            {t('{n} tickets', { n: d.tickets })}{d.tickets ? ` · ${t('ticket moyen {m}', { m: mad(Math.round(d.revenue_cents / d.tickets)) })}` : ''}
          </p>
          {d.last_week_total_cents > 0 && (
            <p className="mt-3 text-sm text-white/80">
              {delta != null && <b className={delta >= 0 ? 'text-brand' : 'text-[#F47171]'}>{delta >= 0 ? '+' : ''}{delta} % </b>}
              {t('vs la semaine dernière à la même heure ({m}, journée entière {t})', { m: mad(d.last_week_same_time_cents), t: mad(d.last_week_total_cents) })}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {Object.entries(d.payments).map(([k, v]) => <span key={k} className="rounded-full bg-white/10 px-3 py-1 text-sm text-white">{t(METHOD[k] ?? k)} <b className="tabular">{mad(Number(v))}</b></span>)}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t('Commandes ouvertes')} value={String(d.open_orders)} hint={mad(d.open_cents)} />
          <Stat label={t('Tables occupées')} value={String(d.tables_busy)} />
          <Stat label={t('Clients en attente')} value={String(d.guests_waiting)} warn={d.guests_waiting > 0} />
          <Stat label={t('Équipe présente')} value={String(d.on_duty.length)} hint={d.on_duty.map(x => x.name).join(', ')} />
        </div>

        <Card>
          <h2 className="mb-2 flex items-center gap-2 font-display text-xl font-semibold"><AlertTriangle className="h-5 w-5 text-warn" />{t('À regarder aujourd’hui')}</h2>
          {!d.alerts.length ? <p className="py-2 text-sm text-ok">{t('Rien d’anormal pour l’instant.')}</p> : (
            <ul className="divide-y divide-line/10">
              {d.alerts.map((x, i) => { const I = ICON[x.kind]; return (
                <li key={i} className="flex items-start gap-3 py-2.5 text-sm">
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${x.kind === 'cash_gap' || x.kind === 'removed' || x.kind === 'cancel' ? 'bg-danger/10 text-danger' : 'bg-warn/10 text-warn'}`}><I className="h-4 w-4" /></span>
                  <span className="flex-1">{text(x)}</span>
                  {x.kind !== 'stock' && x.kind !== 'paused' && <span className="text-xs text-muted tabular">{hm(x.at)}</span>}
                </li>
              ); })}
            </ul>
          )}
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <h2 className="mb-2 flex items-center gap-2 font-semibold"><Clock className="h-4 w-4 text-brand" />{t('Dernières ventes')}</h2>
            {!d.last_sales.length ? <p className="text-sm text-muted">{t('Aucune vente aujourd’hui.')}</p> : (
              <ul className="space-y-1.5 text-sm">{d.last_sales.map((x, i) => <li key={i} className="flex justify-between"><span className="text-muted tabular">{hm(x.at)}{x.staff ? ` · ${x.staff}` : ''}</span><b className="tabular">{mad(Number(x.total))}</b></li>)}</ul>
            )}
          </Card>
          <Card>
            <h2 className="mb-2 flex items-center gap-2 font-semibold"><Users className="h-4 w-4 text-brand" />{t('Équipe présente')}</h2>
            {!d.on_duty.length ? <p className="text-sm text-muted">{t('Personne n’a pointé.')}</p> : (
              <ul className="space-y-1.5 text-sm">{d.on_duty.map((x, i) => <li key={i} className="flex justify-between"><span>{x.name}</span><span className="text-muted tabular">{t('depuis {h}', { h: hm(x.since) })}</span></li>)}</ul>
            )}
          </Card>
        </div>
        <OwnerPhone r={r} />
      </>}
    </div>
  );
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className="card rounded-3xl p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`font-display text-3xl font-semibold tabular ${warn ? 'text-warn' : ''}`}>{value}</p>
      {hint && <p className="truncate text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Where the till sends the Z report (a WhatsApp link the manager taps after closing). */
function OwnerPhone({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [v, setV] = useState(r.owner_whatsapp ?? '');
  if (!a.canEditProfile) return null;
  const save = async () => {
    try { check(await supabase.from('restaurants').update({ owner_whatsapp: v.trim() || null }).eq('id', r.id).select('id')); a.toast(t('Enregistré')); await a.reload(); } catch (e) { a.fail(e); }
  };
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-semibold"><MessageCircle className="h-4 w-4 text-[#25D366]" />{t('Rapport Z sur WhatsApp')}</h2>
      <p className="mb-3 text-sm text-muted">{t('Après la clôture, la caisse propose d’envoyer le rapport Z (chiffre, paiements, remises, écart de caisse) à ce numéro, en un geste.')}</p>
      <div className="flex gap-2">
        <div className="flex-1"><Field label={t('Votre numéro WhatsApp')}><input className={inputCls} inputMode="tel" dir="ltr" value={v} onChange={e => setV(e.target.value.replace(/[^\d+ ]/g, ''))} placeholder="+212 6…" /></Field></div>
        <Btn tone="brand" className="self-end" onClick={save}>{t('Enregistrer')}</Btn>
      </div>
    </Card>
  );
}
