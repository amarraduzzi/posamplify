import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isNetworkError } from './lib/supabase';
import * as db from './lib/data';
import * as P from './lib/print';
import { chime } from './lib/sound';
import { errorMessage } from './lib/errors';
import { uid } from './lib/format';
import { readCache, writeCache } from './lib/cache';
import { applyLang, t, type Lang } from './lib/i18n';
import { OfflineError, loadQueue, nextLocalRef, project, prune, saveQueue, send, type NewLine, type Op, type Queued } from './lib/outbox';
import type { Category, DraftLine, FiscalDoc, Item, Line, Order, Restaurant, Staff, Table } from './lib/types';

export type OrderTarget =
  | { kind: 'table'; tableId: string }
  | { kind: 'order'; orderId: string }
  | { kind: 'new'; orderType: 'takeaway' | 'delivery'; source: 'pos' | 'phone' | 'glovo' };

export interface Toast { id: number; text: string; tone: 'ok' | 'error' | 'info' }

/** Result of a payment: the fiscal ticket (online) or a provisional receipt (offline, ticket follows). */
export type PayResult = { doc: FiscalDoc } | { provisional: string };

type StaticData = { staff: Staff[]; tables: Table[]; categories: Category[]; items: Item[] };
const sleep = (ms: number) => new Promise<void>(r => window.setTimeout(r, ms));
const now = () => new Date().toISOString();

function usePosState() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [memberships, setMemberships] = useState<{ restaurant: Restaurant; role: string }[] | null>(null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [snapshot, setSnapshot] = useState<Order[]>([]);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [live, setLive] = useState(false);
  const [online, setOnline] = useState<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  const [lastSync, setLastSync] = useState<number>(0);
  const [printerOk, setPrinterOk] = useState(false);
  const [businessDate, setBusinessDate] = useState<string>('');
  const [dayClosed, setDayClosed] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- language: chosen on the till, remembered per staff member -----------
  const [lang, setLangState] = useState<Lang>(() => {
    const l = readCache<Lang>('pos-lang') === 'ar' ? 'ar' : 'fr';
    applyLang(l);
    return l;
  });
  const staffIdRef = useRef<string | null>(null);
  const setLang = useCallback((l: Lang) => {
    applyLang(l);
    setLangState(l);
    writeCache('pos-lang', l);
    if (staffIdRef.current) writeCache(`pos-lang-staff:${staffIdRef.current}`, l);
  }, []);
  useEffect(() => {
    staffIdRef.current = staff?.id ?? null;
    if (!staff) return;
    const mine = readCache<Lang>(`pos-lang-staff:${staff.id}`);
    if (mine && mine !== lang) { applyLang(mine); setLangState(mine); writeCache('pos-lang', mine); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff]);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  const fail = useCallback((e: unknown) => toast(errorMessage(e), 'error'), [toast]);

  // ---- auth ---------------------------------------------------------------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const sessionUser = session?.user?.id;
  const membershipCall = useRef(0);
  const refreshMemberships = useCallback(async () => {
    // only the latest call may apply its answer (a slow earlier one must not undo a fresh pairing)
    const call = ++membershipCall.current;
    // read the session now, not from this render: right after pairing, the caller's render is outdated
    const user = (await supabase.auth.getSession()).data.session?.user.id;
    if (call !== membershipCall.current) return;
    if (!user) { setMemberships(null); setRestaurant(null); return; }
    const cacheKey = `pos-memberships:${user}`;
    let ms: { restaurant: Restaurant; role: string }[] | null = null;
    try {
      ms = await db.myRestaurants(user);
      if (call !== membershipCall.current) return;
      writeCache(cacheKey, ms);
      setOnline(true);
    } catch (e) {
      if (call !== membershipCall.current) return;
      // no internet: start from what this till knew last time
      if (isNetworkError(e)) { setOnline(false); ms = readCache(cacheKey); }
      if (!ms) { setLoadError(isNetworkError(e) ? t('Pas de connexion internet, et ce poste n\'a encore rien enregistré. Reconnectez-le une première fois.') : errorMessage(e)); return; }
    }
    setLoadError(null);
    setMemberships(ms);
    const saved = localStorage.getItem('pos-restaurant');
    const pick = ms.find(m => m.restaurant.id === saved) ?? (ms.length === 1 ? ms[0] : null);
    setRestaurant(pick ? pick.restaurant : null);
  }, []);
  useEffect(() => { refreshMemberships(); }, [sessionUser, refreshMemberships]);

  const chooseRestaurant = (r: Restaurant) => { localStorage.setItem('pos-restaurant', r.id); setRestaurant(r); setStaff(null); };
  const logout = async () => { await supabase.auth.signOut(); setStaff(null); setRestaurant(null); };

  // ---- data: static (menu, tables, staff) ---------------------------------
  const rid = restaurant?.id ?? '';
  const reloadStatic = useCallback(async () => {
    if (!rid) return;
    const key = `pos-static:${rid}`;
    try {
      const s = await db.loadStatic(rid);
      setStaffList(s.staff); setTables(s.tables); setCategories(s.categories); setItems(s.items);
      writeCache(key, s);
      const rep = await db.dayReport(rid);
      setBusinessDate(rep.business_date); setDayClosed(!!rep.closed);
      writeCache(`pos-day:${rid}`, { business_date: rep.business_date, closed: !!rep.closed });
      setLoadError(null);
    } catch (e) {
      if (!isNetworkError(e)) { setLoadError(errorMessage(e)); return; }
      setOnline(false);
      const s = readCache<StaticData>(key);
      if (s) { setStaffList(s.staff); setTables(s.tables); setCategories(s.categories); setItems(s.items); }
      const d = readCache<{ business_date: string; closed: boolean }>(`pos-day:${rid}`);
      if (d) { setBusinessDate(d.business_date); setDayClosed(d.closed); }
      if (!s) setLoadError(t('Pas de connexion internet, et le menu n\'est pas encore enregistré sur ce poste.'));
    }
  }, [rid]);

  // ---- data: orders = server snapshot + local queue ------------------------
  const snapRef = useRef<Order[]>([]);
  const queueRef = useRef<Queued[]>([]);
  const onlineRef = useRef(online);
  onlineRef.current = online;

  const setSnap = useCallback((s: Order[]) => {
    snapRef.current = s; setSnapshot(s);
    if (rid) writeCache(`pos-orders:${rid}`, s);
  }, [rid]);
  const changeQueue = useCallback((fn: (q: Queued[]) => Queued[]) => {
    queueRef.current = fn(queueRef.current);
    if (rid) saveQueue(rid, queueRef.current);
    setQueue(queueRef.current);
  }, [rid]);

  // restore what the till knew (works without internet)
  useEffect(() => {
    if (!rid) return;
    snapRef.current = readCache<Order[]>(`pos-orders:${rid}`) ?? [];
    setSnapshot(snapRef.current);
    queueRef.current = loadQueue(rid);
    setQueue(queueRef.current);
  }, [rid]);

  const orders = useMemo(() => project(snapshot, queue), [snapshot, queue]);
  const current = () => project(snapRef.current, queueRef.current);

  const flushing = useRef<Promise<boolean> | null>(null);
  const interactive = useRef(new Set<number>());
  const reloadOrdersRef = useRef<() => Promise<void>>(async () => {});

  /** Sends the queue in order. Resolves true when everything pending went through. */
  const flush = useCallback((): Promise<boolean> => {
    if (flushing.current) return flushing.current;
    const run = (async () => {
      let changed = false;
      let reachedEnd = false;
      for (;;) {
        const next = queueRef.current.find(q => q.state === 'pending');
        if (!next) { reachedEnd = true; break; }
        try {
          const result = await send(next.op);
          changeQueue(q => q.map(x => x.seq === next.seq ? { ...x, state: 'done', done_at: Date.now(), result } : x));
          changed = true;
          setOnline(true);
          if (next.op.kind === 'pay' && result && !interactive.current.has(next.seq)) {
            toast(t('Ticket {n} émis ({label}, payé hors ligne)', { n: result.doc_number, label: next.op.req.label }), 'ok');
          }
        } catch (e) {
          if (e instanceof OfflineError) { setOnline(false); break; }
          if (/JWT|PGRST30/i.test((e as Error).message)) { await supabase.auth.refreshSession().catch(() => {}); break; }
          changeQueue(q => q.map(x => x.seq === next.seq ? { ...x, state: 'failed', error: errorMessage(e) } : x));
          changed = true;
        }
      }
      if (changed) await reloadOrdersRef.current();
      return reachedEnd;
    })();
    flushing.current = run;
    run.finally(() => { if (flushing.current === run) flushing.current = null; });
    return run;
  }, [changeQueue, toast]);

  const reloadOrders = useCallback(async () => {
    if (!rid) return;
    const started = Date.now();
    try {
      const s = await db.loadOpenOrders(rid);
      setSnap(s);
      setLastSync(Date.now());
      const wasOffline = !onlineRef.current;
      setOnline(true);
      changeQueue(q => prune(q, started));
      if (queueRef.current.some(q => q.state === 'pending')) void flush();
      if (wasOffline) void reloadStatic();
    } catch (e) {
      if (isNetworkError(e)) setOnline(false);
    }
  }, [rid, setSnap, changeQueue, flush, reloadStatic]);
  reloadOrdersRef.current = reloadOrders;

  useEffect(() => {
    if (!rid) return;
    reloadStatic(); reloadOrders();
    const stop = db.watchOrders(rid, reloadOrders, setLive);
    const again = window.setInterval(reloadStatic, 5 * 60000); // menu edits, new staff, day change
    const back = () => { void reloadOrders(); };
    window.addEventListener('online', back);
    const offline = () => setOnline(false);
    window.addEventListener('offline', offline);
    return () => { stop(); window.clearInterval(again); window.removeEventListener('online', back); window.removeEventListener('offline', offline); };
  }, [rid, reloadStatic, reloadOrders]);

  // while offline, look for the connection more often than the normal poll
  useEffect(() => {
    if (online || !rid) return;
    const t = window.setInterval(() => { void reloadOrders(); }, 5000);
    return () => window.clearInterval(t);
  }, [online, rid, reloadOrders]);

  const enqueue = useCallback((ops: Op[]) => {
    const base = Math.max(Date.now() * 100, ...queueRef.current.map(q => q.seq + 1));
    const added: Queued[] = ops.map((op, i) => ({ seq: base + i, op, state: 'pending', created_at: now() }));
    changeQueue(q => [...q, ...added]);
    if (onlineRef.current) void flush();
    return added.map(a => a.seq);
  }, [changeQueue, flush]);

  /** Waits for the queue to go through, at most `ms` (online only; offline returns at once). */
  const settle = useCallback(async (ms: number) => {
    if (!onlineRef.current) return;
    await Promise.race([flush(), sleep(ms)]);
  }, [flush]);

  const retryFailed = useCallback((seq?: number) => {
    changeQueue(q => q.map(x => x.state === 'failed' && (seq === undefined || x.seq === seq) ? { ...x, state: 'pending', error: undefined } : x));
    void flush();
  }, [changeQueue, flush]);
  const dismissFailed = useCallback((seq: number) => changeQueue(q => q.filter(x => x.seq !== seq)), [changeQueue]);

  useEffect(() => {
    const check = () => P.pingPrinter().then(setPrinterOk);
    check();
    const t = window.setInterval(check, 30000);
    return () => window.clearInterval(t);
  }, []);

  // ---- derived --------------------------------------------------------------
  const tableById = useMemo(() => new Map(tables.map(t => [t.id, t])), [tables]);
  const staffById = useMemo(() => new Map(staffList.map(s => [s.id, s])), [staffList]);
  // ---- live stock: dishes sold out by stock and the ones with few portions left (Amplify Profit)
  const [stockLevels, setStockLevels] = useState<{ low: Record<string, number>; sold_out: string[] } | null>(null);
  const refreshStock = useCallback(async () => {
    if (!rid || !restaurant?.products?.includes('profit') || !onlineRef.current) return;
    try { setStockLevels(await db.rpc<{ low: Record<string, number>; sold_out: string[] }>('pos_stock_levels', { p_restaurant_id: rid })); } catch { /* keep the last known */ }
  }, [rid, restaurant?.products]);
  useEffect(() => {
    setStockLevels(null); refreshStock();
    const id = window.setInterval(refreshStock, 60000);
    return () => window.clearInterval(id);
  }, [refreshStock]);
  const liveItems = useMemo(() => {
    if (!stockLevels) return items;
    const out = new Set(stockLevels.sold_out);
    return items.map(i => (out.has(i.id) === !i.available ? i : { ...i, available: !out.has(i.id) }));
  }, [items, stockLevels]);
  const stockLow = stockLevels?.low ?? {};
  const itemById = useMemo(() => new Map(liveItems.map(i => [i.id, i])), [liveItems]);
  const pendingQr = useMemo(() => orders.filter(o => o.source === 'qr' && o.status === 'new'), [orders]);
  const labelOf = useCallback((o: Order) => P.orderLabel(o, o.table_id ? tableById.get(o.table_id)?.label : null, t), [tableById]);
  /** Same label in French, for printed tickets. */
  const printLabel = useCallback((o: Order) => P.orderLabel(o, o.table_id ? tableById.get(o.table_id)?.label : null), [tableById]);
  const pendingCount = queue.filter(q => q.state === 'pending').length;
  const failedOps = useMemo(() => queue.filter(q => q.state === 'failed'), [queue]);

  // Chime every 20 s while a guest order waits to be accepted.
  const qrCount = pendingQr.length;
  const lastChime = useRef(0);
  useEffect(() => {
    if (!qrCount) return;
    const ring = () => { if (Date.now() - lastChime.current > 15000) { chime(); lastChime.current = Date.now(); } };
    ring();
    const t = window.setInterval(ring, 20000);
    return () => window.clearInterval(t);
  }, [qrCount]);

  // ---- actions --------------------------------------------------------------
  const settings = restaurant?.pos_settings ?? {};

  /** Prints the kitchen/bar bons of lines not sent yet, then marks them sent (queued, works offline). */
  const sendToKitchen = useCallback(async (o: Order, lines?: Line[]) => {
    const unsent = (lines ?? o.order_lines).filter(l => !l.kitchen_sent_at);
    if (!unsent.length || !restaurant) return;
    const byStation = new Map<string, Line[]>();
    unsent.forEach(l => byStation.set(l.station, [...(byStation.get(l.station) ?? []), l]));
    // a phone (no printer here): the till with the printer prints the bons
    if (!printerOk) {
      enqueue([{ kind: 'requestPrint', ids: unsent.map(l => l.id), at: now() }]);
      toast(t('Envoyé : le bon s’imprime à la caisse'), 'ok');
      return;
    }
    let printed = true;
    if (printerOk) {
      for (const [station, ls] of byStation) {
        try {
          await P.print(P.printerFor(settings, station), `Bon ${station}`, P.kitchenTicket(o, station, ls, printLabel(o), restaurant.timezone, staff?.name));
        } catch (e) { printed = false; fail(e); }
      }
    }
    enqueue([{ kind: 'markSent', ids: unsent.map(l => l.id), at: now() }]);
    if (printerOk && printed) toast(t('Bon envoyé en cuisine'), 'ok');
  }, [restaurant, printerOk, settings, printLabel, staff, fail, toast, enqueue]);

  // ---- bons sent from phones: this till has the printer, it prints them -----
  const claiming = useRef(false);
  const waiting = orders.some(o => o.order_lines.some(l => l.print_requested_at && !l.kitchen_sent_at));
  useEffect(() => {
    if (!printerOk || !online || !restaurant || !waiting || claiming.current) return;
    claiming.current = true;
    (async () => {
      try {
        const got = await db.rpc<{ id: string; order_id: string; station: string; quantity: number; name: string; note: string | null; staff_id: string | null }[]>('claim_kitchen_lines', { p_restaurant_id: restaurant.id });
        if (!got.length) return;
        await reloadOrdersRef.current();
        const all = current();
        const groups = new Map<string, typeof got>();
        got.forEach(l => groups.set(`${l.order_id}|${l.station}`, [...(groups.get(`${l.order_id}|${l.station}`) ?? []), l]));
        for (const ls of groups.values()) {
          const o = all.find(x => x.id === ls[0].order_id);
          if (!o) continue;
          const who = staffList.find(s => s.id === ls[0].staff_id)?.name;
          try { await P.print(P.printerFor(settings, ls[0].station), `Bon ${ls[0].station}`, P.kitchenTicket(o, ls[0].station, ls, printLabel(o), restaurant.timezone, who)); }
          catch (e) { fail(e); }
        }
      } catch (e) { if (!isNetworkError(e)) fail(e); }
      finally { claiming.current = false; }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printerOk, online, restaurant, waiting, orders]);

  /** Saves draft lines (creating the order if needed) and sends them to the kitchen. Works offline. */
  const commitDraft = useCallback(async (target: { order: Order | null; tableId: string | null; orderType: string; source: string;
    customer?: { name?: string; phone?: string; address?: string; ref?: string } }, draft: DraftLine[], opts: { send: boolean }) => {
    if (!restaurant) throw new Error('no restaurant');
    const ops: Op[] = [];
    let orderId = target.order?.id;
    if (!orderId) {
      orderId = uid();
      ops.push({ kind: 'createOrder', order: {
        id: orderId, restaurant_id: restaurant.id, client_id: uid(), source: target.source, order_type: target.orderType,
        table_id: target.tableId, staff_id: staff?.id ?? null,
        customer_name: target.customer?.name || null, customer_phone: target.customer?.phone || null,
        delivery_address: target.customer?.address || null, external_ref: target.customer?.ref || null,
        created_at: now(), local_ref: nextLocalRef(restaurant.id),
      } });
    }
    const lines: NewLine[] = draft.map(d => ({
      id: uid(), restaurant_id: restaurant.id, order_id: orderId!, menu_item_id: d.item_id, variant_id: d.variant_id,
      name: d.name, unit_price_cents: d.unit_price_cents, quantity: d.quantity, station: d.station,
      note: d.note || null, staff_id: staff?.id ?? null, created_at: now(), modifiers: d.modifiers ?? [],
    }));
    if (lines.length) ops.push({ kind: 'addLines', order_id: orderId, lines });
    enqueue(ops);
    // online: give the server a moment, so the kitchen bon carries the real ticket number
    await settle(4000);
    const order = current().find(o => o.id === orderId);
    if (!order) throw new Error(t('Commande introuvable.'));
    if (opts.send) {
      const ids = new Set(lines.map(l => l.id));
      await sendToKitchen(order, order.order_lines.filter(l => ids.has(l.id)));
    }
    return order;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant, staff, enqueue, settle, sendToKitchen]);

  /** Accept a guest (QR) order: join the table's running bill if there is one, print the bons. Needs the internet (QR orders come from it). */
  const acceptQr = useCallback(async (o: Order) => {
    try {
      let target = o;
      const others = o.table_id ? current().filter(x => x.table_id === o.table_id && x.id !== o.id && x.source !== 'qr') : [];
      if (others.length) {
        await db.rpc('pos_merge_orders', { p_target: others[0].id, p_sources: [o.id] });
        target = { ...others[0], order_lines: [...others[0].order_lines, ...o.order_lines] };
      }
      enqueue([{ kind: 'updateOrder', id: target.id, patch: { status: 'preparing' } }]);
      await sendToKitchen(target, o.order_lines);
      await reloadOrders();
      toast(t('Commande {ref} acceptée', { ref: P.ticketRef(o) }), 'ok');
    } catch (e) { fail(e); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enqueue, sendToKitchen, reloadOrders, toast, fail]);

  const updateOrder = useCallback((id: string, patch: Partial<Pick<Order, 'status' | 'note' | 'table_id'>>) =>
    enqueue([{ kind: 'updateOrder', id, patch }]), [enqueue]);
  const deleteLine = useCallback((id: string) => enqueue([{ kind: 'deleteLine', id }]), [enqueue]);
  /** Kitchen screen: lines ready (or recalled). When the whole order is ready, the order becomes "ready". */
  const markReady = useCallback((o: Order, ids: string[], ready: boolean) => {
    const at = ready ? now() : null;
    const ops: Op[] = [{ kind: 'markReady', ids, at }];
    const done = new Set(ids);
    const allReady = o.order_lines.every(l => (done.has(l.id) ? ready : !!l.ready_at));
    if (ready && allReady && (o.status === 'new' || o.status === 'preparing')) ops.push({ kind: 'updateOrder', id: o.id, patch: { status: 'ready' } });
    if (!ready && o.status === 'ready') ops.push({ kind: 'updateOrder', id: o.id, patch: { status: 'preparing' } });
    enqueue(ops);
  }, [enqueue]);

  /** Pays an order. Online: fiscal ticket right away. Offline: provisional receipt, the fiscal ticket is issued on reconnection. */
  const pay = useCallback(async (o: Order, payments: { method: string; amount_cents: number; tip_cents: number }[],
    buyer: { name: string; ice: string } | null, changeCents: number): Promise<PayResult | null> => {
    if (!restaurant) return null;
    const label = labelOf(o);
    const plabel = printLabel(o);
    const ops: Op[] = [];
    if (o.status === 'new') ops.push({ kind: 'updateOrder', id: o.id, patch: { status: 'served' } });
    ops.push({ kind: 'pay', req: { order_id: o.id, payments, staff_id: staff?.id ?? null, buyer, label, paid_at: now(), total_cents: Number(o.total_cents) } });
    const seqs = enqueue(ops);
    const paySeq = seqs[seqs.length - 1];
    interactive.current.add(paySeq);
    try {
      await settle(15000);
    } finally { interactive.current.delete(paySeq); }
    const q = queueRef.current.find(x => x.seq === paySeq);
    if (q?.state === 'failed') {
      // refused by the server (not a connection problem): nothing was paid, show why
      changeQueue(list => list.filter(x => x.seq !== paySeq));
      throw new Error(q.error);
    }
    const drawer = payments.some(p => p.method === 'cash');
    if (q?.state === 'done' && q.result) {
      void refreshStock();
      if (printerOk) {
        try {
          await P.print(P.receiptPrinter(settings), `Ticket ${q.result.doc_number}`,
            P.fiscalTicket(restaurant, q.result, { label: plabel, staff: staff?.name, change_cents: changeCents }), { drawer });
        } catch (e) { fail(e); }
      }
      return { doc: q.result };
    }
    // still waiting for the server (offline or very slow): hand over a provisional receipt
    if (printerOk) {
      try {
        await P.print(P.receiptPrinter(settings), 'Recu provisoire',
          P.provisionalTicket(restaurant, o, { label: plabel, staff: staff?.name, payments, change_cents: changeCents, tz: restaurant.timezone }), { drawer });
      } catch (e) { fail(e); }
    }
    return { provisional: P.ticketRef(o) };
  }, [restaurant, staff, printerOk, settings, labelOf, printLabel, enqueue, settle, changeQueue, fail, refreshStock]);

  const printBill = useCallback(async (o: Order) => {
    if (!restaurant) return;
    try { await P.print(P.receiptPrinter(settings), 'Addition', P.billTicket(restaurant, o, printLabel(o), restaurant.timezone)); toast(t('Addition imprimée'), 'ok'); }
    catch (e) { fail(e); }
  }, [restaurant, settings, printLabel, toast, fail]);

  const reprintDoc = useCallback(async (d: FiscalDoc, label?: string, copy = true) => {
    if (!restaurant) return;
    try { await P.print(P.receiptPrinter(settings), `${copy ? 'Duplicata' : 'Document'} ${d.doc_number}`, P.fiscalTicket(restaurant, d, { label, staff: d.staff_id ? staffById.get(d.staff_id)?.name : undefined, copy })); if (copy) toast(t('Duplicata imprimé'), 'ok'); }
    catch (e) { fail(e); }
  }, [restaurant, settings, staffById, toast, fail]);

  const openDrawer = useCallback(async () => {
    try { await P.print(P.receiptPrinter(settings), 'Tiroir', [], { drawer: true, cut: false }); } catch (e) { fail(e); }
  }, [settings, fail]);

  /** Guard for actions that need the server (manager PIN, reports, credit notes). */
  const requireOnline = useCallback(() => {
    if (onlineRef.current) return true;
    toast(t('Connexion internet requise pour cette action.'), 'error');
    return false;
  }, [toast]);

  return {
    lang, setLang, session, memberships, restaurant, chooseRestaurant, logout, loadError, refreshMemberships,
    staffList, tables, categories, items: liveItems, stockLow, refreshStock, orders, staff, setStaff,
    live, online, lastSync, printerOk, businessDate, dayClosed, setDayClosed, toasts, toast, fail,
    tableById, staffById, itemById, pendingQr, labelOf, settings,
    queue, pendingCount, failedOps, retryFailed, dismissFailed, requireOnline,
    reloadOrders, reloadStatic, sendToKitchen, commitDraft, acceptQr, updateOrder, deleteLine, markReady, pay, printBill, reprintDoc, openDrawer,
  };
}

export type Pos = ReturnType<typeof usePosState>;
const Ctx = createContext<Pos | null>(null);
export function PosProvider({ children }: { children: ReactNode }) {
  const v = usePosState();
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
export const usePos = () => useContext(Ctx)!;
