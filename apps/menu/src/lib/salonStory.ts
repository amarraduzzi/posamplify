// The salon's stories (9:16), drawn on a canvas in the salon's colour:
//  * the mirror: the client's selfie in a gold arched mirror, a line written on the glass like with
//    lipstick, the prestation, who did it, the date, the @;
//  * "J'ai rendez-vous": the appointment as a ticket, with the countdown;
//  * "Je suis n°3": the place in the Nouba and the wait, for the friends who might come too.
export const W = 1080, H = 1920;
const SERIF = '"Fraunces Variable", "IBM Plex Sans Arabic", Georgia, serif';
const SANS = '"Plus Jakarta Sans Variable", "IBM Plex Sans Arabic", system-ui, sans-serif';
type Img = (CanvasImageSource & { width: number; height: number }) | null | undefined;

export interface Line { text: string; rtl?: boolean; lang?: 'fr' | 'en' | 'ar' }
/** What the mirror says, in French, English and Darija. */
export const MIRROR_LINES: Line[] = [
  { text: 'Nouvelle coupe, nouvelle moi', lang: 'fr' },
  { text: 'Le miroir est d’accord', lang: 'fr' },
  { text: 'Cheveux : validés', lang: 'fr' },
  { text: 'Prête pour la photo', lang: 'fr' },
  { text: 'Fresh cut, fresh start', lang: 'en' },
  { text: 'Hair: approved', lang: 'en' },
  { text: 'The mirror agrees', lang: 'en' },
  { text: 'شعر جديد، نفس جديد', rtl: true, lang: 'ar' },
  { text: 'راسي فرحان اليوم', rtl: true, lang: 'ar' },
  { text: 'المراية متفقة معايا', rtl: true, lang: 'ar' },
];

function rgb(hex: string): [number, number, number] {
  let h = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || '').trim())?.[1] ?? '8e3b4f'; if (h.length === 3) h = h.replace(/./g, '$&$&');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const mix = (hex: string, to: string, k: number) => { const a = rgb(hex), b = rgb(to); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`; };
function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function fit(g: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight: number | string, family: string, min = 26) {
  let fs = size; g.font = `${weight} ${fs}px ${family}`;
  while (g.measureText(text).width > maxW && fs > min) { fs -= 2; g.font = `${weight} ${fs}px ${family}`; }
  return fs;
}
function cover(g: CanvasRenderingContext2D, img: NonNullable<Img>, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height), dw = img.width * s, dh = img.height * s;
  g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
/** the salon's colour as a deep, slightly grainy background */
function backdrop(g: CanvasRenderingContext2D, P: string) {
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, mix(P, '#000000', 0.15)); bg.addColorStop(1, mix(P, '#000000', 0.62));
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, 760, 60, W / 2, 760, 900); glow.addColorStop(0, 'rgba(255,240,220,.20)'); glow.addColorStop(1, 'rgba(255,240,220,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  g.fillStyle = 'rgba(255,255,255,.035)';
  for (let i = 0; i < 2600; i++) g.fillRect(rnd() * W, rnd() * H, 2, 2);
}
function footer(g: CanvasRenderingContext2D, salon: string, handle: string | undefined, logo: Img, y: number) {
  g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = '#fff';
  fit(g, salon, 760, 50, 600, SERIF, 30);
  const nw = g.measureText(salon).width, lw = logo ? 80 : 0, gap = logo ? 22 : 0, x0 = W / 2 - (lw + gap + nw) / 2;
  if (logo) { g.save(); g.beginPath(); g.arc(x0 + 40, y, 40, 0, 7); g.clip(); g.drawImage(logo, x0, y - 40, 80, 80); g.restore(); }
  g.fillText(salon, x0 + lw + gap, y + 2);
  if (handle) { g.textAlign = 'center'; g.font = `700 38px ${SANS}`; g.fillStyle = 'rgba(255,255,255,.8)'; g.fillText('@' + handle.replace(/^@/, ''), W / 2, y + 70); }
}

export interface MirrorInput { photo: Img; salon: string; handle?: string; logo?: Img; primary: string; service: string; staff?: string; date: string; line: Line; byWord: string }
export function drawMirror(c: HTMLCanvasElement, o: MirrorInput, scale = 1) {
  c.width = Math.round(W * scale); c.height = Math.round(H * scale);
  const g = c.getContext('2d')!; g.setTransform(scale, 0, 0, scale, 0, 0); g.direction = 'ltr';
  backdrop(g, o.primary);
  // the arched mirror with its gold frame
  const mx = 150, my = 170, mw = W - 300, mh = 1180, R = mw / 2;
  const arch = (inset: number) => { g.beginPath(); g.moveTo(mx + inset, my + mh - inset); g.lineTo(mx + inset, my + R); g.arc(W / 2, my + R, R - inset, Math.PI, 0); g.lineTo(mx + mw - inset, my + mh - inset); g.closePath(); };
  g.save(); g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 70; g.shadowOffsetY = 34;
  const gold = g.createLinearGradient(mx, my, mx + mw, my + mh); gold.addColorStop(0, '#f6dfa0'); gold.addColorStop(0.35, '#b8873b'); gold.addColorStop(0.6, '#f3d68f'); gold.addColorStop(1, '#8a6224');
  arch(-26); g.fillStyle = gold; g.fill(); g.restore();
  g.save(); arch(0); g.clip();
  if (o.photo) cover(g, o.photo, mx, my, mw, mh);
  else { g.fillStyle = mix(o.primary, '#ffffff', 0.75); g.fillRect(mx, my, mw, mh); }
  // glass: a soft reflection across the mirror
  const sh = g.createLinearGradient(mx, my, mx + mw, my + mh); sh.addColorStop(0.08, 'rgba(255,255,255,.22)'); sh.addColorStop(0.22, 'rgba(255,255,255,0)'); sh.addColorStop(0.78, 'rgba(255,255,255,0)'); sh.addColorStop(0.9, 'rgba(255,255,255,.12)');
  g.fillStyle = sh; g.fillRect(mx, my, mw, mh);
  // the line, written on the glass
  g.translate(W / 2, my + mh - 150); g.rotate(-0.06); g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = o.line.rtl ? 'rtl' : 'ltr';
  const fam = o.line.rtl ? SANS : SERIF; fit(g, o.line.text, mw - 120, 92, `italic 600`, fam, 40);
  g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,.25)'; g.strokeText(o.line.text, 0, 4);
  g.fillStyle = '#ff6b8b'; g.fillText(o.line.text, 0, 0);
  g.restore(); g.direction = 'ltr';
  // the prestation, by whom, when
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
  fit(g, o.service, 860, 74, 600, SERIF, 36); g.fillText(o.service, W / 2, 1478);
  g.font = `600 38px ${SANS}`; g.fillStyle = 'rgba(255,255,255,.82)';
  g.fillText([o.staff ? `${o.byWord} ${o.staff}` : '', o.date].filter(Boolean).join('  ·  '), W / 2, 1552);
  footer(g, o.salon, o.handle, o.logo, 1700);
}

export interface RdvInput { salon: string; handle?: string; logo?: Img; primary: string; title: string; service: string; day: string; time: string; countdown?: string; staff?: string; cta: string }
export function drawRdv(c: HTMLCanvasElement, o: RdvInput, scale = 1) {
  c.width = Math.round(W * scale); c.height = Math.round(H * scale);
  const g = c.getContext('2d')!; g.setTransform(scale, 0, 0, scale, 0, 0); g.direction = 'ltr';
  backdrop(g, o.primary);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#fff'; fit(g, o.title, 900, 110, 'italic 600', SERIF, 50); g.fillText(o.title, W / 2, 330);
  if (o.countdown) {
    g.font = `800 46px ${SANS}`; const cw = g.measureText(o.countdown).width + 90;
    rr(g, W / 2 - cw / 2, 420, cw, 92, 46); g.fillStyle = '#ff6b8b'; g.fill(); g.fillStyle = '#fff'; g.fillText(o.countdown, W / 2, 468);
  }
  // the ticket
  const tx = 120, ty = 600, tw = W - 240, th = 760;
  g.save(); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 60; g.shadowOffsetY = 30; rr(g, tx, ty, tw, th, 48); g.fillStyle = '#fffaf3'; g.fill(); g.restore();
  g.fillStyle = mix(o.primary, '#000000', 0.62); g.beginPath(); g.arc(tx, ty + 470, 40, 0, 7); g.arc(tx + tw, ty + 470, 40, 0, 7); g.fill();
  g.setLineDash([18, 16]); g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 4; g.beginPath(); g.moveTo(tx + 60, ty + 470); g.lineTo(tx + tw - 60, ty + 470); g.stroke(); g.setLineDash([]);
  const ink = mix(o.primary, '#000000', 0.35);
  g.fillStyle = ink; g.font = `600 220px ${SERIF}`; g.fillText(o.time, W / 2, ty + 200);
  g.fillStyle = '#2b1d22'; fit(g, o.day, tw - 120, 54, 700, SANS, 30); g.fillText(o.day, W / 2, ty + 365);
  fit(g, o.service, tw - 120, 56, 600, SERIF, 30); g.fillText(o.service, W / 2, ty + 575);
  if (o.staff) { g.font = `600 38px ${SANS}`; g.fillStyle = 'rgba(43,29,34,.65)'; g.fillText(o.staff, W / 2, ty + 650); }
  g.fillStyle = '#fff'; g.font = `700 40px ${SANS}`; g.fillText(o.cta, W / 2, 1480);
  footer(g, o.salon, o.handle, o.logo, 1680);
}

export interface NoubaInput { salon: string; handle?: string; logo?: Img; primary: string; place: string; line: string; wait?: string; cta: string }
export function drawNouba(c: HTMLCanvasElement, o: NoubaInput, scale = 1) {
  c.width = Math.round(W * scale); c.height = Math.round(H * scale);
  const g = c.getContext('2d')!; g.setTransform(scale, 0, 0, scale, 0, 0); g.direction = 'ltr';
  backdrop(g, o.primary);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // a barber pole of stripes behind the number
  g.save(); g.translate(W / 2, 780); g.rotate(-0.5);
  for (let i = -16; i < 16; i++) { g.fillStyle = i % 2 ? 'rgba(255,107,139,.18)' : 'rgba(255,255,255,.08)'; g.fillRect(i * 90, -1800, 90, 3600); }
  g.restore();
  g.fillStyle = '#fff'; fit(g, o.line, 900, 70, 'italic 600', SERIF, 36); g.fillText(o.line, W / 2, 360);
  g.save(); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 50; g.shadowOffsetY = 24;
  g.beginPath(); g.arc(W / 2, 800, 300, 0, 7); g.fillStyle = '#fffaf3'; g.fill(); g.restore();
  g.fillStyle = mix(o.primary, '#000000', 0.35); fit(g, o.place, 480, 300, 600, SERIF, 120); g.fillText(o.place, W / 2, 815);
  if (o.wait) {
    g.font = `800 50px ${SANS}`; const ww = g.measureText(o.wait).width + 100;
    rr(g, W / 2 - ww / 2, 1170, ww, 100, 50); g.fillStyle = '#ff6b8b'; g.fill(); g.fillStyle = '#fff'; g.fillText(o.wait, W / 2, 1222);
  }
  g.fillStyle = '#fff'; fit(g, o.cta, 900, 60, 700, SANS, 34); g.fillText(o.cta, W / 2, 1420);
  footer(g, o.salon, o.handle, o.logo, 1680);
}
