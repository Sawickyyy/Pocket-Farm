// Prosty, typowany event bus: systemy symulacji komunikują się zdarzeniami zamiast wywoływać się nawzajem.

type Handler<E> = (event: E) => void;

export class EventBus<E extends { type: string }> {
  private readonly handlers = new Map<string, Set<Handler<E>>>();
  private readonly any = new Set<Handler<E>>();

  on<T extends E['type']>(type: T, handler: Handler<Extract<E, { type: T }>>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler as Handler<E>);
    return () => set.delete(handler as Handler<E>);
  }

  onAny(handler: Handler<E>): () => void {
    this.any.add(handler);
    return () => this.any.delete(handler);
  }

  emit(event: E): void {
    const set = this.handlers.get(event.type);
    if (set) for (const h of set) h(event);
    for (const h of this.any) h(event);
  }
}
