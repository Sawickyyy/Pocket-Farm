// Pointer Events na elemencie gry → GestureRecognizer → trasowanie: budowanie, zwierzęta, pola, budynki,
// zbieractwo, łowienie, odkrywanie mgły. Przeciąganie po polu = akcja na wielu polach, poza polem = przesuwanie mapy.

import { CONTENT } from '../content/content';
import { t } from '../i18n/i18n';
import type { FarmScene } from '../render/FarmScene';
import { canUnlock, plotUnlockCost } from '../sim/systems/fields';
import { objectAt } from '../sim/systems/building';
import { canExplore, exploreCost, forageReady, isRevealed } from '../sim/systems/exploration';
import { START_UNLOCKED } from '../sim/initialState';
import { MAP_H, MAP_W, biomeAt, chunkOfTile, generateWorld, plotAtTile, tileIndex } from '../sim/world';
import type { App } from '../ui/app';
import type { BuildMode } from '../ui/buildMode';
import { viewCtx } from '../ui/view';
import { GestureRecognizer } from './gestures';

export function bindPointerInput(el: HTMLElement, scene: FarmScene, app: App, build: BuildMode, dpr: () => number, onFirstInteraction: () => void): () => void {
  let dragMode: 'tool' | 'pan' | 'build' | null = null;
  let lastDragPlot: number | null = null;
  let lastPan = { x: 0, y: 0 };

  const toLocal = (x: number, y: number): [number, number] => {
    const r = el.getBoundingClientRect();
    return [(x - r.left) * dpr(), (y - r.top) * dpr()];
  };
  const tileUnder = (x: number, y: number) => scene.tileAt(...toLocal(x, y));
  const plotUnder = (x: number, y: number) => {
    const tl = tileUnder(x, y);
    return plotAtTile(tl.x, tl.y);
  };

  function tap(x: number, y: number): void {
    const state = app.store.get();
    const tile = tileUnder(x, y);
    scene.showHighlight(null);
    if (build.active) {
      build.pointTile(tile.x, tile.y);
      return;
    }
    if (tile.x < 0 || tile.y < 0 || tile.x >= MAP_W || tile.y >= MAP_H) return;

    const animal = scene.animalAt(...toLocal(x, y));
    if (animal !== null) {
      const a = state.animals.find((v) => v.id === animal);
      if (a) {
        app.openSheet('building', a.home);
        return;
      }
    }

    const npc = scene.villagerAt(...toLocal(x, y));
    if (npc !== null) {
      app.openSheet('village', npc, 'people');
      return;
    }

    // 2.5D: bryła budynku zasłania kafle za nią – najpierw sprawdzamy trafienie w sprite.
    const building = scene.objectAt(...toLocal(x, y));
    if (building !== null && plotAtTile(tile.x, tile.y) === null) {
      app.openSheet('building', building);
      return;
    }

    const plot = plotAtTile(tile.x, tile.y);
    if (plot !== null) {
      const p = state.plots[plot]!;
      if (!p.unlocked) {
        if (!canUnlock(state, plot)) {
          app.toasts.show(t('fail.not-adjacent'), 'warn');
          return;
        }
        const cost = plotUnlockCost(state, START_UNLOCKED.length);
        const missing = cost - state.coins;
        app.confirm(
          t('unlock.title'),
          t('unlock.text', { cost }) + (missing > 0 ? `<br><small>${t('unlock.missing', { n: missing })}</small>` : ''),
          t('common.buy'),
          () => void app.send({ type: 'unlockPlot', plot }),
          missing > 0,
        );
        return;
      }
      void app.send({ type: 'useTool', plot });
      return;
    }

    const obj = objectAt(state, CONTENT, tile.x, tile.y);
    if (obj && CONTENT.buildings[obj.type]?.kind !== 'path') {
      app.openSheet('building', obj.uid);
      return;
    }

    const chunk = chunkOfTile(tile.x, tile.y);
    if (!isRevealed(state, tile.x, tile.y)) {
      if (!canExplore(state, chunk)) {
        app.toasts.show(t('fail.hidden'), 'warn');
        return;
      }
      const cost = exploreCost(state);
      app.confirm(t('explore.title'), t('explore.text', { cost }), t('explore.go'), () => void app.send({ type: 'explore', chunk }), state.coins < cost);
      return;
    }

    const world = generateWorld(state.seed);
    const ti = tileIndex(tile.x, tile.y);
    if (world.forage[ti] && forageReady(viewCtx(state), ti)) {
      void app.send({ type: 'forage', tile: ti });
      return;
    }
    if (biomeAt(world, tile.x, tile.y) === 'water') {
      if (state.tool === 'rod') void app.send({ type: 'castLine', tile: ti });
      else app.toasts.show(t('hint.rod'));
    }
  }

  const recognizer = new GestureRecognizer({
    tap,
    dragStart(x, y) {
      if (build.active) {
        dragMode = 'build';
        const tl = tileUnder(x, y);
        build.pointTile(tl.x, tl.y);
        return;
      }
      const plot = plotUnder(x, y);
      if (plot !== null && app.store.get().plots[plot]?.unlocked) {
        dragMode = 'tool';
        lastDragPlot = plot;
        const tl = tileUnder(x, y);
        scene.showHighlight(tl);
        void app.send({ type: 'useTool', plot, silent: true }, true);
      } else {
        dragMode = 'pan';
        scene.cam.stop();
        lastPan = { x, y };
      }
    },
    dragMove(x, y) {
      if (dragMode === 'build') {
        const tl = tileUnder(x, y);
        build.pointTile(tl.x, tl.y);
      } else if (dragMode === 'tool') {
        const plot = plotUnder(x, y);
        if (plot === null || plot === lastDragPlot) return;
        lastDragPlot = plot;
        scene.showHighlight(tileUnder(x, y));
        void app.send({ type: 'useTool', plot, silent: true }, true);
      } else if (dragMode === 'pan') {
        const d = dpr();
        scene.cam.pan((x - lastPan.x) * d, (y - lastPan.y) * d);
        scene.applyCamera();
        lastPan = { x, y };
      }
    },
    dragEnd() {
      if (dragMode === 'pan' && !app.reducedMotion()) scene.cam.release();
      dragMode = null;
      lastDragPlot = null;
      scene.showHighlight(null);
    },
    pinch(dx, dy, scale, cx, cy) {
      const d = dpr();
      const [lx, ly] = toLocal(cx, cy);
      scene.cam.pan(dx * d, dy * d);
      scene.cam.zoomAt(scale, lx, ly);
      scene.applyCamera();
    },
    pinchEnd() {
      scene.showHighlight(null);
      if (!app.reducedMotion()) scene.cam.release();
    },
  });

  const point = (e: PointerEvent) => ({ id: e.pointerId, x: e.clientX, y: e.clientY });

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    onFirstInteraction();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // wskaźnik mógł już zniknąć (bardzo krótki tap) – przechwycenie nie jest wtedy potrzebne
    }
    scene.cam.stop();
    recognizer.down(point(e));
    if (recognizer.currentMode === 'pending' && !build.active) {
      const tl = tileUnder(e.clientX, e.clientY);
      scene.showHighlight(plotAtTile(tl.x, tl.y) !== null ? tl : null);
    } else scene.showHighlight(null);
  };
  const onMove = (e: PointerEvent) => {
    e.preventDefault();
    // Na ekranach 120 Hz Safari łączy zdarzenia – bierzemy pośrednie punkty, żeby nie gubić pól przy przeciąganiu.
    const coalesced = e.getCoalescedEvents?.() ?? [];
    if (coalesced.length > 1 && recognizer.currentMode === 'drag' && dragMode === 'tool') for (const c of coalesced) recognizer.move(point(c));
    else recognizer.move(point(e));
  };
  const onUp = (e: PointerEvent) => {
    e.preventDefault();
    recognizer.up(point(e));
  };
  const onCancel = (e: PointerEvent) => recognizer.cancel(point(e));
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const [lx, ly] = toLocal(e.clientX, e.clientY);
    scene.cam.zoomAt(Math.exp(-e.deltaY * 0.0015), lx, ly);
    scene.applyCamera();
  };

  const opts: AddEventListenerOptions = { passive: false };
  el.addEventListener('pointerdown', onDown, opts);
  el.addEventListener('pointermove', onMove, opts);
  el.addEventListener('pointerup', onUp, opts);
  el.addEventListener('pointercancel', onCancel);
  el.addEventListener('lostpointercapture', onCancel);
  el.addEventListener('wheel', onWheel, opts);
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
    el.removeEventListener('lostpointercapture', onCancel);
    el.removeEventListener('wheel', onWheel);
  };
}
