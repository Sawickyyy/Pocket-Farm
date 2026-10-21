// Prymitywy rysowania Canvas 2D dla grafiki zastępczej.

export type Ctx2D = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D niedostępny');
  return [c, ctx];
}

/** Deterministyczny generator – ta sama grafika przy każdym uruchomieniu. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function ellipse(ctx: Ctx2D, x: number, y: number, rx: number, ry: number, fill: string, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function rrect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number, fill?: string): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

export function leaf(ctx: Ctx2D, x: number, y: number, len: number, width: number, angle: number, color: string): void {
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
  ctx.lineWidth = Math.max(1, len / 18);
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(0, -len * 0.85);
  ctx.stroke();
  ctx.restore();
}

export function star(ctx: Ctx2D, cx: number, cy: number, outer: number, inner: number, fill: string): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Rozjaśnia/przyciemnia kolor #rrggbb o współczynnik (-1..1). */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(Math.min(255, Math.max(0, amount >= 0 ? v + (255 - v) * amount : v * (1 + amount))));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
