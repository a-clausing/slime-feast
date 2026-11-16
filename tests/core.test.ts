import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { canConsume, radiusForMass, speedForMass, overlapEnoughToEat } from '../src/core/mass';
import { World } from '../src/core/world';
import { deserializeWorld, serializeWorld } from '../src/core/save';
import { pressureAt } from '../src/core/difficulty';
import { emptyWorld, enemy, quietStep } from './helpers';

describe('starting state', () => {
  it('initialises a run correctly', () => {
    const w = new World(42);
    const p = w.active!;
    expect(p.mass).toBe(CONFIG.STARTING_MASS);
    expect(p.x).toBe(CONFIG.WORLD_WIDTH / 2);
    expect(p.y).toBe(CONFIG.WORLD_HEIGHT / 2);
    expect(w.isSplit).toBe(false);
    expect(w.stats.score).toBe(0);
    expect(w.stats.time).toBe(0);
    expect(w.foodCount()).toBeGreaterThan(CONFIG.FOOD_TARGET);
  });

  it('never spawns a dangerous enemy near the player at start', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const w = new World(seed);
      const p = w.active!;
      for (const e of w.slimes) {
        if (e.kind !== 'enemy') continue;
        if (canConsume(e.mass, p.mass)) {
          expect(Math.hypot(e.x - p.x, e.y - p.y)).toBeGreaterThan(550);
        }
      }
    }
  });
});

describe('mass formulas', () => {
  it('radius grows with sqrt(mass)', () => {
    expect(radiusForMass(CONFIG.STARTING_MASS)).toBeCloseTo(CONFIG.BASE_RADIUS);
    expect(radiusForMass(CONFIG.STARTING_MASS * 4)).toBeCloseTo(CONFIG.BASE_RADIUS * 2);
  });
  it('speed decreases smoothly with mass and is clamped', () => {
    let prev = Infinity;
    for (let m = 5; m < 20000; m *= 1.3) {
      const s = speedForMass(m);
      expect(s).toBeLessThanOrEqual(prev);
      expect(s).toBeGreaterThanOrEqual(CONFIG.SPEED_MIN);
      expect(s).toBeLessThanOrEqual(CONFIG.SPEED_MAX);
      prev = s;
    }
  });
});

describe('consumption threshold (exactly 120%)', () => {
  it.each([
    [120, 100, true],
    [119, 100, false],
    [240, 200, true],
    [230, 200, false],
    [119.99999, 100, false],
    [30, 25, true],
    [0.6 * 3, 1.5, true], // float-y exact threshold 1.8 vs 1.5*1.2
    [100, 100, false],
  ])('%d vs %d → %s', (pred, prey, ok) => {
    expect(canConsume(pred, prey)).toBe(ok);
  });

  it('requires meaningful overlap, not an edge touch', () => {
    const R = radiusForMass(120);
    const r = radiusForMass(100);
    expect(overlapEnoughToEat(R + r - 1, R, r)).toBe(false); // barely touching
    expect(overlapEnoughToEat(R - r * 0.5, R, r)).toBe(true);
  });

  it('player eats eligible enemy once, transferring mass and score exactly once', () => {
    const { w, p } = emptyWorld(120);
    const e = enemy(w, 1500, 1500, 100);
    quietStep(w, 1);
    expect(e.alive).toBe(false);
    expect(p.mass).toBe(220);
    expect(w.stats.score).toBe(100);
    expect(w.stats.creaturesEaten).toBe(1);
    quietStep(w, 5);
    expect(p.mass).toBe(220);
    expect(w.stats.score).toBe(100);
  });

  it('119 vs 100 bumps instead of eating', () => {
    const { w, p } = emptyWorld(119);
    const e = enemy(w, 1510, 1500, 100);
    quietStep(w, 30);
    expect(e.alive).toBe(true);
    expect(p.alive).toBe(true);
    const gap = Math.hypot(e.x - p.x, e.y - p.y) - radiusForMass(119) - radiusForMass(100);
    expect(gap).toBeGreaterThan(-2); // pushed apart
  });

  it('enemies eat the player under the same rule', () => {
    const { w, p } = emptyWorld(100);
    enemy(w, 1500, 1500, 120);
    quietStep(w, 1);
    expect(p.alive).toBe(false);
    expect(w.gameOver).toBe(true);
  });

  it('enemy-to-enemy consumption transfers mass', () => {
    const { w } = emptyWorld(25, 200, 200);
    const a = enemy(w, 1500, 1500, 240);
    const b = enemy(w, 1500, 1500, 200);
    quietStep(w, 1);
    expect(b.alive).toBe(false);
    expect(a.mass).toBe(440);
    expect(w.stats.score).toBe(0); // not a player kill
  });
});

describe('Slime Split', () => {
  it('is unavailable below minimum mass', () => {
    const { w } = emptyWorld(99.99);
    expect(w.canSplit()).toBe(false);
    expect(w.trySplit()).toBe(false);
    expect(w.isSplit).toBe(false);
  });

  it('splits exactly 60/40 and preserves mass', () => {
    const { w, p } = emptyWorld(500);
    expect(w.trySplit()).toBe(true);
    const home = w.home!;
    const act = w.active!;
    expect(home.mass).toBe(300);
    expect(act.mass).toBe(200);
    expect(home.mass + act.mass).toBe(500);
    expect(home.x).toBe(1500);
    expect(home.y).toBe(1500);
    expect(home.id).toBe(p.id);
    // default direction is right
    expect(act.x).toBeGreaterThan(home.x);
    expect(act.y).toBeCloseTo(home.y);
    expect(w.stats.splits).toBe(1);
  });

  it('preserves mass for awkward values', () => {
    for (const m of [100, 101.3, 333.33, 777.7, 12345.678]) {
      const { w } = emptyWorld(m);
      w.trySplit();
      expect(w.home!.mass + w.active!.mass).toBe(m);
      expect(w.home!.mass).toBeCloseTo(m * 0.6, 10);
    }
  });

  it('uses the last movement direction', () => {
    const { w } = emptyWorld(200);
    quietStep(w, 3, { x: 0, y: -1 });
    const home0 = { ...w.active! };
    w.trySplit();
    expect(w.active!.y).toBeLessThan(home0.y);
  });

  it('splits toward the joystick direction held at the moment of the press', () => {
    const { w } = emptyWorld(400);
    quietStep(w, 30, { x: 1, y: 0 }); // was moving right
    const h = { x: w.active!.x, y: w.active!.y };
    w.trySplit(0, 1); // aiming down when SPLIT is pressed
    const a = w.active!;
    expect(a.y).toBeGreaterThan(h.y + 50);
    expect(Math.abs(a.x - h.x)).toBeLessThan(1e-6);
    expect(a.vy).toBeGreaterThan(0);
    expect(Math.hypot(a.vx, a.vy)).toBeLessThanOrEqual(speedForMass(a.mass) + 1e-9);
  });

  it('ignores a brief thumb flick right before SPLIT (smoothed aim)', () => {
    const { w } = emptyWorld(400);
    quietStep(w, 60, { x: 0, y: -1 }); // steering up for a second
    quietStep(w, 2, { x: 1, y: 0.3 }); // ~33 ms flick toward the SPLIT button as the thumb lifts
    const h = { x: w.active!.x, y: w.active!.y };
    w.trySplit(0, 0); // joystick released
    const a = w.active!;
    const ang = Math.atan2(a.y - h.y, a.x - h.x);
    expect(Math.abs(ang - -Math.PI / 2)).toBeLessThan(0.5); // still basically "up"
  });

  it('keeps both portions inside the arena when split at a wall', () => {
    const r = radiusForMass(400);
    const { w } = emptyWorld(400, CONFIG.WORLD_WIDTH - r, CONFIG.WORLD_HEIGHT - r);
    quietStep(w, 2, { x: 1, y: 1 });
    w.trySplit();
    const a = w.active!;
    const ra = radiusForMass(a.mass);
    expect(a.x).toBeLessThanOrEqual(CONFIG.WORLD_WIDTH - ra + 1e-6);
    expect(a.y).toBeLessThanOrEqual(CONFIG.WORLD_HEIGHT - ra + 1e-6);
    const gap = Math.hypot(a.x - w.home!.x, a.y - w.home!.y) - ra - radiusForMass(w.home!.mass);
    expect(gap).toBeGreaterThan(0);
  });

  it('cannot split again while separated', () => {
    const { w } = emptyWorld(1000);
    expect(w.trySplit()).toBe(true);
    expect(w.active!.mass).toBe(400); // still above minimum
    expect(w.canSplit()).toBe(false);
    expect(w.trySplit()).toBe(false);
    expect(w.slimes.filter((s) => s.alive).length).toBe(2);
  });

  it('stationary portion never moves, even when bumped', () => {
    const { w } = emptyWorld(300);
    w.trySplit();
    const home = w.home!;
    const hx = home.x;
    const hy = home.y;
    const e = enemy(w, hx - radiusForMass(180) - 10, hy, 170); // similar size, overlapping → bump
    quietStep(w, 120, { x: 0, y: -1 });
    expect(e.alive).toBe(true);
    expect(w.isSplit).toBe(true);
    expect(e.x).toBeLessThan(hx - radiusForMass(180) - 10); // the enemy got pushed, not the home
    expect(home.x).toBe(hx);
    expect(home.y).toBe(hy);
  });

  it('controlled portion uses the normal size-based speed (no bonus)', () => {
    const { w } = emptyWorld(500);
    w.trySplit();
    quietStep(w, 120, { x: 1, y: 0 });
    const a = w.active!;
    expect(Math.hypot(a.vx, a.vy)).toBeCloseTo(speedForMass(a.mass), 3);
    // and right after splitting there is no burst above the normal speed
    const { w: w2 } = emptyWorld(500);
    quietStep(w2, 120, { x: 1, y: 0 });
    w2.trySplit();
    for (let i = 0; i < 30; i++) {
      quietStep(w2, 1, { x: 1, y: 0 });
      const b = w2.active!;
      expect(Math.hypot(b.vx, b.vy)).toBeLessThanOrEqual(speedForMass(b.mass) + 1e-9);
    }
  });

  it('both portions can eat and grow independently', () => {
    const { w } = emptyWorld(500);
    w.trySplit();
    const home = w.home!;
    const act = w.active!;
    enemy(w, home.x, home.y, 50);
    enemy(w, act.x, act.y, 40);
    quietStep(w, 1);
    expect(home.mass).toBe(350);
    expect(act.mass).toBe(240);
    expect(w.stats.score).toBe(90);
  });

  it('prevents immediate accidental recombination', () => {
    const { w } = emptyWorld(500);
    w.trySplit();
    // push straight back toward home on the very first frames
    quietStep(w, 10, { x: -1, y: 0 });
    expect(w.isSplit).toBe(true);
  });

  it('recombines on touch with exact mass addition', () => {
    const { w } = emptyWorld(500);
    w.trySplit();
    quietStep(w, 60, { x: 1, y: 0 }); // move away (clears latch)
    expect(w.latch).toBe(false);
    w.active!.mass = 450; // grew while hunting
    const id = w.activeId;
    let steps = 0;
    while (w.isSplit && steps++ < 600) quietStep(w, 1, { x: -1, y: 0 });
    expect(w.isSplit).toBe(false);
    expect(w.activeId).toBe(id);
    expect(w.active!.mass).toBe(750);
    expect(w.slimes.filter((s) => s.alive).length).toBe(1);
    expect(w.canSplit()).toBe(true);
  });

  it('losing the controlled portion returns control to the stationary one', () => {
    const { w } = emptyWorld(500);
    w.trySplit();
    const homeId = w.homeId;
    const act = w.active!;
    enemy(w, act.x, act.y, 300);
    quietStep(w, 1);
    expect(w.gameOver).toBe(false);
    expect(w.isSplit).toBe(false);
    expect(w.activeId).toBe(homeId);
    expect(w.active!.kind).toBe('player');
    expect(w.active!.mass).toBe(300); // lost 40% not restored
    expect(w.canSplit()).toBe(true);
    // the old home can move now
    const x0 = w.active!.x;
    quietStep(w, 30, { x: -1, y: 0 });
    expect(w.active!.x).toBeLessThan(x0);
  });

  it('losing the stationary portion keeps control of the mobile one without teleporting', () => {
    const { w } = emptyWorld(500);
    w.trySplit();
    const actId = w.activeId;
    const home = w.home!;
    const ax = w.active!.x;
    const ay = w.active!.y;
    enemy(w, home.x, home.y, 400);
    quietStep(w, 1);
    expect(w.gameOver).toBe(false);
    expect(w.isSplit).toBe(false);
    expect(w.activeId).toBe(actId);
    // only its own one-step movement, no teleport
    expect(Math.hypot(w.active!.x - ax, w.active!.y - ay)).toBeLessThan(speedForMass(200) * CONFIG.SIM_DT + 0.5);
    expect(w.active!.mass).toBe(200);
    expect(w.canSplit()).toBe(true);
  });

  it('losing both portions in the same update ends the run', () => {
    const { w } = emptyWorld(500);
    w.trySplit();
    const home = w.home!;
    const act = w.active!;
    enemy(w, home.x, home.y, 400);
    enemy(w, act.x, act.y, 300);
    quietStep(w, 1);
    expect(w.gameOver).toBe(true);
    expect(w.events.some((e) => e.type === 'gameover')).toBe(true);
  });

  it('a single predator touching both portions resolves deterministically', () => {
    const results = new Set<string>();
    for (let k = 0; k < 3; k++) {
      const { w } = emptyWorld(500);
      w.trySplit();
      const home = w.home!;
      const act = w.active!;
      const pred = enemy(w, (home.x + act.x) / 2, home.y, 5000);
      quietStep(w, 1);
      results.add(`${w.gameOver}:${pred.mass}`);
      expect(pred.mass).toBe(5500); // both eaten, each exactly once
      expect(w.gameOver).toBe(true);
    }
    expect(results.size).toBe(1);
  });

  it('does not end the run when one portion survives', () => {
    const { w } = emptyWorld(500);
    w.trySplit();
    const act = w.active!;
    enemy(w, act.x, act.y, 1000);
    quietStep(w, 1);
    expect(w.gameOver).toBe(false);
  });
});

describe('scoring', () => {
  it('counts food and creatures, never subtracts on loss', () => {
    const { w } = emptyWorld(500);
    const f = w.spawnFood(1500, 1500);
    quietStep(w, 1);
    expect(f.alive).toBe(false);
    expect(w.stats.score).toBeCloseTo(f.mass);
    w.trySplit();
    const act = w.active!;
    enemy(w, act.x, act.y, 1000);
    const before = w.stats.score;
    quietStep(w, 1);
    expect(w.stats.score).toBe(before);
  });

  it('tracks best mass across both portions', () => {
    const { w } = emptyWorld(500);
    w.trySplit();
    const home = w.home!;
    enemy(w, home.x, home.y, 100);
    quietStep(w, 1);
    expect(w.stats.bestMass).toBe(600);
  });
});

describe('difficulty', () => {
  it('rises gradually with no hard wall', () => {
    let prev = -1;
    for (let t = 0; t < 3600; t += 15) {
      const p = pressureAt(t);
      expect(p.level).toBeGreaterThanOrEqual(prev);
      expect(p.level).toBeLessThan(2.7);
      expect(p.enemyTarget).toBeLessThanOrEqual(CONFIG.ENEMY_HARD_CAP);
      prev = p.level;
    }
    expect(pressureAt(10).phase).toBe('feeding');
    expect(pressureAt(60).phase).toBe('hunting');
    expect(pressureAt(100).phase).toBe('survival');
    expect(pressureAt(200).phase).toBe('endless');
  });
});

describe('save / restore', () => {
  it('round-trips an active split run exactly', () => {
    const w = new World(77);
    for (let i = 0; i < 300; i++) w.step(CONFIG.SIM_DT, { x: 1, y: 0.3 });
    w.active!.mass = 640.125;
    w.trySplit();
    for (let i = 0; i < 30; i++) w.step(CONFIG.SIM_DT, { x: 0, y: 1 });
    const snap = JSON.parse(JSON.stringify(serializeWorld(w, { x: 1, y: 2, zoom: 1 })));
    const r = deserializeWorld(snap);
    expect(r.isSplit).toBe(w.isSplit);
    expect(r.activeId).toBe(w.activeId);
    expect(r.homeId).toBe(w.homeId);
    expect(r.active!.mass).toBe(w.active!.mass);
    expect(r.home!.mass).toBe(w.home!.mass);
    expect(r.totalPlayerMass()).toBe(w.totalPlayerMass());
    expect(r.stats).toEqual(w.stats);
    expect(r.enemyCount()).toBe(w.enemyCount());
    expect(r.foodCount()).toBe(w.foodCount());
    expect(r.rng.state).toBe(w.rng.state);
    // and it keeps simulating sanely
    for (let i = 0; i < 600; i++) r.step(CONFIG.SIM_DT, { x: -1, y: 0 });
    expect(Number.isFinite(r.active?.x ?? 0)).toBe(true);
  });

  it('rejects corrupt or outdated saves', () => {
    expect(() => deserializeWorld(null)).toThrow();
    expect(() => deserializeWorld({ v: 999 })).toThrow();
    const w = new World(5);
    const s = serializeWorld(w);
    expect(() => deserializeWorld({ ...s, activeId: -50 })).toThrow();
    expect(() => deserializeWorld({ ...s, slimes: [[1, 0, 'x']] })).toThrow();
  });
});

describe('long-run stability', () => {
  it('simulates 10 minutes with a wandering bot without NaN or runaway counts', () => {
    const w = new World(99);
    let t = 0;
    for (let i = 0; i < 60 * 600 && !w.gameOver; i++) {
      t += CONFIG.SIM_DT;
      w.step(CONFIG.SIM_DT, { x: Math.cos(t * 0.3), y: Math.sin(t * 0.21) });
      if (i % 600 === 0 && w.canSplit()) w.trySplit();
      if (i % 60 === 0) {
        for (const s of w.slimes) {
          expect(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.mass)).toBe(true);
        }
        expect(w.enemyCount()).toBeLessThanOrEqual(CONFIG.ENEMY_HARD_CAP);
        expect(w.foodCount()).toBeGreaterThan(CONFIG.FOOD_TARGET * 0.5);
      }
    }
  });
});
