import { useEffect, useMemo, useState } from 'react';
import type { PublicItem, PublicMenu } from '@resto/shared';
import { load, save } from './storage';

export interface CartLine {
  key: string;
  item_id: string;
  variant_id: string | null;
  quantity: number;
  note: string;
}

const MAX_QTY = 20;
const lineKey = (itemId: string, variantId: string | null, note: string) =>
  `${itemId}|${variantId ?? ''}|${note.trim().toLowerCase()}`;

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
      if (it.variants.length > 0) return it.variants.some(v => v.id === l.variant_id);
      return l.variant_id === null;
    }));
  }, [menu]);

  const itemsById = useMemo(() => new Map((menu?.items ?? []).map(i => [i.id, i])), [menu]);

  const priceOf = (l: CartLine) => {
    const it = itemsById.get(l.item_id);
    if (!it) return 0;
    const v = it.variants.find(x => x.id === l.variant_id);
    return Number(v ? v.price_cents : it.price_cents);
  };

  const add = (item: PublicItem, variantId: string | null, quantity: number, note = '') => {
    const key = lineKey(item.id, variantId, note);
    setLines(ls => {
      const found = ls.find(l => l.key === key);
      if (found) return ls.map(l => (l.key === key ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + quantity) } : l));
      return [...ls, { key, item_id: item.id, variant_id: variantId, quantity: Math.min(MAX_QTY, quantity), note: note.trim() }];
    });
  };
  const setQty = (key: string, quantity: number) =>
    setLines(ls => (quantity <= 0 ? ls.filter(l => l.key !== key)
                                  : ls.map(l => (l.key === key ? { ...l, quantity: Math.min(MAX_QTY, quantity) } : l))));
  const removeItem = (itemId: string) => setLines(ls => ls.filter(l => l.item_id !== itemId));
  const clear = () => setLines([]);

  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const total = lines.reduce((s, l) => s + priceOf(l) * l.quantity, 0);
  const qtyOfItem = (itemId: string) => lines.filter(l => l.item_id === itemId).reduce((n, l) => n + l.quantity, 0);

  return { lines, add, setQty, removeItem, clear, count, total, priceOf, itemsById, qtyOfItem };
}
export type Cart = ReturnType<typeof useCart>;
