import { describe, expect, it } from 'vitest';
import { CONTENT, type Content } from '../../../src/content/content';
import { EventBus } from '../../../src/core/eventBus';
import { weightedIndex } from '../../../src/core/rng';
import { SEASON_DAYS, calendarAt } from '../../../src/sim/calendar';
import { makeCtx, rand, type Ctx } from '../../../src/sim/ctx';
import type { SimEvent } from '../../../src/sim/events';
import type { Simulation } from '../../../src/sim/simulation';
import { availableFish } from '../../../src/sim/systems/exploration';
import { budgetNet, ensureSite, storageCap } from '../../../src/sim/systems/settlement/common';
import {
  FISH_OUTPUT,
  TAX_BASE,
  UNPAID_MOOD,
  dailyTaxes,
  dailyUpkeep,
  dailyWages,
  economyDay,
  economyHour,
  isProducer,
  machineRate,
  productionHour,
  productionInfo,
  specAreaOf,
} from '../../../src/sim/systems/settlement/economy';
import type { GameState } from '../../../src/sim/types';
import { HOUR_MS, reason, setTime } from '../helpers';
import { addResident, freeSpot, makeTown, ok, placeBuilt } from './helpers';

const SPRING = 3;
const SUMMER = SPRING + SEASON_DAYS;
const AUTUMN = SPRING + 2 * SEASON_DAYS;
const WINTER = SPRING + 3 * SEASON_DAYS;
const WAGE_HOUR = CONTENT.settlement.constants.wageHour;

/** Kontekst na daną godzinę (bez kroku symulacji) ze zbieraniem zdarzeń. */
function at(sim: Simulation, hour: number, day = SPRING, c: Content = CONTENT): { ctx: Ctx; events: SimEvent[] } {
  setTime(sim.state, day, hour);
  const bus = new EventBus<SimEvent>();
  const events: SimEvent[] = [];
  bus.onAny((e) => events.push(e));
  return { ctx: makeCtx(sim.state, bus, calendarAt(sim.state.clock.simMs, sim.state.seed), c), events };
}

/** Wywołuje `productionHour` dla kolejnych godzin pracy od `from` danego dnia. */
function work(sim: Simulation, n: number, day = SPRING, from = 8, c: Content = CONTENT): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    const { ctx, events } = at(sim, from + i, day, c);
    productionHour(ctx, from + i);
    all.push(...events);
  }
  return all;
}

/** Magazyn z dokładnie podanymi przedmiotami (makeTown daje drewno i deski ponad pojemność, a narzędzia ×1,1). */
function stock(sim: Simulation, items: Record<string, number> = {}): void {
  sim.state.inventory = { ...items };
}

/** Pracownicy budynku (bez domu, bez narzędzi: wydajność = 0,5 + szczęście). */
function crew(sim: Simulation, uid: number, n: number, happiness = 0.5): void {
  for (let i = 0; i < n; i++) addResident(sim.state, { job: uid, happiness });
}

/** Wstawia gotowy budynek bezpośrednio do stanu (bez sprawdzania terenu – np. rybaczówka nad wodą). */
function put(s: GameState, type: string, x = 2, y = 2): number {
  const uid = s.nextUid++;
  s.objects.push({ uid, type, x, y });
  if (CONTENT.buildings[type]?.kind === 'machine') s.machines[String(uid)] = { queue: [], output: {} };
  return uid;
}

const site = (sim: Simulation, uid: number) => sim.state.settlement.sites[String(uid)];
const ofType = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

describe('osada: produkcja budynków', () => {
  it('pole osady: postęp = Σ wydajność / godziny, wiosną marchew', () => {
    const sim = makeTown();
    const uid = placeBuilt(sim, 'allotment');
    stock(sim);
    crew(sim, uid, 3);
    expect(work(sim, 1)).toEqual([]);
    expect(site(sim, uid)!.progress).toBeCloseTo(0.5, 9);
    const events = work(sim, 1, SPRING, 9);
    expect(sim.state.inventory.carrot).toBe(3);
    expect(site(sim, uid)!.progress).toBeCloseTo(0, 9);
    const o = sim.state.objects.find((x) => x.uid === uid)!;
    expect(ofType(events, 'produced')).toEqual([{ type: 'produced', uid, item: 'carrot', qty: 3, at: { x: o.x + 1.5, y: o.y + 1.5 } }]);
    expect(sim.state.stats.produced).toBe(3);
  });

  it('wyjście pola zależy od pory roku: lato pomidory, jesień dynie, zima jarmuż', () => {
    for (const [day, item] of [
      [SUMMER, 'tomato'],
      [AUTUMN, 'pumpkin'],
      [WINTER, 'kale'],
    ] as const) {
      const sim = makeTown();
      const uid = placeBuilt(sim, 'allotment');
      stock(sim);
      crew(sim, uid, 3);
      work(sim, 2, day);
      expect(sim.state.inventory).toEqual({ [item]: 3 });
    }
  });

  it('pole zboża daje pszenicę latem i jesienią, wiosną i zimą stoi – bez postępu i bez plonów', () => {
    const summer = makeTown();
    const field = placeBuilt(summer, 'grainfield');
    stock(summer);
    crew(summer, field, 3);
    work(summer, 2, SUMMER);
    expect(summer.state.inventory).toEqual({ wheat: 3 });

    const sim = makeTown();
    const uid = placeBuilt(sim, 'grainfield');
    stock(sim);
    crew(sim, uid, 3);
    expect(work(sim, 10, WINTER)).toEqual([]);
    expect(site(sim, uid)?.progress ?? 0).toBe(0);
    expect(sim.state.inventory).toEqual({});
  });

  it('poza godzinami pracy (7–17) nic nie powstaje', () => {
    const sim = makeTown();
    const uid = placeBuilt(sim, 'allotment');
    stock(sim);
    crew(sim, uid, 3);
    for (const h of [0, 5, 6, 17, 18, 23]) {
      const { ctx } = at(sim, h);
      productionHour(ctx, h);
    }
    expect(site(sim, uid)?.progress ?? 0).toBe(0);
    work(sim, 1, SPRING, 7);
    expect(site(sim, uid)!.progress).toBeCloseTo(0.5, 9);
  });

  it('bez pracowników, w budowie, przy awarii i pożarze brak produkcji', () => {
    const sim = makeTown();
    const empty = placeBuilt(sim, 'lumber');
    const building = placeBuilt(sim, 'lumber');
    const broken = placeBuilt(sim, 'lumber');
    const burning = placeBuilt(sim, 'lumber');
    stock(sim);
    crew(sim, building, 3);
    crew(sim, broken, 3);
    crew(sim, burning, 3);
    site(sim, building)!.built = 0.5;
    site(sim, broken)!.broken = true;
    site(sim, burning)!.fire = 2;
    expect(work(sim, 5)).toEqual([]);
    expect(sim.state.inventory).toEqual({});
    for (const uid of [empty, building, broken, burning]) expect(site(sim, uid)!.progress).toBe(0);
  });

  it('duża moc daje kilka cykli w jednej godzinie', () => {
    const sim = makeTown();
    const uid = placeBuilt(sim, 'lumber'); // 2 drewna / 3 h
    stock(sim);
    crew(sim, uid, 6);
    const events = work(sim, 1);
    expect(sim.state.inventory.wood).toBe(4);
    expect(ofType(events, 'produced')).toHaveLength(2);
    expect(site(sim, uid)!.progress).toBeCloseTo(0, 9);
  });

  it('tartak zużywa wejścia; bez wejść czeka z gotowym cyklem (postęp ≤ 1)', () => {
    const sim = makeTown();
    const uid = placeBuilt(sim, 'sawmill'); // 2 drewna → 1 deska / 2 h
    stock(sim, { wood: 3 });
    crew(sim, uid, 2); // moc 2 → jeden cykl na godzinę
    work(sim, 1);
    expect(sim.state.inventory).toEqual({ wood: 1, planks: 1 });
    expect(site(sim, uid)!.progress).toBeCloseTo(0, 9);
    work(sim, 6, SPRING, 9);
    expect(sim.state.inventory).toEqual({ wood: 1, planks: 1 });
    expect(site(sim, uid)!.progress).toBe(1);
    sim.state.inventory.wood = 2;
    const events = work(sim, 1, SPRING, 16);
    expect(ofType(events, 'produced')).toHaveLength(1);
    expect(sim.state.inventory).toEqual({ planks: 2 });
    expect(site(sim, uid)!.progress).toBe(1);
  });

  it('wejścia zużywane od najniższej jakości', () => {
    const sim = makeTown();
    const uid = placeBuilt(sim, 'sawmill');
    stock(sim, { wood: 1, 'wood*2': 3 });
    crew(sim, uid, 2); // jeden cykl: najpierw zwykłe drewno, potem najlepsze
    work(sim, 1);
    expect(sim.state.inventory).toEqual({ 'wood*2': 2, planks: 1 });
  });

  it('specjalizacja agri przyspiesza żywność, craft – rzemiosło', () => {
    expect(specAreaOf('allotment')).toBe('agri');
    expect(specAreaOf('fishery')).toBe('agri');
    expect(specAreaOf('bakery')).toBe('agri');
    expect(specAreaOf('sawmill')).toBe('craft');
    expect(specAreaOf('loom')).toBe('craft');
    expect(specAreaOf('lumber')).toBeNull();
    expect(specAreaOf('clinic')).toBeNull();
    const sim = makeTown((s) => {
      s.settlement.specialization = 'agri';
    });
    const field = placeBuilt(sim, 'allotment');
    const saw = placeBuilt(sim, 'sawmill');
    stock(sim);
    crew(sim, field, 3);
    crew(sim, saw, 1);
    work(sim, 1);
    expect(site(sim, field)!.progress).toBeCloseTo((3 * 1.25) / 6, 9);
    expect(site(sim, saw)!.progress).toBeCloseTo(1 / 2, 9); // bez drewna nie ma cyklu, ale postęp rośnie
    sim.state.settlement.specialization = 'craft';
    site(sim, field)!.progress = 0;
    site(sim, saw)!.progress = 0;
    work(sim, 1);
    expect(site(sim, field)!.progress).toBeCloseTo(3 / 6, 9);
    expect(site(sim, saw)!.progress).toBeCloseTo(1.25 / 2, 9);
  });

  it('bez drewna tartak dochodzi do pełnego cyklu i czeka (postęp nie rośnie ponad 1)', () => {
    const sim = makeTown();
    const saw = placeBuilt(sim, 'sawmill');
    stock(sim);
    crew(sim, saw, 2);
    expect(work(sim, 4)).toEqual([]);
    expect(site(sim, saw)!.progress).toBe(1);
  });

  it('wydajność pracownika: szczęście i narzędzia', () => {
    const sim = makeTown();
    const uid = placeBuilt(sim, 'allotment');
    stock(sim, { tools: 1 });
    crew(sim, uid, 2, 1);
    work(sim, 1);
    expect(site(sim, uid)!.progress).toBeCloseTo((2 * 1.5 * 1.1) / 6, 9);
  });

  it('limit: przychodnia robi lekarstwa tylko poniżej 10 sztuk', () => {
    const sim = makeTown();
    const uid = placeBuilt(sim, 'clinic'); // 2 zioła → 1 lekarstwo / 4 h
    stock(sim, { herb: 6, medicine: 9 });
    crew(sim, uid, 2);
    site(sim, uid)!.progress = 0.5;
    const events = work(sim, 1);
    expect(ofType(events, 'produced')).toHaveLength(1);
    expect(sim.state.inventory).toEqual({ herb: 4, medicine: 10 });
    expect(work(sim, 4, SPRING, 9)).toEqual([]);
    expect(site(sim, uid)!.progress).toBe(1);
    expect(sim.state.inventory).toEqual({ herb: 4, medicine: 10 });
    sim.state.inventory.medicine = 9; // gracz zużył lekarstwo
    work(sim, 1, SPRING, 13);
    expect(sim.state.inventory).toEqual({ herb: 2, medicine: 10 });
    expect(site(sim, uid)!.progress).toBeCloseTo(0.5, 9);
  });

  it('pełny magazyn wstrzymuje wyroby (cykl czeka gotowy), ale nie jedzenie', () => {
    const sim = makeTown();
    const uid = placeBuilt(sim, 'lumber');
    const field = placeBuilt(sim, 'allotment');
    crew(sim, uid, 3);
    crew(sim, field, 3);
    stock(sim, { stone: storageCap(sim.state, CONTENT) });
    const events = ofType(work(sim, 5), 'produced');
    expect(events.every((e) => e.uid === field)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    expect(sim.state.inventory.wood ?? 0).toBe(0);
    expect(site(sim, uid)!.progress).toBe(1);
  });

  it('magazyn zapełniony w trakcie godziny zatrzymuje kolejne cykle', () => {
    const sim = makeTown();
    const uid = placeBuilt(sim, 'lumber');
    crew(sim, uid, 9); // 3 cykle na godzinę
    stock(sim, { stone: storageCap(sim.state, CONTENT) - 1 });
    const events = work(sim, 1);
    expect(ofType(events, 'produced')).toHaveLength(1);
    expect(sim.state.inventory.wood).toBe(2);
    expect(site(sim, uid)!.progress).toBe(1);
  });
});

describe('osada: rybaczówka', () => {
  it('łowi losową rybę dostępną w porze roku, ważoną `weight` (deterministycznie)', () => {
    const sim = makeTown();
    const uid = put(sim.state, 'fishery'); // 1 ryba / 3 h
    stock(sim);
    crew(sim, uid, 2, 1); // moc 3 → jedna ryba na godzinę
    const { ctx } = at(sim, 8);
    const pool = availableFish(ctx);
    expect(pool.length).toBeGreaterThan(1);
    // Oczekiwana sekwencja z tego samego generatora.
    const copy = { rng: sim.state.rng } as GameState;
    const expected = Array.from({ length: 6 }, () => pool[weightedIndex(pool.map((f) => f.weight), rand(copy))]!.id);
    const events = work(sim, 6);
    const caught = ofType(events, 'produced').map((e) => e.item);
    expect(caught).toEqual(expected);
    for (const f of caught) expect(pool.map((p) => p.id)).toContain(f);
    expect(Object.values(sim.state.inventory).reduce((a, b) => a + b, 0)).toBe(6);
    expect(sim.state.rng).toBe(copy.rng);
  });

  it('ten sam seed → te same ryby; inny seed losuje inaczej', () => {
    const run = (seed: number) => {
      const sim = makeTown(() => {}, seed);
      const uid = put(sim.state, 'fishery');
      stock(sim);
      crew(sim, uid, 2, 1);
      return ofType(work(sim, 10), 'produced').map((e) => e.item);
    };
    expect(run(7)).toEqual(run(7));
    const seeds = [1, 2, 3, 4, 5].map(run).map((x) => x.join());
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it('gdy żadna ryba nie bierze – przestój bez postępu i bez losowania', () => {
    const sim = makeTown();
    const uid = put(sim.state, 'fishery');
    stock(sim);
    crew(sim, uid, 2, 1);
    const rng = sim.state.rng;
    const noFish: Content = { ...CONTENT, fish: [] };
    expect(work(sim, 5, SPRING, 8, noFish)).toEqual([]);
    expect(site(sim, uid)?.progress ?? 0).toBe(0);
    expect(sim.state.rng).toBe(rng);
  });
});

describe('osada: maszyny z obsadą', () => {
  it('młyn z obsadą mieli pszenicę na mąkę do magazynu, nie na tackę maszyny', () => {
    const sim = makeTown();
    const mill = placeBuilt(sim, 'mill');
    stock(sim, { wheat: 4 });
    crew(sim, mill, 1); // moc 1 → tempo 0,7; mąka 30 min → +1,4 / h
    const events = work(sim, 1);
    expect(sim.state.inventory).toEqual({ wheat: 2, flour: 1 });
    expect(site(sim, mill)!.progress).toBeCloseTo(0.4, 9);
    expect(sim.state.machines[String(mill)]).toEqual({ queue: [], output: {} });
    expect(ofType(events, 'produced')).toEqual([expect.objectContaining({ uid: mill, item: 'flour', qty: 1 })]);
  });

  it('łańcuch pszenica → mąka → chleb: piekarnia wybiera pierwszą wykonalną recepturę', () => {
    const sim = makeTown();
    const mill = placeBuilt(sim, 'mill');
    const bakery = placeBuilt(sim, 'bakery');
    stock(sim, { wheat: 4, egg: 1 });
    crew(sim, mill, 1);
    crew(sim, bakery, 2); // tempo 1,0: chleb 60 min, bochenek 90 min
    // 8:00 – mąka, a piekarnia od razu piecze `bread` (mąka + jajko).
    let events = work(sim, 1);
    expect(ofType(events, 'produced').map((e) => e.item)).toEqual(['flour', 'bread']);
    expect(sim.state.inventory).toEqual({ wheat: 2, bread: 1 });
    // 9:00 – druga mąka; bez jajka zostaje `loaf` (90 min, postęp 2/3).
    events = work(sim, 1, SPRING, 9);
    expect(ofType(events, 'produced').map((e) => e.item)).toEqual(['flour']);
    expect(site(sim, bakery)!.progress).toBeCloseTo(2 / 3, 9);
    // 10:00 – młyn bez pszenicy stoi, piekarnia kończy bochenek.
    events = work(sim, 1, SPRING, 10);
    expect(ofType(events, 'produced').map((e) => e.item)).toEqual(['bread']);
    expect(sim.state.inventory).toEqual({ bread: 2 });
    expect(site(sim, mill)!.progress).toBeCloseTo(0.8, 9);
    expect(site(sim, bakery)!.progress).toBeCloseTo(1 / 3, 9);
  });

  it('najwyżej jeden cykl na godzinę – nadmiar postępu się nie kumuluje', () => {
    const sim = makeTown();
    const mill = placeBuilt(sim, 'mill');
    stock(sim, { wheat: 40 });
    crew(sim, mill, 3); // tempo 1,3 → +2,6 cyklu / h
    for (let h = 8; h < 16; h++) {
      const events = work(sim, 1, SPRING, h);
      expect(ofType(events, 'produced')).toHaveLength(1);
      expect(site(sim, mill)!.progress).toBeLessThanOrEqual(1);
    }
    expect(sim.state.inventory).toEqual({ wheat: 24, flour: 8 });
  });

  it('bez surowców maszyna stoi, postęp bez zmian', () => {
    const sim = makeTown();
    const bakery = placeBuilt(sim, 'bakery');
    stock(sim, { egg: 3 });
    crew(sim, bakery, 2);
    ensureSite(sim.state, bakery).progress = 0.5; // maszyny farmy nie mają stanu budowy
    expect(work(sim, 4)).toEqual([]);
    expect(site(sim, bakery)!.progress).toBe(0.5);
  });

  it('bez obsady maszyna nie pracuje sama, a ręczna kolejka gracza zostaje bez zmian', () => {
    const sim = makeTown();
    const mill = placeBuilt(sim, 'mill');
    stock(sim, { wheat: 4 });
    const queue = [{ recipe: 'flour', remainingMs: 1000 }];
    sim.state.machines[String(mill)] = { queue: [...queue], output: { hay: 2 } };
    expect(work(sim, 5)).toEqual([]);
    expect(sim.state.inventory).toEqual({ wheat: 4 });
    crew(sim, mill, 1);
    work(sim, 1, SPRING, 13);
    expect(sim.state.inventory).toEqual({ wheat: 2, flour: 1 });
    expect(sim.state.machines[String(mill)]).toEqual({ queue, output: { hay: 2 } });
  });

  it('maszyny bez etatów (kompostownik) nie są produkcją osady', () => {
    expect(isProducer(CONTENT.buildings.composter!)).toBe(false);
    expect(isProducer(CONTENT.buildings.mill!)).toBe(true);
    expect(isProducer(CONTENT.buildings.allotment!)).toBe(true);
    expect(isProducer(CONTENT.buildings.shop!)).toBe(false);
    expect(machineRate(0)).toBe(0);
    expect(machineRate(2)).toBeCloseTo(1, 9);
  });

  it('pełny magazyn wstrzymuje też maszyny', () => {
    const sim = makeTown();
    const mill = placeBuilt(sim, 'mill');
    crew(sim, mill, 1);
    stock(sim, { wheat: storageCap(sim.state, CONTENT) });
    expect(work(sim, 3)).toEqual([]);
    expect(sim.state.inventory.flour ?? 0).toBe(0);
    expect(site(sim, mill)?.progress ?? 0).toBeLessThanOrEqual(1);
  });
});

describe('osada: płace', () => {
  /** Rolnicy na polu (8), piekarz (10), bezrobotny i dziecko. */
  function payrollTown(coins: number): { sim: Simulation; workers: number[]; idle: number } {
    const sim = makeTown();
    const field = placeBuilt(sim, 'allotment');
    const bakery = placeBuilt(sim, 'bakery');
    stock(sim);
    sim.state.coins = coins; // dopiero po postawieniu (budynki kosztują)
    sim.state.settlement.budget = [];
    const workers = [
      addResident(sim.state, { job: field }).id,
      addResident(sim.state, { job: field }).id,
      addResident(sim.state, { job: bakery }).id,
    ];
    const idle = addResident(sim.state).id;
    addResident(sim.state, { child: true });
    return { sim, workers, idle };
  }
  const resident = (sim: Simulation, id: number) => sim.state.settlement.residents.find((r) => r.id === id)!;

  it(`o ${WAGE_HOUR}:00 każdy zatrudniony dostaje płacę zawodu`, () => {
    const { sim } = payrollTown(100);
    expect(dailyWages(sim.state, CONTENT)).toBe(26);
    for (const h of [0, 8, 17, 19, 23]) economyHour(at(sim, h).ctx, h);
    expect(sim.state.coins).toBe(100);
    const { ctx, events } = at(sim, WAGE_HOUR);
    economyHour(ctx, WAGE_HOUR);
    expect(sim.state.coins).toBe(74);
    expect(sim.state.settlement.budget[0]).toMatchObject({ day: SPRING, wages: 26 });
    expect(events).toEqual([]);
  });

  it('brak monet: wypłata do zera, zdarzenie unpaid i strajk pracowników', () => {
    const { sim, workers, idle } = payrollTown(10);
    const { ctx, events } = at(sim, WAGE_HOUR);
    economyHour(ctx, WAGE_HOUR);
    expect(sim.state.coins).toBe(0);
    expect(events).toEqual([{ type: 'unpaid', missing: 16 }]);
    expect(sim.state.settlement.budget[0]).toMatchObject({ day: SPRING, wages: 10 });
    for (const id of workers) expect(resident(sim, id).mood).toEqual({ value: UNPAID_MOOD, untilDay: SPRING + 1 });
    expect(resident(sim, idle).mood).toEqual({ value: 0, untilDay: -1 });
    expect(sim.state.settlement.chronicle[0]).toMatchObject({ day: SPRING, kind: 'unpaid', params: { missing: 16 } });
  });

  it('pusty skarbiec: nic nie wypłaca, saldo nigdy ujemne', () => {
    const { sim } = payrollTown(0);
    const { ctx, events } = at(sim, WAGE_HOUR);
    economyHour(ctx, WAGE_HOUR);
    expect(sim.state.coins).toBe(0);
    expect(events).toEqual([{ type: 'unpaid', missing: 26 }]);
    expect(sim.state.settlement.budget).toEqual([]);
  });

  it('bez zatrudnionych nie ma płac ani wpisu w budżecie', () => {
    const sim = makeTown();
    addResident(sim.state);
    const coins = sim.state.coins;
    sim.state.settlement.budget = [];
    const { ctx, events } = at(sim, WAGE_HOUR);
    economyHour(ctx, WAGE_HOUR);
    expect(sim.state.coins).toBe(coins);
    expect(events).toEqual([]);
    expect(sim.state.settlement.budget).toEqual([]);
    expect(dailyWages(sim.state, CONTENT)).toBe(0);
  });

  it('praca w nieistniejącym budynku nie jest płatna', () => {
    const sim = makeTown();
    addResident(sim.state, { job: 9999 });
    expect(dailyWages(sim.state, CONTENT)).toBe(0);
  });
});

describe('osada: podatki i utrzymanie', () => {
  function taxTown(): Simulation {
    const sim = makeTown();
    const field = placeBuilt(sim, 'allotment'); // utrzymanie 1
    const bakery = placeBuilt(sim, 'bakery'); // utrzymanie 3
    stock(sim);
    sim.state.settlement.budget = [];
    addResident(sim.state, { job: field }); // (8 + 10) × stawka
    addResident(sim.state, { job: field });
    addResident(sim.state, { job: bakery }); // (10 + 10) × stawka
    addResident(sim.state); // bezrobotny: 10 × stawka
    addResident(sim.state, { child: true }); // dzieci nie płacą
    return sim;
  }

  it('podatki: dorosły stawka × (płaca + 10), bezrobotny stawka × 10, dzieci nic', () => {
    const sim = taxTown();
    expect(TAX_BASE).toBe(10);
    expect(sim.state.settlement.taxRate).toBe(0.1);
    expect(dailyTaxes(sim.state, CONTENT)).toBe(Math.round(0.1 * (18 + 18 + 20 + 10)));
    sim.state.settlement.taxRate = 0.3;
    expect(dailyTaxes(sim.state, CONTENT)).toBe(20); // 19,8
    sim.state.settlement.taxRate = 0;
    expect(dailyTaxes(sim.state, CONTENT)).toBe(0);
  });

  it('nowy dzień: podatki wpływają, utrzymanie wypływa – oba w budżecie', () => {
    const sim = taxTown();
    sim.state.coins = 50;
    const { ctx } = at(sim, 0, SPRING);
    economyDay(ctx);
    expect(sim.state.coins).toBe(50 + 7 - 4);
    expect(sim.state.settlement.budget[0]).toMatchObject({ day: SPRING, taxes: 7, upkeep: 4 });
  });

  it('utrzymanie liczy tylko ukończone budynki', () => {
    const sim = taxTown();
    expect(dailyUpkeep(sim.state, CONTENT)).toBe(4);
    sim.state.inventory.wood = 12; // materiały domu
    const spot = freeSpot(sim.state, 'house');
    ok(sim, { type: 'place', building: 'house', x: spot.x, y: spot.y }); // w budowie
    expect(dailyUpkeep(sim.state, CONTENT)).toBe(4);
    sim.state.settlement.sites[String(sim.state.nextUid - 1)]!.built = 1;
    expect(dailyUpkeep(sim.state, CONTENT)).toBe(4 + CONTENT.buildings.house!.upkeep!);
    placeBuilt(sim, 'tent'); // bez utrzymania
    expect(dailyUpkeep(sim.state, CONTENT)).toBe(6);
  });

  it('podatki wpływają przed utrzymaniem, a utrzymanie nie zadłuża skarbca', () => {
    const sim = taxTown();
    sim.state.coins = 0;
    economyDay(at(sim, 0, SPRING).ctx);
    expect(sim.state.coins).toBe(3);
    sim.state.settlement.taxRate = 0;
    sim.state.coins = 2;
    economyDay(at(sim, 0, SPRING + 1).ctx);
    expect(sim.state.coins).toBe(0);
    expect(sim.state.settlement.budget[0]).toMatchObject({ day: SPRING + 1, taxes: 0, upkeep: 2 });
  });

  it('zdarzenie budget{day, net} za wczorajszy dzień', () => {
    const sim = taxTown();
    sim.state.coins = 100;
    const yesterday = { day: SPRING - 1, taxes: 5, sales: 12, exports: 30, wages: 26, upkeep: 4, imports: 10, investments: 100 };
    sim.state.settlement.budget = [{ ...yesterday }];
    const { ctx, events } = at(sim, 0, SPRING);
    economyDay(ctx);
    expect(budgetNet(yesterday)).toBe(-93);
    expect(events).toEqual([{ type: 'budget', day: SPRING - 1, net: -93 }]);
    expect(sim.state.settlement.budget.map((b) => b.day)).toEqual([SPRING, SPRING - 1]);
  });

  it('bez rozliczenia za wczoraj (starszy wpis, brak wpisów) nie ma zdarzenia budget', () => {
    const sim = taxTown();
    sim.state.settlement.budget = [{ day: SPRING - 2, taxes: 5, sales: 0, exports: 0, wages: 0, upkeep: 0, imports: 0, investments: 0 }];
    const a = at(sim, 0, SPRING);
    economyDay(a.ctx);
    expect(ofType(a.events, 'budget')).toEqual([]);
    sim.state.settlement.budget = [];
    const b = at(sim, 0, SPRING + 1);
    economyDay(b.ctx);
    expect(ofType(b.events, 'budget')).toEqual([]);
  });

  it('zdarzenie budget za wczoraj także, gdy dzisiejszy wpis powstał przed rozliczeniem', () => {
    const sim = taxTown();
    const today = { day: SPRING, taxes: 0, sales: 0, exports: 0, wages: 0, upkeep: 0, imports: 0, investments: 50 };
    const yesterday = { day: SPRING - 1, taxes: 9, sales: 3, exports: 0, wages: 4, upkeep: 2, imports: 0, investments: 0 };
    sim.state.settlement.budget = [today, yesterday];
    const { ctx, events } = at(sim, 0, SPRING);
    economyDay(ctx);
    expect(ofType(events, 'budget')).toEqual([{ type: 'budget', day: SPRING - 1, net: 6 }]);
    expect(sim.state.settlement.budget.map((b) => b.day)).toEqual([SPRING, SPRING - 1]);
    expect(sim.state.settlement.budget[0]).toMatchObject({ investments: 50, taxes: 7, upkeep: 4 });
  });

  it('pełna doba: płace z wieczora trafiają do zdarzenia budget następnego dnia', () => {
    const sim = taxTown();
    sim.state.coins = 100;
    economyDay(at(sim, 0, SPRING).ctx); // +7 −4
    economyHour(at(sim, WAGE_HOUR, SPRING).ctx, WAGE_HOUR); // −26
    const { ctx, events } = at(sim, 0, SPRING + 1);
    economyDay(ctx);
    expect(events).toEqual([{ type: 'budget', day: SPRING, net: 7 - 4 - 26 }]);
    expect(sim.state.coins).toBe(100 + 7 - 4 - 26 + 7 - 4);
  });
});

describe('osada: komendy budżetu', () => {
  it('setTax: stawka 0..0,3 zaokrąglona do 0,01, wpis w kronice', () => {
    const sim = makeTown();
    ok(sim, { type: 'setTax', rate: 0.2 });
    expect(sim.state.settlement.taxRate).toBe(0.2);
    expect(sim.state.settlement.chronicle[0]).toMatchObject({ kind: 'tax', params: { rate: 20 } });
    ok(sim, { type: 'setTax', rate: 0.1 + 0.2 });
    expect(sim.state.settlement.taxRate).toBe(0.3);
    ok(sim, { type: 'setTax', rate: 0.123 });
    expect(sim.state.settlement.taxRate).toBe(0.12);
    ok(sim, { type: 'setTax', rate: 0 });
    expect(sim.state.settlement.taxRate).toBe(0);
    expect(Object.is(sim.state.settlement.taxRate, -0)).toBe(false);
  });

  it('setTax: zła stawka → invalid, stawka bez zmian', () => {
    const sim = makeTown();
    for (const rate of [-0.05, 0.31, 1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(reason(sim, { type: 'setTax', rate })).toBe('invalid');
    }
    expect(reason(sim, { type: 'setTax', rate: '0.2' as unknown as number })).toBe('invalid');
    expect(sim.state.settlement.taxRate).toBe(0.1);
    expect(sim.state.settlement.chronicle.filter((e) => e.kind === 'tax')).toEqual([]);
  });

  it('setTax: seria zmian w tej samej godzinie zostawia w kronice jeden wpis', () => {
    const sim = makeTown();
    ok(sim, { type: 'setTax', rate: 0.15 });
    ok(sim, { type: 'setTax', rate: 0.2 });
    ok(sim, { type: 'setTax', rate: 0.25 });
    const taxes = sim.state.settlement.chronicle.filter((e) => e.kind === 'tax');
    expect(taxes).toHaveLength(1);
    expect(taxes[0]!.params).toEqual({ rate: 25 });
  });

  it('wyższa stawka = wyższe podatki dnia', () => {
    const sim = makeTown();
    for (let i = 0; i < 10; i++) addResident(sim.state);
    ok(sim, { type: 'setTax', rate: 0.25 });
    expect(dailyTaxes(sim.state, CONTENT)).toBe(25);
  });

  it('toggleReserve: przełącza rezerwę istniejącego przedmiotu', () => {
    const sim = makeTown();
    ok(sim, { type: 'toggleReserve', item: 'bread' });
    ok(sim, { type: 'toggleReserve', item: 'cheese' });
    expect(sim.state.settlement.reserved).toEqual(['bread', 'cheese']);
    ok(sim, { type: 'toggleReserve', item: 'bread' });
    expect(sim.state.settlement.reserved).toEqual(['cheese']);
    ok(sim, { type: 'toggleReserve', item: 'wheat' }); // uprawy też są przedmiotami
    expect(sim.state.settlement.reserved).toEqual(['cheese', 'wheat']);
  });

  it('toggleReserve: nieznany przedmiot → invalid', () => {
    const sim = makeTown();
    for (const item of ['nope', '', 'bread*1', 'constructor', '@fish']) {
      expect(reason(sim, { type: 'toggleReserve', item })).toBe('invalid');
    }
    expect(sim.state.settlement.reserved).toEqual([]);
  });
});

describe('osada: informacje o produkcji (UI)', () => {
  it('pole osady: wyjście, szacunek na dobę; pole zboża: przestój zimą', () => {
    const sim = makeTown();
    const uid = placeBuilt(sim, 'allotment');
    stock(sim);
    expect(productionInfo(at(sim, 8).ctx, uid)).toEqual({ item: 'carrot', perDay: 0, blocked: 'staff' });
    crew(sim, uid, 3);
    const info = productionInfo(at(sim, 8).ctx, uid);
    expect(info.item).toBe('carrot');
    expect(info.perDay).toBeCloseTo(((3 * 10) / 6) * 3, 9);
    expect(info.blocked).toBeNull();
    expect(productionInfo(at(sim, 8, WINTER).ctx, uid).item).toBe('kale');
    const grain = placeBuilt(sim, 'grainfield');
    crew(sim, grain, 3);
    expect(productionInfo(at(sim, 8, WINTER).ctx, grain)).toEqual({ item: null, perDay: 0, blocked: 'season' });
  });

  it('brak wejść, pełny magazyn i limit', () => {
    const sim = makeTown();
    const saw = placeBuilt(sim, 'sawmill');
    const clinic = placeBuilt(sim, 'clinic');
    stock(sim);
    crew(sim, saw, 2);
    crew(sim, clinic, 2);
    expect(productionInfo(at(sim, 8).ctx, saw)).toMatchObject({ item: 'planks', blocked: 'inputs' });
    expect(productionInfo(at(sim, 8).ctx, saw).perDay).toBeCloseTo(10, 9);
    stock(sim, { herb: 2, medicine: 10 });
    expect(productionInfo(at(sim, 8).ctx, clinic)).toMatchObject({ item: 'medicine', blocked: 'storage' });
    stock(sim, { herb: 2, medicine: 9 });
    expect(productionInfo(at(sim, 8).ctx, clinic)).toMatchObject({ item: 'medicine', blocked: null });
    stock(sim, { wood: storageCap(sim.state, CONTENT) });
    expect(productionInfo(at(sim, 8).ctx, saw)).toMatchObject({ blocked: 'storage' });
  });

  it('maszyna: receptura, którą obsada wykona, i tempo (max cykl na godzinę)', () => {
    const sim = makeTown();
    const bakery = placeBuilt(sim, 'bakery');
    crew(sim, bakery, 2);
    stock(sim);
    expect(productionInfo(at(sim, 8).ctx, bakery)).toMatchObject({ item: 'bread', blocked: 'inputs' });
    stock(sim, { flour: 3 });
    const loaf = productionInfo(at(sim, 8).ctx, bakery);
    expect(loaf).toMatchObject({ item: 'bread', blocked: null });
    expect(loaf.perDay).toBeCloseTo((1 / 1.5) * 10, 9);
    stock(sim, { flour: 3, egg: 3 });
    expect(productionInfo(at(sim, 8).ctx, bakery).perDay).toBeCloseTo(10, 9);
    const mill = placeBuilt(sim, 'mill');
    crew(sim, mill, 3);
    stock(sim, { wheat: 10 });
    expect(productionInfo(at(sim, 8).ctx, mill)).toEqual({ item: 'flour', perDay: 10, blocked: null });
  });

  it('rybaczówka, budynek w awarii i budynki bez produkcji', () => {
    const sim = makeTown();
    const fishery = put(sim.state, 'fishery');
    crew(sim, fishery, 2);
    stock(sim);
    expect(productionInfo(at(sim, 8).ctx, fishery)).toMatchObject({ item: FISH_OUTPUT, blocked: null });
    expect(productionInfo(at(sim, 8, SPRING, { ...CONTENT, fish: [] }).ctx, fishery)).toEqual({ item: FISH_OUTPUT, perDay: 0, blocked: 'season' });
    sim.state.settlement.sites[String(fishery)] = { built: 1, damage: 0, fire: 0, broken: true, progress: 0, repair: 0 };
    expect(productionInfo(at(sim, 8).ctx, fishery).perDay).toBe(0);
    const tent = placeBuilt(sim, 'tent');
    expect(productionInfo(at(sim, 8).ctx, tent)).toEqual({ item: null, perDay: 0, blocked: null });
    expect(productionInfo(at(sim, 8).ctx, 99_999)).toEqual({ item: null, perDay: 0, blocked: null });
  });
});

describe('osada: gospodarka w pełnej symulacji', () => {
  it('dzień pracy: plony w godzinach 7–17, płace o 18:00, podatki i zdarzenie budget o północy', () => {
    const sim = makeTown();
    const field = placeBuilt(sim, 'allotment');
    for (let i = 0; i < 3; i++) addResident(sim.state, { job: field });
    stock(sim, { tools: 1 }); // makeTown daje zapasy ponad pojemność magazynu
    sim.state.coins = 1000;
    sim.state.settlement.budget = [];
    const upkeep = dailyUpkeep(sim.state, CONTENT);
    setTime(sim.state, SPRING, 6);
    const events: SimEvent[] = [];
    sim.bus.onAny((e) => events.push(e));
    sim.advance(13 * HOUR_MS); // 6:00 → 19:00
    const crops = ofType(events, 'produced').filter((e) => e.uid === field);
    expect(crops.length).toBeGreaterThan(0);
    for (const e of crops) expect(e).toMatchObject({ item: 'carrot', qty: 3 });
    expect(sim.state.settlement.residents.filter((r) => r.job === field)).toHaveLength(3);
    expect(sim.state.settlement.budget).toEqual([expect.objectContaining({ day: SPRING, wages: 24 })]);
    expect(ofType(events, 'unpaid')).toEqual([]);
    sim.advance(5.5 * HOUR_MS); // → 0:30 następnego dnia
    const yesterday = sim.state.settlement.budget.find((b) => b.day === SPRING)!;
    expect(ofType(events, 'budget')).toEqual([{ type: 'budget', day: SPRING, net: budgetNet(yesterday) }]);
    expect(sim.state.settlement.budget[0]).toMatchObject({ day: SPRING + 1, taxes: Math.round(3 * 0.1 * 18), upkeep });
  });
});

describe('osada: determinizm i wydajność gospodarki', () => {
  /** Kilka dób produkcji, płac i rozliczeń na bezpośrednich wywołaniach. */
  function simulate(seed: number): unknown {
    const sim = makeTown(() => {}, seed);
    const field = placeBuilt(sim, 'allotment');
    const mill = placeBuilt(sim, 'mill');
    const bakery = placeBuilt(sim, 'bakery');
    const fishery = put(sim.state, 'fishery');
    stock(sim, { wheat: 30, egg: 4 });
    sim.state.coins = 60;
    crew(sim, field, 3, 0.6);
    crew(sim, mill, 1, 0.4);
    crew(sim, bakery, 2, 0.7);
    crew(sim, fishery, 2, 0.9);
    addResident(sim.state);
    const events: SimEvent[] = [];
    for (let day = SPRING; day < SPRING + 10; day++) {
      const d = at(sim, 0, day);
      economyDay(d.ctx);
      events.push(...d.events);
      for (let h = 0; h < 24; h++) {
        const { ctx, events: ev } = at(sim, h, day);
        productionHour(ctx, h);
        economyHour(ctx, h);
        events.push(...ev);
      }
    }
    const s = sim.state;
    return JSON.parse(JSON.stringify({ inv: s.inventory, coins: s.coins, rng: s.rng, budget: s.settlement.budget, sites: s.settlement.sites, events }));
  }

  it('ten sam seed → ten sam wynik', () => {
    const a = simulate(11);
    expect(simulate(11)).toEqual(a);
    expect((a as { events: SimEvent[] }).events.some((e) => e.type === 'produced')).toBe(true);
    expect((a as { events: SimEvent[] }).events.some((e) => e.type === 'budget')).toBe(true);
  });

  it('godzina produkcji i płac przy 200 mieszkańcach i 150 budynkach ≤ 2 ms', () => {
    const sim = makeTown();
    const s = sim.state;
    const types = ['allotment', 'lumber', 'fishery', 'sawmill', 'workshop', 'clinic', 'mill', 'bakery', 'dairy', 'loom', 'preserves', 'shop', 'school', 'depot', 'tent'];
    const uids: number[] = [];
    for (let i = 0; i < 150; i++) uids.push(put(s, types[i % types.length]!, (i * 3) % 60, Math.floor(i / 20) * 3));
    // Mieszkańcy z domami (pokrycie szkoły w domu) i pracą – pełna ścieżka wydajności.
    const homes = uids.filter((uid) => s.objects.find((o) => o.uid === uid)?.type === 'tent');
    for (let i = 0; i < 200; i++) addResident(s, { job: uids[i % uids.length]!, home: homes[i % homes.length]!, happiness: 0.6 });
    stock(sim, { wheat: 50, wood: 50, herb: 10, flour: 10, milk: 10, wool: 10 });
    s.coins = 1_000_000;
    const { ctx } = at(sim, 9);
    productionHour(ctx, 9);
    const n = 100;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      productionHour(ctx, 9);
      economyHour(ctx, WAGE_HOUR);
    }
    expect((performance.now() - t0) / n).toBeLessThan(2);
  });
});
