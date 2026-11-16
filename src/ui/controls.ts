import type { InputState } from '../core/types';

const JOY_RADIUS = 64; // css px; matches #joystick size / 2
const DEAD_ZONE = 0.12; // fraction of radius
const FULL_SPEED_AT = 0.55; // fraction of radius at which input reaches full magnitude

/**
 * Floating virtual joystick (left touch zone) + keyboard (WASD / arrows).
 * Uses Pointer Events with per-pointer tracking, so the joystick and the SPLIT
 * button can be held simultaneously (multi-touch).
 */
export class Controls {
  readonly input: InputState = { x: 0, y: 0 };
  private joyId: number | null = null;
  private ox = 0;
  private oy = 0;
  private jx = 0;
  private jy = 0;
  private keys = new Set<string>();
  enabled = false;
  /** Fires once per physical press of SPLIT (button or Space). */
  onSplit: () => void = () => {};
  onPauseKey: () => void = () => {};
  onAnyGesture: () => void = () => {};

  constructor(
    private zone: HTMLElement,
    private base: HTMLElement,
    private knob: HTMLElement,
    splitBtn: HTMLElement,
  ) {
    zone.addEventListener('pointerdown', this.down, { passive: false });
    zone.addEventListener('pointermove', this.move, { passive: false });
    zone.addEventListener('pointerup', this.up);
    zone.addEventListener('pointercancel', this.up);
    zone.addEventListener('lostpointercapture', this.up);

    // SPLIT: trigger on pointerdown for immediacy; one trigger per pointer press.
    const pressed = new Set<number>();
    splitBtn.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onAnyGesture();
        if (pressed.has(e.pointerId)) return;
        pressed.add(e.pointerId);
        splitBtn.classList.add('pressed');
        try {
          splitBtn.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        if (this.enabled) this.onSplit();
      },
      { passive: false },
    );
    const release = (e: PointerEvent) => {
      pressed.delete(e.pointerId);
      if (pressed.size === 0) splitBtn.classList.remove('pressed');
    };
    splitBtn.addEventListener('pointerup', release);
    splitBtn.addEventListener('pointercancel', release);
    splitBtn.addEventListener('lostpointercapture', release);
    splitBtn.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      this.onAnyGesture();
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'spacebar') {
        e.preventDefault();
        if (!e.repeat && this.enabled) this.onSplit();
        return;
      }
      if (k === 'escape' || k === 'p') {
        if (!e.repeat) this.onPauseKey();
        return;
      }
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        e.preventDefault();
        this.keys.add(k);
        this.recompute();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
      this.recompute();
    });
    window.addEventListener('blur', () => this.reset());
  }

  private down = (e: PointerEvent): void => {
    e.preventDefault();
    this.onAnyGesture();
    if (!this.enabled || this.joyId !== null) return;
    this.joyId = e.pointerId;
    try {
      this.zone.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.ox = e.clientX;
    this.oy = e.clientY;
    this.jx = 0;
    this.jy = 0;
    this.base.style.left = `${this.ox}px`;
    this.base.style.top = `${this.oy}px`;
    this.knob.style.transform = 'translate(0px, 0px)';
    this.base.classList.remove('hidden');
    this.recompute();
  };

  private move = (e: PointerEvent): void => {
    if (e.pointerId !== this.joyId) return;
    e.preventDefault();
    let dx = e.clientX - this.ox;
    let dy = e.clientY - this.oy;
    let len = Math.hypot(dx, dy);
    // floating base: if the finger goes past the rim, drag the base along
    if (len > JOY_RADIUS) {
      const over = len - JOY_RADIUS;
      this.ox += (dx / len) * over;
      this.oy += (dy / len) * over;
      this.base.style.left = `${this.ox}px`;
      this.base.style.top = `${this.oy}px`;
      dx = e.clientX - this.ox;
      dy = e.clientY - this.oy;
      len = JOY_RADIUS;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const f = len / JOY_RADIUS;
    if (f < DEAD_ZONE) {
      this.jx = 0;
      this.jy = 0;
    } else {
      const mag = Math.min(1, (f - DEAD_ZONE) / (FULL_SPEED_AT - DEAD_ZONE));
      this.jx = (dx / len) * mag;
      this.jy = (dy / len) * mag;
    }
    this.recompute();
  };

  private up = (e: PointerEvent): void => {
    if (e.pointerId !== this.joyId) return;
    this.joyId = null;
    this.jx = 0;
    this.jy = 0;
    this.base.classList.add('hidden');
    this.recompute();
  };

  private recompute(): void {
    let kx = 0;
    let ky = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) kx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) kx += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) ky -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) ky += 1;
    if (this.joyId !== null && (this.jx !== 0 || this.jy !== 0)) {
      this.input.x = this.jx;
      this.input.y = this.jy;
    } else if (kx !== 0 || ky !== 0) {
      const l = Math.hypot(kx, ky);
      this.input.x = kx / l;
      this.input.y = ky / l;
    } else {
      this.input.x = 0;
      this.input.y = 0;
    }
  }

  get joystickActive(): boolean {
    return this.joyId !== null;
  }

  /** Releases everything (pause, blur, screen changes). */
  reset(): void {
    this.joyId = null;
    this.jx = 0;
    this.jy = 0;
    this.keys.clear();
    this.base.classList.add('hidden');
    this.recompute();
  }
}
