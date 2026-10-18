import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Share2 } from 'lucide-react';
import '@fontsource-variable/fraunces';
import { tr } from '@resto/shared';
import type { Item, Restaurant } from '../lib/types';
import { Btn, Field, Modal, Toggle, inputCls } from './ui';
import { t } from '../lib/i18n';
import { FORMATS, STYLES, canvasBlob, renderStory, type StoryFormat, type StoryStyle } from '../lib/storyMaker';

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
  const prices = item.item_variants.length ? item.item_variants.map(v => v.price_cents) : [item.price_cents];
  const price = useMemo(() => `${String(Math.min(...prices) / 100).replace('.', ',')} ${lang === 'ar' ? 'درهم' : 'DH'}`, [item, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const fileName = `${(tr(item.name, r.languages[0]) || 'plat').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${format}.png`;

  useEffect(() => {
    let live = true;
    if (!canvas.current) return;
    renderStory(canvas.current, {
      style, format, name: tr(item.name, lang, r.languages), description: tr(item.description, lang, r.languages).slice(0, 110),
      price, showPrice, badge: BADGES[badge][lang] ?? BADGES[badge].fr, restaurant: r.name, handle, logo: r.branding.logo_url,
      photo: item.image_url, primary: r.branding.primary_color || '#c8553d', rtl: lang === 'ar',
    }).catch(() => live && undefined);
    return () => { live = false; };
  }, [style, format, lang, badge, showPrice, handle, price, item, r]);

  async function share() {
    if (!canvas.current) return; setBusy(true);
    try {
      const blob = await canvasBlob(canvas.current), file = new File([blob], fileName, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); }
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    } catch { /* cancelled */ } finally { setBusy(false); }
  }
  const { w, h } = FORMATS[format];

  return (
    <Modal wide title={t('Story Instagram')} onClose={onClose}
      footer={<div className="flex justify-end"><Btn tone="brand" disabled={busy} onClick={share}>{typeof navigator.canShare === 'function' ? <Share2 className="h-4 w-4" /> : <Download className="h-4 w-4" />} {typeof navigator.canShare === 'function' ? t('Partager') : t('Télécharger')}</Btn></div>}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,300px)_1fr]">
        <div className="mx-auto w-full max-w-[300px]">
          <canvas ref={canvas} style={{ aspectRatio: `${w}/${h}` }} className="w-full rounded-2xl shadow-xl" />
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
        </div>
      </div>
    </Modal>
  );
}
