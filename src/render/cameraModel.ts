// Matematyka kamery (przesuwanie, zoom wokół punktu, dopasowanie do ekranu) bez zależności od Phasera.
// Konwencja jak w Phaserze: środek kamery (cx, cy) w świecie, punkt ekranu sx → świat: cx + (sx - w/2) / zoom.

export interface Viewport {
  /** Rozmiar canvasu w pikselach urządzenia. */
  width: number;
  height: number;
  /** Zasłonięte przez interfejs HTML pasy u góry i u dołu (piksele urządzenia). */
  insetTop: number;
  insetBottom: number;
}

export class CameraModel {
  /** Punkt świata wyświetlany w środku widocznego obszaru (między paskami). */
  focusX: number;
  focusY: number;
  zoom = 1;
  fitZoom = 1;
  viewport: Viewport = { width: 1, height: 1, insetTop: 0, insetBottom: 0 };

  constructor(
    readonly worldWidth: number,
    readonly worldHeight: number,
    /** Lewy górny róg obszaru, który dopasowujemy do ekranu (siatka pól), we współrzędnych świata. */
    readonly originX = 0,
    readonly originY = 0,
    readonly minZoomFactor = 0.85,
    readonly maxZoomFactor = 2.5,
  ) {
    this.focusX = originX + worldWidth / 2;
    this.focusY = originY + worldHeight / 2;
  }

  get minZoom(): number {
    return this.fitZoom * this.minZoomFactor;
  }

  get maxZoom(): number {
    return this.fitZoom * this.maxZoomFactor;
  }

  /** Ekranowy środek widocznego obszaru. */
  private get visibleCenterY(): number {
    const { height, insetTop, insetBottom } = this.viewport;
    return insetTop + (height - insetTop - insetBottom) / 2;
  }

  /** Środek kamery w świecie (do przekazania do `camera.centerOn`). */
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
    this.fitZoom = Math.min(availW / this.worldWidth, availH / this.worldHeight);
    this.zoom = this.clampZoom(this.fitZoom * (Number.isFinite(relative) ? relative : 1));
    this.clampFocus();
  }

  fit(): void {
    this.zoom = this.fitZoom;
    this.focusX = this.originX + this.worldWidth / 2;
    this.focusY = this.originY + this.worldHeight / 2;
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: this.centerX + (sx - this.viewport.width / 2) / this.zoom,
      y: this.centerY + (sy - this.viewport.height / 2) / this.zoom,
    };
  }

  /** Przesunięcie o wektor ekranowy (palce w prawo → świat w prawo). */
  pan(dx: number, dy: number): void {
    this.focusX -= dx / this.zoom;
    this.focusY -= dy / this.zoom;
    this.clampFocus();
  }

  /** Zoom wokół punktu ekranu – ten punkt świata zostaje pod palcami. */
  zoomAt(scale: number, sx: number, sy: number): void {
    const before = this.toWorld(sx, sy);
    this.zoom = this.clampZoom(this.zoom * scale);
    const after = this.toWorld(sx, sy);
    this.focusX += before.x - after.x;
    this.focusY += before.y - after.y;
    this.clampFocus();
  }

  private clampZoom(z: number): number {
    return Math.min(this.maxZoom, Math.max(this.minZoom, z));
  }

  private clampFocus(): void {
    this.focusX = Math.min(this.originX + this.worldWidth, Math.max(this.originX, this.focusX));
    this.focusY = Math.min(this.originY + this.worldHeight, Math.max(this.originY, this.focusY));
  }
}
