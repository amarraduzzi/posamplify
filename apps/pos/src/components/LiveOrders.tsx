import { useState } from 'react';
import { QrCode, Check, ChefHat, BellRing, UtensilsCrossed, Bike, ShoppingBag, MapPin, MessageCircle, Clock, PauseCircle, PlayCircle, Globe } from 'lucide-react';
import * as db from '../lib/data';
import { usePos, type OrderTarget } from '../store';
import { mad, minutesSince, statusLabel, time } from '../lib/format';
import type { Order, OrderStatus } from '../lib/types';
import { Btn } from './ui';
import { ticketRef } from '../lib/print';
import { Star8 } from './Brand';
import { t } from '../lib/i18n';

/** the guest menu (tracking links in WhatsApp messages) */
const MENU_URL = ((import.meta.env.VITE_MENU_URL as string) || 'https://menu.amplifygrowthstudio.com').replace(/\/$/, '');
const intl = (p: string) => { const d = p.replace(/\D/g, ''); return d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? '212' + d.slice(1) : d; };

// i18n:values
const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string; Icon: typeof Check }>> = {
  preparing: { to: 'ready', label: 'Prête', Icon: BellRing },
  ready: { to: 'served', label: 'Servie', Icon: UtensilsCrossed },
};
// i18n:end

/** All open orders, oldest first: accept guest orders, follow kitchen status. */
export function LiveOrders({ onOpen }: { onOpen: (t: OrderTarget) => void }) {
  const pos = usePos();
  const tz = pos.restaurant!.timezone;
  const setStatus = (o: Order, s: OrderStatus) => { pos.updateOrder(o.id, { status: s }); };
  const r = pos.restaurant!;
  const prep = r.online?.prep_minutes ?? 20;
  const etas = [...new Set([15, prep, 30, 45])].sort((a, b) => a - b).slice(0, 4);
  /** WhatsApp to the guest: confirmed with the time, or ready; with the tracking link */
  const message = (o: Order) => {
    const link = `${MENU_URL}/${r.slug}?suivi=${o.id}`;
    const when = o.eta_at ? time(o.eta_at, tz) : '';
    const hello = t('Bonjour {n},', { n: o.customer_name ?? '' });
    const body = o.status === 'ready'
      ? (o.order_type === 'delivery' ? t('votre commande {ref} chez {r} est en route.', { ref: ticketRef(o), r: r.name }) : t('votre commande {ref} chez {r} est prête, à tout de suite !', { ref: ticketRef(o), r: r.name }))
      : o.order_type === 'delivery' ? t('votre commande {ref} chez {r} est confirmée. Livraison vers {h}.', { ref: ticketRef(o), r: r.name, h: when })
      : t('votre commande {ref} chez {r} est confirmée. Prête vers {h}.', { ref: ticketRef(o), r: r.name, h: when });
    return `${hello} ${body}\n${t('Suivi : {l}', { l: link })}`;
  };
  const takesOnline = (r.accept_takeaway || r.accept_delivery) && r.pos_plan !== 'essentiel';
  if (!pos.orders.length) return (
    <>
      {takesOnline && <OnlineBar />}
      <div className="py-24 text-center text-muted">
        <Star8 filled={false} stroke={0.6} className="mx-auto h-16 w-16 text-brand/40" />
        <p className="mt-4">{t('Aucune commande en cours.')}</p>
      </div>
    </>
  );
  return (
    <>
    {takesOnline && <OnlineBar />}
    <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-4">
      {pos.orders.map(o => {
        const m = minutesSince(o.created_at);
        const pending = o.source === 'qr' && o.status === 'new';
        const online = o.source === 'qr' && !o.table_id && o.order_type !== 'dine_in' && o.external_ref !== 'borne';
        const next = o.status === 'new' && !pending ? { to: 'preparing' as OrderStatus, label: 'En préparation', Icon: ChefHat } : NEXT[o.status];
        return (
          <article key={o.id} className={`rise panel flex flex-col overflow-hidden rounded-3xl ${pending ? 'blink !border-qr' : ''}`}>
            <div className={`h-1 ${pending ? 'bg-qr' : o.status === 'ready' ? 'bg-ok' : o.status === 'preparing' ? 'bg-warn' : 'bg-brand'}`} />
            <button onClick={() => onOpen({ kind: 'order', orderId: o.id })} className="flex items-start justify-between gap-2 px-4 pt-3.5 text-start">
              <div>
                <p className="flex items-center gap-1.5 text-lg font-bold">{o.source === 'qr' && <QrCode className="h-4 w-4 text-qr" />}{pos.labelOf(o)}</p>
                <p className="text-xs text-muted">{ticketRef(o)} · {time(o.created_at, tz)} · {statusLabel(o.status)}</p>
                {online && (
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                    <span className="flex items-center gap-1 rounded-full bg-qr/15 px-2 py-0.5 text-qr">{o.order_type === 'delivery' ? <Bike className="h-3.5 w-3.5" /> : <ShoppingBag className="h-3.5 w-3.5" />}{t('En ligne')}</span>
                    {o.wanted_at && <span className="flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-warn"><Clock className="h-3.5 w-3.5" />{t('pour {h}', { h: time(o.wanted_at, tz) })}</span>}
                    {o.eta_at && <span className="rounded-full bg-ok/15 px-2 py-0.5 text-ok">{t('prête vers {h}', { h: time(o.eta_at, tz) })}</span>}
                  </p>
                )}
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular ${m >= 20 ? 'bg-danger/20 text-danger' : m >= 10 ? 'bg-warn/20 text-warn' : 'bg-surface-2 text-muted'}`}>{t('{n} min', { n: m })}</span>
            </button>
            <ul className="flex-1 space-y-0.5 px-4 py-2 text-sm">
              {o.order_lines.map(l => (
                <li key={l.id} className={l.kitchen_sent_at ? '' : 'text-warn'}>
                  <b className="tabular">{l.quantity}×</b> {l.name}{l.note && <span className="block ps-5 text-xs italic text-muted">{l.note}</span>}
                </li>
              ))}
              {o.note && <li className="mt-1 rounded-lg bg-surface-2 px-2 py-1 text-xs"><b>{t('Note :')}</b> {o.note}</li>}
              {online && (o.customer_phone || o.delivery_address) && (
                <li className="mt-2 space-y-1 rounded-lg bg-surface-2 px-2 py-1.5 text-xs">
                  {o.customer_phone && <p dir="ltr" className="rtl:text-end">{o.customer_name} · {o.customer_phone}</p>}
                  {o.delivery_address && <p className="flex items-start gap-1"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{o.delivery_address}
                    {o.delivery_location && <a className="ms-1 font-bold text-brand underline" target="_blank" rel="noopener" href={`https://maps.google.com/?q=${o.delivery_location.lat},${o.delivery_location.lng}`}>{t('Carte')}</a>}</p>}
                </li>
              )}
            </ul>
            <div className="flex items-center justify-between gap-2 border-t border-line/[0.07] bg-bg/30 px-4 py-3">
              <span className="font-display text-xl font-semibold tabular">{mad(o.total_cents)}</span>
              {pending && online ? (
                <span className="flex flex-wrap justify-end gap-1">
                  {etas.map(m => <Btn key={m} tone={m === prep ? 'brand' : 'plain'} className="px-2.5 py-1.5 text-sm" onClick={() => pos.acceptQr(o, m)}><Check className="h-3.5 w-3.5" /> {t('{n} min', { n: m })}</Btn>)}
                </span>
              ) : pending ? <Btn tone="brand" onClick={() => pos.acceptQr(o)}><Check className="h-4 w-4" /> {t('Accepter')}</Btn>
                : next ? <Btn onClick={() => setStatus(o, next.to)}><next.Icon className="h-4 w-4" /> {t(next.label)}</Btn>
                : <span className="text-xs text-muted">{t('À encaisser')}</span>}
            </div>
            {online && !pending && o.customer_phone && (
              <a href={`https://wa.me/${intl(o.customer_phone)}?text=${encodeURIComponent(message(o))}`} target="_blank" rel="noopener"
                className="flex items-center justify-center gap-2 border-t border-line/[0.07] py-2.5 text-sm font-semibold text-ok hover:bg-ok/10">
                <MessageCircle className="h-4 w-4" /> {o.status === 'ready' ? t('Prévenir : commande prête') : t('Confirmer au client sur WhatsApp')}
              </a>
            )}
          </article>
        );
      })}
    </div>
    </>
  );
}

/** Kitchen overloaded: stop the online orders for a while, from the till. */
function OnlineBar() {
  const pos = usePos();
  const r = pos.restaurant!;
  const [until, setUntil] = useState<string | null>(() => (r.online?.paused_until && Date.parse(r.online.paused_until) > Date.now() ? r.online.paused_until : null));
  const [busy, setBusy] = useState(false);
  const paused = !!until && Date.parse(until) > Date.now();
  const pause = async (m: number) => {
    if (!pos.requireOnline()) return;
    setBusy(true);
    try {
      const res = await db.rpc<{ paused_until: string | null }>('online_pause', { p_restaurant_id: r.id, p_minutes: m });
      setUntil(res.paused_until);
      if (r.online) r.online.paused_until = res.paused_until; else r.online = { paused_until: res.paused_until };
      pos.toast(m ? t('Commandes en ligne en pause') : t('Commandes en ligne reprises'), 'ok');
    } catch (e) { pos.fail(e); }
    setBusy(false);
  };
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-2 rounded-2xl px-4 py-2.5 text-sm ${paused ? 'bg-warn/15' : 'bg-surface-2'}`}>
      <Globe className={`h-4 w-4 ${paused ? 'text-warn' : 'text-ok'}`} />
      <span className="me-auto font-semibold">{paused ? t('Commandes en ligne en pause jusqu’à {h}', { h: time(until!, r.timezone) }) : t('Commandes en ligne ouvertes')}</span>
      {paused
        ? <Btn disabled={busy} className="px-3 py-1.5 text-sm" onClick={() => pause(0)}><PlayCircle className="h-4 w-4" /> {t('Reprendre')}</Btn>
        : <>
          <Btn disabled={busy} className="px-3 py-1.5 text-sm" onClick={() => pause(15)}><PauseCircle className="h-4 w-4" /> {t('Pause 15 min')}</Btn>
          <Btn disabled={busy} className="px-3 py-1.5 text-sm" onClick={() => pause(30)}>{t('30 min')}</Btn>
          <Btn disabled={busy} className="px-3 py-1.5 text-sm" onClick={() => pause(60)}>{t('1 h')}</Btn>
        </>}
    </div>
  );
}
