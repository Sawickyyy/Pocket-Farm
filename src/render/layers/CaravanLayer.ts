// Karawana handlowa (docs/plan-osada.md §12, §15): wóz wjeżdża od krawędzi mapy do faktorii, stoi do odjazdu
// i odjeżdża. Czysto wizualna – obecność i termin odjazdu z s.settlement.caravan.
// STUB – moduł „mieszkańcy na mapie”. Kontrakt używany przez FarmScene (nie zmieniaj sygnatur).

import type Phaser from 'phaser';
import type { Content } from '../../content/content';
import type { Calendar, GameState } from '../../sim/types';
import type { WorldMap } from '../../sim/world';

export class CaravanLayer {
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: WorldMap,
    private readonly content: Content,
    private readonly motion: () => boolean,
  ) {}

  sync(state: GameState, cal: Calendar): void {
    void this.scene;
    void this.world;
    void this.content;
    void this.motion;
    void state;
    void cal;
  }

  update(time: number, delta: number, cal: Calendar): void {
    void time;
    void delta;
    void cal;
  }

  /** Czy punkt świata (px) trafia w wóz (dotknięcie otwiera handel). */
  hit(wx: number, wy: number): boolean {
    void wx;
    void wy;
    return false;
  }
}
