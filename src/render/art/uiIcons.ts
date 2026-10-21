// Ikony interfejsu malowane jak przedmioty z filmu animowanego: każdy kształt dostaje światło z lewej-góry,
// cień własny od dołu-prawej, połysk i ciepły odblask od dołu (`lit`). Kontur i rim light dokłada potok `stylize`.
// Rysowane w kwadracie 128×128; nazwy są kontraktem (CSS `.ic-<nazwa>`, `uiIconUrl(nazwa)`).

import { ellipse, leaf, rrect, shade, star, type Ctx2D } from './draw';

type Path = (ctx: Ctx2D) => void;

/** Wypełnia kształt kolorem i oświetla go jak bryłę (cx, cy, r – przybliżony środek i promień kształtu). */
export function lit(ctx: Ctx2D, path: Path, base: string, cx: number, cy: number, r: number, gloss = 1): void {
  ctx.save();
  ctx.beginPath();
  path(ctx);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.clip();
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, 'rgba(255,250,235,0.38)');
  g.addColorStop(0.42, 'rgba(255,250,235,0)');
  g.addColorStop(0.62, 'rgba(60,35,15,0)');
  g.addColorStop(1, 'rgba(60,35,15,0.38)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - r * 1.6, cy - r * 1.6, r * 3.2, r * 3.2);
  // ciepły odblask od ziemi
  ellipse(ctx, cx + r * 0.1, cy + r * 0.92, r * 0.75, r * 0.2, 'rgba(255,214,150,0.28)');
  // połysk
  if (gloss) {
    ellipse(ctx, cx - r * 0.36, cy - r * 0.46, r * 0.34 * gloss, r * 0.17 * gloss, 'rgba(255,255,255,0.7)', -0.55);
    ellipse(ctx, cx - r * 0.12, cy - r * 0.62, r * 0.08, r * 0.06, 'rgba(255,255,255,0.8)');
  }
  ctx.restore();
}

const circle = (x: number, y: number, r: number): Path => (c) => c.arc(x, y, r, 0, Math.PI * 2);
const rect = (x: number, y: number, w: number, h: number, r: number): Path => (c) => c.roundRect(x, y, w, h, r);

function shadow(ctx: Ctx2D, w = 40): void {
  ellipse(ctx, 64, 114, w, 7, 'rgba(74,46,26,0.22)');
}

function stick(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, w: number, col: string): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = shade(col, -0.25);
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = col;
  ctx.lineWidth = w * 0.62;
  ctx.beginPath();
  ctx.moveTo(x0 - w * 0.12, y0 - w * 0.12);
  ctx.lineTo(x1 - w * 0.12, y1 - w * 0.12);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,240,210,0.55)';
  ctx.lineWidth = w * 0.18;
  ctx.beginPath();
  ctx.moveTo(x0 - w * 0.22, y0 - w * 0.22);
  ctx.lineTo(x1 - w * 0.22, y1 - w * 0.22);
  ctx.stroke();
  ctx.restore();
}

function heartPath(cx: number, cy: number, s: number): Path {
  return (c) => {
    c.moveTo(cx, cy + 30 * s);
    c.bezierCurveTo(cx - 44 * s, cy, cx - 34 * s, cy - 36 * s, cx, cy - 18 * s);
    c.bezierCurveTo(cx + 34 * s, cy - 36 * s, cx + 44 * s, cy, cx, cy + 30 * s);
  };
}

function starPath(cx: number, cy: number, outer: number, inner: number): Path {
  return (c) => {
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? inner : outer;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      if (i === 0) c.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      else c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    c.closePath();
  };
}

function face(ctx: Ctx2D, cx: number, cy: number, s = 1, mood: 'happy' | 'calm' = 'happy'): void {
  for (const dx of [-11, 11]) {
    ellipse(ctx, cx + dx * s, cy, 4.2 * s, 5.4 * s, '#3a2412');
    ellipse(ctx, cx + dx * s - 1.4 * s, cy - 2 * s, 1.6 * s, 1.8 * s, '#ffffff');
  }
  ellipse(ctx, cx - 19 * s, cy + 8 * s, 5 * s, 3 * s, 'rgba(255,120,120,0.55)');
  ellipse(ctx, cx + 19 * s, cy + 8 * s, 5 * s, 3 * s, 'rgba(255,120,120,0.55)');
  ctx.strokeStyle = '#3a2412';
  ctx.lineWidth = 2.4 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (mood === 'happy') ctx.arc(cx, cy + 6 * s, 6 * s, 0.2, Math.PI - 0.2);
  else {
    ctx.moveTo(cx - 4 * s, cy + 10 * s);
    ctx.lineTo(cx + 4 * s, cy + 10 * s);
  }
  ctx.stroke();
}

function flowerPetals(ctx: Ctx2D, cx: number, cy: number, n: number, r: number, pr: number, col: string): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    lit(ctx, circle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, pr), col, cx + Math.cos(a) * r, cy + Math.sin(a) * r, pr, 0.6);
  }
}

const DRAW: Record<string, (ctx: Ctx2D) => void> = {
  // ------------------------------------------------------------ narzędzia
  hoe(ctx) {
    shadow(ctx, 34);
    stick(ctx, 30, 108, 86, 30, 12, '#c98a4a');
    lit(ctx, (c) => {
      c.moveTo(70, 18);
      c.lineTo(110, 22);
      c.quadraticCurveTo(112, 44, 98, 52);
      c.lineTo(80, 40);
      c.closePath();
    }, '#a9b4be', 92, 34, 22);
  },
  can(ctx) {
    shadow(ctx);
    stick(ctx, 84, 62, 114, 40, 9, '#3f8fcf');
    ellipse(ctx, 116, 38, 7, 5, '#2f6f9f');
    lit(ctx, rect(22, 48, 66, 58, 16), '#5cb8f0', 55, 77, 34);
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#2f86c2';
    ctx.beginPath();
    ctx.arc(55, 50, 20, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    lit(ctx, rect(18, 92, 74, 14, 7), '#2f86c2', 55, 99, 30, 0);
    for (const [x, y] of [[118, 54], [112, 64], [122, 68]] as const) lit(ctx, circle(x, y, 4), '#bfe8ff', x, y, 4, 0.5);
  },
  sickle(ctx) {
    shadow(ctx, 30);
    stick(ctx, 34, 108, 52, 80, 13, '#c98a4a');
    lit(ctx, (c) => {
      c.moveTo(52, 82);
      c.bezierCurveTo(16, 50, 40, 8, 90, 14);
      c.bezierCurveTo(60, 28, 52, 52, 64, 74);
      c.closePath();
    }, '#d3dbe2', 56, 44, 34);
  },
  rod(ctx) {
    shadow(ctx, 34);
    stick(ctx, 22, 112, 100, 16, 9, '#c98a4a');
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(100, 16);
    ctx.quadraticCurveTo(116, 52, 104, 84);
    ctx.stroke();
    lit(ctx, circle(104, 88, 9), '#f0704f', 104, 88, 9);
    rrect(ctx, 95, 88, 18, 6, 3, '#fff6e4');
    lit(ctx, circle(36, 92, 10), '#8a9aa8', 36, 92, 10);
  },
  cottage(ctx) {
    shadow(ctx, 46);
    lit(ctx, rect(28, 56, 72, 50, 8), '#f6e7cf', 64, 80, 36);
    lit(ctx, (c) => {
      c.moveTo(16, 62);
      c.quadraticCurveTo(64, 2, 112, 62);
      c.closePath();
    }, '#e2603e', 64, 40, 40);
    lit(ctx, rect(54, 76, 20, 30, 10), '#8a5a2e', 64, 90, 12, 0.5);
    lit(ctx, circle(88, 76, 8), '#ffd27a', 88, 76, 8, 0.6);
    lit(ctx, circle(40, 76, 8), '#ffd27a', 40, 76, 8, 0.6);
    lit(ctx, rect(84, 20, 12, 24, 4), '#b0743f', 90, 32, 10, 0.4);
  },

  // ------------------------------------------------------------ waluty i nagrody
  coin(ctx) {
    shadow(ctx, 36);
    lit(ctx, circle(64, 62, 44), '#d98e0b', 64, 62, 44, 0);
    lit(ctx, circle(62, 59, 40), '#ffc53d', 62, 59, 40);
    ctx.strokeStyle = 'rgba(160,95,10,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(62, 59, 30, 0, Math.PI * 2);
    ctx.stroke();
    // wytłoczony kłos
    ctx.strokeStyle = '#c97a08';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(62, 82);
    ctx.lineTo(62, 40);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      leaf(ctx, 62, 48 + i * 8, 13, 6, -0.9, '#e8a020');
      leaf(ctx, 62, 48 + i * 8, 13, 6, 0.9 + Math.PI, '#e8a020');
    }
  },
  star(ctx) {
    shadow(ctx, 34);
    lit(ctx, starPath(64, 62, 50, 22), '#ffc53d', 64, 62, 48);
    face(ctx, 64, 62, 0.8);
  },
  'star-gold'(ctx) {
    lit(ctx, starPath(64, 64, 54, 24), '#ffc53d', 64, 64, 52);
  },
  'star-silver'(ctx) {
    lit(ctx, starPath(64, 64, 54, 24), '#c5d2dc', 64, 64, 52);
  },
  'star-empty'(ctx) {
    lit(ctx, starPath(64, 64, 54, 24), '#e6cfa4', 64, 64, 52, 0);
  },
  heart(ctx) {
    lit(ctx, heartPath(64, 62, 1.25), '#f2667a', 64, 58, 46);
  },
  'heart-empty'(ctx) {
    lit(ctx, heartPath(64, 62, 1.25), '#f3dcc0', 64, 58, 46, 0);
  },
  trophy(ctx) {
    shadow(ctx, 34);
    lit(ctx, rect(40, 96, 48, 14, 5), '#8a5a2e', 64, 103, 24, 0);
    lit(ctx, rect(56, 72, 16, 26, 4), '#d98e0b', 64, 85, 10, 0);
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#d98e0b';
    ctx.beginPath();
    ctx.arc(30, 44, 14, Math.PI * 0.5, Math.PI * 1.5);
    ctx.arc(98, 44, 14, -Math.PI * 0.5, Math.PI * 0.5);
    ctx.stroke();
    lit(ctx, (c) => {
      c.moveTo(28, 22);
      c.lineTo(100, 22);
      c.quadraticCurveTo(100, 80, 64, 80);
      c.quadraticCurveTo(28, 80, 28, 22);
    }, '#ffc53d', 64, 48, 36);
    star(ctx, 64, 46, 12, 5, '#fff3b0');
  },
  gift(ctx) {
    shadow(ctx);
    lit(ctx, rect(26, 52, 76, 56, 8), '#f2667a', 64, 80, 38);
    lit(ctx, rect(20, 40, 88, 20, 7), '#f78a9a', 64, 50, 44);
    rrect(ctx, 57, 40, 14, 68, 3, '#ffc53d');
    ellipse(ctx, 50, 34, 14, 9, '#ffc53d', -0.4);
    ellipse(ctx, 78, 34, 14, 9, '#ffc53d', 0.4);
  },
  tent(ctx) {
    shadow(ctx, 48);
    lit(ctx, (c) => {
      c.moveTo(14, 104);
      c.lineTo(64, 20);
      c.lineTo(114, 104);
      c.closePath();
    }, '#fff3d6', 64, 70, 46);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(14, 104);
    ctx.lineTo(64, 20);
    ctx.lineTo(114, 104);
    ctx.closePath();
    ctx.clip();
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(242,102,122,0.85)' : 'rgba(0,0,0,0)';
      ctx.beginPath();
      ctx.moveTo(64, 20);
      ctx.lineTo(14 + i * 16.7, 104);
      ctx.lineTo(14 + (i + 1) * 16.7, 104);
      ctx.fill();
    }
    ctx.restore();
    lit(ctx, rect(54, 76, 20, 28, 10), '#8a5a2e', 64, 90, 12, 0);
    ctx.fillStyle = '#5fb544';
    ctx.beginPath();
    ctx.moveTo(64, 20);
    ctx.lineTo(64, 4);
    ctx.lineTo(80, 10);
    ctx.lineTo(64, 16);
    ctx.fill();
  },

  // ------------------------------------------------------------ sterowanie
  lock(ctx) {
    ctx.lineWidth = 11;
    ctx.strokeStyle = '#a9b4be';
    ctx.beginPath();
    ctx.arc(64, 52, 22, Math.PI, 0);
    ctx.stroke();
    lit(ctx, rect(30, 52, 68, 54, 14), '#ffc53d', 64, 78, 34);
    lit(ctx, circle(64, 74, 8), '#8a5a2e', 64, 74, 8, 0);
    rrect(ctx, 60, 76, 8, 16, 3, '#8a5a2e');
  },
  check(ctx) {
    lit(ctx, (c) => {
      c.moveTo(18, 66);
      c.lineTo(36, 48);
      c.lineTo(54, 66);
      c.lineTo(94, 22);
      c.lineTo(112, 40);
      c.lineTo(54, 102);
      c.closePath();
    }, '#5fb544', 64, 62, 46);
  },
  close(ctx) {
    // krzyżyk z dwóch gałązek
    stick(ctx, 30, 30, 98, 98, 16, '#b0743f');
    stick(ctx, 98, 30, 30, 98, 16, '#c98a4a');
    leaf(ctx, 94, 30, 18, 9, -0.8, '#5fb544');
  },
  back(ctx) {
    lit(ctx, (c) => {
      c.moveTo(20, 64);
      c.lineTo(62, 22);
      c.lineTo(62, 46);
      c.quadraticCurveTo(112, 46, 108, 100);
      c.quadraticCurveTo(96, 72, 62, 80);
      c.lineTo(62, 106);
      c.closePath();
    }, '#5fb544', 64, 64, 46);
  },
  plus(ctx) {
    lit(ctx, rect(54, 20, 20, 88, 10), '#5fb544', 64, 64, 44);
    lit(ctx, rect(20, 54, 88, 20, 10), '#5fb544', 64, 64, 44);
  },
  gear(ctx) {
    lit(ctx, (c) => {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const r = i % 2 ? 40 : 52;
        if (i === 0) c.moveTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
        else c.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
      }
      c.closePath();
    }, '#c98a4a', 64, 64, 50);
    flowerPetals(ctx, 64, 64, 5, 12, 9, '#f7a1c4');
    lit(ctx, circle(64, 64, 8), '#ffc53d', 64, 64, 8, 0.6);
  },
  info(ctx) {
    lit(ctx, circle(64, 64, 50), '#5cb8f0', 64, 64, 50);
    rrect(ctx, 56, 52, 16, 44, 7, '#fffaf0');
    ellipse(ctx, 64, 36, 9, 9, '#fffaf0');
  },
  'leaf-up'(ctx) {
    lit(ctx, (c) => {
      c.moveTo(64, 12);
      c.quadraticCurveTo(112, 60, 76, 76);
      c.lineTo(76, 112);
      c.lineTo(52, 112);
      c.lineTo(52, 76);
      c.quadraticCurveTo(16, 60, 64, 12);
    }, '#5fb544', 64, 56, 46);
  },
  'leaf-down'(ctx) {
    lit(ctx, (c) => {
      c.moveTo(64, 116);
      c.quadraticCurveTo(112, 68, 76, 52);
      c.lineTo(76, 16);
      c.lineTo(52, 16);
      c.lineTo(52, 52);
      c.quadraticCurveTo(16, 68, 64, 116);
    }, '#f0704f', 64, 72, 46);
  },
  smile(ctx) {
    lit(ctx, circle(64, 64, 48), '#ffc53d', 64, 64, 48);
    face(ctx, 64, 58, 1.1);
  },
  sparkle(ctx) {
    lit(ctx, (c) => {
      c.moveTo(64, 8);
      c.quadraticCurveTo(70, 58, 120, 64);
      c.quadraticCurveTo(70, 70, 64, 120);
      c.quadraticCurveTo(58, 70, 8, 64);
      c.quadraticCurveTo(58, 58, 64, 8);
    }, '#ffe58a', 64, 64, 50);
  },
  moon(ctx) {
    lit(ctx, (c) => {
      c.arc(64, 64, 46, Math.PI * 0.35, Math.PI * 1.65);
      c.quadraticCurveTo(40, 64, 82, 104);
    }, '#ffe58a', 56, 64, 44);
    ellipse(ctx, 40, 70, 3.5, 4.5, '#3a2412');
    ellipse(ctx, 34, 82, 4, 2.5, 'rgba(255,120,120,0.5)');
  },
  timer(ctx) {
    shadow(ctx, 30);
    lit(ctx, rect(30, 14, 68, 12, 6), '#c98a4a', 64, 20, 34, 0);
    lit(ctx, rect(30, 102, 68, 12, 6), '#c98a4a', 64, 108, 34, 0);
    lit(ctx, (c) => {
      c.moveTo(38, 26);
      c.lineTo(90, 26);
      c.quadraticCurveTo(90, 52, 68, 64);
      c.quadraticCurveTo(90, 76, 90, 102);
      c.lineTo(38, 102);
      c.quadraticCurveTo(38, 76, 60, 64);
      c.quadraticCurveTo(38, 52, 38, 26);
    }, '#e6f6ff', 64, 64, 34);
    ellipse(ctx, 64, 94, 18, 7, '#ffc53d');
    ellipse(ctx, 64, 40, 14, 5, '#ffc53d');
  },
  drop(ctx) {
    lit(ctx, (c) => {
      c.moveTo(64, 10);
      c.bezierCurveTo(110, 62, 100, 112, 64, 112);
      c.bezierCurveTo(28, 112, 18, 62, 64, 10);
    }, '#5cb8f0', 64, 74, 40);
  },
  sack(ctx) {
    shadow(ctx);
    lit(ctx, (c) => {
      c.moveTo(42, 34);
      c.quadraticCurveTo(16, 70, 30, 104);
      c.lineTo(98, 104);
      c.quadraticCurveTo(112, 70, 86, 34);
      c.closePath();
    }, '#c98a4a', 64, 72, 40);
    rrect(ctx, 44, 26, 40, 12, 6, '#8a5a2e');
    ellipse(ctx, 64, 24, 16, 8, '#6b4423');
    leaf(ctx, 64, 72, 22, 10, -0.6, '#5fb544');
  },
  acorn(ctx) {
    lit(ctx, (c) => c.ellipse(64, 74, 32, 38, 0, 0, Math.PI * 2), '#d9a066', 64, 74, 36);
    lit(ctx, (c) => c.ellipse(64, 46, 38, 20, 0, 0, Math.PI * 2), '#8a5a2e', 64, 46, 36, 0.5);
    rrect(ctx, 60, 18, 8, 14, 4, '#6b4423');
  },
  bobber(ctx) {
    lit(ctx, circle(64, 70, 34), '#fffaf0', 64, 70, 34);
    ctx.save();
    ctx.beginPath();
    ctx.arc(64, 70, 34, 0, Math.PI * 2);
    ctx.clip();
    lit(ctx, rect(20, 30, 88, 40, 0), '#f0704f', 64, 50, 34);
    ctx.restore();
    rrect(ctx, 60, 14, 8, 24, 4, '#8a5a2e');
  },
  lily(ctx) {
    lit(ctx, (c) => {
      c.moveTo(64, 64);
      c.arc(64, 64, 50, -0.35, Math.PI * 2 - 0.85);
      c.closePath();
    }, '#5fb544', 64, 64, 48);
    flowerPetals(ctx, 64, 60, 6, 10, 9, '#ffd6dc');
    lit(ctx, circle(64, 60, 7), '#ffc53d', 64, 60, 7, 0.4);
  },

  // ------------------------------------------------------------ ustawienia
  bell(ctx) {
    lit(ctx, (c) => {
      c.moveTo(24, 92);
      c.quadraticCurveTo(34, 84, 34, 58);
      c.quadraticCurveTo(34, 22, 64, 22);
      c.quadraticCurveTo(94, 22, 94, 58);
      c.quadraticCurveTo(94, 84, 104, 92);
      c.closePath();
    }, '#ffc53d', 64, 58, 40);
    lit(ctx, circle(64, 100, 10), '#d98e0b', 64, 100, 10, 0.5);
    lit(ctx, circle(64, 18, 6), '#d98e0b', 64, 18, 6, 0);
  },
  note(ctx) {
    lit(ctx, (c) => c.ellipse(42, 94, 20, 15, -0.4, 0, Math.PI * 2), '#5cb8f0', 42, 94, 18);
    lit(ctx, (c) => c.ellipse(92, 82, 20, 15, -0.4, 0, Math.PI * 2), '#5cb8f0', 92, 82, 18);
    lit(ctx, rect(56, 24, 10, 72, 4), '#2f86c2', 61, 60, 10, 0);
    lit(ctx, rect(106, 14, 10, 70, 4), '#2f86c2', 111, 50, 10, 0);
    lit(ctx, (c) => {
      c.moveTo(56, 24);
      c.lineTo(116, 12);
      c.lineTo(116, 30);
      c.lineTo(56, 42);
      c.closePath();
    }, '#2f86c2', 86, 26, 30, 0);
  },
  captions(ctx) {
    lit(ctx, (c) => {
      c.roundRect(14, 22, 100, 70, 22);
      c.moveTo(40, 88);
      c.lineTo(30, 112);
      c.lineTo(62, 90);
    }, '#fffaf0', 64, 56, 50);
    for (let i = 0; i < 3; i++) rrect(ctx, 30, 40 + i * 14, i === 2 ? 40 : 68, 7, 3.5, '#c98a4a');
  },
  camera(ctx) {
    shadow(ctx);
    lit(ctx, rect(16, 40, 96, 64, 14), '#c98a4a', 64, 72, 48);
    lit(ctx, rect(40, 28, 30, 16, 6), '#8a5a2e', 55, 36, 16, 0);
    lit(ctx, circle(64, 72, 24), '#2f86c2', 64, 72, 24);
    lit(ctx, circle(64, 72, 12), '#bfe8ff', 64, 72, 12);
  },
  speech(ctx) {
    lit(ctx, (c) => {
      c.roundRect(10, 16, 74, 54, 18);
      c.moveTo(26, 66);
      c.lineTo(20, 86);
      c.lineTo(46, 68);
    }, '#5cb8f0', 46, 42, 38);
    lit(ctx, (c) => {
      c.roundRect(46, 50, 72, 50, 18);
      c.moveTo(102, 96);
      c.lineTo(110, 116);
      c.lineTo(86, 98);
    }, '#ffc53d', 82, 74, 36);
  },
  eye(ctx) {
    lit(ctx, (c) => {
      c.moveTo(10, 64);
      c.quadraticCurveTo(64, 10, 118, 64);
      c.quadraticCurveTo(64, 118, 10, 64);
    }, '#fffaf0', 64, 64, 50);
    lit(ctx, circle(64, 64, 24), '#5fb544', 64, 64, 24);
    lit(ctx, circle(64, 64, 11), '#3a2412', 64, 64, 11, 0);
    ellipse(ctx, 57, 56, 6, 5, '#ffffff');
  },
  magnifier(ctx) {
    stick(ctx, 76, 76, 110, 110, 16, '#c98a4a');
    lit(ctx, circle(52, 52, 38), '#d98e0b', 52, 52, 38, 0);
    lit(ctx, circle(52, 52, 28), '#bfe8ff', 52, 52, 28);
  },
  snail(ctx) {
    shadow(ctx, 46);
    lit(ctx, (c) => {
      c.moveTo(10, 104);
      c.quadraticCurveTo(20, 80, 40, 88);
      c.lineTo(110, 88);
      c.quadraticCurveTo(124, 104, 100, 106);
      c.closePath();
    }, '#ffd27a', 60, 96, 46);
    lit(ctx, circle(70, 62, 32), '#f0704f', 70, 62, 32);
    ctx.strokeStyle = 'rgba(120,40,20,0.6)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 5; a += 0.2) {
      const r = 4 + a * 1.6;
      const x = 70 + Math.cos(a) * r;
      const y = 62 + Math.sin(a) * r;
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    stick(ctx, 20, 92, 14, 66, 5, '#ffd27a');
    ellipse(ctx, 14, 64, 5, 5, '#3a2412');
  },
  jar(ctx) {
    shadow(ctx, 34);
    lit(ctx, rect(28, 34, 72, 76, 18), '#d7f0f8', 64, 72, 40);
    lit(ctx, rect(34, 18, 60, 20, 6), '#c98a4a', 64, 28, 30, 0);
    lit(ctx, rect(42, 60, 44, 30, 5), '#fffaf0', 64, 75, 22, 0.4);
    for (let i = 0; i < 3; i++) rrect(ctx, 48, 66 + i * 8, 32 - i * 8, 3, 1.5, '#c98a4a');
  },
  'jar-in'(ctx) {
    DRAW.jar!(ctx);
    lit(ctx, (c) => {
      c.moveTo(64, 0);
      c.lineTo(84, 22);
      c.lineTo(72, 22);
      c.lineTo(72, 40);
      c.lineTo(56, 40);
      c.lineTo(56, 22);
      c.lineTo(44, 22);
      c.closePath();
    }, '#5fb544', 64, 20, 20, 0);
  },
  compass(ctx) {
    lit(ctx, circle(64, 64, 50), '#c98a4a', 64, 64, 50);
    lit(ctx, circle(64, 64, 40), '#fffaf0', 64, 64, 40, 0.5);
    lit(ctx, (c) => {
      c.moveTo(64, 26);
      c.lineTo(76, 64);
      c.lineTo(52, 64);
      c.closePath();
    }, '#f0704f', 64, 46, 18, 0);
    lit(ctx, (c) => {
      c.moveTo(64, 102);
      c.lineTo(76, 64);
      c.lineTo(52, 64);
      c.closePath();
    }, '#5cb8f0', 64, 82, 18, 0);
    lit(ctx, circle(64, 64, 6), '#ffc53d', 64, 64, 6, 0);
  },
  book(ctx) {
    shadow(ctx);
    lit(ctx, rect(18, 22, 46, 84, 8), '#5fb544', 41, 64, 40);
    lit(ctx, rect(64, 22, 46, 84, 8), '#4aa236', 87, 64, 40);
    lit(ctx, rect(26, 28, 34, 72, 4), '#fffaf0', 43, 64, 30, 0);
    lit(ctx, rect(68, 28, 34, 72, 4), '#fffaf0', 85, 64, 30, 0);
    star(ctx, 85, 50, 10, 4, '#ffc53d');
  },
  ladybug(ctx) {
    lit(ctx, circle(64, 72, 42), '#f0704f', 64, 72, 42);
    lit(ctx, circle(64, 34, 18), '#3a2412', 64, 34, 18, 0.4);
    ctx.fillStyle = '#3a2412';
    ctx.fillRect(62, 36, 4, 76);
    for (const [x, y] of [[44, 62], [84, 62], [46, 92], [82, 92]] as const) ellipse(ctx, x, y, 8, 8, '#3a2412');
  },
  sparkles(ctx) {
    DRAW.sparkle!(ctx);
  },

  // ------------------------------------------------------------ pogoda i pory roku
  'w-sun'(ctx) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      lit(ctx, (c) => c.ellipse(64 + Math.cos(a) * 46, 64 + Math.sin(a) * 46, 12, 7, a, 0, Math.PI * 2), '#ffb020', 64 + Math.cos(a) * 46, 64 + Math.sin(a) * 46, 12, 0.4);
    }
    lit(ctx, circle(64, 64, 34), '#ffc53d', 64, 64, 34);
    face(ctx, 64, 62, 0.75);
  },
  'w-cloud'(ctx) {
    lit(ctx, circle(92, 46, 22), '#ffc53d', 92, 46, 22);
    lit(ctx, (c) => {
      c.arc(40, 78, 22, Math.PI * 0.5, Math.PI * 1.5);
      c.arc(64, 56, 26, Math.PI, 0);
      c.arc(92, 78, 22, Math.PI * 1.5, Math.PI * 0.5);
      c.closePath();
    }, '#fffaf0', 64, 72, 46);
  },
  'w-rain'(ctx) {
    lit(ctx, (c) => {
      c.arc(40, 56, 22, Math.PI * 0.5, Math.PI * 1.5);
      c.arc(64, 36, 26, Math.PI, 0);
      c.arc(92, 56, 22, Math.PI * 1.5, Math.PI * 0.5);
      c.closePath();
    }, '#d6e6f0', 64, 50, 46);
    face(ctx, 64, 52, 0.6, 'calm');
    for (const [x, y] of [[38, 96], [64, 106], [90, 96]] as const) {
      lit(ctx, (c) => {
        c.moveTo(x, y - 14);
        c.bezierCurveTo(x + 10, y, x + 8, y + 10, x, y + 10);
        c.bezierCurveTo(x - 8, y + 10, x - 10, y, x, y - 14);
      }, '#5cb8f0', x, y, 10, 0.5);
    }
  },
  'w-heat'(ctx) {
    DRAW['w-sun']!(ctx);
    ctx.strokeStyle = 'rgba(240,112,79,0.85)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (const x of [30, 64, 98]) {
      ctx.beginPath();
      ctx.moveTo(x, 124);
      ctx.bezierCurveTo(x - 8, 116, x + 8, 110, x, 102);
      ctx.stroke();
    }
  },
  'w-snow'(ctx) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      stick(ctx, 64, 64, 64 + Math.cos(a) * 50, 64 + Math.sin(a) * 50, 10, '#bfe8ff');
      lit(ctx, circle(64 + Math.cos(a) * 34, 64 + Math.sin(a) * 34, 7), '#e6f6ff', 64 + Math.cos(a) * 34, 64 + Math.sin(a) * 34, 7, 0.4);
    }
    lit(ctx, circle(64, 64, 14), '#e6f6ff', 64, 64, 14);
  },
  's-spring'(ctx) {
    stick(ctx, 64, 118, 64, 70, 8, '#5fb544');
    leaf(ctx, 64, 96, 30, 13, -0.7, '#7cc95a');
    flowerPetals(ctx, 64, 50, 5, 20, 16, '#f7a1c4');
    lit(ctx, circle(64, 50, 12), '#ffc53d', 64, 50, 12, 0.5);
  },
  's-summer'(ctx) {
    stick(ctx, 64, 118, 64, 74, 8, '#5fb544');
    flowerPetals(ctx, 64, 52, 12, 30, 12, '#ffc53d');
    lit(ctx, circle(64, 52, 20), '#8a5a2e', 64, 52, 20, 0.4);
  },
  's-autumn'(ctx) {
    lit(ctx, (c) => {
      const pts = [[64, 8], [74, 34], [100, 22], [92, 50], [118, 58], [92, 70], [100, 96], [70, 82], [64, 110], [58, 82], [28, 96], [36, 70], [10, 58], [36, 50], [28, 22], [54, 34]];
      pts.forEach(([x, y], i) => (i ? c.lineTo(x!, y!) : c.moveTo(x!, y!)));
      c.closePath();
    }, '#f0904f', 64, 58, 50);
    stick(ctx, 64, 84, 64, 124, 6, '#8a5a2e');
  },
  's-winter'(ctx) {
    DRAW['w-snow']!(ctx);
  },
};

export const UI_ICONS = Object.keys(DRAW);

export function drawUiIcon(ctx: Ctx2D, name: string): void {
  DRAW[name]?.(ctx);
}
