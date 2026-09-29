import { useEffect, useState } from 'react';
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

  return (
    <Sheet
      open
      onClose={onClose}
      closeLabel={t.close}
      title={<h2 className="font-display text-xl font-bold leading-tight pt-1">{tr(item.name, lang, fallbacks)}</h2>}
      footer={canOrder && item.available ? (
        <div className="flex items-center gap-3">
          <Stepper value={qty} onChange={setQty} />
          <button
            type="button"
            onClick={() => onAdd(variant?.id ?? null, qty, note)}
            className="flex-1 h-12 rounded-full bg-brand text-brand-ink font-semibold flex items-center justify-between px-5 active:scale-[.98] transition"
          >
            <span>{t.addToCart}</span>
            <span className="tabular-nums">{formatMoney(unit * qty, currency, lang)}</span>
          </button>
        </div>
      ) : undefined}
    >
      {item.image_url && !imgFailed && (
        <img src={item.image_url} alt="" onError={() => setImgFailed(true)}
          className="w-full aspect-[4/3] object-cover rounded-2xl bg-surface-2 mb-4" />
      )}
      {desc && <p className="text-muted leading-relaxed">{desc}</p>}
      <div className="mt-3"><TagPills tags={item.tags} t={t} /></div>
      {!item.variants.length && (
        <p className="mt-3 text-lg font-semibold tabular-nums">{formatMoney(unit, currency, lang)}</p>
      )}

      {item.variants.length > 0 && (
        <fieldset className="mt-5">
          <legend className="text-sm font-semibold mb-2">{t.choose}</legend>
          <div className="space-y-2">
            {item.variants.map(v => (
              <label
                key={v.id}
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3 cursor-pointer transition-colors ${
                  v.id === variantId ? 'border-brand bg-surface-2' : 'border-line'}`}
              >
                <input
                  type="radio"
                  name="variant"
                  checked={v.id === variantId}
                  onChange={() => setVariantId(v.id)}
                  className="size-4 accent-[var(--brand)]"
                />
                <span className="flex-1">{tr(v.name, lang, fallbacks)}</span>
                <span className="font-semibold tabular-nums">{formatMoney(Number(v.price_cents), currency, lang)}</span>
              </label>
            ))}
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
            className="w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3 text-sm placeholder:text-muted outline-none focus:border-brand"
          />
        </label>
      )}
    </Sheet>
  );
}
