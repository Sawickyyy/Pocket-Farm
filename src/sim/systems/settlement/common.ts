// Wspólne zapytania i narzędzia osady (docs/plan-osada.md). Czyste funkcje na stanie gry – używane przez
// wszystkie moduły osady, grafikę i interfejs. Zmiany tu = zmiany kontraktu dla wszystkich modułów.

import { COVERAGE_KINDS, type BuildingDef, type Content, type CoverageKind, type Profession, type ServiceKind } from '../../../content/content';
import type { Ctx } from '../../ctx';
import type { At } from '../../events';
import type { BudgetDay, GameState, PlacedObject, Resident, SiteState } from '../../types';
import { MAP_H, MAP_W, chunkOfTile } from '../../world';

// ---------------------------------------------------------------- etapy

/** Etap osady dla danej populacji (indeks w `settlement.tiers`). */
export function tierOf(c: Content, population: number): number {
  let tier = 0;
  c.settlement.tiers.forEach((t, i) => {
    if (population >= t.min) tier = i;
  });
  return tier;
}

export const population = (s: GameState): number => s.settlement.residents.length;
export const adults = (s: GameState): Resident[] => s.settlement.residents.filter((r) => !r.child);
export const children = (s: GameState): Resident[] => s.settlement.residents.filter((r) => r.child);

// ---------------------------------------------------------------- budynki osady

/** Czy budynek należy do systemu osady (ma stan budowy, etaty, usługi lub miejsca)? */
export function isSettlementDef(def: BuildingDef | undefined): boolean {
  if (!def) return false;
  return def.kind === 'house' || def.kind === 'work' || def.kind === 'infra' || def.kind === 'service' || def.kind === 'bridge' || !!def.jobs || !!def.service;
}

export function objectByUid(s: GameState, uid: number): PlacedObject | undefined {
  return s.objects.find((o) => o.uid === uid);
}

export function defOf(c: Content, s: GameState, uid: number): BuildingDef | undefined {
  const o = objectByUid(s, uid);
  return o ? c.buildings[o.type] : undefined;
}

export function centerOf(c: Content, o: PlacedObject): At {
  const [w, h] = c.buildings[o.type]?.size ?? [1, 1];
  return { x: o.x + w / 2, y: o.y + h / 2 };
}

export const siteOf = (s: GameState, uid: number): SiteState | undefined => s.settlement.sites[String(uid)];

export function newSite(built = 1): SiteState {
  return { built, damage: 0, fire: 0, broken: false, progress: 0, repair: 0 };
}

/** Stan budynku (tworzony w razie potrzeby jako ukończony – np. dla budynków farmy przy awarii). */
export function ensureSite(s: GameState, uid: number): SiteState {
  return (s.settlement.sites[String(uid)] ??= newSite(1));
}

/** Rozpoczyna budowę (postęp 0). */
export function startSite(s: GameState, uid: number): void {
  s.settlement.sites[String(uid)] = newSite(0);
}

/** Ukończony (budynki bez stanu – np. farmy – są zawsze ukończone). */
export function isBuilt(s: GameState, uid: number): boolean {
  const site = siteOf(s, uid);
  return !site || site.built >= 1;
}

/** Działa: ukończony, nieuszkodzony, bez awarii i bez pożaru. */
export function isOperational(s: GameState, uid: number): boolean {
  const site = siteOf(s, uid);
  return !site || (site.built >= 1 && site.damage < 0.5 && !site.broken && site.fire <= 0);
}

/** Mieszkalny dom (ukończony, nieuszkodzony – pożar nie wyrzuca od razu). */
export function isHabitable(s: GameState, uid: number): boolean {
  const site = siteOf(s, uid);
  return !site || (site.built >= 1 && site.damage < 0.5);
}

export function objectsOfKind(s: GameState, c: Content, pred: (def: BuildingDef) => boolean): PlacedObject[] {
  return s.objects.filter((o) => {
    const def = c.buildings[o.type];
    return !!def && pred(def);
  });
}

// ---------------------------------------------------------------- mieszkańcy i praca

export function workersAt(s: GameState, uid: number): Resident[] {
  return s.settlement.residents.filter((r) => r.job === uid);
}

export function residentsAt(s: GameState, uid: number): Resident[] {
  return s.settlement.residents.filter((r) => r.home === uid);
}

/** Obsada 0..1 (budynek bez etatów = 1, nie działa = 0). */
export function staffing(s: GameState, c: Content, uid: number): number {
  if (!isOperational(s, uid)) return 0;
  const def = defOf(c, s, uid);
  const slots = def?.jobs?.slots ?? 0;
  if (!slots) return 1;
  return Math.min(1, workersAt(s, uid).length / slots);
}

export function professionOf(s: GameState, c: Content, r: Resident): Profession | null {
  if (r.job === null) return null;
  return defOf(c, s, r.job)?.jobs?.profession ?? null;
}

export const wageOf = (c: Content, p: Profession): number => c.settlement.professions[p]?.wage ?? 0;

export function isWorkHour(c: Content, hour: number): boolean {
  const k = c.settlement.constants;
  return hour >= k.workStart && hour < k.workEnd;
}

/** Usuwa wszystkich z domu/pracy w budynku (rozbiórka, uszkodzenie). */
export function releaseBuilding(s: GameState, uid: number, home = true, job = true): void {
  for (const r of s.settlement.residents) {
    if (home && r.home === uid) r.home = null;
    if (job && r.job === uid) r.job = null;
  }
}

/** Wolne miejsca w ukończonych, mieszkalnych domach: uid → wolne. */
export function freeHousing(s: GameState, c: Content): Map<number, number> {
  const out = new Map<number, number>();
  for (const o of s.objects) {
    const def = c.buildings[o.type];
    if (def?.kind !== 'house' || !isHabitable(s, o.uid)) continue;
    out.set(o.uid, (def.housing ?? 0) - residentsAt(s, o.uid).length);
  }
  return out;
}

export function nextId(s: GameState): number {
  return s.settlement.nextId++;
}

// ---------------------------------------------------------------- usługi globalne

/** Czy działa (i ma obsadę, jeśli wymaga) budynek z daną usługą (np. faktoria, ratusz, zajezdnia, plac budowy). */
export function hasService(s: GameState, c: Content, kind: ServiceKind): boolean {
  return s.objects.some((o) => c.buildings[o.type]?.service?.kind === kind && staffing(s, c, o.uid) > 0);
}

/** Suma `value × obsada` usług danego rodzaju (np. magazyn). */
export function serviceSum(s: GameState, c: Content, kind: ServiceKind): number {
  let sum = 0;
  for (const o of s.objects) {
    const sv = c.buildings[o.type]?.service;
    if (sv?.kind === kind) sum += (sv.value ?? 1) * staffing(s, c, o.uid);
  }
  return sum;
}

// ---------------------------------------------------------------- magazyn

export function storageUsed(s: GameState): number {
  let n = 0;
  for (const v of Object.values(s.inventory)) n += v;
  return n;
}

export function storageCap(s: GameState, c: Content): number {
  return c.settlement.constants.baseStorage + serviceSum(s, c, 'storage') + serviceSum(s, c, 'hall');
}

export const storageFull = (s: GameState, c: Content): boolean => storageUsed(s) >= storageCap(s, c);

// ---------------------------------------------------------------- pokrycie usług (mapy 64×64)

const coverageCache = new WeakMap<GameState, { key: string; maps: Partial<Record<CoverageKind, Float32Array>> }>();

function coverageKey(s: GameState): string {
  // Zmienia się z budynkami, ich stanem i obsadą (przydziały pracy) – wystarczy na godzinę gry.
  const hour = Math.floor(s.clock.simMs / 60_000);
  return `${hour}|${s.objects.length}|${s.settlement.residents.length}`;
}

/** Mapa pokrycia usługi: wartość 0..1 dla każdego kafla (max po budynkach `value × obsada` w promieniu). */
export function coverage(s: GameState, c: Content, kind: CoverageKind): Float32Array {
  const key = coverageKey(s);
  let entry = coverageCache.get(s);
  if (!entry || entry.key !== key) {
    entry = { key, maps: {} };
    coverageCache.set(s, entry);
  }
  const cached = entry.maps[kind];
  if (cached) return cached;
  const map = new Float32Array(MAP_W * MAP_H);
  for (const o of s.objects) {
    const def = c.buildings[o.type];
    const sv = def?.service;
    if (!def || !sv || sv.kind !== kind || sv.radius <= 0) continue;
    const v = (sv.value ?? 1) * staffing(s, c, o.uid);
    if (v <= 0) continue;
    const ctr = centerOf(c, o);
    const r = sv.radius;
    for (let y = Math.max(0, Math.floor(ctr.y - r)); y <= Math.min(MAP_H - 1, Math.ceil(ctr.y + r)); y++) {
      for (let x = Math.max(0, Math.floor(ctr.x - r)); x <= Math.min(MAP_W - 1, Math.ceil(ctr.x + r)); x++) {
        if (Math.hypot(x + 0.5 - ctr.x, y + 0.5 - ctr.y) > r) continue;
        const i = y * MAP_W + x;
        if (v > map[i]!) map[i] = v;
      }
    }
  }
  entry.maps[kind] = map;
  return map;
}

export function coverageAt(s: GameState, c: Content, kind: CoverageKind, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= MAP_W || yi >= MAP_H) return 0;
  return coverage(s, c, kind)[yi * MAP_W + xi] ?? 0;
}

/** Pokrycie w środku domu mieszkańca (0, gdy bezdomny). */
export function coverageAtHome(s: GameState, c: Content, kind: CoverageKind, r: Resident): number {
  if (r.home === null) return 0;
  const o = objectByUid(s, r.home);
  if (!o) return 0;
  const ctr = centerOf(c, o);
  return coverageAt(s, c, kind, ctr.x, ctr.y);
}

export { COVERAGE_KINDS };

// ---------------------------------------------------------------- teren

export const inTerritory = (s: GameState, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && s.settlement.territory.includes(chunkOfTile(x, y));

// ---------------------------------------------------------------- budżet i kronika

export type BudgetField = Exclude<keyof BudgetDay, 'day'>;

/** Rozliczenie bieżącego dnia (tworzone przy pierwszym wpisie w danym dniu). */
export function budgetToday(ctx: Ctx): BudgetDay {
  const b = ctx.s.settlement.budget;
  if (!b[0] || b[0].day !== ctx.cal.day) {
    b.unshift({ day: ctx.cal.day, taxes: 0, sales: 0, exports: 0, wages: 0, upkeep: 0, imports: 0, investments: 0 });
    if (b.length > 7) b.length = 7;
  }
  return b[0]!;
}

export function addBudget(ctx: Ctx, field: BudgetField, amount: number): void {
  if (!amount) return;
  budgetToday(ctx)[field] += Math.round(amount);
}

export const budgetNet = (b: BudgetDay): number => b.taxes + b.sales + b.exports - b.wages - b.upkeep - b.imports - b.investments;

export function chronicle(ctx: Ctx, kind: string, params?: Record<string, string | number>): void {
  const list = ctx.s.settlement.chronicle;
  list.unshift(params ? { day: ctx.cal.day, hour: Math.floor(ctx.cal.hour), kind, params } : { day: ctx.cal.day, hour: Math.floor(ctx.cal.hour), kind });
  const max = ctx.c.settlement.constants.chronicleMax;
  if (list.length > max) list.length = max;
}

// ---------------------------------------------------------------- wydarzenia (zapytania)

export function activeEvent(s: GameState, kind: string, target?: number) {
  return s.settlement.events.find((e) => e.kind === kind && (target === undefined || e.target === target) && e.untilMs > s.clock.simMs);
}

// ---------------------------------------------------------------- wydajność

/** Mnożnik specjalizacji osady dla danego obszaru (agri/trade/craft). */
export function specMult(s: GameState, c: Content, id: string): number {
  if (s.settlement.specialization !== id) return 1;
  return c.settlement.specializations.find((x) => x.id === id)?.mult ?? 1;
}

/**
 * Wydajność pracownika (docs/plan-osada.md §5): (0,5 + szczęście) × narzędzia × zajezdnia × szkoła × urodzaj.
 * Specjalizację nakłada produkcja (zależy od rodzaju budynku).
 */
export function productivity(s: GameState, c: Content, r: Resident): number {
  let p = 0.5 + r.happiness;
  if ((s.inventory.tools ?? 0) > 0) p *= s.settlement.specialization === 'craft' ? 1.2 : 1.1;
  if (hasService(s, c, 'transport')) p *= 1.1;
  if (coverageAtHome(s, c, 'school', r) > 0) p *= 1.05;
  if (activeEvent(s, 'harvest')) p *= 1.25;
  return p;
}
