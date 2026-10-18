import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Film, Play, Share2, Square } from 'lucide-react';
import '@fontsource-variable/fraunces';
import { tr } from '@resto/shared';
import type { Item, Restaurant } from '../lib/types';
import { Btn, Field, Modal, Toggle, inputCls } from './ui';
import { t } from '../lib/i18n';
import { FORMATS, STYLES, canvasBlob, drawStory, prepareStory, recordStory, type StoryFormat, type StoryInput, type StoryStyle } from '../lib/storyMaker';

// i18n:values
const STYLE_NAMES: Record<StoryStyle, string> = { signature: 'Signature', poster: 'Affiche', editorial: 'Magazine', polaroid: 'Polaroïd', sunburst: 'Soleil' };
const FORMAT_NAMES: Record<StoryFormat, string> = { story: 'Story 9:16', feed: 'Post 4:5', square: 'Carré 1:1' };
// i18n:end
const BADGES: Record<string, Record<string, string>> = {
  heart: { fr: 'Coup de cœur', en: 'Our favourite', ar: 'اختيارنا' },
  new: { fr: 'Nouveau', en: 'New', ar: 'جديد' },
  day: { fr: 'Plat du jour', en: "Today's special", ar: 'طبق اليوم' },
  happy: { fr: 'Happy hour', en: 'Happy hour', ar: 'ساعة السعادة' },
  best: { fr: 'Best-seller', en: 'Best seller', ar: 'الأكثر طلبا' },
};
const handleOf = (u?: string) => /instagram\.com\/([\w.]+)/i.exec(u ?? '')?.[1] ?? '';

export function StoryMaker({ r, item, onClose }: { r: Restaurant; item: Item; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [style, setStyle] = useState<StoryStyle>('signature');
  const [format, setFormat] = useState<StoryFormat>('story');
  const [lang, setLang] = useState(r.languages[0]);
  const [badge, setBadge] = useState('heart');
  const [showPrice, setShowPrice] = useState(true);
  const [handle, setHandle] = useState(handleOf(r.site?.instagram));
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rec, setRec] = useState<number | null>(null);
  const [clip, setClip] = useState<{ blob: Blob; url: string; ext: string } | null>(null);
  const [err, setErr] = useState('');
  const prices = item.item_variants.length ? item.item_variants.map(v => v.price_cents) : [item.price_cents];
  const price = useMemo(() => `${String(Math.min(...prices) / 100).replace('.', ',')} ${lang === 'ar' ? 'درهم' : 'DH'}`, [item, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const fileName = `${(tr(item.name, r.languages[0]) || 'plat').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${format}.png`;

  const input: StoryInput = useMemo(() => ({
    style, format, name: tr(item.name, lang, r.languages), description: tr(item.description, lang, r.languages).slice(0, 110),
    price, showPrice, badge: BADGES[badge][lang] ?? BADGES[badge].fr, restaurant: r.name, handle, logo: r.branding.logo_url,
    photo: item.image_url, primary: r.branding.primary_color || '#c8553d', rtl: lang === 'ar',
  }), [style, format, lang, badge, showPrice, handle, price, item, r]);

  // a changed setting makes an old video out of date
  useEffect(() => { setClip(c => { if (c) URL.revokeObjectURL(c.url); return null; }); }, [input]);
  useEffect(() => () => { setClip(c => { if (c) URL.revokeObjectURL(c.url); return null; }); }, []);

  // preview: still picture, or the looping animation
  useEffect(() => {
    if (!canvas.current || clip) return;
    let live = true, raf = 0; const c = canvas.current;
    prepareStory(input).then(pre => {
      if (!live) return;
      if (!playing) { drawStory(c, input, 1, pre, 0.5); return; }
      const t0 = performance.now();
      const f = () => { if (!live) return; const e = (performance.now() - t0) % 7000; drawStory(c, input, Math.min(1, e / 4500), pre, 0.5); raf = requestAnimationFrame(f); };
      f();
    });
    return () => { live = false; cancelAnimationFrame(raf); };
  }, [input, playing, clip]);

  async function makeVideo() {
    setErr(''); setPlaying(false); setRec(0);
    try { const v = await recordStory(input, setRec); setClip({ blob: v.blob, ext: v.ext, url: URL.createObjectURL(v.blob) }); }
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
          <Field label={t('Style')}>
            <div className="flex flex-wrap gap-2">{STYLES.map(s => <button key={s} onClick={() => setStyle(s)} className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${style === s ? 'border-brand bg-brand text-white' : 'border-line/20 hover:bg-surface-2'}`}>{t(STYLE_NAMES[s])}</button>)}</div>
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
