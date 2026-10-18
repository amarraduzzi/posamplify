// A party-popper "bang" for the confetti, synthesised with Web Audio (no audio file to load).
// Browsers only allow sound after a tap: call unlockAudio() inside the tap handler (before any await),
// then playPop() when the confetti fires. Without a tap (the opening on a fresh QR scan) the pop is
// simply skipped when the browser keeps the audio locked.

const VOLUME = 0.8; // 0 to 1: master level of the pop

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let noise: AudioBuffer | null = null;

function context(): Ctx | null {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  } catch { return null; }
  return ctx;
}

// Call from a tap/click handler, synchronously.
export function unlockAudio() {
  const c = context();
  if (c && c.state === 'suspended') void c.resume().catch(() => { /* locked */ });
}

function noiseBuffer(c: Ctx) {
  if (noise) return noise;
  noise = c.createBuffer(1, Math.floor(c.sampleRate * 1.2), c.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

// delay in seconds; onlyIfRunning: skip quietly when the browser still keeps the audio locked
export function playPop(delay = 0, onlyIfRunning = false) {
  try {
    const c = context();
    if (!c || (onlyIfRunning && c.state !== 'running')) return;
    if (c.state === 'suspended') void c.resume().catch(() => { /* locked */ });
    const t0 = c.currentTime + delay;

    const master = c.createGain();
    master.gain.value = VOLUME;
    const comp = c.createDynamicsCompressor();
    master.connect(comp); comp.connect(c.destination);

    // 1. the crack: a short burst of filtered noise
    const crack = c.createBufferSource(); crack.buffer = noiseBuffer(c);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.6;
    const gCrack = c.createGain();
    gCrack.gain.setValueAtTime(0.0001, t0);
    gCrack.gain.exponentialRampToValueAtTime(1, t0 + 0.003);
    gCrack.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    crack.connect(bp); bp.connect(gCrack); gCrack.connect(master);
    crack.start(t0, Math.random() * 0.5, 0.25);

    // 2. the thump: a sine that drops fast in pitch
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(190, t0);
    o.frequency.exponentialRampToValueAtTime(48, t0 + 0.13);
    const gThump = c.createGain();
    gThump.gain.setValueAtTime(0.0001, t0);
    gThump.gain.exponentialRampToValueAtTime(0.9, t0 + 0.004);
    gThump.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    o.connect(gThump); gThump.connect(master);
    o.start(t0); o.stop(t0 + 0.25);

    // 3. the confetti rustle: a few tiny high crackles right after the bang
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4500;
    hp.connect(master);
    for (let i = 0; i < 14; i++) {
      const at = t0 + 0.06 + i * 0.045 + Math.random() * 0.03;
      const s = c.createBufferSource(); s.buffer = noiseBuffer(c);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.16 * (1 - i / 18), at + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
      s.connect(g); g.connect(hp);
      s.start(at, Math.random() * 0.8, 0.04);
    }
  } catch { /* sound is a bonus: never break the page */ }
}
