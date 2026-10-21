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
