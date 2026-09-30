// "All features" page (posamplify.pages.dev/fonctionnalites): every module in detail,
// to show that Amplify is the most complete system on the market.
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Boxes, ChartPie, Check, Monitor, QrCode, ShieldCheck, Smartphone, UserCheck, Wallet } from 'lucide-react';
import { FEATURES_COPY, type ModuleKey } from './featuresCopy';
import type { SiteLang } from './copy';
import { ADMIN, THEME, initialLang, useReveal } from './Landing';
import { AmplifyLogo } from './AmplifyMark';
import { Star8 } from '../components/Ornament';

const ICON: Record<ModuleKey, typeof Monitor> = {
  pos: Monitor, waiter: Smartphone, qr: QrCode, margins: ChartPie, stock: Boxes, team: UserCheck, money: Wallet, trust: ShieldCheck,
};

export default function FeaturesLanding() {
  const [lang, setLang] = useState<SiteLang>(initialLang);
  const c = FEATURES_COPY[lang];
  const rtl = lang === 'ar';
  const Arrow = rtl ? ArrowLeft : ArrowRight;
  const signup = `${ADMIN}/?inscription=1&lang=${lang}`;
  const login = `${ADMIN}/?lang=${lang}`;
  const total = c.modules.reduce((n, m) => n + m.items.length, 0);
  const statValues = [String(c.modules.length), `${total}+`, '3'];

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang; root.dir = rtl ? 'rtl' : 'ltr';
    root.dataset.theme = 'dark';
    document.body.style.background = '#020F20';
    document.title = c.title;
    try { localStorage.setItem('site-lang', lang); } catch { /* ignore */ }
  }, [lang, rtl, c.title]);
  useReveal(lang);

  return (
    <div style={THEME} className="site min-h-dvh bg-bg text-ink overflow-x-clip">
      <header className="fixed inset-x-0 top-0 z-50">
        <div className="mx-auto max-w-6xl px-4 pt-3">
          <nav className="flex items-center gap-3 rounded-2xl border border-line bg-surface/70 backdrop-blur-xl px-3 py-2 sm:px-4">
            <a href="/" className="me-auto"><AmplifyLogo mark="h-7 w-9 sm:h-8 sm:w-10" text="text-[0.95rem] sm:text-lg" /></a>
            <div className="hidden md:flex items-center gap-6 text-sm text-muted">
              <a href="/" className="hover:text-ink transition-colors">{c.nav.back}</a>
              <a href="/#pricing" className="hover:text-ink transition-colors">{c.nav.pricing}</a>
              <a href="/profit" className="text-brand hover:text-ink transition-colors">{c.nav.profit}</a>
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
      <section className="relative isolate pt-32 sm:pt-40 pb-14">
        <div className="absolute inset-0 -z-10" aria-hidden>
          <div className="absolute inset-0 site-glow" />
          <div className="fade-down absolute inset-0"><div className="zellige absolute inset-0 opacity-[0.07]" /></div>
        </div>
        <div className="mx-auto max-w-5xl px-5 text-center">
          <p className="reveal inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.25em] text-brand"><Check className="size-4" />{c.hero.kicker}</p>
          <h1 className="reveal mt-6 font-display text-5xl sm:text-6xl lg:text-7xl font-semibold leading-[1.02]" style={{ ['--d' as string]: '80ms' }}>
            {c.hero.title1}<br /><span className="text-gold">{c.hero.title2}</span>
          </h1>
          <p className="reveal mx-auto mt-6 max-w-2xl text-lg text-muted leading-relaxed" style={{ ['--d' as string]: '160ms' }}>{c.hero.text}</p>
          <div className="reveal mx-auto mt-10 grid max-w-3xl grid-cols-3 gap-3" style={{ ['--d' as string]: '220ms' }}>
            {c.hero.stats.map(([label, sub], i) => (
              <div key={label} className="rounded-3xl border border-line bg-surface/70 px-3 py-5">
                <p dir="ltr" className="font-display text-4xl sm:text-5xl font-semibold text-brand">{statValues[i]}</p>
                <p className="mt-1 font-semibold">{label}</p>
                <p className="text-xs text-muted">{sub}</p>
              </div>
            ))}
          </div>
          <div className="reveal mt-9 flex flex-col sm:flex-row gap-3 justify-center" style={{ ['--d' as string]: '280ms' }}>
            <a href={signup} className="h-14 px-7 inline-flex items-center justify-center gap-2 rounded-full bg-brand text-brand-ink font-bold glow-brand press">{c.hero.cta}<Arrow className="size-4.5" /></a>
            <a href="/#pricing" className="h-14 px-7 inline-flex items-center justify-center rounded-full border border-line font-bold hover:border-brand/50 transition-colors">{c.hero.cta2}</a>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ jump to a module */}
      <div className="sticky top-[4.5rem] z-40 px-4">
        <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto rounded-2xl border border-line bg-surface/80 p-2 backdrop-blur-xl" aria-label={c.jump}>
          {c.modules.map(m => {
            const Icon = ICON[m.key];
            return <a key={m.key} href={`#${m.key}`} className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink"><Icon className="size-4 text-brand" />{m.title}</a>;
          })}
        </div>
      </div>

      {/* ------------------------------------------------------------ modules */}
      <div className="mx-auto max-w-6xl space-y-20 px-5 py-20">
        {c.modules.map((m, mi) => {
          const Icon = ICON[m.key];
          return (
            <section key={m.key} id={m.key} className="scroll-mt-40 grid gap-8 lg:grid-cols-[0.8fr_1.6fr]">
              <div className="reveal lg:sticky lg:top-40 lg:self-start">
                <span className="grid size-14 place-items-center rounded-2xl bg-brand/15 text-brand"><Icon className="size-7" /></span>
                <p dir="ltr" className="mt-5 text-[11px] font-bold uppercase tracking-[0.2em] text-brand rtl:text-end">{m.tag} · {String(mi + 1).padStart(2, '0')}</p>
                <h2 className="mt-1 font-display text-3xl sm:text-4xl font-semibold leading-tight">{m.title}</h2>
                <p className="mt-3 text-muted leading-relaxed">{m.text}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {m.items.map(([h, p], i) => (
                  <article key={h} className="reveal group relative overflow-hidden rounded-[1.4rem] border border-line bg-surface/70 p-5" style={{ ['--d' as string]: `${(i % 2) * 80}ms` }}>
                    <Star8 filled={false} stroke={0.4} className="absolute -top-10 -end-10 size-28 text-brand/10 transition-colors group-hover:text-brand/25" />
                    <h3 className="flex items-start gap-2 font-display text-lg font-semibold leading-snug"><Check className="mt-1 size-4 shrink-0 text-brand" />{h}</h3>
                    <p className="mt-2 text-sm text-muted leading-relaxed">{p}</p>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <section className="px-5 pb-24">
        <div className="reveal relative isolate mx-auto max-w-5xl overflow-hidden rounded-[2.5rem] border border-brand/30 px-6 py-16 text-center sm:py-20">
          <div className="absolute inset-0 -z-10 bg-gradient-to-br from-brand/25 via-surface to-bg" aria-hidden />
          <div className="absolute inset-0 -z-10 zellige opacity-[0.12]" aria-hidden />
          <h2 className="font-display text-4xl sm:text-5xl font-semibold">{c.final.title}</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-ink/80">{c.final.text}</p>
          <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center">
            <a href={signup} className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-brand px-8 text-[15px] font-bold text-brand-ink glow-brand press">{c.final.cta}<Arrow className="size-4.5" /></a>
            <a href="/#pricing" className="inline-flex h-14 items-center justify-center rounded-full border border-line px-8 font-bold hover:border-brand/50 transition-colors">{c.final.pricing}</a>
          </div>
        </div>
      </section>

      <footer className="border-t border-line px-5 py-10 text-center text-sm text-muted">
        <div className="flex items-center justify-center gap-2"><AmplifyLogo mark="h-6 w-8" text="text-base" /></div>
        <p className="mt-2">{c.footer}</p>
        <p className="mt-1">© 2026</p>
      </footer>
    </div>
  );
}
