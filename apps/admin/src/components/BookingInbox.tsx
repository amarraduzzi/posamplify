// Table bookings in the back office, for restaurants with or without the till: the coming bookings,
// live, with Confirm / Refuse / Arrived / No-show and a ready WhatsApp message to the guest.
// Used on the Réservations page and on the Amplify Commandes screen (with a sound for new requests).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Armchair, Check, MessageCircle, Phone, UserX, Users, X } from 'lucide-react';
import { supabase, MENU_URL } from '../lib/supabase';
import { check } from '../lib/api';
import { chime } from '../lib/chime';
import { dateLocale, t } from '../lib/i18n';
import { useAdminCtx } from '../store';
import type { Restaurant } from '../lib/types';
import { Btn } from './ui';

export interface Booking { id: string; status: 'requested' | 'confirmed' | 'called' | 'seated' | 'cancelled' | 'no_show'; starts_at: string; party_size: number; name: string; phone: string | null; source: string; note: string | null; token: string; created_at: string }
// i18n:values
const ST: Record<Booking['status'], string> = { requested: 'À confirmer', confirmed: 'Confirmée', called: 'Appelé', seated: 'Installé', cancelled: 'Annulée', no_show: 'Pas venu' };
// i18n:end
const TONE: Record<Booking['status'], string> = { requested: 'bg-warn/15 text-warn', confirmed: 'bg-ok/15 text-ok', called: 'bg-surface-2', seated: 'bg-brand/15 text-brand', cancelled: 'bg-surface-2 text-muted line-through', no_show: 'bg-danger/15 text-danger' };
const intl = (p: string) => { const d = p.replace(/\D/g, ''); return d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? '212' + d.slice(1) : d; };

/** The bookings from 3 hours ago to `days` days ahead, kept live. `onNew` hears about requests not seen before. */
export function useBookings(r: Restaurant, days = 8, onNew?: () => void) {
  const a = useAdminCtx();
  const [rows, setRows] = useState<Booking[] | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const load = useCallback(async () => {
    try {
      const list = check(await supabase.from('reservations').select('id,status,starts_at,party_size,name,phone,source,note,token,created_at')
        .eq('restaurant_id', r.id).eq('kind', 'booking')
        .gte('starts_at', new Date(Date.now() - 3 * 3600_000).toISOString()).lt('starts_at', new Date(Date.now() + days * 86400_000).toISOString())
        .order('starts_at')) as Booking[];
      const ids = new Set(list.map(x => x.id));
      if (seen.current && list.some(x => x.status === 'requested' && !seen.current!.has(x.id))) onNew?.();
      seen.current = ids;
      setRows(list);
    } catch (e) { a.fail(e); setRows([]); }
  }, [r.id, days, a, onNew]);
  useEffect(() => {
    load();
    let timer = 0;
    const soon = () => { window.clearTimeout(timer); timer = window.setTimeout(load, 250); };
    const ch = supabase.channel(`bookings-${r.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations', filter: `restaurant_id=eq.${r.id}` }, soon)
      .subscribe();
    const iv = window.setInterval(() => { if (!document.hidden) load(); }, 30_000);
    return () => { window.clearTimeout(timer); window.clearInterval(iv); supabase.removeChannel(ch); };
  }, [load, r.id]);
  const set = async (x: Booking, status: Booking['status']) => {
    try { check(await supabase.from('reservations').update({ status }).eq('id', x.id).select('id')); await load(); } catch (e) { a.fail(e); }
  };
  return { rows, load, set };
}

/** Bookings grouped by day, each with its actions. compact: the Commandes screen (requests first, today). */
export function BookingList({ r, rows, set, compact }: { r: Restaurant; rows: Booking[]; set: (x: Booking, s: Booking['status']) => Promise<void>; compact?: boolean }) {
  const tz = r.timezone;
  const day = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(), { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' });
  const hm = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  const wa = (x: Booking, text: string) => { if (x.phone) window.open(`https://wa.me/${intl(x.phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener'); };
  const confirmMsg = (x: Booking) => `${t('Bonjour {n},', { n: x.name })} ${t('votre table chez {r} est confirmée : {d} à {h}, {p} pers.', { r: r.name, d: day(x.starts_at), h: hm(x.starts_at), p: x.party_size })}\n${t('Pour annuler : {l}', { l: `${MENU_URL}/${r.slug}?resa=${x.token}` })}`;
  const refuseMsg = (x: Booking) => `${t('Bonjour {n},', { n: x.name })} ${t('désolé, nous sommes complets {d} à {h}. Choisissez une autre heure ici : {l}', { d: day(x.starts_at), h: hm(x.starts_at), l: `${MENU_URL}/${r.slug}?reserver` })}`;

  const shown = rows.filter(x => (compact ? x.status === 'requested' || x.status === 'confirmed' : x.status !== 'cancelled'));
  const groups = shown.reduce<Record<string, Booking[]>>((m, x) => { (m[day(x.starts_at)] ??= []).push(x); return m; }, {});
  if (!shown.length) return <p className="text-sm text-muted">{compact ? t('Aucune réservation à traiter.') : t('Aucune réservation à venir.')}</p>;

  return (
    <div className="space-y-4">
      {Object.entries(groups).map(([d, xs]) => (
        <div key={d}>
          <p className="mb-1.5 flex items-center gap-2 font-semibold capitalize">{d}<span className="text-sm font-normal text-muted">· {t('{n} couverts', { n: xs.filter(x => x.status !== 'no_show').reduce((s, x) => s + x.party_size, 0) })}</span></p>
          <ul className="space-y-2">
            {xs.map(x => {
              const past = Date.parse(x.starts_at) < Date.now();
              return (
                <li key={x.id} className={`flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2.5 ${x.status === 'requested' ? 'ring-2 ring-warn/60' : ''} ${['cancelled', 'no_show'].includes(x.status) ? 'opacity-60' : ''}`}>
                  <span className="w-14 font-display text-xl font-semibold tabular" dir="ltr">{hm(x.starts_at)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 font-semibold">{x.name}
                      <span className="inline-flex items-center gap-1 text-sm font-normal text-muted"><Users className="h-3.5 w-3.5" />{x.party_size}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${TONE[x.status]}`}>{t(ST[x.status])}</span>
                      {x.source === 'online' && <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-muted">{t('En ligne')}</span>}
                    </span>
                    <span className="block text-sm text-muted">{x.phone && <a href={`tel:${x.phone}`} className="inline-flex items-center gap-1 hover:text-brand" dir="ltr"><Phone className="h-3 w-3" />{x.phone}</a>}{x.note ? ` · ${x.note}` : ''}</span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {x.status === 'requested' && <>
                      <Btn tone="brand" className="px-3 py-1.5 text-sm" onClick={async () => { await set(x, 'confirmed'); wa(x, confirmMsg(x)); }}><Check className="h-4 w-4" /> {t('Confirmer')}</Btn>
                      <Btn tone="danger" className="px-3 py-1.5 text-sm" onClick={async () => { await set(x, 'cancelled'); wa(x, refuseMsg(x)); }}><X className="h-4 w-4" /> {t('Refuser')}</Btn>
                    </>}
                    {x.status === 'confirmed' && <>
                      {x.phone && <Btn className="px-2.5 py-1.5 text-sm" aria-label={t('Envoyer la confirmation sur WhatsApp')} title={t('Envoyer la confirmation sur WhatsApp')} onClick={() => wa(x, confirmMsg(x))}><MessageCircle className="h-4 w-4" /></Btn>}
                      <Btn className="px-3 py-1.5 text-sm" onClick={() => set(x, 'seated')}><Armchair className="h-4 w-4" /> {t('Arrivés')}</Btn>
                      {past && <Btn className="px-3 py-1.5 text-sm" onClick={() => set(x, 'no_show')}><UserX className="h-4 w-4" /> {t('Pas venu')}</Btn>}
                      <Btn className="px-2.5 py-1.5 text-sm" aria-label={t('Annuler la réservation')} title={t('Annuler la réservation')} onClick={() => set(x, 'cancelled')}><X className="h-4 w-4" /></Btn>
                    </>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The Commandes screen block: bookings to answer first, then today's. A chime for each new request. */
export function BookingInbox({ r, armed }: { r: Restaurant; armed: boolean }) {
  const armedRef = useRef(armed);
  armedRef.current = armed;
  const onNew = useCallback(() => { if (armedRef.current) chime(); }, []);
  const { rows, set } = useBookings(r, 2, onNew);
  const todo = useMemo(() => (rows ?? []).filter(x => x.status === 'requested').length, [rows]);
  // still a chime every 40 s while a request waits for an answer
  useEffect(() => {
    if (!armed || !todo) return;
    const iv = window.setInterval(chime, 40_000);
    return () => window.clearInterval(iv);
  }, [armed, todo]);
  if (!rows) return null;
  return (
    <section className={`rounded-3xl border p-4 ${todo ? 'border-warn/50 bg-warn/5' : 'border-line/10 bg-surface'}`}>
      <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-semibold">{t('Réservations')}
        {todo > 0 && <span className="rounded-full bg-warn px-2.5 py-0.5 text-sm font-bold text-white">{t('{n} à confirmer', { n: todo })}</span>}
      </h2>
      <BookingList r={r} rows={rows} set={set} compact />
    </section>
  );
}
