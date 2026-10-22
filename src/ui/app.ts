// Wspólny kontekst interfejsu przekazywany modułom UI.

import type { AudioEngine } from '../audio/sfx';
import type { Store } from '../core/store';
import type { FarmScene } from '../render/FarmScene';
import type { Command } from '../sim/commands';
import type { SimHost } from '../sim/host';
import type { GameState } from '../sim/types';
import type { Toasts } from './toast';

export interface App {
  store: Store<GameState>;
  sim: SimHost;
  toasts: Toasts;
  audio: AudioEngine;
  /** Wysyła komendę; przy błędzie pokazuje komunikat (chyba że `silent`). */
  send(cmd: Command, silent?: boolean): Promise<boolean>;
  click(): void;
  scene(): FarmScene | null;
  reducedMotion(): boolean;
  openSheet(id: string, arg?: unknown, tab?: string): void;
  closeSheet(): void;
  confirm(title: string, html: string, yes: string, onYes: () => void, disabled?: boolean): void;
  startBuild(type: string, style?: number): void;
  /** Tryb terenu (kupno fragmentów mapy). */
  startTerritory(): void;
  startMove(uid: number): void;
  startFishing(): void;
  debugEnabled(): boolean;
  enableDebug(): void;
  flushSave(): Promise<void>;
}
