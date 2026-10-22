// Mieszkańcy osady chodzący po drogach gracza (docs/plan-osada.md §15): rano dom → praca, wieczorem praca → dom,
// w wolnym czasie plac/karczma; nocą w domach. Czysto wizualne – stan bierzemy z symulacji, trasy z roads.findPath.
// STUB – moduł „mieszkańcy na mapie”. Kontrakt używany przez FarmScene (nie zmieniaj sygnatur).

import type Phaser from 'phaser';
import type { Content } from '../../content/content';
import type { Calendar, GameState } from '../../sim/types';
import type { WorldMap } from '../../sim/world';

/** Limit jednocześnie widocznych postaci. */
export const MAX_VISIBLE_RESIDENTS = 40;

export class ResidentLayer {
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: WorldMap,
    private readonly content: Content,
    /** false przy ograniczeniu ruchu – postacie stoją (bez chodzenia). */
    private readonly motion: () => boolean,
  ) {}

  /** Synchronizacja ze stanem (co ~120 ms i przy zmianie stanu). */
  sync(state: GameState, cal: Calendar): void {
    void this.scene;
    void this.world;
    void this.content;
    void this.motion;
    void state;
    void cal;
  }

  /** Klatka animacji (czas sceny w ms). */
  update(time: number, delta: number, cal: Calendar): void {
    void time;
    void delta;
    void cal;
  }

  /** Mieszkaniec pod punktem świata (px) → id. */
  hit(wx: number, wy: number): number | null {
    void wx;
    void wy;
    return null;
  }

  /** Pozycja widocznej postaci w kaflach (ciągła) albo null, gdy mieszkaniec jest w budynku. */
  positionOf(id: number): { x: number; y: number } | null {
    void id;
    return null;
  }

  /** Radosny podskok postaci (np. po ślubie, narodzinach dziecka w rodzinie). */
  cheer(id: number): void {
    void id;
  }
}
