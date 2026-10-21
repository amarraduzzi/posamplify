// The formules of the restaurant (ftour, group menus, events): Amplify Maître.
// Loaded once per till and kept; the manager edits them in the back office.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { check } from './data';
import { hasMaitre } from './occasion';
import type { Restaurant } from './types';

export interface Offer {
  id: string; kind: 'ftour' | 'group' | 'event'; name: string; description: string | null;
  price_cents: number | string; deposit_cents: number | string | null; options: string[];
  min_party: number; max_party: number; starts_on: string | null; ends_on: string | null; weekdays: number[];
  at_time: string; covers: number | null; online: boolean; active: boolean;
}

let cache: { rid: string; at: number; list: Offer[] } | null = null;

export function useOffers(r: Restaurant | null | undefined) {
  const [list, setList] = useState<Offer[]>(() => (cache && r && cache.rid === r.id ? cache.list : []));
  useEffect(() => {
    if (!r || !hasMaitre(r)) { setList([]); return; }
    if (cache && cache.rid === r.id && Date.now() - cache.at < 5 * 60000) { setList(cache.list); return; }
    let gone = false;
    supabase.from('booking_offers').select('*').eq('restaurant_id', r.id).eq('active', true).order('sort_order').order('created_at')
      .then(res => { try { const l = check(res) as Offer[]; cache = { rid: r.id, at: Date.now(), list: l }; if (!gone) setList(l); } catch { /* none */ } });
    return () => { gone = true; };
  }, [r]);
  return list;
}

/** open on that day (dates and weekdays) */
export const offerOpenOn = (o: Offer, day: string) => {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return (!o.starts_on || day >= o.starts_on) && (!o.ends_on || day <= o.ends_on) && (!o.weekdays.length || o.weekdays.includes(dow));
};
/** "Classique 4 · Végétarien 2" */
export const choicesText = (c: Record<string, number> | null | undefined) =>
  Object.entries(c ?? {}).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${k} ${n}`).join(' · ');
