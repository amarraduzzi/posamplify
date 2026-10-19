// The guest's "J'étais là" story: the dish they just ordered, stuck on the restaurant's colour like a sticker,
// with a big stamp, doodles, confetti and a funny line. Nothing for the guest to do: it is ready to post (9:16).
export interface StoryInput {
  photo: (CanvasImageSource & { width: number; height: number }) | null;
  dishName: string;
  phrase: Phrase;
  restaurant: string;
  handle?: string;
  logo?: HTMLImageElement | null;
  primary: string;
  dateText: string;
  seed: number;
}
export interface Phrase { text: string; rtl?: boolean }
export const W = 1080, H = 1920;
const SERIF = '"Fraunces Variable", "IBM Plex Sans Arabic", Georgia, serif';
const SANS = '"Plus Jakarta Sans Variable", "IBM Plex Sans Arabic", system-ui, sans-serif';

/** Funny lines: French, English and Moroccan Arabic (Darija), picked at random. */
export const PHRASES: Phrase[] = [
  { text: 'Régime : demain' },
  { text: 'Ne me parlez pas, je mange' },
  { text: 'Mon ventre dit merci' },
  { text: 'Plat vu, plat vaincu' },
  { text: 'Je partage ? Non.' },
  { text: 'Calories : non comptées' },
  { text: 'Fourchette en main, soucis dehors' },
  { text: 'Mon cardio ? Aller au resto' },
  { text: 'Diet starts tomorrow' },
  { text: 'Do not disturb, I’m eating' },
  { text: 'I came, I saw, I ate' },
  { text: 'My stomach says thank you' },
  { text: 'الدييت؟ غدا إن شاء الله', rtl: true },
  { text: 'بطني كيقول ليكم شكرا', rtl: true },
  { text: 'ما تهضرو معايا، كنوكل', rtl: true },
  { text: 'جيت، شفت، كليت', rtl: true },
  { text: 'الله يعمرها، بنينة!', rtl: true },
];

function rgb(hex: string): [number, number, number] {
  let h = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? 'c8553d'; if (h.length === 3) h = h.replace(/./g, '$&$&');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const mix = (hex: string, to: string, k: number) => { const a = rgb(hex), b = rgb(to); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`; };
const lum = (hex: string) => { const [r, g, b] = rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
function rand(seed: number) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export async function loadFonts() {
  if (!document.fonts) return;
  await Promise.all(['700 60px "Fraunces Variable"', '700 40px "Plus Jakarta Sans Variable"', '700 40px "IBM Plex Sans Arabic"'].map(f => document.fonts.load(f, 'Aa أب').catch(() => null)));
}
export function loadImage(url?: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise(res => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = rot + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath(); g.fill();
}
function heart(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.beginPath(); g.moveTo(x, y + s * 0.35);
  g.bezierCurveTo(x - s, y - s * 0.3, x - s * 0.5, y - s, x, y - s * 0.4);
  g.bezierCurveTo(x + s * 0.5, y - s, x + s, y - s * 0.3, x, y + s * 0.35); g.fill();
}
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function fit(g: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight: number, family: string, min = 28) {
  let fs = size; g.font = `${weight} ${fs}px ${family}`;
  while (g.measureText(text).width > maxW && fs > min) { fs -= 3; g.font = `${weight} ${fs}px ${family}`; }
  return fs;
}
/** Break a line into at most `max` lines that fit `maxW`. */
function wrap(g: CanvasRenderingContext2D, text: string, maxW: number, max = 2) {
  const words = text.split(/\s+/); const lines: string[] = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (g.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur);
  return lines.length > max ? [...lines.slice(0, max - 1), lines.slice(max - 1).join(' ')] : lines;
}

export function drawStory(c: HTMLCanvasElement, o: StoryInput, scale = 1) {
  c.width = Math.round(W * scale); c.height = Math.round(H * scale);
  const g = c.getContext('2d')!; g.setTransform(scale, 0, 0, scale, 0, 0); g.direction = 'ltr';
  const rnd = rand(o.seed), P = o.primary;
  const light = lum(P) > 0.62;           // a pale brand colour gets dark doodles
  const INK = light ? '#1d1a17' : '#ffffff';
  const POP = light ? mix(P, '#000000', 0.45) : '#ffe45c';   // doodle accent

  // background: brand colour, halftone dots, sun-burst
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, mix(P, '#ffffff', 0.16)); bg.addColorStop(1, mix(P, '#000000', 0.42)); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.save(); g.translate(W / 2, 800); g.fillStyle = 'rgba(255,255,255,.07)';
  for (let i = 0; i < 18; i++) { g.rotate((Math.PI * 2) / 18); g.beginPath(); g.moveTo(0, 0); g.lineTo(-90, -1500); g.lineTo(90, -1500); g.closePath(); if (i % 2) g.fill(); }
  g.restore();
  g.fillStyle = 'rgba(255,255,255,.09)';
  for (let y = 0; y < H; y += 46) for (let x = (y / 46) % 2 ? 23 : 0; x < W; x += 46) { g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fill(); }

  // confetti
  const cols = [POP, '#ffffff', mix(P, '#ffffff', 0.55), '#ff5d8f', '#4de1c1'];
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W, y = rnd() * H; if (y > 560 && y < 1480 && x > 130 && x < W - 130 && rnd() < 0.8) continue;
    g.save(); g.translate(x, y); g.rotate(rnd() * 6.3); g.fillStyle = cols[i % cols.length];
    if (i % 3 === 0) { g.beginPath(); g.arc(0, 0, 8 + rnd() * 8, 0, 7); g.fill(); } else g.fillRect(-9, -4, 18 + rnd() * 14, 8 + rnd() * 5);
    g.restore();
  }

  // top stamp: J'ÉTAIS LÀ
  g.save(); g.translate(W / 2, 285); g.rotate(-0.07);
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 40; g.shadowOffsetY = 18;
  roundRect(g, -440, -165, 880, 330, 36); g.fillStyle = '#fffaf0'; g.fill(); g.shadowColor = 'transparent';
  const ink = mix(P, '#000000', 0.5);
  g.lineWidth = 12; g.strokeStyle = ink; roundRect(g, -420, -145, 840, 290, 24); g.stroke();
  g.lineWidth = 4; roundRect(g, -400, -125, 800, 250, 14); g.stroke();
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  fit(g, 'J’ÉTAIS LÀ', 740, 150, 800, SERIF, 60); g.fillText('J’ÉTAIS LÀ', 0, -28);
  g.font = `700 44px ${SANS}`; g.fillText('I WAS HERE  ·  ', -118, 76); g.direction = 'rtl'; g.font = `700 50px ${SANS}`; g.textAlign = 'left'; g.fillText('كنت هنا', 150, 76); g.direction = 'ltr';
  g.restore();

  // the dish: a crooked sticker with a white outline
  const cx = W / 2, cy = 880, R = 345;
  g.save(); g.translate(cx, cy); g.rotate(0.06);
  g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 60; g.shadowOffsetY = 32;
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0, 0, R + 30, 0, 7); g.fill(); g.shadowColor = 'transparent';
  g.save(); g.beginPath(); g.arc(0, 0, R, 0, 7); g.clip();
  if (o.photo) {
    const s = Math.max((R * 2) / o.photo.width, (R * 2) / o.photo.height), dw = o.photo.width * s, dh = o.photo.height * s;
    g.drawImage(o.photo, -dw / 2, -dh / 2, dw, dh);
    g.globalCompositeOperation = 'soft-light'; g.fillStyle = 'rgba(255,190,110,.25)'; g.fillRect(-R, -R, R * 2, R * 2); g.globalCompositeOperation = 'source-over';
  } else { g.fillStyle = mix(P, '#ffffff', 0.8); g.fillRect(-R, -R, R * 2, R * 2); g.font = `400 340px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🍽️', 0, 10); }
  g.restore();
  // sticker shine
  g.save(); g.beginPath(); g.arc(0, 0, R, 0, 7); g.clip(); const sh = g.createLinearGradient(-R, -R, R, R); sh.addColorStop(0.15, 'rgba(255,255,255,.28)'); sh.addColorStop(0.32, 'rgba(255,255,255,0)'); g.fillStyle = sh; g.fillRect(-R, -R, R * 2, R * 2); g.restore();
  g.restore();

  // dish name ribbon
  g.save(); g.translate(cx + 10, cy + R + 40); g.rotate(-0.04);
  g.textAlign = 'center'; g.textBaseline = 'middle'; const name = o.dishName.toUpperCase();
  fit(g, name, 640, 54, 800, SANS, 30); const nw = Math.min(g.measureText(name).width + 90, 800);
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 24; g.shadowOffsetY = 10; roundRect(g, -nw / 2, -48, nw, 96, 48); g.fillStyle = POP; g.fill(); g.shadowColor = 'transparent';
  g.fillStyle = light ? '#ffffff' : '#1d1a17'; g.fillText(name, 0, 4); g.restore();

  // doodles: stars, hearts, arrow, squiggles
  g.fillStyle = POP; star(g, 170, 700, 62, 0.3); star(g, 905, 1180, 50, 0.9); star(g, 235, 1215, 34, 0.1); star(g, 930, 640, 30, 0.6);
  g.fillStyle = '#ff5d8f'; heart(g, 890, 790, 52); heart(g, 150, 980, 38);
  g.strokeStyle = INK; g.lineWidth = 12; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(880, 1010); g.bezierCurveTo(960, 930, 930, 850, 850, 880); g.stroke();              // arrow pointing at the dish
  g.beginPath(); g.moveTo(822, 835); g.lineTo(850, 884); g.lineTo(895, 856); g.stroke();
  g.lineWidth = 9; g.beginPath(); g.moveTo(90, 1130); for (let i = 1; i <= 6; i++) g.lineTo(90 + i * 24, 1130 + (i % 2 ? -22 : 22)); g.stroke();
  g.beginPath(); g.moveTo(880, 560); for (let i = 1; i <= 5; i++) g.lineTo(880 + i * 22, 560 + (i % 2 ? -20 : 20)); g.stroke();

  // the funny line, on a taped note
  g.save(); g.translate(W / 2, 1480); g.rotate(0.035);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = o.phrase.rtl ? 'rtl' : 'ltr';
  const fs0 = o.phrase.rtl ? 82 : 78; g.font = `700 ${fs0}px ${o.phrase.rtl ? SANS : SERIF}`;
  const lines = wrap(g, o.phrase.text, 780, 2), fs = lines.length > 1 ? fs0 - 8 : fs0; g.font = `700 ${fs}px ${o.phrase.rtl ? SANS : SERIF}`;
  const bh = lines.length * (fs + 18) + 70;
  g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = 36; g.shadowOffsetY = 16; roundRect(g, -460, -bh / 2, 920, bh, 28); g.fillStyle = '#fffdf6'; g.fill(); g.shadowColor = 'transparent';
  g.fillStyle = 'rgba(255,214,90,.9)'; g.save(); g.rotate(-0.08); g.fillRect(-90, -bh / 2 - 22, 180, 48); g.restore();
  g.fillStyle = '#2b1d12'; lines.forEach((ln, i) => g.fillText(ln, 0, (i - (lines.length - 1) / 2) * (fs + 18) + 6));
  g.restore(); g.direction = 'ltr';

  // footer: logo, restaurant, date, @handle
  g.textBaseline = 'middle'; const y = 1690; g.font = `700 46px ${SERIF}`; g.fillStyle = '#fff';
  const nw2 = g.measureText(o.restaurant).width, lw = o.logo ? 84 : 0, gap = o.logo ? 24 : 0, x0 = W / 2 - (lw + gap + nw2) / 2;
  if (o.logo) { g.save(); g.beginPath(); g.arc(x0 + 42, y, 42, 0, 7); g.clip(); g.drawImage(o.logo, x0, y - 42, 84, 84); g.restore(); g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(x0 + 42, y, 42, 0, 7); g.stroke(); }
  g.textAlign = 'left'; g.fillText(o.restaurant, x0 + lw + gap, y);
  g.textAlign = 'center'; g.font = `700 32px ${SANS}`; g.fillStyle = 'rgba(255,255,255,.75)'; g.fillText(o.dateText, W / 2, y + 62);
  if (o.handle) { g.font = `700 40px ${SANS}`; g.fillStyle = POP; g.fillText('@' + o.handle.replace(/^@/, ''), W / 2, y + 122); }
}
export const pngBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('png'))), 'image/png'));
