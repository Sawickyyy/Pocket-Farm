// Drzewa, miejsca zbieractwa, budynki i dekoracje na jednej SpriteGPULayer posortowanej po głębi izometrycznej.
// Bufor przebudowujemy tylko, gdy zmieni się układ (budowa, sezon, odrośnięcie zbiorów).

import type Phaser from 'phaser';
import type { Content } from '../../content/content';
import type { Calendar, GameState } from '../../sim/types';
import { MAP_H, MAP_W, VILLAGE_DECO, VILLAGE_HOUSES, chunkOfTile, tileIndex, type WorldMap } from '../../sim/world';
import { SPRITES_KEY, buildingFrame, houseDef, houseFrame, treeFrame } from '../art/atlas';
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

const CAPACITY = 4200;
const TREE_H = 192;

export class ObjectLayer {
  readonly layer: Phaser.GameObjects.SpriteGPULayer;
  private key = '';
  private last: { state: GameState; cal: Calendar } | null = null;
  /** Budynki w trakcie animacji postawienia (rysowane osobnym obrazkiem). */
  private readonly popping = new Set<number>();
  hits: HitRect[] = [];
  /** Domy mieszkańców (stałe) – dotknięcie otwiera wioskę. */
  private readonly houseHits: (Omit<HitRect, 'uid'> & { npc: string })[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
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
    this.last = { state, cal };
    const key = `${[...this.popping].join(',')}|${cal.season}|${state.world.revealed.length}|${forageKey}|${state.objects.map((o) => `${o.uid}:${o.type}:${o.x}:${o.y}`).join(';')}`;
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
      if (!this.popping.has(o.uid)) items.push({ x: p.x, y: p.y, frame: buildingFrame(o.type), sortY: p.sortY, scale: p.scale, originX: p.originX, originY: p.originY });
      const size = buildingFrameSize(def);
      const x0 = p.x - size.w * p.originX * p.scale;
      const y0 = p.y - size.h * p.originY * p.scale;
      this.hits.push({ uid: o.uid, x0, y0, x1: x0 + size.w * p.scale, y1: y0 + size.h * p.scale, sortY: p.sortY });
    }
    this.houseHits.length = 0;
    for (const hs of VILLAGE_HOUSES) {
      const npc = this.content.npc[hs.npc];
      if (!npc) continue;
      const def = houseDef(npc);
      const p = buildingPlacement(def, hs.x, hs.y);
      items.push({ x: p.x, y: p.y, frame: houseFrame(hs.npc), sortY: p.sortY, scale: p.scale, originX: p.originX, originY: p.originY });
      const size = buildingFrameSize(def);
      const x0 = p.x - size.w * p.originX * p.scale;
      const y0 = p.y - size.h * p.originY * p.scale;
      this.houseHits.push({ npc: hs.npc, x0, y0, x1: x0 + size.w * p.scale, y1: y0 + size.h * p.scale, sortY: p.sortY });
    }
    for (const d of VILLAGE_DECO) {
      const def = this.content.buildings[d.type];
      if (!def) continue;
      const p = buildingPlacement(def, d.x, d.y);
      items.push({ x: p.x, y: p.y, frame: buildingFrame(d.type), sortY: p.sortY, scale: p.scale, originX: p.originX, originY: p.originY });
    }
    items.sort((a, b) => a.sortY - b.sortY);

    if (this.layer.memberCount) this.layer.removeMembers(0, this.layer.memberCount);
    for (const it of items.slice(0, CAPACITY)) {
      this.layer.addMember({ x: it.x, y: it.y, frame: it.frame, originX: it.originX, originY: it.originY, scaleX: it.scale, scaleY: it.scale });
    }
  }

  /**
   * Postawienie budynku z „aktorstwem”: spada z lekkim rozciągnięciem, spłaszcza się przy uderzeniu
   * o ziemię i sprężyście wraca do kształtu (origin w podstawie, więc dół zostaje na miejscu).
   */
  bounce(uid: number, state: GameState): void {
    const o = state.objects.find((x) => x.uid === uid);
    const def = o && this.content.buildings[o.type];
    if (!o || !def || def.kind === 'path') return;
    const p = buildingPlacement(def, o.x, o.y);
    const sc = p.scale;
    this.popping.add(uid);
    if (this.last) this.sync(this.last.state, this.last.cal);
    const img = this.scene.add
      .image(p.x, p.y - 140, SPRITES_KEY, buildingFrame(o.type))
      .setOrigin(p.originX, p.originY)
      .setScale(sc * 0.9, sc * 1.12)
      .setAlpha(0.6)
      .setDepth(21)
      .setLighting(true);
    this.scene.tweens.chain({
      targets: img,
      tweens: [
        { y: p.y, alpha: 1, duration: 230, ease: 'Quad.easeIn' },
        { scaleX: sc * 1.14, scaleY: sc * 0.84, duration: 90, ease: 'Quad.easeOut' },
        { scaleX: sc * 0.96, scaleY: sc * 1.05, duration: 130, ease: 'Quad.easeInOut' },
        { scaleX: sc, scaleY: sc, duration: 200, ease: 'Back.easeOut' },
      ],
      onComplete: () => {
        img.destroy();
        this.popping.delete(uid);
        if (this.last) this.sync(this.last.state, this.last.cal);
      },
    });
  }

  /** Dom mieszkańca pod punktem. */
  houseAt(wx: number, wy: number): string | null {
    let best: (typeof this.houseHits)[number] | null = null;
    for (const r of this.houseHits) {
      if (wx >= r.x0 && wx <= r.x1 && wy >= r.y0 && wy <= r.y1 && (!best || r.sortY > best.sortY)) best = r;
    }
    return best?.npc ?? null;
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
