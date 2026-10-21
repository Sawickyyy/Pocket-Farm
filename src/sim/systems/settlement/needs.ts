// Potrzeby, posiłki i szczęście (docs/plan-osada.md §7). STUB – moduł „praca i potrzeby”.

import type { NeedId } from '../../../content/content';
import type { Ctx } from '../../ctx';
import type { GameState, Resident } from '../../types';

/** Co godzinę: posiłki (o godzinach `mealHours`, ze sprzedażą w zasięgu sklepu), dążenie potrzeb i szczęścia. */
export function needsHour(ctx: Ctx, hour: number): void {
  void ctx;
  void hour;
}

/** Raz na dobę: aktualizacja `sadDays`, wyzerowanie licznika posiłków, wygaszenie `mood`. */
export function needsDay(ctx: Ctx): void {
  void ctx;
}

/** Docelowe wartości potrzeb mieszkańca (do UI i testów). */
export function needTargets(ctx: Ctx, r: Resident): Record<NeedId, number> {
  void ctx;
  void r;
  return { food: 1, housing: 1, work: 1, safety: 1, fun: 1 };
}

/** Punkty odżywcze dostępne w magazynie (bez rezerwy). */
export function foodStock(s: GameState, c: import('../../../content/content').Content): number {
  void s;
  void c;
  return 0;
}

/** Średnie szczęście mieszkańców (1, gdy brak mieszkańców). */
export function averageHappiness(s: GameState): number {
  const rs = s.settlement.residents;
  return rs.length ? rs.reduce((a, r) => a + r.happiness, 0) / rs.length : 1;
}
