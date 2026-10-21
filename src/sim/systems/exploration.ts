// Odkrywanie terenów za farmą (mgła), zbieractwo i łowienie ryb.

import type { Quality } from '../../content/content';
import { weightedIndex } from '../../core/rng';
import type { CommandResult } from '../commands';
import { OK, addItem, addXp, fail, levelOf, rand, stat, type Ctx } from '../ctx';
import type { GameState } from '../types';
import { MAP_W, START_CHUNKS, biomeAt, chunkNeighbors, chunkOfTile, tileIndex } from '../world';

export const FORAGE_RESPAWN_DAYS = 2;

export function exploreCost(s: GameState): number {
  const explored = s.world.revealed.length - START_CHUNKS.length;
  return Math.round((100 * 1.6 ** explored) / 10) * 10;
}

export const isRevealed = (s: GameState, x: number, y: number): boolean => s.world.revealed.includes(chunkOfTile(x, y));

export const canExplore = (s: GameState, chunk: number): boolean =>
  !s.world.revealed.includes(chunk) && chunkNeighbors(chunk).some((n) => s.world.revealed.includes(n));

export function explore(ctx: Ctx, chunk: number): CommandResult {
  const { s } = ctx;
  if (s.world.revealed.includes(chunk)) return fail('already-unlocked');
  if (!canExplore(s, chunk)) return fail('not-adjacent');
  if (levelOf(s.xp) < 2) return fail('level-too-low');
  const cost = exploreCost(s);
  if (s.coins < cost) return fail('no-coins');
  s.coins -= cost;
  s.world.revealed.push(chunk);
  stat(ctx, 'explored');
  ctx.bus.emit({ type: 'explored', chunk, cost });
  addXp(ctx, 10);
  return OK;
}

const tileXY = (tile: number) => ({ x: tile % MAP_W, y: Math.floor(tile / MAP_W) });

export function forageReady(ctx: Ctx, tile: number): boolean {
  return (ctx.s.world.forage[String(tile)] ?? -1) <= ctx.cal.day;
}

export function forage(ctx: Ctx, tile: number): CommandResult {
  const { s, c, cal, world } = ctx;
  const { x, y } = tileXY(tile);
  if (!isRevealed(s, x, y)) return fail('hidden');
  if (!world.forage[tile]) return fail('not-forage');
  if (!forageReady(ctx, tile)) return fail('not-respawned');
  const biome = biomeAt(world, x, y);
  const options = c.forage.filter((f) => f.biome === biome && f.seasons.includes(cal.season));
  if (!options.length) return fail('not-respawned');
  const pick = options[weightedIndex(options.map((o) => o.weight), rand(s))]!;
  const q: Quality = c.items[pick.item]?.quality ? (rand(s) > 0.85 ? 2 : rand(s) > 0.6 ? 1 : 0) : 0;
  addItem(s, pick.item, 1, q);
  s.world.forage[String(tile)] = cal.day + FORAGE_RESPAWN_DAYS;
  stat(ctx, 'foraged');
  ctx.bus.emit({ type: 'foraged', tile, key: q ? `${pick.item}*${q}` : pick.item, at: { x: x + 0.5, y: y + 0.5 } });
  addXp(ctx, 2);
  return OK;
}

/** Dostępne ryby w danej chwili (sezon, pora, pogoda). */
export function availableFish(ctx: Ctx) {
  const { c, cal } = ctx;
  return c.fish.filter(
    (f) =>
      f.seasons.includes(cal.season) &&
      (f.time === 'any' || (f.time === 'night') === cal.isNight) &&
      (!f.weather || f.weather.includes(cal.weather)),
  );
}

export function castLine(ctx: Ctx, tile: number): CommandResult {
  const { s, world } = ctx;
  const { x, y } = tileXY(tile);
  if (!isRevealed(s, x, y)) return fail('hidden');
  if (biomeAt(world, x, y) !== 'water') return fail('not-water');
  const fish = availableFish(ctx);
  const pick = fish[weightedIndex(fish.map((f) => f.weight), rand(s))];
  if (!pick) return fail('no-bite');
  s.world.pendingFish = { fish: pick.id, tile, difficulty: pick.difficulty };
  ctx.bus.emit({ type: 'bite', fish: pick.id, difficulty: pick.difficulty, at: { x: x + 0.5, y: y + 0.5 } });
  return OK;
}

/** Wynik minigry: score 0 = ucieczka, 0..1 = jakość połowu. */
export function reelIn(ctx: Ctx, score: number): CommandResult {
  const { s } = ctx;
  const p = s.world.pendingFish;
  if (!p) return fail('no-bite');
  s.world.pendingFish = null;
  const { x, y } = tileXY(p.tile);
  const at = { x: x + 0.5, y: y + 0.5 };
  if (!(score > 0)) {
    ctx.bus.emit({ type: 'escaped', at });
    return fail('escaped');
  }
  const q: Quality = score >= 0.9 ? 2 : score >= 0.7 ? 1 : 0;
  addItem(s, p.fish, 1, q);
  stat(ctx, 'fishCaught');
  ctx.bus.emit({ type: 'caught', fish: p.fish, key: q ? `${p.fish}*${q}` : p.fish, at });
  addXp(ctx, Math.round(5 + p.difficulty * 20));
  return OK;
}

export const tileOf = tileIndex;
