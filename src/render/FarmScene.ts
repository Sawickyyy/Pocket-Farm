// Scena Phasera: składa warstwy, synchronizuje je ze stanem symulacji, steruje kamerą, światłem i efektami.
// Osada: budowy i zgliszcza (ObjectLayer), zasięg usług, teren, mieszkańcy, karawana, efekty zdarzeń osady.

import Phaser from 'phaser';
import { CONTENT, parseKey } from '../content/content';
import type { Store } from '../core/store';
import { DAY_MS, HOUR_MS, calendarAt, daylight } from '../sim/calendar';
import type { SimEvent } from '../sim/events';
import { PLOT_COUNT } from '../sim/initialState';
import type { GameState } from '../sim/types';
import type { CoverageKind } from '../content/content';
import { centerOf, objectByUid } from '../sim/systems/settlement/common';
import { chunkRect } from '../sim/systems/settlement/territory';
import { CHUNK, CHUNKS_X, FIELD, generateWorld, plotTile, type WorldMap } from '../sim/world';
import { SPRITES_KEY, TILE, TILES_KEY, buildingFrame, cropFrame, drawSpriteAtlas, drawTileset, itemFrame } from './art/atlas';
import { frameFor } from './art/settlementArt';
import { CameraModel, type Viewport } from './cameraModel';
import { buildingPlacement, project, projectedBounds, unproject } from './iso';
import { colorMatrix20, type ColorblindMode } from './colorblind';
import { AmbientLayer } from './layers/AmbientLayer';
import { AnimalLayer } from './layers/AnimalLayer';
import { CaravanLayer } from './layers/CaravanLayer';
import { CoverageLayer, isCoverageKind } from './layers/CoverageLayer';
import { VillagerLayer } from './layers/VillagerLayer';
import { FogLayer } from './layers/FogLayer';
import { GroundLayer } from './layers/GroundLayer';
import { Lighting } from './layers/Lighting';
import { ObjectLayer } from './layers/ObjectLayer';
import { PlantLayer } from './layers/PlantLayer';
import { ResidentLayer } from './layers/ResidentLayer';
import { TerritoryLayer } from './layers/TerritoryLayer';
import { ParticleLayer, type AnyParticle, type EmitOptions } from './ParticleLayer';

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
  /** Wariant wyglądu budynku osady (domyślnie 0). */
  style?: number;
  /** Rysowanie dróg linią: kafle do postawienia (każdy z własną poprawnością); x/y = ostatni kafel. */
  line?: { x: number; y: number; valid: boolean }[];
}

/** Rodzaj zasięgu usług pokazywany jako nakładka (docs/plan-osada.md §9). */
export type CoverageOverlay = CoverageKind;
/** Podgląd zasięgu budynku przed postawieniem (duch w trybie budowania). */
export interface CoveragePreview {
  type: string;
  x: number;
  y: number;
}

const SYNC_MS = 120;
/** Limit efektów zdarzeń osady: pula „żetonów” odnawiana w czasie (nadrabianie potrafi przysłać setki zdarzeń). */
const FX_TOKENS = 10;
const FX_REFILL_MS = 250;
/** Kolory ducha budowy: poprawne / niepoprawne miejsce. */
const GHOST_OK = 0x7dff8a;
const GHOST_BAD = 0xff6b6b;

/** Rysuje prostokąt kafli ducha (tło + obrys) w kontenerze płaskiej ziemi. */
function ghostTile(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, valid: boolean, thin = false): void {
  const color = valid ? GHOST_OK : GHOST_BAD;
  g.fillStyle(color, thin ? 0.38 : 0.3).fillRect(x, y, w * TILE, h * TILE);
  g.lineStyle(thin ? 6 : 8, color, 0.9).strokeRect(x + (thin ? 6 : 0), y + (thin ? 6 : 0), w * TILE - (thin ? 12 : 0), h * TILE - (thin ? 12 : 0));
}

const DOF_KEY = 'dof-mask';
/** Macierze 4×5: jasność do wszystkich kanałów (alfa = 1) oraz ciepłe zabarwienie poświaty. */
const LUMA = [0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152, 0.0722, 0, 0, 0, 0, 0, 0, 1];
/** Ciepła sepia z przyciemnieniem dla świata za otwartym panelem. */
const STAGE_SEPIA = [0.33, 0.6, 0.15, 0, 0.02, 0.29, 0.53, 0.13, 0, 0.01, 0.22, 0.42, 0.1, 0, 0, 0, 0, 0, 1, 0];
const WARM_GLOW = [1, 0, 0, 0, 0, 0, 0.84, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 1, 0];

/** Maska tilt-shiftu: przezroczysty pas w środku ekranu (ostro), pełna krycie u góry i u dołu (rozmyte). */
function dofMask(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0)');
  g.addColorStop(0.7, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  return c;
}

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
  private residents!: ResidentLayer;
  private caravans!: CaravanLayer;
  private coverage!: CoverageLayer;
  private territory!: TerritoryLayer;
  /** Zasięg zamówiony przez UI i podgląd zasięgu ducha budowy (ma pierwszeństwo). */
  private coverageUser: { kind: CoverageKind | null; preview: CoveragePreview | null } = { kind: null, preview: null };
  private coverageGhost: { kind: CoverageKind; preview: CoveragePreview } | null = null;
  private fxTokens = FX_TOKENS;
  private fxRefill = 0;
  private fireTick = 0;
  private smokeTick = 0;
  private lastFly = 0;
  private readonly producedAt = new Map<number, number>();
  private vignette: Phaser.Filters.Vignette | null = null;
  private fx = true;
  private highlight!: Phaser.GameObjects.Graphics;
  private tutorialPulse!: Phaser.GameObjects.Graphics;
  private ghostImage!: Phaser.GameObjects.Image;
  private ghostRect!: Phaser.GameObjects.Graphics;
  private colorFilter: Phaser.Filters.ColorMatrix | null = null;
  private bloom: { blend: Phaser.Filters.Blend; threshold: Phaser.Filters.Threshold } | null = null;
  private gradeSeason: string | null = null;
  private bloomNight = -1;
  private stageFilter: Phaser.Filters.ColorMatrix | null = null;
  staging = 0;
  private post: { mode: ColorblindMode; fx: boolean; dof: boolean } = { mode: 'none', fx: true, dof: false };
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
    this.objects = new ObjectLayer(this, this.world, CONTENT, () => !this.deps.reducedMotion());
    this.animals = new AnimalLayer(this, CONTENT, () => !this.deps.reducedMotion());
    this.villagers = new VillagerLayer(this, CONTENT, () => !this.deps.reducedMotion());
    this.fog = new FogLayer(this);
    this.particles = new ParticleLayer(this);
    this.ambient = new AmbientLayer(this, state.seed);
    this.lighting = new Lighting(this, CONTENT, () => !this.deps.reducedMotion());
    this.residents = new ResidentLayer(this, this.world, CONTENT, () => !this.deps.reducedMotion());
    this.caravans = new CaravanLayer(this, this.world, CONTENT, () => !this.deps.reducedMotion());

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
    // Nakładki osady wstawiane tuż nad kaflami: teren pod zasięgiem usług, oba pod podświetleniem i duchem.
    this.coverage = new CoverageLayer(this, this.ground.flat, CONTENT);
    this.territory = new TerritoryLayer(this, this.ground.flat, CONTENT, () => this.deps.dpr());
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
    this.lighting.update(hour, cal, time);
    this.ambient.update(cal, 1 - daylight(hour), this.fx && !this.deps.reducedMotion());
    this.updatePostFx(cal.season, 1 - daylight(hour));
    this.animals.update(time, state);
    this.villagers.update(time, delta, cal);
    this.residents.update(time, delta, cal);
    this.caravans.update(time, delta, cal);
    this.townEffects(time);
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
    this.residents.sync(state, cal);
    this.caravans.sync(state, cal);
    this.territory.sync(state);
    this.coverage.sync(state);
    if (force || !prev || prev.objects !== state.objects || prev.plots !== state.plots || prev.settlement !== state.settlement) this.lighting.sync(state, this.economy());
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
    // Etykiety cen terenu mają stały rozmiar na ekranie.
    this.territory?.updateScale(this.cam.zoom, this.deps.dpr());
  }

  /** Tryb oszczędny: bez efektów bajkowych albo przy niskim klatkażu – mniej świateł i cząsteczek. */
  private economy(): boolean {
    return !this.fx || document.documentElement.dataset.lowfps === 'true';
  }

  /** Czy punkt świata (px) jest w kadrze (z marginesem). */
  private inView(x: number, y: number, margin = 160): boolean {
    const v = this.cameras.main.worldView;
    return x >= v.x - margin && x <= v.right + margin && y >= v.y - margin && y <= v.bottom + margin;
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
    this.focusAt(x + 0.5, y + 0.5);
  }

  /** Kamera na punkt w kaflach (ciągły). */
  private focusAt(x: number, y: number): void {
    const p = project(x, y);
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
      if (this.coverageGhost) {
        this.coverageGhost = null;
        this.applyCoverage();
      }
      return;
    }
    const def = CONTENT.buildings[g.type];
    if (!def) return;
    const [w, h] = def.size;
    // Drogi i mosty to kafle ziemi – duch to sam prostokąt kafla (przy rysowaniu linią: każdy kafel osobno).
    const ground = def.kind === 'path' || def.kind === 'bridge';
    const r = this.ghostRect.clear();
    if (g.line?.length) {
      r.setPosition(0, 0);
      for (const t of g.line) ghostTile(r, t.x * TILE, t.y * TILE, w, h, t.valid, true);
    } else {
      r.setPosition(g.x * TILE, g.y * TILE);
      ghostTile(r, 0, 0, w, h, g.valid, ground);
    }
    r.setVisible(true);
    if (ground) this.ghostImage.setVisible(false);
    else {
      const place = buildingPlacement(def, g.x, g.y);
      const styled = frameFor(def, g.style);
      this.ghostImage
        .setFrame(this.textures.get(SPRITES_KEY).has(styled) ? styled : buildingFrame(g.type))
        .setOrigin(place.originX, place.originY)
        .setScale(place.scale)
        .setPosition(place.x, place.y)
        .setTint(g.valid ? 0xffffff : 0xff9a9a)
        .setVisible(true);
    }
    // Budynek z usługą: od razu podgląd zasięgu (kafle, które obejmie po postawieniu).
    const sv = def.service;
    const next = sv && isCoverageKind(sv.kind) && sv.radius > 0 ? { kind: sv.kind, preview: { type: g.type, x: g.x, y: g.y } } : null;
    const prev = this.coverageGhost;
    if (prev?.kind !== next?.kind || prev?.preview.x !== next?.preview.x || prev?.preview.y !== next?.preview.y || prev?.preview.type !== next?.preview.type) {
      this.coverageGhost = next;
      this.applyCoverage();
    }
  }

  // ------------------------------------------------------------- osada

  /** Nakładka zasięgu usługi (kolorowe kafle wokół budynków danego rodzaju); null = wyłącz. */
  setCoverage(kind: CoverageOverlay | null, preview?: CoveragePreview | null): void {
    this.coverageUser = { kind, preview: preview ?? null };
    this.applyCoverage();
  }

  private applyCoverage(): void {
    const g = this.coverageGhost;
    if (g) this.coverage.set(g.kind, g.preview);
    else this.coverage.set(this.coverageUser.kind, this.coverageUser.preview);
  }

  /** Tryb terenu: obrys terenu osady, fragmenty do kupienia z cenami. */
  setTerritoryMode(on: boolean): void {
    this.territory.setMode(on);
    this.territory.updateScale(this.cam.zoom, this.deps.dpr());
  }

  /** Mieszkaniec osady pod punktem ekranu → id mieszkańca. */
  residentAt(sx: number, sy: number): number | null {
    const w = this.worldAt(sx, sy);
    return this.residents.hit(w.x, w.y);
  }

  /** Czy punkt ekranu trafia w wóz karawany (dotknięcie otwiera handel). */
  caravanAt(sx: number, sy: number): boolean {
    const w = this.worldAt(sx, sy);
    return this.caravans.hit(w.x, w.y);
  }

  /** Kamera na mieszkańca (jego postać albo dom). */
  focusResident(id: number): void {
    const pos = this.residents.positionOf(id);
    if (pos) {
      this.focusAt(pos.x, pos.y);
      return;
    }
    const s = this.deps.store.get();
    const r = s.settlement.residents.find((v) => v.id === id);
    const uid = r ? (r.home ?? r.job) : null;
    const o = uid !== null ? objectByUid(s, uid) : undefined;
    if (!o) return;
    const c = centerOf(CONTENT, o);
    this.focusAt(c.x, c.y);
  }

  /**
   * Postprocess kamery w kolejności: ColorMatrix (colour script pory roku + daltonizacja) → bloom (poświata
   * jasnych miejsc, nocą mocniejsza – latarnie i okna „świecą”) → tilt-shift (rozmycie góry i dołu ekranu,
   * efekt makiety) → winieta. Wyłączenie efektów zostawia tylko daltonizację (jeśli włączona).
   */
  setPostFx(mode: ColorblindMode, fx: boolean, dof = false): void {
    this.fx = fx;
    this.post = { mode, fx, dof };
    const filters = this.cameras.main.filters;
    if (!filters) return;
    const list = filters.external;
    list.clear();
    this.colorFilter = null;
    this.vignette = null;
    this.bloom = null;
    this.bloomNight = -1;
    if (mode !== 'none' || fx) {
      this.colorFilter = list.addColorMatrix();
      this.colorFilter.colorMatrix.set(colorMatrix20(mode, fx, this.gradeSeason ?? undefined));
    }
    if (fx) {
      // Bloom z jasności (nie z każdego kanału osobno – inaczej czerwone dachy dawałyby czerwone plamy),
      // rozmyty i zabarwiony na ciepło jak światło w filmie animowanym.
      const pf = list.addParallelFilters();
      pf.top.addColorMatrix().colorMatrix.set(LUMA);
      const threshold = pf.top.addThreshold(0.86, 1);
      pf.top.addBlur(0, 2, 2, 1, 0xffffff, 4);
      pf.top.addColorMatrix().colorMatrix.set(WARM_GLOW);
      pf.blend.blendMode = Phaser.BlendModes.SCREEN;
      pf.blend.amount = 0.3;
      this.bloom = { blend: pf.blend, threshold };
    }
    if (fx && dof) {
      if (!this.textures.exists(DOF_KEY)) this.textures.addCanvas(DOF_KEY, dofMask());
      const pf = list.addParallelFilters();
      pf.top.addBlur(1, 4, 4, 1.5, 0xffffff, 6);
      pf.top.addMask(DOF_KEY);
      pf.blend.blendMode = Phaser.BlendModes.NORMAL;
      pf.blend.amount = 1;
    }
    if (fx) this.vignette = list.addVignette(0.5, 0.52, 0.88, 0.32, 0x3a2414);
    // „Staging”: przy otwartym panelu świat dostaje ciepłą, przyciemnioną sepię (bez rozmycia szkła).
    this.stageFilter = list.addColorMatrix();
    this.stageFilter.colorMatrix.set(STAGE_SEPIA);
    this.stageFilter.colorMatrix.alpha = this.staging;
  }

  /** Panel otwarty → świat w tle przyciemnia się ciepłą sepią (płynnie). */
  setStaging(on: boolean): void {
    const target = on ? 0.6 : 0;
    this.tweens.killTweensOf(this);
    if (this.deps.reducedMotion()) {
      this.staging = target;
      if (this.stageFilter) this.stageFilter.colorMatrix.alpha = target;
      return;
    }
    this.tweens.add({
      targets: this,
      staging: target,
      duration: on ? 320 : 260,
      ease: 'Sine.easeOut',
      onUpdate: () => {
        if (this.stageFilter) this.stageFilter.colorMatrix.alpha = this.staging;
      },
    });
  }

  /** Colour script: zmiana pory roku przestawia korekcję; bloom rośnie o zmierzchu i nocą. */
  private updatePostFx(season: string, night: number): void {
    if (season !== this.gradeSeason) {
      this.gradeSeason = season;
      if (this.colorFilter) this.colorFilter.colorMatrix.set(colorMatrix20(this.post.mode, this.post.fx, season));
    }
    if (this.bloom && Math.abs(night - this.bloomNight) > 0.01) {
      this.bloomNight = night;
      this.bloom.blend.amount = 0.3 + night * 0.4;
      this.bloom.threshold.setEdge(0.86 - night * 0.3, 1);
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
          if (!this.deps.reducedMotion()) {
            this.objects.bounce(e.uid, this.deps.store.get());
            this.time.delayedCall(230, () => this.burst(e.at, 'p_smoke', 12, { speed: 300 }));
          } else this.burst(e.at, 'p_smoke', 12, { speed: 300 });
          break;
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
        // przygotowanie: przysiad przed wyskokiem
        { scaleX: scale * 1.25, scaleY: scale * 0.75, duration: 90, ease: 'Quad.easeOut' },
        { scaleX: scale * 1.15, scaleY: scale * 1.4, y: p.y - TILE * 0.6, duration: 240, ease: 'Back.easeOut' },
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
