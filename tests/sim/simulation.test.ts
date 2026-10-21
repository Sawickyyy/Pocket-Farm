import { describe, expect, it } from 'vitest';
import { MAX_CATCHUP_MS } from '../../src/sim/calendar';
import { createEngine, type FromSim } from '../../src/sim/engine';
import { createInitialState } from '../../src/sim/initialState';
import { Simulation } from '../../src/sim/simulation';
import { HOUR_MS, P, T0, makeSim, ok, tillPlantWater } from './helpers';

describe('deterministyczna symulacja', () => {
  it('ten sam czas w jednym kawałku i w wielu daje identyczny stan', () => {
    const build = () => {
      const sim = makeSim((s) => {
        s.coins = 10_000;
        s.xp = 10_000;
        s.inventory.feed = 50;
      });
      tillPlantWater(sim, P);
      return sim;
    };
    const a = build();
    const b = build();
    a.advance(30 * HOUR_MS);
    let used = 0;
    for (let i = 0; i < 250; i++) {
      const d = 6_000 + (i % 7) * 13; // kawałki niewyrównane do kroku symulacji
      used += d;
      b.advance(d);
    }
    b.advance(30 * HOUR_MS - used);
    expect(b.state).toEqual(a.state);
  });

  it('nadrabia nieobecność krok po kroku z limitem 24 h i raportem', () => {
    const sim = makeSim();
    tillPlantWater(sim, P);
    sim.takeEvents();
    sim.state.clock.lastRealMs = T0;
    const report = sim.catchUp(T0 + 3 * MAX_CATCHUP_MS)!;
    expect(report.capped).toBe(true);
    expect(report.simulatedMs).toBe(MAX_CATCHUP_MS);
    expect(report.days).toBeGreaterThan(50);
    expect(sim.takeEvents()).toEqual([]); // offline bez efektów
  });

  it('krótka nieobecność bez raportu; nieznany czas nie nadrabia', () => {
    const sim = makeSim();
    sim.state.clock.lastRealMs = T0;
    expect(sim.catchUp(T0 + 5_000)).toBeNull();
    sim.state.clock.lastRealMs = 0;
    expect(sim.catchUp(T0 + 10 * HOUR_MS)).toBeNull();
  });

  it('mnożnik czasu (debug) przyspiesza tick', () => {
    const sim = makeSim();
    sim.state.clock.lastRealMs = T0;
    ok(sim, { type: 'debug', op: 'timeScale', value: 60 });
    const before = sim.state.clock.simMs;
    sim.tick(T0 + 60_000);
    expect(sim.state.clock.simMs - before).toBe(60 * 60_000);
  });
});

describe('samouczek', () => {
  it('przechodzi kroki na podstawie zdarzeń', () => {
    const s = createInitialState(T0, 1);
    const sim = new Simulation(s);
    ok(sim, { type: 'tutorial', action: 'next' }); // powitanie
    ok(sim, { type: 'selectTool', tool: 'hoe' });
    expect(sim.state.tutorial.step).toBe(2);
    ok(sim, { type: 'useTool', plot: P });
    ok(sim, { type: 'selectTool', tool: 'seeds' });
    ok(sim, { type: 'useTool', plot: P });
    ok(sim, { type: 'selectTool', tool: 'can' });
    ok(sim, { type: 'useTool', plot: P });
    expect(sim.state.tutorial.step).toBe(7);
    sim.advance(2 * HOUR_MS);
    ok(sim, { type: 'selectTool', tool: 'sickle' });
    ok(sim, { type: 'useTool', plot: P });
    ok(sim, { type: 'sellAll' });
    const coins = sim.state.coins;
    ok(sim, { type: 'tutorial', action: 'next' });
    expect(sim.state.tutorial.done).toBe(true);
    expect(sim.state.coins).toBe(coins + 50);
  });
});

describe('silnik (protokół workera)', () => {
  it('init → ready z raportem, komenda → wynik ze stanem i zdarzeniami', () => {
    const out: FromSim[] = [];
    let now = T0;
    const engine = createEngine((m) => out.push(m), () => now);
    const state = createInitialState(T0, 5);
    state.clock.lastRealMs = T0 - 2 * 60 * 60 * 1000; // 2 h rzeczywiste = 5 dni gry
    engine.handle({ kind: 'init', state, realNow: now });
    expect(out[0]!.kind).toBe('ready');
    expect((out[0] as Extract<FromSim, { kind: 'ready' }>).report?.days).toBeGreaterThan(0);
    now += 1000;
    engine.handle({ kind: 'cmd', id: 7, cmd: { type: 'useTool', plot: P } });
    const res = out[1] as Extract<FromSim, { kind: 'result' }>;
    expect(res.id).toBe(7);
    expect(res.result.ok).toBe(true);
    expect(res.events.some((e) => e.type === 'tilled')).toBe(true);
    engine.dispose();
  });
});
