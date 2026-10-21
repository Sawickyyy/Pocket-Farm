// Rośliny i ikony nad polami na SpriteGPULayer: 48 roślin + 48 ikon, edytowanych tylko przy zmianie.

import type Phaser from 'phaser';
import { canUnlock, cropStage, isReady } from '../../sim/systems/fields';
import type { GameState } from '../../sim/types';
import { plotTile } from '../../sim/world';
import { SPRITES_KEY, cropFrame } from '../art/atlas';
import { project } from '../iso';

export class PlantLayer {
  readonly layer: Phaser.GameObjects.SpriteGPULayer;
  private readonly keys: string[];

  constructor(scene: Phaser.Scene, private readonly count: number) {
    this.layer = scene.add.spriteGPULayer(SPRITES_KEY, count * 2).setDepth(10).setLighting(true);
    // Animacje włączone z góry – bez rekompilacji shadera w trakcie gry.
    this.layer.setAnimationEnabled('Sine.easeInOut', true);
    for (let i = 0; i < count * 2; i++) this.layer.addMember({ frame: 'icon_ready', scaleX: 0, scaleY: 0, alpha: 0 });
    this.keys = new Array<string>(count * 2).fill('');
  }

  private set(i: number, key: string, member: Parameters<Phaser.GameObjects.SpriteGPULayer['editMember']>[1] | null): void {
    if (this.keys[i] === key) return;
    this.keys[i] = key;
    this.layer.editMember(i, member ?? { frame: 'icon_ready', scaleX: 0, scaleY: 0, alpha: 0 });
  }

  sync(state: GameState, motion: boolean): void {
    state.plots.forEach((plot, i) => {
      const t = plotTile(i);
      // Rośliny stoją pionowo na środku rombu kafla (podstawa w środku, origin ~0.72 klatki).
      const { x, y } = project(t.x + 0.5, t.y + 0.5);
      const crop = plot.crop;
      if (!crop) this.set(i, '', null);
      else {
        const stage = crop.withered ? 4 : cropStage(crop);
        const ripe = stage === 3;
        this.set(i, `${crop.id}:${stage}:${motion}`, {
          x,
          y,
          frame: cropFrame(crop.id, stage),
          originY: 0.72,
          scaleX: 1.15,
          scaleY: ripe && motion ? { base: 1.15, amplitude: 0.08, duration: 650, ease: 'Sine.easeInOut', yoyo: true } : 1.15,
        });
      }

      let icon: string | null = null;
      if (!plot.unlocked && canUnlock(state, i)) icon = 'icon_lock';
      else if (crop && !crop.withered && crop.growth < 1 && plot.moisture <= 0.05) icon = 'icon_drop';
      else if (isReady(crop)) icon = 'icon_ready';
      const m = this.count + i;
      if (!icon) this.set(m, '', null);
      else if (icon === 'icon_lock') this.set(m, `${icon}`, { x, y: y - 20, frame: icon, scaleX: 0.8, scaleY: 0.8, alpha: 0.9 });
      else {
        const iy = y - 110;
        this.set(m, `${icon}:${motion}`, {
          x: x + 30,
          y: motion ? { base: iy, amplitude: -10, duration: 550, ease: 'Sine.easeInOut', yoyo: true } : iy,
          frame: icon,
          scaleX: 0.45,
          scaleY: 0.45,
        });
      }
    });
  }
}
