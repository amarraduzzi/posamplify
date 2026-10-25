// Pickup board for boccadillos restaurants: names and numbers of the paid orders being prepared / ready,
// shown on a TV or tablet in the room. Off by default; switched on per till in the settings.
// Same transport as the customer display: a private channel named after a random code only this till knows
// (BroadcastChannel on the same PC, Supabase realtime broadcast for another screen). Nothing is stored.
import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface PickupItem { id: string; ref: string; name: string }
export interface PickupMsg { r: { name: string; logo?: string }; preparing: PickupItem[]; ready: PickupItem[] }

const KEY = 'pickup-code';
export const pickupCode = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export function setPickup(on: boolean): string | null {
  let code: string | null = null;
  try {
    if (!on) { localStorage.removeItem(KEY); stopPickup(); }
    else {
      code = pickupCode() ?? Array.from(crypto.getRandomValues(new Uint8Array(12)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
      localStorage.setItem(KEY, code);
    }
  } catch { /* storage blocked */ }
  window.dispatchEvent(new Event('pickup-change'));
  return code;
}

let bc: BroadcastChannel | null = null;
let ch: RealtimeChannel | null = null;
let chCode: string | null = null;
let last: PickupMsg | null = null;
let beat: ReturnType<typeof setInterval> | null = null;
export function stopPickup() {
  if (ch) supabase.removeChannel(ch);
  ch = null; chCode = null; last = null;
  if (beat) clearInterval(beat);
  beat = null;
}
export function sendPickup(m: PickupMsg) {
  const code = pickupCode();
  if (!code) return;
  last = m;
  try { (bc ??= new BroadcastChannel(`retrait-${code}`)).postMessage(m); } catch { /* old browser */ }
  if (chCode !== code) { if (ch) supabase.removeChannel(ch); ch = supabase.channel(`retrait-${code}`, { config: { broadcast: { self: false } } }); ch.subscribe(); chCode = code; }
  ch?.send({ type: 'broadcast', event: 'p', payload: m }).catch(() => {});
  // a board switched on later still gets the current state
  beat ??= setInterval(() => { if (last) sendPickup(last); }, 8000);
}

/** The board side: calls back with every message for this code. */
export function listenPickup(code: string, cb: (m: PickupMsg) => void) {
  const b = new BroadcastChannel(`retrait-${code}`);
  b.onmessage = e => cb(e.data as PickupMsg);
  const c = supabase.channel(`retrait-${code}`).on('broadcast', { event: 'p' }, p => cb(p.payload as PickupMsg)).subscribe();
  return () => { b.close(); supabase.removeChannel(c); };
}
