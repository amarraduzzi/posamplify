// Several restaurants: figures side by side and copying the menu from one to another.
import { useCallback, useEffect, useState } from 'react';
import { Building2, Copy, TrendingUp } from 'lucide-react';
import { mad, rpc } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import { Btn, Card, Field, Toggle, inputCls } from '../components/ui';

interface Row { id: string; name: string; city: string | null; revenue_cents: number; tickets: number; discounts_cents: number; credit_notes_cents: number; cancelled: number; guest_orders: number; cash_gap_cents: number }
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// i18n:values
const PERIODS: [number, string][] = [[1, 'Aujourd’hui'], [7, '7 jours'], [30, '30 jours']];
// i18n:end

export function GroupPage() {
  const a = useAdminCtx();
  const owned = (a.list ?? []).filter(x => x.role === 'owner').map(x => x.r);
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [from, setFrom] = useState(owned[0]?.id ?? '');
  const [to, setTo] = useState(owned[1]?.id ?? '');
  const [prices, setPrices] = useState(false);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setRows(await rpc<Row[]>('group_overview', { p_from: ymd(new Date(Date.now() - (days - 1) * 86400_000)), p_to: ymd(new Date()) })); }
    catch (e) { a.fail(e); setRows([]); }
  }, [days, a]);
  useEffect(() => { load(); }, [load]);
  const total = (rows ?? []).reduce((s, x) => s + Number(x.revenue_cents), 0);
  const max = Math.max(1, ...(rows ?? []).map(x => Number(x.revenue_cents)));
  const name = (id: string) => owned.find(r => r.id === id)?.name ?? '';
  const copy = async () => {
    setBusy(true);
    try {
      const res = await rpc<{ categories: number; added: number; updated: number }>('menu_copy', { p_from: from, p_to: to, p_prices: prices });
      a.toast(t('Menu copié : {n} plats ajoutés, {u} mis à jour', { n: res.added, u: res.updated })); setSure(false);
    } catch (e) { a.fail(e); }
    setBusy(false);
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-brand">Amplify</p>
        <h1 className="font-display text-3xl font-semibold">{t('Groupe')}</h1>
        <p className="text-muted">{t('Tous vos restaurants côte à côte, et un menu à gérer une seule fois.')}</p>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="me-auto flex items-center gap-2 font-display text-xl font-semibold"><TrendingUp className="h-5 w-5 text-brand" />{t('Chiffres par restaurant')}</h2>
          <div className="flex rounded-xl bg-surface-2 p-1">
            {PERIODS.map(([d, l]) => <button key={d} onClick={() => setDays(d)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${days === d ? 'bg-night text-white' : 'text-muted'}`}>{t(l)}</button>)}
          </div>
        </div>
        {rows === null ? <p className="text-muted">{t('Chargement…')}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead><tr className="text-start text-xs uppercase tracking-wider text-muted">
                {['Restaurant', "Chiffre d'affaires", 'Tickets', 'Panier moyen', 'Remises', 'Annulées', 'Commandes clients', 'Écart de caisse'].map(h => <th key={h} className="pb-2 pe-3 text-start font-semibold">{t(h)}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-line/10">
                {rows.map(x => (
                  <tr key={x.id}>
                    <td className="py-3 pe-3"><p className="flex items-center gap-2 font-semibold"><Building2 className="h-4 w-4 text-brand" />{x.name}</p>{x.city && <p className="text-xs text-muted">{x.city}</p>}</td>
                    <td className="py-3 pe-3"><p className="font-semibold tabular">{mad(Number(x.revenue_cents))}</p><div className="mt-1 h-1.5 w-28 rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand" style={{ width: `${(Number(x.revenue_cents) / max) * 100}%` }} /></div></td>
                    <td className="py-3 pe-3 tabular">{x.tickets}</td>
                    <td className="py-3 pe-3 tabular">{x.tickets ? mad(Math.round(Number(x.revenue_cents) / x.tickets)) : '–'}</td>
                    <td className="py-3 pe-3 tabular">{mad(Number(x.discounts_cents))}</td>
                    <td className={`py-3 pe-3 tabular ${x.cancelled > 0 ? 'text-warn' : ''}`}>{x.cancelled}</td>
                    <td className="py-3 pe-3 tabular">{x.guest_orders}</td>
                    <td className={`py-3 pe-3 font-semibold tabular ${Number(x.cash_gap_cents) < 0 ? 'text-danger' : ''}`}>{mad(Number(x.cash_gap_cents))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-line/20 font-semibold"><td className="py-3">{t('Total')}</td><td className="py-3 tabular">{mad(total)}</td><td colSpan={6} /></tr></tfoot>
            </table>
          </div>
        )}
      </Card>

      {owned.length >= 2 && (
        <Card>
          <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-semibold"><Copy className="h-5 w-5 text-brand" />{t('Copier le menu')}</h2>
          <p className="mb-4 text-sm text-muted">{t('Modifiez le menu dans un restaurant, puis copiez-le vers l’autre : les catégories, plats, tailles et options manquants sont ajoutés, ceux qui existent déjà (même nom) sont mis à jour. Rien n’est supprimé. Les recettes et le stock restent propres à chaque restaurant.')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Depuis')}><select className={inputCls} value={from} onChange={e => { const v = e.target.value; setFrom(v); if (v === to) setTo(owned.find(r => r.id !== v)?.id ?? ''); setSure(false); }}>{owned.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
            <Field label={t('Vers')}><select className={inputCls} value={to} onChange={e => { setTo(e.target.value); setSure(false); }}>{owned.filter(r => r.id !== from).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
          </div>
          <div className="mt-4"><Toggle checked={prices} onChange={setPrices} label={t('Copier aussi les prix (sinon chaque restaurant garde ses prix)')} /></div>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
            {sure && <p className="text-sm font-semibold text-warn">{t('Copier le menu de {a} vers {b} ?', { a: name(from), b: name(to) })}</p>}
            {sure ? <><Btn onClick={() => setSure(false)}>{t('Annuler')}</Btn><Btn tone="brand" disabled={busy} onClick={copy}>{t('Oui, copier')}</Btn></>
              : <Btn tone="brand" disabled={!from || !to || from === to} onClick={() => setSure(true)}><Copy className="h-4 w-4" /> {t('Copier le menu')}</Btn>}
          </div>
        </Card>
      )}
    </div>
  );
}
