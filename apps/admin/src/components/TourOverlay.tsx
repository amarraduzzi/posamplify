import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { t } from '../lib/i18n';
import type { TourStep } from '../lib/helpContent';

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const SEL = 'button, a, [role="button"], label, h1, h2, h3, summary, input, select, textarea';

/** finds the visible element whose text (or placeholder / aria-label) best matches the step's target */
function findTarget(step: TourStep): HTMLElement | null {
  if (!step.target) return null;
  const want = norm(t(step.target));
  const root = step.nav ? document.querySelector('aside nav') : document.querySelector('main');
  if (!root) return null;
  let best: HTMLElement | null = null, bestScore = 0, bestArea = Infinity;
  root.querySelectorAll<HTMLElement>(SEL).forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    const raw = (isField ? el.placeholder : el.textContent) || el.getAttribute('aria-label') || '';
    const txt = norm(raw);
    if (!txt) return;
    const score = txt === want ? 3 : txt.startsWith(want) ? 2 : txt.includes(want) && txt.length < want.length * 2 + 12 ? 1 : 0;
    if (!score) return;
    const area = r.width * r.height;
    if (score > bestScore || (score === bestScore && area < bestArea)) { best = el; bestScore = score; bestArea = area; }
  });
  return best;
}

/** Guided tour: dims the screen, rings the real button, and explains it. The highlighted element stays clickable. */
export function TourOverlay({ steps, index, onIndex, onClose }: { steps: TourStep[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const step = steps[index];
  const [rect, setRect] = useState<DOMRect | null>(null);
  const scrolled = useRef<number>(-1);

  useEffect(() => {
    scrolled.current = -1;
    setRect(null);
    const look = () => {
      const el = findTarget(step);
      if (!el) { setRect(null); return; }
      if (scrolled.current !== index) { scrolled.current = index; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      const r = el.getBoundingClientRect();
      setRect(prev => prev && Math.abs(prev.top - r.top) < 1 && Math.abs(prev.left - r.left) < 1 && Math.abs(prev.width - r.width) < 1 ? prev : r);
    };
    // the page behind may still be loading: look often
    const id = window.setInterval(look, 200);
    look();
    return () => window.clearInterval(id);
  }, [step, index]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const W = Math.min(340, window.innerWidth - 24);
  const pad = 6;
  let box: CSSProperties;
  if (rect) {
    const below = rect.bottom + 16 + 190 < window.innerHeight;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - W - 12));
    box = below ? { top: rect.bottom + pad + 12, left, width: W } : { top: Math.max(12, rect.top - pad - 12), left, width: W, transform: 'translateY(-100%)' };
  } else {
    box = { top: '50%', left: '50%', width: W, transform: 'translate(-50%, -50%)' };
  }
  const last = index === steps.length - 1;

  return (
    <div className="no-print pointer-events-none fixed inset-0 z-[100]" role="dialog" aria-label={t('Visite guidée')}>
      <style>{'@keyframes tourPulse{0%{box-shadow:0 0 0 9999px rgba(8,18,32,.62),0 0 0 3px #E8B54A,0 0 0 3px rgba(232,181,74,.9)}70%{box-shadow:0 0 0 9999px rgba(8,18,32,.62),0 0 0 3px #E8B54A,0 0 0 14px rgba(232,181,74,0)}100%{box-shadow:0 0 0 9999px rgba(8,18,32,.62),0 0 0 3px #E8B54A,0 0 0 3px rgba(232,181,74,0)}}'}</style>
      {rect
        ? <div className="fixed rounded-2xl transition-all duration-300" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, animation: 'tourPulse 1.6s ease-out infinite' }} />
        : <div className="fixed inset-0" style={{ background: 'rgba(8,18,32,.62)' }} />}
      <div className="pointer-events-auto fixed rounded-3xl bg-surface p-4 shadow-2xl ring-1 ring-line/10" style={box}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-brand">{t('Étape {i} sur {n}', { i: index + 1, n: steps.length })}</span>
          <button onClick={onClose} aria-label={t('Fermer')} className="rounded-full p-1 text-muted hover:bg-surface-2"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-4 text-[15px] font-semibold leading-snug">{step.text}</p>
        <div className="flex items-center justify-between gap-2">
          <button disabled={index === 0} onClick={() => onIndex(index - 1)} className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold text-muted hover:bg-surface-2 disabled:opacity-30"><ChevronLeft className="h-4 w-4 rtl:rotate-180" />{t('Précédent')}</button>
          <button onClick={() => (last ? onClose() : onIndex(index + 1))} className="gold-fill flex items-center gap-1 rounded-xl px-4 py-2 text-sm font-bold text-brand-ink">{last ? t('Terminé') : t('Suivant')}{!last && <ChevronRight className="h-4 w-4 rtl:rotate-180" />}</button>
        </div>
      </div>
    </div>
  );
}
