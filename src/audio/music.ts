/**
 * Procedural background music (WebAudio) — a looping dark-dungeon groove composed in code,
 * so there are no audio files to license, download or cache.
 *
 * Layers fade in with intensity:
 *   0 (menu / paused)   pad + slow bass
 *   1 (normal play)     + kick, hats, plucked arpeggio
 *   2 (danger nearby)   + snare, driving bass, brighter lead
 * Notes are scheduled slightly ahead of time with a look-ahead timer so timing stays tight
 * even if the main thread hiccups.
 */

const BPM = 104;
const STEP = 60 / BPM / 4; // 16th note
const LOOKAHEAD = 0.12; // seconds scheduled ahead
const TICK_MS = 25;

// A minor dungeon progression: Am – F – Dm – E (harmonic minor turnaround), 1 bar each
const CHORDS: number[][] = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [50, 53, 57], // Dm
  [52, 56, 59], // E (G# leading tone)
];
const BASS = [45, 41, 38, 40]; // A1 F1 D1 E1 (MIDI)
// 16-step arpeggio: chord-tone index (0–2), 3–5 = same tones an octave up
const ARP = [0, 1, 2, 3, 1, 2, 3, 2, 0, 1, 2, 3, 5, 3, 2, 1];
// sparse danger lead (absolute MIDI notes, -1 = rest): E5 D5 C5 B4 C5
const LEAD = [-1, -1, -1, -1, 76, -1, -1, 74, -1, -1, 72, -1, 71, -1, 72, -1];

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private layers: Record<'pad' | 'bass' | 'drums' | 'arp' | 'danger', GainNode> | null = null;
  private timer = 0;
  private nextTime = 0;
  private step = 0;
  private noise: AudioBuffer | null = null;
  private intensity = 0;
  muted = false;
  private playing = false;

  /** Attach to the shared AudioContext (created on the first user gesture). */
  attach(ctx: AudioContext, destination: AudioNode): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.65;
    // gentle low-pass on the whole mix keeps it from fighting the sound effects
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    this.out.connect(lp).connect(destination);
    const mk = (v: number) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(this.out!);
      return g;
    };
    this.layers = { pad: mk(0.5), bass: mk(0.6), drums: mk(0), arp: mk(0), danger: mk(0) };
    const len = Math.floor(ctx.sampleRate * 0.3);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.playing) this.startClock();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(m ? 0 : 0.65, this.ctx.currentTime, 0.15);
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
    const set = (g: GainNode, v: number, tc = 0.6) => g.gain.setTargetAtTime(v, t, tc);
    set(this.layers.pad, level === 2 ? 0.35 : 0.5);
    set(this.layers.bass, level === 0 ? 0.45 : 0.7);
    set(this.layers.drums, level >= 1 ? (level === 2 ? 0.9 : 0.6) : 0);
    set(this.layers.arp, level >= 1 ? 0.45 : 0);
    set(this.layers.danger, level === 2 ? 0.55 : 0, level === 2 ? 0.25 : 0.9);
  }

  private startClock(): void {
    if (this.timer || !this.ctx) return;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // if we fell far behind (tab suspended), resync instead of bursting notes
    if (this.nextTime < ctx.currentTime - 0.25) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % (16 * CHORDS.length);
    }
  }

  private playStep(step: number, t: number): void {
    const L = this.layers!;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = CHORDS[bar];

    // pad: one long chord per bar
    if (s === 0) for (const n of chord) this.pad(mtof(n), t, STEP * 16, L.pad);

    // bass: root on 1 and the "and" of 2; driving 8ths in danger
    const root = mtof(BASS[bar]);
    if (s === 0 || s === 6 || s === 10) this.bass(root, t, STEP * 3, L.bass);
    if (s % 2 === 0) this.bass(root * 2, t, STEP * 1.5, L.danger, 0.35);

    // drums
    if (s === 0 || s === 8) this.kick(t, L.drums);
    if (s === 10) this.kick(t, L.drums, 0.6);
    if (s % 2 === 0) this.hat(t, L.drums, s % 4 === 2 ? 0.22 : 0.12);
    if (s === 4 || s === 12) this.snare(t, L.danger);

    // plucked arpeggio
    const a = ARP[s];
    this.pluck(mtof(chord[a % 3] + 12 * Math.floor(a / 3) + 12), t, L.arp);
    // danger lead: sparse high line over the chords
    const ld = LEAD[s];
    if (ld >= 0) this.pluck(mtof(ld), t, L.danger, 0.5, 'square');
  }

  // ───────────── instruments ─────────────

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private pad(f: number, t: number, dur: number, dest: AudioNode): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    lp.connect(g).connect(dest);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private bass(f: number, t: number, dur: number, dest: AudioNode, vol = 0.32): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + dur);
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.connect(lp).connect(g).connect(dest);
    this.env(g, t, 0.01, vol, dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private pluck(f: number, t: number, dest: AudioNode, vol = 0.12, type: OscillatorType = 'triangle'): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    o.connect(g).connect(dest);
    this.env(g, t, 0.005, type === 'square' ? vol * 0.25 : vol, STEP * 1.6);
    o.start(t);
    o.stop(t + STEP * 2);
  }

  private kick(t: number, dest: AudioNode, vol = 0.9): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    o.connect(g).connect(dest);
    this.env(g, t, 0.003, vol * 0.5, 0.22);
    o.start(t);
    o.stop(t + 0.3);
  }

  private hat(t: number, dest: AudioNode, vol: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    src.connect(hp).connect(g).connect(dest);
    this.env(g, t, 0.002, vol * 0.4, 0.05);
    src.start(t);
    src.stop(t + 0.08);
  }

  private snare(t: number, dest: AudioNode): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    const g = ctx.createGain();
    src.connect(bp).connect(g).connect(dest);
    this.env(g, t, 0.002, 0.35, 0.14);
    src.start(t);
    src.stop(t + 0.2);
  }
}
