// Wioska: zamówienia mieszkańców, festyn, przyjaźnie i prezenty.

import { CONTENT, parseKey } from '../../content/content';
import { fmt, itemName, npcName, t } from '../../i18n/i18n';
import { itemIconUrl, villagerIconUrl } from '../../render/art/atlas';
import { countItem } from '../../sim/ctx';
import { activeFestival, festivalKey } from '../../sim/systems/progress';
import { giftReaction, hearts as heartCount } from '../../sim/systems/village';
import type { GameState } from '../../sim/types';
import type { App } from '../app';
import { h } from '../dom';
import { ic, icEl } from '../uiIcons';
import { keyLabelHtml } from '../format';
import type { SheetManager } from '../sheet';
import { viewCtx } from '../view';
import { btn, card, coins, empty, grid, hearts } from './common';

export function registerVillage(app: App, sheets: SheetManager): void {
  sheets.register({
    id: 'village',
    parent: 'hub',
    title: () => t('village.title'),
    tabs: () => [
      { id: 'orders', label: t('village.orders') },
      { id: 'people', label: t('village.people') },
    ],
    sig: (s, tab) => tab + JSON.stringify([s.orders, s.npcs, s.inventory, s.festivalsDone, s.lastDay]),
    render(body, s, tab, arg) {
      const ctx = viewCtx(s);
      if (tab === 'orders') {
        const parts: (HTMLElement | null)[] = [];
        const fest = activeFestival(ctx);
        if (fest) {
          const done = s.festivalsDone.includes(festivalKey(ctx, fest));
          const have = countItem(s, fest.item);
          parts.push(
            card(
              itemIconUrl(fest.item),
              `${ic('tent')} ${t('village.festival', { name: t(`festival.${fest.id}`) })}`,
              done ? t('village.festivalDone') : `${t('village.festivalDeliver', { qty: fest.qty, item: itemName(fest.item) })} (${have}/${fest.qty}) · ${coins(fmt(fest.coins))}`,
              done ? [] : [btn(t('village.deliver'), () => void app.send({ type: 'festivalDeliver' }), { disabled: have < fest.qty, reward: true })],
              { cls: done ? 'done' : '' },
            ),
          );
        }
        if (!s.orders.length) parts.push(empty(t('village.noOrders'), 'sleep'));
        parts.push(
          grid(
            s.orders.map((o) => {
              const have = countItem(s, o.item);
              return card(
                itemIconUrl(o.item),
                `${npcName(o.npc)}: ${o.qty}× ${itemName(o.item)}`,
                `${have}/${o.qty} · ${coins(fmt(o.coins))} · +${o.xp} XP · ${t('village.expires', { day: (o.expiresDay % 7) + 1 })}`,
                [btn(t('village.deliver'), () => void app.send({ type: 'deliverOrder', id: o.id }), { disabled: have < o.qty, reward: true })],
              );
            }),
          ),
        );
        body.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
        return;
      }
      body.replaceChildren(
        grid(
          CONTENT.npcs.map((n) => {
            const st = s.npcs[n.id]!;
            const hrt = heartCount(st.friendship);
            const gifted = st.giftDay === ctx.cal.day;
            const icon = h('div', { class: 'thumb', html: `<img src="${villagerIconUrl(n.id)}" alt="" width="56" height="56">` });
            const focused = arg === n.id;
            if (focused) requestAnimationFrame(() => body.querySelector('.card.focus')?.scrollIntoView({ block: 'nearest' }));
            return h(
              'div',
              { class: focused ? 'card focus' : 'card' },
              icon,
              h(
                'div',
                {},
                h('h4', { text: `${npcName(n.id)} · ${t(`npc.${n.id}.role`)}` }),
                h('p', { class: 'hearts', html: hearts(hrt), attrs: { 'aria-label': `${t('village.hearts')}: ${hrt}/10` } }),
                h('p', { text: `${t('village.loves')}: ${n.loves.map(itemName).join(', ')}` }),
                h('p', { text: `${t('village.likes')}: ${n.likes.map(itemName).join(', ')}` }),
              ),
              h('div', { class: 'actions' }, btn(gifted ? '' : t('village.gift'), () => app.openSheet('gift', n.id), { disabled: gifted, small: true, aria: gifted ? t('village.giftDone') : t('village.gift'), icon: gifted ? 'check' : 'gift' })),
            );
          }),
        ),
      );
    },
  });

  sheets.register({
    id: 'gift',
    parent: 'village',
    title: (npc) => `${t('village.pickGift')} – ${npcName(String(npc))}`,
    sig: (s: GameState, _tab, npc) => JSON.stringify([s.inventory, s.npcs[String(npc)]]),
    render(body, s, _tab, npc) {
      const id = String(npc);
      const ctx = viewCtx(s);
      const entries = Object.entries(s.inventory)
        .filter(([key, n]) => n > 0 && ['crop', 'animal', 'artisan', 'forage', 'fish'].includes(CONTENT.items[parseKey(key).id]?.kind ?? ''))
        .map(([key, n]) => ({ key, n, reaction: giftReaction(ctx, id, parseKey(key).id) }))
        .sort((a, b) => (b.reaction === 'love' ? 2 : b.reaction === 'like' ? 1 : 0) - (a.reaction === 'love' ? 2 : a.reaction === 'like' ? 1 : 0));
      if (!entries.length) {
        body.replaceChildren(empty(t('inv.empty')));
        return;
      }
      body.replaceChildren(
        grid(
          entries.map((e) =>
            card(itemIconUrl(parseKey(e.key).id), `${keyLabelHtml(e.key)} × ${e.n}`, e.reaction === 'love' ? `${ic('heart')} ${t('village.loves')}` : e.reaction === 'like' ? `${ic('smile')} ${t('village.likes')}` : '', [
              btn(t('inv.gift'), () => {
                void app.send({ type: 'gift', npc: id, key: e.key }).then((ok) => ok && app.openSheet('village', undefined));
              }, { small: true }),
            ]),
          ),
        ),
      );
    },
  });
}
