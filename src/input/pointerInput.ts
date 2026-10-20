// Most: natywne Pointer Events na elemencie gry → GestureRecognizer → kontroler i kamera sceny.
// Używamy własnej obsługi zamiast wejścia Phasera, żeby mieć pełną kontrolę nad tap/drag/pinch.

import type { GameController } from '../game/controller';
import type { FarmScene } from '../render/FarmScene';
import { GestureRecognizer } from './gestures';

export function bindPointerInput(
  el: HTMLElement,
  scene: FarmScene,
  controller: GameController,
  dpr: () => number,
  onFirstInteraction: () => void,
): () => void {
  let lastDragPlot: number | null = null;

  const toLocal = (x: number, y: number): [number, number] => {
    const r = el.getBoundingClientRect();
    return [(x - r.left) * dpr(), (y - r.top) * dpr()];
  };

  const recognizer = new GestureRecognizer({
    tap(x, y) {
      const plot = scene.plotAt(...toLocal(x, y));
      scene.showHighlight(null);
      if (plot !== null) controller.tapPlot(plot);
    },
    dragStart(x, y) {
      lastDragPlot = scene.plotAt(...toLocal(x, y));
      if (lastDragPlot !== null) {
        scene.showHighlight(lastDragPlot);
        controller.dragPlot(lastDragPlot);
      }
    },
    dragMove(x, y) {
      const plot = scene.plotAt(...toLocal(x, y));
      if (plot === null || plot === lastDragPlot) return;
      lastDragPlot = plot;
      scene.showHighlight(plot);
      controller.dragPlot(plot);
    },
    dragEnd() {
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
      // wskaźnik mógł już zniknąć (np. bardzo krótki tap) – przechwycenie nie jest wtedy potrzebne
    }
    recognizer.down(point(e));
    if (recognizer.currentMode === 'pending') {
      scene.showHighlight(scene.plotAt(...toLocal(e.clientX, e.clientY)));
    } else {
      scene.showHighlight(null);
    }
  };
  const onMove = (e: PointerEvent) => {
    e.preventDefault();
    // Na ekranach 120 Hz Safari łączy zdarzenia – bierzemy wszystkie pośrednie punkty, żeby nie gubić pól.
    const events = e.getCoalescedEvents?.() ?? [];
    if (events.length > 1 && recognizer.currentMode === 'drag') for (const c of events) recognizer.move(point(c));
    else recognizer.move(point(e));
  };
  const onUp = (e: PointerEvent) => {
    e.preventDefault();
    recognizer.up(point(e));
  };
  const onCancel = (e: PointerEvent) => recognizer.cancel(point(e));

  // Mysz/trackpad na desktopie: kółko = zoom (wygodne przy testach w przeglądarce).
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
