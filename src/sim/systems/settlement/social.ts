// Relacje społeczne: przyjaźnie, miłość, śluby, konflikty (docs/plan-osada.md §11). STUB – moduł „ludność”.

import type { Ctx } from '../../ctx';
import type { GameState, Relation } from '../../types';

/** Raz na dobę: nowe i rosnące relacje, śluby (wspólny dom), konflikty. Emituje `relation`. */
export function socialDay(ctx: Ctx): void {
  void ctx;
}

export function relationsOf(s: GameState, id: number): Relation[] {
  return s.settlement.relations.filter((r) => r.a === id || r.b === id);
}

export function partnerOf(s: GameState, id: number): number | null {
  const r = s.settlement.relations.find((x) => x.kind === 'partner' && (x.a === id || x.b === id));
  return r ? (r.a === id ? r.b : r.a) : null;
}

/** Wpływ relacji na szczęście: +0,03/przyjaciel (max 0,09), +0,05 partner, −0,05/konflikt. */
export function relationBonus(s: GameState, id: number): number {
  let friends = 0;
  let bonus = 0;
  for (const r of s.settlement.relations) {
    if (r.a !== id && r.b !== id) continue;
    if (r.kind === 'friend') friends++;
    else if (r.kind === 'partner') bonus += 0.05;
    else if (r.kind === 'conflict') bonus -= 0.05;
  }
  return bonus + Math.min(0.09, friends * 0.03);
}

/** Usuwa relacje mieszkańca (wyjazd). */
export function dropRelations(s: GameState, id: number): void {
  s.settlement.relations = s.settlement.relations.filter((r) => r.a !== id && r.b !== id);
}
