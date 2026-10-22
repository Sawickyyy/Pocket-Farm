// Wydarzenia losowe (docs/plan-osada.md §10): pożary (obrażenia, gaszenie, rozprzestrzenianie), awarie,
// epidemie zwierząt, kryzysy gospodarcze i dobre wydarzenia (festyn, urodzaj, bogata karawana).
// Raz na dobę losujemy (nie offline, nie przed `events.minDay` dniem osady, najwyżej jedna katastrofa naraz),
// co godzinę rozliczamy pożary i zdejmujemy wygasłe wydarzenia.

import type { Content } from '../../../content/content';
import { DAY_MS, HOUR_MS } from '../../calendar';
import type { CommandResult } from '../../commands';
import { OK, consumeItem, countItem, fail, rand, type Ctx } from '../../ctx';
import type { ActiveEvent, GameState, PlacedObject, SettlementEventKind, SiteState } from '../../types';
import {
  activeEvent,
  centerOf,
  chronicle,
  coverageAt,
  ensureSite,
  hasService,
  isBuilt,
  isOperational,
  isSettlementDef,
  nextId,
  objectByUid,
  siteOf,
} from './common';

// ---------------------------------------------------------------- stałe

/** Obrażenia pożaru na godzinę; straż zmniejsza je o 80% × pokrycie, studnia o połowę. */
export const FIRE_DAMAGE = 0.15;
export const FIRE_CREW_DAMAGE = 0.8;
export const FIRE_WATER_DAMAGE = 0.5;
/** Straż obniża szansę pożaru o 70% × pokrycie. */
export const FIRE_CREW_CHANCE = 0.7;
/** Pełna szansa pożaru od tylu budynków osady (mniej = proporcjonalnie mniejsza). */
export const FIRE_FULL_BUILDINGS = 10;
/** Pożar gaśnie sam, gdy `fire > FIRE_MAX` (po 4 h), a przy straży, gdy `fire ≥ FIRE_CREW_OUT` (po 1 h). */
export const FIRE_MAX = 4;
export const FIRE_CREW_OUT = 2;
/** Czas wydarzenia pożaru (z zapasem – zdejmujemy je przy zgaszeniu). */
export const FIRE_EVENT_HOURS = 6;
/** Uszkodzenie, od którego budynek nie działa (mieszkańcy tracą dom, pracownicy pracę). */
export const DAMAGED = 0.5;
/** Rozprzestrzenianie: płonący > 2 h bez straży, szansa 0,1/h, sąsiad do 2 kafli, najwyżej raz z danego pożaru. */
export const SPREAD_AFTER = 2;
export const SPREAD_CHANCE = 0.1;
export const SPREAD_DIST = 2;
/** Awaria trwa do naprawy (wydarzenie przedłużamy, dopóki budynek jest zepsuty). */
export const BREAKDOWN_DAYS = 30;
/** Epidemia: 3 dni, 1 dzień przy pokryciu przychodni; tylko przy ≥ 2 zwierzętach. */
export const EPIDEMIC_DAYS = 3;
export const EPIDEMIC_CLINIC_DAYS = 1;
export const EPIDEMIC_MIN_ANIMALS = 2;
/** Kryzys: 3 dni, dopiero po 7. dniu osady. */
export const CRISIS_DAYS = 3;
export const CRISIS_AFTER_DAY = 7;
/** Festyn i urodzaj trwają 2 dni. */
export const GOOD_DAYS = 2;
/** Bogata karawana: następna karawana płaci ×1,3 (oferta czeka najwyżej 7 dni). */
export const RICH_CARAVAN_MULT = 1.3;
export const RICH_CARAVAN_DAYS = 7;

export const CATASTROPHES: readonly SettlementEventKind[] = ['fire', 'breakdown', 'epidemic', 'crisis'];
export type GoodEventKind = 'festival' | 'harvest' | 'richCaravan';
export const GOOD_EVENTS: readonly GoodEventKind[] = ['festival', 'harvest', 'richCaravan'];

// ---------------------------------------------------------------- zapytania (UI, hooki)

/** Czy budynek płonie? */
export function isBurning(s: GameState, uid: number): boolean {
  return (siteOf(s, uid)?.fire ?? 0) > 0;
}

/** Trwające wydarzenia (do UI), w kolejności powstania. */
export function activeEvents(s: GameState): ActiveEvent[] {
  return s.settlement.events.filter((e) => e.untilMs > s.clock.simMs);
}

export const isCatastrophe = (kind: SettlementEventKind): boolean => CATASTROPHES.includes(kind);

/** Czy trwa katastrofa (wydarzenie albo płonący/zepsuty budynek) – wtedy nie losujemy nowej. */
export function catastropheActive(s: GameState): boolean {
  const now = s.clock.simMs;
  if (s.settlement.events.some((e) => isCatastrophe(e.kind) && e.untilMs > now)) return true;
  return Object.values(s.settlement.sites).some((site) => site.fire > 0 || site.broken);
}

/** Czy zwierzęta w budynku `uid` chorują (hak w updateAnimals). */
export function animalHomeSick(s: GameState, uid: number): boolean {
  return !!activeEvent(s, 'epidemic', uid);
}

/** Mnożnik cen (kryzys gospodarczy ×0,7) – rynek i karawany. */
export function priceMult(s: GameState): number {
  return activeEvent(s, 'crisis') ? 0.7 : 1;
}

/** Rozrywka z wydarzeń (festyn +0,15). */
export function funBoost(s: GameState): number {
  return activeEvent(s, 'festival') ? 0.15 : 0;
}

/** Budynki osady, które mogą płonąć: ukończone, bez dróg i mostów (kolejność `s.objects`). */
export function flammable(s: GameState, c: Content): PlacedObject[] {
  return s.objects.filter((o) => {
    const def = c.buildings[o.type];
    return !!def && isSettlementDef(def) && def.kind !== 'path' && def.kind !== 'bridge' && isBuilt(s, o.uid);
  });
}

/** Może się zapalić: nie płonie i nie jest już zniszczony. */
function ignitable(s: GameState, uid: number): boolean {
  const site = siteOf(s, uid);
  return !site || (site.fire <= 0 && site.damage < DAMAGED);
}

/** Dzienna szansa pożaru budynku: `fire × min(1, budynki/10) × (1 − 0,7·straż)` (UI: ryzyko). */
export function fireChance(s: GameState, c: Content, uid: number, buildings = flammable(s, c).length): number {
  const o = objectByUid(s, uid);
  if (!o) return 0;
  const ctr = centerOf(c, o);
  const crew = coverageAt(s, c, 'fire', ctr.x, ctr.y);
  return c.settlement.events.fire * Math.min(1, buildings / FIRE_FULL_BUILDINGS) * (1 - FIRE_CREW_CHANCE * crew);
}

/** Obrażenia pożaru w ciągu godziny przy danym pokryciu straży i studni. */
export const fireDamage = (crew: number, water: boolean): number =>
  FIRE_DAMAGE * (1 - FIRE_CREW_DAMAGE * crew) * (water ? FIRE_WATER_DAMAGE : 1);

/** Kandydaci do awarii: działające budynki z produkcją albo maszyny z obsadą i automatycznymi recepturami. */
export function breakable(s: GameState, c: Content): PlacedObject[] {
  return s.objects.filter((o) => {
    const def = c.buildings[o.type];
    if (!def) return false;
    const machine = !!def.jobs && (def.autoRecipes?.length ?? 0) > 0;
    return (!!def.production || machine) && isOperational(s, o.uid);
  });
}

/** Kandydaci do epidemii: domy zwierząt z mieszkańcami, które jeszcze nie chorują. */
export function sickable(s: GameState, c: Content): PlacedObject[] {
  const homes = new Set(s.animals.map((a) => a.home));
  return s.objects.filter((o) => c.buildings[o.type]?.kind === 'home' && homes.has(o.uid) && !activeEvent(s, 'epidemic', o.uid));
}

/** Odległość obrysów w kaflach (jak w wymaganiach terenu: sąsiednie = 1, jeden kafel przerwy = 2). */
export function footprintGap(c: Content, a: PlacedObject, b: PlacedObject): number {
  const [aw, ah] = c.buildings[a.type]?.size ?? [1, 1];
  const [bw, bh] = c.buildings[b.type]?.size ?? [1, 1];
  const dx = Math.max(0, b.x - (a.x + aw - 1), a.x - (b.x + bw - 1));
  const dy = Math.max(0, b.y - (a.y + ah - 1), a.y - (b.y + bh - 1));
  return Math.max(dx, dy);
}

/** Najbliższy budynek osady (do 2 kafli od obrysu), na który może przejść pożar budynku `uid`. */
export function spreadTarget(s: GameState, c: Content, uid: number): PlacedObject | null {
  const src = objectByUid(s, uid);
  if (!src) return null;
  const from = centerOf(c, src);
  let best: PlacedObject | null = null;
  let bestGap = Infinity;
  let bestDist = Infinity;
  for (const o of flammable(s, c)) {
    if (o.uid === uid || !ignitable(s, o.uid)) continue;
    const gap = footprintGap(c, src, o);
    if (gap > SPREAD_DIST) continue;
    const ctr = centerOf(c, o);
    const dist = Math.hypot(ctr.x - from.x, ctr.y - from.y);
    const closer = gap < bestGap || (gap === bestGap && (dist < bestDist || (dist === bestDist && !!best && o.uid < best.uid)));
    if (!closer) continue;
    best = o;
    bestGap = gap;
    bestDist = dist;
  }
  return best;
}

// ---------------------------------------------------------------- lista wydarzeń

function pushEvent(ctx: Ctx, kind: SettlementEventKind, untilMs: number, target?: number): ActiveEvent {
  const ev: ActiveEvent = { id: nextId(ctx.s), kind, untilMs };
  if (target !== undefined) ev.target = target;
  ctx.s.settlement.events.push(ev);
  return ev;
}

/** Wydarzenie ogólne (bez celu): trwające tego rodzaju przedłużamy zamiast dublować. */
function upsertEvent(ctx: Ctx, kind: SettlementEventKind, untilMs: number): ActiveEvent {
  const cur = activeEvent(ctx.s, kind);
  if (!cur) return pushEvent(ctx, kind, untilMs);
  cur.untilMs = Math.max(cur.untilMs, untilMs);
  return cur;
}

function removeEvents(s: GameState, kind: SettlementEventKind, target: number): void {
  const list = s.settlement.events;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]!;
    if (e.kind === kind && e.target === target) list.splice(i, 1);
  }
}

// ---------------------------------------------------------------- początek wydarzeń (jawny cel – testy, debug)

/** Podpala budynek (`site.fire = 1`). `spread` = przeniesiony z sąsiada. Zwraca false, gdy już płonie. */
export function startFire(ctx: Ctx, uid: number, spread = false): boolean {
  const { s, c } = ctx;
  const o = objectByUid(s, uid);
  if (!o || !c.buildings[o.type]) return false;
  const site = ensureSite(s, uid);
  if (site.fire > 0) return false;
  site.fire = 1;
  removeEvents(s, 'fire', uid);
  pushEvent(ctx, 'fire', s.clock.simMs + FIRE_EVENT_HOURS * HOUR_MS, uid);
  ctx.bus.emit({ type: 'fire', uid, at: centerOf(c, o) });
  chronicle(ctx, 'fire', spread ? { building: o.type, spread: 1 } : { building: o.type });
  return true;
}

/** Awaria budynku (`broken = true`) do naprawy przez budowlańców albo komendą `repair`. */
export function startBreakdown(ctx: Ctx, uid: number): boolean {
  const { s, c } = ctx;
  const o = objectByUid(s, uid);
  if (!o || !c.buildings[o.type]) return false;
  const site = ensureSite(s, uid);
  if (site.broken) return false;
  site.broken = true;
  removeEvents(s, 'breakdown', uid);
  pushEvent(ctx, 'breakdown', s.clock.simMs + BREAKDOWN_DAYS * DAY_MS, uid);
  ctx.bus.emit({ type: 'breakdown', uid, at: centerOf(c, o) });
  chronicle(ctx, 'breakdown', { building: o.type });
  return true;
}

/** Epidemia w domu zwierząt: 3 dni, 1 dzień w zasięgu przychodni. */
export function startEpidemic(ctx: Ctx, home: number): boolean {
  const { s, c } = ctx;
  const o = objectByUid(s, home);
  if (!o || !c.buildings[o.type] || activeEvent(s, 'epidemic', home)) return false;
  const ctr = centerOf(c, o);
  const days = coverageAt(s, c, 'clinic', ctr.x, ctr.y) > 0 ? EPIDEMIC_CLINIC_DAYS : EPIDEMIC_DAYS;
  removeEvents(s, 'epidemic', home);
  pushEvent(ctx, 'epidemic', s.clock.simMs + days * DAY_MS, home);
  ctx.bus.emit({ type: 'epidemic', home, at: ctr });
  chronicle(ctx, 'epidemic', { building: o.type, days });
  return true;
}

/** Kryzys gospodarczy: ceny ×0,7 przez 3 dni (rynek i karawany przez `priceMult`). */
export function startCrisis(ctx: Ctx): void {
  upsertEvent(ctx, 'crisis', ctx.s.clock.simMs + CRISIS_DAYS * DAY_MS);
  ctx.bus.emit({ type: 'crisis', days: CRISIS_DAYS });
  chronicle(ctx, 'crisis', { days: CRISIS_DAYS });
}

/** Dobre wydarzenie: festyn / urodzaj (2 dni) albo bogata karawana (następna płaci ×1,3). */
export function startGoodEvent(ctx: Ctx, kind: GoodEventKind): void {
  const { s } = ctx;
  if (kind === 'richCaravan') {
    s.settlement.caravanBonus = Math.max(s.settlement.caravanBonus, RICH_CARAVAN_MULT);
    upsertEvent(ctx, kind, s.clock.simMs + RICH_CARAVAN_DAYS * DAY_MS);
  } else {
    upsertEvent(ctx, kind, s.clock.simMs + GOOD_DAYS * DAY_MS);
  }
  ctx.bus.emit({ type: 'goodEvent', kind });
  chronicle(ctx, 'goodEvent', { kind });
}

/** Dobre wydarzenia możliwe teraz (bogata karawana tylko z działającą faktorią). */
export function goodEventKinds(s: GameState, c: Content): GoodEventKind[] {
  return GOOD_EVENTS.filter((k) => k !== 'richCaravan' || hasService(s, c, 'trade'));
}

// ---------------------------------------------------------------- losowanie (raz na dobę)

function pick<T>(s: GameState, list: readonly T[]): T | undefined {
  return list.length ? list[Math.floor(rand(s) * list.length)] : undefined;
}

function rollFire(ctx: Ctx): boolean {
  const { s, c } = ctx;
  const all = flammable(s, c);
  const o = pick(s, all.filter((x) => ignitable(s, x.uid)));
  if (!o) return false;
  return rand(s) < fireChance(s, c, o.uid, all.length) && startFire(ctx, o.uid);
}

function rollBreakdown(ctx: Ctx): boolean {
  const { s, c } = ctx;
  const o = pick(s, breakable(s, c));
  if (!o) return false;
  return rand(s) < c.settlement.events.breakdown && startBreakdown(ctx, o.uid);
}

function rollEpidemic(ctx: Ctx): boolean {
  const { s, c } = ctx;
  if (s.animals.length < EPIDEMIC_MIN_ANIMALS) return false;
  const o = pick(s, sickable(s, c));
  if (!o) return false;
  return rand(s) < c.settlement.events.epidemic && startEpidemic(ctx, o.uid);
}

function rollCrisis(ctx: Ctx): boolean {
  const { s, c } = ctx;
  if (ctx.cal.day - s.settlement.foundedDay <= CRISIS_AFTER_DAY) return false;
  if (rand(s) >= c.settlement.events.crisis) return false;
  startCrisis(ctx);
  return true;
}

/** Kolejność losowania katastrof – pierwsza trafiona kończy losowanie. */
const CATASTROPHE_ROLLS: readonly ((ctx: Ctx) => boolean)[] = [rollFire, rollBreakdown, rollEpidemic, rollCrisis];

function rollGood(ctx: Ctx): void {
  const { s, c } = ctx;
  if (rand(s) >= c.settlement.events.good) return;
  const kind = pick(s, goodEventKinds(s, c));
  if (kind) startGoodEvent(ctx, kind);
}

/** Raz na dobę: losowanie nowych wydarzeń (nie offline, nie przed `minDay` dniem osady). */
export function eventsDay(ctx: Ctx): void {
  const { s, c } = ctx;
  const st = s.settlement;
  if (ctx.offline || st.foundedDay < 0 || ctx.cal.day - st.foundedDay < c.settlement.events.minDay) return;
  if (!catastropheActive(s)) {
    for (const roll of CATASTROPHE_ROLLS) if (roll(ctx)) break;
  }
  rollGood(ctx);
}

// ---------------------------------------------------------------- co godzinę

interface Burning {
  uid: number;
  o: PlacedObject;
  site: SiteState;
  ev: ActiveEvent;
}

/** Płonące budynki w kolejności wydarzeń (starszy pożar pierwszy); znikłe budynki gasimy bez śladu. */
function burningNow(ctx: Ctx): Burning[] {
  const { s } = ctx;
  const st = s.settlement;
  const out: Burning[] = [];
  for (const [key, site] of Object.entries(st.sites)) {
    if (site.fire <= 0) continue;
    const uid = Number(key);
    const o = objectByUid(s, uid);
    if (!o) {
      site.fire = 0;
      removeEvents(s, 'fire', uid);
      continue;
    }
    const ev = st.events.find((e) => e.kind === 'fire' && e.target === uid) ?? pushEvent(ctx, 'fire', s.clock.simMs + FIRE_EVENT_HOURS * HOUR_MS, uid);
    out.push({ uid, o, site, ev });
  }
  return out.sort((a, b) => a.ev.id - b.ev.id);
}

/**
 * Czy pożar już się przeniósł? Nowe pożary powstają tylko z przeniesienia (katastrofy są pojedyncze), a przeniesiony
 * dostaje nowsze id i płonie co najmniej do następnej godziny pożaru-źródła – więc wystarczy nowszy pożar na liście.
 */
const hasSpread = (s: GameState, ev: ActiveEvent): boolean => s.settlement.events.some((e) => e.kind === 'fire' && e.id > ev.id);

function extinguish(ctx: Ctx, b: Burning): void {
  b.site.fire = 0;
  removeEvents(ctx.s, 'fire', b.uid);
  const damaged = b.site.damage >= DAMAGED;
  ctx.bus.emit({ type: 'fireOut', uid: b.uid, damaged, at: centerOf(ctx.c, b.o) });
  chronicle(ctx, 'fireOut', { building: b.o.type, damaged: damaged ? 1 : 0 });
}

function firesHour(ctx: Ctx): void {
  const { s, c } = ctx;
  for (const b of burningNow(ctx)) {
    const ctr = centerOf(c, b.o);
    const crew = coverageAt(s, c, 'fire', ctr.x, ctr.y);
    const water = coverageAt(s, c, 'water', ctr.x, ctr.y) > 0;
    b.site.damage = Math.min(1, b.site.damage + fireDamage(crew, water));
    b.site.fire += 1;
    if ((crew > 0 && b.site.fire >= FIRE_CREW_OUT) || b.site.fire > FIRE_MAX) {
      extinguish(ctx, b);
      continue;
    }
    if (crew > 0 || b.site.fire <= SPREAD_AFTER || hasSpread(s, b.ev)) continue;
    const target = spreadTarget(s, c, b.uid);
    if (target && rand(s) < SPREAD_CHANCE) startFire(ctx, target.uid, true);
  }
}

/** Epidemia: przychodnia z pokryciem skraca do 1 dnia od teraz; koniec → `epidemicOver`. */
function keepEpidemic(ctx: Ctx, e: ActiveEvent, now: number): boolean {
  const { s, c } = ctx;
  const o = e.target === undefined ? undefined : objectByUid(s, e.target);
  if (!o) return false;
  const ctr = centerOf(c, o);
  if (coverageAt(s, c, 'clinic', ctr.x, ctr.y) > 0) e.untilMs = Math.min(e.untilMs, now + EPIDEMIC_CLINIC_DAYS * DAY_MS);
  if (e.untilMs > now) return true;
  ctx.bus.emit({ type: 'epidemicOver', home: o.uid });
  chronicle(ctx, 'epidemicOver', { building: o.type });
  return false;
}

function keepEvent(ctx: Ctx, e: ActiveEvent, now: number): boolean {
  const { s } = ctx;
  const st = s.settlement;
  switch (e.kind) {
    case 'fire':
      // Zdejmowany przy zgaszeniu; bez płonącego celu = pozostałość.
      if (e.target === undefined || !isBurning(s, e.target)) return false;
      if (e.untilMs <= now) e.untilMs = now + HOUR_MS;
      return true;
    case 'breakdown': {
      // Zdejmowany przy naprawie; trwa, dopóki budynek jest zepsuty.
      const site = e.target === undefined ? undefined : siteOf(s, e.target);
      if (!site?.broken || e.target === undefined || !objectByUid(s, e.target)) return false;
      if (e.untilMs <= now) e.untilMs = now + BREAKDOWN_DAYS * DAY_MS;
      return true;
    }
    case 'epidemic':
      return keepEpidemic(ctx, e, now);
    case 'richCaravan':
      // Premia zużyta przez karawanę albo oferta przepadła.
      if (st.caravanBonus <= 1) return false;
      if (e.untilMs > now) return true;
      st.caravanBonus = 1;
      return false;
    case 'crisis':
      if (e.untilMs > now) return true;
      chronicle(ctx, 'eventOver', { kind: e.kind });
      return false;
    default:
      return e.untilMs > now;
  }
}

/** Co godzinę: palenie się i gaszenie, wygasanie wydarzeń, koniec epidemii. */
export function eventsHour(ctx: Ctx, hour: number): void {
  void hour;
  firesHour(ctx);
  const list = ctx.s.settlement.events;
  if (!list.length) return;
  const now = ctx.s.clock.simMs;
  let w = 0;
  for (const e of list) if (keepEvent(ctx, e, now)) list[w++] = e;
  list.length = w;
}

// ---------------------------------------------------------------- komendy

/** Leczy zwierzęta w domu `home` jednym lekarstwem (kończy epidemię od razu). */
export function treatAnimals(ctx: Ctx, home: number): CommandResult {
  const { s } = ctx;
  if (!activeEvent(s, 'epidemic', home)) return fail('not-sick');
  if (countItem(s, 'medicine') < 1) return fail('no-medicine');
  consumeItem(s, 'medicine', 1);
  removeEvents(s, 'epidemic', home);
  ctx.bus.emit({ type: 'epidemicOver', home });
  const o = objectByUid(s, home);
  chronicle(ctx, 'treated', o ? { building: o.type } : undefined);
  return OK;
}
