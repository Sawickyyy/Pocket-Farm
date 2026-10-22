import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTENT } from '../../../src/content/content';
import { EventBus } from '../../../src/core/eventBus';
import { calendarAt } from '../../../src/sim/calendar';
import { makeCtx, type Ctx } from '../../../src/sim/ctx';
import type { SimEvent } from '../../../src/sim/events';
import type { Simulation } from '../../../src/sim/simulation';
import { newSite } from '../../../src/sim/systems/settlement/common';
import { FRIEND_CHANCE, LOVE_CHANCE, LOVE_STEP, partnerOf, relationBetween, relationBonus, relationsOf, socialDay } from '../../../src/sim/systems/settlement/social';
import type { GameState, Relation, Resident } from '../../../src/sim/types';
import { setTime } from '../helpers';
import { addResident, makeTown } from './helpers';

// Wymuszone wyniki kolejnych wywołań `rand` (pusta kolejka = prawdziwy generator ze stanu gry).
const forced = vi.hoisted(() => [] as number[]);
vi.mock('../../../src/sim/ctx', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/sim/ctx')>();
  return { ...mod, rand: (s: GameState) => (forced.length ? forced.shift()! : mod.rand(s)) };
});
beforeEach(() => {
  forced.length = 0;
});

const DAY = 5;

function at(sim: Simulation, day = DAY): { ctx: Ctx; events: SimEvent[] } {
  setTime(sim.state, day, 0);
  const bus = new EventBus<SimEvent>();
  const events: SimEvent[] = [];
  bus.onAny((e) => events.push(e));
  return { ctx: makeCtx(sim.state, bus, calendarAt(sim.state.clock.simMs, sim.state.seed)), events };
}

/** Doba relacji; zwraca zdarzenia. */
function social(sim: Simulation, day = DAY): SimEvent[] {
  const { ctx, events } = at(sim, day);
  socialDay(ctx);
  return events;
}

const relEvents = (events: SimEvent[]) => events.filter((e): e is Extract<SimEvent, { type: 'relation' }> => e.type === 'relation');

/** Budynek postawiony bezpośrednio w stanie (bez sprawdzania miejsca). */
function building(sim: Simulation, type: string, x: number, y: number): number {
  const s = sim.state;
  const uid = s.nextUid++;
  s.objects.push({ uid, type, x, y });
  s.settlement.sites[String(uid)] = newSite(1);
  return uid;
}

/** Dwoje sąsiadów w namiotach o środkach odległych o `dist` kafli (Czebyszew). */
function neighbors(dist = 4, patchA: Partial<Resident> = {}, patchB: Partial<Resident> = {}) {
  const sim = makeTown();
  const s = sim.state;
  const ha = building(sim, 'tent', 26, 26);
  const hb = building(sim, 'tent', 26 + dist, 27);
  const a = addResident(s, { home: ha, name: 'Ala Nowak', ...patchA });
  const b = addResident(s, { home: hb, name: 'Bartek Lis', ...patchB });
  return { sim, s, a, b, ha, hb };
}

const rel = (a: Resident, b: Resident, kind: Relation['kind'], v: number): Relation => ({ a: Math.min(a.id, b.id), b: Math.max(a.id, b.id), kind, v });

describe('osada: przyjaźnie', () => {
  it('sąsiedzi (≤ 4 kafle) zaprzyjaźniają się z szansą FRIEND_CHANCE', () => {
    const { sim, s, a, b } = neighbors(4);
    forced.push(FRIEND_CHANCE - 0.001);
    const events = social(sim);
    expect(s.settlement.relations).toEqual([{ a: a.id, b: b.id, kind: 'friend', v: 0.2 }]);
    expect(relEvents(events)).toEqual([{ type: 'relation', kind: 'friend', a: a.id, b: b.id }]);
  });

  it('rzut ≥ FRIEND_CHANCE – brak przyjaźni', () => {
    const { sim, s } = neighbors(4);
    forced.push(FRIEND_CHANCE);
    expect(social(sim)).toEqual([]);
    expect(s.settlement.relations).toEqual([]);
  });

  it('5 kafli i różna praca – brak kontaktu (bez losowania)', () => {
    const { sim, s } = neighbors(5);
    const rng = s.rng;
    social(sim);
    expect(s.settlement.relations).toEqual([]);
    expect(s.rng).toBe(rng);
  });

  it('współpracownicy zaprzyjaźniają się, także bez domu', () => {
    const sim = makeTown();
    const s = sim.state;
    const a = addResident(s, { job: 77 });
    const b = addResident(s, { job: 77 });
    addResident(s, { job: 78 });
    forced.push(FRIEND_CHANCE / 2);
    social(sim);
    expect(s.settlement.relations).toEqual([{ a: a.id, b: b.id, kind: 'friend', v: 0.2 }]);
  });

  it('członkowie tej samej rodziny nie nawiązują relacji', () => {
    const { sim, s } = neighbors(0, { family: 3 }, { family: 3 });
    const rng = s.rng;
    social(sim);
    expect(s.settlement.relations).toEqual([]);
    expect(s.rng).toBe(rng);
  });

  it('istniejąca przyjaźń rośnie o 0,2 (najwyżej do 1)', () => {
    const { sim, s, a, b } = neighbors(2);
    s.settlement.relations.push(rel(a, b, 'friend', 0.2));
    forced.push(FRIEND_CHANCE / 2);
    social(sim);
    expect(s.settlement.relations[0]!.v).toBe(0.4);
    s.settlement.relations[0]!.v = 0.9;
    forced.push(FRIEND_CHANCE / 2, 0.99); // wzrost, nieudany rzut na miłość
    social(sim, DAY + 1);
    expect(s.settlement.relations[0]).toMatchObject({ kind: 'friend', v: 1 });
  });

  it('przyjaźń bez kontaktu słabnie o 0,05 dziennie i znika', () => {
    const { sim, s, a, b } = neighbors(10);
    s.settlement.relations.push(rel(a, b, 'friend', 0.1));
    social(sim);
    expect(s.settlement.relations[0]!.v).toBe(0.05);
    social(sim, DAY + 1);
    expect(s.settlement.relations).toEqual([]);
  });

  it('przyjaźń z kontaktem nie słabnie', () => {
    const { sim, s, a, b } = neighbors(1);
    s.settlement.relations.push(rel(a, b, 'friend', 0.2));
    forced.push(0.99);
    social(sim);
    expect(s.settlement.relations[0]!.v).toBe(0.2);
  });

  it('limit relacji na osobę (maxRelations) przy tworzeniu nowych', () => {
    const { sim, s, a, b } = neighbors(1);
    const max = CONTENT.settlement.constants.maxRelations;
    for (let i = 0; i < max; i++) {
      const far = addResident(s); // bez domu i pracy – brak kontaktu
      s.settlement.relations.push(rel(a, far, 'friend', 1));
    }
    forced.push(0, 0);
    social(sim);
    expect(relationsOf(s, a.id)).toHaveLength(max);
    expect(relationBetween(s, a.id, b.id)).toBeUndefined();
    expect(forced).toEqual([0, 0]); // para pominięta bez losowania
    // b (bez limitu) wciąż może poznać kogoś nowego.
    const c = addResident(s, { home: b.home });
    forced.push(0);
    social(sim, DAY + 1);
    expect(relationBetween(s, c.id, b.id)?.kind).toBe('friend');
  });

  it('relacje zawsze mają a < b i nie powtarzają się', () => {
    const sim = makeTown();
    const s = sim.state;
    const homes = [0, 1, 2, 3].map((i) => building(sim, 'hut', 26 + i * 2, 26));
    for (let i = 0; i < 16; i++) addResident(s, { home: homes[i % 4]!, job: 100 + (i % 3), happiness: i % 5 === 0 ? 0.2 : 0.8 });
    for (let d = 0; d < 40; d++) social(sim, DAY + d);
    const rs = s.settlement.relations;
    expect(rs.length).toBeGreaterThan(0);
    for (const r of rs) expect(r.a).toBeLessThan(r.b);
    expect(new Set(rs.map((r) => `${r.a}:${r.b}`)).size).toBe(rs.length);
    for (const r of s.settlement.residents) expect(relationsOf(s, r.id).length).toBeLessThanOrEqual(CONTENT.settlement.constants.maxRelations);
  });
});

describe('osada: miłość i śluby', () => {
  it('przyjaciele (v ≥ 0,6), dorośli, bez partnerów → miłość z szansą LOVE_CHANCE', () => {
    const { sim, s, a, b } = neighbors(2);
    s.settlement.relations.push(rel(a, b, 'friend', 0.6));
    forced.push(0.99, LOVE_CHANCE - 0.001); // bez wzrostu przyjaźni, udany rzut na miłość
    const events = social(sim);
    expect(s.settlement.relations[0]).toMatchObject({ kind: 'love', v: 0.6 });
    expect(relEvents(events)).toEqual([{ type: 'relation', kind: 'love', a: a.id, b: b.id }]);
  });

  it('za słaba przyjaźń, dziecko albo ktoś po ślubie – bez miłości (i bez rzutu)', () => {
    const weak = neighbors(2);
    weak.s.settlement.relations.push(rel(weak.a, weak.b, 'friend', 0.2));
    forced.push(0.99, 0);
    social(weak.sim);
    expect([weak.s.settlement.relations[0]!.kind, forced]).toEqual(['friend', [0]]);

    forced.length = 0;
    const kid = neighbors(2, {}, { child: true, bornDay: DAY });
    kid.s.settlement.relations.push(rel(kid.a, kid.b, 'friend', 0.8));
    forced.push(0.99, 0);
    social(kid.sim);
    expect([kid.s.settlement.relations[0]!.kind, forced]).toEqual(['friend', [0]]);

    forced.length = 0;
    const married = neighbors(2);
    const spouse = addResident(married.s); // daleko – bez kontaktu
    married.s.settlement.relations.push(rel(married.a, married.b, 'friend', 0.8), rel(married.a, spouse, 'partner', 1));
    forced.push(0.99, 0);
    social(married.sim);
    expect([relationBetween(married.s, married.a.id, married.b.id)!.kind, forced]).toEqual(['friend', [0]]);
  });

  it('jedna miłość naraz', () => {
    const sim = makeTown();
    const s = sim.state;
    const h = building(sim, 'hut', 26, 26);
    const a = addResident(s, { home: h });
    const b = addResident(s, { home: h });
    const c = addResident(s, { home: h });
    s.settlement.relations.push(rel(a, b, 'friend', 0.8), rel(a, c, 'friend', 0.8), rel(b, c, 'friend', 0.8));
    forced.push(0.99, 0, 0.99, 0, 0.99, 0);
    social(sim);
    const loves = s.settlement.relations.filter((r) => r.kind === 'love');
    expect(loves).toEqual([{ a: a.id, b: b.id, kind: 'love', v: 0.8 }]);
  });

  it('miłość rośnie o LOVE_STEP dziennie; przy v ≥ 1 ślub (wspólna rodzina, kronika, zdarzenie)', () => {
    const { sim, s, a, b, ha } = neighbors(2);
    s.objects.find((o) => o.uid === ha)!.type = 'house'; // u a jest miejsce
    s.settlement.relations.push(rel(a, b, 'love', 0.95 - LOVE_STEP));
    expect(social(sim)).toEqual([]);
    expect(s.settlement.relations[0]!.kind).toBe('love');
    expect(s.settlement.relations[0]!.v).toBeCloseTo(0.95, 9);
    const events = social(sim, DAY + 1);
    expect(s.settlement.relations[0]).toEqual({ a: a.id, b: b.id, kind: 'partner', v: 1 });
    expect(relEvents(events)).toEqual([{ type: 'relation', kind: 'partner', a: a.id, b: b.id }]);
    expect(b.family).toBe(a.family);
    expect(b.home).toBe(a.home);
    expect(partnerOf(s, a.id)).toBe(b.id);
    expect(partnerOf(s, b.id)).toBe(a.id);
    expect(s.settlement.stats.weddings).toBe(1);
    expect(s.settlement.chronicle[0]).toMatchObject({ kind: 'wedding', params: { a: 'Ala Nowak', b: 'Bartek Lis' } });
    expect(relationBonus(s, a.id)).toBeCloseTo(0.05, 9);
  });

  it('ślub: b z dziećmi przenosi się do domu a, gdy jest tam miejsce', () => {
    const sim = makeTown();
    const s = sim.state;
    const big = building(sim, 'house', 26, 26);
    const tent = building(sim, 'tent', 29, 26);
    const a = addResident(s, { home: big, family: 1 });
    const b = addResident(s, { home: tent, family: 2 });
    const kid = addResident(s, { home: tent, family: 2, child: true, bornDay: DAY });
    s.settlement.relations.push(rel(a, b, 'love', 0.9));
    social(sim);
    expect([b.home, kid.home]).toEqual([big, big]);
    expect([b.family, kid.family]).toEqual([1, 1]);
  });

  it('ślub: gdy u a brak miejsca, a z dziećmi przenosi się do domu b', () => {
    const sim = makeTown();
    const s = sim.state;
    const tent = building(sim, 'tent', 26, 26);
    const big = building(sim, 'house', 29, 26);
    const a = addResident(s, { home: tent, family: 1 });
    const kid = addResident(s, { home: tent, family: 1, child: true, bornDay: DAY });
    const b = addResident(s, { home: big, family: 2 });
    s.settlement.relations.push(rel(a, b, 'love', 0.9));
    social(sim);
    expect([a.home, kid.home, b.home]).toEqual([big, big, big]);
    expect(b.family).toBe(1);
  });

  it('ślub bez miejsca w żadnym z domów – mieszkają osobno, ale są rodziną', () => {
    const sim = makeTown();
    const s = sim.state;
    const t1 = building(sim, 'tent', 26, 26);
    const t2 = building(sim, 'tent', 28, 26);
    const a = addResident(s, { home: t1, family: 1 });
    addResident(s, { home: t1, family: 1, child: true, bornDay: DAY });
    const b = addResident(s, { home: t2, family: 2 });
    const kidB = addResident(s, { home: t2, family: 2, child: true, bornDay: DAY });
    s.settlement.relations.push(rel(a, b, 'love', 0.9));
    social(sim);
    expect(s.settlement.relations[0]!.kind).toBe('partner');
    expect([a.home, b.home, kidB.home]).toEqual([t1, t2, t2]);
    expect([b.family, kidB.family]).toEqual([1, 1]);
  });

  it('dzieci b zostają w starej rodzinie, gdy jest w niej inny dorosły', () => {
    const sim = makeTown();
    const s = sim.state;
    const big = building(sim, 'manor', 26, 26);
    const hut = building(sim, 'hut', 30, 26);
    const a = addResident(s, { home: big, family: 1 });
    const b = addResident(s, { home: hut, family: 2 });
    const b2 = addResident(s, { home: hut, family: 2 });
    const kid = addResident(s, { home: hut, family: 2, child: true, bornDay: DAY });
    s.settlement.relations.push(rel(a, b, 'love', 0.9));
    social(sim);
    expect([b.family, b2.family, kid.family]).toEqual([1, 2, 2]);
    expect([b.home, b2.home, kid.home]).toEqual([big, hut, hut]);
  });
});

describe('osada: konflikty', () => {
  const unhappy = { happiness: 0.3 };

  it('nieszczęśliwi sąsiedzi kłócą się z szansą 0,1', () => {
    const { sim, s, a, b } = neighbors(3, unhappy, unhappy);
    forced.push(0.099);
    const events = social(sim);
    expect(s.settlement.relations).toEqual([{ a: a.id, b: b.id, kind: 'conflict', v: 0.3 }]);
    expect(relEvents(events)).toEqual([{ type: 'relation', kind: 'conflict', a: a.id, b: b.id }]);
    expect(relationBonus(s, a.id)).toBeCloseTo(-0.05, 9);
  });

  it('posterunek w zasięgu domu zmniejsza szansę o połowę', () => {
    const withPolice = neighbors(3, unhappy, unhappy);
    const station = building(withPolice.sim, 'police', 30, 30);
    addResident(withPolice.s, { job: station }); // strażnik bez domu – obsada 1/2
    forced.push(0.07, 0.99); // 0,07 ≥ 0,05 → bez konfliktu; potem nieudany rzut na przyjaźń
    social(withPolice.sim);
    expect(withPolice.s.settlement.relations).toEqual([]);

    const without = neighbors(3, unhappy, unhappy);
    forced.length = 0;
    forced.push(0.07);
    social(without.sim);
    expect(without.s.settlement.relations[0]!.kind).toBe('conflict');
  });

  it('szczęście ≥ 0,35 – zamiast konfliktu rzut na przyjaźń', () => {
    const { sim, s } = neighbors(3, { happiness: 0.35 }, unhappy);
    forced.push(0.01);
    social(sim);
    expect(s.settlement.relations[0]!.kind).toBe('friend');
  });

  it('nieszczęśliwi współpracownicy, którzy nie są sąsiadami, się nie kłócą', () => {
    const { sim, s } = neighbors(10, { ...unhappy, job: 50 }, { ...unhappy, job: 50 });
    forced.push(0.01);
    social(sim);
    expect(s.settlement.relations[0]!.kind).toBe('friend');
  });

  it('konflikt narasta o 0,3; przekroczenie 1 trafia do kroniki (raz)', () => {
    const { sim, s, a, b } = neighbors(3, unhappy, unhappy);
    s.settlement.relations.push(rel(a, b, 'conflict', 0.3));
    forced.push(0.05);
    social(sim);
    expect(s.settlement.relations[0]!.v).toBe(0.6);
    s.settlement.relations[0]!.v = 0.8;
    forced.push(0.05);
    social(sim, DAY + 1);
    expect(s.settlement.relations[0]!.v).toBe(1);
    expect(s.settlement.chronicle[0]).toMatchObject({ kind: 'quarrel', params: { a: 'Ala Nowak', b: 'Bartek Lis' } });
    forced.push(0.05);
    social(sim, DAY + 2);
    expect(s.settlement.chronicle.filter((e) => e.kind === 'quarrel')).toHaveLength(1);
  });

  it('konflikt gaśnie o 0,1 dziennie, gdy oboje mają szczęście ≥ 0,5', () => {
    const { sim, s, a, b } = neighbors(3, { happiness: 0.5 }, { happiness: 0.6 });
    s.settlement.relations.push(rel(a, b, 'conflict', 0.3));
    const rng = s.rng;
    social(sim);
    expect(s.settlement.relations[0]!.v).toBe(0.2);
    social(sim, DAY + 1);
    social(sim, DAY + 2);
    expect(s.settlement.relations).toEqual([]);
    expect(s.rng).toBe(rng); // istniejący konflikt nie losuje przyjaźni
  });

  it('konflikt nie gaśnie, gdy ktoś jest smutny', () => {
    const { sim, s, a, b } = neighbors(10, { happiness: 0.6 }, { happiness: 0.45 });
    s.settlement.relations.push(rel(a, b, 'conflict', 0.3));
    social(sim);
    expect(s.settlement.relations[0]!.v).toBe(0.3);
  });
});

describe('osada: relacje – porządek, determinizm, wydajność', () => {
  /** Osada z `n` mieszkańcami w siatce chat i kilkoma miejscami pracy. */
  function crowd(n: number, seed = 42): Simulation {
    const sim = makeTown(() => {}, seed);
    const s = sim.state;
    const homes: number[] = [];
    for (let i = 0; homes.length * 3 < n; i++) homes.push(building(sim, 'hut', 2 + (i % 20) * 3, 2 + Math.floor(i / 20) * 3));
    for (let i = 0; i < n; i++) {
      addResident(s, {
        home: homes[Math.floor(i / 3)]!,
        job: i % 4 === 0 ? null : 1000 + (i % 17),
        happiness: 0.2 + ((i * 37) % 70) / 100,
        child: i % 9 === 0,
        bornDay: i % 9 === 0 ? DAY : -1,
      });
    }
    return sim;
  }

  it('relacje osób, których już nie ma, są usuwane', () => {
    const { sim, s, a } = neighbors(10);
    s.settlement.relations.push({ a: a.id, b: 9999, kind: 'friend', v: 1 });
    social(sim);
    expect(s.settlement.relations).toEqual([]);
  });

  it('ten sam seed → te same relacje, śluby i stan generatora', () => {
    const run = (seed: number) => {
      const sim = crowd(40, seed);
      for (let d = 0; d < 40; d++) social(sim, DAY + d);
      return JSON.stringify({ rel: sim.state.settlement.relations, res: sim.state.settlement.residents, rng: sim.state.rng, stats: sim.state.settlement.stats });
    };
    const a = run(3);
    expect(a).toBe(run(3));
    expect(a).not.toBe(run(4));
    expect(JSON.parse(a).rel.length).toBeGreaterThan(0);
  });

  it('200 mieszkańców: doba relacji mieści się w kilku milisekundach', () => {
    const sim = crowd(200);
    social(sim); // rozgrzewka
    const t0 = performance.now();
    for (let d = 1; d <= 10; d++) social(sim, DAY + d);
    const perDay = (performance.now() - t0) / 10;
    expect(perDay).toBeLessThan(25);
    expect(sim.state.settlement.relations.length).toBeGreaterThan(100);
  });
});
