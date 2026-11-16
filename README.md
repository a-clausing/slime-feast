# Slime Feast

**Eat. Split. Survive.** A mobile-first, top-down survival/growth arcade game starring the green Slime from the Monster Merge universe.

▶ **Play:** https://a-clausing.github.io/slime-feast/ (portrait, iPhone-first; installable to the home screen)

## How to play

- **Move:** touch and drag anywhere on the left side of the screen (floating joystick). Desktop: WASD / arrow keys.
- **Eat:** gems, and any slime you outweigh by at least 20% (`yourMass ≥ theirMass × 1.20`). Slimes with a **red glow** can eat you.
- **SLIME SPLIT** (button bottom-right, or Space) at **100+ mass**: 60% of you stays put as a stationary portion; 40% becomes your controlled hunter. It's faster only because it's lighter. Touch the stationary portion to merge again. Both halves can eat and be eaten. You only lose when no portion survives.
- **Pause:** top-right button, or Escape.

## Development

```bash
npm install
npm run dev       # local dev server
npm test          # unit tests (Vitest)
npm run build     # type-check + production build to dist/
npm run preview   # serve the production build at http://localhost:4173/slime-feast/
npm run qa        # headless-Chrome QA (needs `npm run preview` running; set CHROME_PATH if needed)
```

Balancing harness (heuristic bot plays seeded runs):
`BALANCE=1 npx vitest run tests/balance.sim.test.ts --silent=false`

## Architecture

TypeScript + Phaser 3 (WebGL rendering) + Vite. The simulation is deliberately **independent of Phaser and the DOM**, so it is deterministic and fully unit-testable.

| Module | Responsibility |
| --- | --- |
| `src/config.ts` | **All** balancing parameters (mass, speed, split, AI, difficulty, camera, food, saves) |
| `src/core/mass.ts` | Radius (√mass), speed curve, the exact 1.20 consumption rule, overlap rule |
| `src/core/world.ts` | Game state, fixed-step simulation, Slime Split/recombination, consumption and collisions, spawning, scoring |
| `src/core/ai.ts` | Enemy steering: flee > hunt > forage > wander, neutral sliding, wall avoidance |
| `src/core/difficulty.ts` | Phase curve (feeding, hunting, survival, endless) with an asymptotic endless ramp |
| `src/core/spatial.ts` | Uniform grid for food proximity queries |
| `src/core/arena.ts` | Seeded decoration layout |
| `src/core/save.ts` | Versioned save format, validation, localStorage meta and active run |
| `src/game/GameScene.ts` | Rendering, interpolation, camera, effects, threat warnings |
| `src/game/textures.ts` | Procedurally drawn art (slimes, food, floor, decor) |
| `src/ui/controls.ts` | Multi-touch floating joystick, SPLIT button, keyboard |
| `src/ui/hud.ts` | HUD, split button state, off-screen stationary-portion indicator |
| `src/audio/sfx.ts` | Synthesized WebAudio effects (unlocked on first gesture) |
| `src/app.ts` | State machine (menu, playing, paused, game over), persistence and lifecycle, orientation |
| `public/sw.js`, `public/manifest.webmanifest` | PWA: offline caching, installability |

Key implementation notes:

- **Fixed 60 Hz simulation** with an accumulator driven by the wall clock, plus render interpolation, so behaviour doesn't change with frame rate (60/120 Hz ProMotion or slow devices).
- **Split speed:** the controlled portion uses exactly the same `speedForMass()` as every other slime. There is no dash or multiplier.
- **Consumption** is resolved in one deterministic pairwise pass. Prey is marked dead immediately, so mass and score transfer exactly once. Player state (portion loss, control transfer, game over) is resolved after all contacts in that step.
- **Recombination latch:** after a split, merging is armed once the hunter has moved a short distance away (or after 0.45 s), so a split can't instantly re-merge.
- **Persistence:** the full run (both portions, enemies, food, RNG state, timers, camera) is saved every 3 s and on hide/pagehide/resize. On reopen it restores **paused**. Corrupt or old-version saves are discarded safely. Browser storage can still be cleared by the user or evicted by iOS; that is outside the game's control.
- **Rotation/resizing** only resizes the canvas. The simulation is never recreated. Phones held in landscape get a non-destructive "Rotate your device" overlay and the run pauses.

## Art & audio

- The menu art and app icons are cropped from the supplied Monster Merge "LV 1 Slime" artwork.
- **All in-game art** (player, 6 enemies, gems, decorations, floor) is supplied sprite art in `public/sprites/`, cut out from magenta/green backgrounds and sized to each hitbox. The procedural drawings in `src/game/textures.ts` are only a fallback if a sprite fails to load.
- All sound effects are synthesized at runtime (no audio files, no licensing).
