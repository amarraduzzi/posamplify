// Le service discret: the calls of the guests from their table QR (a waiter, water, the bill).
// One poll for the whole till (every 8 s while a screen shows them), a chime for each new call.
import { useEffect, useState } from 'react';
import { BellRing, GlassWater, Receipt } from 'lucide-react';
import { supabase } from './supabase';
import { check, rpc } from './data';
import { chime } from './sound';
import { t } from './i18n';

export type CallKind = 'waiter' | 'water' | 'bill';
export interface ServiceCall { id: string; table_id: string; kind: CallKind; created_at: string }

export const CALLS: Record<CallKind, { label: () => string; Icon: typeof BellRing }> = {
  waiter: { label: () => t('Un serveur'), Icon: BellRing },
  water: { label: () => t('De l’eau'), Icon: GlassWater },
  bill: { label: () => t('L’addition'), Icon: Receipt },
};

let calls: ServiceCall[] = [];
let rid: string | null = null;
let timer: number | null = null;
const seen = new Set<string>();
const subs = new Set<(c: ServiceCall[]) => void>();
let first = true;

async function poll() {
  if (!rid) return;
  try {
    const list = check(await supabase.from('service_calls').select('id,table_id,kind,created_at').eq('restaurant_id', rid)
      .is('done_at', null).gte('created_at', new Date(Date.now() - 3 * 3600_000).toISOString()).order('created_at')) as ServiceCall[];
    const fresh = list.some(c => !seen.has(c.id));
    list.forEach(c => seen.add(c.id));
    if (fresh && !first) chime();
    first = false;
    calls = list;
    subs.forEach(f => f(calls));
  } catch { /* offline: keep the last list */ }
}

/** the open calls of the restaurant; on: only with Amplify Maître */
export function useServiceCalls(restaurantId: string | null | undefined, on: boolean) {
  const [list, setList] = useState<ServiceCall[]>(calls);
  useEffect(() => {
    if (!on || !restaurantId) { setList([]); return; }
    if (rid !== restaurantId) { rid = restaurantId; calls = []; seen.clear(); first = true; }
    subs.add(setList);
    if (timer === null) { void poll(); timer = window.setInterval(poll, 8000); }
    setList(calls);
    return () => { subs.delete(setList); if (!subs.size && timer !== null) { window.clearInterval(timer); timer = null; } };
  }, [restaurantId, on]);
  return list;
}

/** a waiter answered: one call, or every call of a table */
export async function serviceDone(restaurantId: string, x: { callId?: string; tableId?: string }, staffId: string | null) {
  calls = calls.filter(c => (x.callId ? c.id !== x.callId : c.table_id !== x.tableId));
  subs.forEach(f => f(calls));
  await rpc('pos_service_done', { p_restaurant_id: restaurantId, p_call_id: x.callId ?? null, p_table_id: x.tableId ?? null, p_staff_id: staffId });
}
