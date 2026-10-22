// Tryb budowania: „duch” budynku przesuwany palcem, walidacja na żywo, potwierdzenie/anulowanie.

import { CONTENT } from '../content/content';
import { buildingName, t } from '../i18n/i18n';
import { canPlace } from '../sim/systems/building';
import { FARM, FIELD } from '../sim/world';
import type { App } from './app';
import { $ } from './dom';

interface BuildState {
  mode: 'place' | 'move';
  type: string;
  uid?: number;
  x: number;
  y: number;
}

export class BuildMode {
  private st: BuildState | null = null;
  private readonly bar = $('#build-bar');
  private readonly msg = $('#build-msg');
  private readonly confirmBtn = $<HTMLButtonElement>('#build-confirm');
  private readonly removeBtn = $<HTMLButtonElement>('#build-remove');

  constructor(private readonly app: App) {
    $('#build-cancel').addEventListener('click', () => {
      app.click();
      this.exit();
    });
    this.confirmBtn.addEventListener('click', () => {
      app.click();
      void this.confirm();
    });
    this.removeBtn.addEventListener('click', () => {
      app.click();
      const uid = this.st?.uid;
      if (uid === undefined) return;
      void app.send({ type: 'remove', uid }).then((ok) => ok && this.exit());
    });
  }

  get active(): boolean {
    return this.st !== null;
  }

  /** Pierwsze wolne miejsce w strefie farmy (przy nowym budynku). */
  private freeSpot(type: string): { x: number; y: number } {
    const s = this.app.store.get();
    const [w, h] = CONTENT.buildings[type]?.size ?? [1, 1];
    const cx = FIELD.x + FIELD.w / 2;
    const cy = FIELD.y - 3;
    let best = { x: FARM.x, y: FARM.y, d: Infinity };
    for (let y = FARM.y; y <= FARM.y + FARM.h - h; y++) {
      for (let x = FARM.x; x <= FARM.x + FARM.w - w; x++) {
        if (!canPlace(s, CONTENT, type, x, y).ok) continue;
        const d = Math.hypot(x + w / 2 - cx, y + h / 2 - cy);
        if (d < best.d) best = { x, y, d };
      }
    }
    return best;
  }

  start(type: string): void {
    const spot = this.freeSpot(type);
    this.st = { mode: 'place', type, x: spot.x, y: spot.y };
    this.show();
    this.app.scene()?.focusTile(spot.x, spot.y);
  }

  startMove(uid: number): void {
    const o = this.app.store.get().objects.find((v) => v.uid === uid);
    if (!o) return;
    this.st = { mode: 'move', type: o.type, uid, x: o.x, y: o.y };
    this.show();
    this.app.scene()?.focusTile(o.x, o.y);
  }

  exit(): void {
    this.st = null;
    this.bar.hidden = true;
    this.app.scene()?.setGhost(null);
  }

  /**
   * Palec nad kaflem (tap lub przeciąganie) – budynek centrowany pod palcem.
   * `phase`: 'tap' (dotknięcie), 'start'/'move' (przeciąganie; drogi rysuje się linią od 'start').
   */
  pointTile(x: number, y: number, phase: 'tap' | 'start' | 'move' = 'tap'): void {
    void phase;
    if (!this.st) return;
    const [w, h] = CONTENT.buildings[this.st.type]?.size ?? [1, 1];
    this.st.x = Math.round(x - (w - 1) / 2);
    this.st.y = Math.round(y - (h - 1) / 2);
    this.show();
  }

  /** Koniec przeciągania w trybie budowania. */
  dragEnd(): void {}

  private valid(): boolean {
    if (!this.st) return false;
    return canPlace(this.app.store.get(), CONTENT, this.st.type, this.st.x, this.st.y, this.st.uid ?? -1).ok;
  }

  private show(): void {
    if (!this.st) return;
    const valid = this.valid();
    this.bar.hidden = false;
    this.msg.textContent = `${buildingName(this.st.type)} · ${t(this.st.mode === 'move' ? 'build.moving' : 'build.placing')}`;
    this.confirmBtn.disabled = !valid;
    this.removeBtn.hidden = this.st.mode !== 'move';
    this.app.scene()?.setGhost({ type: this.st.type, x: this.st.x, y: this.st.y, valid });
  }

  private async confirm(): Promise<void> {
    const st = this.st;
    if (!st) return;
    const ok =
      st.mode === 'place'
        ? await this.app.send({ type: 'place', building: st.type, x: st.x, y: st.y })
        : await this.app.send({ type: 'move', uid: st.uid!, x: st.x, y: st.y });
    if (!ok) return;
    // Ścieżki i płoty stawia się seriami – zostajemy w trybie budowania.
    const kind = CONTENT.buildings[st.type]?.kind;
    if (st.mode === 'place' && (kind === 'path' || st.type === 'fence') && this.app.store.get().coins >= (CONTENT.buildings[st.type]?.cost ?? 0)) {
      this.show();
      return;
    }
    this.exit();
  }
}
