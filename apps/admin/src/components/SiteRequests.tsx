// New requests from the premium website (a group, a private event, catering), followed live:
// a count for the badge on Traiteur, a banner on every page and a chime when one arrives.
// A request counts as new until someone opens it in Traiteur (catering_orders.seen_at).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChefHat, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { chime } from '../lib/chime';
import { dateLocale, t } from '../lib/i18n';
import type { Restaurant } from '../lib/types';

export interface SiteReq { id: string; customer_name: string; kind: string | null; event_date: string; guests: number | null; created_at: string }
// i18n:values
export const REQ_KIND: Record<string, string> = { group: 'Groupe', private: 'Privatisation', catering: 'Traiteur', other: 'Autre' };
// i18n:end
/** Fired after a request was opened, so the badge updates at once. */
export const SEEN_EVENT = 'amplify:site-request-seen';

export function useSiteRequests(r: Restaurant | null | undefined, on: boolean) {
  const [rows, setRows] = useState<SiteReq[]>([]);
  const known = useRef<Set<string> | null>(null);
  const rid = r?.id;
  const load = useCallback(async () => {
    if (!rid || !on) { setRows([]); return; }
    const { data, error } = await supabase.from('catering_orders').select('id, customer_name, kind, event_date, guests, created_at')
      .eq('restaurant_id', rid).eq('source', 'site').is('seen_at', null).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(20);
    if (error) return; // the badge is a help, never an error on screen
    const list = (data ?? []) as SiteReq[];
    if (known.current && list.some(x => !known.current!.has(x.id))) chime();
    known.current = new Set(list.map(x => x.id));
    setRows(list);
  }, [rid, on]);
  useEffect(() => {
    known.current = null;
    load();
    if (!rid || !on) return;
    let timer = 0;
    const soon = () => { window.clearTimeout(timer); timer = window.setTimeout(load, 300); };
    const ch = supabase.channel(`site-req-${rid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catering_orders', filter: `restaurant_id=eq.${rid}` }, soon)
      .subscribe();
    const iv = window.setInterval(() => { if (!document.hidden) load(); }, 60_000);
    window.addEventListener(SEEN_EVENT, soon);
    return () => { window.clearTimeout(timer); window.clearInterval(iv); window.removeEventListener(SEEN_EVENT, soon); supabase.removeChannel(ch); };
  }, [load, rid, on]);
  return rows;
}

/** The banner at the top of every page while a request waits. */
export function SiteRequestBanner({ rows, onOpen }: { rows: SiteReq[]; onOpen: (id: string) => void }) {
  const [hidden, setHidden] = useState<string | null>(null);
  const x = rows[0];
  if (!x || hidden === x.id) return null;
  const d = new Date(`${x.event_date}T12:00:00Z`).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const what = [x.kind ? t(REQ_KIND[x.kind] ?? 'Autre') : null, d, x.guests ? t('{n} pers.', { n: x.guests }) : null].filter(Boolean).join(', ');
  return (
    <div role="status" className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-brand px-4 py-3 text-brand-ink shadow-lg md:mx-8">
      <ChefHat className="h-5 w-5 shrink-0" />
      <p className="min-w-0 flex-1 text-sm">
        <b>{rows.length > 1 ? t('{n} nouvelles demandes du site', { n: rows.length }) : t('Nouvelle demande du site')}</b>
        <span className="block opacity-90 sm:inline sm:ps-2">{x.customer_name} : {what}</span>
      </p>
      <button type="button" onClick={() => onOpen(x.id)} className="rounded-xl bg-white/90 px-3 py-1.5 text-sm font-semibold text-night hover:bg-white">{t('Ouvrir')}</button>
      <button type="button" onClick={() => setHidden(x.id)} aria-label={t('Fermer')} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-black/10"><X className="h-4 w-4" /></button>
    </div>
  );
}
