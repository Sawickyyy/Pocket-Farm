// Zadania dzienne i tygodniowe, osiągnięcia oraz festyny sezonowe. Postęp liczony ze zdarzeń (event bus).

import type { FestivalDef, QuestDef, QuestEvent } from '../../content/content';
import { SEASON_DAYS } from '../calendar';
import type { CommandResult } from '../commands';
import { OK, addXp, consumeItem, countItem, fail, rand, stat, type Ctx } from '../ctx';
import type { SimEvent } from '../events';
import type { Quest } from '../types';

export const DAILY_COUNT = 3;
export const WEEKLY_COUNT = 2;


function requirementMet(ctx: Ctx, q: QuestDef): boolean {
  const { s, c } = ctx;
  switch (q.requires) {
    case 'animals':
      return s.animals.length > 0;
    case 'machines':
      return s.objects.some((o) => c.buildings[o.type]?.kind === 'machine');
    case 'water':
    case 'explored':
      return s.world.revealed.length > 4;
    default:
      return true;
  }
}

function makeQuests(ctx: Ctx, count: number, range: 'daily' | 'weekly'): Quest[] {
  const { s, c } = ctx;
  const pool = c.quests.filter((q) => requirementMet(ctx, q));
  const out: Quest[] = [];
  const used = new Set<string>();
  let guard = 0;
  while (out.length < count && guard++ < 40 && used.size < pool.length) {
    const def = pool[Math.floor(rand(s) * pool.length)]!;
    if (used.has(def.id)) continue;
    used.add(def.id);
    const [min, max] = def[range];
    const target = Math.round(min + rand(s) * (max - min));
    out.push({ id: s.nextUid++, tpl: def.id, target, progress: 0, claimed: false });
  }
  return out;
}

export function questsNewDay(ctx: Ctx): void {
  const { s, cal } = ctx;
  s.quests.daily = makeQuests(ctx, DAILY_COUNT, 'daily');
  if (cal.day % SEASON_DAYS === 0 || s.quests.weekly.length === 0) s.quests.weekly = makeQuests(ctx, WEEKLY_COUNT, 'weekly');
}

export function questReward(ctx: Ctx, q: Quest, weekly: boolean): { coins: number; xp: number } {
  const def = ctx.c.quests.find((d) => d.id === q.tpl);
  const mult = weekly ? 1.5 : 1;
  return { coins: Math.round((def?.coinsPer ?? 1) * q.target * mult) + 10, xp: Math.round((def?.xpPer ?? 0) * q.target * mult) + 5 };
}

const EVENT_TO_QUEST: Partial<Record<SimEvent['type'], QuestEvent>> = {
  harvested: 'harvest',
  watered: 'water',
  sold: 'sell',
  fed: 'feed',
  crafted: 'craft',
  caught: 'fish',
  foraged: 'forage',
  orderDone: 'order',
};

/** Wywoływane dla każdego zdarzenia symulacji. */
export function onProgressEvent(ctx: Ctx, e: SimEvent): void {
  const qe = EVENT_TO_QUEST[e.type];
  if (qe) {
    const amount = e.type === 'sold' ? e.coins : e.type === 'crafted' ? e.qty : 1;
    for (const q of [...ctx.s.quests.daily, ...ctx.s.quests.weekly]) {
      const def = ctx.c.quests.find((d) => d.id === q.tpl);
      if (def?.event !== qe || q.claimed || q.progress >= q.target) continue;
      q.progress = Math.min(q.target, q.progress + amount);
      if (q.progress >= q.target) ctx.bus.emit({ type: 'questReady', id: q.id });
    }
  }
  checkAchievements(ctx);
}

export function claimQuest(ctx: Ctx, id: number): CommandResult {
  const { s } = ctx;
  const weekly = s.quests.weekly.some((q) => q.id === id);
  const q = [...s.quests.daily, ...s.quests.weekly].find((x) => x.id === id);
  if (!q) return fail('invalid');
  if (q.claimed) return fail('claimed');
  if (q.progress < q.target) return fail('not-complete');
  q.claimed = true;
  const r = questReward(ctx, q, weekly);
  s.coins += r.coins;
  ctx.bus.emit({ type: 'questClaimed', id, coins: r.coins });
  addXp(ctx, r.xp);
  return OK;
}

export function checkAchievements(ctx: Ctx): void {
  const { s, c } = ctx;
  for (const a of c.achievements) {
    if (s.achievements[a.id] !== undefined) continue;
    if ((s.stats[a.stat] ?? 0) >= a.target) {
      s.achievements[a.id] = ctx.cal.day;
      s.coins += a.coins;
      ctx.bus.emit({ type: 'achievement', id: a.id, coins: a.coins });
    }
  }
}

// ---------------------------------------------------------------- festyny

export function activeFestival(ctx: Ctx): FestivalDef | null {
  const { cal, c } = ctx;
  return c.festivals.find((f) => f.season === cal.season && f.day === cal.dayOfSeason) ?? null;
}

export const festivalKey = (ctx: Ctx, f: FestivalDef) => `${ctx.cal.year}:${f.id}`;

export function festivalDeliver(ctx: Ctx): CommandResult {
  const { s } = ctx;
  const f = activeFestival(ctx);
  if (!f) return fail('no-festival');
  const key = festivalKey(ctx, f);
  if (s.festivalsDone.includes(key)) return fail('claimed');
  if (countItem(s, f.item) < f.qty) return fail('missing-items');
  consumeItem(s, f.item, f.qty);
  s.festivalsDone.push(key);
  s.coins += f.coins;
  if (!s.unlocks.includes(f.unlock)) s.unlocks.push(f.unlock);
  stat(ctx, 'festivals');
  ctx.bus.emit({ type: 'festivalDone', id: f.id, unlock: f.unlock });
  addXp(ctx, f.xp);
  return OK;
}
