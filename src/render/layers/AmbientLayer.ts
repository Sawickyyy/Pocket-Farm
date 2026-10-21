// Magia w świecie: świetliki nocą, motyle w dzień, płatki wiosną, liście jesienią, iskierki nad dojrzałymi plonami.
// Wszystko na SpriteGPULayer z zapętlonymi animacjami – shader liczy ruch, CPU zmienia tylko krycie warstw.

import type Phaser from 'phaser';
import type { Calendar, GameState } from '../../sim/types';
import { isReady } from '../../sim/systems/fields';
import { FARM, plotTile } from '../../sim/world';
import { SPRITES_KEY } from '../art/atlas';
import { project } from '../iso';
import { rng } from '../art/draw';

type Anim = Phaser.Types.GameObjects.SpriteGPULayer.MemberAnimation;

export class AmbientLayer {
  private readonly fireflies: Phaser.GameObjects.SpriteGPULayer;
  private readonly butterflies: Phaser.GameObjects.SpriteGPULayer;
  private readonly petals: Phaser.GameObjects.SpriteGPULayer;
  private readonly leaves: Phaser.GameObjects.SpriteGPULayer;
  private readonly sparkles: Phaser.GameObjects.SpriteGPULayer;
  private sparkleKey = '';

  constructor(scene: Phaser.Scene, seed: number) {
    const make = (n: number, depth: number) => {
      const l = scene.add.spriteGPULayer(SPRITES_KEY, n).setDepth(depth);
      l.setAnimationEnabled('Sine.easeInOut', true);
      l.setAnimationEnabled('Linear', true);
      return l;
    };
    this.fireflies = make(36, 45);
    this.butterflies = make(14, 45);
    this.petals = make(40, 46);
    this.leaves = make(40, 46);
    this.sparkles = make(48, 15);
    const r = rng(seed ^ 0xa11ce);
    const spot = (margin = 2) => project(FARM.x - margin + r() * (FARM.w + margin * 2), FARM.y - margin + r() * (FARM.h + margin * 2));
    const wave = (base: number, amp: number, dur: number): Anim => ({ base, amplitude: amp, duration: dur, ease: 'Sine.easeInOut', yoyo: true, delay: r() * dur });

    for (let i = 0; i < 36; i++) {
      const p = spot();
      this.fireflies.addMember({
        frame: 'p_firefly',
        x: wave(p.x, 60 + r() * 80, 2600 + r() * 2400),
        y: wave(p.y - 40, 30 + r() * 40, 1900 + r() * 1800),
        alpha: wave(0.15, 0.85, 700 + r() * 900),
        scaleX: 1.6,
        scaleY: 1.6,
      });
    }
    for (let i = 0; i < 14; i++) {
      const p = spot(0);
      this.butterflies.addMember({
        frame: 'p_butterfly',
        x: wave(p.x, 120 + r() * 120, 4000 + r() * 3000),
        y: wave(p.y - 70, 50 + r() * 40, 2500 + r() * 1500),
        // trzepot skrzydeł: szybkie „spłaszczanie” w poziomie
        scaleX: { base: 1.6, amplitude: -1.1, duration: 140 + r() * 60, ease: 'Sine.easeInOut', yoyo: true },
        scaleY: 1.6,
      });
    }
    // Spadające płatki/liście: ruch liniowy w pętli, krycie wznosi się i opada w tym samym cyklu.
    const falling = (layer: Phaser.GameObjects.SpriteGPULayer, frame: string) => {
      for (let i = 0; i < 40; i++) {
        const p = spot(4);
        const dur = 5000 + r() * 4000;
        const delay = r() * dur;
        layer.addMember({
          frame,
          x: { base: p.x, amplitude: -160 - r() * 120, duration: dur, ease: 'Linear', yoyo: false, delay },
          y: { base: p.y - 500, amplitude: 520, duration: dur, ease: 'Linear', yoyo: false, delay },
          rotation: { base: r() * 6, amplitude: 6, duration: dur, ease: 'Linear', yoyo: false, delay },
          alpha: { base: 0, amplitude: 1, duration: dur / 2, ease: 'Sine.easeInOut', yoyo: true, delay },
          scaleX: 1.5,
          scaleY: 1.5,
        });
      }
    };
    falling(this.petals, 'p_petal');
    falling(this.leaves, 'p_autumn');
  }

  /** Krycie warstw wg pory dnia, sezonu i pogody (wywoływane co klatkę – tylko zmiana alfy). */
  update(cal: Calendar, night: number, enabled: boolean): void {
    const dry = cal.weather !== 'rain' && cal.weather !== 'snow';
    const on = enabled ? 1 : 0;
    this.fireflies.setAlpha(on * night * (cal.season === 'winter' ? 0.3 : 1) * (dry ? 1 : 0.3));
    this.butterflies.setAlpha(on * (1 - night) * (cal.season === 'spring' || cal.season === 'summer' ? 1 : 0) * (dry ? 1 : 0));
    this.petals.setAlpha(on * (cal.season === 'spring' ? 0.9 : 0));
    this.leaves.setAlpha(on * (cal.season === 'autumn' ? 0.9 : 0));
    this.sparkles.setAlpha(on);
  }

  /** Iskierki nad dojrzałymi plonami. */
  sync(state: GameState, motion: boolean): void {
    const ready = state.plots.map((p, i) => (isReady(p.crop) ? i : -1)).filter((i) => i >= 0);
    const key = `${ready.join(',')}|${motion}`;
    if (key === this.sparkleKey) return;
    this.sparkleKey = key;
    if (this.sparkles.memberCount) this.sparkles.removeMembers(0, this.sparkles.memberCount);
    if (!motion) return;
    for (const i of ready) {
      const t = plotTile(i);
      const p = project(t.x + 0.5, t.y + 0.5);
      for (let k = 0; k < 2; k++) {
        this.sparkles.addMember({
          frame: 'p_sparkle',
          x: p.x - 30 + k * 50,
          y: { base: p.y - 60 - k * 20, amplitude: -18, duration: 900 + k * 300, ease: 'Sine.easeInOut', yoyo: true },
          alpha: { base: 0, amplitude: 1, duration: 600 + k * 250, ease: 'Sine.easeInOut', yoyo: true, delay: k * 400 },
          scaleX: 1.2,
          scaleY: 1.2,
        });
      }
    }
  }
}
