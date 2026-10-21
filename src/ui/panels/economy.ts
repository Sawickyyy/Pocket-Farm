// Hub farmy, wybór nasion/nawozu, sklep, rynek (ceny dynamiczne) i spiżarnia.

import { CONTENT, parseKey } from '../../content/content';
import { fmt, itemName, t } from '../../i18n/i18n';
import { itemIconUrl, menuIconUrl } from '../../render/art/atlas';
import { HOUR_MS } from '../../sim/calendar';
import { countItem, levelOf, mod } from '../../sim/ctx';
import { growthRate } from '../../sim/systems/fields';
import { SELL_ALL_KINDS, priceTrend, quote, unitPrice } from '../../sim/systems/market';
import type { GameState } from '../../sim/types';
import type { App } from '../app';
import { h } from '../dom';
import { ic, icEl } from '../uiIcons';
import { formatDuration, keyLabelHtml } from '../format';
import type { SheetManager } from '../sheet';
import { viewCtx } from '../view';
import { btn, card, coins, empty, grid } from './common';

const invSig = (s: GameState) => JSON.stringify([s.coins, s.inventory, s.seeds, Math.floor(s.clock.simMs / (HOUR_MS / 2))]);

export function registerEconomy(app: App, sheets: SheetManager): void {
  // ---------------------------------------------------------- hub
  sheets.register({
    id: 'hub',
    title: () => t('hub.title'),
    sig: (s) => JSON.stringify([s.quests, s.orders, s.skillPoints, Object.keys(s.inventory).length]),
    render(body, s) {
      const claimable = [...s.quests.daily, ...s.quests.weekly].filter((q) => !q.claimed && q.progress >= q.target).length;
      const deliverable = s.orders.filter((o) => countItem(s, o.item) >= o.qty).length;
      const sellable = Object.keys(s.inventory).filter((k) => (s.inventory[k] ?? 0) > 0).length;
      const tiles: [string, string, number, boolean][] = [
        ['market', t('hub.market'), sellable, false],
        ['shop', t('hub.shop'), 0, false],
        ['build', t('hub.build'), 0, false],
        ['village', t('hub.village'), deliverable, true],
        ['progress', t('hub.progress'), claimable, true],
        ['skills', t('hub.skills'), s.skillPoints, true],
        ['inventory', t('hub.inventory'), 0, false],
        ['settings', t('hub.settings'), 0, false],
      ];
      body.replaceChildren(
        h(
          'div',
          { class: 'hub-grid' },
          ...tiles.map(([id, label, badge, urgent]) =>
            h(
              'button',
              {
                class: 'hub-tile',
                type: 'button',
                on: {
                  click: () => {
                    app.click();
                    app.openSheet(id);
                  },
                },
              },
              h('span', { class: 'stamp' }, h('img', { class: 'menu-icon', attrs: { src: menuIconUrl(id), alt: '', width: '56', height: '56' } })),
              h('span', { text: label }),
              // czerwona pieczęć = czeka nagroda/dostawa; złota = po prostu jest coś do sprzedania
              badge ? h('span', { class: urgent ? 'badge seal' : 'badge', text: String(badge) }) : null,
            ),
          ),
        ),
      );
    },
  });

  // ---------------------------------------------------------- wybór nasion
  const seedCards = (s: GameState, onPick?: (id: string) => void) => {
    const ctx = viewCtx(s);
    const level = levelOf(s.xp);
    return CONTENT.crops.map((c) => {
      const locked = level < c.level;
      const inSeason = c.seasons.includes(ctx.cal.season);
      const time = formatDuration((c.growMin * HOUR_MS) / growthRate(0.6) / (1 + mod(s, CONTENT, 'growthSpeed')));
      const seasons = c.seasons.map((x) => t(`season.${x}`)).join(', ');
      const desc = `${coins(c.seed)} · ~${time} · ${seasons}${c.night ? ` · ${ic('moon')} ${t('shop.night')}` : ''}<br>${t('shop.have', { n: s.seeds[c.id] ?? 0 })} · <b>${inSeason ? t('shop.inSeason') : t('shop.outSeason')}</b>`;
      const actions = locked
        ? []
        : [
            btn('+1', () => void app.send({ type: 'buySeeds', crop: c.id, qty: 1 }), { primary: false, disabled: s.coins < c.seed, small: true }),
            btn('+5', () => void app.send({ type: 'buySeeds', crop: c.id, qty: 5 }), { disabled: s.coins < c.seed * 5, small: true }),
          ];
      if (onPick && !locked) actions.unshift(btn('', () => onPick(c.id), { primary: s.selectedSeed !== c.id, small: true, aria: t('tool.pickSeed'), icon: 'check' }));
      return card(itemIconUrl(c.id), `${itemName(c.id)}${s.selectedSeed === c.id && onPick ? ` ${ic('check')}` : ''}`, desc, actions, {
        note: locked ? t('shop.fromLevel', { level: c.level }) : undefined,
        cls: `buy ${inSeason ? '' : 'done'}`,
      });
    });
  };

  sheets.register({
    id: 'seedPicker',
    title: () => t('tool.pickSeed'),
    sig: (s) => JSON.stringify([s.coins, s.seeds, s.selectedSeed, s.xp, Math.floor(s.clock.simMs / (HOUR_MS * 24))]),
    render(body, s) {
      body.replaceChildren(
        grid(
          seedCards(s, (id) => {
            app.click();
            void app.send({ type: 'selectSeed', crop: id });
            app.closeSheet();
          }),
          true,
        ),
      );
    },
  });

  sheets.register({
    id: 'fertPicker',
    title: () => t('tool.pickFert'),
    sig: (s) => JSON.stringify([s.inventory, s.selectedFertilizer, s.coins]),
    render(body, s) {
      const ferts = CONTENT.itemList.filter((i) => i.kind === 'fertilizer');
      body.replaceChildren(
        grid(
          ferts.map((f) =>
            card(itemIconUrl(f.id), `${itemName(f.id)}${s.selectedFertilizer === f.id ? ` ${ic('check')}` : ''}`, `+${Math.round((f.fertility ?? 0) * 100)}% · ${t('shop.have', { n: countItem(s, f.id) })}`, [
              f.buy ? btn(`+5 · ${f.buy * 5}`, () => void app.send({ type: 'buyItem', item: f.id, qty: 5 }), { primary: false, small: true, disabled: s.coins < f.buy * 5, icon: 'coin' }) : h('span'),
              btn('✓', () => {
                app.click();
                void app.send({ type: 'selectFertilizer', item: f.id });
                app.closeSheet();
              }, { small: true }),
            ]),
          ),
        ),
      );
    },
  });

  // ---------------------------------------------------------- sklep
  sheets.register({
    id: 'shop',
    parent: 'hub',
    title: () => t('hub.shop'),
    tabs: () => [
      { id: 'seeds', label: t('shop.seeds') },
      { id: 'supplies', label: t('shop.supplies') },
    ],
    sig: (s, tab) => tab + JSON.stringify([s.coins, s.seeds, s.inventory, s.xp, Math.floor(s.clock.simMs / (HOUR_MS * 24))]),
    render(body, s, tab) {
      if (tab === 'seeds') {
        body.replaceChildren(grid(seedCards(s), true));
        return;
      }
      const supplies = CONTENT.itemList.filter((i) => i.buy);
      body.replaceChildren(
        grid(
          supplies.map((i) =>
            card(itemIconUrl(i.id), itemName(i.id), `${coins(i.buy!)} · ${t('shop.have', { n: countItem(s, i.id) })}`, [
              btn('+1', () => void app.send({ type: 'buyItem', item: i.id, qty: 1 }), { primary: false, small: true, disabled: s.coins < i.buy! }),
              btn('+10', () => void app.send({ type: 'buyItem', item: i.id, qty: 10 }), { small: true, disabled: s.coins < i.buy! * 10 }),
            ], { cls: 'buy' }),
          ),
          true,
        ),
        h('p', { class: 'hint', text: t('shop.animalHint') }),
      );
    },
  });

  // ---------------------------------------------------------- rynek
  sheets.register({
    id: 'market',
    parent: 'hub',
    title: () => t('market.title'),
    sig: (s) => JSON.stringify([s.inventory, s.market.demand, s.skills]) + Math.round(Object.values(s.market.sat).reduce((a, b) => a + b, 0)),
    render(body, s) {
      const ctx = viewCtx(s);
      const entries = Object.entries(s.inventory)
        .filter(([key, n]) => n > 0 && SELL_ALL_KINDS.has(CONTENT.items[parseKey(key).id]?.kind ?? ''))
        .sort((a, b) => unitPrice(ctx, b[0]) - unitPrice(ctx, a[0]));
      if (!entries.length) {
        body.replaceChildren(empty(t('market.empty'), 'point'), h('p', { class: 'hint', text: t('market.hint') }));
        return;
      }
      let total = 0;
      const cards = entries.map(([key, n]) => {
        const { id } = parseKey(key);
        const trend = priceTrend(ctx, id);
        total += quote(ctx, key, n);
        const chip = trend > 0 ? `<span class="chip hot">${ic('leaf-up')}${t('market.hot')}</span>` : trend < 0 ? `<span class="chip cold">${ic('leaf-down')}${t('market.cold')}</span>` : '';
        return card(itemIconUrl(id), `${keyLabelHtml(key)} × ${n}`, `${coins(fmt(unitPrice(ctx, key)))} ${t('market.each')}${chip}`, [
          btn(t('market.one'), () => void app.send({ type: 'sell', key, qty: 1 }), { primary: false, small: true }),
          btn(`${t('market.all')} (${fmt(quote(ctx, key, n))})`, () => void app.send({ type: 'sell', key, qty: 'all' }), { small: true }),
        ]);
      });
      body.replaceChildren(
        grid(cards),
        h(
          'div',
          { class: 'summary-row' },
          h('span', { html: `${t('market.total')}: <b class="price">${fmt(total)}${ic('coin')}</b>` }),
          btn(t('market.sellAll'), () => void app.send({ type: 'sellAll' }), { reward: true, icon: 'coin' }),
        ),
        h('p', { class: 'hint', text: t('market.hint') }),
      );
    },
  });

  // ---------------------------------------------------------- spiżarnia
  sheets.register({
    id: 'inventory',
    parent: 'hub',
    title: () => t('inv.title'),
    sig: invSig,
    render(body, s) {
      const items = Object.entries(s.inventory).filter(([, n]) => n > 0);
      const seeds = Object.entries(s.seeds).filter(([, n]) => n > 0);
      if (!items.length && !seeds.length) {
        body.replaceChildren(empty(t('inv.empty')));
        return;
      }
      body.replaceChildren(
        grid(items.map(([key, n]) => card(itemIconUrl(parseKey(key).id), `${keyLabelHtml(key)} × ${n}`, ''))),
        h('h3', { text: t('shop.seeds') }),
        grid(seeds.map(([id, n]) => card(itemIconUrl(id), `${itemName(id)} × ${n}`, ''))),
      );
    },
  });
}
