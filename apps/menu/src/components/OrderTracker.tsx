import { useEffect, useState } from 'react';
import { Check, ChefHat, BellRing, UtensilsCrossed, XCircle } from 'lucide-react';
import { formatMoney, type OrderStatus } from '@resto/shared';
import { getOrderStatus } from '../lib/api';
import type { Strings } from '../lib/strings';

export interface TrackedOrder { order_id: string; ticket_number: number; total_cents: number; placed_at: number }

const STEPS: { key: OrderStatus; Icon: typeof Check }[] = [
  { key: 'new', Icon: Check },
  { key: 'preparing', Icon: ChefHat },
  { key: 'ready', Icon: BellRing },
  { key: 'served', Icon: UtensilsCrossed },
];

export function OrderTracker({ order, t, lang, currency, tableLabel, onClose }: {
  order: TrackedOrder;
  t: Strings;
  lang: string;
  currency: string;
  tableLabel: string | null;
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

  return (
    <div className="fixed inset-0 z-50 bg-bg overflow-y-auto animate-fade">
      <div className="mx-auto max-w-md px-6 pt-14 pb-10 min-h-full flex flex-col">
        <div className="text-center">
          <div className="mx-auto grid place-items-center size-16 rounded-full bg-brand text-brand-ink">
            {status === 'cancelled' ? <XCircle className="size-8" /> : <Check className="size-8" strokeWidth={3} />}
          </div>
          <h1 className="mt-5 font-display text-2xl font-bold">{t.thanks}</h1>
          <p className="mt-6 text-sm uppercase tracking-widest text-muted">{t.ticket}</p>
          <p dir="ltr" className="font-display text-6xl font-bold tabular-nums">#{order.ticket_number}</p>
          <p className="mt-2 text-muted">
            {tableLabel ? <>{t.table} <bdi>{tableLabel}</bdi> · </> : ''}<bdi>{formatMoney(order.total_cents, currency, lang)}</bdi>
          </p>
        </div>

        {status === 'cancelled' ? (
          <p className="mt-10 rounded-2xl bg-surface-2 p-4 text-center">{t.statusHint.cancelled}</p>
        ) : (
          <ol className="mt-10 space-y-0" aria-label="status">
            {STEPS.map((s, i) => {
              const done = i <= current;
              const active = i === current;
              return (
                <li key={s.key} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`grid place-items-center size-10 rounded-full transition-colors ${
                      done ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted'} ${active ? 'ring-4 ring-surface-2' : ''}`}>
                      <s.Icon className="size-5" />
                    </div>
                    {i < STEPS.length - 1 && <div className={`w-0.5 flex-1 min-h-6 ${i < current ? 'bg-brand' : 'bg-line'}`} />}
                  </div>
                  <div className="pb-6 pt-2">
                    <p className={`font-semibold ${done ? '' : 'text-muted'}`}>{t.status[s.key]}</p>
                    {active && <p className="text-sm text-muted mt-0.5">{t.statusHint[s.key]}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <p className="mt-auto pt-6 text-center text-sm text-muted">{t.payAtCounter}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 h-12 rounded-full border border-line font-semibold active:scale-[.98] transition"
        >
          {t.backToMenu}
        </button>
      </div>
    </div>
  );
}
