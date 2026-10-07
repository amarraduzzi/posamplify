// Host stand: today's bookings and the waitlist. Confirm, seat, mark no-shows, call the next
// guest on WhatsApp, add a phone booking or a walk-in.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Hourglass, MessageCircle, Phone, Plus, UserX, Users, X, Armchair } from 'lucide-react';
import { usePos } from '../store';
import { supabase } from '../lib/supabase';
import { check, rpc } from '../lib/data';
import { time } from '../lib/format';
import { Btn, Field, Modal, inputCls } from './ui';
import { t } from '../lib/i18n';

export interface Reservation {
  id: string; kind: 'booking' | 'waitlist'; status: 'requested' | 'confirmed' | 'called' | 'seated' | 'cancelled' | 'no_show';
  source: string; starts_at: string | null; party_size: number; name: string; phone: string | null; note: string | null;
  table_id: string | null; quoted_min: number | null; token: string; created_at: string; called_at: string | null; seated_at: string | null;
}
const MENU_URL = ((import.meta.env.VITE_MENU_URL as string) || 'https://menu.amplifygrowthstudio.com').replace(/\/$/, '');
const intl = (p: string) => { const d = p.replace(/\D/g, ''); return d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? '212' + d.slice(1) : d; };
/** YYYY-MM-DD of a moment in the restaurant's time zone */
const ymd = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));

/** Bookings of one day + the live waitlist, refreshed every 30 s (also used for the tab badge). */
export function useReservations(day: string | null) {
  const pos = usePos();
  const r = pos.restaurant;
  const on = !!r && (!!r.booking?.enabled || !!r.booking?.waitlist);
  const [list, setList] = useState<Reservation[] | null>(null);
  const load = useCallback(async () => {
    if (!r || !on || !pos.online) return;
    const d = day ?? ymd(new Date(), r.timezone);
    const from = new Date(`${d}T00:00:00Z`); from.setUTCHours(from.getUTCHours() - 14);
    const to = new Date(from.getTime() + 52 * 3600_000);
    try {
      const [b, w] = await Promise.all([
        supabase.from('reservations').select('*').eq('restaurant_id', r.id).eq('kind', 'booking').gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString()).order('starts_at'),
        supabase.from('reservations').select('*').eq('restaurant_id', r.id).eq('kind', 'waitlist').gte('created_at', new Date(Date.now() - 12 * 3600_000).toISOString()).order('created_at'),
      ]);
      const bookings = (check(b) as Reservation[]).filter(x => x.starts_at && ymd(new Date(x.starts_at), r.timezone) === d);
      setList([...bookings, ...(check(w) as Reservation[])]);
    } catch { /* keep the last list */ }
  }, [r, on, pos.online, day]);
  useEffect(() => { load(); const id = window.setInterval(load, 30000); return () => window.clearInterval(id); }, [load]);
  return { on, list, reload: load };
}

export function ReservationsView() {
  const pos = usePos();
  const r = pos.restaurant!;
  const tz = r.timezone;
  const [day, setDay] = useState(() => ymd(new Date(), tz));
  const { list, reload } = useReservations(day);
  const [adding, setAdding] = useState<null | 'booking' | 'waitlist'>(null);
  const [history, setHistory] = useState<Record<string, { no_shows: number; seated: number }>>({});
  const today = ymd(new Date(), tz);
  const bookings = (list ?? []).filter(x => x.kind === 'booking');
  const waiting = (list ?? []).filter(x => x.kind === 'waitlist' && (x.status === 'requested' || x.status === 'called'));
  const active = bookings.filter(x => x.status !== 'cancelled');
  const covers = active.filter(x => x.status !== 'no_show').reduce((s, x) => s + x.party_size, 0);

  // no-shows of the phones on screen (to think twice before confirming)
  useEffect(() => {
    const phones = [...new Set((list ?? []).map(x => x.phone).filter((p): p is string => !!p && !(p in history)))].slice(0, 30);
    phones.forEach(p => rpc<{ no_shows: number; seated: number }>('guest_history', { p_restaurant_id: r.id, p_phone: p })
      .then(h => setHistory(x => ({ ...x, [p]: h }))).catch(() => {}));
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = async (x: Reservation, status: Reservation['status']) => {
    if (!pos.requireOnline()) return;
    try { check(await supabase.from('reservations').update({ status }).eq('id', x.id).select('id')); await reload(); } catch (e) { pos.fail(e); }
  };
  const wa = (x: Reservation, text: string) => x.phone && window.open(`https://wa.me/${intl(x.phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  const link = (x: Reservation) => `${MENU_URL}/${r.slug}?resa=${x.token}`;
  const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const shift = (n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); setDay(ymd(d, tz)); };

  const confirmMsg = (x: Reservation) => `${t('Bonjour {n},', { n: x.name })} ${t('votre table chez {r} est confirmée : {d} à {h}, {p} pers.', { r: r.name, d: fmtDay(day), h: time(x.starts_at!, tz), p: x.party_size })}\n${t('Pour annuler : {l}', { l: link(x) })}`;
  const callMsg = (x: Reservation) => `${t('Bonjour {n},', { n: x.name })} ${t('votre table chez {r} est prête ! Présentez-vous à l’accueil.', { r: r.name })}`;

  const STATUS: Record<Reservation['status'], [string, string]> = {
    requested: [t('À confirmer'), 'bg-warn/15 text-warn'], confirmed: [t('Confirmée'), 'bg-ok/15 text-ok'], called: [t('Appelé'), 'bg-qr/15 text-qr'],
    seated: [t('Installé'), 'bg-brand/15 text-brand'], cancelled: [t('Annulée'), 'bg-surface-2 text-muted line-through'], no_show: [t('Pas venu'), 'bg-danger/15 text-danger'],
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[1.4fr_1fr]">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Btn className="px-2.5" aria-label={t('Jour précédent')} onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4 rtl:rotate-180" /></Btn>
          <h2 className="font-display text-2xl font-semibold capitalize">{day === today ? t('Aujourd’hui') : fmtDay(day)}</h2>
          <Btn className="px-2.5" aria-label={t('Jour suivant')} onClick={() => shift(1)}><ChevronRight className="h-4 w-4 rtl:rotate-180" /></Btn>
          {day !== today && <button onClick={() => setDay(today)} className="text-sm font-semibold text-brand">{t('Aujourd’hui')}</button>}
          <span className="ms-auto text-sm text-muted">{t('{n} réservations · {c} couverts', { n: active.length, c: covers })}</span>
          <Btn tone="brand" onClick={() => setAdding('booking')}><Plus className="h-4 w-4" /> {t('Réservation')}</Btn>
        </div>
        {list === null ? <p className="text-muted">{t('Chargement…')}</p> : !bookings.length ? (
          <div className="panel rounded-3xl p-10 text-center text-muted"><CalendarDays className="mx-auto h-10 w-10 text-brand/50" /><p className="mt-3">{t('Aucune réservation ce jour-là.')}</p></div>
        ) : bookings.map(x => {
          const h = x.phone ? history[x.phone] : undefined;
          const late = x.status === 'confirmed' && x.starts_at && Date.now() > Date.parse(x.starts_at) + 15 * 60000;
          return (
            <article key={x.id} className={`panel flex flex-wrap items-center gap-3 rounded-2xl p-4 ${x.status === 'requested' ? 'ring-2 ring-warn/50' : ''} ${['cancelled', 'no_show'].includes(x.status) ? 'opacity-60' : ''}`}>
              <span className="w-16 font-display text-2xl font-semibold tabular" dir="ltr">{time(x.starts_at!, tz)}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold">{x.name}
                  <span className="flex items-center gap-1 text-sm text-muted"><Users className="h-3.5 w-3.5" />{x.party_size}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS[x.status][1]}`}>{STATUS[x.status][0]}</span>
                  {x.source === 'online' && <span className="rounded-full bg-qr/10 px-2 py-0.5 text-xs font-bold text-qr">{t('En ligne')}</span>}
                  {late && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs font-bold text-danger">{t('en retard')}</span>}
                  {h && h.no_shows > 0 && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs font-bold text-danger">{t('{n} fois pas venu', { n: h.no_shows })}</span>}
                </p>
                <p className="text-sm text-muted"><span dir="ltr">{x.phone ?? ''}</span>{x.note ? ` · ${x.note}` : ''}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {x.status === 'requested' && <Btn tone="brand" className="px-3 py-1.5 text-sm" onClick={async () => { await set(x, 'confirmed'); wa(x, confirmMsg(x)); }}><Check className="h-4 w-4" /> {t('Confirmer')}</Btn>}
                {x.status === 'confirmed' && x.phone && <Btn className="px-3 py-1.5 text-sm" onClick={() => wa(x, confirmMsg(x))}><MessageCircle className="h-4 w-4" /></Btn>}
                {(x.status === 'requested' || x.status === 'confirmed') && <>
                  <Btn tone="ok" className="px-3 py-1.5 text-sm" onClick={() => set(x, 'seated')}><Armchair className="h-4 w-4" /> {t('Arrivés')}</Btn>
                  {day <= today && <Btn className="px-3 py-1.5 text-sm" onClick={() => set(x, 'no_show')}><UserX className="h-4 w-4" /> {t('Pas venu')}</Btn>}
                  <Btn className="px-2.5 py-1.5 text-sm" aria-label={t('Annuler')} onClick={() => set(x, 'cancelled')}><X className="h-4 w-4" /></Btn>
                </>}
              </div>
            </article>
          );
        })}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="me-auto flex items-center gap-2 font-display text-2xl font-semibold"><Hourglass className="h-5 w-5 text-brand" />{t('File d’attente ({n})', { n: waiting.length })}</h2>
          <Btn onClick={() => setAdding('waitlist')}><Plus className="h-4 w-4" /> {t('Ajouter')}</Btn>
        </div>
        {!waiting.length ? <div className="panel rounded-3xl p-8 text-center text-sm text-muted">{t('Personne n’attend. Les clients peuvent aussi rejoindre la file avec le QR à l’entrée.')}</div>
          : waiting.map((x, i) => (
            <article key={x.id} className={`panel rounded-2xl p-4 ${x.status === 'called' ? 'ring-2 ring-qr/60' : ''}`}>
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 font-display text-lg font-semibold">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-semibold">{x.name}<span className="flex items-center gap-1 text-sm text-muted"><Users className="h-3.5 w-3.5" />{x.party_size}</span></p>
                  <p className="text-xs text-muted">{x.status === 'called' && x.called_at ? t('appelé il y a {m} min', { m: minutesSince(x.called_at) }) : t('attend depuis {m} min', { m: minutesSince(x.created_at) })}{x.quoted_min ? ` · ${t('annoncé {m} min', { m: x.quoted_min })}` : ''}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {x.status === 'requested' && <Btn tone="brand" className="px-3 py-1.5 text-sm" onClick={async () => { await set(x, 'called'); wa(x, callMsg(x)); }}><MessageCircle className="h-4 w-4" /> {t('Appeler')}</Btn>}
                {x.status === 'called' && x.phone && <Btn className="px-3 py-1.5 text-sm" onClick={() => wa(x, callMsg(x))}><Phone className="h-4 w-4" /> {t('Relancer')}</Btn>}
                <Btn tone="ok" className="px-3 py-1.5 text-sm" onClick={() => set(x, 'seated')}><Armchair className="h-4 w-4" /> {t('Installé')}</Btn>
                <Btn className="px-3 py-1.5 text-sm" onClick={() => set(x, 'cancelled')}><X className="h-4 w-4" /> {t('Parti')}</Btn>
              </div>
            </article>
          ))}
      </section>
      {adding && <AddReservation kind={adding} day={day} onClose={() => setAdding(null)} onDone={() => { setAdding(null); reload(); }} />}
    </div>
  );
}

function AddReservation({ kind, day, onClose, onDone }: { kind: 'booking' | 'waitlist'; day: string; onClose: () => void; onDone: () => void }) {
  const pos = usePos();
  const r = pos.restaurant!;
  const [f, setF] = useState({ name: '', phone: '', party: '2', time: '20:00', note: '', quoted: '15', date: day });
  const [busy, setBusy] = useState(false);
  const startsAt = useMemo(() => {
    // the typed time is the restaurant's local time
    const guess = new Date(`${f.date}T${f.time}:00Z`);
    const local = new Date(guess.toLocaleString('en-US', { timeZone: r.timezone }));
    const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
    return new Date(guess.getTime() - (local.getTime() - utc.getTime())).toISOString();
  }, [f.date, f.time, r.timezone]);
  const save = async () => {
    if (!pos.requireOnline()) return;
    setBusy(true);
    try {
      const phone = f.phone.replace(/\D/g, '');
      check(await supabase.from('reservations').insert({
        restaurant_id: r.id, kind, source: kind === 'booking' ? 'phone' : 'walk_in', status: kind === 'booking' ? 'confirmed' : 'requested',
        starts_at: kind === 'booking' ? startsAt : null, party_size: Math.max(1, Math.min(60, Number(f.party) || 2)), name: f.name.trim(),
        phone: phone.length >= 9 ? phone : null, note: f.note.trim() || null, quoted_min: kind === 'waitlist' ? Number(f.quoted) || null : null, staff_id: pos.staff?.id ?? null,
        duration_min: r.booking?.duration_min ?? 90,
      }).select('id'));
      pos.toast(t('Enregistré'), 'ok'); onDone();
    } catch (e) { pos.fail(e); }
    setBusy(false);
  };
  return (
    <Modal title={kind === 'booking' ? t('Nouvelle réservation (téléphone)') : t('Ajouter à la file')} onClose={onClose}
      footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy || !f.name.trim()} onClick={save}>{t('Enregistrer')}</Btn></div>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('Nom')}><input autoFocus className={inputCls} maxLength={60} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t('Téléphone')}><input className={inputCls} dir="ltr" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="06…" /></Field>
        <Field label={t('Personnes')}><input className={inputCls} inputMode="numeric" value={f.party} onChange={e => setF({ ...f, party: e.target.value.replace(/\D/g, '') })} /></Field>
        {kind === 'booking' ? <>
          <Field label={t('Date')}><input type="date" className={inputCls} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
          <Field label={t('Heure')}><input type="time" className={inputCls} value={f.time} onChange={e => setF({ ...f, time: e.target.value })} /></Field>
          <Field label={t('Note')}><input className={inputCls} maxLength={300} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder={t('Anniversaire, terrasse…')} /></Field>
        </> : <Field label={t('Attente annoncée (min)')}><input className={inputCls} inputMode="numeric" value={f.quoted} onChange={e => setF({ ...f, quoted: e.target.value.replace(/\D/g, '') })} /></Field>}
      </div>
    </Modal>
  );
}
