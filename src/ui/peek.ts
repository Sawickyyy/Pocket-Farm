// Podgląd grządki po przytrzymaniu palca: dymek z pergaminu nad palcem (roślina, czas do zbioru,
// wilgotność, żyzność, przewidywana jakość). Znika po podniesieniu palca.

import { CONTENT } from '../content/content';
import { t } from '../i18n/i18n';
import { itemIconUrl } from '../render/art/atlas';
import { START_UNLOCKED } from '../sim/initialState';
import { canUnlock, cropEtaMs, cropStage, isReady, plotUnlockCost, qualityScore, qualityTier } from '../sim/systems/fields';
import type { GameState } from '../sim/types';
import { h } from './dom';
import { formatDuration } from './format';
import { viewCtx } from './view';

function meter(label: string, value: number, cls: string): HTMLElement {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return h(
    'div',
    { class: `peek-meter ${cls}`, attrs: { role: 'meter', 'aria-label': label, 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' } },
    h('span', { class: 'peek-label', text: label }),
    h('span', { class: 'peek-bar' }, h('i', { attrs: { style: `width:${pct}%` } })),
  );
}

function content(s: GameState, i: number): HTMLElement[] {
  const plot = s.plots[i];
  if (!plot) return [];
  if (!plot.unlocked) {
    return [
      h('h3', { text: t('peek.locked') }),
      h('p', { text: canUnlock(s, i) ? t('unlock.text', { cost: plotUnlockCost(s, START_UNLOCKED.length) }) : t('fail.not-adjacent') }),
    ];
  }
  const ctx = viewCtx(s);
  const soil = [meter(t('peek.water'), plot.moisture, 'water'), meter(t('peek.soil'), plot.fertility, 'soil')];
  const crop = plot.crop;
  if (!crop) return [h('h3', { text: plot.tilled ? t('peek.tilled') : t('peek.untilled') }), ...soil];

  const def = CONTENT.crop[crop.id];
  const name = t(`item.${crop.id}`);
  let status: string;
  if (crop.withered) status = t('peek.withered');
  else if (isReady(crop)) status = t('peek.ready');
  else {
    const eta = cropEtaMs(ctx, plot);
    status = eta === null ? t('peek.thirsty') : t('peek.eta', { time: formatDuration(eta / Math.max(0.01, s.clock.timeScale)) });
    if (def?.night) status += ` · ${t('peek.night')}`;
  }
  const tier = crop.withered ? 0 : qualityTier(qualityScore(ctx, plot, crop));
  const stars = tier === 2 ? '★★' : tier === 1 ? '★' : '☆';
  return [
    h(
      'div',
      { class: 'peek-head' },
      h('img', { attrs: { src: itemIconUrl(crop.id, 64), alt: '', width: '40', height: '40' } }),
      h('div', {}, h('h3', { text: name }), h('p', { class: 'peek-status', text: status })),
      h('span', { class: `peek-stars q${tier}`, text: stars, attrs: { 'aria-label': t(`quality.${tier}`) } }),
    ),
    meter(t('peek.growth'), crop.withered ? 0 : crop.growth, `growth stage${cropStage(crop)}`),
    ...soil,
  ];
}

export class PlotPeek {
  private readonly el = h('div', { class: 'peek', attrs: { role: 'status', 'aria-live': 'polite' } });
  private plot: number | null = null;

  constructor(private readonly state: () => GameState) {
    this.el.hidden = true;
    document.body.append(this.el);
  }

  /** Pokazuje dymek nad punktem (px CSS) dla danej grządki. */
  show(plot: number, x: number, y: number): void {
    this.plot = plot;
    this.render();
    this.el.hidden = false;
    const w = this.el.offsetWidth;
    const hgt = this.el.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2));
    // nad palcem (żeby go nie zasłaniał), a gdy brak miejsca – pod nim
    const top = y - hgt - 28 > 8 ? y - hgt - 28 : y + 28;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
    this.el.style.setProperty('--tail', `${Math.max(16, Math.min(w - 16, x - left))}px`);
    this.el.classList.toggle('below', top > y);
  }

  /** Odświeżenie przy zmianie stanu, gdy dymek jest widoczny. */
  render(): void {
    if (this.plot === null) return;
    this.el.replaceChildren(...content(this.state(), this.plot));
  }

  hide(): void {
    this.plot = null;
    this.el.hidden = true;
  }

  get visible(): boolean {
    return this.plot !== null;
  }
}
