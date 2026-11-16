import { CONFIG } from '../config';
import { canConsume, radiusForMass } from './mass';
import type { Slime } from './types';
import type { World } from './world';

const TAU = Math.PI * 2;

export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Speed multiplier per behaviour (fraction of the size-based top speed). */
export function modeSpeed(mode: Slime['mode']): number {
  switch (mode) {
    case 'flee':
      return CONFIG.AI_FLEE_SPEED;
    case 'hunt':
      return 1;
    case 'forage':
      return 0.8;
    default:
      return 0.55;
  }
}

/**
 * Lightweight steering "think" for one enemy. Runs every AI_THINK_MIN..MAX seconds
 * (staggered) and only sets a desired heading; the per-step integrator turns smoothly
 * toward it, so enemies never jitter frame to frame.
 * Priority: survive (flee) > hunt prey > forage food > wander.
 */
export function thinkEnemy(world: World, e: Slime): void {
  const rng = world.rng;
  const p = world.pressure;
  const r = radiusForMass(e.mass);
  const detect = (CONFIG.AI_DETECT_BASE + r * CONFIG.AI_DETECT_RADIUS_MULT) * p.detectMult;
  const fleeRange = detect * CONFIG.AI_FLEE_RANGE_MULT;

  let fx = 0;
  let fy = 0;
  let threatened = false;
  let best: Slime | null = null;
  let bestScore = 0;
  let avoidX = 0;
  let avoidY = 0;

  for (const s of world.slimes) {
    if (!s.alive || s === e) continue;
    const dx = s.x - e.x;
    const dy = s.y - e.y;
    const rs = radiusForMass(s.mass);
    const dist = Math.hypot(dx, dy) || 0.001;
    const gap = dist - rs - r;
    if (canConsume(s.mass, e.mass)) {
      if (gap < fleeRange) {
        const w = 1 / Math.max(30, gap + 30);
        fx -= (dx / dist) * w;
        fy -= (dy / dist) * w;
        threatened = true;
      }
    } else if (canConsume(e.mass, s.mass)) {
      if (gap < detect) {
        let score = s.mass / (Math.max(0, gap) + 80);
        if (s.kind === 'player') score *= 0.6 + p.playerFocus;
        else if (s.kind === 'home') score *= 0.4 + p.playerFocus * CONFIG.AI_HOME_INTEREST * 2;
        // stickiness: keep current target unless something much better appears
        if (s.id === e.targetId && !e.targetIsFood) score *= 1.5;
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }
    } else if (gap < 50) {
      // neutral, similar size: slide around each other
      const w = 1 / Math.max(10, gap + 20);
      avoidX -= (dx / dist) * w;
      avoidY -= (dy / dist) * w;
    }
  }

  let dirX = 0;
  let dirY = 0;
  if (threatened) {
    e.mode = 'flee';
    e.targetId = -1;
    const l = Math.hypot(fx, fy) || 1;
    dirX = fx / l;
    dirY = fy / l;
  } else if (best) {
    e.mode = 'hunt';
    e.targetId = best.id;
    e.targetIsFood = false;
    // slight lead on moving targets
    const lead = 0.25;
    const tx = best.x + best.vx * lead - e.x;
    const ty = best.y + best.vy * lead - e.y;
    const l = Math.hypot(tx, ty) || 1;
    dirX = tx / l;
    dirY = ty / l;
  } else {
    // forage nearest pellet
    let fd = detect * 0.75;
    let fdx = 0;
    let fdy = 0;
    let found = -1;
    world.foodGrid.query(e.x, e.y, fd, (idx) => {
      const f = world.food[idx];
      if (!f.alive) return;
      const d = Math.hypot(f.x - e.x, f.y - e.y);
      if (d < fd) {
        fd = d;
        fdx = f.x - e.x;
        fdy = f.y - e.y;
        found = f.id;
      }
    });
    if (found >= 0 && rng.next() < 0.85) {
      e.mode = 'forage';
      e.targetId = found;
      e.targetIsFood = true;
      const l = Math.hypot(fdx, fdy) || 1;
      dirX = fdx / l;
      dirY = fdy / l;
    } else {
      e.mode = 'wander';
      e.targetId = -1;
      if (rng.next() < 0.3) e.desired = wrapAngle(e.desired + rng.range(-1.1, 1.1));
      dirX = Math.cos(e.desired);
      dirY = Math.sin(e.desired);
    }
  }

  // neutral sliding
  dirX += avoidX * 12;
  dirY += avoidY * 12;

  // wall avoidance
  const m = CONFIG.AI_WALL_MARGIN + r;
  const W = CONFIG.WORLD_WIDTH;
  const H = CONFIG.WORLD_HEIGHT;
  if (e.x < m) dirX += (m - e.x) / m * 1.6;
  if (e.x > W - m) dirX -= (e.x - (W - m)) / m * 1.6;
  if (e.y < m) dirY += (m - e.y) / m * 1.6;
  if (e.y > H - m) dirY -= (e.y - (H - m)) / m * 1.6;

  if (dirX !== 0 || dirY !== 0) e.desired = Math.atan2(dirY, dirX);
  e.think = rng.range(CONFIG.AI_THINK_MIN, CONFIG.AI_THINK_MAX);
}
