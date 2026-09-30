// Amplify Profit website (posamplify.pages.dev/profit). Same look as the POS
// site; sign-up from here creates a "Profit only" account (?produit=profit).
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, Clock, ListChecks, Receipt, Sparkles, TrendingUp } from 'lucide-react';
import { PROFIT_COPY } from './profitCopy';
import type { SiteLang } from './copy';
import { ADMIN, Section, THEME, initialLang, useReveal } from './Landing';
import { AmplifyLogo } from './AmplifyMark';
import { Star8 } from '../components/Ornament';

// the example card: Tajine poulet citron at 95 DH (10 % VAT)
const COST = 2820, PRICE = 9500, HT = Math.round(PRICE * 10000 / 11000);
const money = (c: number) => (c / 100).toFixed(2).replace('.', ',');

export default function ProfitLanding() {
  const [lang, setLang] = useState<SiteLang>(initialLang);
  const c = PROFIT_COPY[lang];
  const rtl = lang === 'ar';
  const Arrow = rtl ? ArrowLeft : ArrowRight;
  const signup = `${ADMIN}/?inscription=1&lang=${lang}&produit=profit`;
  const signupBoth = `${ADMIN}/?inscription=1&lang=${lang}`;
  const login = `${ADMIN}/?lang=${lang}`;

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
            <a href="#top" className="me-auto"><AmplifyLogo product="PROFIT" mark="h-7 w-9 sm:h-8 sm:w-10" text="text-[0.95rem] sm:text-lg" /></a>
            <div className="hidden md:flex items-center gap-6 text-sm text-muted">
              <a href="/" className="hover:text-ink transition-colors">{c.nav.pos}</a>
              <a href="#how" className="hover:text-ink transition-colors">{c.nav.how}</a>
              <a href="#pricing" className="hover:text-ink transition-colors">{c.nav.pricing}</a>
              <a href="#faq" className="hover:text-ink transition-colors">{c.nav.faq}</a>
              <a href="/fonctionnalites" className="hover:text-ink transition-colors">{lang === 'ar' ? 'كل المميزات' : 'Toutes les fonctionnalités'}</a>
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
          <div className="fade-down absolute inset-0"><div className="zellige absolute inset-0 opacity-[0.07]" /></div>
        </div>
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 lg:grid-cols-[1.05fr_1fr]">
          <div className="text-center lg:text-start">
            <p className="reveal inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.25em] text-brand"><TrendingUp className="size-4" />{c.hero.kicker}</p>
            <h1 className="reveal mt-6 font-display text-5xl sm:text-6xl lg:text-7xl font-semibold leading-[1.02]" style={{ ['--d' as string]: '80ms' }}>
              {c.hero.title1}<br /><span className="text-gold">{c.hero.title2}</span>
            </h1>
            <p className="reveal mx-auto mt-6 max-w-xl text-lg text-muted leading-relaxed lg:mx-0" style={{ ['--d' as string]: '160ms' }}>{c.hero.text}</p>
            <div className="reveal mt-9 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start" style={{ ['--d' as string]: '240ms' }}>
              <a href={signup} className="h-14 px-7 inline-flex items-center justify-center gap-2 rounded-full bg-brand text-brand-ink font-bold glow-brand press">{c.hero.cta}<Arrow className="size-4.5" /></a>
              <a href="#how" className="h-14 px-7 inline-flex items-center justify-center rounded-full border border-line font-bold hover:border-brand/50 transition-colors">{c.hero.cta2}</a>
            </div>
            <p className="reveal mt-4 text-sm text-muted" style={{ ['--d' as string]: '300ms' }}>{c.hero.note}</p>
          </div>
          <RecipeCard lang={lang} />
        </div>
      </section>

      {/* ------------------------------------------------------------ problem */}
      <Section id="probleme" kicker={c.pains.kicker} title={c.pains.title} icon={<AlertTriangle className="size-4" />}>
        <div className="grid gap-4 md:grid-cols-3">
          {c.pains.items.map(([h, p], i) => (
            <article key={h} className="reveal rounded-[2rem] border border-line bg-surface/70 p-7" style={{ ['--d' as string]: `${i * 90}ms` }}>
              <span className="grid size-10 place-items-center rounded-full bg-[#F47171]/15 font-display font-bold text-[#F47171]">{i + 1}</span>
              <h3 className="mt-4 font-display text-xl font-semibold">{h}</h3>
              <p className="mt-2 text-muted leading-relaxed">{p}</p>
            </article>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------------ features */}
      <Section id="features" kicker={c.features.kicker} title={c.features.title} icon={<ListChecks className="size-4" />}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {c.features.items.map(([h, p, ready], i) => (
            <article key={h} className={`reveal group relative overflow-hidden rounded-[1.6rem] border p-6 ${ready ? 'border-line bg-surface/70' : 'border-dashed border-line bg-surface/30'}`} style={{ ['--d' as string]: `${(i % 4) * 70}ms` }}>
              <Star8 filled={false} stroke={0.4} className="absolute -top-10 -end-10 size-32 text-brand/10 group-hover:text-brand/25 transition-colors" />
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${ready ? 'bg-brand/15 text-brand' : 'border border-line text-muted'}`}>
                {ready ? <Check className="size-3" /> : <Clock className="size-3" />}{ready ? c.features.ready : c.features.soon}
              </span>
              <h3 className="mt-3 font-display text-lg font-semibold leading-snug">{h}</h3>
              <p className="mt-2 text-sm text-muted leading-relaxed">{p}</p>
            </article>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------------ how */}
      <Section id="how" kicker={c.how.kicker} title={c.how.title} text={c.how.text} icon={<Sparkles className="size-4" />}>
        <ol className="grid gap-4 md:grid-cols-3">
          {c.how.steps.map(([h, p], i) => (
            <li key={h} className="reveal rounded-[2rem] border border-line bg-surface/70 p-7" style={{ ['--d' as string]: `${i * 90}ms` }}>
              <span className="grid size-11 place-items-center rounded-2xl bg-brand font-display text-lg font-bold text-brand-ink">{i + 1}</span>
              <h3 className="mt-4 font-display text-xl font-semibold">{h}</h3>
              <p className="mt-2 text-muted leading-relaxed">{p}</p>
            </li>
          ))}
        </ol>
        <p className="reveal mx-auto mt-6 max-w-2xl rounded-full border border-brand/30 bg-brand/10 px-5 py-3 text-center text-sm font-semibold">
          {c.how.together} <a href="/" className="text-brand underline-offset-4 hover:underline">Amplify POS →</a>
        </p>
      </Section>

      {/* ------------------------------------------------------------ pricing */}
      <Section id="pricing" kicker={c.pricing.kicker} title={c.pricing.title} text={c.pricing.note} icon={<Receipt className="size-4" />}>
        <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2">
          {([[c.pricing.alone, '249', 'Amplify Profit', signup, false], [c.pricing.both, '499', c.pricing.both.tag, signupBoth, true]] as const).map(([p, price, tag, href, best], i) => (
            <article key={p.name} className={`reveal relative flex flex-col rounded-[2rem] p-7 ${best ? 'bg-gradient-to-b from-brand/20 to-surface border border-brand/60 shadow-[0_30px_80px_-30px_rgba(5,185,98,.55)]' : 'border border-line bg-surface/70'}`} style={{ ['--d' as string]: `${i * 90}ms` }}>
              {best && <span className="absolute -top-3.5 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 rounded-full bg-brand px-3.5 py-1 text-xs font-bold text-brand-ink whitespace-nowrap">{c.pricing.best}</span>}
              <p dir="ltr" className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand rtl:text-end">{tag}</p>
              <h3 className="mt-1 font-display text-2xl font-semibold">{p.name}</h3>
              <p className="mt-1 text-sm text-muted">{p.text}</p>
              <p className="mt-6 flex items-baseline gap-2"><span dir="ltr" className="font-display text-5xl font-semibold">{price}</span><span className="text-sm text-muted">{c.pricing.per}</span></p>
              <ul className="mt-6 flex-1 space-y-2.5 text-[15px]">{p.items.map(it => <li key={it} className="flex gap-2.5"><Check className="size-5 shrink-0 text-brand" />{it}</li>)}</ul>
              <a href={href} className={`mt-8 grid h-12 place-items-center rounded-full font-bold press ${best ? 'bg-brand text-brand-ink glow-brand' : 'border border-line transition-colors hover:border-brand/50'}`}>{c.pricing.choose}</a>
            </article>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------------ faq */}
      <Section id="faq" kicker={c.faq.kicker} title={c.faq.title} icon={<ChevronDown className="size-4" />}>
        <div className="mx-auto max-w-3xl space-y-3">
          {c.faq.items.map(([q, a]) => (
            <details key={q} className="reveal group rounded-2xl border border-line bg-surface/70 px-5 open:border-brand/40 transition-colors">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold">{q}<ChevronDown className="size-5 shrink-0 text-brand transition-transform group-open:rotate-180" /></summary>
              <p className="pb-5 text-muted leading-relaxed">{a}</p>
            </details>
          ))}
        </div>
      </Section>

      <section className="px-5 pb-24">
        <div className="reveal relative isolate mx-auto max-w-5xl overflow-hidden rounded-[2.5rem] border border-brand/30 px-6 py-16 text-center sm:py-20">
          <div className="absolute inset-0 -z-10 bg-gradient-to-br from-brand/25 via-surface to-bg" aria-hidden />
          <div className="absolute inset-0 -z-10 zellige opacity-[0.12]" aria-hidden />
          <h2 className="font-display text-4xl sm:text-5xl font-semibold">{c.final.title}</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-ink/80">{c.final.text}</p>
          <a href={signup} className="mt-9 inline-flex h-14 items-center gap-2 rounded-full bg-brand px-8 text-[15px] font-bold text-brand-ink glow-brand press">{c.final.cta}<Arrow className="size-4.5" /></a>
          <p className="mt-4 text-sm text-ink/60">{c.hero.note}</p>
        </div>
      </section>

      <footer className="border-t border-line px-5 py-10 text-center text-sm text-muted">
        <div className="flex items-center justify-center gap-2"><AmplifyLogo product="PROFIT" mark="h-6 w-8" text="text-base" /></div>
        <p className="mt-2">{c.footer}</p>
        <p className="mt-1">© 2026</p>
      </footer>
    </div>
  );
}

/** The example recipe card in the hero (static, labelled as an illustration). */
function RecipeCard({ lang }: { lang: SiteLang }) {
  const c = PROFIT_COPY[lang].card;
  const fc = Math.round(COST * 1000 / HT) / 10;
  return (
    <div className="reveal relative mx-auto w-full max-w-md" style={{ ['--d' as string]: '200ms' }}>
      <div className="float rounded-[2rem] border border-line bg-surface/90 p-6 shadow-[0_40px_90px_-30px_rgba(0,0,0,.9),0_0_0_1px_rgba(5,185,98,.2)] backdrop-blur">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand">{c.label}</p>
        <h3 className="mt-1 font-display text-2xl font-semibold">{c.dish}</h3>
        <ul className="mt-4 divide-y divide-line text-sm">
          {c.lines.map(([n, q, p]) => (
            <li key={n} className="flex items-center gap-3 py-2"><span className="flex-1">{n}</span><span className="text-muted tabular-nums">{q}</span><span dir="ltr" className="w-16 text-end tabular-nums">{p}</span></li>
          ))}
        </ul>
        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
          {[[c.cost, money(COST)], [c.price, money(PRICE)], [c.fc, `${String(fc).replace('.', ',')} %`], [c.margin, money(HT - COST)]].map(([l, v], i) => (
            <div key={l} className={`rounded-xl p-2 ${i === 2 ? 'bg-[#F2AD46]/15' : 'bg-surface-2'}`}>
              <p className="text-[10px] leading-tight text-muted">{l}</p>
              <p dir="ltr" className={`mt-0.5 font-display text-sm font-bold tabular-nums ${i === 2 ? 'text-[#F2AD46]' : i === 3 ? 'text-brand' : ''}`}>{v}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-[#F47171]/12 px-3 py-2 text-xs font-semibold text-[#F47171]"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{c.alert}</p>
        <p className="mt-3 text-center text-[11px] text-muted">{c.example}</p>
      </div>
    </div>
  );
}
