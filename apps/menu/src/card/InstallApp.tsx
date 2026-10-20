// "Add to home screen" for the customer's points card. The manifest (restaurant name, logo, colour) comes from
// /manifest.webmanifest; the app opens on the restaurant page, which sends the phone to its own card (the private
// key is stored on the phone): no login. Android Chrome: one tap (beforeinstallprompt). iPhone: Safari has no
// install button, so we explain Share > Add to Home Screen. Instagram/Facebook/WhatsApp browsers cannot install:
// we say to open the link in Chrome.
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Share, SquarePlus } from 'lucide-react';

type Lang = 'fr' | 'en' | 'ar';
const S = {
  fr: { title: 'Gardez votre carte sur votre téléphone', lead: 'Un icône sur l’écran d’accueil : vous voyez vos points en un tap, sans lien ni mot de passe.',
    add: 'Ajouter à l’écran d’accueil', done: 'Carte ajoutée à l’écran d’accueil',
    ios: 'Sur iPhone : touchez Partager (le carré avec une flèche), puis « Sur l’écran d’accueil ».',
    inapp: 'Pour l’ajouter, ouvrez ce lien dans Chrome (menu ⋮ ou « Ouvrir dans le navigateur »).', copy: 'Copier le lien', copied: 'Lien copié',
    menu: 'Dans Chrome : menu ⋮, puis « Ajouter à l’écran d’accueil » ou « Installer l’application ».' },
  en: { title: 'Keep your card on your phone', lead: 'An icon on your home screen: see your points in one tap, no link or password.',
    add: 'Add to home screen', done: 'Card added to your home screen',
    ios: 'On iPhone: tap Share (the square with an arrow), then “Add to Home Screen”.',
    inapp: 'To add it, open this link in Chrome (⋮ menu or “Open in browser”).', copy: 'Copy link', copied: 'Link copied',
    menu: 'In Chrome: ⋮ menu, then “Add to Home screen” or “Install app”.' },
  ar: { title: 'احتفظوا ببطاقتكم على هاتفكم', lead: 'أيقونة على الشاشة الرئيسية: تشاهدون نقاطكم بلمسة واحدة، دون رابط أو كلمة سر.',
    add: 'أضيفوا إلى الشاشة الرئيسية', done: 'تمت إضافة البطاقة إلى الشاشة الرئيسية',
    ios: 'على آيفون: اضغطوا على مشاركة (المربع والسهم) ثم «إضافة إلى الشاشة الرئيسية».',
    inapp: 'للإضافة، افتحوا هذا الرابط في Chrome (قائمة ⋮ أو «فتح في المتصفح»).', copy: 'نسخ الرابط', copied: 'تم نسخ الرابط',
    menu: 'في Chrome: قائمة ⋮ ثم «إضافة إلى الشاشة الرئيسية» أو «تثبيت التطبيق».' },
};

interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

const ua = () => navigator.userAgent || '';
const isIOS = () => /iPhone|iPad|iPod/i.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(ua());
const inApp = () => /FBAN|FBAV|FB_IAB|Instagram|Line\/|TikTok|musical_ly|Snapchat|; wv\)|WhatsApp/i.test(ua());
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/** The home-screen icon: the logo on a white tile over the restaurant's colour (maskable: nothing important at the edges). */
async function makeIcon(size: number, brand: string, logo: string | undefined, name: string): Promise<string> {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = brand; g.fillRect(0, 0, size, size);
  const tile = size * 0.6, x = (size - tile) / 2, r = tile * 0.22;
  g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(x, x, tile, tile, r); g.fill();
  let drawn = false;
  if (logo) {
    try {
      const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = no; i.src = logo; });
      const pad = tile * 0.08, box = tile - pad * 2, k = Math.min(box / img.width, box / img.height);
      g.save(); g.beginPath(); g.roundRect(x + pad, x + pad, box, box, r * 0.7); g.clip();
      g.drawImage(img, x + (tile - img.width * k) / 2, x + (tile - img.height * k) / 2, img.width * k, img.height * k); g.restore();
      drawn = true;
    } catch { /* image blocked or missing: the initials below */ }
  }
  if (!drawn) {
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '★';
    g.fillStyle = brand; g.font = `700 ${tile * 0.45}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(initials, size / 2, size / 2 + tile * 0.03);
  }
  try { return c.toDataURL('image/png'); }
  catch {
    // the logo tainted the canvas (no CORS): the same icon with initials only
    const c2 = document.createElement('canvas'); c2.width = c2.height = size; const g2 = c2.getContext('2d')!;
    g2.fillStyle = brand; g2.fillRect(0, 0, size, size); g2.fillStyle = '#fff'; g2.beginPath(); g2.roundRect(x, x, tile, tile, r); g2.fill();
    g2.fillStyle = brand; g2.font = `700 ${tile * 0.45}px sans-serif`; g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.fillText(name.trim()[0]?.toUpperCase() ?? '★', size / 2, size / 2 + tile * 0.03);
    return c2.toDataURL('image/png');
  }
}

export default function InstallApp({ name, brand, logo, cardKey, lang }: { name: string; brand: string; logo?: string; cardKey: string; lang: Lang }) {
  const t = S[lang] ?? S.fr;
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [added, setAdded] = useState(false);
  const [copied, setCopied] = useState(false);
  const already = useRef(standalone()).current;

  // service worker + the manifest of this restaurant (name, logo, colour)
  useEffect(() => {
    if (already) return;
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* no install, the card still works */ });
    let link: HTMLLinkElement | null = null; let apple: HTMLLinkElement | null = null; let off = false;
    // Android: the manifest must be a real url (served by /manifest.webmanifest), not a blob: Chrome hands the url to
    // Google's server to build the app. The private key is not in it: the app opens on the restaurant page, which
    // sends this phone to its own card.
    const path = location.pathname.replace(/\/+$/, '') || '/';
    const qs = new URLSearchParams({ n: name, c: brand, p: /^\/[a-z0-9-]{0,60}$/i.test(path) ? path : '/', l: lang, v: '3' });
    if (logo && /^https:\/\//i.test(logo)) qs.set('i', logo);
    link = document.createElement('link'); link.rel = 'manifest'; link.href = `/manifest.webmanifest?${qs.toString()}`; document.head.appendChild(link);
    // iPhone: the icon of the home-screen shortcut (it opens the page as it is now, with the key in the link)
    makeIcon(192, brand, logo, name).then(icon => {
      if (off) return;
      apple = document.createElement('link'); apple.rel = 'apple-touch-icon'; apple.href = icon; document.head.appendChild(apple);
    }).catch(() => { /* the card works, only the iPhone icon is missing */ });
    return () => { off = true; link?.remove(); apple?.remove(); };
  }, [already, name, brand, logo, cardKey, lang]);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as BIPEvent); };
    const onInstalled = () => { setAdded(true); setEvt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt); window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  if (already) return null; // the card is already open from the home screen
  const ios = isIOS(), android = isAndroid(), embedded = inApp();
  if (!ios && !android && !evt) return null; // a computer: nothing to install

  const install = async () => {
    if (!evt) return;
    await evt.prompt();
    const r = await evt.userChoice.catch(() => null);
    if (r?.outcome === 'accepted') setAdded(true);
    setEvt(null);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* the link stays in the address bar */ } };

  return (
    <div className="mt-4 rounded-[1.4rem] bg-surface-2 p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface text-brand"><SquarePlus className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{added ? t.done : t.title}</p>
          {!added && <p className="mt-1 text-sm leading-relaxed text-muted">{t.lead}</p>}
        </div>
      </div>
      {!added && (
        <div className="mt-4 space-y-3">
          {embedded
            ? <>
                <p className="text-sm">{t.inapp}</p>
                <button type="button" onClick={copy} className="inline-flex items-center gap-2 rounded-2xl bg-surface px-4 py-2.5 text-sm font-semibold">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? t.copied : t.copy}</button>
              </>
            : evt
              ? <button type="button" onClick={install} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-5 py-3.5 font-semibold text-brand-ink"><Download className="h-5 w-5" />{t.add}</button>
              : ios
                ? <p className="flex items-start gap-2 text-sm"><Share className="mt-0.5 h-4 w-4 shrink-0" /><span>{t.ios}</span></p>
                : <p className="text-sm">{t.menu}</p>}
        </div>
      )}
    </div>
  );
}
