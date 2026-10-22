// Grafika budynków osady (docs/plan-osada.md §15): domy z wariantami wyglądu, miejsca pracy, infrastruktura, usługi,
// rusztowania budowy i zgliszcza. Wszystko to bryły izometryczne zakotwiczone w tylnym narożniku podstawy
// (iso.ts: boxPlacement), rysowane jednym pędzlem: ściana frontowa (L→B), prawa (B→R), dach i dodatki.

import type { BuildingDef, Content } from '../../content/content';
import { ISO_HH, ISO_HW, ISO_PAD, WALL, boxFrameSize, isBox, siteVertical, verticalExtent } from '../iso';
import type { Entry } from './atlas';
import { ellipse, rrect, shade, star, type Ctx2D } from './draw';
import { INK } from './palette';
import { drawItem } from './subjects';

/** Klatka budynku z wariantem wyglądu (`b_<id>_<style>`); budynki bez wariantów: `b_<id>`. */
export const styleFrame = (id: string, style: number): string => `b_${id}_${style}`;
/** Rusztowanie budowy dla obrysu w×h kafli. */
export const siteFrame = (w: number, h: number): string => `site_${w}x${h}`;
/** Zgliszcza / uszkodzony budynek dla obrysu w×h. */
export const ruinFrame = (w: number, h: number): string => `ruin_${w}x${h}`;
/** Rozmiary obrysów, dla których są rusztowania i zgliszcza. */
export const SITE_SIZES: readonly [number, number][] = [
  [1, 1],
  [2, 2],
  [3, 3],
];

/** Nazwa klatki do narysowania obiektu (z wariantem, jeśli budynek go ma). */
export function frameFor(def: BuildingDef, style: number | undefined): string {
  return def.styles && def.styles > 1 ? styleFrame(def.id, Math.min(def.styles - 1, Math.max(0, style ?? 0))) : `b_${def.id}`;
}

type P = { x: number; y: number };

// ---------------------------------------------------------------- palety wariantów (bez fioletu)

interface Palette {
  wall: string;
  roof: string;
  trim: string;
}

const HOUSE_STYLES: Palette[] = [
  { wall: '#f6e7cf', roof: '#e2603e', trim: '#6b4428' },
  { wall: '#d9eef8', roof: '#2f86c2', trim: '#3a5a72' },
  { wall: '#fff0b8', roof: '#3f9a2e', trim: '#6b4428' },
  { wall: '#ffd9c7', roof: '#8a5a2e', trim: '#5a3a1e' },
];
const TENT_STYLES = ['#f0704f', '#5fb544', '#5cb8f0'];

function paletteFor(def: BuildingDef, style: number): Palette {
  if (def.kind === 'house' && def.styles && def.styles > 1) return HOUSE_STYLES[style % HOUSE_STYLES.length]!;
  return { wall: def.art.wall ?? '#f3e2c4', roof: def.art.roof ?? '#c0503a', trim: '#6b4428' };
}

// ---------------------------------------------------------------- prymitywy

function poly(ctx: Ctx2D, pts: P[], fill: string, stroke: string | null = INK, width = 2.5): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

const lerp = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const up = (p: P, d: number): P => ({ x: p.x, y: p.y - d });
const mid = (a: P, b: P): P => lerp(a, b, 0.5);

/** Lokalny układ ściany: oś X wzdłuż ściany (a → b), oś Y w górę (ujemne y = wyżej). */
function onWall(ctx: Ctx2D, a: P, b: P, draw: (len: number) => void): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  ctx.save();
  ctx.transform((b.x - a.x) / len, (b.y - a.y) / len, 0, 1, a.x, a.y);
  draw(len);
  ctx.restore();
}

/** Narożniki podstawy (T tył, R prawy, B przód, L lewy) dla obrysu w×h w klatce o wysokości `vertical`. */
function base(w: number, h: number, ox: number, oy: number, vertical: number) {
  const topY = oy + vertical + ISO_PAD;
  const g = (i: number, j: number): P => ({ x: ox + 2 + h * ISO_HW + (i - j) * ISO_HW, y: topY + (i + j) * ISO_HH });
  return { g, T: g(0, 0), R: g(w, 0), B: g(w, h), L: g(0, h) };
}

function softShadow(ctx: Ctx2D, T: P, R: P, B: P, L: P): void {
  ctx.save();
  ctx.globalAlpha = 0.22;
  poly(ctx, [up(T, -6), { x: R.x + 16, y: R.y + 6 }, { x: B.x, y: B.y + 16 }, { x: L.x - 16, y: L.y + 6 }], '#2a2010', null);
  ctx.restore();
}

// ---------------------------------------------------------------- dekoracje ścian

interface WallOpts {
  door?: 'arch' | 'wide' | 'double' | null;
  windows?: number;
  floors?: number;
  timber?: boolean;
  logs?: boolean;
  planks?: boolean;
  stone?: boolean;
  trim: string;
}

function windowAt(ctx: Ctx2D, cx: number, cy: number, r: number, trim: string): void {
  const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
  g.addColorStop(0, '#fff2b0');
  g.addColorStop(1, '#ffb84d');
  rrect(ctx, cx - r, cy - r * 1.15, r * 2, r * 2.3, r * 0.8);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = trim;
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r * 1.15);
  ctx.lineTo(cx, cy + r * 1.15);
  ctx.stroke();
  // skrzynka z kwiatami
  ctx.fillStyle = '#8a5a34';
  ctx.fillRect(cx - r - 3, cy + r * 1.15 + 1, r * 2 + 6, 6);
  for (let k = 0; k < 3; k++) ellipse(ctx, cx - r + 3 + k * (r - 1.5), cy + r * 1.15, 3.4, 3.4, ['#f2667a', '#fff1a8', '#9fd8ff'][k]!);
}

function wallDecor(ctx: Ctx2D, wall: number, len: number, o: WallOpts): void {
  if (o.logs) {
    ctx.strokeStyle = 'rgba(90,55,25,0.55)';
    ctx.lineWidth = 2;
    for (let y = -10; y > -wall; y -= 11) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(len, y);
      ctx.stroke();
    }
    for (const x of [3, len - 3]) ellipse(ctx, x, -wall / 2, 4, wall / 2 - 2, 'rgba(120,80,40,0.35)');
  }
  if (o.planks) {
    ctx.strokeStyle = 'rgba(90,55,25,0.4)';
    ctx.lineWidth = 2;
    for (let x = 12; x < len; x += 14) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, -wall);
      ctx.stroke();
    }
  }
  if (o.stone !== false) {
    ctx.fillStyle = '#b9b0a2';
    ctx.fillRect(0, -14, len, 14);
    for (let x = 3; x < len - 6; x += 17) {
      ctx.beginPath();
      ctx.ellipse(x + 7, -7, 7.5, 5, 0, 0, Math.PI * 2);
      ctx.fillStyle = shade('#b9b0a2', x % 34 ? -0.08 : 0.06);
      ctx.fill();
      ctx.strokeStyle = 'rgba(74,46,26,0.4)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }
  const floors = o.floors ?? 1;
  if (o.timber) {
    ctx.fillStyle = o.trim;
    ctx.fillRect(0, -wall, 6, wall - 14);
    ctx.fillRect(len - 6, -wall, 6, wall - 14);
    ctx.fillRect(0, -wall, len, 6);
    for (let f = 1; f < floors; f++) ctx.fillRect(0, -wall * (f / floors) - 3, len, 6);
  }
  const winXs = o.windows === 3 ? [0.2, 0.5, 0.8] : o.windows === 2 ? [0.27, 0.73] : o.windows === 1 ? [0.72] : [];
  const r = Math.min(13, len * 0.08);
  for (let f = 0; f < floors; f++) {
    const cy = -wall * ((f + 0.55) / floors);
    for (const t of winXs) {
      if (f === 0 && o.door && Math.abs(t - 0.5) < 0.2) continue;
      windowAt(ctx, len * t, cy, r, o.trim);
    }
  }
  if (o.door) {
    const wide = o.door !== 'arch';
    const dw = Math.min(wide ? 52 : 32, len * (wide ? 0.36 : 0.22));
    const dx = len * 0.5 - dw / 2;
    const dh = Math.min(wall / floors, 100) * (wide ? 0.78 : 0.62);
    ctx.beginPath();
    ctx.moveTo(dx, 0);
    ctx.lineTo(dx, -dh + dw / 2);
    ctx.arc(dx + dw / 2, -dh + dw / 2, dw / 2, Math.PI, 0);
    ctx.lineTo(dx + dw, 0);
    ctx.closePath();
    ctx.fillStyle = '#8a4f2a';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(40,20,10,0.35)';
    ctx.lineWidth = 2;
    const parts = o.door === 'double' ? [0.5] : [0.33, 0.66];
    for (const k of parts) {
      ctx.beginPath();
      ctx.moveTo(dx + dw * k, -2);
      ctx.lineTo(dx + dw * k, -dh + 8);
      ctx.stroke();
    }
    ellipse(ctx, dx + dw * 0.8, -dh * 0.42, 2.5, 2.5, '#ffd24a');
  }
}

// ---------------------------------------------------------------- bryła z dachem

type RoofKind = 'hip' | 'gable' | 'thatch' | 'flat';

interface BoxSpec {
  wall: number;
  roof: RoofKind;
  roofH: number;
  front: WallOpts;
  side: WallOpts;
  chimney?: boolean;
  /** Markiza w paski na froncie. */
  awning?: string;
  sign?: string | undefined;
  tower?: { h: number; roof: string; face: 'clock' | 'bell' };
}

interface Frame {
  T: P;
  R: P;
  B: P;
  L: P;
  g: (i: number, j: number) => P;
  w: number;
  h: number;
}

function drawBox(ctx: Ctx2D, f: Frame, pal: Palette, spec: BoxSpec, c?: Content): void {
  const { T, R, B, L } = f;
  const wall = spec.wall;
  softShadow(ctx, T, R, B, L);
  const wallCol = pal.wall;
  poly(ctx, [L, B, up(B, wall), up(L, wall)], wallCol);
  poly(ctx, [B, R, up(R, wall), up(B, wall)], shade(wallCol, -0.14));
  onWall(ctx, L, B, (len) => wallDecor(ctx, wall, len, spec.front));
  onWall(ctx, B, R, (len) => wallDecor(ctx, wall, len, spec.side));
  // obrys krawędzi po dekoracjach
  poly(ctx, [L, B, up(B, wall), up(L, wall)], 'rgba(0,0,0,0)');
  poly(ctx, [B, R, up(R, wall), up(B, wall)], 'rgba(0,0,0,0)');

  if (spec.awning) {
    // markiza: pasy wzdłuż frontu nad drzwiami
    const a = up(L, wall * 0.62);
    const b = up(B, wall * 0.62);
    const n = 8;
    for (let k = 0; k < n; k++) {
      const p0 = lerp(a, b, k / n);
      const p1 = lerp(a, b, (k + 1) / n);
      poly(ctx, [p0, p1, { x: p1.x - 8, y: p1.y + 18 }, { x: p0.x - 8, y: p0.y + 18 }], k % 2 ? '#fffaf0' : spec.awning, INK, 2);
    }
  }

  drawRoof(ctx, f, pal, spec);

  if (spec.tower) drawTower(ctx, f, pal, spec);

  if (spec.sign && c) {
    const def = c.items[spec.sign];
    if (def) {
      const s = 40;
      const p = up(lerp(L, B, 0.5), Math.min(wall * 0.86, wall - 14));
      ellipse(ctx, p.x, p.y, s / 2 + 6, s / 2 + 6, '#fff6dc');
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.save();
      ctx.translate(p.x - s / 2, p.y - s / 2);
      drawItem(ctx, def, c.crop[spec.sign], s);
      ctx.restore();
    }
  }
}

function roofBase(f: Frame, wall: number, eave: number) {
  const { T, R, B, L } = f;
  const c = { x: (T.x + B.x) / 2, y: (T.y + B.y) / 2 };
  const out = (p: P): P => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    return up({ x: p.x + (dx / len) * eave * 2, y: p.y + (dy / len) * eave }, wall);
  };
  return [out(T), out(R), out(B), out(L)] as const;
}

function drawRoof(ctx: Ctx2D, f: Frame, pal: Palette, spec: BoxSpec): void {
  const { g, w, h } = f;
  const wall = spec.wall;
  const roofCol = pal.roof;
  const [rT, rR, rB, rL] = roofBase(f, wall, spec.roof === 'thatch' ? 18 : 14);
  if (spec.roof === 'flat') {
    const lift = 12;
    poly(ctx, [rT, rR, rB, rL].map((p) => up(p, 0)), shade(roofCol, 0.05));
    poly(ctx, [rL, rB, up(rB, lift), up(rL, lift)], shade(roofCol, -0.05));
    poly(ctx, [rB, rR, up(rR, lift), up(rB, lift)], shade(roofCol, -0.2));
    poly(ctx, [up(rT, lift), up(rR, lift), up(rB, lift), up(rL, lift)], shade(roofCol, 0.12));
    return;
  }
  const roofH = spec.roofH;
  if (spec.roof === 'gable') {
    // grzbiet wzdłuż osi X (T→R); widoczny szczyt na prawej ścianie
    const ridgeA = up(mid(rT, rL), roofH);
    const ridgeB = up(mid(rR, rB), roofH);
    if (spec.chimney) chimney(ctx, lerp(mid(rT, rR), ridgeB, 0.5));
    poly(ctx, [rT, rR, ridgeB, ridgeA], shade(roofCol, 0.12));
    poly(ctx, [rR, rB, ridgeB], shade(pal.wall, -0.2));
    poly(ctx, [rL, rB, ridgeB, ridgeA], roofCol);
    tiles(ctx, rL, rB, ridgeA, ridgeB);
    gloss(ctx, ridgeA, ridgeB);
    return;
  }
  // dach czterospadowy (zwykły i strzecha)
  const ridgeA = up(w >= h ? g(h / 2, h / 2) : g(w / 2, w / 2), wall + roofH);
  const ridgeB = up(w >= h ? g(w - h / 2, h / 2) : g(w / 2, h - w / 2), wall + roofH);
  if (spec.chimney) chimney(ctx, lerp(lerp(rR, rB, 0.5), ridgeB, 0.45));
  const thatch = spec.roof === 'thatch';
  poly(ctx, [rT, rR, ridgeB, ridgeA], shade(roofCol, 0.14));
  poly(ctx, [rL, rT, ridgeA], shade(roofCol, 0.04));
  poly(ctx, [rR, rB, ridgeB], shade(roofCol, -0.2));
  poly(ctx, [rB, rL, ridgeA, ridgeB], roofCol);
  if (thatch) {
    // strzecha: kreski słomy w dół połaci
    ctx.strokeStyle = 'rgba(120,80,20,0.45)';
    ctx.lineWidth = 2;
    for (let k = 0; k <= 12; k++) {
      const a = lerp(ridgeA, ridgeB, k / 12);
      const b = lerp(rL, rB, k / 12);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (let k = 0; k <= 6; k++) {
      const a = lerp(ridgeB, rR, k / 6);
      const b = lerp(rB, rR, k / 6);
      ctx.beginPath();
      ctx.moveTo(lerp(ridgeB, rB, k / 6).x, lerp(ridgeB, rB, k / 6).y);
      ctx.lineTo(lerp(a, b, 0.9).x, lerp(a, b, 0.9).y);
      ctx.stroke();
    }
  } else {
    scallops(ctx, rL, rB, shade(roofCol, -0.08));
    scallops(ctx, rB, rR, shade(roofCol, -0.28));
    tiles(ctx, rL, rB, ridgeA, ridgeB);
  }
  gloss(ctx, ridgeA, ridgeB);
}

function scallops(ctx: Ctx2D, a: P, b: P, col: string): void {
  const n = Math.max(4, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 22));
  for (let k = 0; k < n; k++) {
    const p = lerp(a, b, (k + 0.5) / n);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 12, 9, Math.atan2(b.y - a.y, b.x - a.x), 0, Math.PI);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function tiles(ctx: Ctx2D, eaveA: P, eaveB: P, ridgeA: P, ridgeB: P): void {
  ctx.strokeStyle = 'rgba(74,46,26,0.25)';
  ctx.lineWidth = 2;
  for (let k = 1; k < 4; k++) {
    const a = lerp(eaveA, ridgeA, k / 4);
    const b = lerp(eaveB, ridgeB, k / 4);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

function gloss(ctx: Ctx2D, a: P, b: P): void {
  ctx.strokeStyle = 'rgba(255,240,220,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y + 2);
  ctx.lineTo(b.x, b.y + 2);
  ctx.stroke();
}

function chimney(ctx: Ctx2D, p: P): void {
  poly(ctx, [up(p, -6), { x: p.x + 18, y: p.y + 3 }, { x: p.x + 18, y: p.y - 44 }, { x: p.x, y: p.y - 50 }], '#c46e4f');
  poly(ctx, [{ x: p.x - 3, y: p.y - 50 }, { x: p.x + 21, y: p.y - 44 }, { x: p.x + 21, y: p.y - 52 }, { x: p.x - 3, y: p.y - 58 }], '#8a4632');
}

function drawTower(ctx: Ctx2D, f: Frame, pal: Palette, spec: BoxSpec): void {
  const t = spec.tower!;
  const { g, w, h } = f;
  const cx = w / 2;
  const cy = h / 2;
  const s = 0.42;
  const top = spec.wall + spec.roofH * 0.55;
  const T = up(g(cx - s, cy - s), top);
  const R = up(g(cx + s, cy - s), top);
  const B = up(g(cx + s, cy + s), top);
  const L = up(g(cx - s, cy + s), top);
  poly(ctx, [L, B, up(B, t.h), up(L, t.h)], pal.wall);
  poly(ctx, [B, R, up(R, t.h), up(B, t.h)], shade(pal.wall, -0.14));
  const face = up(mid(L, B), t.h * 0.55);
  if (t.face === 'clock') {
    ellipse(ctx, face.x, face.y, 15, 15, '#fffaf0');
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(face.x, face.y);
    ctx.lineTo(face.x, face.y - 10);
    ctx.moveTo(face.x, face.y);
    ctx.lineTo(face.x + 7, face.y + 2);
    ctx.stroke();
  } else {
    rrect(ctx, face.x - 11, face.y - 16, 22, 26, 10, '#3a2412');
    ellipse(ctx, face.x, face.y, 9, 10, '#ffc53d');
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // spiczasty daszek wieży
  const apex = up(g(cx, cy), top + t.h + 46);
  const [eT, eR, eB, eL] = [up(T, t.h), up(R, t.h), up(B, t.h), up(L, t.h)].map((p) => ({ x: p.x + (p.x - g(cx, cy).x) * 0.25, y: p.y })) as [P, P, P, P];
  poly(ctx, [eT, eR, apex], shade(t.roof, 0.12));
  poly(ctx, [eL, eB, apex], t.roof);
  poly(ctx, [eB, eR, apex], shade(t.roof, -0.2));
  ellipse(ctx, apex.x, apex.y - 3, 4, 4, '#ffc53d');
}

// ---------------------------------------------------------------- rekwizyty na ziemi

function logPile(ctx: Ctx2D, x: number, y: number): void {
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 3 - r; k++) {
      const lx = x + k * 18 + r * 9;
      const ly = y - r * 13;
      rrect(ctx, lx - 16, ly - 6, 30, 12, 6, '#a8743f');
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.stroke();
      ellipse(ctx, lx + 14, ly, 6, 6, '#e8c48a');
      ctx.stroke();
      ellipse(ctx, lx + 14, ly, 2.5, 2.5, '#c98a4a');
    }
  }
}

function crate(ctx: Ctx2D, x: number, y: number, s = 22, col = '#c98a4a'): void {
  poly(ctx, [{ x, y }, { x: x + s, y: y - s * 0.4 }, { x: x + s, y: y - s * 1.3 }, { x, y: y - s * 0.9 }], col);
  poly(ctx, [{ x, y }, { x: x - s, y: y - s * 0.4 }, { x: x - s, y: y - s * 1.3 }, { x, y: y - s * 0.9 }], shade(col, 0.1));
  poly(ctx, [{ x, y: y - s * 0.9 }, { x: x + s, y: y - s * 1.3 }, { x, y: y - s * 1.7 }, { x: x - s, y: y - s * 1.3 }], shade(col, 0.2));
}

function barrel(ctx: Ctx2D, x: number, y: number): void {
  rrect(ctx, x - 12, y - 30, 24, 30, 9, '#a8743f');
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#6b4428';
  ctx.fillRect(x - 12, y - 24, 24, 3);
  ctx.fillRect(x - 12, y - 9, 24, 3);
  ellipse(ctx, x, y - 30, 12, 4, '#c98a4a');
  ctx.stroke();
}

// ---------------------------------------------------------------- modele

function drawField(ctx: Ctx2D, f: Frame, grain = false): void {
  const { T, R, B, L, g, w, h } = f;
  poly(ctx, [T, R, B, L], grain ? '#b8873e' : '#8a5a2e');
  // grządki: wałki wzdłuż osi X z kiełkami
  for (let j = 0.5; j < h; j += 0.5) {
    const a = g(0.2, j);
    const b = g(w - 0.2, j);
    ctx.strokeStyle = '#6b4423';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = '#a8743f';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - 2);
    ctx.lineTo(b.x, b.y - 2);
    ctx.stroke();
    for (let i = 0.5; i < w; i += 0.5) {
      const p = g(i, j);
      if (grain) {
        // kępka zboża: trzy źdźbła z kłosami
        for (const dx of [-5, 0, 5]) {
          ctx.strokeStyle = '#c99a3a';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(p.x + dx, p.y - 2);
          ctx.lineTo(p.x + dx * 1.4, p.y - 24);
          ctx.stroke();
          ellipse(ctx, p.x + dx * 1.4, p.y - 27, 3.2, 7, dx ? '#f2c14e' : '#ffd66b', dx * 0.05);
        }
        continue;
      }
      ellipse(ctx, p.x - 4, p.y - 7, 6, 3.5, '#5fb544', -0.6);
      ellipse(ctx, p.x + 4, p.y - 7, 6, 3.5, '#7cc95a', 0.6);
    }
  }
  // płotek z przodu
  ctx.strokeStyle = '#a8743f';
  ctx.lineWidth = 3;
  for (let k = 0; k <= 6; k++) {
    const p = lerp(L, B, k / 6);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y - 22);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(L.x, L.y - 14);
  ctx.lineTo(B.x, B.y - 14);
  ctx.stroke();
  poly(ctx, [T, R, B, L], 'rgba(0,0,0,0)');
}

function drawPlaza(ctx: Ctx2D, f: Frame): void {
  const { T, R, B, L, g, w, h } = f;
  poly(ctx, [T, R, B, L], '#d9c08a');
  // kostka brukowa
  ctx.strokeStyle = 'rgba(122,90,50,0.35)';
  ctx.lineWidth = 1.5;
  for (let k = 1; k < 6; k++) {
    const a = g((w * k) / 6, 0);
    const b = g((w * k) / 6, h);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const c = g(0, (h * k) / 6);
    const d = g(w, (h * k) / 6);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
  }
  // klomby w narożnikach
  for (const [i, j] of [[0.5, 0.5], [w - 0.5, 0.5], [0.5, h - 0.5], [w - 0.5, h - 0.5]] as const) {
    const p = g(i, j);
    ellipse(ctx, p.x, p.y - 2, 26, 14, '#5fb544');
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.stroke();
    for (let k = 0; k < 5; k++) ellipse(ctx, p.x - 14 + k * 7, p.y - 6 - (k % 2) * 4, 4, 4, ['#f2667a', '#ffc53d', '#9fd8ff', '#fffaf0', '#f2667a'][k]!);
  }
  // fontanna w środku
  const c = g(w / 2, h / 2);
  ellipse(ctx, c.x, c.y, 50, 26, '#b9b2a4');
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ellipse(ctx, c.x, c.y - 2, 40, 19, '#5cb8f0');
  ellipse(ctx, c.x - 12, c.y - 6, 12, 4, 'rgba(255,255,255,0.7)');
  rrect(ctx, c.x - 6, c.y - 52, 12, 50, 5, '#b9b2a4');
  ctx.stroke();
  ellipse(ctx, c.x, c.y - 54, 18, 8, '#b9b2a4');
  ctx.stroke();
  for (const dx of [-14, 0, 14]) ellipse(ctx, c.x + dx, c.y - 64 - (dx ? 0 : 6), 4, 8, 'rgba(160,215,250,0.85)');
  poly(ctx, [T, R, B, L], 'rgba(0,0,0,0)');
}

function drawWell(ctx: Ctx2D, f: Frame, pal: Palette): void {
  const { T, B, g } = f;
  const c = g(0.5, 0.5);
  void T;
  void B;
  ellipse(ctx, c.x, c.y + 6, 40, 16, 'rgba(42,32,16,0.22)');
  // kamienny cembrowina
  rrect(ctx, c.x - 32, c.y - 34, 64, 34, 10, '#b9b2a4');
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  for (let k = 0; k < 4; k++) ellipse(ctx, c.x - 22 + k * 15, c.y - 18, 6, 5, shade('#b9b2a4', k % 2 ? -0.1 : 0.08));
  ellipse(ctx, c.x, c.y - 34, 32, 11, '#8a8278');
  ctx.stroke();
  ellipse(ctx, c.x, c.y - 33, 24, 7, '#2f86c2');
  // słupki i daszek
  ctx.fillStyle = '#8a5a2e';
  ctx.fillRect(c.x - 30, c.y - 92, 6, 60);
  ctx.fillRect(c.x + 24, c.y - 92, 6, 60);
  poly(ctx, [{ x: c.x - 44, y: c.y - 84 }, { x: c.x, y: c.y - 118 }, { x: c.x + 44, y: c.y - 84 }], pal.roof);
  ctx.strokeStyle = '#6b4428';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(c.x - 26, c.y - 66);
  ctx.lineTo(c.x + 26, c.y - 66);
  ctx.stroke();
  rrect(ctx, c.x - 7, c.y - 62, 14, 14, 3, '#a8743f');
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawTent(ctx: Ctx2D, f: Frame, style: number): void {
  const { T, R, B, L, g } = f;
  const col = TENT_STYLES[style % TENT_STYLES.length]!;
  softShadow(ctx, T, R, B, L);
  const apex = up(g(0.5, 0.5), 108);
  const k = 0.08;
  const [t, r, b, l] = [g(k, k), g(1 - k, k), g(1 - k, 1 - k), g(k, 1 - k)];
  poly(ctx, [t, r, apex], shade(col, 0.1));
  poly(ctx, [l, b, apex], '#fffaf0');
  poly(ctx, [b, r, apex], shade(col, -0.15));
  // pasy na froncie
  for (let s = 1; s < 5; s += 2) {
    const a0 = lerp(l, b, s / 5);
    const a1 = lerp(l, b, (s + 1) / 5);
    poly(ctx, [a0, a1, apex], col, null);
  }
  poly(ctx, [l, b, apex], 'rgba(0,0,0,0)');
  // wejście
  const d = lerp(l, b, 0.5);
  poly(ctx, [{ x: d.x - 12, y: d.y - 2 }, { x: d.x + 12, y: d.y + 2 }, { x: d.x + 2, y: d.y - 46 }], '#5a3a1e');
  ctx.strokeStyle = '#8a5a2e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(apex.x, apex.y);
  ctx.lineTo(apex.x, apex.y - 16);
  ctx.stroke();
  poly(ctx, [up(apex, 16), { x: apex.x + 14, y: apex.y - 12 }, up(apex, 8)], '#ffc53d', INK, 1.5);
}

/** Specyfikacja bryły dla modelu (ściany, dach, dekoracje). */
function specFor(def: BuildingDef, pal: Palette): BoxSpec {
  const m = def.art.model ?? 'box';
  const trim = pal.trim;
  const [w, h] = def.size;
  const roofH = 60 + 18 * Math.max(w, h);
  const s: BoxSpec = { wall: WALL, roof: 'hip', roofH, front: { door: 'arch', windows: 1, trim }, side: { windows: 2, trim } };
  switch (m) {
    case 'hut':
      return { wall: 72, roof: 'thatch', roofH: roofH - 10, front: { door: 'arch', windows: 0, logs: true, stone: false, trim }, side: { windows: 1, logs: true, stone: false, trim } };
    case 'cottage':
      return { ...s, chimney: true, front: { door: 'arch', windows: 2, timber: true, trim }, side: { windows: 2, timber: true, trim } };
    case 'townhouse':
      return { wall: 176, roof: 'gable', roofH: roofH - 10, chimney: true, front: { door: 'arch', windows: 2, floors: 2, timber: true, trim }, side: { windows: 2, floors: 2, timber: true, trim } };
    case 'manor':
      return { wall: 132, roof: 'hip', roofH, chimney: true, front: { door: 'double', windows: 3, floors: 2, trim }, side: { windows: 3, floors: 2, trim } };
    case 'lumber':
      return { wall: 76, roof: 'gable', roofH: roofH - 30, sign: def.art.emblem, front: { door: 'wide', windows: 0, planks: true, stone: false, trim }, side: { windows: 1, planks: true, stone: false, trim } };
    case 'fishery':
      return { wall: 80, roof: 'gable', roofH: roofH - 30, sign: def.art.emblem, front: { door: 'arch', windows: 0, planks: true, stone: false, trim }, side: { windows: 1, planks: true, stone: false, trim } };
    case 'yard':
      return { wall: 70, roof: 'flat', roofH: 0, sign: def.art.emblem, front: { door: 'wide', windows: 0, planks: true, trim }, side: { windows: 1, planks: true, trim } };
    case 'shop':
      return { ...s, roof: 'gable', awning: '#f2667a', sign: def.art.emblem, front: { door: 'arch', windows: 2, trim }, side: { windows: 2, trim } };
    case 'tradepost':
      return { ...s, sign: def.art.emblem, front: { door: 'double', windows: 0, planks: true, trim }, side: { windows: 2, planks: true, trim } };
    case 'tavern':
      return { ...s, wall: 112, chimney: true, sign: def.art.emblem, front: { door: 'arch', windows: 2, timber: true, trim }, side: { windows: 2, timber: true, trim } };
    case 'warehouse':
      return { wall: 112, roof: 'gable', roofH, front: { door: 'double', windows: 0, planks: true, trim }, side: { windows: 0, planks: true, trim } };
    case 'townhall':
      return { wall: 124, roof: 'hip', roofH, tower: { h: 70, roof: pal.roof, face: 'clock' }, front: { door: 'double', windows: 2, trim }, side: { windows: 3, trim } };
    case 'school':
      return { wall: 110, roof: 'gable', roofH, tower: { h: 52, roof: pal.roof, face: 'bell' }, front: { door: 'arch', windows: 2, trim }, side: { windows: 3, trim } };
    case 'clinic':
      return { ...s, roof: 'flat', front: { door: 'arch', windows: 2, trim }, side: { windows: 2, trim } };
    case 'firestation':
      return { wall: 116, roof: 'hip', roofH, tower: { h: 40, roof: pal.roof, face: 'bell' }, front: { door: 'wide', windows: 0, trim }, side: { windows: 2, trim } };
    case 'police':
      return { ...s, front: { door: 'arch', windows: 2, trim }, side: { windows: 2, trim } };
    default:
      return { ...s, roof: 'gable', sign: def.art.emblem, front: { door: 'arch', windows: 1, planks: true, trim }, side: { windows: 2, trim } };
  }
}

/** Rekwizyty i znaki rozpoznawcze modelu (po bryle). */
function extras(ctx: Ctx2D, def: BuildingDef, f: Frame, spec: BoxSpec): void {
  const m = def.art.model ?? 'box';
  const { R, B, L } = f;
  if (m === 'lumber' || def.id === 'sawmill') logPile(ctx, B.x + 18, B.y - 6);
  if (m === 'fishery') {
    // sieć rozwieszona na prawej ścianie i beczka
    const a = up(lerp(B, R, 0.2), spec.wall * 0.8);
    const b = up(lerp(B, R, 0.8), spec.wall * 0.8);
    ctx.strokeStyle = 'rgba(255,250,240,0.85)';
    ctx.lineWidth = 1.5;
    for (let k = 0; k <= 6; k++) {
      const p = lerp(a, b, k / 6);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 10, p.y + spec.wall * 0.55);
      ctx.stroke();
    }
    barrel(ctx, L.x + 26, L.y + 2);
  }
  if (m === 'yard') {
    // rusztowanie i stos desek
    ctx.strokeStyle = '#a8743f';
    ctx.lineWidth = 4;
    for (const t of [0.15, 0.55]) {
      const p = lerp(B, R, t);
      ctx.beginPath();
      ctx.moveTo(p.x + 10, p.y + 4);
      ctx.lineTo(p.x + 10, p.y - spec.wall - 50);
      ctx.stroke();
    }
    crate(ctx, L.x + 30, L.y + 4, 18, '#e8c48a');
  }
  if (m === 'shop' || m === 'tradepost') {
    crate(ctx, L.x + 26, L.y + 2, 18);
    if (m === 'shop') for (let k = 0; k < 3; k++) ellipse(ctx, L.x + 20 + k * 7, L.y - 30, 5, 5, ['#f2667a', '#ffc53d', '#5fb544'][k]!);
    if (m === 'tradepost') {
      barrel(ctx, B.x + 22, B.y - 2);
      const pole = up(lerp(L, B, 0.12), 0);
      ctx.strokeStyle = '#6b4428';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(pole.x, pole.y);
      ctx.lineTo(pole.x, pole.y - spec.wall - 120);
      ctx.stroke();
      poly(ctx, [up(pole, spec.wall + 120), { x: pole.x + 40, y: pole.y - spec.wall - 108 }, up(pole, spec.wall + 96)], '#ffc53d', INK, 2);
    }
  }
  if (m === 'tavern') {
    barrel(ctx, L.x + 24, L.y + 2);
    barrel(ctx, L.x + 48, L.y + 10);
  }
  if (m === 'clinic') {
    const p = up(mid(L, B), spec.wall * 0.86);
    ellipse(ctx, p.x, p.y, 22, 22, '#fffaf0');
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    rrect(ctx, p.x - 5, p.y - 15, 10, 30, 3, '#5fb544');
    rrect(ctx, p.x - 15, p.y - 5, 30, 10, 3, '#5fb544');
  }
  if (m === 'police') {
    const p = up(mid(L, B), spec.wall * 0.86);
    ellipse(ctx, p.x, p.y, 20, 20, '#fffaf0');
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    star(ctx, p.x, p.y, 13, 6, '#ffc53d');
    // latarnia przy drzwiach
    const lp = lerp(L, B, 0.82);
    ctx.fillStyle = '#3b3330';
    ctx.fillRect(lp.x - 2, lp.y - 70, 4, 70);
    ellipse(ctx, lp.x, lp.y - 74, 9, 11, '#ffcf7a');
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  if (m === 'firestation') {
    // czerwone wrota z przeszkleniami
    const a = lerp(L, B, 0.3);
    const b = lerp(L, B, 0.7);
    poly(ctx, [a, b, up(b, spec.wall * 0.7), up(a, spec.wall * 0.7)], '#f0704f');
    for (let k = 1; k < 4; k++) {
      const p = lerp(a, b, k / 4);
      ctx.strokeStyle = 'rgba(80,20,10,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y - spec.wall * 0.7);
      ctx.stroke();
    }
  }
}

/** Rysuje budynek osady w klatce o lewym górnym rogu (ox, oy) – rozmiar jak boxFrameSize(def). */
export function drawSettlementBuilding(ctx: Ctx2D, def: BuildingDef, style: number, ox: number, oy: number, c?: Content): void {
  const [w, h] = def.size;
  const { T, R, B, L, g } = base(w, h, ox, oy, verticalExtent(def));
  const f: Frame = { T, R, B, L, g, w, h };
  const pal = paletteFor(def, style);
  const m = def.art.model ?? 'box';
  if (m === 'field' || m === 'grain') return drawField(ctx, f, m === 'grain');
  if (m === 'plaza') return drawPlaza(ctx, f);
  if (m === 'well') return drawWell(ctx, f, pal);
  if (m === 'tent') return drawTent(ctx, f, style);
  const spec = specFor(def, pal);
  drawBox(ctx, f, pal, spec, c);
  extras(ctx, def, f, spec);
}

/** Rusztowanie: fundament, niskie ściany w budowie, słupy i deski. */
export function drawSite(ctx: Ctx2D, w: number, h: number, ox: number, oy: number): void {
  const vertical = siteVertical(w, h);
  const { T, R, B, L } = base(w, h, ox, oy, vertical);
  softShadow(ctx, T, R, B, L);
  poly(ctx, [T, R, B, L], '#d9c08a');
  const low = 26;
  poly(ctx, [L, B, up(B, low), up(L, low)], '#e8c48a');
  poly(ctx, [B, R, up(R, low), up(B, low)], shade('#e8c48a', -0.14));
  onWall(ctx, L, B, (len) => wallDecor(ctx, low, len, { planks: true, trim: '#6b4428' }));
  onWall(ctx, B, R, (len) => wallDecor(ctx, low, len, { planks: true, trim: '#6b4428' }));
  // słupy rusztowania i pomosty
  const top = vertical - 14;
  ctx.lineCap = 'round';
  for (const p of [T, R, B, L]) {
    ctx.strokeStyle = '#8a5a2e';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y - top);
    ctx.stroke();
  }
  for (const lvl of [0.45, 0.85]) {
    ctx.strokeStyle = '#c98a4a';
    ctx.lineWidth = 6;
    for (const [a, b] of [[L, B], [B, R]] as const) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - top * lvl);
      ctx.lineTo(b.x, b.y - top * lvl);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = 'rgba(138,90,46,0.8)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(L.x, L.y);
  ctx.lineTo(B.x, B.y - top * 0.45);
  ctx.moveTo(B.x, B.y);
  ctx.lineTo(R.x, R.y - top * 0.45);
  ctx.stroke();
  // stos desek i drabinka
  crate(ctx, B.x - 30, B.y + 6, 14, '#e8c48a');
  logPile(ctx, L.x + 20, L.y + 4);
}

/** Zgliszcza: osmalone niskie ściany, belki i popiół. */
export function drawRuin(ctx: Ctx2D, w: number, h: number, ox: number, oy: number): void {
  const vertical = siteVertical(w, h);
  const { T, R, B, L } = base(w, h, ox, oy, vertical);
  softShadow(ctx, T, R, B, L);
  poly(ctx, [T, R, B, L], '#6b5a48');
  const lowL = 46;
  const lowR = 30;
  poly(ctx, [L, B, up(B, lowL * 0.6), lerp(up(L, lowL), up(B, lowL), 0.4), up(L, lowL)], '#4a3a2e');
  poly(ctx, [B, R, up(R, lowR * 0.5), lerp(up(B, lowR), up(R, lowR), 0.5), up(B, lowR)], '#3a2c22');
  // zwęglone belki
  ctx.strokeStyle = '#2a2018';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(mid(L, T).x, mid(L, T).y - 10);
  ctx.lineTo(mid(B, R).x, mid(B, R).y - 50);
  ctx.moveTo(mid(T, R).x, mid(T, R).y - 6);
  ctx.lineTo(mid(L, B).x, mid(L, B).y - 36);
  ctx.stroke();
  for (let k = 0; k < 6; k++) {
    const p = lerp(lerp(T, B, 0.2 + k * 0.12), lerp(L, R, 0.3 + (k % 3) * 0.2), 0.5);
    ellipse(ctx, p.x, p.y, 10, 5, k % 2 ? '#8a7a68' : '#5a4a3a');
  }
  ellipse(ctx, mid(T, B).x + 10, mid(T, B).y - 4, 8, 4, '#f0704f');
}

// ---------------------------------------------------------------- atlas

/** Klatki atlasu dla osady (dołączane w drawSpriteAtlas): budynki z modelem (z wariantami), rusztowania, zgliszcza. */
export function settlementEntries(c: Content): Entry[] {
  const out: Entry[] = [];
  for (const def of c.buildingList) {
    if (!def.art.model || !isBox(def)) continue;
    const size = boxFrameSize(def.size[0], def.size[1], verticalExtent(def));
    const styles = def.styles && def.styles > 1 ? def.styles : 1;
    for (let st = 0; st < styles; st++) {
      out.push({
        name: styles > 1 ? styleFrame(def.id, st) : `b_${def.id}`,
        w: size.w,
        h: size.h,
        draw: (ctx, x, y) => drawSettlementBuilding(ctx, def, st, x, y, c),
        style: { outline: def.art.model === 'field' || def.art.model === 'grain' || def.art.model === 'plaza' ? 3 : 4, shade: true },
      });
    }
  }
  for (const [w, h] of SITE_SIZES) {
    const size = boxFrameSize(w, h, siteVertical(w, h));
    out.push({ name: siteFrame(w, h), w: size.w, h: size.h, draw: (ctx, x, y) => drawSite(ctx, w, h, x, y), style: { outline: 3, shade: true } });
    out.push({ name: ruinFrame(w, h), w: size.w, h: size.h, draw: (ctx, x, y) => drawRuin(ctx, w, h, x, y), style: { outline: 3, shade: true } });
  }
  return out;
}
