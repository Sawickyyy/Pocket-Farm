// Typowany dostęp do danych gry z plików JSON + walidacja odwołań między plikami.
// Dodanie uprawy/zwierzęcia/receptury = edycja JSON-a (i tłumaczeń), bez zmian w kodzie.

import achievementsJson from './data/achievements.json';
import animalsJson from './data/animals.json';
import buildingsJson from './data/buildings.json';
import cropsJson from './data/crops.json';
import festivalsJson from './data/festivals.json';
import fishJson from './data/fish.json';
import forageJson from './data/forage.json';
import itemsJson from './data/items.json';
import npcsJson from './data/npcs.json';
import questsJson from './data/quests.json';
import recipesJson from './data/recipes.json';
import settlementJson from './data/settlement.json';
import skillsJson from './data/skills.json';
import tutorialJson from './data/tutorial.json';
import weatherJson from './data/weather.json';

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];
export type WeatherId = 'sun' | 'cloud' | 'rain' | 'heat' | 'snow';
export type Biome = 'grass' | 'forest' | 'water' | 'sand' | 'meadow' | 'farm' | 'village';

export interface Art {
  shape?: string;
  color?: string;
  leaf?: string;
  wall?: string;
  roof?: string;
  emblem?: string;
  body?: string;
  accent?: string;
  /** Model bryły dla grafiki osady (tent, hut, cottage, townhouse, manor, field, well, plaza, box…). */
  model?: string;
}

export interface CropDef {
  id: string;
  seasons: Season[];
  /** Czas wzrostu w godzinach gry (= minutach rzeczywistych przy 1×). */
  growMin: number;
  seed: number;
  price: number;
  xp: number;
  level: number;
  /** Ile żyzności zabiera zbiór. */
  soil: number;
  /** Rośnie tylko nocą. */
  night: boolean;
  art: Art;
}

export type ItemKind = 'crop' | 'animal' | 'fertilizer' | 'feed' | 'artisan' | 'forage' | 'fish' | 'material';

export interface ItemDef {
  id: string;
  kind: ItemKind;
  price: number;
  /** Cena zakupu w sklepie (jeśli można kupić). */
  buy?: number;
  quality: boolean;
  fertility?: number;
  art: Art;
}

export interface FishDef {
  id: string;
  seasons: Season[];
  time: 'day' | 'night' | 'any';
  weight: number;
  price: number;
  difficulty: number;
  weather?: WeatherId[];
  color: string;
}

export interface AnimalDef {
  id: string;
  price: number;
  home: string;
  level: number;
  feed: string[];
  produceHours: number;
  product: string;
  byproduct: { item: string; chance: number } | null;
  art: Art;
}

export type BuildingKind = 'home' | 'machine' | 'sprinkler' | 'lantern' | 'path' | 'deco' | 'house' | 'work' | 'infra' | 'service' | 'bridge';
export type BuildingCategory = 'housing' | 'road' | 'work' | 'infra' | 'service' | 'farm' | 'deco';

export const PROFESSIONS = ['farmer', 'baker', 'lumberjack', 'fisher', 'merchant', 'builder', 'craftsman', 'teacher', 'medic', 'firefighter', 'guard'] as const;
export type Profession = (typeof PROFESSIONS)[number];

export type ServiceKind = 'police' | 'fire' | 'clinic' | 'school' | 'fun' | 'water' | 'light' | 'market' | 'storage' | 'trade' | 'hall' | 'transport' | 'build';
/** Usługi z mapą pokrycia (promień); pozostałe działają globalnie. */
export const COVERAGE_KINDS = ['police', 'fire', 'clinic', 'school', 'fun', 'water', 'light', 'market'] as const;
export type CoverageKind = (typeof COVERAGE_KINDS)[number];

export interface ItemQty {
  item: string;
  qty: number;
}

export interface ProductionDef {
  inputs: ItemQty[];
  /** `item: "@fish"` = losowa ryba dostępna w danej porze roku. */
  output: ItemQty;
  /** Roboczogodziny na jeden cykl. */
  hours: number;
  /** Wyjście zależne od pory roku (brak wpisu = przestój). */
  seasonal?: Partial<Record<Season, string>>;
  /** Produkuj tylko, gdy w magazynie jest mniej niż `limit` sztuk wyjścia. */
  limit?: number;
}

export interface BuildingDef {
  id: string;
  kind: BuildingKind;
  category?: BuildingCategory;
  size: [number, number];
  cost: number;
  level: number;
  capacity?: number;
  animals?: string[];
  radius?: number;
  light?: { radius: number; color: string; intensity: number };
  festival?: boolean;
  /** Etap osady wymagany do budowy (0..4). */
  tier?: number;
  /** Miejsca w domu. */
  housing?: number;
  /** Komfort mieszkania 0..1. */
  comfort?: number;
  /** Liczba wariantów wyglądu. */
  styles?: number;
  jobs?: { profession: Profession; slots: number };
  production?: ProductionDef;
  /** Receptury maszyn wykonywane automatycznie przez obsadę (pierwsza wykonalna). */
  autoRecipes?: string[];
  service?: { kind: ServiceKind; radius: number; value?: number };
  /** Monety za dzień. */
  upkeep?: number;
  /** Czas budowy w roboczogodzinach (0/brak = od razu). */
  buildHours?: number;
  materials?: ItemQty[];
  terrain?: 'water' | 'shore' | 'forest';
  /** Najwyżej jeden w osadzie. */
  unique?: boolean;
  art: Art;
}

export interface RecipeDef {
  id: string;
  building: string;
  inputs: { item: string; qty: number }[];
  output: { item: string; qty: number };
  /** Minuty gry. */
  minutes: number;
}

export interface NpcDef {
  id: string;
  color: string;
  loves: string[];
  likes: string[];
  orders: string[];
  rewards: { hearts: number; coins?: number; item?: string; qty?: number }[];
}

export type ModifierType =
  | 'growthSpeed'
  | 'soilSaving'
  | 'cropQuality'
  | 'affection'
  | 'hungerSaving'
  | 'productSpeed'
  | 'animalQuality'
  | 'sellBonus'
  | 'marketRecovery'
  | 'queueSlots'
  | 'processSpeed'
  | 'bulkSelling'
  | 'orderBonus';

export interface SkillDef {
  id: string;
  branch: 'farming' | 'husbandry' | 'trade';
  cost: number;
  requires: string[];
  effects: { type: ModifierType; value: number }[];
}

export type QuestEvent = 'harvest' | 'water' | 'sell' | 'feed' | 'craft' | 'fish' | 'forage' | 'order';

export interface QuestDef {
  id: string;
  event: QuestEvent;
  daily: [number, number];
  weekly: [number, number];
  coinsPer: number;
  xpPer: number;
  requires?: 'animals' | 'machines' | 'water' | 'explored';
}

export interface AchievementDef {
  id: string;
  stat: string;
  target: number;
  coins: number;
}

export interface FestivalDef {
  id: string;
  season: Season;
  day: number;
  item: string;
  qty: number;
  coins: number;
  xp: number;
  unlock: string;
  market: string[];
  mult: number;
}

export interface WeatherType {
  dry: number;
  wet: boolean;
  quality: number;
}

export interface ForageDef {
  biome: Biome;
  item: string;
  seasons: Season[];
  weight: number;
}

export interface TutorialStep {
  id: string;
  advance: string;
  value?: string;
  target?: string;
  coins?: number;
}

export type NeedId = 'food' | 'housing' | 'work' | 'safety' | 'fun';
export const NEEDS: readonly NeedId[] = ['food', 'housing', 'work', 'safety', 'fun'];

export interface ProposalTpl {
  id: string;
  kind: 'build' | 'policy' | 'event' | 'grant';
  building?: string;
  when: string;
  value?: number;
  cost?: number;
  days?: number;
  item?: string;
  qty?: number;
}

export interface SettlementContent {
  tiers: { id: string; min: number; territory: number }[];
  startTerritory: number[];
  foreignChunks: number[];
  territoryCost: { base: number; growth: number };
  professions: Record<Profession, { wage: number }>;
  needWeights: Record<NeedId, number>;
  /** Wartość odżywcza jedzenia (pkt). */
  foods: Record<string, number>;
  constants: {
    childDays: number;
    workStart: number;
    workEnd: number;
    mealHours: number[];
    arrivalHour: number;
    wageHour: number;
    salesPerPoint: number;
    baseStorage: number;
    taxDefault: number;
    taxMax: number;
    offroadDistance: number;
    offroadDistanceDepot: number;
    maxRelations: number;
    chronicleMax: number;
    proposalDays: number;
    maxProposals: number;
    voucherDiscount: number;
    voucherDays: number;
    /** Twardy limit populacji (napływ i narodziny). */
    maxPopulation: number;
  };
  names: { given: string[]; family: string[] };
  partners: { id: string; buys: string[]; sells: string[] }[];
  /** Odstęp karawan w dniach wg etapu (0 = brak karawan). */
  caravanInterval: number[];
  events: { fire: number; breakdown: number; epidemic: number; crisis: number; good: number; minDay: number };
  proposals: ProposalTpl[];
  specializations: { id: string; mult: number }[];
}

export interface Content {
  crops: CropDef[];
  crop: Record<string, CropDef>;
  items: Record<string, ItemDef>;
  itemList: ItemDef[];
  fish: FishDef[];
  animals: Record<string, AnimalDef>;
  animalList: AnimalDef[];
  buildings: Record<string, BuildingDef>;
  buildingList: BuildingDef[];
  recipes: Record<string, RecipeDef>;
  recipeList: RecipeDef[];
  npcs: NpcDef[];
  npc: Record<string, NpcDef>;
  skills: SkillDef[];
  skill: Record<string, SkillDef>;
  quests: QuestDef[];
  achievements: AchievementDef[];
  festivals: FestivalDef[];
  weather: { types: Record<WeatherId, WeatherType>; seasons: Record<Season, Partial<Record<WeatherId, number>>> };
  forage: ForageDef[];
  tutorial: TutorialStep[];
  settlement: SettlementContent;
}

const byId = <T extends { id: string }>(list: T[]): Record<string, T> => Object.fromEntries(list.map((x) => [x.id, x]));

function buildContent(): Content {
  const crops = cropsJson as CropDef[];
  const fish = fishJson as FishDef[];
  const itemList: ItemDef[] = [
    ...crops.map((c): ItemDef => ({ id: c.id, kind: 'crop', price: c.price, quality: true, art: c.art })),
    ...(itemsJson as Omit<ItemDef, 'quality'>[]).map((i) => ({ ...i, quality: (i as { quality?: boolean }).quality ?? false })),
    ...fish.map((f): ItemDef => ({ id: f.id, kind: 'fish', price: f.price, quality: true, art: { shape: 'fish', color: f.color } })),
  ];
  const animalList = animalsJson as AnimalDef[];
  const buildingList = buildingsJson as unknown as BuildingDef[];
  const recipeList = recipesJson as RecipeDef[];
  const npcs = npcsJson as NpcDef[];
  const skills = skillsJson as SkillDef[];
  return {
    crops,
    crop: byId(crops),
    items: byId(itemList),
    itemList,
    fish,
    animals: byId(animalList),
    animalList,
    buildings: byId(buildingList),
    buildingList,
    recipes: byId(recipeList),
    recipeList,
    npcs,
    npc: byId(npcs),
    skills,
    skill: byId(skills),
    quests: questsJson as QuestDef[],
    achievements: achievementsJson as AchievementDef[],
    festivals: festivalsJson as FestivalDef[],
    weather: weatherJson as Content['weather'],
    forage: forageJson as ForageDef[],
    tutorial: tutorialJson as TutorialStep[],
    settlement: settlementJson as unknown as SettlementContent,
  };
}

export const CONTENT: Content = buildContent();

/** Zwraca listę błędów spójności danych (pusta = OK). Uruchamiana w testach. */
export function validateContent(c: Content): string[] {
  const errors: string[] = [];
  const item = (id: string, where: string) => {
    if (!c.items[id]) errors.push(`${where}: nieznany przedmiot "${id}"`);
  };
  const ids = new Set<string>();
  for (const i of c.itemList) {
    if (ids.has(i.id)) errors.push(`zduplikowane id przedmiotu "${i.id}"`);
    ids.add(i.id);
  }
  for (const cr of c.crops) {
    if (!cr.seasons.length) errors.push(`uprawa ${cr.id}: brak sezonów`);
    for (const s of cr.seasons) if (!SEASONS.includes(s)) errors.push(`uprawa ${cr.id}: zły sezon ${s}`);
  }
  for (const a of c.animalList) {
    item(a.product, `zwierzę ${a.id}`);
    a.feed.forEach((f) => item(f, `zwierzę ${a.id}.feed`));
    if (a.byproduct) item(a.byproduct.item, `zwierzę ${a.id}.byproduct`);
    if (!c.buildings[a.home]) errors.push(`zwierzę ${a.id}: nieznany budynek ${a.home}`);
  }
  for (const r of c.recipeList) {
    if (c.buildings[r.building]?.kind !== 'machine') errors.push(`receptura ${r.id}: ${r.building} nie jest maszyną`);
    r.inputs.forEach((i) => item(i.item, `receptura ${r.id}`));
    item(r.output.item, `receptura ${r.id}`);
  }
  for (const n of c.npcs) {
    [...n.loves, ...n.likes, ...n.orders].forEach((i) => item(i, `NPC ${n.id}`));
    n.rewards.forEach((r) => r.item && item(r.item, `NPC ${n.id}.rewards`));
  }
  for (const s of c.skills) for (const r of s.requires) if (!c.skill[r]) errors.push(`umiejętność ${s.id}: brak ${r}`);
  for (const f of c.festivals) {
    item(f.item, `festyn ${f.id}`);
    if (!c.buildings[f.unlock]) errors.push(`festyn ${f.id}: brak budynku ${f.unlock}`);
    f.market.forEach((m) => item(m, `festyn ${f.id}.market`));
  }
  for (const f of c.forage) item(f.item, `zbieractwo ${f.biome}`);
  // osada
  const st = c.settlement;
  for (const b of c.buildingList) {
    const where = `budynek ${b.id}`;
    b.materials?.forEach((m) => item(m.item, `${where}.materials`));
    if (b.production) {
      b.production.inputs.forEach((m) => item(m.item, `${where}.production`));
      if (b.production.output.item !== '@fish') item(b.production.output.item, `${where}.production`);
      for (const v of Object.values(b.production.seasonal ?? {})) if (v) item(v, `${where}.seasonal`);
    }
    for (const r of b.autoRecipes ?? []) if (c.recipes[r]?.building !== b.id) errors.push(`${where}: receptura ${r} nie należy do budynku`);
    if (b.jobs && !PROFESSIONS.includes(b.jobs.profession)) errors.push(`${where}: zły zawód ${b.jobs.profession}`);
    if (b.kind === 'house' && !(b.housing && b.housing > 0)) errors.push(`${where}: dom bez miejsc`);
    if (b.tier !== undefined && (b.tier < 0 || b.tier >= st.tiers.length)) errors.push(`${where}: zły etap ${b.tier}`);
  }
  for (const f of Object.keys(st.foods)) item(f, 'osada.foods');
  for (const p of st.partners) [...p.buys, ...p.sells].forEach((i) => item(i, `partner ${p.id}`));
  for (const p of st.proposals) {
    if (p.building && !c.buildings[p.building]) errors.push(`propozycja ${p.id}: brak budynku ${p.building}`);
    if (p.item) item(p.item, `propozycja ${p.id}`);
  }
  for (const pr of PROFESSIONS) if (!st.professions[pr]) errors.push(`osada: brak płacy dla ${pr}`);
  for (let i = 1; i < st.tiers.length; i++) if (st.tiers[i]!.min <= st.tiers[i - 1]!.min) errors.push('osada: etapy nierosnące');
  if (!(st.constants.maxPopulation > 0)) errors.push('osada: maxPopulation musi być dodatnie');
  for (const s of SEASONS) {
    const sum = Object.values(c.weather.seasons[s] ?? {}).reduce((a, b) => a + (b ?? 0), 0);
    if (Math.abs(sum - 1) > 1e-6) errors.push(`pogoda ${s}: prawdopodobieństwa sumują się do ${sum}`);
  }
  return errors;
}

/** Klucz przedmiotu w ekwipunku: "wheat" (zwykła), "wheat*1" (srebrna), "wheat*2" (złota). */
export type Quality = 0 | 1 | 2;
export const itemKey = (id: string, q: Quality = 0): string => (q ? `${id}*${q}` : id);
export function parseKey(key: string): { id: string; q: Quality } {
  const [id = key, q] = key.split('*');
  return { id, q: (q === '1' ? 1 : q === '2' ? 2 : 0) as Quality };
}
export const QUALITY_MULT: Record<Quality, number> = { 0: 1, 1: 1.25, 2: 1.5 };
