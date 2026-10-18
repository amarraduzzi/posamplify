// The guest's Polaroid: the photo of their dish in a tilted polaroid on the restaurant's colour, as a 9:16 Instagram story.
export interface PolaroidInput { photo: CanvasImageSource & { width: number; height: number }; caption: string; restaurant: string; handle?: string; logo?: HTMLImageElement | null; primary: string; dateText: string; rtl: boolean }
export const W = 1080, H = 1920;
const SERIF = '"Fraunces Variable", "IBM Plex Sans Arabic", Georgia, serif';
const SANS = '"Plus Jakarta Sans Variable", "IBM Plex Sans Arabic", system-ui, sans-serif';

function rgb(hex: string): [number, number, number] {
  let h = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? 'c8553d'; if (h.length === 3) h = h.replace(/./g, '$&$&');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const mix = (hex: string, to: string, k: number) => { const a = rgb(hex), b = rgb(to); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`; };
const rgba = (hex: string, a: number) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };

export async function loadFonts() {
  if (!document.fonts) return;
  await Promise.all(['600 60px "Fraunces Variable"', '700 40px "Plus Jakarta Sans Variable"', '600 40px "IBM Plex Sans Arabic"'].map(f => document.fonts.load(f, 'Aa أب').catch(() => null)));
}
/** The photo with its camera rotation applied (phones store photos sideways). */
export async function loadPhoto(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back below */ } }
  const url = URL.createObjectURL(file);
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('photo')); i.src = url; });
}
export function loadLogo(url?: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise(res => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
}

export function drawPolaroid(c: HTMLCanvasElement, o: PolaroidInput, scale = 1) {
  c.width = Math.round(W * scale); c.height = Math.round(H * scale);
  const g = c.getContext('2d')!; g.setTransform(scale, 0, 0, scale, 0, 0); g.direction = o.rtl ? 'rtl' : 'ltr';
  const P = o.primary;
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, mix(P, '#ffffff', 0.12)); bg.addColorStop(1, mix(P, '#000000', 0.4)); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,.07)'; for (let i = 0; i < 9; i++) { g.beginPath(); g.arc((i * 337) % W, (i * 521) % H, 90 + (i % 3) * 70, 0, 7); g.fill(); }

  const pw = 820, ph = 1000, cx = W / 2, cy = 860, m = 40, strip = 215, iw = pw - m * 2, ih = ph - m - strip;
  g.save(); g.translate(cx, cy); g.rotate(-0.045);
  g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 70; g.shadowOffsetY = 36; g.fillStyle = '#fffdf8'; g.fillRect(-pw / 2, -ph / 2, pw, ph); g.shadowColor = 'transparent';
  // the guest's photo, cropped to fill, with a soft warm look
  g.save(); g.beginPath(); g.rect(-pw / 2 + m, -ph / 2 + m, iw, ih); g.clip();
  const s = Math.max(iw / o.photo.width, ih / o.photo.height), dw = o.photo.width * s, dh = o.photo.height * s;
  g.drawImage(o.photo, -pw / 2 + m + (iw - dw) / 2, -ph / 2 + m + (ih - dh) / 2, dw, dh);
  g.globalCompositeOperation = 'soft-light'; g.fillStyle = 'rgba(255,190,110,.28)'; g.fillRect(-pw / 2 + m, -ph / 2 + m, iw, ih); g.globalCompositeOperation = 'source-over';
  const v = g.createRadialGradient(0, -ph / 2 + m + ih / 2, ih * 0.35, 0, -ph / 2 + m + ih / 2, ih * 0.85); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.28)'); g.fillStyle = v; g.fillRect(-pw / 2 + m, -ph / 2 + m, iw, ih);
  g.restore();
  // handwritten-style caption + date
  g.fillStyle = '#2b1d12'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let fs = 66; g.font = `600 ${fs}px ${SERIF}`; while (g.measureText(o.caption).width > iw - 30 && fs > 30) { fs -= 3; g.font = `600 ${fs}px ${SERIF}`; }
  g.fillText(o.caption, 0, ph / 2 - strip / 2 - 6);
  g.font = `600 30px ${SANS}`; g.fillStyle = 'rgba(43,29,18,.45)'; g.fillText(o.dateText, 0, ph / 2 - 48);
  g.fillStyle = rgba(P, 0.85); g.fillRect(-100, -ph / 2 - 28, 200, 56);   // piece of tape
  g.restore();

  // footer: logo, restaurant, @handle
  g.textBaseline = 'middle'; const y = 1690; g.font = `700 44px ${SERIF}`;
  const nw = g.measureText(o.restaurant).width, lw = o.logo ? 84 : 0, gap = o.logo ? 24 : 0, x0 = W / 2 - (lw + gap + nw) / 2;
  if (o.logo) { g.save(); g.beginPath(); g.arc(x0 + 42, y, 42, 0, 7); g.clip(); g.drawImage(o.logo, x0, y - 42, 84, 84); g.restore(); g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(x0 + 42, y, 42, 0, 7); g.stroke(); }
  g.direction = 'ltr'; g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText(o.restaurant, x0 + lw + gap, y);
  if (o.handle) { g.textAlign = 'center'; g.font = `600 34px ${SANS}`; g.fillStyle = mix(P, '#ffffff', 0.7); g.fillText('@' + o.handle.replace(/^@/, ''), W / 2, y + 72); }
}
export const pngBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('png'))), 'image/png'));
