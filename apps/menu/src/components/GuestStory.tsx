import { useEffect, useRef, useState } from 'react';
import { Gift, Check, Share2, Download, Shuffle, Copy, Ticket } from 'lucide-react';
import { formatMoney, type GuestAction } from '@resto/shared';
import type { Strings } from '../lib/strings';
import { PHRASES, drawStory, loadFonts, loadImage, pngBlob, H, W } from '../lib/story';
import { issueVoucher, type GuestVoucher } from '../lib/api';
import { rememberVoucher } from '../lib/vouchers';
import { load, save } from '../lib/storage';

export interface ShareConfig { handle?: string; primary: string; logoUrl?: string; actions: GuestAction[]; slug: string; currency: string }
export interface ShareDish { name: string; image: string }

const locale = (lang: string) => (lang === 'ar' ? 'ar-MA-u-nu-latn' : lang);

/**
 * A ready-made, funny "J'étais là" story for the dish the guest just ordered. Nothing to do for the guest:
 * the picture is already visible in the banner, one tap posts it. "Une autre blague" rolls a new line and dish.
 * What the guest gets for sharing is the owner's choice (nothing, a gift from the waiter, or a personal code
 * for the next visit); with no action switched on the story is simply shared.
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
  const voucherKey = `voucher:${orderId}`;
  const [used, setUsed] = useState(() => { try { return localStorage.getItem(giftKey) === '1'; } catch { return false; } });

  const actions = cfg.actions.filter(a => a.on);
  const [chosen, setChosen] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<GuestVoucher | null>(() => load<GuestVoucher>(voucherKey, 60 * 86400_000));
  const [vState, setVState] = useState<'idle' | 'loading' | 'full' | 'error'>('idle');
  const [copied, setCopied] = useState(false);

  const money = (cents: number) => formatMoney(cents, cfg.currency, lang);
  const offerOf = (a: GuestAction) =>
    a.type === 'gift' ? t.offerGift(a.name)
    : a.type === 'percent' ? t.offerPercent(a.value ?? 0)
    : t.offerAmount(money(Math.round((a.value ?? 0) * 100)));
  const voucherOffer = (v: GuestVoucher) => (v.discount_type === 'percent' ? t.offerPercent(Number(v.value) / 100) : t.offerAmount(money(Number(v.value))));
  const day = (d: string) => new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short' }).format(new Date(`${d}T12:00:00`));

  // the action the guest gets: the only one, or the one he picked
  const picked = actions.length === 1 ? actions[0] : actions.find(a => a.id === chosen) ?? null;
  const teaser = voucher ? t.voucherSavedTitle : actions.length === 1 ? offerOf(actions[0]) : actions.length > 1 ? t.offerSeveral : null;

  const dish = dishes.length ? dishes[roll % dishes.length] : null;
  const phrase = PHRASES[(start.current + roll * 5) % PHRASES.length];
  const dateText = new Intl.DateTimeFormat(locale(lang), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());

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

  // a code for the next visit is made once the story was shared (one per order: asking again returns the same code)
  async function getVoucher(a: GuestAction) {
    setVState('loading');
    try {
      const r = await issueVoucher(orderId, a.id);
      if (r.status === 'ok') { setVoucher(r.voucher); save(voucherKey, r.voucher); rememberVoucher(cfg.slug, r.voucher); setVState('idle'); }
      else setVState(r.status === 'full' ? 'full' : 'error');
    } catch { setVState('error'); }
  }
  useEffect(() => {
    if (shared && picked && picked.when === 'next' && !voucher && vState === 'idle') void getVoucher(picked);
  }, [shared, picked?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function build(): Promise<Blob> {
    await loadFonts(); const c = document.createElement('canvas');
    drawStory(c, input(await photoOf(dish)), 1); return pngBlob(c);
  }
  const fileName = `${restaurant.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-jetais-la.png`;
  function saveFile(blob: Blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  async function post() {
    setBusy(true); setErr(false);
    try {
      const blob = await build(), file = new File([blob], fileName, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
      else saveFile(blob);
      setShared(true);
    } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setErr(true); } finally { setBusy(false); }
  }
  async function saveOnly() { setBusy(true); setErr(false); try { saveFile(await build()); setShared(true); } catch { setErr(true); } finally { setBusy(false); } }
  const markUsed = () => { try { localStorage.setItem(giftKey, '1'); } catch { /* private mode */ } setUsed(true); };
  async function copy(code: string) { try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the code is on screen anyway */ } }

  const dayNames = (v: GuestVoucher) => (v.days.length >= 7 ? '' : v.days.map(n => new Intl.DateTimeFormat(locale(lang), { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, n)))).join(', '));
  const when = (v: GuestVoucher) => [dayNames(v), v.start_time && v.end_time ? `${v.start_time.slice(0, 5)}–${v.end_time.slice(0, 5)}` : ''].filter(Boolean).join(' · ');

  const showReward = actions.length > 0 && (shared || voucher);
  return (
    <section className="story-banner relative overflow-hidden rounded-[2rem] bg-brand p-4 text-brand-ink glow-brand animate-pop" aria-label={t.shareCta}>
      <span className="story-shine" aria-hidden />
      <div className="relative text-center">
        {teaser ? (
          <>
            <p className="text-[11px] font-bold uppercase tracking-[0.25em] opacity-90">{t.shareCta}</p>
            <p className="mt-1.5 font-display text-[1.75rem] font-semibold leading-tight"><bdi>{teaser}</bdi></p>
          </>
        ) : (
          <>
            <p className="font-display text-2xl font-semibold leading-tight">{t.shareCta}</p>
            <p className="mt-1 text-sm opacity-90">{t.shareHint}</p>
          </>
        )}
      </div>
      <canvas ref={canvas} style={{ aspectRatio: `${W}/${H}` }} className="story-wobble relative mx-auto mt-4 block w-[60%] max-w-[240px] rounded-2xl bg-white/20 shadow-2xl ring-4 ring-white" />
      {teaser && !showReward && (
        <ol className="relative mx-auto mt-4 w-fit max-w-full space-y-1.5 text-start text-sm font-semibold">
          <li className="flex items-center gap-2.5"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-white text-xs font-bold text-ink">1</span>{t.stepPost}</li>
          <li className="flex items-center gap-2.5"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-white text-xs font-bold text-ink">2</span>{t.stepReward}</li>
        </ol>
      )}
      <button onClick={post} disabled={busy} className="press relative mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-white text-lg font-bold text-ink shadow-xl disabled:opacity-60">
        <Share2 className="size-5" />{t.shareGo}
      </button>
      <div className="relative mt-3 flex items-center justify-center gap-5 text-xs font-semibold opacity-90">
        <button onClick={() => setRoll(r => r + 1)} className="flex items-center gap-1.5 underline-offset-4 hover:underline"><Shuffle className="size-3.5" />{t.shareAnother}</button>
        <button onClick={saveOnly} disabled={busy} className="flex items-center gap-1.5 underline-offset-4 hover:underline"><Download className="size-3.5" />{t.shareSave}</button>
      </div>
      {cfg.handle && <p className="relative mt-2 text-center text-xs opacity-85">{t.shareTag(cfg.handle.replace(/^@/, ''))}</p>}
      {err && <p className="relative mt-2 text-center text-sm font-semibold">{t.shareError}</p>}

      {showReward && (
        <div className="relative mt-4 rounded-3xl bg-white p-4 text-center text-ink animate-rise">
          {voucher ? (
            <>
              <Ticket className="mx-auto size-7 text-brand" />
              <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.25em] text-muted">{t.voucherYour}</p>
              <p className="mt-1 font-display text-xl font-semibold"><bdi>{voucherOffer(voucher)}</bdi></p>
              <p dir="ltr" className="mt-3 rounded-2xl border-2 border-dashed border-brand px-3 py-3 font-display text-3xl font-semibold tracking-[0.15em] text-brand">{voucher.code}</p>
              <button onClick={() => copy(voucher.code)} className="press mt-3 inline-flex h-10 items-center gap-1.5 rounded-full card px-4 text-sm font-semibold">
                {copied ? <Check className="size-4 text-brand" /> : <Copy className="size-4 text-brand" />}{copied ? t.voucherCopied : t.voucherCopy}
              </button>
              <ul className="mt-3 space-y-0.5 text-xs text-muted">
                <li>{t.voucherValid(day(voucher.starts_on), day(voucher.ends_on))}</li>
                {voucher.min_order_cents > 0 && <li>{t.voucherMin(money(Number(voucher.min_order_cents)))}</li>}
                {when(voucher) && <li>{t.voucherWhen(when(voucher))}</li>}
              </ul>
              <p className="mt-2 text-xs font-semibold">{voucher.channels.includes('online') ? t.voucherUse : t.voucherUseStore}</p>
            </>
          ) : !picked ? (
            <>
              <Gift className="mx-auto size-7 text-brand" />
              <p className="mt-1 font-semibold">{t.chooseGift}</p>
              <div className="mt-3 grid gap-2">
                {actions.map(a => <button key={a.id} onClick={() => setChosen(a.id)} className="press rounded-2xl card px-4 py-3 text-sm font-semibold"><bdi>{offerOf(a)}</bdi></button>)}
              </div>
            </>
          ) : picked.when === 'table' ? (
            <>
              <Gift className="mx-auto size-7 text-brand" />
              {used ? <p className="mt-1 font-semibold">{t.shareGiftUsed}</p> : (
                <>
                  <p className="mt-1 text-xs text-muted">{t.shareGiftHint}</p>
                  <p className="mt-1 font-display text-xl font-semibold"><bdi>{picked.name}</bdi></p>
                  <p dir="ltr" className="mt-1 text-xs text-muted">{t.ticket} #{ticket}</p>
                  <button onClick={markUsed} className="press mt-3 inline-flex h-10 items-center gap-1.5 rounded-full card px-4 text-sm font-semibold"><Check className="size-4 text-brand" />{t.shareGiftGiven}</button>
                </>
              )}
            </>
          ) : (
            <>
              <Ticket className="mx-auto size-7 text-brand" />
              {vState === 'full' ? <p className="mt-1 font-semibold">{t.voucherFull}</p>
                : vState === 'error' ? (
                  <>
                    <p className="mt-1 font-semibold">{t.voucherError}</p>
                    <button onClick={() => void getVoucher(picked)} className="press mt-3 inline-flex h-10 items-center rounded-full card px-4 text-sm font-semibold">{t.voucherRetry}</button>
                  </>
                ) : <p className="mt-1 font-semibold">{t.voucherWaiting}</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
