// The restaurant's sign-up page, from a QR code: <slug>?club (counter, tables) or <slug>?club=<key>
// (a tasting). The phone fills in the name and number (autocomplete), one tap signs up. The same
// phone is remembered, so a second scan is one tap too.
//
// One fixed design for every restaurant: only the colour, the logo and (when there is one) the cover
// photo come from the restaurant's branding. A first visit opens with a short brand intro (the colour
// fills the screen, the logo lands, the panel lifts away); a returning guest skips it. After signing
// up, confetti in the restaurant's colours, with a party-popper bang.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Gift, Loader2, PartyPopper, Phone, ShieldCheck, Sparkles, Tag, User, Volume2 } from 'lucide-react';
import { inkFor, type Branding } from '@resto/shared';
import { applyBranding, applyLang } from '../theme';
import { load, save } from '../lib/storage';
import { ApiError, customerSignup, signupInfo, type SignupInfo, type SignupResult } from '../lib/api';
import { playPop, preloadCheer, unlockAudio } from './confettiSound';

const S = {
  fr: {
    join: (r: string) => `Rejoignez le club ${r}`, event: 'Inscrivez-vous pour la dégustation',
    lead: 'Offres, nouveautés et cadeaux, directement sur WhatsApp.', points: (p: number, v: string) => `Et ${p} points = ${v} offerts.`,
    name: 'Prénom', phone: 'Numéro WhatsApp', go: 'Je m’inscris', joinGo: 'Rejoindre le club', busy: 'Inscription…',
    perks: ['Offres exclusives', 'Nouveautés en avant-première', 'Cadeaux'] as string[],
    consent: (r: string) => `En vous inscrivant, vous acceptez de recevoir les offres de ${r} sur WhatsApp. Vous pouvez arrêter à tout moment.`,
    hello: (n: string) => `Re-bonjour ${n}`, done: (n: string) => `Bienvenue ${n} !`, already: 'Vous étiez déjà inscrit : c’est noté.', card: 'Voir ma carte fidélité',
    show: 'Montrez cet écran au personnel', twice: 'Déjà inscrit à cette dégustation', twiceTxt: 'Ce numéro a déjà été inscrit ici.',
    off: 'Les inscriptions ne sont pas ouvertes pour le moment.', closed: 'Cette dégustation est terminée.', notFound: 'Ce restaurant est introuvable.',
    errors: { customer_required: 'Indiquez votre prénom et un numéro valide.', rate_limited: 'Trop d’inscriptions en même temps. Réessayez dans une minute.',
      event_closed: 'Cette dégustation est terminée.', signup_off: 'Les inscriptions ne sont pas ouvertes pour le moment.', network: 'Pas de connexion. Réessayez.' } as Record<string, string>,
    other: 'Une erreur est survenue. Réessayez.', notMe: 'Ce n’est pas moi',
    gateTitle: (r: string) => `Le club ${r}`, gateGo: 'Entrer dans le club', gateTease: 'Le club applaudit chaque nouveau membre. Montez le son !',
  },
  en: {
    join: (r: string) => `Join the ${r} club`, event: 'Sign up for the tasting',
    lead: 'Offers, news and gifts, straight to WhatsApp.', points: (p: number, v: string) => `And ${p} points = ${v} off.`,
    name: 'First name', phone: 'WhatsApp number', go: 'Sign me up', joinGo: 'Join the club', busy: 'Signing up…',
    perks: ['Exclusive offers', 'First to know', 'Gifts'] as string[],
    consent: (r: string) => `By signing up, you agree to receive offers from ${r} on WhatsApp. You can stop at any time.`,
    hello: (n: string) => `Welcome back ${n}`, done: (n: string) => `Welcome ${n}!`, already: 'You were already a member: all set.', card: 'See my loyalty card',
    show: 'Show this screen to the staff', twice: 'Already signed up for this tasting', twiceTxt: 'This number was already signed up here.',
    off: 'Sign-ups are not open right now.', closed: 'This tasting is over.', notFound: 'This restaurant could not be found.',
    errors: { customer_required: 'Please enter your name and a valid number.', rate_limited: 'Too many sign-ups at once. Try again in a minute.',
      event_closed: 'This tasting is over.', signup_off: 'Sign-ups are not open right now.', network: 'No connection. Try again.' } as Record<string, string>,
    other: 'Something went wrong. Try again.', notMe: 'Not me',
    gateTitle: (r: string) => `The ${r} club`, gateGo: 'Step into the club', gateTease: 'The club applauds every new member. Turn your sound up!',
  },
  ar: {
    join: (r: string) => `انضموا إلى نادي ${r}`, event: 'سجلوا للتذوق',
    lead: 'عروض ومستجدات وهدايا، مباشرة على واتساب.', points: (p: number, v: string) => `و${p} نقطة = ${v} هدية.`,
    name: 'الاسم', phone: 'رقم واتساب', go: 'سجلني', joinGo: 'انضم إلى النادي', busy: 'جار التسجيل…',
    perks: ['عروض حصرية', 'أول من يعلم بالجديد', 'هدايا'] as string[],
    consent: (r: string) => `بالتسجيل، توافقون على تلقي عروض ${r} على واتساب. يمكنكم التوقف في أي وقت.`,
    hello: (n: string) => `مرحبا من جديد ${n}`, done: (n: string) => `مرحبا ${n}!`, already: 'كنتم مسجلين من قبل: تم الحفظ.', card: 'عرض بطاقة الوفاء الخاصة بي',
    show: 'أظهروا هذه الشاشة للعاملين', twice: 'مسجل من قبل في هذا التذوق', twiceTxt: 'هذا الرقم سُجل هنا من قبل.',
    off: 'التسجيل غير مفتوح حاليا.', closed: 'انتهى هذا التذوق.', notFound: 'لم يتم العثور على هذا المطعم.',
    errors: { customer_required: 'أدخلوا اسمكم ورقما صحيحا.', rate_limited: 'تسجيلات كثيرة في نفس الوقت. أعيدوا المحاولة بعد دقيقة.',
      event_closed: 'انتهى هذا التذوق.', signup_off: 'التسجيل غير مفتوح حاليا.', network: 'لا يوجد اتصال. أعيدوا المحاولة.' } as Record<string, string>,
    other: 'حدث خطأ. أعيدوا المحاولة.', notMe: 'لست أنا',
    gateTitle: (r: string) => `نادي ${r}`, gateGo: 'ادخلوا النادي', gateTease: 'النادي يصفق لكل عضو جديد. ارفعوا الصوت!',
  },
};
type Lang = keyof typeof S;

const HEX = /^#[0-9a-f]{6}$/i;
const PERK_ICONS = [Tag, Sparkles, Gift];
const INTRO_MS = 2100;      // length of the brand intro (the wipe at its end)
const INTRO_BASE = 1500;    // the page content starts rising while the panel lifts away

// Phones only play sound after a tap. With TAP_TO_OPEN the first visit starts at the club door ("Entrer dans le
// club"): the tap opens the doors and the club cheers for the new member. Set to false for the silent, automatic
// brand intro instead.
const TAP_TO_OPEN = true;
const DOOR_BASE = 650;      // the page content starts rising while the doors swing open

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const seenIntro = (slug: string) => { try { return !!sessionStorage.getItem(`club-intro:${slug}`); } catch { return false; } };
const markIntro = (slug: string) => { try { sessionStorage.setItem(`club-intro:${slug}`, '1'); } catch { /* private mode */ } };

function WhatsAppIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="currentColor" d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2Zm0 18.15c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 4.54 0 8.24 3.7 8.24 8.24 0 4.55-3.7 8.24-8.24 8.24Zm4.52-6.16c-.25-.12-1.47-.72-1.7-.81-.22-.08-.39-.12-.55.13-.17.24-.64.8-.78.97-.15.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.12-.55-1.34-.76-1.83-.2-.48-.4-.42-.55-.42h-.47a.9.9 0 0 0-.66.31c-.22.25-.86.85-.86 2.07s.88 2.4 1.01 2.57c.12.16 1.74 2.66 4.22 3.73.59.25 1.05.4 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
    </svg>
  );
}

export default function ClubSignup({ slug, eventKey }: { slug: string; eventKey: string | null }) {
  const [info, setInfo] = useState<SignupInfo | null | undefined>(undefined);
  const [lang, setLang] = useState<Lang>('fr');
  const mine = load<{ name: string; phone: string }>(`club:${slug}`, 3 * 365 * 86400_000);
  const [name, setName] = useState(mine?.name ?? '');
  const [phone, setPhone] = useState(mine?.phone ?? '');
  const [known, setKnown] = useState(!!mine);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<SignupResult | null>(null);
  const [intro, setIntro] = useState(false);
  const [base, setBase] = useState(0);
  const [confetti, setConfetti] = useState(false);
  const [openConfetti, setOpenConfetti] = useState(false);
  const [gate, setGate] = useState<false | 'wait' | 'open'>(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // starts the opening: the club doors (or the brand panel), the confetti and the cheer
  const begin = (sl: string) => {
    markIntro(sl); unlockAudio();
    setOpenConfetti(true); setTimeout(() => setOpenConfetti(false), 5600);
    if (TAP_TO_OPEN) { setGate('open'); setBase(DOOR_BASE); playPop(0.05); }
    else { setBase(INTRO_BASE); setIntro(true); setTimeout(() => playPop(), 550); }
  };

  useEffect(() => {
    preloadCheer();
    signupInfo(slug, eventKey).then(x => {
      setInfo(x);
      if (!x) return;
      const langs = (x.languages?.length ? x.languages : ['fr']).filter((l): l is Lang => l in S);
      const phoneLang = (navigator.language || '').slice(0, 2) as Lang;
      const l = langs.includes(phoneLang) ? phoneLang : langs[0] ?? 'fr';
      setLang(l); applyLang(l);
      applyBranding((x.branding ?? {}) as Branding, x.name);
      // first visit in this session, nothing remembered: play the brand intro (a returning guest goes straight in)
      const open = x.enabled && !(eventKey && (!x.event || !x.event.active));
      if (open && !mine && !reduced() && !seenIntro(slug)) { if (TAP_TO_OPEN) setGate('wait'); else begin(slug); }
    }).catch(() => setInfo(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, eventKey]);

  const branding = (info?.branding ?? {}) as Branding;
  const brand = branding.primary_color && HEX.test(branding.primary_color) ? branding.primary_color : '#C2410C';
  // the colour that makes the hero text stand out the most: darker for a dark brand, lighter for a light one
  const anti = inkFor(brand) === '#ffffff' ? '#000000' : '#ffffff';
  const vars = { '--anti': anti, '--base': `${base}ms` } as React.CSSProperties;

  const t = S[lang];
  if (info === undefined) return <Screen><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted" /></Screen>;
  if (info === null) return <Screen><p className="text-center text-muted">{t.notFound}</p></Screen>;
  const r = info.name;
  const logo = branding.logo_url;
  const cover = branding.cover_url;
  const closedEvent = eventKey && (!info.event || !info.event.active);
  const isEvent = !!(info.event && !closedEvent);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    unlockAudio(); // inside the tap, so the browser allows the pop after the sign-up
    setErr('');
    if (!name.trim() || phone.replace(/\D/g, '').length < 9) { setErr(t.errors.customer_required); return; }
    setBusy(true);
    try {
      const res = await customerSignup(slug, name, phone, true, eventKey);
      save(`club:${slug}`, { name: name.trim(), phone });
      if (res.card_key) save(`card:${slug}`, res.card_key);
      setDone(res);
      if (!res.again && !reduced()) { setConfetti(true); playPop(0, false, true); setTimeout(() => setConfetti(false), 5200); }
      window.scrollTo(0, 0);
    } catch (x) {
      const m = x instanceof ApiError ? x.message : '';
      setErr(t.errors[m] ?? t.other);
    }
    setBusy(false);
  };

  if (done) {
    const twice = done.again;
    const cardKey = done.card_key ?? load<string>(`card:${slug}`, 3 * 365 * 86400_000);
    if (twice) {
      return (
        <Screen>
          <div className="rounded-[2rem] bg-[#F2AD46]/15 p-8 text-center">
            <AlertTriangle className="mx-auto h-14 w-14 text-[#B7791F]" />
            <p className="mt-4 font-display text-3xl font-semibold">{t.twice}</p>
            <p className="mt-2 text-sm">{t.twiceTxt}</p>
          </div>
          <p className="mt-6 text-center font-display text-lg">{r}</p>
        </Screen>
      );
    }
    return (
      <main className="club-hero relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-12 text-center text-brand-ink" style={vars}>
        <Backdrop cover={cover} />
        {confetti && <Confetti brand={brand} />}
        <div className="relative w-full max-w-md">
          <span className="relative mx-auto grid h-28 w-28 place-items-center">
            <span className="animate-pulse-ring absolute inset-0 rounded-full bg-brand-ink/25" aria-hidden="true" />
            <span className="animate-pop relative grid h-24 w-24 place-items-center rounded-full bg-brand-ink/15 ring-2 ring-brand-ink/40"><CheckCircle2 className="h-14 w-14" /></span>
          </span>
          <p className="club-rise mt-6 font-display text-[2.6rem] font-semibold leading-[1.05]" style={{ '--d': '250ms' } as React.CSSProperties}>{t.done(done.name)}</p>
          {done.existed && !done.event && <p className="club-rise mt-3 text-sm opacity-85" style={{ '--d': '400ms' } as React.CSSProperties}>{t.already}</p>}
          {info.loyalty && cardKey && <a href={`${window.location.pathname}?carte=${cardKey}`} className="club-rise mt-6 inline-flex items-center justify-center gap-2 rounded-2xl bg-black/20 px-5 py-3 font-semibold backdrop-blur-sm" style={{ '--d': '480ms' } as React.CSSProperties}><Gift className="h-5 w-5" />{t.card}</a>}
          {done.event && <div className="club-rise mt-8 rounded-[1.6rem] bg-black/15 px-5 py-5 backdrop-blur-sm" style={{ '--d': '450ms' } as React.CSSProperties}>
            <p className="text-sm font-semibold opacity-85">{done.event}</p>
            {done.offer && <p className="mt-1 font-display text-2xl font-semibold">{done.offer}</p>}
            <p className="mt-4 rounded-2xl bg-black/15 px-4 py-3 font-semibold">{t.show}</p>
            <p className="mt-3 text-xs tabular opacity-75">{new Date().toLocaleString(lang === 'ar' ? 'ar-MA-u-nu-latn' : lang === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
          </div>}
          <p className="club-rise mt-10 font-display text-lg opacity-90" style={{ '--d': '600ms' } as React.CSSProperties}>{r}</p>
        </div>
      </main>
    );
  }

  const rise = (d: number) => ({ '--d': `${d}ms` } as React.CSSProperties);
  return (<>
    {gate && <Gate phase={gate} logo={logo} name={r} brand={brand} title={isEvent ? info.event!.name : t.gateTitle(r)}
      lead={isEvent ? (info.event!.offer ?? t.event) : t.lead} tease={t.gateTease} label={t.gateGo}
      onTap={() => begin(slug)} onEnd={() => setGate(false)} />}
    <main className="min-h-dvh md:grid md:grid-cols-[1.05fr_1fr]" style={gate === 'wait' ? { ...vars, display: 'none' } : vars}>
      {openConfetti && <Confetti brand={brand} offset={TAP_TO_OPEN ? 0.3 : 0.55} top />}
      {intro && <Intro logo={logo} name={r} onSkip={() => { setIntro(false); setBase(0); }} onEnd={() => setIntro(false)} />}

      {/* the hero: the restaurant's colour, its logo, the promise */}
      <section className="club-hero relative isolate overflow-hidden text-brand-ink md:min-h-dvh">
        <Backdrop cover={cover} />
        <div className="relative mx-auto flex max-w-md flex-col items-center px-6 pb-16 pt-9 text-center md:min-h-dvh md:justify-center md:pb-12 md:pt-12">
          {logo
            ? <div className="club-rise rounded-[1.7rem] bg-white p-1.5 shadow-[0_18px_40px_-14px_rgba(0,0,0,.55)] ring-4 ring-white/25" style={rise(0)}>
                <img src={logo} alt={r} className="h-[4.75rem] w-[4.75rem] rounded-[1.25rem] object-cover md:h-24 md:w-24" />
              </div>
            : <p className="club-rise font-display text-3xl font-semibold" style={rise(0)}>{r}</p>}
          <h1 className="club-rise mt-5 font-display text-[2.2rem] font-semibold leading-[1.04] md:mt-6 md:text-[3.2rem]" style={rise(120)}>{isEvent ? info.event!.name : t.join(r)}</h1>
          <p className="club-rise mx-auto mt-2.5 max-w-sm text-base leading-snug opacity-90 md:mt-3 md:text-[1.05rem]" style={rise(240)}>
            {isEvent ? (info.event!.offer ?? t.event) : t.lead}
            {!info.event && info.loyalty && info.loyalty.reward_points ? ` ${t.points(Number(info.loyalty.reward_points), `${Math.round(Number(info.loyalty.reward_cents) / 100)} DH`)}` : ''}
          </p>
        </div>
      </section>

      {/* the sheet: three perks, the form, the promise of no spam */}
      <section className="club-rise relative z-10 -mt-8 rounded-t-[2.2rem] bg-surface px-5 pb-8 pt-6 shadow-[0_-24px_48px_-24px_rgba(0,0,0,.35)] md:mt-0 md:flex md:items-center md:rounded-none md:bg-bg md:px-12 md:shadow-none" style={rise(380)}>
        <div className="mx-auto w-full max-w-md">
          {!isEvent && (
            <ul className="mb-5 grid grid-cols-3 gap-2 text-center md:mb-7">
              {t.perks.map((p, i) => {
                const Icon = PERK_ICONS[i];
                return (
                  <li key={p} className="flex flex-col items-center gap-2">
                    <span className="grid h-10 w-10 place-items-center rounded-2xl md:h-12 md:w-12" style={{ background: 'color-mix(in srgb, var(--brand) 14%, var(--surface-2))' }}><Icon className="h-5 w-5" /></span>
                    <span className="text-[0.74rem] font-semibold leading-tight md:text-[0.78rem]">{p}</span>
                  </li>
                );
              })}
            </ul>
          )}

          {!info.enabled || closedEvent ? (
            <p className="rounded-2xl bg-surface-2 p-5 text-center">{closedEvent ? t.closed : t.off}</p>
          ) : (
            <form onSubmit={submit} className="space-y-3" autoComplete="on">
              {known && name ? (
                <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3.5">
                  <span className="font-semibold">{t.hello(name)}</span>
                  <button type="button" className="text-sm text-muted underline" onClick={() => { setKnown(false); setName(''); setPhone(''); setTimeout(() => nameRef.current?.focus(), 0); }}>{t.notMe}</button>
                </div>
              ) : (<>
                <label className="relative block">
                  <span className="sr-only">{t.name}</span>
                  <User className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
                  <input ref={nameRef} name="name" autoComplete="name" required value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder={t.name}
                    className="w-full rounded-2xl border-2 border-transparent bg-surface-2 py-3.5 pe-4 ps-12 text-lg outline-none transition-colors placeholder:text-muted focus:border-brand focus:bg-surface" />
                </label>
                <label className="relative block">
                  <span className="sr-only">{t.phone}</span>
                  <Phone className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
                  <input name="tel" type="tel" autoComplete="tel" inputMode="tel" dir="ltr" required value={phone} onChange={e => setPhone(e.target.value)} placeholder={`${t.phone} · 06 12 34 56 78`} maxLength={20}
                    className="w-full rounded-2xl border-2 border-transparent bg-surface-2 py-3.5 pe-4 ps-12 text-lg tabular outline-none transition-colors placeholder:text-sm placeholder:text-muted focus:border-brand focus:bg-surface" />
                </label>
              </>)}
              {err && <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{err}</p>}
              <button type="submit" disabled={busy} className="club-cta press flex w-full items-center justify-center gap-2.5 rounded-2xl bg-brand px-4 py-[1.1rem] text-lg font-semibold text-brand-ink disabled:opacity-60">
                {busy ? <><Loader2 className="h-5 w-5 animate-spin" />{t.busy}</> : <><WhatsAppIcon className="h-5 w-5" />{isEvent ? t.go : t.joinGo}</>}
              </button>
              <p className="flex items-start justify-center gap-1.5 px-1 pt-1 text-center text-xs leading-snug text-muted">
                <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" /><span>{t.consent(r)}</span>
              </p>
            </form>
          )}
          <p className="mt-6 text-center text-[0.7rem] font-medium tracking-wide text-muted">Powered by Amplify</p>
        </div>
      </section>
    </main>
  </>);
}

// The colour fills the hero: soft highlights, the restaurant's lattice, slow floating shapes, and the
// cover photo under a wash of the brand colour when the restaurant has one.
function Backdrop({ cover }: { cover?: string }) {
  return (
    <>
      {cover && <>
        <img src={cover} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
        <div className="absolute inset-0 -z-10" style={{ background: 'color-mix(in srgb, var(--brand) 78%, transparent)' }} aria-hidden="true" />
      </>}
      <div className="pointer-events-none absolute inset-0 -z-10 fade-down" aria-hidden="true"><div className="zellige-ink absolute inset-0 opacity-[.13]" /></div>
      <span className="float pointer-events-none absolute -start-16 top-10 -z-10 h-56 w-56 rounded-full opacity-40 blur-3xl" style={{ background: 'color-mix(in srgb, var(--brand-ink) 55%, transparent)' }} aria-hidden="true" />
      <span className="float pointer-events-none absolute -end-12 bottom-24 -z-10 h-44 w-44 rounded-full opacity-30 blur-3xl" style={{ background: 'var(--brand-ink)', animationDelay: '-3s' }} aria-hidden="true" />
    </>
  );
}

// The club door: two doors in the restaurant's colour, the logo, the club's name and one big button. The tap
// is the guest stepping in: the doors swing open, the confetti flies and the club cheers. The tap is also what
// unlocks the sound on a phone.
const STARS: [number, number, number, number][] = [[7, 10, 0, 1.1], [11, 80, .6, 1.5], [27, 3, 1.2, 1], [22, 91, .3, 1.2], [60, 4, .9, 1.3], [64, 91, 1.5, 1.1], [90, 18, .4, 1], [91, 76, 1.1, 1.3]];

function Gate({ phase, logo, name, brand, title, lead, tease, label, onTap, onEnd }: {
  phase: 'wait' | 'open'; logo?: string; name: string; brand: string; title: string; lead: string; tease: string; label: string; onTap: () => void; onEnd: () => void;
}) {
  const open = phase === 'open';
  const door = (right: boolean) => ({ backgroundSize: '200% 100%', backgroundPosition: right ? '100% 0' : '0 0' });
  const edge = 'linear-gradient(to bottom, rgba(255,255,255,.5), transparent 24%, transparent 78%, rgba(255,255,255,.5))';
  return (
    <div className="fixed inset-0 z-50 overflow-hidden" onClick={open ? undefined : onTap} style={{ pointerEvents: open ? 'none' : undefined }}>
      {open && <div className="gate-light pointer-events-none absolute inset-0 z-20" aria-hidden="true"
        style={{ background: 'radial-gradient(55% 45% at 50% 50%, rgba(255,255,255,.95), rgba(255,232,180,.55) 45%, transparent 78%)' }} />}

      <div className={`club-hero gate-door-l absolute inset-y-0 left-0 w-1/2 ${open ? 'is-open' : ''}`} style={door(false)} onAnimationEnd={onEnd} aria-hidden="true">
        <div className="pointer-events-none absolute inset-0 fade-down"><div className="zellige-ink absolute inset-0 opacity-[.13]" /></div>
        <span className="absolute inset-y-0 right-0 w-[3px]" style={{ background: edge }} />
      </div>
      <div className={`club-hero gate-door-r absolute inset-y-0 right-0 w-1/2 ${open ? 'is-open' : ''}`} style={door(true)} aria-hidden="true">
        <div className="pointer-events-none absolute inset-0 fade-down"><div className="zellige-ink absolute inset-0 opacity-[.13]" /></div>
        <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: edge }} />
      </div>

      <div className="pointer-events-none absolute inset-0 z-[5]" aria-hidden="true">
        <span className="gate-beam absolute -top-4 left-[8%] h-[70%] w-[46%]" style={{ clipPath: 'polygon(42% 0, 58% 0, 100% 100%, 0 100%)', transformOrigin: '50% 0', '--sw': '5deg' } as React.CSSProperties} />
        <span className="gate-beam absolute -top-4 right-[8%] h-[70%] w-[46%]" style={{ clipPath: 'polygon(42% 0, 58% 0, 100% 100%, 0 100%)', transformOrigin: '50% 0', '--sw': '-5deg', animationDelay: '-2s' } as React.CSSProperties} />
        <span className="absolute inset-0" style={{ background: 'radial-gradient(48% 30% at 50% 36%, rgba(255,255,255,.2), transparent 72%)' }} />
      </div>

      <div className={`gate-content absolute inset-0 z-10 flex flex-col items-center justify-center px-7 text-center text-brand-ink ${open ? 'is-open' : ''}`}>
        {STARS.map(([top, left, d, size], i) => <Sparkles key={i} className="gate-star absolute" aria-hidden="true" style={{ top: `${top}%`, left: `${left}%`, width: `${size}rem`, height: `${size}rem`, '--dl': `${d}s` } as React.CSSProperties} />)}
        {logo
          ? <div className="rounded-[1.7rem] bg-white p-1.5 shadow-[0_18px_40px_-14px_rgba(0,0,0,.55)] ring-4 ring-white/25"><img src={logo} alt={name} className="h-[4.75rem] w-[4.75rem] rounded-[1.25rem] object-cover" /></div>
          : <p className="font-display text-3xl font-semibold">{name}</p>}
        <span className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand-ink/15 px-3.5 py-1 text-[0.7rem] font-semibold tracking-[0.3em] ring-1 ring-brand-ink/30">CLUB</span>
        <h1 className="mt-4 max-w-xs font-display text-[2.5rem] font-semibold leading-[1.04]">{title}</h1>
        <p className="mt-3 max-w-xs text-base leading-snug opacity-90">{lead}</p>
        <button type="button" className="club-cta gate-cta press mt-9 inline-flex items-center gap-2.5 rounded-full bg-brand-ink px-8 py-[1.05rem] text-lg font-semibold shadow-[0_0_0_7px_rgba(255,255,255,.16),0_18px_40px_-12px_rgba(0,0,0,.55)]" style={{ color: brand }}>
          <PartyPopper className="h-5 w-5" />{label}
        </button>
        <p className="mt-5 max-w-[17rem] text-sm font-medium leading-snug opacity-90"><Volume2 className="me-1.5 inline h-4 w-4 animate-pulse align-[-3px]" aria-hidden="true" />{tease}</p>
      </div>
    </div>
  );
}

// The opening: the colour fills the screen, the logo lands with a ring, then the panel lifts away.
// A tap skips it.
function Intro({ logo, name, onSkip, onEnd }: { logo?: string; name: string; onSkip: () => void; onEnd: () => void }) {
  return (
    <div className="club-hero club-intro fixed inset-0 z-50 grid place-items-center text-brand-ink" onClick={onSkip}
      onAnimationEnd={e => { if (e.target === e.currentTarget) onEnd(); }} style={{ animationDuration: `${INTRO_MS}ms` }} aria-hidden="true">
      <div className="pointer-events-none absolute inset-0 fade-down"><div className="zellige-ink absolute inset-0 opacity-[.13]" /></div>
      <div className="relative grid place-items-center">
        <span className="club-intro-ring absolute h-28 w-28 rounded-full bg-brand-ink/30" />
        <div className="club-intro-logo">
          {logo
            ? <div className="rounded-[1.9rem] bg-white p-2 shadow-[0_24px_60px_-16px_rgba(0,0,0,.6)]"><img src={logo} alt="" className="h-28 w-28 rounded-[1.4rem] object-cover" /></div>
            : <p className="px-8 text-center font-display text-4xl font-semibold">{name}</p>}
        </div>
      </div>
    </div>
  );
}

// Confetti in the restaurant's colours; falls once and is then removed.
function Confetti({ brand, offset = 0, top = false }: { brand: string; offset?: number; top?: boolean }) {
  const pieces = useMemo(() => {
    const palette = ['#ffffff', '#F2AD46', brand, 'color-mix(in srgb, var(--brand) 45%, white)', 'var(--brand-ink)', 'var(--anti)'];
    return Array.from({ length: 44 }, (_, i) => ({
      left: `${(i * 23 + (i % 5) * 7) % 100}%`,
      bg: palette[i % palette.length],
      dl: `${offset + ((i * 37) % 100) / 100 * 0.9}s`,
      t: `${2.6 + ((i * 17) % 10) / 10 * 1.6}s`,
      x: `${((i * 53) % 61) - 30}vw`,
      r: `${(i % 2 ? 1 : -1) * (360 + (i * 41) % 540)}deg`,
      w: `${0.4 + ((i * 13) % 5) / 10}rem`,
    }));
  }, [brand, offset]);
  return (
    <div className={`pointer-events-none fixed inset-0 ${top ? 'z-[60]' : 'z-40'} overflow-hidden`} aria-hidden="true">
      {pieces.map((p, i) => <span key={i} className="confetti" style={{ left: p.left, background: p.bg, width: p.w, '--dl': p.dl, '--t': p.t, '--x': p.x, '--r': p.r } as React.CSSProperties} />)}
    </div>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">{children}</main>;
}
