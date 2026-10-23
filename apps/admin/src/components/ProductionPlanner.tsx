// The production planning of a day. In the evening: what has to be made tomorrow, in order (the
// preparations of that weekday are proposed with the quantity the sales suggest). Nothing leaves the
// stock when it is saved. On the day: a checklist. "Fait" with what was really made takes the ingredients
// out at that moment; "Pas fait" keeps the reason; undo gives the stock back.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Ban, CalendarDays, Check, ClipboardList, MessageCircle, Plus, RotateCcw, Undo2, X } from 'lucide-react';
import { check, rpc } from '../lib/api';
import { supabase } from '../lib/supabase';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { BaseUnit, Restaurant } from '../lib/types';
import { RECIPE_UNITS, fmtQty } from '../lib/profit';
import { waLink } from '../lib/whatsapp';
import { Btn, Card, inputCls } from './ui';
import { Smooth } from './Smooth';

export const num = (s: string) => Number(s.replace(',', '.')) || 0;
export const show = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');
// the quantity is typed in the unit of the batch: pieces, or kg / litres when a batch is 1 kg or more
export const unitOf = (i: { base_unit: BaseUnit; batch_qty: number }) => (i.base_unit === 'pc' ? RECIPE_UNITS.pc[0] : Number(i.batch_qty) >= 1000 ? RECIPE_UNITS[i.base_unit][RECIPE_UNITS[i.base_unit].length - 1] : RECIPE_UNITS[i.base_unit][0]);

interface Proposal { ingredient_id: string; name: string; base_unit: BaseUnit; batch_qty: number; suggested: number; make_days: number[] | null; on_day: boolean }
interface Line {
  id: string; ingredient_id: string; name: string; base_unit: BaseUnit; batch_qty: number; planned_qty: number; note: string | null;
  status: 'pending' | 'done' | 'skipped'; done_qty: number | null; skip_reason: string | null; done_at: string | null;
}
interface Need { ingredient_id: string; name: string; base_unit: BaseUnit; need: number; stock_qty: number | null; short: number | null; is_preparation: boolean; supplier: string | null; supplier_phone: string | null; supplier_id: string | null; purchase_qty: number; purchase_unit: string }
interface Day {
  date: string; today: string; dow: number; proposals: Proposal[]; needs: Need[];
  plan: { id: string; note: string | null; lines: Line[] } | null;
  previous: { date: string; lines: { ingredient_id: string; planned_qty: number; note: string | null }[] } | null;
}
interface Draft { ingredient_id: string; qty: string; note: string | null; locked?: Line['status'] }

const dayName = (d: number, style: 'short' | 'long') => new Date(Date.UTC(2024, 0, d)).toLocaleDateString(dateLocale(), { weekday: style, timeZone: 'UTC' });   // 1 Jan 2024 is a Monday
const nice = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const reasons = () => [t('Pas eu le temps'), t('Ingrédients manquants'), t('Pas nécessaire')];

export function ProductionPlanner({ r, date, refresh, onChanged }: { r: Restaurant; date: string; refresh: number; onChanged: () => Promise<void> | void }) {
  const a = useAdminCtx();
  const [day, setDay] = useState<Day | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'check' | 'edit' | 'none'>('none');
  const [draft, setDraft] = useState<Draft[]>([]);
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [others, setOthers] = useState(false);
  const [daysOpen, setDaysOpen] = useState(false);
  const [doneQty, setDoneQty] = useState<Record<string, string>>({});
  const [skipFor, setSkipFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const dirtyRef = useRef(false);
  // purchase orders made from this plan (once per plan date, so a second tap does not double them)
  const [ordered, setOrdered] = useState<string | null>(null);
  dirtyRef.current = dirty;

  const fromPlan = (d: Day): Draft[] => {
    if (d.plan) return d.plan.lines.map(l => ({ ingredient_id: l.ingredient_id, qty: show(Number(l.planned_qty) / unitOf(l).f), note: l.note, locked: l.status === 'pending' ? undefined : l.status }));
    // nothing saved yet: what is made on that weekday and what the sales say is needed
    return d.proposals.filter(p => p.on_day && Number(p.suggested) > 0).map(p => {
      const s = p.base_unit === 'pc' ? Math.ceil(Number(p.suggested)) : Number(p.suggested);
      return { ingredient_id: p.ingredient_id, qty: show(s / unitOf(p).f), note: null };
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await rpc<Day>('production_day', { p_restaurant_id: r.id, p_date: date });
      setDay(d);
      // what the person is typing stays; otherwise the list follows what is saved
      if (!dirtyRef.current) { setDraft(fromPlan(d)); setNote(d.plan?.note ?? ''); }
      setMode(m => d.date === d.today ? (m === 'edit' && dirtyRef.current ? 'edit' : d.plan ? 'check' : m === 'edit' ? 'edit' : 'none') : 'edit');
    } catch (e) { a.fail(e); }
    setLoading(false);
  }, [r.id, date, a]);
  useEffect(() => { setDirty(false); dirtyRef.current = false; setOthers(false); setSkipFor(null); setMode('none'); }, [date]);
  useEffect(() => { load(); }, [load, refresh]);

  if (!day) return <Card><p className="text-muted">{t('Chargement…')}</p></Card>;
  if (!day.proposals.length) return null;

  const isToday = day.date === day.today;
  const props = new Map(day.proposals.map(p => [p.ingredient_id, p]));
  const change = (f: (d: Draft[]) => Draft[]) => { setDraft(f); setDirty(true); };
  const move = (i: number, by: number) => change(d => { const n = [...d]; const j = i + by; if (j < 0 || j >= n.length) return d; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const add = (p: Proposal) => {
    const s = Number(p.suggested) > 0 ? (p.base_unit === 'pc' ? Math.ceil(Number(p.suggested)) : Number(p.suggested)) : Number(p.batch_qty);
    change(d => [...d, { ingredient_id: p.ingredient_id, qty: show(s / unitOf(p).f), note: null }]);
  };
  const copyPrevious = () => {
    if (!day.previous) return;
    change(() => day.previous!.lines.filter(l => props.has(l.ingredient_id)).map(l => ({ ingredient_id: l.ingredient_id, qty: show(Number(l.planned_qty) / unitOf(props.get(l.ingredient_id)!).f), note: l.note })));
  };

  const save = async () => {
    const lines = draft.map(d => { const p = props.get(d.ingredient_id); return { ingredient_id: d.ingredient_id, qty: num(d.qty) * (p ? unitOf(p).f : 1), note: d.note }; });
    if (lines.some(l => !(l.qty > 0))) { a.toast(t('Indiquez une quantité pour chaque ligne.'), 'error'); return; }
    setBusy('save');
    try {
      const d = await rpc<Day>('production_plan_save', { p_restaurant_id: r.id, p_date: day.date, p_lines: lines, p_note: note || null });
      setDirty(false); dirtyRef.current = false;
      setDay(d); setDraft(fromPlan(d));
      a.toast(t('Planning enregistré. Rien n’est sorti du stock : chaque ligne sort quand elle est confirmée « Fait ».'));
      if (isToday && d.plan) setMode('check');
    } catch (e) { a.fail(e); }
    setBusy(null);
  };
  const act = async (id: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(id);
    try { await fn(); if (done) a.toast(done); setSkipFor(null); setReason(''); await onChanged(); } catch (e) {
      const m = String((e as Error)?.message ?? e);
      a.toast(m.includes('no_recipe') ? t('Cette préparation n’a pas encore de recette : ajoutez ses ingrédients sur la page Ingrédients.') : m.includes('not_today') ? t('Ce planning n’est pas celui d’aujourd’hui.') : m, 'error');
    }
    setBusy(null);
  };
  // what is short becomes draft purchase orders, one per supplier, in whole purchase units at the last price
  const makeOrders = async () => {
    const short = day.needs.filter(n => Number(n.short) > 0 && !n.is_preparation);
    if (!short.length) return;
    setBusy('po');
    try {
      const ings = check(await supabase.from('ingredients').select('id, purchase_price_cents').in('id', short.map(n => n.ingredient_id))) as { id: string; purchase_price_cents: number | null }[];
      const price = new Map(ings.map(g => [g.id, g.purchase_price_cents]));
      const groups = new Map<string, Need[]>();
      for (const n of short) { const k = n.supplier_id ?? ''; groups.set(k, [...(groups.get(k) ?? []), n]); }
      for (const [sid, ns] of groups) {
        const [po] = check(await supabase.from('purchase_orders').insert({ restaurant_id: r.id, supplier_id: sid || null, expected_on: day.date,
          note: t('Pour le planning du {d}', { d: nice(day.date) }).slice(0, 200) }).select('id')) as { id: string }[];
        check(await supabase.from('purchase_order_lines').insert(ns.map((n, i) => ({ restaurant_id: r.id, order_id: po.id, ingredient_id: n.ingredient_id,
          units: Math.max(1, Math.ceil(Number(n.short) / Math.max(1, Number(n.purchase_qty)))), unit_price_cents: price.get(n.ingredient_id) ?? null, sort_order: (i + 1) * 10 }))).select('id'));
      }
      setOrdered(day.date);
      a.toast(t('{n} bon(s) de commande créé(s) : Inventaire > Commandes fournisseurs', { n: groups.size }));
    } catch (e) { a.fail(e); }
    setBusy(null);
  };
  const markDone = (l: Line) => {
    const q = (doneQty[l.id] ? num(doneQty[l.id]) * unitOf(l).f : Number(l.planned_qty));
    if (!(q > 0)) { a.toast(t('Indiquez la quantité produite.'), 'error'); return; }
    act(l.id, async () => { await rpc('production_plan_done', { p_line_id: l.id, p_qty: q }); setDoneQty(x => { const n = { ...x }; delete n[l.id]; return n; }); },
      t('{q} de {n} fait : les ingrédients sont sortis du stock', { q: fmtQty(q, l.base_unit), n: l.name }));
  };
  const setDays = async (p: Proposal, d: number) => {
    const cur = p.make_days?.length ? p.make_days : [1, 2, 3, 4, 5, 6, 7];
    const next = cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d];
    if (!next.length) { a.toast(t('Au moins un jour.'), 'error'); return; }
    try {
      const res = await rpc<{ make_days: number[] | null }>('production_make_days', { p_ingredient_id: p.ingredient_id, p_days: next });
      setDay(x => x && { ...x, proposals: x.proposals.map(y => y.ingredient_id === p.ingredient_id ? { ...y, make_days: res.make_days, on_day: !res.make_days || res.make_days.includes(x.dow) } : y) });
    } catch (e) { a.fail(e); }
  };

  const lines = day.plan?.lines ?? [];
  const nDone = lines.filter(l => l.status === 'done').length;
  const nSkip = lines.filter(l => l.status === 'skipped').length;
  const allHandled = lines.length > 0 && nDone + nSkip === lines.length;
  const inDraft = new Set(draft.map(d => d.ingredient_id));
  const free = day.proposals.filter(p => !inDraft.has(p.ingredient_id));
  const shortGroups = groupShort(day.needs);

  const needsCard = day.plan && day.needs.length > 0 && (
    <Card className={`transition-opacity duration-200 ${loading ? 'opacity-60' : ''}`}>
      <h3 className="font-display text-lg font-semibold">{t('Ingrédients nécessaires')}</h3>
      <p className="mb-3 text-sm text-muted">{isToday ? t('Pour ce qui reste à faire, comparé au stock de maintenant.') : t('Pour tout le planning, comparé au stock de maintenant. Ce qui sera encore utilisé aujourd’hui n’est pas compté.')}{dirty ? ` ${t('D’après le planning enregistré.')}` : ''}</p>
      <div className="divide-y divide-line/10">
        {day.needs.map(n => (
          <div key={n.ingredient_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
            <span className="min-w-[10rem] flex-1 font-semibold">{n.name}{n.supplier && <span className="ms-2 text-xs font-normal text-muted">{n.supplier}</span>}</span>
            <span className="tabular text-muted">{t('Besoin')}: <b className="text-ink">{fmtQty(Number(n.need), n.base_unit)}</b></span>
            <span className="tabular text-muted">{t('En stock')}: <b className="text-ink">{n.stock_qty == null ? t('pas encore compté') : fmtQty(Math.max(0, Number(n.stock_qty)), n.base_unit)}</b></span>
            <span className={`w-28 text-end tabular font-semibold ${Number(n.short) > 0 ? 'text-danger' : 'text-ok'}`}>{n.short == null ? '' : Number(n.short) > 0 ? `${t('Manque')} ${fmtQty(Number(n.short), n.base_unit)}` : t('OK')}</span>
          </div>
        ))}
      </div>
      {day.needs.some(n => Number(n.short) > 0 && !n.is_preparation) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Btn tone="brand" className="text-sm" disabled={busy === 'po' || ordered === day.date} onClick={makeOrders}><ClipboardList className="h-4 w-4" /> {ordered === day.date ? t('Bons de commande créés') : t('Créer les bons de commande')}</Btn>
          <span className="text-xs text-muted">{t('Un brouillon par fournisseur, à vérifier et envoyer dans Inventaire.')}</span>
        </div>
      )}
      {shortGroups.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {shortGroups.map(g => g.phone ? (
            <a key={g.name} href={waLink(g.phone, orderText(g, r.name, day.date))} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-xl bg-surface-2 px-3.5 py-2 text-sm font-semibold hover:bg-line/10">
              <MessageCircle className="h-4 w-4 text-ok" /> {t('Commander chez {s}', { s: g.name })}</a>
          ) : null)}
        </div>
      )}
    </Card>
  );

  // ---------------------------------------------------------------- today, no plan: a short invitation
  if (mode === 'none') return (
    <Card className="flex flex-wrap items-center gap-4">
      <ClipboardList className="h-7 w-7 shrink-0 text-brand" />
      <div className="min-w-[14rem] flex-1">
        <p className="font-semibold">{t('Pas de planning pour aujourd’hui')}</p>
        <p className="text-sm text-muted">{t('Faites-le le soir dans « Demain » : le matin, l’équipe coche ce qui est fait.')}</p>
      </div>
      <Btn tone="ghost" onClick={() => setMode('edit')}><Plus className="h-4 w-4" /> {t('Faire le planning')}</Btn>
    </Card>
  );

  // ---------------------------------------------------------------- the day: the checklist
  if (mode === 'check' && day.plan) return (
    <div className="space-y-5">
      <Card className={`transition-opacity duration-200 ${loading ? 'opacity-60' : ''}`}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="me-auto">
            <h2 className="font-display text-xl font-semibold">{t('Planning du jour')}</h2>
            <p className="text-sm text-muted">{t('Confirmez « Fait » avec la quantité réellement faite : les ingrédients sortent du stock à ce moment.')}</p>
          </div>
          <p className="tabular text-sm font-semibold">{t('{d} / {n} faits', { d: nDone, n: lines.length })}</p>
        </div>
        <span className="mt-3 block h-2 overflow-hidden rounded-full bg-surface-2">
          <i className="block h-full origin-left rounded-full bg-ok transition-transform duration-500 motion-reduce:transition-none rtl:origin-right" style={{ transform: `scaleX(${lines.length ? (nDone + nSkip) / lines.length : 0})` }} />
        </span>
        {day.plan.note && <p className="mt-3 rounded-xl bg-brand/10 px-3 py-2 text-sm font-semibold">{day.plan.note}</p>}
        <ul className="mt-4 space-y-2">
          {lines.map(l => {
            const u = unitOf(l);
            return (
              <li key={l.id} className={`rounded-2xl px-3 py-2.5 transition-colors duration-300 ${l.status === 'done' ? 'bg-ok/10' : l.status === 'skipped' ? 'bg-surface-2 opacity-70' : 'bg-surface-2'}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${l.status === 'done' ? 'bg-ok text-white' : l.status === 'skipped' ? 'bg-line/15 text-muted' : 'border-2 border-line/20'}`}>
                    {l.status === 'done' ? <Check className="h-4 w-4" /> : l.status === 'skipped' ? <X className="h-4 w-4" /> : null}
                  </span>
                  <span className="min-w-[9rem] flex-1">
                    <span className={`block font-semibold ${l.status === 'skipped' ? 'line-through' : ''}`}>{l.name}</span>
                    <span className="block text-xs text-muted">
                      {l.status === 'done' ? t('{q} fait à {h}', { q: fmtQty(Number(l.done_qty), l.base_unit), h: new Date(l.done_at!).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', timeZone: r.timezone }) })
                        : l.status === 'skipped' ? `${t('Pas fait')}${l.skip_reason ? ` : ${l.skip_reason}` : ''}`
                        : `${t('prévu')} ${fmtQty(Number(l.planned_qty), l.base_unit)}`}
                      {l.note && <> · {l.note}</>}
                    </span>
                  </span>
                  {l.status === 'pending' ? <>
                    <input className={`${inputCls} !w-24 text-end`} inputMode="decimal" aria-label={t('Quantité réellement faite')} placeholder={show(Number(l.planned_qty) / u.f)}
                      value={doneQty[l.id] ?? ''} onChange={e => setDoneQty(x => ({ ...x, [l.id]: e.target.value }))} />
                    <span className="w-6 text-sm text-muted">{u.u}</span>
                    <Btn tone="brand" className="px-3 py-2 text-sm" disabled={busy === l.id} onClick={() => markDone(l)}><Check className="h-4 w-4" /> {t('Fait')}</Btn>
                    <Btn tone="ghost" className="px-2.5 py-2 text-sm" onClick={() => { setSkipFor(skipFor === l.id ? null : l.id); setReason(''); }}><Ban className="h-4 w-4" /> {t('Pas fait')}</Btn>
                  </> : (
                    <Btn tone="ghost" className="px-2.5 py-1.5 text-sm" disabled={busy === l.id}
                      onClick={() => {
                        if (l.status === 'done' && !window.confirm(t('Annuler « Fait » pour {n} ? Les ingrédients reviennent en stock.', { n: l.name }))) return;
                        act(l.id, () => rpc('production_plan_undo', { p_line_id: l.id }), l.status === 'done' ? t('Annulé : les ingrédients sont revenus en stock') : undefined);
                      }}>
                      {l.status === 'done' ? <><Undo2 className="h-4 w-4" /> {t('Annuler')}</> : <><RotateCcw className="h-4 w-4" /> {t('Remettre')}</>}
                    </Btn>
                  )}
                </div>
                <Smooth open={skipFor === l.id && l.status === 'pending'}>
                  <div className="flex flex-wrap items-center gap-2 pt-3">
                    {reasons().map(x => (
                      <button key={x} type="button" disabled={busy === l.id} onClick={() => act(l.id, () => rpc('production_plan_skip', { p_line_id: l.id, p_reason: x }))}
                        className="rounded-full bg-surface px-3 py-1.5 text-sm font-semibold ring-1 ring-line/15 hover:bg-line/10">{x}</button>
                    ))}
                    <input className={`${inputCls} !w-auto min-w-[10rem] flex-1 !py-1.5 text-sm`} placeholder={t('Autre raison')} value={reason} maxLength={200} onChange={e => setReason(e.target.value)} />
                    <Btn tone="plain" className="px-3 py-1.5 text-sm" disabled={busy === l.id} onClick={() => act(l.id, () => rpc('production_plan_skip', { p_line_id: l.id, p_reason: reason.trim() || null }))}>{t('Confirmer')}</Btn>
                  </div>
                </Smooth>
              </li>
            );
          })}
        </ul>
        <Smooth open={allHandled}>
          <p className="mt-4 rounded-xl bg-ok/10 px-3 py-2.5 text-sm font-semibold text-ok">
            {t('Planning terminé : {d} faits, {s} pas faits.', { d: nDone, s: nSkip })}
          </p>
        </Smooth>
        <div className="mt-4 flex justify-end">
          <Btn tone="ghost" className="text-sm" onClick={() => setMode('edit')}>{t('Modifier le planning')}</Btn>
        </div>
      </Card>
      {needsCard}
    </div>
  );

  // ---------------------------------------------------------------- the evening: write the plan
  return (
    <div className="space-y-5">
      <Card className={`transition-opacity duration-200 ${loading ? 'opacity-60' : ''}`}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="me-auto">
            <h2 className="font-display text-xl font-semibold first-letter:uppercase">{t('Planning du {d}', { d: nice(day.date) })}</h2>
            <p className="text-sm text-muted">{t('Ce qui doit être fait, dans l’ordre. Rien ne sort du stock maintenant : seulement quand l’équipe confirme « Fait » le jour même.')}</p>
          </div>
          <Btn tone="ghost" className="text-sm" onClick={() => setDaysOpen(o => !o)}><CalendarDays className="h-4 w-4" /> {t('Jours de production')}</Btn>
        </div>

        <Smooth open={daysOpen}>
          <div className="mt-4 rounded-2xl bg-surface-2 p-3">
            <p className="mb-2 text-sm text-muted">{t('Les jours où chaque préparation est faite. Le planning ne propose que celles du jour.')}</p>
            <div className="space-y-1.5">
              {day.proposals.map(p => (
                <div key={p.ingredient_id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-[9rem] flex-1 text-sm font-semibold">{p.name}</span>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5, 6, 7].map(d => {
                      const on = !p.make_days?.length || p.make_days.includes(d);
                      return <button key={d} type="button" aria-pressed={on} aria-label={dayName(d, 'long')} onClick={() => setDays(p, d)}
                        className={`h-8 w-10 rounded-lg text-xs font-semibold transition ${on ? 'bg-brand text-brand-ink' : 'bg-surface text-muted ring-1 ring-line/15'}`}>{dayName(d, 'short')}</button>;
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Smooth>

        {day.previous && !day.plan && (
          <button type="button" onClick={copyPrevious} className="mt-4 flex w-full items-center gap-2 rounded-xl bg-brand/10 px-3 py-2.5 text-start text-sm font-semibold hover:bg-brand/15">
            <RotateCcw className="h-4 w-4 shrink-0" /> <span className="first-letter:uppercase">{t('Reprendre le planning du {d}', { d: nice(day.previous.date) })}</span>
          </button>
        )}

        <ul className="mt-4 space-y-2">
          {draft.map((d, i) => {
            const p = props.get(d.ingredient_id);
            if (!p) return null;
            const u = unitOf(p);
            return (
              <li key={d.ingredient_id} className="flex animate-[rise_.3s_ease-out] flex-wrap items-center gap-2 rounded-2xl bg-surface-2 px-2 py-2 motion-reduce:animate-none">
                <span className="w-6 text-center tabular text-sm text-muted">{i + 1}</span>
                <div className="flex flex-col">
                  <button type="button" aria-label={t('Monter')} disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-0.5 text-muted hover:text-ink disabled:opacity-20"><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" aria-label={t('Descendre')} disabled={i === draft.length - 1} onClick={() => move(i, 1)} className="rounded p-0.5 text-muted hover:text-ink disabled:opacity-20"><ArrowDown className="h-4 w-4" /></button>
                </div>
                <span className="min-w-[9rem] flex-1">
                  <span className="block font-semibold">{p.name}</span>
                  <span className="block text-xs text-muted">
                    {d.locked === 'done' ? t('Déjà fait') : d.locked === 'skipped' ? t('Pas fait') : Number(p.suggested) > 0 ? t('proposé {q}', { q: fmtQty(Number(p.suggested), p.base_unit) }) : t('rien de proposé d’après les ventes')}
                    {!p.on_day && <> · {t('pas un jour habituel')}</>}
                  </span>
                </span>
                <input className={`${inputCls} !w-24 text-end`} inputMode="decimal" aria-label={t('Quantité à produire')} disabled={!!d.locked} value={d.qty} placeholder="0"
                  onChange={e => change(x => x.map(y => y.ingredient_id === d.ingredient_id ? { ...y, qty: e.target.value } : y))} />
                <span className="w-6 text-sm text-muted">{u.u}</span>
                <button type="button" aria-label={t('Retirer')} disabled={!!d.locked} onClick={() => change(x => x.filter(y => y.ingredient_id !== d.ingredient_id))}
                  className="rounded-lg p-2 text-muted hover:bg-line/10 hover:text-danger disabled:opacity-20"><X className="h-4 w-4" /></button>
              </li>
            );
          })}
        </ul>
        {!draft.length && <p className="mt-4 rounded-2xl border-2 border-dashed border-line/15 px-4 py-6 text-center text-sm text-muted">{t('Rien au planning. Ajoutez ci-dessous ce qu’il faut faire.')}</p>}

        {free.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-sm font-semibold">{t('Ajouter')}</p>
            <div className="flex flex-wrap gap-2">
              {free.filter(p => p.on_day).map(p => <AddChip key={p.ingredient_id} p={p} onAdd={add} />)}
              {free.some(p => !p.on_day) && (
                <button type="button" onClick={() => setOthers(o => !o)} className="rounded-full px-3 py-1.5 text-sm font-semibold text-muted hover:text-ink">
                  {others ? t('Masquer les autres jours') : t('Autres préparations ({n})', { n: free.filter(p => !p.on_day).length })}
                </button>
              )}
            </div>
            <Smooth open={others}>
              <div className="flex flex-wrap gap-2 pt-2">{free.filter(p => !p.on_day).map(p => <AddChip key={p.ingredient_id} p={p} onAdd={add} muted />)}</div>
            </Smooth>
          </div>
        )}

        <input className={`${inputCls} mt-5`} placeholder={t('Note pour l’équipe (facultatif)')} value={note} maxLength={500} onChange={e => { setNote(e.target.value); setDirty(true); }} />

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {isToday && day.plan && <Btn tone="ghost" onClick={() => { setDirty(false); dirtyRef.current = false; setDraft(fromPlan(day)); setNote(day.plan?.note ?? ''); setMode('check'); }}>{t('Retour à la liste')}</Btn>}
          {isToday && !day.plan && <Btn tone="ghost" onClick={() => setMode('none')}>{t('Fermer')}</Btn>}
          <Btn tone="brand" disabled={busy === 'save' || (!dirty && !!day.plan)} onClick={save}><ClipboardList className="h-4 w-4" /> {day.plan && !dirty ? t('Planning enregistré') : t('Enregistrer le planning')}</Btn>
        </div>
      </Card>
      {needsCard}
    </div>
  );
}

function AddChip({ p, onAdd, muted }: { p: Proposal; onAdd: (p: Proposal) => void; muted?: boolean }) {
  return (
    <button type="button" onClick={() => onAdd(p)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ring-1 transition hover:bg-brand/10 ${muted ? 'text-muted ring-line/15' : 'ring-brand/30'}`}>
      <Plus className="h-3.5 w-3.5" /> {p.name}
      {Number(p.suggested) > 0 && <span className="text-xs font-normal text-muted">{fmtQty(Number(p.suggested), p.base_unit)}</span>}
    </button>
  );
}

type Group = { name: string; phone: string | null; items: Need[] };
function groupShort(needs: Need[]): Group[] {
  const m = new Map<string, Group>();
  for (const n of needs) {
    if (!(Number(n.short) > 0) || n.is_preparation || !n.supplier) continue;
    const g = m.get(n.supplier) ?? { name: n.supplier, phone: n.supplier_phone, items: [] };
    g.items.push(n); m.set(n.supplier, g);
  }
  return [...m.values()];
}
const orderText = (g: Group, shop: string, date: string) =>
  `${t('Bonjour, commande de {s} pour le {d} :', { s: shop, d: nice(date) })}\n${g.items.map(n => `- ${n.name} : ${fmtQty(Number(n.short), n.base_unit)}`).join('\n')}\n${t('Merci')}`;
