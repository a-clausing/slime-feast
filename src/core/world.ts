import { CONFIG } from '../config';
import { modeSpeed, thinkEnemy, wrapAngle } from './ai';
import { pressureAt, type Pressure } from './difficulty';
import { canConsume, overlapEnoughToEat, radiusForMass, speedForMass } from './mass';
import { Rng } from './rng';
import { Grid } from './spatial';
import type { Food, GameEvent, InputState, RunStats, Slime, SlimeKind } from './types';

export const ENEMY_VARIANTS = 6;

/** Estimated half-diagonal of the visible area for a given player radius (spawn fairness). */
export function viewReach(radius: number): number {
  const span = Math.min(CONFIG.VIEW_SPAN_MAX, CONFIG.VIEW_SPAN_MIN + radius * CONFIG.VIEW_SPAN_PER_RADIUS);
  // portrait phones are ~2.2:1, so the far corner is ~1.2x the narrow span away
  return span * 1.2;
}

/**
 * The whole deterministic game simulation. No rendering, no DOM — fully unit-testable.
 * The renderer reads `slimes`, `food` and drains `events` after each step.
 */
export class World {
  rng: Rng;
  seed: number;
  slimes: Slime[] = [];
  food: Food[] = [];
  foodGrid = new Grid(CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT, 120);
  events: GameEvent[] = [];
  nextId = 1;

  /** Id of the slime currently under player control. */
  activeId = -1;
  /** Id of the stationary 60% portion while split, else -1. */
  homeId = -1;
  /** Separation latch: true right after a split until the portions have moved apart. */
  latch = false;
  latchTime = 0;
  lastDirX = 1;
  lastDirY = 0;

  stats: RunStats = { score: 0, time: 0, bestMass: 0, creaturesEaten: 0, pelletsEaten: 0, splits: 0 };
  gameOver = false;
  /** High score at the moment this run started (for the "new high score" badge). */
  startHigh = 0;
  /** Menu background mode: no player, never ends. */
  attract = false;
  pressure: Pressure = pressureAt(0);
  foodAccumulator = 0;
  spawnTimer = 0;
  recycleTimer = 0;

  constructor(seed = (Date.now() ^ 0x9e3779b9) >>> 0, populate = true) {
    this.seed = seed;
    this.rng = new Rng(seed);
    if (populate) this.populate();
  }

  // ───────────────────────────── setup ─────────────────────────────

  private populate(): void {
    const cx = CONFIG.WORLD_WIDTH / 2;
    const cy = CONFIG.WORLD_HEIGHT / 2;
    const p = this.addSlime('player', cx, cy, CONFIG.STARTING_MASS);
    this.activeId = p.id;
    this.stats.bestMass = p.mass;

    for (let i = 0; i < CONFIG.FOOD_TARGET; i++) this.spawnFood();
    for (let i = 0; i < CONFIG.FOOD_START_CLUSTER; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(60, 520);
      this.spawnFood(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
    }

    // Starting creatures: a ring of weak prey nearby, real predators far away.
    const R = CONFIG.STARTING_MASS;
    for (let i = 0; i < CONFIG.ENEMY_COUNT_START; i++) {
      const tier = i < 12 ? 0 : i < 17 ? 1 : 2;
      let mass: number;
      let minD: number;
      let maxD: number;
      if (tier === 0) {
        mass = this.rng.range(CONFIG.ENEMY_MIN_MASS, R * 0.75);
        minD = 260;
        maxD = 950;
      } else if (tier === 1) {
        mass = this.rng.range(R * 0.85, R * 1.6);
        minD = 600;
        maxD = 1300;
      } else {
        mass = this.rng.range(R * 2.5, R * 6);
        minD = CONFIG.ENEMY_START_PREDATOR_DIST;
        maxD = 2000;
      }
      for (let tries = 0; tries < 30; tries++) {
        const a = this.rng.range(0, Math.PI * 2);
        const d = this.rng.range(minD, maxD);
        const x = cx + Math.cos(a) * d;
        const y = cy + Math.sin(a) * d;
        const r = radiusForMass(mass);
        if (x < r + 40 || y < r + 40 || x > CONFIG.WORLD_WIDTH - r - 40 || y > CONFIG.WORLD_HEIGHT - r - 40) continue;
        this.addSlime('enemy', x, y, mass);
        break;
      }
    }
  }

  addSlime(kind: SlimeKind, x: number, y: number, mass: number): Slime {
    const s: Slime = {
      id: this.nextId++,
      kind,
      x,
      y,
      px: x,
      py: y,
      vx: 0,
      vy: 0,
      mass,
      alive: true,
      variant: kind === 'enemy' ? this.rng.int(0, ENEMY_VARIANTS - 1) : 0,
      mode: 'wander',
      heading: this.rng.range(-Math.PI, Math.PI),
      desired: 0,
      think: this.rng.range(0, CONFIG.AI_THINK_MAX),
      targetId: -1,
      targetIsFood: false,
      speedJitter: kind === 'enemy' ? this.rng.range(0.94, 1.04) : 1,
    };
    s.desired = s.heading;
    this.slimes.push(s);
    if (kind === 'enemy') this.events.push({ type: 'spawn', id: s.id });
    return s;
  }

  spawnFood(x?: number, y?: number): Food {
    const big = this.rng.next() < CONFIG.FOOD_BIG_CHANCE;
    const m = 30;
    const f: Food = {
      id: this.nextId++,
      x: Math.min(CONFIG.WORLD_WIDTH - m, Math.max(m, x ?? this.rng.range(m, CONFIG.WORLD_WIDTH - m))),
      y: Math.min(CONFIG.WORLD_HEIGHT - m, Math.max(m, y ?? this.rng.range(m, CONFIG.WORLD_HEIGHT - m))),
      mass: big ? CONFIG.FOOD_BIG_MASS : CONFIG.FOOD_MASS,
      big,
      alive: true,
      variant: this.rng.int(0, 3),
    };
    // reuse a dead slot to keep the array (and renderer pool) bounded
    let idx = this.food.findIndex((ff) => !ff.alive);
    if (idx < 0) {
      idx = this.food.length;
      this.food.push(f);
    } else {
      this.food[idx] = f;
    }
    this.foodGrid.add(idx, f.x, f.y);
    return f;
  }

  // ───────────────────────────── queries ─────────────────────────────

  get active(): Slime | undefined {
    return this.slimes.find((s) => s.id === this.activeId && s.alive);
  }
  get home(): Slime | undefined {
    return this.homeId < 0 ? undefined : this.slimes.find((s) => s.id === this.homeId && s.alive);
  }
  get isSplit(): boolean {
    return this.homeId >= 0;
  }
  byId(id: number): Slime | undefined {
    return this.slimes.find((s) => s.id === id);
  }
  /** Sum of all surviving player portions. */
  totalPlayerMass(): number {
    let m = 0;
    for (const s of this.slimes) if (s.alive && (s.kind === 'player' || s.kind === 'home')) m += s.mass;
    return m;
  }
  canSplit(): boolean {
    const a = this.active;
    return !this.gameOver && !this.isSplit && !!a && a.mass >= CONFIG.MIN_SPLIT_MASS;
  }
  foodCount(): number {
    let n = 0;
    for (const f of this.food) if (f.alive) n++;
    return n;
  }
  enemyCount(): number {
    let n = 0;
    for (const s of this.slimes) if (s.alive && s.kind === 'enemy') n++;
    return n;
  }

  // ───────────────────────────── split / merge ─────────────────────────────

  /**
   * SLIME SPLIT. 60% stays put as a stationary "home" portion at the exact original
   * position; 40% becomes the controlled portion, placed just beyond the home in the
   * last movement direction. Total mass is preserved exactly. No speed bonus.
   */
  trySplit(): boolean {
    if (!this.canSplit()) return false;
    const a = this.active!;
    const total = a.mass;
    const homeMass = total * CONFIG.SPLIT_STATIONARY_RATIO;
    const activeMass = total - homeMass; // exact complement: no mass created or lost
    const rHome = radiusForMass(homeMass);
    const rAct = radiusForMass(activeMass);
    const sep = rHome + rAct + CONFIG.SPLIT_GAP;

    let dx = this.lastDirX;
    let dy = this.lastDirY;
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) {
      dx = 1;
      dy = 0;
    } else {
      dx /= l;
      dy /= l;
    }
    // Find a direction that keeps the mobile portion inside the arena (rotate if needed).
    const base = Math.atan2(dy, dx);
    let ax = a.x + dx * sep;
    let ay = a.y + dy * sep;
    const fits = (x: number, y: number) =>
      x >= rAct && y >= rAct && x <= CONFIG.WORLD_WIDTH - rAct && y <= CONFIG.WORLD_HEIGHT - rAct;
    if (!fits(ax, ay)) {
      let placed = false;
      for (let k = 1; k <= 8 && !placed; k++) {
        for (const sgn of [1, -1]) {
          const ang = base + sgn * k * (Math.PI / 8);
          const tx = a.x + Math.cos(ang) * sep;
          const ty = a.y + Math.sin(ang) * sep;
          if (fits(tx, ty)) {
            ax = tx;
            ay = ty;
            placed = true;
            break;
          }
        }
      }
      if (!placed) {
        ax = Math.min(CONFIG.WORLD_WIDTH - rAct, Math.max(rAct, ax));
        ay = Math.min(CONFIG.WORLD_HEIGHT - rAct, Math.max(rAct, ay));
      }
    }

    // The original slime entity becomes the stationary home portion (keeps its exact position).
    a.kind = 'home';
    a.mass = homeMass;
    const vx = a.vx;
    const vy = a.vy;
    a.vx = 0;
    a.vy = 0;
    const mobile = this.addSlime('player', ax, ay, activeMass);
    mobile.px = a.x; // render interpolation: visually emerge from the original body
    mobile.py = a.y;
    mobile.vx = vx; // momentum continuity only — no dash, no burst
    mobile.vy = vy;

    this.homeId = a.id;
    this.activeId = mobile.id;
    this.latch = true;
    this.latchTime = 0;
    this.stats.splits++;
    this.events.push({ type: 'split', homeId: a.id, activeId: mobile.id });
    return true;
  }

  private recombine(active: Slime, home: Slime): void {
    const total = active.mass + home.mass;
    // Merge at the mass-weighted centre (they are touching, so the shift is small).
    active.x = (active.x * active.mass + home.x * home.mass) / total;
    active.y = (active.y * active.mass + home.y * home.mass) / total;
    active.mass = total;
    this.clampToWorld(active);
    home.alive = false;
    this.homeId = -1;
    this.latch = false;
    this.events.push({ type: 'recombine', survivorId: active.id, mergedId: home.id, x: active.x, y: active.y });
  }

  // ───────────────────────────── main step ─────────────────────────────

  step(dt: number, input: InputState): void {
    if (this.gameOver) return;
    this.stats.time += dt;
    this.pressure = pressureAt(this.stats.time);

    for (const s of this.slimes) {
      s.px = s.x;
      s.py = s.y;
    }

    this.moveSlimes(dt, input);
    this.eatFood();
    this.resolveSlimeContacts();
    if (!this.attract) this.updatePlayerState();
    if (this.gameOver) return;
    this.maintainPopulation(dt);
    this.compact();

    const total = this.totalPlayerMass();
    if (total > this.stats.bestMass) this.stats.bestMass = total;
  }

  private clampToWorld(s: Slime): void {
    const r = radiusForMass(s.mass);
    const W = CONFIG.WORLD_WIDTH;
    const H = CONFIG.WORLD_HEIGHT;
    if (2 * r >= W) s.x = W / 2;
    else if (s.x < r) {
      s.x = r;
      if (s.vx < 0) s.vx = 0;
    } else if (s.x > W - r) {
      s.x = W - r;
      if (s.vx > 0) s.vx = 0;
    }
    if (2 * r >= H) s.y = H / 2;
    else if (s.y < r) {
      s.y = r;
      if (s.vy < 0) s.vy = 0;
    } else if (s.y > H - r) {
      s.y = H - r;
      if (s.vy > 0) s.vy = 0;
    }
  }

  private moveSlimes(dt: number, input: InputState): void {
    const il = Math.hypot(input.x, input.y);
    if (il > 0.01) {
      this.lastDirX = input.x / il;
      this.lastDirY = input.y / il;
    }
    const k = 1 - Math.exp(-CONFIG.ACCEL_RESPONSE * dt);
    const ke = 1 - Math.exp(-CONFIG.ACCEL_RESPONSE * 0.6 * dt);
    const turn = CONFIG.AI_TURN_RATE * dt;
    const n = this.slimes.length;
    for (let i = 0; i < n; i++) {
      const s = this.slimes[i];
      if (!s.alive) continue;
      if (s.kind === 'home') {
        // The stationary portion never moves.
        s.vx = 0;
        s.vy = 0;
        continue;
      }
      if (s.kind === 'player') {
        const sp = speedForMass(s.mass) * Math.min(1, il);
        const tx = il > 0.01 ? (input.x / il) * sp : 0;
        const ty = il > 0.01 ? (input.y / il) * sp : 0;
        s.vx += (tx - s.vx) * k;
        s.vy += (ty - s.vy) * k;
      } else {
        s.think -= dt;
        if (s.think <= 0) thinkEnemy(this, s);
        const diff = wrapAngle(s.desired - s.heading);
        s.heading = wrapAngle(s.heading + Math.max(-turn, Math.min(turn, diff)));
        const sp = speedForMass(s.mass) * this.pressure.enemySpeedFactor * s.speedJitter * modeSpeed(s.mode);
        s.vx += (Math.cos(s.heading) * sp - s.vx) * ke;
        s.vy += (Math.sin(s.heading) * sp - s.vy) * ke;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      this.clampToWorld(s);
    }
  }

  private eatFood(): void {
    for (const s of this.slimes) {
      if (!s.alive) continue;
      const r = radiusForMass(s.mass);
      const byPlayer = s.kind !== 'enemy';
      this.foodGrid.query(s.x, s.y, r + CONFIG.FOOD_BIG_RADIUS, (idx) => {
        const f = this.food[idx];
        if (!f.alive) return;
        const fr = f.big ? CONFIG.FOOD_BIG_RADIUS : CONFIG.FOOD_RADIUS;
        const dx = f.x - s.x;
        const dy = f.y - s.y;
        if (dx * dx + dy * dy <= (r + fr * 0.4) ** 2) {
          f.alive = false;
          this.foodGrid.remove(idx, f.x, f.y);
          s.mass += f.mass;
          if (byPlayer) {
            this.stats.score += f.mass;
            this.stats.pelletsEaten++;
          }
          this.events.push({ type: 'food', eaterId: s.id, foodId: f.id, x: f.x, y: f.y, byPlayer, big: f.big });
        }
      });
    }
  }

  /** Transfers prey mass exactly once; prey is marked dead immediately so it can't be eaten twice. */
  private consume(pred: Slime, prey: Slime): void {
    if (!pred.alive || !prey.alive) return;
    prey.alive = false;
    pred.mass += prey.mass;
    const byPlayer = pred.kind !== 'enemy';
    if (byPlayer) {
      this.stats.score += prey.mass;
      this.stats.creaturesEaten++;
    }
    this.events.push({
      type: 'eat',
      eaterId: pred.id,
      preyId: prey.id,
      preyKind: prey.kind,
      x: prey.x,
      y: prey.y,
      mass: prey.mass,
      byPlayer,
    });
  }

  /**
   * Deterministic pairwise pass in array order. Handles, per pair:
   *  - player portion vs its home portion → recombination (after the latch clears)
   *  - one can eat the other (≥1.20x) and overlap is meaningful → consume
   *  - neither can eat → bump apart (home portion is immovable)
   */
  private resolveSlimeContacts(): void {
    const list = this.slimes;
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < n; j++) {
        const b = list[j];
        if (!b.alive || !a.alive) continue;
        const ra = radiusForMass(a.mass);
        const rb = radiusForMass(b.mass);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const reach = ra + rb;
        if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > reach * reach) continue;
        const dist = Math.sqrt(d2);

        const aPlayer = a.kind !== 'enemy';
        const bPlayer = b.kind !== 'enemy';
        if (aPlayer && bPlayer) {
          const act = a.kind === 'player' ? a : b;
          const home = a.kind === 'home' ? a : b;
          if (!this.latch && this.homeId === home.id && this.activeId === act.id) {
            this.recombine(act, home);
          } else {
            this.bump(a, b, dist, dx, dy, reach);
          }
          continue;
        }

        if (canConsume(a.mass, b.mass)) {
          if (overlapEnoughToEat(dist, ra, rb)) this.consume(a, b);
        } else if (canConsume(b.mass, a.mass)) {
          if (overlapEnoughToEat(dist, rb, ra)) this.consume(b, a);
        } else {
          this.bump(a, b, dist, dx, dy, reach);
        }
      }
    }

    // separation latch bookkeeping
    if (this.latch) {
      const act = this.active;
      const home = this.home;
      this.latchTime += CONFIG.SIM_DT;
      if (!act || !home) this.latch = false;
      else {
        const gap = Math.hypot(act.x - home.x, act.y - home.y) - radiusForMass(act.mass) - radiusForMass(home.mass);
        if (gap > CONFIG.RECOMBINE_LATCH_CLEAR || (this.latchTime > CONFIG.RECOMBINE_LATCH_MAX_TIME && gap > 0)) {
          this.latch = false;
        }
      }
    }
  }

  private bump(a: Slime, b: Slime, dist: number, dx: number, dy: number, reach: number): void {
    const overlap = reach - dist;
    if (overlap <= 0) return;
    let nx: number;
    let ny: number;
    if (dist < 1e-6) {
      nx = 1;
      ny = 0;
    } else {
      nx = dx / dist;
      ny = dy / dist;
    }
    const push = overlap * CONFIG.BUMP_STRENGTH;
    let wa: number;
    let wb: number;
    if (a.kind === 'home') {
      wa = 0;
      wb = 1;
    } else if (b.kind === 'home') {
      wa = 1;
      wb = 0;
    } else {
      const tot = a.mass + b.mass;
      wa = b.mass / tot;
      wb = a.mass / tot;
    }
    a.x -= nx * push * wa;
    a.y -= ny * push * wa;
    b.x += nx * push * wb;
    b.y += ny * push * wb;
    this.clampToWorld(a);
    this.clampToWorld(b);
  }

  /** Handles portion loss / control transfer / game over after all contacts resolved. */
  private updatePlayerState(): void {
    const act = this.slimes.find((s) => s.id === this.activeId);
    const home = this.homeId >= 0 ? this.slimes.find((s) => s.id === this.homeId) : undefined;
    const actAlive = !!act && act.alive;
    const homeAlive = !!home && home.alive;

    if (this.homeId >= 0) {
      if (!actAlive && homeAlive) {
        // Mobile 40% eaten → control returns to the stationary portion.
        home!.kind = 'player';
        const lostId = this.activeId;
        this.activeId = home!.id;
        this.homeId = -1;
        this.latch = false;
        this.events.push({ type: 'portionLost', which: 'active', lostId, survivorId: home!.id });
      } else if (actAlive && !homeAlive) {
        // Stationary 60% eaten → keep controlling the mobile portion where it is.
        const lostId = this.homeId;
        this.homeId = -1;
        this.latch = false;
        this.events.push({ type: 'portionLost', which: 'home', lostId, survivorId: act!.id });
      } else if (!actAlive && !homeAlive) {
        this.endRun();
      }
    } else if (!actAlive) {
      this.endRun();
    }
  }

  private endRun(): void {
    this.gameOver = true;
    this.homeId = -1;
    this.events.push({ type: 'gameover' });
  }

  // ───────────────────────────── spawning ─────────────────────────────

  private playerPortions(): Slime[] {
    return this.slimes.filter((s) => s.alive && s.kind !== 'enemy');
  }

  /** Picks an enemy mass relative to the player's current size and difficulty. */
  sampleEnemyMass(): number {
    const ref = Math.max(CONFIG.STARTING_MASS, this.active?.mass ?? CONFIG.STARTING_MASS);
    const [w0, w1] = this.pressure.tierWeights;
    const roll = this.rng.next();
    let m: number;
    if (roll < w0) m = this.rng.range(0.2, 0.72) * ref;
    else if (roll < w0 + w1) m = this.rng.range(0.78, 1.15) * ref;
    else m = this.rng.range(1.3, 2.2 * this.pressure.predatorScale) * ref;
    return Math.max(CONFIG.ENEMY_MIN_MASS, m);
  }

  /** Spawns an enemy off-screen, away from every player portion. Returns null if no spot found. */
  spawnEnemy(mass = this.sampleEnemyMass()): Slime | null {
    const portions = this.playerPortions();
    const r = radiusForMass(mass);
    for (let tries = 0; tries < 24; tries++) {
      const x = this.rng.range(r + 40, CONFIG.WORLD_WIDTH - r - 40);
      const y = this.rng.range(r + 40, CONFIG.WORLD_HEIGHT - r - 40);
      let ok = true;
      for (const p of portions) {
        const pr = radiusForMass(p.mass);
        let clear = viewReach(pr) + r + 80;
        // big predators get extra clearance so they never appear without warning
        if (canConsume(mass, p.mass)) clear += 220;
        if ((p.x - x) ** 2 + (p.y - y) ** 2 < clear * clear) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      for (const s of this.slimes) {
        if (!s.alive) continue;
        const rr = radiusForMass(s.mass) + r + 10;
        if ((s.x - x) ** 2 + (s.y - y) ** 2 < rr * rr) {
          ok = false;
          break;
        }
      }
      if (ok) return this.addSlime('enemy', x, y, mass);
    }
    return null;
  }

  private maintainPopulation(dt: number): void {
    // Food: steady respawn up to target.
    const missing = CONFIG.FOOD_TARGET - this.foodCount();
    if (missing > 0) {
      this.foodAccumulator += CONFIG.FOOD_RESPAWN_RATE * dt;
      while (this.foodAccumulator >= 1 && this.foodCount() < CONFIG.FOOD_TARGET) {
        this.foodAccumulator -= 1;
        this.spawnFood();
      }
    } else {
      this.foodAccumulator = 0;
    }

    // Enemies: top up toward the difficulty target, one at a time.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.enemyCount() < this.pressure.enemyTarget) {
      this.spawnEnemy();
      this.spawnTimer = 0.45;
    }

    // Recycle far-away enemies that no longer fit the player's scale (too tiny or absurdly huge),
    // never ones that are interacting with the player.
    this.recycleTimer -= dt;
    if (this.recycleTimer <= 0) {
      this.recycleTimer = CONFIG.ENEMY_RECYCLE_INTERVAL;
      const ref = this.totalPlayerMass();
      const portions = this.playerPortions();
      for (const e of this.slimes) {
        if (!e.alive || e.kind !== 'enemy') continue;
        if (e.mode === 'hunt' && portions.some((p) => p.id === e.targetId)) continue;
        const far = portions.every(
          (p) => Math.hypot(p.x - e.x, p.y - e.y) > CONFIG.ENEMY_DESPAWN_DIST + radiusForMass(e.mass),
        );
        if (!far) continue;
        if (e.mass < ref * 0.08 || e.mass > ref * 5) {
          e.alive = false; // silent removal (off-screen)
          this.spawnEnemy();
          break;
        }
      }
    }
  }

  /** Remove dead slimes from the array (keeps iteration cheap). */
  private compact(): void {
    if (this.slimes.some((s) => !s.alive)) this.slimes = this.slimes.filter((s) => s.alive);
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
