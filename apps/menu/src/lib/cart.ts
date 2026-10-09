import { useEffect, useMemo, useState } from 'react';
import { promoPrice, type PublicItem, type PublicMenu } from '@resto/shared';
import { load, save } from './storage';

export interface CartLine {
  key: string;
  item_id: string;
  variant_id: string | null;
  /** chosen extras / menu options (ids) */
  modifiers?: string[];
  quantity: number;
  note: string;
}

const MAX_QTY = 20;
const lineKey = (itemId: string, variantId: string | null, note: string, mods: string[] = []) =>
  `${itemId}|${variantId ?? ''}|${[...mods].sort().join(',')}|${note.trim().toLowerCase()}`;
export const optionsOf = (it: PublicItem) => new Map((it.modifier_groups ?? []).flatMap(g => g.options.map(o => [o.id, o] as const)));

/** Cart kept per restaurant for 3 hours, so a refresh or a closed tab loses nothing. */
export function useCart(slug: string, menu: PublicMenu | null) {
  const storeKey = `cart:${slug}`;
  const [lines, setLines] = useState<CartLine[]>(() => load<CartLine[]>(storeKey, 3 * 3600_000) ?? []);

  useEffect(() => { save(storeKey, lines); }, [storeKey, lines]);

  // Drop lines whose item disappeared from the menu or sold out since.
  useEffect(() => {
    if (!menu) return;
    const byId = new Map(menu.items.map(i => [i.id, i]));
    setLines(ls => ls.filter(l => {
      const it = byId.get(l.item_id);
      if (!it || !it.available) return false;
      const opts = optionsOf(it);
      if ((l.modifiers ?? []).some(id => !opts.has(id))) return false;
      if (it.variants.length > 0) return it.variants.some(v => v.id === l.variant_id);
      return l.variant_id === null;
    }));
  }, [menu]);

  const itemsById = useMemo(() => new Map((menu?.items ?? []).map(i => [i.id, i])), [menu]);

  /** the dish (or size) price, less the takeaway reduction for a takeaway order (as the server does) */
  const baseOf = (it: PublicItem, l: CartLine, takeaway: boolean) => {
    const v = it.variants.find(x => x.id === l.variant_id);
    const base = Number(v ? v.price_cents : it.price_cents);
    return takeaway ? Math.max(0, base - Number(it.takeaway_off_cents ?? 0)) : base;
  };
  const priceOf = (l: CartLine, takeaway = false) => {
    const it = itemsById.get(l.item_id);
    if (!it) return 0;
    const opts = optionsOf(it);
    const extra = (l.modifiers ?? []).reduce((s, id) => s + Number(opts.get(id)?.price_cents ?? 0), 0);
    return promoPrice(baseOf(it, l, takeaway), it.promo_bp) + extra;
  };
  /** price without the happy hour, to show it struck through */
  const listPriceOf = (l: CartLine, takeaway = false) => {
    const it = itemsById.get(l.item_id);
    if (!it?.promo_bp) return priceOf(l, takeaway);
    const base = baseOf(it, l, takeaway);
    return priceOf(l, takeaway) - promoPrice(base, it.promo_bp) + base;
  };

  const add = (item: PublicItem, variantId: string | null, quantity: number, note = '', modifiers: string[] = []) => {
    const key = lineKey(item.id, variantId, note, modifiers);
    setLines(ls => {
      const found = ls.find(l => l.key === key);
      if (found) return ls.map(l => (l.key === key ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + quantity) } : l));
      return [...ls, { key, item_id: item.id, variant_id: variantId, modifiers, quantity: Math.min(MAX_QTY, quantity), note: note.trim() }];
    });
  };
  const setQty = (key: string, quantity: number) =>
    setLines(ls => (quantity <= 0 ? ls.filter(l => l.key !== key)
                                  : ls.map(l => (l.key === key ? { ...l, quantity: Math.min(MAX_QTY, quantity) } : l))));
  const removeItem = (itemId: string) => setLines(ls => ls.filter(l => l.item_id !== itemId));
  const clear = () => setLines([]);

  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const total = lines.reduce((s, l) => s + priceOf(l) * l.quantity, 0);
  const totalFor = (takeaway: boolean) => lines.reduce((s, l) => s + priceOf(l, takeaway) * l.quantity, 0);
  const qtyOfItem = (itemId: string) => lines.filter(l => l.item_id === itemId).reduce((n, l) => n + l.quantity, 0);

  return { lines, add, setQty, removeItem, clear, count, total, totalFor, priceOf, listPriceOf, itemsById, qtyOfItem };
}
export type Cart = ReturnType<typeof useCart>;
