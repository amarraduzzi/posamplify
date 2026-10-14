// Fill in the prices (and unit, supplier) of many ingredients at once, like a spreadsheet:
// one line per ingredient, Enter jumps to the next price, one click saves every change.
import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Plus, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, fromCents } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Ingredient, Restaurant } from '../lib/types';
import { PURCHASE_UNITS } from '../lib/profit';
import { Btn, inputCls } from './ui';

interface Sup { id: string; name: string }
interface Edit { unit?: string; price?: string; supplierId?: string }
const PRICE_RE = /^\d+([.,]\d{1,2})?$/;

export function QuickPrices({ r, list, onDone, onClose }: { r: Restaurant; list: Ingredient[]; onDone: () => void; onClose: () => void }) {
  const a = useAdminCtx();
  const [sups, setSups] = useState<Sup[]>([]);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [q, setQ] = useState('');
  const missingAtStart = useMemo(() => list.filter(g => g.purchase_price_cents == null).length, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [onlyMissing, setOnlyMissing] = useState(missingAtStart > 0);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');

  const loadSups = async () => {
    try { setSups(check(await supabase.from('suppliers').select('id, name').eq('restaurant_id', r.id).eq('active', true).order('name')) as Sup[]); } catch { /* no access: no supplier column */ }
  };
  useEffect(() => { loadSups(); }, [r.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const val = (g: Ingredient) => {
    const e = edits[g.id] ?? {};
    return { unit: e.unit ?? g.purchase_unit, price: e.price ?? fromCents(g.purchase_price_cents), supplierId: e.supplierId ?? g.supplier_id ?? '' };
  };
  const set = (id: string, p: Edit) => setEdits(s => ({ ...s, [id]: { ...s[id], ...p } }));
  const bad = (g: Ingredient) => { const p = val(g).price.trim(); return p !== '' && !PRICE_RE.test(p); };

  // what really changed against the saved ingredient
  const changed = (g: Ingredient) => {
    const v = val(g);
    return v.unit !== g.purchase_unit || v.price.trim() !== fromCents(g.purchase_price_cents) || v.supplierId !== (g.supplier_id ?? '');
  };
  const dirty = list.filter(changed);
  const invalid = dirty.filter(bad).length;

  const shown = useMemo(() => {
    const f = q.trim().toLowerCase();
    return list.filter(g => (!f || g.name.toLowerCase().includes(f)) && (!onlyMissing || g.purchase_price_cents == null || changed(g)));
  }, [list, q, onlyMissing, edits]); // eslint-disable-line react-hooks/exhaustive-deps

  const applySupplier = (id: string) => { if (!id) return; setEdits(s => { const n = { ...s }; for (const g of shown) n[g.id] = { ...n[g.id], supplierId: id === '-' ? '' : id }; return n; }); };

  const addSupplier = async () => {
    const name = newName.trim().slice(0, 80);
    if (!name) return;
    try {
      const same = sups.find(x => x.name.trim().toLowerCase() === name.toLowerCase());
      if (!same) check(await supabase.from('suppliers').insert({ restaurant_id: r.id, name }).select('id'));
      setNewName(''); await loadSups(); a.toast(t('Fournisseur ajouté'));
    } catch (e) { a.fail(e); }
  };

  const save = async () => {
    setBusy(true);
    let done = 0;
    try {
      for (let i = 0; i < dirty.length; i += 10) {
        await Promise.all(dirty.slice(i, i + 10).map(async g => {
          const v = val(g), p = v.price.trim();
          const priceChanged = p !== fromCents(g.purchase_price_cents);
          const row: Record<string, unknown> = { supplier_id: v.supplierId || null, supplier: sups.find(x => x.id === v.supplierId)?.name ?? null };
          if (v.unit !== g.purchase_unit) {
            // a standard unit knows its size; the unit the ingredient already had keeps its own
            const fixed = PURCHASE_UNITS[g.base_unit].find(x => x.u === v.unit)?.f;
            row.purchase_unit = v.unit; row.purchase_qty = fixed ?? g.purchase_qty;
          }
          if (priceChanged) { row.purchase_price_cents = p === '' ? null : Math.round(Number(p.replace(',', '.')) * 100); if (p !== '') row.price_estimated = false; }
          check(await supabase.from('ingredients').update(row).eq('id', g.id).select('id'));
          done++;
        }));
      }
      a.toast(t('{n} ingrédient(s) mis à jour', { n: done }));
      setEdits({}); onDone();
    } catch (e) { a.fail(e); if (done) { setEdits({}); onDone(); } }
    setBusy(false);
  };

  const unitOptions = (g: Ingredient) => {
    const std = PURCHASE_UNITS[g.base_unit].filter(x => x.f != null).map(x => x.u);
    return std.includes(g.purchase_unit) ? std : [g.purchase_unit, ...std];
  };
  const focusNext = (i: number) => (document.querySelector(`[data-qp="${i + 1}"]`) as HTMLInputElement | null)?.focus();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-56">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className={`${inputCls} ps-9`} placeholder={t('Chercher')} value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} /> {t('Seulement sans prix')}</label>
        <span className="text-sm text-muted">{t('{n} ligne(s)', { n: shown.length })}</span>
        <div className="ms-auto flex gap-2">
          <Btn tone="ghost" onClick={onClose}>{t('Retour à la liste')}</Btn>
          <Btn tone="brand" disabled={busy || !dirty.length || invalid > 0} onClick={save}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {dirty.length ? t('Enregistrer {n} modification(s)', { n: dirty.length }) : t('Aucune modification')}</Btn>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2 p-3 text-sm">
        <span className="font-semibold">{t('Fournisseur pour les lignes affichées')}</span>
        <select className={`${inputCls} !w-52 !py-1.5`} value="" onChange={e => applySupplier(e.target.value)}>
          <option value="">{t('Choisir…')}</option>
          <option value="-">{t('Sans fournisseur (marché, souk…)')}</option>
          {sups.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <span className="ms-auto flex items-center gap-2">
          <input className={`${inputCls} !w-44 !py-1.5`} maxLength={80} value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addSupplier(); }} placeholder={t('Nom du fournisseur')} />
          <Btn className="px-3 py-1.5" disabled={!newName.trim()} onClick={addSupplier}><Plus className="h-4 w-4" /> {t('Nouveau fournisseur')}</Btn>
        </span>
      </div>

      {!shown.length ? (
        <div className="card rounded-3xl p-8 text-center text-muted">{onlyMissing && !q ? t('Tous les prix sont remplis.') : t('Aucun résultat.')}</div>
      ) : (
        <div className="card overflow-x-auto rounded-3xl">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3 text-start">{t('Ingrédient')}</th>
                <th className="px-2 py-3 text-start">{t('Unité d’achat')}</th>
                <th className="px-2 py-3 text-start">{t('Prix d’achat (DH)')}</th>
                <th className="px-2 py-3 text-start">{t('Fournisseur')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/10">
              {shown.map((g, i) => {
                const v = val(g), e = bad(g), c = changed(g);
                return (
                  <tr key={g.id} className={c ? 'bg-brand/5' : ''}>
                    <td className="px-4 py-1.5 font-semibold">{g.name}</td>
                    <td className="px-2 py-1.5">
                      <select className={`${inputCls} !py-1.5`} value={v.unit} onChange={ev => set(g.id, { unit: ev.target.value })}>
                        {unitOptions(g).map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input data-qp={i} className={`${inputCls} !w-28 !py-1.5 text-end tabular ${e ? '!border-danger' : ''}`} inputMode="decimal" value={v.price} placeholder="—"
                        aria-invalid={e} onChange={ev => set(g.id, { price: ev.target.value })} onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); focusNext(i); } }} />
                      {e && <span className="ms-2 text-xs text-danger">{t('Prix invalide')}</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      <select className={`${inputCls} !py-1.5`} value={v.supplierId} onChange={ev => set(g.id, { supplierId: ev.target.value })}>
                        <option value="">—</option>
                        {sups.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
