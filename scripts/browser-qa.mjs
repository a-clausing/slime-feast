// Automated browser QA: drives the production build in headless Chrome at several
// viewports, exercises touch/multi-touch, pause, split, rotation, persistence, game over,
// and saves screenshots to ./qa-screenshots.
//
// Usage:  npm run build && npx vite preview --port 4173 &  then  node scripts/browser-qa.mjs [url]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://localhost:4173/slime-feast/';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const OUT = 'qa-screenshots';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

async function openPage(viewport, { clear = true } = {}) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(URL, { waitUntil: 'load' });
  if (clear) {
    await page.waitForFunction(() => window.__slimeFeast?.app, { timeout: 15000 });
    await page.evaluate(() => {
      window.__slimeFeast.app.persist = () => {};
      localStorage.clear();
    });
    await page.reload({ waitUntil: 'load' });
  }
  await page.waitForFunction(() => window.__slimeFeast?.app, { timeout: 15000 });
  return { page, errors };
}

const state = (page) =>
  page.evaluate(() => {
    const { app } = window.__slimeFeast;
    const w = app.world;
    return {
      state: app.state,
      split: w?.isSplit,
      mass: w?.active?.mass,
      home: w?.home?.mass,
      total: w?.totalPlayerMass?.(),
      time: w?.stats.time,
      score: w?.stats.score,
      x: w?.active?.x,
      y: w?.active?.y,
      gameOver: w?.gameOver,
      enemies: w?.enemyCount?.(),
      food: w?.foodCount?.(),
    };
  });

// Make the run safe for scripted testing: remove enemies near the player.
const clearThreats = (page) =>
  page.evaluate(() => {
    const w = window.__slimeFeast.app.world;
    const a = w.active;
    for (const s of w.slimes) if (s.kind === 'enemy' && Math.hypot(s.x - a.x, s.y - a.y) < 1400) s.alive = false;
    for (let i = 0; i < w.food.length; i++) {
      const f = w.food[i];
      if (f.alive && Math.hypot(f.x - a.x, f.y - a.y) < 700) {
        f.alive = false;
        w.foodGrid.remove(i, f.x, f.y);
      }
    }
    w.slimes = w.slimes.filter((s) => s.alive);
    w.spawnTimer = 30;
  });

async function touchDrag(page, client, id, x0, y0, dx, dy, holdMs) {
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id }] });
  for (let i = 1; i <= 6; i++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (dx * i) / 6, y: y0 + (dy * i) / 6, id }] });
    await sleep(16);
  }
  await sleep(holdMs);
}

try {
  // ───────────── iPhone 15-ish portrait (393x852 @3x, capped at 2x in-game) ─────────────
  {
    const vp = { width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
    const { page, errors } = await openPage(vp);
    await sleep(800);
    await page.screenshot({ path: `${OUT}/01-menu-iphone.png` });
    let s = await state(page);
    check('main menu shows on fresh load', s.state === 'menu');

    await page.tap('#btn-play');
    await sleep(500);
    s = await state(page);
    check('PLAY starts a run with mass 25', s.state === 'playing' && s.mass === 25 && !s.split, JSON.stringify(s));
    await clearThreats(page);

    const client = await page.target().createCDPSession();
    const x0 = s.x;
    // joystick drag right in left zone
    await touchDrag(page, client, 1, 100, 600, 60, 0, 900);
    let s2 = await state(page);
    check('joystick moves the slime', s2.x > x0 + 50, `dx=${(s2.x - x0).toFixed(1)}`);
    await page.screenshot({ path: `${OUT}/02-gameplay-iphone.png` });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(500);
    const v = await page.evaluate(() => {
      const a = window.__slimeFeast.app.world.active;
      return { input: window.__slimeFeast.app.controls.input, speed: Math.hypot(a.vx, a.vy) };
    });
    check('joystick release stops movement', v.input.x === 0 && v.input.y === 0 && v.speed < 5, `speed=${v.speed.toFixed(2)}`);

    // split disabled below 100
    const splitDisabled = await page.$eval('#btn-split', (b) => b.classList.contains('disabled'));
    check('SPLIT shows disabled below 100 mass', splitDisabled);
    await page.tap('#btn-split');
    s = await state(page);
    check('SPLIT does nothing below 100 mass', !s.split);

    // grow to 500 and test multi-touch: hold joystick + tap split
    await clearThreats(page);
    await page.evaluate(() => {
      window.__slimeFeast.app.world.active.mass = 500;
    });
    await sleep(300);
    const ready = await page.$eval('#btn-split', (b) => !b.classList.contains('disabled'));
    check('SPLIT shows active at >=100 mass', ready);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 600, id: 1 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y: 540, id: 1 }] });
    await sleep(250);
    const btn = await page.$eval('#btn-split', (b) => {
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: 100, y: 540, id: 1 },
        { x: btn.x, y: btn.y, id: 2 },
      ],
    });
    await sleep(60);
    s = await state(page);
    check('multi-touch: SPLIT while holding joystick', s.split === true, JSON.stringify({ m: s.mass, h: s.home }));
    // exact 60/40 arithmetic is covered by unit tests; here a pellet may be eaten in the same frames
    check('split is 60/40', Math.abs(s.home / (s.home + s.mass) - 0.6) < 0.01, JSON.stringify({ m: s.mass, h: s.home }));
    const stillMoving = await page.evaluate(() => window.__slimeFeast.app.controls.input.y < -0.5);
    check('joystick keeps working during split press', stillMoving);
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y: 540, id: 1 }] });
    // press split again while separated
    await page.tap('#btn-split');
    s = await state(page);
    const splits = await page.evaluate(() => window.__slimeFeast.app.world.stats.splits);
    check('cannot split again while separated', s.split && splits === 1, `splits=${splits}`);
    await sleep(900);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(200);
    // move far away so the indicator shows
    await page.evaluate(() => {
      const w = window.__slimeFeast.app.world;
      w.active.x = Math.min(2900, w.home.x + 900);
    });
    await sleep(900);
    const indVisible = await page.$eval('#home-indicator', (e) => !e.classList.contains('hidden'));
    check('stationary indicator visible when home is off-screen', indVisible);
    await page.screenshot({ path: `${OUT}/03-split-indicator-iphone.png` });

    // pause stops simulation
    await page.tap('#btn-pause');
    await sleep(200);
    const p1 = await state(page);
    await sleep(800);
    const p2 = await state(page);
    check('pause stops simulation time', p1.state === 'paused' && p1.time === p2.time);
    await page.screenshot({ path: `${OUT}/04-pause-iphone.png` });

    // rotation: landscape keeps state
    const before = await state(page);
    await page.setViewport({ width: 852, height: 393, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await sleep(600);
    await page.screenshot({ path: `${OUT}/05-landscape-overlay.png` });
    const rot = await page.$eval('#rotate-overlay', (e) => !e.classList.contains('hidden'));
    const mid = await state(page);
    check('landscape shows rotate overlay', rot);
    check('rotation preserves run state', mid.total === before.total && mid.time === before.time && mid.split === before.split);
    await page.setViewport(vp);
    await sleep(600);
    const after = await state(page);
    check('rotating back keeps the same run', after.total === before.total && after.state === 'paused');

    // persistence: reload restores paused run
    await page.evaluate(() => window.__slimeFeast.app.persist());
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__slimeFeast?.app?.world, { timeout: 15000 });
    await sleep(500);
    const restored = await state(page);
    check(
      'reload restores the active run (paused, split intact)',
      restored.state === 'paused' && restored.split === true && restored.total === before.total && Math.abs(restored.time - before.time) < 0.05,
      JSON.stringify(restored),
    );
    await page.screenshot({ path: `${OUT}/06-restored-iphone.png` });

    // resume, then lose the mobile portion
    await page.tap('#btn-resume');
    await sleep(200);
    await page.evaluate(() => {
      const w = window.__slimeFeast.app.world;
      const a = w.active;
      const e = w.addSlime('enemy', a.x, a.y, 5000);
      e.speedJitter = 0;
    });
    await sleep(400);
    s = await state(page);
    check('losing the mobile portion transfers control to the stationary one', s.state === 'playing' && !s.split && s.mass === restored.home, JSON.stringify(s));
    // then lose everything
    await page.evaluate(() => {
      const w = window.__slimeFeast.app.world;
      const a = w.active;
      const e = w.addSlime('enemy', a.x, a.y, 5000);
      e.speedJitter = 0;
    });
    await page.waitForFunction(() => window.__slimeFeast.app.state === 'gameover', { timeout: 6000 }).catch(() => {});
    s = await state(page);
    check('losing the last portion shows game over', s.state === 'gameover');
    await page.screenshot({ path: `${OUT}/07-gameover-iphone.png` });
    const goScore = await page.$eval('#go-score', (e) => e.textContent);
    check('game-over shows stats', goScore !== '');
    const newHighShown = await page.$eval('#go-newhigh', (e) => !e.classList.contains('hidden'));

    const t0 = Date.now();
    await page.tap('#btn-again');
    await sleep(100);
    s = await state(page);
    check('PLAY AGAIN restarts immediately and fully resets', s.state === 'playing' && s.mass === 25 && s.score === 0 && s.time < 0.5 && !s.split, `${Date.now() - t0}ms`);
    const hs = await page.evaluate(() => JSON.parse(localStorage.getItem('slimeFeast.meta')).highScore);
    check('high score persisted', hs > 0, String(hs));
    check('new-high-score badge was shown', newHighShown);

    // FPS sample during normal play
    const fps = await page.evaluate(
      () =>
        new Promise((res) => {
          let n = 0;
          const t = performance.now();
          const f = () => {
            n++;
            if (performance.now() - t < 2000) requestAnimationFrame(f);
            else res((n * 1000) / (performance.now() - t));
          };
          requestAnimationFrame(f);
        }),
    );
    check('frame loop running (headless software GL — not representative of iPhone)', fps > 8, `${fps.toFixed(1)} fps`);
    check('no page errors (iPhone)', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ───────────── Small phone (iPhone SE 375x667) ─────────────
  {
    const vp = { width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
    const { page, errors } = await openPage(vp);
    await sleep(500);
    await page.screenshot({ path: `${OUT}/08-menu-se.png` });
    await page.tap('#btn-play');
    await sleep(1500);
    await page.screenshot({ path: `${OUT}/09-gameplay-se.png` });
    const overlap = await page.evaluate(() => {
      const a = document.getElementById('btn-split').getBoundingClientRect();
      return a.bottom <= innerHeight && a.right <= innerWidth;
    });
    check('SPLIT button fully on-screen on small phone', overlap);
    check('no page errors (SE)', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ───────────── Desktop with keyboard ─────────────
  {
    const vp = { width: 1280, height: 800 };
    const { page, errors } = await openPage(vp);
    await sleep(500);
    await page.screenshot({ path: `${OUT}/10-menu-desktop.png` });
    await page.click('#btn-play');
    await sleep(300);
    await clearThreats(page);
    const a = await state(page);
    await page.keyboard.down('KeyW');
    await sleep(700);
    await page.keyboard.up('KeyW');
    const b = await state(page);
    check('keyboard W moves up', b.y < a.y - 40, `dy=${(b.y - a.y).toFixed(1)}`);
    await page.evaluate(() => (window.__slimeFeast.app.world.active.mass = 200));
    await page.keyboard.press('Space');
    await sleep(100);
    const c = await state(page);
    check('Space triggers split', c.split === true);
    await page.keyboard.press('Escape');
    await sleep(100);
    check('Escape pauses', (await state(page)).state === 'paused');
    await page.keyboard.press('Escape');
    await sleep(100);
    check('Escape resumes', (await state(page)).state === 'playing');
    await sleep(800);
    await page.screenshot({ path: `${OUT}/11-gameplay-desktop.png` });
    check('no page errors (desktop)', errors.length === 0, errors.join(' | '));
    await page.close();
  }
} catch (err) {
  check('QA script crashed', false, String(err?.stack || err));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
