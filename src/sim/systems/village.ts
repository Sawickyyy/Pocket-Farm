// Mieszkańcy: zamówienia z nagrodami, prezenty, przyjaźń (serca) i nagrody za kolejne serca.

import { QUALITY_MULT } from '../../content/content';
import type { CommandResult } from '../commands';
import { OK, addItem, addXp, consumeItem, countItem, fail, levelOf, mod, rand, removeKey, stat, type Ctx, qualityOfKey } from '../ctx';
import type { GameState } from '../types';
import { parseKey } from '../../content/content';

export const MAX_ORDERS = 3;
export const ORDER_DAYS = 2;
export const HEART = 100;
export const MAX_FRIENDSHIP = 1000;

export const hearts = (friendship: number): number => Math.min(10, Math.floor(friendship / HEART));

/** Czy gracz jest w stanie zdobyć przedmiot (żeby zamówienia były wykonalne). */
export function obtainable(ctx: Ctx, item: string): boolean {
  const { s, c, cal } = ctx;
  const level = levelOf(s.xp);
  const crop = c.crop[item];
  if (crop) return crop.level <= level && crop.seasons.includes(cal.season);
  const def = c.items[item];
  if (!def) return false;
  if (def.kind === 'animal') return s.animals.some((a) => c.animals[a.kind]?.product === item);
  if (def.kind === 'artisan') {
    return c.recipeList.some((r) => r.output.item === item && s.objects.some((o) => o.type === r.building));
  }
  if (def.kind === 'fish') return (s.stats.fishCaught ?? 0) > 0 || s.world.revealed.length > 4;
  if (def.kind === 'forage') return s.world.revealed.length > 4;
  return true;
}

export function generateOrders(ctx: Ctx): void {
  const { s, c, cal } = ctx;
  s.orders = s.orders.filter((o) => o.expiresDay >= cal.day);
  const limit = levelOf(s.xp) < 2 ? 1 : MAX_ORDERS;
  let guard = 0;
  while (s.orders.length < limit && guard++ < 30) {
    const npc = c.npcs[Math.floor(rand(s) * c.npcs.length)]!;
    const options = npc.orders.filter((i) => obtainable(ctx, i) && !s.orders.some((o) => o.item === i));
    if (!options.length) continue;
    const item = options[Math.floor(rand(s) * options.length)]!;
    const price = c.items[item]?.price ?? 10;
    const qty = Math.max(1, Math.min(10, Math.round((60 / price) * (2 + rand(s) * 4))));
    const coins = Math.round(price * qty * 1.6 * (1 + mod(s, c, 'orderBonus')));
    s.orders.push({ id: s.nextUid++, npc: npc.id, item, qty, coins, xp: Math.round(price * qty * 0.15) + 5, expiresDay: cal.day + ORDER_DAYS });
  }
}

export function deliverOrder(ctx: Ctx, id: number): CommandResult {
  const { s } = ctx;
  const order = s.orders.find((o) => o.id === id);
  if (!order) return fail('invalid');
  if (order.expiresDay < ctx.cal.day) return fail('expired');
  if (countItem(s, order.item) < order.qty) return fail('missing-items');
  const used = consumeItem(s, order.item, order.qty) ?? [];
  // Lepsza jakość = wyższa nagroda.
  const bonus = used.reduce((sum: number, q) => sum + (QUALITY_MULT[q] - 1), 0) / Math.max(1, used.length);
  const coins = Math.round(order.coins * (1 + bonus));
  s.coins += coins;
  s.orders = s.orders.filter((o) => o.id !== id);
  addFriendship(ctx, order.npc, 30);
  stat(ctx, 'ordersDone');
  stat(ctx, 'coinsEarned', coins);
  ctx.bus.emit({ type: 'orderDone', id, npc: order.npc, coins });
  addXp(ctx, order.xp);
  return OK;
}

export function addFriendship(ctx: Ctx, npcId: string, points: number): void {
  const { s, c } = ctx;
  const st = s.npcs[npcId];
  const def = c.npc[npcId];
  if (!st || !def) return;
  const before = hearts(st.friendship);
  st.friendship = Math.min(MAX_FRIENDSHIP, st.friendship + points);
  const after = hearts(st.friendship);
  for (const r of def.rewards) {
    if (r.hearts > before && r.hearts <= after && !st.rewards.includes(r.hearts)) {
      st.rewards.push(r.hearts);
      if (r.coins) s.coins += r.coins;
      if (r.item) addItem(s, r.item, r.qty ?? 1);
      ctx.bus.emit({ type: 'heartReward', npc: npcId, hearts: r.hearts });
    }
  }
}

export function giftReaction(ctx: Ctx, npcId: string, itemId: string): 'love' | 'like' | 'neutral' {
  const def = ctx.c.npc[npcId];
  if (def?.loves.includes(itemId)) return 'love';
  if (def?.likes.includes(itemId)) return 'like';
  return 'neutral';
}

export function gift(ctx: Ctx, npcId: string, key: string): CommandResult {
  const { s, cal } = ctx;
  const st = s.npcs[npcId];
  if (!st) return fail('invalid');
  if (st.giftDay === cal.day) return fail('already-gifted');
  if (!removeKey(s, key, 1)) return fail('missing-items');
  const { id } = parseKey(key);
  const reaction = giftReaction(ctx, npcId, id);
  const base = reaction === 'love' ? 80 : reaction === 'like' ? 45 : 20;
  const points = Math.round(base * (1 + 0.25 * qualityOfKey(key)));
  st.giftDay = cal.day;
  addFriendship(ctx, npcId, points);
  ctx.bus.emit({ type: 'gift', npc: npcId, reaction, points });
  return OK;
}

export const npcState = (s: GameState, id: string) => s.npcs[id];
