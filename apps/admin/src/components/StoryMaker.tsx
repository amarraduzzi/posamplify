import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, Film, Play, Scissors, Share2, Square } from 'lucide-react';
import '@fontsource-variable/fraunces';
import { tr } from '@resto/shared';
import { supabase } from '../lib/supabase';
import type { Item, Restaurant } from '../lib/types';
import { Btn, Field, Modal, Toggle, inputCls } from './ui';
import { t } from '../lib/i18n';
import { runAudio, SOUNDS, type AudioRun, type Sound } from '../lib/storyAudio';
import { FORMATS, STYLES, canvasBlob, drawStory, prepareStory, recordStory, type Mood, type StoryFormat, type StoryInput, type StoryStyle } from '../lib/storyMaker';

// i18n:values
const STYLE_NAMES: Record<StoryStyle, string> = { studio: 'Studio', signature: 'Signature', poster: 'Affiche', editorial: 'Magazine', polaroid: 'Polaroïd', sunburst: 'Soleil' };
const FORMAT_NAMES: Record<StoryFormat, string> = { story: 'Story 9:16', feed: 'Post 4:5', square: 'Carré 1:1' };
const SOUND_NAMES: Record<Sound, string> = { off: 'Sans son', fx: 'Effets', lounge: 'Lounge', oriental: 'Oriental', upbeat: 'Festif' };
const MOOD_NAMES: Record<Mood, string> = { warm: 'Chaud', fresh: 'Frais', moody: 'Moody', none: 'Naturel' };
// i18n:end
const BADGES: Record<string, Record<string, string>> = {
  heart: { fr: 'Coup de cœur', en: 'Our favourite', ar: 'اختيارنا' },
  new: { fr: 'Nouveau', en: 'New', ar: 'جديد' },
  day: { fr: 'Plat du jour', en: "Today's special", ar: 'طبق اليوم' },
  happy: { fr: 'Happy hour', en: 'Happy hour', ar: 'ساعة السعادة' },
  best: { fr: 'Best-seller', en: 'Best seller', ar: 'الأكثر طلبا' },
};
const CUT_VERSION = '1.5.5'; // pinned on purpose
const hashOf = (x: string) => { let h = 0; for (let i = 0; i < x.length; i++) h = (h * 31 + x.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const handleOf = (u?: string) => /instagram\.com\/([\w.]+)/i.exec(u ?? '')?.[1] ?? '';

const slug = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
const CAPTION: Record<string, (n: string, p: string, rest: string, d: string, b: string) => string> = {
  fr: (n, p, rest, d, b) => `✨ ${b} : ${n}${p ? ` à ${p}` : ''} !\n${d ? d + '\n' : ''}\nÀ déguster chez ${rest}. Commandez ou réservez via le lien en bio 👆`,
  en: (n, p, rest, d, b) => `✨ ${b}: ${n}${p ? ` for ${p}` : ''}!\n${d ? d + '\n' : ''}\nCome and enjoy it at ${rest}. Order or book via the link in bio 👆`,
  ar: (n, p, rest, d, b) => `✨ ${b}: ${n}${p ? ` بـ ${p}` : ''}!\n${d ? d + '\n' : ''}\nتعالوا تذوقوه في ${rest}. اطلبوا أو احجزوا عبر الرابط في البايو 👆`,
};
const TAGS: Record<string, string> = { fr: '#maroc #foodmaroc #instafood #restaurantmaroc', en: '#morocco #moroccanfood #instafood #foodie', ar: '#المغرب #مطعم #اكل_مغربي #instafood' };

export function StoryMaker({ r, item, onClose, badge: startBadge, reason }: { r: Restaurant; item: Item; onClose: () => void; badge?: string; reason?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [style, setStyle] = useState<StoryStyle>('studio');
  const [format, setFormat] = useState<StoryFormat>('story');
  const [lang, setLang] = useState(r.languages[0]);
  const [badge, setBadge] = useState(startBadge && BADGES[startBadge] ? startBadge : 'heart');
  const [capEdit, setCapEdit] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPrice, setShowPrice] = useState(true);
  const [handle, setHandle] = useState(handleOf(r.site?.instagram));
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rec, setRec] = useState<number | null>(null);
  const [clip, setClip] = useState<{ blob: Blob; url: string; ext: string } | null>(null);
  const [err, setErr] = useState('');
  const [mood, setMood] = useState<Mood>('warm');
  const [sound, setSound] = useState<Sound>('fx');
  const [cutUrl, setCutUrl] = useState<string | null>(null);
  const [cutP, setCutP] = useState<number | null>(null);
  const cutPath = item.image_url ? `${r.id}/cutouts/${item.id}-${hashOf(item.image_url)}.png` : '';
  const prices = item.item_variants.length ? item.item_variants.map(v => v.price_cents) : [item.price_cents];
  const price = useMemo(() => `${String(Math.min(...prices) / 100).replace('.', ',')} ${lang === 'ar' ? 'درهم' : 'DH'}`, [item, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const fileName = `${(tr(item.name, r.languages[0]) || 'plat').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${format}.png`;

  const input: StoryInput = useMemo(() => ({
    style, format, name: tr(item.name, lang, r.languages), description: tr(item.description, lang, r.languages).slice(0, 110),
    price, showPrice, badge: BADGES[badge][lang] ?? BADGES[badge].fr, restaurant: r.name, handle, logo: r.branding.logo_url,
    photo: item.image_url, primary: r.branding.primary_color || '#c8553d', rtl: lang === 'ar', mood, cutout: cutUrl,
  }), [style, format, lang, badge, showPrice, handle, price, item, r, mood, cutUrl]);

  // caption + hashtags, ready to paste into Instagram (editable)
  const capAuto = useMemo(() => {
    const nm = tr(item.name, lang, r.languages), b = BADGES[badge][lang] ?? BADGES[badge].fr, d = tr(item.description, lang, r.languages).slice(0, 110);
    return `${(CAPTION[lang] ?? CAPTION.fr)(nm, showPrice ? price : '', r.name, d, b)}\n\n#${slug(r.name)} ${slug(nm) ? '#' + slug(nm) + ' ' : ''}${TAGS[lang] ?? TAGS.fr}`;
  }, [item, lang, badge, showPrice, price, r]);
  useEffect(() => { setCapEdit(null); }, [capAuto]);
  const caption = capEdit ?? capAuto;
  async function copyCaption() { try { await navigator.clipboard.writeText(caption); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ } }

  // a cut-out made earlier for this photo is kept in the restaurant's storage
  useEffect(() => {
    if (!cutPath) return; const url = supabase.storage.from('menu-images').getPublicUrl(cutPath).data.publicUrl; const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => setCutUrl(url); i.src = url;
  }, [cutPath]);

  async function makeCutout() {
    if (!item.image_url) return; setErr(''); setCutP(0);
    try {
      const url = `https://cdn.jsdelivr.net/npm/@imgly/background-removal@${CUT_VERSION}/+esm`;
      const lib: any = await import(/* @vite-ignore */ url);
      const small = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
      const raw: Blob = await lib.removeBackground(item.image_url, { model: small ? 'isnet_quint8' : 'isnet_fp16', output: { format: 'image/png' }, progress: (_k: string, cur: number, tot: number) => setCutP(tot ? Math.min(0.99, cur / tot) : 0) });
      // smaller file (max 1400 px), transparency kept
      const bmp = await createImageBitmap(raw), k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height)), cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k); cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
      const png = await new Promise<Blob>((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('png'))), 'image/png'));
      setCutUrl(URL.createObjectURL(png)); setStyle('studio');
      supabase.storage.from('menu-images').upload(cutPath, png, { contentType: 'image/png', cacheControl: '31536000', upsert: true }).catch(() => undefined); // keeping it is a bonus
    } catch { setErr(t("La découpe a échoué. Vérifiez la connexion et réessayez, ou choisissez une autre photo.")); }
    finally { setCutP(null); }
  }


  // a changed setting makes an old video out of date
  useEffect(() => { setClip(c => { if (c) URL.revokeObjectURL(c.url); return null; }); }, [input, sound]);
  useEffect(() => () => { setClip(c => { if (c) URL.revokeObjectURL(c.url); return null; }); }, []);

  // preview: still picture, or the looping animation
  useEffect(() => {
    if (!canvas.current || clip) return;
    let live = true, raf = 0, au: AudioRun | null = null; const c = canvas.current;
    prepareStory(input).then(pre => {
      if (!live) return;
      if (!playing) { drawStory(c, input, 1, pre, 0.5); return; }
      const t0 = performance.now(); let cyc = -1;
      const f = () => {
        if (!live) return; const el = performance.now() - t0, k = Math.floor(el / 7000);
        if (k !== cyc) { cyc = k; au?.stop(); au = null; if (sound !== 'off') { try { au = runAudio(sound, { ms: 6000, record: false }); au.start(); } catch { au = null; } } }   // the sound restarts with every loop
        drawStory(c, input, Math.min(1, (el % 7000) / 4500), pre, 0.5); raf = requestAnimationFrame(f);
      };
      f();
    });
    return () => { live = false; cancelAnimationFrame(raf); au?.stop(); };
  }, [input, playing, clip, sound]);

  async function makeVideo() {
    setErr(''); setPlaying(false); setRec(0);
    try { const v = await recordStory(input, setRec, 6000, 4500, sound); setClip({ blob: v.blob, ext: v.ext, url: URL.createObjectURL(v.blob) }); }
    catch { setErr(t("Ce navigateur ne peut pas créer la vidéo. Utilisez Chrome ou Safari à jour, ou partagez l'image.")); }
    finally { setRec(null); }
  }
  /** the finished picture at full size (the preview canvas is smaller) */
  async function still() { const c = document.createElement('canvas'); drawStory(c, input, 1, await prepareStory(input), 1); return c; }
  async function share() {
    setBusy(true);
    try {
      const blob = clip ? clip.blob : await canvasBlob(await still()), name = clip ? fileName.replace(/\.png$/, `.${clip.ext}`) : fileName, file = new File([blob], name, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); }
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    } catch { /* cancelled */ } finally { setBusy(false); }
  }
  const { w, h } = FORMATS[format];

  return (
    <Modal wide title={t('Story Instagram')} onClose={onClose}
      footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy || rec !== null} onClick={share}>{typeof navigator.canShare === 'function' ? <Share2 className="h-4 w-4" /> : <Download className="h-4 w-4" />} {typeof navigator.canShare === 'function' ? t('Partager') : t('Télécharger')}</Btn></div>}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,300px)_1fr]">
        <div className="mx-auto w-full max-w-[300px]">
          {clip
            ? <video src={clip.url} autoPlay loop muted playsInline controls style={{ aspectRatio: `${w}/${h}` }} className="w-full rounded-2xl bg-black shadow-xl" />
            : <canvas ref={canvas} style={{ aspectRatio: `${w}/${h}` }} className="w-full rounded-2xl shadow-xl" />}
          {rec !== null && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-brand transition-[width]" style={{ width: `${Math.round(rec * 100)}%` }} /></div>}
          {!item.image_url && <p className="mt-2 text-xs text-muted">{t("Ajoutez une photo à l'article : l'image sera bien plus belle.")}</p>}
        </div>
        <div className="space-y-4">
          {reason && <p className="rounded-2xl bg-brand/10 p-3 text-sm">💡 {reason}</p>}
          <Field label={t('Style')}>
            <div className="flex flex-wrap gap-2">{STYLES.map(s => <button key={s} onClick={() => setStyle(s)} className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${style === s ? 'border-brand bg-brand text-white' : 'border-line/20 hover:bg-surface-2'}`}>{t(STYLE_NAMES[s])}</button>)}</div>
          </Field>
          <Field label={t('Ambiance photo')}>
            <div className="flex flex-wrap gap-2">{(Object.keys(MOOD_NAMES) as Mood[]).map(m => <button key={m} onClick={() => setMood(m)} className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${mood === m ? 'border-brand bg-brand text-white' : 'border-line/20 hover:bg-surface-2'}`}>{t(MOOD_NAMES[m])}</button>)}</div>
          </Field>
          {item.image_url && !cutUrl && (
            <div className="rounded-2xl bg-surface-2 p-3">
              <Btn onClick={makeCutout} disabled={cutP !== null}><Scissors className="h-4 w-4" /> {cutP !== null ? t('Découpe en cours…') : t("Détourer le plat (effet studio)")}</Btn>
              {cutP !== null ? <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white"><div className="h-full bg-brand transition-[width]" style={{ width: `${Math.round(cutP * 100)}%` }} /></div>
                : <p className="mt-1.5 text-xs text-muted">{t("Le plat flotte devant le nom en grand. La première fois, un modèle d'environ 50 Mo se télécharge : comptez 20 à 60 secondes.")}</p>}
            </div>
          )}
          <Field label={t('Son')}>
            <div className="flex flex-wrap gap-2">{SOUNDS.map(x => <button key={x} onClick={() => setSound(x)} className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${sound === x ? 'border-brand bg-brand text-white' : 'border-line/20 hover:bg-surface-2'}`}>{t(SOUND_NAMES[x])}</button>)}</div>
            {sound !== 'off' && <p className="mt-1.5 text-xs text-muted">{t("Musique et bruitages créés par l'appli : aucun droit d'auteur, vous pouvez les publier sur Instagram. Cliquez sur « Voir l'animation » pour écouter.")}</p>}
          </Field>
          <Field label={t('Format')}>
            <div className="flex flex-wrap gap-2">{(Object.keys(FORMAT_NAMES) as StoryFormat[]).map(f => <button key={f} onClick={() => setFormat(f)} className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${format === f ? 'border-brand bg-brand text-white' : 'border-line/20 hover:bg-surface-2'}`}>{t(FORMAT_NAMES[f])}</button>)}</div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('Étiquette')}><select className={inputCls} value={badge} onChange={e => setBadge(e.target.value)}>{Object.keys(BADGES).map(k => <option key={k} value={k}>{BADGES[k].fr}</option>)}</select></Field>
            {r.languages.length > 1 && <Field label={t('Langue')}><select className={inputCls} value={lang} onChange={e => setLang(e.target.value)}>{r.languages.map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></Field>}
          </div>
          <Field label="Instagram"><input className={inputCls} dir="ltr" value={handle} onChange={e => setHandle(e.target.value.replace(/^@/, '').trim())} placeholder="nom_du_restaurant" /></Field>
          <Toggle checked={showPrice} onChange={setShowPrice} label={t('Afficher le prix')} />
          <Field label={t('Légende et hashtags')}>
            <textarea className={inputCls} rows={6} dir={lang === 'ar' ? 'rtl' : 'ltr'} value={caption} onChange={e => setCapEdit(e.target.value)} />
            <Btn className="mt-2" onClick={copyCaption}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? t('Copié') : t('Copier la légende')}</Btn>
          </Field>
          <div className="flex flex-wrap gap-2 border-t border-line/10 pt-4">
            {!clip && <Btn onClick={() => setPlaying(p => !p)} disabled={rec !== null}>{playing ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />} {playing ? t('Arrêter') : t("Voir l'animation")}</Btn>}
            {!clip && <Btn tone="brand" onClick={makeVideo} disabled={rec !== null}><Film className="h-4 w-4" /> {rec !== null ? t('Création de la vidéo…') : t('Créer la vidéo (6 s)')}</Btn>}
            {clip && <Btn onClick={() => setClip(c => { if (c) URL.revokeObjectURL(c.url); return null; })}>{t("Revenir à l'image")}</Btn>}
          </div>
          {err && <p className="text-sm text-danger">{err}</p>}
          {clip?.ext === 'webm' && <p className="text-xs text-muted">{t("Ce navigateur crée un fichier webm : Instagram l'accepte mal. Sur iPhone ou avec Chrome à jour, c'est un mp4.")}</p>}
        </div>
      </div>
    </Modal>
  );
}
