// Amplify Profit: inventory. Count the stock (phone in hand), note purchases,
// and see what was really used, and with Amplify POS: what disappeared without
// being sold (waste, free food, theft), per ingredient and in dirhams.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CalendarDays, Pencil, MessageCircle, PackageCheck, Phone, Truck, X, ArrowLeft, Check, ClipboardList, Copy, History, Lock, Plus, Search, Send, ShoppingBasket, SlidersHorizontal, Trash2, Unlock, Upload, Zap } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, mad, rpc, toCents } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { BaseUnit, Ingredient, Restaurant } from '../lib/types';
import { CATEGORIES, SIZE_UNIT, fmtQty, pct } from '../lib/profit';
import { Btn, Field, Modal, Toggle, inputCls } from '../components/ui';
import { SupplierAccounts } from './SupplierAccounts';
import { ImportData } from '../components/ImportData';

interface Count { id: string; counted_on: string; status: 'open' | 'closed'; note: string | null; closed_at: string | null }
interface Line { count_id: string; ingredient_id: string; qty: number }
interface Purchase { id: string; ingredient_id: string; purchased_on: string; qty: number; total_cents: number | null; supplier: string | null }
interface ReportItem {
  ingredient_id: string; name: string; name_ar: string | null; category: string; base_unit: BaseUnit; priced: boolean; counted: boolean;
  opening: number | null; bought: number; closing: number | null; used: number | null; theoretical: number | null; gap: number | null;
  used_cents: number | null; theoretical_cents: number | null; gap_cents: number | null; negative: boolean;
}
interface Report {
  from: { id: string; counted_on: string }; to: { id: string; counted_on: string }; days: number; uses_pos: boolean;
  revenue_ht_cents: number | null; real_food_cost_bp: number | null;
  totals: { used_cents: number; theoretical_cents: number | null; gap_cents: number | null; surplus_cents: number | null; purchases_cents: number;
    counted: number; not_counted: number; unpriced: number; negative: number };
  items: ReportItem[];
}

// the restaurant's business day (after midnight it is still "yesterday" until the day cut-off);
// the server tells it with the forecast, the calendar day is only the fallback
let businessDay: string | null = null;
const today = () => { if (businessDay) return businessDay; const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const num = (s: string) => Number(String(s).replace(',', '.').replace(/\s/g, ''));
const shown = (x: number) => String(Math.round(x * 1000) / 1000).replace('.', ',');
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
/** stock value of a quantity (gross, no waste: it is what is on the shelf) */
const value = (g: Ingredient | undefined, qty: number) => (g?.purchase_price_cents == null ? 0 : qty * g.purchase_price_cents / Number(g.purchase_qty));

interface FItem {
  ingredient_id: string; name: string; name_ar: string | null; category: string; base_unit: BaseUnit;
  purchase_unit: string; purchase_qty: number; purchase_price_cents: number | null; supplier: string | null;
  counted_on: string | null; counted: number | null; bought_since: number; estimate: number | null; below_zero: boolean;
  daily: number | null; daily_source: 'sales' | 'counts' | null; days_left: number | null; to_buy: number | null; to_buy_cents: number | null;
  status: 'urgent' | 'order' | 'ok' | 'no_use' | 'not_counted'; live?: boolean;
}
interface Forecast { today: string; uses_pos: boolean; order_days: number; sales_days: number | null; items: FItem[] }
type Tab = 'live' | 'buy' | 'orders' | 'suppliers' | 'gaps' | 'history';
/** Line prefilled into a delivery: quantity in purchase units, price paid */
export interface Prefill { ingredient_id: string; qty: number; total_cents: number | null }

/** What to buy, rounded the way one buys: half kilos / litres, whole crates and pieces. */
function buyUnits(f: Pick<FItem, 'to_buy' | 'purchase_qty' | 'base_unit'>): number {
  const pq = Number(f.purchase_qty), x = Number(f.to_buy ?? 0) / pq;
  if (x <= 0) return 0;
  return pq === 1000 && f.base_unit !== 'pc' ? Math.ceil(x * 2) / 2 : Math.ceil(x);
}

export function StockPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [ings, setIngs] = useState<Ingredient[] | null>(null);
  const [counts, setCounts] = useState<Count[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [buys, setBuys] = useState<Purchase[]>([]);
  const [fc, setFc] = useState<Forecast | null>(null);
  const [tab, setTab] = useState<Tab>('live');
  const [sheet, setSheet] = useState<string | null>(null);
  const [buying, setBuying] = useState<Prefill[] | null>(null);
  const [pair, setPair] = useState<[string, string] | null>(null);
  const [rep, setRep] = useState<Report | null>(null);

  const load = useCallback(async () => {
    try {
      const [g, c, p, f] = await Promise.all([
        supabase.from('ingredients').select('*').eq('restaurant_id', r.id).eq('active', true).order('category').order('name'),
        supabase.from('stock_counts').select('*').eq('restaurant_id', r.id).order('counted_on', { ascending: false }).order('created_at', { ascending: false }).limit(60),
        supabase.from('stock_purchases').select('*').eq('restaurant_id', r.id).order('purchased_on', { ascending: false }).order('created_at', { ascending: false }).limit(40),
        rpc<Forecast>('stock_forecast', { p_restaurant_id: r.id }),
      ]);
      const cs = check(c) as Count[];
      const ls = cs.length ? check(await supabase.from('stock_count_lines').select('count_id, ingredient_id, qty').eq('restaurant_id', r.id).in('count_id', cs.map(x => x.id))) as Line[] : [];
      businessDay = f.today;
      // per category (as stored in the room), alphabetical inside, ignoring capitals and accents
      setIngs((check(g) as Ingredient[]).sort((x, y) => x.category.localeCompare(y.category) || x.name.localeCompare(y.name, 'fr', { sensitivity: 'base', numeric: true }))); setCounts(cs); setLines(ls); setBuys(check(p) as Purchase[]); setFc(f);
    } catch (e) { a.fail(e); setIngs([]); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);

  const byId = useMemo(() => new Map((ings ?? []).map(g => [g.id, g])), [ings]);
  const closed = counts.filter(c => c.status === 'closed');
  const open = counts.find(c => c.status === 'open');
  // default comparison: the last two closed counts
  const cmp: [string, string] | null = pair && closed.some(c => c.id === pair[0]) && closed.some(c => c.id === pair[1]) ? pair
    : closed.length >= 2 ? [closed[1].id, closed[0].id] : null;

  useEffect(() => {
    if (!cmp || cmp[0] === cmp[1]) { setRep(null); return; }
    let live = true;
    rpc<Report>('stock_report', { p_restaurant_id: r.id, p_from: cmp[0], p_to: cmp[1] }).then(x => live && setRep(x)).catch(e => { if (live) { setRep(null); a.fail(e); } });
    return () => { live = false; };
  }, [r.id, cmp?.[0], cmp?.[1], counts]); // eslint-disable-line react-hooks/exhaustive-deps

  const newCount = async () => {
    if (open) { setSheet(open.id); return; }
    try {
      const [c] = check(await supabase.from('stock_counts').insert({ restaurant_id: r.id, counted_on: today() }).select('*')) as Count[];
      await load(); setSheet(c.id);
    } catch (e) { a.fail(e); }
  };

  if (ings === null) return <p className="text-muted">{t('Chargement…')}</p>;
  const sheetCount = counts.find(c => c.id === sheet);
  if (sheetCount) return <CountSheet r={r} count={sheetCount} ings={ings} lines={lines.filter(l => l.count_id === sheetCount.id)} onBack={() => { setSheet(null); load(); }} />;

  const countValue = (id: string) => lines.filter(l => l.count_id === id).reduce((s, l) => s + value(byId.get(l.ingredient_id), Number(l.qty)), 0);
  const countLines = (id: string) => lines.filter(l => l.count_id === id).length;

  const reopen = async (c: Count) => {
    try { check(await supabase.from('stock_counts').update({ status: 'open', closed_at: null }).eq('id', c.id).select('id')); a.toast(t('Comptage rouvert')); await load(); setSheet(c.id); } catch (e) { a.fail(e); }
  };
  const removeBuy = async (p: Purchase) => {
    try { check(await supabase.from('stock_purchases').delete().eq('id', p.id).select('id')); a.toast(t('Achat supprimé')); load(); } catch (e) { a.fail(e); }
  };

  const steps = (
    <div className="night mb-5 rounded-[2rem] p-6 md:p-8">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">{t('Comment ça marche')}</p>
      <h2 className="mt-1 font-display text-2xl font-semibold">{t('Trois gestes, et vous savez où part votre marchandise')}</h2>
      <ol className="mt-5 grid gap-4 md:grid-cols-3">
        {[
          [t('Comptez votre stock'), t('Le soir après le service, sur votre téléphone. Commencez par les produits chers : viande, poisson, fromage, boissons.'), closed.length >= 1],
          [t('Notez chaque achat'), t('Chaque livraison ou passage au marché, produit par produit. Le stock et le prix se mettent à jour tout seuls.'), buys.length > 0],
          [t('Recomptez dans une semaine'), r.products?.includes('pos')
            ? t('Vous voyez ce que vous avez utilisé, ce que la caisse a vendu, et la différence en dirhams.')
            : t('Vous voyez ce que vous avez vraiment utilisé et ce que ça vous a coûté.'), closed.length >= 2],
        ].map(([title, text, done], i) => (
          <li key={i} className="rounded-2xl bg-white/5 p-4">
            <span className={`grid h-8 w-8 place-items-center rounded-full text-sm font-bold ${done ? 'bg-brand text-brand-ink' : 'bg-white/10'}`}>{done ? <Check className="h-4 w-4" /> : i + 1}</span>
            <p className="mt-3 font-semibold">{title as string}</p>
            <p className="mt-1 text-sm text-white/60">{text as string}</p>
          </li>
        ))}
      </ol>
    </div>
  );

  const TABS: [Tab, string][] = [['live', t('En direct')], ['buy', t('Stock et achats à faire')], ['orders', t('Commandes fournisseurs')], ['suppliers', t('Fournisseurs')], ['gaps', t('Écarts')], ['history', t('Comptages et achats')]];
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="me-auto">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-brand">Amplify Profit</p>
          <h1 className="font-display text-3xl font-semibold">{t('Inventaire')}</h1>
          <p className="text-muted">{t('Votre stock en temps réel, quoi acheter, et ce qui a disparu sans être vendu.')}</p>
        </div>
        <Btn onClick={() => setBuying([])} disabled={!ings.length}><ShoppingBasket className="h-4 w-4" /> {t('Noter un achat')}</Btn>
        <Btn tone="brand" onClick={newCount} disabled={!ings.length}><ClipboardList className="h-4 w-4" /> {open ? t('Continuer le comptage') : t('Nouveau comptage')}</Btn>
      </div>

      {!ings.length ? (
        <div className="card rounded-3xl p-10 text-center text-muted">
          <p>{t('Ajoutez d’abord vos ingrédients (page Ingrédients), ou laissez l’IA remplir vos fiches techniques dans Marges.')}</p>
        </div>
      ) : (<>
        <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto rounded-2xl border border-line/[0.1] bg-surface p-1">
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition ${tab === k ? 'bg-night text-white' : 'text-muted hover:bg-surface-2'}`}>{label}</button>
          ))}
        </div>

        {tab === 'live' && <LiveView r={r} ings={ings} onChanged={load} />}

        {tab === 'buy' && (fc && fc.items.some(i => i.counted != null || i.live)
          ? <BuyView r={r} fc={fc} onBuy={setBuying} onChanged={load} onOrders={() => setTab('orders')} />
          : steps)}

        {tab === 'orders' && <OrdersView r={r} ings={ings} onChanged={load} />}
        {tab === 'suppliers' && <SupplierAccounts r={r} />}

        {tab === 'gaps' && (rep ? <ReportView rep={rep} closed={closed} cmp={cmp!} setPair={setPair} /> : steps)}

        {tab === 'history' && (
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="card rounded-3xl p-6">
              <h2 className="mb-4 font-display text-xl font-semibold">{t('Comptages')}</h2>
              {!counts.length ? <p className="text-sm text-muted">{t('Aucun comptage pour le moment.')}</p> : (
                <ul className="divide-y divide-line/10">
                  {counts.map(c => (
                    <li key={c.id} className="flex items-center gap-3 py-2.5">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${c.status === 'open' ? 'bg-warn/15 text-warn' : 'bg-ok/10 text-ok'}`}>
                        {c.status === 'open' ? <ClipboardList className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{day(c.counted_on)}</p>
                        <p className="text-xs text-muted">{c.status === 'open' ? t('En cours') : t('Validé')} · {t('{n} produits', { n: countLines(c.id) })}</p>
                      </div>
                      <span className="font-semibold tabular">{mad(Math.round(countValue(c.id)))}</span>
                      {c.status === 'open'
                        ? <Btn className="px-3 py-1.5" onClick={() => setSheet(c.id)}>{t('Continuer')}</Btn>
                        : <button aria-label={t('Rouvrir')} title={t('Rouvrir')} onClick={() => reopen(c)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2"><Unlock className="h-4 w-4" /></button>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card rounded-3xl p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="font-display text-xl font-semibold">{t('Achats')}</h2>
                <Btn tone="brand" className="px-3 py-1.5" onClick={() => setBuying([])}><Plus className="h-4 w-4" /> {t('Ajouter')}</Btn>
              </div>
              {!buys.length ? <p className="text-sm text-muted">{t('Notez ici ce que vous achetez entre deux comptages.')}</p> : (
                <ul className="divide-y divide-line/10">
                  {buys.map(p => {
                    const g = byId.get(p.ingredient_id);
                    return (
                      <li key={p.id} className="flex items-center gap-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{g?.name ?? '—'}</p>
                          <p className="text-xs text-muted"><span>{day(p.purchased_on)}</span> · {g ? fmtQty(Number(p.qty), g.base_unit) : ''}{p.supplier ? ` · ${p.supplier}` : ''}</p>
                        </div>
                        <span className="font-semibold tabular">{p.total_cents != null ? mad(p.total_cents) : '—'}</span>
                        <button aria-label={t('Supprimer')} onClick={() => removeBuy(p)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
      </>)}

      {buying && <DeliveryEditor r={r} ings={ings} prefill={buying} countDays={closed.map(c => c.counted_on)} onClose={() => setBuying(null)} onSaved={() => { setBuying(null); load(); }} />}
    </div>
  );
}

// ------------------------------------------------------------ stock now and what to buy
function BuyView({ r, fc, onBuy, onChanged, onOrders }: { r: Restaurant; fc: Forecast; onBuy: (p: Prefill[]) => void; onChanged: () => void; onOrders: () => void }) {
  const a = useAdminCtx();
  const need = fc.items.filter(i => (i.status === 'urgent' || i.status === 'order') && buyUnits(i) > 0);
  const [pick, setPick] = useState<Set<string>>(() => new Set(need.map(i => i.ingredient_id)));
  useEffect(() => { setPick(new Set(need.map(i => i.ingredient_id))); }, [fc]); // eslint-disable-line react-hooks/exhaustive-deps
  const tracked = fc.items.filter(i => i.status !== 'not_counted');
  const notCounted = fc.items.filter(i => i.status === 'not_counted').length;
  const chosen = need.filter(i => pick.has(i.ingredient_id));
  const cost = chosen.reduce((s, i) => s + (i.purchase_price_cents != null ? buyUnits(i) * i.purchase_price_cents : 0), 0);

  const setDays = async (v: string) => {
    const n = Math.round(Number(v));
    if (!(n >= 1 && n <= 60) || n === fc.order_days) return;
    try {
      check(await supabase.from('restaurants').update({ profit_settings: { ...(r.profit_settings ?? {}), order_days: n } }).eq('id', r.id).select('id'));
      r.profit_settings = { ...(r.profit_settings ?? {}), order_days: n };
      onChanged();
    } catch (e) { a.fail(e); }
  };
  const listText = () => [t('Commande {r}', { r: r.name }), ...chosen.map(i => `- ${i.name} : ${String(buyUnits(i)).replace('.', ',')} ${i.purchase_unit}`)].join('\n');
  const copy = async () => { try { await navigator.clipboard.writeText(listText()); a.toast(t('Liste copiée')); } catch { a.toast(t('Copie impossible'), 'error'); } };
  const makeOrders = async () => {
    try {
      const res = await rpc<{ orders: string[] }>('po_from_forecast', { p_restaurant_id: r.id, p_ingredient_ids: chosen.map(i => i.ingredient_id) });
      a.toast(t('{n} bon(s) de commande prêt(s)', { n: res.orders.length })); onOrders();
    } catch (e) { a.fail(e); }
  };
  const toggle = (id: string) => setPick(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const badge = (i: FItem) => {
    if (i.status === 'no_use') return <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{t('pas utilisé')}</span>;
    const d = Number(i.days_left);
    const tone = i.status === 'urgent' ? 'bg-danger/10 text-danger' : i.status === 'order' ? 'bg-warn/15 text-warn' : 'bg-ok/10 text-ok';
    return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{d < 1 ? t('épuisé bientôt') : t('{d} j', { d: String(Math.floor(d)) })}</span>;
  };

  return (
    <>
      <div className="night mb-5 grid gap-6 rounded-[2rem] p-6 md:grid-cols-3 md:p-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">{t('À acheter')}</p>
          <p className="mt-1 font-display text-5xl font-semibold tabular">{need.length}<span className="text-lg text-white/50"> {t('produits')}</span></p>
          <p className="text-sm text-white/60">{t('dont {n} urgents (moins de 2 jours)', { n: need.filter(i => i.status === 'urgent').length })}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">{t('Budget estimé')}</p>
          <p className="mt-1 font-display text-5xl font-semibold tabular">{mad(Math.round(cost))}</p>
          <p className="text-sm text-white/60">{t('aux derniers prix d’achat')}</p>
        </div>
        <div className="text-sm text-white/60">
          <label className="flex items-center gap-2">{t('Acheter pour')}
            <input key={fc.order_days} defaultValue={fc.order_days} onBlur={e => setDays(e.target.value)} inputMode="numeric" aria-label={t('Jours à couvrir')}
              className="w-12 rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-center text-white outline-none focus:border-brand" /> {t('jours')}</label>
          <p className="mt-2">{fc.uses_pos
            ? t('Consommation calculée avec les ventes de la caisse ({n} derniers jours) et vos fiches techniques. Produits sans fiche : avec vos comptages.', { n: fc.sales_days ?? 0 })
            : t('Consommation calculée avec vos deux derniers comptages. Avec Amplify POS, elle suit les ventes en direct.')}</p>
          <p className="mt-2">{t('Le stock est estimé depuis votre dernier comptage. Recomptez chaque semaine pour rester précis.')}</p>
        </div>
      </div>

      {need.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Btn tone="brand" disabled={!chosen.length} onClick={makeOrders}><ClipboardList className="h-4 w-4" /> {t('Créer les bons de commande ({n})', { n: chosen.length })}</Btn>
          <Btn disabled={!chosen.length} onClick={() => onBuy(chosen.map(i => ({ ingredient_id: i.ingredient_id, qty: buyUnits(i), total_cents: i.purchase_price_cents != null ? Math.round(buyUnits(i) * i.purchase_price_cents) : null })))}>
            <ShoppingBasket className="h-4 w-4" /> {t('Noter comme acheté ({n})', { n: chosen.length })}</Btn>
          <Btn tone="ghost" disabled={!chosen.length} onClick={copy}><Copy className="h-4 w-4" /> {t('Copier la liste')}</Btn>
        </div>
      )}

      <div className="card overflow-x-auto rounded-3xl">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="w-10 px-4 py-3" />
              <th className="px-2 py-3 text-start">{t('Produit')}</th>
              <th className="px-3 py-3 text-end">{t('Stock estimé')}</th>
              <th className="px-3 py-3 text-end">{t('Par jour')}</th>
              <th className="px-3 py-3 text-end">{t('À acheter')}</th>
              <th className="px-4 py-3 text-end">{t('Coût')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/10">
            {tracked.map(i => {
              const u = buyUnits(i), can = (i.status === 'urgent' || i.status === 'order') && u > 0;
              return (
                <tr key={i.ingredient_id}>
                  <td className="px-4 py-2.5">{can && <input type="checkbox" aria-label={i.name} checked={pick.has(i.ingredient_id)} onChange={() => toggle(i.ingredient_id)} className="h-4 w-4 accent-[rgb(var(--brand))]" />}</td>
                  <td className="px-2 py-2.5">
                    <p className="font-semibold">{i.name}</p>
                    <p className="text-xs text-muted">{i.live ? t('stock en direct') : t('compté le {d}', { d: day(i.counted_on!) })}{Number(i.bought_since) > 0 ? ` · ${t('+ achats')}` : ''}</p>
                  </td>
                  <td className="px-3 py-2.5 text-end">
                    <span className="me-2 font-semibold tabular">{fmtQty(Number(i.estimate ?? 0), i.base_unit)}</span>{badge(i)}
                    {i.below_zero && <p className="text-xs text-warn">{t('Achat oublié ou à recompter')}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-end tabular text-muted">{i.daily != null ? fmtQty(Number(i.daily), i.base_unit) : '—'}
                    <span className="block text-[11px]">{i.daily_source === 'sales' ? t('ventes') : i.daily_source === 'counts' ? t('comptages') : ''}</span></td>
                  <td className="px-3 py-2.5 text-end font-semibold tabular">{can ? `${String(u).replace('.', ',')} ${i.purchase_unit}` : '—'}</td>
                  <td className="px-4 py-2.5 text-end tabular">{can && i.purchase_price_cents != null ? mad(Math.round(u * i.purchase_price_cents)) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {notCounted > 0 && <p className="mt-3 text-sm text-muted">{t('{n} produits jamais comptés : comptez-les une fois pour les suivre.', { n: notCounted })}</p>}
    </>
  );
}

// ------------------------------------------------------------ the report
function ReportView({ rep, closed, cmp, setPair }: { rep: Report; closed: Count[]; cmp: [string, string]; setPair: (p: [string, string]) => void }) {
  const T = rep.totals;
  const items = rep.items.filter(i => i.counted);
  const pick = (i: 0 | 1, v: string) => setPair(i === 0 ? [v, cmp[1]] : [cmp[0], v]);
  return (
    <>
      <div className="night mb-5 rounded-[2rem] p-6 md:p-8">
        <div className="flex flex-wrap items-center gap-2 text-sm text-white/60">
          <span>{t('Du comptage du')}</span>
          <select aria-label={t('Premier comptage')} value={cmp[0]} onChange={e => pick(0, e.target.value)} className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-white outline-none">
            {closed.map(c => <option key={c.id} value={c.id} className="text-black">{day(c.counted_on)}</option>)}
          </select>
          <span>{t('au')}</span>
          <select aria-label={t('Deuxième comptage')} value={cmp[1]} onChange={e => pick(1, e.target.value)} className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-white outline-none">
            {closed.map(c => <option key={c.id} value={c.id} className="text-black">{day(c.counted_on)}</option>)}
          </select>
          <span>· {rep.days === 1 ? t('1 jour') : t('{n} jours', { n: rep.days })}</span>
        </div>
        <div className={`mt-5 grid gap-6 ${rep.uses_pos ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2'}`}>
          <Kpi label={t('Marchandise utilisée')} value={mad(T.used_cents)} hint={t('début + achats − fin')} />
          {rep.uses_pos ? <>
            <Kpi label={t('Selon les ventes')} value={mad(T.theoretical_cents ?? 0)} hint={t('ce que la caisse a vendu')} />
            <Kpi label={t('Disparu sans être vendu')} value={mad(T.gap_cents ?? 0)} tone={(T.gap_cents ?? 0) > 0 ? 'bad' : 'ok'}
              hint={(T.gap_cents ?? 0) > 0 ? t('perte, gratuit ou vol') : t('rien d’anormal')} />
            <Kpi label={t('Food cost réel')} value={pct(rep.real_food_cost_bp)} hint={t('utilisé / ventes HT')} />
          </> : (
            <Kpi label={t('Achats de la période')} value={mad(T.purchases_cents)} hint={t('achats notés avec un prix')} />
          )}
        </div>
        {!rep.uses_pos && (
          <p className="mt-5 rounded-2xl bg-white/5 p-4 text-sm text-white/70">{t('Avec Amplify POS, chaque plat vendu est comparé à votre stock : vous voyez exactement ce qui a disparu sans être vendu, par produit et en dirhams.')}</p>
        )}
      </div>

      {(T.negative > 0 || T.not_counted > 0 || T.unpriced > 0) && (
        <div className="mb-5 space-y-2">
          {T.negative > 0 && <Note>{t('{n} produit(s) avec plus de stock à la fin que possible : un achat n’a pas été noté, ou un comptage est faux.', { n: T.negative })}</Note>}
          {T.not_counted > 0 && <Note>{t('{n} produit(s) acheté(s) ou vendu(s) mais pas compté(s) les deux fois : ils ne sont pas dans le calcul.', { n: T.not_counted })}</Note>}
          {T.unpriced > 0 && <Note>{t('{n} produit(s) sans prix d’achat : leur valeur n’est pas comptée.', { n: T.unpriced })}</Note>}
        </div>
      )}

      <div className="card overflow-x-auto rounded-3xl">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3 text-start">{t('Produit')}</th>
              <th className="px-3 py-3 text-end">{t('Début')}</th>
              <th className="px-3 py-3 text-end">{t('Achats')}</th>
              <th className="px-3 py-3 text-end">{t('Fin')}</th>
              <th className="px-3 py-3 text-end">{t('Utilisé')}</th>
              {rep.uses_pos && <th className="px-3 py-3 text-end">{t('Vendu')}</th>}
              <th className="px-4 py-3 text-end">{rep.uses_pos ? t('Écart') : t('Coût')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/10">
            {items.map(i => {
              const bad = rep.uses_pos && (i.gap_cents ?? 0) > 0;
              return (
                <tr key={i.ingredient_id} className={i.negative ? 'bg-warn/5' : ''}>
                  <td className="px-4 py-2.5">
                    <p className="font-semibold">{i.name}</p>
                    {i.name_ar && <bdi dir="rtl" className="block text-xs text-muted">{i.name_ar}</bdi>}
                    {i.negative && <p className="text-xs font-semibold text-warn">{t('Achat oublié ?')}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-end tabular text-muted">{fmtQty(Number(i.opening), i.base_unit)}</td>
                  <td className="px-3 py-2.5 text-end tabular text-muted">{Number(i.bought) ? `+ ${fmtQty(Number(i.bought), i.base_unit)}` : '—'}</td>
                  <td className="px-3 py-2.5 text-end tabular text-muted">{fmtQty(Number(i.closing), i.base_unit)}</td>
                  <td className="px-3 py-2.5 text-end tabular font-semibold">{fmtQty(Number(i.used), i.base_unit)}</td>
                  {rep.uses_pos && <td className="px-3 py-2.5 text-end tabular text-muted">{fmtQty(Number(i.theoretical ?? 0), i.base_unit)}</td>}
                  <td className="px-4 py-2.5 text-end">
                    {rep.uses_pos ? <>
                      <span className={`font-semibold tabular ${bad ? 'text-danger' : 'text-ok'}`}>{i.gap_cents == null ? '—' : `${i.gap_cents > 0 ? '−' : '+'} ${mad(Math.abs(i.gap_cents))}`}</span>
                      <span className="block text-xs tabular text-muted">{i.gap != null && Number(i.gap) !== 0 ? `${Number(i.gap) > 0 ? '−' : '+'} ${fmtQty(Math.abs(Number(i.gap)), i.base_unit)}` : ''}</span>
                    </> : <span className="font-semibold tabular">{i.used_cents == null ? '—' : mad(i.used_cents)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'ok' | 'bad' }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.15em] text-white/50">{label}</p>
      <p className={`mt-1 font-display text-3xl font-semibold tabular ${tone === 'bad' ? 'text-[#F47171]' : tone === 'ok' ? 'text-brand' : ''}`}>{value}</p>
      <p className="text-xs text-white/50">{hint}</p>
    </div>
  );
}
function Note({ children }: { children: React.ReactNode }) {
  return <p className="flex items-start gap-2 rounded-2xl border border-warn/40 bg-warn/5 px-4 py-3 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />{children}</p>;
}

// ------------------------------------------------------------ counting (made for a phone)
function CountSheet({ r, count, ings, lines, onBack }: { r: Restaurant; count: Count; ings: Ingredient[]; lines: Line[]; onBack: () => void }) {
  const a = useAdminCtx();
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(lines.map(l => [l.ingredient_id, shown(Number(l.qty) / SIZE_UNIT[ings.find(g => g.id === l.ingredient_id)?.base_unit ?? 'g'].f)])));
  const [saved, setSaved] = useState<Record<string, number>>(() => Object.fromEntries(lines.map(l => [l.ingredient_id, Number(l.qty)])));
  const [q, setQ] = useState('');
  const [date, setDate] = useState(count.counted_on);
  const [confirmClose, setConfirmClose] = useState(false);

  const list = useMemo(() => {
    const f = q.trim().toLowerCase();
    return ings.filter(g => !f || g.name.toLowerCase().includes(f) || (g.name_ar ?? '').includes(f));
  }, [ings, q]);
  const groups = useMemo(() => {
    const m = new Map<string, Ingredient[]>();
    for (const g of list) m.set(g.category, [...(m.get(g.category) ?? []), g]);
    return [...m.entries()];
  }, [list]);
  const done = Object.keys(saved).length;
  const total = Object.entries(saved).reduce((s, [id, qty]) => s + value(ings.find(g => g.id === id), qty), 0);

  const save = async (g: Ingredient) => {
    const raw = (vals[g.id] ?? '').trim();
    try {
      if (!raw) {
        if (saved[g.id] == null) return;
        check(await supabase.from('stock_count_lines').delete().eq('count_id', count.id).eq('ingredient_id', g.id).select('id'));
        setSaved(s => { const n = { ...s }; delete n[g.id]; return n; });
        return;
      }
      const qty = num(raw) * SIZE_UNIT[g.base_unit].f;
      if (!(qty >= 0) || !Number.isFinite(qty)) { a.toast(t('Quantité invalide'), 'error'); return; }
      if (saved[g.id] === qty) return;
      check(await supabase.from('stock_count_lines').upsert({ restaurant_id: r.id, count_id: count.id, ingredient_id: g.id, qty }, { onConflict: 'count_id,ingredient_id' }).select('id'));
      setSaved(s => ({ ...s, [g.id]: qty }));
    } catch (e) { a.fail(e); }
  };
  const setDay = async (v: string) => {
    setDate(v);
    if (!v) return;
    try { check(await supabase.from('stock_counts').update({ counted_on: v }).eq('id', count.id).select('id')); } catch (e) { a.fail(e); }
  };
  const close = async () => {
    try {
      check(await supabase.from('stock_counts').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', count.id).select('id'));
      a.toast(t('Comptage validé')); onBack();
    } catch (e) { a.fail(e); }
  };
  const remove = async () => {
    try { check(await supabase.from('stock_counts').delete().eq('id', count.id).select('id')); a.toast(t('Comptage supprimé')); onBack(); } catch (e) { a.fail(e); }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <button onClick={onBack} className="mb-4 flex items-center gap-2 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t('Inventaire')}</button>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="me-auto">
          <h1 className="font-display text-3xl font-semibold">{t('Comptage')}</h1>
          <p className="text-sm text-muted">{t('Comptez ce qui reste en fin de journée. Laissez vide ce que vous ne comptez pas.')}</p>
        </div>
        <Field label={t('Date du comptage')}><input type="date" className={inputCls} value={date} max={today()} onChange={e => setDay(e.target.value)} /></Field>
      </div>

      <div className="sticky top-0 z-10 -mx-2 mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-bg/90 px-2 py-2 backdrop-blur">
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className={`${inputCls} ps-9`} placeholder={t('Chercher')} value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <span className="text-sm text-muted">{t('{n} / {m} comptés', { n: done, m: ings.length })} · <b className="text-ink tabular">{mad(Math.round(total))}</b></span>
        <Btn tone="brand" disabled={!done} onClick={() => setConfirmClose(true)}><Check className="h-4 w-4" /> {t('Valider')}</Btn>
      </div>

      <div className="space-y-5">
        {groups.map(([cat, gs]) => (
          <section key={cat} className="card overflow-hidden rounded-3xl">
            <h2 className="bg-surface-2 px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted">{t(CATEGORIES[cat] ?? 'Autre')}</h2>
            <ul className="divide-y divide-line/10">
              {gs.map(g => (
                <li key={g.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{g.name}</p>
                    {g.name_ar && <bdi dir="rtl" className="block truncate text-xs text-muted">{g.name_ar}</bdi>}
                  </div>
                  {saved[g.id] != null && <Check aria-hidden className="h-4 w-4 text-ok" />}
                  <div className="w-24 shrink-0">
                    <input aria-label={g.name} inputMode="decimal" className={`${inputCls} text-end tabular`} value={vals[g.id] ?? ''} placeholder="—"
                      onChange={e => setVals(v => ({ ...v, [g.id]: e.target.value }))} onBlur={() => save(g)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                  </div>
                  <span className="w-12 shrink-0 text-sm text-muted">{t(SIZE_UNIT[g.base_unit].u)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="mt-6 flex justify-between gap-3">
        <Btn tone="ghost" className="text-danger" onClick={remove}><Trash2 className="h-4 w-4" /> {t('Supprimer ce comptage')}</Btn>
        <Btn tone="brand" disabled={!done} onClick={() => setConfirmClose(true)}><Check className="h-4 w-4" /> {t('Valider le comptage')}</Btn>
      </div>

      {confirmClose && (
        <Modal title={t('Valider le comptage ?')} onClose={() => setConfirmClose(false)}
          footer={<div className="flex justify-end gap-3"><Btn tone="ghost" onClick={() => setConfirmClose(false)}>{t('Continuer à compter')}</Btn><Btn tone="brand" onClick={close}>{t('Valider')}</Btn></div>}>
          <p>{t('{n} produits comptés, valeur du stock {v}.', { n: done, v: mad(Math.round(total)) })}</p>
          {done < ings.length && <p className="mt-2 text-sm text-muted">{t('Les produits non comptés ne sont pas dans le calcul. Comptez les mêmes produits à chaque fois.')}</p>}
          <p className="mt-2 text-sm text-muted">{t('Vous pourrez le rouvrir si vous avez fait une erreur.')}</p>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------ a delivery (one or more products)
interface Row { key: number; id: string; qty: string; unit: 'buy' | 'size'; total: string }
let rowKey = 0;
function DeliveryEditor({ r, ings, prefill, countDays, onClose, onSaved }: { r: Restaurant; ings: Ingredient[]; prefill: Prefill[]; countDays: string[]; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const blank = (): Row => ({ key: ++rowKey, id: '', qty: '', unit: 'buy', total: '' });
  const [rows, setRows] = useState<Row[]>(() => prefill.length
    ? prefill.map(p => ({ key: ++rowKey, id: p.ingredient_id, qty: shown(p.qty), unit: 'buy', total: p.total_cents != null ? shown(p.total_cents / 100) : '' }))
    : [blank()]);
  const [date, setDate] = useState(today());
  const [supplier, setSupplier] = useState('');
  // bought the day of a count: was it already on the shelf when counting?
  const [afterCount, setAfterCount] = useState(prefill.length > 0);
  const countDay = countDays.includes(date);
  const [busy, setBusy] = useState(false);
  const set = (k: number, patch: Partial<Row>) => setRows(rs => rs.map(x => (x.key === k ? { ...x, ...patch } : x)));
  const baseOf = (x: Row) => {
    const g = ings.find(i => i.id === x.id);
    if (!g) return 0;
    return num(x.qty) * (x.unit === 'buy' ? Number(g.purchase_qty) : SIZE_UNIT[g.base_unit].f);
  };
  const filled = rows.filter(x => x.id || x.qty.trim());
  const sum = filled.reduce((s, x) => s + (x.total.trim() ? toCents(x.total) : 0), 0);

  const save = async () => {
    if (!filled.length) { a.toast(t('Choisissez le produit.'), 'error'); return; }
    if (filled.some(x => !x.id)) { a.toast(t('Choisissez le produit.'), 'error'); return; }
    if (filled.some(x => !(baseOf(x) > 0))) { a.toast(t('Indiquez la quantité.'), 'error'); return; }
    setBusy(true);
    try {
      check(await supabase.from('stock_purchases').insert(filled.map(x => ({
        restaurant_id: r.id, ingredient_id: x.id, purchased_on: date, qty: baseOf(x),
        total_cents: x.total.trim() ? toCents(x.total) : null, supplier: supplier.trim() || null,
        after_count: countDay && afterCount,
      }))).select('id'));
      a.toast(filled.length > 1 ? t('{n} achats enregistrés, stock et prix mis à jour', { n: filled.length })
        : filled[0].total.trim() ? t('Achat enregistré, prix mis à jour') : t('Achat enregistré'));
      onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };

  return (
    <Modal wide title={t('Noter un achat')} onClose={onClose}
      footer={<div className="flex items-center justify-end gap-3">
        {sum > 0 && <span className="me-auto text-sm text-muted">{t('Total')} <b className="text-ink tabular">{mad(sum)}</b></span>}
        <Btn tone="ghost" onClick={onClose}>{t('Annuler')}</Btn><Btn tone="brand" disabled={busy} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Date')}><input type="date" className={inputCls} value={date} max={today()} onChange={e => setDate(e.target.value)} /></Field>
          <Field label={t('Fournisseur (facultatif)')}><input className={inputCls} value={supplier} onChange={e => setSupplier(e.target.value)} placeholder={t('Souk, Metro, grossiste…')} /></Field>
        </div>
        {countDay && (
          <div className="rounded-2xl border border-warn/40 bg-warn/5 p-3 text-sm">
            <p className="font-semibold">{t('Vous avez fait un comptage ce jour-là.')}</p>
            <div className="mt-2 flex flex-wrap gap-4">
              <label className="flex items-center gap-2"><input type="radio" name="when" checked={!afterCount} onChange={() => setAfterCount(false)} /> {t('Reçu avant le comptage (déjà compté)')}</label>
              <label className="flex items-center gap-2"><input type="radio" name="when" checked={afterCount} onChange={() => setAfterCount(true)} /> {t('Reçu après le comptage')}</label>
            </div>
          </div>
        )}
        <p className="rounded-xl bg-surface-2 p-3 text-xs text-muted">{t('Notez chaque produit reçu : c’est ce qui fait monter votre stock. Le prix payé met aussi à jour le coût de vos plats.')}</p>
        <div className="space-y-3">
          {rows.map((x, n) => {
            const g = ings.find(i => i.id === x.id);
            const sameUnit = g && Number(g.purchase_qty) === SIZE_UNIT[g.base_unit].f;
            const b = baseOf(x);
            return (
              <div key={x.key} className="grid grid-cols-[1fr_auto] gap-2 rounded-2xl border border-line/[0.1] p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-end">
                <Field label={n === 0 ? t('Produit') : ''}>
                  <select aria-label={t('Produit')} className={inputCls} value={x.id} onChange={e => set(x.key, { id: e.target.value, unit: 'buy' })}>
                    <option value="">{t('Choisir…')}</option>
                    {Object.entries(CATEGORIES).map(([k, v]) => {
                      const gs = ings.filter(i => i.category === k);
                      return gs.length ? <optgroup key={k} label={t(v)}>{gs.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</optgroup> : null;
                    })}
                  </select>
                </Field>
                <button aria-label={t('Supprimer')} onClick={() => setRows(rs => (rs.length > 1 ? rs.filter(y => y.key !== x.key) : [blank()]))}
                  className="grid h-10 w-10 place-items-center self-end rounded-lg text-muted hover:bg-danger/10 hover:text-danger sm:order-last"><Trash2 className="h-4 w-4" /></button>
                <Field label={n === 0 ? t('Quantité') : ''} hint={g && b > 0 && !sameUnit ? `= ${fmtQty(b, g.base_unit)}` : undefined}>
                  <div className="flex gap-2">
                    <input aria-label={t('Quantité')} className={inputCls} inputMode="decimal" value={x.qty} onChange={e => set(x.key, { qty: e.target.value })} placeholder="5" />
                    {g && (sameUnit ? <span className="self-center text-sm text-muted">{g.purchase_unit}</span> : (
                      <select aria-label={t('Unité')} className={`${inputCls} w-auto`} value={x.unit} onChange={e => set(x.key, { unit: e.target.value as Row['unit'] })}>
                        <option value="buy">{g.purchase_unit}</option>
                        <option value="size">{t(SIZE_UNIT[g.base_unit].u)}</option>
                      </select>
                    ))}
                  </div>
                </Field>
                <Field label={n === 0 ? t('Prix payé (DH)') : ''}>
                  <input aria-label={t('Prix payé (DH)')} className={inputCls} inputMode="decimal" value={x.total} onChange={e => set(x.key, { total: e.target.value })} placeholder={t('facultatif')} />
                </Field>
              </div>
            );
          })}
        </div>
        <Btn tone="ghost" onClick={() => setRows(rs => [...rs, blank()])}><Plus className="h-4 w-4" /> {t('Ajouter un produit')}</Btn>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ live stock
interface LiveDish { id: string; name: Record<string, string>; available: boolean; sold_out_by_stock: boolean; portions: number }
interface LiveItem {
  ingredient_id: string; name: string; name_ar: string | null; category: string; base_unit: BaseUnit; purchase_unit: string; purchase_qty: number;
  purchase_price_cents: number | null; stock_qty: number; stock_min: number | null; stock_since: string | null; updated_at: string | null;
  value_cents: number | null; sold_today: number; waste_today: number; status: 'out' | 'low' | 'ok'; dishes: LiveDish[];
}
interface Live { today: string; auto_sold_out: boolean; items: LiveItem[]; untracked: number; waste_today_cents: number; value_cents: number }
interface Move { id: number; kind: string; qty: number; stock_after: number; business_date: string; doc_number: string | null; note: string | null; created_at: string }
// i18n:values
const MOVE: Record<string, string> = { sale: 'Vente', refund: 'Avoir', purchase: 'Achat', waste: 'Perte', count: 'Comptage', adjust: 'Correction' };
// i18n:end
const dishName = (n: Record<string, string>) => n?.fr || n?.ar || n?.en || Object.values(n ?? {})[0] || '';

/** Every sale, purchase, loss and count moves the stock at once: the picture right now. */
function LiveView({ r, ings, onChanged }: { r: Restaurant; ings: Ingredient[]; onChanged: () => void }) {
  const a = useAdminCtx();
  const [live, setLive] = useState<Live | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const [pulse, setPulse] = useState(0);
  const [act, setAct] = useState<null | { kind: 'set' | 'waste' | 'min' | 'moves'; g: LiveItem | Ingredient }>(null);
  const [q, setQ] = useState('');
  const load = useCallback(async () => {
    try { setLive(await rpc<Live>('stock_live', { p_restaurant_id: r.id })); setAt(new Date()); setPulse(n => n + 1); } catch (e) { a.fail(e); }
  }, [r.id, a]);
  useEffect(() => {
    load();
    // live: a change of any ingredient of this restaurant (a sale at the till) refreshes the screen
    const ch = supabase.channel(`stock-${r.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ingredients', filter: `restaurant_id=eq.${r.id}` }, () => load())
      .subscribe();
    const id = window.setInterval(load, 30000);
    return () => { window.clearInterval(id); supabase.removeChannel(ch); };
  }, [load, r.id]);

  const saveAuto = async (v: boolean) => {
    try {
      check(await supabase.from('restaurants').update({ profit_settings: { ...(r.profit_settings ?? {}), auto_sold_out: v } }).eq('id', r.id).select('id'));
      r.profit_settings = { ...(r.profit_settings ?? {}), auto_sold_out: v };
      a.toast(t('Enregistré')); load();
    } catch (e) { a.fail(e); }
  };
  if (!live) return <p className="text-muted">{t('Chargement…')}</p>;
  const f = q.trim().toLowerCase();
  const items = live.items.filter(i => !f || i.name.toLowerCase().includes(f));
  const alarms = live.items.filter(i => i.status !== 'ok').length;
  const untracked = ings.filter(g => g.stock_qty == null && (!f || g.name.toLowerCase().includes(f)));
  const soldOut = new Map<string, LiveDish>();
  live.items.forEach(i => i.dishes.forEach(d => { if (!d.available) soldOut.set(d.id, d); }));

  return (
    <div className="space-y-5">
      <div className="night relative overflow-hidden rounded-[2rem] p-6 md:p-7">
        <div className="flex flex-wrap items-center gap-3">
          <p className="me-auto flex items-center gap-2 text-sm font-semibold">
            <span className="relative flex h-2.5 w-2.5"><span key={pulse} className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-70 [animation-iteration-count:2]" /><span className="relative h-2.5 w-2.5 rounded-full bg-brand" /></span>
            {t('En direct')}{at ? <span className="text-white/50">· {t('mis à jour à {h}', { h: at.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })}</span> : null}
          </p>
          <div className="rounded-2xl bg-white/5 px-3 py-2 ring-1 ring-white/10">
            <Toggle checked={live.auto_sold_out} onChange={saveAuto} disabled={!a.canEditProfile && a.role !== 'manager'} label={t('Plat épuisé automatiquement')} />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[[t('Valeur du stock'), mad(live.value_cents), ''], [t('Produits suivis'), String(live.items.length), live.untracked ? t('{n} pas encore suivis', { n: live.untracked }) : ''],
            [t('En alerte'), String(alarms), alarms ? t('épuisés ou sous le minimum') : t('tout va bien')], [t('Pertes aujourd’hui'), mad(live.waste_today_cents), '']].map(([l, v, h], i) => (
            <div key={i} className={`rounded-2xl p-4 ${i === 2 && alarms ? 'bg-danger/20 ring-1 ring-danger/40' : 'bg-white/5'}`}>
              <p className="text-xs text-white/60">{l}</p>
              <p className="mt-1 font-display text-3xl font-semibold tabular">{v}</p>
              {h && <p className="mt-0.5 text-xs text-white/50">{h}</p>}
            </div>
          ))}
        </div>
        {soldOut.size > 0 && (
          <p className="mt-4 flex flex-wrap items-center gap-2 text-sm"><Zap className="h-4 w-4 text-warn" /><span className="text-white/70">{t('Épuisés en ce moment :')}</span>
            {[...soldOut.values()].map(d => <span key={d.id} className="rounded-full bg-white/10 px-2.5 py-0.5 font-semibold">{dishName(d.name)}{d.sold_out_by_stock ? ' ⚡' : ''}</span>)}</p>
        )}
        <p className="mt-4 text-xs text-white/45">{t('Chaque vente payée retire les ingrédients de la fiche technique, options comprises. Un avoir les remet. Un comptage remet les compteurs à la réalité.')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className={`${inputCls} ps-9`} placeholder={t('Chercher un produit')} value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>

      {!live.items.length && (
        <div className="card rounded-3xl p-8 text-center">
          <Activity className="mx-auto h-10 w-10 text-brand" />
          <p className="mt-3 font-display text-xl font-semibold">{t('Démarrez le stock en direct')}</p>
          <p className="mx-auto mt-1 max-w-lg text-muted">{t('Un produit est suivi en direct dès qu’il est compté une fois. Faites un comptage, ou indiquez ci-dessous ce que vous avez maintenant.')}</p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map(i => {
          const qty = Number(i.stock_qty), min = i.stock_min != null ? Number(i.stock_min) : null;
          const ref = Math.max(min ? min * 2.5 : 0, qty, Number(i.sold_today) * 3, 1);
          const pctFill = Math.max(0, Math.min(100, (qty / ref) * 100));
          const tone = i.status === 'out' ? 'bg-danger' : i.status === 'low' ? 'bg-warn' : 'bg-ok';
          return (
            <article key={i.ingredient_id} className={`card rounded-3xl p-5 ${i.status === 'out' ? 'ring-2 ring-danger/50' : i.status === 'low' ? 'ring-2 ring-warn/50' : ''}`}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{i.name}</p>
                  <p className="text-xs text-muted">{t(CATEGORIES[i.category] ?? i.category)}{i.value_cents ? ` · ${mad(i.value_cents)}` : ''}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${i.status === 'out' ? 'bg-danger/15 text-danger' : i.status === 'low' ? 'bg-warn/15 text-warn' : 'bg-ok/15 text-ok'}`}>
                  {i.status === 'out' ? t('Épuisé') : i.status === 'low' ? t('Stock bas') : t('OK')}</span>
              </div>
              <p key={qty} className="pop mt-3 font-display text-4xl font-semibold tabular">{fmtQty(Math.max(0, qty), i.base_unit)}{qty < 0 && <span className="ms-2 align-middle text-sm font-semibold text-danger">{t('(négatif : un achat oublié ?)')}</span>}</p>
              <span className="mt-2 block h-2 overflow-hidden rounded-full bg-surface-2"><span className={`block h-full rounded-full transition-[width] duration-700 ${tone}`} style={{ width: `${pctFill}%` }} /></span>
              <p className="mt-1.5 flex justify-between text-xs text-muted">
                <span>{t('Vendu aujourd’hui : {q}', { q: fmtQty(Number(i.sold_today), i.base_unit) })}{Number(i.waste_today) > 0 ? ` · ${t('perdu {q}', { q: fmtQty(Number(i.waste_today), i.base_unit) })}` : ''}</span>
                {min != null && <span>{t('min. {q}', { q: fmtQty(min, i.base_unit) })}</span>}
              </p>
              {i.dishes.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {i.dishes.slice(0, 6).map(d => (
                    <span key={d.id} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${!d.available ? 'bg-danger/10 text-danger line-through' : d.portions <= 5 ? 'bg-warn/10 text-warn' : 'bg-surface-2 text-muted'}`}>
                      {dishName(d.name)} · {d.available ? t('{n} portions', { n: d.portions }) : t('épuisé')}</span>
                  ))}
                </div>
              )}
              <div className="mt-4 flex gap-1.5">
                <Btn className="flex-1 px-2 py-1.5 text-sm" onClick={() => setAct({ kind: 'set', g: i })}><SlidersHorizontal className="h-4 w-4" /> {t('Ajuster')}</Btn>
                <Btn className="flex-1 px-2 py-1.5 text-sm" onClick={() => setAct({ kind: 'waste', g: i })}><Trash2 className="h-4 w-4" /> {t('Perte')}</Btn>
                <Btn className="px-2 py-1.5 text-sm" aria-label={t('Minimum')} title={t('Minimum')} onClick={() => setAct({ kind: 'min', g: i })}><AlertTriangle className="h-4 w-4" /></Btn>
                <Btn className="px-2 py-1.5 text-sm" aria-label={t('Historique')} title={t('Historique')} onClick={() => setAct({ kind: 'moves', g: i })}><History className="h-4 w-4" /></Btn>
              </div>
            </article>
          );
        })}
      </div>

      {untracked.length > 0 && (
        <section className="card rounded-3xl p-6">
          <h2 className="font-display text-xl font-semibold">{t('Pas encore suivis ({n})', { n: untracked.length })}</h2>
          <p className="mb-4 text-sm text-muted">{t('Indiquez ce que vous avez maintenant : le produit est suivi en direct à partir de là.')}</p>
          <ul className="divide-y divide-line/10">
            {untracked.slice(0, 40).map(g => (
              <li key={g.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate font-semibold">{g.name}</span>
                <Btn className="px-3 py-1.5 text-sm" onClick={() => setAct({ kind: 'set', g })}><Plus className="h-4 w-4" /> {t('Démarrer')}</Btn>
              </li>
            ))}
          </ul>
        </section>
      )}

      {act && act.kind !== 'moves' && <StockAction kind={act.kind} g={act.g} onClose={() => setAct(null)} onDone={() => { setAct(null); load(); onChanged(); }} />}
      {act && act.kind === 'moves' && <MovesModal g={act.g as LiveItem} onClose={() => setAct(null)} />}
    </div>
  );
}

function StockAction({ kind, g, onClose, onDone }: { kind: 'set' | 'waste' | 'min'; g: LiveItem | Ingredient; onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const big = SIZE_UNIT[g.base_unit];
  const cur = 'stock_qty' in g && g.stock_qty != null ? Number(g.stock_qty) : null;
  const [val, setVal] = useState(kind === 'min' && g.stock_min != null ? shown(Number(g.stock_min) / big.f) : kind === 'set' && cur != null ? shown(Math.max(0, cur) / big.f) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const gid = 'ingredient_id' in g ? g.ingredient_id : g.id;
  const qty = num(val) * big.f;
  const ok = val.trim() !== '' && Number.isFinite(qty) && qty >= 0 && (kind !== 'waste' || (qty > 0 && note.trim().length >= 2));
  const save = async () => {
    setBusy(true);
    try {
      if (kind === 'set') await rpc('stock_set', { p_ingredient_id: gid, p_qty: qty, p_note: note.trim() || null });
      else if (kind === 'waste') await rpc('stock_waste', { p_ingredient_id: gid, p_qty: qty, p_reason: note.trim() });
      else check(await supabase.from('ingredients').update({ stock_min: val.trim() ? qty : null }).eq('id', gid).select('id'));
      a.toast(t('Enregistré')); onDone();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const title = kind === 'set' ? (cur == null ? t('Démarrer le suivi') : t('Ajuster le stock')) : kind === 'waste' ? t('Noter une perte') : t('Minimum d’alerte');
  return (
    <Modal title={`${title} · ${g.name}`} onClose={onClose}
      footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy || !ok} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        {cur != null && <p className="text-sm text-muted">{t('Stock actuel : {q}', { q: fmtQty(cur, g.base_unit) })}</p>}
        <Field label={kind === 'set' ? t('Quantité réelle maintenant ({u})', { u: big.u }) : kind === 'waste' ? t('Quantité perdue ({u})', { u: big.u }) : t('Alerte sous ({u})', { u: big.u })}>
          <input autoFocus className={inputCls} inputMode="decimal" value={val} onChange={e => setVal(e.target.value)} />
        </Field>
        {kind !== 'min' && <Field label={kind === 'waste' ? t('Raison') : t('Note (facultatif)')}><input className={inputCls} maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder={kind === 'waste' ? t('Périmé, abîmé, renversé…') : t('Livraison du matin…')} /></Field>}
        {kind === 'set' && <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">{t('Gardé dans l’historique. Pour une livraison, utilisez plutôt « Noter un achat » : le prix se met aussi à jour.')}</p>}
        {kind === 'min' && <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">{t('Sous ce seuil, le produit passe en alerte. Laissez vide pour aucune alerte.')}</p>}
      </div>
    </Modal>
  );
}

function MovesModal({ g, onClose }: { g: LiveItem; onClose: () => void }) {
  const a = useAdminCtx();
  const [list, setList] = useState<Move[] | null>(null);
  useEffect(() => {
    supabase.from('stock_moves').select('id,kind,qty,stock_after,business_date,doc_number,note,created_at').eq('ingredient_id', g.ingredient_id).order('id', { ascending: false }).limit(80)
      .then(res => { try { setList(check(res) as Move[]); } catch (e) { a.fail(e); setList([]); } });
  }, [g.ingredient_id, a]);
  return (
    <Modal title={`${t('Historique')} · ${g.name}`} onClose={onClose} wide>
      {!list ? <p className="text-muted">{t('Chargement…')}</p> : !list.length ? <p className="text-muted">{t('Aucun mouvement.')}</p> : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted"><tr><th className="py-2 text-start">{t('Quand')}</th><th className="text-start">{t('Mouvement')}</th><th className="text-end">{t('Quantité')}</th><th className="text-end">{t('Stock après')}</th></tr></thead>
          <tbody className="divide-y divide-line/10">
            {list.map(m => (
              <tr key={m.id}>
                <td className="py-2 pe-3 text-muted">{new Date(m.created_at).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td className="py-2"><span className="font-semibold">{t(MOVE[m.kind] ?? m.kind)}</span>{m.doc_number ? ` · ${m.doc_number}` : ''}{m.note ? <span className="text-muted"> · {m.note}</span> : null}</td>
                <td className={`py-2 text-end font-semibold tabular ${Number(m.qty) < 0 ? 'text-danger' : 'text-ok'}`}>{Number(m.qty) > 0 ? '+' : '−'}{fmtQty(Math.abs(Number(m.qty)), g.base_unit)}</td>
                <td className="py-2 text-end tabular">{fmtQty(Number(m.stock_after), g.base_unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------ suppliers and purchase orders
interface Supplier { id: string; name: string; phone: string | null; email: string | null; contact: string | null; delivery_days: number[]; lead_days: number; note: string | null; active: boolean }
interface PoLine { id?: string; ingredient_id: string; units: number; unit_price_cents: number | null; received_units?: number | null; received_cents?: number | null; sort_order?: number }
interface Po { id: string; supplier_id: string | null; doc_number: string; status: 'draft' | 'sent' | 'received' | 'cancelled'; expected_on: string | null; note: string | null;
  sent_at: string | null; received_at: string | null; received_on: string | null; created_at: string; purchase_order_lines: PoLine[] }
// i18n:values
const PO_STATUS: Record<Po['status'], string> = { draft: 'Brouillon', sent: 'Envoyée', received: 'Reçue', cancelled: 'Annulée' };
const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
// i18n:end
const PO_TONE: Record<Po['status'], string> = { draft: 'bg-surface-2 text-muted', sent: 'bg-warn/15 text-warn', received: 'bg-ok/15 text-ok', cancelled: 'bg-danger/10 text-danger line-through' };
const poTotal = (o: Pick<Po, 'purchase_order_lines' | 'status'>) => o.purchase_order_lines.reduce((s, l) =>
  s + (o.status === 'received' ? Number(l.received_cents ?? 0) : l.unit_price_cents != null ? Number(l.units) * l.unit_price_cents : 0), 0);
/** "06 61 00 00 00" -> "212661000000" (wa.me wants international digits) */
const intlPhone = (v: string) => { const d = v.replace(/\D/g, ''); return !d ? '' : d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? '212' + d.slice(1) : d; };
const units = (x: number) => String(Math.round(x * 1000) / 1000).replace('.', ',');

function OrdersView({ r, ings, onChanged }: { r: Restaurant; ings: Ingredient[]; onChanged: () => void }) {
  const a = useAdminCtx();
  const [list, setList] = useState<Po[] | null>(null);
  const [sups, setSups] = useState<Supplier[]>([]);
  const [open, setOpen] = useState<Po | 'new' | null>(null);
  const [manage, setManage] = useState(false);
  const load = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([
        supabase.from('purchase_orders').select('*, purchase_order_lines(*)').eq('restaurant_id', r.id).order('created_at', { ascending: false }).limit(60),
        supabase.from('suppliers').select('*').eq('restaurant_id', r.id).order('name'),
      ]);
      setList(check(o) as Po[]); setSups(check(s) as Supplier[]);
    } catch (e) { a.fail(e); setList([]); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);
  const supName = (id: string | null) => sups.find(s => s.id === id)?.name ?? t('Sans fournisseur');
  if (!list) return <p className="text-muted">{t('Chargement…')}</p>;
  const openOnes = list.filter(o => o.status === 'draft' || o.status === 'sent');
  const toReceive = list.filter(o => o.status === 'sent');
  const month = list.filter(o => o.status === 'received' && o.received_on?.slice(0, 7) === today().slice(0, 7)).reduce((s, o) => s + poTotal(o), 0);
  return (
    <div className="space-y-5">
      <div className="night grid gap-4 rounded-[2rem] p-6 md:grid-cols-[1fr_1fr_1fr_auto] md:items-center md:p-7">
        {[[t('En cours'), String(openOnes.length), t('brouillons et envoyées')], [t('À réceptionner'), String(toReceive.length), toReceive[0]?.expected_on ? t('prochaine : {d}', { d: day(toReceive[0].expected_on) }) : ''],
          [t('Achats reçus ce mois'), mad(Math.round(month)), t('par bons de commande')]].map(([l, v, h], i) => (
          <div key={i}><p className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">{l}</p><p className="mt-1 font-display text-4xl font-semibold tabular">{v}</p><p className="text-sm text-white/55">{h}</p></div>
        ))}
        <div className="flex flex-wrap gap-2 md:flex-col">
          <Btn tone="brand" onClick={() => setOpen('new')}><Plus className="h-4 w-4" /> {t('Nouvelle commande')}</Btn>
          <Btn onClick={() => setManage(true)}><Truck className="h-4 w-4" /> {t('Fournisseurs ({n})', { n: sups.length })}</Btn>
        </div>
      </div>
      {!list.length ? (
        <div className="card rounded-3xl p-8 text-center text-muted">
          <ClipboardList className="mx-auto h-10 w-10 text-brand" />
          <p className="mt-3 font-display text-xl font-semibold text-ink">{t('Aucune commande pour le moment')}</p>
          <p className="mx-auto mt-1 max-w-lg">{t('Dans « Stock et achats à faire », cochez les produits et créez les bons de commande en un clic : un par fournisseur, prêts à envoyer sur WhatsApp.')}</p>
        </div>
      ) : (
        <div className="card overflow-hidden rounded-3xl">
          <ul className="divide-y divide-line/10">
            {list.map(o => (
              <li key={o.id}>
                <button onClick={() => setOpen(o)} className="flex w-full items-center gap-4 px-5 py-3.5 text-start hover:bg-surface-2/60">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-brand">{o.status === 'received' ? <PackageCheck className="h-5 w-5" /> : o.status === 'sent' ? <Send className="h-5 w-5" /> : <ClipboardList className="h-5 w-5" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{supName(o.supplier_id)} <span className="font-normal text-muted">· {o.doc_number}</span></span>
                    <span className="block text-xs text-muted">{t('{n} produits', { n: o.purchase_order_lines.length })}{o.expected_on && o.status !== 'received' ? ` · ${t('livraison prévue {d}', { d: day(o.expected_on) })}` : ''}{o.received_on ? ` · ${t('reçue le {d}', { d: day(o.received_on) })}` : ''}</span>
                  </span>
                  <span className="font-semibold tabular">{mad(Math.round(poTotal(o)))}</span>
                  <span className={`w-24 rounded-full px-2.5 py-0.5 text-center text-xs font-bold ${PO_TONE[o.status]}`}>{t(PO_STATUS[o.status])}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {open && <OrderModal r={r} ings={ings} sups={sups} po={open === 'new' ? null : open} onClose={() => setOpen(null)} onSaved={() => { load(); onChanged(); }} />}
      {manage && <SuppliersModal r={r} ings={ings} sups={sups} onClose={() => setManage(false)} onSaved={() => { load(); onChanged(); }} />}
    </div>
  );
}

function OrderModal({ r, ings, sups, po, onClose, onSaved }: { r: Restaurant; ings: Ingredient[]; sups: Supplier[]; po: Po | null; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const editable = !po || po.status === 'draft' || po.status === 'sent';
  const [sup, setSup] = useState<string>(po?.supplier_id ?? '');
  const [expected, setExpected] = useState(po?.expected_on ?? '');
  const [note, setNote] = useState(po?.note ?? '');
  const [lines, setLines] = useState<{ id?: string; ingredient_id: string; units: string; price: string }[]>(() =>
    (po?.purchase_order_lines ?? []).slice().sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0)).map(l => ({ id: l.id, ingredient_id: l.ingredient_id, units: units(Number(l.units)), price: l.unit_price_cents != null ? shown(l.unit_price_cents / 100) : '' })));
  const [receiving, setReceiving] = useState(false);
  const [busy, setBusy] = useState(false);
  const byId = new Map(ings.map(g => [g.id, g]));
  const supplier = sups.find(s => s.id === sup);
  const total = lines.reduce((s, l) => s + (l.price.trim() ? num(l.units) * toCents(l.price) : 0), 0);
  const valid = lines.length > 0 && lines.every(l => num(l.units) > 0);

  const persist = async (status?: Po['status']): Promise<string | null> => {
    if (!valid) { a.toast(t('Indiquez une quantité pour chaque produit.'), 'error'); return null; }
    const head = { supplier_id: sup || null, expected_on: expected || null, note: note.trim() || null, ...(status ? { status } : {}) };
    let id = po?.id;
    if (id) check(await supabase.from('purchase_orders').update(head).eq('id', id).select('id'));
    else id = (check(await supabase.from('purchase_orders').insert({ ...head, restaurant_id: r.id }).select('id')) as { id: string }[])[0].id;
    const keep = new Set(lines.filter(l => l.id).map(l => l.id));
    const gone = (po?.purchase_order_lines ?? []).filter(l => !keep.has(l.id)).map(l => l.id!);
    if (gone.length) check(await supabase.from('purchase_order_lines').delete().in('id', gone).select('id'));
    for (const [i, l] of lines.entries()) {
      const row = { units: num(l.units), unit_price_cents: l.price.trim() ? toCents(l.price) : null, sort_order: (i + 1) * 10 };
      if (l.id) check(await supabase.from('purchase_order_lines').update(row).eq('id', l.id).select('id'));
      else check(await supabase.from('purchase_order_lines').insert({ ...row, restaurant_id: r.id, order_id: id, ingredient_id: l.ingredient_id }).select('id'));
    }
    return id!;
  };
  const save = async () => { setBusy(true); try { if (await persist()) { a.toast(t('Enregistré')); onSaved(); onClose(); } } catch (e) { a.fail(e); } setBusy(false); };
  const message = () => {
    const ls = lines.map(l => { const g = byId.get(l.ingredient_id); return `- ${g?.name ?? ''} : ${l.units} ${g?.purchase_unit ?? ''}`; });
    return [t('Bonjour{n},', { n: supplier?.contact ? ` ${supplier.contact}` : '' }), t('Commande {d} de {r} :', { d: po?.doc_number ?? '', r: r.name }).replace('  ', ' '), '', ...ls, '',
      expected ? t('Livraison souhaitée : {d}', { d: day(expected) }) : '', note.trim(), t('Merci de confirmer.')].filter(x => x !== '').join('\n');
  };
  const send = async () => {
    setBusy(true);
    try {
      const id = await persist('sent');
      if (id) {
        const phone = supplier?.phone ? intlPhone(supplier.phone) : '';
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message())}`, '_blank', 'noopener');
        a.toast(t('Commande marquée comme envoyée')); onSaved(); onClose();
      }
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const cancel = async () => {
    if (!po) { onClose(); return; }
    try { check(await supabase.from('purchase_orders').update({ status: 'cancelled' }).eq('id', po.id).select('id')); a.toast(t('Commande annulée')); onSaved(); onClose(); } catch (e) { a.fail(e); }
  };
  if (receiving && po) return <ReceiveModal po={po} ings={ings} supName={supplier?.name} onClose={() => setReceiving(false)} onDone={() => { onSaved(); onClose(); }} />;

  const sorted = ings.filter(g => !lines.some(l => l.ingredient_id === g.id)).sort((x, y) => (x.supplier_id === sup ? 0 : 1) - (y.supplier_id === sup ? 0 : 1) || x.name.localeCompare(y.name));
  return (
    <Modal wide title={po ? `${po.doc_number} · ${t(PO_STATUS[po.status])}` : t('Nouvelle commande')} onClose={onClose}
      footer={<div className="flex flex-wrap items-center gap-2">
        {editable && po && <Btn tone="ghost" className="text-danger" onClick={cancel}><X className="h-4 w-4" /> {t('Annuler la commande')}</Btn>}
        <span className="me-auto text-sm text-muted">{t('Total estimé')} <b className="text-ink tabular">{mad(Math.round(po?.status === 'received' ? poTotal(po) : total))}</b></span>
        {editable && <Btn disabled={busy} onClick={save}>{t('Enregistrer')}</Btn>}
        {editable && <Btn disabled={busy || !valid} onClick={send}><MessageCircle className="h-4 w-4" /> {po?.status === 'sent' ? t('Renvoyer sur WhatsApp') : t('Envoyer sur WhatsApp')}</Btn>}
        {po && editable && <Btn tone="brand" disabled={busy} onClick={() => setReceiving(true)}><PackageCheck className="h-4 w-4" /> {t('Réceptionner')}</Btn>}
      </div>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Fournisseur')}>
            <select className={inputCls} value={sup} disabled={!editable} onChange={e => setSup(e.target.value)}>
              <option value="">{t('Sans fournisseur (marché, souk…)')}</option>
              {sups.filter(s => s.active || s.id === sup).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label={t('Livraison prévue')}><input type="date" className={inputCls} disabled={!editable} value={expected} onChange={e => setExpected(e.target.value)} /></Field>
        </div>
        {supplier && !supplier.phone && editable && <p className="flex items-center gap-2 rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn"><Phone className="h-4 w-4" /> {t('Pas de numéro WhatsApp pour ce fournisseur : WhatsApp vous laissera choisir le contact.')}</p>}
        <div className="overflow-x-auto rounded-2xl border border-line/10">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted"><tr>
              <th className="px-3 py-2 text-start">{t('Produit')}</th><th className="px-3 py-2 text-end">{t('Quantité')}</th><th className="px-3 py-2 text-end">{t('Prix unitaire (DH)')}</th><th className="px-3 py-2 text-end">{po?.status === 'received' ? t('Reçu') : t('Total')}</th><th className="w-10" />
            </tr></thead>
            <tbody className="divide-y divide-line/10">
              {lines.map((l, k) => {
                const g = byId.get(l.ingredient_id), got = po?.purchase_order_lines.find(x => x.id === l.id);
                return (
                  <tr key={l.id ?? `n${k}`}>
                    <td className="px-3 py-2"><p className="font-semibold">{g?.name ?? '—'}</p>{g?.stock_qty != null && <p className="text-xs text-muted">{t('Stock actuel : {q}', { q: fmtQty(Number(g.stock_qty), g.base_unit) })}</p>}</td>
                    <td className="px-3 py-2"><div className="flex items-center justify-end gap-1.5"><input className={`${inputCls} w-20 text-end`} inputMode="decimal" disabled={!editable} value={l.units} onChange={e => setLines(x => x.map((y, j) => (j === k ? { ...y, units: e.target.value } : y)))} /><span className="w-16 truncate text-xs text-muted">{g?.purchase_unit}</span></div></td>
                    <td className="px-3 py-2"><input className={`${inputCls} ms-auto w-24 text-end`} inputMode="decimal" disabled={!editable} value={l.price} placeholder="—" onChange={e => setLines(x => x.map((y, j) => (j === k ? { ...y, price: e.target.value } : y)))} /></td>
                    <td className="px-3 py-2 text-end tabular">{po?.status === 'received' ? (got?.received_units != null ? `${units(Number(got.received_units))} · ${got.received_cents != null ? mad(Number(got.received_cents)) : '—'}` : '—') : l.price.trim() ? mad(Math.round(num(l.units) * toCents(l.price))) : '—'}</td>
                    <td className="px-1">{editable && <button aria-label={t('Supprimer')} onClick={() => setLines(x => x.filter((_, j) => j !== k))} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"><Trash2 className="h-4 w-4" /></button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {editable && (
          <select className={inputCls} value="" onChange={e => { const g = byId.get(e.target.value); if (g) setLines(x => [...x, { ingredient_id: g.id, units: '1', price: g.purchase_price_cents != null ? shown(g.purchase_price_cents / 100) : '' }]); }}>
            <option value="">{t('+ Ajouter un produit')}</option>
            {sorted.map(g => <option key={g.id} value={g.id}>{g.name}{g.supplier_id && g.supplier_id === sup ? ' ★' : ''}</option>)}
          </select>
        )}
        <Field label={t('Note pour le fournisseur')}><input className={inputCls} maxLength={300} disabled={!editable} value={note} onChange={e => setNote(e.target.value)} placeholder={t('Livrer avant 10 h, entrée par l’arrière…')} /></Field>
      </div>
    </Modal>
  );
}

function ReceiveModal({ po, ings, supName, onClose, onDone }: { po: Po; ings: Ingredient[]; supName?: string; onClose: () => void; onDone: () => void }) {
  const a = useAdminCtx();
  const byId = new Map(ings.map(g => [g.id, g]));
  const [rows, setRows] = useState(() => po.purchase_order_lines.slice().sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0)).map(l => ({
    line_id: l.id!, ingredient_id: l.ingredient_id, ordered: Number(l.units), units: units(Number(l.units)),
    total: l.unit_price_cents != null ? shown(Math.round(Number(l.units) * l.unit_price_cents) / 100) : '' })));
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [alerts, setAlerts] = useState<{ name: string; purchase_unit: string; old_cents: number; new_cents: number; bp: number }[] | null>(null);
  const sum = rows.reduce((s, x) => s + (x.total.trim() ? toCents(x.total) : 0), 0);
  const save = async () => {
    if (rows.some(x => !(num(x.units) >= 0))) { a.toast(t('Indiquez la quantité.'), 'error'); return; }
    setBusy(true);
    try {
      const res = await rpc<{ purchases: number; price_alerts: typeof alerts }>('po_receive', { p_order_id: po.id, p_received_on: date, p_after_count: true,
        p_lines: rows.map(x => ({ line_id: x.line_id, units: num(x.units), total_cents: x.total.trim() ? toCents(x.total) : null })) });
      a.toast(t('Livraison reçue : stock et prix mis à jour'));
      if (res.price_alerts?.length) setAlerts(res.price_alerts); else onDone();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  if (alerts) return (
    <Modal title={t('Attention aux prix')} onClose={onDone} footer={<div className="flex justify-end"><Btn tone="brand" onClick={onDone}>{t('Compris')}</Btn></div>}>
      <p className="mb-3 text-sm text-muted">{t('Ces produits coûtent plus cher que la dernière fois. Le coût de vos plats est déjà mis à jour : vérifiez vos marges.')}</p>
      <ul className="divide-y divide-line/10">
        {alerts.map(x => <li key={x.name} className="flex items-center justify-between py-2"><span className="font-semibold">{x.name}</span>
          <span className="tabular"><span className="text-muted line-through">{mad(Number(x.old_cents))}</span> → <b>{mad(Number(x.new_cents))}</b> / {x.purchase_unit} <span className="ms-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-bold text-danger">+{(x.bp / 100).toFixed(0)} %</span></span></li>)}
      </ul>
    </Modal>
  );
  return (
    <Modal wide title={t('Réceptionner {d}', { d: po.doc_number })} onClose={onClose}
      footer={<div className="flex items-center gap-3"><span className="me-auto text-sm text-muted">{t('Payé')} <b className="text-ink tabular">{mad(sum)}</b></span>
        <Btn tone="ghost" onClick={onClose}>{t('Retour')}</Btn><Btn tone="brand" disabled={busy} onClick={save}><PackageCheck className="h-4 w-4" /> {t('Confirmer la réception')}</Btn></div>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <p className="self-end text-sm text-muted">{supName ?? t('Sans fournisseur')} · {t('{n} produits', { n: rows.length })}</p>
          <Field label={t('Reçu le')}><input type="date" className={inputCls} value={date} max={today()} onChange={e => setDate(e.target.value)} /></Field>
        </div>
        <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">{t('Corrigez ce qui est vraiment arrivé et le prix payé. Mettez 0 pour un produit non livré. Le stock monte tout de suite.')}</p>
        <div className="space-y-2">
          {rows.map((x, k) => {
            const g = byId.get(x.ingredient_id), diff = num(x.units) !== x.ordered;
            return (
              <div key={x.line_id} className={`grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-2xl border p-3 ${diff ? 'border-warn/50 bg-warn/5' : 'border-line/10'}`}>
                <span><span className="block font-semibold">{g?.name}</span><span className="text-xs text-muted">{t('commandé : {q}', { q: `${units(x.ordered)} ${g?.purchase_unit ?? ''}` })}</span></span>
                <span className="flex items-center gap-1.5"><input aria-label={t('Quantité reçue')} className={`${inputCls} w-20 text-end`} inputMode="decimal" value={x.units} onChange={e => setRows(rs => rs.map((y, j) => (j === k ? { ...y, units: e.target.value } : y)))} /><span className="w-14 truncate text-xs text-muted">{g?.purchase_unit}</span></span>
                <input aria-label={t('Prix payé (DH)')} className={`${inputCls} w-28 text-end`} inputMode="decimal" placeholder={t('payé (DH)')} value={x.total} onChange={e => setRows(rs => rs.map((y, j) => (j === k ? { ...y, total: e.target.value } : y)))} />
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

function SuppliersModal({ r, ings, sups, onClose, onSaved }: { r: Restaurant; ings: Ingredient[]; sups: Supplier[]; onClose: () => void; onSaved: () => void }) {
  const [edit, setEdit] = useState<Supplier | 'new' | null>(sups.length ? null : 'new');
  const [importing, setImporting] = useState(false);
  if (importing) return <ImportData kind="suppliers" r={r} existing={sups.map(s => s.name)} onClose={() => setImporting(false)} onDone={onSaved} />;
  if (edit) return <SupplierEditor r={r} ings={ings} s={edit === 'new' ? null : edit} onClose={() => (sups.length ? setEdit(null) : onClose())} onSaved={() => { onSaved(); setEdit(null); }} />;
  return (
    <Modal title={t('Fournisseurs')} onClose={onClose} footer={<div className="flex justify-end gap-2"><Btn onClick={() => setImporting(true)}><Upload className="h-4 w-4" /> {t('Importer')}</Btn><Btn tone="brand" onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> {t('Ajouter un fournisseur')}</Btn></div>}>
      <ul className="divide-y divide-line/10">
        {sups.map(s => {
          const n = ings.filter(g => g.supplier_id === s.id).length;
          return (
            <li key={s.id}>
              <button onClick={() => setEdit(s)} className={`flex w-full items-center gap-3 py-3 text-start ${s.active ? '' : 'opacity-50'}`}>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-surface-2 text-brand"><Truck className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1"><span className="block font-semibold">{s.name}</span>
                  <span className="block text-xs text-muted">{t('{n} produits', { n })}{s.delivery_days.length ? ` · ${s.delivery_days.map(d => t(WEEKDAYS[d - 1])).join(', ')}` : ''}{s.phone ? ` · +${s.phone}` : ''}</span></span>
                <Pencil className="h-4 w-4 text-muted" />
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

function SupplierEditor({ r, ings, s, onClose, onSaved }: { r: Restaurant; ings: Ingredient[]; s: Supplier | null; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [f, setF] = useState({ name: s?.name ?? '', phone: s?.phone ? `+${s.phone}` : '', contact: s?.contact ?? '', email: s?.email ?? '', note: s?.note ?? '', lead: String(s?.lead_days ?? 1), days: s?.delivery_days ?? [], active: s?.active ?? true });
  const [mine, setMine] = useState<Set<string>>(() => new Set(s ? ings.filter(g => g.supplier_id === s.id).map(g => g.id) : []));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const row = { name: f.name.trim(), phone: intlPhone(f.phone) || null, contact: f.contact.trim() || null, email: f.email.trim() || null, note: f.note.trim() || null,
        lead_days: Math.max(0, Math.min(30, Math.round(Number(f.lead) || 0))), delivery_days: [...f.days].sort(), active: f.active };
      let id = s?.id;
      if (id) check(await supabase.from('suppliers').update(row).eq('id', id).select('id'));
      else id = (check(await supabase.from('suppliers').insert({ ...row, restaurant_id: r.id }).select('id')) as { id: string }[])[0].id;
      const before = new Set(ings.filter(g => g.supplier_id === id).map(g => g.id));
      const add = [...mine].filter(x => !before.has(x)), drop = [...before].filter(x => !mine.has(x));
      if (add.length) check(await supabase.from('ingredients').update({ supplier_id: id }).in('id', add).select('id'));
      if (drop.length) check(await supabase.from('ingredients').update({ supplier_id: null }).in('id', drop).select('id'));
      a.toast(t('Enregistré')); onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const remove = async () => {
    if (!s) return;
    try { check(await supabase.from('suppliers').delete().eq('id', s.id).select('id')); a.toast(t('Fournisseur supprimé')); onSaved(); } catch (e) { a.fail(e); }
  };
  return (
    <Modal wide title={s ? s.name : t('Nouveau fournisseur')} onClose={onClose}
      footer={<div className="flex justify-between">{s ? <Btn tone="danger" onClick={remove}><Trash2 className="h-4 w-4" /> {t('Supprimer')}</Btn> : <span />}<Btn tone="brand" disabled={busy || !f.name.trim()} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3">
          <Field label={t('Nom')}><input autoFocus className={inputCls} maxLength={80} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder={t('Metro, grossiste Hay Riad…')} /></Field>
          <Field label={t('WhatsApp')} hint={t('Pour envoyer les commandes en un clic.')}><input className={inputCls} dir="ltr" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="06 61 00 00 00" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('Contact')}><input className={inputCls} maxLength={80} value={f.contact} onChange={e => setF({ ...f, contact: e.target.value })} placeholder={t('Prénom')} /></Field>
            <Field label={t('Délai (jours)')}><input className={inputCls} inputMode="numeric" value={f.lead} onChange={e => setF({ ...f, lead: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
          <Field group label={t('Jours de livraison')}>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d, i) => { const on = f.days.includes(i + 1); return <button key={d} type="button" onClick={() => setF({ ...f, days: on ? f.days.filter(x => x !== i + 1) : [...f.days, i + 1] })} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${on ? 'bg-night text-white' : 'bg-surface-2 text-muted'}`}><CalendarDays className="me-1 inline h-3.5 w-3.5" />{t(d)}</button>; })}
            </div>
          </Field>
          <Field label={t('Note')}><input className={inputCls} maxLength={300} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder={t('Paiement à 30 jours, minimum de commande…')} /></Field>
          {s && <Toggle checked={f.active} onChange={v => setF({ ...f, active: v })} label={t('Actif')} />}
        </div>
        <Field group label={t('Ses produits ({n})', { n: mine.size })}>
          <div className="max-h-96 space-y-1 overflow-y-auto rounded-2xl bg-surface-2 p-3">
            {ings.map(g => (
              <label key={g.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={mine.has(g.id)} onChange={() => setMine(x => { const n = new Set(x); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })} />
                <span className="flex-1">{g.name}</span>
              </label>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
