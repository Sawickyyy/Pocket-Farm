import type Phaser from 'phaser';
import { SPRITES_KEY, type ParticleFrame } from './art/atlas';

const CAPACITY = 280;
const LIFE_MS = 700;

/** Cząsteczki osady rysowane przez moduł postaci (residents.ts) – do czasu ich narysowania zastępstwo z atlasu. */
export type TownParticle = 'p_fire' | 'p_ember';
export type AnyParticle = ParticleFrame | TownParticle;

/** Zastępcza klatka (z kolorem) dla cząsteczki, której nie ma jeszcze w atlasie. */
export const PARTICLE_FALLBACK: Readonly<Record<TownParticle, { frame: ParticleFrame; tint: number }>> = {
  p_fire: { frame: 'p_sparkle', tint: 0xff8a2a },
  p_ember: { frame: 'p_firefly', tint: 0xff6a1f },
};

/**
 * Pula „żetonów” efektów: każdy efekt zabiera żeton, żetony wracają co `refillMs` (do `max`).
 * Seria zdarzeń (np. nadrabianie offline) gra kilka efektów, a resztę pomija.
 */
export class FxBudget {
  private tokens: number;
  private last = -Infinity;

  constructor(
    private readonly max: number,
    private readonly refillMs: number,
  ) {
    this.tokens = max;
  }

  take(now: number): boolean {
    if (this.last === -Infinity) this.last = now;
    const back = Math.floor((now - this.last) / this.refillMs);
    if (back > 0) {
      this.tokens = Math.min(this.max, this.tokens + back);
      this.last += back * this.refillMs;
    }
    if (this.tokens >= this.max) this.last = now;
    if (this.tokens <= 0) return false;
    this.tokens--;
    return true;
  }
}

export interface EmitOptions {
  speed?: number;
  /** Dodatkowa prędkość w górę (px/s). */
  up?: number;
  life?: number;
  scale?: number;
  /** Mnożnik grawitacji warstwy (-1..1); ujemny = cząsteczka unosi się (ogień, dym). */
  gravity?: number;
  /** Rozrzut kierunku wokół pionu (radiany, domyślnie 2,4). */
  spread?: number;
  /** Rozrzut miejsca startu w poziomie (px, domyślnie 40). */
  jitter?: number;
  /** Przyrost skali w czasie życia (dym rośnie). */
  grow?: number;
  /** Kolor (mnożony) – np. para wodna, kurz. */
  tint?: number;
  /** Bez obrotu (płomienie, dym). */
  still?: boolean;
  /** Krycie na starcie (domyślnie 1; zanika do ~0). */
  alpha?: number;
}

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
  private readonly known = new Map<string, boolean>();

  constructor(private readonly scene: Phaser.Scene) {
    this.layer = scene.add.spriteGPULayer(SPRITES_KEY, CAPACITY).setDepth(50);
    this.layer.gravity = 1800;
    this.layer.setAnimationEnabled('Linear', true);
    this.layer.setAnimationEnabled('Gravity', true);
    for (let i = 0; i < CAPACITY; i++) this.layer.addMember({ frame: 'p_dirt', scaleX: 0, scaleY: 0, alpha: 0 });
  }

  /** Liczba żywych cząsteczek (do ograniczania efektów ciągłych). */
  get alive(): number {
    return this.live;
  }

  private has(frame: string): boolean {
    let ok = this.known.get(frame);
    if (ok === undefined) {
      ok = this.scene.textures.get(SPRITES_KEY).has(frame);
      this.known.set(frame, ok);
    }
    return ok;
  }

  emit(x: number, y: number, frame: AnyParticle, count: number, opts: EmitOptions = {}): void {
    const now = this.scene.time.now;
    const life = opts.life ?? LIFE_MS;
    let name: string = frame;
    let tint = opts.tint;
    if (!this.has(name)) {
      const fb = PARTICLE_FALLBACK[frame as TownParticle];
      if (!fb) return;
      name = fb.frame;
      tint ??= fb.tint;
    }
    const alpha = opts.alpha ?? 1;
    const spread = opts.spread ?? 2.4;
    const jitter = opts.jitter ?? 40;
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % CAPACITY;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
      const speed = (opts.speed ?? 600) * (0.6 + Math.random() * 0.7);
      const scale = (opts.scale ?? 1.6) * (0.8 + Math.random() * 0.6);
      const grow = opts.grow ? { base: scale, amplitude: opts.grow * scale, duration: life, ease: 'Linear', loop: false } : scale;
      this.layer.editMember(i, {
        frame: name,
        x: { base: x + (Math.random() - 0.5) * jitter, amplitude: Math.cos(angle) * speed * 0.5, duration: life, ease: 'Linear', loop: false },
        y: { base: y, ease: 'Gravity', velocity: Math.round(Math.sin(angle) * speed - (opts.up ?? 0)), gravityFactor: opts.gravity ?? 1, duration: life, loop: false },
        rotation: opts.still ? 0 : { base: Math.random() * 6, amplitude: (Math.random() - 0.5) * 8, duration: life, ease: 'Linear', loop: false },
        scaleX: grow,
        scaleY: grow,
        alpha: { base: alpha, amplitude: 0.05 - alpha, duration: life, ease: 'Linear', loop: false },
        tintTopLeft: tint ?? 0xffffff,
        tintTopRight: tint ?? 0xffffff,
        tintBottomLeft: tint ?? 0xffffff,
        tintBottomRight: tint ?? 0xffffff,
        tintBlend: tint === undefined ? 0 : 1,
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
