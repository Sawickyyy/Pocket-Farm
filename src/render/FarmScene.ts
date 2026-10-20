import Phaser from 'phaser';
import type { Store } from '../core/store';
import { CROPS, GRID_COLS, GRID_ROWS, PLOT_COUNT } from '../game/content';
import { canUnlock, cropStage, isReady, type GameEvent } from '../game/logic';
import type { GameState, Plot } from '../game/state';
import { CameraModel, type Viewport } from './cameraModel';
import { ParticleLayer } from './ParticleLayer';
import {
  SPRITES_KEY,
  TILE,
  TILES_KEY,
  Tile,
  cropFrame,
  drawSpriteAtlas,
  drawTileset,
  type IconFrame,
} from './proceduralArt';

/** Ile kafli trawy otacza siatkę pól (widać je przy oddaleniu i przesuwaniu). */
const BORDER = 3;
const WORLD_W = GRID_COLS * TILE;
const WORLD_H = GRID_ROWS * TILE;
/**
 * Siatka pól zaczyna się w świecie od (GRID_X, GRID_Y), a warstwa kafli leży w (0, 0).
 * Phaser 4.1/4.2 dodaje pozycję TilemapGPULayer dwukrotnie (applyITRS + setQuad w SubmitterTilemapGPULayer),
 * więc nie przesuwamy warstwy – przesuwamy siatkę.
 */
const GRID_X = BORDER * TILE;
const GRID_Y = BORDER * TILE;

export interface SceneDeps {
  store: Store<GameState>;
  reducedMotion: () => boolean;
  onReady: (scene: FarmScene) => void;
}

type SyncMember = { key: string };

export class FarmScene extends Phaser.Scene {
  private deps!: SceneDeps;
  private ground!: Phaser.Tilemaps.TilemapGPULayer;
  private plants!: Phaser.GameObjects.SpriteGPULayer;
  private particles!: ParticleLayer;
  private highlight!: Phaser.GameObjects.Graphics;
  private readonly tileCache = new Int16Array(PLOT_COUNT).fill(-1);
  /** Klucz ostatnio wysłanego stanu członka – edytujemy bufor GPU tylko przy zmianie. */
  private readonly plantKeys: SyncMember[] = Array.from({ length: PLOT_COUNT * 2 }, () => ({ key: '' }));
  readonly cam = new CameraModel(WORLD_W, WORLD_H, GRID_X, GRID_Y);
  private unsubscribers: Array<() => void> = [];

  constructor() {
    super({ key: 'farm' });
  }

  init(deps: SceneDeps): void {
    this.deps = deps;
  }

  create(): void {
    this.createTextures();
    this.createGround();
    this.createPlants();
    this.particles = new ParticleLayer(this, SPRITES_KEY);

    // Podświetlenie dotkniętego pola – jedyny obiekt z filtrem glow (filtry są kosztowne, używamy oszczędnie).
    this.highlight = this.add.graphics().setDepth(30).setVisible(false);
    this.highlight.lineStyle(10, 0xfff3b0, 1).strokeRoundedRect(4, 4, TILE - 8, TILE - 8, 18);
    this.highlight.enableFilters();
    this.highlight.filters?.internal.addGlow(0xffe27a, 6, 0, 1);

    this.cameras.main.setBackgroundColor('#4f8a3c');
    this.cameras.main.setRoundPixels(false);

    const { store } = this.deps;
    this.unsubscribers.push(store.select((s) => s.plots, () => this.syncAll(), true));
    this.unsubscribers.push(store.select((s) => s.upgrades, () => this.syncAll()));

    // Wzrost liczony ze znaczników czasu – wystarczy co jakiś czas odświeżyć etapy.
    this.time.addEvent({ delay: 500, loop: true, callback: () => this.syncAll() });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsubscribers.forEach((u) => u()));
    this.deps.onReady(this);
  }

  override update(): void {
    this.particles.update();
  }

  // ------------------------------------------------------------- tekstury

  private createTextures(): void {
    if (!this.textures.exists(TILES_KEY)) this.textures.addCanvas(TILES_KEY, drawTileset());
    if (!this.textures.exists(SPRITES_KEY)) {
      const { canvas, frames } = drawSpriteAtlas();
      const tex = this.textures.addCanvas(SPRITES_KEY, canvas);
      for (const f of frames) tex?.add(f.name, 0, f.x, f.y, f.w, f.h);
    }
  }

  private createGround(): void {
    const cols = GRID_COLS + BORDER * 2;
    const rows = GRID_ROWS + BORDER * 2;
    const data: number[][] = [];
    for (let y = 0; y < rows; y++) {
      const row: number[] = [];
      for (let x = 0; x < cols; x++) {
        const inGrid = x >= BORDER && x < BORDER + GRID_COLS && y >= BORDER && y < BORDER + GRID_ROWS;
        const ring = x === BORDER - 1 || x === BORDER + GRID_COLS || y === BORDER - 1 || y === BORDER + GRID_ROWS;
        const inRing = ring && x >= BORDER - 1 && x <= BORDER + GRID_COLS && y >= BORDER - 1 && y <= BORDER + GRID_ROWS;
        if (inGrid) row.push(Tile.Locked);
        else if (inRing) row.push(Tile.Path);
        else row.push((x * 7 + y * 13) % 5 === 0 ? Tile.GrassFlowers : Tile.Grass);
      }
      data.push(row);
    }
    const map = this.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE });
    const tileset = map.addTilesetImage(TILES_KEY, TILES_KEY, TILE, TILE, 0, 0);
    if (!tileset) throw new Error('Nie udało się utworzyć tilesetu');
    // Ostatni argument `true` → TilemapGPULayer (cała warstwa w jednym quadzie, koszt per piksel).
    this.ground = map.createLayer(0, tileset, 0, 0, true) as Phaser.Tilemaps.TilemapGPULayer;
    this.ground.setDepth(0);
  }

  private createPlants(): void {
    this.plants = this.add.spriteGPULayer(SPRITES_KEY, PLOT_COUNT * 2).setDepth(10);
    // Włączamy z góry używane animacje, żeby nie rekompilować shadera w trakcie gry.
    this.plants.setAnimationEnabled('Sine.easeInOut', true);
    // Członkowie 0..47 = rośliny, 48..95 = ikony nad polami. Pusty slot = skala 0 (bez przebudowy bufora).
    for (let i = 0; i < PLOT_COUNT * 2; i++) this.plants.addMember({ frame: 'icon_ready', scaleX: 0, scaleY: 0, alpha: 0 });
  }

  // ------------------------------------------------------------- synchronizacja ze stanem

  private groundTileFor(state: GameState, plot: Plot, i: number): number {
    if (!plot.unlocked) return canUnlock(state, i) ? Tile.Unlockable : Tile.Locked;
    if (plot.crop) return plot.crop.wateredAt !== null && !isReady(plot.crop, Date.now()) ? Tile.Wet : Tile.Tilled;
    return plot.tilled ? Tile.Tilled : Tile.Untilled;
  }

  syncAll(): void {
    if (!this.ground) return;
    const state = this.deps.store.get();
    const now = Date.now();
    const motion = !this.deps.reducedMotion();
    let groundDirty = false;

    state.plots.forEach((plot, i) => {
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const tile = this.groundTileFor(state, plot, i);
      if (this.tileCache[i] !== tile) {
        this.tileCache[i] = tile;
        this.ground.putTileAt(tile, col + BORDER, row + BORDER);
        groundDirty = true;
      }

      const x = GRID_X + col * TILE + TILE / 2;
      const y = GRID_Y + row * TILE + TILE / 2;

      // Roślina
      const crop = plot.crop;
      const stage = crop ? cropStage(crop, now) : -1;
      const ripe = crop !== null && stage === 3;
      const plantKey = crop ? `${crop.id}:${stage}:${motion}` : '';
      if (this.setKey(i, plantKey)) {
        if (!crop) this.hide(i);
        else
          this.plants.editMember(i, {
            x,
            y,
            frame: cropFrame(crop.id, stage),
            originY: 0.5,
            scaleX: 1,
            scaleY: ripe && motion ? { base: 1, amplitude: 0.07, duration: 650, ease: 'Sine.easeInOut', yoyo: true } : 1,
            alpha: 1,
          });
      }

      // Ikona nad polem
      let icon: IconFrame | null = null;
      if (!plot.unlocked && canUnlock(state, i)) icon = 'icon_lock';
      else if (crop && crop.wateredAt === null) icon = 'icon_drop';
      else if (ripe) icon = 'icon_ready';
      const iconKey = icon ? `${icon}:${motion}` : '';
      const m = PLOT_COUNT + i;
      if (this.setKey(m, iconKey)) {
        if (!icon) this.hide(m);
        else if (icon === 'icon_lock') {
          this.plants.editMember(m, { x, y, frame: icon, scaleX: 0.8, scaleY: 0.8, alpha: 0.9 });
        } else {
          const ix = x + TILE * 0.28;
          const iy = y - TILE * 0.3;
          this.plants.editMember(m, {
            x: ix,
            y: motion ? { base: iy, amplitude: -10, duration: 550, ease: 'Sine.easeInOut', yoyo: true } : iy,
            frame: icon,
            scaleX: 0.45,
            scaleY: 0.45,
            alpha: 1,
          });
        }
      }
    });

    if (groundDirty) this.ground.generateLayerDataTexture();
  }

  private setKey(member: number, key: string): boolean {
    const slot = this.plantKeys[member];
    if (!slot || slot.key === key) return false;
    slot.key = key;
    return true;
  }

  private hide(member: number): void {
    this.plants.editMember(member, { frame: 'icon_ready', scaleX: 0, scaleY: 0, alpha: 0 });
  }

  // ------------------------------------------------------------- efekty

  playEvents(events: readonly GameEvent[]): void {
    const rich = !this.deps.reducedMotion();
    for (const e of events) {
      switch (e.type) {
        case 'tilled':
          this.burst(e.plot, 'p_dirt', rich ? 8 : 3);
          break;
        case 'planted':
          this.burst(e.plot, 'p_seed', rich ? 6 : 2);
          break;
        case 'watered':
          this.burst(e.plot, 'p_water', rich ? 10 : 3);
          break;
        case 'harvested':
          this.burst(e.plot, 'p_leaf', rich ? 8 : 3);
          this.burst(e.plot, 'p_star', rich ? 4 : 1);
          this.floatText(e.plot, `+${e.xp} XP`, '#fff6b0');
          break;
        case 'unlocked':
          this.burst(e.plot, 'p_coin', rich ? 10 : 3);
          break;
        default:
          break;
      }
      this.syncAll();
    }
  }

  private plotCenter(i: number): { x: number; y: number } {
    return { x: GRID_X + (i % GRID_COLS) * TILE + TILE / 2, y: GRID_Y + Math.floor(i / GRID_COLS) * TILE + TILE / 2 };
  }

  private burst(plot: number, frame: Parameters<ParticleLayer['emit']>[2], count: number): void {
    const { x, y } = this.plotCenter(plot);
    this.particles.emit(x, y, frame, count);
  }

  private floatText(plot: number, text: string, color: string): void {
    const { x, y } = this.plotCenter(plot);
    const label = this.add
      .text(x, y - TILE * 0.2, text, {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '40px',
        fontStyle: 'bold',
        color,
        stroke: '#2b1d0e',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(40);
    if (this.deps.reducedMotion()) {
      this.time.delayedCall(700, () => label.destroy());
      return;
    }
    this.tweens.add({
      targets: label,
      y: y - TILE * 0.9,
      alpha: 0,
      duration: 900,
      ease: 'Cubic.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  showHighlight(plot: number | null): void {
    if (plot === null) {
      this.highlight.setVisible(false);
      return;
    }
    this.highlight.setPosition(GRID_X + (plot % GRID_COLS) * TILE, GRID_Y + Math.floor(plot / GRID_COLS) * TILE).setVisible(true);
  }

  // ------------------------------------------------------------- kamera i trafienia

  setViewport(v: Viewport): void {
    this.cam.setViewport(v, Math.min(v.width, v.height) * 0.04);
    this.applyCamera();
  }

  applyCamera(): void {
    const c = this.cameras.main;
    c.setZoom(this.cam.zoom);
    c.centerOn(this.cam.centerX, this.cam.centerY);
  }

  /** Piksele urządzenia → indeks pola albo null. */
  plotAt(sx: number, sy: number): number | null {
    const { x, y } = this.cam.toWorld(sx, sy);
    const col = Math.floor((x - GRID_X) / TILE);
    const row = Math.floor((y - GRID_Y) / TILE);
    if (col < 0 || row < 0 || col >= GRID_COLS || row >= GRID_ROWS) return null;
    return row * GRID_COLS + col;
  }

  cropColor(plot: number): string | null {
    const c = this.deps.store.get().plots[plot]?.crop;
    return c ? CROPS[c.id].color : null;
  }
}
