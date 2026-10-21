// Teren osady: fragmenty mapy 8×8, kupno kolejnych (dzielnice), sprawdzanie, gdzie wolno budować.

import type { BuildingDef, Content } from '../../../content/content';
import type { CommandResult } from '../../commands';
import { OK, fail, type Ctx } from '../../ctx';
import type { GameState } from '../../types';
import { BiomeId, CHUNK, CHUNKS_X, MAP_H, MAP_W, chunkNeighbors, inField, tileIndex, type WorldMap } from '../../world';
import { addBudget, chronicle, inTerritory } from './common';

export { inTerritory };

export const territoryLimit = (c: Content, peakTier: number): number => c.settlement.tiers[peakTier]?.territory ?? 4;

export function territoryCost(c: Content, bought: number): number {
  const k = c.settlement.territoryCost;
  return Math.round((k.base * k.growth ** bought) / 10) * 10;
}

export function canBuyTerritory(s: GameState, c: Content, chunk: number): CommandResult {
  const st = s.settlement;
  if (!Number.isInteger(chunk) || chunk < 0 || chunk >= CHUNKS_X * CHUNKS_X) return fail('invalid');
  if (st.territory.includes(chunk)) return fail('already-unlocked');
  if (c.settlement.foreignChunks.includes(chunk)) return fail('foreign-land');
  if (!s.world.revealed.includes(chunk)) return fail('hidden');
  if (!chunkNeighbors(chunk).some((n) => st.territory.includes(n))) return fail('not-territory-edge');
  if (st.territory.length >= territoryLimit(c, st.peakTier)) return fail('max-territory');
  if (s.coins < territoryCost(c, st.bought)) return fail('no-coins');
  return OK;
}

export function buyTerritory(ctx: Ctx, chunk: number): CommandResult {
  const { s, c } = ctx;
  const check = canBuyTerritory(s, c, chunk);
  if (!check.ok) return check;
  const cost = territoryCost(c, s.settlement.bought);
  s.coins -= cost;
  s.settlement.territory.push(chunk);
  s.settlement.bought++;
  addBudget(ctx, 'investments', cost);
  chronicle(ctx, 'territory', { chunk, cost });
  ctx.bus.emit({ type: 'territory', chunk, cost });
  return OK;
}

/** Fragmenty, które można teraz kupić (odkryte, przy granicy, nie obce) – do trybu terenu w UI. */
export function buyableChunks(s: GameState, c: Content): number[] {
  const out: number[] = [];
  for (const t of s.settlement.territory) {
    for (const n of chunkNeighbors(t)) {
      if (out.includes(n) || s.settlement.territory.includes(n) || c.settlement.foreignChunks.includes(n) || !s.world.revealed.includes(n)) continue;
      out.push(n);
    }
  }
  return out.sort((a, b) => a - b);
}

export const chunkRect = (chunk: number) => ({ x: (chunk % CHUNKS_X) * CHUNK, y: Math.floor(chunk / CHUNKS_X) * CHUNK, w: CHUNK, h: CHUNK });

function biomeNear(world: WorldMap, x: number, y: number, w: number, h: number, dist: number, biome: number): boolean {
  for (let ty = y - dist; ty < y + h + dist; ty++) {
    for (let tx = x - dist; tx < x + w + dist; tx++) {
      if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue;
      if (world.biome[tileIndex(tx, ty)] === biome) return true;
    }
  }
  return false;
}

/**
 * Sprawdza kafle pod budynkiem (bez zajętości): teren osady, pole gracza, drzewa, woda, wioska, wymagania terenu.
 * Zwraca null, gdy wolno budować, albo powód odmowy.
 */
export function terrainCheck(s: GameState, world: WorldMap, def: BuildingDef, x: number, y: number): CommandResult | null {
  const [w, h] = def.size;
  const onWater = def.terrain === 'water';
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!inTerritory(s, tx, ty)) return fail('outside-farm');
      if (inField(tx, ty)) return fail('blocked');
      const i = tileIndex(tx, ty);
      if (world.trees[i]) return fail('blocked');
      const b = world.biome[i];
      if (b === BiomeId.village) return fail('foreign-land');
      if (onWater !== (b === BiomeId.water)) return fail('terrain');
    }
  }
  if (def.terrain === 'shore' && !biomeNear(world, x, y, w, h, 2, BiomeId.water)) return fail('terrain');
  if (def.terrain === 'forest' && !biomeNear(world, x, y, w, h, 4, BiomeId.forest)) return fail('terrain');
  return null;
}
