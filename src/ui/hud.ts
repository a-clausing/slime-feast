import { CONFIG } from '../config';
import { radiusForMass } from '../core/mass';
import type { World } from '../core/world';
import type { GameScene } from '../game/GameScene';

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

export function fmtTime(sec: number): string {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtNum(n: number): string {
  return Math.floor(n).toLocaleString('en-US');
}

/** HUD + split button state + stationary-portion indicator. Writes to the DOM only on change. */
export class Hud {
  private score = $('hud-score');
  private mass = $('hud-mass');
  private homeMass = $('hud-home-mass');
  private time = $('hud-time');
  private split = $('btn-split');
  private splitNeed = $('split-need');
  private ind = $('home-indicator');
  private indArrow = this.ind.querySelector('.hi-arrow') as HTMLElement;
  private indBody = this.ind.querySelector('.hi-body') as HTMLElement;
  private indDist = $('hi-dist');
  private hud = $('hud');
  private cache = new Map<string, string>();

  private set(key: string, el: HTMLElement, v: string): void {
    if (this.cache.get(key) === v) return;
    this.cache.set(key, v);
    el.textContent = v;
  }
  private cls(key: string, el: HTMLElement, c: string, on: boolean): void {
    const k = `${key}:${c}`;
    const v = on ? '1' : '0';
    if (this.cache.get(k) === v) return;
    this.cache.set(k, v);
    el.classList.toggle(c, on);
  }

  reset(): void {
    this.cache.clear();
  }

  update(w: World, scene: GameScene): void {
    const a = w.active;
    const home = w.home;
    this.set('score', this.score, fmtNum(w.stats.bestMass));
    this.set('mass', this.mass, fmtNum(a?.mass ?? 0));
    this.set('time', this.time, fmtTime(w.stats.time));
    this.cls('hm', this.homeMass, 'hidden', !home);
    if (home) this.set('hmv', this.homeMass, `⌂ ${fmtNum(home.mass)}`);

    const can = w.canSplit();
    this.cls('split', this.split, 'disabled', !can);
    this.cls('split', this.split, 'ready', can);
    this.set('need', this.splitNeed, w.isSplit ? 'MERGE FIRST' : `${fmtNum(a?.mass ?? 0)}/${CONFIG.MIN_SPLIT_MASS}`);

    this.updateIndicator(w, scene);
  }

  private updateIndicator(w: World, scene: GameScene): void {
    const home = w.home;
    const a = w.active;
    if (!home || !a) {
      this.cls('ind', this.ind, 'hidden', true);
      return;
    }
    const hr = radiusForMass(home.mass);
    if (scene.isWorldPointVisible(home.x, home.y, hr * 0.6)) {
      this.cls('ind', this.ind, 'hidden', true);
      return;
    }
    this.cls('ind', this.ind, 'hidden', false);
    this.cls('ind', this.ind, 'threat', scene.homeThreat);

    const W = window.innerWidth;
    const H = window.innerHeight;
    const hudRect = this.hud.getBoundingClientRect();
    const splitRect = this.split.getBoundingClientRect();
    const left = 34;
    const right = W - 34;
    const top = Math.max(hudRect.bottom, 60) + 26;
    const bottom = Math.min(H - 30, splitRect.top - 16);

    const p = scene.worldToScreen(home.x, home.y);
    const cx = W / 2;
    const cy = H / 2;
    let dx = p.x - cx;
    let dy = p.y - cy;
    if (dx === 0 && dy === 0) dx = 1;
    // intersect ray from centre with the safe rectangle
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (right - cx) / dx);
    if (dx < 0) t = Math.min(t, (left - cx) / dx);
    if (dy > 0) t = Math.min(t, (bottom - cy) / dy);
    if (dy < 0) t = Math.min(t, (top - cy) / dy);
    const x = cx + dx * t;
    const y = cy + dy * t;
    const ang = Math.atan2(dy, dx);
    this.ind.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    this.indArrow.style.transform = `rotate(${ang.toFixed(3)}rad) translateX(10px)`;
    // keep the label just inside the arrow
    const lx = -Math.cos(ang) * 34;
    const ly = -Math.sin(ang) * 22;
    this.indBody.style.left = `${lx.toFixed(1)}px`;
    this.indBody.style.top = `${ly.toFixed(1)}px`;
    const dist = Math.max(0, Math.hypot(home.x - a.x, home.y - a.y) - hr - radiusForMass(a.mass));
    this.set('dist', this.indDist, `${Math.round(dist / 10)}m`);
  }
}
