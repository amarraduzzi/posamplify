import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Info, Lightbulb, TrendingDown, TrendingUp, Minus, Clock, Utensils, Users, Sparkles, RefreshCw } from 'lucide-react';
import { mad, rpc } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Card } from '../components/ui';
import { Star8 } from '../components/Brand';
import { dateLocale, getLang, t } from '../lib/i18n';
import { Btn } from '../components/ui';

// The owner's daily briefing. All figures come exactly from the database
// (owner_briefing); this page only turns them into plain-language signals.

interface Totals { tickets: number; revenue_ttc_cents: number; discounts_cents: number; credit_notes: number; credit_notes_cents: number;
  cancelled_orders: number; open_orders: number; cash_payouts_cents: number; payments: Record<string, number> }
interface Briefing {
  business_date: string; day_closed: boolean; today: Totals; last_week: Totals; avg_4w_revenue_cents: number;
  hours: { hour: number; revenue_cents: number; tickets: number }[];
  top_items: { name: string; qty: number; revenue_cents: number }[];
  slow_items: { name: string; price_cents: number }[];
  staff: { staff_id: string | null; name: string | null; orders: number; revenue_cents: number; discounted_orders: number; discount_cents: number; cancelled: number }[];
  cancel_reasons: { reason: string; count: number; amount_cents: number }[];
  channels: Record<string, number>;
}
type Level = 'warn' | 'info' | 'idea' | 'good';
interface Signal { level: Level; text: string }

const shift = (d: string, days: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + days); return x.toISOString().slice(0, 10); };
const weekday = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(dateLocale(), { weekday: 'long', timeZone: 'UTC' });
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);

/** Plain rules on exact numbers. Never an accusation: things "to check". */
function signals(b: Briefing, today: string, hasTables: boolean): Signal[] {
  const out: Signal[] = [];
  const rev = Number(b.today.revenue_ttc_cents), prev = Number(b.last_week.revenue_ttc_cents);
  const past = b.business_date < today;
  if (!b.today.tickets) { out.push({ level: 'info', text: t('Aucune vente enregistrée ce jour.') }); return out; }

  const d = pct(rev, prev);
  if (d !== null && d <= -15) out.push({ level: 'warn', text: t('Chiffre d’affaires en baisse de {p} % par rapport à {day} dernier ({m}).', { p: Math.abs(d), day: weekday(shift(b.business_date, -7)), m: mad(prev) }) });
  if (d !== null && d >= 15) out.push({ level: 'good', text: t('Chiffre d’affaires en hausse de {p} % par rapport à {day} dernier.', { p: d, day: weekday(shift(b.business_date, -7)) }) });

  const orders = b.staff.reduce((n, s) => n + s.orders, 0);
  for (const s of b.staff) {
    const name = s.name ?? t('Sans nom');
    const share = s.orders ? s.discounted_orders / s.orders : 0;
    if (s.discounted_orders >= 2 && (share >= 0.25 || Number(s.discount_cents) > 0.1 * Number(s.revenue_cents)))
      out.push({ level: 'warn', text: t('{name} : {n} remises ({m}) sur {o} commandes. Vérifiez qu’elles étaient justifiées.', { name, n: s.discounted_orders, m: mad(Number(s.discount_cents)), o: s.orders }) });
    if (s.cancelled >= 2)
      out.push({ level: 'warn', text: t('{name} : {n} commandes annulées. Regardez les motifs ci-dessous.', { name, n: s.cancelled }) });
  }
  if (b.today.credit_notes > 0)
    out.push({ level: 'info', text: t('{n} remboursement(s) pour {m}.', { n: b.today.credit_notes, m: mad(Math.abs(Number(b.today.credit_notes_cents))) }) });
  if (past && b.today.open_orders > 0)
    out.push({ level: 'warn', text: t('{n} commande(s) restée(s) ouverte(s) en fin de journée : encaissez-les ou annulez-les.', { n: b.today.open_orders }) });
  if (past && !b.day_closed)
    out.push({ level: 'info', text: t("La journée n'a pas été clôturée (rapport Z) sur la caisse.") });
  const cash = Number(b.today.payments.cash ?? 0);
  if (cash > 0 && Number(b.today.cash_payouts_cents) > 0.2 * cash)
    out.push({ level: 'info', text: t('Sorties de caisse élevées : {m}, soit {p} % des encaissements en espèces.', { m: mad(Number(b.today.cash_payouts_cents)), p: Math.round(Number(b.today.cash_payouts_cents) / cash * 100) }) });

  const peak = [...b.hours].sort((x, y) => Number(y.revenue_cents) - Number(x.revenue_cents))[0];
  if (peak && b.hours.length > 2)
    out.push({ level: 'idea', text: t('Votre heure la plus forte : {h}h ({m}). Prévoyez assez de personnel à ce moment.', { h: peak.hour, m: mad(Number(peak.revenue_cents)) }) });
  if (b.slow_items.length)
    out.push({ level: 'idea', text: t('{n} plat(s) sans aucune vente depuis 14 jours : {list}. Retirez-les du menu ou mettez-les en avant.', { n: b.slow_items.length, list: b.slow_items.slice(0, 4).map(i => i.name).join(', ') }) });
  const qr = b.channels.qr ?? 0;
  if (hasTables && orders >= 10 && qr === 0)
    out.push({ level: 'idea', text: t('Aucune commande par QR code. Posez les QR codes bien visibles sur les tables : vos clients commandent plus vite.') });
  if (b.top_items[0])
    out.push({ level: 'idea', text: t('Meilleure vente : {name} ({n} vendus). Mettez une belle photo sur le menu pour la vendre encore plus.', { name: b.top_items[0].name, n: b.top_items[0].qty }) });
  const order: Level[] = ['warn', 'good', 'info', 'idea'];
  return out.sort((x, y) => order.indexOf(x.level) - order.indexOf(y.level));
}

const LEVEL: Record<Level, { Icon: typeof Info; cls: string }> = {
  warn: { Icon: AlertTriangle, cls: 'bg-danger/10 text-danger' },
  good: { Icon: TrendingUp, cls: 'bg-ok/15 text-ok' },
  info: { Icon: Info, cls: 'bg-surface-2 text-muted' },
  idea: { Icon: Lightbulb, cls: 'bg-brand/15 text-brand' },
};

export function BriefingPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [date, setDate] = useState<string | null>(null);
  const [today, setToday] = useState<string>('');
  const [b, setB] = useState<Briefing | null>(null);
  const [hasTables, setHasTables] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const x = await rpc<Briefing>('owner_briefing', { p_restaurant_id: r.id, p_business_date: date });
        if (stop) return;
        if (!date) setToday(x.business_date);
        setB(x);
      } catch (e) {
        // database not updated yet (owner_briefing missing): say so quietly instead of an error toast
        if (/owner_briefing|function|schema cache|PGRST202/i.test(String((e as Error).message))) setUnavailable(true);
        else a.fail(e);
      }
    })();
    return () => { stop = true; };
  }, [r.id, date, a]);
  useEffect(() => {
    supabase.from('dining_tables').select('id', { count: 'exact', head: true }).eq('restaurant_id', r.id)
      .then(res => setHasTables((res.count ?? 0) > 0));
  }, [r.id]);

  const list = useMemo(() => (b && today ? signals(b, today, hasTables) : []), [b, today, hasTables]);
  if (unavailable) return <Card><h1 className="font-display text-2xl font-semibold">{t('Briefing')}</h1><p className="mt-2 text-muted">{t('Le briefing sera disponible après la prochaine mise à jour de la base de données.')}</p></Card>;
  if (!b) return <p className="text-muted">{t('Chargement…')}</p>;

  const rev = Number(b.today.revenue_ttc_cents), prev = Number(b.last_week.revenue_ttc_cents);
  const d = pct(rev, prev), d4 = pct(rev, Number(b.avg_4w_revenue_cents));
  const avg = b.today.tickets ? Math.round(rev / b.today.tickets) : 0;
  const maxHour = Math.max(1, ...b.hours.map(h => Number(h.revenue_cents)));
  const maxQty = Math.max(1, ...b.top_items.map(i => i.qty));
  const isToday = b.business_date === today;
  const Delta = ({ v, label }: { v: number | null; label: string }) => v === null ? null : (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${v > 0 ? 'bg-ok/15 text-ok' : v < 0 ? 'bg-danger/10 text-danger' : 'bg-surface-2 text-muted'}`}>
      {v > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : v < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
      <span dir="ltr">{v > 0 ? '+' : ''}{v} %</span> {label}
    </span>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="me-auto">
          <h1 className="font-display text-3xl font-semibold">{t('Briefing')}</h1>
          <p className="mt-1 text-muted first-letter:uppercase">
            {new Date(`${b.business_date}T12:00:00Z`).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}
            {isToday && ` · ${t("aujourd'hui, en cours")}`}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-2xl border border-line/[0.1] bg-surface p-1">
          <button onClick={() => setDate(shift(b.business_date, -1))} aria-label={t('Jour précédent')} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-surface-2"><ChevronLeft className="h-5 w-5 rtl:rotate-180" /></button>
          {!isToday && <button onClick={() => setDate(null)} className="h-10 rounded-xl px-3 text-sm font-semibold hover:bg-surface-2">{t("Aujourd'hui")}</button>}
          <button onClick={() => setDate(shift(b.business_date, 1))} disabled={isToday} aria-label={t('Jour suivant')} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-surface-2 disabled:opacity-30"><ChevronRight className="h-5 w-5 rtl:rotate-180" /></button>
        </div>
      </div>

      {/* headline */}
      <div className="night relative overflow-hidden rounded-[2rem] p-6 md:p-8 text-white">
        <Star8 filled={false} stroke={0.3} className="absolute -end-16 -top-16 h-72 w-72 text-brand/20" />
        <p className="relative text-xs font-bold uppercase tracking-[0.25em] text-brand">{t("Chiffre d'affaires TTC")}</p>
        <p className="relative mt-2 font-display text-5xl font-semibold md:text-6xl">{mad(rev)}</p>
        <div className="relative mt-4 flex flex-wrap gap-2">
          <Delta v={d} label={t('vs {day} dernier', { day: weekday(shift(b.business_date, -7)) })} />
          <Delta v={d4} label={t('vs moyenne des 4 derniers {day}s', { day: weekday(b.business_date) })} />
        </div>
        <div className="relative mt-6 grid grid-cols-3 gap-3 border-t border-white/10 pt-5 text-sm">
          <div><p className="text-white/50">{t('Tickets')}</p><p className="mt-1 text-2xl font-bold">{b.today.tickets}</p></div>
          <div><p className="text-white/50">{t('Ticket moyen')}</p><p className="mt-1 text-2xl font-bold">{avg ? mad(avg) : '—'}</p></div>
          <div><p className="text-white/50">{t('Remises')}</p><p className="mt-1 text-2xl font-bold">{mad(Number(b.today.discounts_cents))}</p></div>
        </div>
      </div>

      {b.today.tickets > 0 && <Advisor r={r} date={b.business_date} />}

      {/* signals */}
      <Card>
        <h2 className="mb-1 font-display text-2xl font-semibold">{t('Ce qu’il faut retenir')}</h2>
        <p className="mb-4 text-sm text-muted">{t('Calculé sur vos ventes réelles. « À vérifier » ne veut pas dire qu’il y a un problème : jetez simplement un œil.')}</p>
        <ul className="space-y-2.5">
          {list.map((s, i) => {
            const L = LEVEL[s.level];
            return (
              <li key={i} className="flex items-start gap-3 rounded-2xl border border-line/[0.08] px-4 py-3">
                <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${L.cls}`}><L.Icon className="h-4 w-4" /></span>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{s.level === 'warn' ? t('À vérifier') : s.level === 'good' ? t('Bonne nouvelle') : s.level === 'idea' ? t('Idée') : t('Info')}</p>
                  <p className="mt-0.5 leading-relaxed">{s.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 flex items-center gap-2 font-display text-xl font-semibold"><Clock className="h-5 w-5 text-brand" />{t('Ventes par heure')}</h2>
          {b.hours.length ? (
            <div className="flex h-44 items-end gap-1.5" dir="ltr">
              {Array.from({ length: 24 }, (_, h) => b.hours.find(x => x.hour === h)).map((x, h) => (
                <div key={h} className="group relative flex h-full flex-1 flex-col justify-end">
                  <div className={`rounded-t-md ${x ? 'bg-brand' : 'bg-surface-2'}`} style={{ height: `${x ? Math.max(4, (Number(x.revenue_cents) / maxHour) * 100) : 2}%` }} title={x ? `${h}h · ${mad(Number(x.revenue_cents))}` : `${h}h`} />
                  {h % 3 === 0 && <span className="mt-1 text-center text-[10px] text-muted">{h}h</span>}
                </div>
              ))}
            </div>
          ) : <p className="text-muted">{t('Aucune vente.')}</p>}
        </Card>

        <Card>
          <h2 className="mb-4 flex items-center gap-2 font-display text-xl font-semibold"><Utensils className="h-5 w-5 text-brand" />{t('Meilleures ventes')}</h2>
          {b.top_items.length ? (
            <ul className="space-y-2.5">
              {b.top_items.map(i => (
                <li key={i.name}>
                  <div className="flex justify-between text-sm"><bdi className="font-semibold">{i.name}</bdi><span className="text-muted tabular">{i.qty} · {mad(Number(i.revenue_cents))}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-surface-2"><div className="h-2 rounded-full bg-brand" style={{ width: `${(i.qty / maxQty) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          ) : <p className="text-muted">{t('Aucune vente.')}</p>}
        </Card>
      </div>

      <Card>
        <h2 className="mb-4 flex items-center gap-2 font-display text-xl font-semibold"><Users className="h-5 w-5 text-brand" />{t('Par employé')}</h2>
        {b.staff.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted"><tr className="text-start">
                <th className="py-2 text-start font-semibold">{t('Employé')}</th>
                <th className="text-end font-semibold">{t('Commandes')}</th>
                <th className="text-end font-semibold">{t('Ventes')}</th>
                <th className="text-end font-semibold">{t('Remises')}</th>
                <th className="text-end font-semibold">{t('Annulations')}</th>
              </tr></thead>
              <tbody>
                {b.staff.map(s => (
                  <tr key={s.staff_id ?? 'none'} className="border-t border-line/[0.08]">
                    <td className="py-2.5 font-semibold">{s.name ?? t('Sans nom')}</td>
                    <td className="text-end tabular">{s.orders}</td>
                    <td className="text-end tabular">{mad(Number(s.revenue_cents))}</td>
                    <td className={`text-end tabular ${s.discounted_orders >= 2 ? 'font-bold text-danger' : ''}`}>{s.discounted_orders ? `${s.discounted_orders} · ${mad(Number(s.discount_cents))}` : '—'}</td>
                    <td className={`text-end tabular ${s.cancelled >= 2 ? 'font-bold text-danger' : ''}`}>{s.cancelled || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-muted">{t('Aucune vente.')}</p>}
        {b.cancel_reasons.length > 0 && (
          <div className="mt-5 border-t border-line/[0.08] pt-4">
            <p className="mb-2 text-sm font-semibold text-muted">{t('Motifs d’annulation')}</p>
            <div className="flex flex-wrap gap-2">
              {b.cancel_reasons.map(c => <span key={c.reason} className="rounded-full bg-surface-2 px-3 py-1 text-sm"><bdi>{c.reason === '?' ? t('Sans motif') : c.reason}</bdi> · {c.count}</span>)}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI advisor: the same exact figures, explained in plain words (Edge Function
// "briefing-ai"). Cached per restaurant, day and language on this device.
// ---------------------------------------------------------------------------
interface Advice { summary: string; actions: string[]; watch: string[] }

function Advisor({ r, date }: { r: Restaurant; date: string }) {
  const lang = getLang();
  const key = `advice:${r.id}:${date}:${lang}`;
  const read = (): Advice | null => { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } };
  const [advice, setAdvice] = useState<Advice | null>(read);
  const [state, setState] = useState<'idle' | 'busy' | 'off' | 'error'>('idle');
  useEffect(() => { setAdvice(read()); setState('idle'); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = async () => {
    setState('busy');
    const { data, error } = await supabase.functions.invoke('briefing-ai', { body: { restaurant_id: r.id, business_date: date, lang } });
    if (error || !data || data.error) {
      const code = (data && data.error) || '';
      const ctx = (error as { context?: Response } | null)?.context;
      const body = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
      setState(code === 'ai_not_configured' || body?.error === 'ai_not_configured' || (ctx && ctx.status === 404) ? 'off' : 'error');
      return;
    }
    setAdvice(data as Advice);
    try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* ignore */ }
    setState('idle');
  };

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-brand/30 bg-gradient-to-br from-brand/10 via-surface to-surface p-6">
      <Star8 filled={false} stroke={0.3} className="absolute -end-12 -bottom-12 h-48 w-48 text-brand/15" />
      <div className="relative flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-full gold-fill text-brand-ink"><Sparkles className="h-5 w-5" /></span>
        <div className="me-auto">
          <h2 className="font-display text-2xl font-semibold">{t('Votre conseiller')}</h2>
          <p className="text-sm text-muted">{t('Le résumé de la journée et 3 actions pour demain, écrits à partir de vos vrais chiffres.')}</p>
        </div>
        {state !== 'off' && (
          <Btn tone={advice ? 'plain' : 'brand'} onClick={ask} disabled={state === 'busy'}>
            {advice ? <RefreshCw className={`h-4 w-4 ${state === 'busy' ? 'animate-spin' : ''}`} /> : <Sparkles className="h-4 w-4" />}
            {state === 'busy' ? t('Analyse en cours…') : advice ? t('Actualiser') : t('Demander le résumé')}
          </Btn>
        )}
      </div>
      {state === 'off' && <p className="relative mt-4 rounded-xl bg-surface-2 px-4 py-3 text-sm">{t('Le conseiller IA sera bientôt activé pour votre restaurant.')}</p>}
      {state === 'error' && <p className="relative mt-4 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{t('Le conseiller ne répond pas pour le moment. Réessayez dans un instant.')}</p>}
      {advice && (
        <div className="relative mt-5 space-y-4">
          <p className="text-[17px] leading-relaxed">{advice.summary}</p>
          {advice.actions.length > 0 && (
            <ol className="space-y-2">
              {advice.actions.map((x, i) => (
                <li key={i} className="flex gap-3 rounded-2xl bg-surface/80 px-4 py-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-brand-ink">{i + 1}</span>
                  <span className="leading-relaxed">{x}</span>
                </li>
              ))}
            </ol>
          )}
          {advice.watch.length > 0 && (
            <div className="rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3">
              <p className="mb-1 text-xs font-bold uppercase tracking-wider text-danger">{t('À vérifier')}</p>
              {advice.watch.map((x, i) => <p key={i} className="leading-relaxed">{x}</p>)}
            </div>
          )}
          <p className="text-xs text-muted">{t('Texte rédigé par une IA à partir des chiffres ci-dessous. Les chiffres, eux, sont exacts.')}</p>
        </div>
      )}
    </div>
  );
}
