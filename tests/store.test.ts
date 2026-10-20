import { describe, expect, it, vi } from 'vitest';
import { createStore } from '../src/core/store';

describe('store', () => {
  it('powiadamia subskrybentów o zmianach', () => {
    const store = createStore({ a: 1, b: 1 });
    const fn = vi.fn();
    const off = store.subscribe(fn);
    store.update((s) => ({ ...s, a: 2 }));
    expect(fn).toHaveBeenCalledWith({ a: 2, b: 1 }, { a: 1, b: 1 });
    off();
    store.update((s) => ({ ...s, a: 3 }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('nie powiadamia, gdy stan jest identyczny', () => {
    const store = createStore({ a: 1 });
    const fn = vi.fn();
    store.subscribe(fn);
    store.update((s) => s);
    expect(fn).not.toHaveBeenCalled();
  });

  it('select reaguje tylko na zmianę wybranego fragmentu', () => {
    const store = createStore({ a: 1, b: 1 });
    const fn = vi.fn();
    store.select((s) => s.a, fn);
    store.update((s) => ({ ...s, b: 2 }));
    expect(fn).not.toHaveBeenCalled();
    store.update((s) => ({ ...s, a: 5 }));
    expect(fn).toHaveBeenCalledWith(5, 1);
  });

  it('select z fireImmediately', () => {
    const store = createStore({ a: 7 });
    const fn = vi.fn();
    store.select((s) => s.a, fn, true);
    expect(fn).toHaveBeenCalledWith(7, 7);
  });
});
