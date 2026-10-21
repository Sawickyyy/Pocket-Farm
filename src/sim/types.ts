// Model stanu gry (wersja 2). Stan jest zwykłym JSON-em: klonuje się go przez postMessage i zapisuje w IndexedDB.

import type { Season, WeatherId } from '../content/content';

export const SAVE_VERSION = 2;

export type ToolId = 'hoe' | 'seeds' | 'can' | 'fertilizer' | 'sickle' | 'rod';
export const TOOL_IDS: readonly ToolId[] = ['hoe', 'seeds', 'can', 'fertilizer', 'sickle', 'rod'];

export interface CropState {
  id: string;
  /** Postęp wzrostu 0..1. */
  growth: number;
  /** Czas wzrostu w wilgotnej glebie (ms) – do jakości. */
  wetMs: number;
  /** Łączny czas od posadzenia, w którym roślina mogła rosnąć (ms). */
  aliveMs: number;
  /** Suma jakości pogody ważona czasem. */
  weatherSum: number;
  plantedAt: number;
  withered: boolean;
}

export interface Plot {
  unlocked: boolean;
  tilled: boolean;
  /** Wilgotność 0..1; roślina rośnie tylko przy > 0. */
  moisture: number;
  /** Żyzność 0..1; wpływa na tempo i jakość. */
  fertility: number;
  lastCrop: string | null;
  /** Ile razy z rzędu zebrano tę samą uprawę (płodozmian). */
  streak: number;
  crop: CropState | null;
}

export interface PlacedObject {
  uid: number;
  type: string;
  x: number;
  y: number;
}

export interface Animal {
  id: number;
  kind: string;
  name: string;
  home: number;
  hunger: number;
  affection: number;
  progress: number;
  ready: boolean;
  pettedDay: number;
}

export interface Job {
  recipe: string;
  remainingMs: number;
}

export interface Machine {
  queue: Job[];
  output: Record<string, number>;
}

export interface Order {
  id: number;
  npc: string;
  item: string;
  qty: number;
  coins: number;
  xp: number;
  expiresDay: number;
}

export interface NpcState {
  friendship: number;
  giftDay: number;
  rewards: number[];
}

export interface Quest {
  id: number;
  tpl: string;
  target: number;
  progress: number;
  claimed: boolean;
}

export interface Settings {
  sound: boolean;
  music: boolean;
  captions: boolean;
  language: 'pl' | 'en';
  colorblind: 'none' | 'protan' | 'deutan' | 'tritan';
  uiScale: number;
  reducedMotion: 'auto' | 'on' | 'off';
}

export interface PendingFish {
  fish: string;
  tile: number;
  difficulty: number;
}

export interface GameState {
  version: number;
  seed: number;
  rng: number;
  createdAt: number;
  clock: {
    /** Czas symulacji (ms); 1 godzina gry = 1 minuta. */
    simMs: number;
    /** Ostatni znany czas rzeczywisty (Date.now) – do nadrabiania offline. 0 = nieznany. */
    lastRealMs: number;
    /** Niewykorzystana reszta czasu poniżej jednego kroku symulacji. */
    accMs: number;
    /** Mnożnik czasu (narzędzie debugowania). */
    timeScale: number;
  };
  coins: number;
  xp: number;
  skillPoints: number;
  skills: string[];
  plots: Plot[];
  seeds: Record<string, number>;
  inventory: Record<string, number>;
  objects: PlacedObject[];
  nextUid: number;
  animals: Animal[];
  machines: Record<string, Machine>;
  market: { sat: Record<string, number>; demand: Record<string, number> };
  npcs: Record<string, NpcState>;
  orders: Order[];
  quests: { daily: Quest[]; weekly: Quest[] };
  achievements: Record<string, number>;
  stats: Record<string, number>;
  festivalsDone: string[];
  unlocks: string[];
  world: { revealed: number[]; forage: Record<string, number>; pendingFish: PendingFish | null };
  tutorial: { step: number; done: boolean };
  tool: ToolId;
  selectedSeed: string;
  selectedFertilizer: string;
  settings: Settings;
  /** Ostatni dzień, dla którego wykonano rozliczenie dnia. */
  lastDay: number;
}

export interface Calendar {
  day: number;
  dayOfSeason: number;
  season: Season;
  seasonIndex: number;
  year: number;
  hour: number;
  isNight: boolean;
  weather: WeatherId;
}
