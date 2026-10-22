import { describe, expect, it } from 'vitest';
import { CONTENT, type Content } from '../../../src/content/content';
import { EventBus } from '../../../src/core/eventBus';
import { DAY_MS, HOUR_MS, calendarAt } from '../../../src/sim/calendar';
import { makeCtx, type Ctx } from '../../../src/sim/ctx';
import type { SimEvent } from '../../../src/sim/events';
import type { Simulation } from '../../../src/sim/simulation';
import { updateAnimals } from '../../../src/sim/systems/animals';
import { canPlace } from '../../../src/sim/systems/building';
import { unitPrice } from '../../../src/sim/systems/market';
import { coverageAt, isHabitable, isOperational, objectByUid, productivity } from '../../../src/sim/systems/settlement/common';
import {
  BREAKDOWN_DAYS,
  EPIDEMIC_DAYS,
  FIRE_EVENT_HOURS,
  RICH_CARAVAN_DAYS,
  activeEvents,
  animalHomeSick,
  breakable,
  catastropheActive,
  eventsDay,
  eventsHour,
  fireChance,
  fireDamage,
  flammable,
  footprintGap,
  funBoost,
  goodEventKinds,
  isBurning,
  priceMult,
  spreadTarget,
  startBreakdown,
  startCrisis,
  startEpidemic,
  startFire,
  startGoodEvent,
  treatAnimals,
} from '../../../src/sim/systems/settlement/events';
import type { Animal, GameState } from '../../../src/sim/types';
import { FARM } from '../../../src/sim/world';
import { reason, setTime } from '../helpers';
import { addResident, freeSpot, makeTown, ok, placeBuilt } from './helpers';

const DAY = 5;
type Chances = Content['settlement']['events'];

/** Treść z podmienionymi szansami wydarzeń (domyślnie wszystkie 0). */
function withChances(p: Partial<Chances>): Content {
  const events: Chances = { fire: 0, breakdown: 0, epidemic: 0, crisis: 0, good: 0, minDay: CONTENT.settlement.events.minDay, ...p };
  return { ...CONTENT, settlement: { ...CONTENT.settlement, events } };
}

/** Osada założona w dniu 0 (wydarzenia możliwe od dnia `minDay`). */
const town = (patch: (s: GameState) => void = () => {}, seed = 42): Simulation =>
  makeTown((s) => {
    s.settlement.foundedDay = 0;
    patch(s);
  }, seed);

/** Kontekst na daną godzinę (bez kroku symulacji) ze zbieraniem zdarzeń. */
function at(s: GameState, hour: number, day = DAY, c: Content = CONTENT): { ctx: Ctx; events: SimEvent[] } {
  setTime(s, day, hour);
  const bus = new EventBus<SimEvent>();
  const events: SimEvent[] = [];
  bus.onAny((e) => events.push(e));
  return { ctx: makeCtx(s, bus, calendarAt(s.clock.simMs, s.seed), c), events };
}

/** `eventsHour` dla kolejnych godzin od `from` (może przejść na kolejne dni). */
function hours(s: GameState, from: number, n: number, day = DAY): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    const h = from + i;
    const { ctx, events } = at(s, h % 24, day + Math.floor(h / 24));
    eventsHour(ctx, h % 24);
    all.push(...events);
  }
  return all;
}

/** `eventsDay` w danym dniu (o północy). */
function day(s: GameState, d: number, c: Content = CONTENT, offline = false): SimEvent[] {
  const { ctx, events } = at(s, 0, d, c);
  if (offline) ctx.offline = true;
  eventsDay(ctx);
  return events;
}

const ofType = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
const site = (s: GameState, uid: number) => s.settlement.sites[String(uid)]!;
const kinds = (s: GameState) => s.settlement.events.map((e) => e.kind);

/** Stawia n gotowych namiotów (budynki osady 1×1). */
function tents(sim: Simulation, n: number): number[] {
  return Array.from({ length: n }, () => placeBuilt(sim, 'tent'));
}

/** Miejsce w terenie osady, gdzie zmieszczą się budynki danego typu przesunięte o `offsets` kafli w poziomie. */
function rowSpot(s: GameState, type: string, offsets: number[]): { x: number; y: number } {
  for (let y = FARM.y - 8; y < FARM.y + FARM.h + 8; y++) {
    for (let x = FARM.x - 8; x < FARM.x + FARM.w + 8; x++) {
      if (offsets.every((dx) => canPlace(s, CONTENT, type, x + dx, y).ok)) return { x, y };
    }
  }
  throw new Error(`brak miejsca na rząd ${type}`);
}

/** Rząd chat (2×2) przesuniętych o `offsets` względem pierwszego wolnego miejsca; uid w kolejności offsets. */
function hutRow(sim: Simulation, offsets: number[]): number[] {
  const spot = rowSpot(sim.state, 'hut', offsets);
  return offsets.map((dx) => placeBuilt(sim, 'hut', { x: spot.x + dx, y: spot.y }));
}

/** Kurnik z kurami (bezpośrednio w stanie). */
function coopWith(sim: Simulation, n: number): number {
  const home = placeBuilt(sim, 'coop');
  for (let i = 0; i < n; i++) {
    const a: Animal = { id: sim.state.nextUid++, kind: 'chicken', name: `Kura ${i}`, home, hunger: 1, affection: 0.5, progress: 0, ready: false, pettedDay: -1 };
    sim.state.animals.push(a);
  }
  return home;
}

/** Budynek usługowy z pełną obsadą (np. straż, przychodnia, faktoria). */
function staffed(sim: Simulation, type: string, at?: { x: number; y: number }): number {
  const uid = placeBuilt(sim, type, at);
  const slots = CONTENT.buildings[type]!.jobs?.slots ?? 0;
  for (let i = 0; i < slots; i++) addResident(sim.state, { job: uid });
  return uid;
}

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState;

describe('osada/wydarzenia: losowanie dzienne', () => {
  it('offline nie losuje niczego (nawet dobrych wydarzeń) i nie zużywa generatora', () => {
    const sim = town();
    tents(sim, 10);
    const s = sim.state;
    const rng = s.rng;
    const events = day(s, DAY, withChances({ fire: 1, breakdown: 1, epidemic: 1, crisis: 1, good: 1 }), true);
    expect(events).toEqual([]);
    expect(s.settlement.events).toEqual([]);
    expect(s.rng).toBe(rng);
  });

  it('nic przed założeniem osady i przed dniem minDay', () => {
    const all = withChances({ fire: 1, crisis: 1, good: 1 });
    const sim = town((st) => (st.settlement.foundedDay = -1));
    tents(sim, 10);
    const s = sim.state;
    expect(day(s, DAY, all)).toEqual([]);
    s.settlement.foundedDay = 4;
    expect(day(s, 4 + CONTENT.settlement.events.minDay - 1, all)).toEqual([]);
    expect(s.settlement.events).toEqual([]);
    const events = day(s, 4 + CONTENT.settlement.events.minDay, all);
    expect(ofType(events, 'fire')).toHaveLength(1);
  });

  it('pożar ma pierwszeństwo; potem najwyżej jedna katastrofa naraz', () => {
    const all = withChances({ fire: 1, breakdown: 1, epidemic: 1, crisis: 1 });
    const sim = town();
    tents(sim, 9);
    placeBuilt(sim, 'allotment');
    coopWith(sim, 2);
    const s = sim.state;
    const first = day(s, 10, all);
    expect(ofType(first, 'fire')).toHaveLength(1);
    expect(kinds(s)).toEqual(['fire']);
    expect(catastropheActive(s)).toBe(true);
    // Następna doba w trakcie pożaru: brak nowej katastrofy.
    expect(day(s, 11, all)).toEqual([]);
    expect(kinds(s)).toEqual(['fire']);
  });

  it('kolejność: awaria przed epidemią, epidemia przed kryzysem', () => {
    const sim = town();
    const field = placeBuilt(sim, 'allotment');
    const coop = coopWith(sim, 2);
    const s = sim.state;
    const e1 = day(s, 10, withChances({ breakdown: 1, epidemic: 1, crisis: 1 }));
    expect(ofType(e1, 'breakdown')).toEqual([expect.objectContaining({ uid: field })]);
    expect(kinds(s)).toEqual(['breakdown']);
    // Awaria trwa do naprawy – blokuje kolejne katastrofy.
    expect(day(s, 11, withChances({ epidemic: 1, crisis: 1 }))).toEqual([]);
    site(s, field).broken = false;
    hours(s, 0, 1, 11);
    expect(kinds(s)).toEqual([]);
    const e2 = day(s, 12, withChances({ epidemic: 1, crisis: 1 }));
    expect(ofType(e2, 'epidemic')).toEqual([expect.objectContaining({ home: coop })]);
    expect(ofType(e2, 'crisis')).toEqual([]);
  });

  it('epidemia wymaga co najmniej 2 zwierząt', () => {
    const sim = town();
    coopWith(sim, 1);
    const s = sim.state;
    expect(day(s, 10, withChances({ epidemic: 1 }))).toEqual([]);
    coopWith(sim, 1);
    expect(ofType(day(s, 11, withChances({ epidemic: 1 })), 'epidemic')).toHaveLength(1);
  });

  it('kryzys dopiero po 7. dniu osady', () => {
    const sim = town();
    const s = sim.state;
    const c = withChances({ crisis: 1 });
    expect(day(s, 7, c)).toEqual([]);
    expect(ofType(day(s, 8, c), 'crisis')).toEqual([{ type: 'crisis', days: 3 }]);
    expect(priceMult(s)).toBe(0.7);
  });

  it('szansa pożaru rośnie z liczbą budynków do 10 i spada o 70% przy straży', () => {
    const sim = town();
    const [t] = tents(sim, 5);
    const s = sim.state;
    const base = CONTENT.settlement.events.fire;
    expect(fireChance(s, CONTENT, t!)).toBeCloseTo(base * 0.5, 9);
    tents(sim, 10);
    expect(fireChance(s, CONTENT, t!)).toBeCloseTo(base, 9);
    staffed(sim, 'firestation');
    const o = objectByUid(s, t!)!;
    expect(coverageAt(s, CONTENT, 'fire', o.x, o.y)).toBe(1);
    expect(fireChance(s, CONTENT, t!)).toBeCloseTo(base * 0.3, 9);
  });

  it('drogi, mosty, dekoracje i budowy nie płoną', () => {
    const sim = town();
    const s = sim.state;
    const tent = placeBuilt(sim, 'tent');
    placeBuilt(sim, 'path');
    placeBuilt(sim, 'flowers');
    const spot = freeSpot(s, 'hut');
    ok(sim, { type: 'place', building: 'hut', x: spot.x, y: spot.y }); // budowa w toku
    expect(flammable(s, CONTENT).map((o) => o.uid)).toEqual([tent]);
  });

  it('dobre wydarzenie losowane niezależnie od katastrof', () => {
    const sim = town();
    tents(sim, 10);
    const s = sim.state;
    const events = day(s, DAY, withChances({ fire: 1, good: 1 }));
    expect(ofType(events, 'fire')).toHaveLength(1);
    expect(ofType(events, 'goodEvent')).toHaveLength(1);
  });

  it('bogata karawana tylko z działającą faktorią', () => {
    const sim = town();
    const s = sim.state;
    expect(goodEventKinds(s, CONTENT)).toEqual(['festival', 'harvest']);
    const seen = new Set<string>();
    for (let i = 1; i <= 40; i++) {
      const st = clone(s);
      st.rng = i;
      for (const e of ofType(day(st, DAY, withChances({ good: 1 })), 'goodEvent')) seen.add(e.kind);
    }
    expect([...seen].sort()).toEqual(['festival', 'harvest']);
    staffed(sim, 'tradepost');
    expect(goodEventKinds(s, CONTENT)).toEqual(['festival', 'harvest', 'richCaravan']);
    for (let i = 1; i <= 40; i++) {
      const st = clone(s);
      st.rng = i;
      for (const e of ofType(day(st, DAY, withChances({ good: 1 })), 'goodEvent')) seen.add(e.kind);
    }
    expect(seen.has('richCaravan')).toBe(true);
  });
});

describe('osada/wydarzenia: pożary', () => {
  it('podpalenie: stan budynku, wydarzenie, zdarzenie i kronika', () => {
    const sim = town();
    const [t] = tents(sim, 1);
    const s = sim.state;
    const { ctx, events } = at(s, 3);
    expect(startFire(ctx, t!)).toBe(true);
    expect(startFire(ctx, t!)).toBe(false); // już płonie
    expect(site(s, t!).fire).toBe(1);
    expect(isBurning(s, t!)).toBe(true);
    expect(isOperational(s, t!)).toBe(false);
    expect(isHabitable(s, t!)).toBe(true); // pożar nie wyrzuca od razu
    expect(activeEvents(s)).toEqual([expect.objectContaining({ kind: 'fire', target: t, untilMs: s.clock.simMs + FIRE_EVENT_HOURS * HOUR_MS })]);
    expect(ofType(events, 'fire')).toEqual([{ type: 'fire', uid: t, at: { x: expect.any(Number), y: expect.any(Number) } }]);
    expect(s.settlement.chronicle[0]).toMatchObject({ kind: 'fire', params: { building: 'tent' } });
  });

  it('bez straży i studni: 0,15/h przez 4 h, potem gaśnie i budynek jest uszkodzony', () => {
    const sim = town();
    const [t] = tents(sim, 1);
    const s = sim.state;
    startFire(at(s, 3).ctx, t!);
    expect(hours(s, 3, 3)).toEqual([]);
    expect(site(s, t!).damage).toBeCloseTo(0.45, 9);
    expect(isBurning(s, t!)).toBe(true);
    const out = hours(s, 6, 1);
    expect(ofType(out, 'fireOut')).toEqual([expect.objectContaining({ uid: t, damaged: true })]);
    expect(site(s, t!).fire).toBe(0);
    expect(site(s, t!).damage).toBeCloseTo(0.6, 9);
    expect(isOperational(s, t!)).toBe(false);
    expect(isHabitable(s, t!)).toBe(false);
    expect(s.settlement.events).toEqual([]);
    expect(s.settlement.chronicle[0]).toMatchObject({ kind: 'fireOut', params: { building: 'tent', damaged: 1 } });
  });

  it('studnia w zasięgu: połowa obrażeń, budynek ocalał', () => {
    const sim = town();
    const [t] = tents(sim, 1);
    placeBuilt(sim, 'well');
    const s = sim.state;
    const o = objectByUid(s, t!)!;
    expect(coverageAt(s, CONTENT, 'water', o.x, o.y)).toBeGreaterThan(0);
    startFire(at(s, 3).ctx, t!);
    const out = hours(s, 3, 4);
    expect(ofType(out, 'fireOut')).toEqual([expect.objectContaining({ uid: t, damaged: false })]);
    expect(site(s, t!).damage).toBeCloseTo(4 * fireDamage(0, true), 9);
    expect(site(s, t!).damage).toBeCloseTo(0.3, 9);
    expect(isOperational(s, t!)).toBe(true);
    expect(s.settlement.chronicle[0]).toMatchObject({ kind: 'fireOut', params: { damaged: 0 } });
  });

  it('straż z obsadą gasi w 1 h i ogranicza obrażenia o 80%', () => {
    const sim = town();
    const [t] = tents(sim, 1);
    staffed(sim, 'firestation');
    const s = sim.state;
    startFire(at(s, 3).ctx, t!);
    const out = hours(s, 3, 1);
    expect(ofType(out, 'fireOut')).toEqual([expect.objectContaining({ uid: t, damaged: false })]);
    expect(site(s, t!).damage).toBeCloseTo(0.15 * 0.2, 9);
    expect(isBurning(s, t!)).toBe(false);
    expect(activeEvents(s)).toEqual([]);
  });

  it('straż bez obsady nie pomaga', () => {
    const sim = town();
    const [t] = tents(sim, 1);
    placeBuilt(sim, 'firestation');
    const s = sim.state;
    startFire(at(s, 3).ctx, t!);
    expect(ofType(hours(s, 3, 3), 'fireOut')).toEqual([]);
    expect(ofType(hours(s, 6, 1), 'fireOut')).toEqual([expect.objectContaining({ damaged: true })]);
  });

  it('obrażenia nie przekraczają 1', () => {
    const sim = town();
    const [t] = tents(sim, 1);
    const s = sim.state;
    startFire(at(s, 3).ctx, t!);
    site(s, t!).damage = 0.95;
    hours(s, 3, 1);
    expect(site(s, t!).damage).toBe(1);
  });

  it('rozebrany płonący budynek: pożar i wydarzenie znikają bez zgaszenia', () => {
    const sim = town();
    const [t] = tents(sim, 1);
    const s = sim.state;
    startFire(at(s, 3).ctx, t!);
    ok(sim, { type: 'remove', uid: t! });
    const events = hours(s, 3, 1);
    expect(events).toEqual([]);
    expect(s.settlement.events).toEqual([]);
    expect(catastropheActive(s)).toBe(false);
  });

  it('pożar bez wpisu wydarzenia (stary zapis) dostaje wydarzenie i jest rozliczany', () => {
    const sim = town();
    const [t] = tents(sim, 1);
    const s = sim.state;
    site(s, t!).fire = 1;
    hours(s, 3, 1);
    expect(activeEvents(s)).toEqual([expect.objectContaining({ kind: 'fire', target: t })]);
    expect(site(s, t!).fire).toBe(2);
  });

  it('odległość obrysów i cel przeniesienia: najbliższy do 2 kafli, nie płonący', () => {
    const sim = town();
    // C (przerwa 1 kafel), A, B (przylega); D daleko.
    const [c, a, b] = hutRow(sim, [-3, 0, 2]);
    const s = sim.state;
    const oa = objectByUid(s, a!)!;
    expect(footprintGap(CONTENT, oa, objectByUid(s, b!)!)).toBe(1);
    expect(footprintGap(CONTENT, oa, objectByUid(s, c!)!)).toBe(2);
    expect(spreadTarget(s, CONTENT, a!)?.uid).toBe(b);
    startFire(at(s, 3).ctx, b!);
    expect(spreadTarget(s, CONTENT, a!)?.uid).toBe(c);
    startFire(at(s, 3).ctx, c!);
    expect(spreadTarget(s, CONTENT, a!)).toBeNull();
  });

  it('nie przenosi się dalej niż 2 kafle', () => {
    const sim = town();
    const [a, d] = hutRow(sim, [0, 4]);
    const s = sim.state;
    expect(footprintGap(CONTENT, objectByUid(s, a!)!, objectByUid(s, d!)!)).toBe(3);
    expect(spreadTarget(s, CONTENT, a!)).toBeNull();
    for (let i = 1; i <= 30; i++) {
      const st = clone(s);
      st.rng = i;
      startFire(at(st, 3).ctx, a!);
      hours(st, 3, 8);
      expect(st.settlement.sites[String(d)]!.damage).toBe(0);
    }
  });

  it('przenosi się po > 2 h bez straży, najwyżej raz z danego pożaru', () => {
    const sim = town();
    // B i C przylegają do A, ale są od siebie o 3 kafle.
    const [b, a, c] = hutRow(sim, [-2, 0, 2]);
    const s = sim.state;
    expect(footprintGap(CONTENT, objectByUid(s, b!)!, objectByUid(s, c!)!)).toBe(3);
    let spreads = 0;
    for (let i = 1; i <= 120; i++) {
      const st = clone(s);
      st.rng = i;
      startFire(at(st, 3).ctx, a!);
      const events = hours(st, 3, 12);
      const lit = ofType(events, 'fire').map((e) => e.uid);
      expect(lit.length).toBeLessThanOrEqual(1);
      if (!lit.length) continue;
      spreads++;
      expect([b, c]).toContain(lit[0]);
      // Pożar od 3:00 rozliczany o 3, 4, 5, 6: przeniesienie tylko po > 2 h (o 4:00 i 5:00), przed zgaszeniem.
      const entry = st.settlement.chronicle.find((e) => e.kind === 'fire' && e.params?.spread === 1);
      expect([4, 5]).toContain(entry?.hour);
      expect(ofType(events, 'fireOut')).toHaveLength(2);
    }
    expect(spreads).toBeGreaterThan(5);
    expect(spreads).toBeLessThan(60);
  });

  it('pożar, który już się przeniósł, nie przenosi się drugi raz', () => {
    const sim = town();
    const [b, a, c] = hutRow(sim, [-2, 0, 2]);
    const s = sim.state;
    let contrast = 0;
    for (let i = 1; i <= 60; i++) {
      // A płonie od 2 h, B zapalił się od A (nowsze wydarzenie) → A nie może podpalić C.
      const st = clone(s);
      st.rng = i;
      const { ctx } = at(st, 5);
      startFire(ctx, a!);
      st.settlement.sites[String(a)]!.fire = 3;
      startFire(ctx, b!, true);
      hours(st, 5, 1);
      expect(isBurning(st, c!)).toBe(false);
      // Dla porównania: B płonie niezależnie (starszy pożar) → A może podpalić C.
      const st2 = clone(s);
      st2.rng = i;
      const ctx2 = at(st2, 5).ctx;
      startFire(ctx2, b!);
      startFire(ctx2, a!);
      st2.settlement.sites[String(a)]!.fire = 3;
      hours(st2, 5, 1);
      if (isBurning(st2, c!)) contrast++;
    }
    expect(contrast).toBeGreaterThan(0);
  });

  it('przy straży pożar się nie przenosi', () => {
    const sim = town();
    const [b, a, c] = hutRow(sim, [-2, 0, 2]);
    staffed(sim, 'firestation');
    const s = sim.state;
    for (let i = 1; i <= 30; i++) {
      const st = clone(s);
      st.rng = i;
      startFire(at(st, 3).ctx, a!);
      const events = hours(st, 3, 6);
      expect(ofType(events, 'fire')).toEqual([]);
      expect(isBurning(st, b!) || isBurning(st, c!)).toBe(false);
    }
  });
});

describe('osada/wydarzenia: awarie', () => {
  it('kandydaci: produkcja i maszyny z obsadą, tylko działające', () => {
    const sim = town();
    const field = placeBuilt(sim, 'allotment');
    const mill = placeBuilt(sim, 'mill');
    placeBuilt(sim, 'tent');
    placeBuilt(sim, 'well');
    placeBuilt(sim, 'composter');
    const s = sim.state;
    expect(breakable(s, CONTENT).map((o) => o.uid)).toEqual([field, mill]);
    startBreakdown(at(s, 8).ctx, field);
    expect(breakable(s, CONTENT).map((o) => o.uid)).toEqual([mill]);
  });

  it('awaria: broken, nie działa, wydarzenie do naprawy', () => {
    const sim = town();
    const mill = placeBuilt(sim, 'mill');
    const s = sim.state;
    const { ctx, events } = at(s, 8);
    expect(startBreakdown(ctx, mill)).toBe(true);
    expect(startBreakdown(ctx, mill)).toBe(false);
    expect(site(s, mill)).toMatchObject({ built: 1, broken: true });
    expect(isOperational(s, mill)).toBe(false);
    expect(ofType(events, 'breakdown')).toEqual([expect.objectContaining({ uid: mill })]);
    expect(activeEvents(s)).toEqual([expect.objectContaining({ kind: 'breakdown', target: mill, untilMs: s.clock.simMs + BREAKDOWN_DAYS * DAY_MS })]);
    expect(s.settlement.chronicle[0]).toMatchObject({ kind: 'breakdown', params: { building: 'mill' } });
    // Trwa, dopóki zepsuty (także po upływie 30 dni).
    hours(s, 8, 1, DAY + BREAKDOWN_DAYS + 1);
    expect(activeEvents(s)).toHaveLength(1);
    site(s, mill).broken = false;
    hours(s, 9, 1, DAY + BREAKDOWN_DAYS + 1);
    expect(s.settlement.events).toEqual([]);
  });

  it('naprawa komendą zdejmuje wydarzenie', () => {
    const sim = town();
    const field = placeBuilt(sim, 'allotment');
    const s = sim.state;
    startBreakdown(at(s, 8).ctx, field);
    ok(sim, { type: 'repair', uid: field });
    expect(activeEvents(s)).toEqual([]);
    expect(isOperational(s, field)).toBe(true);
  });

  it('rozebrany zepsuty budynek: wydarzenie znika', () => {
    const sim = town();
    const field = placeBuilt(sim, 'allotment');
    const s = sim.state;
    startBreakdown(at(s, 8).ctx, field);
    ok(sim, { type: 'remove', uid: field });
    hours(s, 8, 1);
    expect(s.settlement.events).toEqual([]);
  });
});

describe('osada/wydarzenia: epidemie zwierząt', () => {
  it('chore zwierzęta nie produkują, zdrowe tak', () => {
    const sim = town();
    const sick = coopWith(sim, 2);
    const healthy = coopWith(sim, 1);
    const s = sim.state;
    const { ctx, events } = at(s, 8);
    expect(startEpidemic(ctx, sick)).toBe(true);
    expect(startEpidemic(ctx, sick)).toBe(false);
    expect(ofType(events, 'epidemic')).toEqual([expect.objectContaining({ home: sick })]);
    expect(animalHomeSick(s, sick)).toBe(true);
    expect(animalHomeSick(s, healthy)).toBe(false);
    expect(activeEvents(s)[0]!.untilMs).toBe(s.clock.simMs + EPIDEMIC_DAYS * DAY_MS);
    updateAnimals(ctx, HOUR_MS);
    for (const a of s.animals) expect(a.progress > 0).toBe(a.home === healthy);
    expect(s.settlement.chronicle[0]).toMatchObject({ kind: 'epidemic', params: { building: 'coop', days: 3 } });
  });

  it('mija po 3 dniach (epidemicOver + kronika)', () => {
    const sim = town();
    const home = coopWith(sim, 2);
    const s = sim.state;
    startEpidemic(at(s, 8).ctx, home);
    expect(hours(s, 7, 1, DAY + 3)).toEqual([]);
    const events = hours(s, 8, 1, DAY + 3);
    expect(events).toEqual([{ type: 'epidemicOver', home }]);
    expect(animalHomeSick(s, home)).toBe(false);
    expect(s.settlement.events).toEqual([]);
    expect(s.settlement.chronicle[0]).toMatchObject({ kind: 'epidemicOver', params: { building: 'coop' } });
  });

  it('przychodnia z obsadą: 1 dzień, także gdy powstanie w trakcie', () => {
    const sim = town();
    const home = coopWith(sim, 2);
    const s = sim.state;
    startEpidemic(at(s, 8).ctx, home);
    const o = objectByUid(s, home)!;
    staffed(sim, 'clinic');
    expect(coverageAt(s, CONTENT, 'clinic', o.x + 1, o.y + 1)).toBeGreaterThan(0);
    hours(s, 10, 1);
    const now = s.clock.simMs;
    expect(activeEvents(s)[0]!.untilMs).toBe(now + DAY_MS);
    expect(ofType(hours(s, 10, 1, DAY + 1), 'epidemicOver')).toHaveLength(1);
    // Nowa epidemia przy przychodni od razu trwa 1 dzień.
    startEpidemic(at(s, 12, DAY + 2).ctx, home);
    expect(activeEvents(s)[0]!.untilMs).toBe(s.clock.simMs + DAY_MS);
  });

  it('leczenie: wymaga choroby i lekarstwa, zużywa 1 sztukę i kończy epidemię', () => {
    const sim = town();
    const home = coopWith(sim, 2);
    const s = sim.state;
    const { ctx, events } = at(s, 8);
    expect(treatAnimals(ctx, home)).toEqual({ ok: false, reason: 'not-sick' });
    startEpidemic(ctx, home);
    expect(treatAnimals(ctx, home)).toEqual({ ok: false, reason: 'no-medicine' });
    s.inventory.medicine = 2;
    expect(treatAnimals(ctx, home)).toEqual({ ok: true });
    expect(s.inventory.medicine).toBe(1);
    expect(animalHomeSick(s, home)).toBe(false);
    expect(s.settlement.events).toEqual([]);
    expect(ofType(events, 'epidemicOver')).toEqual([{ type: 'epidemicOver', home }]);
    expect(s.settlement.chronicle[0]).toMatchObject({ kind: 'treated', params: { building: 'coop' } });
  });

  it('leczenie komendą gracza', () => {
    const sim = town();
    const home = coopWith(sim, 2);
    const s = sim.state;
    expect(reason(sim, { type: 'treatAnimals', home })).toBe('not-sick');
    startEpidemic(at(s, 8).ctx, home);
    s.inventory.medicine = 1;
    ok(sim, { type: 'treatAnimals', home });
    expect(s.inventory.medicine ?? 0).toBe(0);
    expect(animalHomeSick(s, home)).toBe(false);
  });
});

describe('osada/wydarzenia: kryzys i dobre wydarzenia', () => {
  it('kryzys obniża ceny rynku o 30% na 3 dni', () => {
    const sim = town();
    const s = sim.state;
    const { ctx, events } = at(s, 8);
    const before = unitPrice(ctx, 'radish');
    startCrisis(ctx);
    expect(events).toEqual([{ type: 'crisis', days: 3 }]);
    expect(unitPrice(ctx, 'radish')).toBeCloseTo(before * 0.7, 9);
    expect(hours(s, 7, 1, DAY + 3)).toEqual([]);
    expect(priceMult(s)).toBe(0.7);
    hours(s, 8, 1, DAY + 3);
    expect(priceMult(s)).toBe(1);
    expect(s.settlement.events).toEqual([]);
    expect(s.settlement.chronicle[0]).toMatchObject({ kind: 'eventOver', params: { kind: 'crisis' } });
    expect(unitPrice(at(s, 8, DAY + 3).ctx, 'radish')).toBeCloseTo(before, 9);
  });

  it('festyn: rozrywka +0,15 na 2 dni, ponowny przedłuża zamiast dublować', () => {
    const sim = town();
    const s = sim.state;
    const { ctx, events } = at(s, 8);
    startGoodEvent(ctx, 'festival');
    expect(events).toEqual([{ type: 'goodEvent', kind: 'festival' }]);
    expect(funBoost(s)).toBe(0.15);
    expect(s.settlement.chronicle[0]).toMatchObject({ kind: 'goodEvent', params: { kind: 'festival' } });
    startGoodEvent(at(s, 8, DAY + 1).ctx, 'festival');
    expect(s.settlement.events).toHaveLength(1);
    expect(s.settlement.events[0]!.untilMs).toBe(s.clock.simMs + 2 * DAY_MS);
    hours(s, 8, 1, DAY + 3);
    expect(funBoost(s)).toBe(0);
    expect(s.settlement.events).toEqual([]);
  });

  it('urodzaj: wydajność ×1,25 na 2 dni', () => {
    const sim = town();
    const s = sim.state;
    const r = addResident(s, { happiness: 0.5 });
    const before = productivity(s, CONTENT, r);
    startGoodEvent(at(s, 8).ctx, 'harvest');
    expect(productivity(s, CONTENT, r)).toBeCloseTo(before * 1.25, 9);
    hours(s, 8, 1, DAY + 2);
    expect(productivity(s, CONTENT, r)).toBeCloseTo(before, 9);
  });

  it('bogata karawana: premia ×1,3 do zużycia przez karawanę albo wygaśnięcia', () => {
    const sim = town();
    const s = sim.state;
    startGoodEvent(at(s, 8).ctx, 'richCaravan');
    expect(s.settlement.caravanBonus).toBe(1.3);
    expect(activeEvents(s)).toEqual([expect.objectContaining({ kind: 'richCaravan', untilMs: s.clock.simMs + RICH_CARAVAN_DAYS * DAY_MS })]);
    // Karawana zużyła premię (moduł handlu) → wydarzenie znika.
    s.settlement.caravanBonus = 1;
    hours(s, 9, 1);
    expect(s.settlement.events).toEqual([]);
    // Bez karawany oferta przepada po 7 dniach.
    startGoodEvent(at(s, 8).ctx, 'richCaravan');
    hours(s, 8, 1, DAY + RICH_CARAVAN_DAYS);
    expect(s.settlement.events).toEqual([]);
    expect(s.settlement.caravanBonus).toBe(1);
  });

  it('dobre wydarzenia nie są katastrofą', () => {
    const sim = town();
    const s = sim.state;
    startGoodEvent(at(s, 8).ctx, 'festival');
    expect(catastropheActive(s)).toBe(false);
  });
});

describe('osada/wydarzenia: statystyka i determinizm', () => {
  /** Liczba pożarów wylosowanych w `days` dniach (po każdym pożarze budynki wracają do stanu sprzed). */
  function countFires(s: GameState, days: number): number {
    let fires = 0;
    for (let d = DAY; d < DAY + days; d++) {
      fires += ofType(day(s, d), 'fire').length;
      for (let h = 0; h < 6 && Object.values(s.settlement.sites).some((x) => x.fire > 0); h++) hours(s, h, 1, d);
      for (const x of Object.values(s.settlement.sites)) x.damage = 0;
    }
    return fires;
  }

  it('przy wielu dniach pożary się zdarzają, a ze strażą rzadziej', () => {
    const plain = town();
    tents(plain, 10);
    const guarded = town();
    const station = staffed(guarded, 'firestation');
    tents(guarded, 10);
    for (const o of flammable(guarded.state, CONTENT)) {
      if (o.uid === station) continue;
      expect(coverageAt(guarded.state, CONTENT, 'fire', o.x + 0.5, o.y + 0.5)).toBe(1);
    }
    const without = countFires(plain.state, 1500);
    const withCrew = countFires(guarded.state, 1500);
    expect(without).toBeGreaterThan(20);
    expect(withCrew).toBeLessThan(without * 0.6);
  });

  it('ten sam seed → te same wydarzenia', () => {
    const run = (): string => {
      const sim = town(() => {}, 7);
      tents(sim, 6);
      placeBuilt(sim, 'allotment');
      placeBuilt(sim, 'mill');
      coopWith(sim, 3);
      const s = sim.state;
      const c = withChances({ fire: 0.3, breakdown: 0.3, epidemic: 0.3, crisis: 0.3, good: 0.5 });
      const log: SimEvent[] = [];
      for (let d = DAY; d < DAY + 60; d++) {
        log.push(...day(s, d, c));
        for (let h = 0; h < 24; h++) log.push(...hours(s, h, 1, d));
        if (d % 4 === 0) for (const x of Object.values(s.settlement.sites)) x.broken = false;
      }
      return JSON.stringify({ log, rng: s.rng, events: s.settlement.events, sites: s.settlement.sites, chronicle: s.settlement.chronicle });
    };
    const a = run();
    expect(a).toBe(run());
    expect(JSON.parse(a).log.length).toBeGreaterThan(10);
  });
});
