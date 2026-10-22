// Teren osady (docs/plan-osada.md §2, §15): zawsze delikatny, przerywany, ciepło-złoty obrys granicy na ziemi;
// w trybie terenu – fragmenty do kupienia podświetlone z ceną (etykiety o stałym rozmiarze na ekranie),
// niedostępne przygaszone, obce (wioska) zakreskowane.

import type Phaser from 'phaser';
import type { Content } from '../../content/content';
import { fmt } from '../../i18n/i18n';
import { buyableChunks, canBuyTerritory, chunkRect, territoryCost } from '../../sim/systems/settlement/territory';
import type { GameState } from '../../sim/types';
import { CHUNK, CHUNKS_X, CHUNKS_Y } from '../../sim/world';
import { SPRITES_KEY, TILE } from '../art/atlas';
import { project } from '../iso';

export type ChunkLabelState = 'ok' | 'poor' | 'locked' | 'foreign';

export interface ChunkLabel {
  chunk: number;
  /** Środek fragmentu w kaflach. */
  x: number;
  y: number;
  cost: number;
  state: ChunkLabelState;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Granica zbioru fragmentów w kaflach: krawędzie bez sąsiada w zbiorze, współliniowe połączone. */
export function territoryEdges(territory: readonly number[]): Segment[] {
  const own = new Set(territory);
  const has = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < CHUNKS_X && cy < CHUNKS_Y && own.has(cx + cy * CHUNKS_X);
  const horiz = new Map<number, number[]>(); // y → lista x początków odcinków długości CHUNK
  const vert = new Map<number, number[]>(); // x → lista y
  const push = (m: Map<number, number[]>, k: number, v: number) => {
    const l = m.get(k);
    if (l) l.push(v);
    else m.set(k, [v]);
  };
  for (const c of own) {
    const cx = c % CHUNKS_X;
    const cy = Math.floor(c / CHUNKS_X);
    if (!has(cx, cy - 1)) push(horiz, cy * CHUNK, cx * CHUNK);
    if (!has(cx, cy + 1)) push(horiz, (cy + 1) * CHUNK, cx * CHUNK);
    if (!has(cx - 1, cy)) push(vert, cx * CHUNK, cy * CHUNK);
    if (!has(cx + 1, cy)) push(vert, (cx + 1) * CHUNK, cy * CHUNK);
  }
  const out: Segment[] = [];
  const merge = (m: Map<number, number[]>, make: (k: number, a: number, b: number) => Segment) => {
    for (const [k, list] of [...m].sort((a, b) => a[0] - b[0])) {
      list.sort((a, b) => a - b);
      let start = list[0]!;
      let end = start + CHUNK;
      for (let i = 1; i < list.length; i++) {
        const v = list[i]!;
        if (v === end) end += CHUNK;
        else {
          out.push(make(k, start, end));
          start = v;
          end = v + CHUNK;
        }
      }
      out.push(make(k, start, end));
    }
  };
  merge(horiz, (y, a, b) => ({ x1: a, y1: y, x2: b, y2: y }));
  merge(vert, (x, a, b) => ({ x1: x, y1: a, x2: x, y2: b }));
  return out;
}

/** Kreski linii przerywanej wzdłuż odcinka (te same jednostki co odcinek). */
export function dashSegments(s: Segment, dash: number, gap: number): Segment[] {
  const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  if (len <= 0) return [];
  const ux = (s.x2 - s.x1) / len;
  const uy = (s.y2 - s.y1) / len;
  const out: Segment[] = [];
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(len, d + dash);
    out.push({ x1: s.x1 + ux * d, y1: s.y1 + uy * d, x2: s.x1 + ux * e, y2: s.y1 + uy * e });
  }
  return out;
}

/** Etykiety trybu terenu: fragmenty do kupienia (z ceną i dostępnością) i obce fragmenty przy granicy. */
export function territoryLabels(s: GameState, c: Content): ChunkLabel[] {
  const cost = territoryCost(c, s.settlement.bought);
  const out: ChunkLabel[] = [];
  const center = (chunk: number) => {
    const r = chunkRect(chunk);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };
  for (const chunk of buyableChunks(s, c)) {
    const check = canBuyTerritory(s, c, chunk);
    const state: ChunkLabelState = check.ok ? 'ok' : check.reason === 'no-coins' ? 'poor' : 'locked';
    out.push({ chunk, ...center(chunk), cost, state });
  }
  for (const chunk of c.settlement.foreignChunks) {
    if (!s.world.revealed.includes(chunk)) continue;
    out.push({ chunk, ...center(chunk), cost: 0, state: 'foreign' });
  }
  return out;
}

/** Skala etykiety dla stałego rozmiaru na ekranie (projekt w px urządzenia przy zoomie 1 i dpr 2,2). */
export const labelScale = (zoom: number, dpr: number): number => dpr / 2.2 / Math.max(0.05, zoom);

const GOLD = 0xf2b632;
const GOLD_DEEP = 0x8a5a1a;
const INK = 0x4a2e1a;

interface LabelView {
  root: Phaser.GameObjects.Container;
  text: Phaser.GameObjects.Text | null;
}

export class TerritoryLayer {
  /** Fragmenty trybu terenu (pod granicą) i sama granica. */
  private readonly fill: Phaser.GameObjects.Graphics;
  private readonly border: Phaser.GameObjects.Graphics;
  private readonly labels: LabelView[] = [];
  private mode = false;
  private borderKey = '';
  private modeKey = '';
  private scale = 0;
  private resolution = 0;
  private state: GameState | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    flat: Phaser.GameObjects.Container,
    private readonly content: Content,
    private readonly dpr: () => number,
  ) {
    this.fill = scene.add.graphics().setVisible(false);
    this.border = scene.add.graphics();
    // Tuż nad kaflami ziemi (pod zasięgiem usług, podświetleniem i duchem budowy).
    flat.addAt(this.border, 1);
    flat.addAt(this.fill, 1);
  }

  get active(): boolean {
    return this.mode;
  }

  setMode(on: boolean): void {
    if (on === this.mode) return;
    this.mode = on;
    this.modeKey = '';
    if (!on) this.clearMode();
    if (this.state) this.sync(this.state);
  }

  sync(state: GameState): void {
    this.state = state;
    const st = state.settlement;
    const bKey = st.territory.join(',');
    if (bKey !== this.borderKey) {
      this.borderKey = bKey;
      this.drawBorder(st.territory);
    }
    if (!this.mode) return;
    const labels = territoryLabels(state, this.content);
    const mKey = labels.map((l) => `${l.chunk}:${l.state}:${l.cost}`).join(',') + `|${bKey}`;
    if (mKey === this.modeKey) return;
    this.modeKey = mKey;
    this.drawMode(st.territory, labels);
  }

  /** Stały rozmiar etykiet na ekranie (wołane przy zmianie zoomu). */
  updateScale(zoom: number, dpr: number): void {
    if (!this.labels.length) return;
    const scale = labelScale(zoom, dpr);
    if (Math.abs(scale - this.scale) < 0.001) return;
    this.scale = scale;
    // Ostrość tekstu przy powiększeniu: rozdzielczość płótna tekstu w krokach co 0,5.
    const res = Math.min(4, Math.max(1, Math.ceil(scale * 2) / 2));
    const reres = res !== this.resolution;
    this.resolution = res;
    for (const l of this.labels) {
      l.root.setScale(scale);
      if (reres) l.text?.setResolution(res);
    }
  }

  // ------------------------------------------------------------- rysowanie

  private drawBorder(territory: readonly number[]): void {
    const g = this.border.clear();
    const edges = territoryEdges(territory);
    const own = new Set(territory);
    const band = TILE * 0.9;
    // Ciepła poświata po wewnętrznej stronie granicy (gradient krycia).
    for (const e of edges) {
      const x = Math.min(e.x1, e.x2) * TILE;
      const y = Math.min(e.y1, e.y2) * TILE;
      if (e.y1 === e.y2) {
        const w = Math.abs(e.x2 - e.x1) * TILE;
        const inside = own.has(Math.floor((e.x1 + 0.5) / CHUNK) + Math.floor(e.y1 / CHUNK) * CHUNKS_X);
        if (inside) g.fillGradientStyle(GOLD, GOLD, GOLD, GOLD, 0.3, 0.3, 0, 0).fillRect(x, y, w, band);
        else g.fillGradientStyle(GOLD, GOLD, GOLD, GOLD, 0, 0, 0.3, 0.3).fillRect(x, y - band, w, band);
      } else {
        const h = Math.abs(e.y2 - e.y1) * TILE;
        const inside = own.has(Math.floor(e.x1 / CHUNK) + Math.floor((e.y1 + 0.5) / CHUNK) * CHUNKS_X);
        if (inside) g.fillGradientStyle(GOLD, GOLD, GOLD, GOLD, 0.3, 0, 0.3, 0).fillRect(x, y, band, h);
        else g.fillGradientStyle(GOLD, GOLD, GOLD, GOLD, 0, 0.3, 0, 0.3).fillRect(x - band, y, band, h);
      }
    }
    // Ciemniejszy podkład i złote kreski (period 128 px = 1/8 fragmentu, więc kreski łączą się na stykach).
    g.lineStyle(18, GOLD_DEEP, 0.35);
    for (const e of edges) g.lineBetween(e.x1 * TILE, e.y1 * TILE, e.x2 * TILE, e.y2 * TILE);
    g.lineStyle(11, GOLD, 0.95);
    for (const e of edges) {
      for (const d of dashSegments({ x1: e.x1 * TILE, y1: e.y1 * TILE, x2: e.x2 * TILE, y2: e.y2 * TILE }, 80, 48)) g.lineBetween(d.x1, d.y1, d.x2, d.y2);
    }
  }

  private clearMode(): void {
    this.fill.clear().setVisible(false);
    for (const l of this.labels) l.root.destroy();
    this.labels.length = 0;
    this.scale = 0;
  }

  private drawMode(territory: readonly number[], labels: ChunkLabel[]): void {
    this.clearMode();
    const g = this.fill.setVisible(true);
    const S = CHUNK * TILE;
    // Własny teren: ledwo widoczne złote zabarwienie.
    for (const c of territory) {
      const r = chunkRect(c);
      g.fillStyle(GOLD, 0.08).fillRect(r.x * TILE, r.y * TILE, S, S);
    }
    for (const l of labels) {
      const r = chunkRect(l.chunk);
      const x0 = r.x * TILE;
      const y0 = r.y * TILE;
      if (l.state === 'foreign') {
        g.fillStyle(0xc0503a, 0.1).fillRect(x0, y0, S, S);
        g.lineStyle(10, 0xc0503a, 0.35);
        for (let k = 96; k < 2 * S; k += 128) g.lineBetween(x0 + Math.min(k, S), y0 + Math.max(0, k - S), x0 + Math.max(0, k - S), y0 + Math.min(k, S));
      } else if (l.state === 'ok') {
        g.fillStyle(0xffe08a, 0.3).fillRect(x0, y0, S, S);
        g.lineStyle(14, 0xfff3c4, 0.95).strokeRect(x0 + 20, y0 + 20, S - 40, S - 40);
      } else {
        g.fillStyle(0x6b5a48, 0.22).fillRect(x0, y0, S, S);
        g.lineStyle(10, 0xe9dcc4, 0.55).strokeRect(x0 + 20, y0 + 20, S - 40, S - 40);
      }
      this.labels.push(this.makeLabel(l));
    }
    this.updateScale(this.scene.cameras.main.zoom, this.dpr());
  }

  /** Etykieta: papierowa pigułka z monetą i ceną (albo kłódką), stały rozmiar na ekranie. */
  private makeLabel(l: ChunkLabel): LabelView {
    const at = project(l.x, l.y);
    const root = this.scene.add.container(at.x, at.y).setDepth(62);
    const dim = l.state !== 'ok';
    let text: Phaser.GameObjects.Text | null = null;
    const icon = l.state === 'locked' || l.state === 'foreign' ? 'icon_lock' : 'p_coin';
    const img = this.scene.add.image(0, 0, SPRITES_KEY, icon).setScale(icon === 'p_coin' ? 1.5 : 0.62);
    let w = 64;
    if (l.state !== 'foreign') {
      text = this.scene.add
        .text(0, 0, fmt(l.cost), { fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '34px', fontStyle: 'bold', color: dim ? '#8a7a68' : '#4a2e1a' })
        .setOrigin(0, 0.5);
      w = 52 + text.width + 26;
    }
    const h = 64;
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x3a2414, 0.28).fillRoundedRect(-w / 2 + 2, -h / 2 + 6, w, h, h / 2);
    bg.fillStyle(dim ? 0xebe1d1 : 0xfff6e2, 1).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    bg.lineStyle(4, dim ? 0x8a7a68 : INK, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    if (!dim) bg.fillStyle(0xffffff, 0.55).fillRoundedRect(-w / 2 + 10, -h / 2 + 6, w - 20, 12, 6);
    root.add(bg);
    if (text) {
      img.setPosition(-w / 2 + 34, 0).setAlpha(dim ? 0.65 : 1);
      text.setPosition(-w / 2 + 58, 1);
      root.add([img, text]);
    } else root.add(img);
    return { root, text };
  }
}

export const TERRITORY_COLORS = { GOLD, GOLD_DEEP, INK } as const;
