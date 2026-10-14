// Amplify Profit: the ingredient list with purchase prices.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Sparkles, Check, Upload, Trash2, ListChecks } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, mad } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Ingredient, Restaurant } from '../lib/types';
import { CATEGORIES, SIZE_UNIT, unitCost } from '../lib/profit';
import { IngredientEditor } from '../components/IngredientEditor';
import { Btn, inputCls } from '../components/ui';
import { ImportData } from '../components/ImportData';
import { QuickPrices } from '../components/QuickPrices';

export function IngredientsPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [list, setList] = useState<Ingredient[] | null>(null);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');
  const [onlyEstimated, setOnlyEstimated] = useState(false);
  const [edit, setEdit] = useState<Ingredient | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [quick, setQuick] = useState(false);

  const load = useCallback(async () => {
    try {
      const [g, l] = await Promise.all([
        supabase.from('ingredients').select('*').eq('restaurant_id', r.id).order('category').order('name'),
        supabase.from('recipe_lines').select('ingredient_id').eq('restaurant_id', r.id),
      ]);
      // alphabetical, ignoring capitals and accents (É next to E)
      setList((check(g) as Ingredient[]).sort((x, y) => x.name.localeCompare(y.name, 'fr', { sensitivity: 'base', numeric: true })));
      const u: Record<string, number> = {};
      for (const x of check(l) as { ingredient_id: string }[]) u[x.ingredient_id] = (u[x.ingredient_id] ?? 0) + 1;
      setUsage(u);
    } catch (e) { a.fail(e); setList([]); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const f = q.trim().toLowerCase();
    return (list ?? []).filter(g => (!f || g.name.toLowerCase().includes(f) || (g.name_ar ?? '').includes(f)) && (!onlyEstimated || g.price_estimated || g.purchase_price_cents == null));
  }, [list, q, onlyEstimated]);
  const estimated = (list ?? []).filter(g => g.price_estimated || g.purchase_price_cents == null).length;

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
          <p className="text-muted">{t('Vos prix d’achat. Chaque changement de prix met à jour le coût de vos plats.')}</p>
        </div>
        <div className="relative w-60">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className={`${inputCls} ps-9`} placeholder={t('Chercher')} value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Btn onClick={() => setQuick(true)} disabled={!list?.length}><ListChecks className="h-4 w-4" /> {t('Saisie rapide')}</Btn>
        <Btn onClick={() => setImporting(true)}><Upload className="h-4 w-4" /> {t('Importer')}</Btn>
        <Btn tone="brand" onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> {t('Ajouter')}</Btn>
      </div>
      {importing && <ImportData kind="ingredients" r={r} existing={(list ?? []).map(g => g.name)} onClose={() => setImporting(false)} onDone={load} />}

      {estimated > 0 && !quick && (
        <button onClick={() => setOnlyEstimated(v => !v)} className={`mb-4 flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-start text-sm transition ${onlyEstimated ? 'border-warn bg-warn/10' : 'border-warn/40 bg-warn/5 hover:bg-warn/10'}`}>
          <Sparkles className="h-4 w-4 shrink-0 text-warn" />
          <span className="flex-1">{t('{n} prix à vérifier (estimés par l’IA ou manquants). Remplacez-les par vos vrais prix pour des marges exactes.', { n: estimated })}</span>
          <span className="font-semibold text-warn">{onlyEstimated ? t('Tout afficher') : t('Afficher')}</span>
        </button>
      )}

      {quick && list ? <QuickPrices r={r} list={list} onClose={() => setQuick(false)} onDone={load} /> : list === null ? <p className="text-muted">{t('Chargement…')}</p> : !list.length ? (
        <div className="card rounded-3xl p-10 text-center text-muted">
          <p>{t('Aucun ingrédient pour le moment.')}</p>
          <p className="mt-1 text-sm">{t('Astuce : dans « Marges », l’IA peut remplir vos fiches techniques et créer les ingrédients pour vous.')}</p>
        </div>
      ) : (
        <div className="card overflow-hidden rounded-3xl">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-start text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3 text-start">{t('Ingrédient')}</th>
                <th className="hidden px-4 py-3 text-start md:table-cell">{t('Catégorie')}</th>
                <th className="px-4 py-3 text-end">{t('Prix d’achat')}</th>
                <th className="hidden px-4 py-3 text-end sm:table-cell">{t('Coût réel')}</th>
                <th className="hidden px-4 py-3 text-end md:table-cell">{t('Recettes')}</th>
                <th className="w-28 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line/10">
              {shown.map(g => {
                const c = unitCost(g);
                return (
                  <tr key={g.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => setEdit(g)}>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{g.name}</p>
                      {g.name_ar && <p className="text-xs text-muted" dir="rtl">{g.name_ar}</p>}
                    </td>
                    <td className="hidden px-4 py-3 text-muted md:table-cell">{t(CATEGORIES[g.category] ?? 'Autre')}</td>
                    <td className="px-4 py-3 text-end tabular">
                      {g.purchase_price_cents == null ? <span className="text-danger">{t('Prix manquant')}</span>
                        : <>{mad(g.purchase_price_cents)} <span className="text-muted">/ {g.purchase_unit}</span></>}
                      {g.price_estimated && <span className="ms-2 rounded bg-warn/15 px-1.5 py-0.5 text-[11px] font-semibold text-warn">{t('estimé')}</span>}
                    </td>
                    <td className="hidden px-4 py-3 text-end tabular text-muted sm:table-cell">
                      {c == null ? '—' : `${mad(Math.round(c * SIZE_UNIT[g.base_unit].f))} / ${g.base_unit === 'pc' ? t('pièce') : g.base_unit === 'g' ? 'kg' : 'l'}`}
                      {g.waste_bp > 0 && <span className="block text-[11px]">{t('perte {p} %', { p: g.waste_bp / 100 })}</span>}
                    </td>
                    <td className="hidden px-4 py-3 text-end tabular md:table-cell">{usage[g.id] ?? 0}</td>
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
    </div>
  );
}
