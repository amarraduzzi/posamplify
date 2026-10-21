import { useEffect, useState } from 'react';
import { QrCode, ShoppingBag, Clock, BellRing, LayoutGrid, Map as MapIcon, PencilRuler, CalendarClock } from 'lucide-react';
import { usePos, type OrderTarget } from '../store';
import { mad, minutesSince } from '../lib/format';
import { Star8 } from './Brand';
import { t } from '../lib/i18n';
import type { Table } from '../lib/types';
import { hhmm, PlanEditor, PlanView, placed, useTableBookings, type TableState } from './FloorPlan';
import { useReservations } from './Reservations';
import { useGuests } from './Guest';
import { rhythmOf } from '../lib/rhythm';
import { hasMaitre } from '../lib/occasion';
import { useOffers } from '../lib/offers';
import { PHASES, RhythmLine, CourseDots, RhythmSummary } from './Rhythm';
import { GuestMarks } from './FloorPlan';

type View = 'plan' | 'list';
const VIEW_KEY = 'pos-tables-view';
const readView = (): View | null => { try { const v = localStorage.getItem(VIEW_KEY); return v === 'plan' || v === 'list' ? v : null; } catch { return null; } };

export function TablesView({ onOpen }: { onOpen: (t: OrderTarget) => void }) {
  const pos = usePos();
  const byTable = new Map<string, typeof pos.orders>();
  pos.orders.forEach(o => { if (o.table_id) byTable.set(o.table_id, [...(byTable.get(o.table_id) ?? []), o]); });
  const zones = [...new Set(pos.tables.map(x => x.zone ?? ''))];
  // the kitchen screen marked a dish ready and nobody has served it yet: the waiter sees it at a glance
  const ready = new Set(pos.orders.filter(o => o.table_id && o.order_lines.some(l => l.ready_at && !l.served_at)).map(o => o.table_id!));
  const { list: resa } = useReservations(null);
  const maitre = hasMaitre(pos.restaurant);
  const offers = useOffers(pos.restaurant);
  const bookings = useTableBookings(resa);
  // the booking of a table that is arriving now (or seated, no bill yet): opening the table makes the bill theirs
  const arrivals = new Map<string, NonNullable<typeof resa>[number]>();
  for (const x of resa ?? []) {
    if (x.kind !== 'booking' || !x.table_id || !x.starts_at) continue;
    const at = Date.parse(x.starts_at), now = Date.now();
    const near = (['confirmed', 'requested'].includes(x.status) && at > now - 120 * 60000 && at < now + 45 * 60000)
      || (x.status === 'seated' && x.seated_at && Date.parse(x.seated_at) > now - 180 * 60000);
    if (near && !arrivals.has(x.table_id)) arrivals.set(x.table_id, x);
  }
  const guests = useGuests(pos.orders.filter(o => o.table_id).map(o => o.customer_id), [...bookings.values(), ...arrivals.values()].map(x => x.phone));
  const open = (tb: Table) => {
    const a = arrivals.get(tb.id);
    const of = a?.offer_id ? offers.find(o => o.id === a.offer_id) : undefined;
    if (!byTable.get(tb.id)?.length && a) onOpen({ kind: 'table', tableId: tb.id, guest: { name: a.name, phone: a.phone, occasion: a.occasion,
      offer: of ? { name: of.name, price_cents: Number(of.price_cents), party: a.party_size, choices: a.offer_choices ?? {} } : undefined } });
    else onOpen({ kind: 'table', tableId: tb.id });
  };

  const hasPlan = pos.tables.some(placed) || Object.values(pos.floorPlan.zones ?? {}).some(v => v.length);
  const phone = typeof window !== 'undefined' && window.innerWidth < 640;
  const [view, setViewS] = useState<View>(() => readView() ?? (hasPlan && !phone ? 'plan' : 'list'));
  const setView = (v: View) => { setViewS(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* fine */ } };
  const [zone, setZone] = useState(zones[0] ?? '');
  const [editing, setEditing] = useState(false);
  const curZone = zones.includes(zone) ? zone : zones[0] ?? '';

  // the minutes move on by themselves
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick(x => x + 1), 30000); return () => window.clearInterval(id); }, []);
  const state = (tb: Table): TableState => {
    const os = byTable.get(tb.id) ?? [];
    return {
      count: os.length, total: os.reduce((s, o) => s + Number(o.total_cents), 0),
      qr: os.some(o => o.source === 'qr'), pending: os.some(o => o.source === 'qr' && o.status === 'new'),
      since: os.length ? minutesSince(os[0].created_at) : 0, ready: ready.has(tb.id), booking: bookings.get(tb.id),
      rhythm: maitre && os.length ? rhythmOf(os, pos.orders) : null,
      guest: os.length ? guests.byId(os.find(o => o.customer_id)?.customer_id) : guests.byPhone((bookings.get(tb.id) ?? arrivals.get(tb.id))?.phone),
    };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-xs font-semibold text-muted">
        <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border border-line/20 bg-surface" /> {t('Libre')}</span>
        <span className="flex items-center gap-1.5"><i className="gold-fill h-3 w-3 rounded" /> {t('Occupée')}</span>
        <span className="flex items-center gap-1.5"><i className="grid h-4 w-4 place-items-center rounded-full bg-qr"><QrCode className="h-2.5 w-2.5 text-white" /></i> {t('Commande client (QR)')}</span>
        <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border-2 border-qr" /> {t('À accepter')}</span>
        {ready.size > 0 && <span className="flex items-center gap-1.5"><i className="grid h-4 w-4 place-items-center rounded-full bg-warn"><BellRing className="h-2.5 w-2.5 text-white" /></i> {t('Plat prêt à servir')}</span>}
        {bookings.size > 0 && <span className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5 text-sky-500" /> {t('Réservée bientôt')}</span>}
        {pos.tables.length > 0 && (
          <span className="ms-auto flex items-center gap-2">
            {view === 'plan' && (
              <button onClick={() => setEditing(true)} className="hidden items-center gap-1.5 sm:flex rounded-full bg-surface-2 px-3 py-1.5 text-xs font-bold text-muted hover:text-ink">
                <PencilRuler className="h-3.5 w-3.5" /> {t('Modifier le plan')}
              </button>
            )}
            <span className="flex rounded-full bg-surface-2 p-0.5">
              {([['plan', t('Plan'), MapIcon], ['list', t('Liste'), LayoutGrid]] as const).map(([id, l, I]) => (
                <button key={id} onClick={() => setView(id)} aria-pressed={view === id}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${view === id ? 'gold-fill text-brand-ink' : 'text-muted'}`}><I className="h-3.5 w-3.5" />{l}</button>
              ))}
            </span>
          </span>
        )}
      </div>

      {maitre && <RhythmSummary list={pos.tables.map(tb => { const os = byTable.get(tb.id) ?? []; return os.length ? rhythmOf(os, pos.orders) : null; }).filter((x): x is NonNullable<typeof x> => !!x)} />}

      {view === 'plan' && pos.tables.length > 0 && (hasPlan ? (
        <section className="space-y-3">
          {zones.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {zones.map(z => (
                <button key={z} onClick={() => setZone(z)}
                  className={`rounded-full px-4 py-1.5 text-sm font-bold ${curZone === z ? 'gold-fill text-brand-ink' : 'bg-surface-2 text-muted'}`}>{z || t('Salle')}</button>
              ))}
            </div>
          )}
          <PlanView zone={curZone} tables={pos.tables.filter(x => (x.zone ?? '') === curZone)} plan={pos.floorPlan} state={state} onOpen={x => (x.kind === 'table' ? open(pos.tableById.get(x.tableId)!) : onOpen(x))} />
        </section>
      ) : (
        <section className="panel flex flex-col items-center gap-3 rounded-3xl px-6 py-12 text-center">
          <PencilRuler className="h-8 w-8 text-brand" />
          <p className="font-display text-2xl font-semibold">{t('Dessinez votre salle')}</p>
          <p className="max-w-md text-sm text-muted">{t('Placez les tables comme dans le restaurant, avec le bar et l’entrée. Le serveur voit d’un coup d’œil quelles tables sont libres.')}</p>
          <button onClick={() => setEditing(true)} className="gold-fill mt-2 rounded-2xl px-6 py-3 font-bold text-brand-ink">{t('Dessiner le plan')}</button>
        </section>
      ))}

      {view === 'list' && zones.map(z => (
        <section key={z}>
          {z && <h2 className="mb-3 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em] text-muted">{z}<span className="h-px flex-1 bg-line/[0.08]" /></h2>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3.5">
            {pos.tables.filter(x => (x.zone ?? '') === z).map(tb => {
              const s = state(tb);
              return (
                <button key={tb.id} onClick={() => open(tb)}
                  className={`group relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-3xl transition hover:-translate-y-0.5 active:scale-95 ${
                    s.count ? 'gold-fill text-brand-ink' : 'panel hover:border-brand/50'} ${s.pending ? 'blink' : ''} ${s.rhythm?.late ? PHASES[s.rhythm.phase].ring : ''}`}>
                  {!s.count && <Star8 filled={false} stroke={0.5} className="absolute h-[70%] w-[70%] text-line/[0.045] transition group-hover:text-brand/20" />}
                  {s.count > 0 && <Star8 className="absolute -bottom-6 -end-6 h-20 w-20 text-white/10" />}
                  <GuestMarks g={s.guest} />
                  {s.qr && <span className="absolute end-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-qr shadow-lg"><QrCode className="h-3.5 w-3.5 text-white" /></span>}
                  <span className={`relative font-display text-3xl font-semibold leading-none ${s.count ? '' : 'text-ink/90'}`}>{tb.label}</span>
                  {s.count > 0 ? <>
                    <span className="relative mt-1.5 text-sm font-bold tabular">{mad(s.total)}</span>
                    {s.rhythm
                      ? <span className="relative flex flex-col items-center"><RhythmLine r={s.rhythm} /><CourseDots r={s.rhythm} /></span>
                      : <span className="relative mt-0.5 flex items-center gap-0.5 text-[11px] font-semibold opacity-70"><Clock className="h-3 w-3" />{t('{n} min', { n: s.since })}</span>}
                  </> : s.booking?.starts_at ? (
                    <span className="relative mt-1.5 flex items-center gap-1 text-[11px] font-bold text-sky-500"><CalendarClock className="h-3 w-3" />{hhmm(s.booking.starts_at, pos.restaurant?.timezone)}</span>
                  ) : null}
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
      {editing && <PlanEditor zones={zones} startZone={curZone} onClose={() => setEditing(false)} />}
    </div>
  );
}
