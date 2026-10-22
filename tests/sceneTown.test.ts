// Scena osady: czyste helpery warstw (wygląd budynków wg budowy/uszkodzeń, zasięg usług, teren, światła, cząsteczki).

import { describe, expect, it } from 'vitest';
import { CONTENT, COVERAGE_KINDS, type BuildingDef } from '../src/content/content';
import { BADGE_ORIGIN_Y, FIRE_TINT, SILHOUETTE_TINT, lookSignature, nearestSiteSize, objectLook, scorchTint, silhouetteAlpha } from '../src/render/layers/ObjectLayer';
import { COVERAGE_COLORS, coverageAlpha, coverageRuns, isCoverageKind, tilesInRadius } from '../src/render/layers/CoverageLayer';
import { TERRITORY_COLORS, dashSegments, labelScale, territoryEdges, territoryLabels } from '../src/render/layers/TerritoryLayer';
import { FIRE_COLOR, WINDOW_COLOR, fireFlicker, hasWindows, pickLights, type LightKind } from '../src/render/layers/Lighting';
import { FxBudget, isGlowParticle } from '../src/render/ParticleLayer';
import { frameFor, ruinFrame, siteFrame } from '../src/render/art/settlementArt';
import { coverage } from '../src/sim/systems/settlement/common';
import { territoryCost } from '../src/sim/systems/settlement/territory';
import type { SiteState } from '../src/sim/types';
import { makeTown, placeBuilt } from './sim/settlement/helpers';

const def = (id: string): BuildingDef => {
  const d = CONTENT.buildings[id];
  if (!d) throw new Error(`brak budynku ${id}`);
  return d;
};
const site = (patch: Partial<SiteState> = {}): SiteState => ({ built: 1, damage: 0, fire: 0, broken: false, progress: 0, repair: 0, ...patch }) as SiteState;

/** Odcień koloru 0xRRGGBB w stopniach (szarości → -1). */
function hue(c: number): number {
  const r = ((c >> 16) & 255) / 255;
  const g = ((c >> 8) & 255) / 255;
  const b = (c & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.04) return -1;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
const notPurple = (c: number) => {
  const h = hue(c);
  return h < 255 || h > 320;
};

describe('wygląd budynków osady', () => {
  it('rusztowanie i zgliszcza mają najbliższy dostępny rozmiar (bez wystawania poza obrys)', () => {
    expect(nearestSiteSize(1, 1)).toEqual([1, 1]);
    expect(nearestSiteSize(2, 2)).toEqual([2, 2]);
    expect(nearestSiteSize(3, 3)).toEqual([3, 3]);
    expect(nearestSiteSize(3, 2)).toEqual([2, 2]);
    expect(nearestSiteSize(4, 4)).toEqual([3, 3]);
    expect(nearestSiteSize(2, 1)).toEqual([1, 1]);
  });

  it('gotowy budynek: klatka wariantu wyglądu, bez nakładek', () => {
    const tent = def('tent');
    const look = objectLook(tent, 2, undefined);
    expect(look.mode).toBe('built');
    expect(look.frame).toBe(frameFor(tent, 2));
    expect(look.overlay).toBeNull();
    expect(objectLook(tent, 1, site()).mode).toBe('built');
  });

  it('budowa w toku: rusztowanie w rozmiarze obrysu i postęp', () => {
    const house = def('house');
    const look = objectLook(house, 1, site({ built: 0.4 }));
    expect(look.mode).toBe('site');
    expect(look.progress).toBeCloseTo(0.4);
    expect(look.overlay).toEqual({ frame: siteFrame(2, 2), w: 2, h: 2, dx: 0, dy: 0 });
    // sylwetka budynku zostaje w wybranym wariancie
    expect(look.frame).toBe(frameFor(house, 1));
  });

  it('uszkodzenie: osmalenie poniżej progu, zgliszcza od 0,5', () => {
    const shop = def('shop');
    const light = objectLook(shop, 0, site({ damage: 0.2 }));
    expect(light.mode).toBe('built');
    expect(light.scorch).toBeCloseTo(0.4);
    const ruin = objectLook(shop, 0, site({ damage: 0.6 }));
    expect(ruin.mode).toBe('ruin');
    expect(ruin.overlay?.frame).toBe(ruinFrame(2, 2));
    // zgliszcza mają pierwszeństwo przed budową
    expect(objectLook(def('manor'), 0, site({ built: 0.5, damage: 0.7 })).overlay?.frame).toBe(ruinFrame(3, 3));
  });

  it('pożar i awaria są flagami wyglądu', () => {
    const look = objectLook(def('school'), 0, site({ fire: 2, broken: true }));
    expect(look.burning).toBe(true);
    expect(look.broken).toBe(true);
  });

  it('podpis zmienia się tylko przy widocznej zmianie (kroki postępu co 5%)', () => {
    const d = def('house');
    const a = lookSignature(objectLook(d, 0, site({ built: 0.401 })));
    const b = lookSignature(objectLook(d, 0, site({ built: 0.405 })));
    const c = lookSignature(objectLook(d, 0, site({ built: 0.5 })));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(lookSignature(objectLook(d, 0, site({ fire: 1 })))).not.toBe(lookSignature(objectLook(d, 0, site())));
  });

  it('sylwetka budowy gęstnieje z postępem, osmalenie ciemnieje z uszkodzeniem', () => {
    const lo = silhouetteAlpha(0.1);
    const hi = silhouetteAlpha(0.9);
    expect(hi.top).toBeGreaterThan(lo.top);
    expect(hi.bottom).toBeGreaterThan(lo.bottom);
    expect(hi.top).toBeLessThan(1);
    expect(scorchTint(0)).toBe(0xffffff);
    const lum = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
    expect(lum(scorchTint(1))).toBeLessThan(lum(scorchTint(0.3)));
  });

  it('ikonki nad budynkami zaczepione w czubku ogonka dymku', () => {
    expect(BADGE_ORIGIN_Y).toBeGreaterThan(0.7);
    expect(BADGE_ORIGIN_Y).toBeLessThan(0.85);
  });
});

describe('zasięg usług', () => {
  it('każdy rodzaj zasięgu ma kolor, kolory są różne i bez fioletu', () => {
    for (const k of COVERAGE_KINDS) expect(COVERAGE_COLORS[k], k).toBeTypeOf('number');
    const all = Object.values(COVERAGE_COLORS);
    expect(new Set(all).size).toBe(all.length);
    for (const c of all) expect(notPurple(c), c.toString(16)).toBe(true);
    expect(isCoverageKind('police')).toBe(true);
    expect(isCoverageKind('storage')).toBe(false);
    expect(isCoverageKind(undefined)).toBe(false);
  });

  it('podgląd zasięgu ducha obejmuje te same kafle co pokrycie symulacji', () => {
    const sim = makeTown();
    const at = { x: 26, y: 26 };
    const uid = placeBuilt(sim, 'well', at);
    expect(uid).toBeGreaterThan(0);
    const map = coverage(sim.state, CONTENT, 'water');
    const sim1 = new Set<number>();
    map.forEach((v, i) => v > 0 && sim1.add(i));
    const r = def('well').service!.radius;
    const pre = new Set(tilesInRadius(at.x + 0.5, at.y + 0.5, r).map((t) => t.y * 64 + t.x));
    expect(pre.size).toBeGreaterThan(50);
    expect([...pre].sort()).toEqual([...sim1].sort());
  });

  it('krycie rośnie z pokryciem, zero bez koloru', () => {
    expect(coverageAlpha(0)).toBe(0);
    expect(coverageAlpha(1)).toBeGreaterThan(coverageAlpha(0.3));
    expect(coverageAlpha(1)).toBeLessThan(0.5);
  });

  it('odcinki kafli łączą sąsiednie kafle o tym samym kryciu', () => {
    const map = new Float32Array(8 * 2);
    map.set([0, 1, 1, 1, 0, 0.5, 0.5, 0], 0);
    map.set([1, 1, 0, 0, 0, 0, 0, 1], 8);
    const runs = coverageRuns(map, 8, 2);
    expect(runs.map(([x, y, len]) => [x, y, len])).toEqual([
      [1, 0, 3],
      [5, 0, 2],
      [0, 1, 2],
      [7, 1, 1],
    ]);
  });
});

describe('teren osady', () => {
  it('granica startowego terenu to kwadrat 16×16 kafli', () => {
    const edges = territoryEdges([27, 28, 35, 36]);
    expect(edges).toHaveLength(4);
    const xs = edges.flatMap((e) => [e.x1, e.x2]);
    const ys = edges.flatMap((e) => [e.y1, e.y2]);
    expect(Math.min(...xs)).toBe(24);
    expect(Math.max(...xs)).toBe(40);
    expect(Math.min(...ys)).toBe(24);
    expect(Math.max(...ys)).toBe(40);
    for (const e of edges) expect(Math.hypot(e.x2 - e.x1, e.y2 - e.y1)).toBe(16);
  });

  it('granica w kształcie litery L ma 6 odcinków', () => {
    expect(territoryEdges([27, 28, 35])).toHaveLength(6);
  });

  it('linia przerywana: kreski w obrębie odcinka', () => {
    const d = dashSegments({ x1: 0, y1: 0, x2: 10, y2: 0 }, 3, 2);
    expect(d.map((s) => [s.x1, s.x2])).toEqual([
      [0, 3],
      [5, 8],
    ]);
    expect(dashSegments({ x1: 0, y1: 0, x2: 0, y2: 0 }, 3, 2)).toEqual([]);
  });

  it('etykiety: fragmenty do kupienia z ceną, obce oznaczone, brak monet = przygaszone', () => {
    const sim = makeTown((s) => {
      s.world.revealed = [...new Set([...s.world.revealed, 19, 20, 26, 29, 34, 37, 43, 44])];
    });
    const s = sim.state;
    const labels = territoryLabels(s, CONTENT);
    const buy = labels.filter((l) => l.state !== 'foreign');
    expect(buy.length).toBeGreaterThan(0);
    for (const l of buy) {
      expect(l.cost).toBe(territoryCost(CONTENT, s.settlement.bought));
      expect(s.settlement.territory).not.toContain(l.chunk);
    }
    expect(labels.find((l) => l.chunk === 43)?.state).toBe('foreign');
    s.coins = 0;
    expect(territoryLabels(s, CONTENT).filter((l) => l.state !== 'foreign').every((l) => l.state === 'poor' || l.state === 'locked')).toBe(true);
  });

  it('etykiety mają stały rozmiar na ekranie (skala × zoom = const)', () => {
    const a = labelScale(0.5, 2) * 0.5;
    const b = labelScale(2, 2) * 2;
    expect(a).toBeCloseTo(b);
    expect(labelScale(1, 3)).toBeGreaterThan(labelScale(1, 2));
  });

  it('kolory terenu ciepłe, bez fioletu', () => {
    for (const c of Object.values(TERRITORY_COLORS)) expect(notPurple(c)).toBe(true);
  });
});

describe('światła osady', () => {
  const L = (kind: LightKind, n = 0) => ({ kind, n });

  it('pierwszeństwo przy limicie: pożar, latarnie, rośliny, okna', () => {
    const list = [L('window', 1), L('plant'), L('window', 2), L('lamp'), L('fire')];
    expect(pickLights(list, 3).map((l) => l.kind)).toEqual(['fire', 'lamp', 'plant']);
    expect(pickLights(list, 10, true).some((l) => l.kind === 'window')).toBe(false);
  });

  it('okna mają domy i budynki z bryłą, nie plac ani studnia', () => {
    expect(hasWindows(def('house'))).toBe(true);
    expect(hasWindows(def('school'))).toBe(true);
    expect(hasWindows(def('plaza'))).toBe(false);
    expect(hasWindows(def('well'))).toBe(false);
    expect(hasWindows(def('path'))).toBe(false);
  });

  it('migotanie pożaru w rozsądnych granicach', () => {
    for (let t = 0; t < 5000; t += 37) {
      const f = fireFlicker(t, 1.3);
      expect(f).toBeGreaterThanOrEqual(0.5);
      expect(f).toBeLessThanOrEqual(1.2);
    }
  });

  it('ciepłe barwy świateł i nakładek, bez fioletu', () => {
    for (const c of [WINDOW_COLOR, FIRE_COLOR, FIRE_TINT, SILHOUETTE_TINT, scorchTint(0.5), scorchTint(1)]) expect(notPurple(c), c.toString(16)).toBe(true);
  });
});

describe('cząsteczki', () => {
  it('ogień i iskry świecą (pula addytywna), reszta zwykła', () => {
    expect(isGlowParticle('p_fire')).toBe(true);
    expect(isGlowParticle('p_ember')).toBe(true);
    expect(isGlowParticle('p_smoke')).toBe(false);
  });

  it('pula efektów: seria zdarzeń gra tylko kilka, żetony wracają z czasem', () => {
    const b = new FxBudget(3, 100);
    expect([b.take(0), b.take(0), b.take(0), b.take(0)]).toEqual([true, true, true, false]);
    expect(b.take(50)).toBe(false);
    expect(b.take(120)).toBe(true);
    expect(b.take(120)).toBe(false);
    expect([b.take(1000), b.take(1000), b.take(1000), b.take(1000)]).toEqual([true, true, true, false]);
  });
});
