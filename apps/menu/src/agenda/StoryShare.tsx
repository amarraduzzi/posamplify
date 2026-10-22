// Sharing a salon story: "J'ai rendez-vous" on the booking page, "Je suis n°3" in the Nouba. The picture
// is ready (the salon's colour, the @, the link to book): one tap posts it, the link is copied to stick it.
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Share2 } from 'lucide-react';
import { loadFonts, loadImage, pngBlob } from '../lib/story';
import { H, W, drawNouba, drawRdv, type NoubaInput, type RdvInput } from '../lib/salonStory';

type Lang = 'fr' | 'ar' | 'en';
const T = {
  fr: { rdvTitle: 'Partagez votre rendez-vous', rdvHint: 'Vos amies voient où vous allez, et peuvent réserver aussi.', nouba: 'Dites-le à vos amis', noubaHint: 'Ils voient l’attente et peuvent venir aussi.',
        go: 'Publier en story', save: 'Enregistrer l’image', copy: 'Copier le lien à coller', copied: 'Lien copié', sticker: 'Dans Instagram, ajoutez le sticker « Lien » et collez-le.', error: 'Le partage n’a pas marché. Enregistrez l’image.' },
  ar: { rdvTitle: 'شارك موعدك', rdvHint: 'صديقاتك يشوفو فين غادية، ويقدرو يحجزو حتى هوما.', nouba: 'قول لصحابك', noubaHint: 'يشوفو وقت الانتظار ويقدرو يجيو حتى هوما.',
        go: 'نشر في الستوري', save: 'حفظ الصورة', copy: 'نسخ الرابط', copied: 'تم نسخ الرابط', sticker: 'فإنستغرام، زيد ملصق « رابط » ولصقو.', error: 'المشاركة ما نجحاتش. احفظ الصورة.' },
  en: { rdvTitle: 'Share your appointment', rdvHint: 'Your friends see where you are going, and can book too.', nouba: 'Tell your friends', noubaHint: 'They see the wait and can come too.',
        go: 'Post as a story', save: 'Save the picture', copy: 'Copy the link to paste', copied: 'Link copied', sticker: 'In Instagram, add the “Link” sticker and paste it.', error: 'Sharing did not work. Save the picture.' },
};

export async function shareCanvas(c: HTMLCanvasElement, fileName: string, saveOnly = false) {
  const blob = await pngBlob(c), file = new File([blob], fileName, { type: 'image/png' });
  if (!saveOnly && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function StoryCard({ lang, kind, link, logoUrl, draw }: { lang: Lang; kind: 'rdv' | 'nouba'; link: string; logoUrl?: string; draw: (c: HTMLCanvasElement, logo: HTMLImageElement | null, scale: number) => void }) {
  const t = T[lang] ?? T.fr;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState(false);
  useEffect(() => { loadImage(logoUrl).then(setLogo); }, [logoUrl]);
  useEffect(() => { loadFonts().then(() => { if (canvas.current) draw(canvas.current, logo, 0.3); }); }); // redraw on every change of the data
  const go = async (saveOnly: boolean) => {
    setBusy(true); setErr(false);
    try { await loadFonts(); const c = document.createElement('canvas'); draw(c, logo, 1); await shareCanvas(c, `${kind}-story.png`, saveOnly); }
    catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setErr(true); }
    setBusy(false);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the link is visible anyway */ } };
  return (
    <section className="mx-5 mt-8 overflow-hidden rounded-[2rem] bg-brand p-4 text-brand-ink glow-brand">
      <p className="text-center font-display text-xl font-semibold">{kind === 'rdv' ? t.rdvTitle : t.nouba}</p>
      <p className="mt-1 text-center text-sm opacity-90">{kind === 'rdv' ? t.rdvHint : t.noubaHint}</p>
      <canvas ref={canvas} style={{ aspectRatio: `${W}/${H}` }} className="mx-auto mt-4 block w-[55%] max-w-[220px] rounded-2xl shadow-2xl ring-4 ring-white" />
      <button onClick={() => go(false)} disabled={busy} className="press mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-white py-3.5 text-lg font-bold text-ink shadow-xl disabled:opacity-60"><Share2 className="size-5" />{t.go}</button>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-xs font-semibold">
        <button onClick={copy} className="flex items-center gap-1.5">{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? t.copied : t.copy}</button>
        <button onClick={() => go(true)} disabled={busy} className="flex items-center gap-1.5"><Download className="size-3.5" />{t.save}</button>
      </div>
      <p className="mt-2 text-center text-xs opacity-85">{t.sticker}</p>
      {err && <p className="mt-2 text-center text-sm font-semibold">{t.error}</p>}
    </section>
  );
}

export function RdvStory({ lang, link, logoUrl, input }: { lang: Lang; link: string; logoUrl?: string; input: Omit<RdvInput, 'logo'> }) {
  return <StoryCard lang={lang} kind="rdv" link={link} logoUrl={logoUrl} draw={(c, logo, s) => drawRdv(c, { ...input, logo }, s)} />;
}
export function NoubaStory({ lang, link, logoUrl, input }: { lang: Lang; link: string; logoUrl?: string; input: Omit<NoubaInput, 'logo'> }) {
  return <StoryCard lang={lang} kind="nouba" link={link} logoUrl={logoUrl} draw={(c, logo, s) => drawNouba(c, { ...input, logo }, s)} />;
}
