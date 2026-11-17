/**
 * Tiny procedural sound engine (WebAudio). No audio files: every effect is synthesized,
 * so there are no licensing concerns and nothing extra to download/cache.
 * The AudioContext is created only after a user gesture (iOS requirement).
 */
import { Music } from './music';

type Ctx = AudioContext;

export class Sfx {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  muted = false;
  private lastFood = 0;
  /** Background music shares this AudioContext but has its own volume / mute. */
  readonly music = new Music();

  /** Call from a user-gesture handler (pointerdown/keydown). Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9;
        this.master.connect(this.ctx.destination);
        this.music.attach(this.ctx, this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.02);
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }
  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private ok(): boolean {
    return !!this.ctx && !!this.master && !this.muted && this.ctx.state === 'running';
  }

  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    vol: number,
    delay = 0,
  ): void {
    if (!this.ok()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.015, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number, q = 1, delay = 0): void {
    if (!this.ok()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
  }

  food(big: boolean): void {
    const now = performance.now();
    if (now - this.lastFood < 45) return; // avoid buzzing when vacuuming many pellets
    this.lastFood = now;
    this.music.duck(0.7, 0.08);
    const base = big ? 660 : 880 + Math.random() * 300;
    this.tone('sine', base, base * 1.6, big ? 0.16 : 0.08, big ? 0.22 : 0.12);
  }
  /** You got eaten: big wet CHOMP + squelch, and the music ducks hard. */
  eaten(): void {
    this.music.duck(0.15, 0.6);
    // jaw snap
    this.noise(0.08, 0.6, 2400, 1.2);
    this.tone('square', 220, 60, 0.12, 0.25);
    // body crunch
    this.noise(0.25, 0.45, 600, 0.9, 0.05);
    this.tone('sawtooth', 160, 40, 0.35, 0.3, 0.05);
    // squelchy swallow
    this.tone('sine', 420, 90, 0.4, 0.3, 0.18);
    this.noise(0.3, 0.25, 350, 2, 0.2);
  }

  gulp(size: number): void {
    this.music.duck(0.5, 0.15);
    const f = Math.max(90, 320 - size * 0.4);
    this.tone('sine', f * 1.6, f * 0.6, 0.22, 0.35);
    this.tone('triangle', f * 0.8, f * 0.4, 0.18, 0.2, 0.04);
    this.noise(0.12, 0.15, 500, 2);
  }
  split(): void {
    this.music.duck(0.5, 0.2);
    this.noise(0.25, 0.25, 900, 0.8);
    this.tone('sine', 520, 200, 0.25, 0.28);
    this.tone('sine', 300, 700, 0.18, 0.15, 0.06);
  }
  recombine(): void {
    this.music.duck(0.5, 0.25);
    this.tone('sine', 330, 660, 0.18, 0.25);
    this.tone('sine', 495, 990, 0.22, 0.2, 0.08);
    this.tone('triangle', 660, 1320, 0.3, 0.16, 0.16);
  }
  lose(): void {
    this.tone('sawtooth', 300, 80, 0.45, 0.2);
    this.noise(0.3, 0.2, 300, 1);
  }
  gameOver(): void {
    this.music.duck(0.2, 1.2);
    [392, 330, 262, 196].forEach((f, i) => this.tone('triangle', f, f * 0.98, 0.32, 0.22, i * 0.17));
  }
  button(): void {
    this.tone('square', 600, 800, 0.05, 0.08);
  }
  denied(): void {
    this.tone('square', 180, 140, 0.08, 0.08);
  }
}
