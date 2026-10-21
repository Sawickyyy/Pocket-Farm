// Cykl dnia i nocy na oświetleniu Phasera 4: kolor otoczenia wg godziny i pogody, latarnie, świecące rośliny nocne.

import type Phaser from 'phaser';
import type { Content } from '../../content/content';
import { daylight } from '../../sim/calendar';
import { isReady } from '../../sim/systems/fields';
import type { Calendar, GameState } from '../../sim/types';
import { plotTile } from '../../sim/world';
import { TILE } from '../art/atlas';

const NIGHT = [0x3a, 0x48, 0x7a];
const DUSK = [0xff, 0xb0, 0x80];
const DAY = [0xff, 0xff, 0xff];

const hex = (s: string) => parseInt(s.slice(1), 16);
const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i]! - v) * t));
const toInt = (c: number[]) => (c[0]! << 16) | (c[1]! << 8) | c[2]!;

export class Lighting {
  private readonly lamps = new Map<string, { light: Phaser.GameObjects.Light; base: number }>();
  private nightFactor = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly content: Content,
  ) {
    scene.lights.enable();
  }

  /** Kolor otoczenia dla godziny (z płynnym przejściem przez zmierzch/świt). */
  ambientFor(hour: number, weather: string): number {
    const d = daylight(hour);
    let c = d >= 1 ? DAY : d <= 0 ? NIGHT : d < 0.5 ? lerp(NIGHT, DUSK, d * 2) : lerp(DUSK, DAY, (d - 0.5) * 2);
    if (weather === 'rain' || weather === 'cloud') c = c.map((v) => Math.round(v * 0.86));
    if (weather === 'snow') c = lerp(c, [0xd8, 0xe4, 0xff], 0.25);
    return toInt(c);
  }

  update(hour: number, cal: Calendar): void {
    this.scene.lights.setAmbientColor(this.ambientFor(hour, cal.weather));
    this.nightFactor = 1 - daylight(hour);
    for (const l of this.lamps.values()) l.light.intensity = l.base * this.nightFactor;
  }

  sync(state: GameState): void {
    const wanted = new Map<string, { x: number; y: number; radius: number; color: number; intensity: number }>();
    for (const o of state.objects) {
      const def = this.content.buildings[o.type];
      if (def?.kind !== 'lantern' || !def.light) continue;
      wanted.set(`o${o.uid}`, {
        x: (o.x + 0.5) * TILE,
        y: (o.y + 0.3) * TILE,
        radius: def.light.radius,
        color: hex(def.light.color),
        intensity: def.light.intensity,
      });
    }
    state.plots.forEach((p, i) => {
      const def = p.crop && this.content.crop[p.crop.id];
      if (!def?.night || !isReady(p.crop)) return;
      const t = plotTile(i);
      wanted.set(`p${i}`, { x: (t.x + 0.5) * TILE, y: (t.y + 0.5) * TILE, radius: 220, color: hex(def.art.color ?? '#9fe0ff'), intensity: 1 });
    });
    for (const [k, l] of this.lamps) {
      if (!wanted.has(k)) {
        this.scene.lights.removeLight(l.light);
        this.lamps.delete(k);
      }
    }
    for (const [k, w] of wanted) {
      if (this.lamps.has(k)) continue;
      const light = this.scene.lights.addLight(w.x, w.y, w.radius, w.color, w.intensity * this.nightFactor);
      this.lamps.set(k, { light, base: w.intensity });
    }
  }
}
