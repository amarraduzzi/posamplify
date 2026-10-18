// A party-popper "bang" for the confetti, synthesised with Web Audio (no audio file to load).
// Browsers only allow sound after a tap: call unlockAudio() inside the tap handler (before any await),
// then playPop() when the confetti fires. On iPhone the silent switch normally mutes Web Audio: unlockAudio() works around that. Without a tap (the opening on a fresh QR scan) the pop is
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

// A silent clip: playing it makes iOS treat the page as "media", which ignores the silent switch.
function silentWav(): string {
  const n = 800, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
  const tag = (o: number, t: string) => { for (let i = 0; i < 4; i++) b[o + i] = t.charCodeAt(i); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + n, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  tag(36, 'data'); v.setUint32(40, n, true); b.fill(128, 44);
  let bin = ''; for (const x of b) bin += String.fromCharCode(x);
  return `data:audio/wav;base64,${btoa(bin)}`;
}
let silent: HTMLAudioElement | null = null;
const stopSilent = () => { try { silent?.pause(); } catch { /* ignore */ } };

// Call from a tap/click handler, synchronously.
export function unlockAudio() {
  // iOS 16.4+: play even when the phone is on silent
  try { const a = (navigator as unknown as { audioSession?: { type: string } }).audioSession; if (a) a.type = 'playback'; } catch { /* ignore */ }
  const c = context();
  if (c && c.state === 'suspended') void c.resume().catch(() => { /* locked */ });
  // older iOS: a silent clip moves the page to the media channel (the silent switch no longer mutes it)
  try {
    if (!silent) { silent = new Audio(silentWav()); silent.loop = true; silent.setAttribute('playsinline', ''); }
    void silent.play().catch(() => { /* locked */ });
    setTimeout(stopSilent, 15000);
  } catch { /* ignore */ }
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
    setTimeout(stopSilent, (delay + 2) * 1000);

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
