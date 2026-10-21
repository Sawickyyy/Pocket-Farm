import type Phaser from 'phaser';
import { SPRITES_KEY, type ParticleFrame } from './art/atlas';

const CAPACITY = 240;
const LIFE_MS = 700;

/**
 * Cząsteczki na SpriteGPULayer: ruch liczy shader (animacje Linear/Gravity, bez CPU na klatkę),
 * CPU tylko zapisuje członka do bufora przy emisji i chowa go po czasie życia.
 * Używamy wyłącznie animacji „ciągłych” (Linear/Gravity z loop:false) – są liniowe w czasie.
 */
export class ParticleLayer {
  private readonly layer: Phaser.GameObjects.SpriteGPULayer;
  private next = 0;
  private readonly expiry = new Float64Array(CAPACITY);
  private live = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.layer = scene.add.spriteGPULayer(SPRITES_KEY, CAPACITY).setDepth(50);
    this.layer.gravity = 1800;
    this.layer.setAnimationEnabled('Linear', true);
    this.layer.setAnimationEnabled('Gravity', true);
    for (let i = 0; i < CAPACITY; i++) this.layer.addMember({ frame: 'p_dirt', scaleX: 0, scaleY: 0, alpha: 0 });
  }

  emit(x: number, y: number, frame: ParticleFrame, count: number, opts: { speed?: number; up?: number; life?: number; scale?: number } = {}): void {
    const now = this.scene.time.now;
    const life = opts.life ?? LIFE_MS;
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % CAPACITY;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const speed = (opts.speed ?? 600) * (0.6 + Math.random() * 0.7);
      const scale = (opts.scale ?? 1.6) * (0.8 + Math.random() * 0.6);
      this.layer.editMember(i, {
        frame,
        x: { base: x + (Math.random() - 0.5) * 40, amplitude: Math.cos(angle) * speed * 0.5, duration: life, ease: 'Linear', loop: false },
        y: { base: y, ease: 'Gravity', velocity: Math.round(Math.sin(angle) * speed - (opts.up ?? 0)), duration: life, loop: false },
        rotation: { base: Math.random() * 6, amplitude: (Math.random() - 0.5) * 8, duration: life, ease: 'Linear', loop: false },
        scaleX: scale,
        scaleY: scale,
        alpha: { base: 1, amplitude: -0.95, duration: life, ease: 'Linear', loop: false },
      });
      if (this.expiry[i] === 0) this.live++;
      this.expiry[i] = now + life;
    }
  }

  update(): void {
    if (this.live === 0) return;
    const now = this.scene.time.now;
    for (let i = 0; i < CAPACITY; i++) {
      const t = this.expiry[i] ?? 0;
      if (t !== 0 && t <= now) {
        this.expiry[i] = 0;
        this.live--;
        this.layer.editMember(i, { frame: 'p_dirt', scaleX: 0, scaleY: 0, alpha: 0 });
      }
    }
  }
}
