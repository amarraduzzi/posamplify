// "Fait par…": the salon's own posts and stories, drawn on a canvas in its colour.
//  * prestation: the name, the price, "par Imane", a photo if there is one;
//  * avant/après: two photos side by side (only pairs the client agreed to);
//  * créneaux: the free times left today, to fill them;
//  * attente: the Nouba's wait right now, for the quiet hours.
// The link that goes with it books straight with that person (?rdv&p=…).
export type MakerKind = 'service' | 'before_after' | 'slots' | 'wait';
export type MakerFormat = 'story' | 'post';
export const SIZES: Record<MakerFormat, { w: number; h: number }> = { story: { w: 1080, h: 1920 }, post: { w: 1080, h: 1350 } };
const SERIF = '"Fraunces Variable", "Instrument Serif", Georgia, serif';
const SANS = '"Plus Jakarta Sans Variable", "Manrope", system-ui, sans-serif';
type Img = HTMLImageElement | null | undefined;

export interface MakerInput {
  kind: MakerKind; format: MakerFormat; primary: string; salon: string; handle?: string; logo?: Img;
  title: string; subtitle?: string; by?: string; price?: string; photo?: Img; before?: Img; after?: Img;
  times?: string[]; wait?: string; cta: string; labels: { before: string; after: string };
}

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
function cover(g: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height), dw = img.width * s, dh = img.height * s;
  g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

export function drawMaker(c: HTMLCanvasElement, o: MakerInput, scale = 1) {
  const { w: W, h: H } = SIZES[o.format];
  c.width = Math.round(W * scale); c.height = Math.round(H * scale);
  const g = c.getContext('2d')!; g.setTransform(scale, 0, 0, scale, 0, 0); g.direction = 'ltr';
  const P = o.primary, tall = o.format === 'story';
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, mix(P, '#000000', 0.12)); bg.addColorStop(1, mix(P, '#000000', 0.6));
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.textAlign = 'center'; g.textBaseline = 'middle';

  // the picture area
  const top = tall ? 150 : 90, ph = tall ? 1080 : 760, px = 70, pw = W - 140;
  g.save(); rr(g, px, top, pw, ph, 44); g.clip();
  if (o.kind === 'before_after' && (o.before || o.after)) {
    const half = pw / 2;
    if (o.before) cover(g, o.before, px, top, half, ph); else { g.fillStyle = mix(P, '#ffffff', 0.7); g.fillRect(px, top, half, ph); }
    if (o.after) cover(g, o.after, px + half, top, half, ph); else { g.fillStyle = mix(P, '#ffffff', 0.8); g.fillRect(px + half, top, half, ph); }
    g.fillStyle = '#fff'; g.fillRect(px + half - 4, top, 8, ph);
    for (const [txt, x] of [[o.labels.before, px + 30], [o.labels.after, px + half + 30]] as const) {
      g.font = `800 40px ${SANS}`; const tw = g.measureText(txt).width + 48;
      rr(g, x, top + 30, tw, 70, 35); g.fillStyle = 'rgba(0,0,0,.55)'; g.fill(); g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText(txt, x + 24, top + 66); g.textAlign = 'center';
    }
  } else if (o.photo && (o.kind === 'service')) {
    cover(g, o.photo, px, top, pw, ph);
    const fade = g.createLinearGradient(0, top + ph * 0.55, 0, top + ph); fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,.55)');
    g.fillStyle = fade; g.fillRect(px, top, pw, ph);
  } else {
    // no photo: the salon's colour, light, with the big information
    g.fillStyle = '#fffaf3'; g.fillRect(px, top, pw, ph);
    g.fillStyle = mix(P, '#ffffff', 0.85);
    for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(px + pw - 80 + Math.cos(i) * 40, top + 90 + i * 140, 70 - i * 6, 0, 7); g.fill(); }
    const ink = mix(P, '#000000', 0.35); g.fillStyle = ink;
    if (o.kind === 'slots' && o.times?.length) {
      const list = o.times.slice(0, 6); const rows = Math.ceil(list.length / 2); const cellW = (pw - 160) / 2, cellH = 130;
      const y0 = top + ph / 2 - (rows * (cellH + 30)) / 2 + cellH / 2;
      list.forEach((tm, i) => {
        const cx = px + 80 + (i % 2) * (cellW + 0) + cellW / 2, cy = y0 + Math.floor(i / 2) * (cellH + 30);
        rr(g, cx - cellW / 2 + 15, cy - cellH / 2, cellW - 30, cellH, 34); g.fillStyle = mix(P, '#ffffff', 0.9); g.fill();
        g.fillStyle = ink; g.font = `600 84px ${SERIF}`; g.fillText(tm, cx, cy + 6);
      });
    } else if (o.kind === 'wait' && o.wait) {
      fit(g, o.wait, pw - 120, 220, 600, SERIF, 90); g.fillText(o.wait, W / 2, top + ph / 2);
    } else if (o.price) {
      fit(g, o.price, pw - 120, 200, 600, SERIF, 80); g.fillText(o.price, W / 2, top + ph / 2);
    }
  }
  g.restore();
  if (o.kind === 'service' && o.photo && o.price) {
    g.font = `800 56px ${SANS}`; const tw = g.measureText(o.price).width + 70;
    rr(g, px + pw - tw - 30, top + ph - 130, tw, 96, 48); g.fillStyle = '#fffaf3'; g.fill(); g.fillStyle = mix(P, '#000000', 0.35); g.fillText(o.price, px + pw - 30 - tw / 2, top + ph - 80);
  }

  // the words
  let y = top + ph + (tall ? 130 : 90);
  g.fillStyle = '#fff'; fit(g, o.title, W - 160, tall ? 84 : 70, 600, SERIF, 36); g.fillText(o.title, W / 2, y);
  if (o.subtitle) { y += tall ? 80 : 66; g.font = `600 ${tall ? 40 : 36}px ${SANS}`; g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText(o.subtitle, W / 2, y); }
  if (o.by) { y += tall ? 70 : 58; g.font = `italic 600 ${tall ? 46 : 40}px ${SERIF}`; g.fillStyle = '#ffd1dc'; g.fillText(o.by, W / 2, y); }
  y += tall ? 110 : 84;
  g.font = `800 ${tall ? 42 : 36}px ${SANS}`; const cw = Math.min(W - 160, g.measureText(o.cta).width + 90);
  rr(g, W / 2 - cw / 2, y - (tall ? 48 : 42), cw, tall ? 96 : 84, 48); g.fillStyle = '#ff6b8b'; g.fill(); g.fillStyle = '#fff'; fit(g, o.cta, cw - 60, tall ? 42 : 36, 800, SANS, 24); g.fillText(o.cta, W / 2, y + 2);

  // the salon
  const fy = H - (tall ? 110 : 70);
  g.fillStyle = '#fff'; fit(g, o.salon, 700, 44, 600, SERIF, 28);
  const nw = g.measureText(o.salon).width, lw = o.logo ? 70 : 0, gap = o.logo ? 20 : 0, x0 = W / 2 - (lw + gap + nw) / 2 - (o.handle ? 0 : 0);
  if (o.logo) { g.save(); g.beginPath(); g.arc(x0 + 35, fy, 35, 0, 7); g.clip(); g.drawImage(o.logo, x0, fy - 35, 70, 70); g.restore(); }
  g.textAlign = 'left'; g.fillText(o.salon, x0 + lw + gap, fy + 2); g.textAlign = 'center';
  if (o.handle && tall) { g.font = `700 34px ${SANS}`; g.fillStyle = 'rgba(255,255,255,.8)'; g.fillText('@' + o.handle.replace(/^@/, ''), W / 2, fy + 58); }
}

export function loadImg(url?: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise(res => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
}
export const pngBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('png'))), 'image/png'));
