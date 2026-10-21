// Web Worker z logiką symulacji – renderowanie w wątku głównym nie jest blokowane (np. przy nadrabianiu 24 h).

import { createEngine, type ToSim } from './engine';

// Typy DOM i WebWorker kolidują w jednym projekcie – opisujemy tylko to, czego używamy.
const scope = self as unknown as { postMessage(msg: unknown): void; onmessage: ((e: MessageEvent<ToSim>) => void) | null };
const engine = createEngine((msg) => scope.postMessage(msg));
scope.onmessage = (e: MessageEvent<ToSim>) => engine.handle(e.data);
