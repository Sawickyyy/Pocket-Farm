import type Phaser from 'phaser';
import { SPRITES_KEY, type ParticleFrame } from './art/atlas';

const CAPACITY = 280;
/** Osobna, mniejsza pula cząsteczek świecących (mieszanie addytywne). */
const GLOW_CAPACITY = 96;
const LIFE_MS = 700;
/** Phaser.BlendModes (bez importu Phasera w czasie działania – helpery są testowane w Node). */
const BLEND_NORMAL = 0;
const BLEND_ADD = 1;

/** Cząsteczki osady rysowane przez moduł postaci (residents.ts): płomyk i iskra – świecą (blend ADD). */
export type TownParticle = 'p_fire' | 'p_ember';
export type AnyParticle = ParticleFrame | TownParticle;

/** Klatki rysowane w puli addytywnej (światło dodaje się do tła – płomienie „świecą” także nocą). */
export const GLOW_PARTICLES: ReadonlySet<string> = new Set<TownParticle>(['p_fire', 'p_ember']);
export const isGlowParticle = (frame: string): boolean => GLOW_PARTICLES.has(frame);

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

/** Pula członków jednej SpriteGPULayer z czasem wygaśnięcia każdego slotu. */
class Pool {
  readonly layer: Phaser.GameObjects.SpriteGPULayer;
  next = 0;
  live = 0;
  readonly expiry: Float64Array;

  constructor(
    scene: Phaser.Scene,
    readonly capacity: number,
    depth: number,
    blend: number,
  ) {
    this.expiry = new Float64Array(capacity);
    this.layer = scene.add.spriteGPULayer(SPRITES_KEY, capacity).setDepth(depth).setBlendMode(blend);
    this.layer.gravity = 1800;
    this.layer.setAnimationEnabled('Linear', true);
    this.layer.setAnimationEnabled('Gravity', true);
    for (let i = 0; i < capacity; i++) this.layer.addMember({ frame: 'p_dirt', scaleX: 0, scaleY: 0, alpha: 0 });
  }

  update(now: number): void {
    if (this.live === 0) return;
    for (let i = 0; i < this.capacity; i++) {
      const t = this.expiry[i] ?? 0;
      if (t !== 0 && t <= now) {
        this.expiry[i] = 0;
        this.live--;
        this.layer.editMember(i, { frame: 'p_dirt', scaleX: 0, scaleY: 0, alpha: 0 });
      }
    }
  }
}

/**
 * Cząsteczki na SpriteGPULayer: ruch liczy shader (animacje Linear/Gravity, bez CPU na klatkę),
 * CPU tylko zapisuje członka do bufora przy emisji i chowa go po czasie życia.
 * Używamy wyłącznie animacji „ciągłych” (Linear/Gravity z loop:false) – są liniowe w czasie.
 * Płomienie i iskry idą do osobnej puli z mieszaniem addytywnym (świecą), reszta – zwykłej.
 */
export class ParticleLayer {
  private readonly normal: Pool;
  private readonly glow: Pool;
  private readonly known = new Map<string, boolean>();

  constructor(private readonly scene: Phaser.Scene) {
    this.normal = new Pool(scene, CAPACITY, 50, BLEND_NORMAL);
    this.glow = new Pool(scene, GLOW_CAPACITY, 51, BLEND_ADD);
  }

  /** Liczba żywych cząsteczek (do ograniczania efektów ciągłych). */
  get alive(): number {
    return this.normal.live + this.glow.live;
  }

  /** Liczba żywych cząsteczek świecących (ogień ma własny limit). */
  get aliveGlow(): number {
    return this.glow.live;
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
    // Klatka spoza atlasu (np. moduł postaci jeszcze jej nie rysuje) – efekt pomijamy zamiast błędu bufora.
    if (!this.has(frame)) return;
    const pool = isGlowParticle(frame) ? this.glow : this.normal;
    const now = this.scene.time.now;
    const life = opts.life ?? LIFE_MS;
    const tint = opts.tint;
    const alpha = opts.alpha ?? 1;
    const spread = opts.spread ?? 2.4;
    const jitter = opts.jitter ?? 40;
    for (let n = 0; n < count; n++) {
      const i = pool.next;
      pool.next = (pool.next + 1) % pool.capacity;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
      const speed = (opts.speed ?? 600) * (0.6 + Math.random() * 0.7);
      const scale = (opts.scale ?? 1.6) * (0.8 + Math.random() * 0.6);
      const grow = opts.grow ? { base: scale, amplitude: opts.grow * scale, duration: life, ease: 'Linear', loop: false } : scale;
      pool.layer.editMember(i, {
        frame,
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
      if (pool.expiry[i] === 0) pool.live++;
      pool.expiry[i] = now + life;
    }
  }

  update(): void {
    const now = this.scene.time.now;
    this.normal.update(now);
    this.glow.update(now);
  }
}
