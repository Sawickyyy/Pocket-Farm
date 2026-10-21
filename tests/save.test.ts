import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from '../src/core/store';
import { decodeSave, encodeSave, checksum } from '../src/save/codec';
import { SaveError, loadFromUnknown, migrate, normalizeState } from '../src/save/migrations';
import { SaveManager, loadSave, type SaveBackend, type SaveEnvelope } from '../src/save/saveManager';
import { START_UNLOCKED, createInitialState } from '../src/sim/initialState';
import { Simulation } from '../src/sim/simulation';
import { SAVE_VERSION, type GameState } from '../src/sim/types';

const T0 = 1_700_000_000_000;

function sampleState(): GameState {
  const sim = new Simulation(createInitialState(T0, 9));
  const p = START_UNLOCKED[0]!;
  sim.dispatch({ type: 'useTool', plot: p });
  sim.dispatch({ type: 'selectSeed', crop: 'radish' });
  sim.dispatch({ type: 'useTool', plot: p });
  sim.state.coins = 123;
  sim.state.inventory = { 'wheat*2': 3, egg: 1 };
  return sim.state;
}

function memoryBackend(primary?: unknown, backup?: unknown) {
  const data = { primary, backup, writes: 0 };
  const backend: SaveBackend = {
    read: async () => data.primary,
    write: async (env) => {
      data.primary = structuredClone(env);
      data.writes++;
    },
    readBackup: () => data.backup,
    writeBackup: (env) => {
      data.backup = structuredClone(env);
    },
  };
  return { backend, data };
}

/** Prawdziwy kształt zapisu z MVP (v1). */
const V1_SAVE = {
  version: 1,
  createdAt: T0,
  coins: 40,
  xp: 12,
  plots: Array.from({ length: 48 }, (_, i) =>
    i === 26
      ? { unlocked: true, tilled: true, crop: { id: 'radish', plantedAt: T0, wateredAt: T0, readyAt: T0 + 60_000 } }
      : { unlocked: [26, 27, 32, 33, 20, 21].includes(i), tilled: false, crop: null },
  ),
  seeds: { radish: 2, carrot: 1, wheat: 0, pumpkin: 0 },
  barn: { radish: 3, carrot: 0, wheat: 0, pumpkin: 0 },
  upgrades: { fertilizer: 1, stall: 0, sprinkler: 0 },
  tool: 'seeds',
  selectedSeed: 'carrot',
  stats: { harvested: 7, earned: 55 },
  settings: { sound: false },
};

describe('migracja v1 → v2', () => {
  it('przenosi postęp z MVP i zwraca koszt ulepszeń', () => {
    const s = loadFromUnknown(structuredClone(V1_SAVE), T0 + 120_000);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.coins).toBe(40 + 50);
    expect(s.xp).toBe(12);
    expect(s.skillPoints).toBe(1);
    expect(s.inventory).toEqual({ radish: 3 });
    expect(s.seeds).toEqual({ radish: 2, carrot: 1 });
    expect(s.plots[26]!.crop?.growth).toBe(1); // rzodkiewka zdążyła urosnąć
    expect(s.plots.filter((p) => p.unlocked)).toHaveLength(6);
    expect(s.settings.sound).toBe(false);
    expect(s.stats).toEqual({ harvested: 7, coinsEarned: 55 });
    expect(s.tutorial.done).toBe(true);
    expect(s.clock.lastRealMs).toBe(0); // bez nadrabiania nieznanego czasu
  });

  it('uruchamia kolejne migracje do wersji docelowej', () => {
    const out = migrate({ version: 1, a: 1 }, { 1: (d) => ({ ...d, b: 2 }), 2: (d) => ({ ...d, c: 3 }) }, 3);
    expect(out).toMatchObject({ version: 3, a: 1, b: 2, c: 3 });
    expect(() => migrate({ version: SAVE_VERSION + 1 })).toThrow(SaveError);
    expect(() => migrate({ version: 1 }, {}, 2)).toThrow(SaveError);
  });
});

describe('migracja v2 → v3 (większa mapa)', () => {
  it('przesuwa budynki i odkryte fragmenty, osusza puste grządki', () => {
    const v2 = JSON.parse(JSON.stringify(sampleState())) as Record<string, any>;
    v2.version = 2;
    v2.objects = [{ uid: 1, type: 'coop', x: 16, y: 16 }];
    v2.nextUid = 2;
    v2.world.revealed = [14, 15, 20, 21, 13]; // stare fragmenty 6×6 (13 = na lewo od farmy)
    v2.world.forage = { '100': 5 };
    const p = START_UNLOCKED[1]!;
    v2.plots[p] = { ...v2.plots[p], tilled: true, moisture: 1, crop: null };
    const s = loadFromUnknown(v2, T0);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.objects[0]).toMatchObject({ x: 24, y: 24 });
    expect(s.world.revealed).toEqual(expect.arrayContaining([27, 28, 35, 36, 26, 43, 44]));
    expect(s.world.forage).toEqual({});
    expect(s.plots[p]!.moisture).toBe(0);
    expect(s.plots[START_UNLOCKED[0]!]!.crop?.id).toBe('radish');
  });
});

describe('normalizacja', () => {
  it('poprawny stan przechodzi bez zmian', () => {
    const s = sampleState();
    expect(loadFromUnknown(JSON.parse(JSON.stringify(s)), T0)).toEqual(s);
  });

  it('naprawia śmieci zamiast psuć grę', () => {
    const s = normalizeState(
      {
        version: 2,
        coins: -5,
        plots: [{ unlocked: true, crop: { id: 'banana' } }],
        inventory: { wheat: 2, nonsense: 4, 'egg*2': 'x' },
        animals: [{ kind: 'dragon' }, { kind: 'chicken', home: 999 }],
        settings: { language: 'de', uiScale: 9 },
      },
      T0,
    );
    expect(s.coins).toBe(0);
    expect(s.plots).toHaveLength(48);
    expect(s.plots[0]!.crop).toBeNull();
    expect(s.inventory).toEqual({ wheat: 2 });
    expect(s.animals).toEqual([]);
    expect(s.settings.language).toBe('pl');
    expect(s.settings.uiScale).toBe(1.6);
  });
});

describe('kod eksportu', () => {
  it('przechodzi w obie strony i toleruje białe znaki', () => {
    const s = sampleState();
    const code = encodeSave(s);
    expect(decodeSave(`  ${code.slice(0, 20)}\n${code.slice(20)} `, T0)).toEqual(s);
  });

  it('wykrywa uszkodzony kod', () => {
    const code = encodeSave(sampleState());
    const broken = code.slice(0, 30) + (code[30] === 'A' ? 'B' : 'A') + code.slice(31);
    expect(() => decodeSave(broken, T0)).toThrow(SaveError);
    expect(() => decodeSave('cokolwiek', T0)).toThrow(SaveError);
    expect(checksum('abc')).not.toBe(checksum('abd'));
  });
});

describe('SaveManager', () => {
  afterEach(() => vi.useRealTimers());

  it('zapisuje ~1 s po akcji i łączy serię akcji w jeden zapis', async () => {
    vi.useFakeTimers();
    const store = createStore(createInitialState(T0));
    const { backend, data } = memoryBackend();
    const mgr = new SaveManager(store, backend, 1000, () => T0 + 5, 60_000);
    mgr.start();
    store.update((s) => ({ ...s, coins: 1 }));
    mgr.schedule();
    await vi.advanceTimersByTimeAsync(500);
    store.update((s) => ({ ...s, coins: 2 }));
    mgr.schedule();
    await vi.advanceTimersByTimeAsync(900);
    expect(data.writes).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(data.writes).toBe(1);
    expect((data.primary as SaveEnvelope).state.coins).toBe(2);
    mgr.stop();
  });

  it('autozapis co zadany czas (postęp symulacji bez akcji gracza)', async () => {
    vi.useFakeTimers();
    const store = createStore(createInitialState(T0));
    const { backend, data } = memoryBackend();
    const mgr = new SaveManager(store, backend, 1000, Date.now, 15_000);
    mgr.start();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(data.writes).toBe(2);
    mgr.stop();
  });

  it('wczytuje nowszy z zapisów i pomija uszkodzony', async () => {
    const older = { savedAt: 1, state: { ...sampleState(), coins: 1 } };
    const newer = { savedAt: 2, state: { ...sampleState(), coins: 2 } };
    expect((await loadSave(memoryBackend(older, newer).backend, T0))?.state.coins).toBe(2);
    expect((await loadSave(memoryBackend(newer, older).backend, T0))?.state.coins).toBe(2);
    expect((await loadSave(memoryBackend({ savedAt: 9, state: 'xx' }, older).backend, T0))?.state.coins).toBe(1);
    expect(await loadSave(memoryBackend().backend, T0)).toBeNull();
  });
});
