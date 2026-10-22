import { describe, expect, it } from 'vitest';
import { CONTENT, type Content, type ProposalTpl } from '../../../src/content/content';
import { EventBus } from '../../../src/core/eventBus';
import { calendarAt } from '../../../src/sim/calendar';
import { makeCtx, type Ctx } from '../../../src/sim/ctx';
import type { SimEvent } from '../../../src/sim/events';
import type { Simulation } from '../../../src/sim/simulation';
import { placeCost } from '../../../src/sim/systems/building';
import {
  COUNCIL_MOOD,
  NAME_MAX,
  cleanName,
  councilDay,
  disconnectedBuildings,
  makeConditions,
  voucherDiscount,
  voucherRate,
} from '../../../src/sim/systems/settlement/council';
import { funBoost } from '../../../src/sim/systems/settlement/events';
import type { GameState, Resident } from '../../../src/sim/types';
import { DAY_MS, reason, setTime } from '../helpers';
import { addResident, freeSpot, makeTown, ok, placeBuilt, runHours } from './helpers';

const DAY = 5;
const K = CONTENT.settlement.constants;

/** Kontekst na początek danego dnia (bez kroku symulacji) ze zbieraniem zdarzeń. */
function at(sim: Simulation, day = DAY, c: Content = CONTENT, hour = 0): { ctx: Ctx; events: SimEvent[] } {
  setTime(sim.state, day, hour);
  const bus = new EventBus<SimEvent>();
  const events: SimEvent[] = [];
  bus.onAny((e) => events.push(e));
  return { ctx: makeCtx(sim.state, bus, calendarAt(sim.state.clock.simMs, sim.state.seed), c), events };
}

/** Rada danego dnia; zwraca zdarzenia. */
function council(sim: Simulation, day = DAY, c: Content = CONTENT): SimEvent[] {
  const { ctx, events } = at(sim, day, c);
  councilDay(ctx);
  return events;
}

/** Warunek `when` w bieżącym stanie. */
function cond(sim: Simulation, when: string, peakTier?: number): boolean {
  if (peakTier !== undefined) sim.state.settlement.peakTier = peakTier;
  return makeConditions(at(sim).ctx)(when);
}

/** Osada z pustym magazynem (makeTown daje drewno i deski ponad pojemność) i danym etapem. */
function town(peakTier = 1, seed = 42): Simulation {
  const sim = makeTown(() => {}, seed, Math.max(2, peakTier));
  sim.state.settlement.peakTier = peakTier;
  sim.state.inventory = {};
  return sim;
}

function people(s: GameState, n: number, patch: Partial<Resident> = {}): Resident[] {
  return Array.from({ length: n }, () => addResident(s, { ...patch, needs: { food: 0.8, housing: 0.8, work: 0.8, safety: 0.8, fun: 0.8, ...patch.needs } }));
}

/** Treść tylko z wybranymi szablonami (opcjonalnie z podmienionym warunkiem). */
function only(ids: string[], when?: string, extra: ProposalTpl[] = []): Content {
  const proposals = CONTENT.settlement.proposals.filter((p) => ids.includes(p.id)).map((p) => (when ? { ...p, when } : p));
  return { ...CONTENT, settlement: { ...CONTENT.settlement, proposals: [...proposals, ...extra] } };
}

/** Stawia gotowy budynek (komendą) z tymczasowym zapasem materiałów – magazyn wraca do stanu sprzed budowy. */
function build(sim: Simulation, type: string): number {
  const inv = { ...sim.state.inventory };
  sim.state.inventory = { wood: 100, planks: 100 };
  const uid = placeBuilt(sim, type);
  sim.state.inventory = inv;
  return uid;
}

/** Wstawia gotowy obiekt bezpośrednio do stanu (bez sprawdzania terenu). */
function put(s: GameState, type: string, x: number, y: number): number {
  const uid = s.nextUid++;
  s.objects.push({ uid, type, x, y });
  return uid;
}

const proposals = (sim: Simulation) => sim.state.settlement.proposals;
const tpls = (sim: Simulation) => proposals(sim).map((p) => p.tpl);
const ofType = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

/** Jedna propozycja szablonu `tpl` (warunek podmieniony na `noWell`, populacja ≥ 2). Zwraca jej id. */
function proposed(sim: Simulation, tpl: string, day = DAY): number {
  if (sim.state.settlement.residents.length < 2) people(sim.state, 2);
  council(sim, day, only([tpl], 'noWell'));
  const p = proposals(sim).find((x) => x.tpl === tpl);
  expect(p, tpl).toBeDefined();
  return p!.id;
}

describe('rada: warunki szablonów', () => {
  it('brak studni przy ≥ 2 mieszkańcach', () => {
    const sim = town();
    people(sim.state, 1);
    expect(cond(sim, 'noWell')).toBe(false);
    people(sim.state, 1);
    expect(cond(sim, 'noWell')).toBe(true);
    const well = build(sim, 'well');
    sim.state.settlement.sites[String(well)]!.built = 0.3; // budowa się liczy
    expect(cond(sim, 'noWell')).toBe(false);
  });

  it('głód (średnia < 0,5) i głód we wsi (etap 2, < 0,6, bez piekarni)', () => {
    const sim = town();
    expect(cond(sim, 'hungry')).toBe(false); // pusta osada
    people(sim.state, 2, { needs: { food: 0.55 } as Resident['needs'] });
    expect(cond(sim, 'hungry')).toBe(false);
    expect(cond(sim, 'hungryVillage', 1)).toBe(false);
    expect(cond(sim, 'hungryVillage', 2)).toBe(true);
    people(sim.state, 2, { needs: { food: 0.3 } as Resident['needs'] });
    expect(cond(sim, 'hungry')).toBe(true);
    build(sim, 'bakery');
    expect(cond(sim, 'hungryVillage')).toBe(false);
  });

  it('ciasno: brak wolnych miejsc w domach przy ≥ 3 mieszkańcach', () => {
    const sim = town();
    const rs = people(sim.state, 2);
    expect(cond(sim, 'crowded')).toBe(false);
    rs.push(...people(sim.state, 1));
    expect(cond(sim, 'crowded')).toBe(true); // wszyscy bezdomni, brak domów
    const tent = build(sim, 'tent');
    expect(cond(sim, 'crowded')).toBe(false);
    rs[0]!.home = tent;
    rs[1]!.home = tent;
    expect(cond(sim, 'crowded')).toBe(true);
    sim.state.settlement.sites[String(tent)]!.damage = 0.7; // zniszczony dom nie daje miejsc
    rs[0]!.home = null;
    expect(cond(sim, 'crowded')).toBe(true);
  });

  it('pełny magazyn od 90% pojemności', () => {
    const sim = town();
    sim.state.inventory = { wood: 269 };
    expect(cond(sim, 'storageFull')).toBe(false);
    sim.state.inventory = { wood: 200, radish: 70 };
    expect(cond(sim, 'storageFull')).toBe(true);
  });

  it('dzieci bez szkoły (≥ 3 dzieci, etap 2)', () => {
    const sim = town(2);
    people(sim.state, 2, { child: true });
    expect(cond(sim, 'children')).toBe(false);
    people(sim.state, 1, { child: true });
    expect(cond(sim, 'children')).toBe(true);
    expect(cond(sim, 'children', 1)).toBe(false);
    sim.state.settlement.peakTier = 2;
    build(sim, 'school');
    expect(cond(sim, 'children')).toBe(false);
  });

  it('nuda (etap 2, bez placu) i brak bezpieczeństwa (bez latarni; miasteczko bez posterunku)', () => {
    const sim = town(2);
    people(sim.state, 3, { needs: { fun: 0.4, safety: 0.52 } as Resident['needs'] });
    expect(cond(sim, 'bored')).toBe(true);
    expect(cond(sim, 'bored', 1)).toBe(false);
    expect(cond(sim, 'unsafe')).toBe(false);
    expect(cond(sim, 'unsafeTown', 2)).toBe(false);
    expect(cond(sim, 'unsafeTown', 3)).toBe(true);
    people(sim.state, 3, { needs: { fun: 0.4, safety: 0.4 } as Resident['needs'] });
    expect(cond(sim, 'unsafe')).toBe(true);
    build(sim, 'plaza');
    build(sim, 'lantern');
    build(sim, 'police');
    expect(cond(sim, 'bored')).toBe(false);
    expect(cond(sim, 'unsafe')).toBe(false);
    expect(cond(sim, 'unsafeTown')).toBe(false);
  });

  it('epidemia (miasteczko, bez przychodni) i brak faktorii (wieś)', () => {
    const sim = town(3);
    people(sim.state, 2);
    expect(cond(sim, 'epidemic')).toBe(false);
    sim.state.settlement.events.push({ id: 900, kind: 'epidemic', target: 1, untilMs: Number.MAX_SAFE_INTEGER });
    expect(cond(sim, 'epidemic')).toBe(true);
    expect(cond(sim, 'epidemic', 2)).toBe(false);
    expect(cond(sim, 'noTrade', 1)).toBe(false);
    expect(cond(sim, 'noTrade', 2)).toBe(true);
    sim.state.settlement.peakTier = 3;
    build(sim, 'clinic');
    build(sim, 'tradepost');
    expect(cond(sim, 'epidemic')).toBe(false);
    expect(cond(sim, 'noTrade')).toBe(false);
  });

  it('wysokie podatki przy niskim szczęściu', () => {
    const sim = town();
    people(sim.state, 2, { happiness: 0.4 });
    expect(cond(sim, 'taxUnhappy')).toBe(false); // domyślna stawka 0,1
    sim.state.settlement.taxRate = 0.15;
    expect(cond(sim, 'taxUnhappy')).toBe(true);
    for (const r of sim.state.settlement.residents) r.happiness = 0.6;
    expect(cond(sim, 'taxUnhappy')).toBe(false);
  });

  it('rzemieślnicy bez narzędzi (zatrudniony rzemieślnik, < 3 narzędzia)', () => {
    const sim = town(2);
    const mill = build(sim, 'sawmill');
    people(sim.state, 1);
    expect(cond(sim, 'craftsmen')).toBe(false);
    people(sim.state, 1, { job: mill });
    expect(cond(sim, 'craftsmen')).toBe(true);
    sim.state.inventory = { tools: 2, 'tools*1': 1 };
    expect(cond(sim, 'craftsmen')).toBe(false);
  });

  it('budynki bez drogi: ≥ 2 domy lub miejsca pracy', () => {
    const sim = town();
    const s = sim.state;
    put(s, 'well', 34, 26);
    put(s, 'well', 36, 26);
    expect(disconnectedBuildings(at(sim).ctx)).toBe(0); // studnie nie potrzebują drogi
    put(s, 'tent', 26, 26);
    expect(cond(sim, 'disconnected')).toBe(false);
    put(s, 'tent', 30, 26);
    expect(cond(sim, 'disconnected')).toBe(true);
    put(s, 'path', 27, 26);
    expect(disconnectedBuildings(at(sim).ctx)).toBe(1);
    put(s, 'path', 29, 26);
    expect(cond(sim, 'disconnected')).toBe(false);
  });

  it('„zawsze” (festyn): 25% dziennie od 6 mieszkańców, nieznany warunek – nigdy', () => {
    const sim = town();
    people(sim.state, 5);
    const rng = sim.state.rng;
    expect(cond(sim, 'always')).toBe(false);
    expect(sim.state.rng).toBe(rng); // bez losowania
    people(sim.state, 1);
    const check = makeConditions(at(sim).ctx);
    let hits = 0;
    for (let i = 0; i < 400; i++) if (check('always')) hits++;
    expect(hits / 400).toBeGreaterThan(0.17);
    expect(hits / 400).toBeLessThan(0.33);
    expect(check('nonsense')).toBe(false);
  });
});

describe('rada: propozycje', () => {
  it('od etapu 1 – wcześniej rada nie obraduje', () => {
    const sim = town(0);
    people(sim.state, 3);
    const rng = sim.state.rng;
    expect(council(sim)).toEqual([]);
    expect(proposals(sim)).toEqual([]);
    expect(sim.state.rng).toBe(rng);
  });

  it('nowa propozycja: poparcie 30–70%, bez kosztu dla bonu, ważna 3 dni; zdarzenie i kronika', () => {
    const sim = town();
    people(sim.state, 10);
    const events = council(sim, DAY, only(['need_well']));
    expect(proposals(sim)).toHaveLength(1);
    const p = proposals(sim)[0]!;
    expect(p).toMatchObject({ tpl: 'need_well', cost: 0, expiresDay: DAY + K.proposalDays });
    expect(p.support).toBeGreaterThanOrEqual(3);
    expect(p.support).toBeLessThanOrEqual(7);
    expect(events).toEqual([{ type: 'proposal', id: p.id, tpl: 'need_well' }]);
    expect(sim.state.settlement.chronicle[0]).toMatchObject({ day: DAY, kind: 'proposal', params: { tpl: 'need_well' } });
  });

  it('koszt: festyn i dotacja płatne z góry, poparcie co najmniej 1 osoba', () => {
    const sim = town();
    people(sim.state, 2);
    council(sim, DAY, only(['festival', 'tools_grant'], 'noWell'));
    const byTpl = Object.fromEntries(proposals(sim).map((p) => [p.tpl, p]));
    expect(byTpl.festival!.cost).toBe(150);
    expect(byTpl.tools_grant!.cost).toBe(200);
    for (const p of proposals(sim)) expect(p.support).toBeGreaterThanOrEqual(1);
  });

  it('najwyżej 3 otwarte propozycje, każda z innego szablonu', () => {
    const sim = town(2);
    sim.state.settlement.taxRate = 0.2;
    people(sim.state, 10, { happiness: 0.3, needs: { food: 0.3, fun: 0.3, safety: 0.3 } as Resident['needs'] });
    const first = council(sim);
    expect(proposals(sim)).toHaveLength(K.maxProposals);
    expect(new Set(tpls(sim)).size).toBe(K.maxProposals);
    expect(ofType(first, 'proposal')).toHaveLength(K.maxProposals);
    const ids = proposals(sim).map((p) => p.id);
    expect(council(sim, DAY + 1)).toEqual([]);
    expect(proposals(sim).map((p) => p.id)).toEqual(ids);
  });

  it('propozycja wygasa po terminie (i może wrócić jako nowa), bon wygasa po dniu ważności', () => {
    const sim = town();
    people(sim.state, 2);
    const c = only(['need_well']);
    council(sim, DAY, c);
    const id = proposals(sim)[0]!.id;
    for (let d = DAY + 1; d <= DAY + K.proposalDays; d++) {
      expect(council(sim, d, c)).toEqual([]);
      expect(proposals(sim).map((p) => p.id)).toEqual([id]);
    }
    const events = council(sim, DAY + K.proposalDays + 1, c);
    expect(proposals(sim)).toHaveLength(1);
    expect(proposals(sim)[0]!.id).not.toBe(id);
    expect(ofType(events, 'proposal')).toHaveLength(1);

    sim.state.settlement.vouchers = { hut: { discount: 0.4, untilDay: DAY + 10 }, house: { discount: 0.4, untilDay: DAY + 11 } };
    council(sim, DAY + 11, only([]));
    expect(Object.keys(sim.state.settlement.vouchers)).toEqual(['house']);
    council(sim, DAY + 12, only([]));
    expect(sim.state.settlement.vouchers).toEqual({});
  });

  it('rozstrzygnięty szablon nie wraca przez 2 dni', () => {
    const sim = town();
    people(sim.state, 2);
    const c = only(['need_well']);
    council(sim, DAY, c);
    ok(sim, { type: 'decideProposal', id: proposals(sim)[0]!.id, approve: false });
    expect(proposals(sim)).toEqual([]);
    council(sim, DAY + 1, c);
    council(sim, DAY + 2, c);
    expect(proposals(sim)).toEqual([]);
    council(sim, DAY + 3, c);
    expect(tpls(sim)).toEqual(['need_well']);
  });

  it('budowa: tylko odblokowane budynki, bez istniejącego unikalnego i bez ważnego bonu', () => {
    const extra: ProposalTpl[] = [
      { id: 'x_manor', kind: 'build', building: 'manor', when: 'noWell' },
      { id: 'x_hall', kind: 'build', building: 'townhall', when: 'noWell' },
    ];
    const c = only(['need_well'], undefined, extra);
    const sim = town(1);
    people(sim.state, 2);
    sim.state.settlement.vouchers.well = { discount: 0.4, untilDay: DAY + 2 };
    council(sim, DAY, c);
    expect(tpls(sim)).toEqual([]); // dwór i ratusz zablokowane etapem, studnia ma bon

    const big = town(4);
    people(big.state, 2);
    build(big, 'townhall');
    council(big, DAY, c);
    expect(tpls(big).sort()).toEqual(['need_well', 'x_manor']);
  });

  it('deterministycznie: ten sam seed → te same propozycje i stan generatora', () => {
    const run = (seed: number) => {
      const sim = town(2, seed);
      sim.state.settlement.taxRate = 0.2;
      people(sim.state, 10, { happiness: 0.3, needs: { food: 0.3, fun: 0.3, safety: 0.3 } as Resident['needs'] });
      const log: string[] = [];
      for (let d = DAY; d < DAY + 8; d++) {
        council(sim, d);
        const first = proposals(sim)[0];
        if (first && d % 2 === 0) ok(sim, { type: 'decideProposal', id: first.id, approve: d % 4 === 0 });
        log.push(tpls(sim).join(','));
      }
      return { log, proposals: structuredClone(proposals(sim)), rng: sim.state.rng };
    };
    expect(run(11)).toEqual(run(11));
  });

  it('w pełnej symulacji rada obraduje o północy', () => {
    const sim = town(1);
    people(sim.state, 2);
    setTime(sim.state, DAY, 23);
    runHours(sim, 1);
    expect(tpls(sim)).toContain('need_well');
    expect(sim.takeEvents().some((e) => e.type === 'proposal')).toBe(true);
  });
});

describe('rada: decyzje', () => {
  it('zatwierdzenie budowy: bon −40% na 5 dni, działa w placeCost i znika po budowie', () => {
    const sim = town();
    const id = proposed(sim, 'need_well');
    sim.takeEvents();
    ok(sim, { type: 'decideProposal', id, approve: true });
    expect(sim.state.settlement.vouchers.well).toEqual({ discount: K.voucherDiscount, untilDay: DAY + K.voucherDays });
    expect(proposals(sim)).toEqual([]);
    expect(sim.takeEvents().filter((e) => e.type === 'decided')).toEqual([{ type: 'decided', id, tpl: 'need_well', approve: true }]);
    expect(sim.state.settlement.chronicle[0]).toMatchObject({ kind: 'decided', params: { tpl: 'need_well', approve: 1 } });
    expect(placeCost(sim.state, CONTENT, 'well', DAY)).toBe(36);
    expect(placeCost(sim.state, CONTENT, 'well', DAY + K.voucherDays)).toBe(36);
    expect(placeCost(sim.state, CONTENT, 'well', DAY + K.voucherDays + 1)).toBe(60);
    const coins = sim.state.coins;
    const spot = freeSpot(sim.state, 'well');
    ok(sim, { type: 'place', building: 'well', x: spot.x, y: spot.y });
    expect(sim.state.coins).toBe(coins - 36);
    expect(sim.state.settlement.vouchers.well).toBeUndefined();
  });

  it('z działającym ratuszem bon daje −50%', () => {
    const sim = town(2);
    const hall = build(sim, 'townhall');
    const id = proposed(sim, 'need_well');
    expect(voucherRate(sim.state, CONTENT)).toBeCloseTo(0.5, 9);
    ok(sim, { type: 'decideProposal', id, approve: true });
    expect(voucherDiscount(sim.state, 'well', DAY)).toBeCloseTo(0.5, 9);
    expect(placeCost(sim.state, CONTENT, 'well', DAY)).toBe(30);
    sim.state.settlement.sites[String(hall)]!.built = 0.5;
    expect(voucherRate(sim.state, CONTENT)).toBe(K.voucherDiscount);
  });

  it('polityka podatkowa: obniżka o 0,05, przycięta do 0', () => {
    const sim = town();
    sim.state.settlement.taxRate = 0.15;
    people(sim.state, 4, { happiness: 0.3 });
    council(sim, DAY, only(['lower_taxes']));
    ok(sim, { type: 'decideProposal', id: proposals(sim)[0]!.id, approve: true });
    expect(sim.state.settlement.taxRate).toBeCloseTo(0.1, 9);

    const low = town();
    const id = proposed(low, 'lower_taxes');
    low.state.settlement.taxRate = 0.02;
    ok(low, { type: 'decideProposal', id, approve: true });
    expect(low.state.settlement.taxRate).toBe(0);
  });

  it('festyn: koszt teraz, rozrywka +0,15 przez 2 dni, kolejny festyn przedłuża trwający', () => {
    const sim = town();
    const id = proposed(sim, 'festival');
    const coins = sim.state.coins;
    ok(sim, { type: 'decideProposal', id, approve: true });
    expect(sim.state.coins).toBe(coins - 150);
    expect(sim.state.settlement.budget[0]!.investments).toBe(150);
    const now = sim.state.clock.simMs;
    expect(sim.state.settlement.events).toEqual([{ id: expect.any(Number), kind: 'festival', untilMs: now + 2 * DAY_MS }]);
    expect(funBoost(sim.state)).toBe(0.15);
    // drugi festyn następnego dnia, w trakcie pierwszego – jedno wydarzenie, dłuższe
    sim.state.settlement.proposals.push({ id: 999, tpl: 'festival', support: 1, cost: 150, expiresDay: DAY + 3 });
    setTime(sim.state, DAY + 1, 0);
    ok(sim, { type: 'decideProposal', id: 999, approve: true });
    expect(sim.state.settlement.events).toHaveLength(1);
    expect(sim.state.settlement.events[0]!.untilMs).toBe((DAY + 1) * DAY_MS + 2 * DAY_MS);
    setTime(sim.state, DAY + 5, 1);
    expect(funBoost(sim.state)).toBe(0);
  });

  it('brak monet: propozycja zostaje, nic się nie zmienia', () => {
    const sim = town();
    const id = proposed(sim, 'festival');
    sim.state.coins = 149;
    const moods = sim.state.settlement.residents.map((r) => ({ ...r.mood }));
    expect(reason(sim, { type: 'decideProposal', id, approve: true })).toBe('no-coins');
    expect(sim.state.coins).toBe(149);
    expect(proposals(sim).map((p) => p.id)).toEqual([id]);
    expect(sim.state.settlement.events).toEqual([]);
    expect(sim.state.settlement.residents.map((r) => r.mood)).toEqual(moods);
    // odrzucenie nic nie kosztuje
    ok(sim, { type: 'decideProposal', id, approve: false });
    expect(sim.state.coins).toBe(149);
    expect(sim.state.settlement.events).toEqual([]);
    expect(sim.state.settlement.chronicle[0]).toMatchObject({ kind: 'decided', params: { tpl: 'festival', approve: 0 } });
  });

  it('dotacja: +5 narzędzi za 200 monet', () => {
    const sim = town(2);
    const mill = build(sim, 'sawmill');
    people(sim.state, 2, { job: mill });
    council(sim, DAY, only(['tools_grant']));
    const coins = sim.state.coins;
    ok(sim, { type: 'decideProposal', id: proposals(sim)[0]!.id, approve: true });
    expect(sim.state.coins).toBe(coins - 200);
    expect(sim.state.inventory.tools).toBe(5);
  });

  it('nastrój: zatwierdzenie +0,05, odrzucenie −0,05 do końca następnej doby; strajk zostaje', () => {
    const sim = town();
    const [a, b, striker, old] = people(sim.state, 4);
    striker!.mood = { value: -0.15, untilDay: DAY + 1 };
    old!.mood = { value: -0.15, untilDay: DAY - 1 };
    const id = proposed(sim, 'need_well');
    ok(sim, { type: 'decideProposal', id, approve: true });
    expect(a!.mood).toEqual({ value: COUNCIL_MOOD, untilDay: DAY + 1 });
    expect(old!.mood).toEqual({ value: COUNCIL_MOOD, untilDay: DAY + 1 });
    expect(striker!.mood).toEqual({ value: -0.15, untilDay: DAY + 1 });
    const id2 = proposed(sim, 'need_food', DAY + 1);
    ok(sim, { type: 'decideProposal', id: id2, approve: false });
    expect(b!.mood).toEqual({ value: -COUNCIL_MOOD, untilDay: DAY + 2 });
    expect(striker!.mood.value).toBe(-0.15);
  });

  it('nieznana albo wygasła propozycja', () => {
    const sim = town();
    expect(reason(sim, { type: 'decideProposal', id: 12345, approve: true })).toBe('invalid');
    const id = proposed(sim, 'need_well');
    setTime(sim.state, DAY + K.proposalDays + 1, 8);
    expect(reason(sim, { type: 'decideProposal', id, approve: true })).toBe('expired');
  });
});

describe('rada: specjalizacja i nazwa', () => {
  it('specjalizacja: etap 4, działający ratusz, raz na grę', () => {
    const sim = town(3);
    expect(reason(sim, { type: 'specialize', id: 'agri' })).toBe('tier-too-low');
    sim.state.settlement.peakTier = 4;
    expect(reason(sim, { type: 'specialize', id: 'agri' })).toBe('needs-townhall');
    const hall = build(sim, 'townhall');
    sim.state.settlement.sites[String(hall)]!.built = 0.5;
    expect(reason(sim, { type: 'specialize', id: 'agri' })).toBe('needs-townhall');
    sim.state.settlement.sites[String(hall)]!.built = 1;
    expect(reason(sim, { type: 'specialize', id: 'magic' })).toBe('invalid');
    sim.takeEvents();
    ok(sim, { type: 'specialize', id: 'craft' });
    expect(sim.state.settlement.specialization).toBe('craft');
    expect(sim.takeEvents().filter((e) => e.type === 'specialized')).toEqual([{ type: 'specialized', id: 'craft' }]);
    expect(sim.state.settlement.chronicle[0]).toMatchObject({ kind: 'specialized', params: { id: 'craft' } });
    expect(reason(sim, { type: 'specialize', id: 'trade' })).toBe('already-chosen');
    expect(sim.state.settlement.specialization).toBe('craft');
  });

  it('nazwa: przycięcie, bez znaków sterujących, 1–24 znaki', () => {
    const sim = town();
    ok(sim, { type: 'renameSettlement', name: '  Nowa Wola  ' });
    expect(sim.state.settlement.name).toBe('Nowa Wola');
    expect(sim.state.settlement.chronicle[0]).toMatchObject({ kind: 'renamed', params: { name: 'Nowa Wola' } });
    ok(sim, { type: 'renameSettlement', name: 'Zie\u0000lo\nna‮ Góra\t' });
    expect(sim.state.settlement.name).toBe('Zielona Góra');
    for (const bad of ['', '   ', '\u0000\u0007', 'x'.repeat(NAME_MAX + 1)]) {
      expect(reason(sim, { type: 'renameSettlement', name: bad }), JSON.stringify(bad)).toBe('invalid');
    }
    expect(reason(sim, { type: 'renameSettlement', name: 42 as unknown as string })).toBe('invalid');
    expect(sim.state.settlement.name).toBe('Zielona Góra');
    ok(sim, { type: 'renameSettlement', name: 'Ż'.repeat(NAME_MAX) });
    expect(cleanName('🌻'.repeat(NAME_MAX))).toBe('🌻'.repeat(NAME_MAX)); // znaki, nie jednostki UTF-16
  });
});
