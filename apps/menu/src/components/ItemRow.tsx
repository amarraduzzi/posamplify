import { useState } from 'react';
import { Plus, Flame, Sparkles, Star, Leaf } from 'lucide-react';
import { formatMoney, tr, type PublicItem } from '@resto/shared';
import type { Strings } from '../lib/strings';

const TAG_ICON: Record<string, typeof Flame> = { spicy: Flame, new: Sparkles, popular: Star, vegetarian: Leaf };
const TAG_TONE: Record<string, string> = {
  spicy: 'text-[#E4572E] bg-[#E4572E]/10',
  new: 'text-brand bg-brand/12',
  popular: 'text-brand bg-brand/12',
  vegetarian: 'text-[#3F9B5B] bg-[#3F9B5B]/12',
};

export function TagPills({ tags, t }: { tags: string[]; t: Strings }) {
  const known = tags.filter(x => t.tags[x]);
  if (!known.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {known.map(tag => {
        const Icon = TAG_ICON[tag];
        return (
          <span key={tag} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TAG_TONE[tag] ?? 'bg-surface-2 text-muted'}`}>
            {Icon && <Icon className="size-3" />}{t.tags[tag]}
          </span>
        );
      })}
    </div>
  );
}

const minPrice = (item: PublicItem) => item.variants.length
  ? Math.min(...item.variants.map(v => Number(v.price_cents)))
  : Number(item.price_cents);

/** Image that fades in when loaded and disappears when broken. */
export function Photo({ src, className }: { src: string; className: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading');
  if (state === 'failed') return null;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onLoad={() => setState('ok')}
      onError={() => setState('failed')}
      className={`${className} transition-opacity duration-500 ${state === 'ok' ? 'opacity-100' : 'opacity-0'}`}
    />
  );
}

export function ItemRow({ item, index, lang, fallbacks, currency, t, qty, canOrder, onOpen, onQuickAdd }: {
  item: PublicItem;
  index: number;
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
  const priceLabel = formatMoney(minPrice(item), currency, lang);
  const add = item.variants.length || item.modifier_groups?.length ? onOpen : onQuickAdd;

  return (
    <li className="animate-rise" style={{ ['--i' as string]: Math.min(index, 8) }}>
      <div className={`relative flex gap-4 rounded-3xl card p-3.5 transition-shadow ${soldOut ? 'opacity-55' : ''} ${qty > 0 ? 'ring-1 ring-brand/50' : ''}`}>
        <button
          type="button"
          onClick={onOpen}
          disabled={soldOut}
          className="flex-1 min-w-0 text-start disabled:cursor-default ps-1 py-0.5 flex flex-col"
        >
          <div className="flex items-start gap-2">
            {qty > 0 && (
              <span className="mt-0.5 shrink-0 grid place-items-center min-w-5 h-5 px-1 rounded-full bg-brand text-brand-ink text-[11px] font-bold tabular-nums animate-pop">
                {qty}
              </span>
            )}
            <h3 className="font-semibold text-[15.5px] leading-snug">{name}</h3>
          </div>
          {desc && <p className="mt-1 text-[13.5px] text-muted leading-relaxed line-clamp-2">{desc}</p>}
          <div className="mt-auto pt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="font-bold text-brand tabular-nums">
              {item.variants.length > 1 && <span className="text-muted font-medium text-xs me-1">{t.from}</span>}
              {priceLabel}
            </span>
            {soldOut
              ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted">{t.soldOut}</span>
              : <TagPills tags={item.tags} t={t} />}
          </div>
        </button>

        {item.image_url ? (
          <div className="relative shrink-0 self-start">
            <button type="button" onClick={onOpen} disabled={soldOut} className="relative block size-28 rounded-2xl overflow-hidden bg-surface-2" tabIndex={-1} aria-hidden>
              <span className="absolute inset-0 zellige opacity-15" />
              <Photo src={item.image_url} className="relative size-full object-cover" />
            </button>
            {canOrder && !soldOut && (
              <AddButton label={`${t.add}: ${name}`} onClick={add} className="absolute -bottom-2 -end-2 ring-4 ring-surface" />
            )}
          </div>
        ) : canOrder && !soldOut ? (
          <AddButton label={`${t.add}: ${name}`} onClick={add} className="shrink-0 self-center" />
        ) : null}
      </div>
    </li>
  );
}

/** Large photo card for the "signature dishes" carousel. */
export function FeaturedCard({ item, index, lang, fallbacks, currency, t, qty, canOrder, onOpen, onQuickAdd }: {
  item: PublicItem;
  index: number;
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
  return (
    <div className="relative shrink-0 w-[46vw] max-w-52 snap-start animate-rise" style={{ ['--i' as string]: index + 2 }}>
      <button type="button" onClick={onOpen}
        className="relative block w-full aspect-[4/5] rounded-3xl overflow-hidden bg-surface-2 text-start press"
        style={{ boxShadow: 'var(--shadow)' }}>
        <span className="absolute inset-0 zellige opacity-15" aria-hidden />
        {item.image_url && <Photo src={item.image_url} className="absolute inset-0 size-full object-cover" />}
        <span className="absolute inset-0 photo-shade" aria-hidden />
        {qty > 0 && (
          <span className="absolute top-2.5 start-2.5 grid place-items-center min-w-6 h-6 px-1.5 rounded-full bg-brand text-brand-ink text-xs font-bold tabular-nums">
            {qty}
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 p-3.5 pe-12 text-white">
          <span className="block font-display text-[17px] font-semibold leading-tight line-clamp-2">{name}</span>
          <span className="mt-1 block text-sm font-semibold tabular-nums text-white/85">
            {item.variants.length > 1 && <span className="text-xs font-medium me-1 text-white/70">{t.from}</span>}
            {formatMoney(minPrice(item), currency, lang)}
          </span>
        </span>
      </button>
      {canOrder && (
        <AddButton label={`${t.add}: ${name}`} onClick={item.variants.length || item.modifier_groups?.length ? onOpen : onQuickAdd}
          className="absolute bottom-3 end-3 !size-9" />
      )}
    </div>
  );
}

function AddButton({ label, onClick, className = '' }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`grid place-items-center size-10 rounded-full bg-brand text-brand-ink glow-brand active:scale-90 transition ${className}`}
    >
      <Plus className="size-5" strokeWidth={2.5} />
    </button>
  );
}
