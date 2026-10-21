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
  /** Ostatni etap rośliny na polu – wzrost etapu odpala „pyknięcie” (squash & stretch). */
  private readonly stages: number[];
  private first = true;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly count: number,
  ) {
    this.layer = scene.add.spriteGPULayer(SPRITES_KEY, count * 2).setDepth(10).setLighting(true);
    // Animacje włączone z góry – bez rekompilacji shadera w trakcie gry.
    this.layer.setAnimationEnabled('Sine.easeInOut', true);
    for (let i = 0; i < count * 2; i++) this.layer.addMember({ frame: 'icon_ready', scaleX: 0, scaleY: 0, alpha: 0 });
    this.keys = new Array<string>(count * 2).fill('');
    this.stages = new Array<number>(count).fill(-1);
  }

  /**
   * Animacja „aktorska” na zwykłym obrazku nad ukrytym członkiem warstwy GPU: przysiad, wyskok z rozciągnięciem,
   * sprężyste lądowanie. Warstwa GPU obsługuje tylko pętle, więc jednorazowe ruchy robimy tweenami.
   */
  private pop(i: number, key: string, member: Parameters<Phaser.GameObjects.SpriteGPULayer['editMember']>[1], frame: string, x: number, y: number): void {
    this.layer.editMember(i, { ...member, alpha: 0 });
    const s = 1.15;
    const img = this.scene.add.image(x, y, SPRITES_KEY, frame).setOrigin(0.5, 0.72).setScale(s * 1.25, s * 0.55).setDepth(11).setLighting(true);
    this.scene.tweens.chain({
      targets: img,
      tweens: [
        { scaleX: s * 0.85, scaleY: s * 1.22, duration: 140, ease: 'Quad.easeOut' },
        { scaleX: s * 1.08, scaleY: s * 0.92, duration: 120, ease: 'Quad.easeInOut' },
        { scaleX: s, scaleY: s, duration: 220, ease: 'Back.easeOut' },
      ],
      onComplete: () => {
        img.destroy();
        if (this.keys[i] === key) this.layer.editMember(i, member);
      },
    });
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
        const key = `${crop.id}:${stage}:${motion}`;
        const member = {
          x,
          y,
          frame: cropFrame(crop.id, stage),
          originY: 0.72,
          scaleX: 1.15,
          scaleY: ripe && motion ? { base: 1.15, amplitude: 0.08, duration: 650, ease: 'Sine.easeInOut', yoyo: true } : 1.15,
        };
        const grew = !this.first && motion && stage < 4 && stage > this.stages[i]! && this.keys[i] !== key;
        if (grew) {
          this.keys[i] = key;
          this.pop(i, key, member, member.frame, x, y);
        } else this.set(i, key, member);
      }
      this.stages[i] = crop ? (crop.withered ? 4 : cropStage(crop)) : -1;

      let icon: string | null = null;
      if (!plot.unlocked && canUnlock(state, i)) icon = 'icon_lock';
      else if (crop && !crop.withered && crop.growth < 1 && plot.moisture <= 0.05) icon = 'icon_drop';
      else if (isReady(crop)) icon = 'icon_ready';
      const m = this.count + i;
      if (!icon) this.set(m, '', null);
      else if (icon === 'icon_lock') this.set(m, `${icon}`, { x, y: y - 16, frame: icon, scaleX: 0.55, scaleY: 0.55, alpha: 0.7 });
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
    this.first = false;
  }
}
