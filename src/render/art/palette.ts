// Bajkowa paleta i automatyczne „przejścia stylu” nakładane na każdą klatkę atlasu:
// miękka objętość (światło z góry, ciepły cień u dołu) i gruby, zaokrąglony kontur „atramentem”.

import type { Season } from '../../content/content';
import { makeCanvas, type Ctx2D } from './draw';

export const INK = '#4a2e1a';

export const PALETTE = {
  ink: INK,
  grass: { spring: '#8ed36a', summer: '#74c25a', autumn: '#c9b258', winter: '#eaf2f8' } satisfies Record<Season, string>,
  grassDeep: { spring: '#62ad4c', summer: '#4f9a43', autumn: '#a68a3e', winter: '#cfdde8' } satisfies Record<Season, string>,
  forest: { spring: '#5aa04a', summer: '#468b3e', autumn: '#94753a', winter: '#d3dee8' } satisfies Record<Season, string>,
  meadow: { spring: '#a7e07a', summer: '#95d468', autumn: '#d8c26a', winter: '#f2f7fb' } satisfies Record<Season, string>,
  flowers: ['#ffd1e8', '#fff3a8', '#ffffff', '#c9b6ff', '#ffb38a'],
  soil: '#b9774a',
  soilDeep: '#8a5333',
  soilWet: '#7a4a32',
  soilWetDeep: '#55301f',
  water: '#5cc8e6',
  waterDeep: '#3a9fd0',
  sand: '#f3dda4',
  path: '#e9cf98',
  sky: '#bfe7d6',
};

export interface StyleOptions {
  /** Grubość konturu w px (0 = bez konturu). */
  outline: number;
  /** Cieniowanie objętości. */
  shade: boolean;
}

export const STYLE_NONE: StyleOptions = { outline: 0, shade: false };

/**
 * Rysuje klatkę w osobnym płótnie, nakłada styl i zwraca gotowe płótno.
 * Kontur = sylwetka zabarwiona na INK, odbita stemplem w 12 kierunkach pod oryginałem.
 */
export function stylize(draw: (ctx: Ctx2D) => void, w: number, h: number, opts: StyleOptions): HTMLCanvasElement {
  const [art, a] = makeCanvas(w, h);
  draw(a);
  if (!opts.shade && !opts.outline) return art;

  if (opts.shade) {
    a.globalCompositeOperation = 'source-atop';
    const g = a.createLinearGradient(0, 0, w * 0.35, h);
    g.addColorStop(0, 'rgba(255,248,222,0.32)');
    g.addColorStop(0.45, 'rgba(255,248,222,0)');
    g.addColorStop(0.75, 'rgba(120,60,90,0.06)');
    g.addColorStop(1, 'rgba(90,40,70,0.22)');
    a.fillStyle = g;
    a.fillRect(0, 0, w, h);
    a.globalCompositeOperation = 'source-over';
  }
  if (!opts.outline) return art;

  // Sylwetka tylko z pikseli prawie nieprzezroczystych – cienie i poświaty nie dostają konturu.
  const [sil, s] = makeCanvas(w, h);
  const src = a.getImageData(0, 0, w, h);
  const ink = [0x4a, 0x2e, 0x1a];
  const d = src.data;
  for (let i = 0; i < d.length; i += 4) {
    const solid = d[i + 3]! > 150;
    d[i] = ink[0]!;
    d[i + 1] = ink[1]!;
    d[i + 2] = ink[2]!;
    d[i + 3] = solid ? 255 : 0;
  }
  s.putImageData(src, 0, 0);

  const [out, o] = makeCanvas(w, h);
  const r = opts.outline;
  for (let k = 0; k < 12; k++) {
    const ang = (k / 12) * Math.PI * 2;
    o.drawImage(sil, Math.cos(ang) * r, Math.sin(ang) * r);
  }
  o.drawImage(art, 0, 0);
  return out;
}

/** Akwarelowa faktura: miękkie plamy jaśniejsze/ciemniejsze (deterministyczne). */
export function watercolor(ctx: Ctx2D, x: number, y: number, w: number, h: number, rand: () => number, strength = 0.08, blobs = 14): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  for (let i = 0; i < blobs; i++) {
    const cx = x + rand() * w;
    const cy = y + rand() * h;
    const r = 14 + rand() * 34;
    const light = rand() > 0.5;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, light ? `rgba(255,255,230,${strength})` : `rgba(40,60,20,${strength})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();
}
