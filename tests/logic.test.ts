import { describe, expect, it } from 'vitest';
import { CROPS, GRID_COLS, START_UNLOCKED } from '../src/game/content';
import * as L from '../src/game/logic';
import { createInitialState, type GameState } from '../src/game/state';

const T0 = 1_700_000_000_000;
const first = START_UNLOCKED[0]!;

function ok(r: L.ActionResult): GameState {
  if (!r.ok) throw new Error(`oczekiwano sukcesu, otrzymano: ${r.reason}`);
  return r.state;
}

function reason(r: L.ActionResult): L.FailReason | null {
  return r.ok ? null : r.reason;
}

describe('pętla pola: orka → siew → podlewanie → zbiór', () => {
  it('przechodzi całą pętlę i nalicza plon oraz XP', () => {
    let s = createInitialState(T0);
    s = ok(L.till(s, first));
    s = ok(L.plant(s, first, 'radish', T0));
    expect(s.seeds.radish).toBe(3);
    expect(reason(L.harvest(s, first, T0 + 10 * 60_000))).toBe('not-ready'); // niepodlana nie rośnie
    s = ok(L.water(s, first, T0));
    expect(reason(L.harvest(s, first, T0 + 30_000))).toBe('not-ready');
    const r = L.harvest(s, first, T0 + CROPS.radish.growMs);
    s = ok(r);
    expect(s.barn.radish).toBe(1);
    expect(s.xp).toBe(CROPS.radish.xp);
    expect(s.plots[first]).toEqual({ unlocked: true, tilled: false, crop: null });
  });

  it('odrzuca nieprawidłowe akcje z czytelnym powodem', () => {
    const s = createInitialState(T0);
    expect(reason(L.plant(s, first, 'radish', T0))).toBe('not-tilled');
    expect(reason(L.till(s, 0))).toBe('locked');
    const tilled = ok(L.till(s, first));
    expect(reason(L.till(tilled, first))).toBe('already-tilled');
    expect(reason(L.water(tilled, first, T0))).toBe('nothing-to-water');
    expect(reason(L.plant({ ...tilled, seeds: { ...tilled.seeds, radish: 0 } }, first, 'radish', T0))).toBe('no-seeds');
    const planted = ok(L.plant(tilled, first, 'radish', T0));
    expect(reason(L.plant(planted, first, 'radish', T0))).toBe('occupied');
    const watered = ok(L.water(planted, first, T0));
    expect(reason(L.water(watered, first, T0))).toBe('already-watered');
  });

  it('nie mutuje stanu wejściowego', () => {
    const s = createInitialState(T0);
    const snapshot = structuredClone(s);
    L.till(s, first);
    expect(s).toEqual(snapshot);
  });
});

describe('wzrost z różnicy znaczników czasu', () => {
  const crop = { id: 'carrot' as const, plantedAt: T0, wateredAt: T0, readyAt: T0 + 300_000 };

  it('wylicza 4 etapy wzrostu', () => {
    expect(L.cropStage(crop, T0)).toBe(0);
    expect(L.cropStage(crop, T0 + 99_000)).toBe(0);
    expect(L.cropStage(crop, T0 + 101_000)).toBe(1);
    expect(L.cropStage(crop, T0 + 201_000)).toBe(2);
    expect(L.cropStage(crop, T0 + 299_999)).toBe(2);
    expect(L.cropStage(crop, T0 + 300_000)).toBe(3);
    expect(L.cropStage(crop, T0 + 86_400_000)).toBe(3); // „gra była zamknięta przez dobę”
  });

  it('jest odporny na cofnięcie zegara', () => {
    expect(L.growthProgress(crop, T0 - 60_000)).toBe(0);
  });

  it('niepodlana roślina stoi w miejscu', () => {
    expect(L.cropStage({ ...crop, wateredAt: null, readyAt: null }, T0 + 1e9)).toBe(0);
  });

  it('nawóz skraca czas wzrostu tylko dla roślin podlanych po zakupie', () => {
    let s = createInitialState(T0);
    s = { ...s, upgrades: { ...s.upgrades, fertilizer: 2 } };
    expect(L.growDuration('pumpkin', s.upgrades)).toBe(Math.round(3_600_000 * 0.7));
  });

  it('zraszacz podlewa przy siewie', () => {
    let s = createInitialState(T0);
    s = { ...s, upgrades: { ...s.upgrades, sprinkler: 1 } };
    s = ok(L.till(s, first));
    const r = L.plant(s, first, 'radish', T0);
    s = ok(r);
    expect(s.plots[first]!.crop!.wateredAt).toBe(T0);
    expect(r.ok && r.events.map((e) => e.type)).toEqual(['planted', 'watered']);
  });
});

describe('ekonomia', () => {
  it('kupuje nasiona i pilnuje monet oraz poziomu', () => {
    const s = createInitialState(T0);
    const after = ok(L.buySeeds(s, 'radish', 5));
    expect(after.coins).toBe(s.coins - 10);
    expect(after.seeds.radish).toBe(s.seeds.radish + 5);
    expect(reason(L.buySeeds(s, 'radish', 100))).toBe('no-coins');
    expect(reason(L.buySeeds(s, 'carrot', 1))).toBe('level-too-low');
    expect(reason(L.buySeeds(s, 'radish', 0))).toBe('invalid');
  });

  it('sprzedaje plony z bonusem straganu', () => {
    let s = createInitialState(T0);
    s = { ...s, barn: { ...s.barn, carrot: 3 }, upgrades: { ...s.upgrades, stall: 1 } };
    const price = Math.round(18 * 1.15);
    expect(L.sellPrice('carrot', s.upgrades)).toBe(price);
    const sold = ok(L.sell(s, 'carrot', 2));
    expect(sold.barn.carrot).toBe(1);
    expect(sold.coins).toBe(s.coins + price * 2);
    expect(sold.stats.earned).toBe(price * 2);
    expect(reason(L.sell(s, 'carrot', 5))).toBe('nothing-to-sell');
    expect(reason(L.sell(s, 'radish', 'all'))).toBe('nothing-to-sell');
  });

  it('sprzedaje wszystko naraz', () => {
    let s = createInitialState(T0);
    s = { ...s, barn: { ...s.barn, radish: 2, wheat: 1 } };
    const r = L.sellAll(s);
    const after = ok(r);
    expect(after.coins).toBe(s.coins + 2 * 5 + 48);
    expect(Object.values(after.barn).every((n) => n === 0)).toBe(true);
    expect(reason(L.sellAll(after))).toBe('nothing-to-sell');
  });

  it('kupuje ulepszenia do maksymalnego poziomu', () => {
    let s = createInitialState(T0);
    s = { ...s, coins: 10_000, xp: 1_000 };
    s = ok(L.buyUpgrade(s, 'sprinkler'));
    expect(s.upgrades.sprinkler).toBe(1);
    expect(reason(L.buyUpgrade(s, 'sprinkler'))).toBe('max-level');
    expect(L.nextUpgradeCost(s, 'sprinkler')).toBeNull();
    expect(reason(L.buyUpgrade(createInitialState(T0), 'fertilizer'))).toBe('level-too-low');
  });
});

describe('odblokowywanie pól', () => {
  it('pozwala kupić tylko pole sąsiadujące z posiadanym, z rosnącą ceną', () => {
    let s = { ...createInitialState(T0), coins: 1_000 };
    const neighbor = first - 1; // na lewo od pierwszego pola
    expect(L.canUnlock(s, neighbor)).toBe(true);
    expect(L.canUnlock(s, 0)).toBe(false);
    expect(reason(L.unlockPlot(s, 0))).toBe('not-adjacent');
    const cost1 = L.plotUnlockCost(s);
    s = ok(L.unlockPlot(s, neighbor));
    expect(s.coins).toBe(1_000 - cost1);
    expect(L.plotUnlockCost(s)).toBeGreaterThan(cost1);
    expect(reason(L.unlockPlot(s, neighbor))).toBe('already-unlocked');
  });

  it('wymaga monet', () => {
    const s = { ...createInitialState(T0), coins: 0 };
    expect(reason(L.unlockPlot(s, first - 1))).toBe('no-coins');
  });

  it('sąsiedzi na krawędziach siatki', () => {
    expect(L.plotNeighbors(0).sort((a, b) => a - b)).toEqual([1, GRID_COLS]);
    expect(L.plotNeighbors(GRID_COLS - 1).sort((a, b) => a - b)).toEqual([GRID_COLS - 2, GRID_COLS * 2 - 1]);
  });
});

describe('narzędzia', () => {
  it('applyTool deleguje do akcji wybranego narzędzia', () => {
    let s = createInitialState(T0);
    s = L.selectTool(s, 'hoe');
    s = ok(L.applyTool(s, first, T0));
    s = L.selectSeed(s, 'radish');
    expect(s.tool).toBe('seeds');
    s = ok(L.applyTool(s, first, T0));
    s = ok(L.applyTool(L.selectTool(s, 'can'), first, T0));
    s = ok(L.applyTool(L.selectTool(s, 'sickle'), first, T0 + 60_000));
    expect(s.barn.radish).toBe(1);
  });
});
