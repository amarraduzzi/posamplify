// "Le miroir" (?miroir=<ticket token>): after paying, the client takes a selfie in the salon's mirror;
// the frame is ready (the salon, the prestation, who did it, the date, the @, a line on the glass).
// The photo never leaves the phone. For sharing, what the owner chose: a gift at the reception, or a
// personal code for the next visit.
import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Copy, Download, Gift, ImageUp, Loader2, Share2, Shuffle, Ticket } from 'lucide-react';
import type { Branding } from '@resto/shared';
import { applyBranding, applyLang } from '../theme';
import { load, save } from '../lib/storage';
import { loadFonts, loadImage } from '../lib/story';
import { salonMirror, salonVoucher, type SalonAction, type SalonMirror } from '../lib/api';
import { H, MIRROR_LINES, W, drawMirror } from '../lib/salonStory';
import { shareCanvas } from './StoryShare';

type Lang = 'fr' | 'ar' | 'en';
const S = {
  fr: { title: 'Le miroir', hello: 'Merci pour votre visite !', intro: 'Une photo dans le miroir du salon, le cadre est prêt. Elle reste sur votre téléphone.',
        take: 'Prendre ma photo', pick: 'Choisir une photo', another: 'Une autre phrase', retake: 'Une autre photo', post: 'Publier en story', saveImg: 'Enregistrer l’image',
        by: 'par', notFound: 'Ce lien a expiré.', reward: 'Partagez, et recevez :', choose: 'Choisissez votre cadeau', error: 'Le partage n’a pas marché. Enregistrez l’image.',
        yourCode: 'Votre code pour la prochaine visite', copy: 'Copier', copied: 'Copié', valid: (a: string, b: string) => `Valable du ${a} au ${b}`, min: (m: string) => `Dès ${m} de prestations`,
        showCode: 'Donnez ce code à la caisse lors de votre prochaine visite.', used: 'Ce code a déjà servi.', full: 'Plus de codes cette semaine. Merci pour le partage !',
        gift: 'Montrez votre story à l’accueil :', percent: (v: number) => `-${v} % sur votre prochaine visite`, amount: (m: string) => `${m} offerts sur votre prochaine visite`, tag: (h: string) => `Identifiez @${h}` },
  ar: { title: 'المراية', hello: 'شكرا على زيارتك!', intro: 'صورة فمراية الصالون، الإطار واجد. الصورة كتبقى فتيليفونك.',
        take: 'خود صورتي', pick: 'اختار صورة', another: 'جملة أخرى', retake: 'صورة أخرى', post: 'نشر في الستوري', saveImg: 'حفظ الصورة',
        by: 'مع', notFound: 'هاد الرابط سالا.', reward: 'شارك وخود:', choose: 'اختار الهدية ديالك', error: 'المشاركة ما نجحاتش. احفظ الصورة.',
        yourCode: 'الكود ديالك للزيارة الجاية', copy: 'نسخ', copied: 'تم النسخ', valid: (a: string, b: string) => `صالح من ${a} حتى ${b}`, min: (m: string) => `ابتداءً من ${m} ديال الخدمات`,
        showCode: 'عطي هاد الكود فالصندوق فالزيارة الجاية.', used: 'هاد الكود تستعمل.', full: 'سالاو الكودات هاد السيمانة. شكرا على المشاركة!',
        gift: 'ورّي الستوري ديالك فالاستقبال:', percent: (v: number) => `-${v} % فالزيارة الجاية`, amount: (m: string) => `${m} هدية فالزيارة الجاية`, tag: (h: string) => `دير تاغ لـ @${h}` },
  en: { title: 'The mirror', hello: 'Thank you for your visit!', intro: 'A photo in the salon’s mirror, the frame is ready. It stays on your phone.',
        take: 'Take my photo', pick: 'Choose a photo', another: 'Another line', retake: 'Another photo', post: 'Post as a story', saveImg: 'Save the picture',
        by: 'by', notFound: 'This link has expired.', reward: 'Share it, and get:', choose: 'Choose your gift', error: 'Sharing did not work. Save the picture.',
        yourCode: 'Your code for the next visit', copy: 'Copy', copied: 'Copied', valid: (a: string, b: string) => `Valid from ${a} to ${b}`, min: (m: string) => `From ${m} of services`,
        showCode: 'Give this code at the till on your next visit.', used: 'This code has been used.', full: 'No more codes this week. Thanks for sharing!',
        gift: 'Show your story at the reception:', percent: (v: number) => `-${v} % on your next visit`, amount: (m: string) => `${m} off your next visit`, tag: (h: string) => `Tag @${h}` },
};
const loc = (l: Lang) => (l === 'ar' ? 'ar-MA-u-nu-latn' : l === 'en' ? 'en-GB' : 'fr-FR');
function pickLang(langs: string[] | null | undefined): Lang {
  const ok = (langs?.length ? langs : ['fr']).filter((x): x is Lang => x in S);
  const phone = (navigator.language || '').slice(0, 2) as Lang;
  return ok.includes(phone) ? phone : ok[0] ?? 'fr';
}

export default function MirrorApp({ token }: { token: string }) {
  const [m, setM] = useState<SalonMirror | null | undefined>(undefined);
  const [lang, setLang] = useState<Lang>('fr');
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [roll, setRoll] = useState(() => Math.floor(Math.random() * MIRROR_LINES.length));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const [shared, setShared] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(() => load<string>(`mirror:${token}`, 60 * 86400_000));
  const [vState, setVState] = useState<'idle' | 'loading' | 'full' | 'error'>('idle');
  const [copied, setCopied] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);

  useEffect(() => {
    salonMirror(token).then(x => {
      setM(x);
      if (!x) return;
      const l = pickLang(x.salon.languages); setLang(l); applyLang(l);
      applyBranding((x.salon.branding ?? {}) as Branding, x.salon.name);
      loadImage((x.salon.branding as Branding | null)?.logo_url).then(setLogo);
      if (x.voucher) setCode(x.voucher.code);
    }).catch(() => setM(null));
  }, [token]);
  const t = S[lang];
  const lines = MIRROR_LINES.filter(x => x.lang === lang).length ? MIRROR_LINES.filter(x => x.lang === lang) : MIRROR_LINES;
  const tz = m?.salon.timezone ?? 'UTC';
  const input = () => ({
    photo, logo, salon: m!.salon.name, handle: m!.salon.handle ?? undefined, primary: ((m!.salon.branding as Branding | null)?.primary_color) ?? '#8E3B4F',
    service: m!.services.join(' · ') || m!.salon.name, staff: m!.staff.join(', ') || undefined, byWord: t.by, line: lines[roll % lines.length],
    date: new Intl.DateTimeFormat(loc(lang), { timeZone: tz, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(m!.at)),
  });
  useEffect(() => { if (m && canvas.current) loadFonts().then(() => canvas.current && drawMirror(canvas.current, input(), 0.4)); }); // redraw on every change

  const onFile = (f?: File | null) => {
    if (!f) return;
    const url = URL.createObjectURL(f); const img = new Image();
    img.onload = () => setPhoto(img); img.src = url;
  };
  const actions = (m?.actions ?? []).filter(a => a.on);
  const picked: SalonAction | null = actions.length === 1 ? actions[0] : actions.find(a => a.id === chosen) ?? null;
  const offer = (a: SalonAction) => (a.type === 'gift' ? a.name : a.type === 'percent' ? t.percent(a.value ?? 0) : t.amount(`${a.value ?? 0} ${m?.salon.currency === 'MAD' ? 'DH' : m?.salon.currency ?? ''}`));
  const getCode = async (a: SalonAction) => {
    setVState('loading');
    try {
      const r = await salonVoucher(token, a.id);
      if (r.status === 'ok' && r.code) { setCode(r.code); save(`mirror:${token}`, r.code); setVState('idle'); salonMirror(token).then(x => x && setM(x)); }
      else setVState(r.status === 'full' ? 'full' : 'error');
    } catch { setVState('error'); }
  };
  useEffect(() => { if (shared && picked && picked.when === 'next' && !code && vState === 'idle') void getCode(picked); }, [shared, picked?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const post = async (saveOnly: boolean) => {
    setBusy(true); setErr(false);
    try { await loadFonts(); const c = document.createElement('canvas'); drawMirror(c, input(), 1); await shareCanvas(c, 'miroir.png', saveOnly); setShared(true); }
    catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setErr(true); }
    setBusy(false);
  };
  const copy = async () => { if (!code) return; try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* visible anyway */ } };
  const day = (d: string) => new Intl.DateTimeFormat(loc(lang), { day: 'numeric', month: 'short' }).format(new Date(`${d}T12:00:00`));

  if (m === undefined) return <main className="grid min-h-dvh place-items-center bg-bg"><Loader2 className="size-6 animate-spin text-muted" /></main>;
  if (!m) return <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center text-muted">{t.notFound}</main>;
  const v = m.voucher;
  return (
    <main className="min-h-dvh bg-bg pb-10 text-ink">
      <div className="mx-auto max-w-lg px-5 pt-8">
        <p className="text-center text-sm font-semibold text-muted">{m.salon.name}</p>
        <h1 className="mt-1 text-center font-display text-3xl font-semibold">{t.hello}</h1>
        <p className="mt-2 text-center text-muted">{t.intro}</p>
        {actions.length > 0 && !code && (
          <div className="mt-4 rounded-2xl bg-brand/10 p-3 text-center">
            <p className="text-xs font-semibold text-muted">{t.reward}</p>
            <p className="mt-0.5 font-display text-lg font-semibold"><bdi>{actions.length === 1 ? offer(actions[0]) : actions.map(offer).join(' · ')}</bdi></p>
          </div>
        )}

        <input ref={cam} type="file" accept="image/*" capture="user" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
        <input ref={lib} type="file" accept="image/*" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
        <canvas ref={canvas} style={{ aspectRatio: `${W}/${H}` }} className="mx-auto mt-5 block w-[70%] max-w-[300px] rounded-3xl shadow-2xl" />

        <div className="mt-5 space-y-2">
          {!photo ? <>
            <button onClick={() => cam.current?.click()} className="press flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand text-lg font-bold text-brand-ink glow-brand"><Camera className="size-5" />{t.take}</button>
            <button onClick={() => lib.current?.click()} className="press flex h-12 w-full items-center justify-center gap-2 rounded-full bg-surface font-semibold shadow-[var(--shadow)]"><ImageUp className="size-4" />{t.pick}</button>
          </> : <>
            {actions.length > 1 && !picked && !code && (
              <div className="rounded-2xl bg-surface p-3 shadow-[var(--shadow)]">
                <p className="mb-2 text-center text-sm font-semibold">{t.choose}</p>
                <div className="grid gap-2">{actions.map(a => <button key={a.id} onClick={() => setChosen(a.id)} className="press rounded-xl bg-surface-2 px-3 py-2.5 text-sm font-semibold"><bdi>{offer(a)}</bdi></button>)}</div>
              </div>
            )}
            <button onClick={() => post(false)} disabled={busy || (actions.length > 1 && !picked && !code)} className="press flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand text-lg font-bold text-brand-ink glow-brand disabled:opacity-50"><Share2 className="size-5" />{t.post}</button>
            <div className="flex flex-wrap items-center justify-center gap-5 pt-1 text-sm font-semibold text-muted">
              <button onClick={() => setRoll(r => r + 1)} className="flex items-center gap-1.5"><Shuffle className="size-4" />{t.another}</button>
              <button onClick={() => cam.current?.click()} className="flex items-center gap-1.5"><Camera className="size-4" />{t.retake}</button>
              <button onClick={() => post(true)} disabled={busy} className="flex items-center gap-1.5"><Download className="size-4" />{t.saveImg}</button>
            </div>
            {m.salon.handle && <p className="text-center text-xs text-muted">{t.tag(m.salon.handle)}</p>}
          </>}
          {err && <p className="text-center text-sm font-semibold text-red-500">{t.error}</p>}
        </div>

        {code && v ? (
          <div className="mt-6 rounded-3xl bg-surface p-5 text-center shadow-[var(--shadow)]">
            <Ticket className="mx-auto size-7 text-brand" />
            <p className="mt-1 text-xs font-semibold text-muted">{t.yourCode}</p>
            <p className="mt-1 font-display text-xl font-semibold"><bdi>{v.kind === 'gift' ? v.name : v.kind === 'percent' ? t.percent(v.value / 100) : t.amount(`${v.value / 100} DH`)}</bdi></p>
            <p dir="ltr" className="mt-3 rounded-2xl border-2 border-dashed border-brand px-3 py-3 font-display text-3xl font-semibold tracking-[0.15em] text-brand">{code}</p>
            <button onClick={copy} className="press mt-3 inline-flex h-10 items-center gap-1.5 rounded-full bg-surface-2 px-4 text-sm font-semibold">{copied ? <Check className="size-4 text-brand" /> : <Copy className="size-4 text-brand" />}{copied ? t.copied : t.copy}</button>
            <ul className="mt-3 space-y-0.5 text-xs text-muted">
              <li>{t.valid(day(v.starts_on), day(v.ends_on))}</li>
              {v.min_cents > 0 && <li>{t.min(`${v.min_cents / 100} DH`)}</li>}
            </ul>
            <p className="mt-2 text-xs font-semibold">{v.used ? t.used : t.showCode}</p>
          </div>
        ) : shared && picked ? (
          <div className="mt-6 rounded-3xl bg-surface p-5 text-center shadow-[var(--shadow)]">
            {picked.when === 'table' ? <><Gift className="mx-auto size-7 text-brand" /><p className="mt-1 text-sm text-muted">{t.gift}</p><p className="mt-1 font-display text-xl font-semibold"><bdi>{picked.name}</bdi></p></>
              : vState === 'full' ? <p className="font-semibold">{t.full}</p>
              : vState === 'error' ? <button onClick={() => void getCode(picked)} className="press rounded-full bg-surface-2 px-4 py-2 font-semibold">{t.yourCode}</button>
              : <Loader2 className="mx-auto size-6 animate-spin text-muted" />}
          </div>
        ) : null}
      </div>
    </main>
  );
}
