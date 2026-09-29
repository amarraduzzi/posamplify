// localStorage can be missing or throw (private mode, blocked site data):
// everything must keep working without it.
export function load<T>(key: string, maxAgeMs: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { at, v } = JSON.parse(raw) as { at: number; v: T };
    if (Date.now() - at > maxAgeMs) { localStorage.removeItem(key); return null; }
    return v;
  } catch { return null; }
}
export function save<T>(key: string, v: T): void {
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), v })); } catch { /* ignore */ }
}
export function drop(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
