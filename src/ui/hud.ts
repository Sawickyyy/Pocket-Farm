// Górny pasek (monety, poziom, menu), zegar z pogodą, dolny pasek narzędzi i nakładka pogody.

import { itemIconUrl } from '../render/art/atlas';
import { fmt, onLanguageChange, t } from '../i18n/i18n';
import { DAY_MS, HOUR_MS, calendarAt } from '../sim/calendar';
import { countItem, levelProgress } from '../sim/ctx';
import { activeFestival } from '../sim/systems/progress';
import { TOOL_IDS, type GameState, type ToolId } from '../sim/types';
import type { App } from './app';
import { $, h } from './dom';
import { clockText, seasonIcon, weatherIcon } from './format';
import { ic } from './uiIcons';
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
        html = ic('cottage');
        const ready =
          [...s.quests.daily, ...s.quests.weekly].filter((q) => !q.claimed && q.progress >= q.target).length +
          s.orders.filter((o) => countItem(s, o.item) >= o.qty).length;
        count = ready ? String(ready) : '';
      } else html = ic(tool);
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
    // zarobek: podskok kapsuły; wydatek: krótkie „zapadnięcie” z terakotowym błyskiem
    const cls = target > from ? 'bump' : 'spend';
    coinsBox.classList.remove('bump', 'spend');
    void coinsBox.offsetWidth;
    coinsBox.classList.add(cls);
    if (app.reducedMotion() || Math.abs(target - from) < 2) {
      shownCoins = target;
      settleDigits(fmt(from), fmt(target));
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 450);
      shownCoins = Math.round(from + (target - from) * (1 - (1 - k) ** 3));
      if (k < 1) {
        coinsEl.textContent = fmt(shownCoins);
        anim = requestAnimationFrame(step);
      } else settleDigits(fmt(from), fmt(target));
    };
    anim = requestAnimationFrame(step);
  };

  /** Końcowa liczba jako osobne cyfry; zmienione cyfry podskakują każda z własnym opóźnieniem (jak liczydło). */
  const settleDigits = (before: string, after: string) => {
    const pad = (s: string) => s.padStart(Math.max(before.length, after.length), ' ');
    const a = pad(before);
    const b = pad(after);
    coinsEl.replaceChildren(
      ...[...b].map((ch, i) => {
        const span = document.createElement('span');
        span.textContent = ch === ' ' ? '' : ch;
        if (ch !== a[i] && ch !== ' ' && !app.reducedMotion()) {
          span.className = 'digit-tick';
          span.style.animationDelay = `${(b.length - 1 - i) * 45}ms`;
        }
        return span;
      }),
    );
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
  let lastClock = '';

  const render = (s: GameState) => {
    renderTools(s);
    if (s.coins !== shownCoins) animateCoins(s.coins);
    const p = levelProgress(s.xp);
    if (levelEl.textContent !== String(p.level)) {
      const first = levelEl.textContent === '';
      levelEl.textContent = String(p.level);
      if (!first && !app.reducedMotion()) {
        levelEl.classList.remove('pop');
        void levelEl.offsetWidth;
        levelEl.classList.add('pop');
      }
    }
    xpFill.style.width = `${Math.round(p.ratio * 100)}%`;
    spBadge.hidden = s.skillPoints <= 0;
    spBadge.textContent = String(s.skillPoints);
    $('#level-btn').setAttribute('aria-label', t('hud.level', { level: p.level, cur: p.current, need: p.needed }));
    const cal = calendarAt(s.clock.simMs, s.seed);
    const hour = ((s.clock.simMs + s.clock.accMs) % DAY_MS) / HOUR_MS;
    const fest = activeFestival(viewCtx(s));
    const clockHtml = `${weatherIcon(cal.weather)}<span>${clockText(hour)} · ${t(`season.${cal.season}`)} ${cal.dayOfSeason + 1}</span>${seasonIcon(cal.season)}${
      fest ? `<span class="fest">${ic('tent')}${t('hud.festival')}</span>` : ''
    }`;
    if (clockHtml !== lastClock) {
      lastClock = clockHtml;
      clock.innerHTML = clockHtml;
    }
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
