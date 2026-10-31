import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play, Pause, RotateCcw, MousePointer2, ZoomIn, ZoomOut } from 'lucide-react';
import { getLang } from '../../lib/i18n';
import type { HelpStep } from '../../lib/helpContent';
import { tr } from './kit';
import { ADMIN_SCREENS } from './screensAdmin';
import { TILL_SCREENS } from './screensTill';
import { GUEST_SCREENS } from './screensGuest';
import { REPORT_SCREENS } from './screensReports';

const SCREENS = { ...ADMIN_SCREENS, ...TILL_SCREENS, ...GUEST_SCREENS, ...REPORT_SCREENS };
const PULSE = '@keyframes helpPulse{0%{box-shadow:0 0 0 9999px rgba(8,18,32,.58),0 0 0 3px #26D07D,0 0 0 3px rgba(38,208,125,.9)}70%{box-shadow:0 0 0 9999px rgba(8,18,32,.58),0 0 0 3px #26D07D,0 0 0 16px rgba(38,208,125,0)}100%{box-shadow:0 0 0 9999px rgba(8,18,32,.58),0 0 0 3px #26D07D,0 0 0 3px rgba(38,208,125,0)}}';

/** An interactive replica of the screen: the part to use is ringed; clicking the ring (or « Next ») moves on. */
export function Demo({ steps }: { steps: HelpStep[] }) {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [cw, setCw] = useState(640);
  const [ring, setRing] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const outer = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const lang = getLang();
  const n = steps.length;
  const step = steps[Math.min(i, n - 1)];
  const sc = SCREENS[step.s];
  const fit = Math.min(1.05, cw / sc.w);
  const scale = zoom ? Math.max(fit, 0.95) : fit;
  const last = i >= n - 1;

  useEffect(() => { setI(0); setAuto(false); setZoom(false); }, [steps]);
  useEffect(() => {
    const el = outer.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setCw(Math.max(200, e.contentRect.width - 24)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!auto) return;
    const id = window.setTimeout(() => { if (i < n - 1) setI(i + 1); else setAuto(false); }, 4000);
    return () => window.clearTimeout(id);
  }, [auto, i, n]);

  const measure = useCallback(() => {
    const root = inner.current; if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-h="${step.f}"]`);
    if (!el) { setRing(null); return; }
    const a = el.getBoundingClientRect(), b = root.getBoundingClientRect();
    const k = b.width / sc.w || 1;
    setRing({ x: (a.left - b.left) / k, y: (a.top - b.top) / k, w: a.width / k, h: a.height / k });
  }, [step, sc.w]);
  useLayoutEffect(() => { measure(); const id = window.setTimeout(measure, 90); return () => window.clearTimeout(id); }, [measure, scale, lang]);
  useEffect(() => {
    if (!zoom || !ring || !scroller.current) return;
    scroller.current.scrollTo({ left: (ring.x + ring.w / 2) * scale - scroller.current.clientWidth / 2, behavior: 'smooth' });
  }, [zoom, ring, scale]);

  const next = () => (last ? setI(0) : setI(i + 1));
  const txt = (s: HelpStep) => tr(s.x[0], s.x[1], s.x[2]);
  const ib = 'grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-surface-2';

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_270px]">
      <div>
        <div ref={outer} className="rounded-3xl bg-gradient-to-br from-surface-2 to-surface-3 p-3">
          <style>{PULSE}</style>
          <div ref={scroller} className={zoom ? 'overflow-x-auto pb-2' : ''} dir="ltr">
            <div className="relative mx-auto" style={{ width: sc.w * scale, height: sc.h * scale }}>
              <div key={step.s} ref={inner} dir={lang === 'ar' ? 'rtl' : 'ltr'} className="pointer-events-none absolute left-0 top-0 select-none overflow-hidden"
                style={{ width: sc.w, height: sc.h, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
                {sc.render()}
                {ring && (
                  <button type="button" onClick={next} aria-label={txt(step)} className="pointer-events-auto absolute z-20 rounded-xl transition-all duration-300"
                    style={{ left: ring.x - 6, top: ring.y - 6, width: ring.w + 12, height: ring.h + 12, animation: 'helpPulse 1.6s ease-out infinite', cursor: 'pointer' }}>
                    <MousePointer2 className="absolute -bottom-4 -right-3 h-7 w-7 animate-bounce fill-white text-ink drop-shadow-lg" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="card mt-3 rounded-3xl p-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-brand">{tr('Étape', 'Step', 'الخطوة')} {i + 1} / {n}</span>
            <div className="flex gap-0.5">
              {fit < 0.8 && <button onClick={() => setZoom(z => !z)} className={ib} aria-label={tr('Agrandir', 'Zoom', 'تكبير')}>{zoom ? <ZoomOut className="h-4 w-4" /> : <ZoomIn className="h-4 w-4" />}</button>}
              <button onClick={() => setAuto(a => !a)} className={ib} aria-label={tr('Lecture automatique', 'Auto-play', 'تشغيل تلقائي')}>{auto ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
            </div>
          </div>
          <p className="min-h-[3.2rem] text-[15px] font-semibold leading-relaxed">{txt(step)}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button disabled={i === 0} onClick={() => setI(i - 1)} className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold text-muted hover:bg-surface-2 disabled:opacity-30"><ChevronLeft className="h-4 w-4 rtl:rotate-180" />{tr('Précédent', 'Previous', 'السابق')}</button>
            <div className="flex gap-1.5">{steps.map((_, k) => <button key={k} onClick={() => setI(k)} aria-label={String(k + 1)} className={`h-2 rounded-full transition-all ${k === i ? 'w-6 bg-brand' : 'w-2 bg-line/20'}`} />)}</div>
            <button onClick={next} className="gold-fill flex items-center gap-1 rounded-xl px-4 py-2 text-sm font-bold text-brand-ink">
              {last ? <><RotateCcw className="h-4 w-4" />{tr('Rejouer', 'Replay', 'إعادة')}</> : <>{tr('Suivant', 'Next', 'التالي')}<ChevronRight className="h-4 w-4 rtl:rotate-180" /></>}
            </button>
          </div>
        </div>
      </div>

      <ol className="space-y-1.5 self-start">
        {steps.map((s, k) => (
          <li key={k}>
            <button onClick={() => setI(k)} className={`flex w-full gap-2.5 rounded-2xl p-2.5 text-start text-sm leading-snug transition ${k === i ? 'bg-brand/10 font-semibold' : 'text-muted hover:bg-surface-2'}`}>
              <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${k === i ? 'gold-fill text-brand-ink' : 'bg-surface-3'}`}>{k + 1}</span>
              <span>{txt(s)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
