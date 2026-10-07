import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bike, Clock, LocateFixed, PauseCircle, QrCode, ShoppingBag } from 'lucide-react';
import { formatMoney, tr, type OrderType, type PublicMenu } from '@resto/shared';
import { Sheet } from './Sheet';
import { Stepper } from './Stepper';
import type { Cart } from '../lib/cart';
import type { Strings } from '../lib/strings';

export interface Checkout {
  orderType: OrderType;
  name: string;
  phone: string;
  address: string;
  note: string;
  /** '' = as soon as possible, otherwise the ISO time asked for */
  wantedAt?: string;
  location?: { lat: number; lng: number } | null;
}

/** Local weekday and HH:MM of a moment in the restaurant's time zone. */
function localParts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const get = (k: string) => f.find(x => x.type === k)?.value ?? '';
  return { dow: get('weekday').toLowerCase().slice(0, 3), hm: `${get('hour').replace('24', '00')}:${get('minute')}` };
}
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** Same rule as the server (app.open_at): ranges per day, a range past midnight runs into the next day. */
export function openAt(hours: Record<string, [string, string][]>, d: Date, tz: string): boolean {
  if (!hours || !Object.keys(hours).length) return true;
  const { dow, hm } = localParts(d, tz);
  const prev = DAYS[(DAYS.indexOf(dow) + 6) % 7];
  for (const [s, e] of hours[dow] ?? []) if ((e > s && hm >= s && hm < e) || (e <= s && hm >= s)) return true;
  for (const [s, e] of hours[prev] ?? []) if (e <= s && hm < e) return true;
  return false;
}
/** Times a guest can ask for: every 15 minutes, from now + preparation, for the next 2 days, when open. */
function slots(menu: PublicMenu): Date[] {
  const prep = menu.online?.prep_minutes ?? 20;
  const start = new Date(Date.now() + (prep + 5) * 60000);
  start.setSeconds(0, 0); start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15);
  const out: Date[] = [];
  for (let d = start; out.length < 120 && d.getTime() < Date.now() + 2 * 86400000; d = new Date(d.getTime() + 15 * 60000)) {
    if (openAt(menu.restaurant.opening_hours, d, menu.restaurant.timezone)) out.push(d);
  }
  return out;
}

export function availableOrderTypes(menu: PublicMenu): OrderType[] {
  const r = menu.restaurant;
  const out: OrderType[] = [];
  if (r.accept_dine_in) out.push('dine_in');
  if (r.accept_takeaway) out.push('takeaway');
  if (r.accept_delivery) out.push('delivery');
  return out;
}

export function CartSheet({ open, onClose, menu, cart, lang, fallbacks, t, checkout, setCheckout, onSubmit, busy, error }: {
  open: boolean;
  onClose: () => void;
  menu: PublicMenu;
  cart: Cart;
  lang: string;
  fallbacks: string[];
  t: Strings;
  checkout: Checkout;
  setCheckout: (c: Checkout) => void;
  onSubmit: () => void;
  busy: boolean;
  error: string | null;
}) {
  const currency = menu.restaurant.currency;
  const types = availableOrderTypes(menu);
  const on = menu.online;
  const tz = menu.restaurant.timezone;
  const online = checkout.orderType !== 'dine_in';
  const times = useMemo(() => (online && on?.schedule !== false ? slots(menu) : []), [online, menu, on?.schedule]);
  const closed = online && on ? !on.open_now : false;
  const paused = online && !!on?.paused;
  const later = !!checkout.wantedAt;
  const delivery = checkout.orderType === 'delivery';
  const fee = delivery && on && on.delivery_fee_cents > 0 && (on.delivery_free_from_cents == null || cart.total < on.delivery_free_from_cents) ? on.delivery_fee_cents : 0;
  const belowMin = delivery && !!on && on.delivery_min_cents > 0 && cart.total < on.delivery_min_cents;
  const [locState, setLocState] = useState<'idle' | 'busy' | 'fail'>('idle');
  // closed now: preselect the first time it opens again
  useEffect(() => {
    if (open && online && closed && !later && times.length) setCheckout({ ...checkout, wantedAt: times[0].toISOString() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, online, closed, times.length]);
  const hhmm = (d: Date) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-MA-u-nu-latn' : lang, { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
  const locate = () => {
    if (!navigator.geolocation) { setLocState('fail'); return; }
    setLocState('busy');
    navigator.geolocation.getCurrentPosition(
      p => { setLocState('idle'); setCheckout({ ...checkout, location: { lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 } }); },
      () => setLocState('fail'), { enableHighAccuracy: true, timeout: 10000 });
  };
  const needsTable = checkout.orderType === 'dine_in' && !menu.table;
  const needsCustomer = checkout.orderType !== 'dine_in';
  const customerOk = !needsCustomer || (checkout.name.trim() && checkout.phone.trim()
    && (checkout.orderType !== 'delivery' || checkout.address.trim()));
  const timeOk = !online || !closed || later;
  const canSubmit = cart.count > 0 && !needsTable && !!customerOk && !busy && !paused && timeOk && !belowMin;
  const set = (patch: Partial<Checkout>) => setCheckout({ ...checkout, ...patch });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      closeLabel={t.close}
      title={
        <div className="pt-1">
          <h2 className="font-display text-[1.7rem] font-semibold leading-tight">{t.cart}</h2>
          {menu.table && checkout.orderType === 'dine_in' && (
            <p className="text-sm text-muted">{t.table} {menu.table.label}</p>
          )}
        </div>
      }
      footer={cart.count > 0 || error ? (
        <div className="space-y-3">
          {error && (
            <div role="alert" className="flex gap-2 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-danger">
              <AlertCircle className="size-4.5 shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}
          {cart.count > 0 && <>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="w-full h-14 rounded-full bg-brand text-brand-ink font-semibold text-[15px] flex items-center justify-between px-6 glow-brand disabled:opacity-45 disabled:shadow-none press"
          >
            <span>{busy ? t.sending : t.placeOrder}</span>
            <span className="tabular-nums">{formatMoney(cart.total + fee, currency, lang)}</span>
          </button>
          <p className="text-center text-xs text-muted">{checkout.orderType === 'takeaway' ? t.payOnPickup : delivery ? t.payOnDelivery : t.payAtCounter}</p>
          </>}
        </div>
      ) : undefined}
    >
      {cart.count === 0 ? (
        <div className="py-12 text-center">
          <div className="mx-auto grid place-items-center size-16 rounded-full bg-surface-2 text-brand"><ShoppingBag className="size-7" /></div>
          <p className="mt-4 text-muted">{t.emptyCart}</p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {cart.lines.map(l => {
              const it = cart.itemsById.get(l.item_id);
              if (!it) return null;
              const v = it.variants.find(x => x.id === l.variant_id);
              return (
                <li key={l.key} className="flex items-center gap-3 py-3.5">
                  {it.image_url
                    ? <img src={it.image_url} alt="" className="size-14 shrink-0 rounded-xl object-cover bg-surface-2" onError={e => { e.currentTarget.style.display = 'none'; }} />
                    : null}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium leading-snug">{tr(it.name, lang, fallbacks)}</p>
                    {v && <p className="text-sm text-muted">{tr(v.name, lang, fallbacks)}</p>}
                    {!!l.modifiers?.length && <p className="text-sm text-muted">+ {l.modifiers.map(id => { const o = (it.modifier_groups ?? []).flatMap(g => g.options).find(x => x.id === id); return o ? tr(o.name, lang, fallbacks) : ''; }).filter(Boolean).join(', ')}</p>}
                    {l.note && <p className="text-sm text-muted italic truncate">“{l.note}”</p>}
                    <p className="text-sm font-bold text-brand tabular-nums mt-0.5">{formatMoney(cart.priceOf(l) * l.quantity, currency, lang)}</p>
                  </div>
                  <Stepper size="sm" min={0} value={l.quantity} onChange={q => cart.setQty(l.key, q)} removeLabel={t.remove} />
                </li>
              );
            })}
          </ul>

          {types.length > 1 && (
            <div className="mt-5 grid gap-1 rounded-full bg-surface-2 p-1" style={{ gridTemplateColumns: `repeat(${types.length}, 1fr)` }}>
              {types.map(ty => (
                <button
                  key={ty}
                  type="button"
                  onClick={() => set({ orderType: ty })}
                  className={`h-10 rounded-full text-sm font-semibold transition ${
                    checkout.orderType === ty ? 'bg-brand text-brand-ink shadow-sm' : 'text-muted'}`}
                >
                  {t.orderType[ty]}
                </button>
              ))}
            </div>
          )}

          {needsTable && (
            <div className="mt-4 flex gap-3 rounded-2xl border border-line px-4 py-3 text-sm">
              <QrCode className="size-5 shrink-0 text-brand" /><span>{t.scanTable}</span>
            </div>
          )}

          {online && paused && (
            <div className="mt-4 flex gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-sm font-semibold text-danger">
              <PauseCircle className="size-5 shrink-0" /><span>{t.pausedNow(on?.paused_until ? hhmm(new Date(on.paused_until)) : '')}</span>
            </div>
          )}

          {online && !paused && (
            <div className="mt-5">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Clock className="size-4 text-brand" />{t.when}</p>
              {closed && <p className="mb-2 text-sm text-muted">{times.length ? t.closedNow : t.closedNoSchedule}</p>}
              <div className="grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1">
                <button type="button" disabled={closed} onClick={() => set({ wantedAt: '' })}
                  className={`h-10 rounded-full text-sm font-semibold transition disabled:opacity-40 ${!later ? 'bg-brand text-brand-ink shadow-sm' : 'text-muted'}`}>{t.asap}</button>
                <button type="button" disabled={!times.length} onClick={() => set({ wantedAt: (checkout.wantedAt || times[0]?.toISOString()) ?? '' })}
                  className={`h-10 rounded-full text-sm font-semibold transition disabled:opacity-40 ${later ? 'bg-brand text-brand-ink shadow-sm' : 'text-muted'}`}>{t.later}</button>
              </div>
              {!later && !closed && on && <p className="mt-2 text-sm text-muted">{t.ready(on.prep_minutes)}</p>}
              {later && (
                <select value={checkout.wantedAt} onChange={e => set({ wantedAt: e.target.value })}
                  className="mt-2 h-12 w-full rounded-2xl border border-line bg-surface px-4 outline-none focus:border-brand">
                  {times.map(d => <option key={d.toISOString()} value={d.toISOString()}>{hhmm(d)}</option>)}
                </select>
              )}
            </div>
          )}

          {delivery && on && (on.delivery_fee_cents > 0 || on.delivery_min_cents > 0 || on.delivery_area) && (
            <div className="mt-4 space-y-1.5 rounded-2xl border border-line px-4 py-3 text-sm">
              <p className="flex items-center justify-between"><span className="flex items-center gap-2"><Bike className="size-4 text-brand" />{t.deliveryFee}</span>
                <b className="tabular-nums">{fee ? formatMoney(fee, currency, lang) : t.free}</b></p>
              {on.delivery_free_from_cents != null && fee > 0 && <p className="text-muted">{t.freeFrom(formatMoney(on.delivery_free_from_cents, currency, lang))}</p>}
              {belowMin && <p className="font-semibold text-danger">{t.minOrder(formatMoney(on.delivery_min_cents, currency, lang))}</p>}
              {on.delivery_area && <p className="text-muted">{t.area} {on.delivery_area}</p>}
            </div>
          )}

          {needsCustomer && (
            <div className="mt-4 space-y-2">
              <input value={checkout.name} onChange={e => set({ name: e.target.value.slice(0, 60) })}
                placeholder={t.name} autoComplete="given-name"
                className="w-full h-12 rounded-2xl border border-line bg-surface px-4 outline-none focus:border-brand placeholder:text-muted" />
              <input value={checkout.phone} onChange={e => set({ phone: e.target.value.replace(/[^\d+ ]/g, '').slice(0, 20) })}
                placeholder={t.phone} inputMode="tel" autoComplete="tel" dir="ltr"
                className="w-full h-12 rounded-2xl border border-line bg-surface px-4 outline-none focus:border-brand placeholder:text-muted text-start" />
              {checkout.orderType === 'delivery' && (
                <textarea value={checkout.address} onChange={e => set({ address: e.target.value.slice(0, 300) })}
                  placeholder={t.address} rows={2} autoComplete="street-address"
                  className="w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3 outline-none focus:border-brand placeholder:text-muted" />
              )}
              {checkout.orderType === 'delivery' && (
                <button type="button" onClick={locate} disabled={locState === 'busy'}
                  className={`flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold press ${checkout.location ? 'bg-brand/15 text-brand' : 'border border-line'}`}>
                  <LocateFixed className="size-4" />{checkout.location ? t.locationShared : locState === 'busy' ? '…' : t.shareLocation}
                </button>
              )}
              {checkout.orderType === 'delivery' && locState === 'fail' && <p className="text-xs text-muted">{t.locationFail}</p>}
            </div>
          )}

          <label className="block mt-4">
            <span className="text-sm font-semibold">{t.orderNote}</span>
            <textarea value={checkout.note} onChange={e => set({ note: e.target.value.slice(0, 300) })}
              placeholder={t.orderNotePh} rows={2}
              className="mt-1.5 w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-brand placeholder:text-muted" />
          </label>
        </>
      )}
    </Sheet>
  );
}
