// Story Maker engine: draws a dish as a shareable Instagram image on a canvas, in the restaurant's brand colours.
export type Mood = 'none' | 'warm' | 'fresh' | 'moody';
export type StoryStyle = 'studio' | 'signature' | 'poster' | 'editorial' | 'polaroid' | 'sunburst';
export type StoryFormat = 'story' | 'feed' | 'square';
export const FORMATS: Record<StoryFormat, { w: number; h: number }> = { story: { w: 1080, h: 1920 }, feed: { w: 1080, h: 1350 }, square: { w: 1080, h: 1080 } };
export const STYLES: StoryStyle[] = ['studio', 'signature', 'poster', 'editorial', 'polaroid', 'sunburst'];

export interface StoryInput {
  style: StoryStyle; format: StoryFormat; name: string; description?: string; price?: string; badge?: string;
  restaurant: string; handle?: string; logo?: string | null; photo?: string | null;
  primary: string; rtl: boolean; showPrice: boolean;
  /** photo grading */ mood: Mood;
  /** the dish cut out of its background (PNG with transparency), for the Studio style */ cutout?: string | null;
}

const SERIF = '"Fraunces Variable", "IBM Plex Sans Arabic", Georgia, serif';
const SANS = '"Plus Jakarta Sans Variable", "IBM Plex Sans Arabic", system-ui, sans-serif';
type Ctx = CanvasRenderingContext2D;
type Img = HTMLImageElement | HTMLCanvasElement;
const dims = (i: Img): [number, number] => (i instanceof HTMLImageElement ? [i.naturalWidth, i.naturalHeight] : [i.width, i.height]);
// animation state for the frame being drawn: T = progress 0..1 (1 = finished still), ZM = photo zoom, PHOTO = the dish photo
let T = 1, ZM = 1, PHOTO: Img | null = null;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const kk = (a: number, b: number, back = false) => { const x = clamp((T - a) / (b - a)); return back ? 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2) : 1 - Math.pow(1 - x, 3); };

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
function cover(g: Ctx, img: Img, x: number, y: number, w: number, h: number) {
  const [iw, ih] = dims(img), s = Math.max(w / iw, h / ih) * (img === PHOTO ? ZM : 1), dw = iw * s, dh = ih * s;
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
const grainCache = new Map<number, HTMLCanvasElement>();
function grain(g: Ctx, w: number, h: number, a = 0.06) {
  let n = grainCache.get(a);
  if (!n) { n = document.createElement('canvas'); n.width = n.height = 160; const x = n.getContext('2d')!; const d = x.createImageData(160, 160);
    for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255 * a; }
    x.putImageData(d, 0, 0); grainCache.set(a, n); }
  g.fillStyle = g.createPattern(n, 'repeat')!; g.fillRect(0, 0, w, h);
}
function bokeh(g: Ctx, w: number, h: number) {
  const fade = 1 - clamp((T - 0.8) / 0.2); if (fade <= 0) return;
  for (let i = 0; i < 16; i++) {
    const sp = 0.35 + (i % 5) * 0.12, x = (i * 397) % w + Math.sin(T * 6 + i) * 20, y = h - (((i * 211) % h) + T * h * sp) % h, r = 10 + (i % 4) * 9;
    g.fillStyle = rgba('#ffffff', 0.12 + (i % 3) * 0.05); g.globalAlpha = fade;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
}
function pill(g: Ctx, text: string, cx: number, cy: number, bg: string, fg: string, size = 34) {
  const p = kk(0.05, 0.25); g.save(); g.globalAlpha *= clamp(p); g.translate(0, -30 * (1 - p));
  g.font = `700 ${size}px ${SANS}`; if ('letterSpacing' in g) (g as any).letterSpacing = `${size * 0.14}px`;
  const t = text.toUpperCase(), w = g.measureText(t).width + size * 2.2, h = size * 2;
  g.fillStyle = bg; g.beginPath(); g.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2); g.fill();
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, cx + size * 0.07, cy + 2);
  if ('letterSpacing' in g) (g as any).letterSpacing = '0px';
  g.restore();
}
function priceTag(g: Ctx, text: string, cx: number, cy: number, r: number, bg: string, fg: string, rot = -0.14) {
  const p = kk(0.4, 0.62, true); g.save(); g.translate(cx, cy); g.scale(Math.max(p, 0.001), Math.max(p, 0.001)); g.globalAlpha *= clamp(p * 2); g.rotate(rot);
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 40; g.shadowOffsetY = 14;
  g.fillStyle = bg; g.beginPath(); for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2, rr = i % 2 ? r * 0.93 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); g.fill();
  g.shadowColor = 'transparent';
  if (T < 1) { const sx = (-1.5 + 3 * kk(0.62, 0.95)) * r, gr = g.createLinearGradient(sx - r * 0.3, -r, sx + r * 0.3, r); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.save(); g.clip(); g.fillStyle = gr; g.fillRect(-r, -r, r * 2, r * 2); g.restore(); }
  g.strokeStyle = rgba(fg, 0.5); g.lineWidth = 3; g.setLineDash([10, 8]); g.beginPath(); g.arc(0, 0, r * 0.82, 0, 7); g.stroke(); g.setLineDash([]);
  const parts = text.split(' '), num = parts[0], unit = parts.slice(1).join(' ');
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  let s = r * 0.62; g.font = `800 ${s}px ${SERIF}`; while (g.measureText(num).width > r * 1.35 && s > 30) { s -= 4; g.font = `800 ${s}px ${SERIF}`; }
  g.fillText(num, 0, unit ? -r * 0.06 : 0); if (unit) { g.font = `700 ${r * 0.25}px ${SANS}`; g.fillText(unit, 0, r * 0.38); }
  g.restore();
}
function footer(g: Ctx, o: StoryInput, logo: HTMLImageElement | null, w: number, y: number, fg: string, accent: string) {
  const fp = kk(0.7, 0.95); g.save(); g.globalAlpha *= fp;
  g.textBaseline = 'middle'; g.textAlign = 'center'; let x = w / 2;
  g.font = `700 40px ${SERIF}`; const nm = o.restaurant, nw = g.measureText(nm).width, lw = logo ? 72 : 0, gap = logo ? 22 : 0, tot = lw + gap + nw;
  x = w / 2 - tot / 2;
  if (logo) { g.save(); g.beginPath(); g.arc(x + 36, y, 36, 0, 7); g.clip(); cover(g, logo, x, y - 36, 72, 72); g.restore(); g.strokeStyle = accent; g.lineWidth = 3; g.beginPath(); g.arc(x + 36, y, 36, 0, 7); g.stroke(); }
  g.fillStyle = fg; g.textAlign = 'left'; g.fillText(nm, x + lw + gap, y);
  if (o.handle) { g.textAlign = 'center'; g.font = `600 30px ${SANS}`; g.fillStyle = accent; g.fillText('@' + o.handle.replace(/^@/, ''), w / 2, y + 62); }
  g.restore();
}
function nameBlock(g: Ctx, o: StoryInput, x: number, y: number, maxW: number, fg: string, sub: string, size: number, align: CanvasTextAlign, maxLines = 3) {
  const np = kk(0.45, 0.78); g.save(); g.globalAlpha *= clamp(np * 1.3); g.translate(0, 50 * (1 - np));
  g.textAlign = align; g.textBaseline = 'alphabetic';
  const { l, s } = fitName(g, o.name, maxW, maxLines, size, 64); g.fillStyle = fg;
  l.forEach((t, i) => g.fillText(t, x, y + i * s * 1.08)); let yy = y + (l.length - 1) * s * 1.08;
  if (o.description) { g.font = `500 ${Math.round(size * 0.3)}px ${SANS}`; const d = lines(g, o.description, maxW, 2); g.fillStyle = sub; d.forEach((t, i) => g.fillText(t, x, yy + size * 0.5 + i * size * 0.4)); yy += size * 0.5 + (d.length - 1) * size * 0.4; }
  g.restore();
  return yy;
}

/** height of the name block below its first baseline, and the cap height of its first line: lets a layout reserve exactly the room the text will take */
function measureName(g: Ctx, o: StoryInput, maxW: number, size: number, maxLines: number) {
  const { l, s } = fitName(g, o.name, maxW, maxLines, size, 64); let h = (l.length - 1) * s * 1.08 + s * 0.25;
  if (o.description) { g.font = `500 ${Math.round(size * 0.3)}px ${SANS}`; const d = lines(g, o.description, maxW, 2); h = (l.length - 1) * s * 1.08 + size * 0.5 + (d.length - 1) * size * 0.4 + size * 0.3; }
  return { h, cap: s * 0.75 };
}

// ---- cinematic photo grading: split toning, saturation, S-curve contrast, then vignette and a soft light leak
const MOODS: Record<Exclude<Mood, 'none'>, { gain: number[]; lift: number[]; contrast: number; sat: number; bright: number; vig: number; leak: string }> = {
  warm: { gain: [1.07, 1.02, 0.9], lift: [0.02, 0, -0.01], contrast: 1.14, sat: 1.2, bright: 1.02, vig: 0.4, leak: '255,170,90' },
  fresh: { gain: [0.98, 1.03, 1.05], lift: [0, 0.01, 0.025], contrast: 1.08, sat: 1.25, bright: 1.06, vig: 0.18, leak: '255,255,230' },
  moody: { gain: [1.04, 0.98, 0.9], lift: [-0.02, -0.01, 0], contrast: 1.3, sat: 1.05, bright: 0.9, vig: 0.6, leak: '255,140,70' },
};
function gradeImage(src: Img, mood: Mood, cutout: boolean): Img {
  const m = MOODS[mood as Exclude<Mood, 'none'>]; if (!m) return src;
  const [sw, sh] = dims(src), k = Math.min(1, 1600 / Math.max(sw, sh)), w = Math.round(sw * k), h = Math.round(sh * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d')!; x.drawImage(src, 0, 0, w, h);
  try {
    const d = x.getImageData(0, 0, w, h), a = d.data;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i + 3] === 0) continue;
      let r = (a[i] / 255) * m.gain[0] * m.bright + m.lift[0], g = (a[i + 1] / 255) * m.gain[1] * m.bright + m.lift[1], b = (a[i + 2] / 255) * m.gain[2] * m.bright + m.lift[2];
      const L = 0.299 * r + 0.587 * g + 0.114 * b; r = L + (r - L) * m.sat; g = L + (g - L) * m.sat; b = L + (b - L) * m.sat;
      a[i] = ((r - 0.5) * m.contrast + 0.5) * 255; a[i + 1] = ((g - 0.5) * m.contrast + 0.5) * 255; a[i + 2] = ((b - 0.5) * m.contrast + 0.5) * 255;
    }
    x.putImageData(d, 0, 0);
  } catch { return src; }
  if (!cutout) {
    const v = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${m.vig})`); x.fillStyle = v; x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'screen'; const l = x.createRadialGradient(w * 0.88, h * 0.08, 0, w * 0.88, h * 0.08, Math.max(w, h) * 0.6); l.addColorStop(0, `rgba(${m.leak},.32)`); l.addColorStop(1, `rgba(${m.leak},0)`); x.fillStyle = l; x.fillRect(0, 0, w, h); x.globalCompositeOperation = 'source-over';
  }
  return c;
}

export interface StoryAssets { photo: Img | null; logo: HTMLImageElement | null; cut: Img | null }
const prepCache = new Map<string, Promise<StoryAssets>>();
async function buildAssets(o: Pick<StoryInput, 'photo' | 'logo' | 'mood' | 'cutout'>): Promise<StoryAssets> {
  if (document.fonts) await Promise.all(['800 60px "Fraunces Variable"', '700 40px "Plus Jakarta Sans Variable"', '600 40px "IBM Plex Sans Arabic"'].map(f => document.fonts.load(f, 'Aa أب').catch(() => null)));
  const [photo, logo, cut] = await Promise.all([loadImg(o.photo), loadImg(o.logo), loadImg(o.cutout)]);
  return { photo: photo ? gradeImage(photo, o.mood, false) : null, logo, cut: cut ? gradeImage(cut, o.mood, true) : null };
}
export function prepareStory(o: Pick<StoryInput, 'photo' | 'logo' | 'mood' | 'cutout'>): Promise<StoryAssets> {
  const key = [o.photo, o.logo, o.mood, o.cutout].join('|'); let p = prepCache.get(key);
  if (!p) { p = buildAssets(o); prepCache.set(key, p); if (prepCache.size > 12) prepCache.delete(prepCache.keys().next().value as string); }
  return p;
}
export async function renderStory(c: HTMLCanvasElement, o: StoryInput, t = 1, pre?: StoryAssets, scale = 1) { drawStory(c, o, t, pre ?? await prepareStory(o), scale); }

/** Draws one frame. t = 0..1 (1 = the finished picture). Synchronous so it can run every animation frame. */
export function drawStory(c: HTMLCanvasElement, o: StoryInput, t: number, pre: StoryAssets, scale = 1) {
  const { w, h } = FORMATS[o.format]; c.width = Math.round(w * scale); c.height = Math.round(h * scale); const g = c.getContext('2d')!; g.setTransform(scale, 0, 0, scale, 0, 0);
  const { photo, logo, cut } = pre; T = clamp(t); PHOTO = photo; ZM = 1.14 - 0.14 * (1 - Math.pow(1 - T, 2));
  g.direction = o.rtl ? 'rtl' : 'ltr'; g.clearRect(0, 0, w, h);
  const P = o.primary, tall = h > 1500, hasP = !!(o.showPrice && o.price);
  const bright = lum(P) > 0.62, onP = bright ? '#1a1410' : '#fff';

  if (o.style === 'studio') {                // the dish floats, cut out, in front of giant type
    const D = tall ? w * 0.76 : o.format === 'feed' ? h * 0.46 : h * 0.42, top = tall ? 400 : o.format === 'feed' ? 300 : 240, cx = w / 2, cy = top + D / 2;
    const bg = g.createRadialGradient(cx, cy, 40, cx, cy, Math.max(w, h) * 0.85); bg.addColorStop(0, mix(P, '#ffffff', 0.1)); bg.addColorStop(0.45, mix(P, '#000000', 0.48)); bg.addColorStop(1, mix(P, '#000000', 0.9)); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const spot = g.createRadialGradient(cx, cy - D * 0.1, 0, cx, cy - D * 0.1, D * 0.75); spot.addColorStop(0, 'rgba(255,235,200,.32)'); spot.addColorStop(1, 'rgba(255,235,200,0)'); g.fillStyle = spot; g.fillRect(0, 0, w, h);
    // the name repeated in big rows behind the dish: filled and outlined rows slide in opposite directions and settle
    const fs = tall ? 190 : o.format === 'feed' ? 140 : 118, rows = tall ? 6 : o.format === 'feed' ? 5 : 4, rowH = fs * 0.92;
    g.save(); g.direction = 'ltr'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.font = `800 ${fs}px ${SERIF}`;
    const unit = o.name.toUpperCase() + '   \u2022   ', uw = Math.max(g.measureText(unit).width, 200);
    for (let i = 0; i < rows; i++) {
      const dir = i % 2 ? 1 : -1, shift = dir * uw * 1.2 * (1 - kk(0, 1)), y = cy - D * 0.05 + (i - (rows - 1) / 2) * rowH + fs * 0.32, a0 = clamp(kk(0.03 + i * 0.05, 0.3 + i * 0.05));
      g.globalAlpha = a0; const x0 = ((shift - uw * 0.3) % uw) - uw;
      for (let x = x0; x < w + uw; x += uw) {
        if (i % 2) { g.fillStyle = 'rgba(255,255,255,.26)'; g.fillText(unit, x, y); }
        else { g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 3; g.strokeText(unit, x, y); }
      }
    }
    g.restore();
    // floor shadow + the dish
    const dp = kk(0.08, 0.42, true), sc = 0.55 + 0.45 * dp, mv = kk(0.45, 0.55), bob = mv * Math.sin(T * Math.PI * 6) * 14, rot = mv * Math.sin(T * Math.PI * 4) * 0.012;
    g.save(); g.translate(cx, cy + D * 0.47); g.scale(1, 0.16); g.globalAlpha = clamp(dp); const sh = g.createRadialGradient(0, 0, 0, 0, 0, D * 0.52 * sc * (1 - bob / 500)); sh.addColorStop(0, 'rgba(0,0,0,.6)'); sh.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = sh; g.fillRect(-D, -D, D * 2, D * 2); g.restore();
    const img = cut ?? photo;
    if (img) {
      g.save(); g.globalAlpha *= clamp(dp * 1.6); g.translate(cx, cy + bob + (1 - dp) * 60); g.rotate(rot);
      if (cut) { const [iw, ih] = dims(cut), s0 = Math.min(D / iw, D / ih) * sc; g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 50; g.shadowOffsetY = 34; g.drawImage(cut, -iw * s0 / 2, -ih * s0 / 2, iw * s0, ih * s0); }
      else { const R = D * 0.5 * sc; g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 50; g.shadowOffsetY = 30; g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, R + 16, 0, 7); g.fill(); g.shadowColor = 'transparent'; g.save(); g.beginPath(); g.arc(0, 0, R, 0, 7); g.clip(); cover(g, img, -R, -R, 2 * R, 2 * R); g.restore(); }
      g.restore();
    }
    // steam
    const sf = 1 - clamp((T - 0.85) / 0.15);
    if (T < 1 && cut && sf > 0) for (let i = 0; i < 8; i++) { const ph = (T * 1.6 + i * 0.13) % 1, px = cx + Math.sin(i * 2.1 + T * 5) * D * 0.1 + (i - 3.5) * D * 0.045, py = cy - D * 0.22 - ph * D * 0.5, pr = D * (0.05 + ph * 0.07), pg = g.createRadialGradient(px, py, 0, px, py, pr); pg.addColorStop(0, 'rgba(255,255,255,.22)'); pg.addColorStop(1, 'rgba(255,255,255,0)'); g.globalAlpha = Math.sin(Math.PI * ph) * sf * kk(0.4, 0.6); g.fillStyle = pg; g.beginPath(); g.arc(px, py, pr, 0, 7); g.fill(); }
    g.globalAlpha = 1;
    pill(g, o.badge || 'Coup de cœur', w / 2, tall ? 170 : 110, '#f4e3b8', '#2a1c0c', 30);
    if (hasP) priceTag(g, o.price!, cx + D * 0.4, cy + D * 0.34, tall ? 150 : 115, '#f4e3b8', '#2a1c0c');
    nameBlock(g, o.format === 'square' ? { ...o, description: '' } : o, w / 2, cy + D / 2 + (tall ? 190 : 120), w - 200, '#ffffff', 'rgba(255,255,255,.78)', tall ? 108 : 72, 'center', 2);
    footer(g, o, logo, w, h - (tall ? 190 : 120), '#ffffff', mix(P, '#ffffff', 0.65));
    grain(g, w, h, 0.05);
  } else if (o.style === 'signature') {            // dark, gold arch window
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
  } else if (o.style === 'polaroid') {      // tilted polaroid on brand colour, sized to the space between the badge and the footer
    const bg = g.createLinearGradient(0, 0, w, h); bg.addColorStop(0, mix(P, '#fff', 0.12)); bg.addColorStop(1, mix(P, '#000', 0.35)); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.07)'; for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(((i * 337) % w), ((i * 521) % h), 90 + (i % 3) * 70, 0, 7); g.fill(); }
    const footY = h - (tall ? 190 : 120), topY = tall ? 260 : 200, botY = footY - 80;
    const ph = Math.min(w * 0.78 * 1.1, botY - topY - 50), pw = ph / 1.1, cx = w / 2, cy = (topY + botY) / 2 + 10, strip = Math.round(ph * 0.26);
    g.save(); g.translate(cx, cy); g.rotate(-0.05); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 70; g.shadowOffsetY = 36; g.fillStyle = '#fffdf8'; g.fillRect(-pw / 2, -ph / 2, pw, ph); g.shadowColor = 'transparent';
    const m = 34, iw = pw - m * 2, ih = ph - m - strip; g.save(); g.beginPath(); g.rect(-pw / 2 + m, -ph / 2 + m, iw, ih); g.clip(); if (photo) cover(g, photo, -pw / 2 + m, -ph / 2 + m, iw, ih); else { g.fillStyle = rgba(P, 0.4); g.fillRect(-pw / 2 + m, -ph / 2 + m, iw, ih); } g.restore();
    g.fillStyle = '#2b1d12'; g.textAlign = 'center'; g.textBaseline = 'middle'; const f = fitName(g, o.name, iw - 20, 2, 64, 34, 600, SERIF); f.l.forEach((t, i) => g.fillText(t, 0, ph / 2 - strip / 2 + 4 + (i - (f.l.length - 1) / 2) * f.s * 1.05));
    g.fillStyle = rgba(P, 0.85); g.fillRect(-90, -ph / 2 - 26, 180, 52); g.restore();
    if (hasP) priceTag(g, o.price!, cx + pw / 2 - 20, cy - ph / 2 + (tall ? 150 : 120), tall ? 125 : 100, '#fffdf8', '#2b1d12', 0.14);
    pill(g, o.badge || 'Coup de cœur', w / 2, tall ? 150 : 100, '#fffdf8', '#2b1d12', 30);
    footer(g, o, logo, w, footY, '#fff', '#fff');
    grain(g, w, h, 0.05);
  } else {                                   // sunburst: solid brand colour, photo circle, rays; the circle shrinks to leave room for the name and footer
    g.fillStyle = P; g.fillRect(0, 0, w, h);
    const footY = h - (tall ? 190 : 120), limit = footY - 75, sz = tall ? 112 : 90, maxW = w - 160;
    const oo = tall || o.format === 'feed' ? o : { ...o, description: '' };         // the square has no room for the description
    const ms = measureName(g, oo, maxW, sz, 2), yN = limit - ms.h, circTop = tall ? 270 : 175, circBot = yN - ms.cap - 45;
    const R = Math.min(w * 0.38, (circBot - circTop) / 2 - 26), cx = w / 2, cy = (circTop + circBot) / 2;
    g.save(); g.translate(cx, cy); for (let i = 0; i < 24; i++) { g.rotate(Math.PI / 12); g.fillStyle = i % 2 ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.06)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(-w, -h * 1.2); g.lineTo(w, -h * 1.2); g.closePath(); g.fill(); } g.restore();
    g.save(); g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = 60; g.shadowOffsetY = 30; g.fillStyle = bright ? '#1a1410' : '#fff'; g.beginPath(); g.arc(cx, cy, R + 26, 0, 7); g.fill(); g.restore();
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip(); if (photo) cover(g, photo, cx - R, cy - R, R * 2, R * 2); else { g.fillStyle = mix(P, '#000', 0.3); g.fillRect(cx - R, cy - R, R * 2, R * 2); } g.restore();
    pill(g, o.badge || 'Coup de cœur', w / 2, tall ? 170 : 100, bright ? '#1a1410' : '#fff', bright ? '#fff' : P, 30);
    if (hasP) priceTag(g, o.price!, cx + R * 0.78, cy + R * 0.78, tall ? 135 : 105, bright ? '#1a1410' : '#fff', bright ? '#fff' : P, 0.16);
    nameBlock(g, oo, w / 2, yN, maxW, onP, bright ? 'rgba(26,20,16,.75)' : 'rgba(255,255,255,.82)', sz, 'center', 2);
    footer(g, o, logo, w, footY, onP, onP);
    grain(g, w, h, 0.04);
  }
  if (T < 1) bokeh(g, w, h);
}
export const canvasBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('png'))), 'image/png'));

/** Records the animation (about 6 s: motion for 4.5 s, then the finished picture) as a video. mp4 where the browser can, else webm. */
export async function recordStory(o: StoryInput, onProgress?: (p: number) => void, ms = 6000, motionMs = 4500): Promise<{ blob: Blob; ext: 'mp4' | 'webm' }> {
  if (typeof MediaRecorder === 'undefined') throw new Error('video');
  const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  const type = types.find(x => MediaRecorder.isTypeSupported(x)); if (!type) throw new Error('video');
  const pre = await prepareStory(o), c = document.createElement('canvas'), scale = 2 / 3;
  drawStory(c, o, 0, pre, scale);
  const stream = c.captureStream(30), rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 }), chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<Blob>(res => { rec.onstop = () => res(new Blob(chunks, { type: type.split(';')[0] })); });
  rec.start(250); const t0 = performance.now();
  await new Promise<void>(res => { const f = () => { const e = performance.now() - t0; drawStory(c, o, Math.min(1, e / motionMs), pre, scale); onProgress?.(Math.min(1, e / ms)); if (e < ms) requestAnimationFrame(f); else res(); }; f(); });
  rec.stop(); stream.getTracks().forEach(x => x.stop());
  return { blob: await done, ext: type.includes('mp4') ? 'mp4' : 'webm' };
}
