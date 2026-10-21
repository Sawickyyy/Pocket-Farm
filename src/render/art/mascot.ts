// Maskotka „Kiełek”: pucołowate ziarenko z dwoma listkami, dużymi oczami i rumieńcami.
// Siedem min do samouczka, pustych stanów, błędów i ekranu startowego. Kwadrat 128×128.

import { ellipse, leaf, shade, type Ctx2D } from './draw';
import { lit } from './uiIcons';

export const MASCOT_MOODS = ['happy', 'cheer', 'surprised', 'sad', 'sleep', 'wave', 'point'] as const;
export type MascotMood = (typeof MASCOT_MOODS)[number];

const BODY = '#9be06e';
const BELLY = '#e8f8c8';
const INK = '#3a2412';

function eyes(ctx: Ctx2D, cx: number, cy: number, mood: MascotMood): void {
  for (const dx of [-13, 13]) {
    const x = cx + dx;
    if (mood === 'sleep' || mood === 'cheer') {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (mood === 'sleep') ctx.arc(x, cy - 2, 6, 0.25, Math.PI - 0.25);
      else ctx.arc(x, cy + 3, 6, Math.PI + 0.25, -0.25);
      ctx.stroke();
      continue;
    }
    const big = mood === 'surprised' ? 1.25 : 1;
    ellipse(ctx, x, cy, 6.5 * big, 8.5 * big, INK);
    ellipse(ctx, x - 2.2, cy - 3.2, 2.6 * big, 3 * big, '#ffffff');
    ellipse(ctx, x + 2.2, cy + 3, 1.2, 1.2, '#ffffff');
    if (mood === 'sad') {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x - 7 * Math.sign(dx), cy - 14);
      ctx.lineTo(x + 5 * Math.sign(dx), cy - 11);
      ctx.stroke();
    }
  }
}

function mouth(ctx: Ctx2D, cx: number, cy: number, mood: MascotMood): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  if (mood === 'surprised') {
    ellipse(ctx, cx, cy + 2, 5, 6.5, INK);
    ellipse(ctx, cx, cy + 4, 3, 3, '#f2667a');
    return;
  }
  if (mood === 'cheer' || mood === 'happy' || mood === 'wave' || mood === 'point') {
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy - 1);
    ctx.quadraticCurveTo(cx, cy + 14, cx + 9, cy - 1);
    ctx.closePath();
    ctx.fillStyle = INK;
    ctx.fill();
    ellipse(ctx, cx, cy + 6, 4.5, 2.5, '#f2667a');
    return;
  }
  ctx.beginPath();
  if (mood === 'sad') ctx.arc(cx, cy + 8, 6, Math.PI + 0.4, -0.4);
  else ctx.arc(cx, cy, 4, 0.3, Math.PI - 0.3);
  ctx.stroke();
}

function arm(ctx: Ctx2D, x: number, y: number, angle: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  lit(ctx, (c) => c.ellipse(0, -14, 7, 16, 0, 0, Math.PI * 2), shade(BODY, -0.05), 0, -14, 14, 0.5);
  ctx.restore();
}

export function drawMascot(ctx: Ctx2D, mood: MascotMood): void {
  const cx = 64;
  const cy = 74;
  const bounce = mood === 'cheer' ? -6 : 0;
  ellipse(ctx, cx, 118, 30, 6, 'rgba(74,46,26,0.25)');
  // listki na czubku (przy radości rozłożone szerzej)
  const spread = mood === 'cheer' || mood === 'wave' ? 1.15 : mood === 'sad' || mood === 'sleep' ? 0.55 : 0.85;
  const stemTop = cy - 40 + bounce;
  ctx.strokeStyle = '#5fb544';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 26 + bounce);
  ctx.quadraticCurveTo(cx + 3, stemTop + 4, cx, stemTop);
  ctx.stroke();
  leaf(ctx, cx, stemTop, 30, 15, -Math.PI / 2 - spread, '#7cc95a');
  leaf(ctx, cx, stemTop, 30, 15, -Math.PI / 2 + spread, '#6cbf4a');
  // rączki
  if (mood === 'wave') arm(ctx, cx + 30, cy + bounce, 0.9);
  else if (mood === 'point') arm(ctx, cx + 32, cy + 8 + bounce, 1.5);
  else if (mood === 'cheer') {
    arm(ctx, cx - 30, cy + bounce, -0.7);
    arm(ctx, cx + 30, cy + bounce, 0.7);
  }
  // pucołowate ciałko-ziarenko
  lit(ctx, (c) => c.ellipse(cx, cy + bounce, 36, 40, 0, 0, Math.PI * 2), BODY, cx, cy + bounce, 38);
  ellipse(ctx, cx + 4, cy + 18 + bounce, 20, 14, BELLY);
  if (mood !== 'wave' && mood !== 'point' && mood !== 'cheer') {
    arm(ctx, cx - 30, cy + 22 + bounce, -2.6);
    arm(ctx, cx + 30, cy + 22 + bounce, 2.6);
  } else if (mood !== 'cheer') arm(ctx, cx - 30, cy + 22 + bounce, -2.6);
  // nóżki
  ellipse(ctx, cx - 14, cy + 40 + bounce, 11, 6, shade(BODY, -0.2));
  ellipse(ctx, cx + 14, cy + 40 + bounce, 11, 6, shade(BODY, -0.2));
  eyes(ctx, cx, cy - 8 + bounce, mood);
  ellipse(ctx, cx - 24, cy + 4 + bounce, 7, 4, 'rgba(255,120,120,0.55)');
  ellipse(ctx, cx + 24, cy + 4 + bounce, 7, 4, 'rgba(255,120,120,0.55)');
  mouth(ctx, cx, cy + 6 + bounce, mood);
  if (mood === 'sleep') {
    ctx.fillStyle = '#5cb8f0';
    ctx.font = 'bold 20px ui-rounded, system-ui, sans-serif';
    ctx.fillText('z', cx + 30, cy - 34);
    ctx.font = 'bold 14px ui-rounded, system-ui, sans-serif';
    ctx.fillText('z', cx + 44, cy - 46);
  }
  if (mood === 'sad') ellipse(ctx, cx + 20, cy + 6, 3, 5, '#5cb8f0');
}
