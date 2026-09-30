// Amplify Profit: inventory. Count the stock (phone in hand), note purchases,
// and see what was really used, and with Amplify POS: what disappeared without
// being sold (waste, free food, theft), per ingredient and in dirhams.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, ClipboardList, Lock, Plus, Search, ShoppingBasket, Trash2, Unlock } from 'lucide-react';
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

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const num = (s: string) => Number(String(s).replace(',', '.').replace(/\s/g, ''));
const shown = (x: number) => String(Math.round(x * 1000) / 1000).replace('.', ',');
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
/** stock value of a quantity (gross, no waste: it is what is on the shelf) */
const value = (g: Ingredient | undefined, qty: number) => (g?.purchase_price_cents == null ? 0 : qty * g.purchase_price_cents / Number(g.purchase_qty));

export function StockPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [ings, setIngs] = useState<Ingredient[] | null>(null);
  const [counts, setCounts] = useState<Count[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [buys, setBuys] = useState<Purchase[]>([]);
  const [sheet, setSheet] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [pair, setPair] = useState<[string, string] | null>(null);
  const [rep, setRep] = useState<Report | null>(null);

  const load = useCallback(async () => {
    try {
      const [g, c, p] = await Promise.all([
        supabase.from('ingredients').select('*').eq('restaurant_id', r.id).eq('active', true).order('category').order('name'),
        supabase.from('stock_counts').select('*').eq('restaurant_id', r.id).order('counted_on', { ascending: false }).order('created_at', { ascending: false }).limit(60),
        supabase.from('stock_purchases').select('*').eq('restaurant_id', r.id).order('purchased_on', { ascending: false }).order('created_at', { ascending: false }).limit(40),
      ]);
      const cs = check(c) as Count[];
      const ls = cs.length ? check(await supabase.from('stock_count_lines').select('count_id, ingredient_id, qty').eq('restaurant_id', r.id).in('count_id', cs.map(x => x.id))) as Line[] : [];
      setIngs(check(g) as Ingredient[]); setCounts(cs); setLines(ls); setBuys(check(p) as Purchase[]);
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

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="me-auto">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-brand">Amplify Profit</p>
          <h1 className="font-display text-3xl font-semibold">{t('Inventaire')}</h1>
          <p className="text-muted">{t('Ce que vous avez vraiment utilisé, et ce qui a disparu sans être vendu.')}</p>
        </div>
        <Btn onClick={() => setBuying(true)} disabled={!ings.length}><ShoppingBasket className="h-4 w-4" /> {t('Noter un achat')}</Btn>
        <Btn tone="brand" onClick={newCount} disabled={!ings.length}><ClipboardList className="h-4 w-4" /> {open ? t('Continuer le comptage') : t('Nouveau comptage')}</Btn>
      </div>

      {!ings.length ? (
        <div className="card rounded-3xl p-10 text-center text-muted">
          <p>{t('Ajoutez d’abord vos ingrédients (page Ingrédients), ou laissez l’IA remplir vos fiches techniques dans Marges.')}</p>
        </div>
      ) : rep ? <ReportView rep={rep} closed={closed} cmp={cmp!} setPair={setPair} />
        : (
        <div className="night mb-5 rounded-[2rem] p-6 md:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">{t('Comment ça marche')}</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">{t('Trois gestes, et vous savez où part votre marchandise')}</h2>
          <ol className="mt-5 grid gap-4 md:grid-cols-3">
            {[
              [t('Comptez votre stock'), t('Le soir après le service, sur votre téléphone. Commencez par les produits chers : viande, poisson, fromage, boissons.'), closed.length >= 1],
              [t('Notez vos achats'), t('Chaque livraison ou passage au marché. Le prix de l’ingrédient se met à jour tout seul.'), buys.length > 0],
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
      )}

      {ings.length > 0 && (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
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
              <Btn tone="brand" className="px-3 py-1.5" onClick={() => setBuying(true)}><Plus className="h-4 w-4" /> {t('Ajouter')}</Btn>
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

      {buying && <PurchaseEditor r={r} ings={ings} onClose={() => setBuying(false)} onSaved={() => { setBuying(false); load(); }} />}
    </div>
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

// ------------------------------------------------------------ a purchase
function PurchaseEditor({ r, ings, onClose, onSaved }: { r: Restaurant; ings: Ingredient[]; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [id, setId] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState<'buy' | 'size'>('buy');
  const [total, setTotal] = useState('');
  const [date, setDate] = useState(today());
  const [supplier, setSupplier] = useState('');
  const [busy, setBusy] = useState(false);
  const g = ings.find(x => x.id === id);
  const sameUnit = g && Number(g.purchase_qty) === SIZE_UNIT[g.base_unit].f;
  const factor = g ? (unit === 'buy' ? Number(g.purchase_qty) : SIZE_UNIT[g.base_unit].f) : 1;
  const base = num(qty) * factor;

  const save = async () => {
    if (!g) { a.toast(t('Choisissez le produit.'), 'error'); return; }
    if (!(base > 0)) { a.toast(t('Indiquez la quantité.'), 'error'); return; }
    setBusy(true);
    try {
      check(await supabase.from('stock_purchases').insert({
        restaurant_id: r.id, ingredient_id: g.id, purchased_on: date, qty: base,
        total_cents: total.trim() ? toCents(total) : null, supplier: supplier.trim() || null,
      }).select('id'));
      a.toast(total.trim() ? t('Achat enregistré, prix mis à jour') : t('Achat enregistré')); onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };

  return (
    <Modal title={t('Noter un achat')} onClose={onClose}
      footer={<div className="flex justify-end gap-3"><Btn tone="ghost" onClick={onClose}>{t('Annuler')}</Btn><Btn tone="brand" disabled={busy} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <Field label={t('Produit')}>
          <select autoFocus className={inputCls} value={id} onChange={e => { setId(e.target.value); setUnit('buy'); }}>
            <option value="">{t('Choisir…')}</option>
            {Object.entries(CATEGORIES).map(([k, v]) => {
              const gs = ings.filter(x => x.category === k);
              return gs.length ? <optgroup key={k} label={t(v)}>{gs.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup> : null;
            })}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Quantité')} hint={g && base > 0 ? `= ${fmtQty(base, g.base_unit)}` : undefined}>
            <div className="flex gap-2">
              <input className={inputCls} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} placeholder="5" />
              {g && (sameUnit ? <span className="self-center text-sm text-muted">{g.purchase_unit}</span> : (
                <select aria-label={t('Unité')} className={`${inputCls} w-auto`} value={unit} onChange={e => setUnit(e.target.value as 'buy' | 'size')}>
                  <option value="buy">{g.purchase_unit}</option>
                  <option value="size">{t(SIZE_UNIT[g.base_unit].u)}</option>
                </select>
              ))}
            </div>
          </Field>
          <Field label={t('Prix payé au total (DH)')} hint={t('Facultatif. Met à jour le prix de l’ingrédient.')}>
            <input className={inputCls} inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} placeholder="195" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Date')}><input type="date" className={inputCls} value={date} max={today()} onChange={e => setDate(e.target.value)} /></Field>
          <Field label={t('Fournisseur (facultatif)')}><input className={inputCls} value={supplier} onChange={e => setSupplier(e.target.value)} placeholder={g?.supplier ?? ''} /></Field>
        </div>
      </div>
    </Modal>
  );
}
