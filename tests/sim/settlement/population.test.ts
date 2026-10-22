import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTENT } from '../../../src/content/content';
import { EventBus } from '../../../src/core/eventBus';
import { calendarAt } from '../../../src/sim/calendar';
import { makeCtx, type Ctx } from '../../../src/sim/ctx';
import type { SimEvent } from '../../../src/sim/events';
import type { Simulation } from '../../../src/sim/simulation';
import { centerOf, newSite, objectByUid } from '../../../src/sim/systems/settlement/common';
import {
  arrivalBlock,
  familiesToArrive,
  freeHousingTotal,
  housingCapacity,
  populationDay,
  populationHour,
  surnameOf,
} from '../../../src/sim/systems/settlement/population';
import { socialDay } from '../../../src/sim/systems/settlement/social';
import type { GameState, Resident } from '../../../src/sim/types';
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
const HOUR = CONTENT.settlement.constants.arrivalHour;
const NAMES = CONTENT.settlement.names;

/** Kontekst na dany dzień/godzinę (bez kroku symulacji) ze zbieraniem zdarzeń. */
function at(sim: Simulation, hour = HOUR, day = DAY): { ctx: Ctx; events: SimEvent[] } {
  setTime(sim.state, day, hour);
  const bus = new EventBus<SimEvent>();
  const events: SimEvent[] = [];
  bus.onAny((e) => events.push(e));
  return { ctx: makeCtx(sim.state, bus, calendarAt(sim.state.clock.simMs, sim.state.seed)), events };
}

const ofType = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

/** Dom postawiony bezpośrednio w stanie (bez sprawdzania miejsca); `built < 1` = w budowie. */
function house(sim: Simulation, type: string, x: number, y: number, built = 1): number {
  const s = sim.state;
  const uid = s.nextUid++;
  s.objects.push({ uid, type, x, y });
  s.settlement.sites[String(uid)] = newSite(built);
  return uid;
}

const arrive = (sim: Simulation, hour = HOUR, day = DAY): SimEvent[] => {
  const { ctx, events } = at(sim, hour, day);
  populationHour(ctx, hour);
  return events;
};

const day = (sim: Simulation, d = DAY): SimEvent[] => {
  const { ctx, events } = at(sim, 0, d);
  populationDay(ctx);
  return events;
};

const ids = (s: GameState): number[] => s.settlement.residents.map((r) => r.id);
const byFamily = (s: GameState): Map<number, Resident[]> => {
  const out = new Map<number, Resident[]>();
  for (const r of s.settlement.residents) out.set(r.family, [...(out.get(r.family) ?? []), r]);
  return out;
};

describe('osada: napływ rodzin', () => {
  it('pusta osada: o 9:00 przyjeżdżają rodziny do domu z największą liczbą wolnych miejsc', () => {
    const sim = makeTown(() => {}, 42, 0);
    const s = sim.state;
    const big = house(sim, 'house', 26, 26); // 5 miejsc
    const hut = house(sim, 'hut', 30, 26); // 3 miejsca
    // Pusta osada: średnie szczęście = 1 → 1 + 1 + floor(0 / 2) = 2 rodziny. Pierwsza: 2 dorosłych + 2 dzieci.
    forced.push(0.99, 0.99);
    const events = arrive(sim);
    const arrived = ofType(events, 'arrived');
    expect(arrived).toHaveLength(2);
    expect(arrived[0]).toMatchObject({ count: 4, home: big, at: centerOf(CONTENT, objectByUid(s, big)!) });
    expect(arrived[1]!.home).toBe(hut); // w dużym domu zostało 1 miejsce, w chacie 3
    const first = s.settlement.residents.filter((r) => r.family === arrived[0]!.family);
    expect(first.map((r) => r.child)).toEqual([false, false, true, true]);
    expect(first.every((r) => r.home === big)).toBe(true);
    const total = arrived[0]!.count + arrived[1]!.count;
    expect(s.settlement.residents).toHaveLength(total);
    expect(s.settlement.stats.arrived).toBe(total);
    expect(s.settlement.foundedDay).toBe(DAY);
    const entries = s.settlement.chronicle.filter((e) => e.kind === 'arrived');
    expect(entries).toHaveLength(2);
    expect(entries.at(-1)!.params).toEqual({ family: surnameOf(first[0]!.name), count: 4 });
    expect(entries.at(-1)).toMatchObject({ day: DAY, hour: HOUR });
  });

  it('poza godziną przyjazdu nikt nie przyjeżdża', () => {
    const sim = makeTown(() => {}, 42, 0);
    house(sim, 'house', 26, 26);
    expect(arrive(sim, HOUR - 1)).toEqual([]);
    expect(arrive(sim, HOUR + 1)).toEqual([]);
    expect(sim.state.settlement.residents).toEqual([]);
    expect(sim.state.settlement.foundedDay).toBe(-1);
  });

  it('brak wolnych miejsc: domy pełne, w budowie albo uszkodzone', () => {
    const sim = makeTown((s) => (s.inventory.bread = 50), 42, 0);
    const s = sim.state;
    house(sim, 'house', 26, 26, 0.5); // w budowie
    const tent = house(sim, 'tent', 30, 26);
    s.settlement.sites[String(tent)]!.damage = 0.6; // uszkodzony
    const hut = house(sim, 'hut', 34, 26);
    for (let i = 0; i < 3; i++) addResident(s, { home: hut });
    expect(arrivalBlock(s, CONTENT)).toBe('housing');
    expect(arrive(sim)).toEqual([]);
    expect(s.settlement.residents).toHaveLength(3);
  });

  it('średnie szczęście < 0,45 blokuje przyjazd', () => {
    const sim = makeTown((s) => (s.inventory.bread = 50), 42, 0);
    const s = sim.state;
    const tent = house(sim, 'tent', 26, 26);
    house(sim, 'house', 30, 26);
    const r = addResident(s, { home: tent, happiness: 0.44 });
    expect(arrivalBlock(s, CONTENT)).toBe('unhappy');
    expect(arrive(sim)).toEqual([]);
    r.happiness = 0.45;
    expect(arrivalBlock(s, CONTENT)).toBeNull();
    expect(ofType(arrive(sim), 'arrived').length).toBeGreaterThan(0);
  });

  it('za mało jedzenia (< 2 pkt na mieszkańca) blokuje przyjazd; pusta osada – bez warunku', () => {
    const sim = makeTown(() => {}, 42, 0);
    const s = sim.state;
    const hut = house(sim, 'hut', 26, 26);
    house(sim, 'house', 30, 26);
    expect(arrivalBlock(s, CONTENT)).toBeNull(); // pusta osada, brak jedzenia
    for (let i = 0; i < 3; i++) addResident(s, { home: hut });
    s.inventory.bread = 1; // 4 pkt < 6
    expect(arrivalBlock(s, CONTENT)).toBe('hungry');
    expect(arrive(sim)).toEqual([]);
    s.settlement.reserved = ['bread'];
    s.inventory.bread = 10; // zarezerwowane – nie liczy się
    expect(arrivalBlock(s, CONTENT)).toBe('hungry');
    s.settlement.reserved = [];
    s.inventory.bread = 2; // 8 pkt ≥ 6
    expect(ofType(arrive(sim), 'arrived').length).toBeGreaterThan(0);
  });

  it('liczba rodzin: 1 + (szczęście > 0,7) + floor(peakTier / 2)', () => {
    const sim = makeTown((s) => (s.inventory.bread = 500), 42, 0);
    const s = sim.state;
    const tent = house(sim, 'tent', 26, 26);
    const r = addResident(s, { home: tent, happiness: 0.7 });
    expect(familiesToArrive(s)).toBe(1);
    r.happiness = 0.71;
    expect(familiesToArrive(s)).toBe(2);
    s.settlement.peakTier = 3;
    expect(familiesToArrive(s)).toBe(3);
    s.settlement.peakTier = 4;
    expect(familiesToArrive(s)).toBe(4);
    // Dużo miejsca: przyjeżdżają 4 rodziny.
    for (let i = 0; i < 4; i++) house(sim, 'manor', 26 + i * 4, 32);
    const arrived = ofType(arrive(sim), 'arrived');
    expect(arrived).toHaveLength(4);
    expect(new Set(arrived.map((e) => e.family)).size).toBe(4);
    expect(byFamily(s).size).toBe(5);
  });

  it('rodzina mieści się w jednym domu: najpierw ubywa dzieci, zostaje co najmniej 1 dorosły', () => {
    // Namiot (2 miejsca): wylosowane 2 + 2 → 2 dorosłych bez dzieci; druga rodzina nie ma już miejsca.
    const a = makeTown(() => {}, 42, 0);
    const tentA = house(a, 'tent', 26, 26);
    forced.push(0.99, 0.99);
    const evA = ofType(arrive(a), 'arrived');
    expect(evA).toHaveLength(1);
    expect(a.state.settlement.residents.map((r) => [r.child, r.home])).toEqual([
      [false, tentA],
      [false, tentA],
    ]);
    // Jedno wolne miejsce: tylko 1 dorosły.
    const b = makeTown((s) => (s.inventory.bread = 10), 42, 0);
    const tentB = house(b, 'tent', 26, 26);
    addResident(b.state, { home: tentB });
    forced.push(0.99, 0.99);
    expect(ofType(arrive(b), 'arrived').map((e) => e.count)).toEqual([1]);
    expect(b.state.settlement.residents.filter((r) => r.home === tentB)).toHaveLength(2);
    // 1 dorosły + 0 dzieci, gdy tak wypadnie losowanie.
    const c = makeTown(() => {}, 42, 0);
    house(c, 'manor', 26, 26);
    forced.push(0.2, 0.2);
    expect(ofType(arrive(c), 'arrived')[0]!.count).toBe(1);
  });

  it('remis wolnych miejsc: wygrywa dom o mniejszym uid (niezależnie od kolejności obiektów)', () => {
    const sim = makeTown(() => {}, 42, 0);
    const s = sim.state;
    const first = house(sim, 'hut', 26, 26);
    const second = house(sim, 'hut', 30, 26);
    s.objects.reverse();
    forced.push(0.99, 0.99); // 4 osoby → zmniejszone do 3
    const arrived = ofType(arrive(sim), 'arrived');
    expect(arrived[0]).toMatchObject({ home: first, count: 3 });
    expect(arrived[1]!.home).toBe(second);
  });

  it('dane przybyszów: imię i wspólne nazwisko, wygląd, potrzeby, wiek dzieci', () => {
    const sim = makeTown(() => {}, 7, 0);
    const s = sim.state;
    const manor = house(sim, 'manor', 26, 26);
    forced.push(0.99, 0.99);
    const [ev] = ofType(arrive(sim), 'arrived');
    const family = s.settlement.residents.filter((r) => r.family === ev!.family);
    expect(family).toHaveLength(4);
    const surnames = new Set(family.map((r) => surnameOf(r.name)));
    expect(surnames.size).toBe(1);
    expect(NAMES.family).toContain([...surnames][0]);
    const given = family.map((r) => r.name.split(' ')[0]!);
    for (const g of given) expect(NAMES.given).toContain(g);
    expect(new Set(given).size).toBe(4); // bez powtórzeń w rodzinie
    for (const r of family) {
      expect(Number.isInteger(r.look) && r.look >= 0 && r.look < 8).toBe(true);
      expect(r.needs).toEqual({ food: 0.7, housing: 0.7, work: 0.7, safety: 0.7, fun: 0.7 });
      expect(r).toMatchObject({ happiness: 0.7, sadDays: 0, homelessDays: 0, arrivedDay: DAY, home: manor, job: null });
      expect(r.meals).toEqual({ eaten: 0, due: 0, kinds: [] });
      expect(r.mood).toEqual({ value: 0, untilDay: -1 });
      if (r.child) {
        expect(r.bornDay).toBeLessThanOrEqual(DAY);
        expect(r.bornDay).toBeGreaterThan(DAY - 8); // wiek 0..7 dni (< childDays × 0,8)
      } else expect(r.bornDay).toBe(-1);
    }
    // Id rodziny i mieszkańców pochodzą z jednego licznika – są różne.
    expect(new Set([ev!.family, ...family.map((r) => r.id)]).size).toBe(5);
  });

  it('foundedDay ustawiany tylko przy pierwszym przyjeździe', () => {
    const sim = makeTown((s) => (s.inventory.bread = 100), 42, 0);
    house(sim, 'tent', 26, 26);
    house(sim, 'manor', 30, 26);
    arrive(sim, HOUR, DAY);
    expect(sim.state.settlement.foundedDay).toBe(DAY);
    arrive(sim, HOUR, DAY + 1);
    expect(sim.state.settlement.foundedDay).toBe(DAY);
  });

  it('determinizm: ten sam seed → te same rodziny', () => {
    const run = (seed: number) => {
      const sim = makeTown(() => {}, seed, 2);
      house(sim, 'manor', 26, 26);
      house(sim, 'house', 30, 26);
      house(sim, 'hut', 34, 26);
      arrive(sim);
      return JSON.stringify({ r: sim.state.settlement.residents, rng: sim.state.rng });
    };
    expect(run(11)).toBe(run(11));
    expect(run(11)).not.toBe(run(12));
  });
});

describe('osada: dorastanie', () => {
  it('dziecko dorasta po childDays dniach (grewUp + kronika)', () => {
    const sim = makeTown();
    const s = sim.state;
    const h = house(sim, 'house', 26, 26);
    const old = addResident(s, { home: h, child: true, bornDay: DAY - 10, name: 'Iga Lis' });
    const young = addResident(s, { home: h, child: true, bornDay: DAY - 9 });
    const events = day(sim);
    expect(old.child).toBe(false);
    expect(young.child).toBe(true);
    expect(ofType(events, 'grewUp')).toEqual([{ type: 'grewUp', id: old.id }]);
    expect(s.settlement.chronicle[0]).toMatchObject({ kind: 'grewUp', params: { name: 'Iga Lis' } });
  });
});

describe('osada: bezdomni i przeprowadzki', () => {
  it('bezdomna rodzina wprowadza się razem do domu z wystarczającą liczbą miejsc', () => {
    const sim = makeTown();
    const s = sim.state;
    house(sim, 'tent', 26, 26); // 2 – za mało
    const hut = house(sim, 'hut', 30, 26); // 3
    const fam = 500;
    const members = [
      addResident(s, { family: fam, homelessDays: 1 }),
      addResident(s, { family: fam, homelessDays: 1 }),
      addResident(s, { family: fam, child: true, bornDay: DAY }),
    ];
    day(sim);
    expect(members.map((r) => r.home)).toEqual([hut, hut, hut]);
    expect(members.map((r) => r.homelessDays)).toEqual([0, 0, 0]);
    expect(s.settlement.residents).toHaveLength(3);
  });

  it('gdy cała rodzina się nie mieści – zostaje bez domu, licznik dób rośnie', () => {
    const sim = makeTown();
    const s = sim.state;
    house(sim, 'tent', 26, 26);
    const members = [0, 1, 2].map((i) => addResident(s, { family: 500, child: i === 2, bornDay: DAY }));
    day(sim);
    expect(members.map((r) => [r.home, r.homelessDays])).toEqual([
      [null, 1],
      [null, 1],
      [null, 1],
    ]);
  });

  it('uszkodzony dom: mieszkańcy przenoszą się do wolnego domu', () => {
    const sim = makeTown();
    const s = sim.state;
    const burnt = house(sim, 'hut', 26, 26);
    const other = house(sim, 'hut', 30, 26);
    const a = addResident(s, { home: burnt, family: 9 });
    const b = addResident(s, { home: burnt, family: 9 });
    s.settlement.sites[String(burnt)]!.damage = 0.7;
    day(sim);
    expect([a.home, b.home]).toEqual([other, other]);
  });

  it('uszkodzony dom bez innego miejsca: bezdomni (licznik rośnie), po naprawie wracają', () => {
    const sim = makeTown();
    const s = sim.state;
    const burnt = house(sim, 'hut', 26, 26);
    const a = addResident(s, { home: burnt, family: 4 });
    const b = addResident(s, { home: burnt, family: 4 });
    s.settlement.sites[String(burnt)]!.damage = 0.7;
    day(sim);
    expect([a.home, a.homelessDays, b.home, b.homelessDays]).toEqual([null, 1, null, 1]);
    s.settlement.sites[String(burnt)]!.damage = 0; // naprawa
    day(sim, DAY + 1);
    expect([a.home, a.homelessDays, b.home, b.homelessDays]).toEqual([burnt, 0, burnt, 0]);
  });

  it('dom usunięty z mapy: odwołanie czyszczone, gdy nie ma gdzie się przenieść', () => {
    const sim = makeTown();
    const a = addResident(sim.state, { home: 999 });
    day(sim);
    expect([a.home, a.homelessDays]).toEqual([null, 1]);
  });

  it('bezdomne dziecko wraca do domu rodzica, jeśli jest tam miejsce', () => {
    const sim = makeTown();
    const s = sim.state;
    const tent = house(sim, 'tent', 26, 26);
    house(sim, 'manor', 30, 26); // więcej miejsca, ale rodzina woli mieszkać razem
    addResident(s, { home: tent, family: 3 });
    const kid = addResident(s, { family: 3, child: true, bornDay: DAY });
    day(sim);
    expect(kid.home).toBe(tent);
  });

  it('mieszkańcy z domem mają homelessDays = 0 (i nie wyjeżdżają z tego powodu)', () => {
    const sim = makeTown();
    const h = house(sim, 'hut', 26, 26);
    const r = addResident(sim.state, { home: h, homelessDays: 5 });
    day(sim);
    expect(r.homelessDays).toBe(0);
    expect(sim.state.settlement.residents).toContain(r);
  });
});

describe('osada: wyjazdy', () => {
  it('dorosły smutny ≥ 3 doby wyjeżdża razem z dziećmi', () => {
    const sim = makeTown();
    const s = sim.state;
    const h = house(sim, 'house', 26, 26);
    const sad = addResident(s, { home: h, family: 1, sadDays: 3 });
    addResident(s, { home: h, family: 1, child: true, bornDay: DAY });
    addResident(s, { home: h, family: 1, child: true, bornDay: DAY });
    const stays = addResident(s, { home: h, family: 2 });
    const stayingKid = addResident(s, { home: h, family: 2, child: true, bornDay: DAY });
    s.settlement.relations.push({ a: sad.id, b: stays.id, kind: 'friend', v: 0.5 });
    const events = day(sim);
    expect(ids(s)).toEqual([stays.id, stayingKid.id]);
    expect(ofType(events, 'left')).toEqual([{ type: 'left', count: 3, reason: 'unhappy' }]);
    expect(s.settlement.stats.left).toBe(3);
    expect(s.settlement.chronicle[0]).toMatchObject({ kind: 'left', params: { count: 3, reason: 'unhappy' } });
    expect(s.settlement.relations).toEqual([]);
  });

  it('dwie smutne doby to jeszcze nie wyjazd', () => {
    const sim = makeTown();
    const h = house(sim, 'hut', 26, 26);
    addResident(sim.state, { home: h, sadDays: 2 });
    expect(ofType(day(sim), 'left')).toEqual([]);
    expect(sim.state.settlement.residents).toHaveLength(1);
  });

  it('bez domu przez 2 doby → wyjazd (powód: homeless)', () => {
    const sim = makeTown();
    const s = sim.state;
    const r = addResident(s, { homelessDays: 0 });
    expect(ofType(day(sim, DAY), 'left')).toEqual([]);
    expect(r.homelessDays).toBe(1);
    const events = day(sim, DAY + 1);
    expect(ofType(events, 'left')).toEqual([{ type: 'left', count: 1, reason: 'homeless' }]);
    expect(s.settlement.residents).toEqual([]);
  });

  it('dzieci zostają, gdy w rodzinie zostaje inny dorosły', () => {
    const sim = makeTown();
    const s = sim.state;
    const h = house(sim, 'house', 26, 26);
    const leaver = addResident(s, { home: h, family: 1, sadDays: 4 });
    const parent = addResident(s, { home: h, family: 1 });
    const kid = addResident(s, { home: h, family: 1, child: true, bornDay: DAY });
    const events = day(sim);
    expect(ids(s)).toEqual([parent.id, kid.id]);
    expect(ids(s)).not.toContain(leaver.id);
    expect(ofType(events, 'left')).toEqual([{ type: 'left', count: 1, reason: 'unhappy' }]);
  });

  it('smutne dziecko nie wyjeżdża samo', () => {
    const sim = makeTown();
    const h = house(sim, 'house', 26, 26);
    addResident(sim.state, { home: h, family: 1 });
    addResident(sim.state, { home: h, family: 1, child: true, bornDay: DAY, sadDays: 5 });
    day(sim);
    expect(sim.state.settlement.residents).toHaveLength(2);
  });
});

describe('osada: narodziny', () => {
  /** Para partnerów w domu `type` (+ `extra` innych mieszkańców w tym domu). */
  function couple(type = 'house', extra = 0) {
    const sim = makeTown();
    const s = sim.state;
    const h = house(sim, type, 26, 26);
    const a = addResident(s, { home: h, family: 1, name: 'Ala Nowak' });
    const b = addResident(s, { home: h, family: 1, name: 'Bartek Nowak' });
    for (let i = 0; i < extra; i++) addResident(s, { home: h, family: 1, child: true, bornDay: DAY });
    s.settlement.relations.push({ a: a.id, b: b.id, kind: 'partner', v: 1 });
    return { sim, s, h, a, b };
  }

  it('para w jednym domu z wolnym miejscem: dziecko z szansą 0,06', () => {
    const { sim, s, h, a } = couple();
    forced.push(0.059);
    const events = day(sim);
    const baby = s.settlement.residents.at(-1)!;
    expect(s.settlement.residents).toHaveLength(3);
    expect(baby).toMatchObject({ child: true, bornDay: DAY, family: a.family, home: h, job: null, arrivedDay: DAY });
    expect(surnameOf(baby.name)).toBe('Nowak');
    expect(['Ala', 'Bartek']).not.toContain(baby.name.split(' ')[0]);
    expect(ofType(events, 'born')).toEqual([{ type: 'born', id: baby.id, name: baby.name }]);
    expect(s.settlement.stats.born).toBe(1);
    expect(s.settlement.chronicle[0]).toMatchObject({ kind: 'born', params: { name: baby.name } });
  });

  it('rzut ≥ 0,06 – bez dziecka', () => {
    const { sim, s } = couple();
    forced.push(0.06);
    day(sim);
    expect(s.settlement.residents).toHaveLength(2);
    expect(s.settlement.stats.born).toBe(0);
  });

  it('bez wolnego miejsca, w różnych domach albo bez ślubu – bez losowania', () => {
    // Pełny namiot.
    const full = couple('tent');
    let rng = full.s.rng;
    day(full.sim);
    expect([full.s.settlement.residents.length, full.s.rng]).toEqual([2, rng]);
    // Różne domy.
    const apart = couple();
    apart.b.home = house(apart.sim, 'hut', 34, 26);
    rng = apart.s.rng;
    day(apart.sim);
    expect([apart.s.settlement.residents.length, apart.s.rng]).toEqual([2, rng]);
    // Przyjaźń zamiast małżeństwa.
    const friends = couple();
    friends.s.settlement.relations[0]!.kind = 'friend';
    rng = friends.s.rng;
    day(friends.sim);
    expect([friends.s.settlement.residents.length, friends.s.rng]).toEqual([2, rng]);
    // Uszkodzony dom (bez innego miejsca).
    const burnt = couple();
    burnt.s.settlement.sites[String(burnt.h)]!.damage = 0.6;
    rng = burnt.s.rng;
    day(burnt.sim);
    expect([burnt.s.settlement.residents.length, burnt.s.rng]).toEqual([2, rng]);
  });

  it('dziecko w parze nie zostaje rodzicem', () => {
    const { sim, s, b } = couple();
    b.child = true;
    b.bornDay = DAY;
    forced.push(0);
    day(sim);
    expect(s.settlement.residents).toHaveLength(2);
    expect(forced).toEqual([0]); // bez losowania
  });
});

describe('osada: pojemność domów', () => {
  it('liczą się tylko ukończone, nieuszkodzone domy', () => {
    const sim = makeTown();
    const s = sim.state;
    const h = house(sim, 'house', 26, 26); // 5
    house(sim, 'hut', 30, 26, 0.3); // w budowie
    const tent = house(sim, 'tent', 34, 26);
    s.settlement.sites[String(tent)]!.damage = 0.5; // uszkodzony
    house(sim, 'well', 36, 26); // nie dom
    addResident(s, { home: h });
    addResident(s, { home: h });
    expect(housingCapacity(s, CONTENT)).toBe(5);
    expect(freeHousingTotal(s, CONTENT)).toBe(3);
    expect(surnameOf('Ala Nowak')).toBe('Nowak');
    expect(surnameOf('Ala')).toBe('');
  });
});

describe('osada: ludność – determinizm', () => {
  it('ten sam seed → ta sama ludność i relacje po 30 dobach', () => {
    const run = (seed: number) => {
      const sim = makeTown((s) => (s.inventory.bread = 10_000), seed, 4);
      for (let i = 0; i < 6; i++) house(sim, 'house', 26 + (i % 3) * 3, 26 + Math.floor(i / 3) * 3);
      const events: string[] = [];
      for (let d = DAY; d < DAY + 30; d++) {
        const { ctx, events: ev } = at(sim, 0, d);
        populationDay(ctx);
        socialDay(ctx);
        const hour = at(sim, HOUR, d);
        populationHour(hour.ctx, HOUR);
        events.push(...[...ev, ...hour.events].map((e) => e.type));
      }
      return JSON.stringify({ st: sim.state.settlement, rng: sim.state.rng, events });
    };
    const a = run(5);
    expect(a).toBe(run(5));
    expect(a).not.toBe(run(6));
    const st = JSON.parse(a).st as GameState['settlement'];
    expect(st.residents.length).toBeGreaterThan(0);
    expect(st.residents.length).toBeLessThanOrEqual(30); // 6 domów × 5 miejsc
  });
});
