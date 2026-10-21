// Drzewa, miejsca zbieractwa, budynki i dekoracje na jednej SpriteGPULayer posortowanej po głębi izometrycznej.
// Bufor przebudowujemy tylko, gdy zmieni się układ (budowa, sezon, odrośnięcie zbiorów).

import type Phaser from 'phaser';
import type { Content } from '../../content/content';
import type { Calendar, GameState } from '../../sim/types';
import { MAP_H, MAP_W, chunkOfTile, tileIndex, type WorldMap } from '../../sim/world';
import { SPRITES_KEY, buildingFrame, treeFrame } from '../art/atlas';
import { buildingFrameSize, buildingPlacement, project } from '../iso';

interface Item {
  x: number;
  y: number;
  frame: string;
  sortY: number;
  scale: number;
  originX: number;
  originY: number;
}

/** Prostokąt sprite'a budynku na ekranie-świecie – do trafiania dotykiem w dach/ściany, nie tylko w podstawę. */
export interface HitRect {
  uid: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  sortY: number;
}

const CAPACITY = 2200;
const TREE_H = 192;

export class ObjectLayer {
  readonly layer: Phaser.GameObjects.SpriteGPULayer;
  private key = '';
  hits: HitRect[] = [];

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
        const c = project(x + 0.5, y + 0.5);
        if (tree) {
          items.push({ x: c.x, y: c.y, frame: treeFrame(tree === 1 ? 'oak' : 'pine', cal.season), sortY: c.y, scale: 1.35, originX: 0.5, originY: (TREE_H - 14) / TREE_H });
        } else if (this.world.forage[i] && revealed.has(chunkOfTile(x, y)) && (state.world.forage[String(i)] ?? -1) <= cal.day) {
          items.push({ x: c.x, y: c.y, frame: 'icon_forage', sortY: c.y, scale: 0.8, originX: 0.5, originY: 0.75 });
        }
      }
    }
    this.hits = [];
    for (const o of state.objects) {
      const def = this.content.buildings[o.type];
      if (!def || def.kind === 'path') continue;
      const p = buildingPlacement(def, o.x, o.y);
      items.push({ x: p.x, y: p.y, frame: buildingFrame(o.type), sortY: p.sortY, scale: p.scale, originX: p.originX, originY: p.originY });
      const size = buildingFrameSize(def);
      const x0 = p.x - size.w * p.originX * p.scale;
      const y0 = p.y - size.h * p.originY * p.scale;
      this.hits.push({ uid: o.uid, x0, y0, x1: x0 + size.w * p.scale, y1: y0 + size.h * p.scale, sortY: p.sortY });
    }
    items.sort((a, b) => a.sortY - b.sortY);

    if (this.layer.memberCount) this.layer.removeMembers(0, this.layer.memberCount);
    for (const it of items.slice(0, CAPACITY)) {
      this.layer.addMember({ x: it.x, y: it.y, frame: it.frame, originX: it.originX, originY: it.originY, scaleX: it.scale, scaleY: it.scale });
    }
  }

  /** Budynek pod punktem (najbliższy widza, czyli o największej głębi). */
  hit(wx: number, wy: number): number | null {
    let best: HitRect | null = null;
    for (const r of this.hits) {
      if (wx >= r.x0 && wx <= r.x1 && wy >= r.y0 && wy <= r.y1 && (!best || r.sortY > best.sortY)) best = r;
    }
    return best?.uid ?? null;
  }
}
