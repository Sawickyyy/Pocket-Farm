// Drzewa, miejsca zbieractwa, budynki i dekoracje na jednej SpriteGPULayer posortowanej po Y (głębia w widoku z góry).
// Bufor przebudowujemy tylko, gdy zmieni się układ (budowa, sezon, odrośnięcie zbiorów).

import type Phaser from 'phaser';
import type { Content } from '../../content/content';
import type { Calendar, GameState } from '../../sim/types';
import { MAP_H, MAP_W, chunkOfTile, tileIndex, type WorldMap } from '../../sim/world';
import { SPRITES_KEY, TILE, buildingFrame, treeFrame } from '../art/atlas';

interface Item {
  x: number;
  y: number;
  frame: string;
  scale?: number;
  originY?: number;
}

const CAPACITY = 2200;

export class ObjectLayer {
  readonly layer: Phaser.GameObjects.SpriteGPULayer;
  private key = '';

  constructor(
    scene: Phaser.Scene,
    private readonly world: WorldMap,
    private readonly content: Content,
  ) {
    this.layer = scene.add.spriteGPULayer(SPRITES_KEY, CAPACITY).setDepth(20).setLighting(true);
  }

  sync(state: GameState, cal: Calendar): void {
    const forageKey = Object.entries(state.world.forage)
      .filter(([, d]) => d > cal.day)
      .map(([t]) => t)
      .join(',');
    const key = `${cal.season}|${state.world.revealed.length}|${forageKey}|${state.objects.map((o) => `${o.uid}:${o.type}:${o.x}:${o.y}`).join(';')}`;
    if (key === this.key) return;
    this.key = key;

    const items: Item[] = [];
    const revealed = new Set(state.world.revealed);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = tileIndex(x, y);
        const tree = this.world.trees[i];
        if (tree) items.push({ x: (x + 0.5) * TILE, y: (y + 1) * TILE - 6, frame: treeFrame(tree === 1 ? 'oak' : 'pine', cal.season), originY: 1 });
        else if (this.world.forage[i] && revealed.has(chunkOfTile(x, y)) && (state.world.forage[String(i)] ?? -1) <= cal.day) {
          items.push({ x: (x + 0.5) * TILE, y: (y + 0.75) * TILE, frame: 'icon_forage', scale: 0.8, originY: 0.75 });
        }
      }
    }
    for (const o of state.objects) {
      const def = this.content.buildings[o.type];
      if (!def || def.kind === 'path') continue;
      const [w, h] = def.size;
      items.push({ x: (o.x + w / 2) * TILE, y: (o.y + h) * TILE, frame: buildingFrame(o.type), originY: 1 });
    }
    items.sort((a, b) => a.y - b.y);

    if (this.layer.memberCount) this.layer.removeMembers(0, this.layer.memberCount);
    for (const it of items.slice(0, CAPACITY)) {
      this.layer.addMember({ x: it.x, y: it.y, frame: it.frame, originY: it.originY ?? 0.5, scaleX: it.scale ?? 1, scaleY: it.scale ?? 1 });
    }
  }
}
