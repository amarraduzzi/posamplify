// Short two-tone chime for new guest orders. Browsers only allow audio after
// a user interaction, so unlock() is called on the first tap.
let ctx: AudioContext | null = null;
export function unlockAudio() {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* no audio */ }
}
export function chime() {
  if (!ctx) return;
  const now = ctx.currentTime;
  [880, 1320].forEach((f, i) => {
    const o = ctx!.createOscillator(); const g = ctx!.createGain();
    o.frequency.value = f; o.type = 'sine';
    g.gain.setValueAtTime(0.0001, now + i * 0.18);
    g.gain.exponentialRampToValueAtTime(0.35, now + i * 0.18 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.35);
    o.connect(g).connect(ctx!.destination);
    o.start(now + i * 0.18); o.stop(now + i * 0.18 + 0.4);
  });
}
