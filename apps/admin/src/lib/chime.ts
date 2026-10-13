// A short three-note chime for new orders. Browsers only allow sound after a tap: unlockSound() is called by the button.
let ctx: AudioContext | null = null;

export function unlockSound(): boolean {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    ctx ??= new Ctor();
    void ctx.resume();
    return true;
  } catch { return false; }
}

export function chime() {
  if (!ctx || ctx.state === 'closed') return;
  const t0 = ctx.currentTime;
  [[880, 0], [1175, 0.18], [1568, 0.36]].forEach(([freq, delay]) => {
    const osc = ctx!.createOscillator(), gain = ctx!.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + delay);
    gain.gain.exponentialRampToValueAtTime(0.4, t0 + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.35);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(t0 + delay); osc.stop(t0 + delay + 0.4);
  });
}
