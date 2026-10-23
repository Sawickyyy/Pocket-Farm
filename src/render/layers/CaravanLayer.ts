// Karawana handlowa (docs/plan-osada.md §12, §15): wóz wjeżdża od krawędzi mapy do faktorii, stoi do odjazdu
// i odjeżdża. Czysto wizualna – obecność i termin odjazdu z s.settlement.caravan.
// Trasa: od południowej krawędzi mapy dróżką wioski (x = VILLAGE_LANE_X), dalej drogami gracza do drzwi faktorii
// (albo na przełaj, gdy faktoria nie ma połączenia). Przyjazd o 10:00 (leavesAt − 8 h), odjazd o leavesAt –
// stan symulacji kasuje karawanę w chwili odjazdu, więc odjazd odgrywamy z zapamiętanej trasy.

import type Phaser from 'phaser';
import type { Content } from '../../content/content';
import { HOUR_MS } from '../../sim/calendar';
import { isOperational } from '../../sim/systems/settlement/common';
import { CARAVAN_STAY_HOURS } from '../../sim/systems/settlement/trade';
import type { Calendar, GameState } from '../../sim/types';
import { FARM, MAP_H, VILLAGE_LANE_X, VILLAGE_STREET_Y, type WorldMap } from '../../sim/world';
import { SPRITES_KEY } from '../art/atlas';
import { CARAVAN_FRAME, caravanFrame } from '../art/residents';
import { project } from '../iso';
import { ResidentPlanner, SimClock, type Pt } from '../residentPlan';

/** Prędkość wozu: kafle na godzinę gry (ok. 0,9 kafla/s). */
const WAGON_SPEED = 54;
/** Co ile kafli obrót kół (zmiana klatki). */
const WHEEL_STEP = 0.32;
/** Głębia jak postacie (ResidentLayer): nad budynkami, między sobą wg y rzutu. */
const DEPTH = 25;
const DEPTH_PER_PX = 1e-5;
/** Pojawianie się na krawędzi mapy i znikanie (kafle). */
const EDGE_FADE = 2.5;
/** Kurz spod kół: pula obrazków, odstęp i czas życia (ms). */
const DUST_POOL = 12;
const DUST_EVERY = 95;
const DUST_LIFE = 820;
const DUST = 0xd9b98a;
const HIT_PAD = 10;
/** Odsunięcie postoju od drzwi faktorii (kafle). */
const PARK_OFFSET = 0.6;

interface Trip {
  /** leavesAt karawany ze stanu (klucz – nowa karawana = nowa trasa). */
  key: number;
  leavesAt: number;
  arriveAt: number;
  pts: Pt[];
  /** Skumulowana długość (kafle). */
  cum: number[];
  len: number;
  /** Czas przejazdu w jedną stronę (ms gry). */
  driveMs: number;
  tradepost: number;
  /** Karawana zniknęła ze stanu (odjechała) – dograj odjazd. */
  gone: boolean;
  /** Odjazd dograny – wóz schowany. */
  done: boolean;
}

interface Puff {
  img: Phaser.GameObjects.Image;
  born: number;
  x: number;
  y: number;
  vx: number;
  live: boolean;
}

export class CaravanLayer {
  private readonly planner = new ResidentPlanner();
  private readonly clock = new SimClock();
  private trip: Trip | null = null;
  private sprite: Phaser.GameObjects.Sprite | null = null;
  private readonly puffs: Puff[] = [];
  private lastDust = 0;
  private frame = -1;
  private flip = false;
  private shown = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: WorldMap,
    private readonly content: Content,
    private readonly motion: () => boolean,
  ) {}

  sync(state: GameState, cal: Calendar): void {
    void cal;
    this.clock.sync(state.clock.simMs + state.clock.accMs, state.clock.timeScale, this.scene.time.now);
    const caravan = state.settlement.caravan;
    const tp = this.tradepost(state);
    if (tp === null) {
      // bez faktorii nie pokazujemy wozu
      this.trip = null;
      return;
    }
    if (caravan && (!this.trip || this.trip.key !== caravan.leavesAt || this.trip.tradepost !== tp)) this.trip = this.plan(state, tp, caravan.leavesAt);
    if (!caravan && this.trip && !this.trip.gone) {
      // odjechała (także wcześniej niż leavesAt) – odjazd od teraz
      const now = state.clock.simMs + state.clock.accMs;
      this.trip.gone = true;
      if (now < this.trip.leavesAt) this.trip.leavesAt = Math.max(this.trip.arriveAt + this.trip.driveMs, now);
    }
  }

  /** Faktoria (budynek z usługą „trade”), najlepiej działająca. */
  private tradepost(state: GameState): number | null {
    let any: number | null = null;
    for (const o of state.objects) {
      if (this.content.buildings[o.type]?.service?.kind !== 'trade') continue;
      if (isOperational(state, o.uid)) return o.uid;
      any ??= o.uid;
    }
    return any;
  }

  /** Trasa: krawędź mapy → dróżka wioski → (drogi gracza albo przełaj) → drzwi faktorii. */
  private plan(state: GameState, tp: number, leavesAt: number): Trip {
    this.planner.refresh(state, this.content, this.world);
    const place = this.planner.place(tp);
    const door = place?.door ?? { x: VILLAGE_LANE_X + 0.5, y: VILLAGE_STREET_Y + 0.5 };
    // postój pół kafla dalej od ściany (wóz jest szeroki – nie wjeżdża w budynek)
    let ox = 0;
    let oy = 0;
    if (place) {
      if (door.y >= place.y0 + place.h) oy = 1;
      else if (door.x >= place.x0 + place.w) ox = 1;
      else if (door.y < place.y0) oy = -1;
      else ox = -1;
    }
    const park: Pt = { x: door.x + ox * PARK_OFFSET, y: door.y + oy * PARK_OFFSET };
    // z krawędzi mapy dróżką wioski aż do bramy farmy, dalej drogami gracza (albo na przełaj)
    const lane: Pt = { x: VILLAGE_LANE_X + 0.5, y: VILLAGE_STREET_Y + 2.5 };
    const gate: Pt = { x: VILLAGE_LANE_X + 0.5, y: FARM.y + FARM.h + 0.5 };
    const edge: Pt = { x: lane.x, y: MAP_H - 0.5 };
    const route = this.planner.route(gate, door);
    const pts: Pt[] = [edge, lane, gate];
    for (let i = 1; i < route.pts.length - 1; i++) pts.push(route.pts[i]!);
    pts.push(door, park);
    // bez zbędnych punktów na prostych (wóz jedzie płynnie)
    const clean: Pt[] = [pts[0]!];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i]!;
      const prev = clean[clean.length - 1]!;
      if (Math.hypot(p.x - prev.x, p.y - prev.y) < 1e-3) continue;
      const before = clean[clean.length - 2];
      const straight =
        !!before &&
        Math.abs((prev.x - before.x) * (p.y - prev.y) - (prev.y - before.y) * (p.x - prev.x)) < 1e-6 &&
        (prev.x - before.x) * (p.x - prev.x) + (prev.y - before.y) * (p.y - prev.y) > 0;
      if (straight) clean[clean.length - 1] = p;
      else clean.push(p);
    }
    const cum = [0];
    for (let i = 1; i < clean.length; i++) cum.push(cum[i - 1]! + Math.hypot(clean[i]!.x - clean[i - 1]!.x, clean[i]!.y - clean[i - 1]!.y));
    const len = cum[cum.length - 1] ?? 0;
    return {
      key: leavesAt,
      leavesAt,
      arriveAt: leavesAt - CARAVAN_STAY_HOURS * HOUR_MS,
      pts: clean,
      cum,
      len,
      driveMs: (len / WAGON_SPEED) * HOUR_MS,
      tradepost: tp,
      gone: false,
      done: false,
    };
  }

  /** Punkt trasy w odległości d od krawędzi mapy + kierunek. */
  private along(trip: Trip, d: number, out: { x: number; y: number; dx: number; dy: number }): void {
    const { pts, cum } = trip;
    let i = 1;
    while (i < pts.length - 1 && cum[i]! < d) i++;
    const a = pts[i - 1]!;
    const b = pts[i] ?? a;
    const seg = cum[i]! - cum[i - 1]!;
    const f = seg > 0 ? Math.min(1, Math.max(0, (d - cum[i - 1]!) / seg)) : 1;
    out.x = a.x + (b.x - a.x) * f;
    out.y = a.y + (b.y - a.y) * f;
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    out.dx = (b.x - a.x) / l;
    out.dy = (b.y - a.y) / l;
  }

  private readonly pos = { x: 0, y: 0, dx: 0, dy: 0 };

  update(time: number, delta: number, cal: Calendar): void {
    void cal;
    void delta;
    const trip = this.trip;
    if (!trip || trip.done || !this.clock.ready) {
      this.hide();
      this.updateDust(time);
      return;
    }
    const motion = this.motion();
    const now = this.clock.now(time);
    // faza: przyjazd → postój → odjazd
    let d: number;
    let moving = false;
    let dir = 1;
    if (now < trip.arriveAt) {
      this.hide();
      this.updateDust(time);
      return;
    }
    if (now < trip.arriveAt + trip.driveMs) {
      d = ((now - trip.arriveAt) / trip.driveMs) * trip.len;
      moving = true;
    } else if (now < trip.leavesAt) {
      d = trip.len;
    } else if (now < trip.leavesAt + trip.driveMs) {
      d = trip.len * (1 - (now - trip.leavesAt) / trip.driveMs);
      moving = true;
      dir = -1;
    } else {
      trip.done = true;
      this.hide();
      this.updateDust(time);
      return;
    }
    if (!motion) {
      // ograniczenie ruchu: wóz tylko stoi przy faktorii w czasie postoju
      if (moving) {
        this.hide();
        this.updateDust(time);
        return;
      }
    }
    const tex = this.scene.textures.get(SPRITES_KEY);
    if (!tex.has(caravanFrame(0)) || !tex.has(caravanFrame(1))) {
      this.hide();
      return;
    }
    const pos = this.pos;
    this.along(trip, Math.min(trip.len, Math.max(0, d)), pos);
    const sprite = this.ensureSprite();
    const p = project(pos.x, pos.y);
    let y = p.y;
    let rot = 0;
    let sy = CARAVAN_FRAME.scale;
    const frame = moving && motion ? Math.floor(d / WHEEL_STEP) & 1 : 0;
    if (moving) {
      // kierunek jazdy na ekranie; wóz w atlasie jedzie w prawo-dół (+x kafli), lustro dla jazdy w lewo
      const screenDx = (pos.dx - pos.dy) * dir;
      if (Math.abs(screenDx) > 0.05) this.flip = screenDx < 0;
      if (motion) {
        rot = Math.sin(time / 170) * 0.022;
        y -= Math.abs(Math.sin(time / 115)) * 2.5;
        if (time - this.lastDust > DUST_EVERY) {
          this.lastDust = time;
          this.emitDust(pos.x - pos.dx * dir * 0.55, pos.y - pos.dy * dir * 0.55, time);
        }
      }
    } else if (motion) {
      // postój: koń oddycha
      sy *= 1 + Math.sin(time / 700) * 0.008;
    }
    // przenikanie na krawędzi mapy
    const alpha = Math.min(1, d / EDGE_FADE + 0.05);
    sprite.setPosition(p.x, y);
    sprite.setScale(CARAVAN_FRAME.scale, sy);
    sprite.setRotation(rot);
    sprite.setFlipX(this.flip);
    sprite.setAlpha(alpha);
    sprite.setDepth(DEPTH + p.y * DEPTH_PER_PX);
    if (frame !== this.frame) {
      this.frame = frame;
      sprite.setFrame(caravanFrame(frame));
    }
    if (!this.shown) {
      this.shown = true;
      sprite.setVisible(true);
    }
    this.updateDust(time);
  }

  private ensureSprite(): Phaser.GameObjects.Sprite {
    if (this.sprite) return this.sprite;
    this.sprite = this.scene.add
      .sprite(0, 0, SPRITES_KEY, caravanFrame(0))
      .setOrigin(0.5, CARAVAN_FRAME.originY)
      .setScale(CARAVAN_FRAME.scale)
      .setDepth(DEPTH)
      .setLighting(true)
      .setVisible(false);
    this.frame = 0;
    return this.sprite;
  }

  private hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.sprite?.setVisible(false);
  }

  // ------------------------------------------------------------ kurz

  private emitDust(tx: number, ty: number, time: number): void {
    const p = project(tx, ty);
    const v = this.scene.cameras.main.worldView;
    if (p.x < v.x - 200 || p.x > v.right + 200 || p.y < v.y - 200 || p.y > v.bottom + 200) return;
    let puff = this.puffs.find((q) => !q.live);
    if (!puff) {
      if (this.puffs.length >= DUST_POOL) return;
      const img = this.scene.add.image(0, 0, SPRITES_KEY, 'p_smoke').setTint(DUST).setVisible(false);
      puff = { img, born: 0, x: 0, y: 0, vx: 0, live: false };
      this.puffs.push(puff);
    }
    puff.live = true;
    puff.born = time;
    puff.x = p.x + (Math.random() - 0.5) * 30;
    puff.y = p.y - 6;
    puff.vx = (Math.random() - 0.5) * 30;
    puff.img.setVisible(true).setDepth(DEPTH + p.y * DEPTH_PER_PX - 1e-4);
  }

  private updateDust(time: number): void {
    for (const q of this.puffs) {
      if (!q.live) continue;
      const k = (time - q.born) / DUST_LIFE;
      if (k >= 1) {
        q.live = false;
        q.img.setVisible(false);
        continue;
      }
      const ease = 1 - (1 - k) * (1 - k);
      q.img.setPosition(q.x + q.vx * ease, q.y - 22 * ease);
      q.img.setScale(0.9 + ease * 1.6);
      q.img.setAlpha(0.55 * (1 - k));
    }
  }

  /** Czy punkt świata (px) trafia w wóz (dotknięcie otwiera handel). */
  hit(wx: number, wy: number): boolean {
    const sp = this.sprite;
    if (!sp || !this.shown || sp.alpha < 0.3) return false;
    const pad = HIT_PAD / Math.max(0.05, this.scene.cameras.main.zoom);
    const w = CARAVAN_FRAME.w * Math.abs(sp.scaleX);
    const h = CARAVAN_FRAME.h * Math.abs(sp.scaleY);
    const left = sp.x - w / 2 - pad;
    const top = sp.y - h * CARAVAN_FRAME.originY - pad;
    return wx >= left && wx <= left + w + pad * 2 && wy >= top && wy <= top + h + pad * 2;
  }
}
