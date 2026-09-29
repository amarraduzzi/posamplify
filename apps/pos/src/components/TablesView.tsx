import { QrCode, ShoppingBag, Clock } from 'lucide-react';
import { usePos, type OrderTarget } from '../store';
import { mad, minutesSince } from '../lib/format';
import { Star8 } from './Brand';
import { t } from '../lib/i18n';

export function TablesView({ onOpen }: { onOpen: (t: OrderTarget) => void }) {
  const pos = usePos();
  const byTable = new Map<string, typeof pos.orders>();
  pos.orders.forEach(o => { if (o.table_id) byTable.set(o.table_id, [...(byTable.get(o.table_id) ?? []), o]); });
  const zones = [...new Set(pos.tables.map(x => x.zone ?? ''))];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-5 text-xs font-semibold text-muted">
        <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border border-line/20 bg-surface" /> {t('Libre')}</span>
        <span className="flex items-center gap-1.5"><i className="gold-fill h-3 w-3 rounded" /> {t('Occupée')}</span>
        <span className="flex items-center gap-1.5"><i className="grid h-4 w-4 place-items-center rounded-full bg-qr"><QrCode className="h-2.5 w-2.5 text-white" /></i> {t('Commande client (QR)')}</span>
        <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border-2 border-qr" /> {t('À accepter')}</span>
      </div>
      {zones.map(z => (
        <section key={z}>
          {z && <h2 className="mb-3 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em] text-muted">{z}<span className="h-px flex-1 bg-line/[0.08]" /></h2>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3.5">
            {pos.tables.filter(x => (x.zone ?? '') === z).map(tb => {
              const os = byTable.get(tb.id) ?? [];
              const total = os.reduce((s, o) => s + Number(o.total_cents), 0);
              const qr = os.some(o => o.source === 'qr');
              const pending = os.some(o => o.source === 'qr' && o.status === 'new');
              const since = os.length ? minutesSince(os[0].created_at) : 0;
              return (
                <button key={tb.id} onClick={() => onOpen({ kind: 'table', tableId: tb.id })}
                  className={`group relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-3xl transition hover:-translate-y-0.5 active:scale-95 ${
                    os.length ? 'gold-fill text-brand-ink' : 'panel hover:border-brand/50'} ${pending ? 'blink' : ''}`}>
                  {!os.length && <Star8 filled={false} stroke={0.5} className="absolute h-[70%] w-[70%] text-line/[0.045] transition group-hover:text-brand/20" />}
                  {os.length > 0 && <Star8 className="absolute -bottom-6 -end-6 h-20 w-20 text-white/10" />}
                  {qr && <span className="absolute end-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-qr shadow-lg"><QrCode className="h-3.5 w-3.5 text-white" /></span>}
                  <span className={`relative font-display text-3xl font-semibold leading-none ${os.length ? '' : 'text-ink/90'}`}>{tb.label}</span>
                  {os.length > 0 && <>
                    <span className="relative mt-1.5 text-sm font-bold tabular">{mad(total)}</span>
                    <span className="relative mt-0.5 flex items-center gap-0.5 text-[11px] font-semibold opacity-70"><Clock className="h-3 w-3" />{t('{n} min', { n: since })}</span>
                  </>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <button onClick={() => onOpen({ kind: 'new', orderType: 'takeaway', source: 'pos' })}
        className="flex h-20 items-center px-8 justify-center gap-2 rounded-3xl border-2 border-dashed border-brand/40 font-bold text-brand transition hover:bg-brand/10">
        <ShoppingBag className="h-5 w-5" /> {t('Nouvelle commande à emporter')}
      </button>
      {!pos.tables.length && <p className="text-muted">{t('Aucune table configurée.')}</p>}
    </div>
  );
}
