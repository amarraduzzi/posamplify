// Left side of the login / sign-up screen, in the style of the company site:
// a loud condensed headline and a live "service of the day" card. Orders come in, the kitchen ticket
// goes out, the counters climb. Illustration only (no real data).
import { useEffect, useState } from 'react';
import { AmplifyLogo } from './Brand';
import { t } from '../lib/i18n';

type Ev = { table: string; line: string; kind: 'qr' | 'pos'; amount: number };
const EVENTS = (): Ev[] => [
  { table: t('Table {n}', { n: 4 }), line: t('2 × Thé à la menthe'), kind: 'qr', amount: 32 },
  { table: t('Table {n}', { n: 7 }), line: t('1 × Tajine poulet citron'), kind: 'pos', amount: 95 },
  { table: t('Comptoir'), line: t('3 × Café noir'), kind: 'pos', amount: 48 },
  { table: t('Table {n}', { n: 2 }), line: t('2 × Msemen au miel'), kind: 'qr', amount: 36 },
  { table: t('Table {n}', { n: 9 }), line: t('1 × Pizza margarita'), kind: 'qr', amount: 65 },
  { table: t('À emporter'), line: t('4 × Jus d’orange'), kind: 'pos', amount: 72 },
];

export function LoginShowcase({ product }: { product: 'POS' | 'PROFIT' | 'SITE' }) {
  const site = product === 'SITE';
  const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const events = EVENTS();
  const [n, setN] = useState(3);
  useEffect(() => {
    if (still) return;
    const id = setInterval(() => setN(x => x + 1), 2400);
    return () => clearInterval(id);
  }, [still]);
  const feed = Array.from({ length: Math.min(n, 4) }, (_, i) => ({ ...events[(n - 1 - i) % events.length], key: n - i }));
  const orders = 37 + n;
  const revenue = 2840 + Array.from({ length: n }, (_, i) => events[i % events.length].amount).reduce((a, b) => a + b, 0);
  const margin = 68 + (n % 3);

  return (
    <section className="lg-show relative hidden flex-1 flex-col justify-between overflow-hidden p-12 text-white lg:flex">
      {/* glow + grid */}
      <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_80%_60%,rgba(5,185,98,.22),transparent_70%),radial-gradient(40%_40%_at_0%_0%,rgba(5,185,98,.12),transparent_70%)]" />
      <span className="lg-grid pointer-events-none absolute inset-0" />

      <AmplifyLogo size="lg" product={product} className="relative" />

      <div className="relative grid items-end gap-10 xl:grid-cols-[1fr_20rem]">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold ring-1 ring-white/15">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#05B962] opacity-60" /><span className="relative h-2 w-2 rounded-full bg-[#05B962]" /></span>
            {t('Fait pour le Maroc')}
          </p>
          <h2 className="lg-h mt-6 text-[clamp(3.4rem,5.6vw,6rem)]">
            <span className="block overflow-hidden"><span className="lg-rise block">{site ? t('Votre site web.') : t('Votre service.')}</span></span>
            <span className="block overflow-hidden"><span className="lg-rise block text-[#05B962]" style={{ animationDelay: '.12s' }}>{site ? t('Prêt ce soir.') : t('Sous contrôle.')}</span></span>
          </h2>
          <ul className="mt-8 space-y-2.5 text-white/80">
            {(site ? [t('Votre carte depuis une simple photo'), t('Trouvé sur Google, en 3 langues'), t('Les commandes arrivent sur votre WhatsApp')] : [t('Menu QR en français, arabe et anglais'), t('Caisse, bons cuisine et rapports Z'), t('Même quand internet tombe')]).map((x, i) => (
              <li key={x} className="lg-in flex items-center gap-3" style={{ animationDelay: `${.3 + i * .1}s` }}>
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#05B962] text-[#001E3E]"><svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"><path d="M5 12l4 4 10-10" /></svg></span>{x}
              </li>
            ))}
          </ul>
        </div>

        {/* the live card */}
        {!site && <div className="lg-card rounded-[1.75rem] bg-white/[0.06] p-4 ring-1 ring-white/15 backdrop-blur-md" aria-hidden="true">
          <div className="flex items-center justify-between px-1 text-xs">
            <span className="font-semibold text-white/70">{t('Aujourd’hui')}</span>
            <span className="flex items-center gap-1.5 rounded-full bg-[#05B962]/15 px-2 py-0.5 font-bold text-[#05B962]"><span className="h-1.5 w-1.5 rounded-full bg-current" />{t('En ligne')}</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[[t('Commandes'), String(orders)], [t('Ventes'), `${revenue.toLocaleString('fr-FR').replace(/[  ]/g, ' ')}`], [t('Marge'), `${margin} %`]].map(([l, v]) => (
              <div key={l} className="rounded-xl bg-white/[0.06] px-2.5 py-2">
                <p className="text-[0.65rem] text-white/55">{l}</p>
                <p key={v} className="lg-num lg-h text-2xl tabular" dir="ltr">{v}</p>
              </div>
            ))}
          </div>
          <ul className="mt-3 space-y-1.5">
            {feed.map((e, i) => (
              <li key={e.key} className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[0.8rem] ring-1 transition-colors ${i === 0 ? 'lg-new bg-white text-[#001E3E] ring-transparent' : 'bg-white/[0.04] ring-white/10'}`}>
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[0.6rem] font-black ${e.kind === 'qr' ? 'bg-[#05B962] text-[#001E3E]' : i === 0 ? 'bg-[#001E3E] text-white' : 'bg-white/10'}`}>{e.kind === 'qr' ? 'QR' : 'POS'}</span>
                <span className="min-w-0 flex-1 leading-tight"><span className="block font-semibold">{e.table}</span><span className={`block truncate ${i === 0 ? 'text-[#4A5A6E]' : 'text-white/55'}`}>{e.line}</span></span>
                <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[0.65rem] font-bold ${i === 0 ? 'bg-[#DDF6E8] text-[#00552C]' : 'text-white/45'}`}>{i === 0 ? t('En cuisine ✓') : '✓'}</span>
              </li>
            ))}
          </ul>
        </div>}
      </div>

      <div className="relative flex items-center justify-between gap-4">
        <p className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold ring-1 ring-white/15"><span className="text-[#05B962]">★</span> {t('14 jours gratuits · sans engagement')}</p>
        <p className="text-xs text-white/35">{t('Illustration')}</p>
      </div>
    </section>
  );
}
