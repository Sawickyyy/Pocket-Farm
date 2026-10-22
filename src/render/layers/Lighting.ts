// Cykl dnia i nocy na oświetleniu Phasera 4: kolor otoczenia wg godziny i pogody, latarnie, świecące rośliny nocne,
// ciepłe okna zamieszkanych domów i działających budynków osady oraz migoczące światło pożarów.

import type Phaser from 'phaser';
import type { BuildingDef, Content } from '../../content/content';
import { daylight } from '../../sim/calendar';
import { isReady } from '../../sim/systems/fields';
import { isHabitable, isOperational } from '../../sim/systems/settlement/common';
import type { Calendar, GameState } from '../../sim/types';
import { VILLAGE_DECO, VILLAGE_HOUSES, plotTile } from '../../sim/world';
import { ISO_HW, isBox, project } from '../iso';

// Bajkowa krzywa światła: chłodna morska noc, brzoskwiniowy zmierzch, złoty poranek, ciepły dzień.
const NIGHT = [0x4a, 0x6a, 0x9a];
const DUSK = [0xff, 0xa8, 0x70];
const MORNING = [0xff, 0xd9, 0xa0];
const DAY = [0xff, 0xfa, 0xee];

const hex = (s: string) => parseInt(s.slice(1), 16);
const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i]! - v) * t));
const toInt = (c: number[]) => (c[0]! << 16) | (c[1]! << 8) | c[2]!;

/** Rodzaj światła – kolejność = pierwszeństwo przy limicie (pożar najważniejszy). */
export type LightKind = 'fire' | 'lamp' | 'plant' | 'window';
const PRIORITY: Record<LightKind, number> = { fire: 0, lamp: 1, plant: 2, window: 3 };

export interface WantedLight {
  x: number;
  y: number;
  radius: number;
  color: number;
  intensity: number;
  kind: LightKind;
}

/** Własny limit świateł (renderer i tak bierze najbliższe kamerze – maxLights w main.ts). */
export const MAX_LIGHTS = 64;
export const WINDOW_COLOR = 0xffc46b;
export const FIRE_COLOR = 0xff8a3a;
const WARM_LAMP = '#ffcf7a';

/** Modele bez okien (pole, plac, studnia) – nie świecą nocą. */
const NO_WINDOWS = new Set(['field', 'plaza', 'well']);
export const hasWindows = (def: BuildingDef): boolean => isBox(def) && !NO_WINDOWS.has(def.art.model ?? '');

/** Pierwszeństwo i limit: pożary, latarnie, rośliny, okna; tryb oszczędny – bez okien. */
export function pickLights<T extends { kind: LightKind }>(lights: T[], max = MAX_LIGHTS, economy = false): T[] {
  const list = economy ? lights.filter((l) => l.kind !== 'window') : lights.slice();
  list.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
  return list.slice(0, max);
}

/** Migotanie płomieni 0,55..1,15 (czas w ms, faza budynku). */
export const fireFlicker = (t: number, phase: number): number => 0.85 + 0.2 * Math.sin(t / 95 + phase) + 0.1 * Math.sin(t / 37 + phase * 2.3);

interface Lamp {
  light: Phaser.GameObjects.Light;
  base: number;
  kind: LightKind;
  phase: number;
}

export class Lighting {
  private readonly lamps = new Map<string, Lamp>();
  private nightFactor = 0;
  private lit = true;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly content: Content,
    private readonly motion: () => boolean = () => true,
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

  update(hour: number, cal: Calendar, time = 0): void {
    this.scene.lights.setAmbientColor(this.ambientFor(hour, cal.weather));
    this.nightFactor = 1 - daylight(hour);
    // Za dnia światła nocne są wyłączone, żeby nie zajmowały miejsc w limicie renderera (pożar świeci zawsze).
    const lit = this.nightFactor > 0.02;
    const flick = this.motion();
    for (const l of this.lamps.values()) {
      if (l.kind === 'fire') {
        l.light.intensity = l.base * (0.55 + 0.45 * this.nightFactor) * (flick ? fireFlicker(time, l.phase) : 1);
        continue;
      }
      l.light.intensity = l.base * this.nightFactor;
      if (lit !== this.lit) l.light.setVisible(lit);
    }
    this.lit = lit;
  }

  sync(state: GameState, economy = false): void {
    const wanted = new Map<string, WantedLight>();
    const sites = state.settlement.sites;
    // Kto gdzie mieszka i pracuje (jeden przebieg zamiast filtrowania dla każdego budynku).
    const homes = new Set<number>();
    const jobs = new Set<number>();
    for (const r of state.settlement.residents) {
      if (r.home !== null) homes.add(r.home);
      if (r.job !== null) jobs.add(r.job);
    }
    for (const o of state.objects) {
      const def = this.content.buildings[o.type];
      if (!def) continue;
      const site = sites[String(o.uid)];
      const [w, h] = def.size;
      // Pożar: migoczące pomarańczowe światło (także za dnia).
      if (site && site.fire > 0) {
        const p = project(o.x + w / 2, o.y + h / 2);
        wanted.set(`f${o.uid}@${o.x},${o.y}`, { x: p.x, y: p.y - 70, radius: 260 + 60 * Math.max(w, h), color: FIRE_COLOR, intensity: 1.7, kind: 'fire' });
        continue;
      }
      // Latarnie (usługa „light”): światło w promieniu, tylko gdy działają.
      if (def.light || def.service?.kind === 'light') {
        if (!isOperational(state, o.uid)) continue;
        const p = project(o.x + 0.5, o.y + 0.5);
        const radius = def.light?.radius ?? (def.service?.radius ?? 4) * ISO_HW * 0.85;
        // Światło trochę nad podstawą: oświetla ziemię wokół latarni i jej klosz.
        wanted.set(`o${o.uid}@${o.x},${o.y}`, { x: p.x, y: p.y - 60, radius, color: hex(def.light?.color ?? WARM_LAMP), intensity: def.light?.intensity ?? 1, kind: 'lamp' });
        continue;
      }
      const win = this.windowFor(state, def, o.uid, homes, jobs);
      if (!win) continue;
      const p = project(o.x + w, o.y + h / 2);
      wanted.set(`w${o.uid}@${o.x},${o.y}`, { x: p.x, y: p.y - 50, radius: win, color: WINDOW_COLOR, intensity: 0.9, kind: 'window' });
    }
    // Wioska: okna domów mieszkańców i latarnie przy ulicy.
    for (const hs of VILLAGE_HOUSES) {
      const p = project(hs.x + 2, hs.y + 1);
      wanted.set(`h${hs.npc}`, { x: p.x, y: p.y - 50, radius: 230, color: WINDOW_COLOR, intensity: 0.9, kind: 'window' });
    }
    VILLAGE_DECO.forEach((d, i) => {
      const def = this.content.buildings[d.type];
      if (!def?.light) return;
      const p = project(d.x + 0.5, d.y + 0.5);
      wanted.set(`v${i}`, { x: p.x, y: p.y - 60, radius: def.light.radius, color: hex(def.light.color), intensity: def.light.intensity, kind: 'lamp' });
    });
    state.plots.forEach((p, i) => {
      const def = p.crop && this.content.crop[p.crop.id];
      if (!def?.night || !isReady(p.crop)) return;
      const t = plotTile(i);
      const at = project(t.x + 0.5, t.y + 0.5);
      wanted.set(`p${i}`, { x: at.x, y: at.y - 30, radius: 220, color: hex(def.art.color ?? '#9fe0ff'), intensity: 1, kind: 'plant' });
    });

    const keep = new Set(pickLights([...wanted].map(([k, v]) => ({ k, kind: v.kind })), MAX_LIGHTS, economy).map((e) => e.k));
    for (const [k, l] of this.lamps) {
      if (!keep.has(k)) {
        this.scene.lights.removeLight(l.light);
        this.lamps.delete(k);
      }
    }
    for (const k of keep) {
      if (this.lamps.has(k)) continue;
      const w = wanted.get(k)!;
      const fire = w.kind === 'fire';
      const light = this.scene.lights.addLight(w.x, w.y, w.radius, w.color, fire ? w.intensity : w.intensity * this.nightFactor);
      if (!fire) light.setVisible(this.lit);
      this.lamps.set(k, { light, base: w.intensity, kind: w.kind, phase: (w.x * 0.013 + w.y * 0.007) % 6.28 });
    }
  }

  /** Promień światła okien albo null: zamieszkany dom osady, działający budynek z obsadą, domy i maszyny farmy. */
  private windowFor(state: GameState, def: BuildingDef, uid: number, homes: Set<number>, jobs: Set<number>): number | null {
    if (!hasWindows(def)) return null;
    const big = Math.max(def.size[0], def.size[1]);
    const radius = def.art.model === 'tent' ? 150 : big >= 3 ? 290 : 230;
    if (def.kind === 'house') return homes.has(uid) && isHabitable(state, uid) ? radius : null;
    if (!isOperational(state, uid)) return null;
    // Domy zwierząt i maszyny farmy – jak dotąd, poza małymi 1×1 (obsługuje je też gracz, więc bez warunku obsady).
    if (def.kind === 'home' || def.kind === 'machine') return big > 1 ? radius : null;
    if (def.jobs) return jobs.has(uid) ? radius : null;
    // Pozostałe budynki osady z modelem (magazyn, ratusz…) – działające świecą.
    return def.art.model ? radius : null;
  }
}
