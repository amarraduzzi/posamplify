// Create / edit an ingredient the way an owner thinks: "je l'achète par caisse
// de 18 kg à 90 DH, avec 10 % de perte". Used on the Ingredients page and
// inline from a recipe card.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { check, fromCents, mad, toCents } from '../lib/api';
import { t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { BaseUnit, Ingredient, Restaurant } from '../lib/types';
import { BASE_LABEL, CATEGORIES, PURCHASE_UNITS, SIZE_UNIT, unitCost } from '../lib/profit';
import { Btn, Field, Modal, Toggle, inputCls } from './ui';
import { AllergenSection } from './AllergenSection';

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
  // the supplier is a real supplier (same list as Stock > Fournisseurs); '__new__' = create one here
  const [sups, setSups] = useState<{ id: string; name: string }[]>([]);
  const [supplierId, setSupplierId] = useState(ing?.supplier_id ?? '');
  const [newSupplier, setNewSupplier] = useState('');
  // every supplier of this product with the agreed price (the usual one is the field above)
  const [links, setLinks] = useState<{ supplier_id: string; is_main: boolean; price_cents: number | null; ref: string | null }[]>([]);
  useEffect(() => {
    if (!ing) return;
    supabase.from('supplier_products').select('supplier_id, is_main, price_cents, ref').eq('ingredient_id', ing.id)
      .then(({ data }) => setLinks((data ?? []) as typeof links));
  }, [ing]);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const list = check(await supabase.from('suppliers').select('id, name').eq('restaurant_id', r.id).eq('active', true).order('name')) as { id: string; name: string }[];
        if (!live) return;
        setSups(list);
        // an ingredient saved with a typed supplier name: link it to the real one, or offer to create it
        const old = (ing?.supplier ?? '').trim();
        if (ing && !ing.supplier_id && old) {
          const hit = list.find(x => x.name.trim().toLowerCase() === old.toLowerCase());
          if (hit) setSupplierId(hit.id); else { setSupplierId('__new__'); setNewSupplier(old); }
        }
      } catch { /* no access to suppliers: the field stays empty */ }
    })();
    return () => { live = false; };
  }, [r.id, ing]);
  const [track, setTrack] = useState(ing?.track_expiry ?? false);
  const [etype, setEtype] = useState<'dlc' | 'ddm'>(ing?.expiry_type ?? 'dlc');
  const [shelf, setShelf] = useState(ing?.shelf_life_days != null ? String(ing.shelf_life_days) : '');
  const [warnDays, setWarnDays] = useState(String(ing?.expiry_warn_days ?? 2));
  // allergens: null = not filled in yet, [] = checked, none
  const [alg, setAlg] = useState<string[] | null>(ing ? ing.allergens ?? null : null);
  const [traces, setTraces] = useState<string[]>(ing?.may_contain ?? []);
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
    if (supplierId === '__new__' && !newSupplier.trim()) { a.toast(t('Indiquez le nom du fournisseur.'), 'error'); return; }
    const shelfN = shelf.trim() ? Math.round(Number(shelf.replace(',', '.'))) : null;
    const warnN = Math.round(Number(warnDays.replace(',', '.')));
    if (track && shelfN != null && !(shelfN >= 1 && shelfN <= 3650)) { a.toast(t('La durée doit être entre 1 et 3650 jours.'), 'error'); return; }
    if (track && !(warnN >= 0 && warnN <= 60)) { a.toast(t('Le délai d’alerte doit être entre 0 et 60 jours.'), 'error'); return; }
    setBusy(true);
    const row = {
      name: name.trim(), name_ar: nameAr.trim() || null, category, base_unit: base, purchase_unit: unit,
      purchase_qty: qty, purchase_price_cents: priceCents, waste_bp: wasteBp,
      ...(ing?.is_preparation ? {} : { allergens: alg, may_contain: traces, track_expiry: track, expiry_type: etype, shelf_life_days: track ? shelfN : null, expiry_warn_days: track ? warnN : 2 }),
    } as Record<string, unknown>;
    try {
      let sid: string | null = supplierId && supplierId !== '__new__' ? supplierId : null;
      let sname: string | null = sid ? sups.find(x => x.id === sid)?.name ?? null : null;
      if (supplierId === '__new__') {
        const nm = newSupplier.trim().slice(0, 80);
        const same = sups.find(x => x.name.trim().toLowerCase() === nm.toLowerCase());
        if (same) { sid = same.id; sname = same.name; }
        else {
          const made = check(await supabase.from('suppliers').insert({ restaurant_id: r.id, name: nm }).select('id, name').single()) as unknown as { id: string; name: string };
          sid = made.id; sname = made.name;
        }
      }
      row.supplier_id = sid; row.supplier = sname;
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
            {Object.entries(CATEGORIES).filter(([k]) => k !== 'preparation' || category === 'preparation').map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
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
            <Field label={t('Fournisseur (facultatif)')}>
              <select className={inputCls} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">{t('Sans fournisseur (marché, souk…)')}</option>
                {sups.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                <option value="__new__">{t('+ Nouveau fournisseur')}</option>
              </select>
              {supplierId === '__new__' && <input autoFocus className={`${inputCls} mt-2`} maxLength={80} value={newSupplier} onChange={e => setNewSupplier(e.target.value)} placeholder={t('Nom du fournisseur')} />}
              {links.length > 1 && (
                <span className="mt-2 block space-y-0.5 text-xs text-muted">
                  {links.map(l => (
                    <span key={l.supplier_id} className={`block ${l.is_main ? 'font-semibold text-ink' : ''}`}>
                      {sups.find(x => x.id === l.supplier_id)?.name ?? '?'}{l.ref ? ` (${l.ref})` : ''}{l.price_cents != null ? ` · ${mad(Number(l.price_cents))}` : ''}{l.is_main ? ` · ${t('habituel')}` : ''}
                    </span>
                  ))}
                </span>
              )}
            </Field>
          </div>
          {perUse != null && (
            <p className="mt-3 text-sm">
              {t('Coût réel')}: <b className="tabular">{mad(Math.round(perUse * SIZE_UNIT[base].f))}</b> {base === 'pc' ? t('par pièce') : base === 'g' ? t('par kg utilisable') : t('par litre')}
            </p>
          )}
          {ing?.price_estimated && <p className="mt-2 text-xs font-semibold text-warn">{t('Prix estimé par l’IA : en enregistrant votre vrai prix, il devient confirmé.')}</p>}
        </div>
        {!ing?.is_preparation && <AllergenSection value={alg} onChange={setAlg} traces={traces} onTraces={setTraces} />}
        {!ing?.is_preparation && (
          <div className="rounded-2xl bg-surface-2 p-4">
            <p className="mb-3 text-sm font-bold">{t('Durée de conservation')}</p>
            <Toggle checked={track} onChange={setTrack} label={t('Suivre les dates de péremption')} />
            {track && (
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label={t('Type de date')}>
                  <select className={inputCls} value={etype} onChange={e => setEtype(e.target.value as 'dlc' | 'ddm')}>
                    <option value="dlc">{t('DLC : à consommer jusqu’au')}</option>
                    <option value="ddm">{t('DDM : à consommer de préférence avant')}</option>
                  </select>
                </Field>
                <Field label={t('Durée de conservation (jours)')} hint={t('Utilisée quand vous n’indiquez pas de date à la livraison. La date est alors marquée « estimée ».')}>
                  <input className={inputCls} inputMode="numeric" value={shelf} onChange={e => setShelf(e.target.value)} placeholder="5" />
                </Field>
                <Field label={t('Prévenir (jours avant)')}>
                  <input className={inputCls} inputMode="numeric" value={warnDays} onChange={e => setWarnDays(e.target.value)} />
                </Field>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
