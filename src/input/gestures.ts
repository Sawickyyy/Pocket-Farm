// Rozpoznawanie gestów z Pointer Events, niezależne od Phasera i DOM-u (testowalne).
//  - tap: jeden palec, bez ruchu → akcja narzędzia
//  - przeciągnięcie: jeden palec z ruchem → akcja na wielu polach
//  - dwa palce: przesuwanie + zoom (pinch)
//  - przytrzymanie: jeden palec bez ruchu przez chwilę → podgląd (zamiast tapu)

export interface GesturePoint {
  id: number;
  x: number;
  y: number;
}

export interface GestureHandlers {
  tap(x: number, y: number): void;
  dragStart(x: number, y: number): void;
  dragMove(x: number, y: number): void;
  dragEnd(): void;
  /** Przesunięcie środka i zmiana skali względem poprzedniej klatki, wokół punktu (cx, cy). */
  pinch(dx: number, dy: number, scale: number, cx: number, cy: number): void;
  pinchEnd(): void;
  /** Przytrzymanie palca w miejscu; po nim puszczenie nie daje już tapu. */
  longPress?(x: number, y: number): void;
  /** Koniec przytrzymania (palec podniesiony). */
  longPressEnd?(): void;
}

type Mode = 'idle' | 'pending' | 'drag' | 'pinch' | 'cooldown' | 'held';

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

const browserTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export class GestureRecognizer {
  private readonly points = new Map<number, GesturePoint>();
  private mode: Mode = 'idle';
  private start: GesturePoint | null = null;
  private lastMid = { x: 0, y: 0 };
  private lastDist = 0;

  constructor(
    private readonly handlers: GestureHandlers,
    /** Ruch (w px CSS) po którym tap zamienia się w przeciągnięcie. */
    private readonly dragThreshold = 10,
    private readonly holdMs = 450,
    private readonly timers: Timers = browserTimers,
  ) {}

  private holdTimer: unknown = null;

  private clearHold(): void {
    if (this.holdTimer !== null) this.timers.clear(this.holdTimer);
    this.holdTimer = null;
  }

  get currentMode(): Mode {
    return this.mode;
  }

  down(p: GesturePoint): void {
    this.points.set(p.id, { ...p });
    if (this.points.size === 1 && (this.mode === 'idle' || this.mode === 'cooldown')) {
      this.mode = 'pending';
      this.start = { ...p };
      if (this.handlers.longPress) {
        this.holdTimer = this.timers.set(() => {
          this.holdTimer = null;
          if (this.mode !== 'pending' || !this.start) return;
          this.mode = 'held';
          this.handlers.longPress?.(this.start.x, this.start.y);
        }, this.holdMs);
      }
    } else if (this.points.size === 2) {
      this.clearHold();
      if (this.mode === 'held') this.handlers.longPressEnd?.();
      if (this.mode === 'drag') this.handlers.dragEnd();
      this.mode = 'pinch';
      this.resetPinchBaseline();
    }
  }

  move(p: GesturePoint): void {
    if (!this.points.has(p.id)) return;
    this.points.set(p.id, { ...p });

    if (this.mode === 'pending' && this.start) {
      if (Math.hypot(p.x - this.start.x, p.y - this.start.y) >= this.dragThreshold) {
        this.clearHold();
        this.mode = 'drag';
        this.handlers.dragStart(this.start.x, this.start.y);
        this.handlers.dragMove(p.x, p.y);
      }
    } else if (this.mode === 'drag') {
      this.handlers.dragMove(p.x, p.y);
    } else if (this.mode === 'pinch' && this.points.size >= 2) {
      const { mid, dist } = this.pinchMetrics();
      const scale = this.lastDist > 0 && dist > 0 ? dist / this.lastDist : 1;
      this.handlers.pinch(mid.x - this.lastMid.x, mid.y - this.lastMid.y, scale, mid.x, mid.y);
      this.lastMid = mid;
      this.lastDist = dist;
    }
  }

  up(p: GesturePoint): void {
    if (!this.points.has(p.id)) return;
    this.points.delete(p.id);
    this.clearHold();

    if (this.mode === 'pending') {
      this.handlers.tap(p.x, p.y);
      this.mode = 'idle';
    } else if (this.mode === 'held') {
      this.handlers.longPressEnd?.();
      this.mode = 'idle';
    } else if (this.mode === 'drag') {
      this.handlers.dragEnd();
      this.mode = 'idle';
    } else if (this.mode === 'pinch') {
      if (this.points.size >= 2) {
        this.resetPinchBaseline();
      } else {
        this.handlers.pinchEnd();
        // Pozostały palec nie może nagle zacząć orać pól – czekamy aż wszystkie palce się podniosą.
        this.mode = this.points.size === 0 ? 'idle' : 'cooldown';
      }
    } else if (this.points.size === 0) {
      this.mode = 'idle';
    }
    if (this.points.size === 0) this.start = null;
  }

  cancel(p: GesturePoint): void {
    if (!this.points.has(p.id)) return;
    this.points.delete(p.id);
    this.clearHold();
    if (this.mode === 'held') this.handlers.longPressEnd?.();
    if (this.mode === 'drag') this.handlers.dragEnd();
    if (this.mode === 'pinch') this.handlers.pinchEnd();
    this.mode = this.points.size === 0 ? 'idle' : 'cooldown';
  }

  private pinchMetrics(): { mid: { x: number; y: number }; dist: number } {
    const [a, b] = [...this.points.values()];
    if (!a || !b) return { mid: this.lastMid, dist: this.lastDist };
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  private resetPinchBaseline(): void {
    const { mid, dist } = this.pinchMetrics();
    this.lastMid = mid;
    this.lastDist = dist;
  }
}
