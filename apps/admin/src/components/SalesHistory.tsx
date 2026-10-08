// Sales from before Amplify, imported from the old till: month by month next to the Amplify
// sales, the average day before and with Amplify, and what sold best. Never fiscal tickets.
import { useEffect, useState } from 'react';
import { History, Trash2, Upload } from 'lucide-react';
import { mad, rpc } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Card } from './ui';

type H = { months: { month: string; history_cents: number; amplify_cents: number; days: number }[]; top: { name: string; qty: number }[];
  total_cents: number; tickets: number | null; days: number; from: string | null; to: string | null; amplify: { days: number; cents: number; tickets: number } };
const n = (x: unknown) => Number(x ?? 0);

export function SalesHistory({ r, version, onImport }: { r: Restaurant; version: number; onImport: () => void }) {
  const a = useAdminCtx();
  const [h, setH] = useState<H | null>(null);
  const [sure, setSure] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    rpc<H>('sales_history', { p_restaurant_id: r.id }).then(x => live && setH(x)).catch(() => live && setH(null));
    return () => { live = false; };
  }, [r.id, version, reload]);
  if (!h) return null;
  if (!n(h.days)) return (
    <Card className="flex flex-wrap items-center gap-4">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand/15 text-brand"><History className="h-5 w-5" /></span>
      <p className="min-w-0 flex-1 text-sm"><b>{t('Vous venez d’une autre caisse ?')}</b> {t('Importez vos ventes passées pour comparer vos mois et voir ce qui se vend le mieux.')}</p>
      <Btn onClick={onImport}><Upload className="h-4 w-4" /> {t('Importer l’historique')}</Btn>
    </Card>
  );
  // compared only once Amplify has a full week of sales, otherwise one quiet day says nothing
  const before = n(h.total_cents) / n(h.days), withA = n(h.amplify.days) >= 7 ? n(h.amplify.cents) / n(h.amplify.days) : null;
  const delta = withA != null && before ? Math.round(((withA - before) / before) * 100) : null;
  const max = Math.max(1, ...h.months.map(m => n(m.history_cents) + n(m.amplify_cents)));
  const topMax = Math.max(1, ...h.top.map(x => n(x.qty)));
  const fmt = (d: string) => new Date(d).toLocaleDateString(dateLocale());
  const monthLabel = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString(dateLocale(), { month: 'short', year: '2-digit' });
  const canClear = a.role === 'owner' || a.role === 'admin';
  const clear = async () => {
    try { await rpc('sales_history_clear', { p_restaurant_id: r.id }); setSure(false); setReload(x => x + 1); } catch (e) { a.fail(e); }
  };
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="me-auto">
          <h2 className="font-display text-xl font-semibold">{t('Ventes avant Amplify')}</h2>
          <p className="text-sm text-muted">{h.from && h.to ? `${fmt(h.from)} – ${fmt(h.to)} · ` : ''}{t('importées de votre ancienne caisse, à part des tickets')}</p>
        </div>
        <Btn onClick={onImport}><Upload className="h-4 w-4" /> {t('Importer')}</Btn>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl bg-surface-2 p-3"><p className="text-xs text-muted">{t("Chiffre d'affaires")}</p><p className="font-display text-2xl font-semibold tabular">{mad(n(h.total_cents))}</p><p className="text-xs text-muted">{t('{n} jour(s)', { n: n(h.days) })}</p></div>
        <div className="rounded-2xl bg-surface-2 p-3"><p className="text-xs text-muted">{t('Moyenne par jour')}</p><p className="font-display text-2xl font-semibold tabular">{mad(Math.round(before / 100) * 100)}</p></div>
        {h.tickets != null && n(h.tickets) > 0 && <div className="rounded-2xl bg-surface-2 p-3"><p className="text-xs text-muted">{t('Ticket moyen')}</p><p className="font-display text-2xl font-semibold tabular">{mad(Math.round(n(h.total_cents) / n(h.tickets) / 10) * 10)}</p><p className="text-xs text-muted">{t('{n} tickets', { n: n(h.tickets) })}</p></div>}
        {withA != null && (
          <div className="rounded-2xl bg-brand/10 p-3"><p className="text-xs text-muted">{t('Par jour avec Amplify')}</p><p className="font-display text-2xl font-semibold tabular">{mad(Math.round(withA / 100) * 100)}</p>
            {delta != null && <p className={`text-xs font-semibold ${delta >= 0 ? 'text-ok' : 'text-danger'}`}>{delta >= 0 ? '+' : ''}{delta} % {t('par rapport à avant')}</p>}</div>
        )}
      </div>

      {h.months.length > 1 && (
        <div className="mt-5">
          <div className="flex items-end gap-2" aria-label={t('Chiffre d’affaires par mois')}>
            {h.months.map(m => {
              const hc = n(m.history_cents), ac = n(m.amplify_cents);
              return (
                <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${monthLabel(m.month)} : ${mad(hc + ac)}`}>
                  <div className="flex h-28 w-full max-w-12 flex-col justify-end overflow-hidden rounded-t-lg">
                    {ac > 0 && <div className="bg-brand" style={{ height: `${(ac / max) * 100}%` }} />}
                    {hc > 0 && <div className="bg-brand/40" style={{ height: `${(hc / max) * 100}%` }} />}
                    {!hc && !ac && <div className="h-[3px] bg-line/20" />}
                  </div>
                  <span className="text-[11px] text-muted">{monthLabel(m.month)}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 flex gap-4 text-xs text-muted"><span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-brand/40" />{t('Ancienne caisse')}</span><span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-brand" />Amplify</span></p>
        </div>
      )}

      {h.top.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 font-semibold">{t('Les plus vendus')}</p>
          <div className="space-y-1.5">
            {h.top.map(x => (
              <div key={x.name} className="flex items-center gap-3 text-sm">
                <span className="w-44 shrink-0 truncate" title={x.name}>{x.name}</span>
                <span className="h-2 min-w-0 flex-1 rounded-full bg-surface-2"><span className="block h-2 rounded-full bg-brand" style={{ width: `${(n(x.qty) / topMax) * 100}%` }} /></span>
                <span className="w-14 text-end tabular text-muted">{Math.round(n(x.qty) * 100) / 100}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {canClear && (
        <div className="mt-5 flex justify-end">
          {sure ? <span className="flex items-center gap-2 text-sm"><span className="text-muted">{t('Effacer tout l’historique importé ?')}</span><Btn onClick={() => setSure(false)}>{t('Annuler')}</Btn><Btn tone="danger" onClick={clear}>{t('Effacer')}</Btn></span>
            : <button type="button" onClick={() => setSure(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-danger"><Trash2 className="h-3.5 w-3.5" /> {t('Effacer l’historique')}</button>}
        </div>
      )}
    </Card>
  );
}
