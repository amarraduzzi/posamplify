import { useEffect, useRef, useState } from 'react';
import { Gift, Check, Share2, Download, Shuffle } from 'lucide-react';
import type { Strings } from '../lib/strings';
import { PHRASES, drawStory, loadFonts, loadImage, pngBlob, H, W } from '../lib/story';

export interface ShareConfig { handle?: string; reward?: string; primary: string; logoUrl?: string }
export interface ShareDish { name: string; image: string }

/**
 * A ready-made, funny "J'étais là" story for the dish the guest just ordered. Nothing to do for the guest:
 * the picture is already visible in the banner, one tap posts it. "Une autre blague" rolls a new line and dish.
 * An optional gift (set by the owner) is handed over by the waiter once the story was shared.
 */
export function GuestStory({ t, lang, restaurant, orderId, ticket, cfg, dishes }: {
  t: Strings; lang: string; restaurant: string; orderId: string; ticket: number; cfg: ShareConfig; dishes: ShareDish[];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cache = useRef(new Map<string, HTMLImageElement | null>());
  const start = useRef(Math.floor(Math.random() * PHRASES.length));
  const [roll, setRoll] = useState(0);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const giftKey = `gp-gift:${orderId}`;
  const [used, setUsed] = useState(() => { try { return localStorage.getItem(giftKey) === '1'; } catch { return false; } });

  const dish = dishes.length ? dishes[roll % dishes.length] : null;
  const phrase = PHRASES[(start.current + roll * 5) % PHRASES.length];
  const dateText = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-MA-u-nu-latn' : lang, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());

  async function photoOf(d: ShareDish | null) {
    if (!d) return null;
    if (!cache.current.has(d.image)) cache.current.set(d.image, await loadImage(d.image));
    return cache.current.get(d.image) ?? null;
  }
  const input = (photo: HTMLImageElement | null) => ({ photo, dishName: dish?.name ?? restaurant, phrase, restaurant, handle: cfg.handle, logo, primary: cfg.primary, dateText, seed: start.current * 97 + roll * 13 + 5 });

  useEffect(() => { loadImage(cfg.logoUrl).then(setLogo); }, [cfg.logoUrl]);
  useEffect(() => {
    let off = false;
    (async () => { await loadFonts(); const p = await photoOf(dish); if (!off && canvas.current) drawStory(canvas.current, input(p), 0.3); })();
    return () => { off = true; };
  }, [roll, logo]); // eslint-disable-line react-hooks/exhaustive-deps

  async function build(): Promise<Blob> {
    await loadFonts(); const c = document.createElement('canvas');
    drawStory(c, input(await photoOf(dish)), 1); return pngBlob(c);
  }
  const fileName = `${restaurant.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-jetais-la.png`;
  function save(blob: Blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  async function post() {
    setBusy(true); setErr(false);
    try {
      const blob = await build(), file = new File([blob], fileName, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
      else save(blob);
      setShared(true);
    } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setErr(true); } finally { setBusy(false); }
  }
  async function saveOnly() { setBusy(true); setErr(false); try { save(await build()); setShared(true); } catch { setErr(true); } finally { setBusy(false); } }
  const markUsed = () => { try { localStorage.setItem(giftKey, '1'); } catch { /* private mode */ } setUsed(true); };

  return (
    <section className="story-banner relative overflow-hidden rounded-[2rem] bg-brand p-4 text-brand-ink glow-brand animate-pop" aria-label={t.shareCta}>
      <span className="story-shine" aria-hidden />
      <div className="relative flex items-center gap-4">
        <canvas ref={canvas} style={{ aspectRatio: `${W}/${H}` }} className="story-wobble w-[34%] max-w-[132px] shrink-0 rounded-xl bg-white/20 shadow-2xl ring-4 ring-white" />
        <div className="min-w-0 flex-1 text-start">
          <p className="font-display text-2xl font-semibold leading-tight">{t.shareCta}</p>
          <p className="mt-1 text-sm opacity-90">{t.shareHint}</p>
        </div>
      </div>
      <button onClick={post} disabled={busy} className="press relative mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-white text-lg font-bold text-ink shadow-xl disabled:opacity-60">
        <Share2 className="size-5" />{t.shareGo}
      </button>
      <div className="relative mt-3 flex items-center justify-center gap-5 text-sm font-semibold">
        <button onClick={() => { setRoll(r => r + 1); setShared(false); }} className="flex items-center gap-1.5 underline-offset-4 hover:underline"><Shuffle className="size-4" />{t.shareAnother}</button>
        <button onClick={saveOnly} disabled={busy} className="flex items-center gap-1.5 underline-offset-4 hover:underline"><Download className="size-4" />{t.shareSave}</button>
      </div>
      {cfg.handle && <p className="relative mt-2 text-center text-xs opacity-85">{t.shareTag(cfg.handle.replace(/^@/, ''))}</p>}
      {err && <p className="relative mt-2 text-center text-sm font-semibold">{t.shareError}</p>}
      {shared && cfg.reward && (
        <div className="relative mt-4 rounded-3xl bg-white p-4 text-center text-ink animate-rise">
          <Gift className="mx-auto size-7 text-brand" />
          {used ? <p className="mt-1 font-semibold">{t.shareGiftUsed}</p> : (
            <>
              <p className="mt-1 text-xs text-muted">{t.shareGiftHint}</p>
              <p className="mt-1 font-display text-xl font-semibold"><bdi>{cfg.reward}</bdi></p>
              <p dir="ltr" className="mt-1 text-xs text-muted">{t.ticket} #{ticket}</p>
              <button onClick={markUsed} className="press mt-3 inline-flex h-10 items-center gap-1.5 rounded-full card px-4 text-sm font-semibold"><Check className="size-4 text-brand" />{t.shareGiftGiven}</button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
