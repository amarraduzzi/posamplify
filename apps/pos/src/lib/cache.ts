// Small persistent cache on the till itself (localStorage). Used so the till
// can start and keep working without internet: menu, tables, staff, open
// orders and the queue of work still to send. Never throws: a full or
// blocked storage only means less offline comfort, never a broken till.

export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

export function writeCache(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

export function dropCache(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
