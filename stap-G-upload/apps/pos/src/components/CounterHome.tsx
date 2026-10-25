import { Plus } from 'lucide-react';
import { usePos, type OrderTarget } from '../store';
import { LiveOrders } from './LiveOrders';
import { t } from '../lib/i18n';

/** Start screen of a boccadillos restaurant (counter service, no tables): one big button to start an order,
 *  a short count per stage, and the open orders below. Only shown when the restaurant has boccadillos mode on. */
export function CounterHome({ onOpen }: { onOpen: (t: OrderTarget) => void }) {
  const pos = usePos();
  const count = (s: string) => pos.orders.filter(o => o.status === s).length;
  const chips: [string, number, string][] = [
    [t('À encaisser'), pos.pendingQr.length, 'bg-qr/15 text-qr'],
    [t('En préparation'), count('preparing'), 'bg-warn/15 text-warn'],
    [t('Prêtes'), count('ready'), 'bg-ok/15 text-ok'],
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-stretch gap-3">
        <button onClick={() => onOpen({ kind: 'new', orderType: 'takeaway', source: 'pos' })}
          className="gold-fill flex min-h-[84px] min-w-[260px] flex-1 items-center justify-center gap-3 rounded-3xl px-8 py-5 text-2xl font-bold text-brand-ink shadow-lg transition active:scale-[0.99] sm:flex-none">
          <Plus className="h-8 w-8" />{t('Nouvelle commande')}
        </button>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {chips.map(([label, n, cls]) => (
            <span key={label} className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-base font-bold ${cls}`}>
              <b className="tabular text-2xl">{n}</b>{label}
            </span>
          ))}
        </div>
      </div>
      <LiveOrders onOpen={onOpen} />
    </div>
  );
}
