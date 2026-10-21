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
  const field = { x: 0, y: 0, w: 768, h: 1024 };
  const bounds = { x: -500, y: -500, w: 1768, h: 2024 };

  it('dopasowuje pole do widocznego obszaru między paskami', () => {
    const cam = new CameraModel(field, bounds);
    cam.setViewport(viewport, 0);
    cam.fit();
    expect(cam.zoom).toBeCloseTo(Math.min(1170 / 768, (2532 - 700) / 1024));
    const p = cam.toWorld(1170 / 2, 300 + (2532 - 700) / 2);
    expect(p.x).toBeCloseTo(384);
    expect(p.y).toBeCloseTo(512);
    const back = cam.toScreen(p.x, p.y);
    expect(back.y).toBeCloseTo(300 + (2532 - 700) / 2);
  });

  it('zoom wokół punktu zostawia ten punkt pod palcami', () => {
    const cam = new CameraModel(field, bounds);
    cam.setViewport(viewport, 0);
    cam.fit();
    const before = cam.toWorld(400, 1200);
    cam.zoomAt(1.5, 400, 1200);
    const after = cam.toWorld(400, 1200);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('ogranicza zoom i przesuwanie do granic', () => {
    const cam = new CameraModel(field, bounds);
    cam.setViewport(viewport, 0);
    cam.fit();
    cam.zoomAt(100, 0, 0);
    expect(cam.zoom).toBeCloseTo(cam.maxZoom);
    cam.pan(-1e6, -1e6);
    expect(cam.focusX).toBe(bounds.x + bounds.w);
    expect(cam.focusY).toBe(bounds.y + bounds.h);
  });

  it('inercja po puszczeniu palca wygasa', () => {
    const cam = new CameraModel(field, bounds);
    cam.setViewport(viewport, 0);
    cam.fit();
    cam.pan(-30, 0, 1000);
    cam.release(1010);
    const x0 = cam.focusX;
    expect(cam.update(16)).toBe(true);
    expect(cam.focusX).toBeGreaterThan(x0);
    for (let i = 0; i < 500; i++) cam.update(16);
    expect(cam.velX).toBe(0);
    expect(cam.update(16)).toBe(false);
  });

  it('płynne przejście do celu', () => {
    const cam = new CameraModel(field, bounds);
    cam.setViewport(viewport, 0);
    cam.fit();
    cam.focusOn(0, 0, cam.fitZoom, true);
    cam.update(16);
    expect(cam.focusX).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) cam.update(16);
    expect(cam.focusX).toBe(0);
  });
});
