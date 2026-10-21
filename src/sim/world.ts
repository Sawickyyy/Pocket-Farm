// Proceduralna mapa świata wokół farmy (deterministyczna z seeda): łąki, las, rzeka, plaża.
// Mapa jest podzielona na fragmenty 8×8 kafli zakryte mgłą – gracz je odkrywa.

import type { Biome } from '../content/content';
import { hashFloat } from '../core/rng';

export const MAP_W = 64;
export const MAP_H = 64;
export const CHUNK = 8;
export const CHUNKS_X = MAP_W / CHUNK;
export const CHUNKS_Y = MAP_H / CHUNK;

/** Strefa farmy (budowanie) – 16×16 kafli w środku mapy. */
export const FARM = { x: 24, y: 24, w: 16, h: 16 } as const;
/** Pole uprawne 6×8 wewnątrz farmy. */
export const FIELD = { x: 29, y: 30, w: 6, h: 8 } as const;
/** Wioska mieszkańców tuż na południe od farmy. */
export const VILLAGE = { x: 25, y: 41, w: 14, h: 6 } as const;
/** Domy mieszkańców (2×2, drzwi od strony ulicy y = 44). */
export const VILLAGE_HOUSES: readonly { npc: string; x: number; y: number }[] = [
  { npc: 'ania', x: 26, y: 42 },
  { npc: 'bogdan', x: 29, y: 42 },
  { npc: 'celina', x: 33, y: 42 },
  { npc: 'darek', x: 36, y: 42 },
];
/** Dekoracje wioski (tylko wizualne, typy z buildings.json). */
export const VILLAGE_DECO: readonly { type: string; x: number; y: number }[] = [
  { type: 'lantern', x: 28, y: 45 },
  { type: 'lantern', x: 36, y: 45 },
  { type: 'flowers', x: 25, y: 45 },
  { type: 'flowers', x: 26, y: 45 },
  { type: 'flowers', x: 38, y: 45 },
  { type: 'bench', x: 34, y: 46 },
  { type: 'fence', x: 25, y: 46 },
  { type: 'fence', x: 26, y: 46 },
  { type: 'fence', x: 27, y: 46 },
  { type: 'scarecrow', x: 30, y: 46 },
];
/** Ulica wioski i dróżka do farmy (kafle drogi). */
export const VILLAGE_STREET_Y = 44;
export const VILLAGE_LANE_X = 32;

/** Wersja 3 mapy przesunęła wszystko o 8 kafli (mapa 48 → 64). */
export const MAP_SHIFT_V3 = 8;

export const START_CHUNKS: readonly number[] = [
  3 + 3 * CHUNKS_X,
  4 + 3 * CHUNKS_X,
  3 + 4 * CHUNKS_X,
  4 + 4 * CHUNKS_X,
  // wioska
  3 + 5 * CHUNKS_X,
  4 + 5 * CHUNKS_X,
];

export const BIOMES: readonly Biome[] = ['grass', 'forest', 'water', 'sand', 'meadow', 'farm', 'village'];
export const BiomeId = { grass: 0, forest: 1, water: 2, sand: 3, meadow: 4, farm: 5, village: 6 } as const;

export const tileIndex = (x: number, y: number): number => y * MAP_W + x;
export const chunkOfTile = (x: number, y: number): number => Math.floor(x / CHUNK) + Math.floor(y / CHUNK) * CHUNKS_X;

export function plotTile(plot: number): { x: number; y: number } {
  return { x: FIELD.x + (plot % FIELD.w), y: FIELD.y + Math.floor(plot / FIELD.w) };
}

export function plotAtTile(x: number, y: number): number | null {
  const cx = x - FIELD.x;
  const cy = y - FIELD.y;
  if (cx < 0 || cy < 0 || cx >= FIELD.w || cy >= FIELD.h) return null;
  return cy * FIELD.w + cx;
}

export const inFarm = (x: number, y: number): boolean => x >= FARM.x && y >= FARM.y && x < FARM.x + FARM.w && y < FARM.y + FARM.h;
export const inField = (x: number, y: number): boolean => plotAtTile(x, y) !== null;
export const inVillage = (x: number, y: number): boolean => x >= VILLAGE.x && y >= VILLAGE.y - 1 && x < VILLAGE.x + VILLAGE.w && y < VILLAGE.y + VILLAGE.h;

/** Kafel drogi w wiosce: ulica przed domami i dróżka od bramy farmy. */
export const isRoad = (x: number, y: number): boolean =>
  (y === VILLAGE_STREET_Y && x >= VILLAGE.x && x < VILLAGE.x + VILLAGE.w) || (x === VILLAGE_LANE_X && y >= FARM.y + FARM.h && y <= VILLAGE_STREET_Y + 2) || (y >= VILLAGE_STREET_Y + 1 && y <= VILLAGE_STREET_Y + 2 && Math.abs(x - VILLAGE_LANE_X) <= 1);

/** Gładki szum wartości 2D (bilinearny) z hasha. */
function valueNoise(seed: number, x: number, y: number, scale: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const s = (v: number) => v * v * (3 - 2 * v);
  const a = hashFloat(seed, x0, y0);
  const b = hashFloat(seed, x0 + 1, y0);
  const c = hashFloat(seed, x0, y0 + 1);
  const d = hashFloat(seed, x0 + 1, y0 + 1);
  return a + (b - a) * s(tx) + (c - a) * s(ty) + (a - b - c + d) * s(tx) * s(ty);
}

export interface WorldMap {
  seed: number;
  biome: Uint8Array;
  /** Drzewa (dekoracja) na kaflach lasu. */
  trees: Uint8Array;
  /** Miejsca zbieractwa. */
  forage: Uint8Array;
  /** Drogi wioski. */
  road: Uint8Array;
}

const cache = new Map<number, WorldMap>();

export function generateWorld(seed: number): WorldMap {
  const cached = cache.get(seed);
  if (cached) return cached;
  const biome = new Uint8Array(MAP_W * MAP_H);
  const trees = new Uint8Array(MAP_W * MAP_H);
  const forage = new Uint8Array(MAP_W * MAP_H);
  const road = new Uint8Array(MAP_W * MAP_H);

  // Rzeka: meandrująca pionowa linia po lewej lub prawej stronie farmy.
  const side = hashFloat(seed, 1) < 0.5 ? -1 : 1;
  const riverBase = side < 0 ? FARM.x - 8 + hashFloat(seed, 2) * 4 : FARM.x + FARM.w + 4 + hashFloat(seed, 2) * 4;

  for (let y = 0; y < MAP_H; y++) {
    const riverX = riverBase + Math.sin(y / 5 + hashFloat(seed, 3) * 6) * 2.5 + (valueNoise(seed + 9, 0, y, 6) - 0.5) * 3;
    for (let x = 0; x < MAP_W; x++) {
      const i = tileIndex(x, y);
      if (inFarm(x, y)) {
        biome[i] = BiomeId.farm;
        continue;
      }
      if (inVillage(x, y)) {
        biome[i] = BiomeId.village;
        if (isRoad(x, y)) road[i] = 1;
        continue;
      }
      const d = Math.abs(x - riverX);
      const n = valueNoise(seed, x, y, 7) * 0.65 + valueNoise(seed + 5, x, y, 3) * 0.35;
      let b: number = BiomeId.grass;
      if (d < 1.6) b = BiomeId.water;
      else if (d < 2.6) b = BiomeId.sand;
      else if (n > 0.56) b = BiomeId.forest;
      else if (n < 0.3) b = BiomeId.meadow;
      // Mały staw w losowym rogu.
      const px = side < 0 ? MAP_W - 9 : 8;
      const py = hashFloat(seed, 4) < 0.5 ? 8 : MAP_H - 9;
      if (Math.hypot(x - px, (y - py) * 1.2) < 3.2) b = BiomeId.water;
      else if (Math.hypot(x - px, (y - py) * 1.2) < 4.2 && b !== BiomeId.water) b = BiomeId.sand;
      biome[i] = b;
      if (b === BiomeId.forest && hashFloat(seed, x, y, 11) < 0.62) trees[i] = 1 + (hashFloat(seed, x, y, 12) < 0.5 ? 1 : 0);
      if ((b === BiomeId.forest || b === BiomeId.meadow || b === BiomeId.sand) && !trees[i] && hashFloat(seed, x, y, 13) < 0.09) {
        forage[i] = 1;
      }
    }
  }
  const world = { seed, biome, trees, forage, road };
  cache.set(seed, world);
  return world;
}

export function biomeAt(world: WorldMap, x: number, y: number): Biome {
  return BIOMES[world.biome[tileIndex(x, y)] ?? 0] ?? 'grass';
}

export function chunkNeighbors(chunk: number): number[] {
  const cx = chunk % CHUNKS_X;
  const cy = Math.floor(chunk / CHUNKS_X);
  const out: number[] = [];
  if (cx > 0) out.push(chunk - 1);
  if (cx < CHUNKS_X - 1) out.push(chunk + 1);
  if (cy > 0) out.push(chunk - CHUNKS_X);
  if (cy < CHUNKS_Y - 1) out.push(chunk + CHUNKS_X);
  return out;
}
