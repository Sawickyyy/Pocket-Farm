// Zwierzęta: głód, sympatia, produkcja, karmienie, głaskanie, zbiór produktów.

import type { Quality } from '../../content/content';
import { HOUR_MS } from '../calendar';
import type { CommandResult } from '../commands';
import { OK, addItem, addXp, consumeItem, countItem, fail, levelOf, mod, rand, stat, type Ctx } from '../ctx';
import type { Animal, PlacedObject } from '../types';
import { animalHomeSick } from './settlement/events';

/** Pełny brzuch wystarcza na 16 h gry. */
export const HUNGER_PER_HOUR = 1 / 16;
export const FEED_AFFECTION = 0.02;
export const PET_AFFECTION = 0.06;
export const STARVING_PENALTY_PER_HOUR = 0.01;

const NAMES = ['Kluska', 'Bella', 'Mila', 'Tosia', 'Burek', 'Łatka', 'Puszek', 'Złotka', 'Kropka', 'Mućka', 'Bąbel', 'Figa', 'Pola', 'Rysia', 'Kiki', 'Lola'];

export const homeCenter = (o: PlacedObject, size: [number, number]) => ({ x: o.x + size[0] / 2, y: o.y + size[1] / 2 });

function animalAt(ctx: Ctx, a: Animal) {
  const home = ctx.s.objects.find((o) => o.uid === a.home);
  const size = (home && ctx.c.buildings[home.type]?.size) ?? [1, 1];
  return home ? homeCenter(home, size) : { x: 0, y: 0 };
}

export function animalQuality(ctx: Ctx, a: Animal): Quality {
  const score = a.affection + mod(ctx.s, ctx.c, 'animalQuality');
  if (score >= 0.8) return 2;
  if (score >= 0.5) return 1;
  return 0;
}

export function updateAnimals(ctx: Ctx, dt: number): void {
  const { s, c } = ctx;
  const hours = dt / HOUR_MS;
  const hungerRate = HUNGER_PER_HOUR * (1 - mod(s, c, 'hungerSaving'));
  const speed = 1 + mod(s, c, 'productSpeed');
  for (const a of s.animals) {
    const def = c.animals[a.kind];
    if (!def) continue;
    if (a.hunger > 0) {
      a.hunger = Math.max(0, a.hunger - hours * hungerRate);
      // Epidemia (osada): chore zwierzęta nie produkują.
      if (!a.ready && !animalHomeSick(s, a.home)) {
        a.progress += (hours / def.produceHours) * speed;
        if (a.progress >= 1) {
          a.progress = 0;
          a.ready = true;
          ctx.bus.emit({ type: 'animalReady', id: a.id });
        }
      }
    } else {
      a.affection = Math.max(0, a.affection - hours * STARVING_PENALTY_PER_HOUR);
    }
  }
}

export function buyAnimal(ctx: Ctx, kind: string, homeUid: number): CommandResult {
  const { s, c } = ctx;
  const def = c.animals[kind];
  const home = s.objects.find((o) => o.uid === homeUid);
  if (!def || !home) return fail('invalid');
  const homeDef = c.buildings[home.type];
  if (homeDef?.kind !== 'home' || !homeDef.animals?.includes(kind)) return fail('wrong-home');
  if (levelOf(s.xp) < def.level) return fail('level-too-low');
  if (s.animals.filter((a) => a.home === homeUid).length >= (homeDef.capacity ?? 0)) return fail('full');
  if (s.coins < def.price) return fail('no-coins');
  s.coins -= def.price;
  const id = s.nextUid++;
  const name = NAMES[Math.floor(rand(s) * NAMES.length)] ?? 'Mila';
  const animal: Animal = { id, kind, name, home: homeUid, hunger: 0.6, affection: 0.2, progress: 0, ready: false, pettedDay: -1 };
  s.animals.push(animal);
  stat(ctx, 'animalsBought');
  ctx.bus.emit({ type: 'animalBought', id, kind, at: animalAt(ctx, animal) });
  return OK;
}

export function feedAnimal(ctx: Ctx, id: number): CommandResult {
  const { s, c } = ctx;
  const a = s.animals.find((x) => x.id === id);
  const def = a && c.animals[a.kind];
  if (!a || !def) return fail('invalid');
  if (a.hunger > 0.85) return fail('not-hungry');
  const food = def.feed.find((f) => countItem(s, f) > 0);
  if (!food) return fail('no-feed');
  consumeItem(s, food, 1);
  a.hunger = 1;
  a.affection = Math.min(1, a.affection + FEED_AFFECTION * (1 + mod(s, c, 'affection')));
  stat(ctx, 'fed');
  ctx.bus.emit({ type: 'fed', id, at: animalAt(ctx, a) });
  return OK;
}

export function petAnimal(ctx: Ctx, id: number): CommandResult {
  const { s, c, cal } = ctx;
  const a = s.animals.find((x) => x.id === id);
  if (!a) return fail('invalid');
  if (a.pettedDay === cal.day) return fail('already-petted');
  a.pettedDay = cal.day;
  a.affection = Math.min(1, a.affection + PET_AFFECTION * (1 + mod(s, c, 'affection')));
  ctx.bus.emit({ type: 'petted', id, at: animalAt(ctx, a) });
  return OK;
}

export function collectAnimal(ctx: Ctx, id: number): CommandResult {
  const { s, c } = ctx;
  const a = s.animals.find((x) => x.id === id);
  const def = a && c.animals[a.kind];
  if (!a || !def) return fail('invalid');
  if (!a.ready) return fail('not-ready-animal');
  a.ready = false;
  const q = animalQuality(ctx, a);
  addItem(s, def.product, 1, q);
  if (def.byproduct && rand(s) < def.byproduct.chance) addItem(s, def.byproduct.item, 1);
  stat(ctx, 'animalProducts');
  ctx.bus.emit({ type: 'collected', id, key: q ? `${def.product}*${q}` : def.product, at: animalAt(ctx, a) });
  addXp(ctx, 3);
  return OK;
}

/** Operacja na wszystkich zwierzętach budynku; sukces, jeśli choć jedna się udała. */
export function forAllInHome(ctx: Ctx, home: number, op: (ctx: Ctx, id: number) => CommandResult): CommandResult {
  let any = false;
  let last: CommandResult = fail('empty');
  for (const a of ctx.s.animals.filter((x) => x.home === home)) {
    last = op(ctx, a.id);
    if (last.ok) any = true;
  }
  return any ? OK : last;
}
