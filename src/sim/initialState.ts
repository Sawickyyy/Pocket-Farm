import { CONTENT, type Content } from '../content/content';
import { hash32 } from '../core/rng';
import { START_SIM_MS } from './calendar';
import { SAVE_VERSION, type GameState, type Plot, type Settings, type Settlement } from './types';
import { FIELD, START_CHUNKS } from './world';

export const PLOT_COUNT = FIELD.w * FIELD.h;

/** Pola odblokowane na starcie: kolumny 2–3, wiersze 3–5 pola uprawnego. */
export const START_UNLOCKED: readonly number[] = [3, 4, 5].flatMap((row) => [2, 3].map((col) => row * FIELD.w + col));

export function defaultSettings(language: Settings['language'] = 'pl'): Settings {
  return { sound: true, music: true, captions: false, language, colorblind: 'none', uiScale: 1, reducedMotion: 'auto', fx: true, dof: false };
}

export function createPlot(unlocked: boolean): Plot {
  return { unlocked, tilled: false, moisture: 0, fertility: 0.6, lastCrop: null, streak: 0, crop: null };
}

export function createSettlement(c: Content = CONTENT): Settlement {
  return {
    name: '',
    territory: [...c.settlement.startTerritory],
    bought: 0,
    residents: [],
    nextId: 1,
    relations: [],
    sites: {},
    taxRate: c.settlement.constants.taxDefault,
    reserved: [],
    autoExport: [],
    budget: [],
    proposals: [],
    vouchers: {},
    events: [],
    chronicle: [],
    caravan: null,
    nextCaravanDay: -1,
    caravanBonus: 1,
    specialization: null,
    peakTier: 0,
    foundedDay: -1,
    stats: { arrived: 0, left: 0, born: 0, weddings: 0 },
  };
}

export function createInitialState(now: number, seed = hash32(now, 0x5eed), c: Content = CONTENT): GameState {
  return {
    version: SAVE_VERSION,
    seed,
    rng: hash32(seed, 1),
    createdAt: now,
    clock: { simMs: START_SIM_MS, lastRealMs: now, accMs: 0, timeScale: 1 },
    coins: 30,
    xp: 0,
    skillPoints: 0,
    skills: [],
    plots: Array.from({ length: PLOT_COUNT }, (_, i) => createPlot(START_UNLOCKED.includes(i))),
    seeds: { radish: 4 },
    inventory: {},
    objects: [],
    nextUid: 1,
    animals: [],
    machines: {},
    market: { sat: {}, demand: {} },
    npcs: Object.fromEntries(c.npcs.map((n) => [n.id, { friendship: 0, giftDay: -1, rewards: [] }])),
    orders: [],
    quests: { daily: [], weekly: [] },
    achievements: {},
    stats: {},
    festivalsDone: [],
    unlocks: [],
    world: { revealed: [...START_CHUNKS], forage: {}, pendingFish: null },
    tutorial: { step: 0, done: false },
    settlement: createSettlement(c),
    tool: 'hoe',
    selectedSeed: 'radish',
    selectedFertilizer: 'compost',
    settings: defaultSettings(),
    lastDay: -1,
  };
}
