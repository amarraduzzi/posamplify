import { useEffect, useMemo, useState } from 'react';
import { usePos } from '../store';
import { ticketRef } from '../lib/print';
import { pickupCode, sendPickup, stopPickup } from '../lib/pickup';

/** Boccadillos only (rendered by App only then): sends the paid orders in preparation / ready to the pickup board,
 *  when the board is switched on in the settings. Without the switch it does nothing at all. */
export function PickupSender() {
  const pos = usePos();
  const r = pos.restaurant!;
  const [code, setCode] = useState(pickupCode());
  useEffect(() => {
    const f = () => setCode(pickupCode());
    window.addEventListener('pickup-change', f);
    return () => window.removeEventListener('pickup-change', f);
  }, []);
  const msg = useMemo(() => {
    const paid = pos.orders.filter(o => o.prepaid_at && (o.status === 'preparing' || o.status === 'ready'))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const item = (o: (typeof paid)[number]) => ({ id: o.id, ref: ticketRef(o), name: o.customer_name ?? '' });
    return { preparing: paid.filter(o => o.status === 'preparing').map(item), ready: paid.filter(o => o.status === 'ready').map(item) };
  }, [pos.orders]);
  const key = JSON.stringify(msg);
  useEffect(() => {
    if (!code) { stopPickup(); return; }
    sendPickup({ r: { name: r.name, logo: r.branding?.logo_url }, ...msg });
  }, [code, key, r.name]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
