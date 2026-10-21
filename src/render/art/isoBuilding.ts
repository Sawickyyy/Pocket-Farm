// Bajkowe chatki jako bryły izometryczne (2.5D): kamienna podmurówka, mur pruski z belkami, łukowe drzwi,
// okrągłe okienka z ciepłym światłem, skrzynki z kwiatami, dach z falbanką okapu i komin.

import type { BuildingDef } from '../../content/content';
import { ISO_HH, ISO_HW, ISO_PAD, WALL, roofHeight } from '../iso';
import { ellipse, shade, type Ctx2D } from './draw';
import { INK } from './palette';

type P = { x: number; y: number };

const BEAM = '#6b4428';
const STONE = '#b9b0a2';

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

/**
 * Rysowanie „na ścianie”: lokalny układ, w którym oś X biegnie wzdłuż ściany (a → b, w pikselach długości),
 * a oś Y w górę (ujemne y = wyżej). Dzięki temu łuki i okręgi same się „przekrzywiają” w rzucie.
 */
function onWall(ctx: Ctx2D, a: P, b: P, draw: (len: number) => void): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  ctx.save();
  ctx.transform((b.x - a.x) / len, (b.y - a.y) / len, 0, 1, a.x, a.y);
  draw(len);
  ctx.restore();
}

function wallDecor(ctx: Ctx2D, wall: number, len: number, wallCol: string, opts: { door: boolean; windows: number }): void {
  // podmurówka z kamieni
  ctx.fillStyle = STONE;
  ctx.fillRect(0, -16, len, 16);
  for (let x = 4; x < len - 6; x += 18) {
    ctx.beginPath();
    ctx.ellipse(x + 7, -8, 8, 5.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = shade(STONE, (x % 36 ? -0.08 : 0.06));
    ctx.fill();
    ctx.strokeStyle = 'rgba(74,46,26,0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // belki szachulca
  ctx.fillStyle = BEAM;
  const beam = (x: number, y: number, w: number, hh: number) => ctx.fillRect(x, y, w, hh);
  beam(0, -wall, 7, wall - 16);
  beam(len - 7, -wall, 7, wall - 16);
  beam(0, -wall * 0.55, len, 6);
  beam(0, -wall, len, 7);
  for (const t of [0.33, 0.66]) beam(len * t - 3, -wall, 6, wall * 0.45);
  ctx.save();
  ctx.strokeStyle = BEAM;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(8, -wall * 0.55);
  ctx.lineTo(len * 0.33 - 3, -wall + 7);
  ctx.moveTo(len - 8, -wall * 0.55);
  ctx.lineTo(len * 0.66 + 3, -wall + 7);
  ctx.stroke();
  ctx.restore();

  // okrągłe okienka z ciepłym światłem i skrzynką kwiatów
  const winXs = opts.windows === 2 ? [0.25, 0.75] : opts.windows === 1 ? [0.75] : [];
  for (const t of winXs) {
    const cx = len * t;
    const cy = -wall * 0.33;
    const r = Math.min(15, len * 0.09);
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
    g.addColorStop(0, '#fff2b0');
    g.addColorStop(1, '#ffb84d');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = BEAM;
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();
    // skrzynka z kwiatami
    ctx.fillStyle = '#8a5a34';
    ctx.fillRect(cx - r - 3, cy + r + 2, r * 2 + 6, 7);
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.arc(cx - r + 2 + k * ((r * 2 - 4) / 3), cy + r + 1, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = ['#ff8fb1', '#fff1a8', '#ff8fb1', '#9fd8ff'][k]!;
      ctx.fill();
    }
  }

  // łukowe drzwi z okienkiem i klamką
  if (opts.door) {
    const dw = Math.min(34, len * 0.22);
    const dx = len * 0.5 - dw / 2;
    const dh = wall * 0.62;
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
    for (const k of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.moveTo(dx + dw * k, -2);
      ctx.lineTo(dx + dw * k, -dh + 8);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(dx + dw / 2, -dh + dw / 2, dw * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd77a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(dx + dw * 0.8, -dh * 0.45, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd24a';
    ctx.fill();
  }
  void wallCol;
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
  const wallCol = shade(def.art.wall ?? '#f3e2c4', 0.25);
  const roofCol = def.art.roof ?? '#c0503a';

  // miękki cień pod budynkiem
  ctx.save();
  ctx.globalAlpha = 0.22;
  poly(ctx, [up(T, -6), { x: R.x + 16, y: R.y + 6 }, { x: B.x, y: B.y + 16 }, { x: L.x - 16, y: L.y + 6 }], '#2a2010', null);
  ctx.restore();

  // ściany
  poly(ctx, [L, B, up(B, wall), up(L, wall)], wallCol);
  poly(ctx, [B, R, up(R, wall), up(B, wall)], shade(wallCol, -0.14));

  if (small) {
    // kompostownik: drewniana skrzynia z ziemią
    onWall(ctx, L, B, (len) => {
      ctx.fillStyle = '#9a6a3c';
      for (let y = -wall; y < 0; y += 13) ctx.fillRect(0, y, len, 10);
    });
    onWall(ctx, B, R, (len) => {
      ctx.fillStyle = '#7d5430';
      for (let y = -wall; y < 0; y += 13) ctx.fillRect(0, y, len, 10);
    });
    poly(ctx, [up(T, wall), up(R, wall), up(B, wall), up(L, wall)], '#5b3a1e');
    ellipse(ctx, (T.x + B.x) / 2, (T.y + B.y) / 2 - wall - 4, ISO_HW * 0.45, ISO_HH * 0.45, '#7a4f2a');
    ellipse(ctx, (T.x + B.x) / 2 - 10, (T.y + B.y) / 2 - wall - 10, 8, 5, '#6cbf3c');
    return;
  }

  onWall(ctx, L, B, (len) => wallDecor(ctx, wall, len, wallCol, { door: true, windows: 0 }));
  onWall(ctx, B, R, (len) => wallDecor(ctx, wall, len, wallCol, { door: false, windows: h >= 2 ? 2 : 1 }));
  // kontur krawędzi ścian po dekoracji
  poly(ctx, [L, B, up(B, wall), up(L, wall)], 'rgba(0,0,0,0)');
  poly(ctx, [B, R, up(R, wall), up(B, wall)], 'rgba(0,0,0,0)');

  // dach czterospadowy z okapem
  const eave = 14;
  const c = { x: (T.x + B.x) / 2, y: (T.y + B.y) / 2 };
  const out = (p: P): P => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    return up({ x: p.x + (dx / len) * eave * 2, y: p.y + (dy / len) * eave }, wall);
  };
  const [rT, rR, rB, rL] = [out(T), out(R), out(B), out(L)];
  const ridgeA = up(w >= h ? g(h / 2, h / 2) : g(w / 2, w / 2), wall + roofH);
  const ridgeB = up(w >= h ? g(w - h / 2, h / 2) : g(w / 2, h - w / 2), wall + roofH);

  // komin (za dachem, na prawej połaci)
  const chimBase = lerp(lerp(rR, rB, 0.5), ridgeB, 0.45);
  poly(ctx, [up(chimBase, -6), { x: chimBase.x + 18, y: chimBase.y + 3 }, { x: chimBase.x + 18, y: chimBase.y - 44 }, { x: chimBase.x, y: chimBase.y - 50 }], '#c46e4f');
  poly(ctx, [{ x: chimBase.x - 3, y: chimBase.y - 50 }, { x: chimBase.x + 21, y: chimBase.y - 44 }, { x: chimBase.x + 21, y: chimBase.y - 52 }, { x: chimBase.x - 3, y: chimBase.y - 58 }], '#8a4632');

  poly(ctx, [rT, rR, ridgeB, ridgeA], shade(roofCol, 0.14));
  poly(ctx, [rL, rT, ridgeA], shade(roofCol, 0.04));
  poly(ctx, [rR, rB, ridgeB], shade(roofCol, -0.2));
  poly(ctx, [rB, rL, ridgeA, ridgeB], roofCol);

  // falbanka okapu: półkola wzdłuż przednich krawędzi dachu
  const scallops = (a: P, b: P, col: string) => {
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
  };
  scallops(rL, rB, shade(roofCol, -0.08));
  scallops(rB, rR, shade(roofCol, -0.28));
  // rządki dachówek
  ctx.strokeStyle = 'rgba(74,46,26,0.25)';
  ctx.lineWidth = 2;
  for (let k = 1; k < 4; k++) {
    const a = lerp(rL, ridgeA, k / 4);
    const b = lerp(rB, ridgeB, k / 4);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const a2 = lerp(rB, ridgeB, k / 4);
    const b2 = lerp(rR, ridgeB, k / 4);
    ctx.beginPath();
    ctx.moveTo(a2.x, a2.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.stroke();
  }
  // połysk grzbietu
  ctx.strokeStyle = 'rgba(255,240,220,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(ridgeA.x, ridgeA.y + 2);
  ctx.lineTo(ridgeB.x, ridgeB.y + 2);
  ctx.stroke();

  // szyld z emblematem nad drzwiami
  if (emblem) {
    const s = 44;
    const p = up(lerp(L, B, 0.5), wall * 0.82);
    ellipse(ctx, p.x, p.y, s / 2 + 6, s / 2 + 6, '#fff6dc');
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.save();
    ctx.translate(p.x - s / 2, p.y - s / 2);
    emblem(ctx, s);
    ctx.restore();
  }

  if (def.id === 'mill') {
    const hub = up(lerp(B, R, 0.5), wall * 0.95);
    ctx.save();
    ctx.translate(hub.x, hub.y);
    ctx.rotate(0.3);
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = '#fff4dc';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(-9, 8, 18, 72, 5);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(138,90,52,0.6)';
      ctx.lineWidth = 1.5;
      for (let k = 1; k < 4; k++) {
        ctx.beginPath();
        ctx.moveTo(-9, 8 + k * 18);
        ctx.lineTo(9, 8 + k * 18);
        ctx.stroke();
      }
    }
    ctx.restore();
    ellipse(ctx, hub.x, hub.y, 10, 10, '#8a5a34');
  }
}
