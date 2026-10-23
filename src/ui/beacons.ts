// Znaczniki przy krawędzi ekranu: gdy gotowe plony, zwierzęta albo wyroby maszyn są poza kadrem,
// przy brzegu pojawia się „pieczęć” z ikoną i strzałką w ich stronę. Dotknięcie przenosi tam kamerę.
// Osada: pożar (najważniejszy, czerwony), awaria i karawana przy faktorii.

import { CONTENT, parseKey } from '../content/content';
import { t } from '../i18n/i18n';
import { animalIconUrl, itemIconUrl, uiIconUrl } from '../render/art/atlas';
import { isReady } from '../sim/systems/fields';
import type { GameState } from '../sim/types';
import { plotTile } from '../sim/world';
import type { App } from './app';
import { h } from './dom';
import { edgePlacement } from './edge';

const FARM_KINDS = ['crops', 'animals', 'machines'] as const;
const TOWN_KINDS = ['caravan', 'breakdown', 'fire'] as const;
type Kind = (typeof FARM_KINDS)[number] | (typeof TOWN_KINDS)[number];

interface Target {
  kind: Kind;
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
  return [...out, ...townTargets(s)];
}

/** Środek budynku (kafle). */
function centerOfObject(s: GameState, uid: number): { x: number; y: number } | null {
  const o = s.objects.find((x) => x.uid === uid);
  if (!o) return null;
  const def = CONTENT.buildings[o.type];
  return { x: o.x + (def?.size[0] ?? 1) / 2, y: o.y + (def?.size[1] ?? 1) / 2 };
}

/** Osada: płonące i zepsute budynki (pierwszy + liczba) oraz faktoria, gdy stoi karawana. */
function townTargets(s: GameState): Target[] {
  const out: Target[] = [];
  let fire: { x: number; y: number } | null = null;
  let broken: { x: number; y: number } | null = null;
  let fires = 0;
  let breaks = 0;
  for (const [uid, site] of Object.entries(s.settlement.sites)) {
    if (site.fire > 0) {
      fires++;
      fire ??= centerOfObject(s, Number(uid));
    } else if (site.broken) {
      breaks++;
      broken ??= centerOfObject(s, Number(uid));
    }
  }
  if (fire) out.push({ kind: 'fire', ...fire, icon: uiIconUrl('flame', 64), count: fires });
  if (broken) out.push({ kind: 'breakdown', ...broken, icon: uiIconUrl('wrench', 64), count: breaks });
  if (s.settlement.caravan) {
    const post = s.objects.find((o) => CONTENT.buildings[o.type]?.service?.kind === 'trade');
    const at = post && centerOfObject(s, post.uid);
    if (at) out.push({ kind: 'caravan', ...at, icon: uiIconUrl('wagon', 64), count: 1 });
  }
  return out;
}

export function mountBeacons(app: App, dpr: () => number): void {
  const root = h('div', { class: 'beacons' });
  document.body.append(root);
  const views = new Map<Kind, { el: HTMLButtonElement; img: HTMLImageElement; count: HTMLElement; arrow: HTMLElement; target: Target | null }>();
  // pożar ostatni w DOM-ie – leży nad innymi znacznikami przy tym samym brzegu
  for (const kind of [...FARM_KINDS, ...TOWN_KINDS]) {
    const town = (TOWN_KINDS as readonly string[]).includes(kind);
    const img = h('img', { attrs: { alt: '', width: '36', height: '36' } });
    const count = h('span', { class: 'beacon-count' });
    const arrow = h('span', { class: 'beacon-arrow', attrs: { 'aria-hidden': 'true' } });
    const el = h('button', { class: town ? `beacon town-beacon beacon-${kind}` : 'beacon', type: 'button', attrs: { 'aria-label': t(town ? `townHud.beacon.${kind}` : `beacon.${kind}`) } }, arrow, img, count);
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
