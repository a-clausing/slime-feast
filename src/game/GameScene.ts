import Phaser from 'phaser';
import { CONFIG } from '../config';
import { decorForWorld } from '../core/arena';
import { canConsume, radiusForMass } from '../core/mass';
import type { GameEvent, Slime } from '../core/types';
import { viewSpan, type World } from '../core/world';
import { DECOR_REF, ENEMY_TINTS, FLOOR_REF, FOOD_BIG_REF, FOOD_REF, PLAYER_TINT, SLIME_BODY_R, generateTextures } from './textures';

interface SlimeView {
  id: number;
  body: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image | null;
  ring: Phaser.GameObjects.Image | null;
  aura: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text | null;
  dispR: number;
  pulse: number;
  phase: number;
  lastLabel: string;
  kind: Slime['kind'];
  variant: number;
  rx: number;
  ry: number;
  seen: number;
}

interface Particle {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  active: boolean;
}

interface Ghost {
  img: Phaser.GameObjects.Image;
  fromX: number;
  fromY: number;
  toId: number;
  t: number;
  dur: number;
  size: number;
}

export interface RenderHost {
  /** Advances simulation; returns interpolation alpha in [0,1]. */
  tick(deltaMs: number): number;
  readonly world: World | null;
  onEvents(events: GameEvent[]): void;
}

const DEPTH = { floor: 0, decor: 1, wall: 2, food: 3, shadow: 4, aura: 5, slime: 10, label: 900, fx: 1000 };

export class GameScene extends Phaser.Scene {
  private host!: RenderHost;
  private views = new Map<number, SlimeView>();
  private foodViews: Phaser.GameObjects.Image[] = [];
  private foodIds: number[] = [];
  private particles: Particle[] = [];
  private ghosts: Ghost[] = [];
  private links: { g: Phaser.GameObjects.Graphics; t: number; a: number; b: number }[] = [];
  private boundWorld: World | null = null;
  private frame = 0;
  private camX: number = CONFIG.WORLD_WIDTH / 2;
  private camY: number = CONFIG.WORLD_HEIGHT / 2;
  private camZoom = 1;
  dpr = 1;
  /** Menu background: slow drifting camera with no player. */
  attract = false;
  /** True while an enemy that can eat the home portion is close to it. */
  homeThreat = false;
  ready = false;

  constructor() {
    super('game');
  }

  setHost(h: RenderHost): void {
    this.host = h;
  }

  preload(): void {
    // Relative path so it resolves under the GitHub Pages base path.
    this.load.image('slimePlayer', 'sprites/slime-player.png');
    for (let v = 0; v < 6; v++) this.load.image(`slimeEnemy${v}`, `sprites/enemy-${v}.png`);
    for (let v = 0; v < 4; v++) this.load.image(`food${v}`, `sprites/food-${v}.png`);
    this.load.image('foodBig', 'sprites/food-big.png');
    for (let v = 0; v < 5; v++) this.load.image(`decor${v}`, `sprites/decor-${v}.png`);
    this.load.image('floor', 'sprites/floor.png');
  }

  create(): void {
    generateTextures(this);
    this.foodScale = [0, 1, 2, 3].map((v) => FOOD_REF / this.texW(`food${v}`));
    this.foodBigScale = FOOD_BIG_REF / this.texW('foodBig');
    this.buildArena(CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT, 0);

    // particle pool
    for (let i = 0; i < CONFIG.MAX_PARTICLES; i++) {
      const img = this.add.image(0, 0, 'spark').setDepth(DEPTH.fx).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
      this.particles.push({ img, vx: 0, vy: 0, life: 0, max: 1, size: 1, active: false });
    }

    this.cameras.main.setBackgroundColor('#0a0610');
    this.ready = true;
    this.game.events.emit('scene-ready');
  }

  private foodScale = [1, 1, 1, 1];
  private foodBigScale = 1;

  private texW(key: string): number {
    return (this.textures.get(key).getSourceImage() as HTMLImageElement).width;
  }

  private arenaObjs: Phaser.GameObjects.GameObject[] = [];
  private arenaW = 0;
  private arenaH = 0;
  private arenaExp = -1;
  /** Arena scale (1 at start, doubles with each expansion). */
  private ws = 1;

  /**
   * (Re)builds floor, walls, torches and decorations for the current arena size.
   * Object counts for walls/torches stay constant as the arena grows (spacing scales).
   */
  private buildArena(W: number, H: number, expansions: number): void {
    if (W === this.arenaW && H === this.arenaH && expansions === this.arenaExp) return;
    for (const o of this.arenaObjs) {
      this.tweens.killTweensOf(o);
      o.destroy();
    }
    this.arenaObjs = [];
    this.arenaW = W;
    this.arenaH = H;
    this.arenaExp = expansions;
    const sc = W / CONFIG.WORLD_WIDTH;
    this.ws = sc;
    const keep = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.arenaObjs.push(o);
      return o;
    };

    const floorScale = (this.texW('floor') === FLOOR_REF ? 1 : 0.95) * sc;
    keep(this.add.tileSprite(0, 0, W, H, 'floor').setOrigin(0).setDepth(DEPTH.floor).setTileScale(floorScale).setTint(0xa49cb4));

    // decorations — dimmed and desaturated toward the floor so they never read as gems or creatures
    for (const d of decorForWorld(1337, expansions)) {
      const ds = DECOR_REF / this.texW(`decor${d.type}`);
      keep(
        this.add
          .image(d.x, d.y, `decor${d.type}`)
          .setScale(d.scale * 1.15 * ds)
          .setRotation(d.rot)
          .setDepth(DEPTH.decor)
          .setTint(0x5e5470)
          .setAlpha(d.type === 2 ? 0.35 : 0.6),
      );
    }

    // walls: thick stone border with a glowing inner edge + torches
    const g = keep(this.add.graphics().setDepth(DEPTH.wall));
    const T = 36 * sc;
    const step = 60 * sc;
    g.fillStyle(0x0b0612, 1);
    g.fillRect(0, 0, W, T);
    g.fillRect(0, H - T, W, T);
    g.fillRect(0, 0, T, H);
    g.fillRect(W - T, 0, T, H);
    g.fillStyle(0x2a1d3d, 1);
    const brickStep = step * Math.max(1, Math.round(W / (60 * sc) / 50)); // ≤ ~50 bricks per side
    for (let x = 0; x < W; x += brickStep) {
      g.fillRect(x + 2 * sc, 4 * sc, brickStep - 4 * sc, T - 10 * sc);
      g.fillRect(x + 2 * sc, H - T + 6 * sc, brickStep - 4 * sc, T - 10 * sc);
    }
    for (let y = 0; y < H; y += brickStep) {
      g.fillRect(4 * sc, y + 2 * sc, T - 10 * sc, brickStep - 4 * sc);
      g.fillRect(W - T + 6 * sc, y + 2 * sc, T - 10 * sc, brickStep - 4 * sc);
    }
    g.lineStyle(4 * sc, 0x8a4dff, 0.55);
    g.strokeRect(T, T, W - 2 * T, H - 2 * T);
    const tstep = W / 5;
    for (let x = tstep / 2; x < W; x += tstep) {
      for (const y of [T / 2, H - T / 2]) this.torch(x, y, sc, keep);
    }
    for (let y = tstep / 2; y < H; y += tstep) {
      for (const x of [T / 2, W - T / 2]) this.torch(x, y, sc, keep);
    }
    this.cameras.main.setBounds(0, 0, W, H);
  }

  private torch(x: number, y: number, sc: number, keep: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const glow = keep(this.add.image(x, y, 'glow').setTint(0xff9a3c).setScale(1.6 * sc).setAlpha(0.5).setDepth(DEPTH.wall).setBlendMode(Phaser.BlendModes.ADD));
    keep(this.add.circle(x, y, 7 * sc, 0xffd27a).setDepth(DEPTH.wall));
    this.tweens.add({ targets: glow, alpha: { from: 0.35, to: 0.6 }, scale: { from: 1.45 * sc, to: 1.7 * sc }, duration: 380 + Math.random() * 300, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
  }

  // ─────────────────────────── binding ───────────────────────────

  /** (Re)binds the renderer to a world — used for new runs, restores, and the menu demo. */
  bindWorld(world: World, camera?: { x: number; y: number; zoom: number }): void {
    for (const v of this.views.values()) this.destroyView(v);
    this.views.clear();
    for (const g of this.ghosts) g.img.destroy();
    this.ghosts = [];
    for (const l of this.links) l.g.destroy();
    this.links = [];
    for (const p of this.particles) {
      p.active = false;
      p.img.setVisible(false);
    }
    for (const p of this.pops) {
      p.life = 0;
      p.t.setVisible(false);
    }
    this.pelletGain = 0;
    this.boundWorld = world;
    this.buildArena(world.width, world.height, world.expansions);
    for (let i = 0; i < this.foodIds.length; i++) this.foodIds[i] = -1;
    const a = world.active;
    this.camX = camera?.x ?? a?.x ?? world.width / 2;
    this.camY = camera?.y ?? a?.y ?? world.height / 2;
    this.camZoom = camera?.zoom ?? this.targetZoom(a ? radiusForMass(a.mass) : CONFIG.BASE_RADIUS);
    this.applyCamera();
  }

  cameraState(): { x: number; y: number; zoom: number } {
    return { x: this.camX, y: this.camY, zoom: this.camZoom };
  }

  // ─────────────────────────── views ───────────────────────────

  private makeView(s: Slime): SlimeView {
    const isPlayer = s.kind !== 'enemy';
    const key = isPlayer ? 'slimePlayer' : `slimeEnemy${s.variant}`;
    const shadow = this.add.image(s.x, s.y, 'shadow').setDepth(DEPTH.shadow);
    const aura = this.add.image(s.x, s.y, 'aura').setDepth(DEPTH.aura).setTint(0xff2a3a).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    const glow = isPlayer
      ? this.add.image(s.x, s.y, 'glow').setDepth(DEPTH.aura).setTint(PLAYER_TINT).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD)
      : null;
    const body = this.add.image(s.x, s.y, key).setDepth(DEPTH.slime);
    const label = isPlayer
      ? this.add
          .text(s.x, s.y, '', {
            fontFamily: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
            fontSize: '28px',
            fontStyle: 'bold',
            color: '#f4ffe0',
            stroke: '#0f3a12',
            strokeThickness: 6,
          })
          .setOrigin(0.5)
          .setDepth(DEPTH.label)
      : null;
    const v: SlimeView = {
      id: s.id,
      body,
      shadow,
      glow,
      ring: null,
      aura,
      label,
      dispR: radiusForMass(s.mass),
      pulse: 0,
      phase: Math.random() * Math.PI * 2,
      lastLabel: '',
      kind: s.kind,
      variant: s.variant,
      rx: s.x,
      ry: s.y,
      seen: this.frame,
    };
    this.views.set(s.id, v);
    if (s.kind === 'enemy') {
      // spawn pop-in
      body.setAlpha(0);
      this.tweens.add({ targets: body, alpha: 1, duration: 400 });
    }
    return v;
  }

  private destroyView(v: SlimeView): void {
    v.body.destroy();
    v.shadow.destroy();
    v.glow?.destroy();
    v.ring?.destroy();
    v.aura.destroy();
    v.label?.destroy();
  }

  private syncKind(v: SlimeView, s: Slime): void {
    if (v.kind === s.kind) return;
    v.kind = s.kind;
    if (s.kind === 'home' && !v.ring) {
      v.ring = this.add.image(v.rx, v.ry, 'homeRing').setDepth(DEPTH.aura);
    } else if (s.kind !== 'home' && v.ring) {
      v.ring.destroy();
      v.ring = null;
    }
  }

  // ─────────────────────────── frame ───────────────────────────

  private lastNow = 0;

  update(): void {
    if (!this.host) return;
    this.frame++;
    // Use the real wall clock rather than Phaser's smoothed delta so simulation speed
    // never depends on frame rate (fixed-step accumulator lives in the host).
    const now = performance.now();
    const delta = this.lastNow ? Math.min(250, now - this.lastNow) : 16.67;
    this.lastNow = now;
    const alpha = this.host.tick(delta);
    const world = this.host.world;
    if (!world) return;
    if (world !== this.boundWorld) this.bindWorld(world);
    const dt = Math.min(delta, 100) / 1000;
    this.renderWorld(world, alpha, dt);
  }

  private renderWorld(w: World, alpha: number, dt: number): void {
    const t = this.time.now / 1000;
    const active = w.active;
    const home = w.home;
    const activeMass = active?.mass ?? 0;
    const hunterMass =
      !active ? 0 : w.isSplit || active.mass < CONFIG.MIN_SPLIT_MASS ? active.mass : active.mass * (1 - CONFIG.SPLIT_STATIONARY_RATIO);

    // home threat (for warning ring + HUD indicator)
    this.homeThreat = false;
    if (home) {
      const hr = radiusForMass(home.mass);
      for (const e of w.slimes) {
        if (e.kind !== 'enemy' || !e.alive) continue;
        if (!canConsume(e.mass, home.mass)) continue;
        if (Math.hypot(e.x - home.x, e.y - home.y) - hr - radiusForMass(e.mass) < CONFIG.HOME_THREAT_DIST * this.ws) {
          this.homeThreat = true;
          break;
        }
      }
    }

    const view = this.cameras.main.worldView;
    const margin = 300;

    for (const s of w.slimes) {
      if (!s.alive) continue;
      let v = this.views.get(s.id);
      if (!v) v = this.makeView(s);
      v.seen = this.frame;
      this.syncKind(v, s);

      const x = s.px + (s.x - s.px) * alpha;
      const y = s.py + (s.y - s.py) * alpha;
      v.rx = x;
      v.ry = y;
      const targetR = radiusForMass(s.mass);
      v.dispR += (targetR - v.dispR) * (1 - Math.exp(-dt * 9)); // smooth growth
      v.pulse *= Math.exp(-dt * 7);

      const onScreen =
        x + v.dispR > view.x - margin && x - v.dispR < view.right + margin && y + v.dispR > view.y - margin && y - v.dispR < view.bottom + margin;
      v.body.setVisible(onScreen);
      v.shadow.setVisible(onScreen);
      if (v.glow) v.glow.setVisible(onScreen);
      if (v.label) v.label.setVisible(onScreen);
      if (!onScreen) {
        v.aura.setVisible(false);
        if (v.ring) v.ring.setVisible(false);
        continue;
      }

      // squash & stretch along velocity + idle wobble
      const sp = Math.hypot(s.vx, s.vy);
      const stretch = Math.min(0.14, sp / 2200);
      const c = sp > 1 ? s.vx / sp : 0;
      const sn = sp > 1 ? s.vy / sp : 0;
      const wob = 0.035 * Math.sin(t * 3.2 + v.phase);
      const scale = (v.dispR / SLIME_BODY_R) * (1 + v.pulse * 0.18);
      const sx = scale * (1 + wob + stretch * (c * c) - stretch * 0.6 * (sn * sn));
      const sy = scale * (1 - wob + stretch * (sn * sn) - stretch * 0.6 * (c * c));
      v.body.setPosition(x, y).setScale(sx, sy);
      v.body.setDepth(DEPTH.slime + Math.min(800, Math.sqrt(s.mass)) + (s.kind === 'player' ? 0.5 : 0));
      v.shadow.setPosition(x + v.dispR * 0.08, y + v.dispR * 0.82).setScale((v.dispR * 2.1) / 128, (v.dispR * 1.1) / 64).setAlpha(0.6);

      if (v.glow) {
        v.glow.setPosition(x, y).setScale((v.dispR * 3.2) / 128).setAlpha(0.28 + 0.08 * Math.sin(t * 2 + v.phase) + v.pulse * 0.4);
      }
      if (v.ring) {
        const threat = this.homeThreat;
        v.ring
          .setVisible(true)
          .setPosition(x, y)
          .setRotation(t * 0.6)
          .setScale(((v.dispR + 14) * 2) / 240)
          .setTint(threat ? 0xff4040 : 0xffffff)
          .setAlpha(threat ? 0.6 + 0.4 * Math.sin(t * 12) : 0.75);
      }
      // threat aura on enemies that could eat the controlled slime
      // red = can eat you; green = your hunter could eat it (the 40% portion if you split now,
      // or your current hunter while split; before you can split, anything you can eat); else none
      if (s.kind === 'enemy') {
        const danger = activeMass > 0 && canConsume(s.mass, activeMass);
        const edible = !danger && hunterMass > 0 && canConsume(hunterMass, s.mass);
        v.aura.setVisible(danger || edible);
        if (danger) {
          // halo outer radius ≈ 1.6× body radius, fully lit at the body edge
          v.aura.setTint(0xff2a3a).setPosition(x, y).setScale((v.dispR * 3.2) / 256).setAlpha(0.75 + 0.2 * Math.sin(t * 5 + v.phase));
        } else if (edible) {
          v.aura.setTint(0x6dff2f).setPosition(x, y).setScale((v.dispR * 3.0) / 256).setAlpha(0.7 + 0.15 * Math.sin(t * 3 + v.phase));
        }
      }
      if (v.label) {
        const txt = String(Math.floor(s.mass));
        if (txt !== v.lastLabel) {
          v.label.setText(txt);
          v.lastLabel = txt;
        }
        // constant on-screen size (~13 css px), sitting just under the body
        const ls = (0.5 * this.dpr) / this.camZoom;
        v.label.setPosition(x, y + v.dispR * sy / scale * 0.98 + 14 * ls).setScale(ls);
      }
    }

    // remove views for slimes no longer present
    for (const [id, v] of this.views) {
      if (v.seen !== this.frame) {
        this.destroyView(v);
        this.views.delete(id);
      }
    }

    this.renderFood(w, t, view);
    this.updateFx(dt);
    this.updateCamera(w, dt);
    this.flushPellets(dt);
    this.updatePops(dt);
  }

  private renderFood(w: World, t: number, view: Phaser.Geom.Rectangle): void {
    const food = w.food;
    while (this.foodViews.length < food.length) {
      this.foodViews.push(this.add.image(0, 0, 'food0').setDepth(DEPTH.food).setVisible(false));
      this.foodIds.push(-1);
    }
    const m = 60;
    for (let i = 0; i < this.foodViews.length; i++) {
      const img = this.foodViews[i];
      const f = food[i];
      if (!f || !f.alive) {
        if (img.visible) img.setVisible(false);
        this.foodIds[i] = -1;
        continue;
      }
      if (this.foodIds[i] !== f.id) {
        this.foodIds[i] = f.id;
        img.setTexture(f.big ? 'foodBig' : `food${f.variant}`).setPosition(f.x, f.y).setScale(0);
      }
      const vis = f.x > view.x - m && f.x < view.right + m && f.y > view.y - m && f.y < view.bottom + m;
      img.setVisible(vis);
      if (vis) {
        const target = (f.big ? 1.15 * this.foodBigScale : 0.95 * this.foodScale[f.variant]) * (1 + 0.08 * Math.sin(t * 4 + f.id));
        const cur = img.scaleX;
        img.setScale(cur < target * 0.98 ? Math.min(target, cur + 0.08) : target);
      }
    }
  }

  // ─────────────────────────── camera ───────────────────────────

  private targetZoom(radius: number): number {
    const cam = this.cameras.main;
    const W = this.arenaW || CONFIG.WORLD_WIDTH;
    const H = this.arenaH || CONFIG.WORLD_HEIGHT;
    const span = viewSpan(radius, W, H);
    const narrow = Math.min(cam.width, cam.height);
    // never show beyond the arena
    return Math.max(narrow / span, cam.width / W, cam.height / H);
  }

  private updateCamera(w: World, dt: number): void {
    const a = w.active;
    if (a) {
      const v = this.views.get(a.id);
      const tx = v ? v.rx : a.x;
      const ty = v ? v.ry : a.y;
      const k = 1 - Math.exp(-CONFIG.CAMERA_FOLLOW * dt);
      this.camX += (tx - this.camX) * k;
      this.camY += (ty - this.camY) * k;
      const tz = this.targetZoom(radiusForMass(a.mass));
      this.camZoom += (tz - this.camZoom) * (1 - Math.exp(-CONFIG.CAMERA_ZOOM_FOLLOW * dt));
    } else if (this.attract) {
      const t = this.time.now / 1000;
      this.camX = this.arenaW / 2 + Math.sin(t * 0.045) * 700;
      this.camY = this.arenaH / 2 + Math.sin(t * 0.031 + 1) * 700;
      this.camZoom = this.targetZoom(CONFIG.BASE_RADIUS * 1.6);
    }
    this.applyCamera();
  }

  private applyCamera(): void {
    const cam = this.cameras.main;
    const minZ = Math.max(cam.width / (this.arenaW || CONFIG.WORLD_WIDTH), cam.height / (this.arenaH || CONFIG.WORLD_HEIGHT));
    if (this.camZoom < minZ) this.camZoom = minZ;
    cam.setZoom(this.camZoom);
    cam.centerOn(this.camX, this.camY);
  }

  /** Called after a viewport resize: keep the same world framing, no reset. */
  onResize(): void {
    const a = this.boundWorld?.active;
    if (a) this.camZoom = this.targetZoom(radiusForMass(a.mass));
    this.applyCamera();
  }

  /** World → CSS-pixel screen coordinates. */
  worldToScreen(x: number, y: number): { x: number; y: number } {
    const cam = this.cameras.main;
    const wv = cam.worldView;
    return { x: ((x - wv.x) * cam.zoom) / this.dpr, y: ((y - wv.y) * cam.zoom) / this.dpr };
  }

  isWorldPointVisible(x: number, y: number, r: number): boolean {
    const wv = this.cameras.main.worldView;
    return x + r > wv.x && x - r < wv.right && y + r > wv.y && y - r < wv.bottom;
  }

  // ─────────────────────────── effects ───────────────────────────

  private burst(x: number, y: number, tint: number, count: number, speed: number, size: number, life = 0.5): void {
    let n = 0;
    for (const p of this.particles) {
      if (p.active) continue;
      const a = Math.random() * Math.PI * 2;
      const s = speed * this.ws * (0.4 + Math.random() * 0.8);
      p.active = true;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.life = p.max = life * (0.6 + Math.random() * 0.6);
      p.size = size * this.ws * (0.6 + Math.random() * 0.8);
      p.img.setPosition(x, y).setTint(tint).setVisible(true).setAlpha(1).setScale(p.size / 32);
      if (++n >= count) break;
    }
  }

  private updateFx(dt: number): void {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.img.setVisible(false);
        continue;
      }
      p.vx *= Math.exp(-dt * 3);
      p.vy *= Math.exp(-dt * 3);
      p.img.x += p.vx * dt;
      p.img.y += p.vy * dt;
      const k = p.life / p.max;
      p.img.setAlpha(k).setScale((p.size / 32) * (0.4 + 0.6 * k));
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.t += dt;
      const k = Math.min(1, g.t / g.dur);
      const target = this.views.get(g.toId);
      const tx = target ? target.rx : g.fromX;
      const ty = target ? target.ry : g.fromY;
      const e = k * k;
      g.img.setPosition(g.fromX + (tx - g.fromX) * e, g.fromY + (ty - g.fromY) * e);
      g.img.setScale(g.size * (1 - k) * (1 + 0.3 * Math.sin(k * Math.PI))).setAlpha(1 - k * 0.6);
      if (k >= 1) {
        g.img.destroy();
        this.ghosts.splice(i, 1);
      }
    }
    for (let i = this.links.length - 1; i >= 0; i--) {
      const l = this.links[i];
      l.t += dt;
      const va = this.views.get(l.a);
      const vb = this.views.get(l.b);
      l.g.clear();
      const k = l.t / 0.35;
      if (k >= 1 || !va || !vb) {
        l.g.destroy();
        this.links.splice(i, 1);
        continue;
      }
      const w = Math.min(va.dispR, vb.dispR) * 0.9 * (1 - k);
      l.g.lineStyle(w, 0x69d43a, 0.85 * (1 - k));
      l.g.lineBetween(va.rx, va.ry, vb.rx, vb.ry);
    }
  }

  private pops: { t: Phaser.GameObjects.Text; life: number; max: number; x: number; y: number; rise: number }[] = [];
  private pelletGain = 0;
  private pelletTimer = 0;

  /** Floating "+N" number that rises and fades; constant on-screen size regardless of zoom. */
  popText(x: number, y: number, text: string, color: string, big = false): void {
    let p = this.pops.find((q) => q.life <= 0);
    if (!p) {
      if (this.pops.length >= 14) p = this.pops.reduce((a, b) => (a.life < b.life ? a : b));
      else {
        const t = this.add
          .text(0, 0, '', {
            fontFamily: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
            fontSize: '44px',
            fontStyle: '900',
            color: '#ffffff',
            stroke: '#12081d',
            strokeThickness: 9,
          })
          .setOrigin(0.5)
          .setDepth(DEPTH.label + 10);
        p = { t, life: 0, max: 1, x: 0, y: 0, rise: 0 };
        this.pops.push(p);
      }
    }
    p.t.setText(text).setColor(color).setVisible(true).setAlpha(1);
    // stack pops that start close together so simultaneous kills don't overlap
    const base = (0.45 * this.dpr) / this.camZoom;
    const recent = this.pops.filter((q) => q !== p && q.life > q.max - 0.3 && Math.abs(q.x - x) < 120 * base).length;
    p.x = x + (Math.random() - 0.5) * 30 * base;
    p.y = y - recent * 46 * base;
    p.max = p.life = big ? 1.1 : 0.8;
    p.rise = big ? 1.4 : 1;
    p.t.setData('big', big);
  }

  private updatePops(dt: number): void {
    // on-screen size: ~20 css px (big ~28), independent of zoom
    const base = (0.45 * this.dpr) / this.camZoom;
    for (const p of this.pops) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.t.setVisible(false);
        continue;
      }
      const k = 1 - p.life / p.max; // 0 → 1
      const big = p.t.getData('big') as boolean;
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, (k - 0.15) * 0.6);
      const sc = base * (big ? 1.35 : 1) * pop;
      p.t.setScale(sc).setPosition(p.x, p.y - k * 60 * p.rise * (base / 0.5)).setAlpha(k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1);
    }
  }

  /** Batch pellet gains into one "+N" over the player every ~0.35 s (avoids spam). */
  private flushPellets(dt: number): void {
    this.pelletTimer -= dt;
    if (this.pelletTimer > 0 || this.pelletGain <= 0) return;
    const a = this.boundWorld?.active;
    const v = a ? this.views.get(a.id) : undefined;
    if (v) this.popText(v.rx, v.ry - v.dispR - 10 * this.ws, `+${Math.round(this.pelletGain)}`, '#d8ffa8');
    this.pelletGain = 0;
    this.pelletTimer = 0.35;
  }

  private ring(x: number, y: number, r: number, tint: number): void {
    const img = this.add.image(x, y, 'ring').setDepth(DEPTH.fx).setTint(tint).setScale((r * 2) / 128).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: img, scale: (r * 4.5) / 128, alpha: 0, duration: 520, ease: 'Cubic.out', onComplete: () => img.destroy() });
  }

  handleEvents(events: GameEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'food': {
          const v = this.views.get(ev.eaterId);
          if (v) v.pulse = Math.min(1, v.pulse + (ev.big ? 0.5 : 0.18));
          if (ev.byPlayer) this.pelletGain += ev.big ? CONFIG.FOOD_BIG_MASS : CONFIG.FOOD_MASS;
          if (ev.byPlayer || this.isWorldPointVisible(ev.x, ev.y, 20)) this.burst(ev.x, ev.y, ev.big ? 0xffd34d : 0xc8ff6a, ev.big ? 8 : 3, 120, ev.big ? 18 : 12, 0.35);
          break;
        }
        case 'eat': {
          const pv = this.views.get(ev.preyId);
          const ev2 = this.views.get(ev.eaterId);
          if (ev2) ev2.pulse = 1;
          if (!this.isWorldPointVisible(ev.x, ev.y, 200)) break;
          const tint = ev.preyKind === 'enemy' ? ENEMY_TINTS[pv?.variant ?? 0] : PLAYER_TINT;
          if (pv) {
            const ghost = this.add
              .image(pv.rx, pv.ry, pv.body.texture.key)
              .setDepth(DEPTH.slime + 900)
              .setScale(pv.dispR / SLIME_BODY_R);
            this.ghosts.push({ img: ghost, fromX: pv.rx, fromY: pv.ry, toId: ev.eaterId, t: 0, dur: 0.22, size: pv.dispR / SLIME_BODY_R });
          }
          this.burst(ev.x, ev.y, tint, Math.min(18, 6 + Math.floor(Math.sqrt(ev.mass))), 260, 22, 0.6);
          if (ev.byPlayer) this.popText(ev.x, ev.y, `+${Math.round(ev.mass).toLocaleString('en-US')}`, '#8dff4f', true);
          break;
        }
        case 'split': {
          const a = this.views.get(ev.activeId);
          const h = this.views.get(ev.homeId);
          if (h) h.pulse = 1;
          const g = this.add.graphics().setDepth(DEPTH.slime - 1);
          this.links.push({ g, t: 0, a: ev.homeId, b: ev.activeId });
          const x = h?.rx ?? 0;
          const y = h?.ry ?? 0;
          this.burst(x, y, PLAYER_TINT, 16, 280, 20, 0.5);
          if (a) a.pulse = 1;
          break;
        }
        case 'recombine': {
          const v = this.views.get(ev.survivorId);
          if (v) v.pulse = 1.4;
          this.ring(ev.x, ev.y, v?.dispR ?? 60, PLAYER_TINT);
          this.burst(ev.x, ev.y, 0xe6ff9a, 24, 360, 24, 0.7);
          break;
        }
        case 'portionLost': {
          const v = this.views.get(ev.lostId);
          if (v) this.burst(v.rx, v.ry, 0xff5050, 20, 320, 22, 0.7);
          this.cameras.main.shake(220, 0.006);
          break;
        }
        case 'expand': {
          // keep everything visually in place while the world shifts down, then zoom out
          this.camY += ev.shiftY;
          for (const v of this.views.values()) v.ry += ev.shiftY;
          for (const p of this.particles) if (p.active) p.img.y += ev.shiftY;
          for (const g of this.ghosts) g.fromY += ev.shiftY;
          for (const p of this.pops) p.y += ev.shiftY;
          for (let i = 0; i < this.foodIds.length; i++) this.foodIds[i] = -1;
          this.buildArena(ev.width, ev.height, ev.expansions);
          this.applyCamera();
          this.cameras.main.flash(260, 120, 60, 200);
          break;
        }
        case 'gameover': {
          this.cameras.main.shake(350, 0.01);
          break;
        }
        default:
          break;
      }
    }
  }
}
