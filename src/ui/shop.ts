// Sklep: nasiona, sprzedaż plonów, ulepszenia. Odświeżany reaktywnie, gdy jest otwarty.

import type { Store } from '../core/store';
import { CROP_IDS, CROPS, UPGRADE_IDS, UPGRADES } from '../game/content';
import type { GameController } from '../game/controller';
import { growDuration, nextUpgradeCost, sellPrice } from '../game/logic';
import { levelFromXp } from '../game/progression';
import type { GameState } from '../game/state';
import { $, withViewTransition } from './dom';
import { formatDuration, formatNumber } from './format';
import { CROP_ICONS, UPGRADE_ICONS } from './icons';

type Tab = 'seeds' | 'sell' | 'upgrades';

export function mountShop(store: Store<GameState>, controller: GameController, onClick: () => void): void {
  const shop = $('#shop');
  const body = $('#shop-body');
  const tabs = [...shop.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  let tab: Tab = 'seeds';
  let open = false;

  const button = (label: string, disabled: boolean, run: () => void, primary = true): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${primary ? 'primary' : ''}`;
    b.textContent = label;
    b.disabled = disabled;
    b.addEventListener('click', () => {
      onClick();
      run();
    });
    return b;
  };

  const card = (icon: string, title: string, desc: string, actions: HTMLElement[], note?: string): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `<div class="thumb">${icon}</div><div><h3>${title}</h3><p>${desc}</p>${
      note ? `<p class="locked-note">${note}</p>` : ''
    }</div>`;
    const a = document.createElement('div');
    a.className = 'actions';
    a.append(...actions);
    el.append(a);
    return el;
  };

  const renderSeeds = (s: GameState): HTMLElement[] => {
    const level = levelFromXp(s.xp);
    return CROP_IDS.map((id) => {
      const c = CROPS[id];
      const locked = level < c.unlockLevel;
      const desc = `<span class="price">${c.seedPrice} 🪙</span> · ${formatDuration(growDuration(id, s.upgrades))} · masz ${s.seeds[id]}`;
      return card(
        CROP_ICONS[id],
        c.name,
        desc,
        locked
          ? []
          : [
              button('+1', s.coins < c.seedPrice, () => controller.buySeeds(id, 1), false),
              button('+5', s.coins < c.seedPrice * 5, () => controller.buySeeds(id, 5)),
            ],
        locked ? `Dostępne od poziomu ${c.unlockLevel}` : undefined,
      );
    });
  };

  const renderSell = (s: GameState): HTMLElement[] => {
    const owned = CROP_IDS.filter((id) => s.barn[id] > 0);
    if (!owned.length) {
      const e = document.createElement('p');
      e.className = 'empty';
      e.textContent = 'Stodoła jest pusta. Zbierz dojrzałe plony sierpem.';
      return [e];
    }
    const total = owned.reduce((sum, id) => sum + sellPrice(id, s.upgrades) * s.barn[id], 0);
    const cards = owned.map((id) =>
      card(
        CROP_ICONS[id],
        `${CROPS[id].name} × ${s.barn[id]}`,
        `<span class="price">${sellPrice(id, s.upgrades)} 🪙</span> / szt.`,
        [button('1', false, () => controller.sell(id, 1), false), button('Wszystko', false, () => controller.sell(id, 'all'))],
      ),
    );
    const summary = document.createElement('div');
    summary.className = 'summary-row';
    summary.innerHTML = `<span>Razem: <b class="price">${formatNumber(total)} 🪙</b></span>`;
    summary.append(button('Sprzedaj wszystko', false, () => controller.sellAll()));
    return [...cards, summary];
  };

  const renderUpgrades = (s: GameState): HTMLElement[] => {
    const level = levelFromXp(s.xp);
    return UPGRADE_IDS.map((id) => {
      const u = UPGRADES[id];
      const current = s.upgrades[id];
      const cost = nextUpgradeCost(s, id);
      const locked = level < u.unlockLevel;
      const desc =
        cost === null
          ? `${u.describe(current)} · <b>MAKS.</b>`
          : `${u.describe(current + 1)} · <span class="price">${cost} 🪙</span>`;
      return card(
        UPGRADE_ICONS[id],
        `${u.name} ${current ? `(${current}/${u.costs.length})` : ''}`,
        desc,
        locked || cost === null ? [] : [button('Kup', s.coins < cost, () => controller.buyUpgrade(id))],
        locked ? `Dostępne od poziomu ${u.unlockLevel}` : undefined,
      );
    });
  };

  const render = () => {
    const s = store.get();
    const content = tab === 'seeds' ? renderSeeds(s) : tab === 'sell' ? renderSell(s) : renderUpgrades(s);
    const grid = document.createElement('div');
    grid.className = 'cards';
    grid.append(...content);
    body.replaceChildren(grid);
    for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === tab));
  };

  for (const t of tabs) {
    t.addEventListener('click', () => {
      const next = t.dataset.tab as Tab;
      if (next === tab) return;
      onClick();
      tab = next;
      withViewTransition(render);
    });
  }

  shop.addEventListener('beforetoggle', (e) => {
    open = (e as ToggleEvent).newState === 'open';
    if (open) {
      // Jeśli w stodole coś czeka, otwieramy od razu sprzedaż.
      const s = store.get();
      if (Object.values(s.barn).some((n) => n > 0)) tab = 'sell';
      render();
    }
  });

  store.subscribe(() => {
    if (open) render();
  });
}
