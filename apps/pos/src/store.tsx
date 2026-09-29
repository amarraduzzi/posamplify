import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import * as db from './lib/data';
import * as P from './lib/print';
import { chime } from './lib/sound';
import { errorMessage } from './lib/errors';
import { uid } from './lib/format';
import type { Category, DraftLine, FiscalDoc, Item, Line, Order, Restaurant, Staff, Table } from './lib/types';

export type OrderTarget =
  | { kind: 'table'; tableId: string }
  | { kind: 'order'; orderId: string }
  | { kind: 'new'; orderType: 'takeaway' | 'delivery'; source: 'pos' | 'phone' | 'glovo' };

export interface Toast { id: number; text: string; tone: 'ok' | 'error' | 'info' }

function usePosState() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [memberships, setMemberships] = useState<{ restaurant: Restaurant; role: string }[] | null>(null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [live, setLive] = useState(false);
  const [lastSync, setLastSync] = useState<number>(0);
  const [printerOk, setPrinterOk] = useState(false);
  const [businessDate, setBusinessDate] = useState<string>('');
  const [dayClosed, setDayClosed] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

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
  const refreshMemberships = useCallback(async () => {
    if (!sessionUser) { setMemberships(null); setRestaurant(null); return; }
    try {
      const ms = await db.myRestaurants();
      setMemberships(ms);
      const saved = localStorage.getItem('pos-restaurant');
      const pick = ms.find(m => m.restaurant.id === saved) ?? (ms.length === 1 ? ms[0] : null);
      setRestaurant(pick ? pick.restaurant : null);
    } catch (e) { setLoadError(errorMessage(e)); }
  }, [sessionUser]);
  useEffect(() => { refreshMemberships(); }, [refreshMemberships]);

  const chooseRestaurant = (r: Restaurant) => { localStorage.setItem('pos-restaurant', r.id); setRestaurant(r); setStaff(null); };
  const logout = async () => { await supabase.auth.signOut(); setStaff(null); setRestaurant(null); };

  // ---- data -----------------------------------------------------------------
  const rid = restaurant?.id ?? '';
  const reloadStatic = useCallback(async () => {
    if (!rid) return;
    try {
      const s = await db.loadStatic(rid);
      setStaffList(s.staff); setTables(s.tables); setCategories(s.categories); setItems(s.items);
      const rep = await db.dayReport(rid);
      setBusinessDate(rep.business_date); setDayClosed(!!rep.closed);
      setLoadError(null);
    } catch (e) { setLoadError(errorMessage(e)); }
  }, [rid]);

  const reloadOrders = useCallback(async () => {
    if (!rid) return;
    try { setOrders(await db.loadOpenOrders(rid)); setLastSync(Date.now()); } catch { /* keep last known */ }
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    reloadStatic(); reloadOrders();
    const stop = db.watchOrders(rid, reloadOrders, setLive);
    const again = window.setInterval(reloadStatic, 5 * 60000); // menu edits, new staff, day change
    return () => { stop(); window.clearInterval(again); };
  }, [rid, reloadStatic, reloadOrders]);

  useEffect(() => {
    const check = () => P.pingPrinter().then(setPrinterOk);
    check();
    const t = window.setInterval(check, 30000);
    return () => window.clearInterval(t);
  }, []);

  // ---- derived --------------------------------------------------------------
  const tableById = useMemo(() => new Map(tables.map(t => [t.id, t])), [tables]);
  const staffById = useMemo(() => new Map(staffList.map(s => [s.id, s])), [staffList]);
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const pendingQr = useMemo(() => orders.filter(o => o.source === 'qr' && o.status === 'new'), [orders]);
  const labelOf = useCallback((o: Order) => P.orderLabel(o, o.table_id ? tableById.get(o.table_id)?.label : null), [tableById]);

  // Chime every 20 s while a guest order waits to be accepted.
  const pendingCount = pendingQr.length;
  const lastChime = useRef(0);
  useEffect(() => {
    if (!pendingCount) return;
    const ring = () => { if (Date.now() - lastChime.current > 15000) { chime(); lastChime.current = Date.now(); } };
    ring();
    const t = window.setInterval(ring, 20000);
    return () => window.clearInterval(t);
  }, [pendingCount]);

  // ---- actions --------------------------------------------------------------
  const settings = restaurant?.pos_settings ?? {};

  /** Prints the kitchen/bar bons of lines not sent yet, then marks them sent. */
  const sendToKitchen = useCallback(async (o: Order, lines?: Line[]) => {
    const unsent = (lines ?? o.order_lines).filter(l => !l.kitchen_sent_at);
    if (!unsent.length || !restaurant) return;
    const byStation = new Map<string, Line[]>();
    unsent.forEach(l => byStation.set(l.station, [...(byStation.get(l.station) ?? []), l]));
    let printed = true;
    if (printerOk) {
      for (const [station, ls] of byStation) {
        try {
          await P.print(P.printerFor(settings, station), `Bon ${station}`, P.kitchenTicket(o, station, ls, labelOf(o), restaurant.timezone, staff?.name));
        } catch (e) { printed = false; fail(e); }
      }
    }
    await db.markSent(unsent.map(l => l.id));
    if (printerOk && printed) toast('Bon envoyé en cuisine', 'ok');
  }, [restaurant, printerOk, settings, labelOf, staff, fail, toast]);

  /** Saves draft lines (creating the order if needed) and sends them to the kitchen. */
  const commitDraft = useCallback(async (target: { order: Order | null; tableId: string | null; orderType: string; source: string;
    customer?: { name?: string; phone?: string; address?: string; ref?: string } }, draft: DraftLine[], opts: { send: boolean }) => {
    if (!restaurant) throw new Error('no restaurant');
    let order = target.order;
    if (!order) {
      order = await db.createOrder({
        restaurant_id: restaurant.id, client_id: uid(), source: target.source, order_type: target.orderType,
        table_id: target.tableId, staff_id: staff?.id ?? null,
        customer_name: target.customer?.name || null, customer_phone: target.customer?.phone || null,
        delivery_address: target.customer?.address || null, external_ref: target.customer?.ref || null,
      });
    }
    const inserted = await db.addLines(restaurant.id, order.id, staff?.id ?? null, draft.map(d => ({
      item_id: d.item_id, variant_id: d.variant_id, name: d.name, unit_price_cents: d.unit_price_cents,
      quantity: d.quantity, note: d.note, station: d.station,
    }))) as Line[];
    if (opts.send) await sendToKitchen(order, inserted);
    await reloadOrders();
    return order;
  }, [restaurant, staff, sendToKitchen, reloadOrders]);

  /** Accept a guest (QR) order: join the table's running bill if there is one, print the bons. */
  const acceptQr = useCallback(async (o: Order) => {
    try {
      let target = o;
      const others = o.table_id ? orders.filter(x => x.table_id === o.table_id && x.id !== o.id && x.source !== 'qr') : [];
      if (others.length) {
        await db.rpc('pos_merge_orders', { p_target: others[0].id, p_sources: [o.id] });
        target = { ...others[0], order_lines: [...others[0].order_lines, ...o.order_lines] };
      }
      await db.updateOrder(target.id, { status: 'preparing' });
      await sendToKitchen(target, o.order_lines);
      await reloadOrders();
      toast(`Commande #${o.ticket_number} acceptée`, 'ok');
    } catch (e) { fail(e); }
  }, [orders, sendToKitchen, reloadOrders, toast, fail]);

  const pay = useCallback(async (o: Order, payments: { method: string; amount_cents: number; tip_cents: number }[],
    buyer: { name: string; ice: string } | null, changeCents: number) => {
    if (!restaurant) return null;
    const doc = await db.rpc<FiscalDoc>('pos_pay_order', { p_order_id: o.id, p_payments: payments, p_staff_id: staff?.id ?? null, p_buyer: buyer });
    if (o.status === 'new') await db.updateOrder(o.id, { status: 'served' }).catch(() => {});
    if (printerOk) {
      try {
        await P.print(P.receiptPrinter(settings), `Ticket ${doc.doc_number}`,
          P.fiscalTicket(restaurant, doc, { label: labelOf(o), staff: staff?.name, change_cents: changeCents }),
          { drawer: payments.some(p => p.method === 'cash') });
      } catch (e) { fail(e); }
    }
    await reloadOrders();
    return doc;
  }, [restaurant, staff, printerOk, settings, labelOf, reloadOrders, fail]);

  const printBill = useCallback(async (o: Order) => {
    if (!restaurant) return;
    try { await P.print(P.receiptPrinter(settings), 'Addition', P.billTicket(restaurant, o, labelOf(o), restaurant.timezone)); toast('Addition imprimée', 'ok'); }
    catch (e) { fail(e); }
  }, [restaurant, settings, labelOf, toast, fail]);

  const reprintDoc = useCallback(async (d: FiscalDoc, label?: string, copy = true) => {
    if (!restaurant) return;
    try { await P.print(P.receiptPrinter(settings), `${copy ? 'Duplicata' : 'Document'} ${d.doc_number}`, P.fiscalTicket(restaurant, d, { label, staff: d.staff_id ? staffById.get(d.staff_id)?.name : undefined, copy })); if (copy) toast('Duplicata imprimé', 'ok'); }
    catch (e) { fail(e); }
  }, [restaurant, settings, staffById, toast, fail]);

  const openDrawer = useCallback(async () => {
    try { await P.print(P.receiptPrinter(settings), 'Tiroir', [], { drawer: true, cut: false }); } catch (e) { fail(e); }
  }, [settings, fail]);

  return {
    session, memberships, restaurant, chooseRestaurant, logout, loadError, refreshMemberships,
    staffList, tables, categories, items, orders, staff, setStaff,
    live, lastSync, printerOk, businessDate, dayClosed, setDayClosed, toasts, toast, fail,
    tableById, staffById, itemById, pendingQr, labelOf, settings,
    reloadOrders, reloadStatic, sendToKitchen, commitDraft, acceptQr, pay, printBill, reprintDoc, openDrawer,
  };
}

export type Pos = ReturnType<typeof usePosState>;
const Ctx = createContext<Pos | null>(null);
export function PosProvider({ children }: { children: ReactNode }) {
  const v = usePosState();
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
export const usePos = () => useContext(Ctx)!;
