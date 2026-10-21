// Wersjonowanie zapisu. Każda migracja podnosi wersję o 1, a normalizeState naprawia brakujące/uszkodzone pola.

import { CONTENT, type Content } from '../content/content';
import { hash32 } from '../core/rng';
import { START_SIM_MS } from '../sim/calendar';
import { NEEDS, type NeedId } from '../content/content';
import { PLOT_COUNT, createInitialState, createPlot, createSettlement, defaultSettings } from '../sim/initialState';
import { CHUNK, CHUNKS_X, MAP_SHIFT_V3 } from '../sim/world';
import {
  SAVE_VERSION,
  TOOL_IDS,
  type ActiveEvent,
  type BudgetDay,
  type Caravan,
  type CropState,
  type GameState,
  type PlacedObject,
  type Plot,
  type Relation,
  type Resident,
  type Settings,
  type Settlement,
  type SiteState,
  type TradeOffer,
} from '../sim/types';

type AnyRecord = Record<string, unknown>;
export type Migration = (data: AnyRecord) => AnyRecord;

export class SaveError extends Error {}

const isObj = (v: unknown): v is AnyRecord => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const int = (v: unknown, fallback: number, min = 0): number => Math.floor(num(v, fallback, min));
const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

/** v1 (MVP): pola z wateredAt/readyAt, stodoła, ulepszenia → v2 (symulacja krokowa). */
function v1ToV2(d: AnyRecord): AnyRecord {
  const UPGRADE_COSTS: Record<string, number[]> = { fertilizer: [50, 150, 400], stall: [80, 240, 600], sprinkler: [250] };
  const upgrades = isObj(d.upgrades) ? d.upgrades : {};
  // Ulepszenia z MVP zastąpiło drzewko umiejętności – zwracamy wydane monety.
  const refund = Object.entries(UPGRADE_COSTS).reduce(
    (sum, [id, costs]) => sum + costs.slice(0, int(upgrades[id], 0)).reduce((a, b) => a + b, 0),
    0,
  );
  const now = Date.now();
  const plots = (Array.isArray(d.plots) ? d.plots : []).map((p): AnyRecord => {
    if (!isObj(p)) return {};
    const c = isObj(p.crop) ? p.crop : null;
    let crop: AnyRecord | null = null;
    if (c && typeof c.id === 'string') {
      const w = typeof c.wateredAt === 'number' ? c.wateredAt : null;
      const r = typeof c.readyAt === 'number' ? c.readyAt : null;
      const growth = w !== null && r !== null && r > w ? Math.min(1, Math.max(0, (now - w) / (r - w))) : 0;
      crop = { id: c.id, growth, wetMs: 0, aliveMs: 0, weatherSum: 0, plantedAt: START_SIM_MS, withered: false };
    }
    return { unlocked: p.unlocked, tilled: p.tilled, moisture: crop && crop.growth ? 1 : 0, fertility: 0.6, crop };
  });
  const stats = isObj(d.stats) ? d.stats : {};
  const settings = isObj(d.settings) ? d.settings : {};
  return {
    version: 2,
    seed: hash32(num(d.createdAt, 1), 0x5eed),
    createdAt: d.createdAt,
    coins: int(d.coins, 0) + refund,
    xp: d.xp,
    skillPoints: Math.max(0, levelFromXp(int(d.xp, 0)) - 1),
    plots,
    seeds: d.seeds,
    inventory: isObj(d.barn) ? d.barn : {},
    stats: { harvested: int(stats.harvested, 0), coinsEarned: int(stats.earned, 0) },
    settings: { sound: settings.sound },
    tool: d.tool,
    selectedSeed: d.selectedSeed,
    // Czas od ostatniej gry w MVP nie jest znany – zaczynamy bez nadrabiania.
    clock: { simMs: START_SIM_MS, lastRealMs: 0, accMs: 0, timeScale: 1 },
    tutorial: { step: 0, done: true },
  };
}

/** v2 → v3: mapa 48×48 → 64×64 (wszystko przesunięte o 8 kafli = 1 fragment), sucha gleba pustych grządek. */
function v2ToV3(d: AnyRecord): AnyRecord {
  const OLD_CHUNKS_X = 6;
  const shift = MAP_SHIFT_V3;
  const k = shift / CHUNK;
  const world = isObj(d.world) ? d.world : {};
  const revealed = Array.isArray(world.revealed)
    ? world.revealed.filter((c): c is number => Number.isInteger(c) && c >= 0 && c < OLD_CHUNKS_X * OLD_CHUNKS_X).map((c) => (c % OLD_CHUNKS_X) + k + (Math.floor(c / OLD_CHUNKS_X) + k) * CHUNKS_X)
    : undefined;
  const objects = Array.isArray(d.objects) ? d.objects.map((o) => (isObj(o) ? { ...o, x: num(o.x, 0) + shift, y: num(o.y, 0) + shift } : o)) : d.objects;
  const plots = Array.isArray(d.plots) ? d.plots.map((p) => (isObj(p) && !isObj(p.crop) ? { ...p, moisture: 0 } : p)) : d.plots;
  // Pozycje zbieractwa zależą od nowej mapy – liczniki odrastania zaczynamy od nowa.
  return { ...d, objects, plots, world: { ...world, ...(revealed ? { revealed } : {}), forage: {}, pendingFish: null } };
}

/** v3 → v4: osada (docs/plan-osada.md). Stan osady uzupełnia normalizeState – stary zapis zaczyna z pustą osadą. */
function v3ToV4(d: AnyRecord): AnyRecord {
  return { ...d };
}

function levelFromXp(xp: number): number {
  let l = 1;
  while (xp >= 5 * (l + 1) * l) l++;
  return l;
}

/** Migracje z wersji N do N+1. */
export const MIGRATIONS: Record<number, Migration> = {
  1: v1ToV2,
  2: v2ToV3,
  3: v3ToV4,
};

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

function normalizeCounts(v: unknown, valid: (key: string) => boolean): Record<string, number> {
  if (!isObj(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) if (valid(k) && int(n, 0) > 0) out[k] = int(n, 0);
  return out;
}

function normalizeCrop(v: unknown, c: Content): CropState | null {
  if (!isObj(v) || typeof v.id !== 'string' || !c.crop[v.id]) return null;
  return {
    id: v.id,
    growth: num(v.growth, 0, 0, 1),
    wetMs: num(v.wetMs, 0, 0),
    aliveMs: num(v.aliveMs, 0, 0),
    weatherSum: num(v.weatherSum, 0, 0),
    plantedAt: num(v.plantedAt, 0, 0),
    withered: v.withered === true,
  };
}

function normalizePlot(v: unknown, def: Plot, c: Content): Plot {
  if (!isObj(v)) return def;
  const unlocked = typeof v.unlocked === 'boolean' ? v.unlocked : def.unlocked;
  const crop = unlocked ? normalizeCrop(v.crop, c) : null;
  return {
    ...createPlot(unlocked),
    tilled: unlocked && (v.tilled === true || crop !== null),
    moisture: num(v.moisture, 0, 0, 1),
    fertility: num(v.fertility, 0.6, 0, 1),
    lastCrop: typeof v.lastCrop === 'string' && c.crop[v.lastCrop] ? v.lastCrop : null,
    streak: int(v.streak, 0),
    crop,
  };
}

const arr = <T>(v: unknown, map: (x: AnyRecord) => T | null): T[] =>
  Array.isArray(v) ? v.filter(isObj).map(map).filter((x): x is T => x !== null) : [];

const strList = (v: unknown, valid: (x: string) => boolean = () => true): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && valid(x)))] : [];

/** Naprawia stan osady: odrzuca odwołania do nieistniejących budynków i mieszkańców (docs/plan-osada.md). */
function normalizeSettlement(v: unknown, objects: PlacedObject[], c: Content): Settlement {
  const base = createSettlement(c);
  if (!isObj(v)) return base;
  const uids = new Set(objects.map((o) => o.uid));
  const ref = (x: unknown): number | null => (Number.isInteger(x) && uids.has(x as number) ? (x as number) : null);
  const clamp01 = (x: unknown, f: number) => num(x, f, 0, 1);
  const residents = arr(v.residents, (r): Resident | null => {
    if (!Number.isInteger(r.id)) return null;
    const needsSrc = isObj(r.needs) ? r.needs : {};
    const needs = Object.fromEntries(NEEDS.map((n) => [n, clamp01(needsSrc[n], 0.6)])) as Record<NeedId, number>;
    const meals = isObj(r.meals) ? r.meals : {};
    const mood = isObj(r.mood) ? r.mood : {};
    return {
      id: r.id as number,
      name: str(r.name, '?').slice(0, 40),
      family: int(r.family, 0),
      child: r.child === true,
      bornDay: int(r.bornDay, 0, -1),
      home: ref(r.home),
      job: ref(r.job),
      needs,
      happiness: clamp01(r.happiness, 0.6),
      sadDays: int(r.sadDays, 0),
      homelessDays: int(r.homelessDays, 0),
      arrivedDay: int(r.arrivedDay, 0, -1),
      look: int(r.look, 0) % 8,
      meals: { eaten: num(meals.eaten, 0, 0), due: num(meals.due, 0, 0), kinds: strList(meals.kinds, (k) => !!c.items[k]).slice(0, 12) },
      mood: { value: num(mood.value, 0, -1, 1), untilDay: int(mood.untilDay, -1, -1) },
    };
  });
  const ids = new Set(residents.map((r) => r.id));
  const relations = arr(v.relations, (r): Relation | null => {
    const a = int(r.a, -1, -1);
    const b = int(r.b, -1, -1);
    if (!ids.has(a) || !ids.has(b) || a >= b) return null;
    const kind = (['friend', 'love', 'partner', 'conflict'] as const).find((k) => k === r.kind);
    return kind ? { a, b, kind, v: num(r.v, 0, 0, 5) } : null;
  });
  const sites: Record<string, SiteState> = {};
  if (isObj(v.sites)) {
    for (const [k, site] of Object.entries(v.sites)) {
      if (!uids.has(Number(k)) || !isObj(site)) continue;
      sites[k] = {
        built: clamp01(site.built, 1),
        damage: clamp01(site.damage, 0),
        fire: num(site.fire, 0, 0, 48),
        broken: site.broken === true,
        progress: clamp01(site.progress, 0),
        repair: clamp01(site.repair, 0),
      };
    }
  }
  const offer = (o: AnyRecord): TradeOffer | null =>
    typeof o.item === 'string' && c.items[o.item] ? { item: o.item, price: int(o.price, 1, 1), qty: int(o.qty, 0) } : null;
  const caravanSrc = isObj(v.caravan) ? v.caravan : null;
  const caravan: Caravan | null =
    caravanSrc && typeof caravanSrc.from === 'string'
      ? { from: caravanSrc.from, leavesAt: num(caravanSrc.leavesAt, 0, 0), buys: arr(caravanSrc.buys, offer), sells: arr(caravanSrc.sells, offer) }
      : null;
  const budgetDay = (b: AnyRecord): BudgetDay | null =>
    Number.isInteger(b.day)
      ? {
          day: b.day as number,
          taxes: num(b.taxes, 0),
          sales: num(b.sales, 0),
          exports: num(b.exports, 0),
          wages: num(b.wages, 0),
          upkeep: num(b.upkeep, 0),
          imports: num(b.imports, 0),
          investments: num(b.investments, 0),
        }
      : null;
  const event = (e: AnyRecord): ActiveEvent | null => {
    const kind = (['fire', 'breakdown', 'epidemic', 'crisis', 'festival', 'harvest', 'richCaravan'] as const).find((k) => k === e.kind);
    if (!kind) return null;
    const out: ActiveEvent = { id: int(e.id, 0), kind, untilMs: num(e.untilMs, 0, 0) };
    const target = ref(e.target);
    if (target !== null) out.target = target;
    return out;
  };
  const vouchers: Settlement['vouchers'] = {};
  if (isObj(v.vouchers)) {
    for (const [k, x] of Object.entries(v.vouchers)) {
      if (c.buildings[k] && isObj(x)) vouchers[k] = { discount: num(x.discount, 0, 0, 0.9), untilDay: int(x.untilDay, -1, -1) };
    }
  }
  const stats = isObj(v.stats) ? v.stats : {};
  const territory = [...new Set([...base.territory, ...(Array.isArray(v.territory) ? v.territory.filter((x): x is number => Number.isInteger(x) && x >= 0 && x < CHUNKS_X * CHUNKS_X) : [])])];
  const maxId = Math.max(0, ...residents.map((r) => r.id), ...residents.map((r) => r.family));
  return {
    name: str(v.name, '').slice(0, 24),
    territory,
    bought: int(v.bought, 0),
    residents,
    nextId: Math.max(int(v.nextId, 1, 1), maxId + 1),
    relations,
    sites,
    taxRate: num(v.taxRate, base.taxRate, 0, c.settlement.constants.taxMax),
    reserved: strList(v.reserved, (k) => !!c.items[k]),
    autoExport: strList(v.autoExport, (k) => !!c.items[k]),
    budget: arr(v.budget, budgetDay).slice(0, 7),
    proposals: arr(v.proposals, (p) =>
      typeof p.tpl === 'string' && c.settlement.proposals.some((t) => t.id === p.tpl)
        ? { id: int(p.id, 0), tpl: p.tpl, support: int(p.support, 0), cost: int(p.cost, 0), expiresDay: int(p.expiresDay, 0) }
        : null,
    ),
    vouchers,
    events: arr(v.events, event),
    chronicle: arr(v.chronicle, (e) =>
      typeof e.kind === 'string'
        ? {
            day: int(e.day, 0),
            hour: int(e.hour, 0),
            kind: e.kind,
            ...(isObj(e.params)
              ? { params: Object.fromEntries(Object.entries(e.params).filter(([, x]) => typeof x === 'string' || typeof x === 'number')) as Record<string, string | number> }
              : {}),
          }
        : null,
    ).slice(0, c.settlement.constants.chronicleMax),
    caravan,
    nextCaravanDay: int(v.nextCaravanDay, -1, -1),
    caravanBonus: num(v.caravanBonus, 1, 1, 2),
    specialization: typeof v.specialization === 'string' && c.settlement.specializations.some((x) => x.id === v.specialization) ? v.specialization : null,
    peakTier: int(v.peakTier, 0) % c.settlement.tiers.length,
    foundedDay: int(v.foundedDay, -1, -1),
    stats: { arrived: int(stats.arrived, 0), left: int(stats.left, 0), born: int(stats.born, 0), weddings: int(stats.weddings, 0) },
  };
}

/** Zamienia dowolne (już zmigrowane) dane na poprawny GameState – uszkodzony import nie zepsuje gry. */
export function normalizeState(d: AnyRecord, now: number, c: Content = CONTENT): GameState {
  const seed = int(d.seed, 0) || hash32(now, 0x5eed);
  const base = createInitialState(now, seed, c);
  const isItemKey = (k: string) => !!c.items[k.split('*')[0] ?? ''];
  const plotsSrc = Array.isArray(d.plots) ? d.plots : [];
  const clock = isObj(d.clock) ? d.clock : {};
  const world = isObj(d.world) ? d.world : {};
  const market = isObj(d.market) ? d.market : {};
  const settingsSrc = isObj(d.settings) ? d.settings : {};
  const def = defaultSettings();
  const settings: Settings = {
    sound: typeof settingsSrc.sound === 'boolean' ? settingsSrc.sound : def.sound,
    music: typeof settingsSrc.music === 'boolean' ? settingsSrc.music : def.music,
    captions: settingsSrc.captions === true,
    language: settingsSrc.language === 'en' ? 'en' : 'pl',
    colorblind: (['none', 'protan', 'deutan', 'tritan'] as const).find((x) => x === settingsSrc.colorblind) ?? 'none',
    uiScale: num(settingsSrc.uiScale, 1, 0.8, 1.6),
    reducedMotion: (['auto', 'on', 'off'] as const).find((x) => x === settingsSrc.reducedMotion) ?? 'auto',
    fx: typeof settingsSrc.fx === 'boolean' ? settingsSrc.fx : true,
    dof: settingsSrc.dof === true,
  };
  const quests = isObj(d.quests) ? d.quests : {};
  const quest = (q: AnyRecord) =>
    typeof q.tpl === 'string' ? { id: int(q.id, 0), tpl: q.tpl, target: int(q.target, 1, 1), progress: int(q.progress, 0), claimed: q.claimed === true } : null;
  const objectTypes = new Set(Object.keys(c.buildings));
  const objects = arr(d.objects, (o): PlacedObject | null => {
    if (typeof o.type !== 'string' || !objectTypes.has(o.type)) return null;
    const out: PlacedObject = { uid: int(o.uid, 0), type: o.type, x: int(o.x, 0), y: int(o.y, 0) };
    const styles = c.buildings[o.type]?.styles ?? 1;
    if (styles > 1) out.style = int(o.style, 0) % styles;
    return out;
  });
  const tutorial = isObj(d.tutorial) ? d.tutorial : {};

  const state: GameState = {
    ...base,
    version: SAVE_VERSION,
    rng: int(d.rng, base.rng) >>> 0,
    createdAt: num(d.createdAt, now),
    clock: {
      simMs: num(clock.simMs, base.clock.simMs, 0),
      lastRealMs: num(clock.lastRealMs, 0, 0),
      accMs: num(clock.accMs, 0, 0),
      timeScale: num(clock.timeScale, 1, 0, 1000),
    },
    coins: int(d.coins, base.coins),
    xp: int(d.xp, 0),
    skillPoints: int(d.skillPoints, 0),
    skills: Array.isArray(d.skills) ? d.skills.filter((x): x is string => typeof x === 'string' && !!c.skill[x]) : [],
    plots: base.plots.map((p, i) => normalizePlot(plotsSrc[i], p, c)),
    seeds: isObj(d.seeds) ? normalizeCounts(d.seeds, (k) => !!c.crop[k]) : base.seeds,
    inventory: normalizeCounts(d.inventory, isItemKey),
    objects,
    nextUid: Math.max(int(d.nextUid, 1, 1), ...objects.map((o) => o.uid + 1), 1),
    animals: arr(d.animals, (a) =>
      typeof a.kind === 'string' && c.animals[a.kind]
        ? {
            id: int(a.id, 0),
            kind: a.kind,
            name: str(a.name, 'Mila'),
            home: int(a.home, 0),
            hunger: num(a.hunger, 0.5, 0, 1),
            affection: num(a.affection, 0.2, 0, 1),
            progress: num(a.progress, 0, 0, 1),
            ready: a.ready === true,
            pettedDay: int(a.pettedDay, -1, -1),
          }
        : null,
    ).filter((a) => objects.some((o) => o.uid === a.home)),
    machines: isObj(d.machines)
      ? Object.fromEntries(
          Object.entries(d.machines)
            .filter(([k]) => objects.some((o) => String(o.uid) === k))
            .map(([k, m]) => [
              k,
              {
                queue: arr(isObj(m) ? m.queue : [], (j) =>
                  typeof j.recipe === 'string' && c.recipes[j.recipe] ? { recipe: j.recipe, remainingMs: num(j.remainingMs, 0, 0) } : null,
                ),
                output: normalizeCounts(isObj(m) ? m.output : {}, isItemKey),
              },
            ]),
        )
      : {},
    market: {
      sat: isObj(market.sat) ? Object.fromEntries(Object.entries(market.sat).map(([k, v]) => [k, num(v, 0, 0)])) : {},
      demand: isObj(market.demand) ? Object.fromEntries(Object.entries(market.demand).map(([k, v]) => [k, num(v, 1, 0.1, 5)])) : {},
    },
    npcs: Object.fromEntries(
      c.npcs.map((n) => {
        const src = isObj(d.npcs) && isObj(d.npcs[n.id]) ? (d.npcs[n.id] as AnyRecord) : {};
        return [
          n.id,
          {
            friendship: num(src.friendship, 0, 0, 1000),
            giftDay: int(src.giftDay, -1, -1),
            rewards: Array.isArray(src.rewards) ? src.rewards.filter((x): x is number => typeof x === 'number') : [],
          },
        ];
      }),
    ),
    orders: arr(d.orders, (o) =>
      typeof o.npc === 'string' && typeof o.item === 'string' && c.npc[o.npc] && c.items[o.item]
        ? { id: int(o.id, 0), npc: o.npc, item: o.item, qty: int(o.qty, 1, 1), coins: int(o.coins, 0), xp: int(o.xp, 0), expiresDay: int(o.expiresDay, 0) }
        : null,
    ),
    quests: { daily: arr(quests.daily, quest), weekly: arr(quests.weekly, quest) },
    achievements: normalizeCounts(d.achievements, (k) => c.achievements.some((a) => a.id === k)),
    stats: normalizeCounts(d.stats, () => true),
    festivalsDone: Array.isArray(d.festivalsDone) ? d.festivalsDone.filter((x): x is string => typeof x === 'string') : [],
    unlocks: Array.isArray(d.unlocks) ? d.unlocks.filter((x): x is string => typeof x === 'string' && !!c.buildings[x]) : [],
    world: {
      revealed: Array.isArray(world.revealed)
        ? [...new Set([...base.world.revealed, ...world.revealed.filter((x): x is number => Number.isInteger(x))])]
        : base.world.revealed,
      forage: isObj(world.forage) ? Object.fromEntries(Object.entries(world.forage).map(([k, v]) => [k, int(v, 0)])) : {},
      pendingFish: null,
    },
    tutorial: { step: int(tutorial.step, 0), done: typeof tutorial.done === 'boolean' ? tutorial.done : base.tutorial.done },
    settlement: normalizeSettlement(d.settlement, objects, c),
    tool: TOOL_IDS.find((t) => t === d.tool) ?? base.tool,
    selectedSeed: typeof d.selectedSeed === 'string' && c.crop[d.selectedSeed] ? d.selectedSeed : base.selectedSeed,
    selectedFertilizer:
      typeof d.selectedFertilizer === 'string' && c.items[d.selectedFertilizer]?.kind === 'fertilizer' ? d.selectedFertilizer : base.selectedFertilizer,
    settings,
    lastDay: int(d.lastDay, -1, -1),
  };
  // Zapis z innej liczby pól: dopasuj (stała siatka 6×8).
  if (state.plots.length !== PLOT_COUNT) throw new SaveError('Nieprawidłowa liczba pól.');
  return state;
}

export function loadFromUnknown(data: unknown, now: number): GameState {
  if (!isObj(data)) throw new SaveError('Zapis nie jest obiektem.');
  return normalizeState(migrate(data), now);
}
