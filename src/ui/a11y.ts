// Dostępność planszy: mapa jest rysowana na canvasie, więc VoiceOver jej nie widzi. Ukryta lista odblokowanych
// grządek (z ich stanem) pozwala grać czytnikiem ekranu – przycisk grządki używa wybranego narzędzia.

import { t } from '../i18n/i18n';
import { cropStage, isReady } from '../sim/systems/fields';
import type { GameState, Plot } from '../sim/types';
import type { App } from './app';
import { h } from './dom';

function describe(plot: Plot): string {
  const crop = plot.crop;
  if (!crop) return plot.tilled ? t('peek.tilled') : t('peek.untilled');
  const name = t(`item.${crop.id}`);
  if (crop.withered) return `${name}: ${t('peek.withered')}`;
  if (isReady(crop)) return `${name}: ${t('peek.ready')}`;
  const parts = [`${name}: ${t('peek.growth')} ${Math.round(crop.growth * 100)}%`, `${t('a11y.stage', { n: cropStage(crop) + 1 })}`];
  if (plot.moisture <= 0.05) parts.push(t('peek.thirsty'));
  return parts.join(', ');
}

export function mountPlotList(app: App): void {
  const list = h('ul', {});
  const root = h('section', { class: 'sr-only', attrs: { 'aria-label': t('a11y.field') } }, h('h2', { text: t('a11y.field') }), list);
  document.body.append(root);
  let key = '';
  const render = (s: GameState) => {
    const items = s.plots
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.unlocked)
      .map(({ p, i }) => ({ i, text: `${t('a11y.plot', { n: i + 1 })}: ${describe(p)}` }));
    const next = `${s.tool}|${items.map((x) => x.text).join('|')}`;
    if (next === key) return;
    key = next;
    const tool = t(`tool.${s.tool}`);
    list.replaceChildren(
      ...items.map(({ i, text }) =>
        h(
          'li',
          {},
          h('button', {
            type: 'button',
            text,
            attrs: { 'aria-description': t('a11y.use', { tool }) },
            on: { click: () => void app.send({ type: 'useTool', plot: i }) },
          }),
        ),
      ),
    );
  };
  render(app.store.get());
  app.store.subscribe(render);
}
