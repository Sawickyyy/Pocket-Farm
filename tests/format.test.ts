import { describe, expect, it } from 'vitest';
import { formatDuration, plural } from '../src/ui/format';

describe('formatowanie', () => {
  it('czas wzrostu', () => {
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(60_000)).toBe('1 min');
    expect(formatDuration(90_000)).toBe('1 min 30 s');
    expect(formatDuration(15 * 60_000)).toBe('15 min');
    expect(formatDuration(3_600_000)).toBe('1 h');
    expect(formatDuration(3_600_000 * 0.85)).toBe('51 min');
  });

  it('polska odmiana liczebników', () => {
    expect(plural(1, 'roślina', 'rośliny', 'roślin')).toBe('roślina');
    expect(plural(3, 'roślina', 'rośliny', 'roślin')).toBe('rośliny');
    expect(plural(5, 'roślina', 'rośliny', 'roślin')).toBe('roślin');
    expect(plural(12, 'roślina', 'rośliny', 'roślin')).toBe('roślin');
    expect(plural(22, 'roślina', 'rośliny', 'roślin')).toBe('rośliny');
  });
});

import { edgePlacement } from '../src/ui/edge';

describe('znaczniki przy krawędzi ekranu', () => {
  const view = { x0: 0, y0: 100, x1: 400, y1: 700 };
  it('widoczny cel nie dostaje znacznika', () => {
    expect(edgePlacement(200, 300, view, 30)).toBeNull();
  });
  it('cel po prawej: znacznik przy prawej krawędzi, strzałka w prawo', () => {
    const p = edgePlacement(1000, 500, view, 30)!;
    expect(p.x).toBeCloseTo(370);
    expect(p.y).toBeGreaterThan(400);
    expect(p.y).toBeLessThan(500);
    expect(Math.abs(p.angle)).toBeLessThan(0.5);
  });
  it('cel wysoko nad ekranem: znacznik u góry w granicach marginesu', () => {
    const p = edgePlacement(220, -5000, view, 30)!;
    expect(p.y).toBeCloseTo(130);
    expect(p.x).toBeGreaterThanOrEqual(30);
    expect(p.x).toBeLessThanOrEqual(370);
  });
});
