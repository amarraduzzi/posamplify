// Yield report (pâtisserie): per preparation, what really came out of the oven compared with what the recipe
// promised, and what the difference cost. Only productions where "obtained" was filled in are counted
// (planned_qty is set), cancelled ones are left out, and a surplus counts against the loss (net figures).
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { check, mad } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { BaseUnit, Restaurant } from '../lib/types';
import { fmtQty } from '../lib/profit';
import { Card } from './ui';

interface Row { id: string; ingredient_id: string; qty: number; planned_qty: number | null; produced_on: string; cost_cents: number | null }
interface Name { name: string; base_unit: BaseUnit }

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const pct = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',');

export function ProductionYield({ r, today, names }: { r: Restaurant; today: string; names: Map<string, Name> }) {
  const a = useAdminCtx();
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    (async () => {
      try {
        const data = check(await supabase.from('production_batches').select('id, ingredient_id, qty, planned_qty, produced_on, cost_cents')
          .eq('restaurant_id', r.id).is('cancelled_at', null).eq('status', 'done').not('planned_qty', 'is', null)
          .gte('produced_on', addDays(today, -days)).lte('produced_on', today)) as Row[];
        if (live) setRows(data);
      } catch (e) { a.fail(e); if (live) setRows([]); }
    })();
    return () => { live = false; };
  }, [r.id, today, days, a]);

  const lines = useMemo(() => {
    const m = new Map<string, { id: string; n: number; made: number; planned: number; worst: number; loss: number }>();
    for (const b of rows ?? []) {
      const planned = Number(b.planned_qty), made = Number(b.qty);
      if (!(planned > 0)) continue;
      const l = m.get(b.ingredient_id) ?? { id: b.ingredient_id, n: 0, made: 0, planned: 0, worst: Infinity, loss: 0 };
      l.n += 1; l.made += made; l.planned += planned;
      l.worst = Math.min(l.worst, made / planned * 100);
      // the ingredients of the planned quantity were used: the part that did not come out is lost cost
      if (b.cost_cents != null) l.loss += Number(b.cost_cents) * (1 - made / planned);
      m.set(b.ingredient_id, l);
    }
    return [...m.values()].sort((x, y) => y.loss - x.loss);
  }, [rows]);

  const totalLoss = lines.reduce((s, l) => s + l.loss, 0);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="me-auto font-display text-xl font-semibold">{t('Rendement')}</h2>
        <div className="flex rounded-2xl bg-surface-2 p-1">
          {([7, 30, 90] as const).map(d => (
            <button key={d} type="button" onClick={() => setDays(d)} className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${days === d ? 'bg-surface shadow-sm' : 'text-muted hover:text-ink'}`}>
              {t('{n} jours', { n: d })}
            </button>
          ))}
        </div>
      </div>
      {rows === null ? <p className="text-muted">{t('Chargement…')}</p> : !lines.length ? (
        <p className="text-sm text-muted">{t('Aucune production avec quantité obtenue sur cette période. Indiquez « obtenu » en produisant pour suivre le rendement.')}</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">{t('Perte')}: <b className={`tabular ${totalLoss > 0 ? 'text-danger' : 'text-ok'}`}>{mad(Math.round(totalLoss))}</b></p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted">
                  <th className="py-2 text-start font-medium">{t('Préparation')}</th>
                  <th className="py-2 text-end font-medium">{t('Productions')}</th>
                  <th className="py-2 text-end font-medium">{t('Rendement moyen')}</th>
                  <th className="py-2 text-end font-medium">{t('Plus bas')}</th>
                  <th className="py-2 text-end font-medium">{t('Perte')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/10">
                {lines.map(l => {
                  const nm = names.get(l.id);
                  const avg = l.made / l.planned * 100;
                  return (
                    <tr key={l.id}>
                      <td className="py-2.5 font-semibold">
                        {nm?.name ?? '—'}
                        {nm && <span className="ms-2 text-xs font-normal text-muted">{fmtQty(l.made, nm.base_unit)} / {fmtQty(l.planned, nm.base_unit)}</span>}
                      </td>
                      <td className="tabular py-2.5 text-end">{l.n}</td>
                      <td className={`tabular py-2.5 text-end font-semibold ${avg < 100 ? 'text-danger' : 'text-ok'}`}>{pct(avg)} %</td>
                      <td className="tabular py-2.5 text-end">{pct(l.worst)} %</td>
                      <td className={`tabular py-2.5 text-end font-semibold ${l.loss > 0 ? 'text-danger' : 'text-ok'}`}>{mad(Math.round(l.loss))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">{t('Seules les productions avec « obtenu » comptent. Un surplus compense la perte : les chiffres sont nets.')}</p>
        </>
      )}
    </Card>
  );
}
