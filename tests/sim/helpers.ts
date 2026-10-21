import { expect } from 'vitest';
import { DAY_MS, HOUR_MS, SEASON_DAYS, START_SIM_MS, weatherForDay } from '../../src/sim/calendar';
import type { Command } from '../../src/sim/commands';
import { START_UNLOCKED, createInitialState } from '../../src/sim/initialState';
import { Simulation } from '../../src/sim/simulation';
import type { GameState } from '../../src/sim/types';

export const T0 = 1_700_000_000_000;
export const P = START_UNLOCKED[0]!;

export function makeSim(patch: (s: GameState) => void = () => {}, seed = 42): Simulation {
  const s = createInitialState(T0, seed);
  s.tutorial.done = true;
  patch(s);
  return new Simulation(s);
}

export function ok(sim: Simulation, cmd: Command): void {
  const r = sim.dispatch(cmd);
  expect(r, JSON.stringify(cmd)).toEqual({ ok: true });
}

export function reason(sim: Simulation, cmd: Command): string | null {
  const r = sim.dispatch(cmd);
  return r.ok ? null : r.reason;
}

/** Ustawia zegar na podany dzień/godzinę (bez symulowania kroków). */
export function setTime(s: GameState, day: number, hour = 8): void {
  s.clock.simMs = day * DAY_MS + hour * HOUR_MS;
  s.lastDay = day;
}

/** Pierwszy dzień ≥ from (w danym sezonie) o zadanej pogodzie. */
export function findDay(seed: number, weather: string, seasonIndex: number, from = 1): number {
  for (let d = Math.max(from, seasonIndex * SEASON_DAYS); d < 400; d++) {
    if (Math.floor(d / SEASON_DAYS) % 4 === seasonIndex && weatherForDay(seed, d) === weather) return d;
  }
  throw new Error(`brak dnia z pogodą ${weather}`);
}

export const tillPlantWater = (sim: Simulation, plot: number, crop = 'radish') => {
  sim.state.seeds[crop] = (sim.state.seeds[crop] ?? 0) + 1;
  ok(sim, { type: 'selectTool', tool: 'hoe' });
  ok(sim, { type: 'useTool', plot });
  ok(sim, { type: 'selectSeed', crop });
  ok(sim, { type: 'useTool', plot });
  ok(sim, { type: 'selectTool', tool: 'can' });
  sim.state.plots[plot]!.moisture = 0; // wilgoć mogła zostać po poprzednim zbiorze
  ok(sim, { type: 'useTool', plot });
};

export { DAY_MS, HOUR_MS, SEASON_DAYS, START_SIM_MS };
