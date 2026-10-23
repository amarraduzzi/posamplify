// End of the day: per preparation, what was planned, what was made, and what is really left (counted).
// What is left is either kept for tomorrow (the stock becomes the count) or thrown away (counted, then
// written off as waste, with its value). The difference between the stock and the count is corrected.
import { useState } from 'react';
import { Check, Moon, Trash2 } from 'lucide-react';
import { mad, rpc } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { BaseUnit, Restaurant } from '../lib/types';
import { fmtQty } from '../lib/profit';
import { Btn, Card, inputCls } from './ui';
import { Smooth } from './Smooth';
import { num, show, unitOf } from './ProductionPlanner';

export interface DayEndItem { ingredient_id: string; name: string; base_unit: BaseUnit; batch_qty: number; stock_qty: number | null; made_today: number; cost_cents: number | null }
interface PlanLine { ingredient_id: string; planned_qty: number; status: 'pending' | 'done' | 'skipped' }

export function ProductionDayEnd({ r, today, items, onChanged }: { r: Restaurant; today: string; items: DayEndItem[]; onChanged: () => Promise<void> | void }) {
  const a = useAdminCtx();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<Map<string, PlanLine>>(new Map());
  const [left, setLeft] = useState<Record<string, string>>({});
  const [toss, setToss] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const openIt = async () => {
    setOpen(o => !o); setResult(null);
    try {
      const d = await rpc<{ plan: { lines: PlanLine[] } | null }>('production_day', { p_restaurant_id: r.id, p_date: today });
      setPlan(new Map((d.plan?.lines ?? []).map(l => [l.ingredient_id, l])));
    } catch (e) { a.fail(e); }
  };
  // what matters tonight: what was planned, made, or is still in stock
  const rows = items.filter(i => plan.has(i.ingredient_id) || Number(i.made_today) > 0 || Number(i.stock_qty) > 0);

  const save = async () => {
    const todo = rows.filter(i => (left[i.ingredient_id] ?? '').trim() !== '');
    if (!todo.length) { a.toast(t('Indiquez ce qui reste pour au moins une préparation.'), 'error'); return; }
    setBusy(true);
    let thrownCents = 0, thrown = 0, kept = 0;
    try {
      for (const i of todo) {
        const q = num(left[i.ingredient_id]) * unitOf(i).f;
        await rpc('stock_set', { p_ingredient_id: i.ingredient_id, p_qty: q, p_note: t('Fin de journée') });
        if (toss[i.ingredient_id] && q > 0) {
          await rpc('stock_waste', { p_ingredient_id: i.ingredient_id, p_qty: q, p_reason: t('Invendu, jeté en fin de journée') });
          thrown++;
          if (i.cost_cents != null && Number(i.batch_qty) > 0) thrownCents += Math.round(i.cost_cents / Number(i.batch_qty) * q);
        } else kept++;
      }
      setResult(t('Fin de journée enregistrée : {k} gardé(s) pour demain, {j} jeté(s).', { k: kept, j: thrown }) + (thrownCents > 0 ? ` ${t('Valeur jetée : {m}', { m: mad(thrownCents) })}` : ''));
      setLeft({}); setToss({});
      await onChanged();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <Moon className="h-7 w-7 shrink-0 text-brand" />
        <div className="min-w-[14rem] flex-1">
          <h2 className="font-display text-xl font-semibold">{t('Fin de journée')}</h2>
          <p className="text-sm text-muted">{t('Comptez ce qui reste de chaque préparation : gardé pour demain ou jeté. Le stock est corrigé et ce qui est jeté compte comme perte.')}</p>
        </div>
        <Btn tone={open ? 'ghost' : 'plain'} onClick={openIt}>{open ? t('Fermer') : t('Faire la fin de journée')}</Btn>
      </div>
      <Smooth open={open}>
        <div className="pt-4">
          {!rows.length ? <p className="text-sm text-muted">{t('Rien de produit ni en stock aujourd’hui.')}</p> : (
            <div className="divide-y divide-line/10">
              {rows.map(i => {
                const u = unitOf(i);
                const p = plan.get(i.ingredient_id);
                const stock = i.stock_qty == null ? null : Math.max(0, Number(i.stock_qty));
                return (
                  <div key={i.ingredient_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                    <div className="min-w-[12rem] flex-1">
                      <p className="font-semibold">{i.name}</p>
                      <p className="text-sm text-muted">
                        {p && <>{t('prévu')} <b className="tabular text-ink">{fmtQty(Number(p.planned_qty), i.base_unit)}</b>{p.status === 'skipped' && <> ({t('pas fait')})</>} · </>}
                        {t('fait')} <b className="tabular text-ink">{fmtQty(Number(i.made_today), i.base_unit)}</b>
                        {' · '}{t('stock calculé')} <b className="tabular text-ink">{stock == null ? t('pas encore compté') : fmtQty(stock, i.base_unit)}</b>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input className={`${inputCls} !w-24 text-end`} inputMode="decimal" aria-label={t('Il reste')} placeholder={t('Il reste')}
                        value={left[i.ingredient_id] ?? ''} onChange={e => setLeft(x => ({ ...x, [i.ingredient_id]: e.target.value }))} />
                      <span className="w-6 text-sm text-muted">{u.u}</span>
                      <div className="flex rounded-xl bg-surface-2 p-1">
                        <button type="button" aria-pressed={!toss[i.ingredient_id]} onClick={() => setToss(x => ({ ...x, [i.ingredient_id]: false }))}
                          className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-semibold transition ${!toss[i.ingredient_id] ? 'bg-surface shadow-sm' : 'text-muted'}`}><Check className="h-3.5 w-3.5" /> {t('Garder')}</button>
                        <button type="button" aria-pressed={!!toss[i.ingredient_id]} onClick={() => setToss(x => ({ ...x, [i.ingredient_id]: true }))}
                          className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-semibold transition ${toss[i.ingredient_id] ? 'bg-surface text-danger shadow-sm' : 'text-muted'}`}><Trash2 className="h-3.5 w-3.5" /> {t('Jeter')}</button>
                      </div>
                    </div>
                    {stock != null && (left[i.ingredient_id] ?? '') !== '' && Math.abs(num(left[i.ingredient_id]) * u.f - stock) > 0.001 && (
                      <p className="w-full text-xs text-muted">{t('Écart avec le stock calculé : {q}', { q: (num(left[i.ingredient_id]) * u.f - stock > 0 ? '+' : '−') + show(Math.abs(num(left[i.ingredient_id]) * u.f - stock) / u.f) + ' ' + u.u })}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {result && <p className="mt-3 rounded-xl bg-ok/10 px-3 py-2.5 text-sm font-semibold text-ok">{result}</p>}
          {rows.length > 0 && <div className="mt-4 flex justify-end"><Btn tone="brand" disabled={busy} onClick={save}><Moon className="h-4 w-4" /> {t('Enregistrer la fin de journée')}</Btn></div>}
        </div>
      </Smooth>
    </Card>
  );
}
