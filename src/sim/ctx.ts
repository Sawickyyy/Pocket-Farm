// Kontekst przekazywany systemom + wspólne operacje (monety, XP, ekwipunek, statystyki, modyfikatory).

import { CONTENT, itemKey, parseKey, type Content, type ModifierType, type Quality } from '../content/content';
import type { EventBus } from '../core/eventBus';
import { mulberry } from '../core/rng';
import type { CommandResult, FailReason } from './commands';
import type { SimEvent } from './events';
import type { Calendar, GameState } from './types';
import { generateWorld, type WorldMap } from './world';

export interface Ctx {
  s: GameState;
  c: Content;
  bus: EventBus<SimEvent>;
  cal: Calendar;
  world: WorldMap;
  /** Nadrabianie offline: bez losowych katastrof w osadzie. */
  offline?: boolean;
}

export const OK: CommandResult = { ok: true };
export const fail = (reason: FailReason): CommandResult => ({ ok: false, reason });

export function makeCtx(s: GameState, bus: EventBus<SimEvent>, cal: Calendar, c: Content = CONTENT): Ctx {
  return { s, c, bus, cal, world: generateWorld(s.seed) };
}

/** Deterministyczna liczba losowa – stan generatora jest częścią zapisu. */
export function rand(s: GameState): number {
  const [next, r] = mulberry(s.rng);
  s.rng = next;
  return r;
}

// ---------------------------------------------------------------- poziomy

export const xpForLevel = (level: number): number => 5 * level * (level - 1);

export function levelOf(xp: number): number {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  return level;
}

export function levelProgress(xp: number): { level: number; current: number; needed: number; ratio: number } {
  const level = levelOf(xp);
  const base = xpForLevel(level);
  const needed = xpForLevel(level + 1) - base;
  return { level, current: xp - base, needed, ratio: (xp - base) / needed };
}

export const levelReward = (level: number): number => 10 * level;

export function addXp(ctx: Ctx, amount: number): void {
  const { s } = ctx;
  const before = levelOf(s.xp);
  s.xp += Math.round(amount);
  const after = levelOf(s.xp);
  for (let l = before + 1; l <= after; l++) {
    const reward = levelReward(l);
    s.coins += reward;
    s.skillPoints += 1;
    ctx.bus.emit({ type: 'levelUp', level: l, reward });
  }
}

// ---------------------------------------------------------------- modyfikatory (umiejętności)

export function mod(s: GameState, c: Content, type: ModifierType): number {
  let total = 0;
  for (const id of s.skills) for (const e of c.skill[id]?.effects ?? []) if (e.type === type) total += e.value;
  return total;
}

// ---------------------------------------------------------------- ekwipunek

export function addItem(s: GameState, id: string, qty: number, q: Quality = 0): void {
  const key = itemKey(id, q);
  s.inventory[key] = (s.inventory[key] ?? 0) + qty;
}

/** Ile sztuk przedmiotu (dowolnej jakości). */
export function countItem(s: GameState, id: string): number {
  return (s.inventory[id] ?? 0) + (s.inventory[itemKey(id, 1)] ?? 0) + (s.inventory[itemKey(id, 2)] ?? 0);
}

/**
 * Zużywa `qty` sztuk, zaczynając od najniższej jakości. Zwraca zużyte sztuki per jakość
 * albo null (bez zmian), jeśli brakuje.
 */
export function consumeItem(s: GameState, id: string, qty: number): Quality[] | null {
  if (countItem(s, id) < qty) return null;
  const used: Quality[] = [];
  for (const q of [0, 1, 2] as Quality[]) {
    const key = itemKey(id, q);
    while (used.length < qty && (s.inventory[key] ?? 0) > 0) {
      s.inventory[key]! -= 1;
      used.push(q);
    }
    if (s.inventory[key] === 0) delete s.inventory[key];
  }
  return used;
}

export function removeKey(s: GameState, key: string, qty: number): boolean {
  if ((s.inventory[key] ?? 0) < qty) return false;
  s.inventory[key]! -= qty;
  if (s.inventory[key] === 0) delete s.inventory[key];
  return true;
}

export function stat(ctx: Ctx, key: string, n = 1): void {
  ctx.s.stats[key] = (ctx.s.stats[key] ?? 0) + n;
}

export const qualityOfKey = (key: string): Quality => parseKey(key).q;
