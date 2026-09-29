import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { formatMoney, tr, type PublicItem } from '@resto/shared';
import { Sheet } from './Sheet';
import { Stepper } from './Stepper';
import { TagPills } from './ItemRow';
import type { Strings } from '../lib/strings';

export function ItemSheet({ item, lang, fallbacks, currency, t, canOrder, onClose, onAdd }: {
  item: PublicItem | null;
  lang: string;
  fallbacks: string[];
  currency: string;
  t: Strings;
  canOrder: boolean;
  onClose: () => void;
  onAdd: (variantId: string | null, qty: number, note: string) => void;
}) {
  const [variantId, setVariantId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setVariantId(item?.variants[0]?.id ?? null);
    setQty(1);
    setNote('');
    setImgFailed(false);
  }, [item]);

  if (!item) return null;
  const variant = item.variants.find(v => v.id === variantId);
  const unit = Number(variant ? variant.price_cents : item.price_cents);
  const desc = tr(item.description, lang, fallbacks);
  const hasPhoto = !!item.image_url && !imgFailed;

  return (
    <Sheet
      open
      onClose={onClose}
      closeLabel={t.close}
      media={hasPhoto ? (
        <div className="relative aspect-[4/3] bg-surface-2">
          <img src={item.image_url!} alt="" onError={() => setImgFailed(true)} className="size-full object-cover animate-fade" />
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface to-transparent" aria-hidden />
        </div>
      ) : undefined}
      title={
        <div>
          <h2 className="font-display text-[1.7rem] font-semibold leading-tight">{tr(item.name, lang, fallbacks)}</h2>
          {!item.variants.length && (
            <p className="mt-1 text-lg font-bold text-brand tabular-nums">{formatMoney(unit, currency, lang)}</p>
          )}
        </div>
      }
      footer={canOrder && item.available ? (
        <div className="flex items-center gap-3">
          <Stepper value={qty} onChange={setQty} />
          <button
            type="button"
            onClick={() => onAdd(variant?.id ?? null, qty, note)}
            className="flex-1 h-13 rounded-full bg-brand text-brand-ink font-semibold flex items-center justify-between px-5 glow-brand press"
          >
            <span>{t.addToCart}</span>
            <span className="tabular-nums">{formatMoney(unit * qty, currency, lang)}</span>
          </button>
        </div>
      ) : undefined}
    >
      {desc && <p className="text-muted leading-relaxed">{desc}</p>}
      <div className="mt-3"><TagPills tags={item.tags} t={t} /></div>

      {item.variants.length > 0 && (
        <fieldset className="mt-6">
          <legend className="text-xs font-bold uppercase tracking-[0.15em] text-muted mb-3">{t.choose}</legend>
          <div className="space-y-2">
            {item.variants.map(v => {
              const on = v.id === variantId;
              return (
                <label
                  key={v.id}
                  className={`flex items-center gap-3 rounded-2xl border px-4 py-3.5 cursor-pointer transition-all ${
                    on ? 'border-brand bg-brand/8 ring-1 ring-brand' : 'border-line hover:border-brand/40'}`}
                >
                  <span className="relative grid place-items-center size-5 shrink-0">
                    <input type="radio" name="variant" checked={on} onChange={() => setVariantId(v.id)}
                      className="appearance-none size-5 rounded-full border-2 border-line checked:border-brand checked:bg-brand transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-brand/40" />
                    {on && <Check className="absolute size-3 text-brand-ink pointer-events-none" strokeWidth={3.5} aria-hidden />}
                  </span>
                  <span className="flex-1 font-medium">{tr(v.name, lang, fallbacks)}</span>
                  <span className="font-semibold tabular-nums">{formatMoney(Number(v.price_cents), currency, lang)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {canOrder && item.available && (
        <label className="block mt-5">
          <span className="sr-only">{t.itemNote}</span>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value.slice(0, 200))}
            rows={2}
            placeholder={t.itemNote}
            className="w-full resize-none rounded-2xl border border-line bg-surface-2/60 px-4 py-3 text-sm placeholder:text-muted outline-none focus:border-brand transition-colors"
          />
        </label>
      )}
    </Sheet>
  );
}
