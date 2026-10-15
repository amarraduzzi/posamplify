// What will sell on a day, dish by dish (same weekday over the last 8 weeks, plus confirmed catering),
// and the ingredients that will run short.
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, TrendingDown, TrendingUp } from 'lucide-react';
import { tr, type Lang } from '@resto/shared';
import { mad, rpc } from '../lib/api';
import { getLang, t } from '../lib/i18n';
import { fmtQty } from '../lib/profit';
import { useAdminCtx } from '../store';
import type { BaseUnit, I18n, Restaurant } from '../lib/types';
import { Card } from './ui';

interface Dish { menu_item_id: string; name: I18n; expected: number; last_week: number; catering: number }
interface Need { ingredient_id: string; name: string; base_unit: BaseUnit; need: number; stock_qty: number | null; short: number | null }
interface Forecast {
  date: string; today: string; closed: boolean; basis: 'weekday' | 'all_days' | 'history_weekday' | 'history' | 'none'; basis_days: number;
  revenue_cents: number | null; tickets: number | null; dishes: Dish[]; ingredients: Need[];
}
// pieces are counted whole
const qty = (n: number, u: BaseUnit) => fmtQty(u === 'pc' ? Math.ceil(n - 1e-9) : n, u);
const BASIS: Record<Exclude<Forecast['basis'], 'none'>, string> = {
  // i18n:values
  weekday: 'Moyenne des {n} derniers jours identiques de la semaine.',
  all_days: 'Moyenne des {n} derniers jours (pas encore assez du même jour de la semaine).',
  history_weekday: 'D’après votre historique importé : {n} jours identiques de la semaine.',
  history: 'D’après votre historique importé : {n} jours.',
  // i18n:end
};

export function DemandForecast({ r, date }: { r: Restaurant; date: string }) {
  const a = useAdminCtx();
  const [f, setF] = useState<Forecast | null>(null);
  const [all, setAll] = useState(false);
  const [allIng, setAllIng] = useState(false);

  useEffect(() => {
    let on = true;
    setF(null);
    rpc<Forecast>('demand_forecast', { p_restaurant_id: r.id, p_date: date }).then(x => on && setF(x)).catch(e => on && a.fail(e));
    return () => { on = false; };
  }, [r.id, date, a]);

  if (!f) return null;
  const name = (n: I18n) => tr(n, getLang() as Lang, r.languages as Lang[]);
  const short = f.ingredients.filter(i => i.short != null && Number(i.short) > 0);
  const ok = f.ingredients.filter(i => !(i.short != null && Number(i.short) > 0));
  const dishes = all ? f.dishes : f.dishes.slice(0, 10);
  const tomorrow = f.date > f.today;

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div className="me-auto">
          <h2 className="font-display text-xl font-semibold">{t('Ce qui va se vendre')}</h2>
          {f.basis !== 'none' && !f.closed && <p className="text-sm text-muted">{t(BASIS[f.basis as Exclude<Forecast['basis'], 'none'>], { n: f.basis_days })}</p>}
        </div>
        {f.revenue_cents != null && (
          <div className="flex gap-6">
            <div><p className="text-xs text-muted">{t('Chiffre attendu')}</p><p className="font-display text-2xl font-semibold tabular">{mad(Math.round(Number(f.revenue_cents) / 100) * 100)}</p></div>
            <div><p className="text-xs text-muted">{t('Tickets')}</p><p className="font-display text-2xl font-semibold tabular">{f.tickets}</p></div>
          </div>
        )}
      </div>

      {f.closed && <p className="mb-4 rounded-2xl bg-surface-2 p-4 text-sm">{t('Fermé ce jour-là selon vos horaires.')}{f.dishes.length ? ` ${t('Seules les commandes traiteur comptent.')}` : ''}</p>}
      {f.basis === 'none' && !f.dishes.length ? (
        <p className="rounded-2xl border border-dashed border-line/20 p-6 text-center text-sm text-muted">
          {t('Pas encore assez de ventes pour prévoir. La prévision apparaît après une semaine de caisse, ou avec un historique des ventes par produit importé.')}
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <div>
            <p className="mb-2 text-sm font-bold">{t('Plats')}</p>
            <ul className="divide-y divide-line/10">
              {dishes.map(d => {
                const exp = Math.round(Number(d.expected));
                const lw = Number(d.last_week);
                const trend = lw > 0 && exp > 0 ? (exp > lw * 1.15 ? 'up' : exp < lw * 0.85 ? 'down' : null) : null;
                return (
                  <li key={d.menu_item_id} className="flex items-center gap-3 py-1.5">
                    <span className="w-10 shrink-0 text-end font-display text-lg font-semibold tabular">{exp + Number(d.catering)}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{name(d.name)}
                      {Number(d.catering) > 0 && <span className="ms-2 text-xs font-semibold text-brand">{t('dont {n} traiteur', { n: Number(d.catering) })}</span>}
                    </span>
                    {trend === 'up' && <TrendingUp className="h-4 w-4 shrink-0 text-ok" aria-label={t('Plus que la semaine dernière')} />}
                    {trend === 'down' && <TrendingDown className="h-4 w-4 shrink-0 text-muted" aria-label={t('Moins que la semaine dernière')} />}
                    <span className="w-24 shrink-0 text-end text-xs text-muted" title={t('semaine dernière : {n}', { n: lw })}>{t('sem. dern. {n}', { n: lw })}</span>
                  </li>
                );
              })}
            </ul>
            {f.dishes.length > 10 && (
              <button className="mt-2 text-sm font-semibold text-brand hover:underline" onClick={() => setAll(!all)}>
                {all ? t('Voir moins') : t('Voir les {n} plats', { n: f.dishes.length })}
              </button>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-bold">{t('Ingrédients')}</p>
            {!f.ingredients.length ? (
              <p className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">{t('Ajoutez des fiches techniques à vos plats pour voir les ingrédients nécessaires.')}</p>
            ) : (<>
              {short.length > 0 ? (
                <ul className="space-y-2">
                  {short.map(i => (
                    <li key={i.ingredient_id} className="flex items-start gap-2.5 rounded-2xl bg-danger/10 p-3 text-sm">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                      <span className="flex-1">
                        <b>{i.name}</b>: {t('il manque {x}', { x: qty(Number(i.short), i.base_unit) })}
                        <span className="block text-xs text-muted">{t('Besoin {n}, en stock {s}', { n: qty(Number(i.need), i.base_unit), s: qty(Math.max(0, Number(i.stock_qty)), i.base_unit) })}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-2 rounded-2xl bg-ok/10 p-3 text-sm"><CheckCircle2 className="h-4 w-4 text-ok" /> {t('Le stock suffit pour cette journée.')}</p>
              )}
              {ok.length > 0 && (
                <>
                  <button className="mt-3 text-sm font-semibold text-brand hover:underline" onClick={() => setAllIng(!allIng)}>
                    {allIng ? t('Masquer') : t('Voir les {n} autres ingrédients', { n: ok.length })}
                  </button>
                  {allIng && (
                    <ul className="mt-2 divide-y divide-line/10 text-sm">
                      {ok.map(i => (
                        <li key={i.ingredient_id} className="flex justify-between gap-3 py-1.5">
                          <span className="truncate">{i.name}</span>
                          <span className="shrink-0 tabular text-muted">{qty(Number(i.need), i.base_unit)}{i.stock_qty == null ? ` · ${t('pas encore compté')}` : ''}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              {tomorrow && <p className="mt-3 text-xs text-muted">{t('Le stock est celui de maintenant : les ventes de ce soir vont encore le baisser.')}</p>}
            </>)}
          </div>
        </div>
      )}
    </Card>
  );
}
