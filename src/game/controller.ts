// Kontroler: jedyne miejsce, które zamienia intencje gracza (tap, przeciągnięcie, przycisk w sklepie)
// na wywołania czystej logiki, zapisuje wynik w store i rozsyła zdarzenia do efektów/dźwięku/UI.

import type { Store } from '../core/store';
import type { CropId, ToolId, UpgradeId } from './content';
import * as logic from './logic';
import type { ActionResult, FailReason, GameEvent } from './logic';
import type { GameState } from './state';

export interface ControllerHooks {
  onEvents(events: readonly GameEvent[]): void;
  onFail(reason: FailReason): void;
  /** Gracz dotknął zablokowanego pola, które można kupić. */
  onUnlockRequest(plot: number, cost: number): void;
}

export class GameController {
  private hooks: ControllerHooks[] = [];

  constructor(
    readonly store: Store<GameState>,
    private readonly clock: () => number = Date.now,
  ) {}

  addHooks(h: ControllerHooks): void {
    this.hooks.push(h);
  }

  private commit(result: ActionResult, silent = false): boolean {
    if (result.ok) {
      this.store.set(result.state);
      if (result.events.length) for (const h of this.hooks) h.onEvents(result.events);
      return true;
    }
    if (!silent) for (const h of this.hooks) h.onFail(result.reason);
    return false;
  }

  /** Tap na polu: akcja narzędzia; na zablokowanym polu – propozycja zakupu. */
  tapPlot(index: number): void {
    const state = this.store.get();
    const plot = state.plots[index];
    if (!plot) return;
    if (!plot.unlocked) {
      if (logic.canUnlock(state, index)) {
        for (const h of this.hooks) h.onUnlockRequest(index, logic.plotUnlockCost(state));
      } else {
        for (const h of this.hooks) h.onFail('not-adjacent');
      }
      return;
    }
    this.commit(this.smartTool(state, index));
  }

  /** Przeciągnięcie: ta sama akcja na kolejnych polach, bez komunikatów o błędach. */
  dragPlot(index: number): void {
    const state = this.store.get();
    if (!state.plots[index]?.unlocked) return;
    this.commit(logic.applyTool(state, index, this.clock()), true);
  }

  /**
   * Przy tapnięciu ułatwiamy grę jedną ręką: dojrzała roślina zbiera się każdym narzędziem
   * (oprócz konewki), żeby nie trzeba było przełączać się na sierp dla jednego pola.
   */
  private smartTool(state: GameState, index: number): ActionResult {
    const now = this.clock();
    const crop = state.plots[index]?.crop ?? null;
    if (state.tool !== 'sickle' && state.tool !== 'can' && logic.isReady(crop, now)) {
      return logic.harvest(state, index, now);
    }
    return logic.applyTool(state, index, now);
  }

  confirmUnlock(index: number): boolean {
    return this.commit(logic.unlockPlot(this.store.get(), index));
  }

  selectTool(tool: ToolId): void {
    this.store.update((s) => logic.selectTool(s, tool));
  }

  selectSeed(crop: CropId): void {
    this.store.update((s) => logic.selectSeed(s, crop));
  }

  buySeeds(crop: CropId, qty: number): boolean {
    return this.commit(logic.buySeeds(this.store.get(), crop, qty));
  }

  sell(crop: CropId, qty: number | 'all'): boolean {
    return this.commit(logic.sell(this.store.get(), crop, qty));
  }

  sellAll(): boolean {
    return this.commit(logic.sellAll(this.store.get()));
  }

  buyUpgrade(id: UpgradeId): boolean {
    return this.commit(logic.buyUpgrade(this.store.get(), id));
  }

  toggleSound(): void {
    this.store.update((s) => ({ ...s, settings: { ...s.settings, sound: !s.settings.sound } }));
  }

  replaceState(state: GameState): void {
    this.store.set(state);
  }
}
