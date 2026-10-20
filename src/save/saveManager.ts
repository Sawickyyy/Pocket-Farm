// Zapis do IndexedDB (idb-keyval) z opóźnieniem ~1 s oraz awaryjną kopią w localStorage.
// localStorage jest synchroniczny, więc zdąży się zapisać nawet przy `pagehide`, gdy IndexedDB nie zdąży.

import { createStore as createIdbStore, get, set, type UseStore } from 'idb-keyval';
import type { Store } from '../core/store';
import type { GameState } from '../game/state';
import { loadFromUnknown } from './migrations';

const SAVE_KEY = 'save';
const BACKUP_KEY = 'pocket-farm:backup';

export interface SaveEnvelope {
  savedAt: number;
  state: GameState;
}

export interface SaveBackend {
  read(): Promise<unknown>;
  write(envelope: SaveEnvelope): Promise<void>;
  readBackup(): unknown;
  writeBackup(envelope: SaveEnvelope): void;
}

export function createBrowserBackend(): SaveBackend {
  let idb: UseStore | null = null;
  const db = () => (idb ??= createIdbStore('pocket-farm', 'kv'));
  return {
    read: () => get(SAVE_KEY, db()),
    write: (env) => set(SAVE_KEY, env, db()),
    readBackup() {
      try {
        const raw = localStorage.getItem(BACKUP_KEY);
        return raw ? JSON.parse(raw) : undefined;
      } catch {
        return undefined;
      }
    },
    writeBackup(env) {
      try {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(env));
      } catch {
        // brak miejsca / tryb prywatny – IndexedDB nadal jest głównym zapisem
      }
    },
  };
}

function parseEnvelope(raw: unknown, now: number): SaveEnvelope | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const env = raw as { savedAt?: unknown; state?: unknown };
  try {
    return { savedAt: typeof env.savedAt === 'number' ? env.savedAt : 0, state: loadFromUnknown(env.state, now) };
  } catch (err) {
    console.warn('[save] pominięto uszkodzony zapis', err);
    return null;
  }
}

/** Wczytuje nowszy z dwóch zapisów (IndexedDB vs kopia w localStorage). */
export async function loadSave(backend: SaveBackend, now: number): Promise<SaveEnvelope | null> {
  let primary: SaveEnvelope | null = null;
  try {
    primary = parseEnvelope(await backend.read(), now);
  } catch (err) {
    console.warn('[save] IndexedDB niedostępne', err);
  }
  const backup = parseEnvelope(backend.readBackup(), now);
  if (primary && backup) return backup.savedAt > primary.savedAt ? backup : primary;
  return primary ?? backup;
}

export class SaveManager {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private unsubscribe: (() => void) | null = null;
  lastSavedAt = 0;

  constructor(
    private readonly store: Store<GameState>,
    private readonly backend: SaveBackend,
    private readonly delayMs = 1000,
    private readonly clock: () => number = Date.now,
  ) {}

  start(): void {
    this.unsubscribe = this.store.subscribe(() => this.schedule());
  }

  stop(): void {
    this.unsubscribe?.();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Zaplanuj zapis (debounce). */
  schedule(): void {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  /** Zapisz natychmiast (np. przy visibilitychange/pagehide). */
  async flush(force = false): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty && !force) return;
    this.dirty = false;
    const envelope: SaveEnvelope = { savedAt: this.clock(), state: this.store.get() };
    this.backend.writeBackup(envelope);
    try {
      await this.backend.write(envelope);
      this.lastSavedAt = envelope.savedAt;
    } catch (err) {
      console.warn('[save] zapis do IndexedDB nie powiódł się', err);
      this.dirty = true;
    }
  }

  /** Podpina zapis do zdarzeń cyklu życia strony w Safari. */
  bindLifecycle(target: Window = window): void {
    target.document.addEventListener('visibilitychange', () => {
      if (target.document.visibilityState === 'hidden') void this.flush();
    });
    target.addEventListener('pagehide', () => void this.flush());
  }
}

/** Prośba o trwały magazyn – Safari przyznaje go zwykle aplikacjom z ekranu początkowego. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
