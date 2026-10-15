// Full screen till: no title bar, no taskbar. A browser only allows full screen after a tap, so the
// first tap (on the PIN screen) switches it on, and a tap brings it back after Échap.
// On by default in the installed app (Amplify Caisse); a per-device choice in Réglages du poste.
import { isInstalled } from './install';

const KEY = 'pos-fullscreen';

export function autoFullscreen(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v ? v === 'on' : isInstalled();
  } catch { return isInstalled(); }
}

export function setAutoFullscreen(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  if (on) goFullscreen();
  else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function goFullscreen() {
  if (!document.fullscreenEnabled || document.fullscreenElement) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}

export function startAutoFullscreen() {
  document.addEventListener('pointerdown', () => { if (autoFullscreen()) goFullscreen(); }, { capture: true, passive: true });
}
