import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../src/content/content';
import { makeCtx } from '../../src/sim/ctx';
import { canPlace, occupancy } from '../../src/sim/systems/building';
import { quote, satFactor, unitPrice } from '../../src/sim/systems/market';
import { FIELD, FARM } from '../../src/sim/world';
import { HOUR_MS, makeSim, ok, reason } from './helpers';

const ctxOf = (sim: ReturnType<typeof makeSim>) => makeCtx(sim.state, sim.bus, sim.calendar);

describe('rynek dynamiczny', () => {
  it('sprzedaż dużej ilości obniża cenę kolejnych sztuk', () => {
    const sim = makeSim((s) => {
      s.inventory.wheat = 40;
    });
    sim.state.market.demand = {};
    const ctx = ctxOf(sim);
    const first = unitPrice(ctx, 'wheat');
    const tenth = unitPrice(ctx, 'wheat', 9);
    expect(tenth).toBeLessThan(first);
    expect(quote(ctx, 'wheat', 20)).toBeLessThan(first * 20);
    ok(sim, { type: 'sell', key: 'wheat', qty: 20 });
    expect(unitPrice(ctxOf(sim), 'wheat')).toBeCloseTo(first * satFactor(20));
  });

  it('nasycenie wygasa z czasem', () => {
    const sim = makeSim((s) => {
      s.market.sat.wheat = 20;
    });
    sim.advance(6 * HOUR_MS);
    expect(sim.state.market.sat.wheat).toBeCloseTo(10, 0);
  });

  it('jakość podnosi cenę, popyt dnia ją zmienia', () => {
    const sim = makeSim();
    sim.state.market.demand = { carrot: 1.5 };
    const ctx = ctxOf(sim);
    expect(unitPrice(ctx, 'radish*2')).toBeCloseTo(unitPrice(ctx, 'radish') * 1.5);
    expect(unitPrice(ctx, 'carrot')).toBeCloseTo(CONTENT.items.carrot!.price * 1.5);
  });

  it('sprzedaj wszystko pomija nawozy i paszę', () => {
    const sim = makeSim((s) => {
      s.inventory = { radish: 2, compost: 3, feed: 5 };
    });
    ok(sim, { type: 'sellAll' });
    expect(sim.state.inventory).toEqual({ compost: 3, feed: 5 });
    expect(reason(sim, { type: 'sellAll' })).toBe('nothing-to-sell');
  });

  it('zakupy w sklepie', () => {
    const sim = makeSim((s) => (s.coins = 100));
    ok(sim, { type: 'buySeeds', crop: 'radish', qty: 5 });
    ok(sim, { type: 'buyItem', item: 'compost', qty: 2 });
    expect(sim.state.coins).toBe(100 - 10 - 30);
    expect(reason(sim, { type: 'buySeeds', crop: 'pumpkin', qty: 1 })).toBe('level-too-low');
    expect(reason(sim, { type: 'buyItem', item: 'wheat', qty: 1 })).toBe('invalid');
  });
});

describe('budowanie', () => {
  it('stawia budynek w strefie farmy, blokuje kolizje i pole uprawne', () => {
    const sim = makeSim((s) => {
      s.coins = 5000;
      s.xp = 10_000;
    });
    ok(sim, { type: 'place', building: 'coop', x: FARM.x, y: FARM.y });
    expect(reason(sim, { type: 'place', building: 'lantern', x: FARM.x + 1, y: FARM.y + 1 })).toBe('blocked');
    expect(reason(sim, { type: 'place', building: 'lantern', x: FIELD.x, y: FIELD.y })).toBe('blocked');
    expect(reason(sim, { type: 'place', building: 'lantern', x: FARM.x - 1, y: FARM.y })).toBe('outside-farm');
    expect(occupancy(sim.state, CONTENT).size).toBe(4);
    const uid = sim.state.objects[0]!.uid;
    ok(sim, { type: 'move', uid, x: FARM.x + 3, y: FARM.y });
    expect(canPlace(sim.state, CONTENT, 'lantern', FARM.x, FARM.y).ok).toBe(true);
    const coins = sim.state.coins;
    ok(sim, { type: 'remove', uid });
    expect(sim.state.coins).toBe(coins + 200);
  });

  it('wymaga poziomu i monet; posągi tylko po festynie', () => {
    const sim = makeSim((s) => (s.coins = 0));
    expect(reason(sim, { type: 'place', building: 'coop', x: FARM.x, y: FARM.y })).toBe('level-too-low');
    expect(reason(sim, { type: 'place', building: 'path', x: FARM.x, y: FARM.y })).toBe('no-coins');
    expect(reason(sim, { type: 'place', building: 'statue_spring', x: FARM.x, y: FARM.y })).toBe('locked');
  });
});

describe('zwierzęta', () => {
  const withCoop = () => {
    const sim = makeSim((s) => {
      s.coins = 5000;
      s.xp = 10_000;
      s.inventory.feed = 10;
    });
    ok(sim, { type: 'place', building: 'coop', x: FARM.x, y: FARM.y });
    const home = sim.state.objects[0]!.uid;
    ok(sim, { type: 'buyAnimal', kind: 'chicken', home });
    return { sim, home, id: sim.state.animals[0]!.id };
  };

  it('karmienie, głaskanie, produkcja i zbiór jajek', () => {
    const { sim, id } = withCoop();
    ok(sim, { type: 'feedAnimal', id });
    expect(reason(sim, { type: 'feedAnimal', id })).toBe('not-hungry');
    ok(sim, { type: 'petAnimal', id });
    expect(reason(sim, { type: 'petAnimal', id })).toBe('already-petted');
    expect(reason(sim, { type: 'collectAnimal', id })).toBe('not-ready-animal');
    sim.advance(6.5 * HOUR_MS);
    ok(sim, { type: 'collectAnimal', id });
    expect(Object.keys(sim.state.inventory).some((k) => k.startsWith('egg'))).toBe(true);
  });

  it('głodne zwierzę nie produkuje i traci sympatię', () => {
    const { sim } = withCoop();
    const a = sim.state.animals[0]!;
    a.hunger = 0;
    a.affection = 0.5;
    sim.advance(10 * HOUR_MS);
    expect(sim.state.animals[0]!.ready).toBe(false);
    expect(sim.state.animals[0]!.affection).toBeLessThan(0.5);
  });

  it('pojemność budynku i właściwy typ', () => {
    const { sim, home } = withCoop();
    for (let i = 0; i < 3; i++) ok(sim, { type: 'buyAnimal', kind: 'chicken', home });
    expect(reason(sim, { type: 'buyAnimal', kind: 'chicken', home })).toBe('full');
    expect(reason(sim, { type: 'buyAnimal', kind: 'cow', home })).toBe('wrong-home');
    expect(reason(sim, { type: 'remove', uid: home })).toBe('occupied');
  });
});

describe('przetwórstwo', () => {
  it('kolejka w budynku: pszenica → mąka → chleb', () => {
    const sim = makeSim((s) => {
      s.coins = 5000;
      s.xp = 10_000;
      s.inventory = { wheat: 4, egg: 1 };
    });
    ok(sim, { type: 'place', building: 'mill', x: FARM.x, y: FARM.y });
    ok(sim, { type: 'place', building: 'bakery', x: FARM.x + 3, y: FARM.y });
    const [mill, bakery] = sim.state.objects.map((o) => o.uid) as [number, number];
    ok(sim, { type: 'queueRecipe', uid: mill, recipe: 'flour' });
    ok(sim, { type: 'queueRecipe', uid: mill, recipe: 'flour' });
    expect(reason(sim, { type: 'queueRecipe', uid: mill, recipe: 'flour' })).toBe('missing-items');
    expect(reason(sim, { type: 'queueRecipe', uid: bakery, recipe: 'flour' })).toBe('invalid');
    sim.advance(0.5 * HOUR_MS + 10_000);
    expect(sim.state.machines[mill]!.output.flour).toBe(1); // kolejka: drugie zadanie wciąż trwa
    sim.advance(0.5 * HOUR_MS);
    ok(sim, { type: 'collectOutput', uid: mill });
    expect(sim.state.inventory.flour).toBe(2);
    ok(sim, { type: 'queueRecipe', uid: bakery, recipe: 'bread' });
    sim.advance(HOUR_MS + 10_000);
    ok(sim, { type: 'collectOutput', uid: bakery });
    expect(sim.state.inventory.bread).toBe(1);
  });

  it('limit kolejki', () => {
    const sim = makeSim((s) => {
      s.coins = 5000;
      s.xp = 10_000;
      s.inventory = { wheat: 20 };
    });
    ok(sim, { type: 'place', building: 'mill', x: FARM.x, y: FARM.y });
    const uid = sim.state.objects[0]!.uid;
    for (let i = 0; i < 3; i++) ok(sim, { type: 'queueRecipe', uid, recipe: 'hay' });
    expect(reason(sim, { type: 'queueRecipe', uid, recipe: 'hay' })).toBe('queue-full');
  });
});
