// Model stanu gry (wersja 4). Stan jest zwykłym JSON-em: klonuje się go przez postMessage i zapisuje w IndexedDB.

import type { NeedId, Season, WeatherId } from '../content/content';

export const SAVE_VERSION = 4;

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
  /** Wariant wyglądu (domy osady). */
  style?: number;
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

// ---------------------------------------------------------------- osada (docs/plan-osada.md)

export interface Resident {
  id: number;
  name: string;
  /** Wspólne id rodziny (rodzice + dzieci). */
  family: number;
  child: boolean;
  bornDay: number;
  /** uid domu albo null (bezdomny). */
  home: number | null;
  /** uid miejsca pracy albo null. */
  job: number | null;
  needs: Record<NeedId, number>;
  happiness: number;
  /** Kolejne doby ze szczęściem < 0,25. */
  sadDays: number;
  homelessDays: number;
  arrivedDay: number;
  /** Wariant wyglądu postaci (0..7). */
  look: number;
  /** Posiłki z ostatniej doby: zjedzone / należne (do potrzeby jedzenia). */
  meals: { eaten: number; due: number; kinds: string[] };
  /** Chwilowy modyfikator szczęścia (rada, strajk) i dzień jego wygaśnięcia. */
  mood: { value: number; untilDay: number };
}

export type RelationKind = 'friend' | 'love' | 'partner' | 'conflict';

export interface Relation {
  /** a < b (id mieszkańców). */
  a: number;
  b: number;
  kind: RelationKind;
  v: number;
}

/** Stan budynku osady: budowa, uszkodzenia, pożar, awaria, postęp produkcji. */
export interface SiteState {
  /** Postęp budowy 0..1 (1 = gotowy). */
  built: number;
  /** Uszkodzenia 0..1 (≥ 0,5 = nie działa). */
  damage: number;
  /** Godziny trwającego pożaru (0 = brak). */
  fire: number;
  broken: boolean;
  /** Postęp bieżącego cyklu produkcji (0..1). */
  progress: number;
  /** Postęp naprawy (0..1). */
  repair: number;
}

export interface TradeOffer {
  item: string;
  price: number;
  qty: number;
}

export interface Caravan {
  from: string;
  /** Czas odjazdu (simMs). */
  leavesAt: number;
  buys: TradeOffer[];
  sells: TradeOffer[];
}

export interface Proposal {
  id: number;
  tpl: string;
  /** Liczba popierających mieszkańców. */
  support: number;
  /** Koszt zatwierdzenia (monety); 0 dla bonu na budowę. */
  cost: number;
  expiresDay: number;
}

export type SettlementEventKind = 'fire' | 'breakdown' | 'epidemic' | 'crisis' | 'festival' | 'harvest' | 'richCaravan';

export interface ActiveEvent {
  id: number;
  kind: SettlementEventKind;
  /** uid budynku (pożar, awaria, epidemia). */
  target?: number;
  /** Koniec (simMs). */
  untilMs: number;
}

export interface ChronicleEntry {
  day: number;
  hour: number;
  kind: string;
  params?: Record<string, string | number>;
}

export interface BudgetDay {
  day: number;
  taxes: number;
  sales: number;
  exports: number;
  wages: number;
  upkeep: number;
  imports: number;
  investments: number;
}

export interface Settlement {
  name: string;
  territory: number[];
  /** Ile fragmentów kupiono (do ceny). */
  bought: number;
  residents: Resident[];
  /** Licznik id mieszkańców, rodzin, propozycji, wydarzeń. */
  nextId: number;
  relations: Relation[];
  /** Klucz = uid budynku. */
  sites: Record<string, SiteState>;
  taxRate: number;
  /** Przedmioty, których mieszkańcy nie jedzą, a karawany nie kupują automatycznie. */
  reserved: string[];
  autoExport: string[];
  /** budget[0] = dzień bieżący, max 7 dni. */
  budget: BudgetDay[];
  proposals: Proposal[];
  /** Bony rady: typ budynku → zniżka i dzień wygaśnięcia. */
  vouchers: Record<string, { discount: number; untilDay: number }>;
  events: ActiveEvent[];
  chronicle: ChronicleEntry[];
  caravan: Caravan | null;
  nextCaravanDay: number;
  /** Mnożnik ceny następnej karawany (bogata karawana). */
  caravanBonus: number;
  specialization: string | null;
  peakTier: number;
  /** Dzień założenia (pierwszy mieszkaniec) albo -1. */
  foundedDay: number;
  stats: { arrived: number; left: number; born: number; weddings: number };
}

export interface Settings {
  sound: boolean;
  music: boolean;
  captions: boolean;
  language: 'pl' | 'en';
  colorblind: 'none' | 'protan' | 'deutan' | 'tritan';
  uiScale: number;
  reducedMotion: 'auto' | 'on' | 'off';
  /** Efekty bajkowe (korekcja kolorów, winieta, magia w świecie). */
  fx: boolean;
  /** Głębia ostrości (tilt-shift) – opcjonalna, kosztowniejsza dla GPU. */
  dof: boolean;
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
  settlement: Settlement;
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
