// Amplify Profit helpers: units and costs as the owner thinks about them
// ("12 DH le kilo", "une caisse de 18 kg", "150 g par portion").
import type { BaseUnit, Ingredient } from './types';

// i18n:values
export const CATEGORIES: Record<string, string> = {
  legumes: 'Légumes', fruits: 'Fruits', viande: 'Viande', poisson: 'Poisson', laitier: 'Produits laitiers',
  epicerie: 'Épicerie', boissons: 'Boissons', boulangerie: 'Boulangerie', emballage: 'Emballage', autre: 'Autre',
};
export const BASE_LABEL: Record<BaseUnit, string> = { g: 'Au poids (g, kg)', ml: 'Au volume (ml, litre)', pc: 'À la pièce' };
// i18n:end

/** Units a recipe quantity can be typed in, with their size in base units. */
export const RECIPE_UNITS: Record<BaseUnit, { u: string; f: number }[]> = {
  g: [{ u: 'g', f: 1 }, { u: 'kg', f: 1000 }],
  ml: [{ u: 'ml', f: 1 }, { u: 'cl', f: 10 }, { u: 'l', f: 1000 }],
  pc: [{ u: 'pc', f: 1 }],
};
/** Usual purchase units; "fixed" ones know their size, the others ask for it (a crate = ? kg). */
export const PURCHASE_UNITS: Record<BaseUnit, { u: string; f?: number }[]> = {
  g: [{ u: 'kg', f: 1000 }, { u: 'caisse' }, { u: 'sac' }, { u: 'botte' }, { u: 'boîte' }, { u: 'paquet' }],
  ml: [{ u: 'litre', f: 1000 }, { u: 'bouteille' }, { u: 'bidon' }, { u: 'brique' }, { u: 'fût' }],
  pc: [{ u: 'pièce', f: 1 }, { u: 'douzaine', f: 12 }, { u: 'plateau (30)', f: 30 }, { u: 'carton' }, { u: 'paquet' }],
};
/** The unit in which the size of a non-standard purchase unit is typed. */
export const SIZE_UNIT: Record<BaseUnit, { u: string; f: number }> = { g: { u: 'kg', f: 1000 }, ml: { u: 'litre', f: 1000 }, pc: { u: 'pièces', f: 1 } };

/** Cost of one base unit, after waste, in centimes (can be fractional). null when the price is unknown. */
export function unitCost(g: Pick<Ingredient, 'purchase_price_cents' | 'purchase_qty' | 'waste_bp'>): number | null {
  if (g.purchase_price_cents == null) return null;
  return g.purchase_price_cents / (Number(g.purchase_qty) * (1 - g.waste_bp / 10000));
}

/** "150 g", "1,5 kg", "25 cl", "2 pc" : the most readable unit for a quantity in base units. */
export function fmtQty(qty: number, base: BaseUnit): string {
  const n = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');
  if (base === 'g') return qty >= 1000 ? `${n(qty / 1000)} kg` : `${n(qty)} g`;
  if (base === 'ml') return qty >= 1000 ? `${n(qty / 1000)} l` : qty >= 10 && qty % 10 === 0 ? `${n(qty / 10)} cl` : `${n(qty)} ml`;
  return `${n(qty)} pc`;
}

/** Food cost colour: within target, up to 5 points above, or clearly too high. */
export function fcTone(bp: number | null, target: number): 'ok' | 'warn' | 'bad' | 'none' {
  if (bp == null) return 'none';
  return bp <= target ? 'ok' : bp <= target + 500 ? 'warn' : 'bad';
}
export const pct = (bp: number | null | undefined) => (bp == null ? '—' : `${(bp / 100).toFixed(1).replace('.', ',')} %`);
