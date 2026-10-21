// Znaczniki przy krawędzi ekranu: gdy gotowe plony, zwierzęta albo wyroby maszyn są poza kadrem,
// przy brzegu pojawia się „pieczęć” z ikoną i strzałką w ich stronę. Dotknięcie przenosi tam kamerę.

import { CONTENT, parseKey } from '../content/content';
import { t } from '../i18n/i18n';
import { animalIconUrl, itemIconUrl } from '../render/art/atlas';
import { isReady } from '../sim/systems/fields';
import type { GameState } from '../sim/types';
import { plotTile } from '../sim/world';
import type { App } from './app';
import { h } from './dom';
import { edgePlacement } from './edge';

interface Target {
  kind: 'crops' | 'animals' | 'machines';
  /** Środek celu w kaflach. */
  x: number;
  y: number;
  icon: string;
  count: number;
}

function targets(s: GameState): Target[] {
  const out: Target[] = [];
  const ready = s.plots.map((p, i) => ({ p, i })).filter(({ p }) => isReady(p.crop));
  if (ready.length) {
    const tiles = ready.map(({ i }) => plotTile(i));
    out.push({
      kind: 'crops',
      x: tiles.reduce((a, b) => a + b.x, 0) / tiles.length + 0.5,
      y: tiles.reduce((a, b) => a + b.y, 0) / tiles.length + 0.5,
      icon: itemIconUrl(ready[0]!.p.crop!.id, 64),
      count: ready.length,
    });
  }
  const animals = s.animals.filter((a) => a.ready);
  const home = animals.length ? s.objects.find((o) => o.uid === animals[0]!.home) : undefined;
  if (home) {
    const def = CONTENT.buildings[home.type];
    out.push({ kind: 'animals', x: home.x + (def?.size[0] ?? 1) / 2, y: home.y + (def?.size[1] ?? 1) + 0.5, icon: animalIconUrl(animals[0]!.kind, 64), count: animals.length });
  }
  for (const [uid, m] of Object.entries(s.machines)) {
    const key = Object.keys(m.output).find((k) => (m.output[k] ?? 0) > 0);
    const o = key && s.objects.find((x) => String(x.uid) === uid);
    if (!key || !o) continue;
    const def = CONTENT.buildings[o.type];
    out.push({ kind: 'machines', x: o.x + (def?.size[0] ?? 1) / 2, y: o.y + (def?.size[1] ?? 1) / 2, icon: itemIconUrl(parseKey(key).id, 64), count: m.output[key] ?? 0 });
    break;
  }
  return out;
}

export function mountBeacons(app: App, dpr: () => number): void {
  const root = h('div', { class: 'beacons' });
  document.body.append(root);
  const views = new Map<Target['kind'], { el: HTMLButtonElement; img: HTMLImageElement; count: HTMLElement; arrow: HTMLElement; target: Target | null }>();
  for (const kind of ['crops', 'animals', 'machines'] as const) {
    const img = h('img', { attrs: { alt: '', width: '36', height: '36' } });
    const count = h('span', { class: 'beacon-count' });
    const arrow = h('span', { class: 'beacon-arrow', attrs: { 'aria-hidden': 'true' } });
    const el = h('button', { class: 'beacon', type: 'button', attrs: { 'aria-label': t(`beacon.${kind}`) } }, arrow, img, count);
    el.hidden = true;
    const v = { el, img, count, arrow, target: null as Target | null };
    el.addEventListener('click', () => {
      if (!v.target) return;
      app.click();
      app.scene()?.focusTile(v.target.x - 0.5, v.target.y - 0.5);
    });
    views.set(kind, v);
    root.append(el);
  }

  let state: GameState | null = null;
  const refresh = (s: GameState) => {
    if (s === state) return;
    state = s;
    const list = targets(s);
    for (const [kind, v] of views) {
      const tg = list.find((x) => x.kind === kind) ?? null;
      v.target = tg;
      if (!tg) continue;
      if (v.img.getAttribute('src') !== tg.icon) v.img.src = tg.icon;
      v.count.textContent = tg.count > 1 ? String(tg.count) : '';
    }
  };
  refresh(app.store.get());
  app.store.subscribe(refresh);

  const frame = () => {
    requestAnimationFrame(frame);
    const scene = app.scene();
    const sheetOpen = document.querySelector('.sheet:popover-open');
    for (const v of views.values()) {
      const tg = v.target;
      if (!scene || !tg || sheetOpen) {
        v.el.hidden = true;
        continue;
      }
      const d = dpr();
      const p = scene.screenOfTile({ x: tg.x, y: tg.y });
      const vp = scene.cam.viewport;
      const view = { x0: 0, y0: vp.insetTop / d, x1: vp.width / d, y1: (vp.height - vp.insetBottom) / d };
      const place = edgePlacement(p.x / d, p.y / d, view, 34);
      v.el.hidden = !place;
      if (!place) continue;
      v.el.style.transform = `translate(${place.x}px, ${place.y}px)`;
      v.arrow.style.transform = `rotate(${place.angle}rad)`;
    }
  };
  requestAnimationFrame(frame);
}
