// Traceability of one production: per ingredient, the lots that went into it (supplier, lot code, dates), and
// the part that came from stock without a date ("non tracé"). The figures come from the database (production_trace).
import { useEffect, useState } from 'react';
import { rpc } from '../lib/api';
import { dateLocale, t } from '../lib/i18n';
import { fmtQty } from '../lib/profit';
import { useAdminCtx } from '../store';
import type { ProductionTrace } from '../lib/types';
import { Btn, Modal } from './ui';

const dayText = (d: string | null) => d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export function ProductionTraceModal({ id, onClose }: { id: string; onClose: () => void }) {
  const a = useAdminCtx();
  const [d, setD] = useState<ProductionTrace | null>(null);
  useEffect(() => {
    let stop = false;
    rpc<ProductionTrace>('production_trace', { p_production_id: id }).then(x => { if (!stop) setD(x); }).catch(e => { if (!stop) { a.fail(e); onClose(); } });
    return () => { stop = true; };
  }, [id, a, onClose]);

  return (
    <Modal title={d ? `${t('Traçabilité')} · ${d.name}` : t('Traçabilité')} onClose={onClose} wide
      footer={<div className="flex justify-end"><Btn tone="ghost" onClick={onClose}>{t('Fermer')}</Btn></div>}>
      {!d ? <p className="text-muted">{t('Chargement…')}</p> : (
        <div className="space-y-4">
          <p className="text-sm text-muted">{t('Fabriqué le {d} : {q}', { d: dayText(d.produced_on), q: fmtQty(Number(d.qty), d.base_unit) })}{d.cancelled && <span className="ms-2 font-semibold">{t('Annulée')}</span>}</p>
          {!d.ingredients.length && <p className="text-muted">{t('Aucun ingrédient enregistré pour cette production.')}</p>}
          <ul className="space-y-3">
            {d.ingredients.map(i => (
              <li key={i.ingredient_id} className="rounded-2xl border border-line/[0.08] p-3">
                <p className="font-semibold"><bdi>{i.name}</bdi> <span className="font-normal text-muted">· {fmtQty(Number(i.used), i.base_unit)}</span></p>
                {i.lots.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm">
                    {i.lots.map((l, k) => (
                      <li key={k} className="flex flex-wrap gap-x-3 text-muted">
                        <span className="font-semibold text-ink">{fmtQty(Number(l.qty), i.base_unit)}</span>
                        <span>{l.lot_code ? `${t('Lot')} ${l.lot_code}` : t('Sans n° de lot')}</span>
                        {l.supplier && <span>{l.supplier}</span>}
                        <span>{t('reçu le {d}', { d: dayText(l.received_on) })}</span>
                        <span>{t('expire le {d}', { d: dayText(l.expires_on) })}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {Number(i.untraced) > 0.0005 && <p className="mt-2 text-sm text-warn">{t('{q} non tracé (stock sans date)', { q: fmtQty(Number(i.untraced), i.base_unit) })}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
