import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Search, ChevronLeft, ChevronRight, Lightbulb, TriangleAlert, X, MousePointerClick, Sparkles } from 'lucide-react';
import type { Restaurant } from '../lib/types';
import { getLang } from '../lib/i18n';
import { ARTICLES, CHAPTERS, tourFor, type Article, type TourStep } from '../lib/helpContent';
import { Demo } from '../components/help/Demo';
import { tr } from '../components/help/kit';

/** lowercase, no accents, Arabic letter variants merged, so « caisse » / « cáisse » and « أ » / « ا » all match. Keeps the length (1:1) for highlighting. */
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');

type Idx = 0 | 1 | 2;
const langIdx = (): Idx => (getLang() === 'ar' ? 2 : getLang() === 'en' ? 1 : 0);

function haystack(a: Article, L: Idx) {
  return {
    title: norm(a.title[L] + ' ' + (L ? a.title[0] : '')),
    kw: norm(a.kw),
    body: norm([a.summary[L], ...a.steps.map(s => s.x[L]), a.tip?.[L] ?? '', a.warn?.[L] ?? ''].join(' ')),
  };
}
/** every word must be found; title weighs most, then keywords, then the body */
function score(h: ReturnType<typeof haystack>, words: string[]): number {
  let total = 0;
  for (const w of words) {
    const v = (h.title.includes(w) ? 6 : 0) + (h.kw.includes(w) ? 3 : 0) + (h.body.includes(w) ? 1 : 0);
    if (!v) return 0;
    total += v;
  }
  return total;
}

function Mark({ text, words }: { text: string; words: string[] }): ReactNode {
  if (!words.length) return text;
  const n = norm(text);
  if (n.length !== text.length) return text;
  const hit: boolean[] = new Array(text.length).fill(false);
  for (const w of words) {
    let i = n.indexOf(w);
    while (i !== -1) { for (let k = i; k < i + w.length; k++) hit[k] = true; i = n.indexOf(w, i + w.length); }
  }
  const out: ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    let j = i;
    while (j < text.length && hit[j] === hit[i]) j++;
    out.push(hit[i] ? <mark key={i} className="rounded bg-brand/25 px-0.5 text-inherit">{text.slice(i, j)}</mark> : text.slice(i, j));
    i = j;
  }
  return out;
}

const POPULAR = ['start-pair', 'till-order', 'till-pay', 'menu-import', 'menu-tables', 'guest-order'];

/** Interactive guide: instant search, chapters, and for each article a replica of the screen where the user is shown what to tap. Content: lib/helpContent.ts */
export function HelpPage({ r, onTour }: { r: Restaurant; onTour: (steps: TourStep[]) => void }) {
  const [q, setQ] = useState('');
  const [chapter, setChapter] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const L = langIdx();

  const products: string[] = r.products ?? ['pos', 'profit'];
  const available = useMemo(() => ARTICLES.filter(a => !a.products || a.products.some(p => products.includes(p))), [products.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = useMemo(() => norm(q).split(/\s+/).filter(w => w.length > 1), [q]);
  const results = useMemo(
    () => (words.length ? available.map(a => ({ a, s: score(haystack(a, L), words) })).filter(x => x.s > 0).sort((x, y) => y.s - x.s).map(x => x.a) : []),
    [available, words, L],
  );
  const article = open ? available.find(a => a.id === open) : null;
  const chapters = CHAPTERS.filter(c => available.some(a => a.chapter === c.id));
  const popular = POPULAR.map(id => available.find(a => a.id === id)).filter((x): x is Article => !!x);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') { e.preventDefault(); setOpen(null); input.current?.focus(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const go = (id: string) => { setOpen(id); window.scrollTo?.({ top: 0 }); document.querySelector('main')?.scrollTo?.({ top: 0 }); };
  const chapterOf = (a: Article) => CHAPTERS.find(c => c.id === a.chapter);

  // ───────── one article: the interactive screen first, details below
  if (article) {
    const ch = chapterOf(article);
    const mates = available.filter(a => a.chapter === article.chapter);
    const at = mates.findIndex(a => a.id === article.id);
    const prev = mates[at - 1], next = mates[at + 1];
    const tour = tourFor(article, L);
    return (
      <div className="mx-auto max-w-5xl">
        <button onClick={() => setOpen(null)} className="mb-4 flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink"><ChevronLeft className="h-4 w-4 rtl:rotate-180" />{tr('Retour au guide', 'Back to the guide', 'العودة إلى الدليل')}</button>
        {ch && <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-brand">{ch.icon} {ch.title[L]}</p>}
        <h1 className="font-display text-3xl font-semibold">{article.title[L]}</h1>
        <p className="mb-5 mt-1 text-muted">{article.summary[L]}</p>

        <Demo steps={article.steps} />

        {(article.warn || article.tip) && (
          <div className="mt-5 space-y-3">
            {article.warn && <div className="flex gap-3 rounded-2xl bg-warn/10 px-4 py-3 text-sm font-semibold leading-relaxed text-warn"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{article.warn[L]}</span></div>}
            {article.tip && <div className="flex gap-3 rounded-2xl bg-brand/10 px-4 py-3 text-sm font-semibold leading-relaxed"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-brand" /><span>{article.tip[L]}</span></div>}
          </div>
        )}

        {tour.length > 0 && (
          <button onClick={() => onTour(tour)} className="card mt-5 flex w-full items-center gap-3 rounded-2xl p-4 text-start transition hover:-translate-y-0.5 sm:w-auto">
            <span className="gold-fill grid h-10 w-10 shrink-0 place-items-center rounded-full text-brand-ink"><MousePointerClick className="h-5 w-5" /></span>
            <span><span className="block font-bold">{tr('Me le montrer dans l’application', 'Show me in the real application', 'أرني في التطبيق الحقيقي')}</span>
              <span className="block text-sm text-muted">{tr('Les vrais boutons sont entourés, sur votre écran.', 'The real buttons are ringed on your own screen.', 'تُحاط الأزرار الحقيقية بدائرة على شاشتك.')}</span></span>
          </button>
        )}

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {prev ? <button onClick={() => go(prev.id)} className="card flex items-center gap-3 rounded-2xl p-4 text-start hover:-translate-y-0.5"><ChevronLeft className="h-5 w-5 shrink-0 text-muted rtl:rotate-180" /><span><span className="block text-xs font-bold uppercase tracking-wider text-muted">{tr('Précédent', 'Previous', 'السابق')}</span><span className="font-semibold">{prev.title[L]}</span></span></button> : <span />}
          {next && <button onClick={() => go(next.id)} className="card flex items-center justify-between gap-3 rounded-2xl p-4 text-start hover:-translate-y-0.5"><span><span className="block text-xs font-bold uppercase tracking-wider text-muted">{tr('Suivant', 'Next', 'التالي')}</span><span className="font-semibold">{next.title[L]}</span></span><ChevronRight className="h-5 w-5 shrink-0 text-muted rtl:rotate-180" /></button>}
        </div>
      </div>
    );
  }

  const Row = ({ a }: { a: Article }) => (
    <button onClick={() => go(a.id)} className="flex w-full items-start gap-3 px-4 py-3.5 text-start hover:bg-surface-2">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-xl">{a.icon}</span>
      <span className="min-w-0 flex-1"><span className="block font-semibold"><Mark text={a.title[L]} words={words} /></span><span className="mt-0.5 block text-sm text-muted"><Mark text={a.summary[L]} words={words} /></span>
        <span className="mt-1 block text-xs font-bold uppercase tracking-wider text-brand">{chapterOf(a)?.title[L]}</span></span>
      <ChevronRight className="mt-3 h-4 w-4 shrink-0 text-muted rtl:rotate-180" />
    </button>
  );

  const chapterOpen = chapter ? CHAPTERS.find(c => c.id === chapter) : null;

  return (
    <div className="mx-auto max-w-4xl">
      {/* hero + search */}
      <div className="night relative mb-6 overflow-hidden rounded-3xl p-6 md:p-8">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.2em] text-brand"><Sparkles className="h-3.5 w-3.5" />{tr('Guide interactif', 'Interactive guide', 'دليل تفاعلي')}</p>
        <h1 className="font-display text-2xl font-semibold md:text-3xl">{tr('Comment pouvons-nous vous aider ?', 'How can we help you?', 'كيف يمكننا مساعدتك؟')}</h1>
        <p className="mb-5 mt-1 text-sm text-white/70">{tr('Chaque réponse vous montre l’écran, et ce qu’il faut toucher.', 'Every answer shows you the screen, and what to tap.', 'كل إجابة تُريك الشاشة وما يجب الضغط عليه.')}</p>
        <div className="relative">
          <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
          <input ref={input} className="w-full rounded-2xl border border-transparent bg-surface py-3.5 pe-12 ps-12 text-base text-ink outline-none transition placeholder:text-muted/70 focus:ring-4 focus:ring-brand/30"
            placeholder={tr('Rechercher : remise, QR code, imprimante…', 'Search: discount, QR code, printer…', 'ابحث: خصم، رمز QR، طابعة…')} value={q}
            onChange={e => { setQ(e.target.value); setChapter(null); }} onKeyDown={e => { if (e.key === 'Escape') setQ(''); }} aria-label={tr('Rechercher', 'Search', 'بحث')} />
          {q && <button onClick={() => setQ('')} aria-label={tr('Effacer', 'Clear', 'مسح')} className="absolute end-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted hover:bg-surface-2"><X className="h-4 w-4" /></button>}
        </div>
        {!q && popular.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {popular.map(a => <button key={a.id} onClick={() => go(a.id)} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/90 transition hover:bg-white/20">{a.icon} {a.title[L]}</button>)}
          </div>
        )}
      </div>

      {words.length > 0 ? (
        results.length ? (
          <>
            <p className="mb-2 text-sm font-semibold text-muted">{results.length} {tr('résultat(s)', 'result(s)', 'نتيجة')}</p>
            <ul className="card divide-y divide-line/10 overflow-hidden rounded-3xl">{results.map(a => <li key={a.id}><Row a={a} /></li>)}</ul>
          </>
        ) : (
          <div className="card rounded-3xl px-4 py-10 text-center text-muted">
            <p className="mb-1 text-3xl">🔎</p>
            {tr('Aucun résultat. Essayez un autre mot, ou écrivez-nous sur WhatsApp.', 'No result. Try another word, or write to us on WhatsApp.', 'لا نتائج. جرّب كلمة أخرى أو راسلنا عبر واتساب.')}
          </div>
        )
      ) : chapterOpen ? (
        <div>
          <button onClick={() => setChapter(null)} className="mb-3 flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink"><ChevronLeft className="h-4 w-4 rtl:rotate-180" />{tr('Tous les chapitres', 'All chapters', 'كل الفصول')}</button>
          <h2 className="mb-1 font-display text-xl font-semibold">{chapterOpen.icon} {chapterOpen.title[L]}</h2>
          <p className="mb-3 text-sm text-muted">{chapterOpen.blurb[L]}</p>
          <ul className="card divide-y divide-line/10 overflow-hidden rounded-3xl">{available.filter(a => a.chapter === chapterOpen.id).map(a => <li key={a.id}><Row a={a} /></li>)}</ul>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {chapters.map(c => {
            const n = available.filter(a => a.chapter === c.id).length;
            return (
              <button key={c.id} onClick={() => setChapter(c.id)} className="card group rounded-3xl p-5 text-start transition hover:-translate-y-0.5">
                <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-2xl">{c.icon}</span>
                <p className="font-display text-lg font-semibold">{c.title[L]}</p>
                <p className="mt-1 text-sm text-muted">{c.blurb[L]}</p>
                <p className="mt-3 flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-brand">{n} {tr('guides interactifs', 'interactive guides', 'دليلًا تفاعليًا')}<ChevronRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 rtl:rotate-180" /></p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
