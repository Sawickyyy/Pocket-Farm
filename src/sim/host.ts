// Strona wątku głównego: wysyła komendy do symulacji i aktualizuje store stanem z Workera.

import type { Store } from '../core/store';
import type { Command, CommandResult } from './commands';
import { createEngine, type FromSim, type ToSim } from './engine';
import type { SimEvent } from './events';
import type { CatchUpReport } from './simulation';
import type { GameState } from './types';

export interface SimHost {
  ready: Promise<CatchUpReport | null>;
  dispatch(cmd: Command): Promise<CommandResult>;
  replace(state: GameState): void;
  pause(): void;
  resume(): void;
  onEvents(fn: (events: SimEvent[]) => void): void;
  onReport(fn: (report: CatchUpReport) => void): void;
  readonly usesWorker: boolean;
}

export function createSimHost(store: Store<GameState>, initial: GameState, preferWorker = true): SimHost {
  const pending = new Map<number, (r: CommandResult) => void>();
  const eventListeners: Array<(e: SimEvent[]) => void> = [];
  const reportListeners: Array<(r: CatchUpReport) => void> = [];
  let nextId = 1;
  let resolveReady!: (r: CatchUpReport | null) => void;
  const ready = new Promise<CatchUpReport | null>((res) => (resolveReady = res));

  const receive = (msg: FromSim) => {
    store.set(msg.state);
    if (msg.events.length) for (const l of eventListeners) l(msg.events);
    if (msg.kind === 'ready') resolveReady(msg.report);
    if (msg.kind === 'state' && msg.report) for (const l of reportListeners) l(msg.report);
    if (msg.kind === 'result') {
      pending.get(msg.id)?.(msg.result);
      pending.delete(msg.id);
    }
  };

  let send: (msg: ToSim) => void;
  let usesWorker = false;
  if (preferWorker && typeof Worker !== 'undefined') {
    try {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'simulation' });
      worker.onmessage = (e: MessageEvent<FromSim>) => receive(e.data);
      worker.onerror = (e) => console.error('[sim] błąd workera', e);
      send = (msg) => worker.postMessage(msg);
      usesWorker = true;
    } catch (err) {
      console.warn('[sim] Worker niedostępny – symulacja w wątku głównym', err);
    }
  }
  if (!usesWorker) {
    // Klon stanu, żeby zachowanie było takie samo jak przy postMessage.
    const engine = createEngine((msg) => queueMicrotask(() => receive(structuredClone(msg))));
    send = (msg) => engine.handle(structuredClone(msg));
  }

  send!({ kind: 'init', state: initial, realNow: Date.now() });

  return {
    ready,
    usesWorker,
    dispatch(cmd) {
      const id = nextId++;
      return new Promise((res) => {
        pending.set(id, res);
        send({ kind: 'cmd', id, cmd });
      });
    },
    replace(state) {
      send({ kind: 'replace', state, realNow: Date.now() });
    },
    pause() {
      send({ kind: 'pause' });
    },
    resume() {
      send({ kind: 'resume', realNow: Date.now() });
    },
    onEvents(fn) {
      eventListeners.push(fn);
    },
    onReport(fn) {
      reportListeners.push(fn);
    },
  };
}
