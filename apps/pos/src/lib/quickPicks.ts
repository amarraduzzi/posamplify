// What a waiter needs most on the phone: the dishes sold most at this time of day, and the remarks
// staff type most often. Read from the server once an hour, kept on the device for offline use.
import { useEffect, useState } from 'react';
import { rpc } from './data';
import { readCache, writeCache } from './cache';

export interface QuickPicks { popular: Record<string, string[]>; notes: Record<string, string[]>; common_notes: string[]; at?: number }
const EMPTY: QuickPicks = { popular: {}, notes: {}, common_notes: [] };
const key = (rid: string) => `quick-picks:${rid}`;
const loading = new Set<string>();

/** morning, noon, afternoon or evening, in the restaurant's time zone (the same parts as the server) */
export function dayPart(tz: string): string {
  let h = new Date().getHours();
  try { h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date())); } catch { /* local hour */ }
  return h >= 5 && h <= 10 ? 'morning' : h >= 11 && h <= 14 ? 'noon' : h >= 15 && h <= 17 ? 'afternoon' : 'evening';
}

export function useQuickPicks(rid: string): QuickPicks {
  const [qp, setQp] = useState<QuickPicks>(() => readCache<QuickPicks>(key(rid)) ?? EMPTY);
  useEffect(() => {
    if ((qp.at ?? 0) > Date.now() - 3600_000 || loading.has(rid)) return;
    loading.add(rid);
    rpc<QuickPicks>('pos_quick_picks', { p_restaurant_id: rid })
      .then(x => { const v = { ...EMPTY, ...x, at: Date.now() }; writeCache(key(rid), v); setQp(v); })
      .catch(() => { /* offline: keep what we have */ })
      .finally(() => loading.delete(rid));
  }, [rid]); // eslint-disable-line react-hooks/exhaustive-deps
  return qp;
}
