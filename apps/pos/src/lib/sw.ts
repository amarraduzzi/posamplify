import { registerSW } from 'virtual:pwa-register';

// The service worker keeps the till app on the PC for offline use. A new
// version is downloaded in the background and only switched on when nobody
// is working (the staff lock screen), never in the middle of an order.
let apply: ((reload?: boolean) => Promise<void>) | null = null;
let waiting = false;

export function startServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  apply = registerSW({
    onNeedRefresh() { waiting = true; },
    onRegisteredSW(_url, reg) {
      // look for a new version every 30 minutes
      if (reg) window.setInterval(() => { reg.update().catch(() => {}); }, 30 * 60_000);
    },
  });
}

/** Called on the lock screen: installs a waiting update (reloads the page). */
export function applyUpdateIfWaiting() {
  if (waiting && apply && navigator.onLine !== false) { waiting = false; void apply(true); }
}
