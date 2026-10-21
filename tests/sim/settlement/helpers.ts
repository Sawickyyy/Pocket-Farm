// Pomocniki testów osady: stawianie gotowych budynków, dodawanie mieszkańców, przewijanie godzin.

import { CONTENT } from '../../../src/content/content';
import { canPlace } from '../../../src/sim/systems/building';
import { nextId } from '../../../src/sim/systems/settlement/common';
import type { Simulation } from '../../../src/sim/simulation';
import type { GameState, Resident } from '../../../src/sim/types';
import { FARM } from '../../../src/sim/world';
import { HOUR_MS, makeSim, ok } from '../helpers';

export { makeSim, ok, HOUR_MS };

/** Symulacja z dużym zapasem monet, drewna i desek oraz odblokowanymi etapami (domyślnie wszystkie). */
export function makeTown(patch: (s: GameState) => void = () => {}, seed = 42, peakTier = 4): Simulation {
  return makeSim((s) => {
    s.coins = 100_000;
    s.xp = 50_000;
    s.inventory.wood = 500;
    s.inventory.planks = 300;
    s.inventory.tools = 20;
    s.settlement.peakTier = peakTier;
    patch(s);
  }, seed);
}

/** Pierwsze wolne miejsce na terenie osady (od lewego górnego rogu farmy). */
export function freeSpot(s: GameState, type: string, from = { x: FARM.x, y: FARM.y }): { x: number; y: number } {
  for (let y = from.y; y < 64; y++) {
    for (let x = from.x; x < 64; x++) if (canPlace(s, CONTENT, type, x, y).ok) return { x, y };
  }
  throw new Error(`brak miejsca na ${type}`);
}

/** Stawia budynek (komendą) i od razu kończy budowę. Zwraca uid. */
export function placeBuilt(sim: Simulation, type: string, at?: { x: number; y: number }): number {
  const spot = at ?? freeSpot(sim.state, type);
  ok(sim, { type: 'place', building: type, x: spot.x, y: spot.y });
  const uid = sim.state.nextUid - 1;
  const site = sim.state.settlement.sites[String(uid)];
  if (site) site.built = 1;
  return uid;
}

/** Dodaje mieszkańca bezpośrednio do stanu (bez napływu). */
export function addResident(s: GameState, patch: Partial<Resident> = {}): Resident {
  const id = nextId(s);
  const r: Resident = {
    id,
    name: `Test ${id}`,
    family: patch.family ?? id,
    child: false,
    bornDay: -1,
    home: null,
    job: null,
    needs: { food: 0.8, housing: 0.8, work: 0.8, safety: 0.8, fun: 0.8 },
    happiness: 0.8,
    sadDays: 0,
    homelessDays: 0,
    arrivedDay: 0,
    look: 0,
    meals: { eaten: 0, due: 0, kinds: [] },
    mood: { value: 0, untilDay: -1 },
    ...patch,
  };
  s.settlement.residents.push(r);
  return r;
}

/** Przewija symulację o n godzin gry. */
export function runHours(sim: Simulation, n: number): void {
  sim.advance(n * HOUR_MS);
}
