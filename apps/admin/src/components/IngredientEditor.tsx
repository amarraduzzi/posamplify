// Create / edit an ingredient the way an owner thinks: "je l'achète par caisse
// de 18 kg à 90 DH, avec 10 % de perte". Used on the Ingredients page and
// inline from a recipe card.
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { check, fromCents, mad, toCents } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { BaseUnit, Ingredient, Restaurant } from '../lib/types';
import { BASE_LABEL, CATEGORIES, PURCHASE_UNITS, SIZE_UNIT, unitCost } from '../lib/profit';
import { Btn, Field, Modal, inputCls } from './ui';

export function IngredientEditor({ r, ing, used = 0, initialName = '', onClose, onSaved }: {
  r: Restaurant; ing: Ingredient | null; used?: number; initialName?: string;
  onClose: () => void; onSaved: (g: Ingredient) => void;
}) {
  const a = useAdminCtx();
  const [name, setName] = useState(ing?.name ?? initialName);
  const [nameAr, setNameAr] = useState(ing?.name_ar ?? '');
  const [category, setCategory] = useState(ing?.category ?? 'autre');
  const [base, setBase] = useState<BaseUnit>(ing?.base_unit ?? 'g');
  const [unit, setUnit] = useState(ing?.purchase_unit ?? 'kg');
  const fixed = PURCHASE_UNITS[base].find(x => x.u === unit)?.f;
  const [size, setSize] = useState(() => ing && !PURCHASE_UNITS[ing.base_unit].find(x => x.u === ing.purchase_unit)?.f
    ? String(Number(ing.purchase_qty) / SIZE_UNIT[ing.base_unit].f).replace('.', ',') : '');
  const [price, setPrice] = useState(fromCents(ing?.purchase_price_cents));
  const [waste, setWaste] = useState(ing ? String(ing.waste_bp / 100).replace('.', ',') : '0');
  const [supplier, setSupplier] = useState(ing?.supplier ?? '');
  const [busy, setBusy] = useState(false);

  const qty = fixed ?? (Number(size.replace(',', '.')) || 0) * SIZE_UNIT[base].f;
  const wasteBp = Math.round((Number(waste.replace(',', '.')) || 0) * 100);
  const priceCents = price.trim() ? toCents(price) : null;
  const perUse = qty > 0 && wasteBp < 9000 ? unitCost({ purchase_price_cents: priceCents, purchase_qty: qty, waste_bp: wasteBp }) : null;

  const changeBase = (b: BaseUnit) => { setBase(b); setUnit(PURCHASE_UNITS[b][0].u); setSize(''); };
  const save = async () => {
    if (!name.trim()) { a.toast(t('Indiquez le nom.'), 'error'); return; }
    if (!(qty > 0)) { a.toast(t('Indiquez la taille de l’unité d’achat.'), 'error'); return; }
    if (wasteBp < 0 || wasteBp > 9000) { a.toast(t('La perte doit être entre 0 et 90 %.'), 'error'); return; }
    setBusy(true);
    const row = {
      name: name.trim(), name_ar: nameAr.trim() || null, category, base_unit: base, purchase_unit: unit,
      purchase_qty: qty, purchase_price_cents: priceCents, waste_bp: wasteBp, supplier: supplier.trim() || null,
    };
    try {
      const saved = ing
        ? check(await supabase.from('ingredients').update(row).eq('id', ing.id).select('*').single())
        : check(await supabase.from('ingredients').insert({ ...row, restaurant_id: r.id }).select('*').single());
      a.toast(t('Ingrédient enregistré'));
      onSaved(saved as unknown as Ingredient);
    } catch (e) { a.fail(e); }
    setBusy(false);
  };

  return (
    <Modal title={ing ? t('Modifier l’ingrédient') : t('Nouvel ingrédient')} onClose={onClose}
      footer={<div className="flex justify-end gap-3"><Btn tone="ghost" onClick={onClose}>{t('Annuler')}</Btn><Btn tone="brand" disabled={busy} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Nom')}><input autoFocus className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder={t('Tomates')} /></Field>
          <Field label={t('Nom en arabe')}><input className={inputCls} dir="rtl" value={nameAr} onChange={e => setNameAr(e.target.value)} placeholder="طماطم" /></Field>
        </div>
        <Field label={t('Catégorie')}>
          <select className={inputCls} value={category} onChange={e => setCategory(e.target.value)}>
            {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
        </Field>
        <Field group label={t('Dans vos recettes, vous le mesurez')} hint={used > 0 ? t('Utilisé dans {n} recette(s) : l’unité ne peut plus changer.', { n: used }) : undefined}>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(BASE_LABEL) as BaseUnit[]).map(b => (
              <button key={b} type="button" disabled={used > 0} onClick={() => changeBase(b)}
                className={`rounded-xl border px-2 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${base === b ? 'border-brand bg-brand/10 text-brand' : 'border-line/[0.12] hover:bg-surface-2'}`}>
                {t(BASE_LABEL[b])}
              </button>
            ))}
          </div>
        </Field>
        <div className="rounded-2xl bg-surface-2 p-4">
          <p className="mb-3 text-sm font-bold">{t('Achat')}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('Vous l’achetez par')}>
              <select className={inputCls} value={unit} onChange={e => { setUnit(e.target.value); setSize(''); }}>
                {PURCHASE_UNITS[base].map(x => <option key={x.u} value={x.u}>{x.u}</option>)}
                {!PURCHASE_UNITS[base].some(x => x.u === unit) && <option value={unit}>{unit}</option>}
              </select>
            </Field>
            {!fixed && (
              <Field label={t('1 {u} contient', { u: unit })}>
                <div className="flex items-center gap-2">
                  <input className={inputCls} inputMode="decimal" value={size} onChange={e => setSize(e.target.value)} placeholder="18" />
                  <span className="shrink-0 text-sm text-muted">{t(SIZE_UNIT[base].u)}</span>
                </div>
              </Field>
            )}
            <Field label={t('Prix d’achat (DH)')}>
              <input className={inputCls} inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="12" />
            </Field>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label={t('Perte (%)')} hint={t('Épluchures, os, parures : la partie jetée.')}>
              <input className={inputCls} inputMode="decimal" value={waste} onChange={e => setWaste(e.target.value)} />
            </Field>
            <Field label={t('Fournisseur (facultatif)')}><input className={inputCls} value={supplier} onChange={e => setSupplier(e.target.value)} /></Field>
          </div>
          {perUse != null && (
            <p className="mt-3 text-sm">
              {t('Coût réel')}: <b className="tabular">{mad(Math.round(perUse * SIZE_UNIT[base].f))}</b> {base === 'pc' ? t('par pièce') : base === 'g' ? t('par kg utilisable') : t('par litre')}
            </p>
          )}
          {ing?.price_estimated && <p className="mt-2 text-xs font-semibold text-warn">{t('Prix estimé par l’IA : en enregistrant votre vrai prix, il devient confirmé.')}</p>}
        </div>
      </div>
    </Modal>
  );
}
