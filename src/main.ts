import Phaser from 'phaser';
import './style.css';
import { CONFIG } from './config';
import { App } from './app';
import { GameScene } from './game/GameScene';

function dpr(): number {
  return Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR);
}

/**
 * iOS home-screen (standalone) apps with a translucent status bar report a viewport that is
 * one status-bar height too short, so 100vh/100%/innerHeight all leave a band at the bottom.
 * In that mode the app always fills the physical screen, so size the container from `screen`.
 */
function isStandalone(): boolean {
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}
function fitAppToScreen(): void {
  // CSS handles the layout (see html.ios-standalone in style.css); this just flags the mode
  // for iOS, whose `navigator.standalone` is more reliable than the display-mode media query.
  document.documentElement.classList.toggle('ios-standalone', isStandalone());
  window.scrollTo(0, 0);
}

/** Size of the game container (#app). */
function viewport(): { w: number; h: number } {
  fitAppToScreen();
  const r = document.getElementById('app')!.getBoundingClientRect();
  const w = Math.round(r.width) || window.innerWidth;
  const h = Math.round(r.height) || window.innerHeight;
  return { w, h };
}

declare const __BUILD__: string;
const info = document.getElementById('build-info');
if (info) {
  const sa = getComputedStyle(document.documentElement).getPropertyValue('--sat').trim();
  info.textContent = `Build ${typeof __BUILD__ === 'string' ? __BUILD__ : 'dev'} · ${isStandalone() ? 'home-screen' : 'browser'} · screen ${screen.width}×${screen.height} · view ${window.innerWidth}×${window.innerHeight} ${sa}`;
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
// catches iOS standalone launch where the container settles to full height after first paint
new ResizeObserver(onResize).observe(document.getElementById('app')!);
window.addEventListener('pageshow', onResize);

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
