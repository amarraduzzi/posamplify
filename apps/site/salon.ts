// The salon's website (module "Site du salon"): one style, the salon's own colour and logo.
// The prestations and prices instead of a menu, the team, before/after photos (only those the salon
// marked as agreed by the client), the Google reviews, the live wait of the Nouba and the booking
// button. Same service, cache and domains as the restaurant sites.
import { isOpen, nextOpening, waNumber } from './render';

type I18n = Record<string, string | undefined>;
export interface SalonData {
  kind: 'salon';
  restaurant: {
    slug: string; name: string; city: string | null; address: string | null; phone: string | null; currency: string; timezone: string; languages: string[];
    branding: { logo_url?: string; cover_url?: string; primary_color?: string; tagline?: I18n; review_url?: string };
    opening_hours: Record<string, [string, string][]>;
  };
  site: {
    about?: I18n; gallery?: string[]; instagram?: string; facebook?: string; tiktok?: string; maps_url?: string; whatsapp?: string; reviews_url?: string;
    before_after?: { before: string; after: string; caption?: string }[];
  };
  domain: string | null; noindex: boolean; booking: boolean; nouba: boolean;
  services: { id: string; name: I18n; description: I18n; category: string | null; duration_min: number; price_cents: number; price_from: boolean; online: boolean }[];
  staff: { name: string; color: string | null }[];
}
interface Ctx { base: string; origin: string; lang: string; menuUrl: string; now?: Date }
type Lang = 'fr' | 'en' | 'ar';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const safeUrl = (u?: string | null) => (u && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : '');
const HEX = /^#[0-9a-f]{6}$/i;
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const SCHEMA_DAY: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

const T = {
  fr: {
    book: 'Prendre rendez-vous', bookShort: 'Réserver', queue: 'Prendre ma place', services: 'Prestations', team: 'L’équipe', ba: 'Avant, après', photos: 'Le salon', infos: 'Infos',
    reviews: 'Ce que disent nos clientes', reviewsTxt: 'Lisez les avis laissés sur Google, ou laissez le vôtre après votre passage.', readReviews: 'Voir nos avis Google', leaveReview: 'Laisser un avis',
    from: 'dès', hours: 'Horaires', address: 'Adresse', route: 'Itinéraire', call: 'Appeler', write: 'WhatsApp', closed: 'Fermé', openNow: 'Ouvert maintenant', closedNow: 'Fermé maintenant',
    opensToday: 'Ouvre aujourd’hui', opensTomorrow: 'Ouvre demain', opensOn: 'Ouvre {d}', now: 'En ce moment', noWait: 'Pas d’attente', waiting: (n: number) => (n === 0 ? 'personne n’attend' : n === 1 ? '1 personne attend' : `${n} personnes attendent`),
    estimate: 'Estimation', drag: 'Glissez pour comparer', before: 'Avant', after: 'Après', min: 'min', all: 'Tout', powered: 'Site réalisé avec Amplify',
    days: { mon: 'lundi', tue: 'mardi', wed: 'mercredi', thu: 'jeudi', fri: 'vendredi', sat: 'samedi', sun: 'dimanche' } as Record<string, string>, in: 'à',
  },
  en: {
    book: 'Book an appointment', bookShort: 'Book', queue: 'Take my place', services: 'Services', team: 'The team', ba: 'Before, after', photos: 'The salon', infos: 'Info',
    reviews: 'What our clients say', reviewsTxt: 'Read the reviews left on Google, or leave yours after your visit.', readReviews: 'See our Google reviews', leaveReview: 'Leave a review',
    from: 'from', hours: 'Opening hours', address: 'Address', route: 'Directions', call: 'Call', write: 'WhatsApp', closed: 'Closed', openNow: 'Open now', closedNow: 'Closed now',
    opensToday: 'Opens today', opensTomorrow: 'Opens tomorrow', opensOn: 'Opens {d}', now: 'Right now', noWait: 'No wait', waiting: (n: number) => (n === 0 ? 'nobody waiting' : n === 1 ? '1 person waiting' : `${n} people waiting`),
    estimate: 'Estimate', drag: 'Drag to compare', before: 'Before', after: 'After', min: 'min', all: 'All', powered: 'Website made with Amplify',
    days: { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' } as Record<string, string>, in: 'in',
  },
  ar: {
    book: 'احجز موعدا', bookShort: 'احجز', queue: 'خذ نوبتي', services: 'الخدمات', team: 'الفريق', ba: 'قبل وبعد', photos: 'الصالون', infos: 'معلومات',
    reviews: 'ماذا تقول زبوناتنا', reviewsTxt: 'اقرأوا التقييمات على غوغل، أو اتركوا تقييمكم بعد زيارتكم.', readReviews: 'تقييماتنا على غوغل', leaveReview: 'اترك تقييما',
    from: 'ابتداء من', hours: 'أوقات العمل', address: 'العنوان', route: 'الاتجاهات', call: 'اتصل', write: 'واتساب', closed: 'مغلق', openNow: 'مفتوح الآن', closedNow: 'مغلق الآن',
    opensToday: 'يفتح اليوم', opensTomorrow: 'يفتح غدا', opensOn: 'يفتح {d}', now: 'الآن', noWait: 'بدون انتظار', waiting: (n: number) => (n === 0 ? 'لا أحد ينتظر' : `${n} في الانتظار`),
    estimate: 'تقدير', drag: 'اسحبوا للمقارنة', before: 'قبل', after: 'بعد', min: 'د', all: 'الكل', powered: 'موقع من إنجاز Amplify',
    days: { mon: 'الإثنين', tue: 'الثلاثاء', wed: 'الأربعاء', thu: 'الخميس', fri: 'الجمعة', sat: 'السبت', sun: 'الأحد' } as Record<string, string>, in: 'في',
  },
};

const ICON: Record<string, string> = {
  cal: '<path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"/>',
  walk: '<path d="M13 4a1.5 1.5 0 1 0 0 .01M10 21l2-6 3 3v3M9 10l3-2 3 2 2 3M12 8l-1 5"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/>',
  quote: '<path d="M7 7h4v4c0 3-1.5 5-4 6M14 7h4v4c0 3-1.5 5-4 6"/>',
  wa: '<path d="M4 20l1.3-3.9A8 8 0 1 1 8 19.1L4 20zM9 9c0 3 3 6 6 6l1-1.5-2-1-1 1a5 5 0 0 1-2.5-2.5l1-1-1-2z"/>',
  clock: '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
const icon = (n: string) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

function money(c: number, lang: Lang) {
  const n = (c / 100).toLocaleString(lang === 'en' ? 'en-US' : 'fr-FR', { maximumFractionDigits: 2 }).replace(/\u202f|\u00a0/g, ' ');
  return lang === 'ar' ? `${n} درهم` : `${n} DH`;
}
const dur = (m: number, t: typeof T.fr) => (m < 60 ? `${m} ${t.min}` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`);
/** a darker shade of the salon's colour, for text on light backgrounds */
function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16), c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `#${[c(n >> 16), c((n >> 8) & 255), c(n & 255)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}
function inkOn(hex: string) {
  const n = parseInt(hex.slice(1), 16), l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.62 ? '#17120F' : '#FFFFFF';
}

export function renderSalon(d: SalonData, c: Ctx): string {
  const r = d.restaurant, langs = (r.languages?.length ? r.languages : ['fr']).filter(l => l in T) as Lang[];
  const lang = (langs.includes(c.lang as Lang) ? c.lang : langs[0] ?? 'fr') as Lang;
  const t = T[lang], rtl = lang === 'ar';
  const L = (x: I18n | undefined) => (x?.[lang] || langs.map(l => x?.[l]).find(Boolean) || x?.fr || '') as string;
  const accent = HEX.test(r.branding?.primary_color ?? '') ? r.branding.primary_color! : '#7A2E4D';
  const deep = shade(accent, 0.72), ink = inkOn(accent);
  const name = esc(r.name), tagline = L(r.branding?.tagline), about = L(d.site.about);
  const cover = safeUrl(r.branding?.cover_url), logo = safeUrl(r.branding?.logo_url);
  const q = (l: string) => (l === langs[0] ? '' : `?lang=${l}`), ql = q(lang), home = c.base || '/';
  const canonical = `${c.origin}${c.base}${ql}` || '/';
  const bookUrl = (svc?: string) => `${c.menuUrl}/${encodeURIComponent(r.slug)}?rdv${svc ? `&s=${svc}` : ''}&lang=${lang}`;
  const queueUrl = `${c.menuUrl}/${encodeURIComponent(r.slug)}?nouba&lang=${lang}`;
  const place = [r.address, r.city].filter(Boolean).join(', ');
  const mapsUrl = safeUrl(d.site.maps_url) || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name}, ${place}`)}`;
  const tel = (r.phone ?? '').replace(/[^\d+]/g, '');
  const wa = waNumber(d.site.whatsapp || r.phone);
  const reviews = safeUrl(d.site.reviews_url) || safeUrl(r.branding?.review_url);
  const open = isOpen(r.opening_hours, r.timezone, c.now);
  const nx = open === false ? nextOpening(r.opening_hours, r.timezone, c.now) : null;
  const nxLabel = nx ? (nx.off === 0 ? t.opensToday : nx.off === 1 ? t.opensTomorrow : t.opensOn.replace('{d}', t.days[nx.day])) : '';
  const svcs = d.services ?? [];
  const cats = [...new Set(svcs.map(s => s.category || ''))];
  const ba = (d.site.before_after ?? []).filter(x => safeUrl(x.before) && safeUrl(x.after)).slice(0, 6);
  const gallery = (d.site.gallery ?? []).map(safeUrl).filter(Boolean).slice(0, 6);
  const title = `${r.name}${tagline ? ` · ${tagline}` : ''}${r.city ? ` ${t.in} ${r.city}` : ''}`;
  const desc = (about || tagline || `${r.name}${r.city ? `, ${r.city}` : ''}`).replace(/\s+/g, ' ').slice(0, 158);
  const todayKey = (() => { const p = new Intl.DateTimeFormat('en-US', { timeZone: r.timezone, weekday: 'short' }).format(c.now ?? new Date()).toLowerCase(); return p.slice(0, 3); })();

  const ld = {
    '@context': 'https://schema.org', '@type': 'HairSalon', name: r.name, url: `${c.origin}${c.base || '/'}`,
    ...(cover || logo ? { image: cover || logo } : {}), ...(r.phone ? { telephone: r.phone } : {}),
    ...(place ? { address: { '@type': 'PostalAddress', streetAddress: r.address ?? undefined, addressLocality: r.city ?? undefined, addressCountry: 'MA' } } : {}),
    openingHoursSpecification: Object.entries(r.opening_hours ?? {}).flatMap(([day, rs]) => (rs ?? []).map(([o, cl]) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: SCHEMA_DAY[day], opens: o, closes: cl }))),
    makesOffer: svcs.slice(0, 30).map(s => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: L(s.name) }, price: (s.price_cents / 100).toFixed(0), priceCurrency: 'MAD' })),
    sameAs: [d.site.instagram, d.site.facebook, d.site.tiktok].map(safeUrl).filter(Boolean),
  };
  const fonts = `https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700${rtl ? '&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Noto+Naskh+Arabic:wght@500;700' : ''}&display=swap`;

  const langLinks = langs.length > 1 ? `<div class="langs">${langs.map(l => `<a href="${esc(`${c.base || ''}${q(l) || `?lang=${l}`}`)}" class="${l === lang ? 'on' : ''}" hreflang="${l}">${l === 'ar' ? 'ع' : l.toUpperCase()}</a>`).join('')}</div>` : '';
  const primaryBtn = d.booking ? `<a class="btn p" href="${esc(bookUrl())}">${icon('cal')}${t.book}</a>` : d.nouba ? `<a class="btn p" href="${esc(queueUrl)}">${icon('walk')}${t.queue}</a>` : tel ? `<a class="btn p" href="tel:${esc(tel)}">${icon('phone')}${t.call}</a>` : '';
  const secondBtn = d.booking && d.nouba ? `<a class="btn o" href="${esc(queueUrl)}">${icon('walk')}${t.queue}</a>` : '';

  const nav = `<header class="nav" id="top"><div class="w">
${logo ? `<img class="logo" src="${esc(logo)}" alt="" width="40" height="40">` : ''}<a class="brand" href="${esc(home + ql)}">${name}</a>
<nav class="links"><a href="#prestations">${t.services}</a>${ba.length ? `<a href="#avant-apres">${t.ba}</a>` : ''}<a href="#infos">${t.infos}</a></nav>
${langLinks}${d.booking ? `<a class="btn p sm" href="${esc(bookUrl())}">${t.bookShort}</a>` : d.nouba ? `<a class="btn p sm" href="${esc(queueUrl)}">${t.queue}</a>` : ''}
</div></header>`;

  const live = d.nouba ? `<a class="live" id="live" href="${esc(queueUrl)}" hidden><span class="dot"></span><span class="lv-k">${t.now}</span><b class="lv-w"></b><span class="lv-n"></span>${icon('arrow')}</a>` : '';
  const hero = `<section class="hero${cover ? ' has-cover' : ''}">
${cover ? `<img class="cover" src="${esc(cover)}" alt="" fetchpriority="high">` : ''}
<div class="w hin">
<p class="kick">${esc([r.city, open === true ? t.openNow : open === false ? (nxLabel || t.closedNow) : ''].filter(Boolean).join(' · '))}</p>
<h1>${name}</h1>${tagline ? `<p class="tag">${esc(tagline)}</p>` : ''}
<div class="cta">${primaryBtn}${secondBtn}</div>${live}
</div></section>`;

  const aboutBlock = about ? `<section class="about w"><p>${esc(about)}</p></section>` : '';

  const svcRow = (s: SalonData['services'][number]) => {
    const p = s.price_cents > 0 ? `${s.price_from ? `<small>${t.from}</small> ` : ''}${money(s.price_cents, lang)}` : '';
    const link = d.booking && s.online ? `<a class="sv-b" href="${esc(bookUrl(s.id))}" aria-label="${esc(`${t.bookShort} : ${L(s.name)}`)}">${t.bookShort}${icon('arrow')}</a>` : '';
    return `<li class="sv"><div class="sv-t"><h3>${esc(L(s.name))}</h3><span class="lead" aria-hidden="true"></span><span class="sv-p">${p}</span></div>
<div class="sv-m"><span>${icon('clock')}${dur(s.duration_min, t)}</span>${L(s.description) ? `<span class="sv-d">${esc(L(s.description))}</span>` : ''}${link}</div></li>`;
  };
  const servicesBlock = svcs.length ? `<section class="sec w" id="prestations"><h2>${t.services}</h2>
${cats.length > 1 ? `<div class="chips" role="tablist">${[`<button class="on" data-c="*">${t.all}</button>`, ...cats.map(k => `<button data-c="${esc(k)}">${esc(k || t.services)}</button>`)].join('')}</div>` : ''}
${cats.map(k => `<div class="cat" data-cat="${esc(k)}">${cats.length > 1 ? `<h3 class="ct">${esc(k || t.services)}</h3>` : ''}<ul>${svcs.filter(s => (s.category || '') === k).map(svcRow).join('')}</ul></div>`).join('')}
</section>` : '';

  const teamBlock = d.staff?.length ? `<section class="sec w team"><h2>${t.team}</h2><ul>${d.staff.map(s => {
    const col = HEX.test(s.color ?? '') ? s.color! : accent;
    return `<li><span class="av" style="background:${col}">${esc(s.name.trim().slice(0, 1).toUpperCase())}</span>${esc(s.name)}</li>`;
  }).join('')}</ul></section>` : '';

  const baBlock = ba.length ? `<section class="sec ba" id="avant-apres"><div class="w"><h2>${t.ba}</h2><p class="hint">${t.drag}</p>
<div class="bag">${ba.map((x, i) => `<figure class="cmp" style="--p:50%"><img src="${esc(x.after)}" alt="${esc(`${t.after}${x.caption ? ` : ${x.caption}` : ''}`)}" loading="lazy">
<div class="bf"><img src="${esc(x.before)}" alt="${esc(`${t.before}${x.caption ? ` : ${x.caption}` : ''}`)}" loading="lazy"></div>
<span class="lb l">${t.before}</span><span class="lb r">${t.after}</span><span class="hd" aria-hidden="true"></span>
<input type="range" min="0" max="100" value="50" aria-label="${esc(`${t.drag} ${i + 1}`)}">
${x.caption ? `<figcaption>${esc(x.caption)}</figcaption>` : ''}</figure>`).join('')}</div></div></section>` : '';

  const galleryBlock = gallery.length ? `<section class="sec w gal"><h2>${t.photos}</h2><div class="gg">${gallery.map((u, i) => `<img src="${esc(u)}" alt="${esc(`${r.name} ${i + 1}`)}" loading="lazy">`).join('')}</div></section>` : '';

  const reviewsBlock = reviews ? `<section class="sec w rev"><div class="rv-c"><span class="rq">${icon('quote')}</span>
<h2>${t.reviews}</h2><p>${t.reviewsTxt}</p><div class="cta"><a class="btn p" href="${esc(reviews)}" rel="noopener" target="_blank">${t.readReviews}</a></div></div></section>` : '';

  const hoursRows = DAYS.map(k => {
    const rs = r.opening_hours?.[k] ?? [];
    return `<tr class="${k === todayKey ? 'today' : ''}"><th>${t.days[k]}</th><td dir="ltr">${rs.length ? rs.map(([a, b]) => `${a}–${b}`).join(', ') : `<span class="off">${t.closed}</span>`}</td></tr>`;
  }).join('');
  const infos = `<section class="sec w infos" id="infos"><h2>${t.infos}</h2><div class="ig">
<div class="box"><h3>${icon('clock')}${t.hours}</h3><table>${hoursRows}</table></div>
<div class="box"><h3>${icon('pin')}${t.address}</h3>${place ? `<p>${esc(place)}</p>` : ''}
<div class="acts"><a class="btn o" href="${esc(mapsUrl)}" rel="noopener" target="_blank">${icon('pin')}${t.route}</a>${tel ? `<a class="btn o" href="tel:${esc(tel)}">${icon('phone')}${t.call}</a>` : ''}${wa ? `<a class="btn o" href="https://wa.me/${wa}" rel="noopener" target="_blank">${icon('wa')}${t.write}</a>` : ''}</div>
<p class="soc">${[['Instagram', d.site.instagram], ['Facebook', d.site.facebook], ['TikTok', d.site.tiktok]].filter(([, u]) => safeUrl(u)).map(([n, u]) => `<a href="${esc(u)}" rel="noopener" target="_blank">${n}</a>`).join('')}</p></div>
</div></section>`;

  const bar = d.booking || d.nouba || tel ? `<div class="bar">${d.booking ? `<a class="btn p" href="${esc(bookUrl())}">${icon('cal')}${t.bookShort}</a>` : ''}${d.nouba ? `<a class="btn ${d.booking ? 'o' : 'p'}" href="${esc(queueUrl)}">${icon('walk')}${t.queue}</a>` : ''}${!d.booking && !d.nouba && tel ? `<a class="btn p" href="tel:${esc(tel)}">${icon('phone')}${t.call}</a>` : ''}</div>` : '';

  const js = `<script>(()=>{const E=${JSON.stringify(`${c.base}/e`)},M=${JSON.stringify(c.menuUrl).replace(/</g, '\\u003c')},S='v:'+${JSON.stringify(r.slug)};const s=k=>{try{navigator.sendBeacon?navigator.sendBeacon(E,k):fetch(E,{method:'POST',body:k,keepalive:true})}catch(e){}};
if(!navigator.webdriver){let seen=0;try{seen=sessionStorage.getItem(S);sessionStorage.setItem(S,1)}catch(e){}if(!seen)s('view');
document.addEventListener('click',e=>{const a=e.target.closest&&e.target.closest('a[href]');if(!a)return;const h=a.href;if(h.startsWith('tel:'))s('call');else if(/google\\.[a-z.]+\\/maps|maps\\.app\\.goo\\.gl|goo\\.gl\\/maps/.test(h))s('directions');else if(h.startsWith(M))s(/nouba/.test(h)?'queue':'book')},true)}
const n=document.querySelector('.nav');addEventListener('scroll',()=>n.classList.toggle('solid',scrollY>40),{passive:true});
document.querySelectorAll('.cmp input').forEach(i=>i.addEventListener('input',()=>i.closest('.cmp').style.setProperty('--p',i.value+'%')));
const ch=[...document.querySelectorAll('.chips button')];ch.forEach(b=>b.addEventListener('click',()=>{ch.forEach(x=>x.classList.toggle('on',x===b));document.querySelectorAll('.cat').forEach(k=>k.hidden=b.dataset.c!=='*'&&k.dataset.cat!==b.dataset.c)}));
const lv=document.getElementById('live');if(lv){const W=${JSON.stringify({ noWait: t.noWait, min: t.min })},N=${JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(x => t.waiting(x)))};
const get=()=>fetch(${JSON.stringify(`${c.base}/attente`)},{cache:'no-store'}).then(r=>r.ok?r.json():null).then(x=>{if(!x||!x.enabled||!x.open){lv.hidden=true;return}
const w=x.wait_min??0;const e=lv.querySelector('.lv-w');if(w<=0)e.textContent=W.noWait;else{e.textContent='';const b=document.createElement('bdi');b.dir='ltr';b.textContent=w+'–'+(w+Math.max(10,Math.round(w*.3/5)*5));e.append(b,' '+W.min)}lv.querySelector('.lv-n').textContent=N[Math.min(10,x.waiting||0)];lv.dataset.t=w<15?'g':w<45?'o':'r';lv.hidden=false}).catch(()=>{});
get();setInterval(get,60000)}})()</script>`;

  return `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(canonical)}">
${d.noindex ? '<meta name="robots" content="noindex">' : ''}${langs.map(l => `<link rel="alternate" hreflang="${l}" href="${esc(`${c.origin}${c.base}${q(l)}`)}">`).join('')}
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">${cover ? `<meta property="og:image" content="${esc(cover)}">` : ''}
<meta name="theme-color" content="${accent}">${logo ? `<link rel="icon" href="${esc(logo)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="${fonts}" rel="stylesheet">
${cover ? `<link rel="preload" as="image" href="${esc(cover)}" fetchpriority="high">` : ''}
<style>${salonCss(accent, deep, ink, rtl)}</style>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script></head><body>
${nav}<main>${hero}${aboutBlock}${servicesBlock}${baBlock}${teamBlock}${galleryBlock}${reviewsBlock}${infos}</main>
<footer class="foot w"><span>© ${name}</span><a href="https://www.amplifygrowthstudio.com/salons/" rel="noopener">${t.powered}</a></footer>${bar}${js}</body></html>`;
}

function salonCss(accent: string, deep: string, ink: string, rtl: boolean) {
  const serif = rtl ? '"Noto Naskh Arabic", "IBM Plex Sans Arabic", serif' : '"Instrument Serif", Georgia, serif';
  const sans = rtl ? '"IBM Plex Sans Arabic", Manrope, sans-serif' : 'Manrope, system-ui, sans-serif';
  return `:root{--a:${accent};--ad:${deep};--ai:${ink};--bg:#F7F4F2;--card:#FFFFFF;--ink:#1B1716;--mut:#6E6763;--line:rgba(27,23,22,.1)}
*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}body{background:var(--bg);color:var(--ink);font:400 17px/1.6 ${sans};padding-bottom:84px}
a{color:inherit;text-decoration:none}img{display:block;max-width:100%}.w{max-width:1120px;margin:0 auto;padding:0 20px}
.i{width:18px;height:18px;flex:none}
.nav{position:fixed;inset:0 0 auto;z-index:20;transition:background .25s,box-shadow .25s}.nav .w{display:flex;align-items:center;gap:14px;height:68px}
.nav{color:#fff}.nav.solid{color:var(--ink);background:rgba(247,244,242,.92);backdrop-filter:blur(12px);box-shadow:0 1px 0 var(--line)}
.nav:not(.solid) .langs{background:rgba(255,255,255,.16)}.nav:not(.solid) .langs a.on{background:#fff;color:var(--ink)}.nav:not(.solid) .btn.p{background:#fff;color:var(--ink)}
.logo{width:40px;height:40px;border-radius:12px;object-fit:cover}.brand{font:400 24px/1 ${serif};margin-inline-end:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.links{display:none;gap:22px;font-weight:600;font-size:15px}
.langs{display:flex;gap:2px;background:rgba(27,23,22,.06);border-radius:99px;padding:3px}.langs a{padding:4px 10px;border-radius:99px;font-size:13px;font-weight:700}.langs a.on{background:#fff}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:50px;padding:0 24px;border-radius:99px;font-weight:700;font-size:16px;transition:transform .15s,background .2s}
.btn:active{transform:scale(.97)}.btn.p{background:var(--a);color:var(--ai)}.btn.p:hover{background:var(--ad);color:#fff}.btn.o{background:var(--card);box-shadow:inset 0 0 0 1.5px var(--line)}.btn.sm{min-height:40px;padding:0 16px;font-size:14px}
.hero{position:relative;min-height:88vh;display:flex;align-items:flex-end;padding:120px 0 56px;overflow:hidden;background:linear-gradient(160deg,var(--a),var(--ad));color:#fff}
.hero .cover{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.hero.has-cover::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(14,10,9,.82),rgba(14,10,9,.15) 60%,rgba(14,10,9,.35))}
.hin{position:relative;z-index:1;width:100%}.hero:not(.has-cover){min-height:auto;padding-top:150px}.kick{font-weight:600;font-size:15px;opacity:.85;letter-spacing:.02em}
.hero h1{font:400 clamp(58px,13vw,150px)/.88 ${serif};margin:14px 0 0;letter-spacing:-.01em}.tag{font:italic 400 clamp(22px,3.4vw,32px)/1.2 ${serif};margin-top:14px;max-width:24ch;opacity:.92}
.hero .cta{display:flex;flex-wrap:wrap;gap:10px;margin-top:30px}.hero .btn.o{background:rgba(255,255,255,.14);color:#fff;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.35);backdrop-filter:blur(8px)}
.hero .btn.p{background:#fff;color:var(--ink)}
.live{margin-top:22px;display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px 12px;padding:12px 18px;border-radius:20px;background:rgba(255,255,255,.14);backdrop-filter:blur(10px);box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)}
.live[hidden]{display:none}.live .dot{width:10px;height:10px;border-radius:50%;background:#22C55E;box-shadow:0 0 0 0 rgba(34,197,94,.6);animation:pulse 2s infinite}
.live[data-t=o] .dot{background:#F59E0B}.live[data-t=r] .dot{background:#EF4444}.lv-k{font-size:14px;opacity:.8}.lv-w{font-size:20px}.lv-n{font-size:14px;opacity:.8}
@keyframes pulse{70%{box-shadow:0 0 0 10px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
.about{padding:72px 20px 8px}.about p{font:400 clamp(26px,3.6vw,40px)/1.25 ${serif};max-width:30ch}
.sec{padding:72px 20px 0}.sec h2{font:400 clamp(44px,7vw,76px)/.95 ${serif};margin-bottom:26px}
.chips{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin-bottom:12px;scrollbar-width:none}.chips button{flex:none;border:0;background:var(--card);box-shadow:inset 0 0 0 1.5px var(--line);border-radius:99px;padding:9px 16px;font:600 15px ${sans};color:var(--ink);cursor:pointer}
.chips button.on{background:var(--ink);color:#fff;box-shadow:none}.cat[hidden]{display:none}.ct{font:700 13px ${sans};text-transform:uppercase;letter-spacing:.14em;color:var(--mut);margin:28px 0 4px}
.sv{list-style:none;padding:20px 0;border-bottom:1px solid var(--line)}.sv-t{display:flex;align-items:baseline;gap:12px}.sv-t h3{font:600 19px/1.3 ${sans}}
.lead{flex:1;border-bottom:1.5px dotted rgba(27,23,22,.25);transform:translateY(-4px);min-width:20px}.sv-p{font:400 24px/1 ${serif};white-space:nowrap}.sv-p small{font:600 13px ${sans};color:var(--mut)}
.sv-m{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;margin-top:6px;color:var(--mut);font-size:15px}.sv-m>span:first-child{display:inline-flex;align-items:center;gap:6px}.sv-m .i{width:15px;height:15px}
.sv-d{flex-basis:100%;order:3}.sv-b{margin-inline-start:auto;display:inline-flex;align-items:center;gap:6px;font-weight:700;color:var(--ad)}.sv-b .i{width:16px;height:16px}${rtl ? '.sv-b .i,.live .i{transform:scaleX(-1)}' : ''}
.ba{background:var(--ink);color:#fff;margin-top:80px;padding:80px 0}.ba .hint{color:rgba(255,255,255,.6);margin:-14px 0 26px}
.bag{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
.cmp{position:relative;aspect-ratio:4/5;border-radius:22px;overflow:hidden;background:#000;user-select:none}.cmp img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.cmp .bf{position:absolute;inset:0;clip-path:inset(0 calc(100% - var(--p)) 0 0)}${rtl ? '.cmp .bf{clip-path:inset(0 0 0 calc(100% - var(--p)))}' : ''}
.cmp .hd{position:absolute;top:0;bottom:0;${rtl ? 'right' : 'left'}:var(--p);width:2px;background:#fff;transform:translateX(${rtl ? '50%' : '-50%'})}
.cmp .hd::after{content:"";position:absolute;top:50%;left:50%;width:44px;height:44px;border-radius:50%;background:#fff;transform:translate(-50%,-50%);box-shadow:0 6px 20px rgba(0,0,0,.35)}
.cmp input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:ew-resize;direction:${rtl ? 'rtl' : 'ltr'}}
.lb{position:absolute;top:14px;font:700 12px ${sans};letter-spacing:.12em;text-transform:uppercase;background:rgba(0,0,0,.45);padding:5px 10px;border-radius:99px}.lb.l{${rtl ? 'right' : 'left'}:14px}.lb.r{${rtl ? 'left' : 'right'}:14px}
.cmp figcaption{position:absolute;inset:auto 0 0;padding:40px 18px 16px;background:linear-gradient(to top,rgba(0,0,0,.7),transparent);font-weight:600}
.team ul{display:flex;flex-wrap:wrap;gap:12px;list-style:none}.team li{display:flex;align-items:center;gap:12px;background:var(--card);border-radius:99px;padding:8px 22px 8px 8px;font-weight:700;box-shadow:inset 0 0 0 1.5px var(--line)}
.av{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;color:#fff;font:400 22px ${serif}}
.gg{display:grid;gap:12px;grid-template-columns:repeat(2,1fr)}.gg img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:18px}
.rev .rv-c{background:var(--a);color:var(--ai);border-radius:30px;padding:44px 28px}.rev h2{margin-bottom:12px}.rev p{max-width:46ch;opacity:.9}.rev .cta{margin-top:24px}.rev .btn.p{background:var(--ai);color:var(--a)}
.rq{display:block;margin-bottom:14px}.rq .i{width:36px;height:36px;opacity:.85}
.ig{display:grid;gap:16px}.box{background:var(--card);border-radius:26px;padding:26px;box-shadow:inset 0 0 0 1.5px var(--line)}.box h3{display:flex;align-items:center;gap:10px;font:700 17px ${sans};margin-bottom:14px}
table{width:100%;border-collapse:collapse}th,td{padding:8px 0;border-bottom:1px solid var(--line);text-align:start;font-weight:500}th{text-transform:capitalize;color:var(--mut);font-weight:600}td{text-align:end}
tr.today th,tr.today td{color:var(--ad);font-weight:800}.off{color:var(--mut)}.acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.soc{display:flex;gap:16px;margin-top:16px;font-weight:700;color:var(--ad)}
.foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;padding:56px 20px 32px;color:var(--mut);font-size:14px}.foot a{text-decoration:underline;text-underline-offset:3px}
.bar{position:fixed;inset:auto 0 0;z-index:30;display:flex;gap:8px;padding:12px 14px calc(12px + env(safe-area-inset-bottom));background:rgba(247,244,242,.94);backdrop-filter:blur(12px);box-shadow:0 -1px 0 var(--line)}.bar .btn{flex:1;min-height:50px;padding:0 10px;font-size:15px;white-space:nowrap}
@media (min-width:760px){.hero:not(.has-cover){min-height:72vh}.brand{font-size:26px}body{padding-bottom:0}.bar{display:none}.links{display:flex}.ig{grid-template-columns:1fr 1fr}.gg{grid-template-columns:repeat(3,1fr)}.sec{padding-top:110px}.about{padding-top:110px}}
@media (max-width:759px){.nav .btn.sm{display:none}}
@media (prefers-reduced-motion:reduce){.live .dot{animation:none}html{scroll-behavior:auto}}
:focus-visible{outline:3px solid var(--a);outline-offset:3px;border-radius:6px}`;
}

export function salonSitemap(d: SalonData, c: Ctx) {
  const langs = d.restaurant.languages?.length ? d.restaurant.languages : ['fr'];
  const urls = langs.map((l, i) => `${c.origin}${c.base}${i === 0 ? '' : `?lang=${l}`}`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${esc(u)}</loc></url>`).join('')}</urlset>`;
}
