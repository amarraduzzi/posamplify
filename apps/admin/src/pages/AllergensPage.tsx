// Allergens: what each ingredient contains, what each product ends up with (calculated through the recipes and
// preparations), what is still to fill in, and the switch that shows them on the guest menu.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Printer, ShieldAlert } from 'lucide-react';
import { allergenIcon, allergenName, type AllergenOverview, type ItemAllergens } from '@resto/shared';
import { supabase } from '../lib/supabase';
import { check, rpc } from '../lib/api';
import { getLang, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { I18n, Restaurant } from '../lib/types';
import { Btn, Modal, Toggle } from '../components/ui';
import { AllergenBadges, AllergenChips, AllergenSection } from '../components/AllergenSection';

interface Item { id: string; name: I18n }
interface Ing { id: string; name: string }

const nameOf = (n: I18n | null | undefined) => (n?.fr || Object.values(n ?? {})[0] || '') as string;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c] as string));

export function AllergensPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [ov, setOv] = useState<AllergenOverview | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [ings, setIngs] = useState<Ing[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string[] | null>>({});
  const [filter, setFilter] = useState<'all' | 'todo'>('all');
  const [edit, setEdit] = useState<ItemAllergens | null>(null);
  const [busy, setBusy] = useState(false);
  const canSwitch = a.isAdmin || a.role === 'owner';

  const load = useCallback(async () => {
    try {
      const [o, it, ig] = await Promise.all([
        rpc<AllergenOverview>('allergen_overview', { p_restaurant_id: r.id }),
        supabase.from('menu_items').select('id, name').eq('restaurant_id', r.id),
        supabase.from('ingredients').select('id, name').eq('restaurant_id', r.id),
      ]);
      setOv(o);
      setItems(check(it) as Item[]);
      setIngs(check(ig) as Ing[]);
    } catch (e) { a.fail(e); }
  }, [r.id, a]);
  useEffect(() => { load(); }, [load]);

  const itemName = useMemo(() => new Map(items.map(i => [i.id, nameOf(i.name)])), [items]);
  const ingName = useMemo(() => new Map(ings.map(i => [i.id, i.name])), [ings]);

  if (!ov) return <p className="py-10 text-center text-muted">…</p>;

  const total = ov.items.length;
  const complete = ov.items.filter(i => i.state === 'complete').length;
  const shown = ov.items.filter(i => filter === 'all' || i.state !== 'complete');

  const saveIngredient = async (id: string) => {
    const v = drafts[id];
    if (v == null) return;
    setBusy(true);
    try {
      check(await supabase.from('ingredients').update({ allergens: v }).eq('id', id));
      setDrafts(d => { const n = { ...d }; delete n[id]; return n; });
      await load();
    } catch (e) { a.fail(e); }
    setBusy(false);
  };

  const switchGuests = async (on: boolean) => {
    setBusy(true);
    try {
      check(await supabase.from('restaurants').update({ show_allergens: on }).eq('id', r.id));
      setOv({ ...ov, show_allergens: on });
      a.toast(on ? t('Les allergènes sont visibles sur le menu client.') : t('Les allergènes ne sont plus affichés aux clients.'));
    } catch (e) { a.fail(e); }
    setBusy(false);
  };

  // a sheet to print and keep in the shop: one line per product
  const printSheet = () => {
    const lang = getLang();
    const rows = ov.items.map(i => {
      const nm = itemName.get(i.item_id) ?? '';
      const ok = i.state === 'complete';
      const al = ok ? (i.allergens.length ? i.allergens.map(c => `${allergenIcon(c)} ${allergenName(c, lang)}`).join(', ') : t('Aucun allergène déclaré')) : t('À compléter');
      const tr = ok && i.may_contain.length ? i.may_contain.map(c => allergenName(c, lang)).join(', ') : '';
      return `<tr${ok ? '' : ' class="todo"'}><td>${esc(nm)}</td><td>${esc(al)}</td><td>${esc(tr)}</td></tr>`;
    }).sort().join('');
    const w = window.open('', '_blank');
    if (!w) { a.toast(t('Autorisez les fenêtres pop-up pour imprimer.'), 'error'); return; }
    w.document.write(`<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(t('Allergènes'))} - ${esc(r.name)}</title>
<style>body{font:14px/1.4 system-ui,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0 0 4px}p{margin:0 0 14px;color:#555}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:6px 8px;text-align:start;vertical-align:top}th{background:#f1f1f1}
.todo td{color:#888;font-style:italic}@media print{body{margin:10mm}}</style></head><body>
<h1>${esc(t('Allergènes'))} - ${esc(r.name)}</h1><p>${esc(new Date().toLocaleDateString(lang === 'ar' ? 'ar-MA-u-nu-latn' : lang === 'en' ? 'en-GB' : 'fr-FR'))} · ${esc(t('Informations indicatives. En cas d’allergie, demandez au personnel.'))}</p>
<table><thead><tr><th>${esc(t('Produit'))}</th><th>${esc(t('Allergènes'))}</th><th>${esc(t('Traces possibles'))}</th></tr></thead><tbody>${rows}</tbody></table>
<script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><ShieldAlert className="h-6 w-6 text-brand" />{t('Allergènes')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t('Indiquez les allergènes de chaque ingrédient une seule fois : ils sont calculés automatiquement pour chaque recette, préparation et produit.')}</p>
        </div>
        <Btn onClick={printSheet}><Printer className="h-4 w-4" /> {t('Imprimer la fiche')}</Btn>
      </div>

      <div className="rounded-2xl bg-surface-2 p-4">
        <p className="text-sm"><b className="tabular">{complete}</b> / <b className="tabular">{total}</b> {t('produits complets')} · <b className="tabular">{ov.missing.length}</b> {t('ingrédient(s) à compléter')}</p>
        <div className="mt-3">
          <Toggle checked={ov.show_allergens} disabled={!canSwitch || busy} onChange={switchGuests} label={t('Afficher les allergènes sur le menu client')} />
          <p className="mt-1.5 text-xs text-muted">
            {canSwitch ? t('Un produit à compléter n’affiche rien de précis : le client est invité à demander au personnel. Rien n’est jamais affiché comme « sans allergène » tant que la recette n’est pas complète.') : t('Seul le propriétaire peut activer cet affichage.')}
          </p>
        </div>
      </div>

      {ov.missing.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-bold">{t('Ingrédients à compléter')}</h2>
          <ul className="space-y-3">
            {ov.missing.map(id => (
              <li key={id} className="rounded-2xl border border-line/[0.12] p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <b>{ingName.get(id) ?? '?'}</b>
                  <Btn tone="brand" disabled={busy || drafts[id] == null} onClick={() => saveIngredient(id)}>{t('Enregistrer')}</Btn>
                </div>
                <AllergenSection compact value={drafts[id] ?? null} onChange={v => setDrafts(d => ({ ...d, [id]: v }))} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{t('Produits')}</h2>
          <div className="flex gap-1.5">
            {(['all', 'todo'] as const).map(f => (
              <button key={f} type="button" onClick={() => setFilter(f)}
                className={`rounded-full border px-3 py-1 text-xs font-bold ${filter === f ? 'border-brand bg-brand/10 text-brand' : 'border-line/[0.12] text-muted'}`}>
                {f === 'all' ? t('Tous') : t('À compléter')}
              </button>
            ))}
          </div>
        </div>
        {shown.length === 0 ? <p className="py-6 text-center text-muted">{t('Rien à afficher.')}</p> : (
          <ul className="divide-y divide-line/[0.08] rounded-2xl border border-line/[0.12]">
            {shown.map(i => (
              <li key={i.item_id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{itemName.get(i.item_id) ?? '?'}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {i.state === 'complete'
                      ? (i.allergens.length ? <AllergenBadges list={i.allergens} /> : <span className="text-xs text-muted">{t('Aucun allergène déclaré')}</span>)
                      : <span className="rounded-full bg-warn/10 px-2 py-0.5 text-[11px] font-bold text-warn">{i.has_recipe ? t('Ingrédient à compléter') : t('Pas de recette : à vérifier à la main')}</span>}
                    {i.state === 'complete' && i.may_contain.length > 0 && <><span className="text-[11px] text-muted">{t('Traces')} :</span><AllergenBadges list={i.may_contain} tone="muted" /></>}
                  </div>
                </div>
                <Btn onClick={() => setEdit(i)}>{t('Modifier')}</Btn>
              </li>
            ))}
          </ul>
        )}
      </section>

      {edit && <ItemEditor item={edit} name={itemName.get(edit.item_id) ?? ''} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function ItemEditor({ item, name, onClose, onSaved }: { item: ItemAllergens; name: string; onClose: () => void; onSaved: () => void }) {
  const a = useAdminCtx();
  const [add, setAdd] = useState<string[]>(item.add);
  const [remove, setRemove] = useState<string[]>(item.remove);
  const [confirmed, setConfirmed] = useState(item.confirmed);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      check(await supabase.from('menu_items').update({ allergens_add: add, allergens_remove: remove, allergens_confirmed: confirmed }).eq('id', item.item_id));
      a.toast(t('Enregistré'));
      onSaved();
    } catch (e) { a.fail(e); setBusy(false); }
  };
  return (
    <Modal title={name} onClose={onClose}
      footer={<div className="flex justify-end gap-3"><Btn tone="ghost" onClick={onClose}>{t('Annuler')}</Btn><Btn tone="brand" disabled={busy} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <div>
          <p className="mb-1 text-sm font-bold">{t('Calculé depuis la recette')}</p>
          {!item.has_recipe
            ? <p className="text-sm text-muted">{t('Ce produit n’a pas de recette. Indiquez ses allergènes à la main ci-dessous, puis cochez « Vérifié ».')}</p>
            : item.calculated.length ? <AllergenBadges list={item.calculated} /> : <p className="text-sm text-muted">{t('Aucun allergène trouvé dans la recette.')}</p>}
        </div>
        <div>
          <p className="mb-1.5 text-sm font-bold">{t('Ajouter à la main')}</p>
          <AllergenChips value={add} onChange={setAdd} />
        </div>
        <div>
          <p className="mb-1.5 text-sm font-bold">{t('Retirer (si le calcul est faux)')}</p>
          <AllergenChips value={remove} onChange={setRemove} tone="warn" />
        </div>
        <Toggle checked={confirmed} onChange={setConfirmed} label={t('Vérifié : j’ai contrôlé les allergènes de ce produit moi-même')} />
      </div>
    </Modal>
  );
}
