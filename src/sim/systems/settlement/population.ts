// Mieszkańcy: napływ rodzin, wyjazdy, narodziny, dorastanie, bezdomni (docs/plan-osada.md §4).

import { NEEDS, type Content, type NeedId } from '../../../content/content';
import { rand, type Ctx } from '../../ctx';
import type { GameState, PlacedObject, Resident } from '../../types';
import { centerOf, chronicle, freeHousing, isHabitable, nextId, objectByUid, population } from './common';
import { averageHappiness, foodStock } from './needs';
import { dropRelations } from './social';

/** Minimalne średnie szczęście, przy którym przyjeżdżają nowi (pusta osada: bez warunku). */
export const ARRIVAL_MIN_HAPPINESS = 0.45;
/** Średnie szczęście, powyżej którego przyjeżdża dodatkowa rodzina. */
export const ARRIVAL_BONUS_HAPPINESS = 0.7;
/** Wymagany zapas jedzenia: punkty odżywcze na mieszkańca (≈ 1 dzień, 2 posiłki). */
export const ARRIVAL_FOOD_PER_RESIDENT = 2;
/** Startowe potrzeby i szczęście przybyszów i noworodków. */
export const START_MOOD = 0.7;
/** Kolejne smutne doby, po których dorosły wyjeżdża. */
export const LEAVE_SAD_DAYS = 3;
/** Doby bez domu, po których dorosły wyjeżdża. */
export const LEAVE_HOMELESS_DAYS = 2;
/** Dzienna szansa na dziecko pary w jednym domu z wolnym miejscem. */
export const BIRTH_CHANCE = 0.06;
/** Liczba wariantów wyglądu postaci. */
export const LOOKS = 8;

export type ArrivalBlock = 'housing' | 'unhappy' | 'hungry';

// ---------------------------------------------------------------- zapytania (UI)

/** Suma miejsc w ukończonych, mieszkalnych domach. */
export function housingCapacity(s: GameState, c: Content): number {
  let n = 0;
  for (const o of s.objects) {
    const def = c.buildings[o.type];
    if (def?.kind === 'house' && isHabitable(s, o.uid)) n += def.housing ?? 0;
  }
  return n;
}

/** Suma wolnych miejsc w ukończonych, mieszkalnych domach. */
export function freeHousingTotal(s: GameState, c: Content): number {
  let n = 0;
  for (const v of freeHousing(s, c).values()) n += Math.max(0, v);
  return n;
}

/** Dlaczego nikt nie przyjedzie o `arrivalHour` (null = przyjazd możliwy). */
export function arrivalBlock(s: GameState, c: Content, free: Map<number, number> = freeHousing(s, c)): ArrivalBlock | null {
  const pop = population(s);
  if (!roomiest(free)) return 'housing';
  if (pop > 0 && averageHappiness(s) < ARRIVAL_MIN_HAPPINESS) return 'unhappy';
  if (pop > 0 && foodStock(s, c) < ARRIVAL_FOOD_PER_RESIDENT * pop) return 'hungry';
  return null;
}

/** Ile rodzin przyjedzie (jeśli przyjazd jest możliwy): 1 + (szczęście > 0,7) + floor(peakTier / 2). */
export function familiesToArrive(s: GameState): number {
  return 1 + (averageHappiness(s) > ARRIVAL_BONUS_HAPPINESS ? 1 : 0) + Math.floor(s.settlement.peakTier / 2);
}

/** Nazwisko z pełnego imienia („Ala Nowak” → „Nowak”). */
export function surnameOf(name: string): string {
  const i = name.indexOf(' ');
  return i < 0 ? '' : name.slice(i + 1);
}

// ---------------------------------------------------------------- co godzinę: napływ

/** Co godzinę: o `arrivalHour` przyjazdy rodzin (emituje `arrived`, ustawia `foundedDay`). */
export function populationHour(ctx: Ctx, hour: number): void {
  const { s, c } = ctx;
  if (hour !== c.settlement.constants.arrivalHour) return;
  const free = freeHousing(s, c);
  if (arrivalBlock(s, c, free)) return;
  // Liczba rodzin liczona przed przyjazdem (przybysze nie zmieniają średniej w tej samej turze).
  for (let n = familiesToArrive(s); n > 0; n--) {
    const target = roomiest(free);
    if (!target) break;
    const count = arriveFamily(ctx, target.uid, target.free);
    free.set(target.uid, target.free - count);
  }
}

/** Dom z największą liczbą wolnych miejsc (remis: mniejszy uid) albo null, gdy wszystko zajęte. */
function roomiest(free: Map<number, number>): { uid: number; free: number } | null {
  let uid = -1;
  let best = 0;
  for (const [u, n] of free) {
    if (n > best || (n === best && n > 0 && u < uid)) {
      uid = u;
      best = n;
    }
  }
  return best > 0 ? { uid, free: best } : null;
}

/** Przyjazd jednej rodziny do domu `home` z `room` wolnymi miejscami. Zwraca liczebność rodziny. */
function arriveFamily(ctx: Ctx, home: number, room: number): number {
  const { s, c } = ctx;
  const st = s.settlement;
  const day = ctx.cal.day;
  let adults = 1 + Math.floor(rand(s) * 2);
  let kids = Math.floor(rand(s) * 3);
  // Rodzina mieszka razem: najpierw ubywa dzieci, zawsze zostaje co najmniej 1 dorosły.
  while (adults + kids > room && (kids > 0 || adults > 1)) {
    if (kids > 0) kids--;
    else adults--;
  }
  const families = c.settlement.names.family;
  const surname = families[Math.floor(rand(s) * families.length)] ?? '';
  const family = nextId(s);
  const used = new Set<string>();
  const childAge = c.settlement.constants.childDays * 0.8;
  const first = st.residents.length;
  for (let i = 0; i < adults + kids; i++) {
    const child = i >= adults;
    const name = fullName(s, c, used, surname);
    const bornDay = child ? day - Math.floor(rand(s) * childAge) : -1;
    st.residents.push(newResident(ctx, { name, family, child, bornDay, home }));
  }
  // Dwoje dorosłych w rodzinie to małżeństwo: mogą mieć dzieci i dostają premię partnera.
  if (adults === 2) {
    const a = st.residents[first]!.id;
    const b = st.residents[first + 1]!.id;
    st.relations.push({ a: Math.min(a, b), b: Math.max(a, b), kind: 'partner', v: 1 });
  }
  const count = adults + kids;
  if (st.foundedDay < 0) st.foundedDay = day;
  st.stats.arrived += count;
  const o = objectByUid(s, home);
  ctx.bus.emit({ type: 'arrived', family, count, home, at: o ? centerOf(c, o) : { x: 0, y: 0 } });
  chronicle(ctx, 'arrived', { family: surname, count });
  return count;
}

/** Imię z `names.given` (bez powtórzeń w rodzinie) + nazwisko. */
function fullName(s: GameState, c: Content, used: Set<string>, surname: string): string {
  const list = c.settlement.names.given;
  let i = Math.floor(rand(s) * list.length);
  for (let k = 0; k < list.length && used.has(list[i] ?? ''); k++) i = (i + 1) % list.length;
  const given = list[i] ?? '?';
  used.add(given);
  return surname ? `${given} ${surname}` : given;
}

function newResident(ctx: Ctx, p: { name: string; family: number; child: boolean; bornDay: number; home: number }): Resident {
  const needs = {} as Record<NeedId, number>;
  for (const n of NEEDS) needs[n] = START_MOOD;
  return {
    id: nextId(ctx.s),
    name: p.name,
    family: p.family,
    child: p.child,
    bornDay: p.bornDay,
    home: p.home,
    job: null,
    needs,
    happiness: START_MOOD,
    sadDays: 0,
    homelessDays: 0,
    arrivedDay: ctx.cal.day,
    look: Math.floor(rand(ctx.s) * LOOKS),
    meals: { eaten: 0, due: 0, kinds: [] },
    mood: { value: 0, untilDay: -1 },
  };
}

// ---------------------------------------------------------------- raz na dobę

/** Raz na dobę: dorastanie (`grewUp`), przeprowadzki bezdomnych, wyjazdy (`left`), narodziny (`born`). */
export function populationDay(ctx: Ctx): void {
  if (!ctx.s.settlement.residents.length) return;
  growUp(ctx);
  const houses = houseIndex(ctx.s, ctx.c);
  rehouse(ctx, houses);
  departures(ctx);
  births(ctx, houses);
}

/** uid → domy (rodzaj `house`) stojące na mapie. */
function houseIndex(s: GameState, c: Content): Map<number, PlacedObject> {
  const out = new Map<number, PlacedObject>();
  for (const o of s.objects) if (c.buildings[o.type]?.kind === 'house') out.set(o.uid, o);
  return out;
}

/** Mieszkaniec ma dom: istniejący, ukończony i nieuszkodzony. */
const housed = (s: GameState, houses: Map<number, PlacedObject>, r: Resident): boolean =>
  r.home !== null && houses.has(r.home) && isHabitable(s, r.home);

function growUp(ctx: Ctx): void {
  const day = ctx.cal.day;
  const childDays = ctx.c.settlement.constants.childDays;
  for (const r of ctx.s.settlement.residents) {
    if (!r.child || day - r.bornDay < childDays) continue;
    r.child = false;
    ctx.bus.emit({ type: 'grewUp', id: r.id });
    chronicle(ctx, 'grewUp', { name: r.name });
  }
}

/** Bezdomni (brak domu albo dom uszkodzony/usunięty): cała bezdomna część rodziny przenosi się razem. */
function rehouse(ctx: Ctx, houses: Map<number, PlacedObject>): void {
  const { s, c } = ctx;
  const groups = new Map<number, Resident[]>();
  // Domy członków rodziny, którzy mają dom (rodzina woli mieszkać razem).
  const familyHomes = new Map<number, number[]>();
  for (const r of s.settlement.residents) {
    const home = r.home;
    if (home !== null && housed(s, houses, r)) {
      r.homelessDays = 0;
      const list = familyHomes.get(r.family) ?? [];
      if (!list.includes(home)) list.push(home);
      familyHomes.set(r.family, list);
    } else {
      const g = groups.get(r.family);
      if (g) g.push(r);
      else groups.set(r.family, [r]);
    }
  }
  if (!groups.size) return;
  const free = freeHousing(s, c);
  for (const [family, members] of groups) {
    const need = members.length;
    const preferred = (familyHomes.get(family) ?? []).sort((a, b) => a - b).find((uid) => (free.get(uid) ?? 0) >= need);
    const best = roomiest(free);
    const target = preferred ?? (best && best.free >= need ? best.uid : null);
    for (const m of members) {
      if (target !== null) {
        m.home = target;
        m.homelessDays = 0;
      } else {
        // Dom usunięty albo uszkodzony = bezdomny (po naprawie dom znów ma wolne miejsca – wrócą przy przeprowadzce).
        m.home = null;
        m.homelessDays++;
      }
    }
    if (target !== null) free.set(target, (free.get(target) ?? 0) - need);
  }
}

/** Wyjazdy: dorośli smutni ≥ 3 doby albo bez domu ≥ 2 doby; dzieci jadą z nimi, gdy w rodzinie nie zostaje dorosły. */
function departures(ctx: Ctx): void {
  const { s } = ctx;
  const st = s.settlement;
  const leaving = new Set<number>();
  const reasons = new Map<number, 'unhappy' | 'homeless'>();
  for (const r of st.residents) {
    if (r.child) continue;
    const homeless = r.homelessDays >= LEAVE_HOMELESS_DAYS;
    if (!homeless && r.sadDays < LEAVE_SAD_DAYS) continue;
    leaving.add(r.id);
    if (homeless || !reasons.has(r.family)) reasons.set(r.family, homeless ? 'homeless' : 'unhappy');
  }
  if (!leaving.size) return;
  const keepsAdult = new Set<number>();
  for (const r of st.residents) if (!r.child && !leaving.has(r.id)) keepsAdult.add(r.family);
  for (const r of st.residents) if (r.child && reasons.has(r.family) && !keepsAdult.has(r.family)) leaving.add(r.id);

  const counts = new Map<number, number>();
  for (const r of st.residents) if (leaving.has(r.id)) counts.set(r.family, (counts.get(r.family) ?? 0) + 1);
  st.residents = st.residents.filter((r) => !leaving.has(r.id));
  for (const id of leaving) dropRelations(s, id);
  st.stats.left += leaving.size;
  for (const [family, reason] of reasons) {
    const count = counts.get(family) ?? 0;
    ctx.bus.emit({ type: 'left', count, reason });
    chronicle(ctx, 'left', { count, reason });
  }
}

/** Narodziny: para (`partner`), oboje dorośli, w jednym mieszkalnym domu z wolnym miejscem – szansa 0,06/dobę. */
function births(ctx: Ctx, houses: Map<number, PlacedObject>): void {
  const { s, c } = ctx;
  const st = s.settlement;
  const pairs = st.relations.filter((r) => r.kind === 'partner');
  if (!pairs.length) return;
  const byId = new Map(st.residents.map((r) => [r.id, r]));
  const free = freeHousing(s, c);
  for (const rel of pairs) {
    const a = byId.get(rel.a);
    const b = byId.get(rel.b);
    if (!a || !b || a.child || b.child || a.home === null || a.home !== b.home || !housed(s, houses, a)) continue;
    const home = a.home;
    if ((free.get(home) ?? 0) <= 0) continue;
    if (rand(s) >= BIRTH_CHANCE) continue;
    const used = new Set(st.residents.filter((r) => r.family === a.family).map((r) => r.name.split(' ')[0] ?? ''));
    const name = fullName(s, c, used, surnameOf(a.name));
    const baby = newResident(ctx, { name, family: a.family, child: true, bornDay: ctx.cal.day, home });
    st.residents.push(baby);
    byId.set(baby.id, baby);
    free.set(home, (free.get(home) ?? 0) - 1);
    st.stats.born++;
    ctx.bus.emit({ type: 'born', id: baby.id, name });
    chronicle(ctx, 'born', { name });
  }
}
