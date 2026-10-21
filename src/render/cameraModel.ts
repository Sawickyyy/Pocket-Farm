// Matematyka kamery bez zależności od Phasera: dopasowanie, przesuwanie z inercją, zoom wokół punktu, płynne przejścia.
// Konwencja jak w Phaserze: punkt ekranu sx → świat: centerX + (sx − w/2) / zoom.

export interface Viewport {
  /** Rozmiar canvasu w pikselach urządzenia. */
  width: number;
  height: number;
  /** Pasy zasłonięte przez interfejs HTML (piksele urządzenia). */
  insetTop: number;
  insetBottom: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FRICTION_PER_FRAME = 0.92;
const SMOOTH_MS = 140;

export class CameraModel {
  focusX: number;
  focusY: number;
  zoom = 1;
  fitZoom = 1;
  viewport: Viewport = { width: 1, height: 1, insetTop: 0, insetBottom: 0 };
  /** Prędkość inercji (świat / ms). */
  velX = 0;
  velY = 0;
  private target: { x: number; y: number; zoom: number } | null = null;
  private lastPan = { dx: 0, dy: 0, t: 0 };

  constructor(
    /** Obszar dopasowywany do ekranu (pole uprawne). */
    public fitRect: Rect,
    /** Granice przesuwania (odkryta część mapy). */
    public bounds: Rect,
    readonly minZoomFactor = 0.4,
    readonly maxZoomFactor = 2.5,
    /** Przybliżenie startowe względem „całe pole na ekranie” (w 2.5D romb pola jest szeroki, a kafle muszą być duże). */
    readonly fitScale = 1,
  ) {
    this.focusX = fitRect.x + fitRect.w / 2;
    this.focusY = fitRect.y + fitRect.h / 2;
  }

  get minZoom(): number {
    return this.fitZoom * this.minZoomFactor;
  }

  get maxZoom(): number {
    return this.fitZoom * this.maxZoomFactor;
  }

  private get visibleCenterY(): number {
    const { height, insetTop, insetBottom } = this.viewport;
    return insetTop + (height - insetTop - insetBottom) / 2;
  }

  get centerX(): number {
    return this.focusX;
  }

  get centerY(): number {
    return this.focusY - (this.visibleCenterY - this.viewport.height / 2) / this.zoom;
  }

  setViewport(v: Viewport, padding: number): void {
    const relative = this.zoom / this.fitZoom;
    this.viewport = v;
    const availW = Math.max(1, v.width - padding * 2);
    const availH = Math.max(1, v.height - v.insetTop - v.insetBottom - padding * 2);
    this.fitZoom = Math.min(availW / this.fitRect.w, availH / this.fitRect.h) * this.fitScale;
    this.zoom = this.clampZoom(this.fitZoom * (Number.isFinite(relative) ? relative : 1));
    this.clampFocus();
  }

  fit(animate = false): void {
    this.focusOn(this.fitRect.x + this.fitRect.w / 2, this.fitRect.y + this.fitRect.h / 2, this.fitZoom, animate);
  }

  focusOn(x: number, y: number, zoom = this.zoom, animate = true): void {
    const z = this.clampZoom(zoom);
    this.velX = this.velY = 0;
    if (animate) {
      this.target = { x, y, zoom: z };
    } else {
      this.target = null;
      this.focusX = x;
      this.focusY = y;
      this.zoom = z;
      this.clampFocus();
    }
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: this.centerX + (sx - this.viewport.width / 2) / this.zoom,
      y: this.centerY + (sy - this.viewport.height / 2) / this.zoom,
    };
  }

  toScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.centerX) * this.zoom + this.viewport.width / 2,
      y: (wy - this.centerY) * this.zoom + this.viewport.height / 2,
    };
  }

  /** Przesunięcie o wektor ekranowy (palce w prawo → świat jedzie w prawo). */
  pan(dx: number, dy: number, now = performance.now()): void {
    this.target = null;
    this.focusX -= dx / this.zoom;
    this.focusY -= dy / this.zoom;
    this.clampFocus();
    this.lastPan = { dx, dy, t: now };
  }

  /** Puszczenie palca: kontynuacja ruchu z inercją. */
  release(now = performance.now(), sampleMs = 16): void {
    if (now - this.lastPan.t > 80) return;
    this.velX = -this.lastPan.dx / this.zoom / sampleMs;
    this.velY = -this.lastPan.dy / this.zoom / sampleMs;
  }

  stop(): void {
    this.velX = this.velY = 0;
    this.target = null;
  }

  zoomAt(scale: number, sx: number, sy: number): void {
    this.target = null;
    const before = this.toWorld(sx, sy);
    this.zoom = this.clampZoom(this.zoom * scale);
    const after = this.toWorld(sx, sy);
    this.focusX += before.x - after.x;
    this.focusY += before.y - after.y;
    this.clampFocus();
  }

  /** Krok animacji; zwraca true, jeśli kamera się poruszyła. */
  update(dtMs: number): boolean {
    let moved = false;
    if (this.target) {
      const k = 1 - Math.exp(-dtMs / SMOOTH_MS);
      this.focusX += (this.target.x - this.focusX) * k;
      this.focusY += (this.target.y - this.focusY) * k;
      this.zoom += (this.target.zoom - this.zoom) * k;
      if (Math.abs(this.target.x - this.focusX) < 0.5 && Math.abs(this.target.y - this.focusY) < 0.5 && Math.abs(this.target.zoom - this.zoom) < 1e-3) {
        this.focusX = this.target.x;
        this.focusY = this.target.y;
        this.zoom = this.target.zoom;
        this.target = null;
      }
      this.clampFocus();
      moved = true;
    }
    if (this.velX || this.velY) {
      this.focusX += this.velX * dtMs;
      this.focusY += this.velY * dtMs;
      const f = FRICTION_PER_FRAME ** (dtMs / 16.67);
      this.velX *= f;
      this.velY *= f;
      if (Math.hypot(this.velX, this.velY) * this.zoom < 0.02) this.velX = this.velY = 0;
      this.clampFocus();
      moved = true;
    }
    return moved;
  }

  private clampZoom(z: number): number {
    return Math.min(this.maxZoom, Math.max(this.minZoom, z));
  }

  private clampFocus(): void {
    const b = this.bounds;
    const fx = Math.min(b.x + b.w, Math.max(b.x, this.focusX));
    const fy = Math.min(b.y + b.h, Math.max(b.y, this.focusY));
    if (fx !== this.focusX) this.velX = 0;
    if (fy !== this.focusY) this.velY = 0;
    this.focusX = fx;
    this.focusY = fy;
  }
}
