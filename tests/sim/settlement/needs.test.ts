import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/content';
import { EventBus } from '../../../src/core/eventBus';
import { calendarAt } from '../../../src/sim/calendar';
import { makeCtx, type Ctx } from '../../../src/sim/ctx';
import type { SimEvent } from '../../../src/sim/events';
import { newSite } from '../../../src/sim/systems/settlement/common';
import {
  averageHappiness,
  foodStock,
  happinessTarget,
  mealDue,
  mealOrder,
  needTargets,
  needsDay,
  needsHour,
  serveMeal,
} from '../../../src/sim/systems/settlement/needs';
import type { GameState, Resident } from '../../../src/sim/types';
import { DAY_MS, setTime } from '../helpers';
import { addResident, makeTown, runHours } from './helpers';

// Budynki stawiamy bezpośrednio w stanie (dokładne położenie i obsada) na północ od farmy, z dala od wioski.
// Pokrycie usług jest w cache na godzinę gry – każdy scenariusz buduje osobny stan przed pierwszym zapytaniem.

const DAY = 3;

function put(s: GameState, type: string, x: number, y: number, site = true): number {
  const uid = s.nextUid++;
  s.objects.push({ uid, type, x, y });
  if (site) s.settlement.sites[String(uid)] = newSite(1);
  return uid;
}

function ctxOf(s: GameState, hour = 10, day = DAY): Ctx {
  setTime(s, day, hour);
  return makeCtx(s, new EventBus<SimEvent>(), calendarAt(s.clock.simMs, s.seed));
}

/** Osada bez zapasów (tylko materiały budowlane z makeTown) i z podanym jedzeniem. */
function town(food: Record<string, number> = {}): GameState {
  const s = makeTown().state;
  Object.assign(s.inventory, food);
  return s;
}

/** Pracownicy (bezdomni – nie wpływają na sprzedaż) zatrudnieni w budynku. */
function staff(s: GameState, uid: number, n: number): Resident[] {
  return Array.from({ length: n }, () => addResident(s, { job: uid }));
}

const site = (s: GameState, uid: number) => s.settlement.sites[String(uid)]!;

describe('osada: posiłki', () => {
  it('popyt: dorosły 1, dziecko 0,5; najtańsze jedzenie (cena/odżywczość) najpierw', () => {
    const s = town({ bread: 2, radish: 1, roach: 1, berries: 5 });
    const rs = [addResident(s), addResident(s), addResident(s, { child: true }), addResident(s, { child: true })];
    expect(rs.map(mealDue)).toEqual([1, 1, 0.5, 0.5]);
    expect(mealOrder(s, CONTENT).map((f) => f.key)).toEqual(['radish', 'roach', 'berries', 'bread']);
    const res = serveMeal(ctxOf(s, 7));
    expect(res.demand).toBe(3);
    expect(res.covered).toBe(3); // rzodkiewka (1) + płoć (2)
    expect(res.ratio).toBe(1);
    expect(res.kinds).toEqual(['radish', 'roach']);
    expect(s.inventory.radish).toBeUndefined();
    expect(s.inventory.roach).toBeUndefined();
    expect(s.inventory.berries).toBe(5);
    expect(s.inventory.bread).toBe(2);
  });

  it('remis ceny/odżywczości rozstrzyga klucz', () => {
    const s = town({ carrot: 1, berries: 1, moonmelon: 1, bread: 1 });
    expect(mealOrder(s, CONTENT).map((f) => f.key)).toEqual(['berries', 'carrot', 'bread', 'moonmelon']);
    addResident(s);
    serveMeal(ctxOf(s, 7));
    expect(s.inventory.berries).toBeUndefined();
    expect(s.inventory.carrot).toBe(1);
  });

  it('jakości: najpierw zwykła, potem srebrna; złota zostaje', () => {
    const s = town({ 'radish*2': 1, 'radish*1': 1, radish: 1 });
    addResident(s);
    addResident(s);
    serveMeal(ctxOf(s, 7));
    expect(s.inventory).toMatchObject({ 'radish*2': 1 });
    expect(s.inventory.radish).toBeUndefined();
    expect(s.inventory['radish*1']).toBeUndefined();
  });

  it('rezerwa: zarezerwowane jedzenie nie jest jedzone', () => {
    const s = town({ radish: 5, carrot: 5 });
    s.settlement.reserved = ['radish'];
    addResident(s);
    expect(foodStock(s, CONTENT)).toBe(5);
    serveMeal(ctxOf(s, 7));
    expect(s.inventory).toMatchObject({ radish: 5, carrot: 4 });
    s.settlement.reserved = ['radish', 'carrot'];
    const res = serveMeal(ctxOf(s, 18));
    expect(res.ratio).toBe(0);
    expect(s.inventory).toMatchObject({ radish: 5, carrot: 4 });
  });

  it('całe sztuki: ostatnia sztuka może przekroczyć popyt', () => {
    const s = town({ bread: 3 });
    const a = addResident(s);
    const k = addResident(s, { child: true });
    const res = serveMeal(ctxOf(s, 7));
    expect(res.covered).toBe(4);
    expect(res.ratio).toBe(1);
    expect(s.inventory.bread).toBe(2);
    expect(a.meals).toEqual({ eaten: 1, due: 1, kinds: ['bread'] });
    expect(k.meals).toEqual({ eaten: 0.5, due: 0.5, kinds: ['bread'] });
  });

  it('częściowy głód: każdy zjada odsetek pokrytego popytu', () => {
    const s = town({ radish: 2 });
    const adults = [addResident(s), addResident(s), addResident(s)];
    const kids = [addResident(s, { child: true }), addResident(s, { child: true })];
    const res = serveMeal(ctxOf(s, 7));
    expect(res.ratio).toBe(0.5);
    for (const r of adults) expect(r.meals).toMatchObject({ eaten: 0.5, due: 1 });
    for (const r of kids) expect(r.meals).toMatchObject({ eaten: 0.25, due: 0.5 });
    expect(s.inventory.radish).toBeUndefined();
  });

  it('bez jedzenia: należne rośnie, zjedzone nie, bez rodzajów', () => {
    const s = town();
    const r = addResident(s);
    serveMeal(ctxOf(s, 7));
    expect(r.meals).toEqual({ eaten: 0, due: 1, kinds: [] });
  });

  it('posiłki tylko o godzinach mealHours; liczniki doby się sumują', () => {
    const s = town({ radish: 10 });
    const r = addResident(s);
    needsHour(ctxOf(s, 8), 8);
    expect(r.meals.due).toBe(0);
    expect(s.inventory.radish).toBe(10);
    for (const h of CONTENT.settlement.constants.mealHours) needsHour(ctxOf(s, h), h);
    expect(r.meals).toEqual({ eaten: 2, due: 2, kinds: ['radish'] });
    expect(s.inventory.radish).toBe(8);
  });

  it('rodzaje potraw: unikalne, najwyżej 12', () => {
    const s = town({ radish: 1, roach: 1 });
    const kinds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'radish', 'k'];
    const r = addResident(s, { meals: { eaten: 0, due: 0, kinds: [...kinds] } });
    addResident(s, { child: true });
    addResident(s, { child: true });
    serveMeal(ctxOf(s, 7));
    expect(r.meals.kinds).toEqual([...kinds, 'roach']);
    expect(r.meals.kinds.length).toBe(12);
  });

  it('brak mieszkańców – brak posiłku', () => {
    const s = town({ radish: 3 });
    needsHour(ctxOf(s, 7), 7);
    expect(s.inventory.radish).toBe(3);
  });
});

describe('osada: sprzedaż jedzenia', () => {
  /** Sklep (2 etaty, zasięg 9) w (10, 4), dom w zasięgu i dom daleko. */
  function shopTown(workers: number, food: Record<string, number>) {
    const s = town(food);
    const shop = put(s, 'shop', 10, 4); // środek (11; 5)
    const near = put(s, 'hut', 12, 8); // środek (13; 9)
    const far = put(s, 'hut', 40, 8); // środek (41; 9)
    staff(s, shop, workers);
    const inRange = [addResident(s, { home: near }), addResident(s, { home: near }), addResident(s, { home: near, child: true })];
    const outside = addResident(s, { home: far });
    return { s, inRange, outside };
  }

  it('posiłek w zasięgu obsadzonego sklepu: 4 monety × pkt × obsada', () => {
    const { s } = shopTown(1, { radish: 20 });
    const coins = s.coins;
    const ctx = ctxOf(s, 7);
    const res = serveMeal(ctx);
    expect(res.ratio).toBe(1);
    // 2,5 pkt w zasięgu × 4 monety × obsada 0,5 = 5
    expect(res.sales).toBe(5);
    expect(s.coins).toBe(coins + 5);
    expect(s.settlement.budget[0]).toMatchObject({ day: DAY, sales: 5 });
  });

  it('sprzedaż proporcjonalna do najedzenia', () => {
    const { s } = shopTown(2, { radish: 3 }); // popyt 2 + 2,5 + 1 = 5,5 → 3/5,5
    const coins = s.coins;
    const res = serveMeal(ctxOf(s, 7));
    expect(res.ratio).toBeCloseTo(3 / 5.5, 9);
    expect(res.sales).toBe(Math.round(4 * 2.5 * (3 / 5.5)));
    expect(s.coins).toBe(coins + res.sales);
  });

  it('sklep bez obsady, nieukończony albo bez jedzenia – brak sprzedaży', () => {
    const empty = shopTown(0, { radish: 20 });
    const coins = empty.s.coins;
    expect(serveMeal(ctxOf(empty.s, 7)).sales).toBe(0);
    expect(empty.s.coins).toBe(coins);
    expect(empty.s.settlement.budget[0]?.sales ?? 0).toBe(0);

    const building = shopTown(2, { radish: 20 });
    site(building.s, building.s.objects[0]!.uid).built = 0.5;
    expect(serveMeal(ctxOf(building.s, 7)).sales).toBe(0);

    const hungry = shopTown(2, {});
    expect(serveMeal(ctxOf(hungry.s, 7)).sales).toBe(0);
  });

  it('needsHour o 18:00 sprzedaje i zapisuje w budżecie', () => {
    const { s } = shopTown(2, { radish: 20 });
    const coins = s.coins;
    needsHour(ctxOf(s, 18), 18);
    expect(s.coins).toBe(coins + 10);
    expect(s.settlement.budget[0]!.sales).toBe(10);
  });
});

describe('osada: cele potrzeb', () => {
  it('jedzenie: odsetek zjedzonych posiłków, +0,05 za ≥ 3 potrawy, bez posiłków – bez zmian', () => {
    const s = town();
    const ctx = ctxOf(s);
    const r = addResident(s, { meals: { eaten: 1, due: 2, kinds: ['radish', 'egg'] } });
    expect(needTargets(ctx, r).food).toBeCloseTo(0.5, 9);
    r.meals.kinds.push('bread');
    expect(needTargets(ctx, r).food).toBeCloseTo(0.55, 9);
    r.meals.eaten = 2;
    expect(needTargets(ctx, r).food).toBe(1);
    r.meals = { eaten: 0, due: 0, kinds: [] };
    r.needs.food = 0.42;
    expect(needTargets(ctx, r).food).toBe(0.42);
  });

  it('mieszkanie: komfort domu, +0,1 w zasięgu studni (max 1), bezdomny 0', () => {
    const s = town();
    const tent = put(s, 'tent', 10, 10);
    const manor = put(s, 'manor', 30, 10);
    const tentFar = put(s, 'tent', 50, 20);
    put(s, 'well', 12, 10); // zasięg 6 – namiot w (10, 10)
    put(s, 'well', 32, 13);
    const a = addResident(s, { home: tent });
    const b = addResident(s, { home: manor });
    const c = addResident(s, { home: tentFar });
    const d = addResident(s);
    const ctx = ctxOf(s);
    expect(needTargets(ctx, a).housing).toBeCloseTo(0.45, 9);
    expect(needTargets(ctx, b).housing).toBe(1);
    expect(needTargets(ctx, c).housing).toBeCloseTo(0.35, 9);
    expect(needTargets(ctx, d).housing).toBe(0);
  });

  it('praca: zatrudniony 1, bezrobotny 0,3; dziecko 0,6, w zasięgu szkoły 1', () => {
    const noTeacher = town();
    const home = put(noTeacher, 'hut', 10, 10);
    put(noTeacher, 'school', 14, 10);
    const worker = addResident(noTeacher, { home, job: 999 });
    const idle = addResident(noTeacher, { home });
    const kid = addResident(noTeacher, { home, child: true });
    const ctx = ctxOf(noTeacher);
    expect(needTargets(ctx, worker).work).toBe(1);
    expect(needTargets(ctx, idle).work).toBe(0.3);
    expect(needTargets(ctx, kid).work).toBe(0.6); // szkoła bez nauczycieli nie działa

    const taught = town();
    const h2 = put(taught, 'hut', 10, 10);
    const sc2 = put(taught, 'school', 14, 10);
    staff(taught, sc2, 1);
    const kid2 = addResident(taught, { home: h2, child: true });
    expect(needTargets(ctxOf(taught), kid2).work).toBe(1);
  });

  /** Namiot w (20, 10) i wybrane usługi wokół (z pełną obsadą lub `medics` medyków). */
  function safetyTown(opts: { police?: boolean; fire?: boolean; clinic?: number; light?: boolean; burning?: [number, number] }) {
    const s = town();
    const tent = put(s, 'tent', 20, 10); // środek (20,5; 10,5)
    if (opts.police) staff(s, put(s, 'police', 14, 10), 2);
    if (opts.fire) staff(s, put(s, 'firestation', 24, 10), 3);
    if (opts.clinic) staff(s, put(s, 'clinic', 20, 4), opts.clinic);
    if (opts.light) put(s, 'lantern', 22, 12, false);
    if (opts.burning) site(s, put(s, 'hut', opts.burning[0], opts.burning[1])).fire = 1;
    const r = addResident(s, { home: tent });
    return needTargets(ctxOf(s), r).safety;
  }

  it('bezpieczeństwo: 0,35 + 0,3 policja + 0,15 straż + 0,1 przychodnia + 0,1 światło', () => {
    expect(safetyTown({})).toBeCloseTo(0.35, 6);
    expect(safetyTown({ police: true })).toBeCloseTo(0.65, 6);
    expect(safetyTown({ fire: true })).toBeCloseTo(0.5, 6);
    expect(safetyTown({ clinic: 1 })).toBeCloseTo(0.4, 6); // obsada 1/2
    expect(safetyTown({ light: true })).toBeCloseTo(0.45, 6);
    expect(safetyTown({ police: true, fire: true, clinic: 2, light: true })).toBeCloseTo(1, 6);
    const s = town();
    expect(needTargets(ctxOf(s), addResident(s)).safety).toBeCloseTo(0.35, 6); // bezdomny
  });

  it('pożar budynku w promieniu 6 od domu: −0,3; dalej – bez wpływu', () => {
    expect(safetyTown({ burning: [24, 10] })).toBeCloseTo(0.05, 6); // środek (25; 11) – 4,5 kafla
    expect(safetyTown({ burning: [30, 10] })).toBeCloseTo(0.35, 6); // 10,5 kafla
    expect(safetyTown({ police: true, burning: [17, 12] })).toBeCloseTo(0.35, 6);
  });

  it('kilka pożarów w pobliżu – kara tylko raz', () => {
    const s = town();
    const tent = put(s, 'tent', 20, 10);
    site(s, put(s, 'hut', 22, 10)).fire = 2;
    site(s, put(s, 'hut', 18, 12)).fire = 1;
    const r = addResident(s, { home: tent });
    expect(needTargets(ctxOf(s), r).safety).toBeCloseTo(0.05, 6);
  });

  /** Namiot w (20, 10) z dekoracjami w podanych miejscach. */
  function funTown(decos: [string, number, number][], extra: (s: GameState) => void = () => {}) {
    const s = town();
    const tent = put(s, 'tent', 20, 10); // środek (20,5; 10,5)
    for (const [type, x, y] of decos) put(s, type, x, y, false);
    extra(s);
    const r = addResident(s, { home: tent });
    return needTargets(ctxOf(s), r).fun;
  }

  it('rozrywka: dekoracje w promieniu 3 od domu (+0,05, max 0,2)', () => {
    expect(funTown([])).toBeCloseTo(0.3, 6);
    // 1,4 / 2 / 3 kafle – liczą się; 4 kafle – nie.
    expect(funTown([['flowers', 21, 11], ['flowers', 22, 10], ['fence', 23, 10], ['flowers', 24, 10]])).toBeCloseTo(0.45, 6);
    const six: [string, number, number][] = [
      ['flowers', 19, 10],
      ['flowers', 21, 10],
      ['fence', 20, 9],
      ['fence', 20, 11],
      ['bench', 18, 12],
      ['scarecrow', 22, 9],
    ];
    expect(funTown(six)).toBeCloseTo(0.5, 6);
    expect(funTown([['well', 21, 10], ['lantern', 19, 10]])).toBeCloseTo(0.3, 6); // nie są dekoracjami
  });

  it('rozrywka: plac/karczma (wartość × obsada) i festyn (+0,15), max 1', () => {
    expect(funTown([], (s) => put(s, 'plaza', 14, 8))).toBeCloseTo(0.6, 6); // 0,3 + 0,5 × 0,6
    expect(funTown([], (s) => staff(s, put(s, 'tavern', 14, 10), 1))).toBeCloseTo(0.7, 6); // 0,3 + 0,5 × 0,8
    expect(funTown([], (s) => put(s, 'tavern', 14, 10))).toBeCloseTo(0.3, 6); // karczma bez obsady
    const festival = (s: GameState) => s.settlement.events.push({ id: 1, kind: 'festival', untilMs: s.clock.simMs + 10 * DAY_MS });
    expect(funTown([], festival)).toBeCloseTo(0.45, 6);
    const all: [string, number, number][] = [
      ['flowers', 19, 10],
      ['flowers', 21, 10],
      ['fence', 20, 9],
      ['fence', 20, 11],
    ];
    expect(
      funTown(all, (s) => {
        festival(s);
        staff(s, put(s, 'tavern', 14, 10), 1);
      }),
    ).toBe(1);
  });

  it('festyn po czasie nie działa', () => {
    const v = funTown([], (s) => s.settlement.events.push({ id: 1, kind: 'festival', untilMs: 0 }));
    expect(v).toBeCloseTo(0.3, 6);
  });
});

describe('osada: dążenie potrzeb i szczęścia', () => {
  it('potrzeby dążą do celu o 25% na godzinę', () => {
    const s = town();
    const r = addResident(s); // bezdomny, bezrobotny, bez usług
    needsHour(ctxOf(s, 10), 10);
    expect(r.needs.food).toBeCloseTo(0.8, 9); // bez posiłków – bez zmian
    expect(r.needs.housing).toBeCloseTo(0.6, 9);
    expect(r.needs.work).toBeCloseTo(0.675, 9);
    expect(r.needs.safety).toBeCloseTo(0.6875, 9);
    expect(r.needs.fun).toBeCloseTo(0.675, 9);
  });

  it('szczęście: Σ waga × potrzeba − podatek × 1,2, dążenie o 25%', () => {
    const s = town();
    const r = addResident(s);
    needsHour(ctxOf(s, 10), 10);
    const target = 0.3 * 0.8 + 0.2 * 0.6 + 0.2 * 0.675 + 0.15 * 0.6875 + 0.15 * 0.675 - 0.1 * 1.2;
    expect(r.happiness).toBeCloseTo(0.8 + (target - 0.8) * 0.25, 9);
  });

  it('podatek obniża szczęście', () => {
    const run = (rate: number): number => {
      const s = town();
      s.settlement.taxRate = rate;
      const r = addResident(s, { happiness: 0.5 });
      needsHour(ctxOf(s, 10), 10);
      return r.happiness;
    };
    expect(run(0) - run(0.3)).toBeCloseTo(0.25 * 0.3 * 1.2, 9);
    expect(run(0.1)).toBeLessThan(run(0));
  });

  it('relacje i nastrój zmieniają cel szczęścia; nastrój działa do untilDay włącznie', () => {
    const s = town();
    const a = addResident(s);
    const b = addResident(s);
    const c = addResident(s);
    const ctx = ctxOf(s);
    const base = happinessTarget(ctx, a);
    s.settlement.relations.push({ a: a.id, b: b.id, kind: 'friend', v: 0.4 });
    expect(happinessTarget(ctx, a)).toBeCloseTo(base + 0.03, 9);
    s.settlement.relations.push({ a: a.id, b: c.id, kind: 'conflict', v: 0.4 });
    expect(happinessTarget(ctx, a)).toBeCloseTo(base - 0.02, 9);
    a.mood = { value: 0.1, untilDay: DAY };
    expect(happinessTarget(ctx, a)).toBeCloseTo(base + 0.08, 9);
    a.mood = { value: 0.1, untilDay: DAY - 1 };
    expect(happinessTarget(ctx, a)).toBeCloseTo(base - 0.02, 9);
  });

  it('relacje działają w needsHour', () => {
    const run = (friend: boolean): number => {
      const s = town();
      const a = addResident(s);
      const b = addResident(s);
      if (friend) s.settlement.relations.push({ a: a.id, b: b.id, kind: 'partner', v: 1 });
      needsHour(ctxOf(s, 10), 10);
      return a.happiness;
    };
    expect(run(true) - run(false)).toBeCloseTo(0.25 * 0.05, 9);
  });

  it('cel szczęścia przycięty do 0..1', () => {
    const s = town();
    const r = addResident(s, { mood: { value: 2, untilDay: DAY } });
    const ctx = ctxOf(s);
    expect(happinessTarget(ctx, r)).toBe(1);
    r.mood = { value: -2, untilDay: DAY };
    expect(happinessTarget(ctx, r)).toBe(0);
  });

  it('szczęście zbiega do celu przy stałych warunkach', () => {
    const s = town();
    const home = put(s, 'manor', 10, 10);
    put(s, 'well', 13, 10);
    const r = addResident(s, { home, job: 999, happiness: 0.1 });
    for (let i = 0; i < 60; i++) needsHour(ctxOf(s, 10), 10);
    const t = needTargets(ctxOf(s, 10), r);
    expect(t.housing).toBe(1);
    expect(r.needs.housing).toBeCloseTo(1, 6);
    expect(r.needs.work).toBeCloseTo(1, 6);
    expect(r.happiness).toBeCloseTo(happinessTarget(ctxOf(s, 10), r), 4);
    expect(averageHappiness(s)).toBeCloseTo(r.happiness, 9);
  });

  it('głód obniża potrzebę jedzenia i szczęście; jedzenie je podnosi', () => {
    const fed = town({ bread: 50 });
    const hungry = town();
    const a = addResident(fed, { needs: { food: 0.5, housing: 0.5, work: 0.5, safety: 0.5, fun: 0.5 } });
    const b = addResident(hungry, { needs: { food: 0.5, housing: 0.5, work: 0.5, safety: 0.5, fun: 0.5 } });
    for (let h = 0; h < 24; h++) {
      needsHour(ctxOf(fed, h), h);
      needsHour(ctxOf(hungry, h), h);
    }
    expect(a.needs.food).toBeGreaterThan(0.95);
    expect(b.needs.food).toBeLessThan(0.05);
    expect(a.happiness).toBeGreaterThan(b.happiness);
  });
});

describe('osada: rozliczenie doby potrzeb', () => {
  it('sadDays rośnie przy szczęściu < 0,25, zeruje się przy wyższym', () => {
    const s = town();
    const sad = addResident(s, { happiness: 0.2, sadDays: 2 });
    const ok = addResident(s, { happiness: 0.25, sadDays: 2 });
    needsDay(ctxOf(s, 0));
    expect(sad.sadDays).toBe(3);
    expect(ok.sadDays).toBe(0);
  });

  it('licznik posiłków zerowany; wygasły nastrój usuwany, trwający zostaje', () => {
    const s = town();
    const a = addResident(s, { meals: { eaten: 1, due: 2, kinds: ['radish'] }, mood: { value: 0.05, untilDay: DAY - 1 } });
    const b = addResident(s, { mood: { value: -0.15, untilDay: DAY } });
    needsDay(ctxOf(s, 0));
    expect(a.meals).toEqual({ eaten: 0, due: 0, kinds: [] });
    expect(b.meals).not.toBe(a.meals);
    expect(a.mood).toEqual({ value: 0, untilDay: -1 });
    expect(b.mood).toEqual({ value: -0.15, untilDay: DAY });
  });
});

describe('osada: determinizm potrzeb', () => {
  function scenario(): GameState {
    const s = town({ radish: 6, bread: 3, 'carrot*1': 4, egg: 2 });
    const homes = [put(s, 'hut', 10, 10), put(s, 'house', 14, 10), put(s, 'tent', 18, 10)];
    const shop = put(s, 'shop', 10, 4);
    put(s, 'well', 13, 13);
    put(s, 'flowers', 16, 13, false);
    staff(s, shop, 1);
    for (let i = 0; i < 9; i++) addResident(s, { home: homes[i % 3]!, child: i % 4 === 3, happiness: 0.3 + i * 0.05 });
    s.settlement.relations.push({ a: 2, b: 3, kind: 'friend', v: 0.3 });
    return s;
  }

  it('ten sam stan → te same potrzeby, szczęście, magazyn i monety po dwóch dobach', () => {
    const a = scenario();
    const b = scenario();
    for (const s of [a, b]) {
      for (let h = 0; h < 48; h++) {
        const day = DAY + Math.floor(h / 24);
        if (h % 24 === 0 && h > 0) needsDay(ctxOf(s, 0, day));
        needsHour(ctxOf(s, h % 24, day), h % 24);
      }
    }
    expect(JSON.stringify(a.settlement.residents)).toBe(JSON.stringify(b.settlement.residents));
    expect(a.inventory).toEqual(b.inventory);
    expect(a.coins).toBe(b.coins);
    expect(a.settlement.budget).toEqual(b.settlement.budget);
  });
});

describe('osada: potrzeby w symulacji', () => {
  it('posiłek o 7:00 zużywa jedzenie z magazynu', () => {
    const sim = makeTown((s) => {
      s.inventory.radish = 5;
    });
    const s = sim.state;
    setTime(s, DAY, 5);
    const r = addResident(s);
    runHours(sim, 3);
    expect(s.inventory.radish).toBe(4);
    expect(r.meals.due).toBe(1);
    expect(r.meals.eaten).toBe(1);
  });
});
