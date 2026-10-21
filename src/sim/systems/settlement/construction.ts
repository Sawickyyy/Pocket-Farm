// Budowa i naprawy (docs/plan-osada.md §2, §10). STUB – moduł „budowa”.

import type { CommandResult } from '../../commands';
import { fail, type Ctx } from '../../ctx';

/** Efektywna liczba budowlańców pracujących teraz (Σ wydajności pracowników placów budowy w godzinach pracy). */
export function builderPower(ctx: Ctx, hour: number): number {
  void ctx;
  void hour;
  return 0;
}

/**
 * Co godzinę: postęp budów (`sites[uid].built`, emituje `constructed` + kronika), naprawy uszkodzeń i awarii
 * przez budowlańców (emituje `repaired`).
 */
export function constructionHour(ctx: Ctx, hour: number): void {
  void ctx;
  void hour;
}

/** Natychmiastowa naprawa za 20% kosztu budynku (min 20): uszkodzenie, awaria. */
export function repair(ctx: Ctx, uid: number): CommandResult {
  void ctx;
  void uid;
  return fail('not-damaged');
}
