// "Install on this device": Chrome and Edge (Windows, Android) offer to install the app with an icon on the
// desktop or home screen; it then opens in its own window, without the address bar. The browser's
// offer arrives once (beforeinstallprompt) and is kept here until a button uses it.
import { useEffect, useState } from 'react';

interface PromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: PromptEvent | null = null;
const subs = new Set<() => void>();
const tell = () => subs.forEach(f => f());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e as PromptEvent; tell(); });
  window.addEventListener('appinstalled', () => { deferred = null; tell(); });
}

export const isInstalled = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: fullscreen)').matches);

/** can: the browser offers to install now. install(): shows its dialog; true when accepted. */
export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force(n => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return {
    can: !!deferred && !isInstalled(),
    install: async () => {
      if (!deferred) return false;
      const d = deferred;
      await d.prompt();
      const { outcome } = await d.userChoice;
      if (outcome === 'accepted') deferred = null;
      tell();
      return outcome === 'accepted';
    },
  };
}
