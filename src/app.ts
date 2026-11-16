import { CONFIG } from './config';
import type { GameEvent } from './core/types';
import { World } from './core/world';
import { clearRun, loadMeta, loadRun, saveMeta, saveRun, type MetaSave } from './core/save';
import type { GameScene, RenderHost } from './game/GameScene';
import { Sfx } from './audio/sfx';
import { Controls } from './ui/controls';
import { $, Hud, fmtNum, fmtTime } from './ui/hud';

type State = 'menu' | 'playing' | 'paused' | 'dying' | 'gameover';

const TUTORIAL_KEY = 'slimeFeast.tutorialDone';

/** Top-level game controller: state machine, persistence, UI wiring. */
export class App implements RenderHost {
  world: World | null = null;
  state: State = 'menu';
  meta: MetaSave = loadMeta();
  readonly sfx = new Sfx();
  private hud = new Hud();
  private controls: Controls;
  private acc = 0;
  private saveTimer = 0;
  private hintTimer = 0;
  private tutorialStage = 0; // 0 move, 1 eat, 2 wait-for-100, 3 split prompt, 4 done
  private dyingUntil = 0;
  private rotateBlocked = false;
  private readonly idleInput = { x: 0, y: 0 };

  private el = {
    menu: $('screen-menu'),
    pause: $('screen-pause'),
    over: $('screen-gameover'),
    settings: $('screen-settings'),
    hud: $('hud'),
    split: $('btn-split'),
    zone: $('touch-zone'),
    rotate: $('rotate-overlay'),
    hint: $('hint'),
    cont: $('btn-continue'),
  };

  constructor(private scene: GameScene) {
    this.sfx.setMuted(this.meta.muted);
    this.controls = new Controls($('touch-zone'), $('joystick'), $('joystick-knob'), $('btn-split'));
    this.controls.onSplit = () => this.split();
    this.controls.onPauseKey = () => {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    };
    this.controls.onAnyGesture = () => this.sfx.unlock();
    this.wireButtons();
    this.wireLifecycle();
    this.refreshSoundLabels();
  }

  // ───────────────────────── boot ─────────────────────────

  boot(): void {
    try {
      this.tutorialStage = localStorage.getItem(TUTORIAL_KEY) ? 4 : 0;
    } catch {
      this.tutorialStage = 4;
    }
    const saved = loadRun();
    if (saved) {
      // Restore the active run in a paused state.
      this.world = saved.world;
      this.scene.bindWorld(saved.world, saved.camera);
      this.show('paused');
    } else {
      this.toMenu();
    }
    this.checkOrientation();
  }

  // ───────────────────────── state transitions ─────────────────────────

  private show(state: State): void {
    this.state = state;
    const playingish = state === 'playing' || state === 'paused' || state === 'dying' || state === 'gameover';
    this.el.menu.classList.toggle('hidden', state !== 'menu');
    this.el.pause.classList.toggle('hidden', state !== 'paused');
    this.el.over.classList.toggle('hidden', state !== 'gameover');
    this.el.hud.classList.toggle('hidden', !playingish);
    this.el.split.classList.toggle('hidden', !playingish || state === 'gameover');
    this.el.zone.classList.toggle('hidden', state !== 'playing');
    this.controls.enabled = state === 'playing';
    if (state !== 'playing') this.controls.reset();
    if (state === 'menu') {
      $('menu-high').textContent = fmtNum(this.meta.highScore);
      this.el.cont.classList.toggle('hidden', !loadRun());
    }
    this.hud.reset();
    if (this.world && playingish) this.hud.update(this.world, this.scene);
    if (state !== 'playing') this.el.hint.classList.add('hidden');
  }

  startRun(): void {
    clearRun();
    this.scene.attract = false;
    this.world = new World();
    this.scene.bindWorld(this.world);
    this.acc = 0;
    this.saveTimer = 0;
    this.world.startHigh = this.meta.highScore;
    this.show('playing');
    this.tryLockPortrait();
    if (this.tutorialStage < 4) {
      this.tutorialStage = 0;
      this.hint('Drag on the left side to move', 999);
    }
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.persist();
    this.show('paused');
  }

  resume(): void {
    if (this.state !== 'paused' || !this.world) return;
    if (this.rotateBlocked) return;
    this.acc = 0;
    this.show('playing');
  }

  toMenu(): void {
    if (this.world && !this.world.gameOver && (this.state === 'paused' || this.state === 'playing')) this.persist();
    // attract-mode world behind the menu
    const demo = new World(Math.floor(Math.random() * 1e9));
    demo.slimes.forEach((s) => {
      if (s.kind === 'player') s.alive = false;
    });
    demo.slimes = demo.slimes.filter((s) => s.alive);
    demo.activeId = -1;
    demo.attract = true;
    this.world = demo;
    this.scene.attract = true;
    this.scene.bindWorld(demo);
    this.show('menu');
  }

  private continueRun(): void {
    const saved = loadRun();
    if (!saved) return this.startRun();
    this.scene.attract = false;
    this.world = saved.world;
    this.scene.bindWorld(saved.world, saved.camera);
    this.acc = 0;
    this.show('playing');
  }

  private split(): void {
    if (this.state !== 'playing' || !this.world) return;
    if (this.world.trySplit(this.controls.input.x, this.controls.input.y)) {
      this.sfx.split();
      if (navigator.vibrate) navigator.vibrate(18);
      if (this.tutorialStage < 4) {
        this.tutorialStage = 4;
        this.hint('Touch your stationary half to merge back!', 4);
        try {
          localStorage.setItem(TUTORIAL_KEY, '1');
        } catch {
          /* ignore */
        }
      }
    } else {
      this.sfx.denied();
    }
  }

  private endRun(): void {
    const w = this.world!;
    clearRun();
    const newHigh = Math.floor(w.stats.score) > w.startHigh && w.stats.score > 0;
    this.meta.highScore = Math.max(this.meta.highScore, Math.floor(w.stats.score));
    this.meta.bestMass = Math.max(this.meta.bestMass, Math.floor(w.stats.bestMass));
    saveMeta(this.meta);
    $('go-score').textContent = fmtNum(w.stats.score);
    $('go-high').textContent = fmtNum(this.meta.highScore);
    $('go-time').textContent = fmtTime(w.stats.time);
    $('go-mass').textContent = fmtNum(w.stats.bestMass);
    $('go-eaten').textContent = fmtNum(w.stats.creaturesEaten);
    $('go-splits').textContent = fmtNum(w.stats.splits);
    $('go-newhigh').classList.toggle('hidden', !newHigh);
    this.show('gameover');
  }

  // ───────────────────────── frame tick (called by the scene) ─────────────────────────

  tick(deltaMs: number): number {
    const w = this.world;
    if (!w) return 1;
    const dt = CONFIG.SIM_DT;
    if (this.state === 'playing' || this.state === 'menu') {
      this.acc += Math.min(deltaMs, 250) / 1000;
      let steps = 0;
      const input = this.state === 'playing' ? this.controls.input : this.idleInput;
      while (this.acc >= dt && steps < CONFIG.MAX_STEPS_PER_FRAME) {
        w.step(dt, input);
        this.acc -= dt;
        steps++;
        if (w.gameOver) break;
      }
      if (steps === CONFIG.MAX_STEPS_PER_FRAME) this.acc = Math.min(this.acc, dt);
      const events = w.drainEvents();
      if (this.state === 'playing') {
        this.onEvents(events);
        this.hud.update(w, this.scene);
        this.tutorial(w, deltaMs / 1000);
        this.saveTimer += deltaMs / 1000;
        if (this.saveTimer >= CONFIG.SAVE_INTERVAL) {
          this.saveTimer = 0;
          this.persist();
        }
        if (w.gameOver) {
          this.state = 'dying';
          this.dyingUntil = performance.now() + 1100;
          this.controls.enabled = false;
          this.controls.reset();
          this.el.zone.classList.add('hidden');
          this.el.split.classList.add('hidden');
          clearRun();
        }
      } else {
        this.scene.handleEvents(events.filter((e) => e.type !== 'gameover'));
      }
      return Math.min(1, this.acc / dt);
    }
    if (this.state === 'dying') {
      if (performance.now() >= this.dyingUntil) this.endRun();
    }
    if (this.state === 'paused' && w) this.hud.update(w, this.scene);
    return 1;
  }

  onEvents(events: GameEvent[]): void {
    if (!events.length) return;
    this.scene.handleEvents(events);
    let foodSfx = false;
    let bigFood = false;
    for (const e of events) {
      switch (e.type) {
        case 'food':
          if (e.byPlayer) {
            foodSfx = true;
            bigFood ||= e.big;
          }
          break;
        case 'eat':
          if (e.byPlayer) this.sfx.gulp(e.mass);
          break;
        case 'recombine':
          this.sfx.recombine();
          if (navigator.vibrate) navigator.vibrate(25);
          break;
        case 'portionLost':
          this.sfx.lose();
          if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
          this.hint(e.which === 'active' ? 'Your hunter was eaten! Back to your stationary half.' : 'Your stationary half was eaten!', 2.6);
          break;
        case 'gameover':
          this.sfx.gameOver();
          if (navigator.vibrate) navigator.vibrate(120);
          break;
        default:
          break;
      }
    }
    if (foodSfx) this.sfx.food(bigFood);
  }

  private tutorial(w: World, dt: number): void {
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.el.hint.classList.add('hidden');
    }
    if (this.tutorialStage >= 4) return;
    const a = w.active;
    if (!a) return;
    if (this.tutorialStage === 0 && (Math.abs(this.controls.input.x) + Math.abs(this.controls.input.y) > 0.2)) {
      this.tutorialStage = 1;
      this.hint('Chase green-glowing slimes and gems to grow', 4.5);
    } else if (this.tutorialStage === 1 && this.hintTimer <= 0) {
      this.tutorialStage = 2;
      this.hint('Avoid slimes with a red glow — they can eat you!', 4);
    } else if (this.tutorialStage === 2 && w.canSplit()) {
      this.tutorialStage = 3;
      this.hint('100 mass! Tap SPLIT to send out a faster hunter', 6);
    }
  }

  private hint(text: string, seconds: number): void {
    this.el.hint.textContent = text;
    this.el.hint.classList.remove('hidden');
    // restart CSS animation
    this.el.hint.style.animation = 'none';
    void this.el.hint.offsetWidth;
    this.el.hint.style.animation = '';
    this.hintTimer = seconds;
  }

  // ───────────────────────── persistence ─────────────────────────

  persist(): void {
    const w = this.world;
    if (!w || w.gameOver || this.state === 'menu' || this.state === 'gameover' || this.state === 'dying') return;
    saveRun(w, this.scene.cameraState());
    if (w.stats.score > this.meta.highScore) {
      this.meta.highScore = Math.floor(w.stats.score);
      saveMeta(this.meta);
    }
  }

  private wireLifecycle(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing') this.pause();
        else this.persist();
        this.sfx.suspend();
      } else {
        this.sfx.resume();
        this.acc = 0;
      }
    });
    window.addEventListener('pagehide', () => this.persist());
    window.addEventListener('beforeunload', () => this.persist());
    window.addEventListener('blur', () => {
      if (this.state === 'playing') this.pause();
    });
  }

  /** Viewport changes never recreate the simulation — only the camera/canvas adapt. */
  checkOrientation(): void {
    const landscapePhone =
      window.matchMedia('(orientation: landscape) and (pointer: coarse)').matches && window.innerHeight < 560;
    this.rotateBlocked = landscapePhone;
    this.el.rotate.classList.toggle('hidden', !landscapePhone);
    if (landscapePhone && this.state === 'playing') this.pause();
  }

  private tryLockPortrait(): void {
    try {
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      o?.lock?.('portrait').catch(() => {});
    } catch {
      /* unsupported (iOS) — the rotate overlay handles it */
    }
  }

  // ───────────────────────── buttons ─────────────────────────

  private btn(id: string, fn: () => void): void {
    $(id).addEventListener('click', (e) => {
      e.preventDefault();
      this.sfx.unlock();
      this.sfx.button();
      fn();
    });
  }

  private wireButtons(): void {
    this.btn('btn-play', () => this.startRun());
    this.btn('btn-continue', () => this.continueRun());
    this.btn('btn-pause', () => this.pause());
    this.btn('btn-resume', () => this.resume());
    this.btn('btn-restart', () => this.startRun());
    this.btn('btn-pause-menu', () => this.toMenu());
    this.btn('btn-again', () => this.startRun());
    this.btn('btn-go-menu', () => this.toMenu());
    this.btn('btn-settings', () => this.el.settings.classList.remove('hidden'));
    this.btn('btn-settings-close', () => this.el.settings.classList.add('hidden'));
    this.btn('btn-sound-settings', () => this.toggleSound());
    this.btn('btn-sound-pause', () => this.toggleSound());
    this.btn('btn-reset-records', () => {
      if (!confirm('Reset your high score and best mass?')) return;
      this.meta.highScore = 0;
      this.meta.bestMass = 0;
      saveMeta(this.meta);
      $('menu-high').textContent = '0';
    });
  }

  private toggleSound(): void {
    this.meta.muted = !this.meta.muted;
    this.sfx.setMuted(this.meta.muted);
    saveMeta(this.meta);
    this.refreshSoundLabels();
  }

  private refreshSoundLabels(): void {
    const t = `SOUND: ${this.meta.muted ? 'OFF' : 'ON'}`;
    $('btn-sound-settings').textContent = t;
    $('btn-sound-pause').textContent = t;
  }
}
