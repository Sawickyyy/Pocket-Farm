// Budżet, produkcja i łańcuchy dostaw (docs/plan-osada.md §6, §8). STUB – moduł „gospodarka”.

import type { CommandResult } from '../../commands';
import { fail, type Ctx } from '../../ctx';

/** Co godzinę pracy: produkcja budynków z `production` i maszyn z obsadą (`autoRecipes`). Emituje `produced`. */
export function productionHour(ctx: Ctx, hour: number): void {
  void ctx;
  void hour;
}

/** Co godzinę: wypłata płac o `wageHour` (emituje `unpaid` przy braku monet). */
export function economyHour(ctx: Ctx, hour: number): void {
  void ctx;
  void hour;
}

/** Raz na dobę: podatki, utrzymanie, zdarzenie `budget{day, net}` za miniony dzień. */
export function economyDay(ctx: Ctx): void {
  void ctx;
}

export function setTax(ctx: Ctx, rate: number): CommandResult {
  void ctx;
  void rate;
  return fail('invalid');
}

export function toggleReserve(ctx: Ctx, item: string): CommandResult {
  void ctx;
  void item;
  return fail('invalid');
}
