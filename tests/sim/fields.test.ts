import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../src/content/content';
import { calendarAt } from '../../src/sim/calendar';
import { cropStage, qualityTier } from '../../src/sim/systems/fields';
import { HOUR_MS, P, findDay, makeSim, ok, reason, setTime, tillPlantWater } from './helpers';

describe('pola: pętla i wzrost', () => {
  it('orka → siew → podlanie → wzrost → zbiór', () => {
    const sim = makeSim();
    tillPlantWater(sim, P);
    const crop = sim.state.plots[P]!.crop!;
    expect(cropStage(crop)).toBe(0);
    sim.advance(2 * HOUR_MS); // rzodkiewka: 1 h × tempo gleby
    expect(sim.state.plots[P]!.crop!.growth).toBe(1);
    ok(sim, { type: 'selectTool', tool: 'sickle' });
    ok(sim, { type: 'useTool', plot: P });
    expect(Object.keys(sim.state.inventory).some((k) => k.startsWith('radish'))).toBe(true);
    expect(sim.state.plots[P]!.tilled).toBe(false);
  });

  it('sucha gleba wstrzymuje wzrost', () => {
    const sim = makeSim((s) => setTime(s, 0, 8));
    sim.state.seeds.radish = 1;
    ok(sim, { type: 'selectTool', tool: 'hoe' });
    ok(sim, { type: 'useTool', plot: P });
    ok(sim, { type: 'selectSeed', crop: 'radish' });
    ok(sim, { type: 'useTool', plot: P });
    sim.advance(3 * HOUR_MS);
    expect(sim.state.plots[P]!.crop!.growth).toBe(0);
  });

  it('nie da się posiać poza sezonem; zmiana sezonu wyrzuca uprawy (więdną)', () => {
    const sim = makeSim();
    sim.state.seeds.pumpkin = 1;
    ok(sim, { type: 'selectTool', tool: 'hoe' });
    ok(sim, { type: 'useTool', plot: P });
    ok(sim, { type: 'selectSeed', crop: 'pumpkin' });
    expect(reason(sim, { type: 'useTool', plot: P })).toBe('out-of-season');

    const sim2 = makeSim((s) => setTime(s, 6, 8)); // ostatni dzień wiosny
    sim2.state.seeds.carrot = 1;
    tillPlantWater(sim2, P, 'carrot');
    sim2.advance(20 * HOUR_MS); // przejście do lata
    expect(sim2.state.plots[P]!.crop!.withered).toBe(true);
    // zwiędłą roślinę usuwa motyka
    ok(sim2, { type: 'selectTool', tool: 'hoe' });
    ok(sim2, { type: 'useTool', plot: P });
    expect(sim2.state.plots[P]!.crop).toBeNull();
  });

  it('deszcz podlewa obsiane pola, upał wysusza je szybciej', () => {
    const seed = 42;
    const rainDay = findDay(seed, 'rain', 0);
    const sim = makeSim((s) => setTime(s, rainDay, 8), seed);
    ok(sim, { type: 'useTool', plot: P });
    sim.advance(HOUR_MS);
    // świeżo zaorana, pusta grządka zostaje sucha nawet w deszczu
    expect(sim.state.plots[P]!.moisture).toBe(0);
    sim.state.seeds.radish = 1;
    ok(sim, { type: 'selectSeed', crop: 'radish' });
    ok(sim, { type: 'useTool', plot: P });
    sim.advance(HOUR_MS / 6);
    expect(sim.state.plots[P]!.moisture).toBe(1);

    const heatDay = findDay(seed, 'heat', 1);
    const sunDay = findDay(seed, 'sun', 1);
    const heat = makeSim((s) => setTime(s, heatDay, 8), seed);
    const sun = makeSim((s) => setTime(s, sunDay, 8), seed);
    for (const sm of [heat, sun]) {
      ok(sm, { type: 'useTool', plot: P });
      ok(sm, { type: 'selectTool', tool: 'can' });
      ok(sm, { type: 'useTool', plot: P });
      sm.advance(2 * HOUR_MS);
    }
    expect(heat.state.plots[P]!.moisture).toBeLessThan(sun.state.plots[P]!.moisture);
  });

  it('rośliny nocne rosną tylko nocą', () => {
    const sim = makeSim((s) => {
      setTime(s, 7 + 1, 8); // lato, 8:00
      s.xp = 10_000;
    });
    tillPlantWater(sim, P, 'moonmelon');
    sim.state.plots[P]!.moisture = 1;
    sim.advance(10 * HOUR_MS); // 8:00 → 18:00
    expect(sim.state.plots[P]!.crop!.growth).toBe(0);
    sim.state.plots[P]!.moisture = 1;
    sim.advance(4 * HOUR_MS); // → 22:00
    expect(sim.state.plots[P]!.crop!.growth).toBeGreaterThan(0);
  });
});

describe('wilgotność nowych grządek', () => {
  it('po zbiorze i ponownej orce grządka jest sucha', () => {
    const sim = makeSim();
    tillPlantWater(sim, P);
    sim.advance(2 * HOUR_MS);
    ok(sim, { type: 'selectTool', tool: 'sickle' });
    ok(sim, { type: 'useTool', plot: P });
    expect(sim.state.plots[P]!.moisture).toBe(0);
    ok(sim, { type: 'selectTool', tool: 'hoe' });
    ok(sim, { type: 'useTool', plot: P });
    expect(sim.state.plots[P]!.tilled).toBe(true);
    expect(sim.state.plots[P]!.moisture).toBe(0);
  });
});

describe('gleba: żyzność, nawozy, płodozmian', () => {
  it('zbiór zabiera żyzność, ta sama uprawa z rzędu zabiera więcej', () => {
    const sim = makeSim();
    const start = sim.state.plots[P]!.fertility;
    const soil = CONTENT.crop.radish!.soil;
    for (let n = 0; n < 2; n++) {
      tillPlantWater(sim, P);
      sim.state.plots[P]!.crop!.growth = 1;
      ok(sim, { type: 'selectTool', tool: 'sickle' });
      ok(sim, { type: 'useTool', plot: P });
    }
    expect(sim.state.plots[P]!.streak).toBe(1);
    expect(sim.state.plots[P]!.fertility).toBeCloseTo(start - soil - soil * 2);
  });

  it('nawóz podnosi żyzność; ugór regeneruje się co dzień', () => {
    const sim = makeSim((s) => {
      s.inventory.compost = 1;
    });
    sim.state.plots[P]!.fertility = 0.3;
    ok(sim, { type: 'selectFertilizer', item: 'compost' });
    ok(sim, { type: 'useTool', plot: P });
    expect(sim.state.plots[P]!.fertility).toBeCloseTo(0.5);
    expect(reason(sim, { type: 'useTool', plot: P })).toBe('no-fertilizer');
    sim.advance(24 * HOUR_MS);
    expect(sim.state.plots[P]!.fertility).toBeCloseTo(0.54);
  });

  it('progi jakości', () => {
    expect(qualityTier(0.5)).toBe(0);
    expect(qualityTier(0.7)).toBe(1);
    expect(qualityTier(0.9)).toBe(2);
  });

  it('żyzna, stale wilgotna gleba daje lepszą jakość niż jałowa', () => {
    const run = (fertility: number, keepWet: boolean) => {
      const sim = makeSim((s) => {
        s.plots[P]!.fertility = fertility;
        s.seeds.carrot = 1;
        s.xp = 100;
      });
      tillPlantWater(sim, P, 'carrot');
      for (let i = 0; i < 40 && sim.state.plots[P]!.crop!.growth < 1; i++) {
        if (keepWet) sim.state.plots[P]!.moisture = 1;
        else if (sim.state.plots[P]!.moisture <= 0) sim.state.plots[P]!.moisture = 0.2;
        sim.advance(HOUR_MS / 2);
      }
      ok(sim, { type: 'selectTool', tool: 'sickle' });
      ok(sim, { type: 'useTool', plot: P });
      return Object.keys(sim.state.inventory).find((k) => k.startsWith('carrot'))!;
    };
    expect(run(1, true)).not.toBe('carrot');
    expect(run(0.05, false)).toBe('carrot');
  });

  it('kalendarz: sezon zmienia się co 7 dni', () => {
    expect(calendarAt(0, 1).season).toBe('spring');
    expect(calendarAt(7 * 24 * HOUR_MS, 1).season).toBe('summer');
    expect(calendarAt(28 * 24 * HOUR_MS, 1).year).toBe(1);
    expect(calendarAt(21 * HOUR_MS, 1).isNight).toBe(true);
  });
});
