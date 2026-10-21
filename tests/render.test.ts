import { describe, expect, it } from 'vitest';
import { shelfPack } from '../src/render/art/atlas';
import { colorMatrix20, daltonizeMatrix } from '../src/render/colorblind';

describe('daltonizacja', () => {
  it('tryb wyłączony to macierz jednostkowa', () => {
    expect(daltonizeMatrix('none')).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('szarości pozostają szarościami (wiersze sumują się do 1)', () => {
    for (const mode of ['protan', 'deutan'] as const) {
      const m = daltonizeMatrix(mode);
      for (let r = 0; r < 3; r++) expect(m[r * 3]! + m[r * 3 + 1]! + m[r * 3 + 2]!).toBeCloseTo(1, 1);
    }
  });

  it('macierz 4×5 zachowuje alfę', () => {
    const m = colorMatrix20('deutan');
    expect(m).toHaveLength(20);
    expect(m.slice(15)).toEqual([0, 0, 0, 1, 0]);
  });
});

describe('pakowanie atlasu', () => {
  it('nie nakłada prostokątów i mieści się w szerokości', () => {
    const sizes = [
      { w: 128, h: 128 },
      { w: 256, h: 320 },
      { w: 64, h: 64 },
      { w: 384, h: 320 },
      ...Array.from({ length: 20 }, () => ({ w: 128, h: 192 })),
    ];
    const placed = shelfPack(sizes, 1024)!;
    expect(placed).not.toBeNull();
    for (let i = 0; i < sizes.length; i++) {
      for (let j = i + 1; j < sizes.length; j++) {
        const a = { ...placed[i]!, ...sizes[i]! };
        const b = { ...placed[j]!, ...sizes[j]! };
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
      expect(placed[i]!.x + sizes[i]!.w).toBeLessThanOrEqual(1024);
    }
    expect(shelfPack([{ w: 600, h: 600 }, { w: 600, h: 600 }], 1000)).toBeNull();
  });
});

import { degree, midiToHz } from '../src/audio/music';

describe('muzyka generatywna', () => {
  it('stopnie skali i częstotliwości', () => {
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(degree('spring', 0)).toBe(60);
    expect(degree('spring', 5)).toBe(72); // pentatonika: 5. stopień = oktawa wyżej
    expect(degree('autumn', 1)).toBe(60);
    expect(degree('spring', -1)).toBe(57);
  });
});

import { ISO_HH, ISO_HW, project, projectedBounds, unproject } from '../src/render/iso';

describe('rzut izometryczny 2.5D', () => {
  it('romb kafla ma proporcje 2:1', () => {
    const top = project(0, 0);
    const right = project(1, 0);
    const bottom = project(1, 1);
    expect(right.x - top.x).toBeCloseTo(ISO_HW);
    expect(bottom.y - top.y).toBeCloseTo(2 * ISO_HH);
    expect(ISO_HW / ISO_HH).toBeCloseTo(2);
  });

  it('unproject odwraca project', () => {
    for (const [x, y] of [[0, 0], [3.5, 7.25], [47, 1], [-2, 9]] as const) {
      const p = unproject(project(x, y).x, project(x, y).y);
      expect(p.x).toBeCloseTo(x);
      expect(p.y).toBeCloseTo(y);
    }
  });

  it('zgadza się z obrotem o 45° i spłaszczeniem Y ×0,5 (kontenery ziemi)', () => {
    const T = 128;
    const rot = (X: number, Y: number) => ({ x: X * Math.cos(Math.PI / 4) - Y * Math.sin(Math.PI / 4), y: (X * Math.sin(Math.PI / 4) + Y * Math.cos(Math.PI / 4)) * 0.5 });
    const a = rot(5 * T, 2 * T);
    const b = project(5, 2);
    expect(a.x).toBeCloseTo(b.x);
    expect(a.y).toBeCloseTo(b.y);
  });

  it('prostokąt otaczający rzut', () => {
    const r = projectedBounds(0, 0, 2, 2);
    expect(r.w).toBeCloseTo(4 * ISO_HW);
    expect(r.h).toBeCloseTo(4 * ISO_HH);
  });
});
