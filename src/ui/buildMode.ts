// Tryb budowania: „duch” budynku pod palcem, wybór wyglądu (warianty domów), rysowanie dróg linią,
// walidacja na żywo z powodem odmowy, potwierdzenie/anulowanie (docs/plan-osada.md §2–§3, §15).

import { CONTENT, COVERAGE_KINDS, type BuildingDef, type Content, type CoverageKind } from '../content/content';
import { buildingName, fmt, itemName, t } from '../i18n/i18n';
import { itemIconUrl } from '../render/art/atlas';
import { stylize } from '../render/art/palette';
import { drawSettlementBuilding } from '../render/art/settlementArt';
import { boxFrameSize, verticalExtent } from '../render/iso';
import { countItem } from '../sim/ctx';
import { canPlace, placeCost } from '../sim/systems/building';
import { chunkRect } from '../sim/systems/settlement/territory';
import type { GameState } from '../sim/types';
import { FIELD, generateWorld, type WorldMap } from '../sim/world';
import type { Ghost } from '../render/FarmScene';
import type { App } from './app';
import { $, h } from './dom';
import { plural } from './format';
import { ic, icEl } from './uiIcons';
import { viewCtx } from './view';

// ---------------------------------------------------------------- czyste pomocniki (testowane)

export interface TileXY {
  x: number;
  y: number;
}

/** Najdłuższa linia rysowana jednym pociągnięciem (kafle). */
export const MAX_LINE = 64;

/**
 * Linia drogi w kształcie L od `a` do `b`: najpierw dłuższa oś (przy remisie poziomo), potem krótsza.
 * Deterministyczna, bez powtórzeń kafli, najwyżej MAX_LINE kafli.
 */
export function lineTiles(a: TileXY, b: TileXY): TileXY[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const out: TileXY[] = [];
  const push = (x: number, y: number) => {
    if (out.length < MAX_LINE) out.push({ x, y });
  };
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  if (Math.abs(dx) >= Math.abs(dy)) {
    for (let i = 0; i <= Math.abs(dx); i++) push(a.x + i * sx, a.y);
    for (let j = 1; j <= Math.abs(dy); j++) push(b.x, a.y + j * sy);
  } else {
    for (let j = 0; j <= Math.abs(dy); j++) push(a.x, a.y + j * sy);
    for (let i = 1; i <= Math.abs(dx); i++) push(a.x + i * sx, b.y);
  }
  return out;
}

/** Budynki stawiane linią (ścieżki, drogi, most). */
export const isLineDef = (def: BuildingDef | undefined): boolean => def?.kind === 'path' || def?.kind === 'bridge';

/** Powody odmowy wspólne dla całej mapy – szukanie miejsca nie ma wtedy sensu. */
const GLOBAL_FAILS = new Set(['invalid', 'tier-too-low', 'unique']);

/**
 * Najbliższe punktu `near` wolne miejsce na terenie osady (lewy górny róg budynku) albo null.
 * canPlace zawsze z przekazanym WorldMap; kandydaci w kolejności odległości, więc zwykle wystarczy kilka prób.
 */
export function findFreeSpot(s: GameState, c: Content, world: WorldMap, type: string, near: TileXY): TileXY | null {
  const def = c.buildings[type];
  if (!def) return null;
  const [w, hgt] = def.size;
  const seen = new Set<number>();
  const cand: { x: number; y: number; d: number }[] = [];
  for (const chunk of s.settlement.territory) {
    const r = chunkRect(chunk);
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const key = y * 1024 + x;
        if (seen.has(key)) continue;
        seen.add(key);
        cand.push({ x, y, d: Math.hypot(x + w / 2 - near.x, y + hgt / 2 - near.y) });
      }
    }
  }
  cand.sort((p, q) => p.d - q.d || p.y - q.y || p.x - q.x);
  for (const p of cand) {
    const r = canPlace(s, c, type, p.x, p.y, -1, world);
    if (r.ok) return { x: p.x, y: p.y };
    if (GLOBAL_FAILS.has(r.reason)) return null;
  }
  return null;
}

// ---------------------------------------------------------------- wspólne zasoby UI osady

let worldCache: WorldMap | null = null;

/** Mapa świata dla walidacji w UI – generowana raz na seed. */
export function worldFor(seed: number): WorldMap {
  if (worldCache?.seed !== seed) worldCache = generateWorld(seed);
  return worldCache;
}

/** Wzajemne wyłączanie trybów mapy: budowanie ↔ teren. */
export const mapModes: { exitBuild?: () => void; exitTerritory?: () => void } = {};

const thumbCache = new Map<string, string>();

/** Miniatura wariantu wyglądu budynku osady (data URL, w pamięci podręcznej). */
export function styleThumbUrl(def: BuildingDef, style: number, size = 96): string {
  const key = `${def.id}:${style}@${size}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  const frame = boxFrameSize(def.size[0], def.size[1], verticalExtent(def));
  const url = stylize(
    (ctx) => {
      const k = Math.min(size / frame.w, size / frame.h) * 0.92;
      ctx.translate((size - frame.w * k) / 2, (size - frame.h * k) / 2);
      ctx.scale(k, k);
      drawSettlementBuilding(ctx, def, style, 0, 0, CONTENT);
    },
    size,
    size,
    { outline: Math.max(2, Math.round(size / 40)), shade: true },
  ).toDataURL('image/png');
  thumbCache.set(key, url);
  return url;
}

/** Usługa z mapą pokrycia (do podglądu zasięgu). */
export const coverageKindOf = (def: BuildingDef | undefined): CoverageKind | null => {
  const k = def?.service?.kind;
  return k && (COVERAGE_KINDS as readonly string[]).includes(k) ? (k as CoverageKind) : null;
};

/** Krótki opis efektu usługi budynku (pasek budowy, katalog, panel budynku). */
export function serviceEffect(def: BuildingDef): string {
  const sv = def.service;
  if (!sv) return '';
  return t(`buildTown.effect.${sv.kind}`, { r: sv.radius, v: sv.value ?? 0, d: CONTENT.settlement.constants.offroadDistanceDepot });
}

/** „n kafli” z polską odmianą. */
export function tilesText(n: number): string {
  return t(plural(n, 'buildTown.tiles.one', 'buildTown.tiles.few', 'buildTown.tiles.many'), { n });
}

// ---------------------------------------------------------------- nakładka zasięgu (z panelu budynku)

let coverageChip: HTMLElement | null = null;

/** Pokazuje zasięg usługi na mapie (kamera nad budynkiem `at`) z plakietką „ukryj” u góry ekranu. */
export function showCoverage(app: App, kind: CoverageKind, label: string, at?: TileXY): void {
  const scene = app.scene();
  scene?.setCoverage(kind);
  if (at) scene?.focusTile(at.x, at.y);
  if (!coverageChip) {
    const text = h('span');
    const close = h('button', {
      class: 'bt-coverage-close m-ceramic',
      type: 'button',
      attrs: { 'aria-label': t('buildTown.coverage.hide') },
      on: {
        click: () => {
          app.click();
          hideCoverage(app);
        },
      },
    });
    close.append(icEl('close'));
    coverageChip = h('div', { class: 'bt-coverage m-wood', attrs: { role: 'status' } }, icEl('eye'), text, close);
    $('#build-bar').after(coverageChip);
  }
  coverageChip.querySelector('span')!.textContent = t('buildTown.coverage.showing', { name: label });
  coverageChip.querySelector('button')!.setAttribute('aria-label', t('buildTown.coverage.hide'));
  coverageChip.hidden = false;
}

export function hideCoverage(app: App): void {
  if (coverageChip && !coverageChip.hidden) {
    coverageChip.hidden = true;
    app.scene()?.setCoverage(null);
  }
}

// ---------------------------------------------------------------- tryb budowania

interface LineTile extends TileXY {
  valid: boolean;
}

interface BuildState {
  mode: 'place' | 'move';
  type: string;
  uid?: number;
  x: number;
  y: number;
  style: number;
  /** Rysowana linia dróg (kafle z poprawnością) i jej początek. */
  line: LineTile[] | null;
  lineStart: TileXY | null;
  /** Po postawieniu serii (drogi, płoty): czekamy na kolejny gest – bez ducha i bez komunikatu o błędzie. */
  idle: boolean;
}

export class BuildMode {
  private st: BuildState | null = null;
  private busy = false;
  private readonly bar = $('#build-bar');
  private readonly msg = $('#build-msg');
  private readonly confirmBtn = $<HTMLButtonElement>('#build-confirm');
  private readonly removeBtn = $<HTMLButtonElement>('#build-remove');
  private readonly info = h('p', { class: 'bt-info' });
  private readonly styles = h('div', { class: 'bt-styles', attrs: { role: 'radiogroup' } });
  private readonly error = h('p', { class: 'bt-error', attrs: { role: 'status', 'aria-live': 'polite' } });
  /** Ostatnio wybrany wygląd danego typu (na kolejne budowy). */
  private readonly lastStyle = new Map<string, number>();
  private stylesFor = '';
  private infoHtml = '';

  constructor(private readonly app: App) {
    this.msg.after(this.info, this.styles);
    this.bar.append(this.error);
    $('#build-cancel').addEventListener('click', () => {
      app.click();
      this.exit();
    });
    this.confirmBtn.addEventListener('click', () => {
      app.click();
      void this.confirm();
    });
    this.removeBtn.addEventListener('click', () => {
      app.click();
      const uid = this.st?.uid;
      if (uid === undefined) return;
      void app.send({ type: 'remove', uid }).then((ok) => ok && this.exit());
    });
    mapModes.exitBuild = () => this.exit();
    // Stan mógł się zmienić (budowy, monety, etap) – odśwież poprawność, ale nie przy każdym ticku zegara.
    app.store.select(
      (s) => `${s.objects.length}|${s.nextUid}|${s.settlement.peakTier}|${s.settlement.territory.length}`,
      () => this.st && !this.busy && this.refreshLine(),
    );
    app.store.select(
      (s) => Math.floor(s.coins),
      () => this.st && !this.busy && this.show(),
    );
  }

  get active(): boolean {
    return this.st !== null;
  }

  private world(): WorldMap {
    return worldFor(this.app.store.get().seed);
  }

  /** Kafel na środku widocznej części mapy (albo środek pola farmy). */
  private viewCenter(): TileXY {
    const scene = this.app.scene();
    if (!scene) return { x: FIELD.x + FIELD.w / 2, y: FIELD.y - 2 };
    const v = scene.cam.viewport;
    const tl = scene.tileAt(v.width / 2, v.insetTop + (v.height - v.insetTop - v.insetBottom) / 2);
    return { x: tl.x + 0.5, y: tl.y + 0.5 };
  }

  /** Wolne miejsce przy nowym budynku: na terenie osady, najbliżej środka ekranu. */
  private freeSpot(type: string): TileXY {
    const s = this.app.store.get();
    const world = this.world();
    // Kandydaci to cały teren osady, więc brak miejsca przy środku ekranu = brak miejsca w ogóle.
    return findFreeSpot(s, CONTENT, world, type, this.viewCenter()) ?? { x: FIELD.x, y: FIELD.y - 3 };
  }

  start(type: string, style?: number): void {
    const def = CONTENT.buildings[type];
    if (!def) return;
    mapModes.exitTerritory?.();
    hideCoverage(this.app);
    const spot = this.freeSpot(type);
    const max = Math.max(1, def.styles ?? 1);
    const chosen = Math.min(max - 1, Math.max(0, style ?? this.lastStyle.get(type) ?? 0));
    this.st = { mode: 'place', type, x: spot.x, y: spot.y, style: chosen, line: null, lineStart: null, idle: false };
    this.show();
    this.app.scene()?.focusTile(spot.x, spot.y);
  }

  startMove(uid: number): void {
    const o = this.app.store.get().objects.find((v) => v.uid === uid);
    if (!o) return;
    mapModes.exitTerritory?.();
    hideCoverage(this.app);
    this.st = { mode: 'move', type: o.type, uid, x: o.x, y: o.y, style: o.style ?? 0, line: null, lineStart: null, idle: false };
    this.show();
    this.app.scene()?.focusTile(o.x, o.y);
  }

  exit(): void {
    if (!this.st) return;
    this.st = null;
    this.stylesFor = '';
    this.bar.hidden = true;
    this.app.scene()?.setGhost(null);
  }

  /**
   * Palec nad kaflem. 'tap' – budynek (albo pojedynczy kafel drogi) centrowany pod palcem;
   * 'start'/'move' – przeciąganie: drogi rysuje się linią od kafla 'start', reszta podąża za palcem.
   */
  pointTile(x: number, y: number, phase: 'tap' | 'start' | 'move' = 'tap'): void {
    const st = this.st;
    if (!st || this.busy) return;
    const def = CONTENT.buildings[st.type];
    const wasIdle = st.idle;
    st.idle = false;
    if (st.mode === 'place' && isLineDef(def) && phase !== 'tap') {
      if (phase === 'start' || !st.lineStart) st.lineStart = { x, y };
      else if (st.x === x && st.y === y && st.line) return;
      st.x = x;
      st.y = y;
      st.line = this.validate(lineTiles(st.lineStart, { x, y }));
      this.show();
      return;
    }
    const [w, hgt] = def?.size ?? [1, 1];
    const nx = Math.round(x - (w - 1) / 2);
    const ny = Math.round(y - (hgt - 1) / 2);
    if (!st.line && !wasIdle && nx === st.x && ny === st.y && phase === 'move') return;
    st.line = null;
    st.lineStart = null;
    st.x = nx;
    st.y = ny;
    this.show();
  }

  /** Koniec przeciągania: linia zostaje do potwierdzenia. */
  dragEnd(): void {
    if (this.st) this.st.lineStart = null;
  }

  private validate(tiles: TileXY[]): LineTile[] {
    const s = this.app.store.get();
    const world = this.world();
    return tiles.map((tl) => ({ ...tl, valid: canPlace(s, CONTENT, this.st!.type, tl.x, tl.y, -1, world).ok }));
  }

  private refreshLine(): void {
    const st = this.st;
    if (!st) return;
    if (st.line) st.line = this.validate(st.line);
    this.show();
  }

  private setStyle(style: number): void {
    const st = this.st;
    if (!st || st.style === style) return;
    this.app.click();
    st.style = style;
    if (st.mode === 'place') this.lastStyle.set(st.type, style);
    this.show();
  }

  /** Próbki wyglądu (ceramiczne guziki z miniaturą) – przebudowa tylko przy zmianie typu. */
  private renderStyles(def: BuildingDef): void {
    const st = this.st!;
    const n = def.styles ?? 1;
    // Przy przenoszeniu wygląd zmienia się w panelu budynku (restyle), nie tutaj.
    const show = n > 1 && st.mode === 'place';
    this.styles.hidden = !show;
    if (!show) return;
    if (this.stylesFor !== def.id) {
      this.stylesFor = def.id;
      this.styles.setAttribute('aria-label', t('buildTown.style'));
      this.styles.replaceChildren(
        h('span', { class: 'bt-styles-label', text: t('buildTown.style') }),
        ...Array.from({ length: n }, (_, i) =>
          h(
            'button',
            {
              class: 'bt-swatch m-ceramic',
              type: 'button',
              attrs: { role: 'radio', 'aria-label': t('buildTown.styleN', { n: i + 1 }), 'data-style': i },
              on: { click: () => this.setStyle(i) },
            },
            h('img', { attrs: { src: styleThumbUrl(def, i), alt: '' } }),
          ),
        ),
      );
    }
    this.styles.querySelectorAll<HTMLButtonElement>('.bt-swatch').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.style) === st.style)));
  }

  private show(): void {
    const st = this.st;
    if (!st) return;
    const s = this.app.store.get();
    const def = CONTENT.buildings[st.type];
    if (!def) return;
    const world = this.world();
    const day = viewCtx(s).cal.day;
    const cost = placeCost(s, CONTENT, st.type, day);
    let valid: boolean;
    let error = '';
    const pills: string[] = [];

    if (st.idle) {
      valid = false;
      pills.push(`<span class="bt-pill${cost > s.coins ? ' miss' : ''}">${fmt(cost)}${ic('coin')}</span>`);
    } else if (st.line) {
      const ok = st.line.filter((tl) => tl.valid);
      valid = ok.length > 0;
      const total = ok.length * cost;
      pills.push(`<span class="bt-pill${total > s.coins ? ' miss' : ''}">${tilesText(ok.length)} · ${fmt(total)}${ic('coin')}</span>`);
      if (!valid) {
        const last = st.line[st.line.length - 1]!;
        const r = canPlace(s, CONTENT, st.type, last.x, last.y, -1, world);
        error = r.ok ? '' : t(`fail.${r.reason}`);
      } else if (ok.length < st.line.length) pills.push(`<span class="bt-pill soft">${t('buildTown.lineSkip', { n: st.line.length - ok.length })}</span>`);
    } else {
      const r = canPlace(s, CONTENT, st.type, st.x, st.y, st.uid ?? -1, world);
      valid = r.ok;
      if (!r.ok) error = t(`fail.${r.reason}`);
      if (st.mode === 'place') pills.push(`<span class="bt-pill${cost > s.coins ? ' miss' : ''}">${fmt(cost)}${ic('coin')}</span>`);
    }
    if (st.mode === 'place') {
      for (const m of def.materials ?? []) {
        const have = countItem(s, m.item);
        const need = st.line ? m.qty * Math.max(1, st.line.filter((tl) => tl.valid).length) : m.qty;
        pills.push(
          `<span class="bt-pill${have < need ? ' miss' : ''}"><img src="${itemIconUrl(m.item, 48)}" alt="" />${need}<span class="sr-only">${itemName(m.item)}</span></span>`,
        );
      }
    }
    if (def.service && def.service.radius > 0) pills.push(`<span class="bt-pill">${t('buildTown.stat.radius', { r: def.service.radius })}</span>`);
    if (def.service) pills.push(`<span class="bt-pill soft">${serviceEffect(def)}</span>`);

    const hint =
      st.mode === 'move' ? t('build.moving') : st.idle ? t(isLineDef(def) ? 'buildTown.drawMore' : 'buildTown.placeMore') : isLineDef(def) ? t('buildTown.drawHint') : t('build.placing');
    this.bar.hidden = false;
    this.msg.textContent = `${buildingName(st.type)} · ${hint}`;
    const html = pills.join('');
    if (html !== this.infoHtml) {
      this.infoHtml = html;
      this.info.innerHTML = html;
    }
    this.info.hidden = !html;
    this.renderStyles(def);
    this.error.textContent = error;
    this.error.hidden = !error;
    this.confirmBtn.disabled = !valid || this.busy;
    this.confirmBtn.textContent = st.line ? t('buildTown.placeN', { n: st.line.filter((tl) => tl.valid).length }) : t('build.confirm');
    this.removeBtn.hidden = st.mode !== 'move';

    if (st.idle) {
      this.app.scene()?.setGhost(null);
      return;
    }
    const ghost: Ghost = { type: st.type, x: st.x, y: st.y, valid };
    if ((def.styles ?? 1) > 1) ghost.style = st.style;
    if (st.line) ghost.line = st.line.map((tl) => ({ x: tl.x, y: tl.y, valid: tl.valid }));
    this.app.scene()?.setGhost(ghost);
  }

  private async confirm(): Promise<void> {
    const st = this.st;
    if (!st || this.busy) return;
    if (st.line) {
      await this.confirmLine(st);
      return;
    }
    const def = CONTENT.buildings[st.type];
    const cmd =
      st.mode === 'place'
        ? (def?.styles ?? 1) > 1
          ? ({ type: 'place', building: st.type, x: st.x, y: st.y, style: st.style } as const)
          : ({ type: 'place', building: st.type, x: st.x, y: st.y } as const)
        : ({ type: 'move', uid: st.uid!, x: st.x, y: st.y } as const);
    const ok = await this.app.send(cmd);
    if (!ok || this.st !== st) return;
    // Ścieżki, drogi i płoty stawia się seriami – zostajemy w trybie budowania.
    const s = this.app.store.get();
    if (st.mode === 'place' && (isLineDef(def) || st.type === 'fence') && s.coins >= placeCost(s, CONTENT, st.type, viewCtx(s).cal.day)) {
      st.idle = true;
      this.show();
      return;
    }
    this.exit();
  }

  /** Stawia po kolei wszystkie poprawne kafle linii; przerywa, gdy zabraknie monet lub materiałów. */
  private async confirmLine(st: BuildState): Promise<void> {
    const tiles = (st.line ?? []).filter((tl) => tl.valid);
    if (!tiles.length) return;
    const s0 = this.app.store.get();
    const def = CONTENT.buildings[st.type];
    const cost = placeCost(s0, CONTENT, st.type, viewCtx(s0).cal.day);
    let coins = s0.coins;
    const stock = new Map((def?.materials ?? []).map((m) => [m.item, countItem(s0, m.item)]));
    let placed = 0;
    let spent = 0;
    let shortage: 'no-coins' | 'missing-items' | null = null;
    this.busy = true;
    this.confirmBtn.disabled = true;
    try {
      for (const tl of tiles) {
        if (coins < cost) shortage = 'no-coins';
        else if ((def?.materials ?? []).some((m) => (stock.get(m.item) ?? 0) < m.qty)) shortage = 'missing-items';
        if (shortage) break;
        const ok = await this.app.send({ type: 'place', building: st.type, x: tl.x, y: tl.y }, placed > 0);
        if (!ok) {
          if (placed === 0) break;
          continue;
        }
        placed++;
        spent += cost;
        coins -= cost;
        for (const m of def?.materials ?? []) stock.set(m.item, (stock.get(m.item) ?? 0) - m.qty);
      }
    } finally {
      this.busy = false;
    }
    if (placed) this.app.toasts.show(t('buildTown.linePlaced', { n: placed, name: buildingName(st.type), cost: fmt(spent) }), 'good');
    if (shortage) this.app.toasts.show(t(`fail.${shortage}`), 'warn');
    if (this.st !== st) return;
    st.line = null;
    st.lineStart = null;
    st.idle = placed > 0;
    this.show();
  }
}
