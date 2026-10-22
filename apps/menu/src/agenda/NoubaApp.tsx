// La Nouba: how busy is the salon right now, and a place in the queue without sitting there for an hour.
// <slug>?nouba from home (Instagram bio, Google, the website), <slug>?nouba=ici with the QR at the door,
// <slug>?nouba=<token> the client's place. The wait is an estimate, always shown as a range.
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, CheckCircle2, Footprints, Loader2, LogOut, MapPin, Phone, Scissors, Users, XCircle } from 'lucide-react';
import { newId, type Branding } from '@resto/shared';
import { applyBranding, applyLang } from '../theme';
import { load, save } from '../lib/storage';
import { noubaAnswer, noubaInfo, noubaJoin, noubaStatus, type LText, type NoubaInfo, type NoubaStatus } from '../lib/api';
import { NoubaStory } from './StoryShare';

// the story of the place in the queue, in the client's language
const STORY = {
  fr: { line: (s: string) => `Je suis dans la file chez ${s}`, cta: 'Qui vient ? Prenez votre place en ligne' },
  ar: { line: (s: string) => `أنا فالنوبة عند ${s}`, cta: 'شكون جاي؟ خود بلاصتك أونلاين' },
  en: { line: (s: string) => `I’m in the queue at ${s}`, cta: 'Who’s coming? Take your place online' },
};

const S = {
  fr: {
    now: 'En ce moment', noWait: 'Pas d’attente', min: 'min', waiting: (n: number) => (n === 0 ? 'Personne n’attend' : `${n} en attente`),
    working: (n: number) => (n === 1 ? '1 coiffeur' : `${n} coiffeurs`), closed: 'Fermé pour le moment', closedTxt: 'La file ouvre quand l’équipe est là.',
    take: 'Prendre ma place', takeHere: 'Je suis au salon : prendre ma place', what: 'Pour quoi ? (facultatif)', who: 'Avec qui ?', any: 'Peu importe',
    name: 'Prénom', phone: 'Numéro WhatsApp', go: 'Prendre ma place', busy: 'Un instant…', book: 'Prendre rendez-vous', call: 'Appeler le salon',
    estimate: 'Estimation : la durée réelle peut varier.', remoteFull: 'Les places à distance sont complètes pour le moment. Passez au salon : la file continue à l’entrée.',
    off: 'Ce salon n’affiche pas sa file en ligne.', notFound: 'Ce salon est introuvable.', updated: 'Mis à jour automatiquement',
    yourPlace: 'Votre place', number: (n: number) => `N° ${n}`, ahead: (n: number) => (n === 0 ? 'Vous êtes le prochain' : n === 1 ? '1 personne avant vous' : `${n} personnes avant vous`),
    soon: 'C’est bientôt à vous !', soonTxt: 'Venez maintenant au salon.', coming: 'J’arrive', comingDone: 'Le salon sait que vous arrivez.',
    yourTurn: 'C’est à vous !', yourTurnWith: (n: string) => `Installez-vous avec ${n}.`, done: 'Merci et à bientôt !', left: 'Vous avez quitté la file', noShow: 'Votre tour est passé',
    leave: 'Quitter la file', leaveSure: 'Oui, quitter', keep: 'Rester', keepOpen: 'Gardez cette page ouverte : elle se met à jour toute seule.', again: 'Reprendre une place',
    errors: { customer_required: 'Indiquez votre prénom et un numéro valide.', already_waiting: 'Ce numéro est déjà dans la file.', remote_full: 'Les places à distance sont complètes. Passez au salon.',
      closed: 'Le salon est fermé pour le moment.', full_today: 'La file est complète pour aujourd’hui.', queue_off: 'La file n’est pas ouverte.', network: 'Pas de connexion. Réessayez.' } as Record<string, string>,
    other: 'Une erreur est survenue. Réessayez.',
  },
  en: {
    now: 'Right now', noWait: 'No wait', min: 'min', waiting: (n: number) => (n === 0 ? 'Nobody waiting' : `${n} waiting`),
    working: (n: number) => (n === 1 ? '1 stylist' : `${n} stylists`), closed: 'Closed right now', closedTxt: 'The queue opens when the team is in.',
    take: 'Take my place', takeHere: 'I am at the salon: take my place', what: 'What for? (optional)', who: 'With whom?', any: 'No preference',
    name: 'First name', phone: 'WhatsApp number', go: 'Take my place', busy: 'One moment…', book: 'Book an appointment', call: 'Call the salon',
    estimate: 'Estimate: the real time may vary.', remoteFull: 'Places from home are full right now. Come to the salon: the queue continues at the door.',
    off: 'This salon does not show its queue online.', notFound: 'This salon could not be found.', updated: 'Updated automatically',
    yourPlace: 'Your place', number: (n: number) => `No. ${n}`, ahead: (n: number) => (n === 0 ? 'You are next' : n === 1 ? '1 person ahead of you' : `${n} people ahead of you`),
    soon: 'Your turn is coming!', soonTxt: 'Come to the salon now.', coming: 'I am on my way', comingDone: 'The salon knows you are coming.',
    yourTurn: 'It is your turn!', yourTurnWith: (n: string) => `Please take a seat with ${n}.`, done: 'Thank you, see you soon!', left: 'You left the queue', noShow: 'Your turn has passed',
    leave: 'Leave the queue', leaveSure: 'Yes, leave', keep: 'Stay', keepOpen: 'Keep this page open: it updates by itself.', again: 'Take a place again',
    errors: { customer_required: 'Please enter your name and a valid number.', already_waiting: 'This number is already in the queue.', remote_full: 'Places from home are full. Come to the salon.',
      closed: 'The salon is closed right now.', full_today: 'The queue is full for today.', queue_off: 'The queue is not open.', network: 'No connection. Try again.' } as Record<string, string>,
    other: 'Something went wrong. Try again.',
  },
  ar: {
    now: 'الآن', noWait: 'بدون انتظار', min: 'د', waiting: (n: number) => (n === 0 ? 'لا أحد ينتظر' : `${n} في الانتظار`),
    working: (n: number) => (n === 1 ? 'حلاق واحد' : `${n} حلاقين`), closed: 'مغلق حاليا', closedTxt: 'تفتح النوبة عند حضور الفريق.',
    take: 'خذ نوبتي', takeHere: 'أنا في الصالون: خذ نوبتي', what: 'لأي خدمة؟ (اختياري)', who: 'مع من؟', any: 'لا يهم',
    name: 'الاسم', phone: 'رقم واتساب', go: 'خذ نوبتي', busy: 'لحظة…', book: 'حجز موعد', call: 'الاتصال بالصالون',
    estimate: 'تقدير: قد تختلف المدة الحقيقية.', remoteFull: 'النوبات عن بعد ممتلئة حاليا. تعالوا إلى الصالون: النوبة مستمرة عند المدخل.',
    off: 'هذا الصالون لا يعرض النوبة عبر الإنترنت.', notFound: 'لم يتم العثور على هذا الصالون.', updated: 'تتحدث تلقائيا',
    yourPlace: 'نوبتكم', number: (n: number) => `رقم ${n}`, ahead: (n: number) => (n === 0 ? 'أنتم التالون' : n === 1 ? 'شخص واحد قبلكم' : `${n} أشخاص قبلكم`),
    soon: 'نوبتكم قريبة!', soonTxt: 'تعالوا إلى الصالون الآن.', coming: 'أنا في الطريق', comingDone: 'الصالون يعلم أنكم قادمون.',
    yourTurn: 'جاءت نوبتكم!', yourTurnWith: (n: string) => `تفضلوا مع ${n}.`, done: 'شكرا وإلى اللقاء!', left: 'غادرتم النوبة', noShow: 'فاتت نوبتكم',
    leave: 'مغادرة النوبة', leaveSure: 'نعم، مغادرة', keep: 'البقاء', keepOpen: 'اتركوا هذه الصفحة مفتوحة: تتحدث تلقائيا.', again: 'أخذ نوبة من جديد',
    errors: { customer_required: 'أدخلوا اسمكم ورقما صحيحا.', already_waiting: 'هذا الرقم في النوبة من قبل.', remote_full: 'النوبات عن بعد ممتلئة. تعالوا إلى الصالون.',
      closed: 'الصالون مغلق حاليا.', full_today: 'النوبة ممتلئة لهذا اليوم.', queue_off: 'النوبة غير مفتوحة.', network: 'لا يوجد اتصال. أعيدوا المحاولة.' } as Record<string, string>,
    other: 'حدث خطأ. أعيدوا المحاولة.',
  },
};
type Lang = keyof typeof S;
type T = typeof S.fr;
const errText = (t: T, e: unknown) => t.errors[(e as Error)?.message] ?? t.other;
const lt = (x: LText | null | undefined, l: Lang) => (x ? x[l] || x.fr || x.ar || x.en || '' : '');
const HEX = /^#[0-9a-f]{6}$/i;
/** an estimate is a range: 20 -> 20-30 min */
const range = (w: number, t: T) => (w <= 0 ? t.noWait : `${w}–${w + Math.max(10, Math.round(w * 0.3 / 5) * 5)} ${t.min}`);
const tone = (w: number | null | undefined) => (w == null ? '#9CA3AF' : w < 15 ? '#16A34A' : w < 45 ? '#F59E0B' : '#DC2626');
function pickLang(langs: string[] | null | undefined): Lang {
  const ok = (langs?.length ? langs : ['fr']).filter((x): x is Lang => x in S);
  const asked = new URLSearchParams(window.location.search).get('lang') as Lang | null;
  if (asked && ok.includes(asked)) return asked;
  const phone = (navigator.language || '').slice(0, 2) as Lang;
  return ok.includes(phone) ? phone : ok[0] ?? 'fr';
}
const Screen = ({ children }: { children: React.ReactNode }) => <main className="grid min-h-dvh place-items-center bg-bg px-6 text-ink">{children}</main>;

function Head({ name, branding, address, city }: { name: string; branding: Branding; address?: string | null; city?: string | null }) {
  return (
    <header className="flex items-center gap-3 px-5 pb-2 pt-6">
      {branding.logo_url
        ? <img src={branding.logo_url} alt="" className="size-12 shrink-0 rounded-2xl object-cover shadow-[var(--shadow)]" />
        : <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand font-display text-xl font-semibold text-brand-ink">{name.slice(0, 1)}</span>}
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-xl font-semibold leading-tight">{name}</p>
        {(address || city) && <p className="flex items-center gap-1 truncate text-sm text-muted"><MapPin className="size-3.5 shrink-0" />{[address, city].filter(Boolean).join(', ')}</p>}
      </div>
    </header>
  );
}

export default function NoubaApp({ slug, param }: { slug: string; param: string }) {
  const here = param === 'ici';
  const [token, setToken] = useState<string | null>(() => (param && !here && /^[a-z0-9]{8,32}$/i.test(param) ? param : null));
  const show = (x: string | null) => {
    const u = new URL(window.location.href);
    if (x) u.searchParams.set('nouba', x); else u.searchParams.set('nouba', here ? 'ici' : '');
    window.history.pushState(null, '', u.toString().replace(/nouba=(&|$)/, 'nouba$1'));
    setToken(x); window.scrollTo(0, 0);
  };
  return token ? <Place slug={slug} token={token} onAgain={() => show(null)} /> : <Live slug={slug} here={here} onJoined={show} />;
}

function Live({ slug, here, onJoined }: { slug: string; here: boolean; onJoined: (token: string) => void }) {
  const [info, setInfo] = useState<NoubaInfo | null | undefined>(undefined);
  const [lang, setLang] = useState<Lang>('fr');
  const [form, setForm] = useState(false);
  const mine = load<{ name: string; phone: string }>('customer', 365 * 86400_000);
  const [name, setName] = useState(mine?.name ?? '');
  const [phone, setPhone] = useState(mine?.phone ?? '');
  const [svc, setSvc] = useState<string | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId] = useState(() => newId());
  const first = useRef(true);
  const saved = load<string>(`nouba:${slug}`, 18 * 3600_000);
  useEffect(() => {
    const get = () => noubaInfo(slug).then(x => {
      setInfo(x);
      if (x && first.current) { first.current = false; const l = pickLang(x.languages); setLang(l); applyLang(l); applyBranding((x.branding ?? {}) as Branding, x.name); }
    }).catch(() => setInfo(i => (i === undefined ? null : i)));
    get();
    const id = window.setInterval(get, 30000);
    return () => window.clearInterval(id);
  }, [slug]);
  const t = S[lang];
  if (info === undefined) return <Screen><Loader2 className="size-6 animate-spin text-muted" /></Screen>;
  if (info === null) return <Screen><p className="text-muted">{t.notFound}</p></Screen>;
  const branding = (info.branding ?? {}) as Branding;
  const bookLink = `${window.location.pathname}?rdv`;
  if (!info.enabled) return (
    <Screen><div className="text-center"><p className="font-display text-2xl font-semibold">{info.name}</p><p className="mt-2 text-muted">{t.off}</p>
      {info.booking && <a href={bookLink} className="mt-6 inline-flex h-12 items-center gap-2 rounded-full bg-brand px-6 font-semibold text-brand-ink"><CalendarDays className="size-4" />{t.book}</a>}</div></Screen>
  );
  const w = info.wait_min ?? null;
  const canJoin = info.open && (here || info.remote);
  const able = (info.staff ?? []).filter(p => !svc || !p.services.length || p.services.includes(svc));
  const ok = name.trim().length > 0 && phone.replace(/\D/g, '').length >= 9;
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await noubaJoin(slug, { client_id: clientId, name: name.trim(), phone: phone.trim(), service_id: svc, staff_id: who, here, lang });
      save('customer', { ...(mine ?? {}), name: name.trim(), phone: phone.trim() }); save(`nouba:${slug}`, r.token);
      onJoined(r.token);
    } catch (e) { setError(errText(t, e)); }
    setBusy(false);
  };
  const chip = (on: boolean) => `rounded-full px-4 py-2 text-sm font-semibold transition ${on ? 'bg-brand text-brand-ink' : 'bg-surface shadow-[var(--shadow)]'}`;

  return (
    <main className="min-h-dvh bg-bg pb-10 text-ink">
      <div className="mx-auto max-w-lg">
        <Head name={info.name} branding={branding} address={info.address} city={info.city} />
        {saved && <button onClick={() => onJoined(saved)} className="mx-5 mt-2 flex w-[calc(100%-2.5rem)] items-center gap-3 rounded-2xl border border-brand/30 bg-brand/5 px-4 py-3 text-start font-semibold"><Footprints className="size-5 text-brand" />{t.yourPlace}</button>}

        <section className="mx-5 mt-5 overflow-hidden rounded-[2rem] bg-surface p-6 text-center shadow-[var(--shadow)]">
          {info.open ? <>
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-muted">
              <span className="relative flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ background: tone(w) }} /><span className="relative inline-flex size-2.5 rounded-full" style={{ background: tone(w) }} /></span>
              {t.now}
            </p>
            <p className="mt-3 font-display text-[3.2rem] font-semibold leading-none tabular-nums" dir="ltr">{w == null ? '–' : range(w, t)}</p>
            <div className="mt-5 flex justify-center gap-5 text-sm text-muted">
              <span className="inline-flex items-center gap-1.5"><Users className="size-4" />{t.waiting(info.waiting ?? 0)}</span>
              <span className="inline-flex items-center gap-1.5"><Scissors className="size-4" />{t.working(info.working ?? 0)}</span>
            </div>
          </> : <>
            <p className="font-display text-3xl font-semibold">{t.closed}</p>
            <p className="mt-2 text-muted">{t.closedTxt}</p>
          </>}
        </section>
        {info.open && <p className="mx-5 mt-2 text-center text-xs text-muted">{t.estimate} {t.updated}.</p>}

        {info.open && !canJoin && <p className="mx-5 mt-5 rounded-2xl bg-surface-2 p-4 text-sm">{t.remoteFull}</p>}
        {canJoin && !form && (
          <button onClick={() => setForm(true)} className="mx-5 mt-6 flex h-14 w-[calc(100%-2.5rem)] items-center justify-center gap-2 rounded-full bg-brand text-lg font-semibold text-brand-ink glow-brand press">
            <Footprints className="size-5" />{here ? t.takeHere : t.take}
          </button>
        )}
        {canJoin && form && (
          <div className="mx-5 mt-6 space-y-4">
            {!!info.services?.length && (
              <div>
                <p className="mb-2 text-sm font-semibold">{t.what}</p>
                <div className="flex flex-wrap gap-2">{info.services.map(s => <button key={s.id} onClick={() => { setSvc(svc === s.id ? null : s.id); setWho(null); }} className={chip(svc === s.id)}>{lt(s.name, lang)}</button>)}</div>
              </div>
            )}
            {able.length > 1 && (
              <div>
                <p className="mb-2 text-sm font-semibold">{t.who}</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setWho(null)} className={chip(who === null)}>{t.any}</button>
                  {able.map(p => <button key={p.id} onClick={() => setWho(p.id)} className={`${chip(who === p.id)} inline-flex items-center gap-2`}>
                    <span className="size-2.5 rounded-full" style={{ background: p.color && HEX.test(p.color) ? p.color : 'currentColor' }} />{p.name}</button>)}
                </div>
              </div>
            )}
            <input className="h-12 w-full rounded-2xl border border-line bg-surface px-4 outline-none focus:border-brand" placeholder={t.name} value={name} onChange={e => setName(e.target.value)} maxLength={60} autoComplete="given-name" />
            <input className="h-12 w-full rounded-2xl border border-line bg-surface px-4 outline-none focus:border-brand" placeholder={t.phone} value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" dir="ltr" />
            {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
            <button disabled={!ok || busy} onClick={submit} className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand text-lg font-semibold text-brand-ink glow-brand press disabled:opacity-40">
              {busy ? <><Loader2 className="size-4 animate-spin" />{t.busy}</> : t.go}
            </button>
          </div>
        )}

        <div className="mx-5 mt-6 flex flex-col gap-2">
          {info.booking && <a href={bookLink} className="flex h-12 items-center justify-center gap-2 rounded-full bg-surface font-semibold shadow-[var(--shadow)] press"><CalendarDays className="size-4" />{t.book}</a>}
          {info.phone && <a href={`tel:${info.phone}`} className="flex h-12 items-center justify-center gap-2 rounded-full bg-surface font-semibold shadow-[var(--shadow)] press"><Phone className="size-4" />{t.call}</a>}
        </div>
      </div>
    </main>
  );
}

function Place({ slug, token, onAgain }: { slug: string; token: string; onAgain: () => void }) {
  const [st, setSt] = useState<NoubaStatus | null | undefined>(undefined);
  const [lang, setLang] = useState<Lang>('fr');
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const first = useRef(true);
  const refresh = () => noubaStatus(token).then(x => {
    setSt(x);
    if (x && first.current) { first.current = false; const l = pickLang(x.salon.languages); setLang(l); applyLang(l); applyBranding((x.salon.branding ?? {}) as Branding, x.salon.name); }
  }).catch(() => setSt(s => (s === undefined ? null : s)));
  useEffect(() => { refresh(); const id = window.setInterval(refresh, 20000); return () => window.clearInterval(id); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  // the turn comes near: the phone buzzes if the page is open
  const buzzed = useRef(false);
  useEffect(() => { if (st?.soon && !buzzed.current) { buzzed.current = true; try { navigator.vibrate?.([300, 150, 300]); } catch { /* not supported */ } } }, [st?.soon]);
  const t = S[lang];
  if (st === undefined) return <Screen><Loader2 className="size-6 animate-spin text-muted" /></Screen>;
  if (!st) return <Screen><div className="text-center"><p className="text-muted">{t.notFound}</p><button onClick={onAgain} className="mt-5 h-12 rounded-full bg-brand px-6 font-semibold text-brand-ink">{t.again}</button></div></Screen>;
  const answer = async (a: 'coming' | 'leave') => { setBusy(true); try { await noubaAnswer(token, a); await refresh(); } catch { /* refreshed anyway */ } setBusy(false); setSure(false); };
  const waiting = st.status === 'waiting';
  const ended = !waiting && st.status !== 'serving';
  if (ended) { try { localStorage.removeItem(`nouba:${slug}`); } catch { /* private mode */ } }

  return (
    <main className="min-h-dvh bg-bg pb-10 text-ink">
      <div className="mx-auto max-w-lg">
        <Head name={st.salon.name} branding={(st.salon.branding ?? {}) as Branding} address={st.salon.address} city={st.salon.city} />
        {waiting && (
          <section className={`mx-5 mt-5 rounded-[2rem] p-6 text-center shadow-[var(--shadow)] ${st.soon ? 'bg-brand text-brand-ink' : 'bg-surface'}`}>
            {st.soon ? <>
              <p className="font-display text-3xl font-semibold">{t.soon}</p>
              <p className="mt-1 opacity-90">{t.soonTxt}</p>
            </> : <p className="text-sm font-semibold text-muted">{t.yourPlace}</p>}
            <p className="mt-3 font-display text-[3.4rem] font-semibold leading-none" dir="ltr">{t.number((st.ahead ?? 0) + 1)}</p>
            <p className={`mt-3 font-semibold ${st.soon ? '' : 'text-muted'}`}>{t.ahead(st.ahead ?? 0)}</p>
            {st.wait_min != null && !st.soon && <p className="mt-1 text-2xl font-semibold tabular-nums" dir="ltr">≈ {range(st.wait_min, t)}</p>}
            {(st.service || st.staff) && <p className={`mt-3 text-sm ${st.soon ? 'opacity-90' : 'text-muted'}`}>{[lt(st.service, lang), st.staff].filter(Boolean).join(' · ')}</p>}
          </section>
        )}
        {waiting && st.soon && st.remote && (st.coming
          ? <p className="mx-5 mt-4 flex items-center justify-center gap-2 rounded-2xl bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-600"><CheckCircle2 className="size-4" />{t.comingDone}</p>
          : <button disabled={busy} onClick={() => answer('coming')} className="mx-5 mt-4 flex h-14 w-[calc(100%-2.5rem)] items-center justify-center gap-2 rounded-full bg-ink text-lg font-semibold text-bg press"><Footprints className="size-5" />{t.coming}</button>)}
        {st.status === 'serving' && (
          <section className="mx-5 mt-8 text-center">
            <CheckCircle2 className="mx-auto size-16 text-emerald-500" />
            <p className="mt-3 font-display text-3xl font-semibold">{t.yourTurn}</p>
            {st.staff && <p className="mt-1 text-muted">{t.yourTurnWith(st.staff)}</p>}
          </section>
        )}
        {ended && (
          <section className="mx-5 mt-8 text-center">
            {st.status === 'done' ? <CheckCircle2 className="mx-auto size-14 text-emerald-500" /> : <XCircle className="mx-auto size-14 text-muted" />}
            <p className="mt-3 font-display text-2xl font-semibold">{st.status === 'done' ? t.done : st.status === 'left' ? t.left : t.noShow}</p>
            <button onClick={onAgain} className="mt-6 h-12 rounded-full bg-brand px-6 font-semibold text-brand-ink">{t.again}</button>
          </section>
        )}
        {waiting && <p className="mx-5 mt-4 text-center text-xs text-muted">{t.keepOpen} {t.estimate}</p>}
        {waiting && !st.soon && (
          <NoubaStory lang={lang} link={`${window.location.origin}/${slug}?nouba`} logoUrl={((st.salon.branding ?? {}) as Branding).logo_url}
            input={{ salon: st.salon.name, handle: st.salon.handle ?? undefined, primary: ((st.salon.branding ?? {}) as Branding).primary_color ?? '#8E3B4F',
              place: t.number((st.ahead ?? 0) + 1), line: STORY[lang].line(st.salon.name), wait: st.wait_min != null ? `≈ ${range(st.wait_min, t)}` : undefined, cta: STORY[lang].cta }} />
        )}
        <div className="mx-5 mt-6 flex flex-col gap-2">
          {st.salon.phone && <a href={`tel:${st.salon.phone}`} className="flex h-12 items-center justify-center gap-2 rounded-full bg-surface font-semibold shadow-[var(--shadow)] press"><Phone className="size-4" />{t.call}</a>}
          {waiting && (sure ? (
            <div className="flex gap-2">
              <button onClick={() => setSure(false)} className="h-12 flex-1 rounded-full bg-surface-2 font-semibold">{t.keep}</button>
              <button disabled={busy} onClick={() => answer('leave')} className="h-12 flex-1 rounded-full bg-red-600 font-semibold text-white">{t.leaveSure}</button>
            </div>
          ) : <button onClick={() => setSure(true)} className="inline-flex h-11 items-center justify-center gap-2 font-semibold text-red-500"><LogOut className="size-4 rtl:rotate-180" />{t.leave}</button>)}
        </div>
      </div>
    </main>
  );
}
