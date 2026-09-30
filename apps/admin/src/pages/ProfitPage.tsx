// Amplify Profit: margins per dish, recipe cards, and the AI that fills them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Check, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { tr } from '@resto/shared';
import { supabase } from '../lib/supabase';
import { check, mad, rpc, errorMessage } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { BaseUnit, I18n, Ingredient, ProfitData, ProfitDish, RecipeLine, Restaurant } from '../lib/types';
import { RECIPE_UNITS, fcTone, fmtQty, pct, unitCost } from '../lib/profit';
import { IngredientEditor } from '../components/IngredientEditor';
import { Btn, Modal, inputCls } from '../components/ui';

const key = (d: { item_id: string; variant_id: string | null }) => `${d.item_id}|${d.variant_id ?? ''}`;
const TONE = { ok: 'bg-ok/12 text-ok', warn: 'bg-warn/15 text-warn', bad: 'bg-danger/12 text-danger', none: 'bg-surface-2 text-muted' };

export function ProfitPage({ r, onIngredients }: { r: Restaurant; onIngredients: () => void }) {
  const a = useAdminCtx();
  const lang = r.languages[0] ?? 'fr';
  const [data, setData] = useState<ProfitData | null>(null);
  const [edit, setEdit] = useState<ProfitDish | null>(null);
  const [ai, setAi] = useState(false);
  const [filter, setFilter] = useState<'all' | 'bad' | 'todo'>('all');

  const load = useCallback(async () => {
    try { setData(await rpc<ProfitData>('profit_dishes', { p_restaurant_id: r.id, p_days: 30 })); }
    catch (e) { a.fail(e); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);

  const target = data?.target_food_cost_bp ?? 3000;
  const dishes = data?.dishes ?? [];
  const costed = dishes.filter(d => d.cost_cents != null);
  const todo = dishes.filter(d => d.lines === 0);
  const bad = costed.filter(d => fcTone(d.food_cost_bp, target) === 'bad');
  const estimated = dishes.filter(d => d.estimated > 0 || d.unpriced > 0).length;
  // average food cost: weighted by sales when the till tells us what sold, else a plain average
  const soldCosted = costed.filter(d => d.sold_qty > 0);
  const avgFc = soldCosted.length
    ? Math.round(soldCosted.reduce((s, d) => s + d.cost_cents! * d.sold_qty, 0) * 10000 / Math.max(1, soldCosted.reduce((s, d) => s + d.price_ht_cents * d.sold_qty, 0)))
    : costed.length ? Math.round(costed.reduce((s, d) => s + (d.food_cost_bp ?? 0), 0) / costed.length) : null;
  const profit = soldCosted.reduce((s, d) => s + (d.profit_cents ?? 0), 0);

  const shown = filter === 'bad' ? bad : filter === 'todo' ? todo : dishes;
  const groups = useMemo(() => {
    const m = new Map<string, ProfitDish[]>();
    for (const d of shown) { const k = tr(d.category, lang); m.set(k, [...(m.get(k) ?? []), d]); }
    return [...m.entries()];
  }, [shown, lang]);
  const dname = (d: ProfitDish) => tr(d.name, lang) + (d.variant_name ? ` · ${tr(d.variant_name, lang)}` : '');

  const setTarget = async (v: string) => {
    const bp = Math.round((Number(v.replace(',', '.')) || 0) * 100);
    if (bp < 500 || bp > 8000 || bp === target) return;
    try {
      check(await supabase.from('restaurants').update({ profit_settings: { ...(r.profit_settings ?? {}), target_food_cost_bp: bp } }).eq('id', r.id).select('id'));
      a.toast(t('Objectif enregistré')); load();
    } catch (e) { a.fail(e); }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="me-auto">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-brand">Amplify Profit</p>
          <h1 className="font-display text-3xl font-semibold">{t('Marges')}</h1>
          <p className="text-muted">{t('Ce que coûte chaque plat, ce qu’il vous rapporte, et quel prix demander.')}</p>
        </div>
        <Btn tone="ghost" onClick={onIngredients}>{t('Ingrédients')}</Btn>
        {todo.length > 0 && <Btn tone="brand" onClick={() => setAi(true)}><Sparkles className="h-4 w-4" /> {t('Remplir avec l’IA')}</Btn>}
      </div>

      {data === null ? <p className="text-muted">{t('Chargement…')}</p> : !dishes.length ? (
        <div className="card rounded-3xl p-10 text-center">
          <p className="font-semibold">{t('Aucun plat pour le moment.')}</p>
          <p className="mt-1 text-sm text-muted">{t('Ajoutez ou importez d’abord votre menu (rubrique Menu > Importer) : une photo de votre carte suffit.')}</p>
        </div>
      ) : (<>
        {/* ---- key figures */}
        <div className="night relative mb-5 grid gap-5 overflow-hidden rounded-[2rem] p-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">{t('Food cost moyen')}</p>
            <p className="mt-1 font-display text-4xl font-semibold tabular">{pct(avgFc)}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-white/60">{t('Objectif')}
              <input key={target} defaultValue={String(target / 100).replace('.', ',')} disabled={!a.canEditProfile} onBlur={e => setTarget(e.target.value)}
                aria-label={t('Objectif food cost')} className="w-12 rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-center text-white outline-none focus:border-brand" /> %</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">{t('Fiches techniques')}</p>
            <p className="mt-1 font-display text-4xl font-semibold tabular">{costed.length}<span className="text-xl text-white/50"> / {dishes.length}</span></p>
            <p className="mt-1 text-sm text-white/60">{todo.length ? t('{n} plats sans fiche', { n: todo.length }) : t('Tous vos plats ont une fiche')}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">{t('Plats trop chers à produire')}</p>
            <p className={`mt-1 font-display text-4xl font-semibold tabular ${bad.length ? 'text-[#F47171]' : ''}`}>{bad.length}</p>
            <p className="mt-1 text-sm text-white/60">{t('au-dessus de {p}', { p: pct(target + 500) })}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">{data.uses_pos ? t('Marge sur {d} jours', { d: data.days }) : t('Prix à vérifier')}</p>
            {data.uses_pos && soldCosted.length
              ? <><p className="mt-1 font-display text-4xl font-semibold tabular">{mad(profit)}</p><p className="mt-1 text-sm text-white/60">{t('hors TVA, sur les plats vendus en caisse')}</p></>
              : <><p className="mt-1 font-display text-4xl font-semibold tabular">{estimated}</p><p className="mt-1 text-sm text-white/60">{t('plats avec un prix estimé ou manquant')}</p></>}
          </div>
        </div>

        {estimated > 0 && (
          <button onClick={onIngredients} className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-warn/40 bg-warn/5 px-4 py-3 text-start text-sm hover:bg-warn/10">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warn" />
            <span className="flex-1">{t('Certains prix sont estimés par l’IA ou manquants. Mettez vos vrais prix d’achat pour des marges exactes.')}</span>
            <span className="font-semibold text-warn">{t('Ingrédients')} →</span>
          </button>
        )}

        <div className="mb-3 flex flex-wrap gap-2">
          {([['all', t('Tous ({n})', { n: dishes.length })], ['bad', t('À revoir ({n})', { n: bad.length })], ['todo', t('Sans fiche ({n})', { n: todo.length })]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${filter === k ? 'bg-night text-white' : 'bg-surface-2 text-muted hover:text-ink'}`}>{l}</button>
          ))}
        </div>

        {/* ---- dishes */}
        <div className="space-y-4">
          {groups.map(([cat, ds]) => (
            <section key={cat} className="card overflow-hidden rounded-3xl">
              <h2 className="bg-surface-2 px-4 py-2.5 text-sm font-bold"><bdi>{cat}</bdi></h2>
              <div className="hidden grid-cols-[1fr_90px_90px_90px_100px] gap-3 px-4 pt-2 text-[11px] font-bold uppercase tracking-wider text-muted md:grid">
                <span>{t('Plat')}</span><span className="text-end">{t('Prix')}</span><span className="text-end">{t('Coût')}</span><span className="text-end">{t('Food cost')}</span><span className="text-end">{t('Marge')}</span>
              </div>
              <ul className="divide-y divide-line/10">
                {ds.map(d => {
                  const tone = fcTone(d.food_cost_bp, target);
                  const under = d.suggested_price_cents != null && d.suggested_price_cents > d.price_cents;
                  return (
                    <li key={key(d)}>
                      <button onClick={() => setEdit(d)} className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-start hover:bg-surface-2/60 md:grid-cols-[1fr_90px_90px_90px_100px]">
                        <span className="min-w-0">
                          <span className="block truncate font-semibold"><bdi>{dname(d)}</bdi></span>
                          <span className="flex flex-wrap gap-x-3 text-xs text-muted">
                            {d.lines === 0 ? <span className="font-semibold text-brand">+ {t('Créer la fiche')}</span> : <span>{t('{n} ingrédients', { n: d.lines })}</span>}
                            {(d.estimated > 0 || d.unpriced > 0) && <span className="text-warn">{t('prix estimés')}</span>}
                            {data.uses_pos && d.sold_qty > 0 && <span>{t('{n} vendus', { n: d.sold_qty })}</span>}
                            {under && <span className="flex items-center gap-0.5 font-semibold text-danger"><ArrowUpRight className="h-3 w-3" />{t('prix conseillé {p}', { p: mad(d.suggested_price_cents!) })}</span>}
                          </span>
                        </span>
                        <span className="hidden text-end tabular md:block">{mad(d.price_cents)}</span>
                        <span className="hidden text-end tabular text-muted md:block">{d.cost_cents == null ? '—' : mad(d.cost_cents)}</span>
                        <span className="text-end"><span className={`inline-block rounded-lg px-2 py-1 text-sm font-bold tabular ${TONE[tone]}`}>{pct(d.food_cost_bp)}</span></span>
                        <span className="hidden text-end font-semibold tabular md:block">{d.margin_cents == null ? '—' : mad(d.margin_cents)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">{t('Food cost = coût des ingrédients ÷ prix de vente hors TVA. Marge = prix hors TVA − coût des ingrédients (avant loyer et salaires).')}</p>
      </>)}

      {edit && data && <RecipeEditor r={r} dish={edit} sizes={dishes.filter(d => d.item_id === edit.item_id)} target={target}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {ai && <AiFill r={r} dishes={todo} onClose={() => setAi(false)} onSaved={() => { setAi(false); load(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recipe card of one dish (or one size of it)
// ---------------------------------------------------------------------------
// qty in base units; unit/text = how the owner typed it (kept stable while typing)
type Draft = { id?: string; ingredient_id: string; qty: number; variant_id: string | null; unit: string; text: string };
const num = (x: number) => String(Math.round(x * 1000) / 1000).replace('.', ',');
function display(qty: number, base: BaseUnit) {
  const units = RECIPE_UNITS[base];
  const u = [...units].reverse().find(x => qty >= x.f && (qty / x.f) % 1 === 0) ?? units[0];
  return { unit: u.u, text: num(qty / u.f) };
}

function RecipeEditor({ r, dish, sizes, target, onClose, onSaved }: {
  r: Restaurant; dish: ProfitDish; sizes: ProfitDish[]; target: number; onClose: () => void; onSaved: () => void;
}) {
  const a = useAdminCtx();
  const lang = r.languages[0] ?? 'fr';
  const [ings, setIngs] = useState<Ingredient[]>([]);
  const [lines, setLines] = useState<Draft[] | null>(null);
  const [orig, setOrig] = useState<RecipeLine[]>([]);
  const [pick, setPick] = useState('');
  const [creating, setCreating] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasSizes = dish.variant_id !== null;

  useEffect(() => {
    (async () => {
      try {
        const [g, l] = await Promise.all([
          supabase.from('ingredients').select('*').eq('restaurant_id', r.id).eq('active', true).order('name'),
          supabase.from('recipe_lines').select('*').eq('restaurant_id', r.id).eq('menu_item_id', dish.item_id).order('sort_order'),
        ]);
        setIngs(check(g) as Ingredient[]);
        const all = check(l) as RecipeLine[];
        const mine = all.filter(x => x.variant_id === null || x.variant_id === dish.variant_id);
        const gs = new Map((check(g) as Ingredient[]).map(x => [x.id, x]));
        setOrig(mine);
        setLines(mine.map(x => ({ id: x.id, ingredient_id: x.ingredient_id, qty: Number(x.qty), variant_id: x.variant_id,
          ...display(Number(x.qty), gs.get(x.ingredient_id)?.base_unit ?? 'g') })));
      } catch (e) { a.fail(e); onClose(); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.id, dish.item_id, dish.variant_id]);

  const byId = useMemo(() => new Map(ings.map(g => [g.id, g])), [ings]);
  const lineCost = (l: Draft) => { const g = byId.get(l.ingredient_id); const c = g && unitCost(g); return c == null ? null : l.qty * c; };
  const cost = Math.round((lines ?? []).reduce((s, l) => s + (lineCost(l) ?? 0), 0));
  const fc = dish.price_ht_cents > 0 && lines?.length ? Math.round(cost * 10000 / dish.price_ht_cents) : null;
  const suggested = cost > 0 ? Math.ceil(cost * 10000 / target * (10000 + dish.vat_bp) / 10000 / 100) * 100 : null;

  const add = (g: Ingredient) => {
    const qty = g.base_unit === 'pc' ? 1 : 100;
    setLines(ls => [...(ls ?? []), { ingredient_id: g.id, qty, variant_id: null, ...display(qty, g.base_unit) }]);
    setPick('');
  };
  const onPick = (v: string) => {
    setPick(v);
    const g = ings.find(x => x.name.toLowerCase() === v.trim().toLowerCase());
    if (g) add(g);
  };

  const save = async () => {
    if (!lines) return;
    if (lines.some(l => !(l.qty > 0))) { a.toast(t('Indiquez une quantité pour chaque ingrédient.'), 'error'); return; }
    setBusy(true);
    try {
      const keep = new Set(lines.filter(l => l.id).map(l => l.id));
      const gone = orig.filter(o => !keep.has(o.id)).map(o => o.id);
      if (gone.length) check(await supabase.from('recipe_lines').delete().in('id', gone).select('id'));
      for (const [i, l] of lines.entries()) {
        const row = { qty: l.qty, variant_id: l.variant_id, sort_order: (i + 1) * 10 };
        if (l.id) check(await supabase.from('recipe_lines').update(row).eq('id', l.id).select('id'));
        else check(await supabase.from('recipe_lines').insert({ ...row, restaurant_id: r.id, menu_item_id: dish.item_id, ingredient_id: l.ingredient_id }).select('id'));
      }
      a.toast(t('Fiche enregistrée'));
      onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };

  const title = tr(dish.name, lang) + (dish.variant_name ? ` · ${tr(dish.variant_name, lang)}` : '');
  return (
    <Modal wide title={<span><bdi>{title}</bdi></span>} onClose={onClose}
      footer={<div className="flex flex-wrap items-center gap-3">
        <div className="me-auto text-sm tabular">
          {t('Coût')}: <b>{mad(cost)}</b> · {t('Food cost')}: <b className={fcTone(fc, target) === 'bad' ? 'text-danger' : fcTone(fc, target) === 'warn' ? 'text-warn' : 'text-ok'}>{pct(fc)}</b>
          {suggested && suggested > dish.price_cents && <span className="ms-2 text-danger">· {t('prix conseillé {p}', { p: mad(suggested) })}</span>}
        </div>
        <Btn tone="ghost" onClick={onClose}>{t('Annuler')}</Btn>
        <Btn tone="brand" disabled={busy || !lines} onClick={save}>{t('Enregistrer')}</Btn>
      </div>}>
      {lines === null ? <p className="text-muted">{t('Chargement…')}</p> : (
        <div>
          <div className="mb-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-2xl bg-surface-2 p-3"><p className="text-xs text-muted">{t('Prix de vente')}</p><p className="font-display text-xl font-semibold tabular">{mad(dish.price_cents)}</p><p className="text-[11px] text-muted">{t('{p} hors TVA', { p: mad(dish.price_ht_cents) })}</p></div>
            <div className="rounded-2xl bg-surface-2 p-3"><p className="text-xs text-muted">{t('Coût matière')}</p><p className="font-display text-xl font-semibold tabular">{mad(cost)}</p><p className="text-[11px] text-muted">{t('par portion')}</p></div>
            <div className="rounded-2xl bg-surface-2 p-3"><p className="text-xs text-muted">{t('Marge')}</p><p className="font-display text-xl font-semibold tabular">{mad(dish.price_ht_cents - cost)}</p><p className="text-[11px] text-muted">{t('par portion, hors TVA')}</p></div>
          </div>

          <ul className="divide-y divide-line/10 rounded-2xl border border-line/[0.08]">
            {lines.map((l, i) => {
              const g = byId.get(l.ingredient_id);
              if (!g) return null;
              const units = RECIPE_UNITS[g.base_unit as BaseUnit];
              const u = units.find(x => x.u === l.unit) ?? units[0];
              const c = lineCost(l);
              return (
                <li key={l.id ?? `n${i}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-3 py-2 sm:grid-cols-[1fr_170px_90px_auto]">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{g.name}{g.price_estimated && <span className="ms-2 rounded bg-warn/15 px-1 text-[10px] font-semibold text-warn">{t('estimé')}</span>}{g.purchase_price_cents == null && <span className="ms-2 text-[11px] text-danger">{t('prix manquant')}</span>}</p>
                    {hasSizes && (
                      <select aria-label={t('Taille')} className="mt-0.5 rounded-md bg-transparent text-xs text-muted" value={l.variant_id ?? ''}
                        onChange={e => setLines(ls => ls!.map((x, j) => (j === i ? { ...x, variant_id: e.target.value || null } : x)))}>
                        <option value="">{t('Toutes les tailles')}</option>
                        <option value={dish.variant_id!}>{t('Seulement {s}', { s: tr(dish.variant_name ?? {}, lang) })}</option>
                      </select>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <input aria-label={t('Quantité')} inputMode="decimal" className={`${inputCls} w-20 px-2 py-1.5 text-end tabular ${l.qty > 0 ? '' : 'border-danger'}`} value={l.text}
                      onChange={e => { const text = e.target.value; const v = Number(text.replace(',', '.')); setLines(ls => ls!.map((x, j) => (j === i ? { ...x, text, qty: v > 0 ? v * u.f : 0 } : x))); }} />
                    {units.length > 1 ? (
                      <select aria-label={t('Unité')} className={`${inputCls} w-16 px-1.5 py-1.5`} value={u.u}
                        onChange={e => { const nu = units.find(x => x.u === e.target.value)!; setLines(ls => ls!.map((x, j) => (j === i ? { ...x, unit: nu.u, qty: (Number(x.text.replace(',', '.')) || 0) * nu.f } : x))); }}>
                        {units.map(x => <option key={x.u} value={x.u}>{x.u}</option>)}
                      </select>
                    ) : <span className="w-16 text-sm text-muted">{u.u}</span>}
                  </div>
                  <span className="hidden text-end text-sm tabular text-muted sm:block">{c == null ? '—' : mad(Math.round(c))}</span>
                  <button aria-label={t('Retirer')} onClick={() => setLines(ls => ls!.filter((_, j) => j !== i))} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                </li>
              );
            })}
            {!lines.length && <li className="px-4 py-6 text-center text-sm text-muted">{t('Ajoutez les ingrédients d’une portion.')}</li>}
          </ul>

          <div className="mt-3 flex gap-2">
            <input list="ing-list" className={inputCls} placeholder={t('Ajouter un ingrédient (tapez son nom)')} value={pick}
              onChange={e => onPick(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && pick.trim()) { e.preventDefault(); const g = ings.find(x => x.name.toLowerCase() === pick.trim().toLowerCase()); if (g) add(g); else setCreating(pick.trim()); } }} />
            <datalist id="ing-list">{ings.map(g => <option key={g.id} value={g.name} />)}</datalist>
            <Btn tone="ghost" onClick={() => setCreating(pick.trim())}><Plus className="h-4 w-4" /> {t('Nouveau')}</Btn>
          </div>
          {sizes.length > 1 && <p className="mt-3 text-xs text-muted">{t('Ce plat existe en plusieurs tailles : les lignes « toutes les tailles » comptent pour chacune.')}</p>}
        </div>
      )}
      {creating !== null && <IngredientEditor r={r} ing={null} initialName={creating} onClose={() => setCreating(null)}
        onSaved={g => { setCreating(null); setIngs(xs => [...xs, g].sort((x, y) => x.name.localeCompare(y.name))); add(g); }} />}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// AI: standard recipe cards for every dish without one
// ---------------------------------------------------------------------------
type AiLine = { name: string; name_ar?: string; category?: string; base_unit: BaseUnit; qty: number; purchase_unit: string; purchase_qty: number; price_dh: number };
type AiDish = { key: string; lines: AiLine[]; include: boolean };

function AiFill({ r, dishes, onClose, onSaved }: { r: Restaurant; dishes: ProfitDish[]; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const lang = r.languages[0] ?? 'fr';
  const [step, setStep] = useState<'intro' | 'busy' | 'review' | 'saving'>('intro');
  const [progress, setProgress] = useState(0);
  const [out, setOut] = useState<AiDish[]>([]);
  const [err, setErr] = useState('');
  const [priced, setPriced] = useState<Set<string>>(new Set());
  const byKey = useMemo(() => new Map(dishes.map(d => [key(d), d])), [dishes]);
  const nm = (n: I18n) => tr(n, lang);

  // small batches, three at a time, each with a time limit: a big menu never blocks the screen
  const stopRef = useRef(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const run = async () => {
    setStep('busy'); setErr(''); setProgress(0); setDone(0); setFailed(0); stopRef.current = false;
    try {
      const rows = check(await supabase.from('ingredients').select('name, purchase_price_cents').eq('restaurant_id', r.id)) as { name: string; purchase_price_cents: number | null }[];
      const known = rows.map(x => x.name);
      setPriced(new Set(rows.filter(x => x.purchase_price_cents != null).map(x => x.name.toLowerCase())));
      const all: AiDish[] = [];
      const batches: ProfitDish[][] = [];
      for (let i = 0; i < dishes.length; i += 6) batches.push(dishes.slice(i, i + 6));
      let fatal: Error | null = null;
      let nFailed = 0, next = 0, lastDetail = '';

      const ask = async (batch: ProfitDish[]) => {
        const body = { restaurant_id: r.id, ingredients: known.slice(0, 250), dishes: batch.map(d => ({
          key: key(d), name: nm(d.name), variant: d.variant_name ? nm(d.variant_name) : undefined, category: nm(d.category), price_dh: d.price_cents / 100 })) };
        const timeout = new Promise<never>((_, rej) => window.setTimeout(() => rej(new Error('timeout')), 100000));
        const { data, error } = await Promise.race([supabase.functions.invoke('profit-ai', { body }), timeout]);
        if (error || !data || data.error) {
          const ctx = (error as { context?: Response } | null)?.context;
          const b = data?.error ? data : ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
          const code = b?.error ?? '';
          if (code === 'ai_not_configured' || ctx?.status === 404) throw Object.assign(new Error(t("L'assistant IA n'est pas encore activé.")), { fatal: true });
          if (code === 'not_allowed' || ctx?.status === 401 || ctx?.status === 403) throw Object.assign(new Error(t("L'IA n'a pas pu préparer les fiches. Vérifiez que la fonction profit-ai a « Verify JWT » désactivé.")), { fatal: true });
          throw new Error([code || `http ${ctx?.status ?? '?'}`, b?.detail].filter(Boolean).join(' · ').slice(0, 220));
        }
        return data.dishes as { key: string; lines: AiLine[] }[];
      };
      const worker = async () => {
        while (!fatal && !stopRef.current && next < batches.length) {
          const batch = batches[next++];
          let res: { key: string; lines: AiLine[] }[] | null = null;
          for (let attempt = 0; attempt < 2 && !res && !fatal; attempt++) {
            try { res = await ask(batch); }
            catch (e) { if ((e as { fatal?: boolean }).fatal) fatal = e as Error; else { lastDetail = (e as Error).message; if (attempt === 0) await new Promise(ok => window.setTimeout(ok, 3000)); } }
          }
          if (res) {
            for (const x of res) {
              if (!byKey.has(x.key)) continue;
              const lines = (x.lines ?? []).filter(l => l && l.name && ['g', 'ml', 'pc'].includes(l.base_unit) && l.qty > 0);
              if (lines.length) { all.push({ key: x.key, lines, include: true }); for (const l of lines) if (!known.includes(l.name)) known.push(l.name); }
            }
            setDone(all.length);
          } else if (!fatal) { nFailed += batch.length; setFailed(nFailed); }
          setProgress(p => Math.min(dishes.length, p + batch.length));
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      if (fatal) throw fatal;
      if (!all.length) throw new Error(t("L'IA n'a pas pu préparer les fiches. Réessayez.") + (lastDetail ? ` [${lastDetail}]` : ''));
      // same order as the menu
      const order = new Map(dishes.map((d, k) => [key(d), k]));
      all.sort((x, y) => (order.get(x.key) ?? 0) - (order.get(y.key) ?? 0));
      setOut(all); setStep('review');
    } catch (e) { setErr(errorMessage(e).replace(/^Erreur : /, '')); setStep('intro'); }
  };

  const save = async () => {
    setStep('saving');
    try {
      const items = out.filter(x => x.include && x.lines.length).map(x => {
        const d = byKey.get(x.key)!;
        return { item_id: d.item_id, variant_id: d.variant_id, lines: x.lines.map(l => ({ ...l, price_cents: Math.round((l.price_dh || 0) * 100) || null })) };
      });
      const res = await rpc<{ dishes: number; lines: number; ingredients: number }>('apply_recipe_suggestions', { p_restaurant_id: r.id, p_items: items });
      a.toast(t('{n} fiches créées, {g} nouveaux ingrédients', { n: res.dishes, g: res.ingredients }));
      onSaved();
    } catch (e) { a.fail(e); setStep('review'); }
  };

  const unitPrice = (l: AiLine) => `≈ ${String(l.price_dh).replace('.', ',')} DH / ${l.purchase_unit}`;
  return (
    <Modal wide title={t('Remplir les fiches avec l’IA')} onClose={step === 'busy' || step === 'saving' ? () => {} : onClose}
      footer={step === 'review' ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="me-auto text-sm text-muted">{t('{n} fiches sélectionnées', { n: out.filter(x => x.include).length })}</p>
          <Btn tone="ghost" onClick={onClose}>{t('Annuler')}</Btn>
          <Btn tone="brand" onClick={save} disabled={!out.some(x => x.include)}><Check className="h-4 w-4" /> {t('Enregistrer les fiches')}</Btn>
        </div>) : undefined}>
      {err && <p role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{err}</p>}
      {step === 'intro' && (
        <div className="space-y-4">
          <p>{t('L’IA propose pour chacun de vos {n} plats sans fiche une recette standard d’une portion, avec les quantités habituelles au Maroc et un prix d’achat estimé par ingrédient.', { n: dishes.length })}</p>
          <ul className="space-y-2 text-sm text-muted">
            <li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-ok" />{t('Vous vérifiez tout avant d’enregistrer.')}</li>
            <li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-ok" />{t('Les prix restent marqués « estimé » jusqu’à ce que vous mettiez vos vrais prix.')}</li>
            <li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-ok" />{t('Les fiches que vous avez déjà faites ne sont jamais modifiées.')}</li>
          </ul>
          <Btn tone="brand" className="h-12 w-full" onClick={run}><Sparkles className="h-4 w-4" /> {t('Lancer l’IA')}</Btn>
        </div>
      )}
      {step === 'busy' && (
        <div className="grid place-items-center gap-4 py-14 text-center">
          <span className="relative grid h-16 w-16 place-items-center rounded-full gold-fill text-brand-ink"><Sparkles className="h-7 w-7" /><Loader2 className="absolute -inset-2 h-20 w-20 animate-spin text-brand/40" /></span>
          <p className="font-display text-xl font-semibold">{t('L’IA prépare vos fiches…')}</p>
          <div className="h-2 w-64 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.round(progress * 100 / Math.max(1, dishes.length))}%` }} /></div>
          <p className="text-sm text-muted tabular">{t('{n} plats traités sur {t}', { n: progress, t: dishes.length })} · {t('{n} fiches prêtes', { n: done })}</p>
          <p className="max-w-sm text-xs text-muted">{t('Environ 1 minute pour 20 plats. Vous pouvez vous arrêter et vérifier ce qui est prêt : les autres plats pourront être traités ensuite.')}</p>
          {done > 0 && <Btn tone="ghost" onClick={() => { stopRef.current = true; }}>{t('Arrêter et vérifier')}</Btn>}
        </div>
      )}
      {(step === 'review' || step === 'saving') && (
        <div className="space-y-3">
          {out.map((x, i) => {
            const d = byKey.get(x.key)!;
            return (
              <section key={x.key} className={`rounded-2xl border border-line/[0.08] ${x.include ? '' : 'opacity-50'}`}>
                <label className="flex items-center gap-3 bg-surface-2 px-3 py-2">
                  <input type="checkbox" checked={x.include} onChange={e => setOut(o => o.map((y, j) => (j === i ? { ...y, include: e.target.checked } : y)))} />
                  <span className="flex-1 font-semibold"><bdi>{nm(d.name)}{d.variant_name ? ` · ${nm(d.variant_name)}` : ''}</bdi></span>
                  <span className="text-xs text-muted tabular">{mad(d.price_cents)}</span>
                </label>
                <ul className="divide-y divide-line/10 text-sm">
                  {x.lines.map((l, k) => (
                    <li key={k} className="flex items-center gap-3 px-3 py-1.5">
                      <span className="flex-1">{l.name}{l.name_ar && <span className="ms-2 text-xs text-muted"><bdi dir="rtl">{l.name_ar}</bdi></span>}</span>
                      <span className="tabular">{fmtQty(l.qty, l.base_unit)}</span>
                      <span className="hidden w-36 text-end text-xs text-muted tabular sm:block">{priced.has(l.name.toLowerCase()) ? t('prix connu') : unitPrice(l)}</span>
                      <button aria-label={t('Retirer')} onClick={() => setOut(o => o.map((y, j) => (j === i ? { ...y, lines: y.lines.filter((_, m) => m !== k) } : y)))} className="text-muted hover:text-danger"><X className="h-4 w-4" /></button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <p className="text-xs text-muted">{t('Les quantités se corrigent ensuite plat par plat, et les prix dans « Ingrédients ».')}</p>
          {out.length < dishes.length && <p className="rounded-xl bg-warn/10 px-3 py-2 text-xs font-semibold text-warn">{t('{n} plats sans proposition cette fois{f}. Relancez l’IA après avoir enregistré : elle ne traitera que les plats restants.', { n: dishes.length - out.length, f: failed ? ` (${t('délai dépassé')})` : '' })}</p>}
        </div>
      )}
    </Modal>
  );
}

