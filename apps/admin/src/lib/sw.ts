import { registerSW } from 'virtual:pwa-register';

// The service worker keeps the app's files so the installed app opens fast. A new version is
// downloaded in the background and switched on when the page is hidden (not while someone types).
export function startServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let waiting = false;
  const apply = registerSW({
    onNeedRefresh() { waiting = true; },
    onRegisteredSW(_url, reg) { if (reg) window.setInterval(() => { reg.update().catch(() => {}); }, 30 * 60_000); },
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && waiting) { waiting = false; void apply(true); } });
}
