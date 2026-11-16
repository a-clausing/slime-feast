import Phaser from 'phaser';
import { ENEMY_VARIANTS } from '../core/world';

/** Reference sizes the procedural fallbacks were designed at; loaded sprites are scaled to match. */
export const FOOD_REF = 48;
export const FOOD_BIG_REF = 72;
export const DECOR_REF = 128;
export const FLOOR_REF = 256;

/**
 * Sprite art (public/sprites) is loaded in GameScene.preload(); anything missing falls back
 * to the procedural drawings below.
 *
 * The player slime is drawn after the Monster Merge "LV 1 Slime" reference:
 * translucent lime-green jelly, glowing yellow-green eyes, jagged open mouth,
 * floating inner bubbles. (Placeholder until a transparent sprite of the original art is supplied.)
 */

/** Slime textures are 512px; the hitbox circle maps to SLIME_BODY_R px of texture. */
export const SLIME_TEX = 512;
export const SLIME_BODY_R = 208;
/** Procedural drawing happens in a 256-unit space and is scaled 2x onto the 512 canvas. */
const DRAW_TEX = 256;
const DRAW_R = 104;

interface Palette {
  light: string;
  mid: string;
  dark: string;
  outline: string;
  eye: string;
  eyeGlow: string;
}

const PLAYER: Palette = {
  light: '#c8ff6a',
  mid: '#69d43a',
  dark: '#23761f',
  outline: '#0f3a12',
  eye: '#f6ffb0',
  eyeGlow: 'rgba(214,255,90,0.9)',
};

const ENEMY_PALETTES: Palette[] = [
  { light: '#d6a6ff', mid: '#8e4fe0', dark: '#4a1f8f', outline: '#1e0b3d', eye: '#ffe066', eyeGlow: 'rgba(255,214,80,0.8)' }, // violet
  { light: '#ff9c9c', mid: '#e0384f', dark: '#7d1225', outline: '#33050e', eye: '#fff2a8', eyeGlow: 'rgba(255,240,140,0.8)' }, // crimson
  { light: '#ffd08a', mid: '#f08a24', dark: '#8a3f0b', outline: '#331503', eye: '#fffbe0', eyeGlow: 'rgba(255,250,200,0.8)' }, // ember
  { light: '#9fd8ff', mid: '#3b8fe6', dark: '#173f8a', outline: '#06173a', eye: '#e8fbff', eyeGlow: 'rgba(170,240,255,0.85)' }, // frost
  { light: '#ffa8e6', mid: '#d93fae', dark: '#6e145a', outline: '#2d0524', eye: '#ffffff', eyeGlow: 'rgba(255,200,240,0.8)' }, // magenta
  { light: '#bcbcd8', mid: '#6d6d9a', dark: '#2f2f52', outline: '#101024', eye: '#ff6b6b', eyeGlow: 'rgba(255,90,90,0.85)' }, // shade
];

export const ENEMY_TINTS = [0xa66bff, 0xff4d64, 0xff9a3c, 0x55a8ff, 0xff5cc8, 0x9a9ac8];
export const PLAYER_TINT = 0x8dff4f;

function canvasTex(scene: Phaser.Scene, key: string, w: number, h: number): CanvasRenderingContext2D {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const t = scene.textures.createCanvas(key, w, h)!;
  return t.getContext();
}
function refresh(scene: Phaser.Scene, key: string): void {
  (scene.textures.get(key) as Phaser.Textures.CanvasTexture).refresh();
}

/** Blob outline path: a round dome with a slightly wavy, flattened skirt. */
function blobPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, wav: number, seed: number): void {
  ctx.beginPath();
  const N = 72;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const s = Math.sin(a); // >0 bottom half
    let rr = r;
    if (s > 0) rr = r * (1 - 0.06 * s) + Math.sin(a * 7 + seed) * wav * s;
    else rr = r * (1 + 0.015 * s);
    const x = cx + Math.cos(a) * rr * (1 + 0.04 * Math.max(0, s));
    const y = cy + s * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawBody(ctx: CanvasRenderingContext2D, p: Palette, seed: number, translucent: boolean): void {
  const c = DRAW_TEX / 2;
  const r = DRAW_R;
  // body fill
  blobPath(ctx, c, c, r, 4, seed);
  const g = ctx.createRadialGradient(c - r * 0.35, c - r * 0.45, r * 0.1, c, c + r * 0.1, r * 1.1);
  g.addColorStop(0, p.light);
  g.addColorStop(0.45, p.mid);
  g.addColorStop(1, p.dark);
  ctx.fillStyle = g;
  ctx.globalAlpha = translucent ? 0.93 : 1;
  ctx.fill();
  ctx.globalAlpha = 1;

  // inner depth / cel shading band at the bottom
  ctx.save();
  blobPath(ctx, c, c, r, 4, seed);
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(c + r * 0.15, c + r * 0.95, r * 1.2, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  // floating inner bubbles (jelly look)
  const bubbles = [
    [-0.55, 0.35, 0.09],
    [0.6, 0.2, 0.07],
    [0.35, 0.62, 0.06],
    [-0.2, 0.7, 0.05],
    [0.7, -0.35, 0.05],
  ];
  for (const [bx, by, br] of bubbles) {
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(c + bx * r, c + by * r, br * r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.arc(c + bx * r - br * r * 0.3, c + by * r - br * r * 0.3, br * r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  // rim light
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(c, c, r - 9, Math.PI * 1.08, Math.PI * 1.62);
  ctx.stroke();
  ctx.restore();

  // bold outline
  blobPath(ctx, c, c, r, 4, seed);
  ctx.lineWidth = 7;
  ctx.strokeStyle = p.outline;
  ctx.stroke();

  // glossy specular highlight
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.ellipse(c - r * 0.42, c - r * 0.55, r * 0.22, r * 0.11, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.arc(c - r * 0.15, c - r * 0.72, r * 0.05, 0, Math.PI * 2);
  ctx.fill();
}

function glowEye(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, p: Palette, rot = 0): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, rx * 2.3);
  g.addColorStop(0, p.eyeGlow);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, rx * 2.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = p.outline;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx + 4, ry + 4, 0, 0, Math.PI * 2);
  ctx.fill();
  const eg = ctx.createRadialGradient(-rx * 0.2, -ry * 0.25, 0, 0, 0, rx);
  eg.addColorStop(0, '#ffffff');
  eg.addColorStop(0.35, p.eye);
  eg.addColorStop(1, p.mid);
  ctx.fillStyle = eg;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function playerFace(ctx: CanvasRenderingContext2D): void {
  const c = DRAW_TEX / 2;
  const r = DRAW_R;
  // two big glowing eyes + small side eyes, like the reference
  glowEye(ctx, c - r * 0.36, c - r * 0.12, r * 0.15, r * 0.17, PLAYER, -0.15);
  glowEye(ctx, c + r * 0.3, c - r * 0.16, r * 0.17, r * 0.19, PLAYER, 0.1);
  glowEye(ctx, c + r * 0.74, c - r * 0.08, r * 0.07, r * 0.09, PLAYER, 0.3);
  glowEye(ctx, c - r * 0.76, c - r * 0.02, r * 0.06, r * 0.08, PLAYER, -0.3);
  // angry brow ridges
  ctx.strokeStyle = 'rgba(15,58,18,0.7)';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(c - r * 0.56, c - r * 0.42);
  ctx.quadraticCurveTo(c - r * 0.36, c - r * 0.3, c - r * 0.16, c - r * 0.34);
  ctx.moveTo(c + r * 0.08, c - r * 0.38);
  ctx.quadraticCurveTo(c + r * 0.3, c - r * 0.34, c + r * 0.5, c - r * 0.46);
  ctx.stroke();
  // jagged open mouth
  ctx.beginPath();
  const mx = c - r * 0.1;
  const my = c + r * 0.32;
  const mw = r * 0.62;
  const mh = r * 0.3;
  ctx.moveTo(mx - mw / 2, my - mh * 0.15);
  const teeth = 6;
  for (let i = 1; i <= teeth; i++) {
    const t = i / teeth;
    ctx.lineTo(mx - mw / 2 + mw * (t - 0.5 / teeth), my - mh * (i % 2 ? 0.48 : 0.3));
    ctx.lineTo(mx - mw / 2 + mw * t, my - mh * 0.15 - (i === teeth ? mh * 0.1 : 0));
  }
  ctx.quadraticCurveTo(mx + mw * 0.45, my + mh * 0.75, mx, my + mh * 0.6);
  for (let i = teeth - 1; i >= 0; i--) {
    const t = i / teeth;
    ctx.lineTo(mx - mw / 2 + mw * t + mw / teeth / 2, my + mh * (i % 2 ? 0.3 : 0.42));
  }
  ctx.quadraticCurveTo(mx - mw * 0.5, my + mh * 0.4, mx - mw / 2, my - mh * 0.15);
  ctx.closePath();
  ctx.fillStyle = '#081a07';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = PLAYER.outline;
  ctx.stroke();
}

function enemyFace(ctx: CanvasRenderingContext2D, p: Palette, kind: number): void {
  const c = DRAW_TEX / 2;
  const r = DRAW_R;
  ctx.lineCap = 'round';
  if (kind === 0) {
    // angry slanted eyes with pupils + fangs
    for (const sx of [-1, 1]) {
      const x = c + sx * r * 0.33;
      const y = c - r * 0.12;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.17, r * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.outline;
      ctx.beginPath();
      ctx.arc(x + sx * -r * 0.03, y + r * 0.03, r * 0.075, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 9;
      ctx.strokeStyle = p.outline;
      ctx.beginPath();
      ctx.moveTo(x - sx * r * 0.2, y - r * 0.28);
      ctx.lineTo(x + sx * r * 0.18, y - r * 0.12);
      ctx.stroke();
    }
    ctx.fillStyle = p.outline;
    ctx.beginPath();
    ctx.ellipse(c, c + r * 0.38, r * 0.3, r * 0.13, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(c + sx * r * 0.18, c + r * 0.37);
      ctx.lineTo(c + sx * r * 0.1, c + r * 0.37);
      ctx.lineTo(c + sx * r * 0.14, c + r * 0.5);
      ctx.fill();
    }
  } else if (kind === 1) {
    // single big glowing cyclops eye + grin
    glowEye(ctx, c, c - r * 0.12, r * 0.26, r * 0.26, p);
    ctx.fillStyle = p.outline;
    ctx.beginPath();
    ctx.arc(c, c - r * 0.1, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = p.outline;
    ctx.beginPath();
    ctx.arc(c, c + r * 0.22, r * 0.32, 0.25, Math.PI - 0.25);
    ctx.stroke();
  } else {
    // glowing narrow eyes + wavy mouth
    glowEye(ctx, c - r * 0.32, c - r * 0.1, r * 0.16, r * 0.08, p, 0.35);
    glowEye(ctx, c + r * 0.32, c - r * 0.1, r * 0.16, r * 0.08, p, -0.35);
    ctx.lineWidth = 7;
    ctx.strokeStyle = p.outline;
    ctx.beginPath();
    for (let i = 0; i <= 8; i++) {
      const x = c - r * 0.3 + (i / 8) * r * 0.6;
      const y = c + r * 0.32 + (i % 2 ? r * 0.06 : -r * 0.02);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function makeSoftCircle(scene: Phaser.Scene, key: string, size: number, inner: string, outer: string): void {
  const ctx = canvasTex(scene, key, size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  refresh(scene, key);
}

function makeFood(scene: Phaser.Scene): void {
  if (scene.textures.exists('food0') && scene.textures.exists('foodBig')) return; // sprite art loaded
  const colors = [
    ['#fff1a8', '#ffcf3d'],
    ['#b6fbff', '#3fd7ff'],
    ['#ffc4f2', '#ff5fd2'],
    ['#d9c4ff', '#9b6bff'],
  ];
  colors.forEach(([l, d], i) => {
    const S = 48;
    const ctx = canvasTex(scene, `food${i}`, S, S);
    const c = S / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, d + 'aa');
    g.addColorStop(1, d + '00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // little gem
    ctx.beginPath();
    ctx.moveTo(c, c - 12);
    ctx.lineTo(c + 9, c);
    ctx.lineTo(c, c + 12);
    ctx.lineTo(c - 9, c);
    ctx.closePath();
    ctx.fillStyle = d;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(20,10,30,0.8)';
    ctx.stroke();
    ctx.fillStyle = l;
    ctx.beginPath();
    ctx.moveTo(c, c - 12);
    ctx.lineTo(c + 4, c - 2);
    ctx.lineTo(c - 4, c - 2);
    ctx.fill();
    refresh(scene, `food${i}`);
  });
  // big golden crystal
  const S = 72;
  const ctx = canvasTex(scene, 'foodBig', S, S);
  const c = S / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,220,90,0.75)');
  g.addColorStop(1, 'rgba(255,180,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? 13 : 18;
    ctx.lineTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr);
  }
  ctx.closePath();
  const gg = ctx.createLinearGradient(c, c - 18, c, c + 18);
  gg.addColorStop(0, '#fff8c4');
  gg.addColorStop(1, '#f5a400');
  ctx.fillStyle = gg;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#3a2000';
  ctx.stroke();
  refresh(scene, 'foodBig');
}

function makeFloor(scene: Phaser.Scene): void {
  if (scene.textures.exists('floor')) return;
  const S = 256;
  const ctx = canvasTex(scene, 'floor', S, S);
  ctx.fillStyle = '#1c1229';
  ctx.fillRect(0, 0, S, S);
  // 2x2 slabs, each with its own shade; mortar lines on edges (seamless)
  const shades = ['#251838', '#21152f', '#28193b', '#1f1430'];
  for (let i = 0; i < 4; i++) {
    const x = (i % 2) * 128;
    const y = Math.floor(i / 2) * 128;
    ctx.fillStyle = shades[i];
    ctx.fillRect(x + 3, y + 3, 122, 122);
    const g = ctx.createLinearGradient(x, y, x + 128, y + 128);
    g.addColorStop(0, 'rgba(255,255,255,0.035)');
    g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(x + 3, y + 3, 122, 122);
  }
  // speckle noise (deterministic)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.12)';
    ctx.fillRect(rnd() * S, rnd() * S, 2, 2);
  }
  // cracks within slabs
  ctx.strokeStyle = 'rgba(8,4,14,0.75)';
  ctx.lineWidth = 1.5;
  for (let k = 0; k < 3; k++) {
    const sx = (k % 2) * 128 + 20 + rnd() * 60;
    const sy = Math.floor(k / 2) * 128 + 20 + rnd() * 60;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    let x = sx;
    let y = sy;
    for (let j = 0; j < 5; j++) {
      x += (rnd() - 0.3) * 18;
      y += (rnd() - 0.3) * 18;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  refresh(scene, 'floor');
}

/** Decorations: 0 crystal cluster, 1 glowing mushrooms, 2 rune circle, 3 rubble, 4 bones */
function makeDecor(scene: Phaser.Scene): void {
  if (scene.textures.exists('decor0')) return;
  const S = 128;
  // 0 crystals
  let ctx = canvasTex(scene, 'decor0', S, S);
  let g = ctx.createRadialGradient(64, 80, 0, 64, 80, 64);
  g.addColorStop(0, 'rgba(160,90,255,0.35)');
  g.addColorStop(1, 'rgba(160,90,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  for (const [x, h, w, a] of [
    [64, 54, 14, 0],
    [46, 36, 10, -0.35],
    [82, 40, 11, 0.3],
    [56, 26, 8, -0.7],
  ]) {
    ctx.save();
    ctx.translate(x, 92);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.lineTo(-w * 0.8, -h * 0.75);
    ctx.lineTo(0, -h);
    ctx.lineTo(w * 0.8, -h * 0.75);
    ctx.lineTo(w, 0);
    ctx.closePath();
    const cg = ctx.createLinearGradient(-w, 0, w, -h);
    cg.addColorStop(0, '#5b2ca8');
    cg.addColorStop(1, '#d9b8ff');
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.strokeStyle = '#1a0a33';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }
  refresh(scene, 'decor0');

  // 1 mushrooms
  ctx = canvasTex(scene, 'decor1', S, S);
  g = ctx.createRadialGradient(64, 70, 0, 64, 70, 60);
  g.addColorStop(0, 'rgba(60,230,255,0.3)');
  g.addColorStop(1, 'rgba(60,230,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  for (const [x, y, s] of [
    [52, 84, 1],
    [78, 90, 0.75],
    [66, 100, 0.55],
  ]) {
    ctx.fillStyle = '#cfd7e6';
    ctx.strokeStyle = '#121626';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x - 4 * s, y - 18 * s, 8 * s, 20 * s, 3);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, y - 18 * s, 18 * s, 12 * s, 0, Math.PI, 0);
    ctx.closePath();
    const mg = ctx.createLinearGradient(x, y - 30 * s, x, y - 18 * s);
    mg.addColorStop(0, '#9ff6ff');
    mg.addColorStop(1, '#1aa7c9');
    ctx.fillStyle = mg;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(x - 6 * s, y - 24 * s, 2.5 * s, 0, Math.PI * 2);
    ctx.arc(x + 5 * s, y - 22 * s, 2 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  refresh(scene, 'decor1');

  // 2 rune circle
  ctx = canvasTex(scene, 'decor2', S, S);
  ctx.strokeStyle = 'rgba(150,110,255,0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(64, 64, 40, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    ctx.lineTo(64 + Math.cos(a) * 40, 64 + Math.sin(a) * 40);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = 'rgba(170,130,255,0.4)';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.fillRect(64 + Math.cos(a) * 46 - 2, 64 + Math.sin(a) * 46 - 2, 4, 4);
  }
  refresh(scene, 'decor2');

  // 3 rubble
  ctx = canvasTex(scene, 'decor3', S, S);
  for (const [x, y, w, h] of [
    [44, 70, 26, 18],
    [72, 78, 30, 20],
    [60, 56, 18, 14],
    [86, 60, 14, 11],
  ]) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x + 3, y + 6, w / 2, h / 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a2d4d';
    ctx.strokeStyle = '#110a1b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x - w / 2 + 3, y - h / 2 + 3, w - 6, 4);
  }
  refresh(scene, 'decor3');

  // 4 bones
  ctx = canvasTex(scene, 'decor4', S, S);
  const bone = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.strokeStyle = '#120c1a';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = '#d8cdbd';
    ctx.lineWidth = 5;
    ctx.stroke();
    for (const [x, y] of [
      [x1, y1],
      [x2, y2],
    ]) {
      ctx.fillStyle = '#d8cdbd';
      ctx.strokeStyle = '#120c1a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x - 3, y, 5, 0, Math.PI * 2);
      ctx.arc(x + 3, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  bone(36, 60, 86, 80);
  bone(50, 92, 92, 50);
  refresh(scene, 'decor4');
}

function makeSlimes(scene: Phaser.Scene): void {
  let ctx: CanvasRenderingContext2D;
  // Player: the supplied top-down Slime sprite (public/sprites/slime-player.png), loaded in preload().
  // Fallback to the procedural placeholder if it failed to load.
  if (!scene.textures.exists('slimePlayer')) {
    ctx = canvasTex(scene, 'slimePlayer', SLIME_TEX, SLIME_TEX);
    ctx.scale(SLIME_TEX / DRAW_TEX, SLIME_TEX / DRAW_TEX);
    drawBody(ctx, PLAYER, 1.3, true);
    playerFace(ctx);
    refresh(scene, 'slimePlayer');
  }

  for (let v = 0; v < ENEMY_VARIANTS; v++) {
    if (scene.textures.exists(`slimeEnemy${v}`)) continue; // sprite art loaded
    const p = ENEMY_PALETTES[v % ENEMY_PALETTES.length];
    ctx = canvasTex(scene, `slimeEnemy${v}`, SLIME_TEX, SLIME_TEX);
    ctx.scale(SLIME_TEX / DRAW_TEX, SLIME_TEX / DRAW_TEX);
    drawBody(ctx, p, v * 2.1, false);
    enemyFace(ctx, p, v % 3);
    refresh(scene, `slimeEnemy${v}`);
  }

  // dashed "home" ring for the stationary portion
  const S = 256;
  ctx = canvasTex(scene, 'homeRing', S, S);
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(190,255,120,0.9)';
  ctx.setLineDash([22, 16]);
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 8, 0, Math.PI * 2);
  ctx.stroke();
  refresh(scene, 'homeRing');

  // shadow
  ctx = canvasTex(scene, 'shadow', 128, 64);
  const g = ctx.createRadialGradient(64, 32, 0, 64, 32, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.save();
  ctx.scale(1, 0.5);
  ctx.fillRect(0, 0, 128, 128);
  ctx.restore();
  refresh(scene, 'shadow');
}

export function generateTextures(scene: Phaser.Scene): void {
  makeSlimes(scene);
  makeFood(scene);
  makeFloor(scene);
  makeDecor(scene);
  makeSoftCircle(scene, 'glow', 128, 'rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
  makeSoftCircle(scene, 'spark', 32, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');
  // ring for recombine/warnings
  const ctx = canvasTex(scene, 'ring', 128, 128);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.stroke();
  refresh(scene, 'ring');
}
