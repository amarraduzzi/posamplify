import { ReviewButton } from './ReviewButton';
import { useEffect, useState } from 'react';
import { Check, ChefHat, BellRing, UtensilsCrossed, XCircle } from 'lucide-react';
import { formatMoney, type OrderStatus } from '@resto/shared';
import { getOrderStatus } from '../lib/api';
import type { Strings } from '../lib/strings';
import { Divider, Star8 } from './Ornament';

export interface TrackedOrder { order_id: string; ticket_number: number; total_cents: number; placed_at: number }

const STEPS: { key: OrderStatus; Icon: typeof Check }[] = [
  { key: 'new', Icon: Check },
  { key: 'preparing', Icon: ChefHat },
  { key: 'ready', Icon: BellRing },
  { key: 'served', Icon: UtensilsCrossed },
];

export function OrderTracker({ order, t, lang, currency, tableLabel, restaurantName, reviewUrl, onClose }: {
  reviewUrl?: string;
  order: TrackedOrder;
  t: Strings;
  lang: string;
  currency: string;
  tableLabel: string | null;
  restaurantName: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<OrderStatus>('new');

  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const s = await getOrderStatus(order.order_id);
        if (!stop && s) setStatus(s.status);
        if (s && (s.status === 'served' || s.status === 'cancelled')) return;
      } catch { /* offline: keep polling */ }
      if (!stop) timer = window.setTimeout(tick, document.hidden ? 20000 : 7000);
    };
    tick();
    return () => { stop = true; window.clearTimeout(timer); };
  }, [order.order_id]);

  const current = STEPS.findIndex(s => s.key === status);
  const cancelled = status === 'cancelled';

  return (
    <div className="fixed inset-0 z-50 bg-bg overflow-y-auto animate-fade">
      <div className="absolute inset-x-0 top-0 h-96 hero-glow" aria-hidden>
        <div className="absolute inset-0 fade-down"><div className="absolute inset-0 zellige zellige-hero" /></div>
      </div>
      <div className="relative mx-auto max-w-md px-6 pt-16 pb-10 min-h-full flex flex-col">
        <div className="text-center">
          <div className="relative mx-auto size-20">
            {!cancelled && <span className="absolute inset-0 rounded-full bg-brand animate-pulse-ring" aria-hidden />}
            <div className={`relative grid place-items-center size-20 rounded-full animate-pop ${cancelled ? 'bg-danger text-white' : 'bg-brand text-brand-ink glow-brand'}`}>
              {cancelled ? <XCircle className="size-9" /> : <Check className="size-9" strokeWidth={3} />}
            </div>
          </div>
          <h1 className="mt-6 font-display text-[1.9rem] font-semibold leading-tight animate-rise" style={{ ['--i' as string]: 2 }}>{t.thanks}</h1>
          <p className="mt-1 text-muted animate-rise" style={{ ['--i' as string]: 3 }}>{restaurantName}</p>

          <div className="relative mt-8 mx-auto w-full max-w-xs rounded-[2rem] card px-6 py-6 overflow-hidden animate-rise" style={{ ['--i' as string]: 4 }}>
            <Star8 className="absolute -top-16 -end-16 size-44 text-brand opacity-[0.06] animate-spin-slow" />
            <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-muted">{t.ticket}</p>
            <p dir="ltr" className="mt-1 font-display text-7xl font-semibold tabular-nums text-gradient-brand leading-none py-1">#{order.ticket_number}</p>
            <Divider className="mt-4" />
            <p className="mt-4 text-sm text-muted">
              {tableLabel ? <>{t.table} <bdi className="font-semibold text-ink">{tableLabel}</bdi> · </> : ''}
              <bdi className="font-semibold text-ink">{formatMoney(order.total_cents, currency, lang)}</bdi>
            </p>
          </div>
        </div>

        {cancelled ? (
          <p className="mt-8 rounded-2xl card p-4 text-center">{t.statusHint.cancelled}</p>
        ) : (
          <ol className="mt-10 animate-rise" style={{ ['--i' as string]: 6 }} aria-label="status">
            {STEPS.map((s, i) => {
              const done = i <= current;
              const active = i === current;
              return (
                <li key={s.key} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`relative grid place-items-center size-11 rounded-full transition-all duration-500 ${
                      done ? 'bg-brand text-brand-ink' : 'bg-surface border border-line text-muted'} ${active ? 'glow-brand scale-110' : ''}`}>
                      {active && <span className="absolute inset-0 rounded-full bg-brand animate-pulse-ring" aria-hidden />}
                      <s.Icon className="relative size-5" />
                    </div>
                    {i < STEPS.length - 1 && (
                      <div className="w-0.5 flex-1 min-h-7 bg-line overflow-hidden rounded-full">
                        <div className={`w-full bg-brand transition-all duration-700 ${i < current ? 'h-full' : 'h-0'}`} />
                      </div>
                    )}
                  </div>
                  <div className="pb-7 pt-2.5">
                    <p className={`font-semibold ${done ? '' : 'text-muted'}`}>{t.status[s.key]}</p>
                    {active && <p className="text-sm text-muted mt-0.5">{t.statusHint[s.key]}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {status === 'served' && <div className="mt-8 animate-rise"><ReviewButton url={reviewUrl} label={t.reviewCta} hint={t.reviewHint} /></div>}
        <p className="mt-auto pt-6 text-center text-sm text-muted">{t.payAtCounter}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 h-13 rounded-full card font-semibold press"
        >
          {t.backToMenu}
        </button>
      </div>
    </div>
  );
}
