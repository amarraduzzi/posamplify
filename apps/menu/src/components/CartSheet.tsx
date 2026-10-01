import { AlertCircle, QrCode, ShoppingBag } from 'lucide-react';
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
  const needsTable = checkout.orderType === 'dine_in' && !menu.table;
  const needsCustomer = checkout.orderType !== 'dine_in';
  const customerOk = !needsCustomer || (checkout.name.trim() && checkout.phone.trim()
    && (checkout.orderType !== 'delivery' || checkout.address.trim()));
  const canSubmit = cart.count > 0 && !needsTable && !!customerOk && !busy;
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
            <span className="tabular-nums">{formatMoney(cart.total, currency, lang)}</span>
          </button>
          <p className="text-center text-xs text-muted">{t.payAtCounter}</p>
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
