// Margins > "Pertes (péremption)": what expiry cost over the last 7 / 30 / 90 days, in dirhams. The figures come
// exactly from the database (expiry_losses): what was thrown away from a lot because it expired, valued at the
// cost of that lot, against the same number of days before, plus the expired stock that is still on the shelf.
import { useEffect, useState } from 'react';
import { CalendarDays, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { mad, rpc } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { fmtQty } from '../lib/profit';
import { useAdminCtx } from '../store';
import type { ExpiryLosses, Restaurant } from '../lib/types';

// i18n:values
const REASON: Record<string, string> = { expired: 'Périmé', damaged: 'Abîmé', returned: 'Rendu au fournisseur', quality: 'Qualité', other: 'Autre' };
// i18n:end
const PERIODS = [7, 30, 90];
const dayText = (d: string) => new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' });

export function ExpiryLossesView({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [days, setDays] = useState(30);
  const [d, setD] = useState<ExpiryLosses | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let stop = false;
    setD(null);
    rpc<ExpiryLosses>('expiry_losses', { p_restaurant_id: r.id, p_days: days })
      .then(x => { if (!stop) setD(x); })
      .catch(e => {
        if (stop) return;
        // database not updated yet (expiry_losses missing): say so quietly instead of an error toast
        if (/expiry_losses|function|schema cache|PGRST202/i.test(String((e as Error).message))) setUnavailable(true); else a.fail(e);
      });
    return () => { stop = true; };
  }, [r.id, days, a]);

  if (unavailable) return <div className="card rounded-3xl p-8 text-muted">{t('Ce rapport sera disponible après la prochaine mise à jour de la base de données.')}</div>;
  if (!d) return <p className="text-muted">{t('Chargement…')}</p>;

  if (d.tracking === 0) return (
    <div className="card rounded-3xl p-10 text-center">
      <CalendarDays className="mx-auto h-8 w-8 text-muted" />
      <h2 className="mt-3 font-display text-xl font-semibold">{t('Suivez les dates de péremption')}</h2>
      <p className="mx-auto mt-2 max-w-xl text-muted">{t('Activez le suivi des dates sur vos ingrédients (page Ingrédients) pour voir ici ce que la péremption vous coûte.')}</p>
    </div>
  );

  const total = Number(d.expired_cents), prev = Number(d.previous_cents);
  const change = prev ? Math.round(((total - prev) / prev) * 100) : null;
  const maxIng = Math.max(1, ...d.by_ingredient.map(i => Number(i.cents)));
  const maxDay = Math.max(1, ...d.by_day.map(x => Number(x.cents)));
  const nothing = d.expired_count === 0 && Number(d.other_cents) === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="me-auto text-sm text-muted">{t('Ce que vous avez jeté parce que la date était dépassée, au prix d’achat.')}</p>
        {PERIODS.map(n => (
          <button key={n} onClick={() => setDays(n)} className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${days === n ? 'bg-night text-white' : 'bg-surface-2 text-muted hover:text-ink'}`}>{t('{n} jours', { n })}</button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="night relative overflow-hidden rounded-2xl p-5 sm:col-span-1">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">{t('Pertes par péremption')}</p>
          <p className="mt-1 font-display text-4xl font-semibold tabular">{mad(total)}</p>
          <p className="mt-1 text-sm text-white/60">{t('sur {n} jours', { n: d.days })} · {d.expired_count} {t('perte(s)')}</p>
          {change !== null && (
            <span className={`mt-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${change > 0 ? 'bg-danger/20 text-[#F47171]' : change < 0 ? 'bg-ok/20 text-ok' : 'bg-white/10 text-white/70'}`}>
              {change > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : change < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
              <span dir="ltr">{change > 0 ? '+' : ''}{change} %</span> {t('par rapport aux {n} jours d’avant', { n: d.days })}
            </span>
          )}
          {change === null && total > 0 && <p className="mt-3 text-xs text-white/50">{t('Rien jeté pour cette raison les {n} jours d’avant.', { n: d.days })}</p>}
        </div>
        <div className="card rounded-2xl p-5">
          <p className="text-sm text-muted">{t('Périmé, pas encore jeté')}</p>
          <p className={`mt-1 font-display text-3xl font-semibold tabular ${d.at_stake.count ? 'text-danger' : ''}`}>{mad(Number(d.at_stake.cents))}</p>
          <p className="text-xs text-muted">{d.at_stake.count ? t('{n} livraison(s) en stock : à jeter', { n: d.at_stake.count }) : t('Rien de périmé en stock')}</p>
        </div>
        <div className="card rounded-2xl p-5">
          <p className="text-sm text-muted">{t('Autres pertes (abîmé, qualité…)')}</p>
          <p className="mt-1 font-display text-3xl font-semibold tabular">{mad(Number(d.other_cents))}</p>
          <p className="text-xs text-muted">{t('Jeté dans la période pour une autre raison que la date.')}</p>
        </div>
      </div>

      {(d.expired_unpriced > 0 || d.at_stake.unpriced > 0) && (
        <p className="rounded-2xl border border-warn/40 bg-warn/5 px-4 py-3 text-sm">{t('Certaines pertes n’ont pas de prix d’achat : le total est sous-estimé. Ajoutez le prix dans la page Ingrédients.')}</p>
      )}

      {nothing ? (
        <div className="card rounded-3xl p-8 text-center text-muted">{t('Aucune perte par péremption sur cette période.')}</div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="card rounded-3xl p-6">
            <h2 className="mb-4 font-display text-xl font-semibold">{t('Par ingrédient')}</h2>
            {d.by_ingredient.length ? (
              <ul className="space-y-3">
                {d.by_ingredient.map(i => (
                  <li key={i.ingredient_id}>
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate"><bdi className="font-semibold">{i.name}</bdi> <span className="text-muted">· {fmtQty(Number(i.qty), i.base_unit)}</span></span>
                      <span className="tabular">{Number(i.cents) > 0 ? mad(Number(i.cents)) : '—'}</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-surface-2"><div className="h-2 rounded-full bg-danger/70" style={{ width: `${(Number(i.cents) / maxIng) * 100}%` }} /></div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">{t('Aucune perte par péremption sur cette période.')}</p>}
          </section>

          <section className="card rounded-3xl p-6">
            <h2 className="mb-4 font-display text-xl font-semibold">{t('Par jour')}</h2>
            {d.by_day.length ? (
              <div className="flex h-40 items-end gap-1.5" dir="ltr">
                {d.by_day.map(x => (
                  <div key={x.date} className="flex h-full min-w-[10px] flex-1 flex-col justify-end" title={`${dayText(x.date)} · ${mad(Number(x.cents))}`}>
                    <div className="rounded-t-md bg-danger/70" style={{ height: `${Math.max(4, (Number(x.cents) / maxDay) * 100)}%` }} />
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted">{t('Aucune perte par péremption sur cette période.')}</p>}
            {d.by_reason.length > 0 && (
              <div className="mt-5 border-t border-line/[0.08] pt-4">
                <p className="mb-2 text-sm font-semibold text-muted">{t('Toutes les pertes par raison')}</p>
                <div className="flex flex-wrap gap-2">
                  {d.by_reason.map(x => <span key={x.reason} className="rounded-full bg-surface-2 px-3 py-1 text-sm">{t(REASON[x.reason] ?? 'Autre')} · {Number(x.cents) > 0 ? mad(Number(x.cents)) : x.n}</span>)}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
