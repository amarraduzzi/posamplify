// The customer's side of Amplify's billing: a banner when the payment is near or late, and on the
// Restaurant page the next payment, the agreement and the receipts (to print).
import { useEffect, useState } from 'react';
import { CalendarClock, Printer } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { mad } from '../lib/api';
import { t } from '../lib/i18n';
import { billing, fmtDay, METHODS, printReceipt, receiptNo, type PlatformPayment } from '../lib/billing';
import type { Restaurant } from '../lib/types';
import { AMPLIFY_WA } from '../pages/UpgradePage';
import { Card } from './ui';

export function BillingBanner({ r }: { r: Restaurant }) {
  const b = billing(r);
  if (!b.due || !(b.state === 'late' || (b.state === 'soon' && (b.left ?? 99) <= 5))) return null;
  const late = b.state === 'late';
  const text = late
    ? t('Votre abonnement Amplify est à régler depuis le {d}{a}.', { d: fmtDay(b.due, true), a: b.amount ? ` (${mad(b.amount)})` : '' })
    : t('Votre abonnement Amplify est à régler le {d}{a}.', { d: fmtDay(b.due, true), a: b.amount ? ` (${mad(b.amount)})` : '' });
  return (
    <div role="status" className={`mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-sm md:mx-8 ${late ? 'bg-danger/10 text-danger' : 'bg-warn/15 text-warn'}`}>
      <CalendarClock className="h-5 w-5 shrink-0" /><p className="min-w-0 flex-1 font-semibold">{text}</p>
      <a href={`https://wa.me/${AMPLIFY_WA}?text=${encodeURIComponent(t('Bonjour, je veux régler mon abonnement Amplify pour {name}.', { name: r.name }))}`} target="_blank" rel="noopener" className="rounded-xl bg-surface px-3 py-1.5 font-semibold text-ink">{t('Nous écrire')}</a>
    </div>
  );
}

export function BillingCard({ r }: { r: Restaurant }) {
  const [list, setList] = useState<PlatformPayment[]>([]);
  useEffect(() => {
    supabase.from('platform_payments').select('*').eq('restaurant_id', r.id).order('period_to', { ascending: false }).limit(12)
      .then(res => setList((res.data ?? []) as PlatformPayment[]));
  }, [r.id]);
  const b = billing(r);
  if (!r.billing_start && !r.paid_until && !list.length) return null;
  return (
    <Card>
      <h2 className="mb-1 font-display text-xl font-semibold">{t('Votre abonnement Amplify')}</h2>
      <p className="mb-4 text-sm text-muted">
        {b.state === 'setup' && r.billing_start ? t('Votre abonnement commence le {d}.', { d: fmtDay(r.billing_start, true) })
          : b.due ? t('Prochain paiement : {d}{a}.', { d: fmtDay(b.due, true), a: b.amount ? `, ${mad(b.amount)}` : '' }) : ''}
        {r.billing_amount_cents ? ` ${r.billing_period === 'year' ? t('Paiement par an.') : t('Paiement par mois.')}` : ''}
      </p>
      {list.length > 0 && (
        <ul className="divide-y divide-line/10">
          {list.map(p => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
              <span className="w-28 font-semibold tabular">{receiptNo(p)}</span>
              <span className="w-28 font-semibold tabular">{mad(p.amount_cents)}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{t(METHODS[p.method])} · {fmtDay(p.period_from)} → {fmtDay(p.period_to)}</span>
              <button type="button" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-surface-2" title={t('Imprimer le reçu')} aria-label={t('Imprimer le reçu')} onClick={() => printReceipt(r, p)}><Printer className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
