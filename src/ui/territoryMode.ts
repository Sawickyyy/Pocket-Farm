// Tryb terenu: podgląd fragmentów do kupienia z cenami i kupno dotknięciem (docs/plan-osada.md §2).
// STUB – moduł „budowanie osady”.

import type { App } from './app';

export class TerritoryMode {
  constructor(private readonly app: App) {}

  get active(): boolean {
    return false;
  }

  start(): void {
    void this.app;
  }

  exit(): void {}

  /** Dotknięcie kafla w trybie terenu (wywołuje obsługa wskaźnika). */
  tapTile(x: number, y: number): void {
    void x;
    void y;
  }
}
