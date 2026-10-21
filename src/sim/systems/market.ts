// Rynek dynamiczny: cena = baza × jakość × popyt dnia × festyn × umiejętności / (1 + nasycenie/20).
// Każda sprzedana sztuka zwiększa nasycenie (kolejne są tańsze); nasycenie wygasa z połówkowym czasem 6 h gry.

import { QUALITY_MULT, parseKey } from '../../content/content';
import { hashFloat } from '../../core/rng';
import { HOUR_MS } from '../calendar';
import type { CommandResult } from '../commands';
import { OK, fail, mod, removeKey, stat, type Ctx } from '../ctx';
import type { GameState } from '../types';
import { activeFestival } from './progress';
import { priceMult } from './settlement/events';

export const SAT_SCALE = 20;
export const SAT_HALF_LIFE_H = 6;
export const MIN_FACTOR = 0.25;

export function satFactor(sat: number): number {
  return Math.max(MIN_FACTOR, 1 / (1 + sat / SAT_SCALE));
}

/** Cena jednej sztuki przy danym dodatkowym nasyceniu (do sprzedaży hurtowej). */
export function unitPrice(ctx: Ctx, key: string, extraSat = 0): number {
  const { s, c } = ctx;
  const { id, q } = parseKey(key);
  const def = c.items[id];
  if (!def) return 0;
  const demand = s.market.demand[id] ?? 1;
  const festival = activeFestival(ctx);
  const fest = festival && festival.market.includes(id) ? festival.mult : 1;
  const sat = (s.market.sat[id] ?? 0) + extraSat;
  return def.price * QUALITY_MULT[q] * demand * fest * (1 + mod(s, c, 'sellBonus')) * satFactor(sat) * priceMult(s);
}

/** Łączna kwota za `qty` sztuk (każda kolejna sztuka podnosi nasycenie). */
export function quote(ctx: Ctx, key: string, qty: number): number {
  const perUnit = 1 - mod(ctx.s, ctx.c, 'bulkSelling');
  let total = 0;
  for (let i = 0; i < qty; i++) total += unitPrice(ctx, key, i * perUnit);
  return Math.round(total);
}

export function sell(ctx: Ctx, key: string, qty: number | 'all'): CommandResult {
  const { s, c } = ctx;
  const owned = s.inventory[key] ?? 0;
  const n = qty === 'all' ? owned : qty;
  if (!Number.isInteger(n) || n <= 0 || n > owned) return fail('nothing-to-sell');
  const { id } = parseKey(key);
  const coins = quote(ctx, key, n);
  removeKey(s, key, n);
  s.coins += coins;
  s.market.sat[id] = (s.market.sat[id] ?? 0) + n * (1 - mod(s, c, 'bulkSelling'));
  stat(ctx, 'coinsEarned', coins);
  ctx.bus.emit({ type: 'sold', key, qty: n, coins });
  return OK;
}

/** „Sprzedaj wszystko” – plony, produkty, ryby i zbiory (bez nawozów, paszy i półproduktów potrzebnych dalej). */
export const SELL_ALL_KINDS = new Set(['crop', 'animal', 'artisan', 'forage', 'fish']);

export function sellAll(ctx: Ctx): CommandResult {
  let any = false;
  for (const key of Object.keys(ctx.s.inventory)) {
    const def = ctx.c.items[parseKey(key).id];
    if (!def || !SELL_ALL_KINDS.has(def.kind)) continue;
    if (sell(ctx, key, 'all').ok) any = true;
  }
  return any ? OK : fail('nothing-to-sell');
}

export function updateMarket(ctx: Ctx, dt: number): void {
  const { s, c } = ctx;
  const halfLife = (SAT_HALF_LIFE_H * HOUR_MS) / (1 + mod(s, c, 'marketRecovery'));
  const k = 0.5 ** (dt / halfLife);
  for (const id of Object.keys(s.market.sat)) {
    const v = (s.market.sat[id] ?? 0) * k;
    if (v < 0.01) delete s.market.sat[id];
    else s.market.sat[id] = v;
  }
}

/** Popyt dnia: 2 „gorące” przedmioty (×1.5) i 1 „zimny” (×0.7), wylosowane z seeda i dnia. */
export function demandForDay(s: GameState, ctx: Ctx, day: number): Record<string, number> {
  const ids = ctx.c.itemList.filter((i) => SELL_ALL_KINDS.has(i.kind)).map((i) => i.id);
  const out: Record<string, number> = {};
  const pick = (salt: number) => ids[Math.floor(hashFloat(s.seed, day, salt) * ids.length)]!;
  out[pick(1)] = 1.5;
  out[pick(2)] = 1.5;
  const cold = pick(3);
  if (!out[cold]) out[cold] = 0.7;
  return out;
}

export function marketNewDay(ctx: Ctx): void {
  ctx.s.market.demand = demandForDay(ctx.s, ctx, ctx.cal.day);
}

/** Trend ceny do pokazania w UI: -1 (tanieje), 0, 1 (gorący). */
export function priceTrend(ctx: Ctx, id: string): -1 | 0 | 1 {
  const d = ctx.s.market.demand[id] ?? 1;
  const sat = ctx.s.market.sat[id] ?? 0;
  if (d > 1 && sat < 5) return 1;
  if (d < 1 || sat > 5) return -1;
  return 0;
}

export function buyPrice(ctx: Ctx, itemId: string): number | null {
  return ctx.c.items[itemId]?.buy ?? null;
}
