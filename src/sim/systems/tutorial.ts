// Interaktywny samouczek: kroki z JSON przechodzą dalej po zdarzeniach z event busa.

import type { CommandResult } from '../commands';
import { OK, fail, type Ctx } from '../ctx';
import type { SimEvent } from '../events';

export function currentStep(ctx: Ctx) {
  return ctx.s.tutorial.done ? null : (ctx.c.tutorial[ctx.s.tutorial.step] ?? null);
}

function advance(ctx: Ctx): void {
  const { s, c } = ctx;
  const step = c.tutorial[s.tutorial.step];
  if (step?.coins) s.coins += step.coins;
  s.tutorial.step++;
  if (s.tutorial.step >= c.tutorial.length) s.tutorial.done = true;
  ctx.bus.emit({ type: 'tutorial', step: s.tutorial.step });
}

export function onTutorialEvent(ctx: Ctx, e: SimEvent): void {
  const step = currentStep(ctx);
  if (!step || step.advance !== e.type) return;
  if (e.type === 'toolSelected' && step.value && e.tool !== step.value) return;
  advance(ctx);
}

export function tutorialCommand(ctx: Ctx, action: 'next' | 'skip' | 'restart'): CommandResult {
  const { s } = ctx;
  if (action === 'restart') {
    s.tutorial = { step: 0, done: false };
    ctx.bus.emit({ type: 'tutorial', step: 0 });
    return OK;
  }
  if (action === 'skip') {
    s.tutorial.done = true;
    ctx.bus.emit({ type: 'tutorial', step: s.tutorial.step });
    return OK;
  }
  const step = currentStep(ctx);
  if (!step || step.advance !== 'next') return fail('invalid');
  advance(ctx);
  return OK;
}
