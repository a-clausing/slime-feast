import { CONFIG } from '../config';

/** Visual/physical radius from mass — grows with the square root of mass. */
export function radiusForMass(mass: number): number {
  return CONFIG.BASE_RADIUS * Math.sqrt(Math.max(mass, 0) / CONFIG.STARTING_MASS);
}

/** Shared size-based speed formula. Used by every slime, including split portions. */
export function speedForMass(mass: number): number {
  const s = CONFIG.SPEED_BASE * Math.pow(Math.max(mass, 1) / CONFIG.STARTING_MASS, -CONFIG.SPEED_EXPONENT);
  return Math.min(CONFIG.SPEED_MAX, Math.max(CONFIG.SPEED_MIN, s));
}

/**
 * Consumption rule: predatorMass >= preyMass * 1.20, with a tiny relative
 * tolerance so the exact threshold (e.g. 120 vs 100) is never lost to float error.
 */
export function canConsume(predatorMass: number, preyMass: number): boolean {
  if (predatorMass <= 0 || preyMass <= 0) return false;
  const needed = preyMass * CONFIG.CONSUME_RATIO;
  return predatorMass >= needed - needed * CONFIG.CONSUME_EPSILON;
}

/** True when the prey's body is meaningfully inside the predator (not a rim touch). */
export function overlapEnoughToEat(dist: number, predatorR: number, preyR: number): boolean {
  return dist <= predatorR - preyR * CONFIG.CONSUME_OVERLAP;
}
