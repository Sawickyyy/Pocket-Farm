// Budowanie osady (UI): linia drogi, wolne miejsce, katalog (grupy, ceny z bonem, blokady), ETA budowy,
// produkcja sezonowa, tryb terenu (powody odmowy i kupno), komplet tekstów pl/en dla danych.

import { afterEach, describe, expect, it } from 'vitest';
import { CONTENT, COVERAGE_KINDS } from '../src/content/content';
import { DICTS, setLanguage } from '../src/i18n/i18n';
import { canPlace } from '../src/sim/systems/building';
import { chunkRect, inTerritory } from '../src/sim/systems/settlement/territory';
import { generateWorld } from '../src/sim/world';
import { MAX_LINE, coverageKindOf, findFreeSpot, isLineDef, lineTiles, serviceEffect, worldFor } from '../src/ui/buildMode';
import {
  CATALOG_TABS,
  catalogGroups,
  catalogLock,
  categoryOf,
  constructionEta,
  materialNeeds,
  normalizeTab,
  priceInfo,
  productionOutput,
} from '../src/ui/panels/build';
import { nextTerritoryTier, territoryAction } from '../src/ui/territoryMode';
import { makeSim } from './sim/helpers';
import { makeTown, placeBuilt } from './sim/settlement/helpers';

afterEach(() => setLanguage('pl'));

const def = (id: string) => CONTENT.buildings[id]!;

describe('lineTiles', () => {
  const steps = (tiles: { x: number; y: number }[]) => tiles.slice(1).map((p, i) => Math.abs(p.x - tiles[i]!.x) + Math.abs(p.y - tiles[i]!.y));

  it('pojedynczy kafel, gdy start = koniec', () => {
    expect(lineTiles({ x: 5, y: 7 }, { x: 5, y: 7 })).toEqual([{ x: 5, y: 7 }]);
  });

  it('kształt L: najpierw dłuższa oś, przy remisie poziomo', () => {
    const a = lineTiles({ x: 0, y: 0 }, { x: 3, y: 1 });
    expect(a).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
    ]);
    const b = lineTiles({ x: 4, y: 4 }, { x: 3, y: 1 });
    expect(b[1]).toEqual({ x: 4, y: 3 });
    expect(b.at(-1)).toEqual({ x: 3, y: 1 });
    const tie = lineTiles({ x: 0, y: 0 }, { x: -2, y: 2 });
    expect(tie.slice(0, 3)).toEqual([
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: -2, y: 0 },
    ]);
  });

  it('ciągła (krok o 1 kafel), bez powtórzeń, deterministyczna', () => {
    for (const [a, b] of [
      [{ x: 10, y: 10 }, { x: 2, y: 15 }],
      [{ x: 3, y: 3 }, { x: 3, y: 12 }],
      [{ x: 30, y: 20 }, { x: 26, y: 26 }],
    ] as const) {
      const line = lineTiles(a, b);
      expect(line[0]).toEqual(a);
      expect(line.at(-1)).toEqual(b);
      expect(steps(line).every((d) => d === 1)).toBe(true);
      expect(new Set(line.map((p) => `${p.x},${p.y}`)).size).toBe(line.length);
      expect(lineTiles(a, b)).toEqual(line);
    }
  });

  it('najwyżej MAX_LINE kafli', () => {
    expect(lineTiles({ x: 0, y: 0 }, { x: 60, y: 60 })).toHaveLength(MAX_LINE);
  });

  it('linią stawia się ścieżki, drogi i most', () => {
    expect(['path', 'road', 'bridge'].every((id) => isLineDef(def(id)))).toBe(true);
    expect(isLineDef(def('house'))).toBe(false);
    expect(isLineDef(undefined)).toBe(false);
  });
});

describe('findFreeSpot', () => {
  it('wolne miejsce na terenie osady, poprawne wg canPlace z mapą świata', () => {
    const sim = makeTown();
    const s = sim.state;
    const world = generateWorld(s.seed);
    for (const type of ['tent', 'house', 'well', 'warehouse', 'school']) {
      const spot = findFreeSpot(s, CONTENT, world, type, { x: 32, y: 28 });
      expect(spot, type).not.toBeNull();
      expect(canPlace(s, CONTENT, type, spot!.x, spot!.y, -1, world).ok, type).toBe(true);
      expect(inTerritory(s, spot!.x, spot!.y), type).toBe(true);
    }
  });

  it('blisko wskazanego punktu', () => {
    const s = makeTown().state;
    const world = generateWorld(s.seed);
    const near = { x: 26, y: 26 };
    const spot = findFreeSpot(s, CONTENT, world, 'tent', near)!;
    expect(Math.hypot(spot.x + 0.5 - near.x, spot.y + 0.5 - near.y)).toBeLessThan(4);
  });

  it('null, gdy przeszkoda dotyczy całej mapy (etap, jedyny, nieznany typ)', () => {
    const low = makeTown(() => {}, 42, 0).state;
    const world = generateWorld(low.seed);
    expect(findFreeSpot(low, CONTENT, world, 'school', { x: 30, y: 28 })).toBeNull();
    expect(findFreeSpot(low, CONTENT, world, 'nope', { x: 30, y: 28 })).toBeNull();
    const sim = makeTown();
    placeBuilt(sim, 'tradepost');
    expect(findFreeSpot(sim.state, CONTENT, world, 'tradepost', { x: 30, y: 28 })).toBeNull();
  });

  it('worldFor generuje mapę raz na ziarno', () => {
    const a = worldFor(42);
    expect(worldFor(42)).toBe(a);
    expect(worldFor(7)).not.toBe(a);
  });
});

describe('katalog', () => {
  it('każdy budynek w dokładnie jednej zakładce, w grupie wg etapu i ceny', () => {
    const groups = catalogGroups(CONTENT.buildingList);
    const all = CATALOG_TABS.flatMap((c) => groups[c].map((d) => d.id));
    expect(all.sort()).toEqual(CONTENT.buildingList.map((d) => d.id).sort());
    for (const c of CATALOG_TABS) {
      const g = groups[c];
      for (let i = 1; i < g.length; i++) {
        const a = g[i - 1]!;
        const b = g[i]!;
        expect((a.tier ?? 0) < (b.tier ?? 0) || ((a.tier ?? 0) === (b.tier ?? 0) && a.cost <= b.cost), `${a.id} < ${b.id}`).toBe(true);
      }
    }
    expect(groups.housing.map((d) => d.id)).toContain('tent');
    expect(groups.road.map((d) => d.id)).toEqual(expect.arrayContaining(['path', 'road', 'bridge']));
  });

  it('budynki farmy bez kategorii: ozdoby, ścieżki i latarnie → deco, reszta → farm', () => {
    const strip = (id: string) => ({ ...def(id), category: undefined }) as never;
    expect(categoryOf(strip('flowers'))).toBe('deco');
    expect(categoryOf(strip('lantern'))).toBe('deco');
    expect(categoryOf(strip('path'))).toBe('deco');
    expect(categoryOf(strip('coop'))).toBe('farm');
    expect(categoryOf(strip('mill'))).toBe('farm');
    expect(categoryOf(def('school'))).toBe('service');
  });

  it('nazwy zakładek: aliasy i domyślna', () => {
    expect(normalizeTab('houses')).toBe('housing');
    expect(normalizeTab('roads')).toBe('road');
    expect(normalizeTab('services')).toBe('service');
    expect(normalizeTab('deco')).toBe('deco');
    expect(normalizeTab('???')).toBe('housing');
  });

  it('cena z bonem rady (przekreślona katalogowa), po terminie bez zniżki', () => {
    const s = makeTown((st) => (st.settlement.vouchers.house = { discount: 0.4, untilDay: 10 })).state;
    expect(priceInfo(s, CONTENT, 'house', 5)).toEqual({ cost: Math.round(def('house').cost * 0.6), base: def('house').cost, discount: 0.4 });
    expect(priceInfo(s, CONTENT, 'house', 11)).toEqual({ cost: def('house').cost, base: def('house').cost, discount: 0 });
    expect(priceInfo(s, CONTENT, 'tent', 5).discount).toBe(0);
  });

  it('materiały: brakujące oznaczone', () => {
    const withMats = CONTENT.buildingList.find((d) => (d.materials ?? []).length > 0)!;
    const item = withMats.materials![0]!.item;
    const s = makeTown((st) => {
      st.inventory[item] = 0;
    }).state;
    const needs = materialNeeds(s, withMats);
    expect(needs[0]).toMatchObject({ item, have: 0, missing: true });
    s.inventory[item] = 999;
    expect(materialNeeds(s, withMats)[0]!.missing).toBe(false);
    expect(materialNeeds(s, def('tent'))).toEqual(def('tent').materials?.length ? expect.any(Array) : []);
  });

  it('blokady: poziom gracza, etap osady, jedyny już postawiony', () => {
    const low = makeSim((st) => (st.settlement.peakTier = 0)).state;
    const school = def('school');
    expect(catalogLock(low, CONTENT, school)).toEqual(
      school.level > 1 ? { kind: 'level', level: school.level } : { kind: 'tier', tier: school.tier },
    );
    const lowTier = makeTown(() => {}, 42, 0).state;
    expect(catalogLock(lowTier, CONTENT, school)).toEqual({ kind: 'tier', tier: 2 });
    expect(catalogLock(lowTier, CONTENT, def('tent'))).toBeNull();
    const sim = makeTown();
    expect(catalogLock(sim.state, CONTENT, def('townhall'))).toBeNull();
    placeBuilt(sim, 'townhall');
    expect(catalogLock(sim.state, CONTENT, def('townhall'))).toEqual({ kind: 'unique' });
  });
});

describe('panel budynku', () => {
  it('ETA budowy: liczba godzin dla budowy w toku, null po ukończeniu, Infinity przy pożarze', () => {
    const sim = makeTown();
    const uid = placeBuilt(sim, 'house');
    const site = sim.state.settlement.sites[String(uid)]!;
    expect(constructionEta(sim.state, CONTENT, uid, 10, 0)).toBeNull();
    site.built = 0.5;
    const slow = constructionEta(sim.state, CONTENT, uid, 10, 0)!;
    expect(slow).toBeGreaterThan(0);
    expect(Number.isFinite(slow)).toBe(true);
    const fast = constructionEta(sim.state, CONTENT, uid, 10, 2)!;
    expect(fast).toBeLessThanOrEqual(slow);
    site.fire = 1;
    expect(constructionEta(sim.state, CONTENT, uid, 10, 0)).toBe(Infinity);
  });

  it('produkcja: wyjście sezonowe albo stałe', () => {
    const seasonal = CONTENT.buildingList.find((d) => d.production?.seasonal);
    if (seasonal) {
      const [season, item] = Object.entries(seasonal.production!.seasonal!)[0]!;
      expect(productionOutput(seasonal, season)).toBe(item);
      const missing = ['spring', 'summer', 'autumn', 'winter'].find((k) => !(k in seasonal.production!.seasonal!));
      if (missing) expect(productionOutput(seasonal, missing)).toBeNull();
    }
    const steady = CONTENT.buildingList.find((d) => d.production && !d.production.seasonal)!;
    expect(productionOutput(steady, 'winter')).toBe(steady.production!.output.item);
    expect(productionOutput(def('tent'), 'spring')).toBeNull();
  });

  it('podgląd zasięgu tylko dla usług z mapą pokrycia', () => {
    expect(coverageKindOf(def('school'))).toBe('school');
    expect(coverageKindOf(def('tent'))).toBeNull();
    for (const d of CONTENT.buildingList) {
      const k = coverageKindOf(d);
      if (k) expect(COVERAGE_KINDS).toContain(k);
    }
  });
});

describe('tryb terenu', () => {
  const tileOf = (chunk: number) => {
    const r = chunkRect(chunk);
    return { x: r.x + 3, y: r.y + 3 };
  };

  it('własny, obcy, ukryty, nie przy granicy, do kupienia', () => {
    const s = makeTown((st) => (st.world.revealed = Array.from({ length: 64 }, (_, i) => i))).state;
    const at = (chunk: number) => territoryAction(s, CONTENT, tileOf(chunk).x, tileOf(chunk).y);
    expect(at(27)).toEqual({ kind: 'own', chunk: 27 });
    expect(at(CONTENT.settlement.foreignChunks[0]!)).toMatchObject({ kind: 'fail', reason: 'foreign-land' });
    expect(at(0)).toMatchObject({ kind: 'fail', reason: 'not-territory-edge' });
    expect(at(26)).toEqual({ kind: 'buy', chunk: 26, cost: 300 });
    expect(territoryAction(s, CONTENT, -1, 5)).toEqual({ kind: 'none' });
    s.world.revealed = s.world.revealed.filter((c) => c !== 26);
    expect(at(26)).toMatchObject({ kind: 'fail', reason: 'hidden' });
  });

  it('limit etapu z podpowiedzią następnego etapu', () => {
    const s = makeTown((st) => (st.world.revealed = Array.from({ length: 64 }, (_, i) => i)), 42, 0).state;
    const a = territoryAction(s, CONTENT, tileOf(26).x, tileOf(26).y);
    expect(a).toEqual({ kind: 'fail', chunk: 26, reason: 'max-territory', nextTier: 1 });
    expect(nextTerritoryTier(CONTENT, 0)).toBe(1);
    expect(nextTerritoryTier(CONTENT, CONTENT.settlement.tiers.length - 1)).toBeUndefined();
  });
});

describe('teksty dla danych (pl i en)', () => {
  const keys = (lang: 'pl' | 'en') => DICTS[lang] as Record<string, string>;

  it('efekty i nazwy usług, tereny, podpowiedzi zakładek, etapy', () => {
    const services = [...new Set(CONTENT.buildingList.flatMap((d) => (d.service ? [d.service.kind] : [])))];
    const terrains = [...new Set(CONTENT.buildingList.flatMap((d) => (d.terrain ? [d.terrain] : [])))];
    for (const lang of ['pl', 'en'] as const) {
      const d = keys(lang);
      for (const k of services) {
        expect(d[`buildTown.effect.${k}`], `${lang} effect.${k}`).toBeTruthy();
        expect(d[`buildTown.service.${k}`], `${lang} service.${k}`).toBeTruthy();
      }
      for (const k of terrains) expect(d[`buildTown.terrain.${k}`], `${lang} terrain.${k}`).toBeTruthy();
      for (const k of CATALOG_TABS) {
        expect(d[`buildTown.hint.${k}`], `${lang} hint.${k}`).toBeTruthy();
        expect(d[`category.${k}`], `${lang} category.${k}`).toBeTruthy();
      }
      for (const tier of CONTENT.settlement.tiers) expect(d[`tier.${tier.id}`], `${lang} tier.${tier.id}`).toBeTruthy();
    }
  });

  it('opis efektu z promieniem', () => {
    setLanguage('pl');
    expect(serviceEffect(def('well'))).toContain(String(def('well').service!.radius));
    setLanguage('en');
    expect(serviceEffect(def('well'))).toContain(String(def('well').service!.radius));
    expect(serviceEffect(def('tent'))).toBe('');
  });
});
