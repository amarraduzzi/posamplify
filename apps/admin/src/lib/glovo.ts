import type { Restaurant } from './types';
/** The Glovo price, as the database writes it on a Glovo order: the exact Glovo price when set, otherwise
 *  the restaurant price + the Glovo markup, rounded up to the whole dirham. */
export const glovoPrice = (r: Pick<Restaurant, 'glovo_markup_bp'>, base: number, exact?: number | null) => {
  const m = Number(r.glovo_markup_bp ?? 0);
  return exact != null ? Number(exact) : m > 0 ? Math.ceil(Number(base) * (10000 + m) / 1000000) * 100 : Number(base);
};
