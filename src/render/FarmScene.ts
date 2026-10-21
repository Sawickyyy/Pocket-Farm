// Scena Phasera: składa warstwy, synchronizuje je ze stanem symulacji, steruje kamerą, światłem i efektami.

import Phaser from 'phaser';
import { CONTENT, parseKey } from '../content/content';
import type { Store } from '../core/store';
import { DAY_MS, HOUR_MS, calendarAt, daylight } from '../sim/calendar';
import type { SimEvent } from '../sim/events';
import { PLOT_COUNT } from '../sim/initialState';
import type { GameState } from '../sim/types';
import { CHUNK, CHUNKS_X, FIELD, generateWorld, plotTile, type WorldMap } from '../sim/world';
import { SPRITES_KEY, TILE, TILES_KEY, buildingFrame, cropFrame, drawSpriteAtlas, drawTileset, itemFrame, type ParticleFrame } from './art/atlas';
import { CameraModel, type Viewport } from './cameraModel';
import { buildingPlacement, project, projectedBounds, unproject } from './iso';
import { colorMatrix20, type ColorblindMode } from './colorblind';
import { AmbientLayer } from './layers/AmbientLayer';
import { AnimalLayer } from './layers/AnimalLayer';
import { VillagerLayer } from './layers/VillagerLayer';
import { FogLayer } from './layers/FogLayer';
import { GroundLayer } from './layers/GroundLayer';
import { Lighting } from './layers/Lighting';
import { ObjectLayer } from './layers/ObjectLayer';
import { PlantLayer } from './layers/PlantLayer';
import { ParticleLayer } from './ParticleLayer';

export interface SceneDeps {
  store: Store<GameState>;
  reducedMotion: () => boolean;
  /** Pozycja licznika monet na ekranie (px CSS) – cel „lecących” plonów. */
  hudTarget: () => { x: number; y: number } | null;
  dpr: () => number;
  onReady: (scene: FarmScene) => void;
}

export interface Ghost {
  type: string;
  x: number;
  y: number;
  valid: boolean;
}

const SYNC_MS = 120;

export class FarmScene extends Phaser.Scene {
  private deps!: SceneDeps;
  private world!: WorldMap;
  private ground!: GroundLayer;
  private plants!: PlantLayer;
  private objects!: ObjectLayer;
  private fog!: FogLayer;
  private animals!: AnimalLayer;
  private lighting!: Lighting;
  private particles!: ParticleLayer;
  private ambient!: AmbientLayer;
  private villagers!: VillagerLayer;
  private vignette: Phaser.Filters.Vignette | null = null;
  private fx = true;
  private highlight!: Phaser.GameObjects.Graphics;
  private tutorialPulse!: Phaser.GameObjects.Graphics;
  private ghostImage!: Phaser.GameObjects.Image;
  private ghostRect!: Phaser.GameObjects.Graphics;
  private colorFilter: Phaser.Filters.ColorMatrix | null = null;
  private lastState: GameState | null = null;
  private lastSync = 0;
  cam!: CameraModel;

  constructor() {
    super({ key: 'farm' });
  }

  init(deps: SceneDeps): void {
    this.deps = deps;
  }

  create(): void {
    const state = this.deps.store.get();
    this.world = generateWorld(state.seed);
    this.createTextures();

    this.ground = new GroundLayer(this, this.world, CONTENT);
    this.plants = new PlantLayer(this, PLOT_COUNT);
    this.objects = new ObjectLayer(this, this.world, CONTENT);
    this.animals = new AnimalLayer(this, CONTENT, () => !this.deps.reducedMotion());
    this.villagers = new VillagerLayer(this, CONTENT, () => !this.deps.reducedMotion());
    this.fog = new FogLayer(this);
    this.particles = new ParticleLayer(this);
    this.ambient = new AmbientLayer(this, state.seed);
    this.lighting = new Lighting(this, CONTENT);

    // Podświetlenie dotkniętego pola – jedyny obiekt z filtrem glow (filtry są kosztowne).
    // Nakładki leżące na ziemi siedzą w kontenerze izometrycznym – rysujemy je jak kwadraty kafli.
    this.highlight = this.add.graphics().setVisible(false);
    this.highlight.lineStyle(10, 0xfff3b0, 1).strokeRoundedRect(4, 4, TILE - 8, TILE - 8, 18);
    this.highlight.enableFilters();
    this.highlight.filters?.internal.addGlow(0xffe27a, 6, 0, 1);

    this.tutorialPulse = this.add.graphics().setVisible(false);
    this.tutorialPulse.lineStyle(12, 0x7dd3fc, 1).strokeRoundedRect(0, 0, TILE, TILE, 20);

    this.ghostRect = this.add.graphics().setVisible(false);
    this.ground.flat.add([this.highlight, this.tutorialPulse, this.ghostRect]);
    this.ghostImage = this.add.image(0, 0, SPRITES_KEY, 'icon_ready').setOrigin(0.5, 1).setAlpha(0.8).setDepth(71).setVisible(false);

    this.cam = new CameraModel(projectedBounds(FIELD.x, FIELD.y, FIELD.w, FIELD.h), this.boundsFor(state), 0.3, 2.2, 1.35);
    // Pastelowe tło za krawędzią mapy (romb świata nie wypełnia prostokąta ekranu).
    this.cameras.main.setBackgroundColor('#a8dcc4');
    this.cameras.main.setRoundPixels(false);

    this.syncAll(state, true);
    this.deps.onReady(this);
  }

  // ------------------------------------------------------------- tekstury

  private createTextures(): void {
    if (!this.textures.exists(TILES_KEY)) this.textures.addCanvas(TILES_KEY, drawTileset());
    if (!this.textures.exists(SPRITES_KEY)) {
      const { canvas, frames } = drawSpriteAtlas(CONTENT);
      const tex = this.textures.addCanvas(SPRITES_KEY, canvas);
      for (const f of frames) tex?.add(f.name, 0, f.x, f.y, f.w, f.h);
    }
  }

  // ------------------------------------------------------------- pętla

  override update(time: number, delta: number): void {
    const state = this.deps.store.get();
    if (state !== this.lastState && time - this.lastSync > SYNC_MS) this.syncAll(state, false);
    const clock = state.clock;
    const hour = ((clock.simMs + clock.accMs) % DAY_MS) / HOUR_MS;
    const cal = calendarAt(clock.simMs, state.seed);
    this.lighting.update(hour, cal);
    this.ambient.update(cal, 1 - daylight(hour), this.fx && !this.deps.reducedMotion());
    this.animals.update(time, state);
    this.villagers.update(time, delta, cal);
    this.particles.update();
    if (this.cam.update(delta)) this.applyCamera();
  }

  private syncAll(state: GameState, force: boolean): void {
    const prev = this.lastState;
    this.lastState = state;
    this.lastSync = this.time.now;
    const cal = calendarAt(state.clock.simMs, state.seed);
    const motion = !this.deps.reducedMotion();
    this.ground.sync(state, cal);
    this.plants.sync(state, motion);
    this.objects.sync(state, cal);
    this.fog.sync(state, motion);
    this.animals.sync(state);
    this.ambient.sync(state, motion);
    if (force || !prev || prev.objects !== state.objects || prev.plots !== state.plots) this.lighting.sync(state);
    if (force || !prev || prev.world.revealed.length !== state.world.revealed.length) this.cam.bounds = this.boundsFor(state);
  }

  /** Granice kamery: prostokąt otaczający rzut odkrytych fragmentów (z marginesem). */
  private boundsFor(state: GameState) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const c of state.world.revealed) {
      const r = projectedBounds((c % CHUNKS_X) * CHUNK, Math.floor(c / CHUNKS_X) * CHUNK, CHUNK, CHUNK);
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
    }
    const pad = 300;
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  }

  // ------------------------------------------------------------- kamera i trafienia

  setViewport(v: Viewport): void {
    this.cameras.main.setSize(v.width, v.height);
    this.cam.setViewport(v, Math.min(v.width, v.height) * 0.04);
    this.applyCamera();
  }

  applyCamera(): void {
    const c = this.cameras.main;
    c.setZoom(this.cam.zoom);
    c.centerOn(this.cam.centerX, this.cam.centerY);
  }

  /** Piksele urządzenia → świat. */
  worldAt(sx: number, sy: number): { x: number; y: number } {
    return this.cam.toWorld(sx, sy);
  }

  tileAt(sx: number, sy: number): { x: number; y: number } {
    const w = this.worldAt(sx, sy);
    const t = unproject(w.x, w.y);
    return { x: Math.floor(t.x), y: Math.floor(t.y) };
  }

  /** Budynek pod palcem (trafienie w cały sprite bryły, nie tylko w podstawę). */
  objectAt(sx: number, sy: number): number | null {
    const w = this.worldAt(sx, sy);
    return this.objects.hit(w.x, w.y);
  }

  /** Kafel (ciągły) → piksele urządzenia na ekranie (np. do dźwięku przestrzennego). */
  screenOfTile(at: { x: number; y: number }): { x: number; y: number } {
    const p = project(at.x, at.y);
    return this.cam.toScreen(p.x, p.y);
  }

  /** Mieszkaniec albo jego dom pod punktem ekranu → id postaci (dotknięcie postaci ją wita). */
  villagerAt(sx: number, sy: number): string | null {
    const w = this.worldAt(sx, sy);
    const npc = this.villagers.hit(w.x, w.y);
    if (npc) {
      const at = this.villagers.greet(npc, this.time.now);
      if (at) this.floatText(at, '♥', '#ff8fb1');
      return npc;
    }
    return this.objects.houseAt(w.x, w.y);
  }

  animalAt(sx: number, sy: number): number | null {
    const w = this.worldAt(sx, sy);
    return this.animals.hit(w.x, w.y);
  }

  focusTile(x: number, y: number): void {
    const p = project(x + 0.5, y + 0.5);
    this.cam.focusOn(p.x, p.y, Math.max(this.cam.zoom, this.cam.fitZoom * 0.8));
  }

  // ------------------------------------------------------------- nakładki

  showHighlight(tile: { x: number; y: number } | null): void {
    if (!tile) {
      this.highlight.setVisible(false);
      return;
    }
    this.highlight.setPosition(tile.x * TILE, tile.y * TILE).setVisible(true);
  }

  setTutorialTarget(plot: number | null): void {
    this.tweens.killTweensOf(this.tutorialPulse);
    if (plot === null) {
      this.tutorialPulse.setVisible(false);
      return;
    }
    const t = plotTile(plot);
    this.tutorialPulse.setPosition(t.x * TILE, t.y * TILE).setVisible(true).setAlpha(1);
    if (!this.deps.reducedMotion()) this.tweens.add({ targets: this.tutorialPulse, alpha: 0.25, duration: 700, yoyo: true, repeat: -1 });
  }

  setGhost(g: Ghost | null): void {
    if (!g) {
      this.ghostImage.setVisible(false);
      this.ghostRect.setVisible(false);
      return;
    }
    const def = CONTENT.buildings[g.type];
    if (!def) return;
    const [w, h] = def.size;
    const color = g.valid ? 0x7dff8a : 0xff6b6b;
    this.ghostRect.clear().fillStyle(color, 0.3).fillRect(0, 0, w * TILE, h * TILE).lineStyle(8, color, 0.9).strokeRect(0, 0, w * TILE, h * TILE);
    this.ghostRect.setPosition(g.x * TILE, g.y * TILE).setVisible(true);
    const place = buildingPlacement(def, g.x, g.y);
    this.ghostImage
      .setFrame(buildingFrame(g.type))
      .setOrigin(place.originX, place.originY)
      .setScale(place.scale)
      .setPosition(place.x, place.y)
      .setTint(g.valid ? 0xffffff : 0xff9a9a)
      .setVisible(def.kind !== 'path');
  }

  /**
   * Postprocess kamery: jeden ColorMatrix (bajkowa korekcja + daltonizacja) i delikatna winieta.
   * Wyłączenie „efektów bajkowych” zostawia tylko daltonizację (jeśli włączona) – mniej pracy dla GPU.
   */
  setPostFx(mode: ColorblindMode, fx: boolean): void {
    this.fx = fx;
    const filters = this.cameras.main.filters;
    if (!filters) return;
    if (mode === 'none' && !fx) {
      if (this.colorFilter) filters.external.remove(this.colorFilter, true);
      this.colorFilter = null;
    } else {
      this.colorFilter ??= filters.external.addColorMatrix();
      this.colorFilter.colorMatrix.set(colorMatrix20(mode, fx));
    }
    if (fx && !this.vignette) this.vignette = filters.external.addVignette(0.5, 0.52, 0.88, 0.32, 0x2a1a40);
    if (!fx && this.vignette) {
      filters.external.remove(this.vignette, true);
      this.vignette = null;
    }
  }


  // ------------------------------------------------------------- efekty („juice”)

  private px(at: { x: number; y: number }) {
    return project(at.x, at.y);
  }

  private burst(at: { x: number; y: number }, frame: ParticleFrame, count: number, opts?: Parameters<ParticleLayer['emit']>[4]): void {
    const p = this.px(at);
    const n = this.deps.reducedMotion() ? Math.ceil(count / 3) : count;
    this.particles.emit(p.x, p.y, frame, n, opts);
  }

  playEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'tilled':
          this.burst(e.at, 'p_dirt', 8);
          break;
        case 'planted':
          this.burst(e.at, 'p_seed', 6);
          break;
        case 'watered':
          this.burst(e.at, 'p_water', 10);
          break;
        case 'fertilized':
          this.burst(e.at, 'p_dirt', 5);
          this.burst(e.at, 'p_star', 3, { scale: 0.8 });
          break;
        case 'harvested':
          this.burst(e.at, 'p_leaf', 8);
          if (e.quality) this.burst(e.at, 'p_star', 4 + e.quality * 3);
          this.flyToHud(e.at, cropFrame(e.crop, 3), 1);
          this.floatText(e.at, `+${e.xp} XP${e.quality === 2 ? ' ★★' : e.quality === 1 ? ' ★' : ''}`, e.quality === 2 ? '#ffe066' : '#fff6b0');
          break;
        case 'cleared':
        case 'withered':
          this.burst(e.at, 'p_leaf', 5);
          break;
        case 'unlocked':
          this.burst(e.at, 'p_coin', 10);
          break;
        case 'placed':
        case 'moved':
        case 'removed':
          this.burst(e.at, 'p_smoke', 12, { speed: 300 });
          break;
        case 'fed':
          this.burst(e.at, 'p_seed', 6);
          break;
        case 'petted':
          this.burst(e.at, 'p_heart', 5, { speed: 350 });
          this.animals.hop(e.id);
          break;
        case 'collected':
        case 'foraged':
        case 'caught':
          this.flyToHud(e.at, itemFrame(parseKey(e.key).id), 0.9);
          this.burst(e.at, e.type === 'caught' ? 'p_water' : 'p_star', 6);
          break;
        case 'crafted':
          this.burst(e.at, 'p_star', 6);
          break;
        case 'outputCollected':
          this.burst(e.at, 'p_coin', 8);
          break;
        case 'bite':
          this.burst(e.at, 'p_water', 12, { speed: 400 });
          break;
        case 'escaped':
          this.burst(e.at, 'p_water', 6);
          break;
        case 'levelUp':
          this.celebrate();
          break;
        default:
          break;
      }
    }
  }

  /** Sprężysty „pop” i lot przedmiotu do licznika monet. */
  private flyToHud(at: { x: number; y: number }, frame: string, scale: number): void {
    const p = this.px(at);
    const img = this.add.image(p.x, p.y - TILE * 0.2, SPRITES_KEY, frame).setDepth(80).setScale(0);
    const target = this.deps.hudTarget();
    if (this.deps.reducedMotion() || !target) {
      img.setScale(scale);
      this.tweens.add({ targets: img, alpha: 0, delay: 350, duration: 250, onComplete: () => img.destroy() });
      return;
    }
    const d = this.deps.dpr();
    const dest = this.cam.toWorld(target.x * d, target.y * d);
    this.tweens.chain({
      targets: img,
      tweens: [
        { scale: scale * 1.3, y: p.y - TILE * 0.6, duration: 260, ease: 'Back.easeOut' },
        { scale: scale * 0.35, x: dest.x, y: dest.y, alpha: 0.6, duration: 520, ease: 'Cubic.easeIn' },
      ],
      onComplete: () => img.destroy(),
    });
  }

  private floatText(at: { x: number; y: number }, text: string, color: string): void {
    const p = this.px(at);
    const label = this.add
      .text(p.x, p.y - TILE * 0.2, text, {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '40px',
        fontStyle: 'bold',
        color,
        stroke: '#2b1d0e',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(85);
    if (this.deps.reducedMotion()) {
      this.time.delayedCall(800, () => label.destroy());
      return;
    }
    this.tweens.add({ targets: label, y: p.y - TILE * 0.95, alpha: 0, duration: 950, ease: 'Cubic.easeOut', onComplete: () => label.destroy() });
  }

  private celebrate(): void {
    const c = this.cam.toWorld(this.cam.viewport.width / 2, this.cam.viewport.height / 2);
    this.particles.emit(c.x, c.y, 'p_star', this.deps.reducedMotion() ? 6 : 24, { speed: 900, life: 1000, scale: 2 });
    if (!this.deps.reducedMotion()) this.cameras.main.shake(220, 0.004);
  }
}
