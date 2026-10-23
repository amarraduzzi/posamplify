// Amplify Profit: what is bought (purchase prices), what is made to go into something else (icing, dough), and
// what is made to be sold as it is (croissant): three lists. A preparation used directly in a dish of the menu is a
// finished product, unless the owner chose otherwise (prep_role).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Sparkles, Check, Upload, Trash2, ListChecks, CookingPot, BookOpen, Wheat, Croissant } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, mad } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { I18n, Ingredient, Restaurant } from '../lib/types';
import { CATEGORIES, SIZE_UNIT, unitCost } from '../lib/profit';
import { IngredientEditor } from '../components/IngredientEditor';
import { PreparationEditor } from '../components/PreparationEditor';
import { ImportRecipes } from '../components/ImportRecipes';
import { Btn, inputCls } from '../components/ui';
import { ImportData } from '../components/ImportData';
import { QuickPrices } from '../components/QuickPrices';

type Tab = 'raw' | 'prep' | 'final';

export function IngredientsPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [list, setList] = useState<Ingredient[] | null>(null);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');
  const [onlyEstimated, setOnlyEstimated] = useState(false);
  const [edit, setEdit] = useState<Ingredient | 'new' | null>(null);
  const [prepEdit, setPrepEdit] = useState<Ingredient | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [importRecipes, setImportRecipes] = useState(false);
  const [quick, setQuick] = useState(false);
  const [tab, setTab] = useState<Tab>('raw');
  const [newRole, setNewRole] = useState<'final' | null>(null);
  // the dishes each preparation is sold in directly (to find the finished products and show their price)
  const [sold, setSold] = useState<Record<string, { name: string; price: number; qty: number }[]>>({});

  const load = useCallback(async () => {
    try {
      const [g, l, p] = await Promise.all([
        supabase.from('ingredients').select('*').eq('restaurant_id', r.id).order('category').order('name'),
        supabase.from('recipe_lines').select('ingredient_id, menu_item_id, qty').eq('restaurant_id', r.id),
        supabase.from('preparation_lines').select('ingredient_id').eq('restaurant_id', r.id),
      ]);
      const items = check(await supabase.from('menu_items').select('id, name, price_cents').eq('restaurant_id', r.id)) as { id: string; name: I18n; price_cents: number }[];
      const byItem = new Map(items.map(i => [i.id, i]));
      const so: Record<string, { name: string; price: number; qty: number }[]> = {};
      for (const x of check(l) as { ingredient_id: string; menu_item_id: string; qty: number }[]) {
        const it = byItem.get(x.menu_item_id);
        if (it) (so[x.ingredient_id] ??= []).push({ name: (it.name?.fr || Object.values(it.name ?? {})[0] || '') as string, price: Number(it.price_cents), qty: Number(x.qty) });
      }
      setSold(so);
      // alphabetical, ignoring capitals and accents (É next to E)
      setList((check(g) as Ingredient[]).sort((x, y) => x.name.localeCompare(y.name, 'fr', { sensitivity: 'base', numeric: true })));
      const u: Record<string, number> = {};
      // used in a dish or inside a preparation
      for (const x of [...check(l), ...check(p)] as { ingredient_id: string }[]) u[x.ingredient_id] = (u[x.ingredient_id] ?? 0) + 1;
      setUsage(u);
    } catch (e) { a.fail(e); setList([]); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);

  const kindOf = useCallback((g: Ingredient): Tab => !g.is_preparation ? 'raw' : (g.prep_role ?? (sold[g.id]?.length ? 'final' : 'intermediate')) === 'final' ? 'final' : 'prep', [sold]);
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { raw: 0, prep: 0, final: 0 };
    for (const g of list ?? []) c[kindOf(g)]++;
    return c;
  }, [list, kindOf]);
  const shown = useMemo(() => {
    const f = q.trim().toLowerCase();
    return (list ?? []).filter(g => kindOf(g) === tab && (!f || g.name.toLowerCase().includes(f) || (g.name_ar ?? '').includes(f)) && (!onlyEstimated || tab !== 'raw' || g.price_estimated || g.purchase_price_cents == null));
  }, [list, q, onlyEstimated, tab, kindOf]);
  const TABS: [Tab, string, typeof Wheat][] = [['raw', t('Ingrédients'), Wheat], ['prep', t('Préparations'), CookingPot], ['final', t('Produits finis'), Croissant]];
  const estimated = (list ?? []).filter(g => !g.is_preparation && (g.price_estimated || g.purchase_price_cents == null)).length;
  const open = (g: Ingredient) => (g.is_preparation ? setPrepEdit(g) : setEdit(g));

  const confirm = async (g: Ingredient) => {
    try { check(await supabase.from('ingredients').update({ price_estimated: false }).eq('id', g.id).select('id')); a.toast(t('Prix confirmé')); load(); } catch (e) { a.fail(e); }
  };

  const remove = async (g: Ingredient) => {
    if ((usage[g.id] ?? 0) > 0) {
      a.toast(t('Utilisé dans {n} recette(s) : retirez-le d’abord des recettes.', { n: usage[g.id] }), 'error');
      return;
    }
    if (!window.confirm(t('Supprimer {name} ?', { name: g.name }))) return;
    try {
      check(await supabase.from('ingredients').delete().eq('id', g.id).select('id'));
      a.toast(t('Ingrédient supprimé'));
      load();
    } catch (e) { a.fail(e); }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="me-auto">
          <h1 className="font-display text-3xl font-semibold">{t('Ingrédients')}</h1>
          <p className="text-muted">{tab === 'raw' ? t('Vos prix d’achat. Chaque changement de prix met à jour le coût de vos plats.')
            : tab === 'prep' ? t('Ce que vous faites pour l’utiliser dans autre chose : icing, pâte, crème.')
            : t('Ce que vous faites et vendez tel quel : croissant, cinnamon roll, tartelette.')}</p>
        </div>
        <div className="flex rounded-2xl bg-surface-2 p-1" role="tablist">
          {TABS.map(([k, l, Icon]) => (
            <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => { setTab(k); setOnlyEstimated(false); }}
              className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${tab === k ? 'bg-surface shadow-sm' : 'text-muted hover:text-ink'}`}>
              <Icon className="h-4 w-4" /> {l} <span className="tabular text-xs text-muted">{counts[k]}</span></button>
          ))}
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className={`${inputCls} ps-9`} placeholder={t('Chercher')} value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <span className="ms-auto flex flex-wrap gap-2">
          {tab === 'raw' && <>
            <Btn onClick={() => setQuick(true)} disabled={!counts.raw}><ListChecks className="h-4 w-4" /> {t('Saisie rapide')}</Btn>
            <Btn onClick={() => setImporting(true)}><Upload className="h-4 w-4" /> {t('Importer')}</Btn>
            <Btn tone="brand" onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> {t('Nouvel ingrédient')}</Btn>
          </>}
          {tab !== 'raw' && <Btn onClick={() => setImportRecipes(true)} disabled={list === null}><BookOpen className="h-4 w-4" /> {t('Importer des recettes')}</Btn>}
          {tab === 'prep' && <Btn tone="brand" onClick={() => { setNewRole(null); setPrepEdit('new'); }}><CookingPot className="h-4 w-4" /> {t('Nouvelle préparation')}</Btn>}
          {tab === 'final' && <Btn tone="brand" onClick={() => { setNewRole('final'); setPrepEdit('new'); }}><Croissant className="h-4 w-4" /> {t('Nouveau produit fini')}</Btn>}
        </span>
      </div>
      {importRecipes && list && <ImportRecipes r={r} ings={list} onClose={() => setImportRecipes(false)} onDone={load} />}
      {importing && <ImportData kind="ingredients" r={r} existing={(list ?? []).map(g => g.name)} onClose={() => setImporting(false)} onDone={load} />}

      {tab === 'raw' && estimated > 0 && !quick && (
        <button onClick={() => setOnlyEstimated(v => !v)} className={`mb-4 flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-start text-sm transition ${onlyEstimated ? 'border-warn bg-warn/10' : 'border-warn/40 bg-warn/5 hover:bg-warn/10'}`}>
          <Sparkles className="h-4 w-4 shrink-0 text-warn" />
          <span className="flex-1">{t('{n} prix à vérifier (estimés par l’IA ou manquants). Remplacez-les par vos vrais prix pour des marges exactes.', { n: estimated })}</span>
          <span className="font-semibold text-warn">{onlyEstimated ? t('Tout afficher') : t('Afficher')}</span>
        </button>
      )}

      {quick && list ? <QuickPrices r={r} list={list.filter(g => !g.is_preparation)} onClose={() => setQuick(false)} onDone={load} /> : list === null ? <p className="text-muted">{t('Chargement…')}</p> : !list.length ? (
        <div className="card rounded-3xl p-10 text-center text-muted">
          <p>{t('Aucun ingrédient pour le moment.')}</p>
          <p className="mt-1 text-sm">{t('Astuce : dans « Marges », l’IA peut remplir vos fiches techniques et créer les ingrédients pour vous.')}</p>
        </div>
      ) : !shown.length ? (
        <div className="card rounded-3xl p-10 text-center text-muted">
          <p>{q ? t('Rien trouvé.') : tab === 'prep' ? t('Pas encore de préparation. Créez-en une : icing, pâte, crème…') : tab === 'final' ? t('Pas encore de produit fini. Créez-en un : croissant, cinnamon roll…') : t('Aucun ingrédient pour le moment.')}</p>
        </div>
      ) : (
        <div className="card overflow-hidden rounded-3xl">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-start text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3 text-start">{tab === 'raw' ? t('Ingrédient') : tab === 'prep' ? t('Préparation') : t('Produit')}</th>
                {tab === 'raw' && <th className="hidden px-4 py-3 text-start md:table-cell">{t('Catégorie')}</th>}
                <th className="px-4 py-3 text-end">{tab === 'raw' ? t('Prix d’achat') : t('Coût par fournée')}</th>
                <th className="hidden px-4 py-3 text-end sm:table-cell">{tab === 'final' ? t('Coût par pièce') : t('Coût réel')}</th>
                {tab === 'final' ? <th className="hidden px-4 py-3 text-end md:table-cell">{t('Vendu')}</th>
                  : <th className="hidden px-4 py-3 text-end md:table-cell">{tab === 'prep' ? t('Utilisée dans') : t('Recettes')}</th>}
                <th className="w-28 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line/10">
              {shown.map(g => {
                const c = unitCost(g);
                return (
                  <tr key={g.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => open(g)}>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{g.name}{g.is_preparation && !g.made_ahead && <span className="ms-2 inline-block whitespace-nowrap rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">{t('fait à la minute')}</span>}</p>
                      {g.name_ar && <p className="text-xs text-muted" dir="rtl">{g.name_ar}</p>}
                    </td>
                    {tab === 'raw' && <td className="hidden px-4 py-3 text-muted md:table-cell">{t(CATEGORIES[g.category] ?? 'Autre')}</td>}
                    <td className="px-4 py-3 text-end tabular">
                      {g.purchase_price_cents == null ? <span className="text-danger">{g.is_preparation ? t('Recette incomplète') : t('Prix manquant')}</span>
                        : <>{mad(g.purchase_price_cents)} <span className="text-muted">/ {g.is_preparation ? t('fournée') : g.purchase_unit}</span></>}
                      {g.price_estimated && <span className="ms-2 rounded bg-warn/15 px-1.5 py-0.5 text-[11px] font-semibold text-warn">{t('estimé')}</span>}
                    </td>
                    <td className="hidden px-4 py-3 text-end tabular text-muted sm:table-cell">
                      {c == null ? '—' : `${mad(Math.round(c * SIZE_UNIT[g.base_unit].f))} / ${g.base_unit === 'pc' ? t('pièce') : g.base_unit === 'g' ? 'kg' : 'l'}`}
                      {g.waste_bp > 0 && <span className="block text-[11px]">{t('perte {p} %', { p: g.waste_bp / 100 })}</span>}
                    </td>
                    {tab === 'final' ? (
                      <td className="hidden px-4 py-3 text-end md:table-cell">
                        {(sold[g.id] ?? []).slice(0, 2).map((x, i) => {
                          const share = c != null && x.price > 0 ? (c * x.qty) / x.price : null;
                          return <span key={i} className="block tabular">{x.name} · {mad(x.price)}
                            {share != null && <span className={`ms-1 text-[11px] font-semibold ${share > 0.35 ? 'text-warn' : 'text-ok'}`}>{t('matière {p} %', { p: Math.round(share * 100) })}</span>}</span>;
                        })}
                        {!(sold[g.id]?.length) && <span className="text-xs text-muted">{t('Pas encore sur le menu')}</span>}
                      </td>
                    ) : <td className="hidden px-4 py-3 text-end tabular md:table-cell">{usage[g.id] ?? 0}</td>}
                    <td className="px-4 py-3 text-end" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {g.price_estimated && <Btn tone="ghost" className="px-2.5 py-1 text-xs" onClick={() => confirm(g)}><Check className="h-3.5 w-3.5" /> {t('Confirmer')}</Btn>}
                        <button type="button" aria-label={t('Supprimer {name}', { name: g.name })} title={t('Supprimer {name}', { name: g.name })}
                          onClick={() => remove(g)}
                          className={`rounded-lg p-2 transition hover:bg-danger/10 hover:text-danger ${(usage[g.id] ?? 0) > 0 ? 'text-muted/40' : 'text-muted'}`}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {edit && <IngredientEditor r={r} ing={edit === 'new' ? null : edit} used={edit === 'new' ? 0 : usage[edit.id] ?? 0}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {prepEdit && list && <PreparationEditor r={r} prep={prepEdit === 'new' ? null : prepEdit} all={list} role0={newRole} used={prepEdit === 'new' ? 0 : usage[prepEdit.id] ?? 0}
        onClose={() => setPrepEdit(null)} onSaved={() => { setPrepEdit(null); load(); }} />}
    </div>
  );
}
