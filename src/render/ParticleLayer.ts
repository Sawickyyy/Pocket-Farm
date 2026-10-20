import type Phaser from 'phaser';
import type { ParticleFrame } from './proceduralArt';

const CAPACITY = 160;
const LIFE_MS = 650;

/**
 * Cząsteczki na SpriteGPULayer: ruch liczy shader (animacje Linear/Gravity),
 * CPU tylko zapisuje członka do bufora przy emisji i chowa go po czasie życia.
 */
export class ParticleLayer {
  private readonly layer: Phaser.GameObjects.SpriteGPULayer;
  private next = 0;
  private readonly expiry = new Float64Array(CAPACITY);
  private live = 0;

  constructor(private readonly scene: Phaser.Scene, textureKey: string) {
    this.layer = scene.add.spriteGPULayer(textureKey, CAPACITY).setDepth(20);
    this.layer.gravity = 1800;
    this.layer.setAnimationEnabled('Linear', true);
    this.layer.setAnimationEnabled('Gravity', true);
    for (let i = 0; i < CAPACITY; i++) this.layer.addMember({ frame: 'p_dirt', scaleX: 0, scaleY: 0, alpha: 0 });
  }

  emit(x: number, y: number, frame: ParticleFrame, count: number): void {
    const now = this.scene.time.now;
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % CAPACITY;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const speed = 380 + Math.random() * 420;
      const scale = 1.2 + Math.random() * 1.1;
      this.layer.editMember(i, {
        frame,
        x: { base: x + (Math.random() - 0.5) * 40, amplitude: Math.cos(angle) * speed * 0.5, duration: LIFE_MS, ease: 'Linear', loop: false },
        y: { base: y, ease: 'Gravity', velocity: Math.round(Math.sin(angle) * speed), duration: LIFE_MS, loop: false },
        rotation: { base: Math.random() * 6, amplitude: (Math.random() - 0.5) * 8, duration: LIFE_MS, ease: 'Linear', loop: false },
        scaleX: scale,
        scaleY: scale,
        alpha: { base: 1, amplitude: -0.9, duration: LIFE_MS, ease: 'Linear', loop: false },
      });
      if (this.expiry[i] === 0) this.live++;
      this.expiry[i] = now + LIFE_MS;
    }
  }

  /** Chowa wygasłe cząsteczki (żeby animacje „continuous” nie leciały w nieskończoność). */
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
