// Czysta logika gry: funkcje (stan, argumenty, czas) -> nowy stan + zdarzenia.
// Nie dotyka DOM-u ani Phasera, więc da się ją w całości testować w Vitest.

import {
  CROPS,
  FERTILIZER_STEP,
  GRID_COLS,
  GRID_ROWS,
  GROWTH_STAGES,
  PLOT_BASE_COST,
  PLOT_COST_GROWTH,
  START_UNLOCKED,
  STALL_STEP,
  UPGRADES,
  type CropId,
  type ToolId,
  type UpgradeId,
} from './content';
import { levelFromXp, levelReward } from './progression';
import type { GameState, PlantedCrop, Plot } from './state';

export type GameEvent =
  | { type: 'tilled'; plot: number }
  | { type: 'planted'; plot: number; crop: CropId }
  | { type: 'watered'; plot: number }
  | { type: 'harvested'; plot: number; crop: CropId; xp: number }
  | { type: 'unlocked'; plot: number; cost: number }
  | { type: 'levelUp'; level: number; reward: number }
  | { type: 'sold'; crop: CropId; qty: number; coins: number }
  | { type: 'boughtSeeds'; crop: CropId; qty: number; cost: number }
  | { type: 'boughtUpgrade'; upgrade: UpgradeId; level: number; cost: number };

export type FailReason =
  | 'locked'
  | 'not-adjacent'
  | 'already-unlocked'
  | 'already-tilled'
  | 'not-tilled'
  | 'occupied'
  | 'no-seeds'
  | 'nothing-to-water'
  | 'already-watered'
  | 'nothing-to-harvest'
  | 'not-ready'
  | 'no-coins'
  | 'level-too-low'
  | 'max-level'
  | 'nothing-to-sell'
  | 'invalid';

export type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; state: GameState; reason: FailReason };

const fail = (state: GameState, reason: FailReason): ActionResult => ({ ok: false, state, reason });
const success = (state: GameState, events: GameEvent[] = []): ActionResult => ({ ok: true, state, events });

// ---------------------------------------------------------------- wzrost

export function growDuration(crop: CropId, upgrades: GameState['upgrades']): number {
  const factor = 1 - FERTILIZER_STEP * (upgrades.fertilizer ?? 0);
  return Math.round(CROPS[crop].growMs * factor);
}

/** Postęp wzrostu 0..1 liczony wyłącznie ze znaczników czasu – działa także po zamknięciu gry. */
export function growthProgress(crop: PlantedCrop, now: number): number {
  if (crop.wateredAt === null || crop.readyAt === null) return 0;
  const total = crop.readyAt - crop.wateredAt;
  if (total <= 0) return 1;
  // Ochrona przed cofnięciem zegara systemowego.
  const elapsed = Math.max(0, now - crop.wateredAt);
  return Math.min(1, elapsed / total);
}

/** Etap 0..3: nasiono, kiełek, młoda roślina, dojrzała. */
export function cropStage(crop: PlantedCrop, now: number): number {
  const p = growthProgress(crop, now);
  if (p >= 1) return GROWTH_STAGES - 1;
  return Math.min(GROWTH_STAGES - 2, Math.floor(p * (GROWTH_STAGES - 1)));
}

export function isReady(crop: PlantedCrop | null, now: number): boolean {
  return crop !== null && growthProgress(crop, now) >= 1;
}

export function msUntilReady(crop: PlantedCrop, now: number): number | null {
  if (crop.readyAt === null) return null;
  return Math.max(0, crop.readyAt - now);
}

// ---------------------------------------------------------------- ekonomia

export function sellPrice(crop: CropId, upgrades: GameState['upgrades']): number {
  return Math.round(CROPS[crop].sellPrice * (1 + STALL_STEP * (upgrades.stall ?? 0)));
}

export function plotUnlockCost(state: GameState): number {
  const purchased = state.plots.filter((p) => p.unlocked).length - START_UNLOCKED.length;
  const raw = PLOT_BASE_COST * PLOT_COST_GROWTH ** Math.max(0, purchased);
  return Math.round(raw / 5) * 5;
}

export function nextUpgradeCost(state: GameState, id: UpgradeId): number | null {
  return UPGRADES[id].costs[state.upgrades[id]] ?? null;
}

export function plotNeighbors(index: number): number[] {
  const col = index % GRID_COLS;
  const row = Math.floor(index / GRID_COLS);
  const out: number[] = [];
  if (col > 0) out.push(index - 1);
  if (col < GRID_COLS - 1) out.push(index + 1);
  if (row > 0) out.push(index - GRID_COLS);
  if (row < GRID_ROWS - 1) out.push(index + GRID_COLS);
  return out;
}

export function canUnlock(state: GameState, index: number): boolean {
  const plot = state.plots[index];
  if (!plot || plot.unlocked) return false;
  return plotNeighbors(index).some((n) => state.plots[n]?.unlocked);
}

// ---------------------------------------------------------------- pomocnicze

function withPlot(state: GameState, index: number, plot: Plot): GameState {
  const plots = state.plots.slice();
  plots[index] = plot;
  return { ...state, plots };
}

/** Dodaje XP i obsługuje awans (nagroda w monetach). */
function addXp(state: GameState, xp: number, events: GameEvent[]): GameState {
  const before = levelFromXp(state.xp);
  const next = { ...state, xp: state.xp + xp };
  const after = levelFromXp(next.xp);
  let coins = next.coins;
  for (let l = before + 1; l <= after; l++) {
    const reward = levelReward(l);
    coins += reward;
    events.push({ type: 'levelUp', level: l, reward });
  }
  return { ...next, coins };
}

// ---------------------------------------------------------------- akcje na polach

export function till(state: GameState, index: number): ActionResult {
  const plot = state.plots[index];
  if (!plot) return fail(state, 'invalid');
  if (!plot.unlocked) return fail(state, 'locked');
  if (plot.crop) return fail(state, 'occupied');
  if (plot.tilled) return fail(state, 'already-tilled');
  return success(withPlot(state, index, { ...plot, tilled: true }), [{ type: 'tilled', plot: index }]);
}

export function plant(state: GameState, index: number, crop: CropId, now: number): ActionResult {
  const plot = state.plots[index];
  if (!plot) return fail(state, 'invalid');
  if (!plot.unlocked) return fail(state, 'locked');
  if (plot.crop) return fail(state, 'occupied');
  if (!plot.tilled) return fail(state, 'not-tilled');
  if (state.seeds[crop] <= 0) return fail(state, 'no-seeds');

  const autoWater = state.upgrades.sprinkler > 0;
  const planted: PlantedCrop = {
    id: crop,
    plantedAt: now,
    wateredAt: autoWater ? now : null,
    readyAt: autoWater ? now + growDuration(crop, state.upgrades) : null,
  };
  const next = withPlot({ ...state, seeds: { ...state.seeds, [crop]: state.seeds[crop] - 1 } }, index, {
    ...plot,
    crop: planted,
  });
  const events: GameEvent[] = [{ type: 'planted', plot: index, crop }];
  if (autoWater) events.push({ type: 'watered', plot: index });
  return success(next, events);
}

export function water(state: GameState, index: number, now: number): ActionResult {
  const plot = state.plots[index];
  if (!plot) return fail(state, 'invalid');
  if (!plot.unlocked) return fail(state, 'locked');
  if (!plot.crop) return fail(state, 'nothing-to-water');
  if (plot.crop.wateredAt !== null) return fail(state, 'already-watered');
  const crop: PlantedCrop = {
    ...plot.crop,
    wateredAt: now,
    readyAt: now + growDuration(plot.crop.id, state.upgrades),
  };
  return success(withPlot(state, index, { ...plot, crop }), [{ type: 'watered', plot: index }]);
}

export function harvest(state: GameState, index: number, now: number): ActionResult {
  const plot = state.plots[index];
  if (!plot) return fail(state, 'invalid');
  if (!plot.unlocked) return fail(state, 'locked');
  if (!plot.crop) return fail(state, 'nothing-to-harvest');
  if (!isReady(plot.crop, now)) return fail(state, 'not-ready');

  const id = plot.crop.id;
  const xp = CROPS[id].xp;
  const events: GameEvent[] = [{ type: 'harvested', plot: index, crop: id, xp }];
  // Po zbiorze ziemia wraca do stanu nieoranego – pętla „zaoraj → posiej” zaczyna się od nowa.
  let next = withPlot(state, index, { ...plot, crop: null, tilled: false });
  next = {
    ...next,
    barn: { ...next.barn, [id]: next.barn[id] + 1 },
    stats: { ...next.stats, harvested: next.stats.harvested + 1 },
  };
  next = addXp(next, xp, events);
  return success(next, events);
}

export function unlockPlot(state: GameState, index: number): ActionResult {
  const plot = state.plots[index];
  if (!plot) return fail(state, 'invalid');
  if (plot.unlocked) return fail(state, 'already-unlocked');
  if (!canUnlock(state, index)) return fail(state, 'not-adjacent');
  const cost = plotUnlockCost(state);
  if (state.coins < cost) return fail(state, 'no-coins');
  const next = withPlot({ ...state, coins: state.coins - cost }, index, { ...plot, unlocked: true });
  return success(next, [{ type: 'unlocked', plot: index, cost }]);
}

/** Akcja aktualnie wybranego narzędzia na danym polu. */
export function applyTool(state: GameState, index: number, now: number): ActionResult {
  switch (state.tool) {
    case 'hoe':
      return till(state, index);
    case 'seeds':
      return plant(state, index, state.selectedSeed, now);
    case 'can':
      return water(state, index, now);
    case 'sickle':
      return harvest(state, index, now);
  }
}

// ---------------------------------------------------------------- sklep

export function buySeeds(state: GameState, crop: CropId, qty: number): ActionResult {
  if (!Number.isInteger(qty) || qty <= 0) return fail(state, 'invalid');
  if (levelFromXp(state.xp) < CROPS[crop].unlockLevel) return fail(state, 'level-too-low');
  const cost = CROPS[crop].seedPrice * qty;
  if (state.coins < cost) return fail(state, 'no-coins');
  return success(
    { ...state, coins: state.coins - cost, seeds: { ...state.seeds, [crop]: state.seeds[crop] + qty } },
    [{ type: 'boughtSeeds', crop, qty, cost }],
  );
}

export function sell(state: GameState, crop: CropId, qty: number | 'all'): ActionResult {
  const owned = state.barn[crop];
  const n = qty === 'all' ? owned : qty;
  if (!Number.isInteger(n) || n <= 0) return fail(state, owned === 0 ? 'nothing-to-sell' : 'invalid');
  if (n > owned) return fail(state, 'nothing-to-sell');
  const coins = sellPrice(crop, state.upgrades) * n;
  return success(
    {
      ...state,
      coins: state.coins + coins,
      barn: { ...state.barn, [crop]: owned - n },
      stats: { ...state.stats, earned: state.stats.earned + coins },
    },
    [{ type: 'sold', crop, qty: n, coins }],
  );
}

export function sellAll(state: GameState): ActionResult {
  let current = state;
  const events: GameEvent[] = [];
  for (const id of Object.keys(state.barn) as CropId[]) {
    if (current.barn[id] <= 0) continue;
    const r = sell(current, id, 'all');
    if (r.ok) {
      current = r.state;
      events.push(...r.events);
    }
  }
  return events.length ? success(current, events) : fail(state, 'nothing-to-sell');
}

export function buyUpgrade(state: GameState, id: UpgradeId): ActionResult {
  const def = UPGRADES[id];
  const level = state.upgrades[id];
  const cost = def.costs[level];
  if (cost === undefined) return fail(state, 'max-level');
  if (levelFromXp(state.xp) < def.unlockLevel) return fail(state, 'level-too-low');
  if (state.coins < cost) return fail(state, 'no-coins');
  return success(
    { ...state, coins: state.coins - cost, upgrades: { ...state.upgrades, [id]: level + 1 } },
    [{ type: 'boughtUpgrade', upgrade: id, level: level + 1, cost }],
  );
}

export function selectTool(state: GameState, tool: ToolId): GameState {
  return state.tool === tool ? state : { ...state, tool };
}

export function selectSeed(state: GameState, crop: CropId): GameState {
  return { ...state, selectedSeed: crop, tool: 'seeds' };
}
