import { CONFIG } from '../config';
import type { Decor } from './types';
import { Rng } from './rng';

/** Number of decoration types the renderer knows how to draw. */
export const DECOR_TYPES = 5;

/** Seeded, non-overlapping decorative scatter inside a rectangle (purely visual). */
function scatter(seed: number, x0: number, y0: number, w: number, h: number, scale: number): Decor[] {
  const rng = new Rng(seed ^ 0x5eed);
  const out: Decor[] = [];
  const minD = 180 * scale;
  const m = 60 * scale;
  let attempts = 0;
  while (out.length < CONFIG.DECOR_COUNT && attempts++ < CONFIG.DECOR_COUNT * 20) {
    const x = x0 + rng.range(m, w - m);
    const y = y0 + rng.range(m, h - m);
    if (out.some((d) => (d.x - x) ** 2 + (d.y - y) ** 2 < minD * minD)) continue;
    out.push({ x, y, type: rng.int(0, DECOR_TYPES - 1), scale: rng.range(0.7, 1.25) * scale, rot: rng.range(-0.4, 0.4) });
  }
  return out;
}

/**
 * Decorations for an arena that has doubled `expansions` times. Deterministic: each expansion
 * shifts the existing layout down (it becomes the bottom-left square) and scatters new pieces
 * in the three new squares, so the original area never reshuffles.
 */
export function decorForWorld(seed: number, expansions: number): Decor[] {
  let w = CONFIG.WORLD_WIDTH;
  let h = CONFIG.WORLD_HEIGHT;
  let list = scatter(seed, 0, 0, w, h, 1);
  for (let k = 0; k < expansions; k++) {
    for (const d of list) d.y += h;
    const sc = w / CONFIG.WORLD_WIDTH; // new squares match the old square's size
    const s = sc * 1.6; // pieces a bit bigger so they still read after zooming out
    list = list.concat(
      scatter(seed + k * 3 + 1, 0, 0, w, h, s), // above
      scatter(seed + k * 3 + 2, w, 0, w, h, s), // top-right
      scatter(seed + k * 3 + 3, w, h, w, h, s), // right
    );
    w *= 2;
    h *= 2;
  }
  return list;
}

/** Backwards-compatible: decorations for the starting arena. */
export function generateDecor(seed: number): Decor[] {
  return decorForWorld(seed, 0);
}
