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
import { FxBudget, ParticleLayer, type AnyParticle, type EmitOptions } from './ParticleLayer';

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
/** Kolory (mnożone) cząsteczek dymu, pary i kurzu – ciepłe, bez fioletu. */
const SMOKE_DARK = 0x8a7d72;
const SMOKE_SOFT = 0xcfc4b8;
const STEAM = 0xf2f8ff;
const DUST = 0xd9b98a;
/**
 * Płomienie są addytywne: mnożymy je przez ciepłą czerwień, żeby za dnia (jasne tło) dawały pomarańcz,
 * a nie wyblakłą biel; nocą świecą głębokim oranżem.
 */
const FLAME = 0xff8a4a;
/** Iskierki na rogach kupionego fragmentu terenu. */
const TERRITORY_SPARKS: readonly [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
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
  private readonly fxBudget = new FxBudget(FX_TOKENS, FX_REFILL_MS);
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

  private burst(at: { x: number; y: number }, frame: AnyParticle, count: number, opts?: EmitOptions): void {
    const p = this.px(at);
    const n = this.deps.reducedMotion() ? Math.ceil(count / 3) : count;
    this.particles.emit(p.x, p.y, frame, n, opts);
  }

  /** Czy zagrać efekt zdarzenia osady w punkcie (kafle): musi być w kadrze i mieścić się w puli efektów. */
  private townFx(at: { x: number; y: number } | null): at is { x: number; y: number } {
    if (!at) return false;
    const p = this.px(at);
    return this.inView(p.x, p.y, 240) && this.fxBudget.take(this.time.now);
  }

  /** Środek domu mieszkańca (kafle) albo null. */
  private homeOf(id: number): { x: number; y: number } | null {
    const s = this.deps.store.get();
    const r = s.settlement.residents.find((v) => v.id === id);
    const o = r?.home !== null && r?.home !== undefined ? objectByUid(s, r.home) : undefined;
    return o ? centerOf(CONTENT, o) : null;
  }

  /** Błysk ciepłego światła nad budynkiem (ukończenie budowy). */
  private flash(at: { x: number; y: number }, size = 1): void {
    const p = this.px(at);
    const img = this.add
      .image(p.x, p.y - TILE * 0.45, SPRITES_KEY, 'p_sparkle')
      .setDepth(49)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(4 * size)
      .setAlpha(0.95);
    const reduced = this.deps.reducedMotion();
    this.tweens.add({ targets: img, scale: reduced ? 4 * size : 13 * size, alpha: 0, duration: reduced ? 380 : 620, ease: 'Cubic.easeOut', onComplete: () => img.destroy() });
  }

  /** Konfetti (płatki, liście, gwiazdki) – świętowanie przyjazdu, awansu osady. */
  private confetti(at: { x: number; y: number }, count: number, speed = 700): void {
    const per = Math.max(1, Math.round(count / 4));
    const opts = { speed, life: 1100, gravity: 0.35, spread: 2.2, jitter: 60, scale: 1.7 };
    this.burst(at, 'p_petal', per, opts);
    this.burst(at, 'p_autumn', per, opts);
    this.burst(at, 'p_leaf', per, opts);
    this.burst(at, 'p_star', per, { ...opts, scale: 1.1 });
  }

  /** Para wodna, dym, kurz: miękkie kłęby unoszące się i rosnące. */
  private puff(at: { x: number; y: number }, count: number, tint: number, opts: EmitOptions = {}): void {
    this.burst(at, 'p_smoke', count, { speed: 160, up: 120, gravity: -0.12, spread: 1.6, jitter: 90, life: 1300, scale: 1.6, grow: 1.8, still: true, tint, alpha: 0.7, ...opts });
  }

  /**
   * Efekty ciągłe osady: płomienie i iskry nad płonącymi budynkami, od czasu do czasu dym nad osmalonymi
   * i zgliszczami. Tylko budynki w kadrze, z limitem emisji na takt i liczby żywych cząsteczek.
   */
  private townEffects(time: number): void {
    const list = this.objects.effects;
    if (!list.length) return;
    const reduced = this.deps.reducedMotion();
    const eco = this.economy();
    if (time - this.fireTick >= (reduced ? 320 : eco ? 180 : 110)) {
      this.fireTick = time;
      // Płomienie mają własną (addytywną) pulę – limit żywych świecących cząsteczek.
      let budget = this.particles.aliveGlow > 72 ? 0 : 6;
      for (let i = 0; i < list.length && budget > 0; i++) {
        const fx = list[i]!;
        if (!fx.burning || !this.inView(fx.x, fx.y, 200)) continue;
        budget--;
        const jitter = fx.width * 0.45;
        this.particles.emit(fx.x, fx.y, 'p_fire', reduced ? 1 : 2, { speed: 80, up: 170, gravity: -0.1, spread: 0.7, jitter, life: 620, scale: 2.8, grow: -0.55, still: true, tint: FLAME });
        if (!reduced && !eco && Math.random() < 0.45) this.particles.emit(fx.x, fx.y - 40, 'p_ember', 1, { speed: 240, up: 200, gravity: -0.04, spread: 1.5, jitter, life: 950, scale: 0.9 });
      }
    }
    if (time - this.smokeTick >= (reduced ? 1400 : 650)) {
      this.smokeTick = time;
      let budget = this.particles.alive > 220 ? 0 : 4;
      for (let i = 0; i < list.length && budget > 0; i++) {
        const fx = list[i]!;
        if (!this.inView(fx.x, fx.y, 200)) continue;
        if (fx.burning) {
          budget--;
          this.particles.emit(fx.x, fx.y - 60, 'p_smoke', 2, { speed: 90, up: 150, gravity: -0.12, spread: 0.9, jitter: fx.width * 0.3, life: 1800, scale: 1.7, grow: 2.2, still: true, tint: SMOKE_DARK, alpha: 0.75 });
        } else if (fx.smoking && Math.random() < 0.35) {
          budget--;
          this.particles.emit(fx.x, fx.y, 'p_smoke', 1, { speed: 60, up: 90, gravity: -0.08, spread: 0.6, jitter: fx.width * 0.25, life: 2000, scale: 1.1, grow: 2.4, still: true, tint: SMOKE_SOFT, alpha: 0.55 });
        }
      }
    }
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
          this.playTownEvent(e);
          break;
      }
    }
  }

  /** Efekty zdarzeń osady (oszczędnie: w kadrze, z pulą efektów – nadrabianie offline przysyła ich setki). */
  private playTownEvent(e: SimEvent): void {
    const motion = !this.deps.reducedMotion();
    switch (e.type) {
      case 'constructed': {
        if (!this.townFx(e.at)) break;
        if (motion) this.objects.bounce(e.uid, this.deps.store.get());
        this.flash(e.at);
        this.burst(e.at, 'p_sparkle', 12, { speed: 520, up: 200, life: 900, scale: 2 });
        this.burst(e.at, 'p_star', 5, { speed: 650, scale: 1.2 });
        break;
      }
      case 'arrived':
        if (!this.townFx(e.at)) break;
        this.burst(e.at, 'p_heart', 6, { speed: 360, up: 120, gravity: 0.25, life: 1000 });
        this.confetti(e.at, 12, 620);
        break;
      case 'born': {
        const at = this.homeOf(e.id);
        if (!this.townFx(at)) break;
        this.burst(at, 'p_heart', 8, { speed: 320, up: 160, gravity: 0.2, life: 1100 });
        this.burst(at, 'p_sparkle', 4, { speed: 300, scale: 1.4 });
        break;
      }
      case 'relation': {
        if (e.kind !== 'partner') break;
        const at = this.homeOf(e.a) ?? this.homeOf(e.b);
        this.residents.cheer(e.a);
        this.residents.cheer(e.b);
        if (!this.townFx(at)) break;
        this.burst(at, 'p_heart', 10, { speed: 380, up: 160, gravity: 0.2, life: 1200 });
        this.burst(at, 'p_petal', 6, { speed: 500, gravity: 0.3, life: 1100 });
        break;
      }
      case 'tierUp':
      case 'specialized':
        this.celebrate(true);
        break;
      case 'fire':
        if (!this.townFx(e.at)) break;
        this.burst(e.at, 'p_fire', 6, { speed: 220, up: 160, gravity: -0.1, spread: 1, life: 700, scale: 2.4, still: true, tint: FLAME });
        this.puff(e.at, 8, SMOKE_DARK);
        break;
      case 'fireOut':
        if (!this.townFx(e.at)) break;
        this.puff(e.at, 12, STEAM, { speed: 220, life: 1500 });
        break;
      case 'breakdown':
        if (!this.townFx(e.at)) break;
        this.puff(e.at, 5, SMOKE_SOFT, { life: 900 });
        break;
      case 'repaired':
        if (!this.townFx(e.at)) break;
        this.burst(e.at, 'p_sparkle', 10, { speed: 480, up: 160, life: 850, scale: 1.8 });
        this.burst(e.at, 'p_star', 4, { speed: 600, scale: 1.1 });
        break;
      case 'produced': {
        // Mały przedmiot leci do licznika – tylko w kadrze, rzadko (co najwyżej raz na 0,9 s, ten sam budynek co 6 s).
        const now = this.time.now;
        if (now - this.lastFly < 900 || now - (this.producedAt.get(e.uid) ?? -Infinity) < 6000) break;
        if (!this.townFx(e.at)) break;
        this.lastFly = now;
        this.producedAt.set(e.uid, now);
        if (this.producedAt.size > 64) this.producedAt.clear();
        const frame = itemFrame(parseKey(e.item).id);
        if (this.textures.get(SPRITES_KEY).has(frame)) this.flyToHud(e.at, frame, 0.75);
        break;
      }
      case 'caravan': {
        const s = this.deps.store.get();
        const post = s.objects.find((o) => CONTENT.buildings[o.type]?.service?.kind === 'trade');
        const at = post ? centerOf(CONTENT, post) : null;
        if (!this.townFx(at)) break;
        this.puff(at, 10, DUST, { speed: 260, up: 40, gravity: 0.05, life: 1100, scale: 2 });
        break;
      }
      case 'territory': {
        const r = chunkRect(e.chunk);
        const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
        if (!this.fxBudget.take(this.time.now)) break;
        this.burst(c, 'p_sparkle', 10, { speed: 500, up: 220, life: 1000, scale: 2.2 });
        for (const [dx, dy] of TERRITORY_SPARKS) this.burst({ x: c.x + dx * r.w * 0.32, y: c.y + dy * r.h * 0.32 }, 'p_sparkle', 4, { speed: 360, up: 160, life: 900, scale: 1.8 });
        this.burst(c, 'p_coin', 6, { speed: 600 });
        break;
      }
      default:
        break;
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

  /** Świętowanie na środku kadru; `big` (awans osady, specjalizacja) – dwie fale gwiazdek i konfetti. */
  private celebrate(big = false): void {
    const reduced = this.deps.reducedMotion();
    const c = this.cam.toWorld(this.cam.viewport.width / 2, this.cam.viewport.height / 2);
    this.particles.emit(c.x, c.y, 'p_star', reduced ? 6 : 24, { speed: 900, life: 1000, scale: 2 });
    if (big) {
      const t = unproject(c.x, c.y);
      this.confetti(t, 32, 1000);
      this.particles.emit(c.x, c.y, 'p_sparkle', reduced ? 4 : 14, { speed: 700, life: 1100, scale: 2.4 });
      if (!reduced) this.time.delayedCall(320, () => this.particles.emit(c.x, c.y - 120, 'p_star', 18, { speed: 1100, life: 1100, scale: 2.4 }));
    }
    if (!reduced) this.cameras.main.shake(big ? 320 : 220, big ? 0.005 : 0.004);
  }
}
