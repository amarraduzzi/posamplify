// Choosing an ingredient from the list: click the field and every ingredient shows (by category,
// house preparations first), typing filters it (accents and capitals ignored), arrows and Enter work.
// The last line creates a new ingredient with the typed name.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Search } from 'lucide-react';
import { t } from '../lib/i18n';
import type { Ingredient } from '../lib/types';
import { CATEGORIES } from '../lib/profit';
import { norm } from '../lib/menuImport';
import { inputCls } from './ui';

export function IngredientPicker({ ings, used = [], onPick, onCreate }: {
  ings: Ingredient[]; used?: string[]; onPick: (g: Ingredient) => void; onCreate?: (name: string) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  // close when clicking elsewhere
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);

  const shown = useMemo(() => {
    const f = norm(q);
    const rank = (g: Ingredient) => (g.is_preparation ? 0 : 1);
    return ings
      .filter(g => g.active !== false && (!f || norm(g.name).includes(f) || norm(g.name_ar ?? '').includes(f)))
      .sort((a, b) => rank(a) - rank(b) || (CATEGORIES[a.category] ?? a.category).localeCompare(CATEGORIES[b.category] ?? b.category, 'fr')
        || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base', numeric: true }));
  }, [ings, q]);
  const canCreate = !!onCreate && q.trim().length > 0 && !ings.some(g => norm(g.name) === norm(q));
  const total = shown.length + (canCreate ? 1 : 0);
  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' }); }, [hi]);

  const choose = (i: number) => {
    if (i < shown.length) { onPick(shown[i]); setQ(''); setOpen(false); }
    else if (canCreate) { onCreate!(q.trim()); setQ(''); setOpen(false); }
  };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(total - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (open && total) choose(hi); else setOpen(true); }
    else if (e.key === 'Escape') { if (open) { e.stopPropagation(); setOpen(false); } }
  };

  let lastGroup = '';
  return (
    <div ref={box} className="flex-1">
      <div className="relative">
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input className={`${inputCls} pe-9 ps-9`} value={q} placeholder={t('Choisir un ingrédient ou chercher')} aria-label={t('Choisir un ingrédient')}
        role="combobox" aria-expanded={open} aria-autocomplete="list"
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={e => { setQ(e.target.value); setOpen(true); }} onKeyDown={key} />
      <button type="button" tabIndex={-1} aria-label={t('Afficher la liste')} onClick={() => setOpen(o => !o)} className="absolute end-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-surface-2">
        <ChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      </div>
      {open && (
        <ul ref={list} role="listbox" className="mt-2 max-h-72 overflow-y-auto rounded-2xl bg-surface p-1.5 shadow-lg ring-1 ring-line/15">
          {!shown.length && !canCreate && <li className="px-3 py-4 text-center text-sm text-muted">{t('Aucun ingrédient pour le moment.')}</li>}
          {shown.map((g, i) => {
            const group = g.is_preparation ? t('Préparations maison') : t(CATEGORIES[g.category] ?? 'Autre');
            const head = group !== lastGroup; lastGroup = group;
            const isUsed = used.includes(g.id);
            return (
              <li key={g.id}>
                {head && <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-muted">{group}</p>}
                <button type="button" data-i={i} role="option" aria-selected={hi === i} onMouseEnter={() => setHi(i)} onMouseDown={e => e.preventDefault()} onClick={() => choose(i)}
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-start text-sm ${hi === i ? 'bg-brand/10' : ''}`}>
                  <span className={`flex-1 ${isUsed ? 'text-muted' : 'font-semibold'}`}>{g.name}</span>
                  {isUsed && <Check className="h-4 w-4 text-ok" aria-label={t('déjà dans la recette')} />}
                  <span className="text-xs text-muted">{g.base_unit === 'pc' ? t('pièce') : g.base_unit === 'g' ? 'g' : 'ml'}</span>
                </button>
              </li>
            );
          })}
          {canCreate && (
            <li>
              <button type="button" data-i={shown.length} role="option" aria-selected={hi === shown.length} onMouseEnter={() => setHi(shown.length)} onMouseDown={e => e.preventDefault()} onClick={() => choose(shown.length)}
                className={`mt-1 flex w-full items-center gap-2 rounded-xl border-t border-line/10 px-3 py-2.5 text-start text-sm font-semibold text-brand ${hi === shown.length ? 'bg-brand/10' : ''}`}>
                <Plus className="h-4 w-4" /> {t('Créer « {n} »', { n: q.trim() })}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
