// Minigra łowienia: znacznik ryby porusza się po pasku, gracz „zacina”, gdy jest w zielonej strefie.
// Trudność ryby (z JSON) zawęża strefę i przyspiesza rybę. Wynik 0..1 trafia do symulacji (reelIn).

import { t } from '../i18n/i18n';
import type { App } from './app';
import { $ } from './dom';

const TIMEOUT_MS = 7000;

export class Fishing {
  private readonly root = $('#fishing');
  private readonly zone = $('#fish-zone');
  private readonly marker = $('#fish-marker');
  private raf = 0;
  private active = false;
  private pos = 0.5;
  private zoneStart = 0.4;
  private zoneWidth = 0.2;
  private started = 0;

  constructor(private readonly app: App) {
    const strike = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.strike();
    };
    $('#fish-strike').addEventListener('click', strike);
    this.root.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).id !== 'fish-strike') strike(e);
    });
  }

  start(difficulty: number): void {
    this.active = true;
    this.zoneWidth = Math.max(0.1, 0.32 - difficulty * 0.24);
    this.zoneStart = 0.15 + Math.random() * (0.7 - this.zoneWidth);
    this.zone.style.left = `${this.zoneStart * 100}%`;
    this.zone.style.width = `${this.zoneWidth * 100}%`;
    this.root.hidden = false;
    this.started = performance.now();
    const speed = (0.6 + difficulty * 1.4) * (this.app.reducedMotion() ? 0.6 : 1);
    const loop = (now: number) => {
      if (!this.active) return;
      const tt = (now - this.started) / 1000;
      // Ryba „szarpie”: suma dwóch sinusoid o różnych częstotliwościach.
      this.pos = 0.5 + 0.42 * Math.sin(tt * speed * 2.1) * Math.cos(tt * speed * 0.7 + 1);
      this.marker.style.left = `${this.pos * 100}%`;
      if (now - this.started > TIMEOUT_MS) {
        this.finish(0);
        return;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private strike(): void {
    if (!this.active) return;
    const center = this.zoneStart + this.zoneWidth / 2;
    const inZone = this.pos >= this.zoneStart && this.pos <= this.zoneStart + this.zoneWidth;
    const score = inZone ? 0.6 + 0.4 * (1 - Math.abs(this.pos - center) / (this.zoneWidth / 2)) : 0;
    this.finish(score);
  }

  private finish(score: number): void {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.root.hidden = true;
    void this.app.send({ type: 'reelIn', score }, true).then((ok) => {
      if (!ok) this.app.toasts.show(t('fish.escaped'), 'warn');
    });
  }
}
