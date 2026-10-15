// The restaurant's sign-up page, from a QR code: <slug>?club (counter, tables) or <slug>?club=<key>
// (a tasting). The phone fills in the name and number (autocomplete), one tap signs up. The same
// phone is remembered, so a second scan is one tap too.
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import type { Branding } from '@resto/shared';
import { applyBranding, applyLang } from '../theme';
import { load, save } from '../lib/storage';
import { ApiError, customerSignup, signupInfo, type SignupInfo, type SignupResult } from '../lib/api';

const S = {
  fr: {
    join: (r: string) => `Rejoignez le club ${r}`, event: 'Inscrivez-vous pour la dégustation',
    lead: 'Offres, nouveautés et cadeaux, directement sur WhatsApp.', points: (p: number, v: string) => `Et ${p} points = ${v} offerts.`,
    name: 'Prénom', phone: 'Numéro WhatsApp', go: 'Je m’inscris', busy: 'Inscription…',
    consent: (r: string) => `En vous inscrivant, vous acceptez de recevoir les offres de ${r} sur WhatsApp. Vous pouvez arrêter à tout moment.`,
    hello: (n: string) => `Re-bonjour ${n}`, done: (n: string) => `Bienvenue ${n} !`, already: 'Vous étiez déjà inscrit : c’est noté.',
    show: 'Montrez cet écran au personnel', twice: 'Déjà inscrit à cette dégustation', twiceTxt: 'Ce numéro a déjà été inscrit ici.',
    off: 'Les inscriptions ne sont pas ouvertes pour le moment.', closed: 'Cette dégustation est terminée.', notFound: 'Ce restaurant est introuvable.',
    errors: { customer_required: 'Indiquez votre prénom et un numéro valide.', rate_limited: 'Trop d’inscriptions en même temps. Réessayez dans une minute.',
      event_closed: 'Cette dégustation est terminée.', signup_off: 'Les inscriptions ne sont pas ouvertes pour le moment.', network: 'Pas de connexion. Réessayez.' } as Record<string, string>,
    other: 'Une erreur est survenue. Réessayez.', notMe: 'Ce n’est pas moi',
  },
  en: {
    join: (r: string) => `Join the ${r} club`, event: 'Sign up for the tasting',
    lead: 'Offers, news and gifts, straight to WhatsApp.', points: (p: number, v: string) => `And ${p} points = ${v} off.`,
    name: 'First name', phone: 'WhatsApp number', go: 'Sign me up', busy: 'Signing up…',
    consent: (r: string) => `By signing up, you agree to receive offers from ${r} on WhatsApp. You can stop at any time.`,
    hello: (n: string) => `Welcome back ${n}`, done: (n: string) => `Welcome ${n}!`, already: 'You were already a member: all set.',
    show: 'Show this screen to the staff', twice: 'Already signed up for this tasting', twiceTxt: 'This number was already signed up here.',
    off: 'Sign-ups are not open right now.', closed: 'This tasting is over.', notFound: 'This restaurant could not be found.',
    errors: { customer_required: 'Please enter your name and a valid number.', rate_limited: 'Too many sign-ups at once. Try again in a minute.',
      event_closed: 'This tasting is over.', signup_off: 'Sign-ups are not open right now.', network: 'No connection. Try again.' } as Record<string, string>,
    other: 'Something went wrong. Try again.', notMe: 'Not me',
  },
  ar: {
    join: (r: string) => `انضموا إلى نادي ${r}`, event: 'سجلوا للتذوق',
    lead: 'عروض ومستجدات وهدايا، مباشرة على واتساب.', points: (p: number, v: string) => `و${p} نقطة = ${v} هدية.`,
    name: 'الاسم', phone: 'رقم واتساب', go: 'سجلني', busy: 'جار التسجيل…',
    consent: (r: string) => `بالتسجيل، توافقون على تلقي عروض ${r} على واتساب. يمكنكم التوقف في أي وقت.`,
    hello: (n: string) => `مرحبا من جديد ${n}`, done: (n: string) => `مرحبا ${n}!`, already: 'كنتم مسجلين من قبل: تم الحفظ.',
    show: 'أظهروا هذه الشاشة للعاملين', twice: 'مسجل من قبل في هذا التذوق', twiceTxt: 'هذا الرقم سُجل هنا من قبل.',
    off: 'التسجيل غير مفتوح حاليا.', closed: 'انتهى هذا التذوق.', notFound: 'لم يتم العثور على هذا المطعم.',
    errors: { customer_required: 'أدخلوا اسمكم ورقما صحيحا.', rate_limited: 'تسجيلات كثيرة في نفس الوقت. أعيدوا المحاولة بعد دقيقة.',
      event_closed: 'انتهى هذا التذوق.', signup_off: 'التسجيل غير مفتوح حاليا.', network: 'لا يوجد اتصال. أعيدوا المحاولة.' } as Record<string, string>,
    other: 'حدث خطأ. أعيدوا المحاولة.', notMe: 'لست أنا',
  },
};
type Lang = keyof typeof S;

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
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    signupInfo(slug, eventKey).then(x => {
      setInfo(x);
      if (!x) return;
      const langs = (x.languages?.length ? x.languages : ['fr']).filter((l): l is Lang => l in S);
      const phoneLang = (navigator.language || '').slice(0, 2) as Lang;
      const l = langs.includes(phoneLang) ? phoneLang : langs[0] ?? 'fr';
      setLang(l); applyLang(l);
      applyBranding((x.branding ?? {}) as Branding, x.name);
    }).catch(() => setInfo(null));
  }, [slug, eventKey]);

  const t = S[lang];
  if (info === undefined) return <Screen><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted" /></Screen>;
  if (info === null) return <Screen><p className="text-center text-muted">{t.notFound}</p></Screen>;
  const r = info.name;
  const logo = (info.branding as Branding | null)?.logo_url;
  const closedEvent = eventKey && (!info.event || !info.event.active);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr('');
    if (!name.trim() || phone.replace(/\D/g, '').length < 9) { setErr(t.errors.customer_required); return; }
    setBusy(true);
    try {
      const res = await customerSignup(slug, name, phone, true, eventKey);
      save(`club:${slug}`, { name: name.trim(), phone });
      setDone(res);
      window.scrollTo(0, 0);
    } catch (x) {
      const m = x instanceof ApiError ? x.message : '';
      setErr(t.errors[m] ?? t.other);
    }
    setBusy(false);
  };

  if (done) {
    const twice = done.again;
    return (
      <Screen>
        <div className={`rounded-[2rem] p-8 text-center ${twice ? 'bg-[#F2AD46]/15' : 'bg-brand text-brand-ink'}`}>
          {twice ? <AlertTriangle className="mx-auto h-14 w-14 text-[#B7791F]" /> : <CheckCircle2 className="mx-auto h-16 w-16" />}
          <p className="mt-4 font-display text-3xl font-semibold">{twice ? t.twice : t.done(done.name)}</p>
          {twice ? <p className="mt-2 text-sm">{t.twiceTxt}</p> : done.existed && !done.event && <p className="mt-2 text-sm opacity-80">{t.already}</p>}
          {done.event && !twice && <>
            <p className="mt-6 text-sm font-semibold opacity-80">{done.event}</p>
            {done.offer && <p className="mt-1 font-display text-2xl font-semibold">{done.offer}</p>}
            <p className="mt-6 rounded-2xl bg-black/10 px-4 py-3 font-semibold">{t.show}</p>
          </>}
          {done.event && !twice && <p className="mt-4 text-xs tabular opacity-70">{new Date().toLocaleString(lang === 'ar' ? 'ar-MA-u-nu-latn' : lang === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>}
        </div>
        <p className="mt-6 text-center font-display text-lg">{r}</p>
      </Screen>
    );
  }

  return (
    <Screen>
      {logo ? <img src={logo} alt={r} className="mx-auto mb-5 h-20 w-20 rounded-2xl object-cover" /> : <p className="mb-4 text-center font-display text-2xl font-semibold">{r}</p>}
      <h1 className="text-center font-display text-3xl font-semibold leading-tight">{info.event && !closedEvent ? info.event.name : t.join(r)}</h1>
      <p className="mx-auto mt-2 max-w-sm text-center text-muted">
        {info.event && !closedEvent ? (info.event.offer ?? t.event) : t.lead}
        {!info.event && info.loyalty && info.loyalty.reward_points ? ` ${t.points(Number(info.loyalty.reward_points), `${Math.round(Number(info.loyalty.reward_cents) / 100)} DH`)}` : ''}
      </p>

      {!info.enabled || closedEvent ? (
        <p className="mt-8 rounded-2xl bg-surface-2 p-5 text-center">{closedEvent ? t.closed : t.off}</p>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-3" autoComplete="on">
          {known && name ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
              <span className="font-semibold">{t.hello(name)}</span>
              <button type="button" className="text-sm text-muted underline" onClick={() => { setKnown(false); setName(''); setPhone(''); setTimeout(() => nameRef.current?.focus(), 0); }}>{t.notMe}</button>
            </div>
          ) : (<>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold">{t.name}</span>
              <input ref={nameRef} name="name" autoComplete="name" required value={name} onChange={e => setName(e.target.value)} maxLength={60}
                className="w-full rounded-2xl border border-line bg-surface px-4 py-3.5 text-lg outline-none focus:border-brand" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold">{t.phone}</span>
              <input name="tel" type="tel" autoComplete="tel" inputMode="tel" dir="ltr" required value={phone} onChange={e => setPhone(e.target.value)} placeholder="06 12 34 56 78" maxLength={20}
                className="w-full rounded-2xl border border-line bg-surface px-4 py-3.5 text-lg tabular outline-none focus:border-brand" />
            </label>
          </>)}
          {err && <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-2xl bg-brand px-4 py-4 text-lg font-semibold text-brand-ink shadow-lg disabled:opacity-60">
            {busy ? t.busy : t.go}
          </button>
          <p className="px-2 text-center text-xs text-muted">{t.consent(r)}</p>
        </form>
      )}
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">{children}</main>;
}
