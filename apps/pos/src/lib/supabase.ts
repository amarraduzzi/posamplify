import { createClient } from '@supabase/supabase-js';

// Restaurant wifi can hang instead of failing: give every request a deadline,
// so the till notices quickly that it is offline and carries on locally.
const TIMEOUT_MS = 10_000;
const timedFetch: typeof fetch = (input, init = {}) => {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), TIMEOUT_MS);
  init.signal?.addEventListener('abort', () => ctl.abort());
  return fetch(input, { ...init, signal: ctl.signal }).finally(() => window.clearTimeout(timer));
};

// The till logs in once with its own account (role "device") and stays
// logged in; staff then identify themselves with their PIN on top of that.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pos-auth' }, global: { fetch: timedFetch } },
);

/** True when a request failed because the server could not be reached (not because it said no). */
export function isNetworkError(e: unknown): boolean {
  if (!e) return false;
  const x = e as { status?: number; message?: string; name?: string };
  if (x.status === 0) return true;
  return /Failed to fetch|NetworkError|FetchError|Load failed|AbortError|network|timed? ?out|ERR_INTERNET|ERR_NAME/i.test(`${x.name ?? ''} ${x.message ?? ''}`);
}
