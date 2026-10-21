// Budynki jako bryły izometryczne (2.5D): dwie widoczne ściany, dach czterospadowy, drzwi, okna, emblemat.

import type { BuildingDef } from '../../content/content';
import { ISO_HH, ISO_HW, ISO_PAD, WALL, roofHeight } from '../iso';
import { ellipse, shade, type Ctx2D } from './draw';

type P = { x: number; y: number };

function poly(ctx: Ctx2D, pts: P[], fill: string, stroke = 'rgba(40,25,10,0.35)'): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
}

const lerp = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const up = (p: P, d: number): P => ({ x: p.x, y: p.y - d });

/** Czworokąt leżący na ścianie: odcinek a→b (wzdłuż ściany), od t0 do t1, na wysokości h0..h1. */
function wallQuad(a: P, b: P, t0: number, t1: number, h0: number, h1: number): P[] {
  const p0 = lerp(a, b, t0);
  const p1 = lerp(a, b, t1);
  return [up(p0, h0), up(p1, h0), up(p1, h1), up(p0, h1)];
}

export function drawIsoBuilding(ctx: Ctx2D, def: BuildingDef, ox: number, oy: number, emblem?: (ctx: Ctx2D, size: number) => void): void {
  const [w, h] = def.size;
  const roofH = roofHeight(w, h);
  const small = w === 1 && h === 1;
  const wall = small ? WALL * 0.55 : WALL;
  const topY = oy + WALL + roofH + ISO_PAD;
  const g = (i: number, j: number): P => ({ x: ox + 2 + h * ISO_HW + (i - j) * ISO_HW, y: topY + (i + j) * ISO_HH });
  const T = g(0, 0);
  const R = g(w, 0);
  const B = g(w, h);
  const L = g(0, h);
  const wallCol = def.art.wall ?? '#d8c8a8';
  const roofCol = def.art.roof ?? '#7a5a3a';

  // cień pod budynkiem
  ctx.save();
  ctx.globalAlpha = 0.28;
  poly(ctx, [up(T, -6), { x: R.x + 14, y: R.y + 6 }, { x: B.x, y: B.y + 14 }, { x: L.x - 14, y: L.y + 6 }], '#000', 'transparent');
  ctx.restore();

  // ściany: lewa (frontowa, jaśniejsza) i prawa (w cieniu)
  poly(ctx, [L, B, up(B, wall), up(L, wall)], shade(wallCol, 0.05));
  poly(ctx, [B, R, up(R, wall), up(B, wall)], shade(wallCol, -0.18));
  // deski / cegły
  ctx.strokeStyle = 'rgba(60,40,20,0.14)';
  ctx.lineWidth = 2;
  for (let k = 1; k < 5; k++) {
    const d = (wall * k) / 5;
    for (const [a, b] of [[L, B], [B, R]] as const) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - d);
      ctx.lineTo(b.x, b.y - d);
      ctx.stroke();
    }
  }

  if (small) {
    // kompostownik: otwarta skrzynia z ziemią
    poly(ctx, [up(T, wall), up(R, wall), up(B, wall), up(L, wall)], '#5b3a1e');
    ellipse(ctx, (T.x + B.x) / 2, (T.y + B.y) / 2 - wall, ISO_HW * 0.5, ISO_HH * 0.5, '#7a4f2a');
    return;
  }

  // drzwi na lewej ścianie, okna na prawej
  poly(ctx, wallQuad(L, B, 0.4, 0.6, 0, wall * 0.62), shade(wallCol, -0.5));
  for (const t of [0.2, 0.6]) {
    poly(ctx, wallQuad(B, R, t, t + 0.18, wall * 0.35, wall * 0.7), '#bfe3ff');
    poly(ctx, wallQuad(B, R, t + 0.08, t + 0.1, wall * 0.35, wall * 0.7), shade(wallCol, -0.4), 'transparent');
  }

  // dach czterospadowy z okapem
  const eave = 10;
  const c = { x: (T.x + B.x) / 2, y: (T.y + B.y) / 2 };
  const out = (p: P): P => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    return up({ x: p.x + (dx / len) * eave * 2, y: p.y + (dy / len) * eave }, wall);
  };
  const [rT, rR, rB, rL] = [out(T), out(R), out(B), out(L)];
  const ridgeA = up(w >= h ? g(h / 2 + 0, h / 2) : g(w / 2, w / 2), wall + roofH);
  const ridgeB = up(w >= h ? g(w - h / 2, h / 2) : g(w / 2, h - w / 2), wall + roofH);
  // tylne połacie (częściowo widoczne), potem przednie
  poly(ctx, [rT, rR, ridgeB, ridgeA], shade(roofCol, 0.12));
  poly(ctx, [rL, rT, ridgeA], shade(roofCol, 0.02));
  poly(ctx, [rR, rB, ridgeB], shade(roofCol, -0.22));
  poly(ctx, [rB, rL, ridgeA, ridgeB], shade(roofCol, -0.05));
  // dachówki
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  for (let k = 1; k < 4; k++) {
    const a = lerp(rL, ridgeA, k / 4);
    const b = lerp(rB, ridgeB, k / 4);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // emblemat (szyld) na lewej ścianie
  if (emblem) {
    const s = 46;
    const p = up(lerp(L, B, 0.18), wall * 0.62);
    ellipse(ctx, p.x, p.y, s / 2 + 5, s / 2 + 5, '#fff8e8');
    ctx.save();
    ctx.translate(p.x - s / 2, p.y - s / 2);
    emblem(ctx, s);
    ctx.restore();
  }

  if (def.id === 'mill') {
    const hub = up(lerp(B, R, 0.5), wall * 0.95);
    ctx.save();
    ctx.translate(hub.x, hub.y);
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = '#f0e6d0';
      ctx.strokeStyle = 'rgba(80,60,40,0.5)';
      ctx.beginPath();
      ctx.roundRect(-7, 6, 14, 70, 3);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    ellipse(ctx, hub.x, hub.y, 9, 9, '#6b4a2a');
  }
}
