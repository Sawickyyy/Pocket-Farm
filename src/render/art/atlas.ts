// Budowa tekstur z grafiki proceduralnej: tileset (2×16 kafli) i atlas sprite'ów (pakowanie półkowe).
// Nazwy klatek są kontraktem – prawdziwy atlas (load.atlas) z tymi samymi nazwami podmienia grafikę bez zmian w kodzie.

import { CONTENT, SEASONS, type Content, type Season } from '../../content/content';
import { ellipse, makeCanvas, rng, rrect, shade, type Ctx2D } from './draw';
import { drawAnimal, drawBuilding, drawCrop, drawIcon, drawItem, drawTree } from './subjects';

export const TILE = 128;
export const TILES_KEY = 'tiles';
export const SPRITES_KEY = 'sprites';
export const BUILDING_ROOF = 64;

export const Tile = {
  grass: (s: number) => s * 4,
  flowers: (s: number) => s * 4 + 1,
  forest: (s: number) => s * 4 + 2,
  meadow: (s: number) => s * 4 + 3,
  Locked: 16,
  Unlockable: 17,
  Untilled: 18,
  Tilled: 19,
  Wet: 20,
  TilledPoor: 21,
  WetPoor: 22,
  Path: 23,
  Water: 24,
  Sand: 25,
} as const;

export const ICONS = ['icon_lock', 'icon_drop', 'icon_ready', 'icon_bowl', 'icon_explore', 'icon_forage'] as const;
export const PARTICLES = ['p_dirt', 'p_water', 'p_leaf', 'p_coin', 'p_star', 'p_seed', 'p_heart', 'p_snow', 'p_rain', 'p_firefly', 'p_smoke'] as const;
export type ParticleFrame = (typeof PARTICLES)[number];

export const cropFrame = (id: string, stage: number) => `crop_${id}_${stage}`;
export const buildingFrame = (id: string) => `b_${id}`;
export const treeFrame = (kind: 'oak' | 'pine', season: Season) => `tree_${kind}_${season}`;
export const animalFrame = (id: string, f: number) => `animal_${id}_${f}`;
export const itemFrame = (id: string) => `item_${id}`;

// ------------------------------------------------------------------ tileset

const GRASS: Record<Season, string> = { spring: '#72b852', summer: '#5fa344', autumn: '#a39a48', winter: '#e4ecf2' };
const FOREST: Record<Season, string> = { spring: '#4f8a3c', summer: '#3f7a32', autumn: '#7a6a34', winter: '#c8d4dc' };
const MEADOW: Record<Season, string> = { spring: '#8cc85e', summer: '#7dba52', autumn: '#b8a654', winter: '#eef3f6' };

function grassTile(ctx: Ctx2D, ox: number, oy: number, color: string, seed: number, blades = 26, winter = false): void {
  ctx.fillStyle = color;
  ctx.fillRect(ox, oy, TILE, TILE);
  const r = rng(seed);
  for (let i = 0; i < blades; i++) {
    const x = ox + 6 + r() * (TILE - 12);
    const y = oy + 8 + r() * (TILE - 14);
    if (winter) {
      ellipse(ctx, x, y, 3 + r() * 4, 2 + r() * 2, r() > 0.5 ? 'rgba(255,255,255,0.7)' : 'rgba(160,180,200,0.25)');
      continue;
    }
    ctx.strokeStyle = r() > 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(0,40,0,0.14)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 6, y - 8 - r() * 6);
    ctx.stroke();
  }
}

function soilTile(ctx: Ctx2D, ox: number, oy: number, base: string, furrow: string, hi: string, cracked = false): void {
  ctx.fillStyle = '#5f8f3e';
  ctx.fillRect(ox, oy, TILE, TILE);
  rrect(ctx, ox + 6, oy + 6, TILE - 12, TILE - 12, 16, base);
  for (let i = 0; i < 4; i++) {
    const y = oy + 26 + i * 25;
    rrect(ctx, ox + 16, y, TILE - 32, 9, 5, furrow);
    rrect(ctx, ox + 16, y - 5, TILE - 32, 4, 2, hi);
  }
  if (cracked) {
    ctx.strokeStyle = 'rgba(60,40,20,0.45)';
    ctx.lineWidth = 2;
    const r = rng(77);
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      let x = ox + 20 + r() * 88;
      let y = oy + 20 + r() * 88;
      ctx.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        x += (r() - 0.5) * 24;
        y += (r() - 0.5) * 24;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}

export function drawTileset(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(TILE * 16, TILE * 2);
  const pos = (i: number): [number, number] => [(i % 16) * TILE, Math.floor(i / 16) * TILE];

  SEASONS.forEach((season, s) => {
    const winter = season === 'winter';
    let [x, y] = pos(Tile.grass(s));
    grassTile(ctx, x, y, GRASS[season], 1 + s, 26, winter);
    [x, y] = pos(Tile.flowers(s));
    grassTile(ctx, x, y, GRASS[season], 2 + s, 26, winter);
    if (!winter) {
      const r = rng(7 + s);
      const cols = season === 'autumn' ? ['#e07a2c', '#c9a12a', '#9a4a2a'] : ['#fff6a8', '#ffffff', '#f7a1c4'];
      for (let i = 0; i < 5; i++) {
        const fx = x + 18 + r() * 92;
        const fy = y + 18 + r() * 92;
        for (let p = 0; p < 5; p++) ellipse(ctx, fx + Math.cos(p * 1.256) * 5, fy + Math.sin(p * 1.256) * 5, 4, 4, cols[i % 3]!);
        ellipse(ctx, fx, fy, 3, 3, '#f2b632');
      }
    }
    [x, y] = pos(Tile.forest(s));
    grassTile(ctx, x, y, FOREST[season], 3 + s, 36, winter);
    [x, y] = pos(Tile.meadow(s));
    grassTile(ctx, x, y, MEADOW[season], 4 + s, 18, winter);
    if (!winter) {
      const r = rng(31 + s);
      for (let i = 0; i < 8; i++) ellipse(ctx, x + 10 + r() * 108, y + 10 + r() * 108, 3, 3, season === 'autumn' ? '#d9822b' : '#f7e36a');
    }
  });

  let [x, y] = pos(Tile.Locked);
  grassTile(ctx, x, y, '#4f8a3c', 9, 34);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(x, y, TILE, TILE);

  [x, y] = pos(Tile.Unlockable);
  grassTile(ctx, x, y, '#5c9a45', 10, 30);
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,240,200,0.8)';
  rrect(ctx, x + 10, y + 10, TILE - 20, TILE - 20, 14);
  ctx.stroke();
  ctx.setLineDash([]);

  [x, y] = pos(Tile.Untilled);
  grassTile(ctx, x, y, '#7cbc58', 11, 22);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(90,60,30,0.35)';
  rrect(ctx, x + 6, y + 6, TILE - 12, TILE - 12, 16);
  ctx.stroke();

  [x, y] = pos(Tile.Tilled);
  soilTile(ctx, x, y, '#a8743f', '#7c5128', 'rgba(255,220,170,0.25)');
  [x, y] = pos(Tile.Wet);
  soilTile(ctx, x, y, '#6e4626', '#4a2c15', 'rgba(160,200,255,0.25)');
  [x, y] = pos(Tile.TilledPoor);
  soilTile(ctx, x, y, '#c4a37a', '#a08260', 'rgba(255,240,220,0.3)', true);
  [x, y] = pos(Tile.WetPoor);
  soilTile(ctx, x, y, '#8a7058', '#6a5440', 'rgba(160,200,255,0.25)', true);

  [x, y] = pos(Tile.Path);
  ctx.fillStyle = '#d9c08a';
  ctx.fillRect(x, y, TILE, TILE);
  const rp = rng(9);
  for (let i = 0; i < 14; i++) ellipse(ctx, x + rp() * TILE, y + rp() * TILE, 4 + rp() * 6, 3 + rp() * 4, 'rgba(120,90,50,0.25)');

  [x, y] = pos(Tile.Water);
  ctx.fillStyle = '#3f8fcf';
  ctx.fillRect(x, y, TILE, TILE);
  const rw = rng(12);
  for (let i = 0; i < 7; i++) {
    const wx = x + rw() * 100 + 10;
    const wy = y + rw() * 110 + 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.quadraticCurveTo(wx + 8, wy - 5, wx + 16, wy);
    ctx.stroke();
  }

  [x, y] = pos(Tile.Sand);
  ctx.fillStyle = '#e8d49a';
  ctx.fillRect(x, y, TILE, TILE);
  const rs = rng(13);
  for (let i = 0; i < 20; i++) ellipse(ctx, x + rs() * TILE, y + rs() * TILE, 2, 2, 'rgba(150,120,70,0.35)');
  return c;
}

// ------------------------------------------------------------------ atlas sprite'ów

interface Entry {
  name: string;
  w: number;
  h: number;
  draw: (ctx: Ctx2D, x: number, y: number) => void;
}

export interface FrameRect {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pakowanie półkowe: sortowanie po wysokości, wiersze od lewej. */
export function shelfPack(sizes: { w: number; h: number }[], width: number): { x: number; y: number }[] | null {
  const order = sizes.map((s, i) => ({ ...s, i })).sort((a, b) => b.h - a.h);
  const out: { x: number; y: number }[] = new Array(sizes.length);
  let x = 0;
  let y = 0;
  let rowH = 0;
  const PAD = 2;
  for (const s of order) {
    if (x + s.w > width) {
      x = 0;
      y += rowH + PAD;
      rowH = 0;
    }
    out[s.i] = { x, y };
    x += s.w + PAD;
    rowH = Math.max(rowH, s.h);
  }
  return y + rowH <= width ? out : null;
}

export function itemIconDrawer(c: Content, id: string) {
  const def = c.items[id];
  return (ctx: Ctx2D, size: number) => {
    if (def) drawItem(ctx, def, c.crop[id], size);
  };
}

export function drawSpriteAtlas(c: Content = CONTENT): { canvas: HTMLCanvasElement; frames: FrameRect[] } {
  const entries: Entry[] = [];
  for (const crop of c.crops) {
    for (let stage = 0; stage <= 4; stage++) {
      entries.push({ name: cropFrame(crop.id, stage), w: TILE, h: TILE, draw: (ctx, x, y) => drawCrop(ctx, crop, stage, x + TILE / 2, y + TILE / 2 - 8) });
    }
  }
  for (const b of c.buildingList) {
    const [w, h] = b.size;
    const emblemId = b.art.emblem;
    const emblem = emblemId ? itemIconDrawer(c, emblemId) : undefined;
    entries.push({ name: buildingFrame(b.id), w: w * TILE, h: h * TILE + BUILDING_ROOF, draw: (ctx, x, y) => drawBuilding(ctx, b, x, y, TILE, emblem) });
  }
  for (const season of SEASONS) {
    for (const kind of ['oak', 'pine'] as const) {
      entries.push({ name: treeFrame(kind, season), w: TILE, h: 192, draw: (ctx, x, y) => drawTree(ctx, kind, season, x, y, TILE, 192) });
    }
  }
  for (const a of c.animalList) {
    for (const f of [0, 1]) entries.push({ name: animalFrame(a.id, f), w: TILE, h: TILE, draw: (ctx, x, y) => drawAnimal(ctx, a, f, x + TILE / 2, y + TILE / 2) });
  }
  for (const icon of ICONS) entries.push({ name: icon, w: TILE, h: TILE, draw: (ctx, x, y) => drawIcon(ctx, icon, x + TILE / 2, y + TILE / 2) });
  for (const item of c.itemList) {
    const draw = itemIconDrawer(c, item.id);
    entries.push({
      name: itemFrame(item.id),
      w: 64,
      h: 64,
      draw: (ctx, x, y) => {
        ctx.save();
        ctx.translate(x, y);
        draw(ctx, 64);
        ctx.restore();
      },
    });
  }
  for (const p of PARTICLES) entries.push({ name: p, w: 32, h: 32, draw: (ctx, x, y) => drawParticle(ctx, p, x + 16, y + 16) });
  entries.push({ name: 'fog', w: 256, h: 256, draw: (ctx, x, y) => drawFogPuff(ctx, x, y) });

  const size = 2048;
  const placed = shelfPack(entries, size);
  if (!placed) throw new Error('Atlas się nie mieści');
  const [canvas, ctx] = makeCanvas(size, size);
  const frames: FrameRect[] = entries.map((e, i) => {
    const p = placed[i]!;
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, e.w, e.h);
    ctx.clip();
    e.draw(ctx, p.x, p.y);
    ctx.restore();
    return { name: e.name, x: p.x, y: p.y, w: e.w, h: e.h };
  });
  return { canvas, frames };
}

function drawParticle(ctx: Ctx2D, name: ParticleFrame, cx: number, cy: number): void {
  switch (name) {
    case 'p_dirt':
      ellipse(ctx, cx, cy, 9, 7, '#8a5a2e');
      break;
    case 'p_water':
      ellipse(ctx, cx, cy, 6, 9, '#5fb8f0');
      ellipse(ctx, cx - 2, cy - 2, 2, 3, '#e0f4ff');
      break;
    case 'p_leaf':
      ellipse(ctx, cx, cy, 10, 5, '#6cbf3c', 0.6);
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
    case 'p_heart':
      ellipse(ctx, cx - 5, cy - 3, 6, 6, '#e2486a');
      ellipse(ctx, cx + 5, cy - 3, 6, 6, '#e2486a');
      ctx.beginPath();
      ctx.moveTo(cx - 11, cy - 1);
      ctx.lineTo(cx, cy + 11);
      ctx.lineTo(cx + 11, cy - 1);
      ctx.fillStyle = '#e2486a';
      ctx.fill();
      break;
    case 'p_snow':
      ellipse(ctx, cx, cy, 5, 5, 'rgba(255,255,255,0.95)');
      break;
    case 'p_rain':
      rrect(ctx, cx - 1.5, cy - 12, 3, 24, 2, 'rgba(180,220,255,0.75)');
      break;
    case 'p_firefly':
      ellipse(ctx, cx, cy, 10, 10, 'rgba(255,240,140,0.35)');
      ellipse(ctx, cx, cy, 4, 4, '#fff6b0');
      break;
    case 'p_smoke':
      ellipse(ctx, cx, cy, 12, 12, 'rgba(230,230,230,0.6)');
      break;
  }
}

function drawFogPuff(ctx: Ctx2D, x: number, y: number): void {
  const g = ctx.createRadialGradient(x + 128, y + 128, 10, x + 128, y + 128, 126);
  g.addColorStop(0, 'rgba(236,240,244,1)');
  g.addColorStop(0.6, 'rgba(226,232,238,0.92)');
  g.addColorStop(1, 'rgba(220,228,236,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, 256, 256);
}

// ------------------------------------------------------------------ ikony do HTML

const iconCache = new Map<string, string>();

/** Data URL ikony przedmiotu do interfejsu HTML (rysowane tym samym kodem co w grze). */
export function itemIconUrl(id: string, size = 96, c: Content = CONTENT): string {
  const key = `${id}@${size}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const [canvas, ctx] = makeCanvas(size, size);
  itemIconDrawer(c, id)(ctx, size);
  const url = canvas.toDataURL('image/png');
  iconCache.set(key, url);
  return url;
}

export function buildingIconUrl(id: string, size = 96, c: Content = CONTENT): string {
  const key = `b:${id}@${size}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const def = c.buildings[id];
  const [canvas, ctx] = makeCanvas(size, size);
  if (def) {
    const [w, h] = def.size;
    const fw = w * TILE;
    const fh = h * TILE + BUILDING_ROOF;
    const s = Math.min(size / fw, size / fh);
    ctx.translate((size - fw * s) / 2, (size - fh * s) / 2);
    ctx.scale(s, s);
    const emblem = def.art.emblem ? itemIconDrawer(c, def.art.emblem) : undefined;
    drawBuilding(ctx, def, 0, 0, TILE, emblem);
  }
  const url = canvas.toDataURL('image/png');
  iconCache.set(key, url);
  return url;
}

export function animalIconUrl(id: string, size = 96, c: Content = CONTENT): string {
  const key = `a:${id}@${size}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const [canvas, ctx] = makeCanvas(size, size);
  const def = c.animals[id];
  if (def) {
    ctx.scale(size / TILE, size / TILE);
    drawAnimal(ctx, def, 0, TILE / 2, TILE / 2);
  }
  const url = canvas.toDataURL('image/png');
  iconCache.set(key, url);
  return url;
}

export { shade };
