// Production (pâtisserie, bakery, central kitchen): what to make today, from the sales of the same
// weekday and the confirmed catering orders, minus what is already in stock. "Produire" takes the
// ingredients out of the stock and puts the preparation in; a mistake can be cancelled.
import { useCallback, useEffect, useState } from 'react';
import { CookingPot, Undo2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, mad, rpc } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { BaseUnit, Restaurant } from '../lib/types';
import { RECIPE_UNITS, fmtQty } from '../lib/profit';
import { Btn, Card, inputCls } from '../components/ui';
import { DemandForecast } from '../components/DemandForecast';

interface PlanItem {
  ingredient_id: string; name: string; base_unit: BaseUnit; batch_qty: number; stock_qty: number | null; daily: number;
  made_today: number; catering: number; expired_qty?: number; suggested: number; cost_cents: number | null;
}
interface Batch { id: string; ingredient_id: string; qty: number; produced_on: string; cost_cents: number | null; note: string | null; cancelled_at: string | null; created_at: string }

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const num = (s: string) => Number(s.replace(',', '.')) || 0;
const show = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');
// the quantity is typed in the unit of the batch: pieces, or kg / litres when a batch is 1 kg or more
const unitOf = (i: Pick<PlanItem, 'base_unit' | 'batch_qty'>) => (i.base_unit === 'pc' ? RECIPE_UNITS.pc[0] : Number(i.batch_qty) >= 1000 ? RECIPE_UNITS[i.base_unit][RECIPE_UNITS[i.base_unit].length - 1] : RECIPE_UNITS[i.base_unit][0]);

export function ProductionPage({ r, onIngredients }: { r: Restaurant; onIngredients: () => void }) {
  const a = useAdminCtx();
  const [today, setToday] = useState<string | null>(null);
  const [day, setDay] = useState<0 | 1>(0);
  const [items, setItems] = useState<PlanItem[] | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const base = await rpc<{ date: string; items: PlanItem[] }>('production_plan', { p_restaurant_id: r.id, p_date: null });
      const dt = day ? addDays(base.date, 1) : base.date;
      const plan = day ? await rpc<{ date: string; items: PlanItem[] }>('production_plan', { p_restaurant_id: r.id, p_date: dt }) : base;
      setToday(base.date);
      setItems(plan.items);
      setQty(Object.fromEntries(plan.items.map(i => {
        const s = i.base_unit === 'pc' ? Math.ceil(Number(i.suggested)) : Number(i.suggested);
        return [i.ingredient_id, s > 0 ? show(s / unitOf(i).f) : ''];
      })));
      setBatches(check(await supabase.from('production_batches').select('id, ingredient_id, qty, produced_on, cost_cents, note, cancelled_at, created_at')
        .eq('restaurant_id', r.id).eq('produced_on', base.date).order('created_at', { ascending: false })) as Batch[]);
    } catch (e) { a.fail(e); setItems([]); }
  }, [r.id, day, a]);
  useEffect(() => { load(); }, [load]);

  const produce = async (i: PlanItem) => {
    const s = num(qty[i.ingredient_id] ?? '');
    const q = s * unitOf(i).f;
    if (!(q > 0)) { a.toast(t('Indiquez la quantité produite.'), 'error'); return; }
    setBusy(i.ingredient_id);
    try {
      const res = await rpc<{ cost_cents: number | null }>('production_record', { p_ingredient_id: i.ingredient_id, p_qty: q, p_note: null, p_catering_id: null });
      a.toast(t('{q} de {n} en stock', { q: fmtQty(q, i.base_unit), n: i.name }) + (res.cost_cents != null ? ` · ${mad(res.cost_cents)}` : ''));
      await load();
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      a.toast(m.includes('no_recipe') ? t('Cette préparation n’a pas encore de recette : ajoutez ses ingrédients sur la page Ingrédients.') : m, 'error');
    }
    setBusy(null);
  };
  const cancel = async (b: Batch) => {
    const n = items?.find(i => i.ingredient_id === b.ingredient_id)?.name ?? '';
    if (!window.confirm(t('Annuler cette production de {n} ? Les ingrédients reviennent en stock.', { n }))) return;
    try { await rpc('production_cancel', { p_id: b.id }); a.toast(t('Production annulée')); await load(); } catch (e) { a.fail(e); }
  };

  const nice = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const byId = new Map((items ?? []).map(i => [i.ingredient_id, i]));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="me-auto">
          <h1 className="font-display text-3xl font-semibold">{t('Production')}</h1>
          <p className="text-muted">{t('Ce qui va se vendre et ce qu’il faut préparer, d’après vos ventes du même jour de la semaine et vos commandes traiteur.')}</p>
        </div>
        <div className="flex rounded-2xl bg-surface-2 p-1">
          {([0, 1] as const).map(d => (
            <button key={d} type="button" onClick={() => setDay(d)} className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${day === d ? 'bg-surface shadow-sm' : 'text-muted hover:text-ink'}`}>
              {d ? t('Demain') : t('Aujourd’hui')}
            </button>
          ))}
        </div>
      </div>

      {today && <DemandForecast r={r} date={day ? addDays(today, 1) : today} />}

      {items === null ? <p className="text-muted">{t('Chargement…')}</p> : !items.length ? (
        <Card>
          <div className="flex flex-wrap items-center gap-4">
            <CookingPot className="h-8 w-8 shrink-0 text-brand" />
            <div className="min-w-[16rem] flex-1">
              <p className="font-semibold">{t('Aucune préparation faite à l’avance')}</p>
              <p className="text-sm text-muted">{t('Créez vos préparations (croissants, pâte feuilletée, crème…) sur la page Ingrédients avec « Nouvelle préparation », et cochez « Préparée à l’avance ». Elles apparaissent ici avec la quantité à produire.')}</p>
            </div>
            <Btn tone="ghost" onClick={onIngredients}>{t('Aller aux ingrédients')}</Btn>
          </div>
        </Card>
      ) : (
        <Card>
          <h2 className="mb-1 font-display text-xl font-semibold capitalize">{today ? nice(day ? addDays(today, 1) : today) : ''}</h2>
          <p className="mb-4 text-sm text-muted">{day ? t('Pour demain : le stock compté est celui de maintenant et une partie sera encore vendue aujourd’hui. Prévoyez un peu plus.') : t('La quantité proposée se modifie avant de produire.')}</p>
          <div className="divide-y divide-line/10">
            {items.map(i => {
              const stock = i.stock_qty == null ? null : Number(i.stock_qty);
              const u = unitOf(i);
              const perUnit = i.cost_cents != null && Number(i.batch_qty) > 0 ? i.cost_cents / Number(i.batch_qty) : null;
              const typed = num(qty[i.ingredient_id] ?? '') * u.f;
              return (
                <div key={i.ingredient_id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
                  <div className="min-w-[12rem] flex-1">
                    <p className="font-semibold">{i.name}</p>
                    <p className="text-sm text-muted">
                      {t('En stock')}: <b className={`tabular ${stock != null && stock < 0 ? 'text-danger' : 'text-ink'}`}>{stock == null ? t('pas encore compté') : fmtQty(stock, i.base_unit)}</b>
                      {' · '}{t('vendu en moyenne')}: <b className="tabular text-ink">{fmtQty(Number(i.daily), i.base_unit)}</b>
                      {Number(i.catering) > 0 && <> · {t('traiteur')}: <b className="tabular text-brand">{fmtQty(Number(i.catering), i.base_unit)}</b></>}
                      {Number(i.expired_qty) > 0 && <> · {t('Périmé')}: <b className="tabular text-danger">{fmtQty(Number(i.expired_qty), i.base_unit)}</b></>}
                      {Number(i.made_today) > 0 && <> · {t('déjà produit')}: <b className="tabular text-ok">{fmtQty(Number(i.made_today), i.base_unit)}</b></>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input className={`${inputCls} !w-24 text-end`} inputMode="decimal" aria-label={t('Quantité à produire')} value={qty[i.ingredient_id] ?? ''}
                      onChange={e => setQty({ ...qty, [i.ingredient_id]: e.target.value })} placeholder="0" />
                    <span className="w-6 text-sm text-muted">{u.u}</span>
                    <Btn tone="ghost" className="px-2.5 py-2 text-sm" title={t('Une fournée')} onClick={() => setQty({ ...qty, [i.ingredient_id]: show(Number(i.batch_qty) / u.f) })}>{t('1 fournée')}</Btn>
                    <Btn tone="brand" className="px-3 py-2 text-sm" disabled={busy === i.ingredient_id || day === 1} onClick={() => produce(i)}><CookingPot className="h-4 w-4" /> {t('Produire')}</Btn>
                  </div>
                  {perUnit != null && typed > 0 && <p className="w-full text-xs text-muted sm:w-auto">{t('Coût')}: {mad(Math.round(perUnit * typed))}</p>}
                </div>
              );
            })}
          </div>
          {day === 1 && <p className="mt-3 text-sm text-muted">{t('Vous enregistrez la production le jour où elle est faite.')}</p>}
        </Card>
      )}

      {batches.length > 0 && (
        <Card>
          <h2 className="mb-3 font-display text-xl font-semibold">{t('Produit aujourd’hui')}</h2>
          <ul className="space-y-2">
            {batches.map(b => {
              const i = byId.get(b.ingredient_id);
              return (
                <li key={b.id} className={`flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2.5 ${b.cancelled_at ? 'opacity-50' : ''}`}>
                  <span className="w-14 tabular text-muted" dir="ltr">{new Date(b.created_at).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', timeZone: r.timezone })}</span>
                  <span className={`flex-1 font-semibold ${b.cancelled_at ? 'line-through' : ''}`}>{i ? `${fmtQty(Number(b.qty), i.base_unit)} ${i.name}` : show(Number(b.qty))}</span>
                  {b.cost_cents != null && <span className="tabular text-sm text-muted">{mad(b.cost_cents)}</span>}
                  {b.cancelled_at ? <span className="text-xs font-semibold text-muted">{t('Annulée')}</span>
                    : <Btn tone="ghost" className="px-2.5 py-1 text-sm" onClick={() => cancel(b)}><Undo2 className="h-4 w-4" /> {t('Annuler')}</Btn>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
