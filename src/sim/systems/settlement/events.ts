// Wydarzenia losowe: pożary, awarie, epidemie zwierząt, kryzysy, dobre wydarzenia (docs/plan-osada.md §10). STUB – moduł „wydarzenia”.

import type { CommandResult } from '../../commands';
import { fail, type Ctx } from '../../ctx';
import type { GameState } from '../../types';

/** Co godzinę: palenie się i gaszenie, wygasanie wydarzeń, koniec epidemii. */
export function eventsHour(ctx: Ctx, hour: number): void {
  void ctx;
  void hour;
}

/** Raz na dobę: losowanie nowych wydarzeń (nie offline, nie przed `minDay`). */
export function eventsDay(ctx: Ctx): void {
  void ctx;
}

/** Czy zwierzęta w budynku `uid` chorują (hak w updateAnimals). */
export function animalHomeSick(s: GameState, uid: number): boolean {
  void s;
  void uid;
  return false;
}

/** Mnożnik cen (kryzys gospodarczy ×0,7) – rynek i karawany. */
export function priceMult(s: GameState): number {
  void s;
  return 1;
}

/** Rozrywka z wydarzeń (festyn +0,15). */
export function funBoost(s: GameState): number {
  void s;
  return 0;
}

export function treatAnimals(ctx: Ctx, home: number): CommandResult {
  void ctx;
  void home;
  return fail('not-sick');
}
