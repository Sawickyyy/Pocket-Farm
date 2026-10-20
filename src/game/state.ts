import {
  CROP_IDS,
  PLOT_COUNT,
  START_COINS,
  START_SEEDS,
  START_UNLOCKED,
  UPGRADE_IDS,
  type CropId,
  type ToolId,
  type UpgradeId,
} from './content';

export const SAVE_VERSION = 1;

export interface PlantedCrop {
  id: CropId;
  plantedAt: number;
  /** Moment podlania (start wzrostu) albo null, jeśli nasiono czeka na wodę. */
  wateredAt: number | null;
  /** Moment dojrzałości wyliczony przy podlaniu (zamraża wpływ ulepszeń). */
  readyAt: number | null;
}

export interface Plot {
  unlocked: boolean;
  tilled: boolean;
  crop: PlantedCrop | null;
}

export type CropCounts = Record<CropId, number>;

export interface GameState {
  version: number;
  createdAt: number;
  coins: number;
  xp: number;
  plots: Plot[];
  seeds: CropCounts;
  barn: CropCounts;
  upgrades: Record<UpgradeId, number>;
  tool: ToolId;
  selectedSeed: CropId;
  stats: { harvested: number; earned: number };
  settings: { sound: boolean };
}

export function emptyCounts(): CropCounts {
  return Object.fromEntries(CROP_IDS.map((id) => [id, 0])) as CropCounts;
}

export function createInitialState(now: number): GameState {
  const plots: Plot[] = Array.from({ length: PLOT_COUNT }, (_, i) => ({
    unlocked: START_UNLOCKED.includes(i),
    tilled: false,
    crop: null,
  }));
  const seeds = emptyCounts();
  for (const [id, n] of Object.entries(START_SEEDS)) seeds[id as CropId] = n ?? 0;
  return {
    version: SAVE_VERSION,
    createdAt: now,
    coins: START_COINS,
    xp: 0,
    plots,
    seeds,
    barn: emptyCounts(),
    upgrades: Object.fromEntries(UPGRADE_IDS.map((id) => [id, 0])) as Record<UpgradeId, number>,
    tool: 'hoe',
    selectedSeed: 'radish',
    stats: { harvested: 0, earned: 0 },
    settings: { sound: true },
  };
}
