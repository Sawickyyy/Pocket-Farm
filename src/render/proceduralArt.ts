// Grafika zastępcza rysowana Canvas 2D. Nazwy klatek są kontraktem z resztą kodu:
// żeby podmienić na prawdziwy atlas, wystarczy załadować `this.load.atlas(SPRITES_KEY, ...)`
// z tymi samymi nazwami klatek i tileset 8×1 kafli 128 px pod kluczem TILES_KEY.

import { CROP_IDS, GROWTH_STAGES, type CropId } from '../game/content';

export const TILE = 128;
export const TILES_KEY = 'tiles';
export const SPRITES_KEY = 'sprites';

/** Indeksy kafli w tilesecie. */
export const Tile = {
  Grass: 0,
  GrassFlowers: 1,
  Locked: 2,
  Unlockable: 3,
  Untilled: 4,
  Tilled: 5,
  Wet: 6,
  Path: 7,
} as const;

export const PARTICLE = 32;
export const PARTICLE_FRAMES = ['p_dirt', 'p_water', 'p_leaf', 'p_coin', 'p_star', 'p_seed'] as const;
export type ParticleFrame = (typeof PARTICLE_FRAMES)[number];
export const ICON_FRAMES = ['icon_lock', 'icon_drop', 'icon_ready'] as const;
export type IconFrame = (typeof ICON_FRAMES)[number];

export const cropFrame = (crop: CropId, stage: number): string => `${crop}_${stage}`;

export interface FrameRect {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// ------------------------------------------------------------------ narzędzia

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D niedostępny');
  return [c, ctx];
}

/** Deterministyczny pseudolosowy generator – ta sama grafika przy każdym uruchomieniu. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, width: number, angle: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(width, -len * 0.5, 0, -len);
  ctx.quadraticCurveTo(-width, -len * 0.5, 0, 0);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,60,20,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(0, -len * 0.85);
  ctx.stroke();
  ctx.restore();
}

// ------------------------------------------------------------------ kafle

function grassBase(ctx: CanvasRenderingContext2D, ox: number, color: string, seed: number, blades = 26): void {
  ctx.fillStyle = color;
  ctx.fillRect(ox, 0, TILE, TILE);
  const r = rng(seed);
  for (let i = 0; i < blades; i++) {
    const x = ox + 6 + r() * (TILE - 12);
    const y = 8 + r() * (TILE - 14);
    ctx.strokeStyle = r() > 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(0,40,0,0.14)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 6, y - 8 - r() * 6);
    ctx.stroke();
  }
}

function soil(ctx: CanvasRenderingContext2D, ox: number, base: string, furrow: string, highlight: string): void {
  const inset = 6;
  ctx.fillStyle = '#5f8f3e';
  ctx.fillRect(ox, 0, TILE, TILE);
  roundRect(ctx, ox + inset, inset, TILE - inset * 2, TILE - inset * 2, 16);
  ctx.fillStyle = base;
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    const y = 26 + i * 25;
    roundRect(ctx, ox + 16, y, TILE - 32, 9, 5);
    ctx.fillStyle = furrow;
    ctx.fill();
    roundRect(ctx, ox + 16, y - 5, TILE - 32, 4, 2);
    ctx.fillStyle = highlight;
    ctx.fill();
  }
}

export function drawTileset(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(TILE * 8, TILE);

  grassBase(ctx, Tile.Grass * TILE, '#6aa84f', 1);

  grassBase(ctx, Tile.GrassFlowers * TILE, '#6aa84f', 2);
  const r = rng(7);
  for (let i = 0; i < 5; i++) {
    const x = Tile.GrassFlowers * TILE + 18 + r() * 92;
    const y = 18 + r() * 92;
    const col = ['#fff6a8', '#ffffff', '#f7a1c4'][i % 3] ?? '#fff';
    for (let p = 0; p < 5; p++) ellipse(ctx, x + Math.cos(p * 1.256) * 5, y + Math.sin(p * 1.256) * 5, 4, 4, col);
    ellipse(ctx, x, y, 3, 3, '#f2b632');
  }

  // Zablokowane pole: ciemniejsza trawa z płotkiem.
  const lx = Tile.Locked * TILE;
  grassBase(ctx, lx, '#4f8a3c', 3, 34);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(lx, 0, TILE, TILE);

  // Pole do odblokowania: trawa z kropkowaną ramką.
  const ux = Tile.Unlockable * TILE;
  grassBase(ctx, ux, '#5c9a45', 4, 30);
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,240,200,0.75)';
  roundRect(ctx, ux + 10, 10, TILE - 20, TILE - 20, 14);
  ctx.stroke();
  ctx.setLineDash([]);

  // Odblokowane, nieorane: jasna trawa z subtelną ramką grządki.
  const nx = Tile.Untilled * TILE;
  grassBase(ctx, nx, '#7cbc58', 5, 22);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(90,60,30,0.35)';
  roundRect(ctx, nx + 6, 6, TILE - 12, TILE - 12, 16);
  ctx.stroke();

  soil(ctx, Tile.Tilled * TILE, '#a8743f', '#7c5128', 'rgba(255,220,170,0.25)');
  soil(ctx, Tile.Wet * TILE, '#6e4626', '#4a2c15', 'rgba(160,200,255,0.25)');

  const px = Tile.Path * TILE;
  ctx.fillStyle = '#d9c08a';
  ctx.fillRect(px, 0, TILE, TILE);
  const rp = rng(9);
  for (let i = 0; i < 14; i++) ellipse(ctx, px + rp() * TILE, rp() * TILE, 4 + rp() * 6, 3 + rp() * 4, 'rgba(120,90,50,0.25)');

  return c;
}

// ------------------------------------------------------------------ rośliny

function drawSeedMound(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ellipse(ctx, cx, cy + 22, 34, 14, '#5b3a1e');
  ellipse(ctx, cx, cy + 18, 28, 10, '#7a4f2a');
  for (const [dx, dy] of [[-10, 16], [2, 13], [12, 18]] as const) ellipse(ctx, cx + dx, cy + dy, 4, 3, '#f1e2b0');
}

function drawSprout(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
  ellipse(ctx, cx, cy + 26, 22, 8, 'rgba(60,35,15,0.5)');
  ctx.strokeStyle = '#4c8a2e';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx, cy + 26);
  ctx.lineTo(cx, cy + 4);
  ctx.stroke();
  leaf(ctx, cx, cy + 6, 22, 11, -0.9, color);
  leaf(ctx, cx, cy + 6, 22, 11, 0.9, color);
}

function drawCrop(ctx: CanvasRenderingContext2D, crop: CropId, stage: number, cx: number, cy: number): void {
  if (stage === 0) return drawSeedMound(ctx, cx, cy);
  if (stage === 1) return drawSprout(ctx, cx, cy, crop === 'wheat' ? '#9ccc4a' : '#6cbf3c');

  const shadow = () => ellipse(ctx, cx, cy + 36, 34, 10, 'rgba(40,20,5,0.35)');
  const ripe = stage === 3;

  switch (crop) {
    case 'radish': {
      shadow();
      if (ripe) {
        ellipse(ctx, cx, cy + 22, 22, 20, '#e2486a');
        ellipse(ctx, cx - 7, cy + 15, 7, 5, 'rgba(255,255,255,0.35)');
        ellipse(ctx, cx, cy + 40, 5, 6, '#f6f0e8');
      }
      const n = ripe ? 5 : 4;
      for (let i = 0; i < n; i++) leaf(ctx, cx, cy + (ripe ? 6 : 30), ripe ? 40 : 34, 16, -1 + (i * 2) / (n - 1), '#5fae3a');
      break;
    }
    case 'carrot': {
      shadow();
      if (ripe) {
        ctx.beginPath();
        ctx.moveTo(cx - 18, cy + 14);
        ctx.quadraticCurveTo(cx, cy + 60, cx + 18, cy + 14);
        ctx.closePath();
        ctx.fillStyle = '#f08a24';
        ctx.fill();
        ellipse(ctx, cx, cy + 14, 18, 7, '#f6a04a');
      }
      for (let i = 0; i < 7; i++) {
        const a = -0.9 + (i * 1.8) / 6;
        leaf(ctx, cx, cy + (ripe ? 12 : 32), ripe ? 46 : 38, 7, a, i % 2 ? '#4f9e2f' : '#68b83d');
      }
      break;
    }
    case 'wheat': {
      shadow();
      const stalks = ripe ? 7 : 6;
      for (let i = 0; i < stalks; i++) {
        const x = cx - 24 + (i * 48) / (stalks - 1);
        const top = cy - (ripe ? 34 : 18) + (i % 2) * 8;
        ctx.strokeStyle = ripe ? '#c99a2e' : '#7dbb3f';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x, cy + 36);
        ctx.quadraticCurveTo(x + 3, (cy + top) / 2, x + (i - stalks / 2) * 1.5, top);
        ctx.stroke();
        if (ripe) {
          for (let g = 0; g < 4; g++) {
            ellipse(ctx, x - 4 + (i - stalks / 2) * 1.5, top + 4 + g * 7, 4, 6, '#f0cc5a', -0.5);
            ellipse(ctx, x + 4 + (i - stalks / 2) * 1.5, top + 4 + g * 7, 4, 6, '#e4b844', 0.5);
          }
        } else {
          leaf(ctx, x, cy + 20, 26, 5, (i - stalks / 2) * 0.15, '#8fcc4a');
        }
      }
      break;
    }
    case 'pumpkin': {
      shadow();
      ctx.strokeStyle = '#3f8a2a';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(cx - 40, cy + 30);
      ctx.bezierCurveTo(cx - 20, cy + 10, cx + 20, cy + 44, cx + 40, cy + 20);
      ctx.stroke();
      for (const [dx, dy, a] of [[-30, 26, -0.6], [30, 22, 0.6], [0, 34, 0]] as const) leaf(ctx, cx + dx, cy + dy, 30, 18, a, '#4f9e33');
      if (ripe) {
        for (const [dx, rx, col] of [[-16, 18, '#d8661a'], [16, 18, '#d8661a'], [0, 20, '#ef8326']] as const) {
          ellipse(ctx, cx + dx, cy + 22, rx, 26, col);
        }
        ellipse(ctx, cx - 6, cy + 10, 6, 10, 'rgba(255,255,255,0.25)');
        roundRect(ctx, cx - 4, cy - 10, 8, 12, 3);
        ctx.fillStyle = '#5a7a2a';
        ctx.fill();
      } else {
        ellipse(ctx, cx + 4, cy + 22, 10, 9, '#9ccf4a');
        for (let p = 0; p < 5; p++) ellipse(ctx, cx - 18 + Math.cos(p * 1.256) * 6, cy + 8 + Math.sin(p * 1.256) * 6, 5, 5, '#f7d23a');
      }
      break;
    }
  }
}

// ------------------------------------------------------------------ ikony i cząsteczki

function drawIcon(ctx: CanvasRenderingContext2D, name: IconFrame, cx: number, cy: number): void {
  if (name === 'icon_lock') {
    ellipse(ctx, cx, cy, 30, 30, 'rgba(30,40,20,0.45)');
    ctx.strokeStyle = '#f3e7c6';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy - 6, 11, Math.PI, 0);
    ctx.stroke();
    roundRect(ctx, cx - 16, cy - 6, 32, 24, 5);
    ctx.fillStyle = '#f3c44a';
    ctx.fill();
    ellipse(ctx, cx, cy + 5, 4, 5, '#7a5214');
  } else if (name === 'icon_drop') {
    ellipse(ctx, cx, cy + 4, 24, 24, 'rgba(255,255,255,0.85)');
    ctx.beginPath();
    ctx.moveTo(cx, cy - 16);
    ctx.bezierCurveTo(cx + 16, cy + 2, cx + 13, cy + 18, cx, cy + 18);
    ctx.bezierCurveTo(cx - 13, cy + 18, cx - 16, cy + 2, cx, cy - 16);
    ctx.fillStyle = '#3a9be0';
    ctx.fill();
    ellipse(ctx, cx - 4, cy + 6, 3, 5, 'rgba(255,255,255,0.7)');
  } else {
    ctx.fillStyle = '#fff3a0';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 9 : 22;
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  }
}

function drawParticle(ctx: CanvasRenderingContext2D, name: ParticleFrame, cx: number, cy: number): void {
  switch (name) {
    case 'p_dirt':
      ellipse(ctx, cx, cy, 9, 7, '#8a5a2e');
      break;
    case 'p_water':
      ellipse(ctx, cx, cy, 6, 9, '#5fb8f0');
      ellipse(ctx, cx - 2, cy - 2, 2, 3, '#e0f4ff');
      break;
    case 'p_leaf':
      leaf(ctx, cx, cy + 10, 20, 8, 0.4, '#6cbf3c');
      break;
    case 'p_coin':
      ellipse(ctx, cx, cy, 11, 11, '#f2b632');
      ellipse(ctx, cx, cy, 7, 7, '#ffd75e');
      break;
    case 'p_star':
      drawIcon(ctx, 'icon_ready', cx, cy);
      break;
    case 'p_seed':
      ellipse(ctx, cx, cy, 5, 4, '#f1e2b0');
      break;
  }
}

export function drawSpriteAtlas(): { canvas: HTMLCanvasElement; frames: FrameRect[] } {
  const size = 1024;
  const [c, ctx] = makeCanvas(size, size);
  const frames: FrameRect[] = [];
  let slot = 0;
  const cellsPerRow = size / TILE;
  const nextCell = (): [number, number] => {
    const x = (slot % cellsPerRow) * TILE;
    const y = Math.floor(slot / cellsPerRow) * TILE;
    slot++;
    return [x, y];
  };

  for (const crop of CROP_IDS) {
    for (let stage = 0; stage < GROWTH_STAGES; stage++) {
      const [x, y] = nextCell();
      drawCrop(ctx, crop, stage, x + TILE / 2, y + TILE / 2 - 8);
      frames.push({ name: cropFrame(crop, stage), x, y, w: TILE, h: TILE });
    }
  }
  for (const icon of ICON_FRAMES) {
    const [x, y] = nextCell();
    drawIcon(ctx, icon, x + TILE / 2, y + TILE / 2);
    frames.push({ name: icon, x, y, w: TILE, h: TILE });
  }
  // Cząsteczki w jednym rzędzie 32 px pod resztą.
  const py = Math.ceil(slot / cellsPerRow) * TILE;
  PARTICLE_FRAMES.forEach((name, i) => {
    const x = i * PARTICLE;
    drawParticle(ctx, name, x + PARTICLE / 2, py + PARTICLE / 2);
    frames.push({ name, x, y: py, w: PARTICLE, h: PARTICLE });
  });

  return { canvas: c, frames };
}
