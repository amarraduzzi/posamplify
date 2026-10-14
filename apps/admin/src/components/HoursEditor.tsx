// Opening hours of the restaurant (restaurants.opening_hours): ranges per day, used by online ordering,
// table bookings and the website. A range past midnight (19:00 - 01:00) runs into the night.
import { Clock, Plus, Trash2 } from 'lucide-react';
import { t } from '../lib/i18n';
import { Toggle, inputCls } from './ui';

export type Hours = Record<string, [string, string][]>;
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
// i18n:values
const DAY_LABEL: Record<string, string> = { mon: 'Lundi', tue: 'Mardi', wed: 'Mercredi', thu: 'Jeudi', fri: 'Vendredi', sat: 'Samedi', sun: 'Dimanche' };
// i18n:end

/** What is saved: only valid ranges; {} = always open. */
export function cleanHours(hours: Hours, useHours: boolean): Hours {
  const clean: Hours = {};
  if (useHours) for (const d of DAYS) clean[d] = (hours[d] ?? []).filter(([s, e]) => /^\d\d:\d\d$/.test(s) && /^\d\d:\d\d$/.test(e) && s !== e);
  return clean;
}

export function HoursEditor({ hours, setHours, useHours, setUseHours }: {
  hours: Hours; setHours: (f: (h: Hours) => Hours) => void; useHours: boolean; setUseHours: (v: boolean) => void;
}) {
  const setRange = (d: string, i: number, k: 0 | 1, v: string) => setHours(h => ({ ...h, [d]: (h[d] ?? []).map((x, j) => (j === i ? (k === 0 ? [v, x[1]] : [x[0], v]) as [string, string] : x)) }));
  const copyToAll = (d: string) => setHours(h => Object.fromEntries(DAYS.map(x => [x, (h[d] ?? []).map(y => [...y] as [string, string])])));
  return (
          <div className="rounded-2xl border border-line/10 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <p className="me-auto flex items-center gap-2 font-semibold"><Clock className="h-4 w-4 text-brand" /> {t('Horaires d’ouverture')}</p>
              <Toggle checked={useHours} onChange={v => { setUseHours(v); if (v && !Object.keys(hours).length) setHours(() => Object.fromEntries(DAYS.map(d => [d, [['12:00', '23:00']]]))); }} label={useHours ? t('Selon les horaires') : t('Toujours ouvert')} />
            </div>
            {useHours && (
              <ul className="divide-y divide-line/10">
                {DAYS.map(d => (
                  <li key={d} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="w-24 font-semibold">{t(DAY_LABEL[d])}</span>
                    {!(hours[d] ?? []).length && <span className="text-sm text-muted">{t('Fermé')}</span>}
                    {(hours[d] ?? []).map(([s, e], i) => (
                      <span key={i} className="flex items-center gap-1">
                        <input type="time" aria-label={t('Ouverture')} className={`${inputCls} w-28 py-1.5`} value={s} onChange={x => setRange(d, i, 0, x.target.value)} />
                        <span className="text-muted">–</span>
                        <input type="time" aria-label={t('Fermeture')} className={`${inputCls} w-28 py-1.5`} value={e} onChange={x => setRange(d, i, 1, x.target.value)} />
                        <button aria-label={t('Supprimer')} onClick={() => setHours(h => ({ ...h, [d]: (h[d] ?? []).filter((_, j) => j !== i) }))} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                      </span>
                    ))}
                    <span className="ms-auto flex gap-1">
                      {(hours[d] ?? []).length < 2 && <button onClick={() => setHours(h => ({ ...h, [d]: [...(h[d] ?? []), (h[d] ?? []).length ? ['19:00', '23:30'] : ['12:00', '15:00']] }))} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand hover:bg-surface-2"><Plus className="h-3.5 w-3.5" /> {t('Plage')}</button>}
                      <button onClick={() => copyToAll(d)} className="rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-surface-2">{t('Copier à tous les jours')}</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted">{t('Une plage qui finit après minuit (par exemple 19:00 – 01:00) continue sur la nuit.')}</p>
          </div>
  );
}
