// Ziemia całej mapy na TilemapGPULayer: biomy (zależne od sezonu), pole uprawne (wilgoć, żyzność), ścieżki.

import type Phaser from 'phaser';
import type { Content } from '../../content/content';
import { canUnlock } from '../../sim/systems/fields';
import type { Calendar, GameState, Plot } from '../../sim/types';
import { BiomeId, FIELD, MAP_H, MAP_W, plotAtTile, tileIndex, type WorldMap } from '../../sim/world';
import { TILE, TILES_KEY, Tile } from '../art/atlas';
import { hashFloat } from '../../core/rng';

export class GroundLayer {
  readonly layer: Phaser.Tilemaps.TilemapGPULayer;
  private readonly cache = new Int16Array(MAP_W * MAP_H).fill(-1);

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
    this.layer.setDepth(0).setLighting(true);
  }

  private fieldTile(state: GameState, plot: Plot, i: number): number {
    if (!plot.unlocked) return canUnlock(state, i) ? Tile.Unlockable : Tile.Locked;
    if (!plot.tilled && !plot.crop) return Tile.Untilled;
    const wet = plot.moisture > 0.25;
    const poor = plot.fertility < 0.35;
    if (wet) return poor ? Tile.WetPoor : Tile.Wet;
    return poor ? Tile.TilledPoor : Tile.Tilled;
  }

  sync(state: GameState, cal: Calendar): void {
    const s = cal.seasonIndex;
    const paths = new Set<number>();
    for (const o of state.objects) if (this.content.buildings[o.type]?.kind === 'path') paths.add(tileIndex(o.x, o.y));
    let dirty = false;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = tileIndex(x, y);
        let tile: number;
        const plot = plotAtTile(x, y);
        if (plot !== null) tile = this.fieldTile(state, state.plots[plot]!, plot);
        else if (paths.has(i)) tile = Tile.Path;
        else {
          switch (this.world.biome[i]) {
            case BiomeId.water:
              tile = Tile.Water;
              break;
            case BiomeId.sand:
              tile = Tile.Sand;
              break;
            case BiomeId.forest:
              tile = Tile.forest(s);
              break;
            case BiomeId.meadow:
              tile = Tile.meadow(s);
              break;
            default:
              tile = hashFloat(this.world.seed, x, y, 5) < 0.12 ? Tile.flowers(s) : Tile.grass(s);
          }
        }
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

export const FIELD_RECT_PX = { x: FIELD.x * TILE, y: FIELD.y * TILE, w: FIELD.w * TILE, h: FIELD.h * TILE };
