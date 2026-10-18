// A party-popper "bang" for the confetti, synthesised with Web Audio (no audio file to load).
// Browsers only allow sound after a tap: call unlockAudio() inside the tap handler (before any await),
// then playPop() when the confetti fires. On iPhone the silent switch normally mutes Web Audio: unlockAudio() works around that. Without a tap (the opening on a fresh QR scan) the pop is
// simply skipped when the browser keeps the audio locked.

const VOLUME = 1; // 0 to 1: master level of the pop

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

// One popper: crack (mid/high noise), body (mid noise), thump (pitch-dropping sine) and a confetti rustle.
// Phone speakers are weak in the bass, so most of the punch sits in the mids (500 to 3000 Hz).
function burst(c: Ctx, out: AudioNode, t0: number, level: number, pitch: number) {
  const env = (g: GainNode, peak: number, attack: number, end: number) => {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak * level, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + end);
  };
  const src = (when: number, len: number) => {
    const s = c.createBufferSource(); s.buffer = noiseBuffer(c);
    s.start(when, Math.random() * 0.6, len); return s;
  };
  // crack
  const crack = src(t0, 0.3), bp = c.createBiquadFilter(), gc = c.createGain();
  bp.type = 'bandpass'; bp.frequency.value = 2200 * pitch; bp.Q.value = 0.5; env(gc, 1.4, 0.002, 0.26);
  crack.connect(bp); bp.connect(gc); gc.connect(out);
  // body
  const body = src(t0, 0.3), lp = c.createBiquadFilter(), gb = c.createGain();
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(1400 * pitch, t0); lp.frequency.exponentialRampToValueAtTime(220, t0 + 0.22); env(gb, 1.2, 0.003, 0.3);
  body.connect(lp); lp.connect(gb); gb.connect(out);
  // thump
  const o = c.createOscillator(), gt = c.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(260 * pitch, t0); o.frequency.exponentialRampToValueAtTime(55, t0 + 0.14); env(gt, 1.1, 0.004, 0.24);
  o.connect(gt); gt.connect(out); o.start(t0); o.stop(t0 + 0.3);
  // confetti rustle
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3800; hp.connect(out);
  for (let i = 0; i < 22; i++) {
    const at = t0 + 0.07 + i * 0.04 + Math.random() * 0.03;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.3 * level * (1 - i / 28), at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.035);
    const s = src(at, 0.05); s.connect(g); g.connect(hp);
  }
}

// a short "ta-da" after the bangs
function chime(c: Ctx, out: AudioNode, t0: number) {
  [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
    const at = t0 + i * 0.085, o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.22, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + (i === 3 ? 0.7 : 0.22));
    o.connect(g); g.connect(out); o.start(at); o.stop(at + 0.8);
  });
}

// delay in seconds; onlyIfRunning: skip quietly when the browser still keeps the audio locked;
// big: three poppers in a row plus a "ta-da" (the sign-up), otherwise a single, full pop (the opening)
export function playPop(delay = 0, onlyIfRunning = false, big = false) {
  try {
    const c = context();
    if (!c || (onlyIfRunning && c.state !== 'running')) return;
    if (c.state === 'suspended') void c.resume().catch(() => { /* locked */ });
    const t0 = c.currentTime + delay;
    setTimeout(stopSilent, (delay + (big ? 3 : 2)) * 1000);

    const master = c.createGain(); master.gain.value = VOLUME;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 8; comp.ratio.value = 8; comp.attack.value = 0.002; comp.release.value = 0.12;
    const makeup = c.createGain(); makeup.gain.value = 1.5;
    const limit = c.createDynamicsCompressor();
    limit.threshold.value = -2; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.05;
    master.connect(comp); comp.connect(makeup); makeup.connect(limit); limit.connect(c.destination);

    burst(c, master, t0, 1, 1);
    if (big) {
      burst(c, master, t0 + 0.17, 0.9, 0.85);
      burst(c, master, t0 + 0.36, 0.8, 1.15);
      chime(c, master, t0 + 0.62);
    }
  } catch { /* sound is a bonus: never break the page */ }
}
