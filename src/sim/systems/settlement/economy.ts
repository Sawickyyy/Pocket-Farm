// Gospodarka osady (docs/plan-osada.md §6, §8): produkcja budynków i maszyn z obsadą (z magazynu do magazynu),
// płace, podatki, utrzymanie i dzienne rozliczenie budżetu. Magazyn = ekwipunek gracza, skarbiec = `s.coins`
// (nigdy ujemny – brak monet na płace to strajk).

import type { BuildingDef, Content, FishDef, ItemQty, ProductionDef, RecipeDef, Season } from '../../../content/content';
import { weightedIndex } from '../../../core/rng';
import type { CommandResult } from '../../commands';
import { OK, addItem, consumeItem, countItem, fail, rand, stat, type Ctx } from '../../ctx';
import type { GameState, PlacedObject, Resident } from '../../types';
import { availableFish } from '../exploration';
import {
  addBudget,
  budgetNet,
  centerOf,
  chronicle,
  ensureSite,
  isBuilt,
  isFoodKey,
  isOperational,
  isWorkHour,
  objectByUid,
  productivity,
  professionOf,
  specMult,
  storageCap,
  storageFull,
  storageUsed,
  wageOf,
  workersAt,
} from './common';

/** Wyjście produkcji oznaczające losową rybę dostępną w porze roku/pogodzie (rybaczówka). */
export const FISH_OUTPUT = '@fish';
/** Budynki żywności (specjalizacja `agri`) i rzemiosła (`craft`) – §14. */
export const AGRI_BUILDINGS: readonly string[] = ['allotment', 'grainfield', 'fishery', 'mill', 'bakery', 'dairy', 'preserves'];
export const CRAFT_BUILDINGS: readonly string[] = ['sawmill', 'workshop', 'loom'];
/** Tempo maszyny z obsadą: 0,4 + 0,3 × moc pracowników (2 osoby ≈ tempo gracza). */
export const MACHINE_BASE_RATE = 0.4;
export const MACHINE_WORKER_RATE = 0.3;
/** Podstawa podatku doliczana do płacy (bezrobotny płaci tylko od niej). */
export const TAX_BASE = 10;
/** Strajk: chwilowa zmiana szczęścia pracowników przy niewypłaconych płacach (do końca następnej doby). */
export const UNPAID_MOOD = -0.15;
/** Wyroby osady nasycają rynek farmy: +0,5 nasycenia na sztukę (masowa sprzedaż szybko tanieje). */
export const PRODUCTION_SAT = 0.5;

export type ProductionBlock = 'inputs' | 'storage' | 'season' | 'staff';

export interface ProductionInfo {
  /** Bieżące wyjście (id przedmiotu, `@fish` albo null – przestój sezonowy / brak produkcji). */
  item: string | null;
  /** Szacunek sztuk na dobę przy obecnej obsadzie i godzinach pracy (10 h). */
  perDay: number;
  /** Powód przestoju (null = pracuje albo stan budynku pokazuje UI osobno). */
  blocked: ProductionBlock | null;
}

// ---------------------------------------------------------------- zapytania (symulacja + UI)

/** Specjalizacja obejmująca budynek danego typu (null = żadna). */
export function specAreaOf(type: string): 'agri' | 'craft' | null {
  if (AGRI_BUILDINGS.includes(type)) return 'agri';
  if (CRAFT_BUILDINGS.includes(type)) return 'craft';
  return null;
}

/** Czy budynek produkuje sam: `production` albo maszyna z obsadą (`jobs` + `autoRecipes`). */
export function isProducer(def: BuildingDef): boolean {
  return !!def.production || (def.kind === 'machine' && !!def.jobs && !!def.autoRecipes?.length);
}

/** Moc pracowników budynku: Σ wydajność × specjalizacja (0 bez pracowników). */
export function workPower(s: GameState, c: Content, type: string, workers: readonly Resident[]): number {
  if (!workers.length) return 0;
  let sum = 0;
  for (const r of workers) sum += productivity(s, c, r);
  const area = specAreaOf(type);
  return area ? sum * specMult(s, c, area) : sum;
}

/** Tempo maszyny z obsadą (0 bez pracowników). */
export const machineRate = (power: number): number => (power > 0 ? MACHINE_BASE_RATE + MACHINE_WORKER_RATE * power : 0);

/** Wyjście produkcji w danej porze roku: id przedmiotu, `@fish` albo null (brak wpisu sezonowego = przestój). */
export function outputOf(prod: ProductionDef, season: Season): string | null {
  return prod.seasonal ? (prod.seasonal[season] ?? null) : prod.output.item;
}

const hasInputs = (s: GameState, inputs: readonly ItemQty[]): boolean => inputs.every((i) => countItem(s, i.item) >= i.qty);

/** Receptury maszyny wykonywane przez obsadę (w kolejności z danych). */
export function autoRecipesOf(c: Content, def: BuildingDef): RecipeDef[] {
  const out: RecipeDef[] = [];
  for (const id of def.autoRecipes ?? []) {
    const r = c.recipes[id];
    if (r) out.push(r);
  }
  return out;
}

/** Pierwsza receptura z listy, której wejścia są w magazynie (null = przestój). */
export function autoRecipe(s: GameState, c: Content, def: BuildingDef): RecipeDef | null {
  return autoRecipesOf(c, def).find((r) => hasInputs(s, r.inputs)) ?? null;
}

const recipeHours = (r: RecipeDef): number => Math.max(1, r.minutes) / 60;
const workHours = (c: Content): number => c.settlement.constants.workEnd - c.settlement.constants.workStart;

type FishPool = { list: FishDef[]; weights: number[] } | null;

/** Ryby do losowania o tej porze (null = żadna nie bierze). */
function fishPool(ctx: Ctx): FishPool {
  const list = availableFish(ctx);
  const weights = list.map((f) => Math.max(0, f.weight));
  return weights.some((w) => w > 0) ? { list, weights } : null;
}

/** Zatrudnieni z płacą zawodu (pracownicy budynków z etatami). */
function payroll(s: GameState, c: Content): { r: Resident; wage: number }[] {
  const out: { r: Resident; wage: number }[] = [];
  for (const r of s.settlement.residents) {
    const p = professionOf(s, c, r);
    if (p) out.push({ r, wage: wageOf(c, p) });
  }
  return out;
}

/** Suma płac na dobę (wypłacana o `wageHour`). */
export function dailyWages(s: GameState, c: Content): number {
  let sum = 0;
  for (const p of payroll(s, c)) sum += p.wage;
  return sum;
}

/**
 * Stawka podatku do rozliczenia: średnia z godzin bieżącej doby (`settlement.taxAcc`, próbka co godzinę gry),
 * a przed pierwszą próbką – bieżąca stawka. Zmiana suwaka tuż przed północą nie zmienia podatku z całej doby.
 */
export function effectiveTaxRate(s: GameState): number {
  const acc = s.settlement.taxAcc;
  return acc && acc.hours > 0 ? acc.sum / acc.hours : s.settlement.taxRate;
}

/**
 * Podatki pobierane na nowy dzień: dorosły `stawka × (płaca + 10)`, bezrobotny `stawka × 10` (zaokrąglone).
 * Domyślnie średnia stawka z doby; `rate` – podgląd innej stawki (suwak w UI).
 */
export function dailyTaxes(s: GameState, c: Content, rate = effectiveTaxRate(s)): number {
  if (!(rate > 0)) return 0;
  let sum = 0;
  for (const r of s.settlement.residents) {
    if (r.child) continue;
    const p = professionOf(s, c, r);
    sum += rate * ((p ? wageOf(c, p) : 0) + TAX_BASE);
  }
  return Math.round(sum);
}

/** Utrzymanie ukończonych budynków na dobę; maszyny farmy (`machine`) płacą tylko z obsadą (pracownicy osady). */
export function dailyUpkeep(s: GameState, c: Content): number {
  let staffed: Set<number> | undefined;
  let sum = 0;
  for (const o of s.objects) {
    const def = c.buildings[o.type];
    const upkeep = def?.upkeep ?? 0;
    if (!def || upkeep <= 0 || !isBuilt(s, o.uid)) continue;
    if (def.kind === 'machine') {
      staffed ??= new Set(s.settlement.residents.map((r) => r.job).filter((j): j is number => j !== null));
      if (!staffed.has(o.uid)) continue;
    }
    sum += upkeep;
  }
  return sum;
}

/** Stan produkcji budynku dla panelu: co robi, ile na dobę i dlaczego stoi. */
export function productionInfo(ctx: Ctx, uid: number): ProductionInfo {
  const { s, c } = ctx;
  const o = objectByUid(s, uid);
  const def = o && c.buildings[o.type];
  if (!o || !def || !isProducer(def)) return { item: null, perDay: 0, blocked: null };
  const workers = workersAt(s, uid);
  // Budowa, awaria, pożar, uszkodzenie: nic nie powstaje (stan budynku UI pokazuje osobno).
  const power = isOperational(s, uid) ? workPower(s, c, o.type, workers) : 0;
  const full = storageFull(s, c);
  if (def.production) {
    const prod = def.production;
    const item = outputOf(prod, ctx.cal.season);
    if (item === null || (item === FISH_OUTPUT && !fishPool(ctx))) return { item, perDay: 0, blocked: 'season' };
    const perDay = ((power * workHours(c)) / Math.max(prod.hours, 1e-9)) * prod.output.qty;
    const limited = prod.limit !== undefined && countItem(s, item) >= prod.limit;
    const blocked: ProductionBlock | null = !workers.length
      ? 'staff'
      : (full && item !== FISH_OUTPUT && !isFoodKey(c, item)) || limited
        ? 'storage'
        : !hasInputs(s, prod.inputs)
          ? 'inputs'
          : null;
    return { item, perDay, blocked };
  }
  const recipes = autoRecipesOf(c, def);
  const recipe = recipes.find((r) => hasInputs(s, r.inputs)) ?? null;
  const shown = recipe ?? recipes[0] ?? null;
  // Najwyżej jeden cykl na godzinę.
  const perDay = shown ? Math.min(1, machineRate(power) / recipeHours(shown)) * workHours(c) * shown.output.qty : 0;
  const foodOut = !!shown && isFoodKey(c, shown.output.item);
  const blocked: ProductionBlock | null = !workers.length ? 'staff' : full && !foodOut ? 'storage' : !recipe ? 'inputs' : null;
  return { item: shown?.output.item ?? null, perDay, blocked };
}

// ---------------------------------------------------------------- produkcja (co godzinę pracy)

/** Wolne miejsce w magazynie w trakcie godziny (liczone raz, potem aktualizowane o zużycie i wyroby). */
interface Store {
  room: number;
}

/** Wyrób osady: zdarzenie, statystyka i nasycenie rynku farmy (`qty × 0,5`). */
function produced(ctx: Ctx, o: PlacedObject, item: string, qty: number): void {
  const sat = ctx.s.market.sat;
  sat[item] = (sat[item] ?? 0) + qty * PRODUCTION_SAT;
  ctx.bus.emit({ type: 'produced', uid: o.uid, item, qty, at: centerOf(ctx.c, o) });
  stat(ctx, 'produced', qty);
}

/** Zmiana zajętości magazynu po cyklu: wyroby minus zużyte surowce (jedzenie się nie liczy). */
function roomUsed(c: Content, out: string, qty: number, inputs: readonly ItemQty[]): number {
  let n = isFoodKey(c, out) ? 0 : qty;
  for (const i of inputs) if (!isFoodKey(c, i.item)) n -= i.qty;
  return n;
}

function runProduction(ctx: Ctx, o: PlacedObject, prod: ProductionDef, power: number, store: Store, fish: () => FishPool): void {
  const { s } = ctx;
  const item = outputOf(prod, ctx.cal.season);
  if (item === null) return; // np. pole osady zimą
  const isFish = item === FISH_OUTPUT;
  if (isFish && !fish()) return; // żadna ryba nie bierze
  // Jedzenie (także ryby) idzie do spiżarni – pełny magazyn go nie wstrzymuje.
  const food = isFish || isFoodKey(ctx.c, item);
  const site = ensureSite(s, o.uid);
  site.progress += power / Math.max(prod.hours, 1e-9);
  while (site.progress >= 1) {
    const limited = prod.limit !== undefined && countItem(s, item) >= prod.limit;
    if ((!food && store.room <= 0) || limited || !hasInputs(s, prod.inputs)) {
      site.progress = Math.min(site.progress, 1); // czeka z gotowym cyklem
      return;
    }
    let out = item;
    if (isFish) {
      const pool = fish()!;
      const f = pool.list[weightedIndex(pool.weights, rand(s))];
      if (!f) {
        site.progress = Math.min(site.progress, 1);
        return;
      }
      out = f.id;
    }
    for (const i of prod.inputs) consumeItem(s, i.item, i.qty);
    addItem(s, out, prod.output.qty);
    store.room -= roomUsed(ctx.c, out, prod.output.qty, prod.inputs);
    site.progress -= 1;
    produced(ctx, o, out, prod.output.qty);
  }
}

function runMachine(ctx: Ctx, o: PlacedObject, def: BuildingDef, power: number, store: Store): void {
  const { s, c } = ctx;
  const recipe = autoRecipe(s, c, def);
  if (!recipe) return; // brak surowców – przestój bez zmiany postępu
  const site = ensureSite(s, o.uid);
  site.progress += machineRate(power) / recipeHours(recipe);
  if (site.progress < 1) return;
  if (store.room <= 0 && !isFoodKey(c, recipe.output.item)) {
    site.progress = Math.min(site.progress, 1);
    return;
  }
  for (const i of recipe.inputs) consumeItem(s, i.item, i.qty);
  addItem(s, recipe.output.item, recipe.output.qty);
  store.room -= roomUsed(c, recipe.output.item, recipe.output.qty, recipe.inputs);
  // Najwyżej jeden cykl na godzinę – nadmiar postępu się nie kumuluje.
  site.progress = Math.min(site.progress - 1, 1);
  produced(ctx, o, recipe.output.item, recipe.output.qty);
}

/** Co godzinę pracy: produkcja budynków z `production` i maszyn z obsadą (`autoRecipes`). Emituje `produced`. */
export function productionHour(ctx: Ctx, hour: number): void {
  const { s, c } = ctx;
  if (!isWorkHour(c, hour)) return;
  // Pełny magazyn wstrzymuje wyroby i materiały; jedzenie trafia do spiżarni bez limitu.
  const store: Store = { room: storageCap(s, c) - storageUsed(s, c) };
  // Pracownicy per budynek (jedno przejście zamiast `workersAt` dla każdego budynku).
  const crews = new Map<number, Resident[]>();
  for (const r of s.settlement.residents) {
    if (r.job === null) continue;
    const list = crews.get(r.job);
    if (list) list.push(r);
    else crews.set(r.job, [r]);
  }
  if (!crews.size) return;
  let pool: FishPool | undefined;
  const fish = () => (pool === undefined ? (pool = fishPool(ctx)) : pool);
  for (const o of s.objects) {
    const workers = crews.get(o.uid);
    if (!workers) continue;
    const def = c.buildings[o.type];
    if (!def || !isProducer(def) || !isOperational(s, o.uid)) continue;
    const power = workPower(s, c, o.type, workers);
    if (power <= 0) continue;
    if (def.production) runProduction(ctx, o, def.production, power, store, fish);
    else runMachine(ctx, o, def, power, store);
  }
}

// ---------------------------------------------------------------- płace i rozliczenie dnia

/** Próbka stawki podatku z bieżącej godziny (do średniej z doby). */
function sampleTax(s: GameState): void {
  const st = s.settlement;
  const acc = (st.taxAcc ??= { sum: 0, hours: 0 });
  acc.sum += st.taxRate;
  acc.hours++;
}

/** Co godzinę: próbka stawki podatku i wypłata płac o `wageHour` (emituje `unpaid` przy braku monet). */
export function economyHour(ctx: Ctx, hour: number): void {
  const { s, c } = ctx;
  sampleTax(s);
  if (hour !== c.settlement.constants.wageHour) return;
  const staff = payroll(s, c);
  if (!staff.length) return;
  let total = 0;
  for (const p of staff) total += p.wage;
  const paid = Math.min(total, Math.max(0, s.coins));
  s.coins -= paid;
  addBudget(ctx, 'wages', paid);
  if (paid >= total) return;
  // Strajk: wypłacono, ile się da; wszyscy pracownicy niezadowoleni do końca następnej doby.
  const missing = total - paid;
  for (const p of staff) p.r.mood = { value: UNPAID_MOOD, untilDay: ctx.cal.day + 1 };
  ctx.bus.emit({ type: 'unpaid', missing });
  chronicle(ctx, 'unpaid', { missing });
}

/** Raz na dobę: zdarzenie `budget{day, net}` za miniony dzień, podatki (średnia stawka z doby), utrzymanie. */
export function economyDay(ctx: Ctx): void {
  const { s, c } = ctx;
  // Zwykle `budget[0]`; szukamy po dniu, gdyby dzisiejszy wpis powstał już przed rozliczeniem (np. komenda).
  const last = s.settlement.budget.find((b) => b.day === ctx.cal.day - 1);
  if (last) ctx.bus.emit({ type: 'budget', day: last.day, net: budgetNet(last) });
  const taxes = dailyTaxes(s, c);
  s.settlement.taxAcc = { sum: 0, hours: 0 };
  if (taxes > 0) {
    s.coins += taxes;
    addBudget(ctx, 'taxes', taxes);
  }
  const upkeep = Math.min(Math.max(0, s.coins), dailyUpkeep(s, c));
  if (upkeep > 0) {
    s.coins -= upkeep;
    addBudget(ctx, 'upkeep', upkeep);
  }
}

// ---------------------------------------------------------------- komendy

/** Stawka podatku 0..taxMax (zaokrąglona do 0,01). */
export function setTax(ctx: Ctx, rate: number): CommandResult {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return fail('invalid');
  const r = Math.round(rate * 100) / 100 || 0; // bez -0
  if (r < 0 || r > ctx.c.settlement.constants.taxMax) return fail('invalid');
  const st = ctx.s.settlement;
  st.taxRate = r;
  // Suwak wysyła serię zmian – w kronice zostaje ostatnia z danej godziny.
  const top = st.chronicle[0];
  if (top?.kind === 'tax' && top.day === ctx.cal.day && top.hour === Math.floor(ctx.cal.hour)) st.chronicle.shift();
  chronicle(ctx, 'tax', { rate: Math.round(r * 100) });
  return OK;
}

/** Przełącza rezerwę przedmiotu (mieszkańcy go nie jedzą, karawany nie kupują automatycznie). */
export function toggleReserve(ctx: Ctx, item: string): CommandResult {
  if (typeof item !== 'string' || !Object.hasOwn(ctx.c.items, item)) return fail('invalid');
  const list = ctx.s.settlement.reserved;
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
  else list.push(item);
  return OK;
}
