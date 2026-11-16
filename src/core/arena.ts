import { CONFIG } from '../config';
import type { Decor } from './types';
import { Rng } from './rng';

/** Number of decoration types the renderer knows how to draw. */
export const DECOR_TYPES = 5;

/** Seeded, non-colliding decorative scatter (purely visual). */
export function generateDecor(seed: number): Decor[] {
  const rng = new Rng(seed ^ 0x5eed);
  const out: Decor[] = [];
  const W = CONFIG.WORLD_WIDTH;
  const H = CONFIG.WORLD_HEIGHT;
  let attempts = 0;
  while (out.length < CONFIG.DECOR_COUNT && attempts++ < CONFIG.DECOR_COUNT * 20) {
    const x = rng.range(60, W - 60);
    const y = rng.range(60, H - 60);
    if (out.some((d) => (d.x - x) ** 2 + (d.y - y) ** 2 < 180 * 180)) continue;
    out.push({ x, y, type: rng.int(0, DECOR_TYPES - 1), scale: rng.range(0.7, 1.25), rot: rng.range(-0.4, 0.4) });
  }
  return out;
}
