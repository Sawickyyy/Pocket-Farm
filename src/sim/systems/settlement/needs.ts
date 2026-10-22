// Potrzeby, posiłki i szczęście (docs/plan-osada.md §7). Co godzinę każda potrzeba i szczęście dążą do celu
// (`x += (cel − x) × 0,25`); o godzinach posiłków mieszkańcy jedzą z magazynu (najtańsze najpierw), a w zasięgu
// obsadzonego sklepu płacą za posiłek. Pokrycie usług, dekoracje i pożary liczymy raz na dom w danej godzinie.

import { COVERAGE_KINDS, NEEDS, parseKey, type Content, type CoverageKind, type NeedId } from '../../../content/content';
import { removeKey, type Ctx } from '../../ctx';
import type { At } from '../../events';
import type { GameState, PlacedObject, Relation, Resident } from '../../types';
import { MAP_H, MAP_W } from '../../world';
import { addBudget, centerOf, coverage } from './common';
import { funBoost } from './events';
import { relationBonus } from './social';

/** Tempo dążenia potrzeb i szczęścia do celu (na godzinę). */
export const NEED_RATE = 0.25;
/** Wpływ stawki podatku na szczęście (`− stawka × 1,2`). */
export const TAX_HAPPINESS = 1.2;
/** Najwięcej zapamiętanych rodzajów potraw z doby. */
export const MAX_MEAL_KINDS = 12;
/** Różne potrawy z doby dające premię do jedzenia (+0,05). */
export const VARIETY_KINDS = 3;
export const VARIETY_BONUS = 0.05;
/** Promień pożaru obniżającego bezpieczeństwo (−0,3) i promień dekoracji (+0,05 każda, max 0,2). */
export const FIRE_RADIUS = 6;
export const FIRE_PENALTY = 0.3;
export const DECO_RADIUS = 3;
export const DECO_FUN = 0.05;
export const DECO_FUN_MAX = 0.2;

/** Punkty odżywcze należne mieszkańcowi na posiłek: dorosły 1, dziecko 0,5. */
export const mealDue = (r: Resident): number => (r.child ? 0.5 : 1);

// ---------------------------------------------------------------- otoczenie domu

/** Czynniki potrzeb zależne tylko od domu (wspólne dla rodziny). */
interface HomeInfo {
  comfort: number;
  cov: Record<CoverageKind, number>;
  nearFire: boolean;
  decos: number;
}

const NO_COVERAGE = Object.fromEntries(COVERAGE_KINDS.map((k) => [k, 0])) as Record<CoverageKind, number>;

/** Zapytania potrzeb na jedną godzinę gry (stan budynków się w niej nie zmienia). */
class NeedsEnv {
  private readonly byUid = new Map<number, PlacedObject>();
  private readonly homes = new Map<number, HomeInfo | null>();
  private maps: Partial<Record<CoverageKind, Float32Array>> = {};
  private burning: At[] | null = null;
  private decos: At[] | null = null;
  readonly funBoost: number;

  constructor(
    readonly s: GameState,
    readonly c: Content,
  ) {
    for (const o of s.objects) this.byUid.set(o.uid, o);
    this.funBoost = funBoost(s);
  }

  /** Otoczenie domu albo null (bezdomny lub dom nie istnieje). */
  home(uid: number | null): HomeInfo | null {
    if (uid === null) return null;
    let info = this.homes.get(uid);
    if (info !== undefined) return info;
    const o = this.byUid.get(uid);
    info = o ? this.describe(o) : null;
    this.homes.set(uid, info);
    return info;
  }

  private describe(o: PlacedObject): HomeInfo {
    const ctr = centerOf(this.c, o);
    const xi = Math.floor(ctr.x);
    const yi = Math.floor(ctr.y);
    const inside = xi >= 0 && yi >= 0 && xi < MAP_W && yi < MAP_H;
    const cov = { ...NO_COVERAGE };
    // Jak coverageAtHome: wartość mapy pokrycia w kaflu środka domu.
    if (inside) for (const k of COVERAGE_KINDS) cov[k] = this.map(k)[yi * MAP_W + xi] ?? 0;
    return {
      comfort: this.c.buildings[o.type]?.comfort ?? 0,
      cov,
      nearFire: this.burningAround().some((p) => Math.hypot(p.x - ctr.x, p.y - ctr.y) <= FIRE_RADIUS),
      decos: countWithin(this.decoCenters(), ctr, DECO_RADIUS, Math.ceil(DECO_FUN_MAX / DECO_FUN)),
    };
  }

  private map(kind: CoverageKind): Float32Array {
    return (this.maps[kind] ??= coverage(this.s, this.c, kind));
  }

  /** Środki płonących budynków (`site.fire > 0`). */
  private burningAround(): At[] {
    if (this.burning) return this.burning;
    const out: At[] = [];
    for (const [key, site] of Object.entries(this.s.settlement.sites)) {
      if (site.fire <= 0) continue;
      const o = this.byUid.get(Number(key));
      if (o) out.push(centerOf(this.c, o));
    }
    return (this.burning = out);
  }

  /** Środki dekoracji (`kind: "deco"`). */
  private decoCenters(): At[] {
    if (this.decos) return this.decos;
    const out: At[] = [];
    for (const o of this.s.objects) if (this.c.buildings[o.type]?.kind === 'deco') out.push(centerOf(this.c, o));
    return (this.decos = out);
  }
}

/** Ile punktów leży w promieniu `r` od `p` (liczenie przerywane po `cap`). */
function countWithin(points: At[], p: At, r: number, cap: number): number {
  let n = 0;
  for (const q of points) {
    if (Math.abs(q.x - p.x) > r || Math.abs(q.y - p.y) > r || Math.hypot(q.x - p.x, q.y - p.y) > r) continue;
    if (++n >= cap) break;
  }
  return n;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function targetsFor(env: NeedsEnv, r: Resident): Record<NeedId, number> {
  const h = env.home(r.home);
  const cov = h?.cov ?? NO_COVERAGE;
  const meals = r.meals;
  const food = meals.due > 0 ? Math.min(1, meals.eaten / meals.due + (meals.kinds.length >= VARIETY_KINDS ? VARIETY_BONUS : 0)) : r.needs.food;
  const housing = h ? Math.min(1, h.comfort + (cov.water > 0 ? 0.1 : 0)) : 0;
  const work = r.child ? (cov.school > 0 ? 1 : 0.6) : r.job !== null ? 1 : 0.3;
  const safety = clamp01(0.35 + 0.3 * cov.police + 0.15 * cov.fire + 0.1 * cov.clinic + 0.1 * cov.light - (h?.nearFire ? FIRE_PENALTY : 0));
  const fun = Math.min(1, 0.3 + 0.5 * cov.fun + Math.min(DECO_FUN_MAX, DECO_FUN * (h?.decos ?? 0)) + env.funBoost);
  return { food, housing, work, safety, fun };
}

/** Docelowe wartości potrzeb mieszkańca (do UI i testów). */
export function needTargets(ctx: Ctx, r: Resident): Record<NeedId, number> {
  return targetsFor(new NeedsEnv(ctx.s, ctx.c), r);
}

/** Chwilowy modyfikator szczęścia (rada, strajk) – ważny do `untilDay` włącznie. */
export const moodOf = (r: Resident, day: number): number => (r.mood.untilDay >= day ? r.mood.value : 0);

/** Cel szczęścia z bieżących potrzeb: Σ waga·potrzeba − podatek·1,2 + relacje + nastrój, przycięty do 0..1. */
export function happinessTarget(ctx: Ctx, r: Resident, relations = relationBonus(ctx.s, r.id)): number {
  const w = ctx.c.settlement.needWeights;
  let v = 0;
  for (const n of NEEDS) v += (w[n] ?? 0) * r.needs[n];
  return clamp01(v - ctx.s.settlement.taxRate * TAX_HAPPINESS + relations + moodOf(r, ctx.cal.day));
}

// ---------------------------------------------------------------- posiłki

export interface FoodLot {
  key: string;
  id: string;
  /** Punkty odżywcze na sztukę. */
  value: number;
  qty: number;
}

/** Jedzenie w magazynie w kolejności spożycia: cena/odżywczość rosnąco, potem klucz (bez rezerwy). */
export function mealOrder(s: GameState, c: Content): FoodLot[] {
  const lots: (FoodLot & { cost: number })[] = [];
  for (const [key, qty] of Object.entries(s.inventory)) {
    if (!(qty > 0)) continue;
    const { id } = parseKey(key);
    const value = c.settlement.foods[id];
    if (!value || value <= 0 || s.settlement.reserved.includes(id)) continue;
    lots.push({ key, id, value, qty, cost: (c.items[id]?.price ?? 0) / value });
  }
  lots.sort((a, b) => a.cost - b.cost || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return lots.map(({ key, id, value, qty }) => ({ key, id, value, qty }));
}

/** Wynik posiłku (do testów i UI). */
export interface MealResult {
  demand: number;
  covered: number;
  ratio: number;
  kinds: string[];
  sales: number;
}

/** Posiłek wszystkich mieszkańców: zużycie jedzenia z magazynu, liczniki posiłków i sprzedaż w zasięgu sklepu. */
export function serveMeal(ctx: Ctx): MealResult {
  return meal(ctx, new NeedsEnv(ctx.s, ctx.c));
}

function meal(ctx: Ctx, env: NeedsEnv): MealResult {
  const { s, c } = ctx;
  const rs = s.settlement.residents;
  let demand = 0;
  for (const r of rs) demand += mealDue(r);
  if (demand <= 0) return { demand: 0, covered: 0, ratio: 0, kinds: [], sales: 0 };

  // Całe sztuki, najtańsze najpierw – ostatnia sztuka może przekroczyć popyt.
  let covered = 0;
  const kinds: string[] = [];
  for (const lot of mealOrder(s, c)) {
    if (covered >= demand) break;
    const take = Math.min(lot.qty, Math.ceil((demand - covered) / lot.value - 1e-9));
    if (take <= 0 || !removeKey(s, lot.key, take)) continue;
    covered += take * lot.value;
    if (!kinds.includes(lot.id)) kinds.push(lot.id);
  }
  const ratio = Math.min(1, covered / demand);

  const perPoint = c.settlement.constants.salesPerPoint;
  let revenue = 0;
  for (const r of rs) {
    const due = mealDue(r);
    const m = r.meals;
    m.due += due;
    m.eaten += due * ratio;
    for (const k of kinds) if (m.kinds.length < MAX_MEAL_KINDS && !m.kinds.includes(k)) m.kinds.push(k);
    const market = env.home(r.home)?.cov.market ?? 0;
    if (market > 0) revenue += perPoint * due * ratio * market;
  }
  const sales = Math.round(revenue);
  if (sales > 0) {
    s.coins += sales;
    addBudget(ctx, 'sales', sales);
  }
  return { demand, covered, ratio, kinds, sales };
}

// ---------------------------------------------------------------- systemy

/** Co godzinę: posiłki (o godzinach `mealHours`, ze sprzedażą w zasięgu sklepu), dążenie potrzeb i szczęścia. */
export function needsHour(ctx: Ctx, hour: number): void {
  const { s, c } = ctx;
  const rs = s.settlement.residents;
  if (!rs.length) return;
  const env = new NeedsEnv(s, c);
  if (c.settlement.constants.mealHours.includes(hour)) meal(ctx, env);

  const bonus = relationBonuses(s);
  for (const r of rs) {
    const t = targetsFor(env, r);
    for (const n of NEEDS) r.needs[n] += (t[n] - r.needs[n]) * NEED_RATE;
    const target = happinessTarget(ctx, r, bonus.get(r.id) ?? 0);
    r.happiness += (target - r.happiness) * NEED_RATE;
  }
}

/**
 * Wpływ relacji na szczęście dla wszystkich naraz. `relationBonus` (social.ts) przegląda całą listę relacji,
 * więc wołamy go na widoku stanu z relacjami tylko danej osoby – ten sam wynik w O(relacje) zamiast O(n × relacje).
 */
export function relationBonuses(s: GameState): Map<number, number> {
  const byId = new Map<number, Relation[]>();
  const add = (id: number, rel: Relation): void => {
    const list = byId.get(id);
    if (list) list.push(rel);
    else byId.set(id, [rel]);
  };
  for (const rel of s.settlement.relations) {
    add(rel.a, rel);
    if (rel.b !== rel.a) add(rel.b, rel);
  }
  const out = new Map<number, number>();
  if (!byId.size) return out;
  const view: GameState = { ...s, settlement: { ...s.settlement } };
  for (const [id, list] of byId) {
    view.settlement.relations = list;
    out.set(id, relationBonus(view, id));
  }
  return out;
}

/** Raz na dobę: aktualizacja `sadDays`, wyzerowanie licznika posiłków, wygaszenie `mood`. */
export function needsDay(ctx: Ctx): void {
  const day = ctx.cal.day;
  for (const r of ctx.s.settlement.residents) {
    r.sadDays = r.happiness < 0.25 ? r.sadDays + 1 : 0;
    r.meals = { eaten: 0, due: 0, kinds: [] };
    if (r.mood.untilDay < day) r.mood = { value: 0, untilDay: -1 };
  }
}

/** Punkty odżywcze dostępne w magazynie (bez rezerwy, każda jakość). */
export function foodStock(s: GameState, c: Content): number {
  let points = 0;
  for (const [key, n] of Object.entries(s.inventory)) {
    const { id } = parseKey(key);
    const value = c.settlement.foods[id];
    if (value && n > 0 && !s.settlement.reserved.includes(id)) points += value * n;
  }
  return points;
}

/** Średnie szczęście mieszkańców (1, gdy brak mieszkańców). */
export function averageHappiness(s: GameState): number {
  const rs = s.settlement.residents;
  return rs.length ? rs.reduce((a, r) => a + r.happiness, 0) / rs.length : 1;
}
