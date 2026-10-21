// Mgła nad nieodkrytymi fragmentami mapy (SpriteGPULayer z miękkich chmur) + ikony „do odkrycia”.

import type Phaser from 'phaser';
import { canExplore } from '../../sim/systems/exploration';
import type { GameState } from '../../sim/types';
import { CHUNK, CHUNKS_X, CHUNKS_Y } from '../../sim/world';
import { SPRITES_KEY, TILE } from '../art/atlas';

const PUFFS = [
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
  [0.5, 0.5],
] as const;
const FADE_MS = 900;

export class FogLayer {
  readonly layer: Phaser.GameObjects.SpriteGPULayer;
  private key = '';
  private known = new Set<number>();
  private pending: ReturnType<typeof setTimeout> | null = null;

  constructor(scene: Phaser.Scene) {
    this.layer = scene.add.spriteGPULayer(SPRITES_KEY, CHUNKS_X * CHUNKS_Y * (PUFFS.length + 1)).setDepth(40).setLighting(true);
    this.layer.setAnimationEnabled('Linear', true);
    this.layer.setAnimationEnabled('Sine.easeInOut', true);
  }

  sync(state: GameState, motion: boolean): void {
    const key = `${state.world.revealed.join(',')}|${motion}`;
    if (key === this.key) return;
    const newlyRevealed = state.world.revealed.filter((c) => !this.known.has(c));
    const firstSync = this.key === '';
    this.key = key;
    this.known = new Set(state.world.revealed);
    if (!firstSync && newlyRevealed.length && motion) {
      // Animacja rozwiewania mgły na GPU, potem przebudowa bufora.
      this.rebuild(state, motion, new Set(newlyRevealed));
      if (this.pending) clearTimeout(this.pending);
      this.pending = setTimeout(() => this.rebuild(state, motion), FADE_MS);
    } else this.rebuild(state, motion);
  }

  private rebuild(state: GameState, motion: boolean, fading = new Set<number>()): void {
    const revealed = new Set(state.world.revealed);
    if (this.layer.memberCount) this.layer.removeMembers(0, this.layer.memberCount);
    const size = CHUNK * TILE;
    for (let c = 0; c < CHUNKS_X * CHUNKS_Y; c++) {
      const fadingNow = fading.has(c);
      if (revealed.has(c) && !fadingNow) continue;
      const cx = (c % CHUNKS_X) * size;
      const cy = Math.floor(c / CHUNKS_X) * size;
      PUFFS.forEach(([px, py], k) => {
        const scale = k === 4 ? 4.2 : 3.4;
        this.layer.addMember({
          frame: 'fog',
          x: cx + px * size,
          y: motion && !fadingNow ? { base: cy + py * size, amplitude: 14, duration: 3000 + k * 400, ease: 'Sine.easeInOut', yoyo: true } : cy + py * size,
          scaleX: scale,
          scaleY: scale,
          alpha: fadingNow ? { base: 1, amplitude: -1.05, duration: FADE_MS, ease: 'Linear', loop: false } : 1,
        });
      });
      if (!revealed.has(c) && canExplore(state, c)) {
        this.layer.addMember({ frame: 'icon_explore', x: cx + size / 2, y: cy + size / 2, scaleX: 1.6, scaleY: 1.6 });
      }
    }
  }
}
