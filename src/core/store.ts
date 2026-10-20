// Minimalny reaktywny store: niemutowalny stan + subskrypcje z selektorami.

export type Listener<T> = (state: T, prev: T) => void;

export interface Store<T> {
  get(): T;
  set(next: T): void;
  update(fn: (state: T) => T): void;
  subscribe(listener: Listener<T>): () => void;
  /** Wywołuje `listener` tylko, gdy wartość selektora się zmieni (porównanie Object.is). */
  select<S>(selector: (state: T) => S, listener: (value: S, prev: S) => void, fireImmediately?: boolean): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener<T>>();

  const store: Store<T> = {
    get: () => state,
    set(next) {
      if (Object.is(next, state)) return;
      const prev = state;
      state = next;
      for (const l of [...listeners]) l(state, prev);
    },
    update(fn) {
      store.set(fn(state));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    select(selector, listener, fireImmediately = false) {
      let current = selector(state);
      if (fireImmediately) listener(current, current);
      return store.subscribe((s) => {
        const next = selector(s);
        if (Object.is(next, current)) return;
        const prev = current;
        current = next;
        listener(next, prev);
      });
    },
  };
  return store;
}
