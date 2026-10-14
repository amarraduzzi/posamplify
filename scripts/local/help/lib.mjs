// Shared helpers for the help-center screenshots (local stack: admin :5175, till :5174, menu :5173).
// Each screenshot is saved as PNG in RAW, and its "hotspot" (the button the article points at) is
// stored in the manifest as fractions of the image, so the site can draw a pulsing ring on it.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import pg from 'pg';

export const RAW = process.env.RAW ?? '/tmp/claude-0/help-raw';
export const MAN = `${RAW}/manifest.json`;
export const STATE = `${RAW}/state.json`;
mkdirSync(RAW, { recursive: true });
export const manifest = existsSync(MAN) ? JSON.parse(readFileSync(MAN, 'utf8')) : {};
export const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
export const saveState = () => writeFileSync(STATE, JSON.stringify(state, null, 1));

export const db = new pg.Pool({ connectionString: 'postgres://postgres@localhost:54332/postgres' });
export const q = async (s, p = []) => (await db.query(s, p)).rows;

export const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
export const errors = [];
export async function page(w = 1280, h = 800, scale = 1.5) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, locale: 'fr-FR' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`${p.url()}: ${e.message}`));
  return p;
}
export const btn = (p, n, exact = typeof n === 'string') => p.getByRole('button', { name: n, exact });

/** Screenshot `id`. target: the locator the article points at. clip: a locator (the dialog) or a box. */
export async function snap(p, id, { target, clip, pad = 16, wait = 500, toasts = false } = {}) {
  await p.waitForTimeout(wait);
  // toasts ("Enregistré") would cover the screen: hidden unless the article is about them
  await p.evaluate((show) => {
    let st = document.getElementById('shot-css');
    if (!st) { st = document.createElement('style'); st.id = 'shot-css'; document.head.appendChild(st); }
    st.textContent = show ? '' : '.pointer-events-none.fixed.bottom-4{display:none!important}';
  }, toasts);
  const vp = p.viewportSize();
  let region = { x: 0, y: 0, width: vp.width, height: vp.height };
  if (clip) {
    const bb = typeof clip.boundingBox === 'function' ? await clip.boundingBox() : clip;
    if (bb) {
      const x = Math.max(0, bb.x - pad), y = Math.max(0, bb.y - pad);
      region = { x, y, width: Math.min(vp.width - x, bb.width + pad * 2), height: Math.min(vp.height - y, bb.height + pad * 2) };
    }
  }
  let hot = null;
  if (target) {
    const t = await target.boundingBox();
    if (t) hot = { x: (t.x - region.x) / region.width, y: (t.y - region.y) / region.height, w: t.width / region.width, h: t.height / region.height };
  }
  await p.screenshot({ path: `${RAW}/${id}.png`, clip: region });
  manifest[id] = { w: Math.round(region.width), h: Math.round(region.height), hot, phone: vp.width < 600 };
  writeFileSync(MAN, JSON.stringify(manifest, null, 1));
  console.log('shot', id, hot ? 'hot' : '');
}

export async function done() {
  if (errors.length) console.log('page errors:', errors.slice(0, 8));
  await browser.close();
  await db.end();
}
