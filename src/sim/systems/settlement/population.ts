// Mieszkańcy: napływ rodzin, wyjazdy, narodziny, dorastanie, bezdomni (docs/plan-osada.md §4). STUB – moduł „ludność”.

import type { Ctx } from '../../ctx';

/** Co godzinę: o `arrivalHour` przyjazdy rodzin (emituje `arrived`, ustawia `foundedDay`). */
export function populationHour(ctx: Ctx, hour: number): void {
  void ctx;
  void hour;
}

/** Raz na dobę: wyjazdy (`left`), dorastanie (`grewUp`), narodziny (`born`), przeprowadzki bezdomnych. */
export function populationDay(ctx: Ctx): void {
  void ctx;
}
