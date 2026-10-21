// Cykl dnia i nocy na oświetleniu Phasera 4: kolor otoczenia wg godziny i pogody, latarnie, świecące rośliny nocne.

import type Phaser from 'phaser';
import type { Content } from '../../content/content';
import { daylight } from '../../sim/calendar';
import { isReady } from '../../sim/systems/fields';
import type { Calendar, GameState } from '../../sim/types';
import { VILLAGE_DECO, VILLAGE_HOUSES, plotTile } from '../../sim/world';
import { project } from '../iso';

// Bajkowa krzywa światła: chłodna morska noc, brzoskwiniowy zmierzch, złoty poranek, ciepły dzień.
const NIGHT = [0x4a, 0x6a, 0x9a];
const DUSK = [0xff, 0xa8, 0x70];
const MORNING = [0xff, 0xd9, 0xa0];
const DAY = [0xff, 0xfa, 0xee];

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
    const twilight = hour < 12 ? MORNING : DUSK;
    let c = d >= 1 ? DAY : d <= 0 ? NIGHT : d < 0.5 ? lerp(NIGHT, twilight, d * 2) : lerp(twilight, DAY, (d - 0.5) * 2);
    // złota godzina tuż po świcie i przed zmierzchem
    if (d >= 1 && (hour < 8.5 || hour > 16.5)) c = lerp(DAY, MORNING, hour < 12 ? (8.5 - hour) / 1.5 : (hour - 16.5) / 1.5);
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
      const p = project(o.x + 0.5, o.y + 0.5);
      wanted.set(`o${o.uid}`, {
        x: p.x,
        // Światło trochę nad podstawą: oświetla ziemię wokół latarni i jej klosz.
        y: p.y - 60,
        radius: def.light.radius,
        color: hex(def.light.color),
        intensity: def.light.intensity,
      });
    }
    // Ciepłe okna chatek nocą (bajkowy klimat); limit świateł sceny bierze najbliższe kamerze.
    for (const o of state.objects) {
      const def = this.content.buildings[o.type];
      if (!def || (def.kind !== 'home' && def.kind !== 'machine') || (def.size[0] === 1 && def.size[1] === 1)) continue;
      const p = project(o.x + def.size[0], o.y + def.size[1] / 2);
      wanted.set(`w${o.uid}`, { x: p.x, y: p.y - 50, radius: 230, color: 0xffc46b, intensity: 0.9 });
    }
    // Wioska: okna domów mieszkańców i latarnie przy ulicy.
    for (const h of VILLAGE_HOUSES) {
      const p = project(h.x + 2, h.y + 1);
      wanted.set(`h${h.npc}`, { x: p.x, y: p.y - 50, radius: 230, color: 0xffc46b, intensity: 0.9 });
    }
    VILLAGE_DECO.forEach((d, i) => {
      const def = this.content.buildings[d.type];
      if (!def?.light) return;
      const p = project(d.x + 0.5, d.y + 0.5);
      wanted.set(`v${i}`, { x: p.x, y: p.y - 60, radius: def.light.radius, color: hex(def.light.color), intensity: def.light.intensity });
    });
    state.plots.forEach((p, i) => {
      const def = p.crop && this.content.crop[p.crop.id];
      if (!def?.night || !isReady(p.crop)) return;
      const t = plotTile(i);
      const at = project(t.x + 0.5, t.y + 0.5);
      wanted.set(`p${i}`, { x: at.x, y: at.y - 30, radius: 220, color: hex(def.art.color ?? '#9fe0ff'), intensity: 1 });
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
