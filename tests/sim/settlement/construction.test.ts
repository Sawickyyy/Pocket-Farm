import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/content';
import { EventBus } from '../../../src/core/eventBus';
import { calendarAt } from '../../../src/sim/calendar';
import { makeCtx, type Ctx } from '../../../src/sim/ctx';
import type { SimEvent } from '../../../src/sim/events';
import type { Simulation } from '../../../src/sim/simulation';
import { centerOf, ensureSite, isBuilt, isOperational, newSite, objectByUid } from '../../../src/sim/systems/settlement/common';
import {
  buildRate,
  builderPower,
  constructionHour,
  constructionQueue,
  repairCost,
  repairQueue,
} from '../../../src/sim/systems/settlement/construction';
import type { GameState } from '../../../src/sim/types';
import { reason, setTime } from '../helpers';
import { addResident, freeSpot, makeTown, ok, placeBuilt, runHours } from './helpers';

const DAY = 3;
const hoursOf = (type: string): number => CONTENT.buildings[type]!.buildHours!;

/** Osada bez narzędzi w magazynie – wydajność pracownika = 0,5 + szczęście. */
const town = (patch: (s: GameState) => void = () => {}, seed = 42): Simulation =>
  makeTown((s) => {
    delete s.inventory.tools;
    patch(s);
  }, seed);

/** Kontekst na daną godzinę (bez kroku symulacji) ze zbieraniem zdarzeń. */
function at(sim: Simulation, hour: number, day = DAY): { ctx: Ctx; events: SimEvent[] } {
  setTime(sim.state, day, hour);
  const bus = new EventBus<SimEvent>();
  const events: SimEvent[] = [];
  bus.onAny((e) => events.push(e));
  return { ctx: makeCtx(sim.state, bus, calendarAt(sim.state.clock.simMs, sim.state.seed)), events };
}

/** Wywołuje `constructionHour` dla kolejnych godzin od `from` (może przejść na kolejne dni). */
function hours(sim: Simulation, from: number, n: number, day = DAY): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    const h = from + i;
    const { ctx, events } = at(sim, h % 24, day + Math.floor(h / 24));
    constructionHour(ctx, h % 24);
    all.push(...events);
  }
  return all;
}

/** Stawia budynek komendą (budowa od zera). */
function startBuild(sim: Simulation, type: string): number {
  const spot = freeSpot(sim.state, type);
  ok(sim, { type: 'place', building: type, x: spot.x, y: spot.y });
  return sim.state.nextUid - 1;
}

/** Gotowy plac budowy z budowlańcami o danym szczęściu. */
function yard(sim: Simulation, workers: number, happiness = 0.5): number {
  const uid = placeBuilt(sim, 'builders');
  for (let i = 0; i < workers; i++) addResident(sim.state, { job: uid, happiness });
  return uid;
}

const site = (sim: Simulation, uid: number) => sim.state.settlement.sites[String(uid)]!;
const ofType = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

describe('osada: moc budowlańców', () => {
  it('suma wydajności pracowników działających placów budowy', () => {
    const sim = town();
    const uid = yard(sim, 2, 0.5);
    addResident(sim.state, { job: uid, happiness: 0.3 });
    expect(builderPower(at(sim, 8).ctx, 8)).toBeCloseTo(1 + 1 + 0.8, 9);
  });

  it('narzędzia w magazynie zwiększają moc (×1,1)', () => {
    const sim = town();
    yard(sim, 2, 0.5);
    sim.state.inventory.tools = 3;
    expect(builderPower(at(sim, 8).ctx, 8)).toBeCloseTo(2.2, 9);
  });

  it('tylko w godzinach pracy 7–17', () => {
    const sim = town();
    yard(sim, 1, 0.5);
    expect(builderPower(at(sim, 7).ctx, 7)).toBeCloseTo(1, 9);
    expect(builderPower(at(sim, 16).ctx, 16)).toBeCloseTo(1, 9);
    expect(builderPower(at(sim, 17).ctx, 17)).toBe(0);
    expect(builderPower(at(sim, 6).ctx, 6)).toBe(0);
    expect(builderPower(at(sim, 23).ctx, 23)).toBe(0);
  });

  it('pomija pracowników innych budynków i niedziałające place budowy', () => {
    const sim = town();
    const s = sim.state;
    const builders = yard(sim, 1, 0.5);
    const lumber = placeBuilt(sim, 'lumber');
    addResident(s, { job: lumber, happiness: 0.5 });
    addResident(s, { happiness: 0.5 });
    expect(builderPower(at(sim, 8).ctx, 8)).toBeCloseTo(1, 9);
    ensureSite(s, builders).broken = true;
    expect(builderPower(at(sim, 8).ctx, 8)).toBe(0);
    site(sim, builders).broken = false;
    site(sim, builders).damage = 0.6;
    expect(builderPower(at(sim, 8).ctx, 8)).toBe(0);
    site(sim, builders).damage = 0;
    site(sim, builders).built = 0.5;
    expect(builderPower(at(sim, 8).ctx, 8)).toBe(0);
  });

  it('bez placu budowy moc wynosi 0', () => {
    const sim = town();
    addResident(sim.state, { happiness: 1 });
    expect(builderPower(at(sim, 10).ctx, 10)).toBe(0);
  });
});

describe('osada: budowa', () => {
  it('bez budowlańców: tempo bazowe 1/buildHours w godzinach pracy', () => {
    const sim = town();
    const uid = startBuild(sim, 'house');
    expect(site(sim, uid).built).toBe(0);
    hours(sim, 8, 3);
    expect(site(sim, uid).built).toBeCloseTo(3 / hoursOf('house'), 9);
    expect(isBuilt(sim.state, uid)).toBe(false);
  });

  it('poza godzinami pracy tempo bazowe ×0,5, a budowlańcy nie pomagają', () => {
    const sim = town();
    yard(sim, 3, 1);
    const uid = startBuild(sim, 'house');
    hours(sim, 18, 4);
    expect(site(sim, uid).built).toBeCloseTo((4 * 0.5) / hoursOf('house'), 9);
    expect(buildRate(CONTENT, 20, 0)).toBe(0.5);
    expect(buildRate(CONTENT, 9, 2)).toBe(2);
  });

  it('budowlańcy przyspieszają najstarszą budowę: (1 + 0,5 × moc) / buildHours', () => {
    const sim = town();
    yard(sim, 2, 0.5); // moc 2
    const first = startBuild(sim, 'house');
    const second = startBuild(sim, 'house');
    hours(sim, 9, 1);
    expect(site(sim, first).built).toBeCloseTo((1 + 0.5 * 2) / hoursOf('house'), 9);
    expect(site(sim, second).built).toBeCloseTo(1 / hoursOf('house'), 9);
    expect(constructionQueue(sim.state, CONTENT)).toEqual([first, second]);
  });

  it('po ukończeniu najstarszej premia przechodzi na kolejną budowę', () => {
    const sim = town();
    yard(sim, 2, 0.5); // tempo najstarszej 2/h
    const tent = startBuild(sim, 'tent');
    const house = startBuild(sim, 'house');
    const events = hours(sim, 8, 2);
    expect(site(sim, tent).built).toBe(1);
    expect(ofType(events, 'constructed').map((e) => e.uid)).toEqual([tent]);
    const before = site(sim, house).built;
    hours(sim, 10, 1);
    expect(site(sim, house).built - before).toBeCloseTo(2 / hoursOf('house'), 9);
  });

  it('ukończenie: built = 1, zdarzenie constructed i wpis w kronice (raz)', () => {
    const sim = town();
    const s = sim.state;
    const uid = startBuild(sim, 'tent');
    const n = hoursOf('tent');
    const events = hours(sim, 8, n + 3);
    expect(site(sim, uid).built).toBe(1);
    const done = ofType(events, 'constructed');
    expect(done).toHaveLength(1);
    expect(done[0]).toEqual({ type: 'constructed', uid, building: 'tent', at: centerOf(CONTENT, objectByUid(s, uid)!) });
    expect(s.settlement.chronicle.filter((e) => e.kind === 'constructed')).toEqual([
      { day: DAY, hour: 8 + n - 1, kind: 'constructed', params: { building: 'tent' } },
    ]);
    expect(isBuilt(s, uid)).toBe(true);
    expect(isOperational(s, uid)).toBe(true);
  });

  it('suma ułamków kończy budowę mimo błędów zaokrągleń', () => {
    const sim = town();
    const uid = startBuild(sim, 'lumber'); // 6 h: 6 × 1/6 ≠ 1 w arytmetyce zmiennoprzecinkowej
    const events = hours(sim, 7, hoursOf('lumber'));
    expect(site(sim, uid).built).toBe(1);
    expect(ofType(events, 'constructed')).toHaveLength(1);
  });

  it('budowa bez czasu budowy kończy się od razu (także nocą)', () => {
    const sim = town();
    const mill = placeBuilt(sim, 'mill');
    sim.state.settlement.sites[String(mill)] = newSite(0);
    const events = hours(sim, 23, 1);
    expect(site(sim, mill).built).toBe(1);
    expect(ofType(events, 'constructed').map((e) => e.building)).toEqual(['mill']);
  });

  it('budowa bez czasu budowy nie zabiera premii budowlańców', () => {
    const sim = town();
    yard(sim, 2, 0.5);
    const mill = placeBuilt(sim, 'mill');
    const house = startBuild(sim, 'house');
    sim.state.settlement.sites[String(mill)] = newSite(0);
    hours(sim, 8, 1);
    expect(site(sim, house).built).toBeCloseTo(2 / hoursOf('house'), 9);
  });

  it('pożar wstrzymuje budowę, premia trafia do następnej', () => {
    const sim = town();
    yard(sim, 2, 0.5);
    const first = startBuild(sim, 'house');
    const second = startBuild(sim, 'house');
    site(sim, first).fire = 1;
    hours(sim, 8, 1);
    expect(site(sim, first).built).toBe(0);
    expect(site(sim, second).built).toBeCloseTo(2 / hoursOf('house'), 9);
    expect(constructionQueue(sim.state, CONTENT)).toEqual([second]);
  });

  it('stan budowy bez obiektu jest pomijany', () => {
    const sim = town();
    sim.state.settlement.sites['9999'] = newSite(0);
    const events = hours(sim, 8, 5);
    expect(sim.state.settlement.sites['9999']!.built).toBe(0);
    expect(events).toEqual([]);
  });

  it('w symulacji budowa postępuje co pełną godzinę gry', () => {
    const sim = town();
    setTime(sim.state, DAY, 8);
    const uid = startBuild(sim, 'tent');
    sim.takeEvents();
    runHours(sim, hoursOf('tent'));
    expect(site(sim, uid).built).toBe(1);
    expect(sim.takeEvents().filter((e) => e.type === 'constructed')).toHaveLength(1);
  });
});

describe('osada: naprawy przez budowlańców', () => {
  it('awaria naprawiona w 3 godziny pracy jednego budowlańca', () => {
    const sim = town();
    yard(sim, 1, 0.5); // moc 1
    const mill = placeBuilt(sim, 'mill');
    ensureSite(sim.state, mill).broken = true;
    expect(isOperational(sim.state, mill)).toBe(false);
    let events = hours(sim, 8, 2);
    expect(site(sim, mill).repair).toBeCloseTo(2 / 3, 9);
    expect(site(sim, mill).broken).toBe(true);
    expect(events).toEqual([]);
    events = hours(sim, 10, 1);
    expect(site(sim, mill)).toMatchObject({ broken: false, damage: 0, repair: 0 });
    expect(ofType(events, 'repaired')).toEqual([{ type: 'repaired', uid: mill, at: centerOf(CONTENT, objectByUid(sim.state, mill)!) }]);
    expect(sim.state.settlement.chronicle[0]).toMatchObject({ kind: 'repaired', params: { building: 'mill' } });
    expect(isOperational(sim.state, mill)).toBe(true);
  });

  it('tempo naprawy × min(1, moc): słabi budowlańcy wolniej, nadmiar nie przyspiesza', () => {
    const weak = town();
    yard(weak, 1, 0); // moc 0,5
    const a = placeBuilt(weak, 'tent');
    ensureSite(weak.state, a).damage = 0.4;
    hours(weak, 8, 1);
    expect(site(weak, a).repair).toBeCloseTo(0.05, 9);

    const strong = town();
    yard(strong, 3, 1); // moc 4,5
    const b = placeBuilt(strong, 'tent');
    ensureSite(strong.state, b).damage = 0.4;
    hours(strong, 7, 1);
    expect(site(strong, b).repair).toBeCloseTo(0.1, 9);
    hours(strong, 8, 9); // razem 10 godzin pracy (7:00–16:00)
    expect(site(strong, b)).toMatchObject({ damage: 0, repair: 0 });
  });

  it('jeden budynek na godzinę, najpierw największe uszkodzenia', () => {
    const sim = town();
    yard(sim, 2, 0.5);
    const small = placeBuilt(sim, 'tent');
    const big = placeBuilt(sim, 'tent');
    ensureSite(sim.state, small).damage = 0.3;
    ensureSite(sim.state, big).damage = 0.6;
    expect(repairQueue(sim.state)).toEqual([big, small]);
    const events = hours(sim, 7, 10);
    expect(site(sim, big).damage).toBe(0);
    expect(site(sim, small)).toMatchObject({ damage: 0.3, repair: 0 });
    expect(ofType(events, 'repaired').map((e) => e.uid)).toEqual([big]);
    hours(sim, 7, 1, DAY + 1);
    expect(site(sim, small).repair).toBeCloseTo(0.1, 9);
  });

  it('przy równych uszkodzeniach pierwszeństwo ma mniejszy uid', () => {
    const sim = town();
    yard(sim, 1, 0.5);
    const a = placeBuilt(sim, 'tent');
    const b = placeBuilt(sim, 'tent');
    ensureSite(sim.state, b).damage = 0.2;
    ensureSite(sim.state, a).damage = 0.2;
    hours(sim, 8, 1);
    expect(site(sim, a).repair).toBeGreaterThan(0);
    expect(site(sim, b).repair).toBe(0);
  });

  it('bez budowlańców i poza godzinami pracy brak samonaprawy', () => {
    const sim = town();
    const mill = placeBuilt(sim, 'mill');
    ensureSite(sim.state, mill).broken = true;
    hours(sim, 0, 48);
    expect(site(sim, mill)).toMatchObject({ broken: true, repair: 0 });

    yard(sim, 2, 0.5);
    hours(sim, 17, 14); // 17:00–6:00
    expect(site(sim, mill).repair).toBe(0);
  });

  it('pożar blokuje naprawę – budowlańcy zajmują się innym budynkiem', () => {
    const sim = town();
    yard(sim, 1, 0.5);
    const burning = placeBuilt(sim, 'tent');
    const other = placeBuilt(sim, 'tent');
    Object.assign(ensureSite(sim.state, burning), { damage: 0.8, fire: 2 });
    ensureSite(sim.state, other).damage = 0.1;
    expect(repairQueue(sim.state)).toEqual([other]);
    hours(sim, 8, 1);
    expect(site(sim, burning).repair).toBe(0);
    expect(site(sim, other).repair).toBeCloseTo(0.1, 9);
  });

  it('zniszczony plac budowy nie naprawi się sam', () => {
    const sim = town();
    const builders = yard(sim, 3, 1);
    ensureSite(sim.state, builders).damage = 0.6;
    hours(sim, 7, 30);
    expect(site(sim, builders)).toMatchObject({ damage: 0.6, repair: 0 });
  });

  it('naprawa usuwa aktywną awarię tego budynku z wydarzeń', () => {
    const sim = town();
    yard(sim, 1, 0.5);
    const mill = placeBuilt(sim, 'mill');
    const bakery = placeBuilt(sim, 'bakery');
    ensureSite(sim.state, mill).broken = true;
    ensureSite(sim.state, bakery).broken = true;
    const far = sim.state.clock.simMs * 10;
    sim.state.settlement.events.push({ id: 1, kind: 'breakdown', target: mill, untilMs: far }, { id: 2, kind: 'breakdown', target: bakery, untilMs: far });
    hours(sim, 8, 3);
    expect(site(sim, mill).broken).toBe(false);
    expect(sim.state.settlement.events.map((e) => e.target)).toEqual([bakery]);
  });
});

describe('osada: komenda repair', () => {
  it('koszt 20% ceny budynku, minimum 20', () => {
    expect(repairCost(CONTENT, 'mill')).toBe(Math.round(0.2 * CONTENT.buildings.mill!.cost));
    expect(repairCost(CONTENT, 'tent')).toBe(20);
    expect(repairCost(CONTENT, 'manor')).toBe(Math.round(0.2 * CONTENT.buildings.manor!.cost));
  });

  it('płaci, zapisuje inwestycję, czyści uszkodzenia i awarię, emituje repaired', () => {
    const sim = town();
    const s = sim.state;
    setTime(s, DAY, 12);
    const mill = placeBuilt(sim, 'mill');
    Object.assign(ensureSite(s, mill), { broken: true, damage: 0.7, repair: 0.4 });
    s.settlement.events.push({ id: 7, kind: 'breakdown', target: mill, untilMs: s.clock.simMs * 10 });
    const coins = s.coins;
    const invest = s.settlement.budget[0]!.investments;
    sim.takeEvents();
    ok(sim, { type: 'repair', uid: mill });
    const cost = repairCost(CONTENT, 'mill');
    expect(s.coins).toBe(coins - cost);
    expect(s.settlement.budget[0]!.investments).toBe(invest + cost);
    expect(site(sim, mill)).toMatchObject({ broken: false, damage: 0, repair: 0 });
    expect(s.settlement.events).toEqual([]);
    expect(sim.takeEvents().filter((e) => e.type === 'repaired')).toEqual([
      { type: 'repaired', uid: mill, at: centerOf(CONTENT, objectByUid(s, mill)!) },
    ]);
    expect(s.settlement.chronicle[0]).toEqual({ day: DAY, hour: 12, kind: 'repaired', params: { building: 'mill' } });
    expect(isOperational(s, mill)).toBe(true);
  });

  it('naprawia samo uszkodzenie po pożarze za minimalną cenę', () => {
    const sim = town();
    const tent = placeBuilt(sim, 'tent');
    site(sim, tent).damage = 0.55;
    const coins = sim.state.coins;
    ok(sim, { type: 'repair', uid: tent });
    expect(sim.state.coins).toBe(coins - 20);
    expect(site(sim, tent).damage).toBe(0);
  });

  it('błędy: nieznany budynek, brak uszkodzeń, trwający pożar, brak monet', () => {
    const sim = town();
    const s = sim.state;
    const mill = placeBuilt(sim, 'mill');
    expect(reason(sim, { type: 'repair', uid: 9999 })).toBe('invalid');
    expect(reason(sim, { type: 'repair', uid: mill })).toBe('not-damaged');
    ensureSite(s, mill);
    expect(reason(sim, { type: 'repair', uid: mill })).toBe('not-damaged');
    Object.assign(site(sim, mill), { damage: 0.6, fire: 1 });
    expect(reason(sim, { type: 'repair', uid: mill })).toBe('busy');
    site(sim, mill).fire = 0;
    s.coins = repairCost(CONTENT, 'mill') - 1;
    const snapshot = JSON.stringify(s);
    expect(reason(sim, { type: 'repair', uid: mill })).toBe('no-coins');
    expect(JSON.stringify(s)).toBe(snapshot);
    s.coins += 1;
    ok(sim, { type: 'repair', uid: mill });
    expect(s.coins).toBe(0);
  });
});

describe('osada: determinizm i wydajność budowy', () => {
  const scenario = (seed: number) => {
    const sim = town(() => {}, seed);
    const s = sim.state;
    yard(sim, 2, 0.4);
    const mill = placeBuilt(sim, 'mill');
    ensureSite(s, mill).broken = true;
    const tent = placeBuilt(sim, 'tent');
    ensureSite(s, tent).damage = 0.5;
    startBuild(sim, 'house');
    startBuild(sim, 'lumber');
    startBuild(sim, 'tent');
    const rng = s.rng;
    const events = hours(sim, 5, 60);
    return { rng, sim, events };
  };

  it('ten sam stan → ten sam wynik, bez zużywania losowości', () => {
    const a = scenario(7);
    const b = scenario(7);
    expect(JSON.stringify(b.sim.state.settlement)).toBe(JSON.stringify(a.sim.state.settlement));
    expect(b.events).toEqual(a.events);
    expect(a.sim.state.rng).toBe(a.rng);
    expect(ofType(a.events, 'constructed')).toHaveLength(3);
    expect(ofType(a.events, 'repaired')).toHaveLength(2);
  });

  it('150 budów i 200 mieszkańców: godzina budowy mieści się w budżecie czasu', () => {
    const sim = town();
    const s = sim.state;
    const builders = yard(sim, 3, 0.6);
    for (let i = 0; i < 197; i++) addResident(s, { happiness: 0.5 });
    for (let i = 0; i < 150; i++) {
      const uid = s.nextUid++;
      s.objects.push({ uid, type: 'house', x: i % 64, y: Math.floor(i / 64) });
      s.settlement.sites[String(uid)] = Object.assign(newSite(0), { damage: (i % 7) / 10 });
    }
    expect(builders).toBeGreaterThan(0);
    const { ctx } = at(sim, 9);
    constructionHour(ctx, 9);
    const t0 = performance.now();
    const n = 200;
    for (let i = 0; i < n; i++) constructionHour(ctx, 9);
    expect((performance.now() - t0) / n).toBeLessThan(1);
  });
});
