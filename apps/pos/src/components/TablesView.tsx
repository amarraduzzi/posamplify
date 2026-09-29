import { QrCode, ShoppingBag, Clock } from 'lucide-react';
import { usePos, type OrderTarget } from '../store';
import { mad, minutesSince } from '../lib/format';

export function TablesView({ onOpen }: { onOpen: (t: OrderTarget) => void }) {
  const pos = usePos();
  const byTable = new Map<string, typeof pos.orders>();
  pos.orders.forEach(o => { if (o.table_id) byTable.set(o.table_id, [...(byTable.get(o.table_id) ?? []), o]); });
  const zones = [...new Set(pos.tables.map(t => t.zone ?? ''))];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-muted">
        <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border border-line/20 bg-surface" /> Libre</span>
        <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-brand" /> Occupée</span>
        <span className="flex items-center gap-1.5"><i className="grid h-4 w-4 place-items-center rounded-full bg-qr"><QrCode className="h-2.5 w-2.5 text-white" /></i> Commande client (QR)</span>
        <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border-2 border-danger" /> À accepter</span>
      </div>
      {zones.map(z => (
        <section key={z}>
          {z && <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">{z}</h2>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-3">
            {pos.tables.filter(t => (t.zone ?? '') === z).map(t => {
              const os = byTable.get(t.id) ?? [];
              const total = os.reduce((s, o) => s + Number(o.total_cents), 0);
              const qr = os.some(o => o.source === 'qr');
              const pending = os.some(o => o.source === 'qr' && o.status === 'new');
              const since = os.length ? minutesSince(os[0].created_at) : 0;
              return (
                <button key={t.id} onClick={() => onOpen({ kind: 'table', tableId: t.id })}
                  className={`relative flex aspect-square flex-col items-center justify-center rounded-2xl border transition active:scale-95 ${
                    os.length ? 'border-brand bg-brand text-brand-ink shadow-lg shadow-black/30' : 'border-line/10 bg-surface hover:border-brand/60'} ${pending ? 'blink' : ''}`}>
                  {qr && <span className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full border-2 border-bg bg-qr"><QrCode className="h-3.5 w-3.5 text-white" /></span>}
                  <span className="text-2xl font-black leading-none">{t.label}</span>
                  {os.length > 0 && <>
                    <span className="mt-1 text-xs font-bold tabular">{mad(total)}</span>
                    <span className="mt-0.5 flex items-center gap-0.5 text-[11px] opacity-75"><Clock className="h-3 w-3" />{since} min</span>
                  </>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <button onClick={() => onOpen({ kind: 'new', orderType: 'takeaway', source: 'pos' })}
        className="flex h-24 w-full max-w-xs items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand/50 font-bold text-brand hover:bg-brand/10">
        <ShoppingBag className="h-5 w-5" /> Nouvelle commande à emporter
      </button>
      {!pos.tables.length && <p className="text-muted">Aucune table configurée.</p>}
    </div>
  );
}
