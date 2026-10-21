// Zwierzęta jako zwykłe sprite'y (jest ich kilka): spacer po wybiegu przed budynkiem, ikony potrzeb.

import Phaser from 'phaser';
import type { Content } from '../../content/content';
import type { Animal, GameState } from '../../sim/types';
import { SPRITES_KEY, TILE, animalFrame } from '../art/atlas';

interface View {
  sprite: Phaser.GameObjects.Sprite;
  badge: Phaser.GameObjects.Image;
  home: number;
  kind: string;
  nextMove: number;
  walking: boolean;
}

export class AnimalLayer {
  private readonly views = new Map<number, View>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly content: Content,
    private readonly motion: () => boolean,
  ) {}

  private yard(state: GameState, a: Animal) {
    const home = state.objects.find((o) => o.uid === a.home);
    const def = home && this.content.buildings[home.type];
    if (!home || !def) return null;
    const [w, h] = def.size;
    return { x0: home.x * TILE + 30, x1: (home.x + w) * TILE - 30, y0: (home.y + h) * TILE + 20, y1: (home.y + h + 1) * TILE - 10 };
  }

  sync(state: GameState): void {
    const alive = new Set<number>();
    for (const a of state.animals) {
      alive.add(a.id);
      const yard = this.yard(state, a);
      if (!yard) continue;
      let v = this.views.get(a.id);
      if (!v || v.home !== a.home) {
        v?.sprite.destroy();
        v?.badge.destroy();
        const x = Phaser.Math.Between(yard.x0, yard.x1);
        const y = Phaser.Math.Between(yard.y0, yard.y1);
        const scale = a.kind === 'chicken' ? 0.65 : 0.9;
        const sprite = this.scene.add.sprite(x, y, SPRITES_KEY, animalFrame(a.kind, 0)).setScale(scale).setDepth(25).setLighting(true);
        sprite.setData('animal', a.id);
        const badge = this.scene.add.image(x, y - 70, SPRITES_KEY, 'icon_ready').setScale(0.4).setDepth(26).setVisible(false);
        v = { sprite, badge, home: a.home, kind: a.kind, nextMove: 0, walking: false };
        this.views.set(a.id, v);
      }
      const icon = a.ready ? 'icon_ready' : a.hunger < 0.15 ? 'icon_bowl' : null;
      v.badge.setVisible(!!icon);
      if (icon) v.badge.setFrame(icon);
    }
    for (const [id, v] of this.views) {
      if (!alive.has(id)) {
        v.sprite.destroy();
        v.badge.destroy();
        this.views.delete(id);
      }
    }
  }

  update(time: number, state: GameState): void {
    for (const [id, v] of this.views) {
      v.badge.setPosition(v.sprite.x, v.sprite.y - 70 * v.sprite.scaleY);
      if (time < v.nextMove || v.walking) continue;
      const a = state.animals.find((x) => x.id === id);
      const yard = a && this.yard(state, a);
      if (!yard) continue;
      v.nextMove = time + Phaser.Math.Between(2000, 5000);
      if (!this.motion()) continue;
      const tx = Phaser.Math.Between(yard.x0, yard.x1);
      const ty = Phaser.Math.Between(yard.y0, yard.y1);
      const dist = Phaser.Math.Distance.Between(v.sprite.x, v.sprite.y, tx, ty);
      v.sprite.setFlipX(tx < v.sprite.x);
      v.walking = true;
      let frame = 0;
      const stepper = this.scene.time.addEvent({
        delay: 180,
        loop: true,
        callback: () => v.sprite.setFrame(animalFrame(v.kind, (frame = 1 - frame))),
      });
      this.scene.tweens.add({
        targets: v.sprite,
        x: tx,
        y: ty,
        duration: dist * 9,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          stepper.remove();
          v.sprite.setFrame(animalFrame(v.kind, 0));
          v.walking = false;
        },
      });
    }
  }

  /** Zwierzę pod punktem świata (dotknięcie). */
  hit(wx: number, wy: number): number | null {
    for (const [id, v] of this.views) if (v.sprite.getBounds().contains(wx, wy)) return id;
    return null;
  }

  positionOf(id: number): { x: number; y: number } | null {
    const v = this.views.get(id);
    return v ? { x: v.sprite.x, y: v.sprite.y } : null;
  }

  hop(id: number): void {
    const v = this.views.get(id);
    if (!v || !this.motion()) return;
    this.scene.tweens.add({ targets: v.sprite, y: v.sprite.y - 24, duration: 140, yoyo: true, ease: 'Quad.easeOut' });
  }
}
