// Rada osady: propozycje mieszkańców, decyzje gracza, bony, specjalizacja (docs/plan-osada.md §13–14). STUB – moduł „handel i rada”.

import type { CommandResult } from '../../commands';
import { fail, type Ctx } from '../../ctx';
import type { GameState } from '../../types';

/** Raz na dobę: wygasanie propozycji i bonów, nowe propozycje wg warunków (emituje `proposal`). */
export function councilDay(ctx: Ctx): void {
  void ctx;
}

export function decideProposal(ctx: Ctx, id: number, approve: boolean): CommandResult {
  void ctx;
  void id;
  void approve;
  return fail('invalid');
}

/** Zniżka z bonu rady na budynek danego typu (0..1). */
export function voucherDiscount(s: GameState, type: string, day: number): number {
  const v = s.settlement.vouchers[type];
  return v && v.untilDay >= day ? v.discount : 0;
}

export function specialize(ctx: Ctx, id: string): CommandResult {
  void ctx;
  void id;
  return fail('invalid');
}

export function renameSettlement(ctx: Ctx, name: string): CommandResult {
  void ctx;
  void name;
  return fail('invalid');
}
