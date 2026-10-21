// Odczyt danych symulacji w wątku głównym (ceny, kalendarz itp.) – te same czyste funkcje co w Workerze.

import { EventBus } from '../core/eventBus';
import { calendarAt } from '../sim/calendar';
import { makeCtx, type Ctx } from '../sim/ctx';
import type { SimEvent } from '../sim/events';
import type { GameState } from '../sim/types';

const bus = new EventBus<SimEvent>();
let cache: { state: GameState; ctx: Ctx } | null = null;

/** Kontekst tylko do odczytu (nie wysyłać przez niego zmian!). */
export function viewCtx(state: GameState): Ctx {
  if (cache?.state === state) return cache.ctx;
  const ctx = makeCtx(state, bus, calendarAt(state.clock.simMs, state.seed));
  cache = { state, ctx };
  return ctx;
}
