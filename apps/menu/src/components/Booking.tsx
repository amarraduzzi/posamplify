// Guests book a table or join the waitlist from the restaurant's link, then follow it on a private page.
// ?reserver opens the booking, ?file the waitlist (QR at the door), ?resa=<token> the guest's page.
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Clock, Hourglass, Phone, Users, XCircle } from 'lucide-react';
import { Sheet } from './Sheet';
import { Stepper } from './Stepper';
import { bookTable, bookingSlots, joinWaitlist, reservationCancel, reservationStatus, type ReservationStatus } from '../lib/api';
import { load, save } from '../lib/storage';
import { newId } from '@resto/shared';

const S = {
  fr: {
    book: 'Réserver une table', waitlist: 'Liste d’attente', guests: 'Personnes', day: 'Jour', time: 'Heure', noSlot: 'Plus de place ce jour-là. Essayez un autre jour.',
    name: 'Prénom', phone: 'Téléphone (WhatsApp)', note: 'Une demande ? (anniversaire, chaise bébé…)', confirm: 'Réserver', join: 'Rejoindre la file',
    today: 'Aujourd’hui', tomorrow: 'Demain', loading: 'Chargement…', requested: 'Demande envoyée', requestedTxt: 'Le restaurant va confirmer votre réservation.',
    confirmed: 'Réservation confirmée', cancelled: 'Réservation annulée', noShow: 'Réservation non honorée', seated: 'Bon appétit !', cancel: 'Annuler ma réservation',
    leave: 'Quitter la file', ahead: (n: number) => (n === 0 ? 'Vous êtes le prochain' : n === 1 ? '1 groupe avant vous' : `${n} groupes avant vous`),
    called: 'Votre table est prête !', calledTxt: 'Présentez-vous à l’accueil.', waiting: 'Vous êtes dans la file', keep: 'Gardez cette page : elle se met à jour toute seule.',
    call: 'Appeler le restaurant', close: 'Fermer', people: (n: number) => `${n} pers.`, myBooking: 'Ma réservation', errors: {
      slot_unavailable: 'Ce créneau vient d’être pris. Choisissez une autre heure.', party_too_big: 'Pour un grand groupe, appelez le restaurant.',
      customer_required: 'Indiquez votre prénom et un numéro valide.', rate_limited: 'Vous avez déjà plusieurs réservations à venir.',
      already_waiting: 'Vous êtes déjà dans la file.', closed: 'Le restaurant est fermé pour le moment.', waitlist_off: 'La liste d’attente est fermée.',
      booking_off: 'Les réservations en ligne sont fermées.', too_late: 'Trop tard pour annuler en ligne : appelez le restaurant.', network: 'Pas de connexion. Réessayez.' } as Record<string, string>,
    other: 'Une erreur est survenue. Réessayez.',
  },
  en: {
    book: 'Book a table', waitlist: 'Waitlist', guests: 'Guests', day: 'Day', time: 'Time', noSlot: 'No table left that day. Try another day.',
    name: 'First name', phone: 'Phone (WhatsApp)', note: 'Any request? (birthday, high chair…)', confirm: 'Book', join: 'Join the queue',
    today: 'Today', tomorrow: 'Tomorrow', loading: 'Loading…', requested: 'Request sent', requestedTxt: 'The restaurant will confirm your booking.',
    confirmed: 'Booking confirmed', cancelled: 'Booking cancelled', noShow: 'Booking missed', seated: 'Enjoy your meal!', cancel: 'Cancel my booking',
    leave: 'Leave the queue', ahead: (n: number) => (n === 0 ? 'You are next' : n === 1 ? '1 party ahead of you' : `${n} parties ahead of you`),
    called: 'Your table is ready!', calledTxt: 'Please come to the host stand.', waiting: 'You are in the queue', keep: 'Keep this page open: it updates by itself.',
    call: 'Call the restaurant', close: 'Close', people: (n: number) => `${n} ppl`, myBooking: 'My booking', errors: {
      slot_unavailable: 'This time was just taken. Please pick another.', party_too_big: 'For a large group, please call the restaurant.',
      customer_required: 'Please enter your name and a valid number.', rate_limited: 'You already have several upcoming bookings.',
      already_waiting: 'You are already in the queue.', closed: 'The restaurant is closed right now.', waitlist_off: 'The waitlist is closed.',
      booking_off: 'Online booking is closed.', too_late: 'Too late to cancel online: please call the restaurant.', network: 'No connection. Try again.' } as Record<string, string>,
    other: 'Something went wrong. Try again.',
  },
  ar: {
    book: 'حجز طاولة', waitlist: 'قائمة الانتظار', guests: 'الأشخاص', day: 'اليوم', time: 'الساعة', noSlot: 'لا توجد أماكن في هذا اليوم. جربوا يوما آخر.',
    name: 'الاسم', phone: 'الهاتف (واتساب)', note: 'طلب خاص؟ (عيد ميلاد، كرسي طفل…)', confirm: 'احجز', join: 'انضموا إلى الطابور',
    today: 'اليوم', tomorrow: 'غدا', loading: 'جار التحميل…', requested: 'تم إرسال الطلب', requestedTxt: 'سيؤكد المطعم حجزكم.',
    confirmed: 'تم تأكيد الحجز', cancelled: 'تم إلغاء الحجز', noShow: 'لم يتم الحضور', seated: 'بالصحة والعافية!', cancel: 'إلغاء حجزي',
    leave: 'مغادرة الطابور', ahead: (n: number) => (n === 0 ? 'أنتم التالون' : n === 1 ? 'مجموعة واحدة قبلكم' : `${n} مجموعات قبلكم`),
    called: 'طاولتكم جاهزة!', calledTxt: 'تفضلوا إلى الاستقبال.', waiting: 'أنتم في الطابور', keep: 'احتفظوا بهذه الصفحة: تتحدث تلقائيا.',
    call: 'الاتصال بالمطعم', close: 'إغلاق', people: (n: number) => `${n} أشخاص`, myBooking: 'حجزي', errors: {
      slot_unavailable: 'تم أخذ هذا الوقت للتو. اختاروا ساعة أخرى.', party_too_big: 'للمجموعات الكبيرة، اتصلوا بالمطعم.',
      customer_required: 'أدخلوا اسمكم ورقما صحيحا.', rate_limited: 'لديكم عدة حجوزات قادمة.',
      already_waiting: 'أنتم في الطابور من قبل.', closed: 'المطعم مغلق حاليا.', waitlist_off: 'قائمة الانتظار مغلقة.',
      booking_off: 'الحجز عبر الإنترنت مغلق.', too_late: 'فات وقت الإلغاء عبر الإنترنت: اتصلوا بالمطعم.', network: 'لا يوجد اتصال. أعيدوا المحاولة.' } as Record<string, string>,
    other: 'حدث خطأ. أعيدوا المحاولة.',
  },
};
type T = typeof S.fr;
export const bookingStrings = (lang: string): T => (S as Record<string, T>)[lang] ?? S.fr;
const errText = (t: T, e: unknown) => t.errors[(e as Error)?.message] ?? t.other;
const localeOf = (lang: string) => (lang === 'ar' ? 'ar-MA-u-nu-latn' : lang);
/** day as YYYY-MM-DD in the restaurant's time zone */
const ymd = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

interface Saved { slug: string; token: string }
export const savedReservations = (slug: string) => load<Saved[]>(`resa:${slug}`, 30 * 86400_000) ?? [];
const remember = (slug: string, token: string) => save(`resa:${slug}`, [{ slug, token }, ...savedReservations(slug).filter(x => x.token !== token)].slice(0, 5));

export function BookingSheet({ slug, lang, tz, maxParty, daysAhead, note, onClose, onBooked }: {
  slug: string; lang: string; tz: string; maxParty: number; daysAhead: number; note?: string | null; onClose: () => void; onBooked: (token: string) => void;
}) {
  const t = bookingStrings(lang);
  const [party, setParty] = useState(2);
  const days = useMemo(() => Array.from({ length: Math.min(daysAhead + 1, 21) }, (_, i) => new Date(Date.now() + i * 86400_000)), [daysAhead]);
  const [day, setDay] = useState(() => ymd(new Date(), tz));
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const saved = load<{ name: string; phone: string }>('customer', 365 * 86400_000);
  const [name, setName] = useState(saved?.name ?? '');
  const [phone, setPhone] = useState(saved?.phone ?? '');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId] = useState(() => newId());
  useEffect(() => {
    let live = true;
    setSlots(null); setSlot(null);
    bookingSlots(slug, day, party).then(x => live && setSlots(x ?? []), e => { if (live) { setSlots([]); setError(errText(t, e)); } });
    return () => { live = false; };
  }, [slug, day, party]); // eslint-disable-line react-hooks/exhaustive-deps
  const hm = (iso: string) => new Intl.DateTimeFormat(localeOf(lang), { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const dayLabel = (d: Date, i: number) => i === 0 ? t.today : i === 1 ? t.tomorrow : new Intl.DateTimeFormat(localeOf(lang), { timeZone: tz, weekday: 'short', day: 'numeric' }).format(d);
  const ok = !!slot && name.trim().length > 0 && phone.replace(/\D/g, '').length >= 9;
  const submit = async () => {
    if (!slot) return;
    setBusy(true); setError(null);
    try {
      const res = await bookTable(slug, { client_id: clientId, starts_at: slot, party_size: party, name: name.trim(), phone: phone.trim(), note: msg.trim() || undefined });
      save('customer', { ...(saved ?? {}), name: name.trim(), phone: phone.trim() });
      remember(slug, res.token); onBooked(res.token);
    } catch (e) { setError(errText(t, e)); if ((e as Error).message === 'slot_unavailable') bookingSlots(slug, day, party).then(x => setSlots(x ?? [])).catch(() => {}); }
    setBusy(false);
  };
  return (
    <Sheet open onClose={onClose} closeLabel={t.close} title={<h2 className="pt-1 font-display text-[1.7rem] font-semibold leading-tight">{t.book}</h2>}
      footer={<div className="space-y-2">
        {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
        <button disabled={!ok || busy} onClick={submit} className="flex h-14 w-full items-center justify-between rounded-full bg-brand px-6 font-semibold text-brand-ink glow-brand disabled:opacity-40">
          <span>{t.confirm}</span><span className="text-sm">{slot ? `${t.people(party)} · ${hm(slot)}` : ''}</span>
        </button>
      </div>}>
      <div className="space-y-5 px-5 pb-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 font-semibold"><Users className="size-4 text-brand" />{t.guests}</span>
          <Stepper value={party} onChange={setParty} min={1} max={maxParty} />
        </div>
        <div>
          <p className="mb-2 flex items-center gap-2 font-semibold"><CalendarDays className="size-4 text-brand" />{t.day}</p>
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 no-scrollbar">
            {days.map((d, i) => { const v = ymd(d, tz); return (
              <button key={v} onClick={() => setDay(v)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold capitalize transition ${day === v ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted'}`}>{dayLabel(d, i)}</button>
            ); })}
          </div>
        </div>
        <div>
          <p className="mb-2 flex items-center gap-2 font-semibold"><Clock className="size-4 text-brand" />{t.time}</p>
          {slots === null ? <p className="text-sm text-muted">{t.loading}</p> : !slots.length ? <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">{t.noSlot}</p> : (
            <div className="grid grid-cols-4 gap-2">
              {slots.map(s => <button key={s} onClick={() => setSlot(s)} className={`rounded-xl py-2.5 text-sm font-bold tabular-nums transition ${slot === s ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`} dir="ltr">{hm(s)}</button>)}
            </div>
          )}
        </div>
        {slot && (
          <div className="space-y-3">
            <input className="h-12 w-full rounded-2xl border border-line bg-surface-2 px-4 outline-none focus:border-brand" placeholder={t.name} value={name} onChange={e => setName(e.target.value)} maxLength={60} autoComplete="given-name" />
            <input className="h-12 w-full rounded-2xl border border-line bg-surface-2 px-4 outline-none focus:border-brand" placeholder={t.phone} value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" dir="ltr" />
            <textarea className="h-20 w-full resize-none rounded-2xl border border-line bg-surface-2 px-4 py-3 outline-none focus:border-brand" placeholder={t.note} value={msg} onChange={e => setMsg(e.target.value)} maxLength={300} />
          </div>
        )}
        {note && <p className="text-xs text-muted">{note}</p>}
      </div>
    </Sheet>
  );
}

export function WaitlistSheet({ slug, lang, onClose, onJoined }: { slug: string; lang: string; onClose: () => void; onJoined: (token: string) => void }) {
  const t = bookingStrings(lang);
  const saved = load<{ name: string; phone: string }>('customer', 365 * 86400_000);
  const [party, setParty] = useState(2);
  const [name, setName] = useState(saved?.name ?? '');
  const [phone, setPhone] = useState(saved?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId] = useState(() => newId());
  const ok = name.trim().length > 0 && phone.replace(/\D/g, '').length >= 9;
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const res = await joinWaitlist(slug, { client_id: clientId, party_size: party, name: name.trim(), phone: phone.trim() });
      save('customer', { ...(saved ?? {}), name: name.trim(), phone: phone.trim() });
      remember(slug, res.token); onJoined(res.token);
    } catch (e) { setError(errText(t, e)); }
    setBusy(false);
  };
  return (
    <Sheet open onClose={onClose} closeLabel={t.close} title={<h2 className="pt-1 font-display text-[1.7rem] font-semibold leading-tight">{t.waitlist}</h2>}
      footer={<div className="space-y-2">
        {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
        <button disabled={!ok || busy} onClick={submit} className="h-14 w-full rounded-full bg-brand font-semibold text-brand-ink glow-brand disabled:opacity-40">{t.join}</button>
      </div>}>
      <div className="space-y-4 px-5 pb-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 font-semibold"><Users className="size-4 text-brand" />{t.guests}</span>
          <Stepper value={party} onChange={setParty} min={1} max={20} />
        </div>
        <input className="h-12 w-full rounded-2xl border border-line bg-surface-2 px-4 outline-none focus:border-brand" placeholder={t.name} value={name} onChange={e => setName(e.target.value)} maxLength={60} />
        <input className="h-12 w-full rounded-2xl border border-line bg-surface-2 px-4 outline-none focus:border-brand" placeholder={t.phone} value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" dir="ltr" />
      </div>
    </Sheet>
  );
}

/** The guest's private page: a booking (status, cancel) or a place in the queue (live position). */
export function ReservationSheet({ token, lang, onClose }: { token: string; lang: string; onClose: () => void }) {
  const t = bookingStrings(lang);
  const [st, setSt] = useState<ReservationStatus | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => reservationStatus(token).then(setSt).catch(() => {});
  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 15000);
    return () => window.clearInterval(id);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  const cancel = async () => {
    setBusy(true); setError(null);
    try { await reservationCancel(token); await refresh(); } catch (e) { setError(errText(t, e)); }
    setBusy(false);
  };
  if (st === undefined) return <Sheet open onClose={onClose} closeLabel={t.close}><p className="p-8 text-center text-muted">{t.loading}</p></Sheet>;
  if (!st) return null;
  const tz = st.restaurant.timezone;
  const when = st.starts_at ? new Intl.DateTimeFormat(localeOf(lang), { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(st.starts_at)) : '';
  const wait = st.kind === 'waitlist';
  const head = wait
    ? st.status === 'called' ? { Icon: CheckCircle2, tone: 'text-emerald-400', h: t.called, p: t.calledTxt }
      : st.status === 'requested' ? { Icon: Hourglass, tone: 'text-brand', h: t.waiting, p: t.ahead(Number(st.ahead ?? 0)) }
      : st.status === 'seated' ? { Icon: CheckCircle2, tone: 'text-emerald-400', h: t.seated, p: '' }
      : { Icon: XCircle, tone: 'text-muted', h: t.cancelled, p: '' }
    : st.status === 'confirmed' ? { Icon: CheckCircle2, tone: 'text-emerald-400', h: t.confirmed, p: '' }
      : st.status === 'requested' ? { Icon: Hourglass, tone: 'text-brand', h: t.requested, p: t.requestedTxt }
      : st.status === 'seated' ? { Icon: CheckCircle2, tone: 'text-emerald-400', h: t.seated, p: '' }
      : { Icon: XCircle, tone: 'text-muted', h: st.status === 'no_show' ? t.noShow : t.cancelled, p: '' };
  const open = ['requested', 'confirmed', 'called'].includes(st.status);
  return (
    <Sheet open onClose={onClose} closeLabel={t.close} title={<h2 className="pt-1 font-display text-[1.7rem] font-semibold leading-tight">{wait ? t.waitlist : t.myBooking}</h2>}>
      <div className="space-y-5 px-5 pb-6 text-center">
        <head.Icon className={`mx-auto size-16 ${head.tone} ${wait && st.status === 'called' ? 'animate-bounce' : ''}`} />
        <div>
          <p className="font-display text-2xl font-semibold">{head.h}</p>
          {head.p && <p className="mt-1 text-muted">{head.p}</p>}
        </div>
        <div className="rounded-2xl bg-surface-2 p-4 text-start text-sm">
          <p className="font-semibold">{st.restaurant.name}</p>
          {when && <p className="mt-1 first-letter:uppercase">{when}</p>}
          <p className="text-muted">{st.name} · {t.people(st.party_size)}</p>
          {st.restaurant.note && <p className="mt-2 text-xs text-muted">{st.restaurant.note}</p>}
        </div>
        {wait && open && <p className="text-xs text-muted">{t.keep}</p>}
        {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
        <div className="flex flex-col gap-2">
          {st.restaurant.phone && <a href={`tel:${st.restaurant.phone}`} className="flex h-12 items-center justify-center gap-2 rounded-full bg-surface-2 font-semibold"><Phone className="size-4" />{t.call}</a>}
          {open && <button disabled={busy} onClick={cancel} className="h-12 rounded-full font-semibold text-red-400 disabled:opacity-40">{wait ? t.leave : t.cancel}</button>}
        </div>
      </div>
    </Sheet>
  );
}
