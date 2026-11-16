import { CONFIG } from '../config';
import { Rng } from './rng';
import type { Food, RunStats, Slime } from './types';
import { World } from './world';

/** Versioned snapshot of an active run. */
export interface RunSave {
  v: number;
  savedAt: number;
  seed: number;
  rngState: number;
  nextId: number;
  activeId: number;
  homeId: number;
  latch: boolean;
  latchTime: number;
  lastDirX: number;
  lastDirY: number;
  stats: RunStats;
  spawnTimer: number;
  recycleTimer: number;
  foodAccumulator: number;
  startHigh?: number;
  /** Compact slime tuples. */
  slimes: SlimeTuple[];
  /** Compact food tuples (alive only). */
  food: FoodTuple[];
  camera?: { x: number; y: number; zoom: number };
}

type SlimeTuple = [
  id: number,
  kind: 0 | 1 | 2,
  x: number,
  y: number,
  vx: number,
  vy: number,
  mass: number,
  variant: number,
  heading: number,
  desired: number,
  speedJitter: number,
];
type FoodTuple = [id: number, x: number, y: number, mass: number, big: 0 | 1, variant: number];

const KINDS = ['player', 'home', 'enemy'] as const;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function serializeWorld(w: World, camera?: RunSave['camera']): RunSave {
  return {
    v: CONFIG.SAVE_VERSION,
    savedAt: Date.now(),
    seed: w.seed,
    rngState: w.rng.state,
    nextId: w.nextId,
    activeId: w.activeId,
    homeId: w.homeId,
    latch: w.latch,
    latchTime: w.latchTime,
    lastDirX: w.lastDirX,
    lastDirY: w.lastDirY,
    stats: { ...w.stats },
    spawnTimer: w.spawnTimer,
    recycleTimer: w.recycleTimer,
    foodAccumulator: w.foodAccumulator,
    startHigh: w.startHigh,
    // Masses are stored at full precision so split/merge totals stay exact.
    slimes: w.slimes
      .filter((s) => s.alive)
      .map((s) => [
        s.id,
        KINDS.indexOf(s.kind) as 0 | 1 | 2,
        r2(s.x),
        r2(s.y),
        r2(s.vx),
        r2(s.vy),
        s.mass,
        s.variant,
        r2(s.heading),
        r2(s.desired),
        r2(s.speedJitter),
      ]),
    food: w.food.filter((f) => f.alive).map((f) => [f.id, r2(f.x), r2(f.y), f.mass, f.big ? 1 : 0, f.variant]),
    camera,
  };
}

function isNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Rebuilds a World from a save. Throws on corrupt/incompatible data (caller discards it). */
export function deserializeWorld(data: unknown): World {
  const s = data as RunSave;
  if (!s || typeof s !== 'object') throw new Error('save: not an object');
  if (s.v !== CONFIG.SAVE_VERSION) throw new Error(`save: unsupported version ${String(s.v)}`);
  if (!Array.isArray(s.slimes) || !Array.isArray(s.food) || !s.stats) throw new Error('save: missing fields');
  for (const k of ['seed', 'rngState', 'nextId', 'activeId', 'homeId'] as const) {
    if (!isNum(s[k])) throw new Error(`save: bad ${k}`);
  }

  const w = new World(s.seed, false);
  w.rng = new Rng(s.rngState);
  w.nextId = s.nextId;
  w.activeId = s.activeId;
  w.homeId = s.homeId;
  w.latch = !!s.latch;
  w.latchTime = isNum(s.latchTime) ? s.latchTime : 0;
  w.lastDirX = isNum(s.lastDirX) ? s.lastDirX : 1;
  w.lastDirY = isNum(s.lastDirY) ? s.lastDirY : 0;
  w.stats = {
    score: Number(s.stats.score) || 0,
    time: Number(s.stats.time) || 0,
    bestMass: Number(s.stats.bestMass) || 0,
    creaturesEaten: Number(s.stats.creaturesEaten) || 0,
    pelletsEaten: Number(s.stats.pelletsEaten) || 0,
    splits: Number(s.stats.splits) || 0,
  };
  w.spawnTimer = isNum(s.spawnTimer) ? s.spawnTimer : 0;
  w.recycleTimer = isNum(s.recycleTimer) ? s.recycleTimer : 0;
  w.foodAccumulator = isNum(s.foodAccumulator) ? s.foodAccumulator : 0;
  w.startHigh = isNum(s.startHigh) ? s.startHigh : 0;

  for (const t of s.slimes) {
    if (!Array.isArray(t) || t.length < 11 || !t.every(isNum)) throw new Error('save: bad slime');
    const [id, kind, x, y, vx, vy, mass, variant, heading, desired, speedJitter] = t;
    const sl: Slime = {
      id,
      kind: KINDS[kind] ?? 'enemy',
      x,
      y,
      px: x,
      py: y,
      vx,
      vy,
      mass,
      alive: mass > 0,
      variant,
      mode: 'wander',
      heading,
      desired,
      think: 0,
      targetId: -1,
      targetIsFood: false,
      speedJitter,
    };
    w.slimes.push(sl);
  }
  for (const t of s.food) {
    if (!Array.isArray(t) || t.length < 6 || !t.every(isNum)) throw new Error('save: bad food');
    const [id, x, y, mass, big, variant] = t;
    const f: Food = { id, x, y, mass, big: big === 1, alive: true, variant };
    w.foodGrid.add(w.food.length, x, y);
    w.food.push(f);
  }

  // integrity checks: the controlled slime must exist; home must exist iff split
  const act = w.slimes.find((x) => x.id === w.activeId);
  if (!act || act.kind !== 'player') throw new Error('save: missing active slime');
  if (w.homeId >= 0) {
    const home = w.slimes.find((x) => x.id === w.homeId);
    if (!home || home.kind !== 'home') throw new Error('save: missing home portion');
  }
  return w;
}

// ─────────────────────────── localStorage wrappers ───────────────────────────

const RUN_KEY = 'slimeFeast.run.v1';
const META_KEY = 'slimeFeast.meta';

export interface MetaSave {
  highScore: number;
  bestMass: number;
  muted: boolean;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function saveRun(w: World, camera?: RunSave['camera']): void {
  const st = storage();
  if (!st) return;
  try {
    st.setItem(RUN_KEY, JSON.stringify(serializeWorld(w, camera)));
  } catch {
    /* quota or private mode — non-fatal */
  }
}

export function loadRun(): { world: World; camera?: RunSave['camera'] } | null {
  const st = storage();
  if (!st) return null;
  const raw = st.getItem(RUN_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as RunSave;
    const world = deserializeWorld(data);
    if (world.gameOver) return null;
    return { world, camera: data.camera };
  } catch (err) {
    console.warn('[slime-feast] discarding unreadable save:', err);
    clearRun();
    return null;
  }
}

export function clearRun(): void {
  try {
    storage()?.removeItem(RUN_KEY);
  } catch {
    /* ignore */
  }
}

export function loadMeta(): MetaSave {
  const def: MetaSave = { highScore: 0, bestMass: 0, muted: false };
  try {
    const raw = storage()?.getItem(META_KEY);
    if (!raw) return def;
    const m = JSON.parse(raw) as Partial<MetaSave>;
    return {
      highScore: Number(m.highScore) || 0,
      bestMass: Number(m.bestMass) || 0,
      muted: !!m.muted,
    };
  } catch {
    return def;
  }
}

export function saveMeta(m: MetaSave): void {
  try {
    storage()?.setItem(META_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}
