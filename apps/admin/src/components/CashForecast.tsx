// Cash forecast: the money available today (typed by the owner) plus the expected sales, minus the
// expected purchases, fixed costs and supplier invoices, day by day for the next 30 days.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Wallet } from 'lucide-react';
import { fromCents, mad, rpc, toCents } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn } from './ui';

interface Day { date: string; sales: number; purchases: number; fixed: number; suppliers: number; balance: number }
interface Forecast {
  today: string; days: number; start_cents: number | null; start_as_of: string | null;
  source: 'pos' | 'history' | 'month' | 'none'; basis_days: number; purchase_ratio: number; purchase_lag_days: number; ratio_source: 'purchases' | 'month' | 'default';
  rows: Day[]; totals: { sales: number; purchases: number; fixed: number; suppliers: number };
  end_cents: number; low: { date: string; balance: number }; first_negative: string | null;
  big_payments: { date: string; kind: 'fixed' | 'supplier'; name: string; amount: number }[];
}

const day = (d: string, long = false) => new Date(d + 'T12:00:00').toLocaleDateString(dateLocale(), long ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' });
const num = (v: unknown) => Number(v) || 0;
// a forecast in whole dirhams
const dh = (c: number) => mad(Math.round(c / 100) * 100);

export function CashForecast({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [f, setF] = useState<Forecast | null>(null);
  const [cash, setCash] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const x = await rpc<Forecast>('cash_forecast', { p_restaurant_id: r.id, p_days: 30 });
      setF(x); setCash(fromCents(x.start_cents));
    } catch (e) { a.fail(e); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!cash.trim()) return;
    setBusy(true);
    try { await rpc('set_cash_position', { p_restaurant_id: r.id, p_amount_cents: toCents(cash) }); a.toast(t('Enregistré')); await load(); } catch (e) { a.fail(e); }
    setBusy(false);
  };

  if (!f) return null;
  const known = f.start_cents != null;
  const noSales = f.source === 'none';
  const stale = known && f.start_as_of && f.start_as_of < f.today;
  const low = f.low ? num(f.low.balance) : 0;
  const short = !!f.first_negative;
  const end = num(f.end_cents);

  return (
    <section className="card mt-5 rounded-3xl p-6">
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <div className="me-auto max-w-xl">
          <h2 className="font-display text-xl font-semibold">{t('Trésorerie : les 30 prochains jours')}</h2>
          <p className="text-sm text-muted">{t('Ce qu’il restera en caisse et en banque si les ventes suivent le rythme des dernières semaines.')}</p>
        </div>
        <div className="rounded-2xl bg-surface-2 p-3">
          <label className="block text-xs font-semibold text-muted" htmlFor="cash-now">{t('Argent disponible aujourd’hui (caisse + banque)')}</label>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="flex items-center rounded-xl border border-line/15 bg-surface px-3 focus-within:border-brand">
              <input id="cash-now" className="w-28 bg-transparent py-2 font-semibold tabular outline-none" inputMode="decimal" value={cash}
                onChange={e => setCash(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} placeholder="25000" />
              <span className="text-sm text-muted">DH</span>
            </span>
            <Btn tone="brand" className="px-3 py-2" disabled={busy || !cash.trim()} onClick={save}>{t('Calculer')}</Btn>
          </div>
          {stale && <p className="mt-1.5 text-xs text-warn">{t('Montant du {d}. Mettez-le à jour pour une prévision juste.', { d: day(f.start_as_of!) })}</p>}
        </div>
      </div>

      {noSales ? (
        <p className="rounded-2xl border border-dashed border-line/20 p-6 text-center text-sm text-muted">
          {t('Pas encore assez de ventes pour prévoir. Il faut au moins 7 jours de caisse, un historique importé ou le chiffre d’affaires d’un mois.')}
        </p>
      ) : (<>
        {known ? (
          <div className={`mb-5 flex items-start gap-3 rounded-2xl p-4 ${short ? 'bg-danger/10 text-danger' : low < end * 0.25 ? 'bg-warn/10' : 'bg-ok/10'}`}>
            {short ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /> : <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-ok" />}
            <div>
              {short ? <>
                <p className="font-bold">{t('Si rien ne change, il vous manquera {x} le {d}.', { x: dh(-low), d: day(f.low.date, true) })}</p>
                <p className="mt-0.5 text-sm text-ink/70">{t('La caisse passe sous zéro dès le {d}. Encaissez plus tôt, décalez un paiement ou parlez à votre fournisseur avant cette date.', { d: day(f.first_negative!, true) })}</p>
              </> : <>
                <p className="font-bold">{t('Pas de manque prévu sur 30 jours.')}</p>
                <p className="mt-0.5 text-sm text-ink/70">{t('Au plus bas : {x} le {d}. Dans 30 jours : environ {e}.', { x: dh(low), d: day(f.low.date, true), e: dh(end) })}</p>
              </>}
            </div>
          </div>
        ) : (
          <p className="mb-5 rounded-2xl bg-surface-2 p-4 text-sm">{t('Indiquez l’argent disponible aujourd’hui pour voir le jour où la caisse risque de manquer.')}</p>
        )}

        {known && <Chart rows={f.rows} />}

        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <Total label={t('Ventes prévues')} value={`+ ${dh(num(f.totals.sales))}`} tone="ok" />
          <Total label={t('Achats de marchandises')} value={`− ${dh(num(f.totals.purchases))}`} hint={f.purchase_lag_days > 0 ? t('{p} % des ventes, payés après {n} jours', { p: Math.round(f.purchase_ratio * 100), n: f.purchase_lag_days }) : t('{p} % des ventes', { p: Math.round(f.purchase_ratio * 100) })} />
          <Total label={t('Charges fixes')} value={`− ${dh(num(f.totals.fixed))}`} />
          <Total label={t('Factures fournisseurs')} value={`− ${dh(num(f.totals.suppliers))}`} hint={t('déjà dues')} />
        </div>

        {f.big_payments.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-sm font-bold">{t('Gros paiements à venir')}</p>
            <ul className="divide-y divide-line/10 rounded-2xl border border-line/10">
              {f.big_payments.map((p, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-24 shrink-0 text-muted">{p.date <= f.today ? t('Aujourd’hui') : day(p.date)}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.name}<span className="ms-2 text-xs font-normal text-muted">{p.kind === 'supplier' ? (p.date <= f.today ? t('fournisseur, en retard') : t('fournisseur')) : t('charge fixe')}</span></span>
                  <span className="font-semibold tabular">− {dh(num(p.amount))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-4 text-xs text-muted">
          {f.source === 'month' ? t('Estimation basée sur le chiffre d’affaires mensuel saisi.') : t('Estimation basée sur {n} jours de ventes ({s}), jour par jour de la semaine.', { n: f.basis_days, s: f.source === 'pos' ? t('caisse Amplify') : t('historique importé') })}
          {' '}{f.ratio_source === 'default' ? t('Achats estimés à 32 % des ventes : enregistrez vos achats pour plus de précision.') : ''}
          {' '}{t('Les charges fixes sans jour de paiement sont réparties sur le mois.')}
        </p>
      </>)}
    </section>
  );
}

function Total({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'ok' }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-0.5 font-semibold tabular ${tone === 'ok' ? 'text-ok' : ''}`}>{value}</p>
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

// the balance as a line; below zero in red
function Chart({ rows }: { rows: Day[] }) {
  const W = 720, H = 180, P = 8;
  const vals = rows.map(x => num(x.balance));
  const max = Math.max(0, ...vals), min = Math.min(0, ...vals);
  const span = max - min || 1;
  const x = (i: number) => P + i * (W - 2 * P) / Math.max(1, rows.length - 1);
  const y = (v: number) => P + (max - v) * (H - 2 * P) / span;
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const zero = y(0);
  const area = `${line}L${x(rows.length - 1).toFixed(1)},${zero.toFixed(1)}L${x(0).toFixed(1)},${zero.toFixed(1)}Z`;
  const lowI = vals.indexOf(Math.min(...vals));
  const ticks = [0, 7, 14, 21, rows.length - 1].filter(i => i < rows.length);
  return (
    <div dir="ltr">
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="h-auto w-full" role="img" aria-label={t('Évolution de la trésorerie')}>
        <defs>
          <clipPath id="cf-above"><rect x="0" y="0" width={W} height={zero} /></clipPath>
          <clipPath id="cf-below"><rect x="0" y={zero} width={W} height={H - zero + 1} /></clipPath>
        </defs>
        <path d={area} className="fill-ok/10" clipPath="url(#cf-above)" />
        <path d={area} className="fill-danger/15" clipPath="url(#cf-below)" />
        <line x1={P} x2={W - P} y1={zero} y2={zero} className="stroke-line/30" strokeDasharray="4 4" />
        <path d={line} fill="none" className="stroke-ok" strokeWidth="2.5" strokeLinejoin="round" clipPath="url(#cf-above)" />
        <path d={line} fill="none" className="stroke-danger" strokeWidth="2.5" strokeLinejoin="round" clipPath="url(#cf-below)" />
        {lowI >= 0 && <circle cx={x(lowI)} cy={y(vals[lowI])} r="5" className={vals[lowI] < 0 ? 'fill-danger' : 'fill-ok'} />}
        {ticks.map(i => <text key={i} x={x(i)} y={H + 14} textAnchor={i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'} className="fill-muted text-[11px]">{day(rows[i].date)}</text>)}
      </svg>
    </div>
  );
}
