// Górny pasek (monety, poziom, menu), dolny pasek narzędzi i wybór nasion.

import type { Store } from '../core/store';
import { CROP_IDS, CROPS, TOOL_IDS, TOOL_NAMES, type ToolId } from '../game/content';
import type { GameController } from '../game/controller';
import { growDuration } from '../game/logic';
import { levelFromXp, levelProgress } from '../game/progression';
import type { GameState } from '../game/state';
import { $ } from './dom';
import { formatDuration, formatNumber } from './format';
import { CROP_ICONS, TOOL_ICONS } from './icons';

export function mountHud(store: Store<GameState>, controller: GameController, onClick: () => void): void {
  const coinsEl = $<HTMLOutputElement>('#coins');
  const coinsBox = coinsEl.closest('.coins');
  const levelEl = $('#level');
  const xpFill = $('#xp-fill');
  const toolbar = $('#toolbar');
  const seedPicker = $('#seed-picker');
  const seedList = $('#seed-list');
  const statsBody = $('#stats-body');

  // ---------- pasek narzędzi
  const toolButtons = new Map<ToolId, HTMLButtonElement>();
  for (const tool of TOOL_IDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool';
    b.dataset.tool = tool;
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<span class="ico">${TOOL_ICONS[tool]}</span><span class="label">${TOOL_NAMES[tool]}</span>`;
    if (tool === 'seeds') b.insertAdjacentHTML('beforeend', '<span class="badge"></span>');
    b.addEventListener('click', () => {
      onClick();
      const s = store.get();
      // Drugie tapnięcie w aktywne „Nasiona” otwiera wybór gatunku.
      if (tool === 'seeds' && s.tool === 'seeds') seedPicker.showPopover();
      else controller.selectTool(tool);
    });
    toolButtons.set(tool, b);
    toolbar.append(b);
  }
  const shopBtn = document.createElement('button');
  shopBtn.type = 'button';
  shopBtn.className = 'tool';
  shopBtn.setAttribute('popovertarget', 'shop');
  shopBtn.innerHTML = `<span class="ico">${TOOL_ICONS.shop}</span><span class="label">Sklep</span><span class="badge"></span>`;
  shopBtn.addEventListener('click', onClick);
  toolbar.append(shopBtn);

  const renderTools = (s: GameState) => {
    for (const [tool, b] of toolButtons) b.setAttribute('aria-pressed', String(s.tool === tool));
    const seedsBtn = toolButtons.get('seeds');
    if (seedsBtn) {
      seedsBtn.querySelector('.ico')!.innerHTML = CROP_ICONS[s.selectedSeed];
      seedsBtn.querySelector('.label')!.textContent = CROPS[s.selectedSeed].name;
      const badge = seedsBtn.querySelector<HTMLElement>('.badge')!;
      badge.textContent = String(s.seeds[s.selectedSeed]);
      badge.toggleAttribute('data-zero', false);
      seedsBtn.setAttribute('aria-label', `Nasiona: ${CROPS[s.selectedSeed].name}, ${s.seeds[s.selectedSeed]} szt.`);
    }
    const barnCount = Object.values(s.barn).reduce((a, b) => a + b, 0);
    const shopBadge = shopBtn.querySelector<HTMLElement>('.badge')!;
    shopBadge.textContent = barnCount ? String(barnCount) : '';
    shopBtn.setAttribute('aria-label', barnCount ? `Sklep, ${barnCount} plonów do sprzedania` : 'Sklep');
  };

  // ---------- wybór nasion
  const renderSeedPicker = (s: GameState) => {
    const level = levelFromXp(s.xp);
    seedList.replaceChildren(
      ...CROP_IDS.map((id) => {
        const c = CROPS[id];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'seed-option';
        b.setAttribute('aria-pressed', String(s.selectedSeed === id));
        const locked = level < c.unlockLevel;
        b.disabled = locked;
        b.innerHTML = `${CROP_ICONS[id]}<b>${c.name}</b><small>${
          locked ? `od poz. ${c.unlockLevel}` : `${s.seeds[id]} szt. · ${formatDuration(growDuration(id, s.upgrades))}`
        }</small>`;
        b.addEventListener('click', () => {
          onClick();
          controller.selectSeed(id);
          seedPicker.hidePopover();
        });
        return b;
      }),
    );
  };
  seedPicker.addEventListener('beforetoggle', (e) => {
    if ((e as ToggleEvent).newState === 'open') renderSeedPicker(store.get());
  });

  // ---------- monety i poziom
  let lastCoins = store.get().coins;
  const renderCoins = (s: GameState) => {
    coinsEl.value = formatNumber(s.coins);
    if (s.coins > lastCoins && coinsBox) {
      coinsBox.classList.remove('bump');
      void (coinsBox as HTMLElement).offsetWidth;
      coinsBox.classList.add('bump');
    }
    lastCoins = s.coins;
  };
  const renderLevel = (s: GameState) => {
    const p = levelProgress(s.xp);
    levelEl.textContent = String(p.level);
    xpFill.style.width = `${Math.round(p.ratio * 100)}%`;
    $('#level-btn').setAttribute('aria-label', `Poziom ${p.level}, ${p.current} z ${p.needed} XP`);
  };

  const renderStats = (s: GameState) => {
    const p = levelProgress(s.xp);
    statsBody.innerHTML = `
      <h2>Poziom ${p.level}</h2>
      <dl class="stats-grid">
        <dt>Doświadczenie</dt><dd>${p.current} / ${p.needed} XP</dd>
        <dt>Zebrane plony</dt><dd>${formatNumber(s.stats.harvested)}</dd>
        <dt>Zarobione monety</dt><dd>${formatNumber(s.stats.earned)}</dd>
        <dt>Pola</dt><dd>${s.plots.filter((x) => x.unlocked).length} / ${s.plots.length}</dd>
      </dl>`;
  };
  $('#stats-pop').addEventListener('beforetoggle', (e) => {
    if ((e as ToggleEvent).newState === 'open') renderStats(store.get());
  });

  const render = (s: GameState) => {
    renderTools(s);
    renderCoins(s);
    renderLevel(s);
  };
  render(store.get());
  store.subscribe((s) => render(s));
}
