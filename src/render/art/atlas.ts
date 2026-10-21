// Budowa tekstur z grafiki proceduralnej: tileset (2×16 kafli) i atlas sprite'ów (pakowanie półkowe).
// Nazwy klatek są kontraktem – prawdziwy atlas (load.atlas) z tymi samymi nazwami podmienia grafikę bez zmian w kodzie.

import { CONTENT, SEASONS, type BuildingDef, type Content, type NpcDef, type Season } from '../../content/content';
import { ellipse, makeCanvas, rng, rrect, shade, type Ctx2D } from './draw';
import { buildingFrameSize, isBox } from '../iso';
import { drawIsoBuilding } from './isoBuilding';
import { PALETTE, STYLE_NONE, stylize, watercolor, type StyleOptions } from './palette';
import { drawAnimal, drawBuilding, drawCrop, drawIcon, drawItem, drawTree } from './subjects';
import { drawVillager } from './villager';

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
export const PARTICLES = ['p_dirt', 'p_water', 'p_leaf', 'p_coin', 'p_star', 'p_seed', 'p_heart', 'p_snow', 'p_rain', 'p_firefly', 'p_smoke', 'p_butterfly', 'p_petal', 'p_autumn', 'p_sparkle'] as const;
export type ParticleFrame = (typeof PARTICLES)[number];

export const cropFrame = (id: string, stage: number) => `crop_${id}_${stage}`;
export const buildingFrame = (id: string) => `b_${id}`;
export const treeFrame = (kind: 'oak' | 'pine', season: Season) => `tree_${kind}_${season}`;
export const animalFrame = (id: string, f: number) => `animal_${id}_${f}`;
export const itemFrame = (id: string) => `item_${id}`;
export const villagerFrame = (id: string, f: number) => `villager_${id}_${f}`;
export const houseFrame = (id: string) => `house_${id}`;

/** Dom mieszkańca jako bryła izometryczna 2×2 (dach w kolorze postaci). */
export function houseDef(npc: NpcDef): BuildingDef {
  return { id: `house_${npc.id}`, kind: 'home', size: [2, 2], cost: 0, level: 1, art: { wall: '#f6e7cf', roof: npc.color } };
}

// ------------------------------------------------------------------ tileset

const INK_SOFT = 'rgba(74,46,26,0.55)';

/** Pulchna kępka trawy: trzy zaokrąglone listki z ciepłym konturem. */
function tuft(ctx: Ctx2D, x: number, y: number, s: number, fill: string): void {
  ctx.beginPath();
  ctx.moveTo(x - 7 * s, y);
  ctx.quadraticCurveTo(x - 7 * s, y - 9 * s, x - 3 * s, y - 13 * s);
  ctx.quadraticCurveTo(x - 2 * s, y - 6 * s, x, y - 15 * s);
  ctx.quadraticCurveTo(x + 2 * s, y - 6 * s, x + 4 * s, y - 12 * s);
  ctx.quadraticCurveTo(x + 7 * s, y - 8 * s, x + 7 * s, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Kwiatek-gwiazdka z konturem i złotym środkiem. */
function flower(ctx: Ctx2D, x: number, y: number, r: number, col: string): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.55 : r;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK_SOFT;
  ctx.stroke();
  ellipse(ctx, x, y, r * 0.3, r * 0.3, '#ffc94a');
}

function grassTile(ctx: Ctx2D, ox: number, oy: number, base: string, deep: string, seed: number, tufts = 7, winter = false): void {
  ctx.fillStyle = base;
  ctx.fillRect(ox, oy, TILE, TILE);
  const r = rng(seed);
  watercolor(ctx, ox, oy, TILE, TILE, r, winter ? 0.05 : 0.09, 12);
  for (let i = 0; i < tufts; i++) {
    const x = ox + 14 + r() * (TILE - 28);
    const y = oy + 22 + r() * (TILE - 30);
    if (winter) ellipse(ctx, x, y, 8 + r() * 6, 3 + r() * 2, 'rgba(255,255,255,0.85)');
    else tuft(ctx, x, y, 1 + r() * 0.5, r() > 0.5 ? shade(base, -0.08) : shade(base, 0.1));
  }
}

function soilTile(ctx: Ctx2D, ox: number, oy: number, base: string, deep: string, wet: boolean, poor = false): void {
  ctx.fillStyle = shade(PALETTE.grass.spring, -0.1);
  ctx.fillRect(ox, oy, TILE, TILE);
  rrect(ctx, ox + 5, oy + 5, TILE - 10, TILE - 10, 22, base);
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK_SOFT;
  ctx.stroke();
  const r = rng(poor ? 91 : wet ? 92 : 93);
  watercolor(ctx, ox + 5, oy + 5, TILE - 10, TILE - 10, r, 0.1, 8);
  // zaokrąglone grządki (wypukłe wałki z połyskiem)
  for (let i = 0; i < 4; i++) {
    const y = oy + 20 + i * 24;
    rrect(ctx, ox + 14, y, TILE - 28, 15, 8, deep);
    rrect(ctx, ox + 14, y - 1, TILE - 28, 11, 6, shade(base, 0.06));
    rrect(ctx, ox + 20, y + 1, TILE - 44, 3, 2, wet ? 'rgba(200,230,255,0.45)' : 'rgba(255,235,200,0.45)');
  }
  for (let i = 0; i < 5; i++) ellipse(ctx, ox + 16 + r() * 96, oy + 16 + r() * 96, 3, 2.5, 'rgba(255,240,220,0.5)');
  if (poor) {
    ctx.strokeStyle = 'rgba(74,46,26,0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      let x = ox + 24 + r() * 80;
      let y = oy + 24 + r() * 80;
      ctx.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        x += (r() - 0.5) * 22;
        y += (r() - 0.5) * 22;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  if (wet) {
    // mokra: ciemna, z błękitnymi kałużkami i połyskiem
    for (let i = 0; i < 4; i++) {
      const x = ox + 28 + r() * 70;
      const y = oy + 28 + r() * 70;
      ellipse(ctx, x, y, 9, 4.5, 'rgba(120,190,255,0.5)');
      ellipse(ctx, x - 3, y - 1.5, 3, 1.4, 'rgba(235,248,255,0.85)');
    }
  } else {
    // sucha: jasna, spękana i zakurzona
    ctx.strokeStyle = 'rgba(120,80,40,0.45)';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) {
      let x = ox + 22 + r() * 84;
      let y = oy + 22 + r() * 84;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        x += (r() - 0.5) * 16;
        y += (r() - 0.5) * 16;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 6; i++) ellipse(ctx, ox + 16 + r() * 96, oy + 16 + r() * 96, 4, 2.5, 'rgba(255,236,200,0.45)');
  }
}

export function drawTileset(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(TILE * 16, TILE * 2);
  const pos = (i: number): [number, number] => [(i % 16) * TILE, Math.floor(i / 16) * TILE];
  const P = PALETTE;

  SEASONS.forEach((season, s) => {
    const winter = season === 'winter';
    let [x, y] = pos(Tile.grass(s));
    grassTile(ctx, x, y, P.grass[season], P.grassDeep[season], 1 + s, 6, winter);
    [x, y] = pos(Tile.flowers(s));
    grassTile(ctx, x, y, P.grass[season], P.grassDeep[season], 2 + s, 4, winter);
    const rf = rng(7 + s);
    const cols = season === 'autumn' ? ['#ff9f5a', '#ffd166', '#e86a5a'] : winter ? ['#ffffff', '#dff1ff', '#ffffff'] : P.flowers;
    for (let i = 0; i < 5; i++) flower(ctx, x + 18 + rf() * 92, y + 18 + rf() * 92, 6 + rf() * 3, cols[i % cols.length]!);
    [x, y] = pos(Tile.forest(s));
    grassTile(ctx, x, y, P.forest[season], shade(P.forest[season], -0.15), 3 + s, 9, winter);
    [x, y] = pos(Tile.meadow(s));
    grassTile(ctx, x, y, P.meadow[season], P.grass[season], 4 + s, 4, winter);
    if (!winter) {
      const rm = rng(31 + s);
      for (let i = 0; i < 7; i++) flower(ctx, x + 12 + rm() * 104, y + 12 + rm() * 104, 4, season === 'autumn' ? '#ffb347' : P.flowers[i % P.flowers.length]!);
    }
  });

  let [x, y] = pos(Tile.Locked);
  grassTile(ctx, x, y, shade(P.grass.summer, -0.12), shade(P.grass.summer, -0.25), 9, 8);
  ctx.fillStyle = 'rgba(40,30,60,0.12)';
  ctx.fillRect(x, y, TILE, TILE);

  [x, y] = pos(Tile.Unlockable);
  grassTile(ctx, x, y, shade(P.grass.spring, -0.05), P.grassDeep.spring, 10, 6);
  ctx.setLineDash([12, 10]);
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,246,214,0.95)';
  rrect(ctx, x + 12, y + 12, TILE - 24, TILE - 24, 20);
  ctx.stroke();
  ctx.setLineDash([]);

  [x, y] = pos(Tile.Untilled);
  grassTile(ctx, x, y, shade(P.grass.spring, 0.08), P.grass.spring, 11, 5);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(122,74,40,0.45)';
  rrect(ctx, x + 6, y + 6, TILE - 12, TILE - 12, 22);
  ctx.stroke();

  [x, y] = pos(Tile.Tilled);
  soilTile(ctx, x, y, P.soil, P.soilDeep, false);
  [x, y] = pos(Tile.Wet);
  soilTile(ctx, x, y, P.soilWet, P.soilWetDeep, true);
  [x, y] = pos(Tile.TilledPoor);
  soilTile(ctx, x, y, '#d6b08a', '#b68f6a', false, true);
  [x, y] = pos(Tile.WetPoor);
  soilTile(ctx, x, y, '#9a7a62', '#7a5e48', true, true);

  [x, y] = pos(Tile.Path);
  ctx.fillStyle = P.path;
  ctx.fillRect(x, y, TILE, TILE);
  const rp = rng(9);
  watercolor(ctx, x, y, TILE, TILE, rp, 0.07, 8);
  for (let i = 0; i < 9; i++) {
    const px = x + 10 + rp() * 108;
    const py = y + 10 + rp() * 108;
    const rx = 6 + rp() * 8;
    ellipse(ctx, px, py, rx, rx * 0.7, shade(P.path, -0.12 - rp() * 0.1));
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(74,46,26,0.35)';
    ctx.stroke();
    ellipse(ctx, px - rx * 0.3, py - rx * 0.25, rx * 0.35, rx * 0.2, 'rgba(255,255,240,0.5)');
  }

  [x, y] = pos(Tile.Water);
  const gw = ctx.createLinearGradient(x, y, x + TILE, y + TILE);
  gw.addColorStop(0, P.water);
  gw.addColorStop(1, P.waterDeep);
  ctx.fillStyle = gw;
  ctx.fillRect(x, y, TILE, TILE);
  const rw = rng(12);
  watercolor(ctx, x, y, TILE, TILE, rw, 0.08, 10);
  for (let i = 0; i < 6; i++) {
    const wx = x + rw() * 96 + 12;
    const wy = y + rw() * 104 + 10;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.quadraticCurveTo(wx + 7, wy - 6, wx + 14, wy);
    ctx.quadraticCurveTo(wx + 21, wy + 6, wx + 28, wy);
    ctx.stroke();
  }
  for (let i = 0; i < 4; i++) ellipse(ctx, x + rw() * TILE, y + rw() * TILE, 2.5, 2.5, 'rgba(255,255,255,0.9)');

  [x, y] = pos(Tile.Sand);
  ctx.fillStyle = P.sand;
  ctx.fillRect(x, y, TILE, TILE);
  const rs = rng(13);
  watercolor(ctx, x, y, TILE, TILE, rs, 0.07, 8);
  for (let i = 0; i < 16; i++) ellipse(ctx, x + rs() * TILE, y + rs() * TILE, 2, 2, 'rgba(170,130,80,0.4)');
  for (let i = 0; i < 2; i++) flower(ctx, x + 20 + rs() * 88, y + 20 + rs() * 88, 5, '#ffd1e8');
  return c;
}

// ------------------------------------------------------------------ atlas sprite'ów

interface Entry {
  name: string;
  w: number;
  h: number;
  draw: (ctx: Ctx2D, x: number, y: number) => void;
  /** Bajkowy styl klatki (kontur + objętość); domyślnie pełny. */
  style?: StyleOptions;
}

export interface FrameRect {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pakowanie półkowe: sortowanie po wysokości, wiersze od lewej. */
export function shelfPack(sizes: { w: number; h: number }[], width: number, maxHeight = width): { x: number; y: number }[] | null {
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
  return y + rowH <= maxHeight ? out : null;
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
      entries.push({ name: cropFrame(crop.id, stage), w: TILE, h: TILE, draw: (ctx, x, y) => drawCrop(ctx, crop, stage, x + TILE / 2, y + TILE / 2 - 8), style: { outline: 3, shade: true } });
    }
  }
  for (const b of c.buildingList) {
    const emblemId = b.art.emblem;
    const emblem = emblemId ? itemIconDrawer(c, emblemId) : undefined;
    const size = buildingFrameSize(b);
    entries.push({
      name: buildingFrame(b.id),
      w: size.w,
      h: size.h,
      draw: (ctx, x, y) => (isBox(b) ? drawIsoBuilding(ctx, b, x, y, emblem) : drawBuilding(ctx, b, x, y, TILE, emblem)),
      style: { outline: b.kind === 'path' ? 0 : 4, shade: true },
    });
  }
  for (const season of SEASONS) {
    for (const kind of ['oak', 'pine'] as const) {
      entries.push({ name: treeFrame(kind, season), w: TILE, h: 192, draw: (ctx, x, y) => drawTree(ctx, kind, season, x, y, TILE, 192), style: { outline: 3, shade: true } });
    }
  }
  for (const a of c.animalList) {
    for (const f of [0, 1]) entries.push({ name: animalFrame(a.id, f), w: TILE, h: TILE, draw: (ctx, x, y) => drawAnimal(ctx, a, f, x + TILE / 2, y + TILE / 2), style: { outline: 3, shade: true } });
  }
  for (const n of c.npcs) {
    for (const f of [0, 1, 2]) entries.push({ name: villagerFrame(n.id, f), w: TILE, h: TILE, draw: (ctx, x, y) => drawVillager(ctx, n, f, x + TILE / 2, y + TILE / 2), style: { outline: 3, shade: true } });
    const hd = houseDef(n);
    const hs = buildingFrameSize(hd);
    entries.push({ name: houseFrame(n.id), w: hs.w, h: hs.h, draw: (ctx, x, y) => drawIsoBuilding(ctx, hd, x, y), style: { outline: 4, shade: true } });
  }
  for (const icon of ICONS) entries.push({ name: icon, w: TILE, h: TILE, draw: (ctx, x, y) => drawIcon(ctx, icon, x + TILE / 2, y + TILE / 2), style: { outline: 3, shade: false } });
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
      style: { outline: 2, shade: true },
    });
  }
  for (const p of PARTICLES) entries.push({ name: p, w: 32, h: 32, draw: (ctx, x, y) => drawParticle(ctx, p, x + 16, y + 16), style: STYLE_NONE });
  entries.push({ name: 'fog', w: 256, h: 256, draw: (ctx, x, y) => drawFogPuff(ctx, x, y), style: STYLE_NONE });

  // Szerokość 2048, wysokość dopasowana do zawartości (maks. 4096 – limit tekstur na iOS jest wyższy).
  const size = 2048;
  const placed = shelfPack(entries, size, 4096);
  if (!placed) throw new Error('Atlas się nie mieści');
  const usedH = Math.max(...placed.map((p, i) => p.y + entries[i]!.h));
  const [canvas, ctx] = makeCanvas(size, Math.ceil(usedH / 256) * 256);
  const frames: FrameRect[] = entries.map((e, i) => {
    const p = placed[i]!;
    // Każda klatka rysowana osobno, stylizowana (objętość + kontur) i wklejana do atlasu.
    ctx.drawImage(stylize((c2) => e.draw(c2, 0, 0), e.w, e.h, e.style ?? { outline: 3, shade: true }), p.x, p.y);
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
    case 'p_butterfly':
      for (const sgn of [-1, 1]) {
        ellipse(ctx, cx + sgn * 6, cy - 3, 6, 7, '#ffb3d9', sgn * 0.4);
        ellipse(ctx, cx + sgn * 5, cy + 5, 4, 4.5, '#c9b6ff', sgn * 0.3);
        ellipse(ctx, cx + sgn * 6, cy - 4, 2, 2, 'rgba(255,255,255,0.8)');
      }
      rrect(ctx, cx - 1.5, cy - 7, 3, 14, 1.5, '#4a2e1a');
      break;
    case 'p_petal':
      ellipse(ctx, cx, cy, 6, 3.5, '#ffd1e8', 0.6);
      ellipse(ctx, cx - 1, cy - 1, 2.5, 1.2, 'rgba(255,255,255,0.8)', 0.6);
      break;
    case 'p_autumn':
      ellipse(ctx, cx, cy, 8, 4, '#f29a46', 0.8);
      ellipse(ctx, cx + 2, cy + 1, 4, 2, '#d0502a', 0.8);
      break;
    case 'p_sparkle': {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 14);
      g.addColorStop(0, 'rgba(255,255,230,1)');
      g.addColorStop(0.3, 'rgba(255,240,170,0.7)');
      g.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - 16, cy - 16, 32, 32);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 0.75, cy - 9, 1.5, 18);
      ctx.fillRect(cx - 9, cy - 0.75, 18, 1.5);
      break;
    }
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

/** Ikona do HTML: ten sam kod rysujący i ten sam bajkowy styl (kontur + objętość) co w atlasie. */
function iconUrl(key: string, size: number, draw: (ctx: Ctx2D) => void): string {
  const cached = iconCache.get(key);
  if (cached) return cached;
  const url = stylize(draw, size, size, { outline: Math.max(2, Math.round(size / 40)), shade: true }).toDataURL('image/png');
  iconCache.set(key, url);
  return url;
}

/** Data URL ikony przedmiotu do interfejsu HTML. */
export function itemIconUrl(id: string, size = 96, c: Content = CONTENT): string {
  return iconUrl(`${id}@${size}`, size, (ctx) => {
    // margines na kontur
    ctx.translate(size * 0.04, size * 0.04);
    itemIconDrawer(c, id)(ctx, size * 0.92);
  });
}

export function buildingIconUrl(id: string, size = 96, c: Content = CONTENT): string {
  return iconUrl(`b:${id}@${size}`, size, (ctx) => {
    const def = c.buildings[id];
    if (!def) return;
    const { w: fw, h: fh } = buildingFrameSize(def);
    const s = Math.min(size / fw, size / fh) * 0.94;
    ctx.translate((size - fw * s) / 2, (size - fh * s) / 2);
    ctx.scale(s, s);
    const emblem = def.art.emblem ? itemIconDrawer(c, def.art.emblem) : undefined;
    if (isBox(def)) drawIsoBuilding(ctx, def, 0, 0, emblem);
    else drawBuilding(ctx, def, 0, 0, TILE, emblem);
  });
}

export function animalIconUrl(id: string, size = 96, c: Content = CONTENT): string {
  return iconUrl(`a:${id}@${size}`, size, (ctx) => {
    const def = c.animals[id];
    if (!def) return;
    ctx.scale(size / TILE, size / TILE);
    drawAnimal(ctx, def, 0, TILE / 2, TILE / 2);
  });
}

export function villagerIconUrl(id: string, size = 96, c: Content = CONTENT): string {
  return iconUrl(`v:${id}@${size}`, size, (ctx) => {
    const def = c.npc[id];
    if (!def) return;
    // portret: głowa i ramiona, powiększone
    ctx.scale((size / TILE) * 1.45, (size / TILE) * 1.45);
    drawVillager(ctx, def, 0, TILE / 2 / 1.45 + 0, TILE / 2 / 1.45 + 18);
  });
}

export { shade };
