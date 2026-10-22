// Budowa i naprawy (docs/plan-osada.md §2, §10): postęp placów budowy, naprawy uszkodzeń i awarii przez
// budowlańców oraz natychmiastowa naprawa za monety.

import type { Content } from '../../../content/content';
import type { CommandResult } from '../../commands';
import { OK, fail, type Ctx } from '../../ctx';
import type { GameState, PlacedObject, SiteState } from '../../types';
import { addBudget, centerOf, chronicle, isOperational, isWorkHour, objectByUid, productivity, siteOf } from './common';

/** Tempo bazowe budowy poza godzinami pracy (mnożnik). */
export const OFF_HOURS_RATE = 0.5;
/** Dodatkowe tempo najstarszej budowy na jednego budowlańca (× jego wydajność). */
export const BUILDER_BONUS = 0.5;
/** Postęp naprawy na godzinę pracy budowlańców: awaria (3 h) i uszkodzenie (10 h). */
export const REPAIR_RATE_BROKEN = 1 / 3;
export const REPAIR_RATE_DAMAGE = 0.1;
/** Natychmiastowa naprawa: 20% kosztu budynku, min. 20 monet. */
export const REPAIR_COST_SHARE = 0.2;
export const REPAIR_MIN_COST = 20;

/** Tolerancja sumowania ułamków (np. 10 × 0,1 = 0,999…). */
const EPS = 1e-9;

interface SiteRef {
  uid: number;
  o: PlacedObject;
  site: SiteState;
}

/** Stany budynków spełniające warunek, z istniejącym obiektem, uid rosnąco. */
function sitesWhere(s: GameState, pred: (site: SiteState) => boolean): SiteRef[] {
  const found: { uid: number; site: SiteState }[] = [];
  for (const [key, site] of Object.entries(s.settlement.sites)) if (pred(site)) found.push({ uid: Number(key), site });
  if (!found.length) return [];
  const byUid = new Map<number, PlacedObject>();
  for (const o of s.objects) byUid.set(o.uid, o);
  const out: SiteRef[] = [];
  for (const f of found) {
    const o = byUid.get(f.uid);
    if (o) out.push({ uid: f.uid, o, site: f.site });
  }
  return out.sort((a, b) => a.uid - b.uid);
}

/** Czy budynek wymaga naprawy (uszkodzenie albo awaria)? */
export const needsRepair = (site: SiteState | undefined): boolean => !!site && (site.broken || site.damage > 0);

/** Koszt natychmiastowej naprawy budynku danego typu. */
export function repairCost(c: Content, type: string): number {
  return Math.max(REPAIR_MIN_COST, Math.round(REPAIR_COST_SHARE * (c.buildings[type]?.cost ?? 0)));
}

/** Tempo budowy w roboczogodzinach na godzinę (premia budowlańców tylko dla najstarszej budowy). */
export function buildRate(c: Content, hour: number, power: number): number {
  return (isWorkHour(c, hour) ? 1 : OFF_HOURS_RATE) + BUILDER_BONUS * power;
}

/** Postęp naprawy na godzinę przy danej mocy budowlańców (0 bez budowlańców). */
export function repairRate(site: SiteState, power: number): number {
  return (site.broken ? REPAIR_RATE_BROKEN : REPAIR_RATE_DAMAGE) * Math.min(1, Math.max(0, power));
}

/**
 * Budowy w toku, które postępują (z czasem budowy, bez pożaru), uid rosnąco –
 * pierwsza (najstarsza) dostaje premię budowlańców.
 */
export function constructionQueue(s: GameState, c: Content): number[] {
  return sitesWhere(s, (site) => site.built < 1 && site.fire <= 0)
    .filter((x) => (c.buildings[x.o.type]?.buildHours ?? 0) > 0)
    .map((x) => x.uid);
}

/** Budynki do naprawy przez budowlańców (bez trwającego pożaru): najpierw większe uszkodzenia, potem uid. */
export function repairQueue(s: GameState): number[] {
  return repairTargets(s).map((x) => x.uid);
}

function repairTargets(s: GameState): SiteRef[] {
  return sitesWhere(s, (site) => needsRepair(site) && site.fire <= 0).sort((a, b) => b.site.damage - a.site.damage || a.uid - b.uid);
}

/** Efektywna liczba budowlańców pracujących teraz (Σ wydajności pracowników placów budowy w godzinach pracy). */
export function builderPower(ctx: Ctx, hour: number): number {
  const { s, c } = ctx;
  if (!isWorkHour(c, hour)) return 0;
  const yards = new Set<number>();
  for (const o of s.objects) if (c.buildings[o.type]?.service?.kind === 'build' && isOperational(s, o.uid)) yards.add(o.uid);
  if (!yards.size) return 0;
  let power = 0;
  for (const r of s.settlement.residents) if (r.job !== null && yards.has(r.job)) power += productivity(s, c, r);
  return power;
}

function finishConstruction(ctx: Ctx, ref: SiteRef): void {
  ref.site.built = 1;
  ctx.bus.emit({ type: 'constructed', uid: ref.uid, building: ref.o.type, at: centerOf(ctx.c, ref.o) });
  chronicle(ctx, 'constructed', { building: ref.o.type });
}

/** Kończy naprawę: czyści uszkodzenia, awarię i jej aktywne wydarzenie. */
function finishRepair(ctx: Ctx, uid: number, o: PlacedObject, site: SiteState): void {
  site.broken = false;
  site.damage = 0;
  site.repair = 0;
  const events = ctx.s.settlement.events;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind === 'breakdown' && e.target === uid) events.splice(i, 1);
  }
  ctx.bus.emit({ type: 'repaired', uid, at: centerOf(ctx.c, o) });
  chronicle(ctx, 'repaired', { building: o.type });
}

/**
 * Co godzinę: postęp budów (`sites[uid].built`, emituje `constructed` + kronika), naprawy uszkodzeń i awarii
 * przez budowlańców (emituje `repaired`).
 */
export function constructionHour(ctx: Ctx, hour: number): void {
  const { s, c } = ctx;
  const building = sitesWhere(s, (site) => site.built < 1);
  const damaged = repairTargets(s);
  if (!building.length && !damaged.length) return;
  const power = builderPower(ctx, hour);

  // Budowy: tempo bazowe dla wszystkich, premia budowlańców dla najstarszej. Pożar wstrzymuje budowę.
  let bonus = power;
  for (const ref of building) {
    const hours = c.buildings[ref.o.type]?.buildHours ?? 0;
    if (hours > 0) {
      if (ref.site.fire > 0) continue;
      ref.site.built += buildRate(c, hour, bonus) / hours;
      bonus = 0;
    }
    if (hours <= 0 || ref.site.built >= 1 - EPS) finishConstruction(ctx, ref);
  }

  // Naprawy: budowlańcy naprawiają jeden budynek na godzinę – najbardziej uszkodzony. Bez nich brak samonaprawy.
  const target = damaged[0];
  if (power <= 0 || !target) return;
  target.site.repair += repairRate(target.site, power);
  if (target.site.repair >= 1 - EPS) finishRepair(ctx, target.uid, target.o, target.site);
}

/** Natychmiastowa naprawa za 20% kosztu budynku (min 20): uszkodzenie, awaria. */
export function repair(ctx: Ctx, uid: number): CommandResult {
  const { s, c } = ctx;
  const o = objectByUid(s, uid);
  if (!o || !c.buildings[o.type]) return fail('invalid');
  const site = siteOf(s, uid);
  if (!site || !needsRepair(site)) return fail('not-damaged');
  if (site.fire > 0) return fail('busy');
  const cost = repairCost(c, o.type);
  if (s.coins < cost) return fail('no-coins');
  s.coins -= cost;
  addBudget(ctx, 'investments', cost);
  finishRepair(ctx, uid, o, site);
  return OK;
}
