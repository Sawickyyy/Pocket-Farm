// Przetwórstwo: budynki-maszyny z kolejką zadań (receptury z JSON), produkty trafiają na tackę do odebrania.

import { HOUR_MS } from '../calendar';
import type { CommandResult } from '../commands';
import { OK, addItem, addXp, consumeItem, countItem, fail, mod, stat, type Ctx } from '../ctx';
import type { Machine, PlacedObject } from '../types';

export const BASE_QUEUE = 3;
export const OUTPUT_CAP = 20;

export function machineOf(ctx: Ctx, uid: number): Machine {
  const key = String(uid);
  return (ctx.s.machines[key] ??= { queue: [], output: {} });
}

const centerOf = (ctx: Ctx, o: PlacedObject) => {
  const size = ctx.c.buildings[o.type]?.size ?? [1, 1];
  return { x: o.x + size[0] / 2, y: o.y + size[1] / 2 };
};

export const queueLimit = (ctx: Ctx): number => BASE_QUEUE + mod(ctx.s, ctx.c, 'queueSlots');

export function outputCount(m: Machine): number {
  return Object.values(m.output).reduce((a, b) => a + b, 0);
}

export function updateProcessing(ctx: Ctx, dt: number): void {
  const { s, c } = ctx;
  const speed = 1 + mod(s, c, 'processSpeed');
  for (const o of s.objects) {
    const m = s.machines[String(o.uid)];
    if (!m || !m.queue.length) continue;
    let budget = dt * speed;
    while (budget > 0 && m.queue.length) {
      const job = m.queue[0]!;
      if (outputCount(m) >= OUTPUT_CAP) break; // pełna tacka wstrzymuje produkcję
      const used = Math.min(budget, job.remainingMs);
      job.remainingMs -= used;
      budget -= used;
      if (job.remainingMs <= 0) {
        const r = c.recipes[job.recipe];
        m.queue.shift();
        if (r) {
          m.output[r.output.item] = (m.output[r.output.item] ?? 0) + r.output.qty;
          stat(ctx, 'crafted', r.output.qty);
          ctx.bus.emit({ type: 'crafted', uid: o.uid, item: r.output.item, qty: r.output.qty, at: centerOf(ctx, o) });
        }
      }
    }
  }
}

export function queueRecipe(ctx: Ctx, uid: number, recipeId: string): CommandResult {
  const { s, c } = ctx;
  const o = s.objects.find((x) => x.uid === uid);
  const r = c.recipes[recipeId];
  if (!o || !r || r.building !== o.type) return fail('invalid');
  const m = machineOf(ctx, uid);
  if (m.queue.length >= queueLimit(ctx)) return fail('queue-full');
  if (!r.inputs.every((inp) => countItem(s, inp.item) >= inp.qty)) return fail('missing-items');
  for (const inp of r.inputs) consumeItem(s, inp.item, inp.qty);
  m.queue.push({ recipe: r.id, remainingMs: (r.minutes / 60) * HOUR_MS });
  ctx.bus.emit({ type: 'queued', uid, recipe: r.id, at: centerOf(ctx, o) });
  return OK;
}

export function collectOutput(ctx: Ctx, uid: number): CommandResult {
  const { s } = ctx;
  const o = s.objects.find((x) => x.uid === uid);
  const m = s.machines[String(uid)];
  if (!o || !m) return fail('empty');
  const count = outputCount(m);
  if (!count) return fail('empty');
  for (const [item, qty] of Object.entries(m.output)) addItem(s, item, qty);
  m.output = {};
  ctx.bus.emit({ type: 'outputCollected', uid, count, at: centerOf(ctx, o) });
  addXp(ctx, count * 2);
  return OK;
}
