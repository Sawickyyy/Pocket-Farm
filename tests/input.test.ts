import { describe, expect, it, vi } from 'vitest';
import { GestureRecognizer, type GestureHandlers } from '../src/input/gestures';
import { CameraModel } from '../src/render/cameraModel';

function handlers() {
  return {
    tap: vi.fn(),
    dragStart: vi.fn(),
    dragMove: vi.fn(),
    dragEnd: vi.fn(),
    pinch: vi.fn(),
    pinchEnd: vi.fn(),
  } satisfies GestureHandlers;
}

describe('GestureRecognizer', () => {
  it('tap: palec w dół i w górę bez ruchu', () => {
    const h = handlers();
    const g = new GestureRecognizer(h);
    g.down({ id: 1, x: 10, y: 10 });
    g.move({ id: 1, x: 13, y: 12 });
    g.up({ id: 1, x: 13, y: 12 });
    expect(h.tap).toHaveBeenCalledWith(13, 12);
    expect(h.dragStart).not.toHaveBeenCalled();
  });

  it('przeciągnięcie po przekroczeniu progu', () => {
    const h = handlers();
    const g = new GestureRecognizer(h, 10);
    g.down({ id: 1, x: 0, y: 0 });
    g.move({ id: 1, x: 20, y: 0 });
    g.move({ id: 1, x: 40, y: 0 });
    g.up({ id: 1, x: 40, y: 0 });
    expect(h.dragStart).toHaveBeenCalledWith(0, 0);
    expect(h.dragMove).toHaveBeenCalledTimes(2);
    expect(h.dragEnd).toHaveBeenCalledOnce();
    expect(h.tap).not.toHaveBeenCalled();
  });

  it('dwa palce: pinch zamiast akcji narzędzia', () => {
    const h = handlers();
    const g = new GestureRecognizer(h);
    g.down({ id: 1, x: 100, y: 100 });
    g.down({ id: 2, x: 200, y: 100 });
    g.move({ id: 2, x: 300, y: 100 });
    expect(h.pinch).toHaveBeenCalledOnce();
    const [dx, dy, scale] = h.pinch.mock.calls[0]!;
    expect(dx).toBe(50);
    expect(dy).toBe(0);
    expect(scale).toBeCloseTo(2);
    g.up({ id: 2, x: 300, y: 100 });
    // pozostały palec nie może orać
    g.move({ id: 1, x: 160, y: 100 });
    g.up({ id: 1, x: 160, y: 100 });
    expect(h.tap).not.toHaveBeenCalled();
    expect(h.dragStart).not.toHaveBeenCalled();
    expect(h.pinchEnd).toHaveBeenCalledOnce();
  });

  it('drugi palec w trakcie przeciągania kończy drag i przechodzi w pinch', () => {
    const h = handlers();
    const g = new GestureRecognizer(h);
    g.down({ id: 1, x: 0, y: 0 });
    g.move({ id: 1, x: 30, y: 0 });
    g.down({ id: 2, x: 100, y: 0 });
    expect(h.dragEnd).toHaveBeenCalledOnce();
    expect(g.currentMode).toBe('pinch');
  });

  it('pointercancel czyści stan', () => {
    const h = handlers();
    const g = new GestureRecognizer(h);
    g.down({ id: 1, x: 0, y: 0 });
    g.cancel({ id: 1, x: 0, y: 0 });
    expect(g.currentMode).toBe('idle');
    g.down({ id: 3, x: 0, y: 0 });
    g.up({ id: 3, x: 0, y: 0 });
    expect(h.tap).toHaveBeenCalledOnce();
  });
});

describe('CameraModel', () => {
  const viewport = { width: 1170, height: 2532, insetTop: 300, insetBottom: 400 };

  it('dopasowuje siatkę do widocznego obszaru między paskami', () => {
    const cam = new CameraModel(768, 1024);
    cam.setViewport(viewport, 0);
    cam.fit();
    expect(cam.zoom).toBeCloseTo(Math.min(1170 / 768, (2532 - 700) / 1024));
    // środek świata trafia w środek widocznego obszaru
    const visibleMidY = 300 + (2532 - 700) / 2;
    const p = cam.toWorld(1170 / 2, visibleMidY);
    expect(p.x).toBeCloseTo(384);
    expect(p.y).toBeCloseTo(512);
  });

  it('zoom wokół punktu zostawia ten punkt świata pod palcami', () => {
    const cam = new CameraModel(768, 1024);
    cam.setViewport(viewport, 0);
    cam.fit();
    const before = cam.toWorld(400, 1200);
    cam.zoomAt(1.5, 400, 1200);
    const after = cam.toWorld(400, 1200);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('ogranicza zoom i przesuwanie', () => {
    const cam = new CameraModel(768, 1024);
    cam.setViewport(viewport, 0);
    cam.fit();
    cam.zoomAt(100, 0, 0);
    expect(cam.zoom).toBeCloseTo(cam.maxZoom);
    cam.pan(-1e6, -1e6);
    expect(cam.focusX).toBe(768);
    expect(cam.focusY).toBe(1024);
  });
});
