import { ReviewButton } from './ReviewButton';
import { useEffect, useState } from 'react';
import { Check, ChefHat, BellRing, UtensilsCrossed, XCircle, MessageCircle, Clock } from 'lucide-react';
import { formatMoney, type OrderStatus, type OrderStatusResult } from '@resto/shared';
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

export function OrderTracker({ order, t, lang, currency, tableLabel, restaurantName, reviewUrl, timezone, onClose }: {
  reviewUrl?: string;
  timezone?: string;
  order: TrackedOrder;
  t: Strings;
  lang: string;
  currency: string;
  tableLabel: string | null;
  restaurantName: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<OrderStatus>('new');
  const [info, setInfo] = useState<OrderStatusResult | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const s = await getOrderStatus(order.order_id);
        if (!stop && s) { setStatus(s.status); setInfo(s); }
        if (s && (s.status === 'served' || s.status === 'cancelled')) return;
      } catch { /* offline: keep polling */ }
      if (!stop) timer = window.setTimeout(tick, document.hidden ? 20000 : 7000);
    };
    tick();
    return () => { stop = true; window.clearTimeout(timer); };
  }, [order.order_id]);

  const current = STEPS.findIndex(s => s.key === status);
  const online = !!info?.order_type && info.order_type !== 'dine_in';
  const hm = (iso: string) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-MA-u-nu-latn' : lang, { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const when = info?.eta_at ? (info.order_type === 'delivery' ? t.deliveredAround(hm(info.eta_at)) : t.readyAround(hm(info.eta_at)))
    : info?.wanted_at ? t.askedFor(hm(info.wanted_at)) : null;
  const digits = (info?.restaurant_phone ?? '').replace(/\D/g, '');
  const wa = digits.startsWith('00') ? digits.slice(2) : digits.startsWith('0') ? '212' + digits.slice(1) : digits;
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
            {online && (
              <p className={`mt-4 flex items-center justify-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${info?.eta_at ? 'bg-brand/15 text-brand' : 'bg-surface-2 text-muted'}`}>
                <Clock className="size-4" />{when ?? t.waitingConfirm}
              </p>
            )}
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
        {online && wa && !cancelled && status !== 'served' && (
          <a href={`https://wa.me/${wa}?text=${encodeURIComponent(`${t.ticket} #${order.ticket_number}`)}`} target="_blank" rel="noopener"
            className="mt-8 flex h-12 items-center justify-center gap-2 rounded-full border border-line font-semibold press">
            <MessageCircle className="size-5 text-brand" />{t.contactWhatsApp}
          </a>
        )}
        <p className="mt-auto pt-6 text-center text-sm text-muted">{info?.order_type === 'takeaway' ? t.payOnPickup : info?.order_type === 'delivery' ? t.payOnDelivery : t.payAtCounter}</p>
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
