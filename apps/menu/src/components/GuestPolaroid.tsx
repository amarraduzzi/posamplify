import { useEffect, useRef, useState } from 'react';
import { Camera, Gift, Image as ImageIcon, Share2, Download, Check } from 'lucide-react';
import type { Strings } from '../lib/strings';
import { Sheet } from './Sheet';
import { drawPolaroid, loadFonts, loadLogo, loadPhoto, pngBlob, H, W } from '../lib/polaroid';

export interface ShareConfig { handle?: string; reward?: string; primary: string; logoUrl?: string }

/** The guest photographs their dish; the app turns it into a Polaroid story to share on Instagram. An optional gift (set by the owner) is handed over by the waiter. */
export function GuestPolaroid({ open, onClose, t, lang, restaurant, orderId, ticket, cfg }: {
  open: boolean; onClose: () => void; t: Strings; lang: string; restaurant: string; orderId: string; ticket: number; cfg: ShareConfig;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [photo, setPhoto] = useState<Awaited<ReturnType<typeof loadPhoto>> | null>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [caption, setCaption] = useState(t.shareDefault(restaurant));
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const giftKey = `gp-gift:${orderId}`;
  const [used, setUsed] = useState(() => { try { return localStorage.getItem(giftKey) === '1'; } catch { return false; } });
  const dateText = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-MA-u-nu-latn' : lang, { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date());
  const input = () => ({ photo: photo!, caption: caption.trim() || t.shareDefault(restaurant), restaurant, handle: cfg.handle, logo, primary: cfg.primary, dateText, rtl: lang === 'ar' });

  useEffect(() => { loadLogo(cfg.logoUrl).then(setLogo); }, [cfg.logoUrl]);
  useEffect(() => { if (open && photo && canvas.current) loadFonts().then(() => canvas.current && drawPolaroid(canvas.current, input(), 0.4)); }, [open, photo, caption, logo]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    setErr(false); setShared(false);
    try { setPhoto(await loadPhoto(f)); } catch { setErr(true); }
  }
  async function build(): Promise<Blob> { await loadFonts(); const c = document.createElement('canvas'); drawPolaroid(c, input(), 1); return pngBlob(c); }
  async function share() {
    if (!photo) return; setBusy(true);
    try {
      const blob = await build(), file = new File([blob], `${restaurant.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-polaroid.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
      else save(blob, file.name);
      setShared(true);
    } catch { /* cancelled */ } finally { setBusy(false); }
  }
  async function saveOnly() { if (!photo) return; setBusy(true); try { save(await build(), 'polaroid.png'); setShared(true); } catch { setErr(true); } finally { setBusy(false); } }
  function save(blob: Blob, name: string) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  const markUsed = () => { try { localStorage.setItem(giftKey, '1'); } catch { /* private mode */ } setUsed(true); };

  return (
    <Sheet open={open} onClose={onClose} title={t.shareCta} closeLabel={t.close}>
      <div className="px-5 pb-6 space-y-4">
        <p className="text-sm text-muted">{t.shareHint}</p>
        {!photo ? (
          <div className="grid gap-3">
            <label className="press flex h-14 cursor-pointer items-center justify-center gap-2 rounded-full bg-brand font-semibold text-brand-ink glow-brand">
              <Camera className="size-5" />{t.shareTake}<input type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
            </label>
            <label className="press flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full card font-semibold">
              <ImageIcon className="size-5 text-brand" />{t.shareGallery}<input type="file" accept="image/*" className="hidden" onChange={pick} />
            </label>
          </div>
        ) : (
          <>
            <canvas ref={canvas} style={{ aspectRatio: `${W}/${H}` }} className="mx-auto w-full max-w-[230px] rounded-2xl shadow-xl" />
            <input value={caption} maxLength={40} onChange={e => setCaption(e.target.value)} aria-label={t.shareCaption} placeholder={t.shareCaption}
              className="h-12 w-full rounded-2xl border border-line bg-bg px-4 text-center font-display text-lg" />
            <button onClick={share} disabled={busy} className="press flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand font-semibold text-brand-ink glow-brand disabled:opacity-60">
              <Share2 className="size-5" />{t.shareGo}
            </button>
            <div className="flex items-center justify-center gap-5 text-sm font-semibold">
              <button onClick={saveOnly} disabled={busy} className="flex items-center gap-1.5 text-brand"><Download className="size-4" />{t.shareSave}</button>
              <label className="flex cursor-pointer items-center gap-1.5 text-brand"><Camera className="size-4" />{t.shareAgain}<input type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} /></label>
            </div>
            {cfg.handle && <p className="text-center text-xs text-muted">{t.shareTag(cfg.handle.replace(/^@/, ''))}</p>}
          </>
        )}
        {err && <p className="text-center text-sm text-danger">{t.shareError}</p>}
        {shared && cfg.reward && (
          <div className="rounded-3xl bg-brand/12 p-4 text-center animate-rise">
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
      </div>
    </Sheet>
  );
}
