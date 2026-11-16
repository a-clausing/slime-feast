import { CONFIG } from '../src/config';
import { World } from '../src/core/world';
import type { Slime } from '../src/core/types';

/** Empty, deterministic world with a single player slime (no food, no enemies). */
export function emptyWorld(mass: number = CONFIG.STARTING_MASS, x = 1500, y = 1500): { w: World; p: Slime } {
  const w = new World(1234, false);
  const p = w.addSlime('player', x, y, mass);
  w.activeId = p.id;
  w.stats.bestMass = mass;
  // keep population systems quiet in isolated tests
  w.spawnTimer = 1e9;
  w.recycleTimer = 1e9;
  return { w, p };
}

export function quietStep(w: World, n = 1, input = { x: 0, y: 0 }): void {
  for (let i = 0; i < n; i++) {
    w.spawnTimer = 1e9;
    w.recycleTimer = 1e9;
    w.foodAccumulator = -1e9;
    w.step(CONFIG.SIM_DT, input);
  }
}

export function enemy(w: World, x: number, y: number, mass: number): Slime {
  const e = w.addSlime('enemy', x, y, mass);
  e.think = 1e9; // freeze AI so tests control positions
  e.vx = 0;
  e.vy = 0;
  e.desired = 0;
  e.heading = 0;
  e.speedJitter = 0; // zero speed: stays put
  return e;
}
