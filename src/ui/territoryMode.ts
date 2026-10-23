// Tryb terenu: podgląd fragmentów do kupienia z cenami (scena) i kupno dotknięciem; własna drewniana belka
// z liczbą fragmentów, limitem etapu i ceną następnego (docs/plan-osada.md §2).

import { CONTENT, type Content } from '../content/content';
import { fmt, t } from '../i18n/i18n';
import type { FailReason } from '../sim/commands';
import { project } from '../render/iso';
import { buyableChunks, chunkRect, territoryCost, territoryLimit } from '../sim/systems/settlement/territory';
import type { GameState } from '../sim/types';
import { CHUNKS_X, CHUNKS_Y, MAP_H, MAP_W, chunkNeighbors, chunkOfTile } from '../sim/world';
import type { App } from './app';
import { mapModes } from './buildMode';
import { $, h } from './dom';
import { ic, icEl } from './uiIcons';

// ---------------------------------------------------------------- czyste pomocniki (testowane)

export type TerritoryAction =
  | { kind: 'none' }
  | { kind: 'own'; chunk: number }
  | { kind: 'buy'; chunk: number; cost: number }
  | { kind: 'fail'; chunk: number; reason: FailReason; nextTier?: number };

/** Najbliższy etap z większym limitem terenu niż obecny (albo undefined). */
export function nextTerritoryTier(c: Content, peakTier: number): number | undefined {
  const now = territoryLimit(c, peakTier);
  const i = c.settlement.tiers.findIndex((tier, k) => k > peakTier && tier.territory > now);
  return i < 0 ? undefined : i;
}

/** Co zrobić po dotknięciu kafla w trybie terenu. Kolejność powodów jak w canBuyTerritory (bez monet). */
export function territoryAction(s: GameState, c: Content, x: number, y: number): TerritoryAction {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return { kind: 'none' };
  const chunk = chunkOfTile(x, y);
  const st = s.settlement;
  if (chunk < 0 || chunk >= CHUNKS_X * CHUNKS_Y) return { kind: 'none' };
  if (st.territory.includes(chunk)) return { kind: 'own', chunk };
  if (c.settlement.foreignChunks.includes(chunk)) return { kind: 'fail', chunk, reason: 'foreign-land' };
  if (!s.world.revealed.includes(chunk)) return { kind: 'fail', chunk, reason: 'hidden' };
  if (!chunkNeighbors(chunk).some((n) => st.territory.includes(n))) return { kind: 'fail', chunk, reason: 'not-territory-edge' };
  if (st.territory.length >= territoryLimit(c, st.peakTier)) {
    const next = nextTerritoryTier(c, st.peakTier);
    return next === undefined ? { kind: 'fail', chunk, reason: 'max-territory' } : { kind: 'fail', chunk, reason: 'max-territory', nextTier: next };
  }
  return { kind: 'buy', chunk, cost: territoryCost(c, st.bought) };
}

// ---------------------------------------------------------------- tryb

export class TerritoryMode {
  private on = false;
  private bar: HTMLElement | null = null;
  private stats: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastSig = '';

  constructor(private readonly app: App) {
    mapModes.exitTerritory = () => this.exit();
  }

  get active(): boolean {
    return this.on;
  }

  /** Belka trybu tworzona przy pierwszym użyciu (obok paska budowania). */
  private ensureBar(): HTMLElement {
    if (this.bar) return this.bar;
    const done = h('button', {
      class: 'btn primary',
      type: 'button',
      on: {
        click: () => {
          this.app.click();
          this.exit();
        },
      },
    });
    done.append(icEl('check'), document.createTextNode(t('territory.done')));
    done.classList.add('tb-done');
    this.stats = h('div', { class: 'tb-stats' });
    this.hint = h('p', { class: 'tb-hint' });
    this.bar = h(
      'div',
      { class: 'build-bar territory-bar', attrs: { role: 'region', 'aria-label': t('territory.title'), hidden: true } },
      h('div', { class: 'tb-head' }, h('p', { class: 'tb-title', html: `${ic('compass')}${t('territory.title')}` }), done),
      this.stats,
      this.hint,
    );
    $('#build-bar').after(this.bar);
    return this.bar;
  }

  start(): void {
    mapModes.exitBuild?.();
    const bar = this.ensureBar();
    this.on = true;
    this.lastSig = '';
    bar.hidden = false;
    this.app.scene()?.setTerritoryMode(true);
    this.render(this.app.store.get());
    this.overview();
    this.unsubscribe?.();
    this.unsubscribe = this.app.store.subscribe((s) => this.render(s));
    this.app.toasts.show(t('territory.intro'));
  }

  exit(): void {
    if (!this.on) return;
    this.on = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.bar) this.bar.hidden = true;
    this.app.scene()?.setTerritoryMode(false);
  }

  /** Kamera obejmuje teren osady i fragmenty do kupienia (pod belką trybu). */
  private overview(): void {
    const scene = this.app.scene();
    const bar = this.bar;
    if (!scene || !bar) return;
    const s = this.app.store.get();
    const chunks = [...s.settlement.territory, ...buyableChunks(s, CONTENT)];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const ch of chunks) {
      const r = chunkRect(ch);
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
    }
    if (!Number.isFinite(x0)) return;
    // Rzut izometryczny prostokąta kafli: skrajne punkty to jego narożniki.
    const corners = [project(x0, y0), project(x1, y0), project(x0, y1), project(x1, y1)];
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const v = scene.cam.viewport;
    const k = v.width / Math.max(1, window.innerWidth);
    const top = Math.max(v.insetTop, bar.getBoundingClientRect().bottom * k);
    const availW = v.width * 0.94;
    const availH = Math.max(1, v.height - top - v.insetBottom) * 0.94;
    const zoom = Math.min(availW / (Math.max(...xs) - Math.min(...xs)), availH / (Math.max(...ys) - Math.min(...ys)));
    // Środek prostokąta w świecie przesunięty tak, by wypadł na środku widocznej części pod belką.
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    // Tylko oddalamy (nigdy nie przybliżamy) w granicach kamery.
    const z = Math.max(scene.cam.minZoom, Math.min(zoom, scene.cam.zoom, scene.cam.maxZoom));
    scene.cam.focusOn(cx, cy - (top - v.insetTop) / 2 / z, z, !this.app.reducedMotion());
  }

  /** Belka: posiadane/limit, cena następnego fragmentu, skarbiec – przerysowanie tylko przy zmianie. */
  private render(s: GameState): void {
    if (!this.on || !this.stats || !this.hint) return;
    const st = s.settlement;
    const limit = territoryLimit(CONTENT, st.peakTier);
    const cost = territoryCost(CONTENT, st.bought);
    const buyable = buyableChunks(s, CONTENT).length;
    const sig = `${st.territory.length}|${limit}|${cost}|${Math.floor(s.coins)}|${buyable}|${st.peakTier}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    const full = st.territory.length >= limit;
    const poor = s.coins < cost;
    this.stats.innerHTML = [
      `<span class="tb-stat"><small>${t('territory.owned')}</small><b>${st.territory.length}/${limit}</b></span>`,
      `<span class="tb-stat${full ? ' dim' : poor ? ' miss' : ''}"><small>${t('territory.next')}</small><b>${full ? '–' : fmt(cost)}${full ? '' : ic('coin')}</b></span>`,
      `<span class="tb-stat"><small>${t('territory.treasury')}</small><b>${fmt(s.coins)}${ic('coin')}</b></span>`,
    ].join('');
    const next = nextTerritoryTier(CONTENT, st.peakTier);
    this.hint.textContent = full
      ? next === undefined
        ? t('territory.hintMax')
        : t('territory.hintTier', { tier: t(`tier.${CONTENT.settlement.tiers[next]!.id}`), n: CONTENT.settlement.tiers[next]!.territory })
      : buyable
        ? t('territory.hint')
        : t('territory.hintNone');
  }

  /** Dotknięcie kafla w trybie terenu (wywołuje obsługa wskaźnika). */
  tapTile(x: number, y: number): void {
    if (!this.on) return;
    const s = this.app.store.get();
    const a = territoryAction(s, CONTENT, x, y);
    if (a.kind === 'none' || a.kind === 'own') return;
    if (a.kind === 'fail') {
      this.app.audio.play('error');
      const extra =
        a.reason === 'max-territory' && a.nextTier !== undefined ? ` ${t('territory.moreAt', { tier: t(`tier.${CONTENT.settlement.tiers[a.nextTier]!.id}`) })}` : '';
      this.app.toasts.show(t(`fail.${a.reason}`) + extra, 'warn');
      return;
    }
    const st = s.settlement;
    const limit = territoryLimit(CONTENT, st.peakTier);
    const missing = a.cost - s.coins;
    this.app.confirm(
      t('territory.buyTitle'),
      t('territory.buyText', { cost: `<b class="price">${fmt(a.cost)}${ic('coin')}</b>`, n: st.territory.length + 1, limit }) +
        (missing > 0 ? `<br><small class="q-miss">${t('territory.missing', { n: fmt(missing) })}</small>` : ''),
      t('territory.buy'),
      () => void this.app.send({ type: 'buyTerritory', chunk: a.chunk }),
      missing > 0,
    );
  }
}
