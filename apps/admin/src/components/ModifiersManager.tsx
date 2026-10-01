// Extras and set menus: groups of options ("Suppléments", "Cuisson", "Boisson de la formule")
// linked to dishes. Prices are added by the database when a dish is ordered.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { tr } from '@resto/shared';
import { supabase } from '../lib/supabase';
import { check, fromCents, mad, toCents } from '../lib/api';
import { useAdminCtx } from '../store';
import type { Category, I18n, Item, Restaurant } from '../lib/types';
import { Btn, Field, I18nInput, Modal, inputCls } from './ui';
import { t } from '../lib/i18n';

interface Group { id: string; name: I18n; min_select: number; max_select: number | null; sort_order: number; active: boolean }
interface Option { id: string; group_id: string; name: I18n; price_cents: number; sort_order: number; active: boolean }
interface Link { menu_item_id: string; group_id: string }
type Kind = 'extras' | 'one' | 'custom';

export function ModifiersManager({ r, cats, items, onClose }: { r: Restaurant; cats: Category[]; items: Item[]; onClose: () => void }) {
  const a = useAdminCtx();
  const lang = r.languages[0] ?? 'fr';
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [edit, setEdit] = useState<Group | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      const [g, o, l] = await Promise.all([
        supabase.from('modifier_groups').select('*').eq('restaurant_id', r.id).order('sort_order').order('created_at'),
        supabase.from('modifier_options').select('*').eq('restaurant_id', r.id).order('sort_order').order('created_at'),
        supabase.from('item_modifier_groups').select('menu_item_id, group_id').eq('restaurant_id', r.id),
      ]);
      setGroups(check(g) as Group[]); setOptions(check(o) as Option[]); setLinks(check(l) as Link[]);
    } catch (e) { a.fail(e); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);

  const rule = (g: Group) => g.min_select === 1 && g.max_select === 1 ? t('1 choix obligatoire')
    : g.min_select > 0 ? t('{a} à {b} choix', { a: g.min_select, b: g.max_select ?? '∞' })
    : g.max_select ? t('facultatif, jusqu’à {n}', { n: g.max_select }) : t('facultatif');

  return (
    <Modal wide title={t('Suppléments et formules')} onClose={onClose}
      footer={<div className="flex justify-between"><Btn onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> {t('Nouveau groupe')}</Btn><Btn tone="brand" onClick={onClose}>{t('Terminé')}</Btn></div>}>
      <p className="mb-4 text-sm text-muted">{t('Un groupe = des choix proposés sur certains plats. Exemples : « Suppléments » (fromage + 5 DH, œuf + 3 DH), « Cuisson » (1 choix obligatoire), ou pour une formule petit-déjeuner : « Boisson » et « Viennoiserie » (1 choix chacun, 0 DH).')}</p>
      {groups === null ? <p className="text-muted">{t('Chargement…')}</p> : !groups.length ? (
        <div className="rounded-2xl border border-dashed border-line/20 p-8 text-center text-muted">{t('Aucun groupe pour le moment.')}</div>
      ) : (
        <ul className="divide-y divide-line/10 overflow-hidden rounded-2xl border border-line/10">
          {groups.map(g => {
            const os = options.filter(o => o.group_id === g.id && o.active);
            const n = links.filter(l => l.group_id === g.id).length;
            return (
              <li key={g.id} className={`flex items-center gap-3 px-4 py-3 ${g.active ? '' : 'opacity-50'}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{tr(g.name, lang)} <span className="text-xs font-normal text-muted">· {rule(g)}</span></p>
                  <p className="truncate text-sm text-muted">{os.map(o => `${tr(o.name, lang)}${o.price_cents ? ` +${mad(o.price_cents)}` : ''}`).join(' · ') || t('Aucune option')}</p>
                  <p className="text-xs text-muted">{t('{n} plat(s)', { n })}</p>
                </div>
                <Btn className="px-3 py-1.5" onClick={() => setEdit(g)}><Pencil className="h-4 w-4" /> {t('Modifier')}</Btn>
              </li>
            );
          })}
        </ul>
      )}
      {edit && <GroupEditor r={r} cats={cats} items={items} group={edit === 'new' ? null : edit}
        options={edit === 'new' ? [] : options.filter(o => o.group_id === edit.id)}
        linked={edit === 'new' ? [] : links.filter(l => l.group_id === edit.id).map(l => l.menu_item_id)}
        count={groups?.length ?? 0} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </Modal>
  );
}

type DraftOpt = { id?: string; name: I18n; price: string; active: boolean };

function GroupEditor({ r, cats, items, group, options, linked, count, onClose, onSaved }: {
  r: Restaurant; cats: Category[]; items: Item[]; group: Group | null; options: Option[]; linked: string[]; count: number; onClose: () => void; onSaved: () => void;
}) {
  const a = useAdminCtx();
  const lang = r.languages[0] ?? 'fr';
  const [name, setName] = useState<I18n>(group?.name ?? {});
  const initialKind: Kind = !group ? 'extras' : group.min_select === 0 && group.max_select == null ? 'extras' : group.min_select === 1 && group.max_select === 1 ? 'one' : 'custom';
  const [kind, setKind] = useState<Kind>(initialKind);
  const [min, setMin] = useState(String(group?.min_select ?? 0));
  const [max, setMax] = useState(group?.max_select == null ? '' : String(group.max_select));
  const [opts, setOpts] = useState<DraftOpt[]>(() => options.length
    ? options.map(o => ({ id: o.id, name: o.name, price: fromCents(o.price_cents), active: o.active }))
    : [{ name: {}, price: '', active: true }]);
  const [dishes, setDishes] = useState<Set<string>>(() => new Set(linked));
  const [active, setActive] = useState(group?.active ?? true);
  const [busy, setBusy] = useState(false);
  const byCat = useMemo(() => cats.map(c => ({ c, list: items.filter(i => i.category_id === c.id && i.active) })).filter(x => x.list.length), [cats, items]);

  const [minN, maxN] = kind === 'extras' ? [0, null] : kind === 'one' ? [1, 1] : [Math.max(0, Number(min) || 0), max.trim() ? Math.max(1, Number(max) || 1) : null];
  const named = opts.filter(o => Object.values(o.name).some(v => v.trim()));
  const ok = Object.values(name).some(v => v.trim()) && named.length > 0 && (maxN == null || maxN >= minN) && (maxN == null || minN <= named.length);

  const toggleDish = (id: string) => setDishes(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleCat = (ids: string[]) => setDishes(s => { const n = new Set(s); const all = ids.every(id => n.has(id)); ids.forEach(id => (all ? n.delete(id) : n.add(id))); return n; });

  const save = async () => {
    setBusy(true);
    try {
      const row = { name, min_select: minN, max_select: maxN, active };
      const g = group
        ? (check(await supabase.from('modifier_groups').update(row).eq('id', group.id).select('id').single()) as { id: string })
        : (check(await supabase.from('modifier_groups').insert({ ...row, restaurant_id: r.id, sort_order: (count + 1) * 10 }).select('id').single()) as { id: string });
      // options: update the kept ones, add the new ones, remove the emptied ones
      const keep = new Set(named.filter(o => o.id).map(o => o.id!));
      const gone = options.filter(o => !keep.has(o.id)).map(o => o.id);
      if (gone.length) check(await supabase.from('modifier_options').delete().in('id', gone).select('id'));
      for (const [k, o] of named.entries()) {
        const data = { name: o.name, price_cents: o.price.trim() ? toCents(o.price) : 0, sort_order: (k + 1) * 10, active: o.active };
        if (o.id) check(await supabase.from('modifier_options').update(data).eq('id', o.id).select('id'));
        else check(await supabase.from('modifier_options').insert({ ...data, restaurant_id: r.id, group_id: g.id }).select('id'));
      }
      // dishes
      check(await supabase.from('item_modifier_groups').delete().eq('group_id', g.id).select('group_id'));
      if (dishes.size) check(await supabase.from('item_modifier_groups').insert([...dishes].map(id => ({ restaurant_id: r.id, menu_item_id: id, group_id: g.id, sort_order: group?.sort_order ?? (count + 1) * 10 }))).select('group_id'));
      a.toast(t('Groupe enregistré')); onSaved();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };
  const remove = async () => {
    if (!group) return;
    try { check(await supabase.from('modifier_groups').delete().eq('id', group.id).select('id')); a.toast(t('Groupe supprimé')); onSaved(); } catch (e) { a.fail(e); }
  };

  return (
    <Modal wide title={group ? t('Modifier le groupe') : t('Nouveau groupe')} onClose={onClose}
      footer={<div className="flex justify-between">{group ? <Btn tone="danger" onClick={remove}><Trash2 className="h-4 w-4" /> {t('Supprimer')}</Btn> : <span />}<Btn tone="brand" disabled={!ok || busy} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-5">
        <Field group label={t('Nom du groupe')}><I18nInput value={name} onChange={setName} langs={r.languages.length ? r.languages : ['fr']} max={60} ariaLabel={t('Nom du groupe')} /></Field>
        <Field group label={t('Le client choisit')}>
          <div className="grid gap-2 sm:grid-cols-3">
            {([['extras', t('Des suppléments'), t('facultatif, plusieurs')], ['one', t('Un choix obligatoire'), t('cuisson, boisson de la formule')], ['custom', t('Sur mesure'), t('minimum et maximum')]] as const).map(([k, l, h]) => (
              <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-xl px-3 py-2.5 text-start ${kind === k ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>
                <span className="block font-semibold">{l}</span><span className="text-xs opacity-80">{h}</span>
              </button>
            ))}
          </div>
          {kind === 'custom' && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              {t('Entre')} <input aria-label={t('Minimum')} className={`${inputCls} w-16`} inputMode="numeric" value={min} onChange={e => setMin(e.target.value)} />
              {t('et')} <input aria-label={t('Maximum')} className={`${inputCls} w-16`} inputMode="numeric" value={max} onChange={e => setMax(e.target.value)} placeholder="∞" /> {t('choix')}
            </div>
          )}
        </Field>

        <Field group label={t('Options')}>
          <div className="space-y-2">
            {opts.map((o, k) => (
              <div key={k} className="grid grid-cols-[1fr_110px_auto] items-start gap-2">
                <I18nInput compact value={o.name} onChange={v => setOpts(x => x.map((y, j) => (j === k ? { ...y, name: v } : y)))} langs={r.languages.length ? r.languages : ['fr']} max={60} ariaLabel={t('Option {n}', { n: k + 1 })} />
                <input className={inputCls} inputMode="decimal" placeholder={t('+ DH')} aria-label={t('Prix en plus (DH)')} value={o.price} onChange={e => setOpts(x => x.map((y, j) => (j === k ? { ...y, price: e.target.value } : y)))} />
                <button aria-label={t('Supprimer')} onClick={() => setOpts(x => x.filter((_, j) => j !== k))} className="grid h-10 w-10 place-items-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <Btn tone="ghost" onClick={() => setOpts(x => [...x, { name: {}, price: '', active: true }])}><Plus className="h-4 w-4" /> {t('Ajouter une option')}</Btn>
            <p className="text-xs text-muted">{t('Laissez le prix vide pour une option gratuite (choix de la formule, cuisson).')}</p>
          </div>
        </Field>

        <Field group label={t('Sur quels plats ? ({n})', { n: dishes.size })}>
          <div className="max-h-72 space-y-3 overflow-y-auto rounded-2xl bg-surface-2 p-3">
            {byCat.map(({ c, list }) => {
              const ids = list.map(i => i.id);
              const all = ids.every(id => dishes.has(id));
              return (
                <div key={c.id}>
                  <label className="mb-1 flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={all} onChange={() => toggleCat(ids)} /> {c.icon} {tr(c.name, lang)}</label>
                  <div className="grid gap-1 ps-6 sm:grid-cols-2">
                    {list.map(i => <label key={i.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dishes.has(i.id)} onChange={() => toggleDish(i.id)} /> {tr(i.name, lang)}</label>)}
                  </div>
                </div>
              );
            })}
          </div>
        </Field>
        {group && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> {t('Actif')}</label>}
      </div>
    </Modal>
  );
}
