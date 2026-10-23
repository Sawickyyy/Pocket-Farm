// Nakładka zasięgu usług (docs/plan-osada.md §7, §9): kafle w zasięgu działających budynków danego rodzaju
// zabarwione kolorem usługi, obrysy promieni oraz podgląd zasięgu budynku przed postawieniem (duch budowy).
// Leży na ziemi – rysowana w kontenerze płaskiej ziemi (współrzędne kafel × TILE).

import type Phaser from 'phaser';
import { COVERAGE_KINDS, type Content, type CoverageKind } from '../../content/content';
import { centerOf, coverage, isBuilt, isOperational, staffing } from '../../sim/systems/settlement/common';
import type { GameState } from '../../sim/types';
import { MAP_H, MAP_W, chunkOfTile } from '../../sim/world';
import { TILE } from '../art/atlas';

/** Kolory rodzajów usług (bez fioletu – pilnuje tests/sceneTown.test.ts i tests/theme.test.ts). */
export const COVERAGE_COLORS: Readonly<Record<CoverageKind, number>> = {
  police: 0x3d8bfd,
  fire: 0xf0503c,
  clinic: 0x3fbf6a,
  school: 0xf5c518,
  fun: 0xff9a3c,
  water: 0x4fc3f7,
  light: 0xffd166,
  market: 0xff6fa5,
};

/** Jasny podkład linii (papier motywu). */
const CREAM = 0xfff8e6;

export const isCoverageKind = (kind: string | undefined): kind is CoverageKind => !!kind && (COVERAGE_KINDS as readonly string[]).includes(kind);

/** Kafle w promieniu `r` od środka (cx, cy) – ta sama reguła co w common.coverage (środek kafla, odległość euklidesowa). */
export function tilesInRadius(cx: number, cy: number, r: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (r <= 0) return out;
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(MAP_H - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(MAP_W - 1, Math.ceil(cx + r)); x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) out.push({ x, y });
    }
  }
  return out;
}

/** Krycie zabarwienia kafla dla wartości pokrycia 0..1 (zero = brak koloru). */
export const coverageAlpha = (v: number): number => (v <= 0 ? 0 : 0.24 + 0.24 * Math.min(1, v));

/**
 * Poziome odcinki kafli o tym samym (skwantowanym) kryciu – mniej prostokątów do narysowania.
 * Zwraca [x, y, długość, krycie].
 */
export function coverageRuns(map: ArrayLike<number>, w = MAP_W, h = MAP_H): [number, number, number, number][] {
  const runs: [number, number, number, number][] = [];
  for (let y = 0; y < h; y++) {
    let start = -1;
    let alpha = 0;
    for (let x = 0; x <= w; x++) {
      const a = x < w ? Math.round(coverageAlpha(map[y * w + x] ?? 0) * 50) / 50 : 0;
      if (a !== alpha || x === w) {
        if (start >= 0 && alpha > 0) runs.push([start, y, x - start, alpha]);
        start = x;
        alpha = a;
      }
    }
  }
  return runs;
}

/**
 * Odcinki kafli bez pokrycia w odkrytym terenie – przygaszamy je, żeby obszar w zasięgu „świecił”.
 * `open(x, y)` mówi, czy kafel jest odkryty. Zwraca [x, y, długość].
 */
export function gapRuns(map: ArrayLike<number>, open: (x: number, y: number) => boolean, w = MAP_W, h = MAP_H): [number, number, number][] {
  const runs: [number, number, number][] = [];
  for (let y = 0; y < h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const gap = x < w && (map[y * w + x] ?? 0) <= 0 && open(x, y);
      if (gap && start < 0) start = x;
      else if (!gap && start >= 0) {
        runs.push([start, y, x - start]);
        start = -1;
      }
    }
  }
  return runs;
}

/** Przygaszenie terenu poza zasięgiem (ciepły brąz, nie czerń). */
export const VEIL = { color: 0x3a2414, alpha: 0.24 } as const;

export interface CoveragePreviewSpec {
  type: string;
  x: number;
  y: number;
}

export class CoverageLayer {
  readonly gfx: Phaser.GameObjects.Graphics;
  private kind: CoverageKind | null = null;
  private preview: CoveragePreviewSpec | null = null;
  private key = '';
  private state: GameState | null = null;

  constructor(
    scene: Phaser.Scene,
    flat: Phaser.GameObjects.Container,
    private readonly content: Content,
  ) {
    this.gfx = scene.add.graphics().setVisible(false);
    // Nad kaflami ziemi, pod podświetleniem i duchem budowy.
    flat.addAt(this.gfx, 1);
  }

  get active(): CoverageKind | null {
    return this.kind;
  }

  set(kind: CoverageKind | null, preview: CoveragePreviewSpec | null): void {
    this.kind = kind;
    this.preview = kind ? preview : null;
    if (this.state) this.sync(this.state);
  }

  sync(state: GameState): void {
    this.state = state;
    const kind = this.kind;
    if (!kind) {
      if (this.key !== '') {
        this.key = '';
        this.gfx.clear().setVisible(false);
      }
      return;
    }
    // Podpis: budynki tego rodzaju (miejsce, obsada, stan) + podgląd.
    let key = `${kind}|${state.world.revealed.length}|${this.preview ? `${this.preview.type}:${this.preview.x}:${this.preview.y}` : ''}`;
    for (const o of state.objects) {
      if (this.content.buildings[o.type]?.service?.kind !== kind) continue;
      key += `|${o.uid}:${o.x}:${o.y}:${Math.round(staffing(state, this.content, o.uid) * 20)}:${isBuilt(state, o.uid) ? 1 : 0}`;
    }
    if (key === this.key) return;
    this.key = key;
    this.draw(state, kind);
  }

  private draw(state: GameState, kind: CoverageKind): void {
    const g = this.gfx.clear().setVisible(true);
    const color = COVERAGE_COLORS[kind];
    const map = coverage(state, this.content, kind);
    // Poza zasięgiem (w odkrytym terenie) – lekkie przygaszenie, w zasięgu – kolor usługi.
    const revealed = new Set(state.world.revealed);
    const open = (x: number, y: number) => revealed.has(chunkOfTile(x, y));
    g.fillStyle(VEIL.color, VEIL.alpha);
    for (const [x, y, len] of gapRuns(map, open)) g.fillRect(x * TILE, y * TILE, len * TILE, TILE);
    // Kafle w zasięgu działających budynków (wartość = max value × obsada).
    for (const [x, y, len, alpha] of coverageRuns(map)) {
      g.fillStyle(color, alpha).fillRect(x * TILE, y * TILE, len * TILE, TILE);
    }
    // Obrysy promieni: ciągły dla działających z obsadą, przerywany dla nieczynnych (budowa, brak obsady).
    for (const o of state.objects) {
      const def = this.content.buildings[o.type];
      const sv = def?.service;
      if (!def || sv?.kind !== kind || sv.radius <= 0) continue;
      const c = centerOf(this.content, o);
      const working = isOperational(state, o.uid) && staffing(state, this.content, o.uid) > 0;
      // jasny podkład pod kolorową linią – czytelna na trawie, piasku i nocą
      if (working) {
        g.lineStyle(20, CREAM, 0.7).strokeCircle(c.x * TILE, c.y * TILE, sv.radius * TILE);
        g.lineStyle(11, color, 0.95).strokeCircle(c.x * TILE, c.y * TILE, sv.radius * TILE);
      } else {
        dashedCircle(g, c.x * TILE, c.y * TILE, sv.radius * TILE, 20, CREAM, 0.6);
        dashedCircle(g, c.x * TILE, c.y * TILE, sv.radius * TILE, 11, color, 0.9);
      }
      // znacznik środka
      g.fillStyle(CREAM, 0.9).fillCircle(c.x * TILE, c.y * TILE, 26);
      g.fillStyle(color, 1).fillCircle(c.x * TILE, c.y * TILE, 18);
    }
    const p = this.preview;
    const def = p && this.content.buildings[p.type];
    const sv = def?.service;
    if (p && def && sv && sv.radius > 0) {
      const cx = p.x + def.size[0] / 2;
      const cy = p.y + def.size[1] / 2;
      g.fillStyle(color, 0.3);
      for (const t of tilesInRadius(cx, cy, sv.radius)) g.fillRect(t.x * TILE, t.y * TILE, TILE, TILE);
      // jasna obwódka pod kolorową – czytelna na każdym biomie
      g.lineStyle(22, CREAM, 0.85).strokeCircle(cx * TILE, cy * TILE, sv.radius * TILE);
      g.lineStyle(12, color, 1).strokeCircle(cx * TILE, cy * TILE, sv.radius * TILE);
    }
  }
}

/** Okrąg przerywany (Graphics nie ma linii przerywanych). */
export function dashedCircle(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, width: number, color: number, alpha: number): void {
  const n = Math.max(12, Math.round((2 * Math.PI * r) / 90));
  const step = (Math.PI * 2) / n;
  g.lineStyle(width, color, alpha);
  for (let i = 0; i < n; i++) {
    g.beginPath();
    g.arc(cx, cy, r, i * step, i * step + step * 0.55);
    g.strokePath();
  }
}
