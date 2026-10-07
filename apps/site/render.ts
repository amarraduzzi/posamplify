// Restaurant website, rendered on the server (Cloudflare Pages Functions) so Google reads it.
// Pure functions: data in, HTML out. Everything from the database is escaped.
// Pages: home (/), full menu (/menu), sitemap.xml, robots.txt. Languages: ?lang=fr|en|ar.

type I18n = Record<string, string | undefined>;
export interface SiteItem { id: string; category_id: string; name: I18n; description: I18n; price_cents: number; image_url: string | null; tags: string[]; available: boolean; variants: { name: I18n; price_cents: number }[]; promo_bp?: number | null }
export interface SiteData {
  restaurant: {
    slug: string; name: string; city: string | null; address: string | null; phone: string | null; currency: string; timezone: string; languages: string[];
    branding: { logo_url?: string; cover_url?: string; primary_color?: string; tagline?: I18n; review_url?: string };
    opening_hours: Record<string, [string, string][]>;
  };
  categories: { id: string; name: I18n; icon: string | null }[];
  items: SiteItem[];
  site: { theme?: 'nuit' | 'riad' | 'moderne'; about?: I18n; gallery?: string[]; cuisine?: string; price_range?: string; instagram?: string; facebook?: string; tiktok?: string; maps_url?: string };
  domain: string | null; noindex: boolean; booking: boolean; can_order: boolean;
  promotions?: { name: string; value: number; until: string | null }[];
}
export interface Ctx { base: string; origin: string; lang: string; menuUrl: string; now?: Date }

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const safeUrl = (u?: string | null) => (u && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : '');
const tr = (x: I18n | undefined, lang: string, langs: string[]) => (x?.[lang] || langs.map(l => x?.[l]).find(Boolean) || x?.fr || '') as string;

const T = {
  fr: { menu: 'La carte', infos: 'Infos', book: 'Réserver une table', order: 'Commander en ligne', orderShort: 'Commander', bookShort: 'Réserver', directions: 'Itinéraire', call: 'Appeler', hours: 'Horaires', address: 'Adresse', fullMenu: 'Voir toute la carte', signature: 'Nos incontournables', gallery: 'En images', follow: 'Suivez-nous', open: 'Ouvert maintenant', closed: 'Fermé maintenant', closedDay: 'Fermé', from: 'dès', review: 'Laisser un avis Google', made: 'Site créé avec Amplify', about: 'Bienvenue', back: 'Accueil', soldOut: 'épuisé', orderNote: 'À emporter ou en livraison, sans attendre.', happy: 'Happy hour en cours', days: { mon: 'Lundi', tue: 'Mardi', wed: 'Mercredi', thu: 'Jeudi', fri: 'Vendredi', sat: 'Samedi', sun: 'Dimanche' } as Record<string, string>, in: 'à' },
  en: { menu: 'Menu', infos: 'Info', book: 'Book a table', order: 'Order online', orderShort: 'Order', bookShort: 'Book', directions: 'Directions', call: 'Call', hours: 'Opening hours', address: 'Address', fullMenu: 'See the full menu', signature: 'Signature dishes', gallery: 'Gallery', follow: 'Follow us', open: 'Open now', closed: 'Closed now', closedDay: 'Closed', from: 'from', review: 'Leave a Google review', made: 'Website made with Amplify', about: 'Welcome', back: 'Home', soldOut: 'sold out', orderNote: 'Take-away or delivery, no waiting.', happy: 'Happy hour now', days: { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' } as Record<string, string>, in: 'in' },
  ar: { menu: 'القائمة', infos: 'معلومات', book: 'احجز طاولة', order: 'اطلب عبر الإنترنت', orderShort: 'اطلب', bookShort: 'احجز', directions: 'الاتجاهات', call: 'اتصل', hours: 'أوقات العمل', address: 'العنوان', fullMenu: 'القائمة الكاملة', signature: 'أطباقنا المميزة', gallery: 'صور', follow: 'تابعونا', open: 'مفتوح الآن', closed: 'مغلق الآن', closedDay: 'مغلق', from: 'ابتداء من', review: 'اترك تقييما على غوغل', made: 'موقع من إنجاز Amplify', about: 'مرحبا بكم', back: 'الرئيسية', soldOut: 'نفد', orderNote: 'للأخذ أو التوصيل، بدون انتظار.', happy: 'ساعة التخفيض الآن', days: { mon: 'الاثنين', tue: 'الثلاثاء', wed: 'الأربعاء', thu: 'الخميس', fri: 'الجمعة', sat: 'السبت', sun: 'الأحد' } as Record<string, string>, in: 'في' },
};
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const SCHEMA_DAY: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

const THEMES = {
  nuit: { bg: '#0E0D0B', surface: '#1A1815', line: 'rgba(255,255,255,.09)', ink: '#F4EFE6', muted: '#B5AB99', accent: '#C9A15A', accentInk: '#16120B', display: "'Fraunces', Georgia, serif", dark: true },
  riad: { bg: '#F5EDE1', surface: '#FFFAF2', line: 'rgba(60,35,20,.12)', ink: '#2A1B12', muted: '#7A6352', accent: '#B5562F', accentInk: '#FFF7EE', display: "'Fraunces', Georgia, serif", dark: false },
  moderne: { bg: '#FFFFFF', surface: '#F3F5F7', line: 'rgba(15,23,42,.09)', ink: '#0F172A', muted: '#5B6678', accent: '#0F766E', accentInk: '#FFFFFF', display: "'Plus Jakarta Sans', system-ui, sans-serif", dark: false },
};

function money(c: number, currency: string, lang: string) {
  const v = (c / 100).toFixed(2).replace(/\.00$/, '');
  const n = lang === 'en' ? v : v.replace('.', ',');
  return currency === 'MAD' ? (lang === 'ar' ? `${n} درهم` : `${n} DH`) : `${n} ${currency}`;
}
function localNow(tz: string, at: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at).map(x => [x.type, x.value]));
  return { dow: String(p.weekday).toLowerCase().slice(0, 3), hm: `${p.hour}:${p.minute}` };
}
export function isOpen(hours: Record<string, [string, string][]>, tz: string, at = new Date()) {
  if (!hours || !Object.keys(hours).length) return null;
  const { dow, hm } = localNow(tz, at);
  const prev = DAYS[(DAYS.indexOf(dow) + 6) % 7];
  for (const [s, e] of hours[dow] ?? []) if ((e > s && hm >= s && hm < e) || (e <= s && hm >= s)) return true;
  for (const [s, e] of hours[prev] ?? []) if (e <= s && hm < e) return true;
  return false;
}

const ICONS: Record<string, string> = {
  bag: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
  cal: '<path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"/>',
  pin: '<path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  ig: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/>',
  fb: '<path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z"/>',
  tt: '<path d="M14 3v11a3.5 3.5 0 1 1-3-3.46M14 3c.5 2.5 2.5 4.5 5 5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
const icon = (n: string, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

function css(th: typeof THEMES.nuit, accent: string, rtl: boolean) {
  return `
:root{--bg:${th.bg};--surface:${th.surface};--line:${th.line};--ink:${th.ink};--muted:${th.muted};--accent:${accent};--accent-ink:${th.accentInk};--display:${th.display}}
*{box-sizing:border-box;margin:0}html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--ink);font:16px/1.6 ${rtl ? "'IBM Plex Sans Arabic'," : ''}'Plus Jakarta Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}img{display:block;max-width:100%}
.w{max-width:1120px;margin:0 auto;padding:0 20px}
.i{width:18px;height:18px;flex:none}
h1,h2,h3{font-family:${rtl ? "'IBM Plex Sans Arabic',sans-serif" : 'var(--display)'};font-weight:600;line-height:1.08;letter-spacing:${rtl ? '0' : '-.01em'}}
.k{font-size:12px;font-weight:700;letter-spacing:.25em;text-transform:uppercase;color:var(--accent)}
.btn{display:inline-flex;align-items:center;gap:8px;white-space:nowrap;height:48px;padding:0 22px;border-radius:999px;font-weight:600;font-size:15px;transition:transform .15s,opacity .15s}
.btn:active{transform:scale(.97)}.btn.p{background:var(--accent);color:var(--accent-ink);box-shadow:0 10px 30px -12px var(--accent)}
.btn.g{border:1px solid var(--line);background:color-mix(in srgb,var(--surface) 70%,transparent);backdrop-filter:blur(8px)}
header.nav{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
header.nav .w{display:flex;align-items:center;gap:14px;height:64px}
.logo{width:38px;height:38px;border-radius:12px;object-fit:cover;background:var(--surface)}
.brand{font-family:var(--display);font-weight:600;font-size:19px;margin-inline-end:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.links{display:flex;gap:22px;font-size:14px;color:var(--muted)}.links a:hover{color:var(--ink)}
.langs{display:flex;gap:4px;font-size:12px;font-weight:700}.langs a{padding:4px 8px;border-radius:8px;color:var(--muted)}.langs a.on{background:var(--surface);color:var(--ink)}
.nav .btn{height:40px;padding:0 16px;font-size:14px}
.hero{position:relative;min-height:min(86vh,760px);display:flex;align-items:flex-end;overflow:hidden;color:#fff}
.hero>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scale(1.04);animation:z 18s ease-out forwards}
@keyframes z{to{transform:scale(1)}}
.hero:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.15) 0%,rgba(0,0,0,.25) 40%,rgba(0,0,0,.82) 100%)}
.hero.nophoto{color:var(--ink);background:radial-gradient(120% 90% at 80% 0%,color-mix(in srgb,var(--accent) 28%,transparent),transparent 60%),var(--bg)}.hero.nophoto:after{display:none}
.hero .w{position:relative;z-index:1;padding-top:120px;padding-bottom:64px;width:100%}
.hero h1{font-size:clamp(44px,8vw,96px);max-width:12ch}
.hero p.t{margin-top:14px;font-size:clamp(17px,2.2vw,21px);opacity:.88;max-width:36ch}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:22px}
.chip{display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border-radius:999px;font-size:13px;font-weight:600;background:rgba(255,255,255,.14);backdrop-filter:blur(8px)}
.hero.nophoto .chip{background:var(--surface)}
.chip .dot{width:8px;height:8px;border-radius:50%;background:#3DDC84}.chip.c .dot{background:#F47171}
.ctas{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}
section{padding:84px 0}section+section{border-top:1px solid var(--line)}
.sh{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:28px}
.sh h2{font-size:clamp(32px,4.5vw,52px)}
.about{display:grid;gap:40px;grid-template-columns:1.1fr .9fr;align-items:center}
.about p{font-size:19px;color:var(--muted);margin-top:18px;white-space:pre-line}
.about img{border-radius:28px;aspect-ratio:4/5;object-fit:cover;width:100%}
.dishes{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.dish{background:var(--surface);border:1px solid var(--line);border-radius:26px;overflow:hidden;display:flex;flex-direction:column}
.dish img{aspect-ratio:4/3;object-fit:cover;width:100%;transition:transform .5s}.dish:hover img{transform:scale(1.04)}
.dish .b{padding:18px 20px 20px;display:flex;flex-direction:column;gap:6px;flex:1}
.dish h3{font-size:21px}.dish p{font-size:14px;color:var(--muted)}
.price{font-weight:700;color:var(--accent);margin-top:auto;padding-top:6px}
.price s{color:var(--muted);font-weight:500;margin-inline-end:6px}
.order{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center;background:var(--accent);color:var(--accent-ink);border-radius:32px;padding:44px}
.order h2{font-size:clamp(30px,4vw,46px)}.order p{opacity:.85;margin-top:6px}.order .btn{background:var(--accent-ink);color:var(--accent)}
.gal{display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:200px;gap:12px}
.gal img{width:100%;height:100%;object-fit:cover;border-radius:20px}.gal img:first-child{grid-column:span 2;grid-row:span 2}
.info{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:26px;padding:26px}
.card h3{font-size:22px;display:flex;align-items:center;gap:10px;margin-bottom:14px}
.hrs{width:100%;border-collapse:collapse;font-size:15px}.hrs td{padding:7px 0;border-bottom:1px solid var(--line)}.hrs td:last-child{text-align:end;font-variant-numeric:tabular-nums}.hrs tr.on td{color:var(--accent);font-weight:700}
.map{width:100%;height:240px;border:0;border-radius:18px;margin-top:16px;${th.dark ? 'filter:invert(.9) hue-rotate(180deg) brightness(.95)' : ''}}
.row{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
.cats{position:sticky;top:64px;z-index:10;background:var(--bg);border-bottom:1px solid var(--line);overflow-x:auto;white-space:nowrap;padding:12px 0}
.cats a{display:inline-block;padding:8px 14px;border-radius:999px;background:var(--surface);font-size:14px;font-weight:600;margin-inline-end:6px}
.mcat{padding:44px 0 8px;scroll-margin-top:130px}.mcat h2{font-size:34px;margin-bottom:12px}
.mi{display:flex;gap:16px;padding:16px 0;border-bottom:1px solid var(--line)}
.mi img{width:88px;height:88px;border-radius:16px;object-fit:cover;flex:none}
.mi .n{display:flex;justify-content:space-between;gap:12px;font-weight:600;font-size:17px}.mi .n span:last-child{color:var(--accent);white-space:nowrap}
.mi p{font-size:14px;color:var(--muted)}.mi.so{opacity:.5}
footer{padding:48px 0 110px;color:var(--muted);font-size:14px;border-top:1px solid var(--line)}
footer .w{display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between;align-items:center}
.soc{display:flex;gap:8px}.soc a{width:42px;height:42px;display:grid;place-items:center;border-radius:50%;background:var(--surface);color:var(--ink)}
.made{display:inline-flex;align-items:center;gap:6px;opacity:.8}.made b{color:var(--ink)}
.bar{position:fixed;inset-inline:12px;bottom:12px;z-index:30;display:none;gap:8px;padding:8px;border-radius:999px;background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(14px);border:1px solid var(--line);box-shadow:0 20px 40px -20px rgba(0,0,0,.5)}
.bar .btn{flex:1;justify-content:center;height:46px;padding:0 10px}
.rv{opacity:0;transform:translateY(18px);transition:opacity .7s,transform .7s}.rv.in{opacity:1;transform:none}
@media (max-width:860px){.links{display:none}.about,.info,.order{grid-template-columns:1fr}.dishes{grid-template-columns:1fr 1fr}.gal{grid-template-columns:1fr 1fr;grid-auto-rows:150px}.nav .btn{display:none}.bar{display:flex}section{padding:60px 0}.order{padding:30px}}
@media (max-width:520px){.dishes{grid-template-columns:1fr}.hero h1{font-size:44px}}
@media (prefers-reduced-motion:reduce){.rv{opacity:1;transform:none}.hero>img{animation:none}}
`;
}

function priceOf(it: SiteItem, r: SiteData['restaurant'], lang: string, t: typeof T.fr) {
  const base = it.variants?.length ? Math.min(...it.variants.map(v => Number(v.price_cents))) : Number(it.price_cents);
  const promo = it.promo_bp ? base - Math.round(base * it.promo_bp / 10000) : base;
  const pre = it.variants?.length > 1 ? `${t.from} ` : '';
  return `${it.promo_bp ? `<s>${esc(money(base, r.currency, lang))}</s>` : ''}${pre}${esc(money(promo, r.currency, lang))}`;
}

export function renderSite(d: SiteData, c: Ctx, page: 'home' | 'menu'): string {
  const r = d.restaurant, langs = r.languages?.length ? r.languages : ['fr'];
  const lang = (['fr', 'en', 'ar'].includes(c.lang) && langs.includes(c.lang) ? c.lang : langs[0]) as 'fr' | 'en' | 'ar';
  const t = T[lang] ?? T.fr, rtl = lang === 'ar';
  const th = THEMES[d.site.theme ?? 'nuit'] ?? THEMES.nuit;
  const accent = /^#[0-9a-f]{6}$/i.test(r.branding?.primary_color ?? '') ? r.branding.primary_color! : th.accent;
  const name = esc(r.name);
  const tagline = tr(r.branding?.tagline, lang, langs);
  const about = tr(d.site.about, lang, langs);
  const cover = safeUrl(r.branding?.cover_url), logo = safeUrl(r.branding?.logo_url);
  const home = c.base || '/', q = (l: string) => (l === langs[0] ? '' : `?lang=${l}`), ql = q(lang);
  const canonical = `${c.origin}${c.base}${page === 'menu' ? '/menu' : ''}${ql}` || '/';
  const orderUrl = `${c.menuUrl}/${encodeURIComponent(r.slug)}?lang=${lang}`, bookUrl = `${c.menuUrl}/${encodeURIComponent(r.slug)}?reserver&lang=${lang}`;
  const place = [r.address, r.city].filter(Boolean).join(', ');
  const mapsUrl = safeUrl(d.site.maps_url) || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name}, ${place}`)}`;
  const open = isOpen(r.opening_hours, r.timezone, c.now);
  const tel = (r.phone ?? '').replace(/[^\d+]/g, '');
  const items = d.items ?? [];
  const sig = [...items].filter(i => i.available).sort((a, b) => Number(b.tags?.includes('popular')) - Number(a.tags?.includes('popular')) || Number(!!b.image_url) - Number(!!a.image_url)).slice(0, 6);
  const gallery = (d.site.gallery ?? []).map(safeUrl).filter(Boolean).slice(0, 7);
  const gal = gallery.length >= 3 ? gallery : [...gallery, ...items.map(i => safeUrl(i.image_url)).filter(Boolean)].slice(0, 5);
  const title = page === 'menu' ? `${t.menu} · ${r.name}${r.city ? `, ${r.city}` : ''}` : `${r.name}${d.site.cuisine ? ` · ${d.site.cuisine}` : tagline ? ` · ${tagline}` : ''}${r.city ? ` ${t.in} ${r.city}` : ''}`;
  const desc = (about || tagline || `${r.name}${r.city ? `, ${r.city}` : ''}`).replace(/\s+/g, ' ').slice(0, 158);

  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org', '@type': 'Restaurant', name: r.name, url: `${c.origin}${c.base || '/'}`,
    ...(cover || logo ? { image: cover || logo } : {}), ...(r.phone ? { telephone: r.phone } : {}),
    ...(place ? { address: { '@type': 'PostalAddress', streetAddress: r.address ?? undefined, addressLocality: r.city ?? undefined, addressCountry: 'MA' } } : {}),
    ...(d.site.cuisine ? { servesCuisine: d.site.cuisine } : {}), ...(d.site.price_range ? { priceRange: d.site.price_range } : {}),
    acceptsReservations: d.booking, hasMenu: `${c.origin}${c.base}/menu`,
    openingHoursSpecification: Object.entries(r.opening_hours ?? {}).flatMap(([day, rs]) => (rs ?? []).map(([o, cl]) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: SCHEMA_DAY[day], opens: o, closes: cl }))),
    sameAs: [d.site.instagram, d.site.facebook, d.site.tiktok].map(safeUrl).filter(Boolean),
  };
  if (page === 'menu') ld.hasMenu = { '@type': 'Menu', hasMenuSection: (d.categories ?? []).map(cat => ({ '@type': 'MenuSection', name: tr(cat.name, lang, langs), hasMenuItem: items.filter(i => i.category_id === cat.id).map(i => ({ '@type': 'MenuItem', name: tr(i.name, lang, langs), ...(tr(i.description, lang, langs) ? { description: tr(i.description, lang, langs) } : {}), offers: { '@type': 'Offer', price: (Number(i.price_cents) / 100).toFixed(2), priceCurrency: r.currency } })) })) };

  const head = `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(canonical)}">
${d.noindex ? '<meta name="robots" content="noindex">' : ''}${langs.map(l => `<link rel="alternate" hreflang="${l}" href="${esc(`${c.origin}${c.base}${page === 'menu' ? '/menu' : ''}${q(l)}`)}">`).join('')}
<meta property="og:type" content="restaurant"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">${cover ? `<meta property="og:image" content="${esc(cover)}">` : ''}
<meta name="theme-color" content="${th.bg}">${logo ? `<link rel="icon" href="${esc(logo)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;600&display=swap" rel="stylesheet">
${cover && page === 'home' ? `<link rel="preload" as="image" href="${esc(cover)}">` : ''}
<style>${css(th, accent, rtl)}</style>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script></head><body>`;

  const nav = `<header class="nav"><div class="w">
${logo ? `<img class="logo" src="${esc(logo)}" alt="" width="38" height="38">` : ''}<a class="brand" href="${esc(home + ql)}">${name}</a>
<nav class="links"><a href="${esc(`${c.base}/menu${ql}`)}">${t.menu}</a><a href="${esc(`${home}${ql}#infos`)}">${t.infos}</a></nav>
${langs.length > 1 ? `<div class="langs">${langs.filter(l => ['fr', 'en', 'ar'].includes(l)).map(l => `<a href="${esc(`${c.base}${page === 'menu' ? '/menu' : ''}${q(l) || '?lang=' + l}`)}" class="${l === lang ? 'on' : ''}" hreflang="${l}">${l === 'ar' ? 'ع' : l.toUpperCase()}</a>`).join('')}</div>` : ''}
${d.booking ? `<a class="btn g" href="${esc(bookUrl)}">${icon('cal')}${t.bookShort}</a>` : ''}${d.can_order ? `<a class="btn p" href="${esc(orderUrl)}">${icon('bag')}${t.orderShort}</a>` : ''}
</div></header>`;

  const bar = (d.can_order || d.booking || tel) ? `<div class="bar">${d.can_order ? `<a class="btn p" href="${esc(orderUrl)}">${icon('bag')}${t.orderShort}</a>` : ''}${d.booking ? `<a class="btn g" href="${esc(bookUrl)}">${icon('cal')}${t.bookShort}</a>` : ''}${!d.can_order && tel ? `<a class="btn g" href="tel:${esc(tel)}">${icon('phone')}${t.call}</a>` : ''}</div>` : '';
  const socials = [['ig', d.site.instagram], ['fb', d.site.facebook], ['tt', d.site.tiktok]].filter(([, u]) => safeUrl(u)).map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener" aria-label="${k}">${icon(k!)}</a>`).join('');
  const foot = `<footer><div class="w"><div><b style="color:var(--ink)">${name}</b>${place ? ` · ${esc(place)}` : ''}${r.phone ? ` · <a href="tel:${esc(tel)}" dir="ltr">${esc(r.phone)}</a>` : ''}</div>
${socials ? `<div class="soc">${socials}</div>` : ''}<a class="made" href="https://www.amplifygrowthstudio.com/?utm_source=site&utm_medium=footer&utm_campaign=${esc(r.slug)}" rel="noopener">${t.made.replace('Amplify', '<b>Amplify</b>')}</a></div></footer>`;
  const reveal = `<script>(()=>{const o=new IntersectionObserver(e=>e.forEach(x=>{if(x.isIntersecting){x.target.classList.add('in');o.unobserve(x.target)}}),{rootMargin:'0px 0px -8% 0px'});document.querySelectorAll('.rv').forEach(n=>o.observe(n))})()</script>`;

  if (page === 'menu') {
    const cats = (d.categories ?? []).filter(cat => items.some(i => i.category_id === cat.id));
    return `${head}${nav}<main><section style="padding-top:56px;padding-bottom:20px"><div class="w"><p class="k">${name}</p><h1 style="font-size:clamp(40px,6vw,72px);margin-top:8px">${t.menu}</h1></div></section>
<div class="cats"><div class="w">${cats.map(cat => `<a href="#c-${esc(cat.id)}">${esc(cat.icon ?? '')} ${esc(tr(cat.name, lang, langs))}</a>`).join('')}</div></div>
<div class="w">${cats.map(cat => `<div class="mcat" id="c-${esc(cat.id)}"><h2>${esc(cat.icon ?? '')} ${esc(tr(cat.name, lang, langs))}</h2>${items.filter(i => i.category_id === cat.id).map(i => `<div class="mi${i.available ? '' : ' so'}">${safeUrl(i.image_url) ? `<img src="${esc(i.image_url)}" alt="${esc(tr(i.name, lang, langs))}" loading="lazy" width="88" height="88">` : ''}<div style="flex:1"><div class="n"><span>${esc(tr(i.name, lang, langs))}${i.available ? '' : ` · ${t.soldOut}`}</span><span class="price" style="padding:0">${priceOf(i, r, lang, t)}</span></div>${tr(i.description, lang, langs) ? `<p>${esc(tr(i.description, lang, langs))}</p>` : ''}</div></div>`).join('')}</div>`).join('')}
${d.can_order ? `<section><div class="order rv"><div><h2>${t.order}</h2><p>${t.orderNote}</p></div><a class="btn" href="${esc(orderUrl)}">${t.orderShort} ${icon('arrow')}</a></div></section>` : '<div style="height:60px"></div>'}</div></main>${foot}${bar}${reveal}</body></html>`;
  }

  const hh = d.promotions?.[0];
  const hours = DAYS.map(day => `<tr class="${localNow(r.timezone, c.now ?? new Date()).dow === day ? 'on' : ''}"><td>${t.days[day]}</td><td dir="ltr">${(r.opening_hours?.[day] ?? []).map(([a, b]) => `${a}–${b}`).join(', ') || t.closedDay}</td></tr>`).join('');
  return `${head}${nav}<main>
<section class="hero${cover ? '' : ' nophoto'}" style="padding:0;border:0">${cover ? `<img src="${esc(cover)}" alt="${name}" fetchpriority="high">` : ''}<div class="w">
<p class="k" style="color:${cover ? '#fff' : 'var(--accent)'};opacity:.9">${esc(d.site.cuisine || tagline || '')}</p>
<h1>${name}</h1>${tagline && d.site.cuisine ? `<p class="t">${esc(tagline)}</p>` : ''}
<div class="chips">${open != null ? `<span class="chip${open ? '' : ' c'}"><span class="dot"></span>${open ? t.open : t.closed}</span>` : ''}${r.city ? `<span class="chip">${icon('pin')}${esc(r.city)}</span>` : ''}${hh ? `<span class="chip">${icon('star')}${t.happy} -${hh.value / 100}%</span>` : ''}</div>
<div class="ctas">${d.can_order ? `<a class="btn p" href="${esc(orderUrl)}">${icon('bag')}${t.order}</a>` : ''}${d.booking ? `<a class="btn g" href="${esc(bookUrl)}">${icon('cal')}${t.book}</a>` : ''}<a class="btn g" href="${esc(`${c.base}/menu${ql}`)}">${t.menu}</a></div>
</div></section>
${about ? `<section><div class="w about"><div class="rv"><p class="k">${t.about}</p><h2 style="font-size:clamp(32px,4.5vw,52px);margin-top:10px">${name}</h2><p>${esc(about)}</p></div>${gal[0] ? `<img class="rv" src="${esc(gal[0])}" alt="${name}" loading="lazy">` : ''}</div></section>` : ''}
${sig.length ? `<section><div class="w"><div class="sh"><h2 class="rv">${t.signature}</h2><a class="btn g" href="${esc(`${c.base}/menu${ql}`)}">${t.fullMenu} ${icon('arrow')}</a></div><div class="dishes">${sig.map(i => `<article class="dish rv">${safeUrl(i.image_url) ? `<img src="${esc(i.image_url)}" alt="${esc(tr(i.name, lang, langs))}" loading="lazy">` : ''}<div class="b"><h3>${esc(tr(i.name, lang, langs))}</h3>${tr(i.description, lang, langs) ? `<p>${esc(tr(i.description, lang, langs))}</p>` : ''}<span class="price">${priceOf(i, r, lang, t)}</span></div></article>`).join('')}</div></div></section>` : ''}
${d.can_order ? `<section><div class="w"><div class="order rv"><div><h2>${t.order}</h2><p>${t.orderNote}</p></div><a class="btn" href="${esc(orderUrl)}">${t.orderShort} ${icon('arrow')}</a></div></div></section>` : ''}
${gal.length >= 3 ? `<section><div class="w"><h2 class="rv" style="font-size:clamp(32px,4.5vw,52px);margin-bottom:28px">${t.gallery}</h2><div class="gal">${gal.slice(0, 5).map(u => `<img class="rv" src="${esc(u)}" alt="${name}" loading="lazy">`).join('')}</div></div></section>` : ''}
<section id="infos"><div class="w info">
<div class="card rv"><h3>${icon('clock')}${t.hours}</h3><table class="hrs">${hours}</table></div>
<div class="card rv"><h3>${icon('pin')}${t.address}</h3>${place ? `<p>${esc(place)}</p>` : ''}${place ? `<iframe class="map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="${t.address}" src="https://maps.google.com/maps?q=${encodeURIComponent(`${r.name}, ${place}`)}&z=16&output=embed"></iframe>` : ''}
<div class="row"><a class="btn p" href="${esc(mapsUrl)}" target="_blank" rel="noopener">${icon('pin')}${t.directions}</a>${tel ? `<a class="btn g" href="tel:${esc(tel)}">${icon('phone')}${t.call}</a>` : ''}${safeUrl(r.branding?.review_url) ? `<a class="btn g" href="${esc(r.branding.review_url)}" target="_blank" rel="noopener">${icon('star')}${t.review}</a>` : ''}</div></div>
</div></section></main>${foot}${bar}${reveal}</body></html>`;
}

export function renderSitemap(d: SiteData, c: Ctx) {
  const langs = d.restaurant.languages?.length ? d.restaurant.languages : ['fr'];
  const urls = ['', '/menu'].flatMap(p => langs.map((l, i) => `${c.origin}${c.base}${p}${i === 0 ? '' : `?lang=${l}`}`));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${esc(u)}</loc></url>`).join('')}</urlset>`;
}
