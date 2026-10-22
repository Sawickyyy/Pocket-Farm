// Ziemia całej mapy na TilemapGPULayer: biomy (zależne od sezonu), pole uprawne (wilgoć, żyzność), ścieżki,
// drogi i mosty osady (kafle, nie sprite'y).

import type Phaser from 'phaser';
import type { Content } from '../../content/content';
import { canUnlock } from '../../sim/systems/fields';
import type { Calendar, GameState, Plot } from '../../sim/types';
import { BiomeId, MAP_H, MAP_W, plotAtTile, tileIndex, type WorldMap } from '../../sim/world';
import { TILE, TILES_KEY, Tile } from '../art/atlas';
import { hashFloat } from '../../core/rng';

export class GroundLayer {
  readonly layer: Phaser.Tilemaps.TilemapGPULayer;
  /**
   * Kontener „płaskiej” ziemi: obrót o 45° wewnątrz spłaszczenia Y ×0,5 = rzut izometryczny 2:1.
   * Wszystko, co leży na ziemi (podświetlenie, obrys budowy), dodajemy tutaj we współrzędnych kafli × TILE.
   */
  readonly flat: Phaser.GameObjects.Container;
  private readonly cache = new Int16Array(MAP_W * MAP_H).fill(-1);
  /** Kafle dróg i mostów osady (−1 = brak) – bufor wielokrotnego użytku. */
  private readonly over = new Int16Array(MAP_W * MAP_H);
  private base: Int16Array | null = null;
  private baseSeason = -1;

  constructor(
    scene: Phaser.Scene,
    private readonly world: WorldMap,
    private readonly content: Content,
  ) {
    const data: number[][] = Array.from({ length: MAP_H }, () => new Array<number>(MAP_W).fill(0));
    const map = scene.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE });
    const tileset = map.addTilesetImage(TILES_KEY, TILES_KEY, TILE, TILE, 0, 0);
    if (!tileset) throw new Error('Nie udało się utworzyć tilesetu');
    // Pozycja (0,0): Phaser 4.1/4.2 dolicza przesunięcie TilemapGPULayer dwukrotnie, więc warstwy nie przesuwamy.
    this.layer = map.createLayer(0, tileset, 0, 0, true) as Phaser.Tilemaps.TilemapGPULayer;
    this.layer.setLighting(true);
    // TilemapGPULayer obsługuje tylko rzut ortogonalny – izometrię daje macierz kontenerów (koszt GPU bez zmian).
    this.flat = scene.add.container(0, 0, [this.layer]).setRotation(Math.PI / 4);
    scene.add.container(0, 0, [this.flat]).setScale(1, 0.5).setDepth(0);
  }

  private fieldTile(state: GameState, plot: Plot, i: number): number {
    if (!plot.unlocked) return canUnlock(state, i) ? Tile.Unlockable : Tile.Locked;
    if (!plot.tilled && !plot.crop) return Tile.Untilled;
    const wet = plot.moisture > 0.25;
    const poor = plot.fertility < 0.35;
    if (wet) return poor ? Tile.WetPoor : Tile.Wet;
    return poor ? Tile.TilledPoor : Tile.Tilled;
  }

  /** Kafle biomów i dróg wioski dla pory roku – liczone raz na sezon (hash kwiatów i biom nie zmieniają się). */
  private baseTiles(season: number): Int16Array {
    if (this.base && this.baseSeason === season) return this.base;
    const out = this.base ?? new Int16Array(MAP_W * MAP_H);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = tileIndex(x, y);
        let tile: number;
        if (this.world.road[i]) tile = Tile.Path;
        else {
          switch (this.world.biome[i]) {
            case BiomeId.water:
              tile = Tile.Water;
              break;
            case BiomeId.sand:
              tile = Tile.Sand;
              break;
            case BiomeId.forest:
              tile = Tile.forest(season);
              break;
            case BiomeId.meadow:
              tile = Tile.meadow(season);
              break;
            default:
              tile = hashFloat(this.world.seed, x, y, 5) < 0.12 ? Tile.flowers(season) : Tile.grass(season);
          }
        }
        out[i] = tile;
      }
    }
    this.base = out;
    this.baseSeason = season;
    return out;
  }

  sync(state: GameState, cal: Calendar): void {
    const base = this.baseTiles(cal.seasonIndex);
    // Ścieżki, brukowane drogi osady i mosty to kafle ziemi (nie sprite'y); pole uprawne ma pierwszeństwo.
    const over = this.over.fill(-1);
    for (const o of state.objects) {
      const def = this.content.buildings[o.type];
      if (def?.kind === 'path') over[tileIndex(o.x, o.y)] = def.art.model === 'stone' ? Tile.Road : Tile.Path;
      else if (def?.kind === 'bridge') over[tileIndex(o.x, o.y)] = Tile.Bridge;
    }
    let dirty = false;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = tileIndex(x, y);
        const plot = plotAtTile(x, y);
        const tile = plot !== null ? this.fieldTile(state, state.plots[plot]!, plot) : over[i]! >= 0 ? over[i]! : base[i]!;
        if (this.cache[i] !== tile) {
          this.cache[i] = tile;
          this.layer.putTileAt(tile, x, y);
          dirty = true;
        }
      }
    }
    if (dirty) this.layer.generateLayerDataTexture();
  }
}
