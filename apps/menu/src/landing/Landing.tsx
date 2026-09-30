import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import QRCode from 'qrcode';
import {
  ArrowLeft, ArrowRight, Check, ChefHat, ChevronDown, Clock, CloudOff, Languages, Lock, QrCode, Receipt,
  ShieldCheck, Smartphone, Sparkles, Wifi, WifiOff, Zap, BarChart3,
} from 'lucide-react';
import { COPY, type SiteLang } from './copy';
import { FEATURES_COPY } from './featuresCopy';

const FEATURE_COUNT = FEATURES_COPY.fr.modules.reduce((n, m) => n + m.items.length, 0);
import { Star8 } from '../components/Ornament';
import { AmplifyLogo } from './AmplifyMark';

// Amplify POS website. Served at the root of the menu app (restaurants live under /<slug>),
// loaded lazily so guests scanning a table QR code never download it.

export const ADMIN = (import.meta.env.VITE_ADMIN_URL as string | undefined) ?? 'https://amplify-admin.pages.dev';
const DEMO_SLUG = (import.meta.env.VITE_DEMO_SLUG as string | undefined) ?? 'dar-nour'; // fictional demo café (supabase/demo/dar-nour.sql)

// The Amplify colors from the logo: deep navy and green (independent of any restaurant's branding).
export const THEME = {
  '--bg': '#020F20', '--surface': '#071B36', '--surface-2': '#0D274A', '--ink': '#ECF2FA', '--muted': '#8CA0BE',
  '--line': 'rgba(210, 225, 245, 0.10)', '--brand': '#05B962', '--brand-ink': '#001E3E', '--danger': '#F47171',
  '--font-display-family': '"Montserrat Variable", "IBM Plex Sans Arabic", system-ui, sans-serif',
} as CSSProperties;

export function initialLang(): SiteLang {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'ar' || q === 'fr') return q;
    const saved = localStorage.getItem('site-lang');
    if (saved === 'ar' || saved === 'fr') return saved;
  } catch { /* storage blocked */ }
  return (navigator.language || '').startsWith('ar') ? 'ar' : 'fr';
}

/** Adds .in to elements with .reveal when they scroll into view. */
export function useReveal(dep: unknown) {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal:not(.in)');
    if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    els.forEach(e => io.observe(e));
    return () => io.disconnect();
  }, [dep]);
}

export default function Landing() {
  const [lang, setLang] = useState<SiteLang>(initialLang);
  const c = COPY[lang];
  const rtl = lang === 'ar';
  const signup = `${ADMIN}/?inscription=1&lang=${lang}`;
  // each product can be bought on its own: the plan buttons open a sign-up for that product
  const signupFor = (product?: 'pos' | 'profit') => `${signup}${product ? `&produit=${product}` : ''}`;
  const login = `${ADMIN}/?lang=${lang}`;
  const Arrow = rtl ? ArrowLeft : ArrowRight;

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang; root.dir = rtl ? 'rtl' : 'ltr';
    root.dataset.theme = 'dark';
    document.body.style.background = '#020F20';
    document.title = rtl ? 'Amplify POS · صندوق ذكي للمقاهي والمطاعم في المغرب' : 'Amplify POS · La caisse des cafés et restaurants au Maroc';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#020F20');
    try { localStorage.setItem('site-lang', lang); } catch { /* ignore */ }
  }, [lang, rtl]);
  useReveal(lang);

  return (
    <div style={THEME} className="site min-h-dvh bg-bg text-ink overflow-x-clip">
      {/* ------------------------------------------------------------ nav */}
      <header className="fixed inset-x-0 top-0 z-50">
        <div className="mx-auto max-w-6xl px-4 pt-3">
          <nav className="flex items-center gap-3 rounded-2xl border border-line bg-surface/70 backdrop-blur-xl px-3 py-2 sm:px-4">
            <a href="#top" className="flex items-center gap-2.5 me-auto">
              <AmplifyLogo mark="h-7 w-9 sm:h-8 sm:w-10" text="text-[0.95rem] sm:text-lg" />
            </a>
            <div className="hidden md:flex items-center gap-6 text-sm text-muted">
              <a href="/fonctionnalites" className="hover:text-ink transition-colors">{c.nav.features}</a>
              <a href="#demo" className="hover:text-ink transition-colors">{c.nav.demo}</a>
              <a href="#pricing" className="hover:text-ink transition-colors">{c.nav.pricing}</a>
              <a href="#faq" className="hover:text-ink transition-colors">{c.nav.faq}</a>
              <a href="/profit" className="font-semibold text-brand hover:text-ink transition-colors">{c.nav.profit}</a>
            </div>
            <button onClick={() => setLang(rtl ? 'fr' : 'ar')} lang={rtl ? 'fr' : 'ar'}
              className="h-9 px-3 rounded-full border border-line text-sm font-semibold text-muted hover:text-ink transition-colors whitespace-nowrap">
              {rtl ? 'FR' : <><span className="sm:hidden">ع</span><span className="hidden sm:inline">العربية</span></>}
            </button>
            <a href={login} className="hidden sm:inline text-sm font-semibold text-muted hover:text-ink transition-colors">{c.nav.login}</a>
            <a href={signup} className="h-9 px-4 grid place-items-center rounded-full bg-brand text-brand-ink text-sm font-bold glow-brand press whitespace-nowrap">{c.nav.cta}</a>
          </nav>
        </div>
      </header>

      {/* ------------------------------------------------------------ hero */}
      <section id="top" className="relative isolate pt-32 sm:pt-40 pb-20">
        <div className="absolute inset-0 -z-10" aria-hidden>
          <div className="absolute inset-0 site-glow" />
          <div className="absolute inset-x-0 top-0 h-[42rem] fade-down"><div className="absolute inset-0 zellige opacity-[0.11]" /></div>
          <Star8 filled={false} stroke={0.08} className="absolute -top-40 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 size-[56rem] text-brand opacity-[0.06] animate-spin-slow" />
        </div>
        <div className="mx-auto max-w-6xl px-5 grid lg:grid-cols-[1.05fr_1fr] gap-14 items-center">
          <div className="text-center lg:text-start">
            <p className="reveal inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-brand">
              <Sparkles className="size-3.5" />{c.hero.eyebrow}
            </p>
            <h1 className="reveal mt-6 font-display text-[2.9rem] sm:text-6xl lg:text-7xl font-semibold leading-[1.02]" style={{ ['--d' as string]: '80ms' }}>
              {c.hero.title1}<br /><span className="text-gold">{c.hero.title2}</span>
            </h1>
            <p className="reveal mt-6 text-lg text-muted leading-relaxed max-w-xl mx-auto lg:mx-0" style={{ ['--d' as string]: '160ms' }}>{c.hero.sub}</p>
            <div className="reveal mt-9 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start" style={{ ['--d' as string]: '240ms' }}>
              <a href={signup} className="h-14 px-7 inline-flex items-center justify-center gap-2 rounded-full bg-brand text-brand-ink text-[15px] font-bold glow-brand press">
                {c.hero.cta}<Arrow className="size-4.5" />
              </a>
              <a href="#demo" className="h-14 px-7 inline-flex items-center justify-center gap-2 rounded-full border border-line bg-surface/60 text-[15px] font-semibold hover:border-brand/50 transition-colors">
                <Smartphone className="size-4.5 text-brand" />{c.hero.demo}
              </a>
            </div>
            <p className="reveal mt-4 text-sm text-muted" style={{ ['--d' as string]: '300ms' }}>{c.hero.note}</p>
          </div>
          <HeroVisual lang={lang} />
        </div>
        <div className="mx-auto max-w-6xl px-5 mt-16 flex flex-wrap justify-center gap-3">
          {c.hero.chips.map((chip, i) => (
            <span key={chip} className="reveal inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-4 py-2 text-sm text-ink/85" style={{ ['--d' as string]: `${i * 70}ms` }}>
              <Check className="size-4 text-brand" />{chip}
            </span>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ two products */}
      <Section id="produits" kicker={c.products.kicker} title={c.products.title} text={c.products.text} icon={<Sparkles className="size-4" />}>
        <div className="grid gap-4 md:grid-cols-2">
          {([['pos', c.products.pos, '#features'], ['profit', c.products.profit, '/profit']] as const).map(([k, p, href], i) => (
            <a key={k} href={href} className={`reveal group relative flex flex-col overflow-hidden rounded-[2rem] border p-7 transition-colors ${k === 'profit' ? 'border-brand/50 bg-gradient-to-br from-brand/15 to-surface hover:border-brand' : 'border-line bg-surface/70 hover:border-brand/50'}`} style={{ ['--d' as string]: `${i * 90}ms` }}>
              <Star8 filled={false} stroke={0.4} className="absolute -top-10 -end-10 size-36 text-brand/10 group-hover:text-brand/25 transition-colors" />
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">{p.tag}</p>
              <h3 dir="ltr" className="mt-2 font-logo text-2xl font-extrabold rtl:text-end">AMPLIFY <span className="text-brand">{k === 'pos' ? 'POS' : 'PROFIT'}</span></h3>
              <p className="mt-3 text-muted leading-relaxed">{p.text}</p>
              <ul className="mt-5 space-y-2 text-[15px] flex-1">{p.items.map(it => <li key={it} className="flex gap-2.5"><Check className="size-5 shrink-0 text-brand" />{it}</li>)}</ul>
              <span className="mt-6 inline-flex items-center gap-2 font-bold text-brand">{p.cta}<Arrow className="size-4 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1" /></span>
            </a>
          ))}
        </div>
        <p className="reveal mx-auto mt-6 flex max-w-2xl items-center justify-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-5 py-3 text-center text-sm font-semibold"><Zap className="size-4 shrink-0 text-brand" />{c.products.together}</p>
      </Section>

      {/* ------------------------------------------------------------ offline */}
      <Section id="offline" kicker={c.offline.kicker} title={c.offline.title} text={c.offline.text} icon={<CloudOff className="size-4" />}>
        <OfflineDemo lang={lang} />
      </Section>

      {/* ------------------------------------------------------------ features */}
      <Section id="features" kicker={c.features.kicker} title={c.features.title} icon={<Zap className="size-4" />}>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {c.features.items.map(([title, text], i) => {
            const Icon = [Receipt, QrCode, ChefHat, Lock, ShieldCheck, BarChart3][i];
            return (
              <article key={title} className="reveal group relative overflow-hidden rounded-3xl border border-line bg-surface/70 p-6 hover:border-brand/40 transition-colors" style={{ ['--d' as string]: `${(i % 3) * 90}ms` }}>
                <Star8 filled={false} stroke={0.4} className="absolute -top-10 -end-10 size-36 text-brand/10 group-hover:text-brand/25 transition-colors" />
                <span className="relative grid place-items-center size-12 rounded-2xl bg-brand/12 text-brand"><Icon className="size-6" /></span>
                <h3 className="relative mt-5 text-lg font-bold">{title}</h3>
                <p className="relative mt-2 text-muted leading-relaxed">{text}</p>
              </article>
            );
          })}
        </div>
        <div className="reveal mt-8 text-center">
          <a href="/fonctionnalites" className="inline-flex h-12 items-center gap-2 rounded-full border border-brand/50 bg-brand/10 px-6 font-bold text-brand hover:bg-brand/20 transition-colors">
            {c.nav.allCta.replace('{n}', String(FEATURE_COUNT))} <ArrowRight className="size-4 rtl:rotate-180" />
          </a>
        </div>
      </Section>

      {/* ------------------------------------------------------------ languages */}
      <Section id="langues" kicker={c.lang.kicker} title={c.lang.title} text={c.lang.text} icon={<Languages className="size-4" />}>
        <div className="reveal grid sm:grid-cols-2 gap-4">
          <MiniTicket lang="fr" />
          <MiniTicket lang="ar" />
        </div>
      </Section>

      {/* ------------------------------------------------------------ live demo */}
      <Section id="demo" kicker={c.live.kicker} title={c.live.title} text={c.live.text} icon={<Smartphone className="size-4" />}>
        <LiveDemo openLabel={c.live.open} lang={lang} />
      </Section>

      {/* ------------------------------------------------------------ coming soon */}
      <Section id="soon" kicker={c.soon.kicker} title={c.soon.title} text={c.soon.text} icon={<Sparkles className="size-4" />}>
        <div className="reveal mx-auto max-w-2xl rounded-[2rem] border border-brand/25 bg-surface/80 p-3 shadow-2xl">
          <div className="rounded-[1.5rem] bg-bg/70 p-5 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="relative grid place-items-center size-10"><Star8 className="absolute inset-0 size-full text-brand" /><Sparkles className="relative size-4 text-brand-ink" /></span>
              <div className="me-auto">
                <p className="font-bold">Amplify</p>
                <p className="text-xs text-muted">22:30</p>
              </div>
              <span className="rounded-full bg-brand/15 px-3 py-1 text-xs font-bold text-brand">{c.soon.kicker}</span>
            </div>
            <div className="mt-5 space-y-3">
              {c.soon.card.map(([k, v, hint]) => (
                <div key={k} className="flex items-center gap-4 rounded-2xl border border-line bg-surface/70 px-4 py-3.5">
                  <p className="w-28 shrink-0 text-xs font-bold uppercase tracking-wider text-muted">{k}</p>
                  <div className="min-w-0">
                    <p className="font-display text-xl font-semibold text-brand">{v}</p>
                    <p className="text-sm text-muted">{hint}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-center text-xs text-muted">{c.soon.note}</p>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------ pricing */}
      <Section id="pricing" kicker={c.pricing.kicker} title={c.pricing.title} text={c.pricing.note} icon={<Receipt className="size-4" />}>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
          {c.pricing.plans.map((p, i) => {
            const featured = !!p.featured;
            return (
              <article key={p.name} className={`reveal relative flex flex-col rounded-[2rem] p-7 ${featured ? 'bg-gradient-to-b from-brand/20 to-surface border border-brand/60 shadow-[0_30px_80px_-30px_rgba(5,185,98,.55)] md:-translate-y-3' : 'border border-line bg-surface/70'}`}
                style={{ ['--d' as string]: `${i * 90}ms` }}>
                {featured && <span className="absolute -top-3.5 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 rounded-full bg-brand px-3.5 py-1 text-xs font-bold text-brand-ink whitespace-nowrap">{c.pricing.popular}</span>}
                <p dir="ltr" className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand rtl:text-end">{p.tag}</p>
                <h3 className="mt-1 font-display text-2xl font-semibold">{p.name}</h3>
                <p className="mt-1 text-sm text-muted">{p.text}</p>
                <p className="mt-6 flex items-baseline gap-2"><span dir="ltr" className="font-display text-5xl font-semibold">{p.price}</span><span className="text-sm text-muted">{c.pricing.per}</span></p>
                <ul className="mt-6 space-y-2.5 text-[15px] flex-1">
                  {p.items.map(it => <li key={it} className="flex gap-2.5"><Check className="size-5 shrink-0 text-brand" /><span>{it}</span></li>)}
                </ul>
                <a href={signupFor(p.product)} className={`mt-8 h-12 grid place-items-center rounded-full font-bold press ${featured ? 'bg-brand text-brand-ink glow-brand' : 'border border-line hover:border-brand/50 transition-colors'}`}>{c.pricing.choose}</a>
              </article>
            );
          })}
        </div>
        <div className="reveal mt-10 rounded-[2rem] border border-brand/30 bg-brand/[0.06] p-7 md:p-9">
          <div className="grid gap-6 md:grid-cols-[1fr_1.4fr] md:items-center">
            <div>
              <h3 className="font-display text-2xl font-semibold">{c.pricing.included.title}</h3>
              <p className="mt-2 text-muted">{c.pricing.included.text}</p>
            </div>
            <ul className="grid gap-2.5 sm:grid-cols-2 text-[15px]">
              {c.pricing.included.items.map(it => <li key={it} className="flex gap-2.5"><Check className="size-5 shrink-0 text-brand" /><span>{it}</span></li>)}
            </ul>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------ faq */}
      <Section id="faq" kicker={c.faq.kicker} title={c.faq.title} icon={<ChevronDown className="size-4" />}>
        <div className="mx-auto max-w-3xl space-y-3">
          {c.faq.items.map(([q, a]) => (
            <details key={q} className="reveal group rounded-2xl border border-line bg-surface/70 px-5 open:border-brand/40 transition-colors">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold">
                {q}<ChevronDown className="size-5 shrink-0 text-brand transition-transform group-open:rotate-180" />
              </summary>
              <p className="pb-5 text-muted leading-relaxed">{a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------------ final cta */}
      <section className="px-5 pb-24">
        <div className="reveal relative isolate mx-auto max-w-5xl overflow-hidden rounded-[2.5rem] border border-brand/30 px-6 py-16 text-center sm:py-20">
          <div className="absolute inset-0 -z-10 bg-gradient-to-br from-brand/25 via-surface to-bg" aria-hidden />
          <div className="absolute inset-0 -z-10 zellige opacity-[0.12]" aria-hidden />
          <h2 className="font-display text-4xl sm:text-5xl font-semibold">{c.final.title}</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-ink/80">{c.final.text}</p>
          <a href={signup} className="mt-9 inline-flex h-14 items-center gap-2 rounded-full bg-brand px-8 text-[15px] font-bold text-brand-ink glow-brand press">
            {c.final.cta}<Arrow className="size-4.5" />
          </a>
          <p className="mt-4 text-sm text-ink/60">{c.hero.note}</p>
        </div>
      </section>

      <footer className="border-t border-line px-5 py-10 text-center text-sm text-muted">
        <div className="flex items-center justify-center gap-2">
          <AmplifyLogo mark="h-6 w-8" text="text-base" />
        </div>
        <p className="mt-2">{c.footer}</p>
        <p className="mt-1">© 2026</p>
      </footer>
    </div>
  );
}

export function Section({ id, kicker, title, text, icon, children }: { id: string; kicker: string; title: string; text?: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 px-5 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <p className="reveal inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-brand">{icon}{kicker}</p>
          <h2 className="reveal mt-4 font-display text-4xl sm:text-5xl font-semibold leading-tight" style={{ ['--d' as string]: '80ms' }}>{title}</h2>
          {text && <p className="reveal mt-5 text-lg text-muted leading-relaxed" style={{ ['--d' as string]: '160ms' }}>{text}</p>}
        </div>
        <div className="mt-14">{children}</div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Hero: the till (drawn in HTML) and a phone showing the real guest menu
// ---------------------------------------------------------------------------
function HeroVisual({ lang }: { lang: SiteLang }) {
  return (
    <div className="reveal relative mx-auto w-full max-w-xl lg:max-w-none sm:pe-16 lg:pe-10" style={{ ['--d' as string]: '200ms' }}>
      <div className="hidden sm:block tilt rounded-[1.6rem] border border-line bg-surface p-2 shadow-[0_40px_120px_-40px_rgba(0,0,0,.9)]">
        <TillMock />
      </div>
      <div className="relative mx-auto sm:absolute sm:-bottom-24 sm:-end-6 lg:-end-16 w-[230px] sm:w-[170px] float">
        <Phone src={`/${DEMO_SLUG}?lang=${lang}`} />
      </div>
    </div>
  );
}

function Phone({ src }: { src: string }) {
  return (
    <div className="relative rounded-[2.4rem] border border-white/10 bg-[#010A16] p-2 shadow-[0_40px_90px_-30px_rgba(0,0,0,.95),0_0_0_1px_rgba(5,185,98,.25)]">
      <div className="absolute top-3.5 start-1/2 z-10 h-5 w-20 -translate-x-1/2 rtl:translate-x-1/2 rounded-full bg-black" aria-hidden />
      <div className="overflow-hidden rounded-[1.9rem] bg-bg aspect-[9/19.5]">
        <iframe src={src} title="Menu" loading="lazy" className="size-full border-0" />
      </div>
    </div>
  );
}

function TillMock() {
  const tables = [
    [1, 0], [2, 185], [3, 0], [4, 32], [5, 0], [6, 0], [7, 250], [8, 0], [9, 68], [10, 0], [11, 0], [12, 0],
  ] as const;
  return (
    <div dir="ltr" className="overflow-hidden rounded-[1.2rem] bg-[#031428] text-[10px] text-[#ECF2FA] select-none" aria-hidden>
      <div className="flex items-center gap-2 border-b border-white/5 bg-[#071B36] px-3 py-2">
        <span className="relative grid size-5 place-items-center"><Star8 className="absolute inset-0 size-full text-brand" /></span>
        <span className="font-display text-[11px] font-semibold">Dar Nour</span>
        <span className="ms-2 rounded-md bg-brand px-2 py-1 font-bold text-brand-ink">Tables 4/12</span>
        <span className="rounded-md px-2 py-1 text-[#8CA0BE]">Commandes</span>
        <span className="rounded-md px-2 py-1 text-[#8CA0BE]">Historique</span>
        <span className="ms-auto flex items-center gap-1 rounded-full bg-[#2DD4BF]/10 px-2 py-0.5 font-bold text-[#2DD4BF]"><Wifi className="size-3" />En direct</span>
      </div>
      <div className="grid grid-cols-[1fr_128px]">
        <div className="grid grid-cols-4 gap-2 p-3">
          {tables.map(([n, amt]) => (
            <div key={n} className={`aspect-square rounded-xl grid place-content-center text-center ${amt ? 'gold-tile text-brand-ink' : 'border border-white/5 bg-[#071B36]'}`}>
              <span className="font-display text-base font-semibold leading-none">{n}</span>
              {amt ? <span className="mt-0.5 font-bold">{amt} MAD</span> : null}
            </div>
          ))}
        </div>
        <div className="border-s border-white/5 bg-[#071B36] p-2.5 flex flex-col">
          <p className="font-bold uppercase tracking-widest text-[#8CA0BE]">Table 7</p>
          {[['2×', 'Tajine poulet', '130'], ['1×', 'Salade du jardin', '45'], ['3×', 'Thé à la menthe', '45'], ['1×', 'Jus d’orange', '30']].map(([q, n, p]) => (
            <p key={n} className="mt-1.5 flex gap-1"><b>{q}</b><span className="flex-1 truncate">{n}</span><span>{p}</span></p>
          ))}
          <p className="mt-auto flex items-baseline justify-between border-t border-white/5 pt-2"><span className="text-[#8CA0BE]">TOTAL</span><span className="font-display text-base font-semibold text-brand">250 MAD</span></p>
          <span className="mt-2 rounded-lg bg-[#2DD4BF] py-1.5 text-center font-bold text-[#032A2A]">Encaisser</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Offline demo: switch the internet off and watch the till keep going
// ---------------------------------------------------------------------------
function OfflineDemo({ lang }: { lang: SiteLang }) {
  const c = COPY[lang].offline;
  const [online, setOnline] = useState(true);
  const [feed, setFeed] = useState<{ id: number; text: string; synced: boolean }[]>([]);
  const n = useRef(0);
  const onlineRef = useRef(online);
  onlineRef.current = online;

  useEffect(() => {
    const tick = () => {
      const id = n.current++;
      setFeed(f => [{ id, text: c.events[id % c.events.length], synced: onlineRef.current }, ...f].slice(0, 6));
    };
    tick();
    const t = window.setInterval(tick, 1700);
    return () => window.clearInterval(t);
  }, [c]);

  // back online: the queue drains one by one
  useEffect(() => {
    if (!online) return;
    const t = window.setInterval(() => {
      setFeed(f => {
        const i = f.map(x => x.synced).lastIndexOf(false);
        if (i < 0) return f;
        const next = [...f]; next[i] = { ...next[i], synced: true }; return next;
      });
    }, 280);
    return () => window.clearInterval(t);
  }, [online]);

  const queued = feed.filter(x => !x.synced).length;
  return (
    <div className="reveal mx-auto grid max-w-4xl items-center gap-6 md:grid-cols-[260px_1fr]">
      <div className="rounded-[2rem] border border-line bg-surface/70 p-6 text-center">
        <p className="text-sm font-semibold text-muted">{c.internet}</p>
        <button role="switch" aria-checked={online} onClick={() => setOnline(o => !o)}
          className={`relative mx-auto mt-4 block h-16 w-32 rounded-full transition-colors duration-300 ${online ? 'bg-[#2DD4BF]' : 'bg-[#F47171]'}`}>
          <span className={`absolute top-2 grid size-12 place-items-center rounded-full bg-white shadow-lg transition-all duration-300 ${online ? 'start-[4.5rem]' : 'start-2'}`}>
            {online ? <Wifi className="size-6 text-[#0E7C70]" /> : <WifiOff className="size-6 text-[#c24141]" />}
          </span>
        </button>
        <p className={`mt-4 font-display text-2xl font-semibold ${online ? 'text-[#2DD4BF]' : 'text-[#F47171]'}`}>{online ? c.on : c.off}</p>
        <p className="mt-1 h-5 text-sm text-muted">{queued ? `${queued} ${c.queued}` : c.synced}</p>
      </div>
      <div className="rounded-[2rem] border border-line bg-bg/70 p-3">
        <ul className="space-y-2">
          {feed.map((e, i) => (
            <li key={e.id} className={`flex items-center gap-3 rounded-2xl border border-line bg-surface/80 px-4 py-3 ${i === 0 ? 'animate-rise' : ''}`}>
              <span className={`grid size-8 shrink-0 place-items-center rounded-full transition-colors ${e.synced ? 'bg-[#2DD4BF]/15 text-[#2DD4BF]' : 'bg-[#F2AD46]/15 text-[#F2AD46]'}`}>
                {e.synced ? <Check className="size-4" strokeWidth={3} /> : <Clock className="size-4" />}
              </span>
              <span className="flex-1 font-medium">{e.text}</span>
              <span className={`text-xs font-semibold ${e.synced ? 'text-[#2DD4BF]' : 'text-[#F2AD46]'}`}>{e.synced ? '✓' : c.queued}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function MiniTicket({ lang }: { lang: SiteLang }) {
  const ar = lang === 'ar';
  const rows = ar
    ? [['طاجين الدجاج', '2', '130'], ['شاي بالنعناع', '3', '45'], ['عصير البرتقال', '1', '30']]
    : [['Tajine poulet', '2', '130'], ['Thé à la menthe', '3', '45'], ['Jus d’orange', '1', '30']];
  return (
    <div dir={ar ? 'rtl' : 'ltr'} lang={lang} className="rounded-[2rem] border border-line bg-surface/80 p-6">
      <div className="flex items-center justify-between">
        <p className="font-display text-2xl font-semibold">{ar ? 'طاولة 7' : 'Table 7'}</p>
        <span className="rounded-full bg-brand/15 px-3 py-1 text-xs font-bold text-brand">{ar ? 'العربية' : 'Français'}</span>
      </div>
      <ul className="mt-4 divide-y divide-line">
        {rows.map(([name, q, p]) => (
          <li key={name} className="flex items-center gap-3 py-2.5"><b className="w-7">{q}×</b><span className="flex-1">{name}</span><span dir="ltr" className="font-semibold">{p} {ar ? 'درهم' : 'MAD'}</span></li>
        ))}
      </ul>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm font-bold">
        <span className="rounded-xl bg-brand py-3 text-center text-brand-ink">{ar ? 'إرسال' : 'Envoyer'}</span>
        <span className="rounded-xl bg-[#2DD4BF] py-3 text-center text-[#032A2A]">{ar ? 'تحصيل' : 'Encaisser'}</span>
      </div>
    </div>
  );
}

function LiveDemo({ openLabel, lang }: { openLabel: string; lang: SiteLang }) {
  const url = `${location.origin}/${DEMO_SLUG}`;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 440, color: { dark: '#020F20', light: '#ECF2FA' } }).then(setQr).catch(() => {});
  }, [url]);
  return (
    <div className="reveal mx-auto grid max-w-4xl items-center gap-10 md:grid-cols-2">
      <div className="text-center">
        <div className="relative mx-auto w-fit">
          <Star8 filled={false} stroke={0.3} className="absolute -inset-10 size-[calc(100%+5rem)] text-brand/40 animate-spin-slow" />
          <div className="relative rounded-[2rem] bg-[#ECF2FA] p-4 shadow-[0_30px_80px_-30px_rgba(5,185,98,.6)]">
            {qr ? <img src={qr} alt="QR code" className="size-52" /> : <div className="size-52" />}
          </div>
        </div>
        <a href={url} target="_blank" rel="noopener" className="mt-10 inline-flex h-12 items-center gap-2 rounded-full border border-line px-6 font-semibold hover:border-brand/50 transition-colors">
          <Smartphone className="size-4.5 text-brand" />{openLabel}
        </a>
      </div>
      <div className="mx-auto w-[260px]"><Phone src={`/${DEMO_SLUG}?lang=${lang}`} /></div>
    </div>
  );
}
