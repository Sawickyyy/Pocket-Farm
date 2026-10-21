// Rysowanie obiektów gry na podstawie opisów "art" z plików JSON (kształt + kolory).

import type { AnimalDef, Art, BuildingDef, CropDef, ItemDef, Season } from '../../content/content';
import { ellipse, leaf, rrect, shade, star, type Ctx2D } from './draw';

// ------------------------------------------------------------------ uprawy

function seedMound(ctx: Ctx2D, cx: number, cy: number): void {
  ellipse(ctx, cx, cy + 22, 34, 14, '#5b3a1e');
  ellipse(ctx, cx, cy + 18, 28, 10, '#7a4f2a');
  for (const [dx, dy] of [[-10, 16], [2, 13], [12, 18]] as const) ellipse(ctx, cx + dx, cy + dy, 4, 3, '#f1e2b0');
}

function sprout(ctx: Ctx2D, cx: number, cy: number, color: string): void {
  ellipse(ctx, cx, cy + 26, 22, 8, 'rgba(60,35,15,0.5)');
  ctx.strokeStyle = shade(color, -0.3);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx, cy + 26);
  ctx.lineTo(cx, cy + 4);
  ctx.stroke();
  leaf(ctx, cx, cy + 6, 22, 11, -0.9, color);
  leaf(ctx, cx, cy + 6, 22, 11, 0.9, color);
}

/** Etap 0–3 lub 4 = zwiędła. */
export function drawCrop(ctx: Ctx2D, def: CropDef, stage: number, cx: number, cy: number): void {
  const { color = '#e2486a', leaf: leafCol = '#5fae3a', shape = 'bulb' } = def.art;
  if (stage === 4) {
    ctx.save();
    ctx.filter = 'grayscale(0.85) brightness(0.75)';
    drawCrop(ctx, def, 2, cx, cy);
    ctx.restore();
    ctx.strokeStyle = '#5b4a32';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 20, cy + 30);
    ctx.lineTo(cx + 18, cy - 6);
    ctx.stroke();
    return;
  }
  if (stage === 0) return seedMound(ctx, cx, cy);
  if (stage === 1) return sprout(ctx, cx, cy, leafCol);
  const ripe = stage === 3;
  ellipse(ctx, cx, cy + 36, 34, 10, 'rgba(40,20,5,0.35)');

  switch (shape) {
    case 'bulb':
      if (ripe) {
        ellipse(ctx, cx, cy + 22, 22, 20, color);
        ellipse(ctx, cx - 7, cy + 15, 7, 5, 'rgba(255,255,255,0.35)');
        ellipse(ctx, cx, cy + 40, 5, 6, '#f6f0e8');
      }
      for (let i = 0; i < 5; i++) leaf(ctx, cx, cy + (ripe ? 6 : 30), ripe ? 40 : 34, 16, -1 + i / 2, leafCol);
      break;
    case 'root':
      if (ripe) {
        ctx.beginPath();
        ctx.moveTo(cx - 18, cy + 14);
        ctx.quadraticCurveTo(cx, cy + 60, cx + 18, cy + 14);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ellipse(ctx, cx, cy + 14, 18, 7, shade(color, 0.2));
      }
      for (let i = 0; i < 7; i++) leaf(ctx, cx, cy + (ripe ? 12 : 32), ripe ? 46 : 38, 7, -0.9 + (i * 1.8) / 6, i % 2 ? leafCol : shade(leafCol, 0.15));
      break;
    case 'grain': {
      const stalks = 7;
      for (let i = 0; i < stalks; i++) {
        const x = cx - 24 + (i * 48) / (stalks - 1);
        const top = cy - (ripe ? 34 : 18) + (i % 2) * 8;
        ctx.strokeStyle = ripe ? shade(color, -0.25) : leafCol;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x, cy + 36);
        ctx.quadraticCurveTo(x + 3, (cy + top) / 2, x + (i - 3.5) * 1.5, top);
        ctx.stroke();
        if (ripe) {
          for (let g = 0; g < 4; g++) {
            ellipse(ctx, x - 4 + (i - 3.5) * 1.5, top + 4 + g * 7, 4, 6, color, -0.5);
            ellipse(ctx, x + 4 + (i - 3.5) * 1.5, top + 4 + g * 7, 4, 6, shade(color, -0.1), 0.5);
          }
        } else leaf(ctx, x, cy + 20, 26, 5, (i - 3.5) * 0.15, leafCol);
      }
      break;
    }
    case 'vine':
      ctx.strokeStyle = shade(leafCol, -0.2);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(cx - 40, cy + 30);
      ctx.bezierCurveTo(cx - 20, cy + 10, cx + 20, cy + 44, cx + 40, cy + 20);
      ctx.stroke();
      for (const [dx, dy, a] of [[-30, 26, -0.6], [30, 22, 0.6], [0, 34, 0]] as const) leaf(ctx, cx + dx, cy + dy, 30, 18, a, leafCol);
      if (ripe) {
        ellipse(ctx, cx - 16, cy + 22, 18, 26, shade(color, -0.12));
        ellipse(ctx, cx + 16, cy + 22, 18, 26, shade(color, -0.12));
        ellipse(ctx, cx, cy + 22, 20, 26, color);
        ellipse(ctx, cx - 6, cy + 10, 6, 10, 'rgba(255,255,255,0.3)');
      } else {
        ellipse(ctx, cx + 4, cy + 22, 10, 9, shade(color, 0.4));
      }
      break;
    case 'bush':
      for (let i = 0; i < 7; i++) leaf(ctx, cx + (i - 3) * 6, cy + 34, ripe ? 44 : 36, 14, (i - 3) * 0.3, i % 2 ? leafCol : shade(leafCol, 0.15));
      if (ripe) {
        for (const [dx, dy] of [[-16, 4], [10, -2], [-2, 16], [18, 18], [-20, 22], [4, 30]] as const) {
          ellipse(ctx, cx + dx, cy + dy, 7, 8, color);
          ellipse(ctx, cx + dx - 2, cy + dy - 3, 2, 2, 'rgba(255,255,255,0.6)');
        }
      }
      break;
    case 'flower':
      ctx.strokeStyle = shade(leafCol, -0.2);
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx, cy + 36);
      ctx.lineTo(cx, cy - (ripe ? 18 : 0));
      ctx.stroke();
      leaf(ctx, cx, cy + 22, 26, 12, -1, leafCol);
      leaf(ctx, cx, cy + 14, 26, 12, 1, leafCol);
      if (ripe) {
        for (let p = 0; p < 12; p++) ellipse(ctx, cx + Math.cos((p * Math.PI) / 6) * 18, cy - 22 + Math.sin((p * Math.PI) / 6) * 18, 8, 5, color, (p * Math.PI) / 6);
        ellipse(ctx, cx, cy - 22, 12, 12, '#6b4220');
      } else ellipse(ctx, cx, cy - 2, 9, 9, shade(leafCol, 0.3));
      break;
    case 'mushroom':
      for (const [dx, s] of [[-16, 0.7], [14, 0.8], [0, 1]] as const) {
        const h = (ripe ? 30 : 18) * s;
        rrect(ctx, cx + dx - 5 * s, cy + 34 - h, 10 * s, h, 4, leafCol);
        ellipse(ctx, cx + dx, cy + 34 - h, (ripe ? 20 : 12) * s, (ripe ? 12 : 8) * s, color);
        if (ripe) ellipse(ctx, cx + dx - 5 * s, cy + 30 - h, 4 * s, 3 * s, 'rgba(255,255,255,0.7)');
      }
      break;
    case 'leafy':
      for (let i = 0; i < 9; i++) leaf(ctx, cx, cy + 34, (ripe ? 46 : 34) - (i % 3) * 6, 18, -1.2 + i * 0.3, i % 2 ? color : leafCol);
      break;
  }
}

// ------------------------------------------------------------------ przedmioty (ikony)

export function drawItem(ctx: Ctx2D, def: ItemDef, crop: CropDef | undefined, size: number): void {
  const s = size / 128;
  ctx.save();
  ctx.scale(s, s);
  if (crop) {
    drawCrop(ctx, crop, 3, 64, 56);
    ctx.restore();
    return;
  }
  const { shape = 'sack', color = '#c9a36a' } = def.art;
  const cx = 64;
  const cy = 64;
  switch (shape) {
    case 'egg':
      ellipse(ctx, cx, cy + 6, 30, 38, color);
      ellipse(ctx, cx - 10, cy - 10, 8, 12, 'rgba(255,255,255,0.6)');
      break;
    case 'bottle':
      rrect(ctx, cx - 22, cy - 18, 44, 64, 12, color);
      rrect(ctx, cx - 10, cy - 44, 20, 28, 6, color);
      rrect(ctx, cx - 12, cy - 50, 24, 10, 4, '#4a7ab8');
      rrect(ctx, cx - 22, cy + 4, 44, 18, 0, '#4a7ab8');
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 3;
      ctx.strokeRect(cx - 22, cy - 18, 44, 64);
      break;
    case 'wool':
      for (const [dx, dy, r] of [[-18, 0, 22], [16, -4, 24], [0, 16, 26], [-4, -16, 20]] as const) ellipse(ctx, cx + dx, cy + dy, r, r, color);
      for (const [dx, dy] of [[-12, -6], [14, 6], [0, 18]] as const) ellipse(ctx, cx + dx, cy + dy, 8, 6, shade(color, -0.08));
      break;
    case 'sack':
      ctx.beginPath();
      ctx.moveTo(cx - 34, cy + 44);
      ctx.quadraticCurveTo(cx - 44, cy - 10, cx - 18, cy - 30);
      ctx.lineTo(cx + 18, cy - 30);
      ctx.quadraticCurveTo(cx + 44, cy - 10, cx + 34, cy + 44);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      rrect(ctx, cx - 20, cy - 42, 40, 14, 6, shade(color, -0.25));
      ellipse(ctx, cx - 12, cy, 8, 14, 'rgba(255,255,255,0.2)');
      break;
    case 'hay':
      rrect(ctx, cx - 40, cy - 26, 80, 60, 10, color);
      for (let i = 0; i < 7; i++) {
        ctx.strokeStyle = shade(color, -0.2);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - 36 + i * 12, cy - 24);
        ctx.lineTo(cx - 30 + i * 12, cy + 32);
        ctx.stroke();
      }
      rrect(ctx, cx - 40, cy - 2, 80, 8, 2, '#8a5a2e');
      break;
    case 'bread':
      ellipse(ctx, cx, cy + 8, 44, 28, color);
      ellipse(ctx, cx, cy, 40, 22, shade(color, 0.15));
      for (const dx of [-20, 0, 20]) {
        ctx.strokeStyle = shade(color, -0.3);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(cx + dx - 6, cy - 10);
        ctx.lineTo(cx + dx + 6, cy + 8);
        ctx.stroke();
      }
      break;
    case 'pie':
      ellipse(ctx, cx, cy + 14, 46, 22, '#c98a3c');
      ellipse(ctx, cx, cy + 6, 42, 18, color);
      for (let i = 0; i < 6; i++) ellipse(ctx, cx - 30 + i * 12, cy + 6, 3, 14, '#f0c070', 0.3);
      break;
    case 'cheese':
      ctx.beginPath();
      ctx.moveTo(cx - 44, cy + 30);
      ctx.lineTo(cx + 44, cy + 30);
      ctx.lineTo(cx + 44, cy - 6);
      ctx.lineTo(cx - 20, cy - 30);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      for (const [dx, dy, r] of [[-10, 8, 7], [20, 14, 5], [26, -2, 4]] as const) ellipse(ctx, cx + dx, cy + dy, r, r, shade(color, -0.2));
      break;
    case 'cloth':
      rrect(ctx, cx - 40, cy - 30, 80, 60, 6, color);
      for (let i = 0; i < 5; i++) rrect(ctx, cx - 40, cy - 26 + i * 12, 80, 4, 0, shade(color, 0.25));
      rrect(ctx, cx + 20, cy - 30, 20, 60, 6, shade(color, -0.15));
      break;
    case 'jar':
      rrect(ctx, cx - 30, cy - 24, 60, 66, 14, color);
      rrect(ctx, cx - 34, cy - 40, 68, 18, 6, '#e8e0d0');
      rrect(ctx, cx - 18, cy - 4, 36, 24, 4, '#f6efe0');
      ellipse(ctx, cx - 16, cy - 10, 5, 12, 'rgba(255,255,255,0.35)');
      break;
    case 'mushroom':
      rrect(ctx, cx - 10, cy - 4, 20, 44, 8, '#f3e2c0');
      ellipse(ctx, cx, cy - 6, 40, 26, color);
      for (const [dx, dy] of [[-16, -12], [10, -16], [20, -2]] as const) ellipse(ctx, cx + dx, cy + dy, 5, 4, 'rgba(255,255,255,0.7)');
      break;
    case 'berry':
      leaf(ctx, cx, cy - 14, 30, 14, -0.5, '#4f9e2f');
      for (const [dx, dy] of [[-16, 6], [10, 0], [0, 20], [18, 20], [-14, 28]] as const) {
        ellipse(ctx, cx + dx, cy + dy, 13, 13, color);
        ellipse(ctx, cx + dx - 4, cy + dy - 4, 3, 3, 'rgba(255,255,255,0.5)');
      }
      break;
    case 'flower':
      ctx.strokeStyle = '#4f9e2f';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx, cy + 50);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      for (let p = 0; p < 6; p++) ellipse(ctx, cx + Math.cos((p * Math.PI) / 3) * 18, cy - 8 + Math.sin((p * Math.PI) / 3) * 18, 13, 13, color);
      ellipse(ctx, cx, cy - 8, 11, 11, '#f2b632');
      break;
    case 'herb':
      for (let i = 0; i < 7; i++) leaf(ctx, cx, cy + 44, 60 - (i % 2) * 14, 12, -0.9 + i * 0.3, i % 2 ? color : shade(color, -0.2));
      break;
    case 'log':
      rrect(ctx, cx - 44, cy - 18, 88, 40, 18, color);
      ellipse(ctx, cx + 38, cy + 2, 14, 20, shade(color, 0.35));
      ellipse(ctx, cx + 38, cy + 2, 7, 10, shade(color, 0.15));
      break;
    case 'shell':
      ctx.beginPath();
      ctx.moveTo(cx, cy + 36);
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI + (i * Math.PI) / 8;
        ctx.lineTo(cx + Math.cos(a) * 44, cy + 10 + Math.sin(a) * 44);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      for (let i = 1; i < 8; i++) {
        const a = Math.PI + (i * Math.PI) / 8;
        ctx.strokeStyle = shade(color, -0.2);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, cy + 36);
        ctx.lineTo(cx + Math.cos(a) * 42, cy + 10 + Math.sin(a) * 42);
        ctx.stroke();
      }
      break;
    case 'fish':
      ctx.beginPath();
      ctx.moveTo(cx + 40, cy);
      ctx.quadraticCurveTo(cx, cy - 34, cx - 32, cy);
      ctx.quadraticCurveTo(cx, cy + 34, cx + 40, cy);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 28, cy);
      ctx.lineTo(cx - 52, cy - 22);
      ctx.lineTo(cx - 52, cy + 22);
      ctx.closePath();
      ctx.fillStyle = shade(color, -0.2);
      ctx.fill();
      ellipse(ctx, cx + 22, cy - 6, 5, 5, '#ffffff');
      ellipse(ctx, cx + 23, cy - 6, 2.5, 2.5, '#222');
      ellipse(ctx, cx, cy + 6, 22, 6, 'rgba(255,255,255,0.25)');
      break;
    default:
      ellipse(ctx, cx, cy, 36, 36, color);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ budynki

const EMBLEM_SIZE = 56;

export function drawBuilding(ctx: Ctx2D, def: BuildingDef, ox: number, oy: number, tile: number, emblem?: (ctx: Ctx2D, size: number) => void): void {
  const [w, h] = def.size;
  const W = w * tile;
  const H = h * tile;
  const roofH = 64;
  const art: Art = def.art;
  const wall = art.wall ?? '#d8c8a8';
  const roof = art.roof ?? '#7a5a3a';
  ctx.save();
  ctx.translate(ox, oy);
  ellipse(ctx, W / 2, roofH + H - 8, W * 0.48, 16, 'rgba(0,0,0,0.25)');

  switch (def.kind) {
    case 'home':
    case 'machine': {
      if (w === 1) {
        // kompostownik: drewniana skrzynia
        rrect(ctx, 14, roofH + 30, W - 28, H - 40, 8, wall);
        for (let i = 0; i < 3; i++) rrect(ctx, 14, roofH + 40 + i * 24, W - 28, 6, 2, shade(wall, -0.25));
        ellipse(ctx, W / 2, roofH + 30, (W - 28) / 2, 10, '#5b3a1e');
        break;
      }
      const wallTop = roofH + 40;
      rrect(ctx, 10, wallTop, W - 20, H - 52, 10, wall);
      for (let y = wallTop + 18; y < roofH + H - 20; y += 22) rrect(ctx, 14, y, W - 28, 3, 1, shade(wall, -0.12));
      // dach
      ctx.beginPath();
      ctx.moveTo(-4, wallTop + 12);
      ctx.lineTo(W / 2, 6);
      ctx.lineTo(W + 4, wallTop + 12);
      ctx.closePath();
      ctx.fillStyle = roof;
      ctx.fill();
      for (let i = 1; i < 5; i++) {
        ctx.strokeStyle = shade(roof, -0.2);
        ctx.lineWidth = 3;
        ctx.beginPath();
        const y = 6 + ((wallTop + 6) * i) / 5;
        const half = ((W / 2 + 4) * i) / 5;
        ctx.moveTo(W / 2 - half, y);
        ctx.lineTo(W / 2 + half, y);
        ctx.stroke();
      }
      // drzwi
      const dw = Math.min(56, W * 0.28);
      rrect(ctx, W / 2 - dw / 2, roofH + H - 12 - 70, dw, 70, 10, shade(wall, -0.45));
      ellipse(ctx, W / 2 + dw / 4, roofH + H - 48, 3, 3, '#f2d27a');
      // emblemat na szczycie
      if (emblem) {
        ellipse(ctx, W / 2, wallTop - 4, EMBLEM_SIZE / 2 + 6, EMBLEM_SIZE / 2 + 6, '#fff8e8');
        ctx.save();
        ctx.translate(W / 2 - EMBLEM_SIZE / 2, wallTop - 4 - EMBLEM_SIZE / 2);
        emblem(ctx, EMBLEM_SIZE);
        ctx.restore();
      }
      if (def.id === 'mill') {
        ctx.save();
        ctx.translate(W - 28, wallTop + 4);
        for (let i = 0; i < 4; i++) {
          ctx.rotate(Math.PI / 2);
          rrect(ctx, -6, 0, 12, 58, 3, '#f0e6d0');
        }
        ctx.restore();
        ellipse(ctx, W - 28, wallTop + 4, 8, 8, '#6b4a2a');
      }
      break;
    }
    case 'sprinkler':
      rrect(ctx, W / 2 - 6, roofH + 50, 12, 56, 4, wall);
      ellipse(ctx, W / 2, roofH + 50, 18, 12, roof);
      for (let i = 0; i < 6; i++) ellipse(ctx, W / 2 + Math.cos(i) * 38, roofH + 44 + Math.sin(i) * 16, 4, 6, 'rgba(120,200,255,0.8)');
      break;
    case 'lantern':
      rrect(ctx, W / 2 - 5, roofH + 20, 10, H - 30, 3, wall);
      rrect(ctx, W / 2 - 18, roofH + 6, 36, 34, 8, '#2b2420');
      rrect(ctx, W / 2 - 12, roofH + 12, 24, 22, 5, roof);
      ellipse(ctx, W / 2, roofH + 23, 20, 20, 'rgba(255,220,140,0.35)');
      break;
    case 'path':
      rrect(ctx, 6, roofH + 6, W - 12, H - 12, 18, wall);
      break;
    case 'deco':
      drawDeco(ctx, def, W, H, roofH);
      break;
  }
  ctx.restore();
}

function drawDeco(ctx: Ctx2D, def: BuildingDef, W: number, H: number, top: number): void {
  const wall = def.art.wall ?? '#a8743f';
  const roof = def.art.roof ?? '#7c5128';
  if (def.id === 'fence') {
    rrect(ctx, 8, top + 54, W - 16, 10, 3, wall);
    rrect(ctx, 8, top + 84, W - 16, 10, 3, wall);
    for (const x of [20, W - 32]) rrect(ctx, x, top + 36, 12, 76, 4, roof);
  } else if (def.id === 'flowers') {
    ellipse(ctx, W / 2, top + H - 26, 50, 22, '#6b4a2a');
    for (let i = 0; i < 9; i++) {
      const x = 22 + (i % 3) * 42;
      const y = top + 70 + Math.floor(i / 3) * 16;
      leaf(ctx, x, y + 14, 18, 7, 0, '#4f9e2f');
      for (let p = 0; p < 5; p++) ellipse(ctx, x + Math.cos(p * 1.256) * 6, y + Math.sin(p * 1.256) * 6, 5, 5, i % 2 ? wall : roof);
    }
  } else if (def.id === 'bench') {
    rrect(ctx, 16, top + 50, W - 32, 18, 6, wall);
    rrect(ctx, 16, top + 76, W - 32, 14, 6, shade(wall, 0.1));
    for (const x of [26, W - 40]) rrect(ctx, x, top + 86, 12, 30, 3, roof);
  } else if (def.id === 'scarecrow') {
    rrect(ctx, W / 2 - 4, top + 40, 8, 80, 3, '#7a4a2a');
    rrect(ctx, W / 2 - 40, top + 58, 80, 8, 3, '#7a4a2a');
    rrect(ctx, W / 2 - 22, top + 52, 44, 44, 10, '#c0503a');
    ellipse(ctx, W / 2, top + 36, 18, 18, '#f0d9a8');
    ellipse(ctx, W / 2, top + 20, 30, 8, wall);
    rrect(ctx, W / 2 - 14, top + 6, 28, 16, 6, wall);
  } else if (def.id.startsWith('statue')) {
    rrect(ctx, 20, top + 86, W - 40, 30, 4, '#bdbdbd');
    rrect(ctx, W / 2 - 16, top + 40, 32, 50, 12, roof);
    ellipse(ctx, W / 2, top + 30, 18, 18, roof);
    star(ctx, W / 2, top + 26, 22, 9, wall);
  }
}

// ------------------------------------------------------------------ drzewa, zwierzęta, ikony

export function drawTree(ctx: Ctx2D, kind: 'oak' | 'pine', season: Season, ox: number, oy: number, w: number, h: number): void {
  const cx = ox + w / 2;
  const base = oy + h - 14;
  ellipse(ctx, cx, base + 4, w * 0.36, 12, 'rgba(0,0,0,0.25)');
  rrect(ctx, cx - 9, base - 52, 18, 54, 5, '#6b4423');
  const snow = season === 'winter';
  if (kind === 'oak') {
    const col = season === 'autumn' ? '#d9822b' : season === 'winter' ? '#7a6a58' : season === 'spring' ? '#6fbf4a' : '#3f8f3a';
    for (const [dx, dy, r] of [[-26, -70, 34], [24, -74, 34], [0, -104, 40], [-6, -64, 36]] as const) ellipse(ctx, cx + dx, base + dy, r, r * 0.9, col);
    ellipse(ctx, cx - 14, base - 112, 14, 10, 'rgba(255,255,255,0.18)');
    if (season === 'spring') for (let i = 0; i < 8; i++) ellipse(ctx, cx - 40 + ((i * 37) % 80), base - 120 + ((i * 23) % 70), 4, 4, '#f7c6dc');
    if (snow) for (const [dx, dy] of [[-20, -96], [18, -100], [0, -132]] as const) ellipse(ctx, cx + dx, base + dy, 22, 9, '#f4f8ff');
  } else {
    const col = snow ? '#2f5f4a' : '#2f6f45';
    for (let i = 0; i < 4; i++) {
      const y = base - 40 - i * 30;
      const half = 46 - i * 10;
      ctx.beginPath();
      ctx.moveTo(cx - half, y);
      ctx.lineTo(cx, y - 46);
      ctx.lineTo(cx + half, y);
      ctx.closePath();
      ctx.fillStyle = shade(col, i * 0.06);
      ctx.fill();
      if (snow) ellipse(ctx, cx, y - 30, half * 0.45, 6, '#f4f8ff');
    }
  }
}

export function drawAnimal(ctx: Ctx2D, def: AnimalDef, frame: number, cx: number, cy: number): void {
  const body = def.art.body ?? '#fff';
  const accent = def.art.accent ?? '#333';
  const step = frame ? 4 : -4;
  ellipse(ctx, cx, cy + 34, 30, 8, 'rgba(0,0,0,0.25)');
  if (def.id === 'chicken') {
    rrect(ctx, cx - 6 + step, cy + 18, 4, 16, 2, '#e8a33a');
    rrect(ctx, cx + 4 - step, cy + 18, 4, 16, 2, '#e8a33a');
    ellipse(ctx, cx, cy + 6, 24, 20, body);
    ellipse(ctx, cx + 18, cy - 14, 12, 12, body);
    ellipse(ctx, cx + 18, cy - 28, 5, 6, accent);
    ctx.beginPath();
    ctx.moveTo(cx + 29, cy - 14);
    ctx.lineTo(cx + 38, cy - 11);
    ctx.lineTo(cx + 29, cy - 8);
    ctx.fillStyle = '#e8a33a';
    ctx.fill();
    ellipse(ctx, cx + 21, cy - 16, 2, 2, '#222');
    ellipse(ctx, cx - 18, cy - 2, 10, 14, shade(body, -0.1), -0.6);
    return;
  }
  const big = def.id === 'cow';
  const W = big ? 44 : 38;
  for (const [dx, s] of [[-W + 12, 1], [-W + 26, -1], [W - 26, 1], [W - 12, -1]] as const) rrect(ctx, cx + dx + step * s, cy + 12, 8, 22, 3, def.id === 'sheep' ? '#3b3330' : body);
  if (def.id === 'sheep') {
    for (const [dx, dy] of [[-22, 0], [0, -6], [22, 0], [-10, 10], [12, 10]] as const) ellipse(ctx, cx + dx, cy + dy, 18, 16, body);
    ellipse(ctx, cx + 34, cy - 6, 12, 14, accent);
    ellipse(ctx, cx + 38, cy - 9, 2, 2, '#fff');
  } else {
    rrect(ctx, cx - W, cy - 18, W * 2, 34, 16, body);
    ellipse(ctx, cx - 12, cy - 6, 12, 9, accent);
    ellipse(ctx, cx + 14, cy + 4, 9, 7, accent);
    rrect(ctx, cx + W - 8, cy - 30, 26, 28, 10, body);
    rrect(ctx, cx + W + 4, cy - 14, 16, 12, 6, '#f2b8b0');
    ellipse(ctx, cx + W + 6, cy - 22, 2, 2, '#222');
    rrect(ctx, cx + W - 6, cy - 38, 4, 10, 2, '#e8dcc0');
    rrect(ctx, cx + W + 12, cy - 38, 4, 10, 2, '#e8dcc0');
  }
}

export function drawIcon(ctx: Ctx2D, name: string, cx: number, cy: number): void {
  switch (name) {
    case 'icon_lock':
      ellipse(ctx, cx, cy, 30, 30, 'rgba(30,40,20,0.45)');
      ctx.strokeStyle = '#f3e7c6';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(cx, cy - 6, 11, Math.PI, 0);
      ctx.stroke();
      rrect(ctx, cx - 16, cy - 6, 32, 24, 5, '#f3c44a');
      ellipse(ctx, cx, cy + 5, 4, 5, '#7a5214');
      break;
    case 'icon_drop':
      ellipse(ctx, cx, cy + 4, 24, 24, 'rgba(255,255,255,0.85)');
      ctx.beginPath();
      ctx.moveTo(cx, cy - 16);
      ctx.bezierCurveTo(cx + 16, cy + 2, cx + 13, cy + 18, cx, cy + 18);
      ctx.bezierCurveTo(cx - 13, cy + 18, cx - 16, cy + 2, cx, cy - 16);
      ctx.fillStyle = '#3a9be0';
      ctx.fill();
      break;
    case 'icon_ready':
      star(ctx, cx, cy, 22, 9, '#fff3a0');
      break;
    case 'icon_bowl':
      ellipse(ctx, cx, cy + 4, 26, 26, 'rgba(255,255,255,0.85)');
      ellipse(ctx, cx, cy + 4, 18, 9, '#c0503a');
      ellipse(ctx, cx, cy, 15, 5, '#e8cf6a');
      break;
    case 'icon_explore':
      ellipse(ctx, cx, cy, 30, 30, 'rgba(20,30,40,0.5)');
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(cx, cy, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy - 12);
      ctx.lineTo(cx + 6, cy);
      ctx.lineTo(cx, cy + 12);
      ctx.lineTo(cx - 6, cy);
      ctx.closePath();
      ctx.fillStyle = '#e2486a';
      ctx.fill();
      break;
    case 'icon_forage':
      ellipse(ctx, cx, cy + 10, 22, 12, '#3f7f2f');
      for (const [dx, dy] of [[-8, 6], [6, 2], [0, 12]] as const) ellipse(ctx, cx + dx, cy + dy, 5, 5, '#e2486a');
      star(ctx, cx + 14, cy - 12, 9, 4, '#fff6b0');
      break;
  }
}
