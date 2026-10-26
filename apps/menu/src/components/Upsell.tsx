import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { formatMoney, promoPrice, tr, type PublicItem, type PublicMenu } from '@resto/shared';
import type { Cart } from '../lib/cart';
import type { Strings } from '../lib/strings';
import { Photo } from './ItemRow';

type Kind = 'drink' | 'dessert' | 'side';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Recognised from the category names (any language the restaurant filled in). A category that
// matches nothing is simply never suggested from: no guessing, so no odd suggestions.
const KEYS: Record<Kind, RegExp> = {
  drink: /boisson|\bjus\b|\bcafe\b|\bthe\b|infusion|soda|\beau\b|drink|juice|coffee|\btea\b|beverage|smoothie|milkshake|cocktail|mojito|limonade|lemonade|bebida|zumo|مشروب|عصير|قهوة|شاي/,
  dessert: /dessert|glace|gateau|patisserie|sweet|cake|ice cream|tiramisu|brownie|postre|حلويات|حلو/,
  side: /accompagnement|\bside|frites|supplement|extra|guarnicion|إضافات|اضافات/,
};
const ORDER: Kind[] = ['drink', 'dessert', 'side'];

const kindOfCategory = (names: string[]): Kind | null => {
  const text = fold(names.join(' | '));
  return ORDER.find(k => KEYS[k].test(text)) ?? null;
};

/** one tap, no choices to make: no sizes, no options */
const simple = (i: PublicItem) => i.available && !i.sold_by_weight && !i.variants.length && !i.modifier_groups?.length;

export function pickSuggestions(menu: PublicMenu, cart: Cart, max = 5): PublicItem[] {
  const kindOf = new Map<string, Kind | null>(menu.categories.map(c => [c.id, kindOfCategory(Object.values(c.name ?? {}))]));
  const inCart = new Set(cart.lines.map(l => l.item_id));
  const cartKinds = new Set<Kind | 'main'>();
  for (const id of inCart) {
    const it = cart.itemsById.get(id);
    if (it) cartKinds.add(kindOf.get(it.category_id) ?? 'main');
  }
  const hasMain = cartKinds.has('main');
  // what is missing from this order: a drink, a dessert, and (with a main dish) a side
  const wanted = ORDER.filter(k => !cartKinds.has(k) && (k !== 'side' || hasMain));

  const rank = (a: PublicItem, b: PublicItem) =>
    Number(b.tags.includes('popular')) - Number(a.tags.includes('popular'))
    || Number(!!b.image_url) - Number(!!a.image_url)
    || Number(a.price_cents) - Number(b.price_cents);

  const perKind = wanted.map(k => menu.items
    .filter(i => kindOf.get(i.category_id) === k && simple(i) && !inCart.has(i.id))
    .sort(rank).slice(0, 3));

  // take them in turn (drink, dessert, side, drink...) so the row stays varied
  const out: PublicItem[] = [];
  for (let n = 0; out.length < max && n < 3; n++) {
    for (const list of perKind) if (list[n] && out.length < max) out.push(list[n]);
  }
  return out;
}

export function Upsell({ menu, cart, lang, fallbacks, currency, t, onAdd }: {
  menu: PublicMenu;
  cart: Cart;
  lang: string;
  fallbacks: string[];
  currency: string;
  t: Strings;
  onAdd: (item: PublicItem) => void;
}) {
  const picks = useMemo(() => pickSuggestions(menu, cart), [menu, cart.lines]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!picks.length) return null;
  return (
    <section className="mt-5" aria-label={t.upsellTitle}>
      <p className="mb-2.5 text-sm font-semibold">{t.upsellTitle}</p>
      <ul className="-mx-6 flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory px-6 pb-1 scroll-px-6">
        {picks.map(it => {
          const name = tr(it.name, lang, fallbacks);
          return (
            <li key={it.id} className="relative w-36 shrink-0 snap-start rounded-2xl border border-line bg-surface p-2">
              {it.image_url && (
                <div className="relative aspect-square overflow-hidden rounded-xl bg-surface-2">
                  <Photo src={it.image_url} className="absolute inset-0 size-full object-cover" />
                </div>
              )}
              <p className={`line-clamp-2 text-[13px] font-medium leading-snug ${it.image_url ? 'mt-2' : 'pe-10 pt-1'}`}>{name}</p>
              <p className="mt-1 text-sm font-bold tabular-nums text-brand">{formatMoney(promoPrice(Number(it.price_cents), it.promo_bp), currency, lang)}</p>
              <button type="button" onClick={() => onAdd(it)} aria-label={`${t.add}: ${name}`}
                className="absolute bottom-2 end-2 grid size-9 place-items-center rounded-full bg-brand text-brand-ink glow-brand transition active:scale-90">
                <Plus className="size-5" strokeWidth={2.5} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
