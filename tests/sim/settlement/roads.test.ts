import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/content';
import { makeCtx } from '../../../src/sim/ctx';
import { newSite } from '../../../src/sim/systems/settlement/common';
import {
  STONE_ROAD_SPEED,
  accessOf,
  canCommute,
  commuteChecker,
  commuteDistance,
  doorTile,
  findPath,
  isConnected,
  roadComponentCount,
  roadComponents,
  roadTiles,
  walkSpeedAt,
  type Tile,
} from '../../../src/sim/systems/settlement/roads';
import type { GameState, PlacedObject } from '../../../src/sim/types';
import { MAP_H, MAP_W, VILLAGE_LANE_X, VILLAGE_STREET_Y, generateWorld, tileIndex } from '../../../src/sim/world';
import { freeSpot, makeTown, placeBuilt } from './helpers';

const c = CONTENT;

/** Wstawia obiekt bezpośrednio do stanu (moduł dróg jest czysto geometryczny – bez sprawdzania terenu). */
function put(s: GameState, type: string, x: number, y: number): number {
  const uid = s.nextUid++;
  s.objects.push({ uid, type, x, y });
  return uid;
}

/** Odcinek ścieżek od (x0, y0) do (x1, y1) włącznie (poziomy lub pionowy). */
function line(s: GameState, x0: number, y0: number, x1: number, y1: number, type = 'path'): void {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) put(s, type, x, y);
}

function town(seed = 42) {
  const sim = makeTown(() => {}, seed);
  const s = sim.state;
  const world = generateWorld(s.seed);
  const ctx = () => makeCtx(sim.state, sim.bus, sim.calendar);
  const comp = (x: number, y: number) => roadComponents(s, c, world)[tileIndex(x, y)]!;
  const path = (from: Tile, to: Tile) => findPath(s, c, world, from, to);
  return { sim, s, world, ctx, comp, path };
}

/** Trasa spójna (kroki w 4-sąsiedztwie), a kafle wewnętrzne leżą na drodze. */
function expectValidPath(tiles: Uint8Array, p: Tile[]): void {
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!;
    const b = p[i]!;
    expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);
  }
  for (let i = 1; i < p.length - 1; i++) expect(tiles[tileIndex(p[i]!.x, p[i]!.y)]).toBe(1);
}

describe('osada: kafle drogi', () => {
  it('ścieżka i droga kamienna są drogą, płot nie', () => {
    const { s, world } = town();
    put(s, 'path', 5, 5);
    put(s, 'road', 6, 5);
    put(s, 'fence', 7, 5);
    const tiles = roadTiles(s, c, world);
    expect(tiles.length).toBe(MAP_W * MAP_H);
    expect(tiles[tileIndex(5, 5)]).toBe(1);
    expect(tiles[tileIndex(6, 5)]).toBe(1);
    expect(tiles[tileIndex(7, 5)]).toBe(0);
    expect(tiles[tileIndex(4, 5)]).toBe(0);
  });

  it('drogi wioski z mapy świata są drogą', () => {
    const { s, world } = town();
    const tiles = roadTiles(s, c, world);
    let n = 0;
    for (let i = 0; i < world.road.length; i++) {
      if (world.road[i] === 1) {
        n++;
        expect(tiles[i]).toBe(1);
      }
    }
    expect(n).toBeGreaterThan(0);
    expect(tiles[tileIndex(VILLAGE_LANE_X, VILLAGE_STREET_Y)]).toBe(1);
  });

  it('most staje się drogą dopiero po ukończeniu budowy', () => {
    const { s, world, comp } = town();
    line(s, 6, 10, 9, 10);
    const bridge = put(s, 'bridge', 10, 10);
    s.settlement.sites[String(bridge)] = newSite(0);
    line(s, 11, 10, 14, 10);
    expect(roadTiles(s, c, world)[tileIndex(10, 10)]).toBe(0);
    expect(comp(10, 10)).toBe(-1);
    expect(comp(9, 10)).not.toBe(comp(11, 10));
    s.settlement.sites[String(bridge)]!.built = 0.6;
    expect(comp(10, 10)).toBe(-1);
    // Ukończenie zmienia stan w miejscu – cache musi to wykryć.
    s.settlement.sites[String(bridge)]!.built = 1;
    expect(roadTiles(s, c, world)[tileIndex(10, 10)]).toBe(1);
    expect(comp(10, 10)).toBe(comp(9, 10));
    expect(comp(9, 10)).toBe(comp(11, 10));
  });

  it('most bez stanu budowy (np. z migracji) jest ukończony', () => {
    const { s, comp } = town();
    put(s, 'bridge', 10, 10);
    expect(comp(10, 10)).toBeGreaterThanOrEqual(0);
  });

  it('roadTiles zwraca kopię – modyfikacja nie psuje sieci', () => {
    const { s, world, comp } = town();
    put(s, 'path', 5, 5);
    const tiles = roadTiles(s, c, world);
    tiles[tileIndex(5, 5)] = 0;
    tiles[tileIndex(0, 0)] = 1;
    expect(roadTiles(s, c, world)[tileIndex(5, 5)]).toBe(1);
    expect(roadTiles(s, c, world)[tileIndex(0, 0)]).toBe(0);
    expect(comp(5, 5)).toBeGreaterThanOrEqual(0);
  });
});

describe('osada: składowe sieci dróg', () => {
  it('pusta osada: drogi wioski tworzą jedną składową', () => {
    const { s, world } = town();
    expect(roadComponentCount(s, c, world)).toBe(1);
    const comp = roadComponents(s, c, world);
    expect(comp.length).toBe(MAP_W * MAP_H);
    expect(comp[tileIndex(0, 0)]).toBe(-1);
  });

  it('oddzielne odcinki mają różne id, łącznik je scala', () => {
    const { s, world, comp } = town();
    line(s, 2, 5, 4, 5);
    line(s, 6, 5, 8, 5);
    put(s, 'path', 6, 6); // odnoga w dół – ta sama składowa
    const before = roadComponentCount(s, c, world);
    expect(comp(2, 5)).toBe(comp(4, 5));
    expect(comp(6, 5)).toBe(comp(8, 5));
    expect(comp(6, 6)).toBe(comp(8, 5));
    expect(comp(2, 5)).not.toBe(comp(6, 5));
    expect(comp(5, 5)).toBe(-1);
    put(s, 'road', 5, 5);
    expect(roadComponentCount(s, c, world)).toBe(before - 1);
    expect(comp(2, 5)).toBe(comp(8, 5));
    expect(comp(5, 5)).toBe(comp(6, 6));
  });

  it('sąsiedztwo po skosie nie łączy dróg', () => {
    const { s, comp } = town();
    put(s, 'path', 3, 3);
    put(s, 'path', 4, 4);
    expect(comp(3, 3)).not.toBe(comp(4, 4));
  });

  it('cache: ta sama tablica bez zmian, nowa po dodaniu, przesunięciu i usunięciu drogi', () => {
    const { s, world, comp } = town();
    put(s, 'path', 5, 5);
    const a = roadComponents(s, c, world);
    expect(roadComponents(s, c, world)).toBe(a);
    // Nowy budynek poza siecią nie zmienia dróg.
    put(s, 'house', 20, 20);
    expect(roadComponents(s, c, world)).toBe(a);
    // Nowa droga.
    const uid = put(s, 'path', 12, 12);
    const b = roadComponents(s, c, world);
    expect(b).not.toBe(a);
    expect(b[tileIndex(12, 12)]).toBeGreaterThanOrEqual(0);
    // Przesunięcie w miejscu (komenda move zmienia x/y obiektu).
    const o = s.objects.find((v) => v.uid === uid)!;
    o.x = 13;
    expect(comp(12, 12)).toBe(-1);
    expect(comp(13, 12)).toBeGreaterThanOrEqual(0);
    // Usunięcie (filtr tworzy nową tablicę obiektów).
    s.objects = s.objects.filter((v) => v.uid !== uid);
    expect(comp(13, 12)).toBe(-1);
    expect(comp(5, 5)).toBeGreaterThanOrEqual(0);
  });

  it('cache rozróżnia mapy świata', () => {
    const { s, world } = town();
    const other = { ...world, road: new Uint8Array(MAP_W * MAP_H) };
    expect(roadComponentCount(s, c, world)).toBe(1);
    expect(roadComponentCount(s, c, other)).toBe(0);
    expect(roadComponentCount(s, c, world)).toBe(1);
  });

  it('droga postawiona komendą od razu trafia do sieci', () => {
    const { sim, s, world, comp } = town();
    const spot = freeSpot(s, 'path');
    expect(comp(spot.x, spot.y)).toBe(-1);
    const count = roadComponentCount(s, c, world);
    placeBuilt(sim, 'path', spot);
    expect(comp(spot.x, spot.y)).toBeGreaterThanOrEqual(0);
    expect(roadComponentCount(s, c, world)).toBe(count + 1);
    expect(sim.dispatch({ type: 'remove', uid: s.nextUid - 1 }).ok).toBe(true);
    expect(comp(spot.x, spot.y)).toBe(-1);
  });
});

describe('osada: dostęp budynku do drogi', () => {
  it('kafel drogi przy obrysie daje dostęp, po skosie nie', () => {
    const { s, ctx, comp } = town();
    const house = put(s, 'house', 10, 10); // 2×2: kafle 10..11 × 10..11
    put(s, 'path', 12, 12);
    expect(accessOf(s, c, ctx().world, house)).toEqual([]);
    expect(isConnected(ctx(), house)).toBe(false);
    put(s, 'path', 12, 11);
    expect(accessOf(s, c, ctx().world, house)).toEqual([comp(12, 11)]);
    expect(isConnected(ctx(), house)).toBe(true);
  });

  it('dostęp z każdej strony obrysu', () => {
    for (const [x, y] of [
      [10, 9],
      [11, 9],
      [9, 10],
      [9, 11],
      [12, 10],
      [12, 11],
      [10, 12],
      [11, 12],
    ] as const) {
      const { s, ctx } = town();
      const house = put(s, 'house', 10, 10);
      put(s, 'path', x, y);
      expect(isConnected(ctx(), house), `${x},${y}`).toBe(true);
    }
  });

  it('dwie oddzielne drogi przy budynku – posortowana lista składowych', () => {
    const { s, world, comp } = town();
    const house = put(s, 'house', 10, 10);
    line(s, 10, 12, 10, 14); // pod budynkiem (niższe id składowej przy kolejności wierszy? nie – sprawdzamy sortowanie)
    line(s, 5, 10, 9, 10); // z lewej
    const ids = accessOf(s, c, world, house);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual([comp(9, 10), comp(10, 12)].sort((a, b) => a - b));
    expect(ids[0]!).toBeLessThan(ids[1]!);
  });

  it('droga sama w sobie należy do swojej składowej', () => {
    const { s, world, comp } = town();
    line(s, 3, 3, 5, 3);
    const mid = s.objects[1]!.uid;
    expect(accessOf(s, c, world, mid)).toEqual([comp(4, 3)]);
  });

  it('nieistniejący budynek nie ma dostępu', () => {
    const { s, world, ctx } = town();
    expect(accessOf(s, c, world, 999)).toEqual([]);
    expect(isConnected(ctx(), 999)).toBe(false);
  });

  it('budynek przy drodze wioski ma do niej dostęp', () => {
    const { s, world, comp } = town();
    expect(world.road[tileIndex(VILLAGE_LANE_X, 40)]).toBe(1);
    const house = put(s, 'house', VILLAGE_LANE_X, 38); // front y + h = 40
    expect(accessOf(s, c, world, house)).toEqual([comp(VILLAGE_LANE_X, 40)]);
  });

  it('budynek przy krawędzi mapy (bez wyjścia poza mapę)', () => {
    const { s, world, comp } = town();
    const house = put(s, 'house', 0, 0);
    expect(accessOf(s, c, world, house)).toEqual([]);
    put(s, 'path', 2, 0);
    expect(accessOf(s, c, world, house)).toEqual([comp(2, 0)]);
  });

  it('przesunięty budynek (komenda move zmienia x/y w miejscu) zyskuje i traci dostęp', () => {
    const { s, world, comp } = town();
    line(s, 2, 20, 8, 20);
    const house = put(s, 'house', 20, 10);
    expect(accessOf(s, c, world, house)).toEqual([]);
    const o = s.objects.find((v) => v.uid === house)!;
    o.x = 4;
    o.y = 18; // front y + h = 20 – na drodze
    expect(accessOf(s, c, world, house)).toEqual([comp(4, 20)]);
    o.y = 10;
    expect(accessOf(s, c, world, house)).toEqual([]);
  });

  it('obiekt podmieniony w tablicy (niemutowalna aktualizacja) – liczy się nowe położenie', () => {
    const { s, world, comp } = town();
    line(s, 2, 20, 8, 20);
    const house = put(s, 'house', 20, 10);
    expect(accessOf(s, c, world, house)).toEqual([]);
    const i = s.objects.findIndex((v) => v.uid === house);
    s.objects[i] = { ...s.objects[i]!, x: 4, y: 18 };
    expect(accessOf(s, c, world, house)).toEqual([comp(4, 20)]);
  });

  it('nowa droga przy budynku od razu daje dostęp (cache dostępu odświeża się z siecią)', () => {
    const { s, world, ctx, comp } = town();
    const house = put(s, 'house', 20, 10);
    expect(isConnected(ctx(), house)).toBe(false);
    put(s, 'path', 22, 11);
    expect(isConnected(ctx(), house)).toBe(true);
    expect(accessOf(s, c, world, house)).toEqual([comp(22, 11)]);
  });

  it('accessOf zwraca kopię – modyfikacja wyniku nie psuje kolejnych zapytań', () => {
    const { s, world, comp } = town();
    const house = put(s, 'house', 10, 10);
    put(s, 'path', 12, 10);
    const ids = accessOf(s, c, world, house);
    ids.push(99);
    ids[0] = -5;
    expect(accessOf(s, c, world, house)).toEqual([comp(12, 10)]);
  });
});

describe('osada: dojazd dom → praca', () => {
  it('blisko bez drogi: dojazd jest (granica 6 kafli włącznie)', () => {
    const { s, ctx } = town();
    const home = put(s, 'house', 10, 10); // środek (11, 11)
    const near = put(s, 'workshop', 14, 10); // środek (15, 11): 4
    const edge = put(s, 'workshop', 16, 14); // środek (17, 15): 6 + 4 = 10 – za daleko
    const six = put(s, 'workshop', 13, 14); // środek (14, 15): 3 + 4 = 7 – za daleko
    const exact = put(s, 'workshop', 10, 16); // środek (11, 17): 6
    expect(canCommute(ctx(), home, near)).toBe(true);
    expect(canCommute(ctx(), home, exact)).toBe(true);
    expect(canCommute(ctx(), home, six)).toBe(false);
    expect(canCommute(ctx(), home, edge)).toBe(false);
  });

  it('daleko: dojazd tylko przez wspólną drogę', () => {
    const { s, ctx } = town();
    const home = put(s, 'house', 10, 10);
    const job = put(s, 'workshop', 20, 10); // 10 kafli
    expect(canCommute(ctx(), home, job)).toBe(false);
    line(s, 12, 10, 15, 10);
    line(s, 17, 10, 19, 10);
    expect(canCommute(ctx(), home, job)).toBe(false); // luka w drodze
    put(s, 'road', 16, 10);
    expect(canCommute(ctx(), home, job)).toBe(true);
    expect(canCommute(ctx(), job, home)).toBe(true);
  });

  it('daleko: obie budowle przy drogach, ale różnych sieciach – brak dojazdu', () => {
    const { s, ctx } = town();
    const home = put(s, 'house', 10, 10);
    const job = put(s, 'workshop', 30, 4);
    line(s, 10, 12, 16, 12);
    line(s, 30, 6, 30, 9);
    expect(isConnected(ctx(), home)).toBe(true);
    expect(isConnected(ctx(), job)).toBe(true);
    expect(canCommute(ctx(), home, job)).toBe(false);
  });

  it('dojazd przez drogi wioski', () => {
    const { s, ctx } = town();
    const home = put(s, 'house', VILLAGE_LANE_X, 38); // przy dróżce wioski
    const job = put(s, 'workshop', 25, VILLAGE_STREET_Y + 1); // przy ulicy, środek (26, 46): 7 + 7 = 14
    expect(canCommute(ctx(), home, job)).toBe(true);
  });

  it('zajezdnia zwiększa zasięg dojazdu bez dróg do 12 kafli', () => {
    const { s, ctx } = town();
    const home = put(s, 'house', 10, 10);
    const ten = put(s, 'workshop', 20, 10); // 10
    const twelve = put(s, 'workshop', 22, 10); // 12
    const far = put(s, 'workshop', 23, 10); // 13
    expect(canCommute(ctx(), home, ten)).toBe(false);
    const depot = put(s, 'depot', 40, 4);
    s.settlement.sites[String(depot)] = newSite(0);
    expect(canCommute(ctx(), home, ten)).toBe(false); // zajezdnia w budowie nie działa
    s.settlement.sites[String(depot)]!.built = 1;
    expect(canCommute(ctx(), home, ten)).toBe(true);
    expect(canCommute(ctx(), home, twelve)).toBe(true);
    expect(canCommute(ctx(), home, far)).toBe(false);
    s.settlement.sites[String(depot)]!.broken = true;
    expect(canCommute(ctx(), home, ten)).toBe(false); // awaria zajezdni
  });

  it('nieistniejący budynek: brak dojazdu', () => {
    const { s, ctx } = town();
    const home = put(s, 'house', 10, 10);
    expect(canCommute(ctx(), home, 999)).toBe(false);
    expect(canCommute(ctx(), 999, home)).toBe(false);
    expect(commuteChecker(ctx())(home, 999)).toBe(false);
  });

  it('odległość dojazdu: Manhattan środków (połówkowe środki budynków o nieparzystym boku)', () => {
    const { s } = town();
    put(s, 'house', 10, 10); // 2×2 → środek (11, 11)
    put(s, 'plaza', 20, 20); // 3×3 → środek (21,5; 21,5)
    put(s, 'path', 11, 11); // 1×1 → środek (11,5; 11,5)
    const [house, plaza, path] = s.objects.slice(-3) as [PlacedObject, PlacedObject, PlacedObject];
    expect(commuteDistance(c, house, plaza)).toBe(21);
    expect(commuteDistance(c, house, path)).toBe(1);
    expect(commuteDistance(c, plaza, house)).toBe(21);
  });

  it('commuteChecker daje te same wyniki co canCommute (drogi, odległość, zajezdnia)', () => {
    const { s, ctx } = town();
    line(s, 2, 30, 40, 30);
    line(s, 20, 31, 20, 40);
    const uids: number[] = [];
    for (let i = 0; i < 24; i++) uids.push(put(s, i % 2 ? 'house' : 'workshop', 2 + (i % 8) * 5, 26 + Math.floor(i / 8) * 6));
    const check = () => {
      const chk = commuteChecker(ctx());
      let yes = 0;
      for (const a of uids) {
        for (const b of uids) {
          const v = canCommute(ctx(), a, b);
          expect(chk(a, b), `${a}→${b}`).toBe(v);
          if (v) yes++;
        }
      }
      return yes;
    };
    const withoutDepot = check();
    expect(withoutDepot).toBeGreaterThan(uids.length);
    expect(withoutDepot).toBeLessThan(uids.length * uids.length);
    put(s, 'depot', 50, 4);
    expect(check()).toBeGreaterThan(withoutDepot);
  });
});

describe('osada: trasy po drogach (findPath)', () => {
  it('ten sam kafel: trasa jednoelementowa', () => {
    const { path } = town();
    expect(path({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([{ x: 3, y: 3 }]);
  });

  it('prosta droga: kolejne kafle od początku do końca', () => {
    const { s, path } = town();
    line(s, 2, 5, 8, 5);
    const p = path({ x: 2, y: 5 }, { x: 8, y: 5 })!;
    expect(p).toEqual(Array.from({ length: 7 }, (_, i) => ({ x: 2 + i, y: 5 })));
    expect(path({ x: 8, y: 5 }, { x: 2, y: 5 })).toEqual([...p].reverse());
  });

  it('początek i koniec poza drogą: zejście z i na przylegający kafel drogi', () => {
    const { s, world, path } = town();
    line(s, 2, 5, 8, 5);
    const p = path({ x: 2, y: 4 }, { x: 8, y: 6 })!;
    expect(p).toHaveLength(9);
    expect(p[0]).toEqual({ x: 2, y: 4 });
    expect(p[1]).toEqual({ x: 2, y: 5 });
    expect(p.at(-2)).toEqual({ x: 8, y: 5 });
    expect(p.at(-1)).toEqual({ x: 8, y: 6 });
    expectValidPath(roadTiles(s, c, world), p);
    // Kafel drogi tuż przy celu.
    expect(path({ x: 5, y: 5 }, { x: 5, y: 6 })).toEqual([
      { x: 5, y: 5 },
      { x: 5, y: 6 },
    ]);
    expect(path({ x: 5, y: 4 }, { x: 5, y: 6 })).toEqual([
      { x: 5, y: 4 },
      { x: 5, y: 5 },
      { x: 5, y: 6 },
    ]);
  });

  it('wybiera najkrótszą z dwóch tras, a bez skrótu idzie objazdem', () => {
    const { s, world, path } = town();
    line(s, 2, 5, 10, 5); // skrót
    line(s, 2, 6, 2, 9);
    line(s, 3, 9, 9, 9);
    line(s, 10, 6, 10, 9); // objazd
    const short = path({ x: 2, y: 5 }, { x: 10, y: 5 })!;
    expect(short).toHaveLength(9);
    expect(short.every((t) => t.y === 5)).toBe(true);
    s.objects = s.objects.filter((o) => !(o.x === 6 && o.y === 5));
    const detour = path({ x: 2, y: 5 }, { x: 10, y: 5 })!;
    expect(detour).toHaveLength(1 + 4 + 8 + 4);
    expectValidPath(roadTiles(s, c, world), detour);
  });

  it('brak połączenia, brak drogi przy kaflu albo poza mapą: null', () => {
    const { s, path } = town();
    line(s, 2, 5, 4, 5);
    line(s, 6, 5, 8, 5);
    expect(path({ x: 2, y: 5 }, { x: 8, y: 5 })).toBeNull();
    expect(path({ x: 0, y: 0 }, { x: 2, y: 5 })).toBeNull();
    expect(path({ x: 2, y: 5 }, { x: 0, y: 20 })).toBeNull();
    expect(path({ x: -1, y: 5 }, { x: 2, y: 5 })).toBeNull();
    expect(path({ x: 2, y: 5 }, { x: MAP_W, y: 5 })).toBeNull();
    expect(path({ x: 2, y: 5 }, { x: 3, y: MAP_H })).toBeNull();
    // Dwa sąsiednie kafle bez drogi – trasa musi prowadzić po drodze.
    expect(path({ x: 20, y: 20 }, { x: 21, y: 20 })).toBeNull();
  });

  it('trasa przez most dopiero po jego ukończeniu', () => {
    const { s, path } = town();
    line(s, 6, 10, 9, 10);
    const bridge = put(s, 'bridge', 10, 10);
    s.settlement.sites[String(bridge)] = newSite(0);
    line(s, 11, 10, 14, 10);
    expect(path({ x: 6, y: 10 }, { x: 14, y: 10 })).toBeNull();
    s.settlement.sites[String(bridge)]!.built = 1;
    expect(path({ x: 6, y: 10 }, { x: 14, y: 10 })).toHaveLength(9);
  });

  it('od drzwi domu do drzwi pracy przez drogi wioski', () => {
    const { s, world, path } = town();
    const home = put(s, 'house', VILLAGE_LANE_X, 38);
    const job = put(s, 'workshop', 25, VILLAGE_STREET_Y + 1);
    const a = doorTile(s, c, world, home)!;
    const b = doorTile(s, c, world, job)!;
    const p = path(a, b)!;
    expect(p).not.toBeNull();
    expect(p[0]).toEqual(a);
    expect(p.at(-1)).toEqual(b);
    expectValidPath(roadTiles(s, c, world), p);
  });

  it('deterministyczna: ten sam seed i układ dróg dają tę samą trasę i składowe', () => {
    const build = () => {
      const t = town(7);
      // Siatka z wieloma trasami o tej samej długości.
      for (let y = 2; y <= 12; y += 2) line(t.s, 2, y, 14, y);
      for (let x = 2; x <= 14; x += 4) line(t.s, x, 3, x, 11);
      return t;
    };
    const a = build();
    const b = build();
    const pa = a.path({ x: 2, y: 2 }, { x: 14, y: 12 })!;
    const pb = b.path({ x: 2, y: 2 }, { x: 14, y: 12 })!;
    expect(pa).toHaveLength(12 + 10 + 1);
    expect(pa).toEqual(pb);
    expect(a.path({ x: 2, y: 2 }, { x: 14, y: 12 })).toEqual(pa);
    expect(Array.from(roadComponents(a.s, c, a.world))).toEqual(Array.from(roadComponents(b.s, c, b.world)));
  });
});

describe('osada: drzwi budynku (doorTile)', () => {
  it('bez drogi: kafel tuż przed frontem', () => {
    const { s, world } = town();
    const house = put(s, 'house', 10, 10);
    const plaza = put(s, 'plaza', 20, 20); // 3×3
    expect(doorTile(s, c, world, house)).toEqual({ x: 11, y: 12 });
    expect(doorTile(s, c, world, plaza)).toEqual({ x: 21, y: 23 });
  });

  it('preferuje drogę przed frontem (od środka boku), potem z prawej, z tyłu i z lewej', () => {
    const { s, world } = town();
    const house = put(s, 'house', 10, 10);
    const left = put(s, 'path', 9, 11);
    expect(doorTile(s, c, world, house)).toEqual({ x: 9, y: 11 });
    const back = put(s, 'path', 10, 9);
    expect(doorTile(s, c, world, house)).toEqual({ x: 10, y: 9 });
    const right = put(s, 'path', 12, 10);
    expect(doorTile(s, c, world, house)).toEqual({ x: 12, y: 10 });
    put(s, 'path', 10, 12);
    expect(doorTile(s, c, world, house)).toEqual({ x: 10, y: 12 });
    put(s, 'path', 11, 12);
    expect(doorTile(s, c, world, house)).toEqual({ x: 11, y: 12 });
    void left;
    void back;
    void right;
  });

  it('nieistniejący budynek: null', () => {
    const { s, world } = town();
    expect(doorTile(s, c, world, 999)).toBeNull();
  });

  it('budynek przy dolnej krawędzi mapy: kafel przed frontem przycięty do mapy', () => {
    const { s, world } = town();
    const house = put(s, 'house', 10, MAP_H - 2); // front y + h = MAP_H – poza mapą
    expect(doorTile(s, c, world, house)).toEqual({ x: 11, y: MAP_H - 1 });
    put(s, 'path', 12, MAP_H - 1); // droga z prawej
    expect(doorTile(s, c, world, house)).toEqual({ x: 12, y: MAP_H - 1 });
  });

  it('droga wioski przed frontem jest drzwiami', () => {
    const { s, world } = town();
    const house = put(s, 'house', VILLAGE_LANE_X, 38);
    expect(doorTile(s, c, world, house)).toEqual({ x: VILLAGE_LANE_X, y: 40 });
  });
});

describe('osada: prędkość chodu (grafika)', () => {
  it('droga kamienna przyspiesza, ścieżka i trawa nie', () => {
    const { s, world } = town();
    put(s, 'road', 5, 5);
    put(s, 'path', 6, 5);
    expect(walkSpeedAt(s, c, world, 5, 5)).toBe(STONE_ROAD_SPEED);
    expect(walkSpeedAt(s, c, world, 5.7, 5.2)).toBe(STONE_ROAD_SPEED);
    expect(walkSpeedAt(s, c, world, 6, 5)).toBe(1);
    expect(walkSpeedAt(s, c, world, 7, 5)).toBe(1);
    expect(walkSpeedAt(s, c, world, -1, 5)).toBe(1);
  });
});

describe('osada: wydajność sieci dróg', () => {
  it('pełna mapa z ~300 drogami: składowe szybko, zapytania z cache tanio', () => {
    const { s, world, ctx } = town();
    for (let y = 1; y < MAP_H; y += 8) line(s, 2, y, 41, y); // 8 × 40 = 320 kafli
    for (let i = 0; i < 150; i++) put(s, 'house', 44 + (i % 10) * 2, 1 + Math.floor(i / 10) * 4);
    const homes = s.objects.filter((o) => o.type === 'house').map((o) => o.uid);
    expect(s.objects.filter((o) => o.type === 'path')).toHaveLength(320);

    let t = performance.now();
    const comp = roadComponents(s, c, world);
    const first = performance.now() - t;
    expect(comp[tileIndex(2, 1)]).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(50);

    t = performance.now();
    for (let i = 0; i < 2000; i++) roadComponents(s, c, world);
    expect(performance.now() - t).toBeLessThan(50);

    const cx = ctx();
    t = performance.now();
    let n = 0;
    for (let i = 0; i < 2000; i++) if (canCommute(cx, homes[i % homes.length]!, homes[(i * 7 + 3) % homes.length]!)) n++;
    expect(performance.now() - t).toBeLessThan(100);
    expect(n).toBeGreaterThan(0);

    // Pętla przydziałów: wszystkie pary 150 × 150 jednym sprawdzeniem sieci.
    t = performance.now();
    const chk = commuteChecker(cx);
    let m = 0;
    for (const a of homes) for (const b of homes) if (chk(a, b)) m++;
    expect(performance.now() - t).toBeLessThan(40);
    expect(m).toBeGreaterThan(homes.length);

    t = performance.now();
    for (let i = 0; i < 50; i++) expect(findPath(s, c, world, { x: 2, y: 1 }, { x: 41, y: 57 })).toBeNull();
    for (let i = 0; i < 50; i++) expect(findPath(s, c, world, { x: 2, y: 1 }, { x: 41, y: 1 })).toHaveLength(40);
    expect(performance.now() - t).toBeLessThan(100);
  });
});
