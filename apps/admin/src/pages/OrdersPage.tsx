// Amplify Commandes: guest orders (QR menu, online ordering) arrive here, live, with a sound.
// For restaurants without the till: accept with a preparation time, mark ready, served, or refuse.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellOff, Check, ChefHat, Clock, MapPin, MessageCircle, Phone, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { check, mad, rpc } from '../lib/api';
import { chime, unlockSound } from '../lib/chime';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn, Modal, inputCls } from '../components/ui';

export interface InboxLine { id: string; name: string; quantity: number; note: string | null; created_at: string }
export interface InboxOrder {
  id: string; ticket_number: number; status: 'new' | 'preparing' | 'ready' | 'served' | 'cancelled';
  order_type: 'dine_in' | 'takeaway' | 'delivery'; table_id: string | null; table_by_guest?: boolean;
  customer_name: string | null; customer_phone: string | null; delivery_address: string | null;
  delivery_location?: { lat: number; lng: number } | null; note: string | null;
  wanted_at?: string | null; eta_at?: string | null; total_cents: number; created_at: string;
  order_lines: InboxLine[];
}

const intl = (p: string) => { const d = p.replace(/\D/g, ''); return d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? '212' + d.slice(1) : d; };
const MINUTES = [10, 15, 20, 30, 45];

export function OrdersPage({ r }: { r: Restaurant }) {
  const a = useAdminCtx();
  const [orders, setOrders] = useState<InboxOrder[] | null>(null);
  const [tables, setTables] = useState<Record<string, string>>({});
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [refusing, setRefusing] = useState<InboxOrder | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const since = new Date(Date.now() - 36 * 3600_000).toISOString();
      const rows = check(await supabase.from('orders')
        .select('id, ticket_number, status, order_type, table_id, table_by_guest, customer_name, customer_phone, delivery_address, delivery_location, note, wanted_at, eta_at, total_cents, created_at, order_lines(id, name, quantity, note, created_at)')
        .eq('restaurant_id', r.id).eq('source', 'qr').gte('created_at', since).order('created_at', { ascending: true })) as unknown as InboxOrder[];
      setOrders(rows.map(o => ({ ...o, order_lines: [...o.order_lines].sort((x, y) => x.created_at.localeCompare(y.created_at)) })));
    } catch (e) { a.fail(e); }
  }, [r.id, a]);

  useEffect(() => {
    supabase.from('dining_tables').select('id, label').eq('restaurant_id', r.id)
      .then(({ data }) => setTables(Object.fromEntries((data ?? []).map(x => [x.id as string, x.label as string]))));
  }, [r.id]);

  // live: any change of an order of this restaurant reloads the list; a slow poll covers a dropped connection
  useEffect(() => {
    load();
    let timer = 0;
    const soon = () => { window.clearTimeout(timer); timer = window.setTimeout(load, 250); };
    const ch = supabase.channel(`inbox-${r.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${r.id}` }, soon)
      .subscribe();
    const iv = window.setInterval(() => { if (!document.hidden) load(); }, 20_000);
    return () => { window.clearTimeout(timer); window.clearInterval(iv); supabase.removeChannel(ch); };
  }, [load, r.id]);

  const fresh = useMemo(() => (orders ?? []).filter(o => o.status === 'new'), [orders]);

  // a chime for every order we have not seen yet, then every 25 s while something waits for an answer
  useEffect(() => {
    if (!orders) return;
    const ids = new Set(orders.map(o => o.id));
    if (seen.current && armed && orders.some(o => o.status === 'new' && !seen.current!.has(o.id))) chime();
    seen.current = ids;
  }, [orders, armed]);
  useEffect(() => {
    if (!armed || !fresh.length) return;
    const iv = window.setInterval(chime, 25_000);
    return () => window.clearInterval(iv);
  }, [armed, fresh.length]);
  useEffect(() => {
    const base = document.title;
    document.title = fresh.length ? `(${fresh.length}) ${t('Commandes')}` : base;
    return () => { document.title = base; };
  }, [fresh.length]);

  // keep the screen on while the page is armed (a kitchen tablet must not fall asleep)
  useEffect(() => {
    if (!armed || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null, stop = false;
    const get = async () => { try { lock = await navigator.wakeLock.request('screen'); } catch { /* not allowed: fine */ } };
    const vis = () => { if (!document.hidden && !stop) get(); };
    get(); document.addEventListener('visibilitychange', vis);
    return () => { stop = true; document.removeEventListener('visibilitychange', vis); void lock?.release(); };
  }, [armed]);

  const act = async (key: string, job: () => Promise<void>) => {
    setBusy(key);
    try { await job(); await load(); } catch (e) { a.fail(e); }
    setBusy(null);
  };
  const update = async (id: string, patch: Record<string, unknown>) => { check(await supabase.from('orders').update(patch).eq('id', id).select('id')); };

  return (
    <>
      <OrdersView
        orders={orders} tableLabel={id => (id ? tables[id] ?? null : null)} tz={r.timezone}
        armed={armed} onArm={() => { const ok = unlockSound(); setArmed(ok); if (ok) chime(); }} onMute={() => setArmed(false)}
        prepDefault={r.online?.prep_minutes ?? 20} busy={busy}
        onAccept={(o, min) => act(o.id, () => update(o.id, {
          status: 'preparing',
          ...(min ? { eta_at: new Date(Math.max(Date.now() + min * 60_000, o.wanted_at ? Date.parse(o.wanted_at) : 0)).toISOString() } : {}),
        }))}
        onReady={o => act(o.id, () => update(o.id, { status: 'ready' }))}
        onDone={o => act(o.id, () => update(o.id, { status: 'served' }))}
        onRefuse={setRefusing}
      />
      {refusing && <RefuseModal order={refusing} onClose={() => setRefusing(null)}
        onConfirm={reason => act(refusing.id, async () => { await rpc('inbox_refuse', { p_order_id: refusing.id, p_reason: reason || null }); setRefusing(null); })} />}
    </>
  );
}

const REASONS = ['Plus disponible', 'Trop de monde', 'Fermé'];
function RefuseModal({ order, onClose, onConfirm }: { order: InboxOrder; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={t('Refuser la commande #{n} ?', { n: order.ticket_number })} onClose={onClose}
      footer={<><Btn onClick={onClose}>{t('Annuler')}</Btn><Btn tone="danger" onClick={() => onConfirm(reason.trim())}>{t('Refuser')}</Btn></>}>
      <p className="mb-2 text-sm font-semibold">{t('Motif (facultatif)')}</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {REASONS.map(x => <button key={x} type="button" onClick={() => setReason(t(x))} className="rounded-full border border-line/15 px-3 py-1.5 text-sm font-semibold hover:bg-surface-2">{t(x)}</button>)}
      </div>
      <input className={inputCls} value={reason} maxLength={200} onChange={e => setReason(e.target.value)} aria-label={t('Motif (facultatif)')} />
    </Modal>
  );
}

const hm = (iso: string, tz: string) => new Date(iso).toLocaleTimeString(dateLocale(), { timeZone: tz, hour: '2-digit', minute: '2-digit' });
const TYPE: Record<InboxOrder['order_type'], string> = { dine_in: 'Sur place', takeaway: 'À emporter', delivery: 'Livraison' };
const DONE: Record<InboxOrder['order_type'], string> = { dine_in: 'Marquer servie', takeaway: 'Marquer remise', delivery: 'Marquer livrée' };

/** The screen itself: no data access, so it can be shown with any list of orders. */
export function OrdersView({ orders, tableLabel, tz, armed, onArm, onMute, prepDefault, busy, onAccept, onReady, onDone, onRefuse, now: nowProp }: {
  orders: InboxOrder[] | null; tableLabel: (id: string | null) => string | null; tz: string; armed: boolean; onArm: () => void; onMute: () => void;
  prepDefault: number; busy: string | null; now?: number;
  onAccept: (o: InboxOrder, minutes?: number) => void; onReady: (o: InboxOrder) => void; onDone: (o: InboxOrder) => void; onRefuse: (o: InboxOrder) => void;
}) {
  const [tick, setTick] = useState(Date.now());
  useEffect(() => { const iv = setInterval(() => setTick(Date.now()), 30_000); return () => clearInterval(iv); }, []);
  const now = nowProp ?? tick;
  const open = (orders ?? []).filter(o => ['new', 'preparing', 'ready'].includes(o.status))
    .sort((x, y) => ['new', 'preparing', 'ready'].indexOf(x.status) - ['new', 'preparing', 'ready'].indexOf(y.status) || x.created_at.localeCompare(y.created_at));
  const finished = (orders ?? []).filter(o => ['served', 'cancelled'].includes(o.status) && now - Date.parse(o.created_at) < 8 * 3600_000).reverse();
  const minutes = [...new Set([prepDefault, ...MINUTES])].sort((x, y) => x - y).slice(0, 5);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl">{t('Commandes')}</h1>
        <span className="flex items-center gap-1.5 text-sm text-muted"><span className="h-2 w-2 rounded-full bg-ok" />{t('En direct')}</span>
        {armed && <button onClick={onMute} className="ms-auto inline-flex items-center gap-1.5 rounded-full border border-line/15 px-3 py-1.5 text-sm font-semibold hover:bg-surface-2"><Bell className="h-4 w-4 text-ok" /> {t('Son activé')}</button>}
      </div>

      {!armed && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl bg-brand/15 p-4">
          <BellOff className="h-5 w-5 shrink-0" />
          <p className="min-w-0 flex-1 font-semibold">{t('Le son est coupé : touchez pour être alerté à chaque nouvelle commande.')}</p>
          <Btn tone="brand" onClick={onArm}><Bell className="h-4 w-4" /> {t('Activer le son')}</Btn>
        </div>
      )}

      {orders === null && <p className="text-muted">{t('Chargement…')}</p>}
      {orders !== null && !open.length && (
        <div className="rounded-3xl border border-dashed border-line/20 p-10 text-center">
          <ChefHat className="mx-auto mb-3 h-8 w-8 text-muted" />
          <p className="font-semibold">{t('Aucune commande pour le moment.')}</p>
          <p className="mt-1 text-sm text-muted">{t('Les nouvelles commandes apparaissent ici toutes seules.')}</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {open.map(o => <OrderCard key={o.id} o={o} tz={tz} now={now} table={tableLabel(o.table_id)} minutes={minutes} prepDefault={prepDefault} busy={busy === o.id}
          onAccept={onAccept} onReady={onReady} onDone={onDone} onRefuse={onRefuse} />)}
      </div>

      {finished.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-semibold text-muted">{t('Terminées aujourd’hui')} ({finished.length})</summary>
          <ul className="mt-3 divide-y divide-line/10 rounded-2xl border border-line/10">
            {finished.map(o => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <strong>#{o.ticket_number}</strong>
                <span className="text-muted">{hm(o.created_at, tz)}</span>
                <span>{t(TYPE[o.order_type])}{tableLabel(o.table_id) ? ` · ${tableLabel(o.table_id)}` : ''}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{o.order_lines.map(l => `${l.quantity}× ${l.name}`).join(', ')}</span>
                <span className={o.status === 'cancelled' ? 'font-semibold text-danger' : 'font-semibold text-ok'}>{o.status === 'cancelled' ? t('Refusée') : t('Terminée')}</span>
                <span className="font-semibold">{mad(o.total_cents)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = { new: 'bg-brand text-brand-ink', preparing: 'bg-night text-white', ready: 'bg-ok text-white' };
const STATUS_LABEL: Record<string, string> = { new: 'À accepter', preparing: 'En préparation', ready: 'Prête' };

function OrderCard({ o, tz, now, table, minutes, prepDefault, busy, onAccept, onReady, onDone, onRefuse }: {
  o: InboxOrder; tz: string; now: number; table: string | null; minutes: number[]; prepDefault: number; busy: boolean;
  onAccept: (o: InboxOrder, minutes?: number) => void; onReady: (o: InboxOrder) => void; onDone: (o: InboxOrder) => void; onRefuse: (o: InboxOrder) => void;
}) {
  const [picking, setPicking] = useState(false);
  const age = Math.max(0, Math.round((now - Date.parse(o.created_at)) / 60_000));
  const timed = o.order_type !== 'dine_in';
  const where = o.order_type === 'dine_in' ? (table ? t('Sur place · Table {n}', { n: table }) : t('Sur place')) : t(TYPE[o.order_type]);
  return (
    <div className={`flex flex-col rounded-3xl bg-white p-4 shadow-card ring-1 ${o.status === 'new' ? 'ring-2 ring-brand' : 'ring-line/10'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-2xl font-black">#{o.ticket_number}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLE[o.status]}`}>{t(STATUS_LABEL[o.status])}</span>
        <span className="ms-auto text-sm text-muted">{age < 1 ? t('à l’instant') : t('il y a {n} min', { n: age })}</span>
      </div>
      <p className="mt-1 text-sm font-semibold">{where}{o.table_by_guest ? <span className="ms-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">{t('Saisi par le client')}</span> : null}</p>
      {timed && o.wanted_at && <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold"><Clock className="h-4 w-4" /> {t('Pour {h}', { h: hm(o.wanted_at, tz) })}</p>}
      {o.status !== 'new' && o.eta_at && <p className="mt-1 flex items-center gap-1.5 text-sm text-muted"><Clock className="h-4 w-4" /> {t('Prête vers {h}', { h: hm(o.eta_at, tz) })}</p>}

      <ul className="mt-3 space-y-1.5 border-t border-line/10 pt-3">
        {o.order_lines.map(l => (
          <li key={l.id}><span className="font-bold">{l.quantity}×</span> {l.name}{l.note ? <span className="block ps-6 text-sm italic text-muted">{l.note}</span> : null}</li>
        ))}
      </ul>
      {o.note && <p className="mt-3 rounded-xl bg-brand/15 px-3 py-2 text-sm"><strong>{t('Note du client')} :</strong> {o.note}</p>}

      {timed && (o.customer_name || o.customer_phone || o.delivery_address) && (
        <div className="mt-3 space-y-1.5 border-t border-line/10 pt-3 text-sm">
          {o.customer_name && <p className="font-semibold">{o.customer_name}</p>}
          {o.customer_phone && (
            <div className="flex flex-wrap items-center gap-2" dir="ltr">
              <span>{o.customer_phone}</span>
              <a href={`tel:+${intl(o.customer_phone)}`} className="inline-flex items-center gap-1 rounded-full border border-line/15 px-2.5 py-1 font-semibold hover:bg-surface-2"><Phone className="h-3.5 w-3.5" /> {t('Appeler')}</a>
              <a href={`https://wa.me/${intl(o.customer_phone)}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-full border border-line/15 px-2.5 py-1 font-semibold hover:bg-surface-2"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</a>
            </div>
          )}
          {o.delivery_address && <p className="flex items-start gap-1.5"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /> <span>{o.delivery_address}{o.delivery_location && <> · <a className="font-semibold underline" target="_blank" rel="noopener" href={`https://www.google.com/maps?q=${o.delivery_location.lat},${o.delivery_location.lng}`}>{t('Ouvrir la carte')}</a></>}</span></p>}
        </div>
      )}

      <p className="mt-3 text-end text-lg font-black">{mad(o.total_cents)}</p>

      <div className="mt-auto space-y-2 pt-2">
        {o.status === 'new' && !picking && (
          <div className="flex gap-2">
            <Btn tone="brand" className="min-h-12 flex-1 !text-base" disabled={busy} onClick={() => timed ? setPicking(true) : onAccept(o)}><Check className="h-5 w-5" /> {t('Accepter')}</Btn>
            <Btn tone="ghost" className="min-h-12" disabled={busy} onClick={() => onRefuse(o)}><X className="h-5 w-5" /> {t('Refuser')}</Btn>
          </div>
        )}
        {o.status === 'new' && picking && (
          <div>
            <p className="mb-1.5 text-sm font-semibold">{t('Prête dans')}</p>
            <div className="flex flex-wrap gap-2">
              {minutes.map(m => <Btn key={m} tone={m === prepDefault ? 'brand' : 'ghost'} className="min-h-11 min-w-16" disabled={busy} onClick={() => onAccept(o, m)}>{m} min</Btn>)}
              <Btn tone="ghost" className="min-h-11" onClick={() => setPicking(false)}>{t('Retour')}</Btn>
            </div>
          </div>
        )}
        {o.status === 'preparing' && <Btn tone="brand" className="min-h-12 w-full !text-base" disabled={busy} onClick={() => onReady(o)}><Check className="h-5 w-5" /> {t('Commande prête')}</Btn>}
        {o.status === 'preparing' && <Btn tone="ghost" className="w-full" disabled={busy} onClick={() => onRefuse(o)}>{t('Refuser')}</Btn>}
        {o.status === 'ready' && <Btn tone="brand" className="min-h-12 w-full !text-base" disabled={busy} onClick={() => onDone(o)}><Check className="h-5 w-5" /> {t(DONE[o.order_type])}</Btn>}
      </div>
    </div>
  );
}
