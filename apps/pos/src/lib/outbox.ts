// Offline-first writes for the till.
//
// Every change the till makes (new order, lines, kitchen sent, status, note,
// table, payment) becomes an operation in a queue stored on the till. The
// screen shows the server's last known orders with the queue applied on top,
// so staff see their work instantly, online or not. A sync loop sends the
// queue in order as soon as the server is reachable.
//
// Replays are safe: orders and lines carry ids made on the till (a second
// insert of the same id does nothing), updates set absolute values, and a
// payment retried after a lost answer is recognised by the server
// ("order_already_closed") and resolved to the ticket it already issued.

import { supabase, isNetworkError } from './supabase';
import { check } from './data';
import { readCache, writeCache } from './cache';
import type { FiscalDoc, Line, Order } from './types';
import { t } from './i18n';

export interface NewOrder {
  id: string; restaurant_id: string; client_id: string; source: string; order_type: string;
  table_id: string | null; staff_id: string | null; customer_name: string | null; customer_phone: string | null;
  delivery_address: string | null; external_ref: string | null; created_at: string; local_ref: string;
}
export interface NewLine {
  id: string; restaurant_id: string; order_id: string; menu_item_id: string | null; variant_id: string | null;
  name: string; unit_price_cents: number; quantity: number; station: string; note: string | null;
  staff_id: string | null; created_at: string;
  /** chosen options: the server re-checks and re-prices them */
  modifiers?: { id: string; name: string; price_cents: number }[];
}
export interface PayRequest {
  order_id: string; payments: { method: string; amount_cents: number; tip_cents: number }[];
  staff_id: string | null; buyer: { name: string; ice: string } | null; label: string; paid_at: string; total_cents: number;
}

export type Op =
  | { kind: 'createOrder'; order: NewOrder }
  | { kind: 'addLines'; order_id: string; lines: NewLine[] }
  | { kind: 'markSent'; ids: string[]; at: string }
  | { kind: 'requestPrint'; ids: string[]; at: string }
  | { kind: 'markReady'; ids: string[]; at: string | null }
  | { kind: 'updateOrder'; id: string; patch: Partial<Pick<Order, 'status' | 'note' | 'table_id' | 'eta_at'>> }
  | { kind: 'updateLine'; id: string; patch: Partial<Pick<Line, 'quantity' | 'note'>> }
  | { kind: 'deleteLine'; id: string }
  | { kind: 'pay'; req: PayRequest };

export interface Queued {
  seq: number;
  op: Op;
  state: 'pending' | 'done' | 'failed';
  created_at: string;
  done_at?: number;
  error?: string;
  result?: FiscalDoc;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
const key = (rid: string) => `pos-outbox:${rid}`;
export const loadQueue = (rid: string) => readCache<Queued[]>(key(rid)) ?? [];
export const saveQueue = (rid: string, q: Queued[]) => writeCache(key(rid), q);

/** Short reference for orders made offline (printed until the server gives a ticket number). */
export function nextLocalRef(rid: string): string {
  const k = `pos-localref:${rid}`;
  const n = (readCache<number>(k) ?? 0) + 1;
  writeCache(k, n);
  return `H${n}`;
}

// ---------------------------------------------------------------------------
// Projection: server snapshot + queue = what the till shows
// ---------------------------------------------------------------------------
function recompute(o: Order) {
  o.subtotal_cents = o.order_lines.reduce((s, l) => s + Number(l.line_total_cents), 0);
  o.total_cents = Math.max(0, o.subtotal_cents - Number(o.discount_cents ?? 0));
}

export function project(snapshot: Order[], queue: Queued[]): Order[] {
  const orders = snapshot.map(o => ({ ...o, order_lines: [...o.order_lines] }));
  const byId = new Map(orders.map(o => [o.id, o]));
  const lineOwner = new Map<string, Order>();
  orders.forEach(o => o.order_lines.forEach(l => lineOwner.set(l.id, o)));
  const touched = new Set<Order>();
  const paid = new Set<string>();

  for (const q of queue) {
    if (q.state === 'failed') continue;
    const op = q.op;
    switch (op.kind) {
      case 'createOrder': {
        if (byId.has(op.order.id)) break;
        // a done create missing from a fresh snapshot means the order was closed or merged elsewhere
        if (q.state === 'done') break;
        const o: Order = {
          ...op.order, business_date: '', ticket_number: 0, status: 'new', note: null,
          subtotal_cents: 0, discount_cents: 0, total_cents: 0, closed_at: null, order_lines: [],
          source: op.order.source as Order['source'], order_type: op.order.order_type as Order['order_type'],
        };
        orders.push(o); byId.set(o.id, o);
        break;
      }
      case 'addLines': {
        const o = byId.get(op.order_id);
        if (!o) break;
        for (const l of op.lines) {
          if (lineOwner.has(l.id)) continue;
          const line: Line = {
            id: l.id, order_id: l.order_id, menu_item_id: l.menu_item_id, variant_id: l.variant_id, name: l.name,
            unit_price_cents: l.unit_price_cents, quantity: l.quantity, line_total_cents: l.unit_price_cents * l.quantity,
            station: l.station, note: l.note, kitchen_sent_at: null, created_at: l.created_at, modifiers: l.modifiers ?? [],
          };
          o.order_lines.push(line); lineOwner.set(l.id, o); touched.add(o);
        }
        break;
      }
      case 'markReady':
        for (const id of op.ids) {
          const l = lineOwner.get(id)?.order_lines.find(x => x.id === id);
          if (l) l.ready_at = op.at;
        }
        break;
      case 'requestPrint':
        for (const id of op.ids) {
          const o = lineOwner.get(id);
          const l = o?.order_lines.find(x => x.id === id);
          if (l && !l.kitchen_sent_at && !l.print_requested_at) l.print_requested_at = op.at;
        }
        break;
      case 'markSent':
        for (const id of op.ids) {
          const o = lineOwner.get(id);
          const l = o?.order_lines.find(x => x.id === id);
          if (l && !l.kitchen_sent_at) l.kitchen_sent_at = op.at;
        }
        break;
      case 'updateOrder': {
        const o = byId.get(op.id);
        if (o) Object.assign(o, op.patch);
        break;
      }
      case 'updateLine': {
        const o = lineOwner.get(op.id);
        const i = o ? o.order_lines.findIndex(x => x.id === op.id) : -1;
        if (o && i >= 0) {
          const l = { ...o.order_lines[i], ...op.patch };
          l.line_total_cents = l.unit_price_cents * l.quantity;
          o.order_lines[i] = l; touched.add(o);
        }
        break;
      }
      case 'deleteLine': {
        const o = lineOwner.get(op.id);
        if (o) { o.order_lines = o.order_lines.filter(x => x.id !== op.id); lineOwner.delete(op.id); touched.add(o); }
        break;
      }
      case 'pay':
        paid.add(op.req.order_id);
        break;
    }
  }
  touched.forEach(recompute);
  return orders.filter(o => !paid.has(o.id) && o.status !== 'cancelled').sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Done operations can be forgotten once a snapshot fetched after them already contains their effect. */
export function prune(queue: Queued[], snapshotStartedAt: number): Queued[] {
  return queue.filter(q => !(q.state === 'done' && (q.done_at ?? 0) < snapshotStartedAt));
}

// ---------------------------------------------------------------------------
// Sending one operation
// ---------------------------------------------------------------------------
export class OfflineError extends Error {}

const isDuplicate = (e: unknown) => {
  const x = e as { code?: string; message?: string };
  return x.code === '23505' || /duplicate key/i.test(x.message ?? '');
};

/** Sends one operation. Throws OfflineError when the server cannot be reached; other errors are real refusals. */
export async function send(op: Op): Promise<FiscalDoc | undefined> {
  try {
    switch (op.kind) {
      case 'createOrder': {
        const { local_ref: _ref, ...row } = op.order;
        const r = await supabase.from('orders').insert({ ...row, business_date: '2000-01-01', ticket_number: 0 });
        // already there (earlier attempt whose answer was lost): fine
        if (r.error && r.status !== 0 && isDuplicate(r.error)) return;
        check(r);
        return;
      }
      case 'addLines': {
        if (!op.lines.length) return;
        const rows = op.lines.map(l => ({ ...l, vat_bp: null }));
        check(await supabase.from('order_lines').upsert(rows, { onConflict: 'id', ignoreDuplicates: true }));
        return;
      }
      case 'markReady':
        if (op.ids.length) check(await supabase.from('order_lines').update({ ready_at: op.at }).in('id', op.ids));
        return;
      case 'requestPrint':
        if (op.ids.length) check(await supabase.from('order_lines').update({ print_requested_at: op.at }).in('id', op.ids).is('kitchen_sent_at', null));
        return;
      case 'markSent':
        if (op.ids.length) check(await supabase.from('order_lines').update({ kitchen_sent_at: op.at }).in('id', op.ids).is('kitchen_sent_at', null));
        return;
      case 'updateOrder':
        check(await supabase.from('orders').update(op.patch).eq('id', op.id));
        return;
      case 'updateLine':
        check(await supabase.from('order_lines').update(op.patch).eq('id', op.id));
        return;
      case 'deleteLine':
        check(await supabase.from('order_lines').delete().eq('id', op.id));
        return;
      case 'pay': {
        const r = op.req;
        try {
          return check(await supabase.rpc('pos_pay_order', {
            p_order_id: r.order_id, p_payments: r.payments, p_staff_id: r.staff_id, p_buyer: r.buyer,
          })) as FiscalDoc;
        } catch (e) {
          if (!/order_already_closed/.test((e as Error).message)) throw e;
          // first attempt went through but its answer was lost: fetch the ticket it issued
          const [o] = check(await supabase.from('orders').select('fiscal_document_id').eq('id', r.order_id)) as { fiscal_document_id: string | null }[];
          if (!o?.fiscal_document_id) throw e;
          return check(await supabase.from('fiscal_documents').select('*').eq('id', o.fiscal_document_id).single()) as FiscalDoc;
        }
      }
    }
  } catch (e) {
    if (isNetworkError(e)) throw new OfflineError((e as Error).message);
    throw e;
  }
}

/** Human description of an operation, for the sync panel. */
export function describe(op: Op, labelOf: (orderId: string) => string): string {
  switch (op.kind) {
    case 'createOrder': return t('Nouvelle commande {ref}', { ref: op.order.local_ref });
    case 'addLines': return `${t('{n} article(s)', { n: op.lines.reduce((n, l) => n + l.quantity, 0) })} · ${labelOf(op.order_id)}`;
    case 'markSent': return t('Bon cuisine ({n} ligne(s))', { n: op.ids.length });
    case 'markReady': return op.at ? t('Prêt en cuisine ({n} ligne(s))', { n: op.ids.length }) : t('Rappelé en cuisine ({n} ligne(s))', { n: op.ids.length });
    case 'requestPrint': return t('Bon à imprimer à la caisse ({n} ligne(s))', { n: op.ids.length });
    case 'updateOrder': return `${t('Mise à jour')} · ${labelOf(op.id)}`;
    case 'updateLine': return t("Modification d'article");
    case 'deleteLine': return t('Article retiré');
    case 'pay': return `${t('Encaissement')} ${op.req.label}`;
  }
}
