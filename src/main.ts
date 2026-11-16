import Phaser from 'phaser';
import './style.css';
import { CONFIG } from './config';
import { App } from './app';
import { GameScene } from './game/GameScene';

function dpr(): number {
  return Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR);
}

function viewport(): { w: number; h: number } {
  const vv = window.visualViewport;
  return { w: Math.round(vv?.width ?? window.innerWidth), h: Math.round(vv?.height ?? window.innerHeight) };
}

const scene = new GameScene();
const initial = viewport();
const ratio = dpr();
scene.dpr = ratio;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0a0610',
  width: initial.w * ratio,
  height: initial.h * ratio,
  scale: { mode: Phaser.Scale.NONE, zoom: 1 / ratio },
  render: { antialias: true, powerPreference: 'high-performance', roundPixels: false, mipmapFilter: 'LINEAR_MIPMAP_LINEAR' },
  input: { keyboard: false, mouse: false, touch: false, gamepad: false },
  audio: { noAudio: true },
  banner: false,
  scene: [scene],
});

const app = new App(scene);
scene.setHost(app);

game.events.once('scene-ready', () => {
  app.boot();
  // expose a tiny hook for automated browser QA
  (window as unknown as { __slimeFeast: unknown }).__slimeFeast = { app, scene, game };
});

// ── Resize / rotation: resize the canvas only. The simulation is never recreated. ──
let resizeRaf = 0;
function onResize(): void {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    const { w, h } = viewport();
    const r = dpr();
    scene.dpr = r;
    game.scale.resize(w * r, h * r);
    game.scale.setZoom(1 / r);
    if (scene.ready) scene.onResize();
    app.checkOrientation();
    app.persist();
  });
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
window.visualViewport?.addEventListener('resize', onResize);

// prevent iOS double-tap zoom / pinch zoom / long-press menus
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ── Service worker (production only) ──
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((reg) => {
        // Ask the worker to cache every asset this page already loaded (hashed bundles, art).
        const urls = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((u) => u.startsWith(location.origin));
        urls.push(location.href.split('#')[0]);
        const post = () => (reg.active ?? reg.waiting ?? reg.installing)?.postMessage({ type: 'cache-urls', urls });
        if (reg.active) post();
        else navigator.serviceWorker.ready.then(post);
      })
      .catch((err) => console.warn('[slime-feast] SW registration failed', err));
  });
}
