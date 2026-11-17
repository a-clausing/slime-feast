/**
 * Procedural background music (WebAudio) — an upbeat rock/techno loop composed in code,
 * so there are no audio files to license, download or cache.
 *
 * 128 BPM, E minor. Four-on-the-floor kick, snare on 2 & 4, pumping octave bass,
 * distorted power-chord "guitar" chugs, and a lead riff when danger is near.
 *
 * Layers fade in with intensity:
 *   0 (menu / paused)   light kick, quiet chugs, sparkly arpeggio
 *   1 (normal play)     full drums, pumping bass, power chords
 *   2 (danger nearby)   + lead riff, crash cymbals, 16th hats
 * Notes are scheduled slightly ahead with a look-ahead timer so timing stays tight.
 */

const BPM = 128;
const STEP = 60 / BPM / 4; // 16th note
const LOOKAHEAD = 0.12;
const TICK_MS = 25;

// Em – C – D – B power-chord progression, 1 bar each. Root MIDI notes (E2 = 40).
const ROOTS = [40, 36, 38, 35];
// 16-step guitar rhythm: 1 = palm-muted chug, 2 = open accent, 0 = rest
const GTR = [2, 1, 1, 1, 0, 1, 2, 1, 1, 0, 1, 1, 2, 1, 0, 1];
// lead riff over 4 bars (semitones above each bar's root + 24; -1 = rest)
const LEAD: number[][] = [
  [7, -1, 10, -1, 12, -1, 10, 7, -1, 7, 5, -1, 7, -1, -1, -1],
  [7, -1, 11, -1, 12, -1, 14, -1, 12, 11, -1, 7, -1, -1, 4, -1],
  [7, -1, 10, -1, 12, -1, 14, 12, -1, 10, 12, -1, 14, -1, 17, -1],
  [12, -1, 11, -1, 7, -1, 6, -1, 7, -1, -1, 11, 12, -1, 11, -1],
];
// sparkly 16th arpeggio for the calm (menu / pause) layer
const ARP = [0, 7, 12, 15, 12, 7, 0, 7, 12, 15, 19, 15, 12, 7, 12, 15];

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

type LayerName = 'drums' | 'bass' | 'gtr' | 'calm' | 'danger';

export class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private layers: Record<LayerName, GainNode> | null = null;
  private gtrBus: AudioNode | null = null;
  private leadBus: AudioNode | null = null;
  private timer = 0;
  private nextTime = 0;
  private step = 0;
  private noise: AudioBuffer | null = null;
  private intensity = 0;
  muted = false;
  private playing = false;

  attach(ctx: AudioContext, destination: AudioNode): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.3;
    const comp = ctx.createDynamicsCompressor(); // glue + loudness, keeps peaks safe
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    this.out.connect(comp).connect(destination);
    const mk = (v: number) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(this.out!);
      return g;
    };
    this.layers = { drums: mk(0.35), bass: mk(0.3), gtr: mk(0.25), calm: mk(0.6), danger: mk(0) };
    this.gtrBus = this.distortion(ctx, 28, 3200, this.layers.gtr);
    this.leadBus = this.distortion(ctx, 18, 4200, this.layers.danger);

    const len = Math.floor(ctx.sampleRate * 0.6);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.playing) this.startClock();
  }

  /** Overdrive → cabinet-style low-pass, like a distorted guitar amp. */
  private distortion(ctx: AudioContext, amount: number, cutoff: number, dest: AudioNode): AudioNode {
    const ws = ctx.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
    }
    ws.curve = curve;
    ws.oversample = '2x';
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    lp.Q.value = 0.8;
    ws.connect(lp).connect(dest);
    return ws;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(m ? 0 : 0.3, this.ctx.currentTime, 0.15);
  }

  play(): void {
    this.playing = true;
    if (this.ctx) this.startClock();
  }

  stop(): void {
    this.playing = false;
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  /** 0 calm, 1 playing, 2 danger. Layers crossfade smoothly. */
  setIntensity(level: number): void {
    if (level === this.intensity || !this.layers || !this.ctx) {
      this.intensity = level;
      return;
    }
    this.intensity = level;
    const t = this.ctx.currentTime;
    const set = (g: GainNode, v: number, tc = 0.4) => g.gain.setTargetAtTime(v, t, tc);
    set(this.layers.drums, level === 0 ? 0.35 : 1);
    set(this.layers.bass, level === 0 ? 0.3 : 0.85);
    set(this.layers.gtr, level === 0 ? 0.25 : level === 1 ? 0.75 : 1);
    set(this.layers.calm, level === 0 ? 0.6 : 0.15);
    set(this.layers.danger, level === 2 ? 0.8 : 0, level === 2 ? 0.15 : 0.7);
  }

  private startClock(): void {
    if (this.timer || !this.ctx) return;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (this.nextTime < ctx.currentTime - 0.25) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % (16 * ROOTS.length);
    }
  }

  private playStep(step: number, t: number): void {
    const L = this.layers!;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const root = ROOTS[bar];

    // drums: four-on-the-floor kick, snare on 2 & 4, off-beat hats
    if (s % 4 === 0) this.kick(t, L.drums);
    if (s === 4 || s === 12) this.snare(t, L.drums, 0.55);
    if (s === 14 && bar === 3) this.snare(t, L.drums, 0.35); // fill into the loop
    if (s === 15 && bar === 3) this.snare(t, L.drums, 0.45);
    if (s % 4 === 2) this.hat(t, L.drums, 0.32, 0.09);
    else if (s % 2 === 1) this.hat(t, L.drums, 0.12, 0.03);
    // danger: 16th hats + crash on each bar
    this.hat(t, L.danger, 0.1, 0.025);
    if (s === 0) this.crash(t, L.danger);

    // pumping octave bass on every 16th
    this.bass(mtof(root - 12 + (s % 2) * 12), t, STEP * 0.9, L.bass);

    // distorted power chords (root + 5th + octave)
    const g = GTR[s];
    if (g > 0) this.power(root, t, g === 2 ? STEP * 1.8 : STEP * 0.55, g === 2 ? 0.5 : 0.3);

    // calm sparkle arpeggio
    this.pluck(mtof(root + 24 + ARP[s]), t, L.calm, 0.07);

    // danger lead riff
    const ld = LEAD[bar][s];
    if (ld >= 0) this.lead(mtof(root + 24 + ld), t, STEP * 1.9);
  }

  // ───────────── instruments ─────────────

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private power(root: number, t: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.connect(this.gtrBus!);
    for (const [iv, det] of [
      [0, -6],
      [7, 5],
      [12, 0],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(root + 12 + iv);
      o.detune.value = det;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    this.env(g, t, 0.004, vol, dur);
  }

  private lead(f: number, t: number, dur: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.connect(this.leadBus!);
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const lfo = ctx.createOscillator(); // vibrato for a "guitar solo" feel
    const lg = ctx.createGain();
    lfo.frequency.value = 6;
    lg.gain.value = f * 0.008;
    lfo.connect(lg).connect(o.frequency);
    o.connect(g);
    this.env(g, t, 0.01, 0.22, dur);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  private bass(f: number, t: number, dur: number, dest: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + dur);
    lp.Q.value = 6;
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.connect(lp).connect(g).connect(dest);
    this.env(g, t, 0.004, 0.32, dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private pluck(f: number, t: number, dest: AudioNode, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    o.connect(g).connect(dest);
    this.env(g, t, 0.004, vol, STEP * 1.3);
    o.start(t);
    o.stop(t + STEP * 1.6);
  }

  private kick(t: number, dest: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    o.connect(g).connect(dest);
    this.env(g, t, 0.002, 0.95, 0.2);
    o.start(t);
    o.stop(t + 0.28);
    this.noiseHit(t, dest, 'highpass', 3000, 0.12, 0.012); // click for punch
  }

  private snare(t: number, dest: AudioNode, vol: number): void {
    const ctx = this.ctx!;
    this.noiseHit(t, dest, 'bandpass', 1900, vol, 0.16);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    o.connect(g).connect(dest);
    this.env(g, t, 0.002, vol * 0.5, 0.09);
    o.start(t);
    o.stop(t + 0.12);
  }

  private hat(t: number, dest: AudioNode, vol: number, dur: number): void {
    this.noiseHit(t, dest, 'highpass', 7500, vol, dur);
  }

  private crash(t: number, dest: AudioNode): void {
    this.noiseHit(t, dest, 'highpass', 5000, 0.28, 0.55);
  }

  private noiseHit(t: number, dest: AudioNode, type: BiquadFilterType, freq: number, vol: number, dur: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    src.connect(f).connect(g).connect(dest);
    this.env(g, t, 0.002, vol, dur);
    src.start(t);
    src.stop(t + dur + 0.05);
  }
}
