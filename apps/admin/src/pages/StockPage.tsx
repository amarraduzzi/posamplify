// Amplify Profit: inventory. Count the stock (phone in hand), note purchases,
// and see what was really used, and with Amplify POS: what disappeared without
// being sold (waste, free food, theft), per ingredient and in dirhams.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, ClipboardList, Copy, Lock, Plus, Search, Send, ShoppingBasket, Trash2, Unlock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, mad, rpc, toCents } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { BaseUnit, Ingredient, Restaurant } from '../lib/types';
import { CATEGORIES, SIZE_UNIT, fmtQty, pct } from '../lib/profit';
import { Btn, Field, Modal, inputCls } from '../components/ui';

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
  status: 'urgent' | 'order' | 'ok' | 'no_use' | 'not_counted';
}
interface Forecast { today: string; uses_pos: boolean; order_days: number; sales_days: number | null; items: FItem[] }
type Tab = 'buy' | 'gaps' | 'history';
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
  const [tab, setTab] = useState<Tab>('buy');
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
      setIngs(check(g) as Ingredient[]); setCounts(cs); setLines(ls); setBuys(check(p) as Purchase[]); setFc(f);
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

  const TABS: [Tab, string][] = [['buy', t('Stock et achats à faire')], ['gaps', t('Écarts')], ['history', t('Comptages et achats')]];
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

        {tab === 'buy' && (fc && fc.items.some(i => i.counted != null)
          ? <BuyView r={r} fc={fc} onBuy={setBuying} onChanged={load} />
          : steps)}

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
function BuyView({ r, fc, onBuy, onChanged }: { r: Restaurant; fc: Forecast; onBuy: (p: Prefill[]) => void; onChanged: () => void }) {
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
  const whatsapp = () => window.open(`https://wa.me/?text=${encodeURIComponent(listText())}`, '_blank', 'noopener');
  const copy = async () => { try { await navigator.clipboard.writeText(listText()); a.toast(t('Liste copiée')); } catch { a.toast(t('Copie impossible'), 'error'); } };
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
          <Btn tone="brand" disabled={!chosen.length} onClick={() => onBuy(chosen.map(i => ({ ingredient_id: i.ingredient_id, qty: buyUnits(i), total_cents: i.purchase_price_cents != null ? Math.round(buyUnits(i) * i.purchase_price_cents) : null })))}>
            <ShoppingBasket className="h-4 w-4" /> {t('Noter comme acheté ({n})', { n: chosen.length })}</Btn>
          <Btn disabled={!chosen.length} onClick={whatsapp}><Send className="h-4 w-4" /> {t('Envoyer par WhatsApp')}</Btn>
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
                    <p className="text-xs text-muted">{t('compté le {d}', { d: day(i.counted_on!) })}{Number(i.bought_since) > 0 ? ` · ${t('+ achats')}` : ''}</p>
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
