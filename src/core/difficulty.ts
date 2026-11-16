import { CONFIG } from '../config';

export type Phase = 'feeding' | 'hunting' | 'survival' | 'endless';

export interface Pressure {
  phase: Phase;
  /** 0 at start, ~1 at PHASE_ENDLESS, keeps rising slowly (asymptotic toward ~1.9). */
  level: number;
  enemyTarget: number;
  /** Spawn weights for [prey, peer, predator] tiers. */
  tierWeights: [number, number, number];
  /** Multiplier on predator spawn mass range. */
  predatorScale: number;
  enemySpeedFactor: number;
  detectMult: number;
  /** Probability that a hunting enemy considers player portions over other prey. */
  playerFocus: number;
}

export function phaseFor(t: number): Phase {
  if (t < CONFIG.PHASE_HUNT) return 'feeding';
  if (t < CONFIG.PHASE_SURVIVAL) return 'hunting';
  if (t < CONFIG.PHASE_ENDLESS) return 'survival';
  return 'endless';
}

/** Smooth, configurable difficulty curve. No hard cap, but never an impossible wall. */
export function pressureAt(t: number): Pressure {
  let level: number;
  if (t <= CONFIG.PHASE_ENDLESS) {
    level = t / CONFIG.PHASE_ENDLESS;
  } else {
    const extraMin = (t - CONFIG.PHASE_ENDLESS) / 60;
    // asymptotic ramp: approaches +0.9 over many minutes
    level = 1 + 0.9 * (1 - Math.exp(-extraMin * CONFIG.ENDLESS_RAMP_PER_MIN));
  }
  const phase = phaseFor(t);
  const lv = Math.min(level, 1);
  const enemyTarget = Math.round(
    CONFIG.ENEMY_COUNT_START + (CONFIG.ENEMY_COUNT_MAX - CONFIG.ENEMY_COUNT_START) * Math.min(1, level / 1.4),
  );
  const tierWeights: [number, number, number] =
    phase === 'feeding'
      ? [0.74, 0.2, 0.06]
      : phase === 'hunting'
        ? [0.56, 0.24, 0.2]
        : phase === 'survival'
          ? [0.46, 0.26, 0.28]
          : [0.4, 0.26, 0.34 + 0.08 * (level - 1)];
  return {
    phase,
    level,
    enemyTarget: Math.min(enemyTarget, CONFIG.ENEMY_HARD_CAP),
    tierWeights,
    predatorScale: 1 + 0.5 * lv + 0.3 * Math.max(0, level - 1),
    enemySpeedFactor:
      CONFIG.ENEMY_SPEED_FACTOR + (CONFIG.ENEMY_SPEED_FACTOR_MAX - CONFIG.ENEMY_SPEED_FACTOR) * Math.min(1, level / 1.5),
    detectMult: 0.85 + 0.3 * lv + 0.15 * Math.max(0, level - 1),
    playerFocus: 0.35 + 0.35 * lv + 0.15 * Math.max(0, level - 1),
  };
}
