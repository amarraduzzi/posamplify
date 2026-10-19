// On a confirmed catering order: a warning when the stock that is still good ON the day of the event does not
// cover what the order needs (lots that expire before the event do not count). Nothing is shown when all is fine,
// or when the database has no expiry update yet.
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { rpc } from '../lib/api';
import { fmtQty } from '../lib/profit';
import { t } from '../lib/i18n';
import type { CateringExpiryCheck, Restaurant } from '../lib/types';

export function CateringExpiryWarning({ r, date }: { r: Restaurant; date: string }) {
  const [d, setD] = useState<CateringExpiryCheck | null>(null);
  useEffect(() => {
    let stop = false;
    rpc<CateringExpiryCheck>('catering_expiry_check', { p_restaurant_id: r.id, p_date: date }).then(x => { if (!stop) setD(x); }).catch(() => { if (!stop) setD(null); });
    return () => { stop = true; };
  }, [r.id, date]);
  const short = (d?.items ?? []).filter(i => Number(i.short) > 0);
  if (!short.length) return null;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-warn/40 bg-warn/5 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
      <div>
        <p className="font-semibold">{t('Stock encore bon le jour de l’événement : insuffisant')}</p>
        <ul className="mt-1 space-y-0.5">
          {short.map(i => (
            <li key={i.ingredient_id}>
              <bdi className="font-semibold">{i.name}</bdi> : {t('besoin {n}, bon à cette date {u}', { n: fmtQty(Number(i.need), i.base_unit), u: fmtQty(Number(i.usable), i.base_unit) })}
              {Number(i.expiring) > 0 && <span className="text-muted"> · {t('{q} expire avant', { q: fmtQty(Number(i.expiring), i.base_unit) })}</span>}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-muted">{t('Calculé avec le stock d’aujourd’hui : une livraison ou une production avant la date peut combler le manque.')}</p>
      </div>
    </div>
  );
}
