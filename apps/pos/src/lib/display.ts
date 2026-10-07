// Customer display: the till sends what the guest should see to a second screen.
// Same PC (second monitor): BroadcastChannel. Another tablet: a Supabase realtime broadcast on a
// channel named after a random code only this till knows (nothing is stored in the database).
import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface ShownLine { q: number; name: string; total: number; list?: number }
export type Shown =
  | { mode: 'idle' }
  | { mode: 'order'; label: string; lines: ShownLine[]; subtotal: number; discount: number; promo: boolean; total: number }
  | { mode: 'pay'; total: number; given: number; change: number }
  | { mode: 'thanks'; change: number };
export interface DisplayMsg { r: { name: string; logo?: string; slug: string }; menuUrl: string; s: Shown }

const KEY = 'display-code';
export const displayCode = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export function setDisplay(on: boolean): string | null {
  try {
    if (!on) { localStorage.removeItem(KEY); stop(); return null; }
    const c = displayCode() ?? Array.from(crypto.getRandomValues(new Uint8Array(12)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
    localStorage.setItem(KEY, c); return c;
  } catch { return null; }
}

let bc: BroadcastChannel | null = null;
let ch: RealtimeChannel | null = null;
let chCode: string | null = null;
let last: DisplayMsg | null = null;
let beat: ReturnType<typeof setInterval> | null = null;
function stop() { if (ch) supabase.removeChannel(ch); ch = null; chCode = null; if (beat) clearInterval(beat); beat = null; }
function send(m: DisplayMsg) {
  const code = displayCode();
  if (!code) return;
  try { (bc ??= new BroadcastChannel(`ecran-${code}`)).postMessage(m); } catch { /* old browser */ }
  if (chCode !== code) { stop(); ch = supabase.channel(`ecran-${code}`, { config: { broadcast: { self: false } } }); ch.subscribe(); chCode = code; }
  ch?.send({ type: 'broadcast', event: 's', payload: m }).catch(() => {});
  // a display switched on later still gets the current state
  beat ??= setInterval(() => { if (last) send(last); }, 8000);
}
const MENU_URL = ((import.meta.env.VITE_MENU_URL as string) || 'https://menu.amplifygrowthstudio.com').replace(/\/$/, '');
/** Sends what the guest sees (does nothing when no display is set up on this till). */
export function show(r: { name: string; slug: string; branding?: { logo_url?: string } } | null | undefined, s: Shown) {
  if (!r || !displayCode()) return;
  last = { r: { name: r.name, slug: r.slug, logo: r.branding?.logo_url }, menuUrl: MENU_URL, s };
  send(last);
}

/** The display side: calls back with every message for this code. */
export function listen(code: string, cb: (m: DisplayMsg) => void) {
  const b = new BroadcastChannel(`ecran-${code}`);
  b.onmessage = e => cb(e.data as DisplayMsg);
  const c = supabase.channel(`ecran-${code}`).on('broadcast', { event: 's' }, p => cb(p.payload as DisplayMsg)).subscribe();
  return () => { b.close(); supabase.removeChannel(c); };
}
