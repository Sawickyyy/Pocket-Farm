// Wersjonowanie zapisu. Każda migracja podnosi wersję o 1.
// Dodając pole do GameState: zwiększ SAVE_VERSION w state.ts i dopisz tu migrację `[stara]: (s) => ...`.

import { CROP_IDS, PLOT_COUNT, TOOL_IDS, UPGRADE_IDS, UPGRADES, type CropId } from '../game/content';
import { SAVE_VERSION, createInitialState, type GameState, type PlantedCrop, type Plot } from '../game/state';

type AnyRecord = Record<string, unknown>;
export type Migration = (data: AnyRecord) => AnyRecord;

/** Migracje z wersji N do N+1. */
export const MIGRATIONS: Record<number, Migration> = {
  // przykład na przyszłość:
  // 1: (s) => ({ ...s, version: 2, nowePole: 0 }),
};

export class SaveError extends Error {}

export function migrate(data: AnyRecord, migrations: Record<number, Migration> = MIGRATIONS, target = SAVE_VERSION): AnyRecord {
  let current = data;
  let version = typeof current.version === 'number' ? current.version : 1;
  if (version > target) throw new SaveError(`Zapis pochodzi z nowszej wersji gry (${version}).`);
  while (version < target) {
    const step = migrations[version];
    if (!step) throw new SaveError(`Brak migracji z wersji ${version}.`);
    current = step(current);
    version++;
    current = { ...current, version };
  }
  return current;
}

const isObj = (v: unknown): v is AnyRecord => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, min = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : fallback;
const int = (v: unknown, fallback: number): number => Math.floor(num(v, fallback));

function normalizeCounts(v: unknown): Record<CropId, number> {
  const src = isObj(v) ? v : {};
  return Object.fromEntries(CROP_IDS.map((id) => [id, int(src[id], 0)])) as Record<CropId, number>;
}

function normalizeCrop(v: unknown): PlantedCrop | null {
  if (!isObj(v) || !CROP_IDS.includes(v.id as CropId)) return null;
  const wateredAt = typeof v.wateredAt === 'number' ? v.wateredAt : null;
  const readyAt = typeof v.readyAt === 'number' && wateredAt !== null ? v.readyAt : null;
  return {
    id: v.id as CropId,
    plantedAt: num(v.plantedAt, Date.now()),
    wateredAt: readyAt === null ? null : wateredAt,
    readyAt,
  };
}

/**
 * Zamienia dowolne (już zmigrowane) dane na poprawny GameState.
 * Uzupełnia brakujące pola wartościami domyślnymi, więc uszkodzony import nie zepsuje gry.
 */
export function normalizeState(data: AnyRecord, now: number): GameState {
  const base = createInitialState(now);
  const plotsSrc = Array.isArray(data.plots) ? data.plots : [];
  const plots: Plot[] = base.plots.map((def, i) => {
    const p = plotsSrc[i];
    if (!isObj(p)) return def;
    const crop = normalizeCrop(p.crop);
    const unlocked = typeof p.unlocked === 'boolean' ? p.unlocked : def.unlocked;
    return { unlocked, tilled: unlocked && (p.tilled === true || crop !== null), crop: unlocked ? crop : null };
  });
  if (plots.length !== PLOT_COUNT) throw new SaveError('Nieprawidłowa liczba pól.');

  const upSrc = isObj(data.upgrades) ? data.upgrades : {};
  const upgrades = Object.fromEntries(
    UPGRADE_IDS.map((id) => [id, Math.min(UPGRADES[id].costs.length, int(upSrc[id], 0))]),
  ) as GameState['upgrades'];

  const stats = isObj(data.stats) ? data.stats : {};
  const settings = isObj(data.settings) ? data.settings : {};

  return {
    version: SAVE_VERSION,
    createdAt: num(data.createdAt, now),
    coins: int(data.coins, base.coins),
    xp: int(data.xp, 0),
    plots,
    seeds: isObj(data.seeds) ? normalizeCounts(data.seeds) : base.seeds,
    barn: normalizeCounts(data.barn),
    upgrades,
    tool: TOOL_IDS.includes(data.tool as never) ? (data.tool as GameState['tool']) : base.tool,
    selectedSeed: CROP_IDS.includes(data.selectedSeed as CropId) ? (data.selectedSeed as CropId) : base.selectedSeed,
    stats: { harvested: int(stats.harvested, 0), earned: int(stats.earned, 0) },
    settings: { sound: typeof settings.sound === 'boolean' ? settings.sound : true },
  };
}

export function loadFromUnknown(data: unknown, now: number): GameState {
  if (!isObj(data)) throw new SaveError('Zapis nie jest obiektem.');
  return normalizeState(migrate(data), now);
}
