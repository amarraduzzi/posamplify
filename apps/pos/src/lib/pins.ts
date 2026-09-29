// Staff PINs without internet.
//
// The real check is always the server's (bcrypt hash, lockout). After a
// successful online check, the till keeps its own slow hash of that PIN
// (PBKDF2, 100 000 rounds, random salt) so the same person can unlock this
// till while the internet is down. Someone who never logged in on this till
// needs the internet once. A local lockout mirrors the server's: 5 wrong
// tries, then 5 minutes.

import { readCache, writeCache } from './cache';

interface Saved { salt: string; hash: string }
interface Tries { n: number; until: number }
const ROUNDS = 100_000;

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ROUNDS }, k, 256);
  return b64(bits);
}

const pinsKey = (rid: string) => `pos-pins:${rid}`;
const triesKey = (rid: string) => `pos-pin-tries:${rid}`;

/** Remember a PIN the server just accepted. */
export async function rememberPin(rid: string, staffId: string, pin: string) {
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const all = readCache<Record<string, Saved>>(pinsKey(rid)) ?? {};
    all[staffId] = { salt: b64(salt), hash: await derive(pin, salt) };
    writeCache(pinsKey(rid), all);
  } catch { /* no WebCrypto: offline unlock simply not available */ }
}

/** The server refused a PIN this till still accepts: the PIN was changed, forget the old one. */
export async function forgetPinIfStale(rid: string, staffId: string, pin: string) {
  const all = readCache<Record<string, Saved>>(pinsKey(rid)) ?? {};
  const s = all[staffId];
  if (s && (await derive(pin, unb64(s.salt)).catch(() => '')) === s.hash) {
    delete all[staffId];
    writeCache(pinsKey(rid), all);
  }
}

export const canUnlockOffline = (rid: string, staffId: string) => !!readCache<Record<string, Saved>>(pinsKey(rid))?.[staffId];

/** Offline check: 'ok' | 'invalid' | 'locked' | 'unknown' (never unlocked on this till). */
export async function checkPinOffline(rid: string, staffId: string, pin: string): Promise<'ok' | 'invalid' | 'locked' | 'unknown'> {
  const s = readCache<Record<string, Saved>>(pinsKey(rid))?.[staffId];
  if (!s) return 'unknown';
  const tries = readCache<Record<string, Tries>>(triesKey(rid)) ?? {};
  const t = tries[staffId] ?? { n: 0, until: 0 };
  if (t.until > Date.now()) return 'locked';
  const ok = (await derive(pin, unb64(s.salt)).catch(() => '')) === s.hash;
  tries[staffId] = ok ? { n: 0, until: 0 } : { n: t.n + 1, until: t.n + 1 >= 5 ? Date.now() + 5 * 60_000 : 0 };
  if (!ok && tries[staffId].until) tries[staffId].n = 0;
  writeCache(triesKey(rid), tries);
  return ok ? 'ok' : tries[staffId].until ? 'locked' : 'invalid';
}
