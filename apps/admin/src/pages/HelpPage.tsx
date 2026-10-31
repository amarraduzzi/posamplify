import { useMemo, useState, type ReactNode } from 'react';
import { Search, ChevronLeft, Lightbulb, TriangleAlert, X, MousePointerClick } from 'lucide-react';
import type { Restaurant } from '../lib/types';
import { t } from '../lib/i18n';
import { ARTICLES, CHAPTERS, type Article, type Block, type TourStep } from '../lib/helpContent';

/** lowercase, no accents, so « caisse », « Caisse » and « cáisse » all match */
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function blockText(b: Block): string {
  if (b.t === 'img') return b.alt + ' ' + (b.caption ?? '');
  return b.t === 'steps' || b.t === 'ul' ? b.items.join(' ') : b.text;
}

function searchable(a: Article) {
  return { title: norm(a.title), kw: norm(a.keywords.join(' ')), body: norm(a.summary + ' ' + a.blocks.map(blockText).join(' ')) };
}

/** every word must be found; the title weighs most, then keywords, then the body */
function score(a: Article, words: string[]): number {
  const s = searchable(a);
  let total = 0;
  for (const w of words) {
    const v = (s.title.includes(w) ? 6 : 0) + (s.kw.includes(w) ? 3 : 0) + (s.body.includes(w) ? 1 : 0);
    if (!v) return 0;
    total += v;
  }
  return total;
}

function Mark({ text, words }: { text: string; words: string[] }): ReactNode {
  if (!words.length) return text;
  const n = norm(text);
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

function Blocks({ blocks, words }: { blocks: Block[]; words: string[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((b, i) => {
        if (b.t === 'p') return <p key={i} className="leading-relaxed"><Mark text={b.text} words={words} /></p>;
        if (b.t === 'ul') return <ul key={i} className="list-disc space-y-1.5 ps-5 leading-relaxed">{b.items.map((x, k) => <li key={k}><Mark text={x} words={words} /></li>)}</ul>;
        if (b.t === 'steps') return (
          <ol key={i} className="space-y-2.5">
            {b.items.map((x, k) => (
              <li key={k} className="flex gap-3 leading-relaxed">
                <span className="gold-fill mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold text-brand-ink">{k + 1}</span>
                <span><Mark text={x} words={words} /></span>
              </li>
            ))}
          </ol>
        );
        if (b.t === 'img') return (
          <figure key={i}>
            <img src={b.src} alt={b.alt} loading="lazy" className="w-full rounded-2xl border border-line/10" />
            {b.caption && <figcaption className="mt-2 text-center text-sm text-muted">{b.caption}</figcaption>}
          </figure>
        );
        const warn = b.t === 'warn';
        return (
          <div key={i} className={`flex gap-3 rounded-2xl px-4 py-3 text-sm font-semibold leading-relaxed ${warn ? 'bg-warn/10 text-warn' : 'bg-brand/10 text-ink'}`}>
            {warn ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-brand" />}
            <span><Mark text={b.text} words={words} /></span>
          </div>
        );
      })}
    </div>
  );
}

/** Guide intégré : recherche instantanée, chapitres, articles. Le contenu vit dans lib/helpContent.ts. */
export function HelpPage({ r, onTour }: { r: Restaurant; onTour: (steps: TourStep[]) => void }) {
  const [q, setQ] = useState('');
  const [chapter, setChapter] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const products: string[] = r.products ?? ['pos', 'profit'];
  const available = useMemo(() => ARTICLES.filter(a => !a.products || a.products.some(p => products.includes(p))), [products.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = useMemo(() => norm(q).split(/\s+/).filter(w => w.length > 1), [q]);
  const results = useMemo(
    () => words.length ? available.map(a => ({ a, s: score(a, words) })).filter(x => x.s > 0).sort((x, y) => y.s - x.s).map(x => x.a) : [],
    [available, words],
  );
  const article = open ? available.find(a => a.id === open) : null;
  const chapters = CHAPTERS.filter(c => available.some(a => a.chapter === c.id));
  const shown = chapter ? available.filter(a => a.chapter === chapter) : [];

  const go = (id: string) => { setOpen(id); window.scrollTo?.({ top: 0 }); };

  if (article) {
    const ch = CHAPTERS.find(c => c.id === article.chapter);
    const siblings = available.filter(a => a.chapter === article.chapter && a.id !== article.id);
    return (
      <div className="mx-auto max-w-3xl">
        <button onClick={() => setOpen(null)} className="mb-4 flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink"><ChevronLeft className="h-4 w-4 rtl:rotate-180" /> {t('Retour au guide')}</button>
        {ch && <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-brand">{ch.title}</p>}
        <h1 className="mb-6 font-display text-3xl font-semibold">{article.title}</h1>
        {article.tour && (
          <button onClick={() => onTour(article.tour!)} className="gold-fill mb-5 flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 font-bold text-brand-ink shadow-sm transition hover:brightness-105 sm:w-auto">
            <MousePointerClick className="h-5 w-5" /> {t('Me le montrer dans l’application')}
          </button>
        )}
        <div className="card rounded-3xl p-5 md:p-7"><Blocks blocks={article.blocks} words={words} /></div>
        {siblings.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-3 font-display text-lg font-semibold">{t('Dans le même chapitre')}</h2>
            <ul className="divide-y divide-line/10 overflow-hidden card rounded-3xl">
              {siblings.map(a => <li key={a.id}><button onClick={() => go(a.id)} className="w-full px-4 py-3 text-start font-semibold hover:bg-surface-2">{a.title}</button></li>)}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 font-display text-3xl font-semibold">{t('Aide')}</h1>
      <p className="mb-5 text-sm text-muted">{t('Le guide complet de votre espace. Tapez un mot pour trouver la réponse.')}</p>
      <div className="relative mb-6">
        <Search className="pointer-events-none absolute start-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
        <input className="w-full rounded-2xl border border-line/[0.12] bg-surface py-3 pe-11 ps-11 text-base outline-none transition placeholder:text-muted/60 focus:border-brand focus:ring-4 focus:ring-brand/15"
          placeholder={t('Rechercher : remise, code, imprimante…')} value={q} onChange={e => { setQ(e.target.value); setChapter(null); }} aria-label={t('Rechercher')} />
        {q && <button onClick={() => setQ('')} aria-label={t('Effacer')} className="absolute end-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted hover:bg-surface-2"><X className="h-4 w-4" /></button>}
      </div>

      {words.length > 0 ? (
        results.length ? (
          <ul className="divide-y divide-line/10 overflow-hidden card rounded-3xl">
            {results.map(a => (
              <li key={a.id}>
                <button onClick={() => go(a.id)} className="w-full px-4 py-3.5 text-start hover:bg-surface-2">
                  <p className="font-semibold"><Mark text={a.title} words={words} /></p>
                  <p className="mt-0.5 text-sm text-muted"><Mark text={a.summary} words={words} /></p>
                  <p className="mt-1 text-xs font-bold uppercase tracking-wider text-brand">{CHAPTERS.find(c => c.id === a.chapter)?.title}</p>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="card rounded-3xl px-4 py-10 text-center text-muted">{t('Aucun résultat. Essayez un autre mot, ou écrivez-nous sur WhatsApp.')}</p>
      ) : chapter ? (
        <div>
          <button onClick={() => setChapter(null)} className="mb-3 flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink"><ChevronLeft className="h-4 w-4 rtl:rotate-180" /> {t('Tous les chapitres')}</button>
          <ul className="divide-y divide-line/10 overflow-hidden card rounded-3xl">
            {shown.map(a => <li key={a.id}><button onClick={() => go(a.id)} className="w-full px-4 py-3.5 text-start hover:bg-surface-2"><p className="font-semibold">{a.title}</p><p className="mt-0.5 text-sm text-muted">{a.summary}</p></button></li>)}
          </ul>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {chapters.map((c, i) => (
            <button key={c.id} onClick={() => setChapter(c.id)} className="card rounded-3xl p-5 text-start transition hover:-translate-y-0.5">
              <span className="gold-fill mb-3 grid h-8 w-8 place-items-center rounded-full text-sm font-bold text-brand-ink">{i + 1}</span>
              <p className="font-display text-lg font-semibold">{c.title}</p>
              <p className="mt-1 text-sm text-muted">{c.blurb}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
