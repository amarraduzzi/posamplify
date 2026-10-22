// Amplify Agenda: the salon's booking page (<slug>?rdv) and the client's private page (<slug>?rdv=<token>).
// Four short steps on the phone: the prestation, with whom (a person or "peu importe"), the day and the
// time (only free times), then the first name and the WhatsApp number. Same look as the menu: the colour,
// the logo and the fonts come from the salon's branding.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarCheck2, CalendarPlus, CheckCircle2, ChevronRight, Clock, Hourglass, Loader2, MapPin, MessageCircle, Phone, Scissors, Shuffle, XCircle } from 'lucide-react';
import { formatMoney, newId, type Branding } from '@resto/shared';
import { applyBranding, applyLang } from '../theme';
import { load, save } from '../lib/storage';
import { RdvStory } from './StoryShare';
import { agendaBook, agendaCancel, agendaConfirm, agendaDays, agendaInfo, agendaSlots, agendaStatus, type AgendaInfo, type AgendaService, type AgendaStaff, type AgendaStatus, type LText } from '../lib/api';

const S = {
  fr: {
    title: 'Prendre rendez-vous', service: 'Choisissez une prestation', who: 'Avec qui ?', any: 'Peu importe', anyTxt: 'La première personne disponible',
    when: 'Quel jour, à quelle heure ?', details: 'Vos coordonnées', name: 'Prénom', phone: 'Numéro WhatsApp', note: 'Un détail pour le salon ? (cheveux longs, première fois…)',
    confirm: 'Confirmer le rendez-vous', busy: 'Réservation…', back: 'Retour', from: 'dès', today: 'Aujourd’hui', tomorrow: 'Demain',
    morning: 'Matin', afternoon: 'Après-midi', evening: 'Soir', noSlot: 'Plus de créneau ce jour-là. Choisissez un autre jour.', noDay: 'Aucun créneau libre pour le moment. Appelez le salon.',
    loading: 'Chargement…', closed: 'La réservation en ligne n’est pas ouverte pour le moment.', notFound: 'Ce salon est introuvable.', call: 'Appeler le salon',
    with: (n: string) => `avec ${n}`, mine: 'Mon rendez-vous', otherCat: 'Prestations',
    confirmed: 'Rendez-vous confirmé', requested: 'Demande envoyée', requestedTxt: 'Le salon confirme votre rendez-vous rapidement.',
    cancelled: 'Rendez-vous annulé', cancelledSalon: 'Le salon a annulé ce rendez-vous. Appelez-le pour en fixer un autre.', past: 'À bientôt !', noShow: 'Rendez-vous manqué',
    cancel: 'Annuler le rendez-vous', cancelSure: 'Oui, annuler', keep: 'Garder', cancelUntil: (h: number) => (h > 0 ? `Annulation en ligne jusqu’à ${h} h avant.` : ''),
    tooLate: 'Pour annuler ou changer maintenant, appelez le salon.', calendar: 'Ajouter à mon agenda', write: 'Écrire au salon', again: 'Prendre un autre rendez-vous',
    saveLink: 'Gardez ce lien : il sert à voir ou annuler votre rendez-vous.', iCome: 'Je confirme ma venue', thanksCome: 'Merci ! Le salon sait que vous venez.',
    wa: (s: string, d: string) => `Bonjour, j’ai réservé « ${s} » ${d}.`,
    errors: { slot_unavailable: 'Ce créneau vient d’être pris. Choisissez une autre heure.', customer_required: 'Indiquez votre prénom et un numéro valide.',
      rate_limited: 'Vous avez déjà plusieurs rendez-vous à venir. Appelez le salon.', booking_off: 'La réservation en ligne est fermée.',
      service_not_found: 'Cette prestation n’est plus proposée en ligne.', too_late: 'Trop tard pour annuler en ligne : appelez le salon.', network: 'Pas de connexion. Réessayez.' } as Record<string, string>,
    other: 'Une erreur est survenue. Réessayez.',
  },
  en: {
    title: 'Book an appointment', service: 'Choose a service', who: 'With whom?', any: 'No preference', anyTxt: 'The first person available',
    when: 'Which day, what time?', details: 'Your details', name: 'First name', phone: 'WhatsApp number', note: 'Anything the salon should know? (long hair, first visit…)',
    confirm: 'Confirm the appointment', busy: 'Booking…', back: 'Back', from: 'from', today: 'Today', tomorrow: 'Tomorrow',
    morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', noSlot: 'No time left that day. Pick another day.', noDay: 'No free time right now. Please call the salon.',
    loading: 'Loading…', closed: 'Online booking is not open right now.', notFound: 'This salon could not be found.', call: 'Call the salon',
    with: (n: string) => `with ${n}`, mine: 'My appointment', otherCat: 'Services',
    confirmed: 'Appointment confirmed', requested: 'Request sent', requestedTxt: 'The salon will confirm your appointment shortly.',
    cancelled: 'Appointment cancelled', cancelledSalon: 'The salon cancelled this appointment. Call them to book another one.', past: 'See you soon!', noShow: 'Appointment missed',
    cancel: 'Cancel the appointment', cancelSure: 'Yes, cancel', keep: 'Keep it', cancelUntil: (h: number) => (h > 0 ? `Online cancellation up to ${h} h before.` : ''),
    tooLate: 'To cancel or change now, please call the salon.', calendar: 'Add to my calendar', write: 'Message the salon', again: 'Book another appointment',
    saveLink: 'Keep this link: it lets you see or cancel your appointment.', iCome: 'I confirm I am coming', thanksCome: 'Thank you! The salon knows you are coming.',
    wa: (s: string, d: string) => `Hello, I booked “${s}” ${d}.`,
    errors: { slot_unavailable: 'This time was just taken. Please pick another.', customer_required: 'Please enter your name and a valid number.',
      rate_limited: 'You already have several upcoming appointments. Please call the salon.', booking_off: 'Online booking is closed.',
      service_not_found: 'This service is no longer bookable online.', too_late: 'Too late to cancel online: please call the salon.', network: 'No connection. Try again.' } as Record<string, string>,
    other: 'Something went wrong. Try again.',
  },
  ar: {
    title: 'حجز موعد', service: 'اختاروا الخدمة', who: 'مع من؟', any: 'لا يهم', anyTxt: 'أول شخص متاح',
    when: 'أي يوم وأي ساعة؟', details: 'معلوماتكم', name: 'الاسم', phone: 'رقم واتساب', note: 'معلومة للصالون؟ (شعر طويل، أول زيارة…)',
    confirm: 'تأكيد الموعد', busy: 'جار الحجز…', back: 'رجوع', from: 'ابتداء من', today: 'اليوم', tomorrow: 'غدا',
    morning: 'الصباح', afternoon: 'بعد الظهر', evening: 'المساء', noSlot: 'لا توجد مواعيد في هذا اليوم. اختاروا يوما آخر.', noDay: 'لا توجد مواعيد متاحة حاليا. اتصلوا بالصالون.',
    loading: 'جار التحميل…', closed: 'الحجز عبر الإنترنت غير مفتوح حاليا.', notFound: 'لم يتم العثور على هذا الصالون.', call: 'الاتصال بالصالون',
    with: (n: string) => `مع ${n}`, mine: 'موعدي', otherCat: 'الخدمات',
    confirmed: 'تم تأكيد الموعد', requested: 'تم إرسال الطلب', requestedTxt: 'سيؤكد الصالون موعدكم قريبا.',
    cancelled: 'تم إلغاء الموعد', cancelledSalon: 'ألغى الصالون هذا الموعد. اتصلوا به لتحديد موعد آخر.', past: 'إلى اللقاء!', noShow: 'موعد لم يتم الحضور إليه',
    cancel: 'إلغاء الموعد', cancelSure: 'نعم، إلغاء', keep: 'الاحتفاظ به', cancelUntil: (h: number) => (h > 0 ? `الإلغاء عبر الإنترنت ممكن حتى ${h} ساعات قبل الموعد.` : ''),
    tooLate: 'للإلغاء أو التغيير الآن، اتصلوا بالصالون.', calendar: 'إضافة إلى تقويمي', write: 'مراسلة الصالون', again: 'حجز موعد آخر',
    saveLink: 'احتفظوا بهذا الرابط: يمكنكم من خلاله رؤية موعدكم أو إلغاؤه.', iCome: 'أؤكد حضوري', thanksCome: 'شكرا! الصالون يعلم أنكم قادمون.',
    wa: (s: string, d: string) => `مرحبا، حجزت «${s}» ${d}.`,
    errors: { slot_unavailable: 'تم أخذ هذا الوقت للتو. اختاروا ساعة أخرى.', customer_required: 'أدخلوا اسمكم ورقما صحيحا.',
      rate_limited: 'لديكم عدة مواعيد قادمة. اتصلوا بالصالون.', booking_off: 'الحجز عبر الإنترنت مغلق.',
      service_not_found: 'هذه الخدمة لم تعد متاحة للحجز عبر الإنترنت.', too_late: 'فات وقت الإلغاء عبر الإنترنت: اتصلوا بالصالون.', network: 'لا يوجد اتصال. أعيدوا المحاولة.' } as Record<string, string>,
    other: 'حدث خطأ. أعيدوا المحاولة.',
  },
};
type Lang = keyof typeof S;
type T = typeof S.fr;
const errText = (t: T, e: unknown) => t.errors[(e as Error)?.message] ?? t.other;
const loc = (l: Lang) => (l === 'ar' ? 'ar-MA-u-nu-latn' : l === 'en' ? 'en-GB' : 'fr-FR');
const lt = (x: LText | null | undefined, l: Lang) => (x ? x[l] || x.fr || x.ar || x.en || '' : '');
const ymd = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const dur = (m: number, l: Lang = 'fr') => {
  const h = Math.floor(m / 60), r = m % 60;
  if (l === 'ar') return m < 60 ? `${m} دقيقة` : `${h} س${r ? ` ${r} د` : ''}`;
  return m < 60 ? `${m} min` : `${h} h${r ? ` ${String(r).padStart(2, '0')}` : ''}`;
};
const price = (s: { price_cents: number; price_from: boolean }, t: T, l: Lang) =>
  s.price_cents > 0 ? `${s.price_from ? `${t.from} ` : ''}${formatMoney(s.price_cents, 'MAD', l as 'fr')}` : '';
/** a Moroccan number for wa.me: 06... -> 2126... */
const waNumber = (p: string) => { const d = p.replace(/\D/g, ''); return d.startsWith('0') ? `212${d.slice(1)}` : d; };
const HEX = /^#[0-9a-f]{6}$/i;

interface Saved { token: string; at: string }
const savedOf = (slug: string) => (load<Saved[]>(`rdv:${slug}`, 120 * 86400_000) ?? []).filter(x => new Date(x.at).getTime() > Date.now() - 3 * 3600_000);
const remember = (slug: string, token: string, at: string) => save(`rdv:${slug}`, [{ token, at }, ...savedOf(slug).filter(x => x.token !== token)].slice(0, 5));

// the story "J'ai rendez-vous", in the client's language
const STORY = {
  fr: { title: 'J’ai rendez-vous', count: (d: number) => (d <= 0 ? 'Aujourd’hui' : d === 1 ? 'Demain' : `Dans ${d} jours`), cta: 'Réservez aussi : lien en story' },
  ar: { title: 'عندي موعد', count: (d: number) => (d <= 0 ? 'اليوم' : d === 1 ? 'غدا' : `من بعد ${d} أيام`), cta: 'احجزو حتى نتوما: الرابط فالستوري' },
  en: { title: 'I have an appointment', count: (d: number) => (d <= 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`), cta: 'Book too: link in story' },
};

function pickLang(langs: string[] | null | undefined, asked?: string | null): Lang {
  const ok = (langs?.length ? langs : ['fr']).filter((x): x is Lang => x in S);
  const phone = (navigator.language || '').slice(0, 2) as Lang;
  if (asked && asked in S && ok.includes(asked as Lang)) return asked as Lang;
  return ok.includes(phone) ? phone : ok[0] ?? 'fr';
}

export default function AgendaApp({ slug, token }: { slug: string; token: string | null }) {
  const [tok, setTok] = useState(token);
  const open = (x: string | null) => {
    const u = new URL(window.location.href);
    u.searchParams.set('rdv', x ?? '');
    window.history.pushState(null, '', u.toString().replace(/rdv=(&|$)/, 'rdv$1'));
    setTok(x); window.scrollTo(0, 0);
  };
  useEffect(() => {
    const f = () => { const v = new URLSearchParams(window.location.search).get('rdv'); setTok(v && /^[a-z0-9]{8,32}$/i.test(v) ? v : null); };
    window.addEventListener('popstate', f);
    return () => window.removeEventListener('popstate', f);
  }, []);
  return tok ? <StatusView slug={slug} token={tok} onAgain={() => open(null)} /> : <BookView slug={slug} onBooked={open} />;
}

function Screen({ children }: { children: React.ReactNode }) {
  return <main className="grid min-h-dvh place-items-center bg-bg px-6 text-ink">{children}</main>;
}

function SalonHead({ name, branding, address, city, lang, langs, onLang }: {
  name: string; branding: Branding; address?: string | null; city?: string | null; lang: Lang; langs: string[]; onLang?: (l: Lang) => void;
}) {
  const ok = langs.filter((x): x is Lang => x in S);
  return (
    <header className="flex items-center gap-3 px-5 pb-2 pt-6">
      {branding.logo_url
        ? <img src={branding.logo_url} alt="" className="size-12 shrink-0 rounded-2xl object-cover shadow-[var(--shadow)]" />
        : <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand font-display text-xl font-semibold text-brand-ink">{name.slice(0, 1)}</span>}
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-xl font-semibold leading-tight">{name}</p>
        {(address || city) && <p className="flex items-center gap-1 truncate text-sm text-muted"><MapPin className="size-3.5 shrink-0" />{[address, city].filter(Boolean).join(', ')}</p>}
      </div>
      {onLang && ok.length > 1 && (
        <div className="flex shrink-0 gap-1 rounded-full bg-surface-2 p-1">
          {ok.map(l => <button key={l} onClick={() => onLang(l)} className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase ${l === lang ? 'bg-surface text-ink shadow-[var(--shadow)]' : 'text-muted'}`}>{l === 'ar' ? 'ع' : l}</button>)}
        </div>
      )}
    </header>
  );
}

function Avatar({ s, size = 'size-11' }: { s: Pick<AgendaStaff, 'name' | 'color'>; size?: string }) {
  const c = s.color && HEX.test(s.color) ? s.color : 'var(--brand)';
  return <span className={`grid ${size} shrink-0 place-items-center rounded-full font-semibold text-white`} style={{ background: c }}>{s.name.slice(0, 1).toUpperCase()}</span>;
}

// ------------------------------------------------------------------ booking
function BookView({ slug, onBooked }: { slug: string; onBooked: (token: string) => void }) {
  const [info, setInfo] = useState<AgendaInfo | null | undefined>(undefined);
  const [lang, setLangState] = useState<Lang>('fr');
  const setLang = (l: Lang) => { setLangState(l); applyLang(l); };
  useEffect(() => {
    agendaInfo(slug).then(x => {
      setInfo(x);
      if (!x) return;
      setLang(pickLang(x.languages, new URLSearchParams(window.location.search).get('lang')));
      applyBranding((x.branding ?? {}) as Branding, x.name);
    }).catch(() => setInfo(null));
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = S[lang];
  const [step, setStep] = useState(0);
  const [svc, setSvc] = useState<AgendaService | null>(null);
  const [who, setWho] = useState<string | null>(null); // staff id, or null = peu importe
  const [days, setDays] = useState<string[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const mine = load<{ name: string; phone: string }>('customer', 365 * 86400_000);
  const [name, setName] = useState(mine?.name ?? '');
  const [phone, setPhone] = useState(mine?.phone ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId] = useState(() => newId());
  const top = useRef<HTMLDivElement>(null);
  const saved = useMemo(() => savedOf(slug), [slug]);

  const tz = info?.timezone ?? 'UTC';
  const able = (s: AgendaService) => (info?.staff ?? []).filter(p => !p.services.length || p.services.includes(s.id));
  const go = (n: number) => { setStep(n); setError(null); top.current?.scrollIntoView({ block: 'start' }); };

  const chooseService = (s: AgendaService) => {
    setSvc(s); setSlot(null);
    const people = able(s);
    // a personal link (?rdv&p=<person>, shared by that person): straight to their times
    const pref = new URLSearchParams(window.location.search).get('p');
    if (pref && people.some(x => x.id === pref)) { setWho(pref); go(2); return; }
    // one person only, or "peu importe" switched off with one person: no need to ask
    if (people.length === 1) { setWho(people[0].id); go(2); }
    else { setWho(null); go(1); }
  };

  // from the salon's website: ?rdv&s=<prestation> opens that prestation directly
  const opened = useRef(false);
  useEffect(() => {
    if (!info || opened.current) return;
    opened.current = true;
    const sid = new URLSearchParams(window.location.search).get('s');
    const svc0 = sid ? info.services.find(x => x.id === sid) : null;
    if (svc0) chooseService(svc0);
  }, [info]); // eslint-disable-line react-hooks/exhaustive-deps

  // the days with a free time, then the first of them
  useEffect(() => {
    if (step !== 2 || !svc) return;
    let live = true;
    setDays(null); setDay(null); setSlots(null); setSlot(null);
    agendaDays(slug, svc.id, who).then(d => { if (!live) return; setDays(d ?? []); setDay(d?.[0] ?? null); }, e => { if (live) { setDays([]); setError(errText(t, e)); } });
    return () => { live = false; };
  }, [step, svc, who, slug]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!svc || !day) return;
    let live = true;
    setSlots(null); setSlot(null);
    agendaSlots(slug, svc.id, who, day).then(x => live && setSlots(x ?? []), e => { if (live) { setSlots([]); setError(errText(t, e)); } });
    return () => { live = false; };
  }, [day, svc, who, slug]); // eslint-disable-line react-hooks/exhaustive-deps

  if (info === undefined) return <Screen><Loader2 className="size-6 animate-spin text-muted" /></Screen>;
  if (info === null) return <Screen><p className="text-center text-muted">{t.notFound}</p></Screen>;
  const branding = (info.branding ?? {}) as Branding;
  if (!info.enabled || !info.services.length) return (
    <Screen>
      <div className="max-w-sm text-center">
        <p className="font-display text-2xl font-semibold">{info.name}</p>
        <p className="mt-2 text-muted">{t.closed}</p>
        {info.phone && <a href={`tel:${info.phone}`} className="mt-6 inline-flex h-12 items-center gap-2 rounded-full bg-brand px-6 font-semibold text-brand-ink"><Phone className="size-4" />{t.call}</a>}
      </div>
    </Screen>
  );

  const hm = (iso: string) => new Intl.DateTimeFormat(loc(lang), { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const hourOf = (iso: string) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso)));
  const today = ymd(new Date(), tz);
  const allDays = Array.from({ length: Math.min(info.days_ahead, 30) + 1 }, (_, i) => ymd(new Date(Date.now() + i * 86400_000), tz));
  const dayLabel = (d: string) => {
    const dt = new Date(`${d}T12:00:00Z`);
    return {
      top: d === today ? t.today : d === allDays[1] ? t.tomorrow : new Intl.DateTimeFormat(loc(lang), { timeZone: 'UTC', weekday: 'short' }).format(dt),
      num: new Intl.DateTimeFormat(loc(lang), { timeZone: 'UTC', day: 'numeric' }).format(dt),
      month: new Intl.DateTimeFormat(loc(lang), { timeZone: 'UTC', month: 'short' }).format(dt),
    };
  };
  const person = who ? info.staff.find(p => p.id === who) : null;
  const longDay = (iso: string) => new Intl.DateTimeFormat(loc(lang), { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
  const okDetails = !!slot && name.trim().length > 0 && phone.replace(/\D/g, '').length >= 9;
  const cats = [...new Set(info.services.map(s => s.category || ''))];

  const submit = async () => {
    if (!svc || !slot || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await agendaBook(slug, { client_id: clientId, service_id: svc.id, staff_id: who, starts_at: slot, name: name.trim(), phone: phone.trim(), note: note.trim() || undefined, lang });
      save('customer', { ...(mine ?? {}), name: name.trim(), phone: phone.trim() });
      remember(slug, res.token, res.starts_at);
      onBooked(res.token);
    } catch (e) {
      setError(errText(t, e));
      if ((e as Error).message === 'slot_unavailable' && day) { go(2); agendaSlots(slug, svc.id, who, day).then(x => setSlots(x ?? [])).catch(() => {}); }
    }
    setBusy(false);
  };

  const groups: [string, string[]][] = slots ? ([
    [t.morning, slots.filter(s => hourOf(s) < 12)],
    [t.afternoon, slots.filter(s => hourOf(s) >= 12 && hourOf(s) < 17)],
    [t.evening, slots.filter(s => hourOf(s) >= 17)],
  ] as [string, string[]][]).filter(([, xs]) => xs.length) : [];

  return (
    <main className="min-h-dvh bg-bg pb-40 text-ink">
      <div ref={top} className="mx-auto max-w-lg">
        <SalonHead name={info.name} branding={branding} address={info.address} city={info.city} lang={lang} langs={info.languages ?? []} onLang={setLang} />

        <div className="px-5 pt-3">
          {step > 0 && (
            <button onClick={() => go(step === 2 && svc && able(svc).length === 1 ? 0 : step - 1)} className="-ms-2 mb-1 inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-sm font-semibold text-muted press">
              <ArrowLeft className="size-4 rtl:rotate-180" />{t.back}
            </button>
          )}
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {[0, 1, 2, 3].map(i => <span key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-brand' : 'bg-surface-2'}`} />)}
          </div>
          <h1 className="mt-4 font-display text-[1.75rem] font-semibold leading-tight">{[t.service, t.who, t.when, t.details][step]}</h1>
          {step === 0 && saved.length > 0 && (
            <button onClick={() => onBooked(saved[0].token)} className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-brand/30 bg-brand/5 px-4 py-3 text-start press">
              <CalendarCheck2 className="size-5 shrink-0 text-brand" /><span className="flex-1 font-semibold">{t.mine}</span><ChevronRight className="size-4 text-muted rtl:rotate-180" />
            </button>
          )}
        </div>

        {step === 0 && (
          <div className="mt-4 space-y-6 px-5">
            {cats.map(c => (
              <section key={c}>
                {cats.length > 1 && <h2 className="mb-2 text-sm font-semibold text-muted">{c || t.otherCat}</h2>}
                <ul className="overflow-hidden rounded-3xl bg-surface shadow-[var(--shadow)]">
                  {info.services.filter(s => (s.category || '') === c).map((s, i) => (
                    <li key={s.id} className={i ? 'border-t border-line' : ''}>
                      <button onClick={() => chooseService(s)} className="flex w-full items-center gap-3 px-4 py-4 text-start transition-colors hover:bg-surface-2/60">
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">{lt(s.name, lang)}</span>
                          {lt(s.description, lang) && <span className="mt-0.5 line-clamp-2 block text-sm text-muted">{lt(s.description, lang)}</span>}
                          <span className="mt-1 flex items-center gap-1 text-sm text-muted"><Clock className="size-3.5" />{dur(s.duration_min, lang)}</span>
                        </span>
                        <span className="shrink-0 text-end text-sm font-semibold tabular-nums">{price(s, t, lang)}</span>
                        <ChevronRight className="size-4 shrink-0 text-muted rtl:rotate-180" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {step === 1 && svc && (
          <ul className="mt-4 space-y-2 px-5">
            {info.any_staff && (
              <li>
                <button onClick={() => { setWho(null); go(2); }} className="flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 text-start shadow-[var(--shadow)] press">
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-brand"><Shuffle className="size-5" /></span>
                  <span className="flex-1"><span className="block font-semibold">{t.any}</span><span className="block text-sm text-muted">{t.anyTxt}</span></span>
                  <ChevronRight className="size-4 text-muted rtl:rotate-180" />
                </button>
              </li>
            )}
            {able(svc).map(p => (
              <li key={p.id}>
                <button onClick={() => { setWho(p.id); go(2); }} className="flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 text-start shadow-[var(--shadow)] press">
                  <Avatar s={p} /><span className="flex-1 font-semibold">{p.name}</span><ChevronRight className="size-4 text-muted rtl:rotate-180" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {step === 2 && svc && (
          <div className="mt-4">
            {days === null ? <p className="px-5 text-sm text-muted">{t.loading}</p> : !days.length ? (
              <div className="mx-5 rounded-2xl bg-surface-2 p-4 text-sm text-muted">
                {t.noDay}
                {info.phone && <a href={`tel:${info.phone}`} className="mt-3 flex h-11 items-center justify-center gap-2 rounded-full bg-surface font-semibold text-ink"><Phone className="size-4" />{t.call}</a>}
              </div>
            ) : <>
              <div className="no-scrollbar flex gap-2 overflow-x-auto px-5 pb-1">
                {allDays.map(d => {
                  const free = days.includes(d); const l = dayLabel(d);
                  return (
                    <button key={d} disabled={!free} onClick={() => setDay(d)}
                      className={`flex w-[4.25rem] shrink-0 flex-col items-center rounded-2xl py-2.5 transition ${day === d ? 'bg-brand text-brand-ink' : free ? 'bg-surface shadow-[var(--shadow)]' : 'bg-transparent text-muted/50 line-through decoration-1'}`}>
                      <span className="text-[0.7rem] font-semibold capitalize">{l.top}</span>
                      <span className="font-display text-xl font-semibold leading-tight">{l.num}</span>
                      <span className="text-[0.7rem] capitalize opacity-80">{l.month}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 space-y-4 px-5">
                {slots === null ? <p className="text-sm text-muted">{t.loading}</p> : !slots.length ? <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">{t.noSlot}</p>
                  : groups.map(([g, xs]) => (
                    <div key={g}>
                      <p className="mb-2 text-sm font-semibold text-muted">{g}</p>
                      <div className="grid grid-cols-4 gap-2">
                        {xs.map(s => (
                          <button key={s} onClick={() => { setSlot(s); go(3); }} dir="ltr"
                            className={`rounded-xl py-2.5 text-sm font-bold tabular-nums transition press ${slot === s ? 'bg-brand text-brand-ink' : 'bg-surface shadow-[var(--shadow)]'}`}>{hm(s)}</button>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </>}
          </div>
        )}

        {step === 3 && svc && slot && (
          <div className="mt-4 space-y-3 px-5">
            <input className="h-12 w-full rounded-2xl border border-line bg-surface px-4 outline-none focus:border-brand" placeholder={t.name} value={name} onChange={e => setName(e.target.value)} maxLength={60} autoComplete="given-name" />
            <input className="h-12 w-full rounded-2xl border border-line bg-surface px-4 outline-none focus:border-brand" placeholder={t.phone} value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" dir="ltr" />
            <textarea className="h-20 w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3 outline-none focus:border-brand" placeholder={t.note} value={note} onChange={e => setNote(e.target.value)} maxLength={300} />
            {info.cancel_hours > 0 && <p className="text-xs text-muted">{t.cancelUntil(info.cancel_hours)}</p>}
          </div>
        )}
        {error && <p className="mx-5 mt-4 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
        {info.note && step === 0 && <p className="mx-5 mt-6 text-sm text-muted">{info.note}</p>}
      </div>

      {svc && step > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 backdrop-blur-md">
          <div className="mx-auto max-w-lg px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            <div className="flex items-center gap-3">
              {person ? <Avatar s={person} size="size-9" /> : <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-brand"><Scissors className="size-4" /></span>}
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-semibold">{lt(svc.name, lang)} <span className="font-normal text-muted">· {dur(svc.duration_min, lang)}</span></p>
                <p className="truncate text-muted first-letter:uppercase">{slot ? `${longDay(slot)} · ${hm(slot)}` : person ? t.with(person.name) : step >= 2 ? t.any : ''}{slot && person ? ` · ${t.with(person.name)}` : ''}</p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{price(svc, t, lang)}</span>
            </div>
            {step === 3 && (
              <button disabled={!okDetails || busy} onClick={submit} className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand font-semibold text-brand-ink glow-brand press disabled:opacity-40">
                {busy ? <><Loader2 className="size-4 animate-spin" />{t.busy}</> : t.confirm}
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

// ------------------------------------------------------------------ the client's page
function StatusView({ slug, token, onAgain }: { slug: string; token: string; onAgain: () => void }) {
  const [st, setSt] = useState<AgendaStatus | null | undefined>(undefined);
  const [lang, setLangState] = useState<Lang>('fr');
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);
  const refresh = () => agendaStatus(token).then(x => {
    setSt(x);
    if (x && first.current) {
      first.current = false;
      const l = pickLang(x.salon.languages, new URLSearchParams(window.location.search).get('lang'));
      setLangState(l); applyLang(l); applyBranding((x.salon.branding ?? {}) as Branding, x.salon.name);
      if (x.status === 'requested' || x.status === 'confirmed') remember(slug, token, x.starts_at);
    }
  }).catch(() => setSt(s => (s === undefined ? null : s)));
  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 30000);
    return () => window.clearInterval(id);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = S[lang];
  if (st === undefined) return <Screen><Loader2 className="size-6 animate-spin text-muted" /></Screen>;
  if (!st) return (
    <Screen>
      <div className="text-center">
        <p className="text-muted">{t.notFound}</p>
        <button onClick={onAgain} className="mt-5 h-12 rounded-full bg-brand px-6 font-semibold text-brand-ink">{t.title}</button>
      </div>
    </Screen>
  );
  const tz = st.salon.timezone;
  const svcName = lt(st.service, lang);
  const day = new Intl.DateTimeFormat(loc(lang), { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(st.starts_at));
  const time = new Intl.DateTimeFormat(loc(lang), { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(st.starts_at));
  const upcoming = st.status === 'requested' || st.status === 'confirmed';
  const head = st.status === 'confirmed' ? { Icon: CheckCircle2, tone: 'text-emerald-500', h: t.confirmed, p: '' }
    : st.status === 'requested' ? { Icon: Hourglass, tone: 'text-brand', h: t.requested, p: t.requestedTxt }
    : st.status === 'cancelled' ? { Icon: XCircle, tone: 'text-muted', h: t.cancelled, p: st.cancelled_by === 'salon' ? t.cancelledSalon : '' }
    : st.status === 'no_show' ? { Icon: XCircle, tone: 'text-muted', h: t.noShow, p: '' }
    : { Icon: CheckCircle2, tone: 'text-emerald-500', h: t.past, p: '' };

  const cancel = async () => {
    setBusy(true); setError(null);
    try { await agendaCancel(token); await refresh(); setSure(false); } catch (e) { setError(errText(t, e)); }
    setBusy(false);
  };
  const confirmCome = async () => {
    setBusy(true); setError(null);
    try { await agendaConfirm(token); await refresh(); } catch (e) { setError(errText(t, e)); }
    setBusy(false);
  };
  const ics = () => {
    const f = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const where = [st.salon.address, st.salon.city].filter(Boolean).join(', ');
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Amplify//Agenda//FR', 'BEGIN:VEVENT', `UID:${token}@amplify`, `DTSTAMP:${f(new Date().toISOString())}`,
      `DTSTART:${f(st.starts_at)}`, `DTEND:${f(st.ends_at)}`, `SUMMARY:${svcName} · ${st.salon.name}`.replace(/[,;]/g, ' '), where ? `LOCATION:${where.replace(/[,;]/g, ' ')}` : '',
      `URL:${window.location.href}`, 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' })); a.download = 'rendez-vous.ics'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const wa = st.salon.phone ? `https://wa.me/${waNumber(st.salon.phone)}?text=${encodeURIComponent(`${t.wa(svcName, `${day} · ${time}`)}\n${window.location.href}`)}` : null;

  return (
    <main className="min-h-dvh bg-bg pb-10 text-ink">
      <div className="mx-auto max-w-lg">
        <SalonHead name={st.salon.name} branding={(st.salon.branding ?? {}) as Branding} address={st.salon.address} city={st.salon.city} lang={lang} langs={[]} />
        <div className="px-5 pt-6 text-center">
          <head.Icon className={`mx-auto size-14 ${head.tone}`} />
          <h1 className="mt-3 font-display text-[1.75rem] font-semibold leading-tight">{head.h}</h1>
          {head.p && <p className="mt-1 text-muted">{head.p}</p>}
        </div>

        <div className="mx-5 mt-6 overflow-hidden rounded-3xl bg-surface shadow-[var(--shadow)]">
          <div className="flex items-center gap-4 border-b border-line px-5 py-4">
            <div className="text-center">
              <p className="font-display text-3xl font-semibold leading-none tabular-nums" dir="ltr">{time}</p>
            </div>
            <p className="flex-1 font-semibold first-letter:uppercase">{day}</p>
          </div>
          <div className="space-y-1 px-5 py-4 text-sm">
            <p className="text-base font-semibold">{svcName}</p>
            <p className="text-muted">{dur(st.duration_min, lang)}{st.staff ? ` · ${t.with(st.staff)}` : ''}{st.price_cents > 0 ? ` · ${price(st, t, lang)}` : ''}</p>
            <p className="text-muted">{st.name}</p>
          </div>
        </div>
        {st.salon.note && upcoming && <p className="mx-5 mt-3 text-sm text-muted">{st.salon.note}</p>}

        {error && <p className="mx-5 mt-4 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
        <div className="mt-6 space-y-2 px-5">
          {upcoming && st.client_confirmed && <p className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-600"><CheckCircle2 className="size-4" />{t.thanksCome}</p>}
          {upcoming && st.can_confirm && !st.client_confirmed && (
            <button disabled={busy} onClick={confirmCome} className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-emerald-600 text-lg font-semibold text-white press disabled:opacity-40"><CheckCircle2 className="size-5" />{t.iCome}</button>
          )}
          {upcoming && <button onClick={ics} className={`flex h-12 w-full items-center justify-center gap-2 rounded-full font-semibold press ${st.can_confirm && !st.client_confirmed ? 'bg-surface shadow-[var(--shadow)]' : 'bg-brand text-brand-ink glow-brand'}`}><CalendarPlus className="size-4" />{t.calendar}</button>}
          {wa && upcoming && <a href={wa} target="_blank" rel="noopener" className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-surface font-semibold shadow-[var(--shadow)] press"><MessageCircle className="size-4" />{t.write}</a>}
          {st.salon.phone && <a href={`tel:${st.salon.phone}`} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-surface font-semibold shadow-[var(--shadow)] press"><Phone className="size-4" />{t.call}</a>}
          {!upcoming && <button onClick={onAgain} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand font-semibold text-brand-ink press">{t.again}</button>}
        </div>

        {upcoming && (() => {
          const days = Math.round((new Date(new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(st.starts_at))).getTime() - new Date(new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())).getTime()) / 86400000);
          const b = (st.salon.branding ?? {}) as Branding;
          return <RdvStory lang={lang} link={`${window.location.origin}/${slug}?rdv`} logoUrl={b.logo_url}
            input={{ salon: st.salon.name, handle: st.salon.handle ?? undefined, primary: b.primary_color ?? '#8E3B4F', title: STORY[lang].title, service: svcName,
              day, time, countdown: STORY[lang].count(days), staff: st.staff ? t.with(st.staff) : undefined, cta: STORY[lang].cta }} />;
        })()}

        {upcoming && (
          <div className="mx-5 mt-8 border-t border-line pt-5 text-center">
            {st.can_cancel ? (sure ? (
              <div className="flex gap-2">
                <button onClick={() => setSure(false)} className="h-12 flex-1 rounded-full bg-surface-2 font-semibold">{t.keep}</button>
                <button disabled={busy} onClick={cancel} className="h-12 flex-1 rounded-full bg-red-600 font-semibold text-white disabled:opacity-40">{t.cancelSure}</button>
              </div>
            ) : <button onClick={() => setSure(true)} className="h-11 rounded-full px-5 font-semibold text-red-500">{t.cancel}</button>)
              : <p className="text-sm text-muted">{t.tooLate}</p>}
            {st.can_cancel && st.salon.cancel_hours > 0 && <p className="mt-2 text-xs text-muted">{t.cancelUntil(st.salon.cancel_hours)}</p>}
            <p className="mt-4 text-xs text-muted">{t.saveLink}</p>
          </div>
        )}
      </div>
    </main>
  );
}
