// Górny pasek (monety, poziom, menu), zegar z pogodą, dolny pasek narzędzi i nakładka pogody.

import { itemIconUrl } from '../render/art/atlas';
import { fmt, onLanguageChange, t } from '../i18n/i18n';
import { DAY_MS, HOUR_MS, calendarAt } from '../sim/calendar';
import { countItem, levelProgress } from '../sim/ctx';
import { activeFestival } from '../sim/systems/progress';
import { TOOL_IDS, type GameState, type ToolId } from '../sim/types';
import type { App } from './app';
import { $, h } from './dom';
import { WEATHER_ICON, clockText } from './format';
import { TOOL_ICONS } from './icons';
import { viewCtx } from './view';

export function mountHud(app: App): { coinTarget(): { x: number; y: number } | null } {
  const { store } = app;
  const coinsEl = $<HTMLOutputElement>('#coins');
  const coinsBox = $('.coins');
  const levelEl = $('#level');
  const xpFill = $('#xp-fill');
  const spBadge = $('#sp-badge');
  const clock = $('#clock');
  const toolbar = $('#toolbar');
  const weather = $('#weather');

  // ---------- pasek narzędzi
  const buttons = new Map<ToolId | 'hub', HTMLButtonElement>();
  for (const tool of [...TOOL_IDS, 'hub'] as const) {
    const b = h('button', { class: 'tool', type: 'button', attrs: { 'data-tool': tool } }, h('span', { class: 'ico' }), h('span', { class: 'label' }), h('span', { class: 'badge' }));
    if (tool !== 'hub') b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      app.click();
      const s = store.get();
      if (tool === 'hub') app.openSheet('hub');
      else if (tool === 'seeds' && s.tool === 'seeds') app.openSheet('seedPicker');
      else if (tool === 'fertilizer' && s.tool === 'fertilizer') app.openSheet('fertPicker');
      else void app.send({ type: 'selectTool', tool });
    });
    buttons.set(tool, b);
    toolbar.append(b);
  }

  const iconHtml = new Map<ToolId | 'hub', string>();
  const renderTools = (s: GameState) => {
    for (const [tool, b] of buttons) {
      const ico = b.querySelector('.ico')!;
      const label = b.querySelector('.label')!;
      const badge = b.querySelector<HTMLElement>('.badge')!;
      if (tool !== 'hub') b.setAttribute('aria-pressed', String(s.tool === tool));
      let html = '';
      let text = t(`tool.${tool}`);
      let count = '';
      if (tool === 'seeds') {
        html = `<img src="${itemIconUrl(s.selectedSeed, 64)}" alt="">`;
        count = String(s.seeds[s.selectedSeed] ?? 0);
      } else if (tool === 'fertilizer') {
        html = `<img src="${itemIconUrl(s.selectedFertilizer, 64)}" alt="">`;
        count = String(countItem(s, s.selectedFertilizer));
      } else if (tool === 'hub') {
        html = TOOL_ICONS.hub;
        const ready =
          [...s.quests.daily, ...s.quests.weekly].filter((q) => !q.claimed && q.progress >= q.target).length +
          s.orders.filter((o) => countItem(s, o.item) >= o.qty).length;
        count = ready ? String(ready) : '';
      } else html = TOOL_ICONS[tool];
      // porównujemy z zapamiętanym napisem: serializacja innerHTML (SVG) różni się od źródła,
      // więc porównanie z innerHTML podmieniałoby ikonę przy każdej klatce stanu
      if (iconHtml.get(tool) !== html) {
        iconHtml.set(tool, html);
        ico.innerHTML = html;
      }
      label.textContent = text;
      badge.textContent = count;
      const full = tool === 'seeds' ? `${text}: ${t(`item.${s.selectedSeed}`)}` : text;
      b.setAttribute('aria-label', count ? `${full} (${count})` : full);
    }
  };

  // ---------- monety z „toczącym się” licznikiem
  let shownCoins = store.get().coins;
  let anim = 0;
  const animateCoins = (target: number) => {
    cancelAnimationFrame(anim);
    const from = shownCoins;
    if (target > from) {
      coinsBox.classList.remove('bump');
      void coinsBox.offsetWidth;
      coinsBox.classList.add('bump');
    }
    if (app.reducedMotion() || Math.abs(target - from) < 2) {
      shownCoins = target;
      coinsEl.value = fmt(target);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 450);
      shownCoins = Math.round(from + (target - from) * (1 - (1 - k) ** 3));
      coinsEl.value = fmt(shownCoins);
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  };

  // ---------- pogoda (CSS)
  const drops = Array.from({ length: 40 }, () => {
    const i = document.createElement('i');
    i.style.left = `${Math.random() * 110}%`;
    i.style.animationDuration = `${0.6 + Math.random() * 0.5}s`;
    i.style.animationDelay = `${-Math.random() * 2}s`;
    return i;
  });
  weather.append(...drops);
  let lastWeather = '';

  const render = (s: GameState) => {
    renderTools(s);
    if (s.coins !== shownCoins) animateCoins(s.coins);
    const p = levelProgress(s.xp);
    levelEl.textContent = String(p.level);
    xpFill.style.width = `${Math.round(p.ratio * 100)}%`;
    spBadge.hidden = s.skillPoints <= 0;
    spBadge.textContent = String(s.skillPoints);
    $('#level-btn').setAttribute('aria-label', t('hud.level', { level: p.level, cur: p.current, need: p.needed }));
    const cal = calendarAt(s.clock.simMs, s.seed);
    const hour = ((s.clock.simMs + s.clock.accMs) % DAY_MS) / HOUR_MS;
    const fest = activeFestival(viewCtx(s));
    clock.innerHTML = `${WEATHER_ICON[cal.weather] ?? ''} ${clockText(hour)} · ${t(`season.${cal.season}`)} ${cal.dayOfSeason + 1}${
      fest ? `<span class="fest">🎪 ${t('hud.festival')}</span>` : ''
    }`;
    clock.setAttribute('aria-label', `${t(`weather.${cal.weather}`)}, ${clockText(hour)}, ${t(`season.${cal.season}`)}`);
    if (cal.weather !== lastWeather) {
      lastWeather = cal.weather;
      weather.className = `weather ${cal.weather}`;
    }
  };

  $('#level-btn').addEventListener('click', () => {
    app.click();
    app.openSheet('skills');
  });
  $('#menu-btn').addEventListener('click', () => {
    app.click();
    app.openSheet('settings');
  });

  coinsEl.value = fmt(shownCoins);
  render(store.get());
  store.subscribe(render);
  onLanguageChange(() => render(store.get()));

  return {
    coinTarget() {
      const r = coinsBox.getBoundingClientRect();
      return { x: r.left + 20, y: r.top + r.height / 2 };
    },
  };
}
