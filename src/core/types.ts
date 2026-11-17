export type SlimeKind = 'player' | 'home' | 'enemy';
export type AiMode = 'wander' | 'hunt' | 'flee' | 'forage';

export interface Slime {
  id: number;
  kind: SlimeKind;
  x: number;
  y: number;
  /** Previous-step position, for render interpolation. */
  px: number;
  py: number;
  vx: number;
  vy: number;
  mass: number;
  alive: boolean;
  /** Visual variant index (enemy colour / face). */
  variant: number;
  // AI
  mode: AiMode;
  heading: number;
  desired: number;
  think: number;
  targetId: number;
  targetIsFood: boolean;
  /** Per-enemy speed jitter so packs don't move in lockstep. */
  speedJitter: number;
}

export interface Food {
  id: number;
  x: number;
  y: number;
  mass: number;
  big: boolean;
  alive: boolean;
  variant: number;
}

export interface Decor {
  x: number;
  y: number;
  type: number;
  scale: number;
  rot: number;
}

export interface InputState {
  /** Normalized movement vector (length 0..1). */
  x: number;
  y: number;
}

export type GameEvent =
  | { type: 'food'; eaterId: number; foodId: number; x: number; y: number; byPlayer: boolean; big: boolean }
  | { type: 'eat'; eaterId: number; preyId: number; preyKind: SlimeKind; x: number; y: number; mass: number; byPlayer: boolean }
  | { type: 'split'; homeId: number; activeId: number }
  | { type: 'recombine'; survivorId: number; mergedId: number; x: number; y: number }
  | { type: 'portionLost'; which: 'active' | 'home'; lostId: number; survivorId: number }
  | { type: 'gameover' }
  | { type: 'spawn'; id: number }
  | { type: 'expand'; shiftY: number; width: number; height: number; expansions: number };

export interface RunStats {
  score: number;
  time: number;
  bestMass: number;
  /** Total player mass at the moment the run ended (the run's score). */
  finalMass: number;
  creaturesEaten: number;
  pelletsEaten: number;
  splits: number;
}
