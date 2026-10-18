// Story Maker engine: draws a dish as a shareable Instagram image on a canvas, in the restaurant's brand colours.
export type StoryStyle = 'signature' | 'poster' | 'editorial' | 'polaroid' | 'sunburst';
export type StoryFormat = 'story' | 'feed' | 'square';
export const FORMATS: Record<StoryFormat, { w: number; h: number }> = { story: { w: 1080, h: 1920 }, feed: { w: 1080, h: 1350 }, square: { w: 1080, h: 1080 } };
export const STYLES: StoryStyle[] = ['signature', 'poster', 'editorial', 'polaroid', 'sunburst'];

export interface StoryInput {
  style: StoryStyle; format: StoryFormat; name: string; description?: string; price?: string; badge?: string;
  restaurant: string; handle?: string; logo?: string | null; photo?: string | null;
  primary: string; rtl: boolean; showPrice: boolean;
}

const SERIF = '"Fraunces Variable", "IBM Plex Sans Arabic", Georgia, serif';
const SANS = '"Plus Jakarta Sans Variable", "IBM Plex Sans Arabic", system-ui, sans-serif';
type Ctx = CanvasRenderingContext2D;

function rgb(hex: string): [number, number, number] {
  let h = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? 'c8553d'; if (h.length === 3) h = h.replace(/./g, '$&$&');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const rgba = (hex: string, a: number) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
function mix(hex: string, to: string, k: number) { const a = rgb(hex), b = rgb(to); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`; }
function lum(hex: string) { const [r, g, b] = rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }

function loadImg(url?: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise(res => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
}
function cover(g: Ctx, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight), dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
function lines(g: Ctx, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean), out: string[] = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur);
  if (out.length > maxLines) { const k = out.slice(0, maxLines); k[maxLines - 1] = k[maxLines - 1].replace(/\s*\S*$/, '') + '…'; return k; }
  return out;
}
/** fits the dish name in the box: shrinks the font until it fits in maxLines */
function fitName(g: Ctx, text: string, maxW: number, maxLines: number, size: number, min: number, weight = 700, family = SERIF) {
  let s = size, l: string[] = [];
  for (; s >= min; s -= 4) { g.font = `${weight} ${s}px ${family}`; l = lines(g, text, maxW, 9); if (l.length <= maxLines) break; }
  g.font = `${weight} ${s}px ${family}`; l = lines(g, text, maxW, maxLines);
  return { l, s };
}
function grain(g: Ctx, w: number, h: number, a = 0.06) {
  const n = document.createElement('canvas'); n.width = n.height = 160; const x = n.getContext('2d')!; const d = x.createImageData(160, 160);
  for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255 * a; }
  x.putImageData(d, 0, 0); g.fillStyle = g.createPattern(n, 'repeat')!; g.fillRect(0, 0, w, h);
}
function pill(g: Ctx, text: string, cx: number, cy: number, bg: string, fg: string, size = 34) {
  g.font = `700 ${size}px ${SANS}`; if ('letterSpacing' in g) (g as any).letterSpacing = `${size * 0.14}px`;
  const t = text.toUpperCase(), w = g.measureText(t).width + size * 2.2, h = size * 2;
  g.fillStyle = bg; g.beginPath(); g.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2); g.fill();
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, cx + size * 0.07, cy + 2);
  if ('letterSpacing' in g) (g as any).letterSpacing = '0px';
}
function priceTag(g: Ctx, text: string, cx: number, cy: number, r: number, bg: string, fg: string, rot = -0.14) {
  g.save(); g.translate(cx, cy); g.rotate(rot);
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 40; g.shadowOffsetY = 14;
  g.fillStyle = bg; g.beginPath(); for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2, rr = i % 2 ? r * 0.93 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); g.fill();
  g.shadowColor = 'transparent'; g.strokeStyle = rgba(fg, 0.5); g.lineWidth = 3; g.setLineDash([10, 8]); g.beginPath(); g.arc(0, 0, r * 0.82, 0, 7); g.stroke(); g.setLineDash([]);
  const parts = text.split(' '), num = parts[0], unit = parts.slice(1).join(' ');
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  let s = r * 0.62; g.font = `800 ${s}px ${SERIF}`; while (g.measureText(num).width > r * 1.35 && s > 30) { s -= 4; g.font = `800 ${s}px ${SERIF}`; }
  g.fillText(num, 0, unit ? -r * 0.06 : 0); if (unit) { g.font = `700 ${r * 0.25}px ${SANS}`; g.fillText(unit, 0, r * 0.38); }
  g.restore();
}
function footer(g: Ctx, o: StoryInput, logo: HTMLImageElement | null, w: number, y: number, fg: string, accent: string) {
  g.textBaseline = 'middle'; g.textAlign = 'center'; let x = w / 2;
  g.font = `700 40px ${SERIF}`; const nm = o.restaurant, nw = g.measureText(nm).width, lw = logo ? 72 : 0, gap = logo ? 22 : 0, tot = lw + gap + nw;
  x = w / 2 - tot / 2;
  if (logo) { g.save(); g.beginPath(); g.arc(x + 36, y, 36, 0, 7); g.clip(); cover(g, logo, x, y - 36, 72, 72); g.restore(); g.strokeStyle = accent; g.lineWidth = 3; g.beginPath(); g.arc(x + 36, y, 36, 0, 7); g.stroke(); }
  g.fillStyle = fg; g.textAlign = 'left'; g.fillText(nm, x + lw + gap, y);
  if (o.handle) { g.textAlign = 'center'; g.font = `600 30px ${SANS}`; g.fillStyle = accent; g.fillText('@' + o.handle.replace(/^@/, ''), w / 2, y + 62); }
}
function nameBlock(g: Ctx, o: StoryInput, x: number, y: number, maxW: number, fg: string, sub: string, size: number, align: CanvasTextAlign, maxLines = 3) {
  g.textAlign = align; g.textBaseline = 'alphabetic';
  const { l, s } = fitName(g, o.name, maxW, maxLines, size, 64); g.fillStyle = fg;
  l.forEach((t, i) => g.fillText(t, x, y + i * s * 1.08)); let yy = y + (l.length - 1) * s * 1.08;
  if (o.description) { g.font = `500 ${Math.round(size * 0.3)}px ${SANS}`; const d = lines(g, o.description, maxW, 2); g.fillStyle = sub; d.forEach((t, i) => g.fillText(t, x, yy + size * 0.5 + i * size * 0.4)); yy += size * 0.5 + (d.length - 1) * size * 0.4; }
  return yy;
}

export async function renderStory(c: HTMLCanvasElement, o: StoryInput) {
  const { w, h } = FORMATS[o.format]; c.width = w; c.height = h; const g = c.getContext('2d')!;
  if (document.fonts) await Promise.all(['800 60px "Fraunces Variable"', '700 40px "Plus Jakarta Sans Variable"', '600 40px "IBM Plex Sans Arabic"'].map(f => document.fonts.load(f, 'Aa أب').catch(() => null)));
  const [photo, logo] = await Promise.all([loadImg(o.photo), loadImg(o.logo)]);
  g.direction = o.rtl ? 'rtl' : 'ltr'; g.clearRect(0, 0, w, h);
  const P = o.primary, tall = h > 1500, hasP = !!(o.showPrice && o.price);
  const bright = lum(P) > 0.62, onP = bright ? '#1a1410' : '#fff';

  if (o.style === 'signature') {            // dark, gold arch window
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#15110d'); bg.addColorStop(1, mix(P, '#000', 0.78)); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const glow = g.createRadialGradient(w / 2, h * 0.34, 50, w / 2, h * 0.34, w * 0.8); glow.addColorStop(0, rgba(P, 0.5)); glow.addColorStop(1, rgba(P, 0)); g.fillStyle = glow; g.fillRect(0, 0, w, h);
    const aw = w * 0.74, ax = (w - aw) / 2, ay = tall ? 250 : 150, ah = tall ? 920 : h * 0.4;
    const arch = (x: number, y: number, ww: number, hh: number) => { g.beginPath(); g.moveTo(x, y + hh); g.lineTo(x, y + ww / 2); g.arc(x + ww / 2, y + ww / 2, ww / 2, Math.PI, 0); g.lineTo(x + ww, y + hh); g.closePath(); };
    g.strokeStyle = mix(P, '#ffffff', 0.55); g.lineWidth = 3; arch(ax - 28, ay - 28, aw + 56, ah + 56); g.stroke();
    g.save(); arch(ax, ay, aw, ah); g.clip(); if (photo) cover(g, photo, ax, ay, aw, ah); else { g.fillStyle = mix(P, '#000', 0.4); g.fillRect(ax, ay, aw, ah); } g.restore();
    pill(g, o.badge || 'Coup de cœur', w / 2, ay - 70 + (tall ? 0 : 20), P, onP, 30);
    if (hasP) priceTag(g, o.price!, ax + aw - 40, ay + ah - 60, tall ? 150 : 120, '#f4e3b8', '#2a1c0c');
    const ny = ay + ah + (tall ? 190 : 120); nameBlock(g, o, w / 2, ny, w - 200, '#fff6e6', 'rgba(255,246,230,.7)', tall ? 108 : 72, 'center', tall ? 3 : 2);
    footer(g, o, logo, w, h - (tall ? 190 : 120), '#fff6e6', mix(P, '#fff', 0.6));
    grain(g, w, h, 0.05);
  } else if (o.style === 'poster') {        // full-bleed photo, giant type
    g.fillStyle = mix(P, '#000', 0.6); g.fillRect(0, 0, w, h); if (photo) cover(g, photo, 0, 0, w, h);
    const top = g.createLinearGradient(0, 0, 0, h * 0.28); top.addColorStop(0, 'rgba(0,0,0,.55)'); top.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = top; g.fillRect(0, 0, w, h * 0.28);
    const bot = g.createLinearGradient(0, h * 0.42, 0, h); bot.addColorStop(0, 'rgba(0,0,0,0)'); bot.addColorStop(0.7, mix(P, '#000', 0.7).replace('rgb', 'rgba').replace(')', ',.92)')); bot.addColorStop(1, 'rgba(0,0,0,.96)'); g.fillStyle = bot; g.fillRect(0, h * 0.42, w, h * 0.58);
    pill(g, o.badge || 'Coup de cœur', w / 2, tall ? 170 : 110, P, onP, 30);
    const base = h - (tall ? 840 : 640); g.fillStyle = P; g.fillRect(w / 2 - 60, base - (tall ? 190 : 150), 120, 8);
    const yy = nameBlock(g, o, w / 2, base, w - 140, '#fff', 'rgba(255,255,255,.78)', tall ? 150 : 120, 'center');
    if (hasP) { g.font = `700 64px ${SERIF}`; g.fillStyle = mix(P, '#fff', 0.55); g.textAlign = 'center'; g.fillText(o.price!, w / 2, yy + 100); }
    footer(g, o, logo, w, h - (tall ? 170 : 110), '#fff', mix(P, '#fff', 0.6));
    grain(g, w, h, 0.045);
  } else if (o.style === 'editorial') {     // cream paper, magazine layout
    g.fillStyle = '#f6efe3'; g.fillRect(0, 0, w, h); g.strokeStyle = P; g.lineWidth = 3; g.strokeRect(46, 46, w - 92, h - 92); g.lineWidth = 1; g.strokeRect(62, 62, w - 124, h - 124);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `600 28px ${SANS}`; g.fillStyle = P; if ('letterSpacing' in g) (g as any).letterSpacing = '8px'; g.fillText((o.badge || 'Coup de cœur').toUpperCase(), w / 2, 130); if ('letterSpacing' in g) (g as any).letterSpacing = '0px';
    const pw = w - 260, ph = tall ? 900 : h * 0.46, px = 130, py = 190;
    g.save(); g.shadowColor = 'rgba(60,35,10,.3)'; g.shadowBlur = 50; g.shadowOffsetY = 24; g.fillStyle = '#fff'; g.fillRect(px - 18, py - 18, pw + 36, ph + 36); g.restore();
    if (photo) { g.save(); g.beginPath(); g.rect(px, py, pw, ph); g.clip(); cover(g, photo, px, py, pw, ph); g.restore(); } else { g.fillStyle = rgba(P, 0.3); g.fillRect(px, py, pw, ph); }
    if (hasP) priceTag(g, o.price!, px + pw - 20, py + ph + 10, tall ? 130 : 105, P, onP, 0.12);
    nameBlock(g, o, w / 2, py + ph + (tall ? 200 : 150), w - 220, '#2b1d12', 'rgba(43,29,18,.68)', tall ? 104 : 84, 'center');
    footer(g, o, logo, w, h - (tall ? 190 : 140), '#2b1d12', P);
    grain(g, w, h, 0.035);
  } else if (o.style === 'polaroid') {      // tilted polaroid on brand colour
    const bg = g.createLinearGradient(0, 0, w, h); bg.addColorStop(0, mix(P, '#fff', 0.12)); bg.addColorStop(1, mix(P, '#000', 0.35)); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.07)'; for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(((i * 337) % w), ((i * 521) % h), 90 + (i % 3) * 70, 0, 7); g.fill(); }
    const pw = w * 0.76, ph = pw * 1.18, cx = w / 2, cy = tall ? 760 : h * 0.44;
    g.save(); g.translate(cx, cy); g.rotate(-0.05); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 70; g.shadowOffsetY = 36; g.fillStyle = '#fffdf8'; g.fillRect(-pw / 2, -ph / 2, pw, ph); g.shadowColor = 'transparent';
    const m = 36, iw = pw - m * 2, ih = ph - m - 250; g.save(); g.beginPath(); g.rect(-pw / 2 + m, -ph / 2 + m, iw, ih); g.clip(); if (photo) cover(g, photo, -pw / 2 + m, -ph / 2 + m, iw, ih); else { g.fillStyle = rgba(P, 0.4); g.fillRect(-pw / 2 + m, -ph / 2 + m, iw, ih); } g.restore();
    g.fillStyle = '#2b1d12'; g.textAlign = 'center'; g.textBaseline = 'middle'; const f = fitName(g, o.name, iw, 2, 64, 36, 600, SERIF); f.l.forEach((t, i) => g.fillText(t, 0, ph / 2 - 125 + (i - (f.l.length - 1) / 2) * f.s * 1.05));
    g.fillStyle = rgba(P, 0.85); g.fillRect(-90, -ph / 2 - 26, 180, 52); g.restore();
    if (hasP) priceTag(g, o.price!, cx + pw / 2 - 30, cy + ph / 2 - 40, 125, '#fffdf8', '#2b1d12', 0.14);
    pill(g, o.badge || 'Coup de cœur', w / 2, tall ? 150 : 100, '#fffdf8', '#2b1d12', 30);
    footer(g, o, logo, w, h - (tall ? 190 : 120), '#fff', '#fff');
    grain(g, w, h, 0.05);
  } else {                                   // sunburst: solid brand colour, photo circle, rays
    g.fillStyle = P; g.fillRect(0, 0, w, h); const cx = w / 2, cy = tall ? 700 : h * 0.4, R = w * 0.38;
    g.save(); g.translate(cx, cy); for (let i = 0; i < 24; i++) { g.rotate(Math.PI / 12); g.fillStyle = i % 2 ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.06)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(-w, -h * 1.2); g.lineTo(w, -h * 1.2); g.closePath(); g.fill(); } g.restore();
    g.save(); g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = 60; g.shadowOffsetY = 30; g.fillStyle = bright ? '#1a1410' : '#fff'; g.beginPath(); g.arc(cx, cy, R + 26, 0, 7); g.fill(); g.restore();
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip(); if (photo) cover(g, photo, cx - R, cy - R, R * 2, R * 2); else { g.fillStyle = mix(P, '#000', 0.3); g.fillRect(cx - R, cy - R, R * 2, R * 2); } g.restore();
    pill(g, o.badge || 'Coup de cœur', w / 2, tall ? 170 : 100, bright ? '#1a1410' : '#fff', bright ? '#fff' : P, 30);
    if (hasP) priceTag(g, o.price!, cx + R - 40, cy + R - 30, tall ? 135 : 110, bright ? '#1a1410' : '#fff', bright ? '#fff' : P, 0.16);
    nameBlock(g, o, w / 2, cy + R + (tall ? 190 : 150), w - 160, onP, bright ? 'rgba(26,20,16,.75)' : 'rgba(255,255,255,.82)', tall ? 112 : 90, 'center');
    footer(g, o, logo, w, h - (tall ? 190 : 120), onP, onP);
    grain(g, w, h, 0.04);
  }
}
export const canvasBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('png'))), 'image/png'));
