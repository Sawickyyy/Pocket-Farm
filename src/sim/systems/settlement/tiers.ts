// Etapy rozwoju osady (obozowisko → osada → wieś → miasteczko → miasto) i awanse.

import type { Ctx } from '../../ctx';
import { chronicle, population, tierOf } from './common';

export { tierOf };

/** Aktualizuje najwyższy osiągnięty etap (odblokowania zostają na zawsze). */
export function updateTier(ctx: Ctx): void {
  const st = ctx.s.settlement;
  const tier = tierOf(ctx.c, population(ctx.s));
  while (st.peakTier < tier) {
    st.peakTier++;
    chronicle(ctx, 'tierUp', { tier: st.peakTier });
    ctx.bus.emit({ type: 'tierUp', tier: st.peakTier });
  }
}

/** Czy budynek jest odblokowany na danym etapie. */
export const tierAllows = (peakTier: number, tier: number | undefined): boolean => (tier ?? 0) <= peakTier;
