// A house-made preparation (pâte feuilletée, crème pâtissière, a croissant made ahead): what one batch
// needs and what it gives. The cost is calculated from the ingredients and follows their prices.
// Made ahead = it has its own stock and is produced on the Production page; made on the spot = selling
// a dish that uses it takes its ingredients straight away.
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, mad } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { BaseUnit, Ingredient, Restaurant } from '../lib/types';
import { BASE_LABEL, RECIPE_UNITS, fmtQty, unitCost } from '../lib/profit';
import { Btn, Field, Modal, Toggle, inputCls } from './ui';

interface Row { key: string; ingredient_id: string; qty: string; unit: string }
const num = (s: string) => Number(s.replace(',', '.')) || 0;
const show = (x: number) => String(Math.round(x * 1000) / 1000).replace('.', ',');
let seq = 0;

export function PreparationEditor({ r, prep, all, used = 0, role0 = null, onClose, onSaved }: {
  r: Restaurant; prep: Ingredient | null; all: Ingredient[]; used?: number;
  /** a new one created from the list of finished products starts as one */
  role0?: 'intermediate' | 'final' | null;
  onClose: () => void; onSaved: () => void;
}) {
  const a = useAdminCtx();
  const [name, setName] = useState(prep?.name ?? '');
  const [nameAr, setNameAr] = useState(prep?.name_ar ?? '');
  const [base, setBase] = useState<BaseUnit>(prep?.base_unit ?? 'pc');
  const bestUnit = (b: BaseUnit, q: number) => [...RECIPE_UNITS[b]].reverse().find(u => q >= u.f && (q / u.f) % 1 === 0) ?? RECIPE_UNITS[b][0];
  const [yUnit, setYUnit] = useState(() => (prep ? bestUnit(prep.base_unit, Number(prep.purchase_qty)).u : 'pc'));
  const [yQty, setYQty] = useState(() => (prep ? show(Number(prep.purchase_qty) / bestUnit(prep.base_unit, Number(prep.purchase_qty)).f) : ''));
  const [ahead, setAhead] = useState(prep?.made_ahead ?? true);
  const [role, setRole] = useState<'intermediate' | 'final' | null>(prep ? prep.prep_role ?? null : role0);
  const [track, setTrack] = useState(prep?.track_expiry ?? false);
  const [shelf, setShelf] = useState(prep?.shelf_life_days != null ? String(prep.shelf_life_days) : '');
  const [warnDays, setWarnDays] = useState(String(prep?.expiry_warn_days ?? 1));
  const [rows, setRows] = useState<Row[] | null>(prep ? null : [{ key: String(++seq), ingredient_id: '', qty: '', unit: '' }]);
  const [busy, setBusy] = useState(false);

  // the lines of an existing preparation
  useEffect(() => {
    if (!prep) return;
    (async () => {
      try {
        const ls = check(await supabase.from('preparation_lines').select('ingredient_id, qty').eq('preparation_id', prep.id).order('sort_order')) as { ingredient_id: string; qty: number }[];
        setRows(ls.map(l => {
          const g = all.find(x => x.id === l.ingredient_id);
          const u = g ? bestUnit(g.base_unit, Number(l.qty)) : { u: '', f: 1 };
          return { key: String(++seq), ingredient_id: l.ingredient_id, qty: show(Number(l.qty) / u.f), unit: u.u };
        }));
      } catch (e) { a.fail(e); setRows([]); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prep?.id]);

  const byId = useMemo(() => new Map(all.map(g => [g.id, g])), [all]);
  const choices = useMemo(() => all.filter(g => g.id !== prep?.id && g.active !== false), [all, prep?.id]);
  const factor = (row: Row) => { const g = byId.get(row.ingredient_id); return g ? RECIPE_UNITS[g.base_unit].find(u => u.u === row.unit)?.f ?? 1 : 1; };
  const yieldQty = num(yQty) * (RECIPE_UNITS[base].find(u => u.u === yUnit)?.f ?? 1);

  // the cost of one batch, live; missing prices are named
  const lines = (rows ?? []).filter(x => x.ingredient_id && num(x.qty) > 0);
  let batch = 0; const missing: string[] = [];
  for (const x of lines) {
    const g = byId.get(x.ingredient_id)!;
    const c = unitCost(g);
    if (c == null) missing.push(g.name); else batch += c * num(x.qty) * factor(x);
  }
  const per = yieldQty > 0 ? batch / yieldQty : null;
  const perLabel = base === 'pc' ? t('par pièce') : base === 'g' ? t('par kg') : t('par litre');
  const perF = base === 'pc' ? 1 : 1000;

  const setRow = (key: string, p: Partial<Row>) => setRows(rs => (rs ?? []).map(x => (x.key === key ? { ...x, ...p } : x)));
  const pick = (key: string, id: string) => { const g = byId.get(id); setRow(key, { ingredient_id: id, unit: g ? RECIPE_UNITS[g.base_unit][0].u : '' }); };
  const changeBase = (b: BaseUnit) => { setBase(b); setYUnit(RECIPE_UNITS[b][RECIPE_UNITS[b].length - 1].u); };

  const save = async () => {
    if (!name.trim()) { a.toast(t('Indiquez le nom.'), 'error'); return; }
    if (!(yieldQty > 0)) { a.toast(t('Indiquez ce que donne une fournée.'), 'error'); return; }
    if (!lines.length) { a.toast(t('Ajoutez au moins un ingrédient.'), 'error'); return; }
    const ids = lines.map(x => x.ingredient_id);
    if (new Set(ids).size !== ids.length) { a.toast(t('Un ingrédient apparaît deux fois : additionnez les quantités sur une seule ligne.'), 'error'); return; }
    const useExpiry = track && ahead;
    const shelfN = Math.round(Number(shelf.replace(',', '.')));
    const warnN = Math.round(Number(warnDays.replace(',', '.')));
    if (useExpiry && !(shelfN >= 1 && shelfN <= 3650)) { a.toast(t('La durée doit être entre 1 et 3650 jours.'), 'error'); return; }
    if (useExpiry && !(warnN >= 0 && warnN <= 60)) { a.toast(t('Le délai d’alerte doit être entre 0 et 60 jours.'), 'error'); return; }
    setBusy(true);
    const row = { name: name.trim(), name_ar: nameAr.trim() || null, base_unit: base, purchase_unit: 'fournée', purchase_qty: yieldQty,
      waste_bp: 0, is_preparation: true, made_ahead: ahead, prep_role: role, category: 'preparation',
      track_expiry: useExpiry, expiry_type: 'dlc' as const, shelf_life_days: useExpiry ? shelfN : null, expiry_warn_days: useExpiry ? warnN : 2 };
    try {
      const saved = (prep
        ? check(await supabase.from('ingredients').update(row).eq('id', prep.id).select('id').single())
        : check(await supabase.from('ingredients').insert({ ...row, restaurant_id: r.id }).select('id').single())) as unknown as { id: string };
      // the lines: replaced as a whole (the cost is recalculated by the database after each change)
      check(await supabase.from('preparation_lines').delete().eq('preparation_id', saved.id).select('id'));
      check(await supabase.from('preparation_lines').insert(lines.map((x, i) => ({
        restaurant_id: r.id, preparation_id: saved.id, ingredient_id: x.ingredient_id,
        qty: Math.round(num(x.qty) * factor(x) * 1000) / 1000, sort_order: i,
      }))).select('id'));
      a.toast(t('Préparation enregistrée'));
      onSaved();
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      if (m.includes('preparation loop')) a.toast(t('Impossible : cette préparation se contiendrait elle-même.'), 'error'); else a.fail(e);
    }
    setBusy(false);
  };

  return (
    <Modal wide title={prep ? (role === 'final' ? t('Modifier le produit fini') : t('Modifier la préparation')) : role === 'final' ? t('Nouveau produit fini') : t('Nouvelle préparation')} onClose={onClose}
      footer={<div className="flex justify-end gap-3"><Btn tone="ghost" onClick={onClose}>{t('Annuler')}</Btn><Btn tone="brand" disabled={busy || rows === null} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">{t('Une recette faite chez vous : pâte, crème, garniture, ou une pièce préparée à l’avance. Son coût se calcule tout seul à partir des ingrédients.')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Nom')}><input autoFocus className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder={t('Pâte feuilletée')} /></Field>
          <Field label={t('Nom en arabe')}><input className={inputCls} dir="rtl" value={nameAr} onChange={e => setNameAr(e.target.value)} /></Field>
        </div>
        <Field group label={t('Le résultat se mesure')} hint={used > 0 ? t('Utilisé dans {n} recette(s) : l’unité ne peut plus changer.', { n: used }) : undefined}>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(BASE_LABEL) as BaseUnit[]).map(b => (
              <button key={b} type="button" disabled={used > 0} onClick={() => changeBase(b)}
                className={`rounded-xl border px-2 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${base === b ? 'border-brand bg-brand/10 text-brand' : 'border-line/[0.12] hover:bg-surface-2'}`}>
                {t(BASE_LABEL[b])}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Une fournée donne')}>
            <div className="flex gap-2">
              <input className={inputCls} inputMode="decimal" value={yQty} onChange={e => setYQty(e.target.value)} placeholder={base === 'pc' ? '60' : '2'} />
              <select className={`${inputCls} !w-24 shrink-0`} value={yUnit} onChange={e => setYUnit(e.target.value)}>
                {RECIPE_UNITS[base].map(u => <option key={u.u} value={u.u}>{u.u}</option>)}
              </select>
            </div>
          </Field>
          <div className="flex flex-col justify-end gap-1 pb-1">
            <Toggle checked={ahead} onChange={setAhead} label={t('Préparée à l’avance (elle a son propre stock)')} />
            <p className="text-xs text-muted">{ahead ? t('Vous la produisez sur la page Production ; les ventes prennent dans son stock.') : t('Faite à la minute : chaque vente prend directement ses ingrédients.')}</p>
          </div>
        </div>
        <Field label={t('Dans quelle liste ?')} group>
          <div className="flex flex-wrap gap-2">
            {([[null, t('Automatique')], ['intermediate', t('Préparation')], ['final', t('Produit fini')]] as const).map(([k, l]) => (
              <Btn key={String(k)} tone={role === k ? 'brand' : 'ghost'} className="px-3 py-2 text-sm" onClick={() => setRole(k)}>{l}</Btn>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">{role === null ? t('Automatique : vendue telle quelle sur le menu = produit fini, sinon préparation.') : role === 'final' ? t('Vendue telle quelle : croissant, cinnamon roll, tartelette.') : t('Utilisée dans autre chose : icing, pâte, crème.')}</p>
        </Field>
        {ahead && (
          <div className="rounded-2xl bg-surface-2 p-4">
            <p className="mb-3 text-sm font-bold">{t('Durée de conservation')}</p>
            <Toggle checked={track} onChange={setTrack} label={t('Suivre les dates de péremption')} />
            {track && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label={t('Durée de conservation (jours)')}>
                  <input className={inputCls} inputMode="numeric" value={shelf} onChange={e => setShelf(e.target.value)} placeholder="2" />
                </Field>
                <Field label={t('Prévenir (jours avant)')}>
                  <input className={inputCls} inputMode="numeric" value={warnDays} onChange={e => setWarnDays(e.target.value)} />
                </Field>
              </div>
            )}
          </div>
        )}

        <div className="rounded-2xl bg-surface-2 p-4">
          <p className="mb-3 text-sm font-bold">{t('Ingrédients pour une fournée')}</p>
          {rows === null ? <p className="text-sm text-muted">{t('Chargement…')}</p> : (
            <div className="space-y-2">
              {rows.map(x => {
                const g = byId.get(x.ingredient_id);
                const c = g ? unitCost(g) : null;
                return (
                  <div key={x.key} className="grid grid-cols-[minmax(0,1fr)_5.5rem_4.5rem_2.5rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_5rem_5rem_2.5rem]">
                    <select className={inputCls} value={x.ingredient_id} onChange={e => pick(x.key, e.target.value)}>
                      <option value="">{t('Choisir un ingrédient')}</option>
                      {choices.map(o => <option key={o.id} value={o.id}>{o.name}{o.is_preparation ? ` (${t('préparation')})` : ''}</option>)}
                    </select>
                    <input className={inputCls} inputMode="decimal" value={x.qty} onChange={e => setRow(x.key, { qty: e.target.value })} placeholder="500" />
                    <select className={inputCls} value={x.unit} disabled={!g} onChange={e => setRow(x.key, { unit: e.target.value })}>
                      {(g ? RECIPE_UNITS[g.base_unit] : [{ u: '', f: 1 }]).map(u => <option key={u.u} value={u.u}>{u.u}</option>)}
                    </select>
                    <span className="hidden text-end text-sm tabular text-muted sm:block">{g && num(x.qty) > 0 ? (c == null ? <span className="text-danger">{t('sans prix')}</span> : mad(Math.round(c * num(x.qty) * factor(x)))) : ''}</span>
                    <button type="button" aria-label={t('Retirer')} title={t('Retirer')} onClick={() => setRows(rs => (rs ?? []).filter(y => y.key !== x.key))} className="rounded-lg p-2 text-muted hover:bg-danger/10 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                  </div>
                );
              })}
              <Btn tone="ghost" className="px-2.5 py-1.5 text-sm" onClick={() => setRows(rs => [...(rs ?? []), { key: String(++seq), ingredient_id: '', qty: '', unit: '' }])}><Plus className="h-4 w-4" /> {t('Ajouter un ingrédient')}</Btn>
              {!choices.length && <p className="text-sm text-warn">{t('Créez d’abord vos ingrédients (farine, beurre…) sur cette page.')}</p>}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-line/10 pt-3 text-sm">
            <span>{t('Coût d’une fournée')}: <b className="tabular">{mad(Math.round(batch))}</b></span>
            {per != null && yieldQty > 0 && <span>{t('Coût')} {perLabel}: <b className="tabular">{mad(Math.round(per * perF))}</b> <span className="text-muted">({t('fournée de {q}', { q: fmtQty(yieldQty, base) })})</span></span>}
          </div>
          {missing.length > 0 && <p className="mt-2 text-xs font-semibold text-warn">{t('Sans prix : {list}. Le coût est incomplet.', { list: missing.join(', ') })}</p>}
        </div>
      </div>
    </Modal>
  );
}
