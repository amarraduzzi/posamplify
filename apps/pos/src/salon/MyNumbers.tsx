// "Mes chiffres": the person unlocked on the till sees their own month (revenue, clients, commission,
// tips, the days), after typing their PIN again: the reception tablet is shared.
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePos } from '../store';
import { rpc } from '../lib/data';
import { mad } from '../lib/format';
import { t } from '../lib/i18n';
import { PIN_ERRORS } from '../lib/errors';
import { Modal } from '../components/ui';
import { PinPad } from '../components/PinPad';

interface Month {
  ok: boolean; error?: string; month: string; today: string; clients: number; services_cents: number; products_cents: number; has_plan: boolean;
  service_commission_cents: number; product_commission_cents: number; commission_cents: number; tips_cents: number;
  days: { date: string; cents: number; clients: number }[];
}
const shift = (m: string, n: number) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 10);

export function MyNumbers({ onClose }: { onClose: () => void }) {
  const pos = usePos();
  const r = pos.restaurant!;
  const me = pos.staff!;
  const [pin, setPin] = useState<string | null>(null);
  const [x, setX] = useState<Month | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async (p: string, month: string | null) => {
    setBusy(true); setErr(null);
    try {
      const res = await rpc<Month>('agenda_my_month', { p_restaurant_id: r.id, p_staff_id: me.id, p_pin: p, p_month: month });
      if (res.ok) { setX(res); setPin(p); } else setErr(PIN_ERRORS[res.error ?? 'invalid'] ?? t('Code incorrect.'));
    } catch (e) { pos.fail(e); }
    setBusy(false);
  };
  if (!x || !pin) return (
    <Modal title={t('Mes chiffres')} onClose={onClose}>
      <p className="mb-4 text-center text-sm text-muted">{t('{name}, tapez votre code pour voir vos chiffres.', { name: me.name })}</p>
      <PinPad onSubmit={p => load(p, null)} busy={busy} error={err} round />
    </Modal>
  );
  const max = Math.max(1, ...x.days.map(d => Number(d.cents)));
  const label = new Date(`${x.month}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const current = x.today.slice(0, 7) === x.month.slice(0, 7);
  const today = x.days.find(d => d.date === x.today);
  // every day of the month (up to today for the current month), with or without tickets
  const last = new Date(Date.UTC(+x.month.slice(0, 4), +x.month.slice(5, 7), 0)).getUTCDate();
  const upto = current ? Number(x.today.slice(8, 10)) : last;
  const all = Array.from({ length: upto }, (_, i) => { const date = `${x.month.slice(0, 8)}${String(i + 1).padStart(2, '0')}`; return x.days.find(d => d.date === date) ?? { date, cents: 0, clients: 0 }; });
  return (
    <Modal title={t('Mes chiffres · {name}', { name: me.name })} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex items-center justify-center gap-2">
          <button className="rounded-xl bg-surface-2 p-2.5" disabled={busy} onClick={() => load(pin, shift(x.month, -1))} aria-label={t('Mois précédent')}><ChevronLeft className="h-4 w-4 rtl:rotate-180" /></button>
          <span className="min-w-[10rem] text-center font-semibold first-letter:uppercase">{label}</span>
          <button className="rounded-xl bg-surface-2 p-2.5 disabled:opacity-30" disabled={busy || current} onClick={() => load(pin, shift(x.month, 1))} aria-label={t('Mois suivant')}><ChevronRight className="h-4 w-4 rtl:rotate-180" /></button>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={t('Prestations')} value={mad(x.services_cents)} />
          <Stat label={t('Clients')} value={String(x.clients)} />
          <Stat label={t('Ma commission')} value={x.has_plan ? mad(x.commission_cents) : '–'} sub={x.has_plan ? (Number(x.product_commission_cents) ? t('dont produits {m}', { m: mad(x.product_commission_cents) }) : undefined) : t('Pas encore de règle de paie')} />
          <Stat label={t('Pourboires')} value={mad(x.tips_cents)} />
        </div>
        {current && <p className="text-center text-sm text-muted">{t('Aujourd’hui : {m} · {n} client(s)', { m: mad(today?.cents ?? 0), n: today?.clients ?? 0 })}{Number(x.products_cents) ? ` · ${t('produits vendus ce mois : {m}', { m: mad(x.products_cents) })}` : ''}</p>}
        {x.days.length > 0 ? (
          <div className="panel rounded-3xl p-4">
            <div className="flex h-40 items-end gap-1">
              {all.map(d => (
                <div key={d.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${d.date} · ${mad(d.cents)}`}>
                  <div className="flex w-full flex-1 items-end"><div className={`w-full rounded-t-md ${d.date === x.today ? 'gold-fill' : Number(d.cents) ? 'bg-brand/60' : 'bg-surface-2'}`} style={{ height: Number(d.cents) ? `${Math.max(4, (Number(d.cents) / max) * 100)}%` : '3px' }} /></div>
                  <span className="text-[10px] text-muted tabular">{Number(d.date.slice(8)) % 5 === 1 || d.date === x.today ? d.date.slice(8) : ''}</span>
                </div>
              ))}
            </div>
          </div>
        ) : <p className="rounded-2xl bg-surface-2 p-6 text-center text-muted">{t('Pas encore de ticket ce mois-ci.')}</p>}
        <p className="text-xs text-muted">{t('Selon les tickets de la caisse, après remise. Votre salaire et vos avances se voient avec le propriétaire.')}</p>
      </div>
    </Modal>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="panel rounded-3xl p-4"><p className="text-sm text-muted">{label}</p><p className="mt-1 font-display text-2xl font-semibold tabular">{value}</p>{sub && <p className="text-xs text-muted">{sub}</p>}</div>;
}
