import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from '../src/core/store';
import { START_UNLOCKED } from '../src/game/content';
import { plant, till, water } from '../src/game/logic';
import { SAVE_VERSION, createInitialState, type GameState } from '../src/game/state';
import { checksum, decodeSave, encodeSave } from '../src/save/codec';
import { SaveError, loadFromUnknown, migrate, normalizeState } from '../src/save/migrations';
import { SaveManager, loadSave, type SaveBackend, type SaveEnvelope } from '../src/save/saveManager';

const T0 = 1_700_000_000_000;

function sampleState(): GameState {
  const p = START_UNLOCKED[0]!;
  let s = createInitialState(T0);
  for (const r of [till(s, p)]) if (r.ok) s = r.state;
  const r2 = plant(s, p, 'radish', T0);
  if (r2.ok) s = r2.state;
  const r3 = water(s, p, T0);
  if (r3.ok) s = r3.state;
  return { ...s, coins: 123, xp: 42 };
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

describe('kod eksportu', () => {
  it('przechodzi w obie strony bez strat', () => {
    const s = sampleState();
    const code = encodeSave(s);
    expect(code.startsWith('PFARM1.')).toBe(true);
    expect(decodeSave(code, T0)).toEqual(s);
  });

  it('toleruje białe znaki z kopiowania (np. łamanie linii)', () => {
    const s = sampleState();
    const code = encodeSave(s);
    const messy = `  ${code.slice(0, 20)}\n${code.slice(20)}  `;
    expect(decodeSave(messy, T0)).toEqual(s);
  });

  it('wykrywa uszkodzony kod', () => {
    const code = encodeSave(sampleState());
    const broken = code.slice(0, 30) + (code[30] === 'A' ? 'B' : 'A') + code.slice(31);
    expect(() => decodeSave(broken, T0)).toThrow(SaveError);
    expect(() => decodeSave('cokolwiek', T0)).toThrow(SaveError);
  });

  it('checksum jest stabilny', () => {
    expect(checksum('abc')).toBe(checksum('abc'));
    expect(checksum('abc')).not.toBe(checksum('abd'));
  });
});

describe('migracje i normalizacja', () => {
  it('uruchamia kolejne migracje do wersji docelowej', () => {
    const migrations = {
      1: (d: Record<string, unknown>) => ({ ...d, gold: d.coins }),
      2: (d: Record<string, unknown>) => ({ ...d, renamed: true }),
    };
    const out = migrate({ version: 1, coins: 5 }, migrations, 3);
    expect(out).toMatchObject({ version: 3, gold: 5, renamed: true });
  });

  it('odrzuca zapis z przyszłości i brakującą migrację', () => {
    expect(() => migrate({ version: SAVE_VERSION + 1 })).toThrow(SaveError);
    expect(() => migrate({ version: 1 }, {}, 2)).toThrow(SaveError);
  });

  it('uzupełnia brakujące pola i odrzuca śmieci', () => {
    const s = normalizeState({ coins: -50, xp: 'dużo', plots: [{ unlocked: true, crop: { id: 'banana' } }] }, T0);
    expect(s.coins).toBe(0);
    expect(s.xp).toBe(0);
    expect(s.plots).toHaveLength(48);
    expect(s.plots[0]).toEqual({ unlocked: true, tilled: false, crop: null });
    expect(s.seeds.radish).toBeGreaterThan(0);
  });

  it('poprawny stan przechodzi bez zmian', () => {
    const s = sampleState();
    expect(loadFromUnknown(JSON.parse(JSON.stringify(s)), T0)).toEqual(s);
  });
});

describe('SaveManager', () => {
  afterEach(() => vi.useRealTimers());

  it('zapisuje z opóźnieniem ~1 s i łączy serię zmian w jeden zapis', async () => {
    vi.useFakeTimers();
    const store = createStore(createInitialState(T0));
    const { backend, data } = memoryBackend();
    const mgr = new SaveManager(store, backend, 1000, () => T0 + 5);
    mgr.start();
    store.update((s) => ({ ...s, coins: 1 }));
    await vi.advanceTimersByTimeAsync(500);
    store.update((s) => ({ ...s, coins: 2 }));
    await vi.advanceTimersByTimeAsync(900);
    expect(data.writes).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(data.writes).toBe(1);
    expect((data.primary as SaveEnvelope).state.coins).toBe(2);
    expect((data.backup as SaveEnvelope).savedAt).toBe(T0 + 5);
  });

  it('flush zapisuje natychmiast (visibilitychange / pagehide)', async () => {
    const store = createStore(createInitialState(T0));
    const { backend, data } = memoryBackend();
    const mgr = new SaveManager(store, backend);
    mgr.start();
    store.update((s) => ({ ...s, coins: 77 }));
    await mgr.flush();
    expect(data.writes).toBe(1);
    await mgr.flush(); // nic się nie zmieniło
    expect(data.writes).toBe(1);
    mgr.stop();
  });

  it('wczytuje nowszy z zapisów: IndexedDB albo kopia awaryjna', async () => {
    const older = { savedAt: 1, state: { ...sampleState(), coins: 1 } };
    const newer = { savedAt: 2, state: { ...sampleState(), coins: 2 } };
    expect((await loadSave(memoryBackend(older, newer).backend, T0))?.state.coins).toBe(2);
    expect((await loadSave(memoryBackend(newer, older).backend, T0))?.state.coins).toBe(2);
    expect((await loadSave(memoryBackend(undefined, older).backend, T0))?.state.coins).toBe(1);
    expect(await loadSave(memoryBackend().backend, T0)).toBeNull();
  });

  it('pomija uszkodzony zapis główny', async () => {
    const good = { savedAt: 1, state: sampleState() };
    expect((await loadSave(memoryBackend({ savedAt: 9, state: 'xx' }, good).backend, T0))?.state.coins).toBe(123);
  });
});
