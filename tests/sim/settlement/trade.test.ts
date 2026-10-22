import { describe, expect, it } from 'vitest';
import { CONTENT, type Content } from '../../../src/content/content';
import { EventBus } from '../../../src/core/eventBus';
import { calendarAt } from '../../../src/sim/calendar';
import { makeCtx, type Ctx } from '../../../src/sim/ctx';
import type { SimEvent } from '../../../src/sim/events';
import type { Simulation } from '../../../src/sim/simulation';
import {
  BUY_QTY_MAX,
  CARAVAN_HOUR,
  CARAVAN_STAY_HOURS,
  EXPORT_RESERVE,
  autoExportQty,
  caravanInterval,
  caravansActive,
  exportValue,
  makeCaravan,
  tradeHour,
} from '../../../src/sim/systems/settlement/trade';
import type { Caravan, TradeOffer } from '../../../src/sim/types';
import { DAY_MS, HOUR_MS, reason, setTime } from '../helpers';
import { addResident, makeTown, ok, placeBuilt, runHours } from './helpers';

const DAY = 3;

/** Kontekst na daną godzinę (bez kroku symulacji) ze zbieraniem zdarzeń. */
function at(sim: Simulation, hour: number, day = DAY, c: Content = CONTENT): { ctx: Ctx; events: SimEvent[] } {
  setTime(sim.state, day, hour);
  const bus = new EventBus<SimEvent>();
  const events: SimEvent[] = [];
  bus.onAny((e) => events.push(e));
  return { ctx: makeCtx(sim.state, bus, calendarAt(sim.state.clock.simMs, sim.state.seed), c), events };
}

/** Wywołuje `tradeHour` o danej godzinie i zwraca zdarzenia. */
function hourAt(sim: Simulation, hour: number, day = DAY, c: Content = CONTENT): SimEvent[] {
  const { ctx, events } = at(sim, hour, day, c);
  tradeHour(ctx, hour);
  return events;
}

const ofType = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

/** Osada z faktorią (domyślnie z handlarzem), pustym magazynem i danym etapem. */
function tradeTown(peakTier = 2, opts: { staffed?: boolean; seed?: number } = {}): { sim: Simulation; post: number } {
  const sim = makeTown(() => {}, opts.seed ?? 42, Math.max(2, peakTier));
  const post = placeBuilt(sim, 'tradepost');
  if (opts.staffed ?? true) addResident(sim.state, { job: post });
  sim.state.settlement.peakTier = peakTier;
  sim.state.inventory = {};
  return { sim, post };
}

/** Dni przyjazdów karawan w kolejnych `days` dniach (przyjazd o 10:00, odjazd o 18:00). */
function arrivals(sim: Simulation, from: number, days: number, c: Content = CONTENT): number[] {
  const out: number[] = [];
  for (let d = from; d < from + days; d++) {
    hourAt(sim, CARAVAN_HOUR, d, c);
    if (sim.state.settlement.caravan) out.push(d);
    hourAt(sim, CARAVAN_HOUR + CARAVAN_STAY_HOURS, d, c);
  }
  return out;
}

/** Ręcznie ustawiona karawana (bez losowania). */
function withCaravan(sim: Simulation, buys: TradeOffer[], sells: TradeOffer[]): Caravan {
  const caravan: Caravan = { from: 'riverside', leavesAt: sim.state.clock.simMs + 8 * HOUR_MS, buys, sells };
  sim.state.settlement.caravan = caravan;
  return caravan;
}

/** Jeden partner o znanej liście towarów (skupuje wszystkie trzy, sprzedaje dwa). */
const ONE_PARTNER: Content = {
  ...CONTENT,
  settlement: { ...CONTENT.settlement, partners: [{ id: 'oldvillage', buys: ['radish', 'egg', 'milk'], sells: ['egg', 'wood', 'herb'] }] },
};

const price = (id: string): number => CONTENT.items[id]!.price;

describe('handel: przyjazd i odjazd karawany', () => {
  it('przyjeżdża o 10:00 tylko do działającej faktorii z obsadą', () => {
    const { sim, post } = tradeTown(2, { staffed: false });
    expect(caravansActive(sim.state, CONTENT)).toBe(false);
    expect(hourAt(sim, CARAVAN_HOUR)).toEqual([]);
    expect(sim.state.settlement.caravan).toBeNull();
    addResident(sim.state, { job: post });
    expect(hourAt(sim, 9)).toEqual([]);
    expect(sim.state.settlement.caravan).toBeNull();
    const events = hourAt(sim, CARAVAN_HOUR);
    const caravan = sim.state.settlement.caravan!;
    expect(caravan).not.toBeNull();
    expect(ofType(events, 'caravan')).toEqual([{ type: 'caravan', from: caravan.from }]);
    expect(CONTENT.settlement.partners.map((p) => p.id)).toContain(caravan.from);
    expect(caravan.leavesAt).toBe(DAY * DAY_MS + 18 * HOUR_MS);
    expect(sim.state.settlement.nextCaravanDay).toBe(DAY + 3);
    expect(sim.state.settlement.chronicle[0]).toMatchObject({ day: DAY, hour: 10, kind: 'caravan', params: { from: caravan.from } });
  });

  it('budowa albo uszkodzenie faktorii wstrzymuje karawany', () => {
    const { sim, post } = tradeTown(3);
    sim.state.settlement.sites[String(post)]!.built = 0.5;
    hourAt(sim, CARAVAN_HOUR);
    expect(sim.state.settlement.caravan).toBeNull();
    expect(sim.state.settlement.nextCaravanDay).toBe(-1);
    sim.state.settlement.sites[String(post)]!.built = 1;
    sim.state.settlement.sites[String(post)]!.damage = 0.6;
    hourAt(sim, CARAVAN_HOUR);
    expect(sim.state.settlement.caravan).toBeNull();
  });

  it('odjeżdża o 18:00 ze zdarzeniem caravanLeft i wpisem w kronice', () => {
    const { sim } = tradeTown(2);
    hourAt(sim, CARAVAN_HOUR);
    const from = sim.state.settlement.caravan!.from;
    expect(hourAt(sim, 17)).toEqual([]);
    expect(sim.state.settlement.caravan).not.toBeNull();
    expect(hourAt(sim, 18)).toEqual([{ type: 'caravanLeft', from }]);
    expect(sim.state.settlement.caravan).toBeNull();
    expect(sim.state.settlement.chronicle[0]).toMatchObject({ kind: 'caravanLeft', params: { from } });
    // Po odjeździe handel niemożliwy.
    expect(reason(sim, { type: 'caravanSell', key: 'bread', qty: 1 })).toBe('no-caravan');
    expect(reason(sim, { type: 'caravanBuy', item: 'wood', qty: 1 })).toBe('no-caravan');
  });

  it('odstęp wg etapu: brak przed wsią, wieś co 3 dni, miasteczko co 2, miasto codziennie', () => {
    expect(caravanInterval(tradeTown(1).sim.state, CONTENT)).toBe(0);
    expect(arrivals(tradeTown(1).sim, DAY, 7)).toEqual([]);
    expect(arrivals(tradeTown(2).sim, DAY, 7)).toEqual([DAY, DAY + 3, DAY + 6]);
    expect(arrivals(tradeTown(3).sim, DAY, 7)).toEqual([DAY, DAY + 2, DAY + 4, DAY + 6]);
    expect(arrivals(tradeTown(4).sim, DAY, 4)).toEqual([DAY, DAY + 1, DAY + 2, DAY + 3]);
  });

  it('karawana, która nie mogła przyjechać w swoim dniu, przyjeżdża przy pierwszej okazji', () => {
    const { sim, post } = tradeTown(2);
    hourAt(sim, CARAVAN_HOUR);
    hourAt(sim, 18);
    sim.state.settlement.sites[String(post)]!.broken = true;
    expect(arrivals(sim, DAY + 1, 4)).toEqual([]);
    sim.state.settlement.sites[String(post)]!.broken = false;
    expect(arrivals(sim, DAY + 5, 1)).toEqual([DAY + 5]);
    expect(sim.state.settlement.nextCaravanDay).toBe(DAY + 8);
  });

  it('specjalizacja handlowa: karawany codziennie', () => {
    const { sim } = tradeTown(2);
    sim.state.settlement.specialization = 'trade';
    expect(caravanInterval(sim.state, CONTENT)).toBe(1);
    expect(arrivals(sim, DAY, 3)).toEqual([DAY, DAY + 1, DAY + 2]);
    // inna specjalizacja nie zmienia odstępu
    const other = tradeTown(2).sim;
    other.state.settlement.specialization = 'agri';
    expect(caravanInterval(other.state, CONTENT)).toBe(3);
  });

  it('w pełnej symulacji: przyjazd o 10:00, odjazd o 18:00', () => {
    const { sim } = tradeTown(4);
    setTime(sim.state, DAY, 9);
    sim.takeEvents();
    runHours(sim, 1);
    expect(sim.state.settlement.caravan).not.toBeNull();
    runHours(sim, CARAVAN_STAY_HOURS);
    expect(sim.state.settlement.caravan).toBeNull();
    const types = sim.takeEvents().map((e) => e.type);
    expect(types).toContain('caravan');
    expect(types).toContain('caravanLeft');
  });
});

describe('handel: oferty i ceny', () => {
  it('3–4 towary skupowane i 2–3 sprzedawane z listy partnera, ceny i ilości w granicach', () => {
    const { sim } = tradeTown(2);
    const { ctx } = at(sim, CARAVAN_HOUR);
    const partners = new Set<string>();
    const buyCounts = new Set<number>();
    const sellCounts = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const cv = makeCaravan(ctx)!;
      const partner = CONTENT.settlement.partners.find((p) => p.id === cv.from)!;
      partners.add(cv.from);
      buyCounts.add(cv.buys.length);
      sellCounts.add(cv.sells.length);
      expect(cv.buys.length).toBeGreaterThanOrEqual(3);
      expect(cv.buys.length).toBeLessThanOrEqual(4);
      expect(cv.sells.length).toBeGreaterThanOrEqual(2);
      expect(cv.sells.length).toBeLessThanOrEqual(3);
      expect(new Set(cv.buys.map((o) => o.item)).size).toBe(cv.buys.length);
      expect(new Set(cv.sells.map((o) => o.item)).size).toBe(cv.sells.length);
      for (const o of cv.buys) {
        expect(partner.buys).toContain(o.item);
        const base = price(o.item);
        expect(o.price).toBeGreaterThanOrEqual(Math.max(1, Math.round(base * 1.1)));
        expect(o.price).toBeLessThanOrEqual(Math.round(base * 1.5));
        const lo = Math.min(BUY_QTY_MAX, Math.max(1, Math.round((60 / o.price) * 4)));
        const hi = Math.min(BUY_QTY_MAX, Math.max(1, Math.round((60 / o.price) * 12)));
        expect(o.qty).toBeGreaterThanOrEqual(lo);
        expect(o.qty).toBeLessThanOrEqual(hi);
      }
      for (const o of cv.sells) {
        expect(partner.sells).toContain(o.item);
        expect(cv.buys.some((b) => b.item === o.item)).toBe(false);
        const base = price(o.item);
        expect(o.price).toBeGreaterThanOrEqual(Math.round(base * 1.2));
        expect(o.price).toBeLessThanOrEqual(Math.round(base * 1.6));
        expect(o.qty).toBeGreaterThanOrEqual(5);
        expect(o.qty).toBeLessThanOrEqual(20);
      }
      expect(cv.leavesAt).toBe(sim.state.clock.simMs + CARAVAN_STAY_HOURS * HOUR_MS);
    }
    expect(partners.size).toBe(CONTENT.settlement.partners.length);
    expect([...buyCounts].sort()).toEqual([3, 4]);
    expect([...sellCounts].sort()).toEqual([2, 3]);
  });

  it('karawana nie sprzedaje towaru, który skupuje', () => {
    const { sim } = tradeTown(2);
    const { ctx } = at(sim, CARAVAN_HOUR, DAY, ONE_PARTNER);
    for (let i = 0; i < 20; i++) {
      const cv = makeCaravan(ctx)!;
      expect(cv.buys.map((o) => o.item).sort()).toEqual(['egg', 'milk', 'radish']);
      expect(cv.sells.map((o) => o.item).sort()).toEqual(['herb', 'wood']);
    }
  });

  /** Ta sama karawana (ten sam seed) w dwóch osadach: zwykłej i zmienionej przez `patch`. */
  function compare(patch: (sim: Simulation) => void): { plain: Caravan; changed: Caravan; changedSim: Simulation } {
    const a = tradeTown(2).sim;
    const b = tradeTown(2).sim;
    patch(b);
    hourAt(a, CARAVAN_HOUR);
    hourAt(b, CARAVAN_HOUR);
    const plain = a.state.settlement.caravan!;
    const changed = b.state.settlement.caravan!;
    expect(changed.from).toBe(plain.from);
    expect(changed.buys.map((o) => o.item)).toEqual(plain.buys.map((o) => o.item));
    expect(changed.sells.map((o) => o.item)).toEqual(plain.sells.map((o) => o.item));
    return { plain, changed, changedSim: b };
  }

  it('kryzys: ceny skupu i sprzedaży ×0,7', () => {
    const { plain, changed } = compare((sim) => sim.state.settlement.events.push({ id: 900, kind: 'crisis', untilMs: Number.MAX_SAFE_INTEGER }));
    plain.buys.forEach((o, i) => expect(Math.abs(changed.buys[i]!.price - 0.7 * o.price)).toBeLessThanOrEqual(1));
    plain.sells.forEach((o, i) => expect(Math.abs(changed.sells[i]!.price - 0.7 * o.price)).toBeLessThanOrEqual(1));
    expect(changed.buys.some((o, i) => o.price < plain.buys[i]!.price)).toBe(true);
  });

  it('bogata karawana płaci ×1,3 (sprzedaż bez zmian), premia zużyta przy przyjeździe', () => {
    const { plain, changed, changedSim } = compare((sim) => {
      sim.state.settlement.caravanBonus = 1.3;
    });
    plain.buys.forEach((o, i) => expect(Math.abs(changed.buys[i]!.price - 1.3 * o.price)).toBeLessThanOrEqual(1.2));
    expect(changed.buys.some((o, i) => o.price > plain.buys[i]!.price)).toBe(true);
    expect(changed.sells).toEqual(plain.sells);
    expect(changedSim.state.settlement.caravanBonus).toBe(1);
  });

  it('specjalizacja handlowa: skup ×1,25, sprzedaż bez zmian', () => {
    const { plain, changed } = compare((sim) => {
      sim.state.settlement.specialization = 'trade';
    });
    plain.buys.forEach((o, i) => expect(Math.abs(changed.buys[i]!.price - 1.25 * o.price)).toBeLessThanOrEqual(1.2));
    expect(changed.sells).toEqual(plain.sells);
  });

  it('deterministycznie: ten sam seed → te same karawany i stan generatora', () => {
    const run = (seed: number) => {
      const { sim } = tradeTown(4, { seed });
      const list: Caravan[] = [];
      for (let d = DAY; d < DAY + 5; d++) {
        hourAt(sim, CARAVAN_HOUR, d);
        list.push(structuredClone(sim.state.settlement.caravan!));
        hourAt(sim, 18, d);
      }
      return { list, rng: sim.state.rng };
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7).list).not.toEqual(run(8).list);
  });
});

describe('handel: sprzedaż i kupno', () => {
  it('sprzedaż karawanie: monety, limit oferty, budżet eksportu, statystyka i zdarzenie', () => {
    const { sim } = tradeTown(2);
    const caravan = withCaravan(sim, [{ item: 'bread', price: 200, qty: 5 }], []);
    sim.state.inventory = { bread: 4 };
    const coins = sim.state.coins;
    const earned = sim.state.stats.coinsEarned ?? 0;
    sim.takeEvents();
    ok(sim, { type: 'caravanSell', key: 'bread', qty: 3 });
    expect(sim.state.coins).toBe(coins + 600);
    expect(sim.state.inventory.bread).toBe(1);
    expect(caravan.buys[0]!.qty).toBe(2);
    expect(sim.state.settlement.budget[0]!.exports).toBe(600);
    expect(sim.state.stats.coinsEarned).toBe(earned + 600);
    expect(sim.takeEvents().filter((e) => e.type === 'traded')).toEqual([{ type: 'traded', item: 'bread', qty: 3, coins: 600, dir: 'export' }]);
    ok(sim, { type: 'caravanSell', key: 'bread', qty: 1 });
    expect(sim.state.inventory.bread).toBeUndefined();
  });

  it('sprzedaż: jakość podnosi cenę (×1,25 srebrna, ×1,5 złota)', () => {
    const { sim } = tradeTown(2);
    withCaravan(sim, [{ item: 'egg', price: 30, qty: 10 }], []);
    sim.state.inventory = { 'egg*1': 3, 'egg*2': 2 };
    const coins = sim.state.coins;
    ok(sim, { type: 'caravanSell', key: 'egg*1', qty: 3 });
    expect(sim.state.coins).toBe(coins + Math.round(30 * 1.25 * 3));
    ok(sim, { type: 'caravanSell', key: 'egg*2', qty: 1 });
    expect(sim.state.coins).toBe(coins + Math.round(30 * 1.25 * 3) + 45);
    expect(exportValue({ item: 'egg', price: 30, qty: 1 }, 'egg*2', 2)).toBe(90);
    expect(sim.state.settlement.budget[0]!.exports).toBe(Math.round(30 * 1.25 * 3) + 45);
  });

  it('sprzedaż: błędy (brak karawany, towar spoza oferty, zła ilość, za mało towaru)', () => {
    const { sim } = tradeTown(2);
    sim.state.inventory = { bread: 10, cheese: 10 };
    expect(reason(sim, { type: 'caravanSell', key: 'bread', qty: 1 })).toBe('no-caravan');
    withCaravan(sim, [{ item: 'bread', price: 200, qty: 5 }], [{ item: 'wood', price: 8, qty: 10 }]);
    expect(reason(sim, { type: 'caravanSell', key: 'cheese', qty: 1 })).toBe('invalid');
    expect(reason(sim, { type: 'caravanSell', key: 'wood', qty: 1 })).toBe('invalid');
    for (const qty of [0, -1, 1.5, 6, Number.NaN]) expect(reason(sim, { type: 'caravanSell', key: 'bread', qty })).toBe('invalid');
    sim.state.inventory = { bread: 2 };
    expect(reason(sim, { type: 'caravanSell', key: 'bread', qty: 3 })).toBe('no-stock');
    expect(reason(sim, { type: 'caravanSell', key: 'bread*1', qty: 1 })).toBe('no-stock');
    expect(sim.state.inventory).toEqual({ bread: 2 });
    expect(sim.state.settlement.caravan!.buys[0]!.qty).toBe(5);
  });

  it('kupno od karawany: koszt, magazyn, limit, budżet importu i zdarzenie', () => {
    const { sim } = tradeTown(2);
    const caravan = withCaravan(sim, [], [{ item: 'planks', price: 40, qty: 10 }]);
    const coins = sim.state.coins;
    sim.takeEvents();
    ok(sim, { type: 'caravanBuy', item: 'planks', qty: 3 });
    expect(sim.state.coins).toBe(coins - 120);
    expect(sim.state.inventory.planks).toBe(3);
    expect(caravan.sells[0]!.qty).toBe(7);
    expect(sim.state.settlement.budget[0]!.imports).toBe(120);
    expect(sim.takeEvents().filter((e) => e.type === 'traded')).toEqual([{ type: 'traded', item: 'planks', qty: 3, coins: 120, dir: 'import' }]);
    ok(sim, { type: 'caravanBuy', item: 'planks', qty: 7 });
    expect(caravan.sells[0]!.qty).toBe(0);
    expect(reason(sim, { type: 'caravanBuy', item: 'planks', qty: 1 })).toBe('invalid');
  });

  it('kupno: błędy (towar spoza oferty, zła ilość, brak monet)', () => {
    const { sim } = tradeTown(2);
    withCaravan(sim, [{ item: 'bread', price: 200, qty: 5 }], [{ item: 'planks', price: 40, qty: 10 }]);
    expect(reason(sim, { type: 'caravanBuy', item: 'bread', qty: 1 })).toBe('invalid');
    expect(reason(sim, { type: 'caravanBuy', item: 'planks*1', qty: 1 })).toBe('invalid');
    for (const qty of [0, -2, 2.5, 11]) expect(reason(sim, { type: 'caravanBuy', item: 'planks', qty })).toBe('invalid');
    sim.state.coins = 100;
    expect(reason(sim, { type: 'caravanBuy', item: 'planks', qty: 3 })).toBe('no-coins');
    expect(sim.state.coins).toBe(100);
    expect(sim.state.inventory.planks).toBeUndefined();
    ok(sim, { type: 'caravanBuy', item: 'planks', qty: 2 });
    expect(sim.state.coins).toBe(20);
  });

  it('przełączanie auto-eksportu', () => {
    const { sim } = tradeTown(2);
    ok(sim, { type: 'toggleExport', item: 'bread' });
    ok(sim, { type: 'toggleExport', item: 'egg' });
    expect(sim.state.settlement.autoExport).toEqual(['bread', 'egg']);
    ok(sim, { type: 'toggleExport', item: 'bread' });
    expect(sim.state.settlement.autoExport).toEqual(['egg']);
    expect(reason(sim, { type: 'toggleExport', item: 'nope' })).toBe('invalid');
    expect(reason(sim, { type: 'toggleExport', item: 'egg*1' })).toBe('invalid');
  });
});

describe('handel: auto-eksport', () => {
  it('przy przyjeździe sprzedaje nadmiar ponad rezerwę 5 szt., od najniższej jakości, do limitu oferty', () => {
    const { sim } = tradeTown(2);
    const st = sim.state.settlement;
    st.autoExport = ['egg', 'radish', 'milk'];
    st.reserved = ['milk'];
    sim.state.inventory = { egg: 2, 'egg*1': 6, radish: 100, milk: 50, wood: 30 };
    const coins = sim.state.coins;
    const events = hourAt(sim, CARAVAN_HOUR, DAY, ONE_PARTNER);
    const cv = st.caravan!;
    const egg = cv.buys.find((o) => o.item === 'egg')!;
    const radish = cv.buys.find((o) => o.item === 'radish')!;
    const milk = cv.buys.find((o) => o.item === 'milk')!;
    // jajka: 8 − 5 = 3 szt. (2 zwykłe + 1 srebrne), zostaje 5 srebrnych
    expect(sim.state.inventory.egg).toBeUndefined();
    expect(sim.state.inventory['egg*1']).toBe(EXPORT_RESERVE);
    const eggCoins = egg.price * 2 + Math.round(egg.price * 1.25);
    // rzodkiewki: oferta 40 szt. (tania rzodkiewka – limit oferty)
    expect(radish.qty).toBe(0);
    expect(sim.state.inventory.radish).toBe(60);
    const radishCoins = radish.price * BUY_QTY_MAX;
    // mleko zarezerwowane, drewna karawana nie skupuje
    expect(sim.state.inventory.milk).toBe(50);
    expect(milk.qty).toBeGreaterThan(0);
    expect(sim.state.inventory.wood).toBe(30);
    expect(sim.state.coins).toBe(coins + eggCoins + radishCoins);
    expect(st.budget[0]!.exports).toBe(eggCoins + radishCoins);
    expect(ofType(events, 'traded')).toEqual([
      { type: 'traded', item: 'radish', qty: BUY_QTY_MAX, coins: radishCoins, dir: 'export' },
      { type: 'traded', item: 'egg', qty: 3, coins: eggCoins, dir: 'export' },
    ].sort((a, b) => cv.buys.findIndex((o) => o.item === a.item) - cv.buys.findIndex((o) => o.item === b.item)));
    // zdarzenie przyjazdu przed handlem
    expect(events[0]!.type).toBe('caravan');
  });

  it('bez auto-eksportu, przy zapasie ≤ 5 albo poza ofertą nic nie sprzedaje', () => {
    const { sim } = tradeTown(2);
    const st = sim.state.settlement;
    st.autoExport = ['egg', 'bread'];
    sim.state.inventory = { egg: 5, radish: 100, bread: 50 };
    const coins = sim.state.coins;
    const events = hourAt(sim, CARAVAN_HOUR, DAY, ONE_PARTNER);
    expect(ofType(events, 'traded')).toEqual([]);
    expect(sim.state.inventory).toEqual({ egg: 5, radish: 100, bread: 50 });
    expect(sim.state.coins).toBe(coins);
    const egg = st.caravan!.buys.find((o) => o.item === 'egg')!;
    expect(autoExportQty(sim.state, egg)).toBe(0);
    sim.state.inventory.egg = 9;
    expect(autoExportQty(sim.state, egg)).toBe(Math.min(egg.qty, 4));
    st.reserved = ['egg'];
    expect(autoExportQty(sim.state, egg)).toBe(0);
  });
});
