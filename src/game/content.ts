// Dane gry (balans). Wszystko, co projektant chciałby stroić, jest tutaj.

export const GRID_COLS = 6;
export const GRID_ROWS = 8;
export const PLOT_COUNT = GRID_COLS * GRID_ROWS;

export const CROP_IDS = ['radish', 'carrot', 'wheat', 'pumpkin'] as const;
export type CropId = (typeof CROP_IDS)[number];

export interface CropDef {
  id: CropId;
  name: string;
  /** Czas wzrostu od podlania do dojrzałości, w ms. */
  growMs: number;
  seedPrice: number;
  sellPrice: number;
  xp: number;
  /** Minimalny poziom gracza, żeby kupić nasiona. */
  unlockLevel: number;
  /** Kolor używany w interfejsie HTML. */
  color: string;
}

const MIN = 60_000;

export const CROPS: Record<CropId, CropDef> = {
  radish: { id: 'radish', name: 'Rzodkiewka', growMs: 1 * MIN, seedPrice: 2, sellPrice: 5, xp: 2, unlockLevel: 1, color: '#e2486a' },
  carrot: { id: 'carrot', name: 'Marchew', growMs: 5 * MIN, seedPrice: 6, sellPrice: 18, xp: 6, unlockLevel: 2, color: '#f08a24' },
  wheat: { id: 'wheat', name: 'Pszenica', growMs: 15 * MIN, seedPrice: 15, sellPrice: 48, xp: 15, unlockLevel: 3, color: '#e4c04a' },
  pumpkin: { id: 'pumpkin', name: 'Dynia', growMs: 60 * MIN, seedPrice: 40, sellPrice: 160, xp: 50, unlockLevel: 5, color: '#e0731c' },
};

export const UPGRADE_IDS = ['fertilizer', 'stall', 'sprinkler'] as const;
export type UpgradeId = (typeof UPGRADE_IDS)[number];

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** Opis efektu dla poziomu ulepszenia (1..maxLevel). */
  describe: (level: number) => string;
  /** Cena kolejnych poziomów; długość = maksymalny poziom. */
  costs: readonly number[];
  unlockLevel: number;
}

export const FERTILIZER_STEP = 0.15;
export const STALL_STEP = 0.15;

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  fertilizer: {
    id: 'fertilizer',
    name: 'Nawóz',
    describe: (l) => `Rośliny rosną o ${Math.round(l * FERTILIZER_STEP * 100)}% szybciej`,
    costs: [50, 150, 400],
    unlockLevel: 2,
  },
  stall: {
    id: 'stall',
    name: 'Stragan',
    describe: (l) => `Plony sprzedajesz o ${Math.round(l * STALL_STEP * 100)}% drożej`,
    costs: [80, 240, 600],
    unlockLevel: 2,
  },
  sprinkler: {
    id: 'sprinkler',
    name: 'Zraszacz',
    describe: () => 'Nowo zasiane nasiona są od razu podlane',
    costs: [250],
    unlockLevel: 3,
  },
};

export const TOOL_IDS = ['hoe', 'seeds', 'can', 'sickle'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export const TOOL_NAMES: Record<ToolId, string> = {
  hoe: 'Motyka',
  seeds: 'Nasiona',
  can: 'Konewka',
  sickle: 'Sierp',
};

export const START_COINS = 20;
export const START_SEEDS: Partial<Record<CropId, number>> = { radish: 4 };

/** Pola odblokowane na starcie: kolumny 2–3, wiersze 3–5 (środek siatki). */
export const START_UNLOCKED: readonly number[] = [3, 4, 5].flatMap((row) => [2, 3].map((col) => row * GRID_COLS + col));

export const PLOT_BASE_COST = 30;
export const PLOT_COST_GROWTH = 1.3;

/** Liczba etapów wzrostu (0 = nasiono, 3 = dojrzała). */
export const GROWTH_STAGES = 4;
