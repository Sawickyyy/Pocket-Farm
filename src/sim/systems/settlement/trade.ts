// Handel z innymi osadami: karawany, import i eksport (docs/plan-osada.md §12). STUB – moduł „handel i rada”.

import type { CommandResult } from '../../commands';
import { fail, type Ctx } from '../../ctx';

/** Co godzinę: przyjazd karawany o 10:00 (oferty, auto-eksport), odjazd o czasie `leavesAt`. */
export function tradeHour(ctx: Ctx, hour: number): void {
  void ctx;
  void hour;
}

export function caravanSell(ctx: Ctx, key: string, qty: number): CommandResult {
  void ctx;
  void key;
  void qty;
  return fail('no-caravan');
}

export function caravanBuy(ctx: Ctx, item: string, qty: number): CommandResult {
  void ctx;
  void item;
  void qty;
  return fail('no-caravan');
}

export function toggleExport(ctx: Ctx, item: string): CommandResult {
  void ctx;
  void item;
  return fail('invalid');
}
