// Proceduralna mapa świata wokół farmy (deterministyczna z seeda): łąki, las, rzeka, plaża.
// Mapa jest podzielona na fragmenty 8×8 kafli zakryte mgłą – gracz je odkrywa.

import type { Biome } from '../content/content';
import { hashFloat } from '../core/rng';

export const MAP_W = 48;
export const MAP_H = 48;
export const CHUNK = 8;
export const CHUNKS_X = MAP_W / CHUNK;
export const CHUNKS_Y = MAP_H / CHUNK;

/** Strefa farmy (budowanie) – 16×16 kafli w środku mapy. */
export const FARM = { x: 16, y: 16, w: 16, h: 16 } as const;
/** Pole uprawne 6×8 wewnątrz farmy. */
export const FIELD = { x: 21, y: 22, w: 6, h: 8 } as const;

export const START_CHUNKS: readonly number[] = [2 + 2 * CHUNKS_X, 3 + 2 * CHUNKS_X, 2 + 3 * CHUNKS_X, 3 + 3 * CHUNKS_X];

export const BIOMES: readonly Biome[] = ['grass', 'forest', 'water', 'sand', 'meadow', 'farm'];
export const BiomeId = { grass: 0, forest: 1, water: 2, sand: 3, meadow: 4, farm: 5 } as const;

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
}

const cache = new Map<number, WorldMap>();

export function generateWorld(seed: number): WorldMap {
  const cached = cache.get(seed);
  if (cached) return cached;
  const biome = new Uint8Array(MAP_W * MAP_H);
  const trees = new Uint8Array(MAP_W * MAP_H);
  const forage = new Uint8Array(MAP_W * MAP_H);

  // Rzeka: meandrująca pionowa linia po lewej lub prawej stronie farmy.
  const side = hashFloat(seed, 1) < 0.5 ? -1 : 1;
  const riverBase = side < 0 ? 8 + hashFloat(seed, 2) * 4 : MAP_W - 12 + hashFloat(seed, 2) * 4;

  for (let y = 0; y < MAP_H; y++) {
    const riverX = riverBase + Math.sin(y / 5 + hashFloat(seed, 3) * 6) * 2.5 + (valueNoise(seed + 9, 0, y, 6) - 0.5) * 3;
    for (let x = 0; x < MAP_W; x++) {
      const i = tileIndex(x, y);
      if (inFarm(x, y)) {
        biome[i] = BiomeId.farm;
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
  const world = { seed, biome, trees, forage };
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
