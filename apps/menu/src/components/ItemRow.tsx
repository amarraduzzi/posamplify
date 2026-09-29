import { Plus, Flame, Sparkles, Star, Leaf } from 'lucide-react';
import { formatMoney, tr, type PublicItem } from '@resto/shared';
import type { Strings } from '../lib/strings';

const TAG_ICON: Record<string, typeof Flame> = { spicy: Flame, new: Sparkles, popular: Star, vegetarian: Leaf };

export function TagPills({ tags, t }: { tags: string[]; t: Strings }) {
  const known = tags.filter(x => t.tags[x]);
  if (!known.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {known.map(tag => {
        const Icon = TAG_ICON[tag];
        return (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
            {Icon && <Icon className="size-3" />}{t.tags[tag]}
          </span>
        );
      })}
    </div>
  );
}

export function ItemRow({ item, lang, fallbacks, currency, t, qty, canOrder, onOpen, onQuickAdd }: {
  item: PublicItem;
  lang: string;
  fallbacks: string[];
  currency: string;
  t: Strings;
  qty: number;
  canOrder: boolean;
  onOpen: () => void;
  onQuickAdd: () => void;
}) {
  const name = tr(item.name, lang, fallbacks);
  const desc = tr(item.description, lang, fallbacks);
  const soldOut = !item.available;
  const minPrice = item.variants.length
    ? Math.min(...item.variants.map(v => Number(v.price_cents)))
    : Number(item.price_cents);
  const priceLabel = formatMoney(minPrice, currency, lang);

  return (
    <li className={soldOut ? 'opacity-55' : ''}>
      <div className="flex gap-4 py-4">
        <button
          type="button"
          onClick={onOpen}
          disabled={soldOut}
          className="flex-1 min-w-0 text-start disabled:cursor-default"
        >
          <div className="flex items-start gap-2">
            {qty > 0 && (
              <span className="mt-0.5 shrink-0 grid place-items-center min-w-5 h-5 px-1 rounded-md bg-brand text-brand-ink text-xs font-bold tabular-nums">
                {qty}
              </span>
            )}
            <h3 className="font-semibold leading-snug">{name}</h3>
          </div>
          {desc && <p className="mt-1 text-sm text-muted leading-relaxed line-clamp-2">{desc}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="font-semibold tabular-nums">
              {item.variants.length > 1 && <span className="text-muted font-normal text-sm me-1">{lang === 'en' ? 'from' : lang === 'ar' ? 'من' : 'dès'}</span>}
              {priceLabel}
            </span>
            {soldOut
              ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{t.soldOut}</span>
              : <TagPills tags={item.tags} t={t} />}
          </div>
        </button>

        {item.image_url ? (
          <div className="relative shrink-0 self-start">
            <button type="button" onClick={onOpen} disabled={soldOut} className="block" tabIndex={-1} aria-hidden>
              <img
                src={item.image_url}
                alt=""
                loading="lazy"
                decoding="async"
                className="size-24 rounded-2xl object-cover bg-surface-2"
                onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
              />
            </button>
            {canOrder && !soldOut && (
              <AddButton label={`${t.add}: ${name}`} onClick={item.variants.length ? onOpen : onQuickAdd}
                className="absolute -bottom-2 end-[-6px] ring-4 ring-bg" />
            )}
          </div>
        ) : canOrder && !soldOut ? (
          <AddButton label={`${t.add}: ${name}`} onClick={item.variants.length ? onOpen : onQuickAdd}
            className="shrink-0 self-center" />
        ) : null}
      </div>
    </li>
  );
}

function AddButton({ label, onClick, className = '' }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`grid place-items-center size-10 rounded-full bg-brand text-brand-ink shadow-lg active:scale-90 transition ${className}`}
    >
      <Plus className="size-5" strokeWidth={2.5} />
    </button>
  );
}
