import { supabase } from './supabase';
import type { CashMovement, Category, DayReport, FiscalDoc, Item, Order, Restaurant, Staff, Table, Variant } from './types';

/** Raises the database error message (our machine readable codes). */
export function check<T>(r: { data: T | null; error: { message: string; details?: string | null; code?: string } | null; status?: number }): T {
  if (r.error) {
    const e = new Error(r.error.message) as Error & { details?: string | null; status?: number; code?: string };
    e.details = r.error.details;
    e.status = r.status;
    e.code = r.error.code;
    throw e;
  }
  return r.data as T;
}

export async function myRestaurants(userId: string): Promise<{ restaurant: Restaurant; role: string }[]> {
  const ms = check(await supabase.from('memberships').select('role, restaurant_id').eq('user_id', userId));
  if (!ms.length) return [];
  const rs = check(await supabase.from('restaurants').select('*').in('id', ms.map(m => m.restaurant_id)));
  return rs.map(r => ({ restaurant: r as Restaurant, role: ms.find(m => m.restaurant_id === r.id)!.role }));
}

export async function loadStatic(rid: string) {
  const [staff, tables, cats, items, variants] = await Promise.all([
    supabase.from('staff').select('id,name,role,active').eq('restaurant_id', rid).eq('active', true).order('name'),
    supabase.from('dining_tables').select('id,label,zone,sort_order,active').eq('restaurant_id', rid).eq('active', true).order('sort_order').order('label'),
    supabase.from('categories').select('id,name,icon,station,sort_order').eq('restaurant_id', rid).eq('active', true).order('sort_order').order('created_at'),
    supabase.from('menu_items').select('id,category_id,name,price_cents,station,available,sort_order,image_url').eq('restaurant_id', rid).eq('active', true).order('sort_order').order('created_at'),
    supabase.from('item_variants').select('id,menu_item_id,name,price_cents,sort_order').eq('restaurant_id', rid).eq('active', true).order('sort_order').order('price_cents'),
  ]);
  const vs = check(variants) as Variant[];
  return {
    staff: check(staff) as Staff[],
    tables: (check(tables) as Table[]).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, 'fr', { numeric: true })),
    categories: check(cats) as Category[],
    items: (check(items) as Omit<Item, 'variants'>[]).map(i => ({ ...i, variants: vs.filter(v => v.menu_item_id === i.id) })) as Item[],
  };
}

export async function loadOpenOrders(rid: string): Promise<Order[]> {
  const rows = check(await supabase.from('orders')
    .select('*, order_lines(*)')
    .eq('restaurant_id', rid).is('closed_at', null).neq('status', 'cancelled')
    .order('created_at'));
  return (rows as Order[]).map(o => ({ ...o, order_lines: [...o.order_lines].sort((a, b) => a.created_at.localeCompare(b.created_at)) }));
}

/** Calls fn whenever orders or lines change (Realtime), plus a safety poll. */
export function watchOrders(rid: string, fn: () => void, onStatus: (live: boolean) => void): () => void {
  let t: number | undefined;
  const debounced = () => { window.clearTimeout(t); t = window.setTimeout(fn, 250); };
  const ch = supabase.channel(`orders-${rid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${rid}` }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'order_lines', filter: `restaurant_id=eq.${rid}` }, debounced)
    .subscribe(s => onStatus(s === 'SUBSCRIBED'));
  // Realtime can silently drop on flaky restaurant wifi: re-read regularly anyway.
  const poll = window.setInterval(fn, 10000);
  return () => { window.clearInterval(poll); window.clearTimeout(t); supabase.removeChannel(ch); };
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  return check(await supabase.rpc(fn, args)) as T;
}

export async function createOrder(o: { restaurant_id: string; client_id: string; source: string; order_type: string;
  table_id?: string | null; staff_id?: string | null; customer_name?: string | null; customer_phone?: string | null;
  delivery_address?: string | null; external_ref?: string | null; note?: string | null }): Promise<Order> {
  // idempotent: if this client_id already exists (retry after a timeout), reuse it
  const existing = check(await supabase.from('orders').select('*, order_lines(*)').eq('restaurant_id', o.restaurant_id).eq('client_id', o.client_id));
  if (existing.length) return existing[0] as Order;
  const row = check(await supabase.from('orders').insert({ ...o, business_date: '2000-01-01', ticket_number: 0 }).select('*, order_lines(*)').single());
  return row as unknown as Order;
}

export async function addLines(rid: string, orderId: string, staffId: string | null, lines: {
  item_id: string | null; variant_id: string | null; name: string; unit_price_cents: number; quantity: number; note: string; station: string }[]) {
  if (!lines.length) return [];
  return check(await supabase.from('order_lines').insert(lines.map(l => ({
    restaurant_id: rid, order_id: orderId, menu_item_id: l.item_id, variant_id: l.variant_id,
    name: l.name, unit_price_cents: l.unit_price_cents, quantity: l.quantity, vat_bp: null,
    station: l.station, note: l.note || null, staff_id: staffId,
  }))).select('*'));
}

export const updateOrder = async (id: string, patch: Record<string, unknown>) =>
  check(await supabase.from('orders').update(patch).eq('id', id).select('id'));
export const updateLine = async (id: string, patch: Record<string, unknown>) =>
  check(await supabase.from('order_lines').update(patch).eq('id', id).select('id'));
export const deleteLine = async (id: string) =>
  check(await supabase.from('order_lines').delete().eq('id', id).select('id'));
export const markSent = async (ids: string[]) => ids.length
  ? check(await supabase.from('order_lines').update({ kitchen_sent_at: new Date().toISOString() }).in('id', ids).select('id'))
  : [];

export async function todaysDocs(rid: string, businessDate: string): Promise<FiscalDoc[]> {
  return check(await supabase.from('fiscal_documents').select('*').eq('restaurant_id', rid)
    .eq('business_date', businessDate).order('chain_index', { ascending: false })) as FiscalDoc[];
}
export async function docById(id: string): Promise<FiscalDoc> {
  return check(await supabase.from('fiscal_documents').select('*').eq('id', id).single()) as FiscalDoc;
}
export const dayReport = (rid: string, date: string | null = null) =>
  rpc<DayReport>('day_report', { p_restaurant_id: rid, p_business_date: date });
export async function cashMovements(rid: string, date: string): Promise<CashMovement[]> {
  return check(await supabase.from('cash_movements').select('*').eq('restaurant_id', rid).eq('business_date', date).order('created_at')) as CashMovement[];
}
export async function addCashMovement(rid: string, kind: string, amount_cents: number, reason: string, staff_id: string | null) {
  return check(await supabase.from('cash_movements').insert({ restaurant_id: rid, business_date: '2000-01-01', kind, amount_cents, reason, staff_id }).select('id'));
}
