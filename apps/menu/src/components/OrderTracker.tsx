import { ReviewButton } from './ReviewButton';
import { GuestStory, type ShareConfig, type ShareDish } from './GuestStory';
import { Fragment, useEffect, useState } from 'react';
import { Check, ChefHat, BellRing, UtensilsCrossed, XCircle, MessageCircle, Clock } from 'lucide-react';
import { formatMoney, type OrderStatus, type OrderStatusResult } from '@resto/shared';
import { getOrderStatus } from '../lib/api';
import type { Strings } from '../lib/strings';

export interface TrackedOrder { order_id: string; ticket_number: number; total_cents: number; placed_at: number; item_ids?: string[] }

const STEPS: { key: OrderStatus; Icon: typeof Check }[] = [
  { key: 'new', Icon: Check },
  { key: 'preparing', Icon: ChefHat },
  { key: 'ready', Icon: BellRing },
  { key: 'served', Icon: UtensilsCrossed },
];

export function OrderTracker({ order, t, lang, currency, tableLabel, restaurantName, reviewUrl, timezone, share, dishes, onClose }: {
  reviewUrl?: string;
  share?: ShareConfig | null;
  /** dishes with a photo for the share story: the ordered ones first */
  dishes?: ShareDish[];
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
      <div className="relative mx-auto max-w-md px-5 pt-6 pb-8 min-h-full flex flex-col">
        {/* 1. confirmation: small and clear, the order number stays big enough for the waiter */}
        <div className="rounded-3xl card p-4 animate-rise">
          <div className="flex items-center gap-3">
            <div className={`grid size-11 shrink-0 place-items-center rounded-full ${cancelled ? 'bg-danger text-white' : 'bg-brand text-brand-ink'}`}>
              {cancelled ? <XCircle className="size-6" /> : <Check className="size-6" strokeWidth={3} />}
            </div>
            <div className="min-w-0 flex-1 text-start">
              <h1 className="font-display text-xl font-semibold leading-tight">{t.thanks}</h1>
              <p className="truncate text-sm text-muted">
                <bdi>{restaurantName}</bdi>{tableLabel ? <> · {t.table} <bdi className="font-semibold text-ink">{tableLabel}</bdi></> : ''}
              </p>
            </div>
            <div className="shrink-0 text-end">
              <p dir="ltr" className="font-display text-3xl font-semibold tabular-nums leading-none text-brand">#{order.ticket_number}</p>
              <p className="mt-1 text-sm font-semibold"><bdi>{formatMoney(order.total_cents, currency, lang)}</bdi></p>
            </div>
          </div>
          {online && (
            <p className={`mt-3 flex items-center justify-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${info?.eta_at ? 'bg-brand/15 text-brand' : 'bg-surface-2 text-muted'}`}>
              <Clock className="size-4" />{when ?? t.waitingConfirm}
            </p>
          )}
          {info?.delivery_code && (
            <div className="mt-3 rounded-2xl bg-brand/12 px-4 py-3 text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-brand">{t.deliveryCode}</p>
              <p dir="ltr" className="font-display text-4xl font-semibold tracking-[0.3em] tabular-nums">{info.delivery_code}</p>
              <p className="mt-1 text-xs text-muted">{info.delivery_status === 'picked_up' && info.courier ? t.courierOnWay(info.courier) : t.deliveryCodeHint}</p>
            </div>
          )}
        </div>

        {/* 2. the story: the main thing on this page */}
        {share && !cancelled && (
          <div className="mt-5"><GuestStory t={t} lang={lang} restaurant={restaurantName} orderId={order.order_id} ticket={order.ticket_number} cfg={share} dishes={dishes ?? []} /></div>
        )}

        {/* 3. status: one line of icons and the current step, not a long list */}
        {cancelled ? (
          <p className="mt-6 rounded-2xl card p-4 text-center">{t.statusHint.cancelled}</p>
        ) : (
          <div className="mt-6 animate-rise" aria-label="status">
            <div className="flex items-center px-2">
              {STEPS.map((s, i) => {
                const done = i <= current;
                const active = i === current;
                return (
                  <Fragment key={s.key}>
                    <div className={`relative grid size-9 shrink-0 place-items-center rounded-full transition-all duration-500 ${done ? 'bg-brand text-brand-ink' : 'bg-surface border border-line text-muted'} ${active ? 'glow-brand' : ''}`}>
                      {active && <span className="absolute inset-0 rounded-full bg-brand animate-pulse-ring" aria-hidden />}
                      <s.Icon className="relative size-4" />
                    </div>
                    {i < STEPS.length - 1 && <div className={`h-0.5 flex-1 rounded-full ${i < current ? 'bg-brand' : 'bg-line'}`} />}
                  </Fragment>
                );
              })}
            </div>
            <p className="mt-3 text-center font-semibold">{t.status[status]}</p>
            <p className="text-center text-sm text-muted">{t.statusHint[status]}</p>
          </div>
        )}

        {status === 'served' && <div className="mt-6 animate-rise"><ReviewButton url={reviewUrl} label={t.reviewCta} hint={t.reviewHint} /></div>}
        {online && wa && !cancelled && status !== 'served' && (
          <a href={`https://wa.me/${wa}?text=${encodeURIComponent(`${t.ticket} #${order.ticket_number}`)}`} target="_blank" rel="noopener"
            className="mt-6 flex h-12 items-center justify-center gap-2 rounded-full border border-line font-semibold press">
            <MessageCircle className="size-5 text-brand" />{t.contactWhatsApp}
          </a>
        )}
        <p className="mt-auto pt-6 text-center text-xs text-muted">{info?.order_type === 'takeaway' ? t.payOnPickup : info?.order_type === 'delivery' ? t.payOnDelivery : t.payAtCounter}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 h-12 rounded-full card font-semibold press"
        >
          {t.backToMenu}
        </button>
      </div>
    </div>
  );
}
