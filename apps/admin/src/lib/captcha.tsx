// Bot protection with Cloudflare Turnstile (free). Only active when
// VITE_TURNSTILE_SITE_KEY is set (Cloudflare Pages > Settings > Variables); the
// matching secret key goes into Supabase > Authentication > Attack Protection.
// Without the key (local tests) nothing is shown and no token is sent.
// The widget is mostly invisible: it only asks for a click when a visitor looks suspicious.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getLang, t } from './i18n';

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || '';

type Turnstile = {
  render: (el: HTMLElement, o: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.onload = () => res(); s.onerror = () => { loading = null; rej(new Error('captcha')); };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * const cap = useCaptcha();  ...  <form>{cap.widget}<button disabled={!cap.ready}>
 * pass `captchaToken: cap.token` to supabase.auth calls, then cap.reset() (a token works once).
 */
export function useCaptcha() {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!SITE_KEY) return;
    let gone = false;
    loadScript().then(() => {
      if (gone || !box.current || !window.turnstile) return;
      id.current = window.turnstile.render(box.current, {
        sitekey: SITE_KEY,
        appearance: 'interaction-only',
        language: getLang(),
        callback: (tk: string) => { setToken(tk); setFailed(false); },
        'expired-callback': () => setToken(undefined),
        'error-callback': () => { setToken(undefined); setFailed(true); },
      });
    }).catch(() => setFailed(true));
    return () => { gone = true; if (id.current && window.turnstile) window.turnstile.remove(id.current); id.current = null; };
  }, []);

  const reset = useCallback(() => {
    if (!SITE_KEY) return;
    setToken(undefined);
    if (id.current && window.turnstile) window.turnstile.reset(id.current);
  }, []);

  const widget = SITE_KEY ? (
    <div>
      <div ref={box} className="flex justify-center empty:hidden" />
      {failed && <p className="mt-1 text-center text-xs text-danger">{t('Vérification anti-robot impossible. Vérifiez la connexion et rechargez la page.')}</p>}
    </div>
  ) : null;

  return { enabled: !!SITE_KEY, ready: !SITE_KEY || !!token, token, reset, widget };
}
