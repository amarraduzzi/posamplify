import { QrCode, Check, ChefHat, BellRing, UtensilsCrossed } from 'lucide-react';
import { usePos, type OrderTarget } from '../store';
import { updateOrder } from '../lib/data';
import { mad, minutesSince, STATUS, time } from '../lib/format';
import type { Order, OrderStatus } from '../lib/types';
import { Btn } from './ui';
import { Star8 } from './Brand';

const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string; Icon: typeof Check }>> = {
  preparing: { to: 'ready', label: 'Prête', Icon: BellRing },
  ready: { to: 'served', label: 'Servie', Icon: UtensilsCrossed },
};

/** All open orders, oldest first: accept guest orders, follow kitchen status. */
export function LiveOrders({ onOpen }: { onOpen: (t: OrderTarget) => void }) {
  const pos = usePos();
  const tz = pos.restaurant!.timezone;
  const setStatus = async (o: Order, s: OrderStatus) => {
    try { await updateOrder(o.id, { status: s }); await pos.reloadOrders(); } catch (e) { pos.fail(e); }
  };
  if (!pos.orders.length) return (
    <div className="py-24 text-center text-muted">
      <Star8 filled={false} stroke={0.6} className="mx-auto h-16 w-16 text-brand/40" />
      <p className="mt-4">Aucune commande en cours.</p>
    </div>
  );
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-4">
      {pos.orders.map(o => {
        const m = minutesSince(o.created_at);
        const pending = o.source === 'qr' && o.status === 'new';
        const next = o.status === 'new' && !pending ? { to: 'preparing' as OrderStatus, label: 'En préparation', Icon: ChefHat } : NEXT[o.status];
        return (
          <article key={o.id} className={`rise panel flex flex-col overflow-hidden rounded-3xl ${pending ? 'blink !border-qr' : ''}`}>
            <div className={`h-1 ${pending ? 'bg-qr' : o.status === 'ready' ? 'bg-ok' : o.status === 'preparing' ? 'bg-warn' : 'bg-brand'}`} />
            <button onClick={() => onOpen({ kind: 'order', orderId: o.id })} className="flex items-start justify-between gap-2 px-4 pt-3.5 text-left">
              <div>
                <p className="flex items-center gap-1.5 text-lg font-bold">{o.source === 'qr' && <QrCode className="h-4 w-4 text-qr" />}{pos.labelOf(o)}</p>
                <p className="text-xs text-muted">#{o.ticket_number} · {time(o.created_at, tz)} · {STATUS[o.status]}</p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular ${m >= 20 ? 'bg-danger/20 text-danger' : m >= 10 ? 'bg-warn/20 text-warn' : 'bg-surface-2 text-muted'}`}>{m} min</span>
            </button>
            <ul className="flex-1 space-y-0.5 px-4 py-2 text-sm">
              {o.order_lines.map(l => (
                <li key={l.id} className={l.kitchen_sent_at ? '' : 'text-warn'}>
                  <b className="tabular">{l.quantity}×</b> {l.name}{l.note && <span className="block pl-5 text-xs italic text-muted">{l.note}</span>}
                </li>
              ))}
              {o.note && <li className="mt-1 rounded-lg bg-surface-2 px-2 py-1 text-xs"><b>Note :</b> {o.note}</li>}
            </ul>
            <div className="flex items-center justify-between gap-2 border-t border-line/[0.07] bg-bg/30 px-4 py-3">
              <span className="font-display text-xl font-semibold tabular">{mad(o.total_cents)}</span>
              {pending ? <Btn tone="brand" onClick={() => pos.acceptQr(o)}><Check className="h-4 w-4" /> Accepter</Btn>
                : next ? <Btn onClick={() => setStatus(o, next.to)}><next.Icon className="h-4 w-4" /> {next.label}</Btn>
                : <span className="text-xs text-muted">À encaisser</span>}
            </div>
          </article>
        );
      })}
    </div>
  );
}
