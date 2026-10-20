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
