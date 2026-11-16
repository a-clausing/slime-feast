/**
 * Balancing harness (skipped by default). Run with:  BALANCE=1 npx vitest run tests/balance.sim.test.ts
 * A simple heuristic bot plays many seeded runs and reports pacing numbers.
 */
import { it } from 'vitest';
import { CONFIG } from '../src/config';
import { canConsume, radiusForMass } from '../src/core/mass';
import { World } from '../src/core/world';

function botInput(w: World, skill: number): { x: number; y: number } {
  const p = w.active!;
  const pr = radiusForMass(p.mass);
  let fx = 0;
  let fy = 0;
  let threat = false;
  let best: { x: number; y: number; s: number } | null = null;
  for (const e of w.slimes) {
    if (!e.alive || e.kind !== 'enemy') continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y) - radiusForMass(e.mass) - pr;
    if (canConsume(e.mass, p.mass) && d < 260 * skill) {
      fx -= (e.x - p.x) / (d + 20);
      fy -= (e.y - p.y) / (d + 20);
      threat = true;
    } else if (canConsume(p.mass, e.mass) && d < 500) {
      const s = e.mass / (d + 50);
      if (!best || s > best.s) best = { x: e.x, y: e.y, s };
    }
  }
  if (threat) return norm(fx, fy);
  if (w.isSplit && w.home && Math.random() < 0.002) return norm(w.home.x - p.x, w.home.y - p.y);
  if (best) return norm(best.x - p.x, best.y - p.y);
  let bd = 1e9;
  let tx = CONFIG.WORLD_WIDTH / 2 - p.x;
  let ty = CONFIG.WORLD_HEIGHT / 2 - p.y;
  for (const f of w.food) {
    if (!f.alive) continue;
    const d = (f.x - p.x) ** 2 + (f.y - p.y) ** 2;
    if (d < bd) {
      bd = d;
      tx = f.x - p.x;
      ty = f.y - p.y;
    }
  }
  return norm(tx, ty);
}
function norm(x: number, y: number) {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

it.skipIf(!process.env.BALANCE)('balance report', () => {
  for (const skill of [0.6, 1, 1.5]) {
    const rows: string[] = [];
    let sumT = 0;
    let t100sum = 0;
    let t100n = 0;
    const N = 16;
    for (let seed = 1; seed <= N; seed++) {
      const w = new World(seed * 7919);
      let t100 = -1;
      let maxMass = 0;
      const deaths: string[] = [];
      while (!w.gameOver && w.stats.time < 600) {
        w.step(CONFIG.SIM_DT, botInput(w, skill));
        const m = w.totalPlayerMass();
        maxMass = Math.max(maxMass, m);
        if (t100 < 0 && m >= 100) t100 = w.stats.time;
        if (w.canSplit() && Math.random() < 0.003) w.trySplit();
        for (const ev of w.events) {
          if (ev.type === 'eat' && ev.preyKind !== 'enemy') {
            const k = w.byId(ev.eaterId);
            deaths.push(`t=${w.stats.time.toFixed(0)} ${ev.preyKind} m=${ev.mass.toFixed(0)} by m=${(k ? k.mass - ev.mass : 0).toFixed(0)} mode=${k?.mode}`);
          }
        }
        w.events.length = 0;
      }
      sumT += w.stats.time;
      if (t100 >= 0) {
        t100sum += t100;
        t100n++;
      }
      rows.push(
        `seed ${seed}: survived ${w.stats.time.toFixed(0)}s score ${w.stats.score.toFixed(0)} best ${maxMass.toFixed(0)} t100 ${t100.toFixed(1)} eaten ${w.stats.creaturesEaten} splits ${w.stats.splits} | ${deaths.join('; ')}`,
      );
    }
    console.log(`\n== skill ${skill}: avg survival ${(sumT / N).toFixed(0)}s, avg time-to-100 ${(t100sum / Math.max(1, t100n)).toFixed(1)}s (${t100n}/${N})`);
    console.log(rows.join('\n'));
  }
}, 600000);
