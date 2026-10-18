// Story sound: sound effects and three short original music loops, all synthesised in the browser with Web Audio.
// Nothing is downloaded and nothing is copyrighted, so the video can be posted on Instagram as it is.
export type Sound = 'off' | 'fx' | 'lounge' | 'oriental' | 'upbeat';
export const SOUNDS: Sound[] = ['off', 'fx', 'lounge', 'oriental', 'upbeat'];
export interface AudioRun { stream: MediaStream | null; start(): void; stop(): void }

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** record = true: the sound goes into a stream that is added to the video; false: it plays on the speakers (preview). */
export function runAudio(sound: Sound, o: { ms: number; record: boolean }): AudioRun {
  const AC: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AC(), master = ctx.createGain(), fx = ctx.createGain(), mus = ctx.createGain();
  fx.connect(master); mus.connect(master); master.gain.value = 0.9; fx.gain.value = sound === 'fx' ? 1 : 0.6; mus.gain.value = 1;
  let stream: MediaStream | null = null;
  if (o.record && typeof ctx.createMediaStreamDestination === 'function') { const d = ctx.createMediaStreamDestination(); master.connect(d); stream = d.stream; } else master.connect(ctx.destination);
  const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const tone = (bus: GainNode, f: number, t: number, dur: number, type: OscillatorType, vol: number, f2?: number) => {
    const os = ctx.createOscillator(), g = ctx.createGain(); os.type = type; os.frequency.setValueAtTime(f, t); if (f2) os.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    os.connect(g); g.connect(bus); os.start(t); os.stop(t + dur + 0.05);
  };
  const noise = (bus: GainNode, t: number, dur: number, type: BiquadFilterType, f: number, q: number, vol: number, f2?: number, atk = 0.4) => {
    const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = nb; fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur); fl.Q.value = q;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * atk); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(bus); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  };
  const kick = (t: number, vol: number) => tone(mus, 150, t, 0.2, 'sine', vol, 45);

  // the sounds that follow what happens on screen: text rows sliding in, dish landing, price tag popping, shimmer
  const effects = (t0: number) => {
    noise(fx, t0 + 0.0, 1.3, 'bandpass', 300, 1.2, 0.16, 2600, 0.6);
    tone(fx, 1800, t0 + 0.3, 0.08, 'sine', 0.07);
    tone(fx, 140, t0 + 0.55, 0.3, 'sine', 0.35, 50); noise(fx, t0 + 0.55, 0.12, 'lowpass', 500, 0.7, 0.12, undefined, 0.1);
    tone(fx, 660, t0 + 1.85, 0.16, 'sine', 0.22, 1100); tone(fx, 1320, t0 + 1.92, 0.12, 'triangle', 0.08);
    noise(fx, t0 + 2.05, 0.7, 'bandpass', 500, 1.4, 0.09, 3200, 0.5);
    [1568, 1976, 2349, 3136].forEach((f, i) => tone(fx, f, t0 + 2.85 + i * 0.07, 0.35, 'triangle', 0.05));
  };

  const music = (t0: number, total: number) => {
    if (sound === 'lounge') {
      const bpm = 88, st = 60 / bpm / 2, chords = [[50, 57, 60, 64], [55, 59, 62, 65], [48, 55, 59, 64], [57, 60, 64, 67]], bass = [38, 43, 36, 45], pent = [62, 65, 67, 69, 72];
      for (let i = 0; i * st < total; i++) {
        const t = t0 + i * st, bar = Math.floor(i / 8) % 4, s = i % 8;
        if (s === 0) chords[bar].forEach(m => { tone(mus, hz(m), t, 2.3, 'sine', 0.035); tone(mus, hz(m + 12), t, 2.0, 'triangle', 0.012); });
        if (s === 0 || s === 4) tone(mus, hz(bass[bar]), t, 0.55, 'triangle', 0.13);
        if (s === 0 || s === 5) kick(t, 0.22);
        if (s === 4) noise(mus, t, 0.09, 'bandpass', 1800, 2, 0.06, undefined, 0.05);
        noise(mus, t, 0.05, 'highpass', 7000, 0.7, s % 2 ? 0.014 : 0.026, undefined, 0.1);
        if (s === 2 || s === 6) { const m = pent[(i * 3) % 5]; tone(mus, hz(m), t, 0.7, 'sine', 0.055); tone(mus, hz(m + 12), t, 0.4, 'triangle', 0.015); }
      }
    } else if (sound === 'oriental') {
      const bpm = 100, st = 60 / bpm / 2, sc = [62, 63, 66, 67, 69, 70, 72, 74], mel = [0, -1, 1, 2, 1, 0, -1, 1, 2, 3, 2, -1, 1, 0, -1, -1, 4, -1, 3, 2, 3, 1, 2, 0];
      tone(mus, hz(50), t0, total, 'sine', 0.05); tone(mus, hz(57), t0, total, 'sine', 0.03);
      for (let i = 0; i * st < total; i++) {
        const t = t0 + i * st, s = i % 8, d = mel[i % mel.length];
        if (d >= 0) { tone(mus, hz(sc[d]), t, 0.34, 'triangle', 0.1); tone(mus, hz(sc[d] + 12), t, 0.2, 'sine', 0.025); }
        if (s === 0 || s === 6) { tone(mus, 170, t, 0.2, 'sine', 0.24, 70); noise(mus, t, 0.1, 'lowpass', 300, 0.7, 0.08, undefined, 0.1); }
        else if (s === 2 || s === 5) noise(mus, t, 0.06, 'bandpass', 3200, 4, 0.11, undefined, 0.1);
        else if (s === 3 || s === 7) noise(mus, t, 0.04, 'bandpass', 4500, 3, 0.05, undefined, 0.1);
      }
    } else if (sound === 'upbeat') {
      const bpm = 118, st = 60 / bpm / 2, pent = [72, 74, 76, 79, 81], arp = [0, 2, 1, 3, 2, 4, 3, 1], roots = [48, 48, 53, 55];
      for (let i = 0; i * st < total; i++) {
        const t = t0 + i * st, bar = Math.floor(i / 8) % 4, s = i % 8, m = pent[arp[s]];
        tone(mus, hz(m), t, 0.28, 'triangle', 0.08); tone(mus, hz(m + 12), t, 0.15, 'sine', 0.02);
        if (s % 2 === 0) tone(mus, hz(roots[bar]), t, 0.28, 'sine', 0.14);
        if (s % 2 === 0) kick(t, 0.28);
        if (s === 4) noise(mus, t, 0.13, 'bandpass', 1500, 1.5, 0.1, undefined, 0.05);
        if (s % 2) noise(mus, t, 0.05, 'highpass', 7500, 0.7, 0.03, undefined, 0.1);
      }
    }
  };

  let stopped = false;
  return {
    stream,
    start() {
      void ctx.resume(); const t0 = ctx.currentTime + 0.05, total = o.ms / 1000;
      effects(t0); music(t0, total);
      master.gain.setValueAtTime(0.9, t0 + total - 0.9); master.gain.linearRampToValueAtTime(0, t0 + total);   // fade out with the video
    },
    stop() {
      if (stopped) return; stopped = true;
      try { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(master.gain.value, ctx.currentTime); master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1); } catch { /* already closed */ }
      setTimeout(() => { ctx.close().catch(() => undefined); }, 250);
    },
  };
}
