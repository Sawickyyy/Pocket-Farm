// Drogi i dojazd (docs/plan-osada.md §3): kafle drogi, spójne składowe sieci, dostęp budynków, dojazd dom → praca
// i trasy dla grafiki chodzących mieszkańców. Sieć liczona raz i trzymana w cache (WeakMap po stanie gry) –
// stan jest mutowany w miejscu, więc cache sprawdza sygnaturę obiektów drogowych (uid:x:y:built) przy każdym użyciu.
// Przy sieci trzymamy też indeks uid → obiekt i dostęp budynków, żeby pętle dojazdu nie przeglądały całej mapy.

import type { BuildingDef, Content } from '../../../content/content';
import type { Ctx } from '../../ctx';
import type { GameState, PlacedObject } from '../../types';
import { MAP_H, MAP_W, type WorldMap } from '../../world';
import { centerOf, hasService, isBuilt, objectByUid } from './common';

export interface Tile {
  x: number;
  y: number;
}

/** Typ drogi kamiennej (szybszy chód w grafice). */
export const STONE_ROAD = 'road';
/** Mnożnik prędkości chodu na drodze kamiennej – tylko grafika, bez wpływu na symulację. */
export const STONE_ROAD_SPEED = 1.25;

/** Czy obiekt tego typu tworzy kafle drogi (ścieżka, droga, most – most dopiero po ukończeniu). */
export const isRoadDef = (def: BuildingDef | undefined): boolean => def?.kind === 'path' || def?.kind === 'bridge';

const N = MAP_W * MAP_H;
// Sąsiedzi w stałej kolejności (determinizm): góra, prawo, dół, lewo.
const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;

const inMap = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

// ---------------------------------------------------------------- sieć (cache)

/** Dostęp budynku do sieci (ważny, dopóki obiekt stoi w tym samym miejscu i ma ten sam typ). */
interface Access {
  x: number;
  y: number;
  type: string;
  ids: number[];
}

interface RoadNetwork {
  world: WorldMap;
  c: Content;
  /** Tablica obiektów, długość i licznik uid z chwili liczenia – zmiana któregokolwiek = ponowne sprawdzenie. */
  objects: PlacedObject[];
  length: number;
  nextUid: number;
  /** Obiekty drogowe (referencje), ich indeksy w `s.objects` i położenie. */
  refs: PlacedObject[];
  index: Int32Array;
  xs: Float64Array;
  ys: Float64Array;
  /** Mosty: indeksy w `refs` i ukończenie (1/0) z chwili liczenia. */
  bridges: number[];
  bridgeBuilt: number[];
  /** Sygnatura `uid:x:y:built|…` obiektów drogowych. */
  key: string;
  tiles: Uint8Array;
  stone: Uint8Array;
  comp: Int32Array;
  count: number;
  /** uid → indeks w `s.objects` (leniwie; kasowany przy każdej zmianie tablicy obiektów). */
  byUid: Map<number, number> | null;
  /** uid → dostęp budynku (zależy od `comp`, więc żyje tyle co składowe). */
  access: Map<number, Access>;
}

const cache = new WeakMap<GameState, RoadNetwork>();

/** Szybkie sprawdzenie, czy sieć z cache nadal odpowiada stanowi (bez budowania sygnatury) – O(liczba dróg). */
function stillValid(net: RoadNetwork, s: GameState, c: Content, world: WorldMap): boolean {
  const objects = s.objects;
  if (net.world !== world || net.c !== c || net.objects !== objects || net.length !== objects.length || net.nextUid !== s.nextUid) return false;
  const { refs, index, xs, ys, bridges, bridgeBuilt } = net;
  for (let i = 0; i < refs.length; i++) {
    const o = refs[i]!;
    if (objects[index[i]!] !== o || o.x !== xs[i] || o.y !== ys[i]) return false;
  }
  for (let j = 0; j < bridges.length; j++) {
    if ((isBuilt(s, refs[bridges[j]!]!.uid) ? 1 : 0) !== bridgeBuilt[j]) return false;
  }
  return true;
}

function network(s: GameState, c: Content, world: WorldMap): RoadNetwork {
  const prev = cache.get(s);
  if (prev && stillValid(prev, s, c, world)) return prev;

  const refs: PlacedObject[] = [];
  const at: number[] = [];
  const bridges: number[] = [];
  const bridgeBuilt: number[] = [];
  const parts: string[] = [];
  s.objects.forEach((o, i) => {
    const def = c.buildings[o.type];
    if (!isRoadDef(def)) return;
    let b = 1;
    if (def?.kind === 'bridge') {
      b = isBuilt(s, o.uid) ? 1 : 0;
      bridges.push(refs.length);
      bridgeBuilt.push(b);
    }
    refs.push(o);
    at.push(i);
    parts.push(`${o.uid}:${o.x}:${o.y}:${b}`);
  });
  const key = parts.join('|');
  const quick = {
    objects: s.objects,
    length: s.objects.length,
    nextUid: s.nextUid,
    refs,
    index: Int32Array.from(at),
    xs: Float64Array.from(refs, (o) => o.x),
    ys: Float64Array.from(refs, (o) => o.y),
    bridges,
    bridgeBuilt,
    key,
    byUid: null,
  };

  // Zmiana tylko poza drogami (np. nowy dom) – sieć bez zmian, odświeżamy dane szybkiego sprawdzenia.
  if (prev && prev.world === world && prev.c === c && prev.key === key) {
    Object.assign(prev, quick);
    return prev;
  }

  const unbuilt = new Set<number>();
  bridges.forEach((r, j) => {
    if (!bridgeBuilt[j]) unbuilt.add(r);
  });
  const tiles = new Uint8Array(N);
  const stone = new Uint8Array(N);
  const road = world.road;
  for (let i = 0; i < N; i++) if (road[i] === 1) tiles[i] = 1;
  refs.forEach((o, i) => {
    if (unbuilt.has(i)) return; // most w budowie
    const [w, h] = c.buildings[o.type]?.size ?? [1, 1];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const x = o.x + dx;
        const y = o.y + dy;
        if (!inMap(x, y)) continue;
        tiles[y * MAP_W + x] = 1;
        if (o.type === STONE_ROAD) stone[y * MAP_W + x] = 1;
      }
    }
  });

  // Składowe: BFS w 4-sąsiedztwie, numerowane w kolejności pierwszego kafla (wiersz po wierszu).
  const comp = new Int32Array(N).fill(-1);
  const queue = new Int32Array(N);
  let count = 0;
  for (let start = 0; start < N; start++) {
    if (!tiles[start] || comp[start]! >= 0) continue;
    comp[start] = count;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    while (head < tail) {
      const cur = queue[head++]!;
      const cx = cur % MAP_W;
      const cy = (cur - cx) / MAP_W;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DX[k]!;
        const ny = cy + DY[k]!;
        if (!inMap(nx, ny)) continue;
        const ni = ny * MAP_W + nx;
        if (!tiles[ni] || comp[ni]! >= 0) continue;
        comp[ni] = count;
        queue[tail++] = ni;
      }
    }
    count++;
  }

  const net: RoadNetwork = { world, c, ...quick, tiles, stone, comp, count, access: new Map() };
  cache.set(s, net);
  return net;
}

/** Obiekt po uid przez indeks sieci (O(1)); indeks budowany leniwie, weryfikowany przy każdym trafieniu. */
function findObject(net: RoadNetwork, s: GameState, uid: number): PlacedObject | undefined {
  let map = net.byUid;
  if (!map) {
    const m = new Map<number, number>();
    s.objects.forEach((o, i) => m.set(o.uid, i));
    net.byUid = map = m;
  }
  const i = map.get(uid);
  const o = i === undefined ? undefined : s.objects[i];
  return o && o.uid === uid ? o : objectByUid(s, uid);
}

/** Składowe przy budynku z pamięci sieci (wewnętrzne – wyniku nie modyfikować). */
function accessIds(net: RoadNetwork, c: Content, o: PlacedObject): number[] {
  const hit = net.access.get(o.uid);
  if (hit && hit.x === o.x && hit.y === o.y && hit.type === o.type) return hit.ids;
  const ids = accessList(net.comp, c, o);
  net.access.set(o.uid, { x: o.x, y: o.y, type: o.type, ids });
  return ids;
}

// ---------------------------------------------------------------- zapytania

/** Mapa kafli drogi (1 = droga): obiekty `kind` path/bridge + drogi wioski (`world.road`). Kopia – można modyfikować. */
export function roadTiles(s: GameState, c: Content, world: WorldMap): Uint8Array {
  return network(s, c, world).tiles.slice();
}

/** Id spójnej składowej sieci dróg dla każdego kafla (−1 = brak drogi). Wynik z cache – tylko do odczytu. */
export function roadComponents(s: GameState, c: Content, world: WorldMap): Int32Array {
  return network(s, c, world).comp;
}

/** Liczba spójnych składowych sieci dróg (np. do podpowiedzi w UI). */
export function roadComponentCount(s: GameState, c: Content, world: WorldMap): number {
  return network(s, c, world).count;
}

/** Posortowane składowe kafli drogi w obrysie budynku (sam jest drogą) i przylegających do niego (4-sąsiedztwo). */
function accessList(comp: Int32Array, c: Content, o: PlacedObject): number[] {
  const [w, h] = c.buildings[o.type]?.size ?? [1, 1];
  const out: number[] = [];
  const add = (x: number, y: number): void => {
    if (!inMap(x, y)) return;
    const id = comp[y * MAP_W + x]!;
    if (id >= 0 && !out.includes(id)) out.push(id);
  };
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) add(o.x + dx, o.y + dy);
  for (let dx = 0; dx < w; dx++) {
    add(o.x + dx, o.y - 1);
    add(o.x + dx, o.y + h);
  }
  for (let dy = 0; dy < h; dy++) {
    add(o.x - 1, o.y + dy);
    add(o.x + w, o.y + dy);
  }
  return out.sort((a, b) => a - b);
}

/** Składowe dróg przylegające (4-sąsiedztwo) do obrysu budynku `uid` (gdy budynek sam jest drogą – jego składowa). */
export function accessOf(s: GameState, c: Content, world: WorldMap, uid: number): number[] {
  const net = network(s, c, world);
  const o = findObject(net, s, uid);
  return o ? accessIds(net, c, o).slice() : [];
}

/** Czy budynek ma dostęp do jakiejkolwiek drogi. */
export function isConnected(ctx: Ctx, uid: number): boolean {
  const net = network(ctx.s, ctx.c, ctx.world);
  const o = findObject(net, ctx.s, uid);
  return !!o && accessIds(net, ctx.c, o).length > 0;
}

/** Odległość Manhattan środków dwóch obiektów (w kaflach, środki mogą być połówkowe). */
export function commuteDistance(c: Content, a: PlacedObject, b: PlacedObject): number {
  const p = centerOf(c, a);
  const q = centerOf(c, b);
  return Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
}

/** Wspólna składowa w dwóch posortowanych (krótkich) listach. */
const shareComponent = (a: number[], b: number[]): boolean => a.length > 0 && b.length > 0 && a.some((id) => b.includes(id));

/**
 * Dojazd dom → praca bez ponownego sprawdzania sieci przy każdym wywołaniu – dla pętli przydziałów
 * (np. `jobs.assign`: bezrobotni × wolne etaty). Zwrócona funkcja jest ważna tylko do najbliższej zmiany
 * obiektów, mostów lub obsady zajezdni (w obrębie jednego przebiegu systemu); wynik jak `canCommute`.
 */
export function commuteChecker(ctx: Ctx): (homeUid: number, jobUid: number) => boolean {
  const { s, c, world } = ctx;
  const net = network(s, c, world);
  const k = c.settlement.constants;
  const depotRange = Math.max(k.offroadDistance, k.offroadDistanceDepot);
  let depot: boolean | undefined;
  return (homeUid, jobUid) => {
    const home = findObject(net, s, homeUid);
    const job = findObject(net, s, jobUid);
    if (!home || !job) return false;
    const dist = commuteDistance(c, home, job);
    if (dist <= k.offroadDistance) return true;
    if (shareComponent(accessIds(net, c, home), accessIds(net, c, job))) return true;
    // Zajezdnia sprawdzana na końcu i raz na przebieg – hasService przegląda wszystkie obiekty.
    return dist <= depotRange && (depot ??= hasService(s, c, 'transport'));
  };
}

/** Dojazd dom → praca: wspólna składowa dróg albo odległość środków (Manhattan) ≤ 6 (≤ 12 z zajezdnią). */
export function canCommute(ctx: Ctx, homeUid: number, jobUid: number): boolean {
  return commuteChecker(ctx)(homeUid, jobUid);
}

/** Kafle drogi przylegające do (x, y) w stałej kolejności sąsiadów. */
function roadNeighbors(tiles: Uint8Array, x: number, y: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < 4; k++) {
    const nx = x + DX[k]!;
    const ny = y + DY[k]!;
    if (inMap(nx, ny) && tiles[ny * MAP_W + nx]) out.push(ny * MAP_W + nx);
  }
  return out;
}

/**
 * Najkrótsza trasa po kaflach drogi (BFS, 4-sąsiedztwo) od `from` do `to` włącznie – dla grafiki.
 * `from`/`to` poza drogą: pierwszy/ostatni krok to zejście z/na przylegający kafel drogi. Trasa zawsze prowadzi
 * przez co najmniej jeden kafel drogi (poza `from == to` → `[from]`). null, gdy brak połączenia lub poza mapą.
 */
export function findPath(s: GameState, c: Content, world: WorldMap, from: Tile, to: Tile): Tile[] | null {
  const fx = Math.floor(from.x);
  const fy = Math.floor(from.y);
  const tx = Math.floor(to.x);
  const ty = Math.floor(to.y);
  if (!inMap(fx, fy) || !inMap(tx, ty)) return null;
  if (fx === tx && fy === ty) return [{ x: fx, y: fy }];
  const { tiles, comp } = network(s, c, world);
  const fi = fy * MAP_W + fx;
  const ti = ty * MAP_W + tx;
  const sources = tiles[fi] ? [fi] : roadNeighbors(tiles, fx, fy);
  const targets = tiles[ti] ? [ti] : roadNeighbors(tiles, tx, ty);
  // Szybkie odrzucenie: początek i koniec w różnych składowych.
  if (!sources.some((i) => targets.some((j) => comp[i] === comp[j]))) return null;

  // BFS z wielu źródeł; −2 = nieodwiedzony, −1 = źródło.
  const parent = new Int32Array(N).fill(-2);
  const queue = new Int32Array(N);
  let head = 0;
  let tail = 0;
  let hit = -1;
  for (const src of sources) {
    if (parent[src] !== -2) continue;
    parent[src] = -1;
    if (targets.includes(src)) {
      hit = src;
      break;
    }
    queue[tail++] = src;
  }
  while (hit < 0 && head < tail) {
    const cur = queue[head++]!;
    const cx = cur % MAP_W;
    const cy = (cur - cx) / MAP_W;
    for (let k = 0; k < 4; k++) {
      const nx = cx + DX[k]!;
      const ny = cy + DY[k]!;
      if (!inMap(nx, ny)) continue;
      const ni = ny * MAP_W + nx;
      if (!tiles[ni] || parent[ni] !== -2) continue;
      parent[ni] = cur;
      if (targets.includes(ni)) {
        hit = ni;
        break;
      }
      queue[tail++] = ni;
    }
  }
  if (hit < 0) return null;

  const road: Tile[] = [];
  for (let i = hit; i >= 0; i = parent[i]!) road.push({ x: i % MAP_W, y: Math.floor(i / MAP_W) });
  road.reverse();
  const path: Tile[] = [];
  if (!tiles[fi]) path.push({ x: fx, y: fy });
  path.push(...road);
  if (!tiles[ti]) path.push({ x: tx, y: ty });
  return path;
}

/** Przesunięcia 0..n−1 od środka boku (floor(n/2)) na zewnątrz, remisy – mniejsze najpierw. */
function fromMiddle(n: number): number[] {
  const mid = Math.floor(n / 2);
  return Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
}

/**
 * „Drzwi” budynku dla grafiki: kafel drogi przylegający do obrysu – najpierw przed frontem (y + h), potem z prawej
 * (x + w), z tyłu (y − 1) i z lewej (x − 1), na każdym boku od środka. Bez drogi: kafel tuż przed frontem
 * (x + floor(w/2), y + h), przycięty do mapy (budynek przy krawędzi). null, gdy budynek nie istnieje.
 */
export function doorTile(s: GameState, c: Content, world: WorldMap, uid: number): Tile | null {
  const net = network(s, c, world);
  const o = findObject(net, s, uid);
  if (!o) return null;
  const [w, h] = c.buildings[o.type]?.size ?? [1, 1];
  const { tiles } = net;
  const isRoadAt = (x: number, y: number): boolean => inMap(x, y) && tiles[y * MAP_W + x] === 1;
  const alongW = fromMiddle(w);
  const alongH = fromMiddle(h);
  const sides: Tile[][] = [
    alongW.map((dx) => ({ x: o.x + dx, y: o.y + h })),
    alongH.map((dy) => ({ x: o.x + w, y: o.y + dy })),
    alongW.map((dx) => ({ x: o.x + dx, y: o.y - 1 })),
    alongH.map((dy) => ({ x: o.x - 1, y: o.y + dy })),
  ];
  for (const side of sides) for (const t of side) if (isRoadAt(t.x, t.y)) return t;
  return { x: Math.min(MAP_W - 1, Math.max(0, o.x + Math.floor(w / 2))), y: Math.min(MAP_H - 1, Math.max(0, o.y + h)) };
}

/** Mnożnik prędkości chodu na kaflu (grafika): droga kamienna ×1,25, inaczej 1. */
export function walkSpeedAt(s: GameState, c: Content, world: WorldMap, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (!inMap(xi, yi)) return 1;
  return network(s, c, world).stone[yi * MAP_W + xi] ? STONE_ROAD_SPEED : 1;
}
