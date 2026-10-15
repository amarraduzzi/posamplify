// Restaurant website, rendered on the server (Cloudflare Pages Functions) so Google reads it.
// Pure functions: data in, HTML out. Everything from the database is escaped.
// Pages: home (/), full menu (/menu), sitemap.xml, robots.txt. Languages: ?lang=fr|en|ar.
// Three styles, each with its own layout and typefaces:
// * riad: arches, zellige, a classic menu card with dotted leaders
// * nuit: full-screen photo or video with film bars, dishes on a film strip
// * moderne: light bento grid of big photo cards, the menu as photo cards
// * atelier: pâtisserie, boulangerie: a striped awning, products on plates like in a shop window, price tags,
//   prices per kilo, and a block for orders and catering (a quote asked on WhatsApp)
// Premium (site_plan 'premium', set by the platform):
// * maison: a light house magazine: the name as a masthead, a photo collage, the story in numbered
//   chapters, the dishes the house recommends, the chef, the menu as a printed card, and a request form
//   (group, private event, catering) that arrives as a quote in the back office
// Restaurants without online ordering (no till) can take orders on WhatsApp: the guest fills a
// basket on the site and sends it as a ready-made WhatsApp message to the restaurant.

type I18n = Record<string, string | undefined>;
export interface SiteItem { id: string; category_id: string; name: I18n; description: I18n; price_cents: number; image_url: string | null; tags: string[]; available: boolean; variants: { name: I18n; price_cents: number }[]; promo_bp?: number | null; sold_by_weight?: boolean }
export interface SiteData {
  restaurant: {
    slug: string; name: string; city: string | null; address: string | null; phone: string | null; currency: string; timezone: string; languages: string[];
    branding: { logo_url?: string; cover_url?: string; primary_color?: string; tagline?: I18n; review_url?: string };
    opening_hours: Record<string, [string, string][]>;
  };
  categories: { id: string; name: I18n; icon: string | null }[];
  items: SiteItem[];
  site: {
    theme?: 'nuit' | 'riad' | 'moderne' | 'atelier' | 'maison' | 'signature'; about?: I18n; gallery?: string[]; cuisine?: string; price_range?: string; instagram?: string; facebook?: string; tiktok?: string; maps_url?: string;
    video_url?: string; whatsapp?: string; wa_order?: boolean; wa_delivery?: boolean; catering?: boolean;
    story?: { title?: I18n; text?: I18n; image?: string }[]; chef?: { name?: string; role?: I18n; text?: I18n; photo?: string };
    signatures?: { item_id: string; text?: I18n }[]; request?: boolean;
  };
  site_plan?: 'basic' | 'premium';
  domain: string | null; noindex: boolean; booking: boolean; can_order: boolean;
  paused?: boolean;
  promotions?: { name: string; value: number; until: string | null }[];
}
export interface Ctx { base: string; origin: string; lang: string; menuUrl: string; now?: Date }
type Lang = 'fr' | 'en' | 'ar';
type Theme = 'nuit' | 'riad' | 'moderne' | 'atelier' | 'maison' | 'signature';
const PREMIUM: Theme[] = ['maison', 'signature'];

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const safeUrl = (u?: string | null) => (u && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : '');
const tr = (x: I18n | undefined, lang: string, langs: string[]) => (x?.[lang] || langs.map(l => x?.[l]).find(Boolean) || x?.fr || '') as string;
/** A Moroccan number as wa.me wants it (06…/07… -> 2126…/2127…). */
export function waNumber(p?: string | null) {
  let d = (p ?? '').replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^00/, '');
  if (/^0[5-7]\d{8}$/.test(d)) d = `212${d.slice(1)}`;
  return /^\d{9,15}$/.test(d) ? d : '';
}

const T = {
  fr: { menu: 'La carte', infos: 'Infos', book: 'Réserver une table', order: 'Commander en ligne', orderShort: 'Commander', bookShort: 'Réserver', directions: 'Itinéraire', call: 'Appeler', hours: 'Horaires', address: 'Adresse', fullMenu: 'Voir toute la carte', signature: 'Nos incontournables', gallery: 'En images', open: 'Ouvert maintenant', closed: 'Fermé maintenant', closedDay: 'Fermé', today: 'Aujourd’hui', from: 'dès', review: 'Laisser un avis Google', made: 'Site créé avec Amplify', about: 'Bienvenue', soldOut: 'épuisé', orderNote: 'À emporter ou en livraison, sans attendre.', waNote: 'Choisissez vos plats, nous recevons votre commande sur WhatsApp.', happy: 'Happy hour en cours', in: 'à',
    opensToday: 'Ouvre aujourd’hui', opensTomorrow: 'Ouvre demain', opensOn: 'Ouvre {d}',
    days: { mon: 'Lundi', tue: 'Mardi', wed: 'Mercredi', thu: 'Jeudi', fri: 'Vendredi', sat: 'Samedi', sun: 'Dimanche' } as Record<string, string>,
    add: 'Ajouter', search: 'Rechercher un plat', all: 'Tout', none: 'Aucun plat ne correspond.', basket: 'Votre commande', see: 'Voir la commande', total: 'Total', yourName: 'Votre prénom', takeaway: 'À emporter', delivery: 'Livraison', dineIn: 'Sur place', addr: 'Adresse de livraison', note: 'Remarque (facultatif)', send: 'Envoyer sur WhatsApp', close: 'Fermer', choose: 'Choisissez', empty: 'Votre commande est vide.', waHello: 'Bonjour {r}, je souhaite commander :', waName: 'Nom', waAddr: 'Adresse', waNoteL: 'Remarque', waFoot: 'Envoyé depuis votre site', waHint: 'WhatsApp s’ouvre avec votre message prêt. Il ne reste qu’à l’envoyer.', orderWa: 'Commander sur WhatsApp',
    tags: { popular: 'Populaire', spicy: 'Épicé', new: 'Nouveau', vegetarian: 'Végétarien' } as Record<string, string>,
    vitrine: 'En vitrine', cater: 'Commandes et événements', caterText: 'Gâteaux d’anniversaire, plateaux et pièces pour vos fêtes, mariages et séminaires. Dites-nous la date et le nombre de personnes, nous vous préparons un devis.', caterBtn: 'Demander un devis', caterWa: 'Bonjour {r}, je voudrais un devis pour une commande. Date : … Nombre de personnes : … Ce que je souhaite : …', perKg: 'le kg',
    story: 'Notre histoire', recommends: 'La maison recommande', chapter: 'Chapitre', reqTitle: 'Recevoir chez nous', reqText: 'Un groupe, un anniversaire, une privatisation ou un traiteur : dites-nous tout, nous vous rappelons avec une proposition.', kinds: { group: 'Groupe', private: 'Privatisation', catering: 'Traiteur', other: 'Autre' } as Record<string, string>, fName: 'Votre nom', fPhone: 'Téléphone', fDate: 'Date', fGuests: 'Personnes', fMsg: 'Votre demande', fSend: 'Envoyer la demande', fSent: 'Merci, votre demande est bien arrivée. Nous vous rappelons rapidement.', reqWa: 'Prévenir aussi sur WhatsApp', reqWaMsg: 'Bonjour, je viens d’envoyer une demande sur votre site.', fErr: 'Envoi impossible. Vérifiez le numéro et la date, ou appelez-nous.', fMany: 'Trop de demandes aujourd’hui. Appelez-nous directement.' },
  en: { menu: 'Menu', infos: 'Info', book: 'Book a table', order: 'Order online', orderShort: 'Order', bookShort: 'Book', directions: 'Directions', call: 'Call', hours: 'Opening hours', address: 'Address', fullMenu: 'See the full menu', signature: 'Signature dishes', gallery: 'Gallery', open: 'Open now', closed: 'Closed now', closedDay: 'Closed', today: 'Today', from: 'from', review: 'Leave a Google review', made: 'Website made with Amplify', about: 'Welcome', soldOut: 'sold out', orderNote: 'Take-away or delivery, no waiting.', waNote: 'Pick your dishes, we receive your order on WhatsApp.', happy: 'Happy hour now', in: 'in',
    opensToday: 'Opens today', opensTomorrow: 'Opens tomorrow', opensOn: 'Opens {d}',
    days: { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' } as Record<string, string>,
    add: 'Add', search: 'Search a dish', all: 'All', none: 'No dish matches.', basket: 'Your order', see: 'View order', total: 'Total', yourName: 'Your first name', takeaway: 'Take-away', delivery: 'Delivery', dineIn: 'Dine in', addr: 'Delivery address', note: 'Note (optional)', send: 'Send on WhatsApp', close: 'Close', choose: 'Choose', empty: 'Your order is empty.', waHello: 'Hello {r}, I would like to order:', waName: 'Name', waAddr: 'Address', waNoteL: 'Note', waFoot: 'Sent from your website', waHint: 'WhatsApp opens with your message ready. Just press send.', orderWa: 'Order on WhatsApp',
    tags: { popular: 'Popular', spicy: 'Spicy', new: 'New', vegetarian: 'Vegetarian' } as Record<string, string>,
    vitrine: 'In the window', cater: 'Orders and events', caterText: 'Birthday cakes, platters and pieces for your parties, weddings and seminars. Tell us the date and the number of guests, we prepare a quote for you.', caterBtn: 'Ask for a quote', caterWa: 'Hello {r}, I would like a quote for an order. Date: … Number of guests: … What I would like: …', perKg: 'per kg',
    story: 'Our story', recommends: 'The house recommends', chapter: 'Chapter', reqTitle: 'Host with us', reqText: 'A group, a birthday, a private event or catering: tell us everything, we call you back with a proposal.', kinds: { group: 'Group', private: 'Private event', catering: 'Catering', other: 'Other' } as Record<string, string>, fName: 'Your name', fPhone: 'Phone', fDate: 'Date', fGuests: 'Guests', fMsg: 'Your request', fSend: 'Send the request', fSent: 'Thank you, your request has arrived. We will call you back soon.', reqWa: 'Also send it on WhatsApp', reqWaMsg: 'Hello, I just sent a request on your website.', fErr: 'Could not send. Check the number and the date, or call us.', fMany: 'Too many requests today. Please call us directly.' },
  ar: { menu: 'القائمة', infos: 'معلومات', book: 'احجز طاولة', order: 'اطلب عبر الإنترنت', orderShort: 'اطلب', bookShort: 'احجز', directions: 'الاتجاهات', call: 'اتصل', hours: 'أوقات العمل', address: 'العنوان', fullMenu: 'القائمة الكاملة', signature: 'أطباقنا المميزة', gallery: 'صور', open: 'مفتوح الآن', closed: 'مغلق الآن', closedDay: 'مغلق', today: 'اليوم', from: 'ابتداء من', review: 'اترك تقييما على غوغل', made: 'موقع من إنجاز Amplify', about: 'مرحبا بكم', soldOut: 'نفد', orderNote: 'للأخذ أو التوصيل، بدون انتظار.', waNote: 'اختر أطباقك، ونستلم طلبك عبر واتساب.', happy: 'ساعة التخفيض الآن', in: 'في',
    opensToday: 'يفتح اليوم', opensTomorrow: 'يفتح غدا', opensOn: 'يفتح يوم {d}',
    days: { mon: 'الاثنين', tue: 'الثلاثاء', wed: 'الأربعاء', thu: 'الخميس', fri: 'الجمعة', sat: 'السبت', sun: 'الأحد' } as Record<string, string>,
    add: 'أضف', search: 'ابحث عن طبق', all: 'الكل', none: 'لا يوجد طبق مطابق.', basket: 'طلبك', see: 'عرض الطلب', total: 'المجموع', yourName: 'اسمك', takeaway: 'للأخذ', delivery: 'توصيل', dineIn: 'في المطعم', addr: 'عنوان التوصيل', note: 'ملاحظة (اختياري)', send: 'أرسل عبر واتساب', close: 'إغلاق', choose: 'اختر', empty: 'طلبك فارغ.', waHello: 'مرحبا {r}، أريد أن أطلب:', waName: 'الاسم', waAddr: 'العنوان', waNoteL: 'ملاحظة', waFoot: 'أرسل من موقعكم', waHint: 'يفتح واتساب ورسالتك جاهزة. اضغط إرسال فقط.', orderWa: 'اطلب عبر واتساب',
    tags: { popular: 'الأكثر طلبا', spicy: 'حار', new: 'جديد', vegetarian: 'نباتي' } as Record<string, string>,
    vitrine: 'في الواجهة', cater: 'الطلبيات والمناسبات', caterText: 'كعكات أعياد الميلاد، صواني وقطع لحفلاتكم وأعراسكم وندواتكم. أخبرونا بالتاريخ وعدد الأشخاص، ونحضّر لكم عرض سعر.', caterBtn: 'اطلب عرض سعر', caterWa: 'مرحبا {r}، أريد عرض سعر لطلبية. التاريخ: … عدد الأشخاص: … ما أريده: …', perKg: 'للكيلو',
    story: 'حكايتنا', recommends: 'اختيارات البيت', chapter: 'الفصل', reqTitle: 'استقبالكم عندنا', reqText: 'مجموعة، عيد ميلاد، حفل خاص أو ممون: أخبرونا بكل شيء، ونتصل بكم بعرض.', kinds: { group: 'مجموعة', private: 'حفل خاص', catering: 'ممون', other: 'أخرى' } as Record<string, string>, fName: 'اسمك', fPhone: 'الهاتف', fDate: 'التاريخ', fGuests: 'عدد الأشخاص', fMsg: 'طلبك', fSend: 'أرسل الطلب', fSent: 'شكرا، وصل طلبك. سنتصل بك قريبا.', reqWa: 'أخبروهم أيضا عبر واتساب', reqWaMsg: 'السلام عليكم، أرسلت للتو طلبا عبر موقعكم.', fErr: 'تعذر الإرسال. تحقق من الرقم والتاريخ، أو اتصل بنا.', fMany: 'طلبات كثيرة اليوم. اتصل بنا مباشرة.' },
};
type Tx = typeof T.fr;
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const SCHEMA_DAY: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

// colour, type and fonts per style
const THEMES: Record<Theme, { bg: string; surface: string; line: string; ink: string; muted: string; accent: string; accentInk: string; gold: string; display: string; displayAr: string; fonts: string; dark: boolean }> = {
  riad: { bg: '#EFE3D1', surface: '#F7EEE1', line: 'rgba(46,31,23,.14)', ink: '#2E1F17', muted: '#6E5A4A', accent: '#1E5B4F', accentInk: '#F7EEE1', gold: '#B8862B',
    display: "'Cormorant Garamond', Georgia, serif", displayAr: "'Amiri', serif", fonts: 'family=Cormorant+Garamond:wght@500;600;700&family=Amiri:wght@400;700', dark: false },
  nuit: { bg: '#12100E', surface: '#1C1915', line: 'rgba(233,225,211,.12)', ink: '#ECE4D6', muted: '#9C9282', accent: '#C9A15A', accentInk: '#17120A', gold: '#C9A15A',
    display: "'Bodoni Moda', Didot, serif", displayAr: "'IBM Plex Sans Arabic', sans-serif", fonts: 'family=Bodoni+Moda:opsz,wght@6..96,500;6..96,600;6..96,700', dark: true },
  moderne: { bg: '#FFFFFF', surface: '#F2F2EE', line: 'rgba(22,24,29,.1)', ink: '#16181D', muted: '#5D616B', accent: '#2540C9', accentInk: '#FFFFFF', gold: '#F2B33D',
    display: "'Bricolage Grotesque', system-ui, sans-serif", displayAr: "'IBM Plex Sans Arabic', sans-serif", fonts: 'family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800', dark: false },
  // chocolate ink, pistachio awning, caramel price tags on almost-white paper
  atelier: { bg: '#FFFCF7', surface: '#F5EFE6', line: 'rgba(43,26,18,.12)', ink: '#2B1A12', muted: '#7A6558', accent: '#557F3E', accentInk: '#FFFCF7', gold: '#B9803A',
    display: "'Italiana', 'Bodoni Moda', Didot, serif", displayAr: "'Amiri', serif", fonts: 'family=Italiana&family=Amiri:wght@400;700', dark: false },
  // lime-washed plaster, olive-black ink, Majorelle blue, a little saffron
  maison: { bg: '#F1EFE9', surface: '#E7E3D9', line: 'rgba(31,36,32,.14)', ink: '#1F2420', muted: '#5E625A', accent: '#2F3FA3', accentInk: '#F1EFE9', gold: '#C49A3A',
    display: "'Gloock', Georgia, serif", displayAr: "'Amiri', serif", fonts: 'family=Gloock&family=Amiri:wght@400;700', dark: false },
  // mint tea at night: green-black, cream, a pale mint for prices and actions
  signature: { bg: '#0E1512', surface: '#17211C', line: 'rgba(236,230,216,.13)', ink: '#ECE6D8', muted: '#A0AAA1', accent: '#A9D8BE', accentInk: '#0E1512', gold: '#D4B483',
    display: "'Instrument Serif', Georgia, serif", displayAr: "'Amiri', serif", fonts: 'family=Instrument+Serif:ital@0;1&family=Amiri:wght@400;700', dark: true },
};

// a zellige tile: an eight-pointed star in a square lattice
const zellige = (c: string, o = 1) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='56' height='56' viewBox='0 0 56 56'><g fill='none' stroke='${c}' stroke-opacity='${o}' stroke-width='1.3'><rect x='16' y='16' width='24' height='24'/><rect x='16' y='16' width='24' height='24' transform='rotate(45 28 28)'/><circle cx='28' cy='28' r='5'/><path d='M0 0l11 11M56 0L45 11M0 56l11-11M56 56L45 45'/></g></svg>`)}")`;
const STAR = '<svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1l2.9 4.1L19.8 4.2l-.9 4.9L23 12l-4.1 2.9.9 4.9-4.9-.9L12 23l-2.9-4.1-4.9.9.9-4.9L1 12l4.1-2.9-.9-4.9 4.9.9z"/></svg>';

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

export function nextOpening(hours: Record<string, [string, string][]>, tz: string, at = new Date()) {
  if (!hours || !Object.keys(hours).length) return null;
  const { dow, hm } = localNow(tz, at);
  const i = DAYS.indexOf(dow);
  for (let off = 0; off <= 7; off++) {
    const day = DAYS[(i + off) % 7];
    const starts = (hours[day] ?? []).map(([s]) => s).filter(s => off > 0 || s > hm).sort();
    if (starts.length) return { off, day, time: starts[0] };
  }
  return null;
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
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  wa: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1a4 4 0 0 1-2-2l1-1-1-2z"/>',
};
const icon = (n: string, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

function css(k: Theme, th: typeof THEMES.nuit, accent: string, rtl: boolean) {
  const disp = rtl ? th.displayAr : th.display;
  return `
:root{--bg:${th.bg};--surface:${th.surface};--line:${th.line};--ink:${th.ink};--muted:${th.muted};--accent:${accent};--accent-ink:${th.accentInk};--gold:${th.gold};--display:${disp};--r:${k === 'moderne' ? '26px' : k === 'riad' ? '6px' : k === 'atelier' ? '18px' : k === 'maison' ? '4px' : k === 'signature' ? '3px' : '2px'}}
*{box-sizing:border-box;margin:0}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{background:var(--bg);color:var(--ink);font:16px/1.6 ${rtl ? "'IBM Plex Sans Arabic'," : ''}'Manrope',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}img,video{display:block;max-width:100%}button,input,textarea{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.w{max-width:1160px;margin:0 auto;padding:0 20px}
.i{width:18px;height:18px;flex:none}
h1,h2,h3{font-family:var(--display);font-weight:600;line-height:1.04;letter-spacing:${rtl ? '0' : '-.015em'};text-wrap:balance}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap;min-height:48px;padding:0 22px;border-radius:999px;font-weight:600;font-size:15px;border:0;cursor:pointer;transition:transform .15s,background .2s}
.btn:active{transform:scale(.97)}.btn.p{background:var(--accent);color:var(--accent-ink)}
.btn.g{border:1px solid var(--line);background:color-mix(in srgb,var(--surface) 75%,transparent);backdrop-filter:blur(8px)}
.btn.wa{background:#1FA855;color:#fff}
header.nav{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
header.nav .w{display:flex;align-items:center;gap:14px;height:66px}
.logo{width:40px;height:40px;border-radius:50%;object-fit:cover;background:var(--surface)}
.brand{font-family:var(--display);font-weight:600;font-size:22px;margin-inline-end:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.links{display:flex;gap:24px;font-size:15px;color:var(--muted)}.links a:hover{color:var(--ink)}
.langs{display:flex;gap:2px;font-size:13px;font-weight:700}.langs a{padding:5px 9px;border-radius:999px;color:var(--muted)}.langs a.on{background:var(--surface);color:var(--ink)}
.nav .btn{min-height:42px;padding:0 18px;font-size:14px}
.chip{display:inline-flex;align-items:center;gap:7px;padding:7px 14px;border-radius:999px;font-size:14px;font-weight:600}
.dot{width:8px;height:8px;border-radius:50%;background:#3DDC84;box-shadow:0 0 0 4px rgba(61,220,132,.2)}.dot.c{background:#F47171;box-shadow:0 0 0 4px rgba(244,113,113,.2)}
.ctas{display:flex;flex-wrap:wrap;gap:10px}
section{padding:96px 0}
.h2{font-size:clamp(36px,5vw,60px)}
.lead{font-size:clamp(18px,2vw,21px);color:var(--muted);max-width:60ch;white-space:pre-line}
.price{font-weight:700;color:var(--accent);white-space:nowrap;font-variant-numeric:tabular-nums}.price s{color:var(--muted);font-weight:500;margin-inline-end:6px}
.addb{display:inline-grid;place-items:center;width:40px;height:40px;border-radius:50%;border:0;background:var(--accent);color:var(--accent-ink);cursor:pointer;flex:none;transition:transform .15s}.addb:active{transform:scale(.9)}
.addb.bump{animation:bump .35s}@keyframes bump{50%{transform:scale(1.25)}}
.hrs{width:100%;border-collapse:collapse;font-size:15px}.hrs td{padding:8px 0;border-bottom:1px solid var(--line)}.hrs td:last-child{text-align:end;font-variant-numeric:tabular-nums}.hrs tr.on td{color:var(--accent);font-weight:700}
.map{width:100%;height:260px;border:0;border-radius:var(--r);margin-top:18px;${th.dark ? 'filter:invert(.9) hue-rotate(180deg) brightness(.92) contrast(.9)' : ''}}
.info{display:grid;grid-template-columns:1fr 1fr;gap:28px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:30px}
.card h3{font-size:26px;display:flex;align-items:center;gap:10px;margin-bottom:16px}
.row{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
.ordr{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center;background:var(--accent);color:var(--accent-ink);border-radius:var(--r);padding:48px}
.ordr h2{font-size:clamp(32px,4vw,50px)}.ordr p{opacity:.85;margin-top:8px;max-width:46ch}.ordr .btn{background:var(--accent-ink);color:var(--accent)}
footer{padding:56px 0 120px;color:var(--muted);font-size:14px;border-top:1px solid var(--line)}
footer .w{display:flex;flex-wrap:wrap;gap:18px;justify-content:space-between;align-items:center}
.soc{display:flex;gap:8px}.soc a{width:44px;height:44px;display:grid;place-items:center;border-radius:50%;background:var(--surface);color:var(--ink)}
.made{display:inline-flex;align-items:center;gap:6px;opacity:.85}.made b{color:var(--ink)}
.bar{position:fixed;inset-inline:12px;bottom:max(12px,env(safe-area-inset-bottom));z-index:30;display:none;gap:8px;padding:7px;border-radius:999px;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(14px);border:1px solid var(--line);box-shadow:0 20px 40px -18px rgba(0,0,0,.45)}
.bar .btn{flex:1;min-height:46px;padding:0 10px}
/* menu page */
.mhead{padding-block:64px 28px}.mhead h1{font-size:clamp(48px,8vw,104px)}
.tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:26px}
.srch{display:flex;align-items:center;gap:8px;flex:1 1 260px;max-width:380px;height:46px;padding:0 16px;border-radius:999px;border:1px solid var(--line);background:var(--surface)}
.srch input{border:0;background:none;outline:none;flex:1;min-width:0;font-size:15px}
.flt{display:flex;flex-wrap:wrap;gap:6px}
.flt button,.cats a{display:inline-flex;align-items:center;height:40px;padding:0 16px;border-radius:999px;border:1px solid var(--line);background:none;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;color:var(--muted)}
.flt button[aria-pressed=true],.cats a.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.cats{position:sticky;top:66px;z-index:10;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.cats .w{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-top:10px;padding-bottom:10px}.cats .w::-webkit-scrollbar{display:none}
.mcat{padding:56px 0 8px;scroll-margin-top:140px}.mcat>h2{font-size:clamp(34px,4.4vw,52px);margin-bottom:22px}
.mi{display:flex;gap:16px;align-items:flex-start;padding:18px 0;border-bottom:1px solid var(--line)}
.mi .ph{width:96px;height:96px;border-radius:var(--r);object-fit:cover;flex:none;background:var(--surface)}
.mi .b{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.mi .n{display:flex;align-items:baseline;gap:10px;font-weight:700;font-size:18px}
.mi .n .nm{flex:1}
.mi p{font-size:14.5px;color:var(--muted)}.mi.so{opacity:.5}
.tg{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}.tg span{font-size:12px;font-weight:700;padding:2px 9px;border-radius:999px;background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent)}
.nores{padding:60px 0;text-align:center;color:var(--muted);display:none}
/* basket */
.cf{position:fixed;inset-inline:12px;bottom:max(12px,env(safe-area-inset-bottom));z-index:35;display:none;margin:0 auto;max-width:520px;align-items:center;justify-content:space-between;gap:12px;min-height:58px;padding:0 10px 0 22px;border-radius:999px;border:0;background:var(--ink);color:var(--bg);font-weight:700;font-size:16px;cursor:pointer;box-shadow:0 24px 50px -20px rgba(0,0,0,.6)}
.cf.on{display:flex;animation:up .35s cubic-bezier(.2,.8,.2,1)}@keyframes up{from{transform:translateY(120%)}}
.cf .n{display:inline-grid;place-items:center;min-width:30px;height:30px;padding:0 8px;border-radius:999px;background:var(--accent);color:var(--accent-ink);font-size:14px;margin-inline-end:10px}
.cf .t{display:inline-flex;align-items:center;gap:10px;padding:10px 18px;border-radius:999px;background:color-mix(in srgb,var(--bg) 14%,transparent)}
dialog{border:0;padding:0;margin:auto auto 0;width:100%;max-width:560px;max-height:92vh;border-radius:28px 28px 0 0;background:var(--bg);color:var(--ink);box-shadow:0 -20px 60px rgba(0,0,0,.35)}
dialog[open]{animation:sheet .3s cubic-bezier(.2,.8,.2,1)}@keyframes sheet{from{transform:translateY(40%);opacity:0}}
dialog::backdrop{background:rgba(10,8,6,.55);backdrop-filter:blur(3px)}
.dh{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:20px 22px 12px}.dh h2{font-size:28px}
.xb{width:42px;height:42px;display:grid;place-items:center;border-radius:50%;border:0;background:var(--surface);cursor:pointer}
.db{padding:0 22px 22px;overflow-y:auto;max-height:calc(92vh - 74px)}
.cl{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}.cl .nm{flex:1;font-weight:600}.cl .nm small{display:block;color:var(--muted);font-weight:500}
.qty{display:flex;align-items:center;gap:6px}.qty button{width:34px;height:34px;display:grid;place-items:center;border-radius:50%;border:1px solid var(--line);background:none;cursor:pointer}.qty b{min-width:20px;text-align:center}
.tot{display:flex;justify-content:space-between;font-size:20px;font-weight:800;padding:16px 0}
.seg{display:flex;gap:6px;padding:4px;border-radius:999px;background:var(--surface);margin:6px 0 14px}.seg label{flex:1;text-align:center;padding:10px 6px;border-radius:999px;font-weight:600;font-size:14px;cursor:pointer}.seg input{position:absolute;opacity:0;pointer-events:none}.seg label:has(input:checked){background:var(--ink);color:var(--bg)}
.fld{display:block;margin-bottom:12px}.fld[hidden]{display:none}.fld span{display:block;font-size:13px;font-weight:700;color:var(--muted);margin-bottom:6px}
.fld input,.fld textarea{width:100%;border:1px solid var(--line);background:var(--surface);border-radius:14px;padding:12px 14px;font-size:16px;outline:none}.fld input:focus,.fld textarea:focus{border-color:var(--accent)}
.hint{font-size:13px;color:var(--muted);text-align:center;margin-top:10px}
.vr{display:flex;justify-content:space-between;align-items:center;width:100%;padding:16px;margin-bottom:8px;border-radius:16px;border:1px solid var(--line);background:var(--surface);font-weight:600;cursor:pointer;text-align:start}
.star{width:18px;height:18px;color:var(--gold)}
${k === 'riad' ? riadCss(th) : k === 'nuit' ? nuitCss() : k === 'atelier' ? atelierCss() : k === 'maison' ? maisonCss() + requestCss() : k === 'signature' ? signatureCss() + requestCss() : modCss()}
@media (max-width:860px){.links{display:none}.info,.ordr{grid-template-columns:1fr}.nav .btn{display:none}.bar{display:flex}section{padding:68px 0}.ordr{padding:32px}.card{padding:24px}.has-cart .bar{display:none}}
@media (prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}html{scroll-behavior:auto}}
`;
}

function riadCss(th: typeof THEMES.riad) {
  return `
.t-riad .brand{font-size:26px;font-weight:700}
.t-riad .btn{border-radius:4px}.t-riad .btn.p{background:var(--accent)}
.zb{height:44px;background:${zellige(th.accent, .55)} center/44px,var(--surface);border-block:1px solid var(--line)}
.rh{display:grid;grid-template-columns:1.05fr .95fr;gap:56px;align-items:center;padding-block:56px 72px}
.rh .k{font-size:17px;color:var(--accent);font-weight:600;display:flex;align-items:center;gap:10px}
.rh h1{font-size:clamp(58px,8.6vw,124px);font-weight:600;margin:14px 0 18px;line-height:.92}
.rh .t{font-family:var(--display);font-size:clamp(22px,2.6vw,30px);font-style:italic;color:var(--muted);max-width:28ch;line-height:1.25}
.rh .chips{display:flex;flex-wrap:wrap;gap:8px;margin:26px 0}.rh .chip{background:var(--surface);border:1px solid var(--line)}
.arch{position:relative;justify-self:center;width:min(100%,460px)}
.arch .a1{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:999px 999px 6px 6px;box-shadow:0 30px 60px -30px rgba(46,31,23,.5)}
.arch:before{content:"";position:absolute;inset:-16px -16px 26px;border:1.5px solid var(--gold);border-radius:999px 999px 8px 8px;opacity:.7}
.arch .a2{position:absolute;width:42%;aspect-ratio:3/4;object-fit:cover;border-radius:999px 999px 4px 4px;inset-inline-start:-14%;bottom:-6%;border:6px solid var(--bg)}
.arch.none{aspect-ratio:3/4;border-radius:999px 999px 6px 6px;background:${zellige(th.accentInk, .35)} center/60px,var(--accent)}
.orn{display:flex;align-items:center;justify-content:center;gap:14px;color:var(--gold);margin-bottom:18px}.orn:before,.orn:after{content:"";height:1px;width:64px;background:currentColor;opacity:.6}
.t-riad .sc{text-align:center}.t-riad .sc .lead{margin:18px auto 0}
.t-riad .dishes{display:grid;grid-template-columns:repeat(3,1fr);gap:34px 28px;margin-top:48px}
.t-riad .dish{text-align:center;display:flex;flex-direction:column;align-items:center}
.t-riad .dish .ph{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:999px 999px 6px 6px;background:var(--surface)}.t-riad div.ph{background:${zellige(th.accent, .35)} center/48px,var(--surface)}
.t-riad .dish h3{font-size:28px;margin-top:18px}.t-riad .dish p{font-size:15px;color:var(--muted);margin-top:6px;max-width:34ch}
.t-riad .dish .ft{display:flex;align-items:center;gap:12px;margin-top:12px}
.t-riad .gal{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:44px}
.t-riad .gal img{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:999px 999px 6px 6px}.t-riad .gal img:nth-child(even){margin-top:44px}
.t-riad .ordr{background:${zellige(th.accentInk, .16)} center/56px,var(--accent);border-radius:6px;text-align:center;grid-template-columns:1fr;justify-items:center}
.t-riad .mhead{text-align:center}.t-riad .mhead .tools{justify-content:center}
.t-riad .mcat>h2{text-align:center}.t-riad .mcat>h2:after{content:"";display:block;height:14px;margin:14px auto 0;width:120px;background:${zellige(th.gold, .9)} center/14px repeat-x}
.t-riad .mlist{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 56px}
.t-riad .mi{border-bottom:0;padding:14px 0}
.t-riad .mi .ph{width:68px;height:68px;border-radius:50%}
.t-riad .mi .n{font-family:var(--display);font-size:23px;font-weight:600}
.t-riad .mi .n .ld{flex:1;border-bottom:2px dotted var(--line);transform:translateY(-6px);min-width:20px}.t-riad .mi .n .nm{flex:0 1 auto}
.t-riad .mi .price{color:var(--ink);font-family:'Manrope',sans-serif;font-size:16px}
@media (max-width:860px){.arch .a2{inset-inline-start:-8%;width:36%}.rh{grid-template-columns:1fr;gap:44px;padding-block:36px 56px;text-align:center}.rh .k,.rh .chips,.rh .ctas{justify-content:center}.rh .t{margin:0 auto}.arch{width:min(78%,360px)}.t-riad .dishes{grid-template-columns:1fr 1fr;gap:28px 16px}.t-riad .dish h3{font-size:22px}.t-riad .gal{grid-template-columns:1fr 1fr}.t-riad .mlist{grid-template-columns:minmax(0,1fr)}.t-riad .mi .n{flex-wrap:wrap;row-gap:2px}.t-riad .mi .n .nm{flex:1 1 100%}.t-riad .mi .ld{display:none}}
@media (max-width:520px){.t-riad .dishes{grid-template-columns:1fr}.t-riad .dish .ph{width:82%}}
`;
}
function nuitCss() {
  return `
.t-nuit header.nav{position:fixed;inset-inline:0;background:linear-gradient(180deg,rgba(0,0,0,.6),transparent);border:0;backdrop-filter:none;color:#fff}
.t-nuit.pg-menu header.nav,.t-nuit header.nav.solid{position:sticky;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--line);color:var(--ink)}
.t-nuit .brand{font-size:24px;letter-spacing:.01em}
.t-nuit .langs a.on{background:rgba(255,255,255,.14);color:inherit}
.nh{position:relative;height:100svh;min-height:600px;overflow:hidden;background:#000;color:#F5EEE2}
.nh .m{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.78;animation:kb 22s ease-out forwards}
@keyframes kb{from{transform:scale(1.12)}to{transform:scale(1)}}
.nh:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.35),transparent 30%,transparent 45%,rgba(0,0,0,.9))}
.nh.none{background:radial-gradient(90% 70% at 70% 20%,rgba(201,161,90,.22),transparent 60%),#000}
.nh .in{position:absolute;inset:auto 0 0;z-index:1;padding-bottom:28px}
.nh h1{font-size:clamp(64px,13vw,200px);font-weight:500;line-height:.86;letter-spacing:-.035em;animation:rise 1.2s .2s cubic-bezier(.2,.8,.2,1) both}
@keyframes rise{from{opacity:0;transform:translateY(40px)}}
.nh .t{font-family:var(--display);font-style:italic;font-size:clamp(20px,2.4vw,28px);margin-top:14px;opacity:.85;max-width:34ch}
.nh .ctas{margin-top:28px}.nh .btn.g{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.22);color:#fff}
.lb{display:flex;flex-wrap:wrap;gap:12px 28px;align-items:center;margin-top:34px;padding-top:18px;border-top:1px solid rgba(255,255,255,.18);font-size:14px;color:rgba(245,238,226,.78)}
.lb span{display:inline-flex;align-items:center;gap:8px}
.t-nuit .ab{display:grid;grid-template-columns:.8fr 1.2fr;gap:64px;align-items:end}
.t-nuit .ab .q{font-family:var(--display);font-size:clamp(26px,3.2vw,40px);line-height:1.25;white-space:pre-line}
.t-nuit .ab img{width:100%;aspect-ratio:3/4;object-fit:cover}
.strip{--g:max(20px,calc((100vw - 1120px)/2));display:grid;grid-auto-flow:column;grid-auto-columns:min(78vw,340px);gap:18px;overflow-x:auto;scroll-snap-type:x mandatory;padding:6px var(--g) 24px;scroll-padding-inline:var(--g);scrollbar-width:thin;scrollbar-color:var(--gold) transparent}
.t-nuit .dish{scroll-snap-align:start;position:relative;display:flex;flex-direction:column}
.t-nuit .dish .ph{width:100%;aspect-ratio:3/4;object-fit:cover;background:var(--surface);filter:saturate(1.05) contrast(1.05)}.t-nuit div.ph{background:radial-gradient(60% 50% at 50% 40%,rgba(201,161,90,.18),transparent),var(--surface)}
.t-nuit .dish .b{padding-top:16px;display:flex;flex-direction:column;gap:6px}
.t-nuit .dish h3{font-size:26px;font-weight:500}.t-nuit .dish p{font-size:14px;color:var(--muted)}
.t-nuit .dish .ft{display:flex;justify-content:space-between;align-items:center;margin-top:6px}
.t-nuit .sh{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:34px}
.t-nuit .gal{display:grid;grid-template-columns:2fr 1fr 1fr;grid-auto-rows:240px;gap:6px}
.t-nuit .gal img{width:100%;height:100%;object-fit:cover}.t-nuit .gal img:first-child{grid-row:span 2}.t-nuit .gal.n4 img:last-child{grid-column:span 2}
.t-nuit .ordr{background:linear-gradient(120deg,#2A2116,#14100C);color:var(--ink);border:1px solid rgba(201,161,90,.35)}.t-nuit .ordr .btn{background:var(--accent);color:var(--accent-ink)}
.t-nuit .mi .ph{order:2;width:110px;height:110px}
.t-nuit .mi .n{font-family:var(--display);font-size:24px;font-weight:500}
.t-nuit .mlist{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 48px}
@media (max-width:860px){.nh h1{font-size:clamp(56px,17vw,120px)}.t-nuit .ab{grid-template-columns:1fr;gap:32px}.t-nuit .gal{grid-template-columns:1fr 1fr;grid-auto-rows:170px}.t-nuit .gal img:first-child{grid-column:span 2;grid-row:auto}.t-nuit .mlist{grid-template-columns:minmax(0,1fr)}.t-nuit .mi .n{flex-wrap:wrap;row-gap:2px}.t-nuit .mi .n .nm{flex:1 1 100%}.t-nuit .mi .ph{width:92px;height:92px}.lb{gap:10px 18px}.nh .in{padding-bottom:96px}}
`;
}
function modCss() {
  return `
.t-moderne .brand{font-weight:800;letter-spacing:-.03em}
.t-moderne h1,.t-moderne h2,.t-moderne h3{font-weight:800;letter-spacing:-.035em}
.bento{display:grid;grid-template-columns:2fr 1fr 1fr;grid-template-rows:minmax(250px,auto) minmax(250px,auto);gap:14px;padding-block:18px 40px}
.bx{position:relative;border-radius:28px;overflow:hidden;background:var(--surface);padding:26px;display:flex;flex-direction:column}
.bx.big{grid-row:span 2;padding:0;min-height:560px;justify-content:flex-end;color:#fff}
.bx.big>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.bx.big:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 40%,rgba(0,0,0,.75))}
.bx.big.none{background:var(--accent)}.bx.big.none:after{display:none}
.bx.big .in{position:relative;z-index:1;padding:32px}
.bx.big h1{font-size:clamp(48px,5.6vw,84px);line-height:.92}
.bx.big .t{font-size:clamp(17px,1.6vw,20px);opacity:.9;margin-top:12px;max-width:34ch}
.bx.big .ctas{margin-top:22px}.bx.big .btn.g{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.28);color:#fff}
.bx.ph{padding:0;justify-content:flex-end}.bx.ph>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.bx.ph .tag{position:relative;margin:14px;align-self:flex-start;display:flex;align-items:center;gap:10px;padding:8px 8px 8px 16px;border-radius:999px;background:#fff;color:#16181D;font-weight:700;font-size:14px;box-shadow:0 10px 30px -10px rgba(0,0,0,.35)}
.bx.ph .tag .price{color:var(--accent)}.bx.ph .tag{max-width:calc(100% - 28px);flex-wrap:wrap;row-gap:0}
.bx.ac{background:var(--accent);color:var(--accent-ink);justify-content:space-between}.bx.ac h2{font-size:34px}.bx.ac .btn{background:var(--accent-ink);color:var(--accent);align-self:flex-start}
.bx .lbl{font-size:14px;font-weight:700;color:var(--muted);display:flex;align-items:center;gap:8px}
.bx .big-n{font-family:var(--display);font-size:44px;font-weight:800;letter-spacing:-.03em;line-height:1;margin-top:auto}
.bx .sub{color:var(--muted);margin-top:8px;font-size:15px}
.bx.adr .big-n{font-size:clamp(22px,2.4vw,30px);line-height:1.08;overflow-wrap:anywhere}
.rm-wave{height:56px;margin-top:-1px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 56' preserveAspectRatio='none'%3E%3Cpath fill='%23F4EDE0' d='M0 28C240 0 480 56 720 28S1200 0 1440 28V56H0Z'/%3E%3C/svg%3E") center bottom/100% 100% no-repeat}
.rm-wave.dn{transform:scaleY(-1);margin:-1px 0 0}
.rm-sand{background:var(--surface)}.rm .rm-sand .dish{background:#fff}
.rm .bx.big>img{filter:brightness(.9) contrast(1.06) saturate(1.05)}
.rm .bx.big:after{background:linear-gradient(180deg,rgba(8,22,42,.28) 0%,rgba(8,22,42,.04) 28%,rgba(8,22,42,.55) 60%,rgba(8,22,42,.9) 100%)}
.rm .bx.big h1{text-shadow:0 2px 28px rgba(0,0,0,.4)}.rm .bx.big .t{text-shadow:0 1px 14px rgba(0,0,0,.45)}
@media (max-width:860px){.rm-wave{height:34px}}
.bx.adr .btn{margin-top:18px;align-self:flex-start;min-height:44px;padding:0 18px;font-size:14px;background:var(--ink);color:var(--bg)}
.t-moderne .sh{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:30px}
.t-moderne .dishes,.t-moderne .mlist{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.t-moderne .dish,.t-moderne .mi{position:relative;display:flex;flex-direction:column;gap:0;padding:0;border:0;border-radius:24px;background:var(--surface);overflow:hidden}
.t-moderne .dish .ph,.t-moderne .mi .ph{width:100%;height:auto;aspect-ratio:4/3;border-radius:0;object-fit:cover}
.t-moderne .dish .b,.t-moderne .mi .b{padding:18px 20px 20px;display:flex;flex-direction:column;gap:6px;flex:1}
.t-moderne .dish h3{font-size:22px}.t-moderne .dish p{font-size:14px;color:var(--muted)}
.t-moderne .ft{display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:8px}
.t-moderne .mi .n{font-size:19px;font-weight:800;letter-spacing:-.02em}
.t-moderne .mi .ft .price{font-size:17px}
.t-moderne .mi:not(:has(.ph)) .b{padding-top:22px}
.t-moderne .gal{display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:220px;gap:14px}
.t-moderne .gal img{width:100%;height:100%;object-fit:cover;border-radius:24px}.t-moderne .gal img:first-child{grid-column:span 2;grid-row:span 2}.t-moderne .gal.n4 img:last-child{grid-column:span 2}
@media (max-width:980px){.bento{grid-template-columns:1fr 1fr}.bx.big{grid-column:span 2;grid-row:auto;min-height:72svh}}
@media (max-width:860px){.t-moderne .dishes,.t-moderne .mlist{grid-template-columns:1fr 1fr;gap:12px}.t-moderne .gal{grid-template-columns:1fr 1fr;grid-auto-rows:150px}.bx{padding:20px}.bx .big-n{font-size:34px}.bx.ac h2{font-size:26px}}
@media (max-width:520px){.bento{gap:10px}.bx{min-width:0}.bx.ac,.bx.ac+.bx{grid-column:1/-1}.bx.ac{gap:18px}.bx.ac h2{font-size:28px}.bx.ac .btn{max-width:100%}.bx.big .in{padding:24px}.t-moderne .dishes{grid-auto-flow:column;grid-auto-columns:78%;grid-template-columns:none;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:8px}.t-moderne .dish{scroll-snap-align:start}.t-moderne .mlist{grid-template-columns:1fr 1fr}.t-moderne .mi .b{padding:12px 14px 14px}.t-moderne .mi .n{font-size:16px}.t-moderne .mi p{display:none}.t-moderne .mi .addb{width:36px;height:36px}.t-moderne .mi .ft .price{font-size:15px;white-space:normal;line-height:1.25}.t-moderne .mi .ft .price s{display:block;font-size:13px}}
`;
}

function atelierCss() {
  return `
.t-atelier{--pale:color-mix(in srgb,var(--accent) 24%,#fff)}
.t-atelier h1,.t-atelier h2{font-weight:400;letter-spacing:${'0'}}
.t-atelier .brand{font-size:26px;font-weight:400}
.t-atelier header.nav{border-bottom:0}
/* the awning: stripes with a scalloped edge, the sign of a pâtisserie */
.aw{position:relative;z-index:2;height:34px;background:repeating-linear-gradient(90deg,var(--accent) 0 44px,var(--pale) 44px 88px)}
.aw:after{content:"";position:absolute;inset-inline:0;top:100%;height:22px;background:radial-gradient(circle at 22px 0,var(--accent) 21.5px,transparent 22.5px) 0 0/88px 22px repeat-x,radial-gradient(circle at 66px 0,var(--pale) 21.5px,transparent 22.5px) 0 0/88px 22px repeat-x;filter:drop-shadow(0 7px 6px rgba(43,26,18,.13))}
.ah{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center;padding-block:76px 84px}
.ah .k{font-family:var(--display);font-size:22px;color:var(--gold)}
.ah h1{font-size:clamp(64px,9.4vw,148px);line-height:.88;margin:12px 0 20px}.ah h1.long{font-size:clamp(52px,6.6vw,104px);line-height:.94}
.ah .t{font-size:clamp(19px,2vw,22px);color:var(--muted);max-width:32ch}
.ah .chips{display:flex;flex-wrap:wrap;gap:8px;margin:26px 0}.ah .chip{background:var(--surface)}
.ah .ph-w{position:relative}
.ah .ph-w img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:220px 220px 22px 22px;box-shadow:0 40px 70px -40px rgba(43,26,18,.55)}
.ah .ph-w.none{aspect-ratio:4/5;border-radius:220px 220px 22px 22px;background:radial-gradient(circle,var(--pale) 3px,transparent 3.5px) 0 0/22px 22px,var(--surface)}
.seal{position:absolute;inset-inline-start:-34px;bottom:46px;width:132px;height:132px;border-radius:50%;display:grid;place-content:center;text-align:center;gap:2px;background:var(--accent);color:var(--accent-ink);box-shadow:0 18px 40px -18px rgba(43,26,18,.6);transform:rotate(-8deg);outline:2px dashed color-mix(in srgb,var(--accent-ink) 55%,transparent);outline-offset:-9px}
.seal b{font-family:var(--display);font-size:30px;font-weight:400;line-height:1}.seal span{font-size:12px;font-weight:700;padding:0 16px;line-height:1.25}.seal span span{padding:0;white-space:nowrap}
.t-atelier .sh{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:46px}
.t-atelier .sh .k{display:block;font-family:var(--display);font-size:22px;color:var(--gold);margin-bottom:6px}
/* the shop window: each product on its plate, resting on a paper card with its price tag */
.t-atelier .dishes{display:grid;grid-template-columns:repeat(3,1fr);gap:64px 30px}
.t-atelier .dish{display:flex;flex-direction:column;align-items:center;text-align:center}
.t-atelier .dish .ph{position:relative;z-index:1;width:74%;aspect-ratio:1;object-fit:cover;border-radius:50%;background:var(--surface);box-shadow:0 0 0 10px #fff,0 0 0 11px var(--line),0 26px 34px -14px rgba(43,26,18,.45);transition:transform .5s cubic-bezier(.2,.8,.2,1)}
.t-atelier div.ph{background:radial-gradient(circle,var(--pale) 3px,transparent 3.5px) 0 0/20px 20px,var(--surface)}
.t-atelier .dish:hover .ph{transform:translateY(-6px) rotate(-3deg)}
.t-atelier .dish .b{width:100%;flex:1;margin-top:-44px;padding:62px 22px 24px;border-radius:var(--r);background:var(--surface);display:flex;flex-direction:column;align-items:center;gap:6px}
.t-atelier .dish h3{font-family:'Manrope',sans-serif;font-size:19px;font-weight:700;letter-spacing:-.01em}
.t-atelier .dish p{font-size:14.5px;color:var(--muted);max-width:30ch}
.t-atelier .dish .ft{display:flex;align-items:center;gap:12px;margin-top:auto;padding-top:10px}
.t-atelier .price{position:relative;display:inline-flex;align-items:baseline;gap:4px;padding:5px 14px 5px 24px;border-radius:999px;background:#fff;border:1px dashed var(--gold);color:var(--ink)}
.t-atelier .price:before{content:"";position:absolute;inset-inline-start:9px;top:50%;width:7px;height:7px;border-radius:50%;background:var(--surface);box-shadow:inset 0 0 0 1.5px var(--gold);transform:translateY(-50%)}
.t-atelier .price .kg{font-size:12px;font-weight:600;color:var(--muted)}
.t-atelier .about{display:grid;grid-template-columns:.9fr 1.1fr;gap:64px;align-items:center}
.t-atelier .about .q{font-size:clamp(20px,2.2vw,25px);line-height:1.55;white-space:pre-line}
.t-atelier .about img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:50%;box-shadow:0 0 0 12px var(--surface)}
/* orders and catering */
.cater{position:relative;overflow:hidden;display:grid;grid-template-columns:1.2fr .8fr;gap:30px;align-items:center;padding:58px 48px 48px;border-radius:var(--r);background:var(--ink);color:var(--bg)}
.cater:before{content:"";position:absolute;inset:0 0 auto;height:12px;background:repeating-linear-gradient(90deg,var(--accent) 0 44px,var(--pale) 44px 88px)}
.cater h2{font-size:clamp(38px,4.6vw,62px)}.cater p{margin-top:12px;opacity:.82;max-width:52ch}
.cater .ctas{justify-content:flex-end}.cater .btn.g{border-color:rgba(255,252,247,.3);background:transparent;color:var(--bg)}
.t-atelier .ordr{background:var(--accent);border-radius:var(--r)}
.t-atelier .gal{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.t-atelier .gal img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:var(--r)}.t-atelier .gal img:nth-child(3n+2){margin-top:46px}
/* menu: a window of plates */
.t-atelier .mhead h1{font-size:clamp(56px,9vw,120px)}
.t-atelier .mcat>h2{font-size:clamp(40px,5vw,64px)}
.t-atelier .mlist{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:34px 22px}
.t-atelier .mi{flex-direction:column;align-items:center;text-align:center;gap:14px;padding:0;border:0}
.t-atelier .mi .ph{width:72%;height:auto;aspect-ratio:1;border-radius:50%;box-shadow:0 0 0 8px #fff,0 0 0 9px var(--line),0 18px 26px -14px rgba(43,26,18,.45)}
.t-atelier .mi .b{width:100%;align-items:center}
.t-atelier .mi .n{justify-content:center;font-size:17px}
.t-atelier .mi .ft{display:flex;align-items:center;gap:10px;margin-top:6px}
@media (max-width:860px){.ah{grid-template-columns:1fr;gap:40px;padding-block:44px 64px}.ah .ph-w{width:min(84%,400px);justify-self:center}.seal{width:108px;height:108px;inset-inline-start:-22px;bottom:30px}.seal b{font-size:24px}.t-atelier .dishes{grid-template-columns:1fr 1fr;gap:44px 14px}.t-atelier .dish .b{padding:54px 12px 18px}.t-atelier .dish p{display:none}.t-atelier .about{grid-template-columns:1fr;gap:32px}.t-atelier .about img{width:70%;justify-self:center}.cater{grid-template-columns:1fr;padding:48px 24px 28px}.cater .ctas{justify-content:flex-start}.t-atelier .gal{grid-template-columns:1fr 1fr}.t-atelier .gal img:nth-child(3n+2){margin-top:0}.t-atelier .mlist{grid-template-columns:1fr 1fr}.t-atelier .mi p{display:none}}
@media (max-width:420px){.t-atelier .dish h3{font-size:16px}.t-atelier .price{padding:4px 10px 4px 20px;font-size:14px}}
`;
}
/** The request form of the premium styles (groups, private events, catering). */
function requestCss() {
  return `
/* request form */
.rq{display:grid;grid-template-columns:1fr 1.15fr;gap:56px;align-items:start}
.rq form{background:var(--surface);border-radius:var(--r);padding:30px}
.rq .grid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}
.rq .seg{flex-wrap:wrap}.rq .seg label{flex:1 1 40%}
.rq .ok{display:none;padding:22px;border-radius:var(--r);background:var(--accent);color:var(--accent-ink);font-weight:600}.rq .ok .btn{margin-top:16px}
.rq form.done{display:none}.rq form.done+.ok{display:block}
.rq .er{color:#B42318;font-size:14px;margin-top:10px;min-height:20px}
.hp{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;opacity:0;pointer-events:none}
@media (max-width:860px){.rq{grid-template-columns:1fr;gap:28px}.rq form{padding:20px}}
`;
}

function signatureCss() {
  return `
.t-signature{color-scheme:dark}
.t-signature h1,.t-signature h2,.t-signature h3{font-weight:400;letter-spacing:-.01em}
.t-signature .brand{font-size:26px;font-weight:400}
.t-signature .btn{border-radius:var(--r)}.t-signature .btn.g{background:transparent}
.t-signature .h2{font-size:clamp(40px,5.6vw,72px)}
.t-signature .sh{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:44px}
/* the opening shot: a full frame whose black bars open to cinema format */
.sgh{padding:0}
.sgh .fr{position:relative;height:calc(100svh - 66px);min-height:520px;overflow:hidden;background:#050806}
.sgh .fr.e{height:62vh}
.sgh .m{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;animation:sgz 2.6s cubic-bezier(.2,.7,.2,1) both}
@keyframes sgz{from{transform:scale(1.07)}}
.sgh .fr:after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,transparent 45%,rgba(5,8,6,.82))}
.lb:before,.lb:after{content:'';position:absolute;z-index:2;inset-inline:0;height:6.5vh;background:var(--bg);animation:lbo 1.5s cubic-bezier(.7,0,.2,1) .25s both}
.lb:before{top:0}.lb:after{bottom:0}
@keyframes lbo{from{height:50.5%}}
.cap{position:absolute;z-index:1;inset-inline:0;bottom:calc(6.5vh + 34px);text-align:center;padding:0 20px;color:#F6F1E6;animation:capin 1s ease 1.3s both}
@keyframes capin{from{opacity:0}}
.cap h1{font-size:clamp(58px,10.5vw,168px);line-height:.9;letter-spacing:-.02em;overflow-wrap:anywhere}
.cap .sub{font-family:var(--display);font-style:italic;font-size:clamp(19px,2.2vw,26px);margin-top:14px;opacity:.9}
.sgb{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:18px;padding-block:26px;border-bottom:1px solid var(--line)}
.sgb .chips{display:flex;flex-wrap:wrap;gap:8px}.sgb .chip{border:1px solid var(--line)}
/* the story: the frame stays, the scenes scroll past it */
.sgs .h2{margin-bottom:28px}
.sc{display:grid;grid-template-columns:1fr 1fr;gap:72px}
.stage{position:sticky;top:96px;height:calc(100vh - 140px);border-radius:var(--r);overflow:hidden;background:var(--surface)}
.stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transform:scale(1.04);transition:opacity .9s,transform 1.6s}
.stage img.on{opacity:1;transform:none}
.scene{min-height:78vh;display:flex;flex-direction:column;justify-content:center}
.scene .mob{display:none}
.scene .n{font-family:var(--display);font-style:italic;font-size:clamp(72px,8vw,120px);line-height:.9;color:var(--accent)}
.scene .lbl{display:block;margin-top:10px;font-size:14px;font-weight:700;color:var(--muted)}
.scene h3{font-size:clamp(34px,3.8vw,52px);margin-top:10px}
.scene p{margin-top:16px;font-size:18px;color:var(--muted);max-width:46ch;white-space:pre-line}
/* the house recommends: three film stills */
.still{margin:0 0 84px}.still:last-child{margin-bottom:0}
.still img{width:100%;aspect-ratio:21/9;object-fit:cover;border-radius:var(--r)}
.still figcaption{text-align:center;max-width:58ch;margin:26px auto 0}
.still h3{font-size:clamp(32px,3.6vw,48px)}
.still p{margin-top:10px;color:var(--muted);font-family:var(--display);font-style:italic;font-size:21px;white-space:pre-line}
.still .ft{display:inline-flex;align-items:center;gap:14px;margin-top:16px}
.js .rv{opacity:.2;transform:scale(.97);transition:opacity 1.1s,transform 1.4s cubic-bezier(.2,.8,.2,1)}.js .rv.in{opacity:1;transform:none}
/* the chef, full frame */
.sgc{position:relative;min-height:86vh;display:flex;align-items:flex-end;padding:0;overflow:hidden;background:#050806}
.sgc .bgp{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.62}
.sgc:after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,rgba(5,8,6,.9) 0%,rgba(5,8,6,.35) 70%),linear-gradient(0deg,rgba(5,8,6,.7),transparent 50%)}
.sgc .w{position:relative;z-index:1;padding-block:96px;width:100%}
.sgc blockquote{font-family:var(--display);font-style:italic;font-size:clamp(34px,4.6vw,64px);line-height:1.08;max-width:20ch;white-space:pre-line;color:#F6F1E6}
.sgc .who{margin-top:28px;font-weight:700;color:#F6F1E6}.sgc .who span{display:block;font-weight:500;opacity:.7}
/* the card */
.sgcard{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:40px 56px}
.sgcard h3{font-size:32px;font-style:italic;color:var(--accent);padding-bottom:12px;border-bottom:1px solid var(--line);margin-bottom:6px}
.sgcard .ln{display:flex;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid var(--line)}.sgcard .nm{font-weight:600}
.t-signature .ordr{background:var(--surface);color:var(--ink);border:1px solid var(--line)}.t-signature .ordr .btn{background:var(--accent);color:var(--accent-ink)}
.t-signature .rq .fld input,.t-signature .rq .fld textarea{background:var(--bg)}.t-signature .rq .er{color:#F2A093}
/* gallery: a strip of film */
.sgf .h2{margin-bottom:30px}.t-signature #infos{padding-top:24px}
.film{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:30px max(20px,calc((100vw - 1120px)/2));scroll-padding-inline:max(20px,calc((100vw - 1120px)/2));background:repeating-linear-gradient(90deg,#26302A 0 12px,transparent 12px 26px) left 9px/100% 9px no-repeat,repeating-linear-gradient(90deg,#26302A 0 12px,transparent 12px 26px) left calc(100% - 9px)/100% 9px no-repeat,#050806;scrollbar-width:thin;scrollbar-color:var(--accent) transparent}
.film img{height:min(46vw,320px);aspect-ratio:3/2;object-fit:cover;border-radius:2px;flex:none;scroll-snap-align:start}
.t-signature .mi .n{font-family:var(--display);font-size:24px;font-weight:400}
.t-signature .mcat>h2{font-style:italic}
@media (max-width:860px){.sc{grid-template-columns:1fr;gap:0}.stage{display:none}.scene{min-height:0;padding:26px 0 44px}.scene .mob{display:block;width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:var(--r);margin-bottom:22px}.still{margin-bottom:56px}.still img{aspect-ratio:16/10}.sgc{min-height:78vh}.sgc .bgp{opacity:.5}.sgb{flex-direction:column;align-items:flex-start}.cap{bottom:calc(6.5vh + 22px)}}
@media (prefers-reduced-motion:reduce){.js .rv{opacity:1;transform:none}.stage img{transition:none}}
`;
}

function maisonCss() {
  return `
.t-maison h1,.t-maison h2,.t-maison h3{font-weight:400;letter-spacing:-.01em}
.t-maison .brand{font-size:24px}
.t-maison .btn.p{border-radius:4px}.t-maison .btn.g{border-radius:4px}
/* masthead: the name across the page, then a line of facts and the photo collage */
.mh{padding-block:46px 30px}
.mh h1{font-size:clamp(56px,11.5vw,176px);line-height:.86;letter-spacing:-.03em;overflow-wrap:anywhere}
.mh h1 span{display:inline-block;animation:mrise 1s cubic-bezier(.2,.8,.2,1) both}
@keyframes mrise{from{opacity:0;transform:translateY(.35em)}}
.mh .row2{display:grid;grid-template-columns:1.3fr 1fr;gap:40px;align-items:end;margin-top:28px;padding-top:22px;border-top:1px solid var(--ink)}
.mh .t{font-family:var(--display);font-size:clamp(22px,2.4vw,30px);line-height:1.2;max-width:26ch}
.mh .side{display:flex;flex-direction:column;align-items:flex-end;gap:14px}.mh .chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}.mh .chip{background:var(--surface)}
.col{display:grid;grid-template-columns:7fr 5fr;grid-template-rows:1fr 1fr;gap:14px;height:min(72vh,640px);margin-bottom:24px}
.col img,.col .e{width:100%;height:100%;object-fit:cover;border-radius:var(--r);background:var(--surface)}
.col img:first-child,.col .e:first-child{grid-row:span 2}
.col.n1{grid-template-columns:1fr;grid-template-rows:1fr}
/* chapters */
.chs{display:flex;flex-direction:column;gap:110px}
.ch{display:grid;grid-template-columns:5fr 7fr;gap:60px;align-items:center}
.ch:nth-child(even) .ci{order:2}
.ch .n{font-family:var(--display);font-size:clamp(90px,12vw,170px);line-height:.8;color:transparent;-webkit-text-stroke:1.5px var(--accent)}
.ch .lbl{display:block;margin-top:14px;font-size:14px;font-weight:700;color:var(--accent)}
.ch h3{font-size:clamp(32px,3.6vw,48px);margin-top:6px}
.ch p{margin-top:16px;font-size:18px;color:var(--muted);max-width:52ch;white-space:pre-line}
.ci img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:var(--r)}
.js .rv{clip-path:inset(12% 12% 12% 12%);opacity:.3;transition:clip-path 1.2s cubic-bezier(.2,.8,.2,1),opacity 1s}
.js .rv.in{clip-path:inset(0);opacity:1}
/* the house recommends */
.recs{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
.rec{display:flex;flex-direction:column;gap:14px}
.rec:first-child{grid-column:1/-1;display:grid;grid-template-columns:1.25fr 1fr;gap:44px;align-items:center}
.rec img,.rec .e{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--r);background:var(--surface)}
.rec:first-child img,.rec:first-child .e{aspect-ratio:16/11}
.rec h3{font-size:30px}.rec:first-child h3{font-size:clamp(36px,4vw,54px)}
.rec p{color:var(--muted);white-space:pre-line}
.rec .ft{display:flex;align-items:center;gap:14px}
/* chef */
.chef{background:var(--ink);color:var(--bg)}
.chef .w{display:grid;grid-template-columns:5fr 7fr;gap:64px;align-items:center}
.chef img{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:var(--r)}
.chef blockquote{font-family:var(--display);font-size:clamp(26px,3vw,40px);line-height:1.22;white-space:pre-line}
.chef .who{margin-top:26px;font-weight:700}.chef .who span{display:block;font-weight:500;opacity:.7}
/* the card */
.crd{border:1px solid var(--ink);border-radius:var(--r);padding:44px 48px;background:var(--bg)}
.crd .cols{display:grid;grid-template-columns:1fr 1fr;gap:10px 64px}
.crd h3{grid-column:1/-1;font-size:28px;margin:18px 0 6px;color:var(--accent)}.crd h3:first-child{margin-top:0}
.crd .ln{display:flex;align-items:baseline;gap:10px;padding:8px 0}.crd .ln .nm{font-weight:600}.crd .ln .ld{flex:1;border-bottom:1px solid var(--line);transform:translateY(-4px);min-width:16px}
.t-maison .gal{display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:220px;gap:14px}
.t-maison .gal img{width:100%;height:100%;object-fit:cover;border-radius:var(--r)}.t-maison .gal img:first-child{grid-column:span 2;grid-row:span 2}.t-maison .gal.n4 img:last-child,.t-maison .gal.n3 img:not(:first-child){grid-column:span 2}.t-maison #infos{padding-top:24px}
.t-maison .ordr{background:var(--accent);border-radius:var(--r)}
.t-maison .mcat>h2{border-bottom:1px solid var(--ink);padding-bottom:12px}
.t-maison .mlist{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 56px}
.t-maison .mi{border-bottom:0;padding:14px 0}.t-maison .mi .ph{width:72px;height:72px}
.t-maison .mi .n{font-family:var(--display);font-size:22px;font-weight:400}
.t-maison .mi .n .ld{flex:1;border-bottom:1px solid var(--line);transform:translateY(-6px);min-width:20px}.t-maison .mi .n .nm{flex:0 1 auto}
.t-maison .mi .price{color:var(--ink);font-family:'Manrope',sans-serif;font-size:16px}
@media (max-width:860px){.mh .row2{grid-template-columns:1fr;gap:20px}.mh .side{align-items:flex-start}.mh .chips{justify-content:flex-start}.col{grid-template-columns:1fr 1fr;grid-template-rows:auto auto;height:auto}.col img:first-child,.col .e:first-child{grid-column:1/-1;grid-row:auto;aspect-ratio:4/3}.col img,.col .e{aspect-ratio:1}.chs{gap:64px}.ch{grid-template-columns:1fr;gap:26px}.ch:nth-child(even) .ci{order:0}.recs{grid-template-columns:1fr}.rec:first-child{grid-template-columns:1fr;gap:18px}.chef .w{grid-template-columns:1fr;gap:32px}.chef img{width:70%}.crd{padding:28px 20px}.crd .cols{grid-template-columns:1fr}.t-maison .gal{grid-template-columns:1fr 1fr;grid-auto-rows:150px}.t-maison .mlist{grid-template-columns:minmax(0,1fr)}.t-maison .mi .n{flex-wrap:wrap;row-gap:2px}.t-maison .mi .n .nm{flex:1 1 100%}.t-maison .mi .ld{display:none}}
@media (prefers-reduced-motion:reduce){.js .rv{clip-path:none;opacity:1}}
`;
}
function unitPrices(it: SiteItem) {
  const off = (c: number) => (it.promo_bp ? c - Math.round(c * it.promo_bp / 10000) : c);
  const vs = (it.variants ?? []).map(v => ({ base: Number(v.price_cents), p: off(Number(v.price_cents)), name: v.name }));
  return { vs, base: vs.length ? Math.min(...vs.map(v => v.base)) : Number(it.price_cents), p: vs.length ? Math.min(...vs.map(v => v.p)) : off(Number(it.price_cents)) };
}
function priceOf(it: SiteItem, r: SiteData['restaurant'], lang: string, t: Tx) {
  const u = unitPrices(it);
  const pre = u.vs.length > 1 ? `${t.from} ` : '';
  return `${it.promo_bp ? `<s>${esc(money(u.base, r.currency, lang))}</s>` : ''}${pre}${esc(money(u.p, r.currency, lang))}${it.sold_by_weight ? ` <small class="kg">${t.perKg}</small>` : ''}`;
}

export function renderSite(d: SiteData, c: Ctx, page: 'home' | 'menu'): string {
  const r = d.restaurant, langs = r.languages?.length ? r.languages : ['fr'];
  const lang = (['fr', 'en', 'ar'].includes(c.lang) && langs.includes(c.lang) ? c.lang : (['fr', 'en', 'ar'].includes(langs[0]) ? langs[0] : 'fr')) as Lang;
  const t = T[lang], rtl = lang === 'ar';
  const want: Theme = d.site.theme && THEMES[d.site.theme] ? d.site.theme : 'nuit';
  // a premium style only on a premium site (the platform sets the plan once it is paid)
  const k: Theme = PREMIUM.includes(want) && d.site_plan !== 'premium' ? 'moderne' : want;
  // Relais Marin: a warm sand tint instead of neutral grey, to echo the beach (only this restaurant)
  const rm = r.slug === 'relais-marin' && k === 'moderne';
  const th = rm ? { ...THEMES[k], surface: '#F4EDE0', line: 'rgba(22,24,29,.12)', muted: '#625C52' } : THEMES[k];
  const accent = /^#[0-9a-f]{6}$/i.test(r.branding?.primary_color ?? '') ? r.branding.primary_color! : th.accent;
  const name = esc(r.name);
  const L = (x: I18n | undefined) => tr(x, lang, langs);
  const tagline = L(r.branding?.tagline), about = L(d.site.about);
  const cover = safeUrl(r.branding?.cover_url), logo = safeUrl(r.branding?.logo_url), video = safeUrl(d.site.video_url);
  const home = c.base || '/', q = (l: string) => (l === langs[0] ? '' : `?lang=${l}`), ql = q(lang);
  const menuHref = `${c.base}/menu${ql}`;
  const canonical = `${c.origin}${c.base}${page === 'menu' ? '/menu' : ''}${ql}` || '/';
  const orderUrl = `${c.menuUrl}/${encodeURIComponent(r.slug)}?lang=${lang}`, bookUrl = `${c.menuUrl}/${encodeURIComponent(r.slug)}?reserver&lang=${lang}`;
  const place = [r.address, r.city].filter(Boolean).join(', ');
  const mapsUrl = safeUrl(d.site.maps_url) || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name}, ${place}`)}`;
  const open = isOpen(r.opening_hours, r.timezone, c.now);
  const now = localNow(r.timezone, c.now ?? new Date());
  const todayHours = (r.opening_hours?.[now.dow] ?? []).map(([a, b]) => `${a}–${b}`).join(', ');
  const nx = open === false ? nextOpening(r.opening_hours, r.timezone, c.now) : null;
  const nxLabel = nx ? (nx.off === 0 ? t.opensToday : nx.off === 1 ? t.opensTomorrow : t.opensOn.replace('{d}', t.days[nx.day])) : '';
  const tel = (r.phone ?? '').replace(/[^\d+]/g, '');
  const wa = !d.can_order && d.site.wa_order !== false ? waNumber(d.site.whatsapp || r.phone) : '';
  const items = d.items ?? [];
  const sig = [...items].filter(i => i.available).sort((a, b) => Number(b.tags?.includes('popular')) - Number(a.tags?.includes('popular')) || Number(!!b.image_url) - Number(!!a.image_url)).slice(0, 6);
  const gallery = (d.site.gallery ?? []).map(safeUrl).filter(Boolean).slice(0, 7);
  const dishPhotos = items.map(i => safeUrl(i.image_url)).filter(Boolean);
  const gal = gallery.length >= 3 ? gallery : [...gallery, ...dishPhotos].slice(0, 5);
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
  if (page === 'menu') ld.hasMenu = { '@type': 'Menu', hasMenuSection: (d.categories ?? []).map(cat => ({ '@type': 'MenuSection', name: L(cat.name), hasMenuItem: items.filter(i => i.category_id === cat.id).map(i => ({ '@type': 'MenuItem', name: L(i.name), ...(L(i.description) ? { description: L(i.description) } : {}), offers: { '@type': 'Offer', price: (unitPrices(i).p / 100).toFixed(2), priceCurrency: r.currency } })) })) };

  const fonts = `https://fonts.googleapis.com/css2?${th.fonts}&family=Manrope:wght@400;500;600;700;800${rtl ? '&family=IBM+Plex+Sans+Arabic:wght@400;600;700' : ''}&display=swap`;
  const lcp = page === 'home' ? (k === 'moderne' || k === 'atelier' || k === 'maison' ? cover : k === 'riad' ? cover || gal[0] : video ? '' : cover) : '';
  const head = `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(canonical)}">
${d.noindex ? '<meta name="robots" content="noindex">' : ''}${langs.map(l => `<link rel="alternate" hreflang="${l}" href="${esc(`${c.origin}${c.base}${page === 'menu' ? '/menu' : ''}${q(l)}`)}">`).join('')}
<meta property="og:type" content="restaurant"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">${cover ? `<meta property="og:image" content="${esc(cover)}">` : ''}
<meta name="theme-color" content="${th.bg}">${logo ? `<link rel="icon" href="${esc(logo)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="${fonts}" rel="stylesheet">
${lcp ? `<link rel="preload" as="image" href="${esc(lcp)}" fetchpriority="high">` : ''}
<style>${css(k, th, accent, rtl)}</style>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script></head><body class="t-${k} pg-${page}${rm ? ' rm' : ''}">`;

  const langLinks = langs.length > 1 ? `<div class="langs">${langs.filter(l => ['fr', 'en', 'ar'].includes(l)).map(l => `<a href="${esc(`${c.base}${page === 'menu' ? '/menu' : ''}${q(l) || '?lang=' + l}`)}" class="${l === lang ? 'on' : ''}" hreflang="${l}">${l === 'ar' ? 'ع' : l.toUpperCase()}</a>`).join('')}</div>` : '';
  const primary = d.can_order ? `<a class="btn p" href="${esc(orderUrl)}">${icon('bag')}${t.orderShort}</a>` : wa ? `<a class="btn p" href="${esc(menuHref)}">${icon('bag')}${t.orderShort}</a>` : '';
  const nav = `<header class="nav"><div class="w">
${logo ? `<img class="logo" src="${esc(logo)}" alt="" width="40" height="40">` : ''}<a class="brand" href="${esc(home + ql)}">${name}</a>
<nav class="links"><a href="${esc(menuHref)}">${t.menu}</a><a href="${esc(`${home}${ql}#infos`)}">${t.infos}</a></nav>
${langLinks}${d.booking ? `<a class="btn g" href="${esc(bookUrl)}">${icon('cal')}${t.bookShort}</a>` : ''}${page === 'menu' && wa ? '' : primary}
</div></header>`;

  const ctas = (big: boolean) => `<div class="ctas">${d.can_order ? `<a class="btn p" href="${esc(orderUrl)}">${icon('bag')}${t.order}</a>` : wa ? `<a class="btn p" href="${esc(menuHref)}">${icon('wa')}${t.orderWa}</a>` : ''}${d.booking ? `<a class="btn g" href="${esc(bookUrl)}">${icon('cal')}${big ? t.book : t.bookShort}</a>` : ''}<a class="btn g" href="${esc(menuHref)}">${t.menu}</a></div>`;
  const bar = (d.can_order || d.booking || tel || wa) ? `<div class="bar">${primary}${d.booking ? `<a class="btn g" href="${esc(bookUrl)}">${icon('cal')}${t.bookShort}</a>` : ''}${!d.can_order && !wa && tel ? `<a class="btn g" href="tel:${esc(tel)}">${icon('phone')}${t.call}</a>` : ''}${!d.booking ? `<a class="btn g" href="${esc(page === 'menu' ? `${home}${ql}#infos` : menuHref)}">${page === 'menu' ? t.infos : t.menu}</a>` : ''}</div>` : '';
  const socials = [['ig', d.site.instagram], ['fb', d.site.facebook], ['tt', d.site.tiktok]].filter(([, u]) => safeUrl(u)).map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener" aria-label="${n}">${icon(n!)}</a>`).join('');
  const foot = `<footer><div class="w"><div><b style="color:var(--ink)">${name}</b>${place ? `<br>${esc(place)}` : ''}${r.phone ? `<br><a href="tel:${esc(tel)}" dir="ltr">${esc(r.phone)}</a>` : ''}</div>
${socials ? `<div class="soc">${socials}</div>` : ''}<a class="made" href="https://www.amplifygrowthstudio.com/?utm_source=site&utm_medium=footer&utm_campaign=${esc(r.slug)}" rel="noopener">${t.made.replace('Amplify', '<b>Amplify</b>')}</a></div></footer>`;

  const addBtn = (i: SiteItem) => (wa && i.available && !i.sold_by_weight ? `<button class="addb" type="button" data-add="${esc(i.id)}" aria-label="${esc(`${t.add}: ${L(i.name)}`)}">${icon('plus')}</button>` : '');
  const tags = (i: SiteItem) => (i.tags ?? []).filter(x => t.tags[x]);
  const dishCard = (i: SiteItem) => {
    const img = safeUrl(i.image_url) ? `<img class="ph" src="${esc(i.image_url)}" alt="${esc(L(i.name))}" loading="lazy" decoding="async">` : (k === 'moderne' ? '' : '<div class="ph"></div>');
    return `<article class="dish">${img}<div class="b"><h3>${esc(L(i.name))}</h3>${L(i.description) ? `<p>${esc(L(i.description))}</p>` : ''}<div class="ft"><span class="price">${priceOf(i, r, lang, t)}</span>${addBtn(i)}</div></div></article>`;
  };
  const menuItem = (i: SiteItem) => {
    const img = safeUrl(i.image_url) ? `<img class="ph" src="${esc(i.image_url)}" alt="${esc(L(i.name))}" loading="lazy" decoding="async" width="96" height="96">` : '';
    const tg = tags(i);
    const nm = `${esc(L(i.name))}${i.available ? '' : ` <small>(${t.soldOut})</small>`}`;
    const body = k === 'moderne' || k === 'atelier'
      ? `<div class="b"><div class="n"><span class="nm">${nm}</span></div>${L(i.description) ? `<p>${esc(L(i.description))}</p>` : ''}${tg.length ? `<div class="tg">${tg.map(x => `<span>${t.tags[x]}</span>`).join('')}</div>` : ''}<div class="ft"><span class="price">${priceOf(i, r, lang, t)}</span>${addBtn(i)}</div></div>`
      : `<div class="b"><div class="n"><span class="nm">${nm}</span>${k === 'riad' || k === 'maison' ? '<span class="ld"></span>' : ''}<span class="price">${priceOf(i, r, lang, t)}</span></div>${L(i.description) ? `<p>${esc(L(i.description))}</p>` : ''}${tg.length ? `<div class="tg">${tg.map(x => `<span>${t.tags[x]}</span>`).join('')}</div>` : ''}</div>${addBtn(i)}`;
    return `<div class="mi${i.available ? '' : ' so'}" data-tags="${esc(tg.join(' '))}" data-q="${esc(`${L(i.name)} ${L(i.description)}`.toLowerCase())}">${img}${body}</div>`;
  };

  // the basket (WhatsApp orders): data for the script, the floating button and two sheets
  const waData = wa ? {
    slug: r.slug, name: r.name, wa, lang, cur: r.currency, delivery: d.site.wa_delivery !== false,
    items: Object.fromEntries(items.filter(i => i.available && !i.sold_by_weight).map(i => { const u = unitPrices(i); return [i.id, { n: L(i.name), p: u.p, v: u.vs.length > 1 ? u.vs.map(v => ({ n: L(v.name), p: v.p })) : null }]; })),
    t: { hello: t.waHello, name: t.waName, addr: t.waAddr, note: t.waNoteL, foot: t.waFoot, total: t.total, takeaway: t.takeaway, delivery: t.delivery, dineIn: t.dineIn, empty: t.empty },
  } : null;
  const basket = waData ? `<script type="application/json" id="wad">${JSON.stringify(waData).replace(/</g, '\\u003c')}</script>
<button class="cf" type="button" id="cf"><span><span class="n" id="cfn">0</span>${t.see}</span><span class="t" id="cft"></span></button>
<dialog id="vd" aria-labelledby="vdt"><div class="dh"><h2 id="vdt"></h2><button class="xb" type="button" data-close aria-label="${t.close}">${icon('x')}</button></div><div class="db" id="vdb"></div></dialog>
<dialog id="cd" aria-labelledby="cdt"><div class="dh"><h2 id="cdt">${t.basket}</h2><button class="xb" type="button" data-close aria-label="${t.close}">${icon('x')}</button></div><div class="db">
<div id="cl"></div><div class="tot"><span>${t.total}</span><span id="ctot"></span></div>
<form id="cform"><div class="seg" role="radiogroup"><label><input type="radio" name="mode" value="takeaway" checked>${t.takeaway}</label>${d.site.wa_delivery !== false ? `<label><input type="radio" name="mode" value="delivery">${t.delivery}</label>` : ''}<label><input type="radio" name="mode" value="dineIn">${t.dineIn}</label></div>
<label class="fld"><span>${t.yourName}</span><input name="name" required maxlength="40" autocomplete="given-name"></label>
<label class="fld" id="faddr" hidden><span>${t.addr}</span><textarea name="addr" rows="2" maxlength="200" autocomplete="street-address"></textarea></label>
<label class="fld"><span>${t.note}</span><input name="note" maxlength="140"></label>
<button class="btn wa" type="submit" style="width:100%;min-height:54px;font-size:16px">${icon('wa')}${t.send}</button><p class="hint">${t.waHint}</p></form></div></dialog>
<script>${BASKET_JS}</script>` : '';
  // statistics without cookies: a counter per day (visit, menu, call, directions, order, booking, WhatsApp basket)
  const track = `<script>(()=>{const E=${JSON.stringify(`${c.base}/e`)},M=${JSON.stringify(c.menuUrl).replace(/</g, '\\u003c')},S='v:'+${JSON.stringify(r.slug)};const s=k=>{try{navigator.sendBeacon?navigator.sendBeacon(E,k):fetch(E,{method:'POST',body:k,keepalive:true})}catch(e){}};window.__ev=s;if(navigator.webdriver)return;
let seen=0;try{seen=sessionStorage.getItem(S);sessionStorage.setItem(S,1)}catch(e){}if(!seen)s('view');${page === 'menu' ? "s('menu');" : ''}
document.addEventListener('click',e=>{const a=e.target.closest&&e.target.closest('a[href]');if(!a)return;const h=a.href;if(h.startsWith('tel:'))s('call');else if(/google\\.[a-z.]+\\/maps|maps\\.app\\.goo\\.gl|goo\\.gl\\/maps/.test(h))s('directions');else if(h.startsWith(M))s(/reserver/.test(h)?'book':'order')},true)})()</script>`;
  const end = `${foot}${page === 'menu' && wa ? '' : bar}${basket}${k === 'nuit' && page === 'home' ? NUIT_JS : ''}${(k === 'maison' || k === 'signature') && page === 'home' ? PREMIUM_JS : ''}${track}</body></html>`;

  if (page === 'menu') {
    const cats = (d.categories ?? []).filter(cat => items.some(i => i.category_id === cat.id));
    const usedTags = Object.keys(t.tags).filter(x => items.some(i => i.tags?.includes(x)));
    return `${head}${nav}<main>${k === 'atelier' ? '<div class="aw" aria-hidden="true"></div>' : ''}<div class="w mhead">${k === 'riad' ? `<div class="orn">${STAR}</div>` : ''}<h1>${t.menu}</h1>${wa ? `<p class="lead" style="margin:14px ${k === 'riad' ? 'auto' : '0'} 0">${t.waNote}</p>` : ''}
<div class="tools"><label class="srch">${icon('search')}<input type="search" id="q" placeholder="${t.search}" aria-label="${t.search}" autocomplete="off"></label>${usedTags.length ? `<div class="flt">${usedTags.map(x => `<button type="button" data-f="${x}" aria-pressed="false">${t.tags[x]}</button>`).join('')}</div>` : ''}</div></div>
${cats.length > 1 ? `<nav class="cats" aria-label="${t.menu}"><div class="w">${cats.map(cat => `<a href="#c-${esc(cat.id)}" data-c="${esc(cat.id)}">${esc(L(cat.name))}</a>`).join('')}</div></nav>` : ''}
<div class="w">${cats.map(cat => `<section class="mcat" id="c-${esc(cat.id)}" style="padding-bottom:8px"><h2>${esc(L(cat.name))}</h2><div class="mlist">${items.filter(i => i.category_id === cat.id).map(menuItem).join('')}</div></section>`).join('')}
<p class="nores" id="nores">${t.none}</p>
${d.can_order ? `<section><div class="ordr"><div><h2>${t.order}</h2><p>${t.orderNote}</p></div><a class="btn" href="${esc(orderUrl)}">${icon('bag')}${t.orderShort}</a></div></section>` : '<div style="height:80px"></div>'}</div></main>
<script>${MENU_JS}</script>${end}`;
  }

  // ---------- home ----------
  const hh = d.promotions?.[0];
  const hours = DAYS.map(day => `<tr class="${now.dow === day ? 'on' : ''}"><td>${t.days[day]}</td><td dir="ltr">${(r.opening_hours?.[day] ?? []).map(([a, b]) => `${a}–${b}`).join(', ') || t.closedDay}</td></tr>`).join('');
  const openChip = open != null ? `<span class="chip"><span class="dot${open ? '' : ' c'}"></span>${open ? t.open : t.closed}</span>` : '';
  const hhChip = hh ? `<span class="chip">${icon('star')}${t.happy} -${hh.value / 100}%</span>` : '';
  const infos = `<section id="infos"><div class="w info">
<div class="card"><h3>${icon('clock')}${t.hours}</h3><table class="hrs">${hours}</table></div>
<div class="card"><h3>${icon('pin')}${t.address}</h3>${place ? `<p>${esc(place)}</p><iframe class="map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="${t.address}" src="https://maps.google.com/maps?q=${encodeURIComponent(`${r.name}, ${place}`)}&z=16&output=embed"></iframe>` : ''}
<div class="row"><a class="btn p" href="${esc(mapsUrl)}" target="_blank" rel="noopener">${icon('pin')}${t.directions}</a>${tel ? `<a class="btn g" href="tel:${esc(tel)}">${icon('phone')}${t.call}</a>` : ''}${safeUrl(r.branding?.review_url) ? `<a class="btn g" href="${esc(r.branding.review_url)}" target="_blank" rel="noopener">${icon('star')}${t.review}</a>` : ''}</div></div>
</div></section>`;
  const orderBlock = d.can_order || wa ? `<section><div class="w"><div class="ordr"><div><h2>${d.can_order ? t.order : t.orderWa}</h2><p>${d.can_order ? t.orderNote : t.waNote}</p></div><a class="btn" href="${esc(d.can_order ? orderUrl : menuHref)}">${icon(d.can_order ? 'bag' : 'wa')}${t.orderShort}</a></div></div></section>` : '';
  const fullMenuBtn = `<a class="btn g" href="${esc(menuHref)}">${t.fullMenu}</a>`;

  // ---------- shared by the premium styles (Maison, Signature) ----------
  const pics = [cover, ...gal].filter((u, i, a) => u && a.indexOf(u) === i) as string[];
  const story = (d.site.story ?? []).filter(x => L(x.title) || L(x.text)).slice(0, 4);
  const chapters = story.length ? story : about ? [{ title: { [lang]: t.about }, text: { [lang]: about }, image: pics[1] }] : [];
  const byId = new Map(items.map(i => [i.id, i]));
  const recs = (d.site.signatures ?? []).map(x => ({ it: byId.get(x.item_id), text: L(x.text) })).filter(x => x.it && x.it.available) as { it: SiteItem; text: string }[];
  const recList = recs.length ? recs.slice(0, 3) : sig.slice(0, 3).map(it => ({ it, text: L(it.description) }));
  const chef = d.site.chef;
  const cats = (d.categories ?? []).filter(cat => items.some(i => i.category_id === cat.id && i.available)).slice(0, 3);
  const tag = (i: number) => String(i + 1).padStart(2, '0');
  const words = r.name.split(/\s+/).map(w2 => esc(w2));
  const reqOn = d.site.request !== false;
  // after sending, the guest can also tell the restaurant on WhatsApp (an instant alert on its phone)
  const reqWa = waNumber(d.site.whatsapp || r.phone);
  const reqSection = reqOn ? `<section id="demande" style="padding-top:0"><div class="w rq"><div><h2 class="h2">${t.reqTitle}</h2><p class="lead" style="margin-top:18px">${t.reqText}</p>${tel ? `<div class="row"><a class="btn g" href="tel:${esc(tel)}">${icon('phone')}${t.call}</a></div>` : ''}</div>
<div><form id="rqf" data-u="${esc(`${c.base}/demande`)}" novalidate><div class="seg" role="radiogroup">${['group', 'private', 'catering', 'other'].map((x, i) => `<label><input type="radio" name="kind" value="${x}"${i ? '' : ' checked'}>${t.kinds[x]}</label>`).join('')}</div>
<div class="grid"><label class="fld"><span>${t.fName}</span><input name="name" required maxlength="80" autocomplete="name"></label><label class="fld"><span>${t.fPhone}</span><input name="phone" required inputmode="tel" maxlength="20" autocomplete="tel" dir="ltr"></label>
<label class="fld"><span>${t.fDate}</span><input name="date" type="date" required></label><label class="fld"><span>${t.fGuests}</span><input name="guests" inputmode="numeric" maxlength="4"></label></div>
<label class="fld"><span>${t.fMsg}</span><textarea name="message" rows="3" maxlength="800"></textarea></label><label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
<button class="btn p" type="submit" style="width:100%;min-height:52px">${t.fSend}</button><p class="er" role="status" data-e="${esc(t.fErr)}" data-m="${esc(t.fMany)}"></p></form><div class="ok" role="status"><p>${t.fSent}</p>${reqWa ? `<a class="btn wa" id="rqwa" href="https://wa.me/${esc(reqWa)}" data-m="${esc(t.reqWaMsg)}" target="_blank" rel="noopener">${icon('wa')}${t.reqWa}</a>` : ''}</div></div></div></section>` : '';

  let body = '';
  if (k === 'riad') {
    const a1 = cover || gal[0], a2 = gal.find(u => u !== a1);
    body = `<div class="w rh"><div>
<p class="k">${STAR}${esc([d.site.cuisine, r.city].filter(Boolean).join(', ') || t.about)}</p>
<h1>${name}</h1>${tagline ? `<p class="t">${esc(tagline)}</p>` : ''}
<div class="chips">${openChip}${todayHours ? `<span class="chip">${icon('clock')}${t.today} <span dir="ltr">${esc(todayHours)}</span></span>` : ''}${hhChip}</div>${ctas(true)}</div>
${a1 ? `<div class="arch"><img class="a1" src="${esc(a1)}" alt="${name}" fetchpriority="high">${a2 ? `<img class="a2" src="${esc(a2)}" alt="" loading="lazy">` : ''}</div>` : '<div class="arch none" aria-hidden="true"></div>'}
</div><div class="zb" aria-hidden="true"></div>
${about ? `<section><div class="w sc"><div class="orn">${STAR}</div><h2 class="h2">${t.about}</h2><p class="lead">${esc(about)}</p></div></section>` : ''}
${sig.length ? `<section style="padding-top:${about ? '0' : '96px'}"><div class="w sc"><div class="orn">${STAR}</div><h2 class="h2">${t.signature}</h2><div class="dishes">${sig.map(dishCard).join('')}</div><div style="margin-top:44px">${fullMenuBtn}</div></div></section>` : ''}
${orderBlock}
${gal.length >= 4 ? `<section style="padding-top:0"><div class="w sc"><div class="orn">${STAR}</div><h2 class="h2">${t.gallery}</h2><div class="gal">${gal.slice(0, 4).map(u => `<img src="${esc(u)}" alt="${name}" loading="lazy">`).join('')}</div></div></section>` : ''}
<div class="zb" aria-hidden="true"></div>${infos}`;
  } else if (k === 'atelier') {
    const ph = cover || gal[0];
    const aboutImg = gal.find(u => u !== ph);
    const waCater = waNumber(d.site.whatsapp || r.phone);
    const caterHref = waCater ? `https://wa.me/${waCater}?text=${encodeURIComponent(t.caterWa.replace('{r}', r.name))}` : '';
    const seal = open != null ? `<div class="seal"><b>${open ? t.open.split(' ')[0] : nx ? esc(nx.time) : t.closedDay}</b><span>${open ? (todayHours ? `<span dir="ltr">${esc(todayHours)}</span>` : t.today) : nx ? nxLabel : t.closed}</span></div>` : '';
    body = `<div class="aw" aria-hidden="true"></div>
<div class="w ah"><div>
<p class="k">${esc([d.site.cuisine, r.city].filter(Boolean).join(', ') || t.about)}</p>
<h1${r.name.length > 16 ? ' class="long"' : ''}>${name}</h1>${tagline ? `<p class="t">${esc(tagline)}</p>` : ''}
<div class="chips">${openChip}${todayHours ? `<span class="chip">${icon('clock')}${t.today} <span dir="ltr">${esc(todayHours)}</span></span>` : ''}${hhChip}</div>${ctas(true)}</div>
<div class="ph-w${ph ? '' : ' none'}">${ph ? `<img src="${esc(ph)}" alt="${name}" fetchpriority="high">` : ''}${seal}</div>
</div>
${sig.length ? `<section style="padding-top:24px"><div class="w"><div class="sh"><div><span class="k">${t.vitrine}</span><h2 class="h2">${t.signature}</h2></div>${fullMenuBtn}</div><div class="dishes">${sig.map(dishCard).join('')}</div></div></section>` : ''}
${about ? `<section style="padding-top:0"><div class="w about">${aboutImg ? `<img src="${esc(aboutImg)}" alt="${name}" loading="lazy">` : '<div></div>'}<div><h2 class="h2" style="margin-bottom:22px">${t.about}</h2><p class="q">${esc(about)}</p></div></div></section>` : ''}
${d.site.catering !== false && (caterHref || tel) ? `<section style="padding-top:0"><div class="w"><div class="cater"><div><h2>${t.cater}</h2><p>${t.caterText}</p></div><div class="ctas">${caterHref ? `<a class="btn wa" href="${esc(caterHref)}" target="_blank" rel="noopener">${icon('wa')}${t.caterBtn}</a>` : ''}${tel ? `<a class="btn g" href="tel:${esc(tel)}">${icon('phone')}${t.call}</a>` : ''}</div></div></div></section>` : ''}
${orderBlock}
${gal.length >= 3 ? `<section style="padding-top:0"><div class="w"><h2 class="h2" style="margin-bottom:34px">${t.gallery}</h2><div class="gal">${gal.slice(0, 6).map(u => `<img src="${esc(u)}" alt="${name}" loading="lazy">`).join('')}</div></div></section>` : ''}
${infos}`;
  } else if (k === 'maison') {
    body = `<div class="w mh"><h1 dir="auto">${words.map((w2, i) => `<span style="animation-delay:${120 + i * 110}ms">${w2}</span>`).join(' ')}</h1>
<div class="row2">${tagline ? `<p class="t">${esc(tagline)}</p>` : `<p class="t">${esc([d.site.cuisine, r.city].filter(Boolean).join(', '))}</p>`}
<div class="side"><div class="chips">${openChip}${todayHours ? `<span class="chip">${icon('clock')}${t.today} <span dir="ltr">${esc(todayHours)}</span></span>` : ''}${hhChip}</div>${ctas(true)}</div></div></div>
${pics.length ? `<div class="w"><div class="col${pics.length < 3 ? ' n1' : ''}">${(pics.length < 3 ? pics.slice(0, 1) : pics.slice(0, 3)).map((u, i) => `<img src="${esc(u)}" alt="${name}"${i ? ' loading="lazy"' : ' fetchpriority="high"'}>`).join('')}</div></div>` : ''}
${chapters.length ? `<section><div class="w"><h2 class="h2" style="margin-bottom:64px">${t.story}</h2><div class="chs">${chapters.map((c2, i) => {
      const img = safeUrl(c2.image) || pics[(i + 1) % Math.max(pics.length, 1)];
      return `<article class="ch"><div class="ci">${img ? `<img class="rv" src="${esc(img)}" alt="${esc(L(c2.title))}" loading="lazy">` : ''}</div><div><span class="n" aria-hidden="true">${tag(i)}</span><span class="lbl">${t.chapter} ${i + 1}</span>${L(c2.title) ? `<h3>${esc(L(c2.title))}</h3>` : ''}${L(c2.text) ? `<p>${esc(L(c2.text))}</p>` : ''}</div></article>`;
    }).join('')}</div></div></section>` : ''}
${recList.length ? `<section style="padding-top:${chapters.length ? '0' : '96px'}"><div class="w"><div class="sh" style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:40px"><h2 class="h2">${t.recommends}</h2>${fullMenuBtn}</div><div class="recs">${recList.map(({ it, text }) => `<article class="rec">${safeUrl(it.image_url) ? `<img class="rv" src="${esc(it.image_url)}" alt="${esc(L(it.name))}" loading="lazy">` : '<div class="e"></div>'}<div><h3>${esc(L(it.name))}</h3>${text ? `<p style="margin-top:10px">${esc(text)}</p>` : ''}<div class="ft" style="margin-top:14px"><span class="price">${priceOf(it, r, lang, t)}</span>${addBtn(it)}</div></div></article>`).join('')}</div></div></section>` : ''}
${chef && (chef.name || L(chef.text)) ? `<section class="chef"><div class="w">${safeUrl(chef.photo) ? `<img src="${esc(chef.photo)}" alt="${esc(chef.name ?? '')}" loading="lazy">` : '<div></div>'}<div>${L(chef.text) ? `<blockquote>${esc(L(chef.text))}</blockquote>` : ''}<p class="who">${esc(chef.name ?? '')}${L(chef.role) ? `<span>${esc(L(chef.role))}</span>` : ''}</p></div></div></section>` : ''}
${cats.length ? `<section style="padding-bottom:0"><div class="w"><div class="crd"><div class="cols">${cats.map(cat => `<h3>${esc(L(cat.name))}</h3>${items.filter(i => i.category_id === cat.id && i.available).slice(0, 6).map(i => `<div class="ln"><span class="nm">${esc(L(i.name))}</span><span class="ld"></span><span class="price">${priceOf(i, r, lang, t)}</span></div>`).join('')}`).join('')}</div><div style="margin-top:30px;text-align:center">${fullMenuBtn}</div></div></div></section>` : ''}
${orderBlock}
${reqSection}
${gal.length >= 3 ? `<section style="padding-top:0"><div class="w"><h2 class="h2" style="margin-bottom:34px">${t.gallery}</h2><div class="gal n${Math.min(gal.length, 5)}">${gal.slice(0, 5).map(u => `<img src="${esc(u)}" alt="${name}" loading="lazy">`).join('')}</div></div></section>` : ''}
${infos}`;
  } else if (k === 'signature') {
    const still = (u?: string | null, alt = '') => (safeUrl(u) ? `<img class="rv" src="${esc(u!)}" alt="${esc(alt)}" loading="lazy">` : '');
    const media = video ? `<video class="m" autoplay muted loop playsinline preload="metadata"${cover ? ` poster="${esc(cover)}"` : ''}><source src="${esc(video)}" type="video/mp4"></video>` : pics[0] ? `<img class="m" src="${esc(pics[0])}" alt="${name}" fetchpriority="high">` : '';
    const sub = tagline || [d.site.cuisine, r.city].filter(Boolean).join(', ');
    const scenes = chapters.map((c2, i) => ({ ...c2, img: safeUrl(c2.image) || pics[(i + 1) % Math.max(pics.length, 1)] }));
    body = `<section class="sgh"><div class="fr${media ? '' : ' e'}">${media}<div class="lb" aria-hidden="true"></div>
<div class="cap"><h1 dir="auto">${name}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</div></div></section>
<div class="w sgb"><div class="chips">${openChip}${todayHours ? `<span class="chip">${icon('clock')}${t.today} <span dir="ltr">${esc(todayHours)}</span></span>` : ''}${hhChip}</div>${ctas(true)}</div>
${scenes.length ? `<section class="sgs"><div class="w"><h2 class="h2">${t.story}</h2></div><div class="w sc"><div class="stage" aria-hidden="true">${scenes.map((x, i) => (x.img ? `<img src="${esc(x.img)}" alt="" data-i="${i}" class="${i ? '' : 'on'}" loading="lazy">` : '')).join('')}</div>
<div class="scenes">${scenes.map((x, i) => `<article class="scene" data-i="${i}">${x.img ? `<img class="mob" src="${esc(x.img)}" alt="${esc(L(x.title))}" loading="lazy">` : ''}<span class="n" aria-hidden="true">${tag(i)}</span><span class="lbl">${t.chapter} ${i + 1}</span>${L(x.title) ? `<h3>${esc(L(x.title))}</h3>` : ''}${L(x.text) ? `<p>${esc(L(x.text))}</p>` : ''}</article>`).join('')}</div></div></section>` : ''}
${recList.length ? `<section class="sgr"><div class="w"><div class="sh"><h2 class="h2">${t.recommends}</h2>${fullMenuBtn}</div>${recList.map(({ it, text }) => `<figure class="still">${still(it.image_url, L(it.name))}<figcaption><h3>${esc(L(it.name))}</h3>${text ? `<p>${esc(text)}</p>` : ''}<span class="ft"><span class="price">${priceOf(it, r, lang, t)}</span>${addBtn(it)}</span></figcaption></figure>`).join('')}</div></section>` : ''}
${chef && (chef.name || L(chef.text)) ? `<section class="sgc">${safeUrl(chef.photo) ? `<img class="bgp" src="${esc(chef.photo)}" alt="${esc(chef.name ?? '')}" loading="lazy">` : ''}<div class="w">${L(chef.text) ? `<blockquote>${esc(L(chef.text))}</blockquote>` : ''}<p class="who">${esc(chef.name ?? '')}${L(chef.role) ? `<span>${esc(L(chef.role))}</span>` : ''}</p></div></section>` : ''}
${cats.length ? `<section style="padding-bottom:0"><div class="w"><div class="sh"><h2 class="h2">${t.menu}</h2>${fullMenuBtn}</div><div class="sgcard">${cats.map(cat => `<div class="grp"><h3>${esc(L(cat.name))}</h3>${items.filter(i => i.category_id === cat.id && i.available).slice(0, 6).map(i => `<div class="ln"><span class="nm">${esc(L(i.name))}</span><span class="price">${priceOf(i, r, lang, t)}</span></div>`).join('')}</div>`).join('')}</div></div></section>` : ''}
${orderBlock}
${reqSection}
${gal.length >= 3 ? `<section class="sgf"><div class="w"><h2 class="h2">${t.gallery}</h2></div><div class="film">${gal.slice(0, 7).map(u => `<img src="${esc(u)}" alt="${name}" loading="lazy">`).join('')}</div></section>` : ''}
${infos}`;
  } else if (k === 'nuit') {
    const media = video ? `<video class="m" autoplay muted loop playsinline preload="metadata"${cover ? ` poster="${esc(cover)}"` : ''}><source src="${esc(video)}" type="video/mp4"></video>` : cover ? `<img class="m" src="${esc(cover)}" alt="${name}" fetchpriority="high">` : '';
    body = `<section class="nh${media ? '' : ' none'}" style="padding:0">${media}<div class="w in">
<h1>${name}</h1>${tagline ? `<p class="t">${esc(tagline)}</p>` : ''}${ctas(false)}
<div class="lb">${open != null ? `<span><span class="dot${open ? '' : ' c'}"></span>${open ? t.open : t.closed}</span>` : ''}${todayHours ? `<span>${icon('clock')}${t.today} <span dir="ltr">${esc(todayHours)}</span></span>` : ''}${place ? `<span>${icon('pin')}${esc(place)}</span>` : ''}${hh ? `<span>${icon('star')}${t.happy} -${hh.value / 100}%</span>` : ''}</div>
</div></section>
${about ? `<section><div class="w ab"><div><h2 class="h2" style="margin-bottom:28px">${t.about}</h2>${gal[0] ? `<img src="${esc(gal[0])}" alt="${name}" loading="lazy">` : ''}</div><p class="q">${esc(about)}</p></div></section>` : ''}
${sig.length ? `<section style="padding-top:${about ? '0' : '96px'}"><div class="w sh"><h2 class="h2">${t.signature}</h2>${fullMenuBtn}</div><div class="strip">${sig.map(dishCard).join('')}</div></section>` : ''}
${orderBlock}
${gal.length >= 3 ? `<section style="padding-top:0"><div class="w"><h2 class="h2" style="margin-bottom:34px">${t.gallery}</h2><div class="gal${Math.min(gal.length, 5) === 4 ? ' n4' : ''}">${gal.slice(0, 5).map(u => `<img src="${esc(u)}" alt="${name}" loading="lazy">`).join('')}</div></div></section>` : ''}
${infos}`;
  } else {
    const feat = sig.find(i => safeUrl(i.image_url) && safeUrl(i.image_url) !== cover);
    body = `<div class="w bento">
<div class="bx big${cover ? '' : ' none'}">${cover ? `<img src="${esc(cover)}" alt="${name}" fetchpriority="high">` : ''}<div class="in"><h1>${name}</h1>${tagline ? `<p class="t">${esc(tagline)}</p>` : ''}${ctas(false)}</div></div>
<div class="bx"><span class="lbl">${open != null ? `<span class="dot${open ? '' : ' c'}"></span>${open ? t.open : t.closed}` : `${icon('clock')}${t.hours}`}</span><p class="big-n" dir="ltr">${esc(nx ? nx.time : todayHours || t.closedDay)}</p><p class="sub">${nx ? nxLabel : t.today}${hh ? `, ${t.happy} -${hh.value / 100}%` : ''}</p></div>
${feat ? `<a class="bx ph" href="${esc(menuHref)}"><img src="${esc(feat.image_url)}" alt="${esc(L(feat.name))}" loading="lazy"><span class="tag">${esc(L(feat.name))}<span class="price">${priceOf(feat, r, lang, t)}</span></span></a>` : `<div class="bx"><span class="lbl">${icon('star')}${t.signature}</span><p class="big-n">${items.length}</p><p class="sub">${t.menu}</p></div>`}
${d.can_order || wa ? `<div class="bx ac"><h2>${d.can_order ? t.order : t.orderWa}</h2><a class="btn" href="${esc(d.can_order ? orderUrl : menuHref)}">${icon(d.can_order ? 'bag' : 'wa')}${t.orderShort}</a></div>` : d.booking ? `<div class="bx ac"><h2>${t.book}</h2><a class="btn" href="${esc(bookUrl)}">${icon('cal')}${t.bookShort}</a></div>` : `<a class="bx ac" href="${esc(menuHref)}"><h2>${t.menu}</h2><span class="btn">${t.fullMenu}</span></a>`}
<a class="bx adr" href="${esc(mapsUrl)}" target="_blank" rel="noopener"><span class="lbl">${icon('pin')}${t.address}</span><p class="big-n">${esc(r.address || r.city || t.directions)}</p>${r.address && r.city ? `<p class="sub">${esc(r.city)}</p>` : ''}<span class="btn">${icon('pin')}${t.directions}</span></a>
</div>
${rm ? '<div class="rm-wave"></div><div class="rm-sand">' : ''}${about ? `<section style="padding-top:56px"><div class="w"><h2 class="h2" style="max-width:16ch">${t.about}</h2><p class="lead" style="margin-top:18px">${esc(about)}</p></div></section>` : ''}
${sig.length ? `<section style="padding-top:${about ? '0' : '56px'}"><div class="w"><div class="sh"><h2 class="h2">${t.signature}</h2>${fullMenuBtn}</div><div class="dishes">${sig.map(dishCard).join('')}</div></div></section>` : ''}
${rm ? '</div><div class="rm-wave dn"></div>' : ''}
${!d.can_order && !wa ? '' : ''}
${gal.length >= 3 ? `<section style="padding-top:0"><div class="w"><h2 class="h2" style="margin-bottom:30px">${t.gallery}</h2><div class="gal${Math.min(gal.length, 5) === 4 ? ' n4' : ''}">${gal.slice(0, 5).map(u => `<img src="${esc(u)}" alt="${name}" loading="lazy">`).join('')}</div></div></section>` : ''}
${infos}`;
  }
  return `${head}${nav}<main>${body}</main>${end}`;
}

// Menu page: search, tag filters, category bar that follows the scroll.
const MENU_JS = `(()=>{const q=document.getElementById('q'),fs=[...document.querySelectorAll('[data-f]')],cats=[...document.querySelectorAll('.mcat')],nr=document.getElementById('nores');
const run=()=>{const s=(q.value||'').trim().toLowerCase(),on=fs.filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.dataset.f);let any=0;
cats.forEach(c=>{let n=0;c.querySelectorAll('.mi').forEach(m=>{const ok=(!s||m.dataset.q.includes(s))&&on.every(f=>m.dataset.tags.split(' ').includes(f));m.hidden=!ok;n+=ok});c.hidden=!n;any+=n});nr.style.display=any?'none':'block'};
q.addEventListener('input',run);fs.forEach(b=>b.addEventListener('click',()=>{b.setAttribute('aria-pressed',b.getAttribute('aria-pressed')==='true'?'false':'true');run()}));
const links=[...document.querySelectorAll('.cats a')];if(links.length){const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){links.forEach(a=>a.classList.toggle('on',a.dataset.c===e.target.id.slice(2)));const a=links.find(a=>a.classList.contains('on'));a&&a.parentElement.scrollTo({left:a.offsetLeft-a.parentElement.offsetLeft-20,behavior:'smooth'})}}),{rootMargin:'-150px 0px -60% 0px'});cats.forEach(c=>io.observe(c))}})()`;
// Maison: photos open up once when they scroll in; the request form goes to the restaurant as a quote.
// Maison and Signature: photos revealed on scroll, Signature's story frame follows the scene being read,
// and the request form (sent to /demande, then an optional WhatsApp message to the restaurant).
const PREMIUM_JS = `<script>(()=>{document.documentElement.classList.add('js');const io='IntersectionObserver' in window?new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.2}):null;document.querySelectorAll('.rv').forEach(x=>io?io.observe(x):x.classList.add('in'));
const st=document.querySelectorAll('.stage img');if(st.length>1&&'IntersectionObserver' in window){const so=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)st.forEach(x=>x.classList.toggle('on',x.dataset.i===e.target.dataset.i))}),{rootMargin:'-45% 0px -45% 0px'});document.querySelectorAll('.scene').forEach(x=>so.observe(x))}
const f=document.getElementById('rqf');if(!f)return;const er=f.querySelector('.er'),v=n=>f.elements[n].value;f.addEventListener('submit',async e=>{e.preventDefault();er.textContent='';if(!v('name').trim()||!v('phone').trim()||!v('date')){er.textContent=er.dataset.e;return}
const b=f.querySelector('button[type=submit]');b.disabled=true;try{const r=await fetch(f.dataset.u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:v('kind'),name:v('name'),phone:v('phone'),date:v('date'),guests:v('guests'),message:v('message'),website:v('website')})});
if(r.ok){f.classList.add('done');window.__ev&&window.__ev('request');const w=document.getElementById('rqwa');if(w){const k=f.querySelector('input[name=kind]:checked');w.href+='?text='+encodeURIComponent([w.dataset.m,(k?k.parentNode.textContent.trim():''),v('date'),v('guests')?v('guests')+' pers.':'',v('name'),v('message')].filter(Boolean).join('\\n'))}}else{const j=await r.json().catch(()=>({}));er.textContent=j.error==='too_many'?er.dataset.m:er.dataset.e}}catch(x){er.textContent=er.dataset.e}b.disabled=false})})()</script>`;
// Nuit: the transparent bar over the photo becomes solid once the photo has scrolled away.
const NUIT_JS = `<script>(()=>{const n=document.querySelector('header.nav'),h=document.querySelector('.nh');if(!n||!h)return;new IntersectionObserver(([e])=>n.classList.toggle('solid',!e.isIntersecting),{rootMargin:'-80px 0px 0px 0px'}).observe(h)})()</script>`;
// The WhatsApp basket. Kept for the visit only (sessionStorage), nothing is sent to us.
const BASKET_JS = `(()=>{const D=JSON.parse(document.getElementById('wad').textContent),T=D.t,K='wa-cart:'+D.slug,$=i=>document.getElementById(i);let c=[];try{c=JSON.parse(sessionStorage.getItem(K)||'[]').filter(l=>D.items[l.id])}catch(e){}
const fmt=x=>{const v=(x/100).toFixed(2).replace(/\\.00$/,''),n=D.lang==='en'?v:v.replace('.',',');return D.cur==='MAD'?(D.lang==='ar'?n+' درهم':n+' DH'):n+' '+D.cur};
const unit=l=>{const it=D.items[l.id];return it.v?it.v[l.v].p:it.p},label=l=>{const it=D.items[l.id];return it.v?it.n+' ('+it.v[l.v].n+')':it.n};
const total=()=>c.reduce((s,l)=>s+unit(l)*l.q,0),count=()=>c.reduce((s,l)=>s+l.q,0);
const el=(t,a,h)=>{const e=document.createElement(t);Object.assign(e,a||{});if(h)e.append(...h);return e};
function save(){try{sessionStorage.setItem(K,JSON.stringify(c))}catch(e){}draw()}
function add(id,v){const l=c.find(x=>x.id===id&&x.v===v);l?l.q++:c.push({id,v,q:1});save()}
function draw(){const n=count();$('cf').classList.toggle('on',n>0);document.body.classList.toggle('has-cart',n>0);$('cfn').textContent=n;$('cft').textContent=fmt(total());$('ctot').textContent=fmt(total());
const L=$('cl');L.replaceChildren(...(c.length?c.map((l,i)=>el('div',{className:'cl'},[el('span',{className:'nm',textContent:label(l)},[el('small',{textContent:fmt(unit(l)*l.q)})]),el('span',{className:'qty'},[el('button',{type:'button',ariaLabel:'-',textContent:'−',onclick:()=>{l.q--;if(!l.q)c.splice(i,1);save();if(!c.length)$('cd').close()}}),el('b',{textContent:l.q}),el('button',{type:'button',ariaLabel:'+',textContent:'+',onclick:()=>{l.q++;save()}})])])):[el('p',{className:'hint',textContent:T.empty})]))}
document.addEventListener('click',e=>{const b=e.target.closest('[data-add]');if(b){const id=b.dataset.add,it=D.items[id];if(!it)return;if(it.v){$('vdt').textContent=it.n;$('vdb').replaceChildren(...it.v.map((v,i)=>el('button',{type:'button',className:'vr',onclick:()=>{add(id,i);$('vd').close()}},[el('span',{textContent:v.n}),el('b',{textContent:fmt(v.p)})])));$('vd').showModal()}else{add(id,0);b.classList.remove('bump');void b.offsetWidth;b.classList.add('bump')}return}
const x=e.target.closest('[data-close]');if(x){x.closest('dialog').close();return}if(e.target.tagName==='DIALOG')e.target.close()});
$('cf').onclick=()=>{draw();$('cd').showModal()};
const F=$('cform');F.addEventListener('change',()=>{const d=F.mode.value==='delivery';$('faddr').hidden=!d;F.addr.required=d});
F.addEventListener('submit',e=>{e.preventDefault();if(!c.length)return;const m=F.mode.value,lines=[T.hello.replace('{r}',D.name),''];c.forEach(l=>lines.push(l.q+' × '+label(l)+' ('+fmt(unit(l)*l.q)+')'));lines.push('',T.total+' : '+fmt(total()),T[m]);
lines.push(T.name+' : '+F.name.value.trim());if(m==='delivery')lines.push(T.addr+' : '+F.addr.value.trim());if(F.note.value.trim())lines.push(T.note+' : '+F.note.value.trim());lines.push('',T.foot);
window.__ev&&window.__ev('wa_order');window.open('https://wa.me/'+D.wa+'?text='+encodeURIComponent(lines.join('\\n')),'_blank','noopener');c=[];save();$('cd').close()});
draw()})()`;

/** A site-only restaurant that has not paid: a quiet page with its phone number, hidden from Google. */
export function renderPaused(d: { restaurant: { name: string; phone: string | null; city: string | null } }) {
  const r = d.restaurant, tel = (r.phone ?? '').replace(/[^\d+]/g, '');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(r.name)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F2F2EE;color:#16181D;font:17px/1.6 system-ui,sans-serif;text-align:center;padding:24px}h1{font-size:34px;margin:0 0 8px}a{display:inline-block;margin-top:18px;padding:12px 22px;border-radius:999px;background:#16181D;color:#fff;text-decoration:none;font-weight:600}</style></head>
<body><main><h1>${esc(r.name)}</h1><p>${esc(r.city ?? '')}</p><p>Notre site revient très bientôt.</p>${tel ? `<a href="tel:${esc(tel)}">Appeler ${esc(r.phone)}</a>` : ''}</main></body></html>`;
}

export function renderSitemap(d: SiteData, c: Ctx) {
  const langs = d.restaurant.languages?.length ? d.restaurant.languages : ['fr'];
  const urls = ['', '/menu'].flatMap(p => langs.map((l, i) => `${c.origin}${c.base}${p}${i === 0 ? '' : `?lang=${l}`}`));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${esc(u)}</loc></url>`).join('')}</urlset>`;
}
