// Silnik symulacji obsługujący wiadomości. Ten sam kod działa w Web Workerze (worker.ts)
// i – gdy Workera brak – w wątku głównym (host.ts).

import type { Command, CommandResult } from './commands';
import type { SimEvent } from './events';
import { Simulation, type CatchUpReport } from './simulation';
import type { GameState } from './types';

export type ToSim =
  | { kind: 'init'; state: GameState; realNow: number }
  | { kind: 'cmd'; id: number; cmd: Command }
  | { kind: 'replace'; state: GameState; realNow: number }
  | { kind: 'pause' }
  | { kind: 'resume'; realNow: number };

export type FromSim =
  | { kind: 'ready'; state: GameState; events: SimEvent[]; report: CatchUpReport | null }
  | { kind: 'state'; state: GameState; events: SimEvent[]; report?: CatchUpReport | null }
  | { kind: 'result'; id: number; result: CommandResult; state: GameState; events: SimEvent[] };

export const TICK_MS = 200;

export function createEngine(post: (msg: FromSim) => void, now: () => number = Date.now) {
  let sim: Simulation | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const startTimer = () => {
    if (timer) return;
    timer = setInterval(() => {
      if (!sim) return;
      sim.tick(now());
      post({ kind: 'state', state: sim.state, events: sim.takeEvents() });
    }, TICK_MS);
  };
  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  return {
    handle(msg: ToSim): void {
      switch (msg.kind) {
        case 'init': {
          sim = new Simulation(msg.state);
          const report = sim.catchUp(msg.realNow);
          post({ kind: 'ready', state: sim.state, events: sim.takeEvents(), report });
          startTimer();
          break;
        }
        case 'replace':
          if (!sim) sim = new Simulation(msg.state);
          else sim.replaceState(msg.state);
          sim.state.clock.lastRealMs = msg.realNow;
          post({ kind: 'state', state: sim.state, events: sim.takeEvents() });
          break;
        case 'cmd': {
          if (!sim) return;
          sim.tick(now());
          const result = sim.dispatch(msg.cmd);
          post({ kind: 'result', id: msg.id, result, state: sim.state, events: sim.takeEvents() });
          break;
        }
        case 'pause':
          stopTimer();
          break;
        case 'resume': {
          if (!sim) return;
          const report = sim.catchUp(msg.realNow);
          post({ kind: 'state', state: sim.state, events: sim.takeEvents(), report });
          startTimer();
          break;
        }
      }
    },
    dispose: stopTimer,
  };
}
