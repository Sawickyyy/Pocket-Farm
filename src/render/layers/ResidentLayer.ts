// Mieszkańcy osady chodzący po drogach gracza (docs/plan-osada.md §15): rano dom → praca, wieczorem praca → dom,
// w wolnym czasie plac/karczma; nocą w domach. Czysto wizualne – stan bierzemy z symulacji, plan dnia i trasy
// z residentPlan.ts (deterministyczne, zsynchronizowane z czasem gry: 1 h gry = 60 s). Pula sprite'ów
// (MAX_VISIBLE_RESIDENTS) przydzielana co chwilę najważniejszym postaciom: najpierw w kadrze, potem najbliżej środka.

import type Phaser from 'phaser';
import type { Content } from '../../content/content';
import { DAY_MS, HOUR_MS } from '../../sim/calendar';
import { professionOf } from '../../sim/systems/settlement/common';
import type { Calendar, GameState, Resident } from '../../sim/types';
import { MAP_H, MAP_W, type WorldMap } from '../../sim/world';
import { SPRITES_KEY } from '../art/atlas';
import { CHILD_SCALE, RESIDENT_FRAME, childFrame, residentFrame } from '../art/residents';
import { WALL, isBox, isFlatModel, project, roofHeight, verticalExtent } from '../iso';
import { MORNING, NIGHTFALL, ResidentPlanner, SimClock, hash01, newPose, samplePlan, type DayPlan, type Pose } from '../residentPlan';

/** Limit jednocześnie widocznych postaci. */
export const MAX_VISIBLE_RESIDENTS = 40;

/** Głębia postaci: jak mieszkańcy wioski i zwierzęta (nad budynkami), między sobą wg y rzutu. */
const DEPTH = 25;
const DEPTH_PER_PX = 1e-5;
/** Co ile ms przeliczamy, kto dostaje sprite (kamera i rozkład postaci zmieniają się płynnie). */
const SELECT_MS = 200;
/** Budżet planowania dni na klatkę (ms) – nowe trasy liczą się porcjami. */
const PLAN_BUDGET_MS = 2;
/** Margines kadru przy wyborze widocznych (px świata). */
const VIEW_MARGIN = 140;
/** Krycie postaci zasłoniętej budynkiem (widać ją „przez ścianę”). */
const BEHIND_ALPHA = 0.4;
/** Margines trafienia palcem (px ekranu). */
const HIT_PAD = 12;
const CHEER_MS = 480;
const N = MAP_W * MAP_H;

interface Track {
  id: number;
  r: Resident;
  plan: DayPlan | null;
  /** Klucz, dla którego policzono plan. */
  planDay: number;
  planHome: number | null;
  planJob: number | null;
  planChild: boolean;
  planSig: number;
  pose: Pose;
  /** Klatki chodu 0/1 (null – brak w atlasie, postaci nie pokazujemy). */
  frames: [string, string] | null;
  frameJob: number | null;
  frameChild: boolean;
  frameLook: number;
  scale: number;
  /** Boczne przesunięcie na drodze (kafle). */
  lane: number;
  slot: number;
  score: number;
  want: number;
  seen: number;
  step: number;
  cheerAt: number;
  flip: boolean;
  lookAt: number;
  behind: number;
}

export class ResidentLayer {
  private readonly planner = new ResidentPlanner();
  private readonly tracks = new Map<number, Track>();
  private readonly list: Track[] = [];
  private readonly candidates: Track[] = [];
  private readonly sprites: Phaser.GameObjects.Sprite[] = [];
  private readonly owners: (Track | null)[] = [];
  private readonly current: string[] = [];
  private readonly depths: number[] = [];
  private state: GameState | null = null;
  private stamp = 0;
  private wantStamp = 0;
  private lastSelect = -1e9;
  private readonly clock = new SimClock();
  // zasłanianie przez budynki: kafel → 1, gdy postać na nim jest za bryłą
  private occlusion: Uint8Array | null = null;
  private occlusionSig = -1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: WorldMap,
    private readonly content: Content,
    /** false przy ograniczeniu ruchu – postacie stoją (bez chodzenia). */
    private readonly motion: () => boolean,
  ) {}

  /** Synchronizacja ze stanem (co ~120 ms i przy zmianie stanu). */
  sync(state: GameState, cal: Calendar): void {
    void cal;
    this.state = state;
    this.clock.sync(state.clock.simMs + state.clock.accMs, state.clock.timeScale, this.scene.time.now);
    this.planner.refresh(state, this.content, this.world);
    if (this.occlusionSig !== this.planner.geometry) this.occlusion = null;

    const stamp = ++this.stamp;
    const list = this.list;
    let added = false;
    for (const r of state.settlement.residents) {
      let t = this.tracks.get(r.id);
      if (!t) {
        t = this.newTrack(r);
        this.tracks.set(r.id, t);
        added = true;
      }
      t.r = r;
      t.seen = stamp;
      if (t.frameJob !== r.job || t.frameChild !== r.child || t.frameLook !== r.look || (t.frames === null && stamp % 25 === 0)) this.updateFrames(t, state);
    }
    if (added || this.tracks.size !== state.settlement.residents.length) {
      for (const [id, t] of this.tracks) {
        if (t.seen === stamp) continue;
        this.release(t);
        this.tracks.delete(id);
      }
      list.length = 0;
      for (const t of this.tracks.values()) list.push(t);
    }
  }

  private newTrack(r: Resident): Track {
    const side = hash01(r.id, 0, 11) < 0.5 ? -1 : 1;
    return {
      id: r.id,
      r,
      plan: null,
      planDay: -1,
      planHome: null,
      planJob: null,
      planChild: false,
      planSig: -1,
      pose: newPose(),
      frames: null,
      frameJob: -2,
      frameChild: r.child,
      frameLook: -1,
      scale: RESIDENT_FRAME.scale,
      lane: side * (0.12 + hash01(r.id, 0, 12) * 0.14),
      slot: -1,
      score: 0,
      want: 0,
      seen: 0,
      step: hash01(r.id, 0, 13) * 6,
      cheerAt: -1e9,
      flip: hash01(r.id, 0, 14) < 0.5,
      lookAt: 0,
      behind: 1,
    };
  }

  private updateFrames(t: Track, state: GameState): void {
    const r = t.r;
    t.frameJob = r.job;
    t.frameChild = r.child;
    t.frameLook = r.look;
    const prof = r.child ? null : professionOf(state, this.content, r);
    const f0 = r.child ? childFrame(r.look, 0) : residentFrame(prof, r.look, 0);
    const f1 = r.child ? childFrame(r.look, 1) : residentFrame(prof, r.look, 1);
    const tex = this.scene.textures.get(SPRITES_KEY);
    t.frames = tex.has(f0) && tex.has(f1) ? [f0, f1] : null;
    t.scale = RESIDENT_FRAME.scale * (r.child ? CHILD_SCALE : 1);
    const slot = t.slot;
    if (slot >= 0) {
      if (t.frames) this.current[slot] = '';
      else this.release(t);
    }
  }

  // ------------------------------------------------------------ klatka

  /** Klatka animacji (czas sceny w ms). */
  update(time: number, delta: number, cal: Calendar): void {
    void cal;
    if (!this.state || !this.clock.ready) return;
    const motion = this.motion();
    const sim = this.clock.now(time);
    const day = Math.floor(sim / DAY_MS);
    const hour = (sim - day * DAY_MS) / HOUR_MS;
    const night = hour < MORNING - 0.3 || hour >= NIGHTFALL + 0.05;
    const sig = this.planner.signature;

    // plany dni (porcjami, w budżecie czasu)
    const start = performance.now();
    let planned = 0;
    for (const t of this.list) {
      const r = t.r;
      if (t.plan && t.planDay === day && t.planHome === r.home && t.planJob === r.job && t.planChild === r.child && t.planSig === sig) continue;
      if (planned > 0 && performance.now() - start > PLAN_BUDGET_MS) break;
      t.plan = this.planner.plan(r, day);
      t.planDay = day;
      t.planHome = r.home;
      t.planJob = r.job;
      t.planChild = r.child;
      t.planSig = sig;
      planned++;
    }

    // pozycje wszystkich (tanie) – niewidocznym od razu zabieramy sprite
    for (const t of this.list) {
      const pose = t.pose;
      if (!t.plan || night) {
        pose.visible = false;
      } else {
        samplePlan(t.plan, hour, pose, !motion, t.lane);
      }
      if (t.slot >= 0 && (!pose.visible || pose.alpha <= 0)) this.release(t);
    }

    if (time - this.lastSelect >= SELECT_MS || planned > 0) {
      this.lastSelect = time;
      this.select();
    }

    const dt = Math.min(delta, 100) / 1000;
    const stepRate = 9 * Math.min(3, this.clock.timeScale);
    const occ = this.occlusionMap();
    for (let i = 0; i < this.owners.length; i++) {
      const t = this.owners[i];
      if (t) this.draw(t, i, time, dt, stepRate, motion, occ);
    }
  }

  /** Przydział sprite'ów: w kadrze najpierw, potem najbliżej środka kadru. */
  private select(): void {
    const view = this.scene.cameras.main.worldView;
    const cx = view.centerX;
    const cy = view.centerY;
    const cand = this.candidates;
    cand.length = 0;
    for (const t of this.list) {
      if (!t.pose.visible || !t.frames || t.pose.alpha <= 0) continue;
      const p = project(t.pose.x, t.pose.y);
      const inView = p.x >= view.x - VIEW_MARGIN && p.x <= view.right + VIEW_MARGIN && p.y >= view.y - VIEW_MARGIN && p.y <= view.bottom + VIEW_MARGIN;
      const dx = p.x - cx;
      const dy = p.y - cy;
      // drobna premia za już przydzielony sprite – bez migania na granicy limitu
      t.score = (inView ? 0 : 1e12) + dx * dx + dy * dy - (t.slot >= 0 ? 4e4 : 0);
      cand.push(t);
    }
    if (cand.length > MAX_VISIBLE_RESIDENTS) cand.sort(byScore);
    const n = Math.min(MAX_VISIBLE_RESIDENTS, cand.length);
    const want = ++this.wantStamp;
    for (let i = 0; i < n; i++) cand[i]!.want = want;
    for (const t of this.owners) if (t && t.want !== want) this.release(t);
    for (let i = 0; i < n; i++) {
      const t = cand[i]!;
      if (t.slot < 0) this.assign(t);
    }
  }

  private assign(t: Track): void {
    let slot = this.owners.indexOf(null);
    if (slot < 0) {
      if (this.sprites.length >= MAX_VISIBLE_RESIDENTS) return;
      const sprite = this.scene.add
        .sprite(0, 0, SPRITES_KEY, t.frames![0])
        .setOrigin(0.5, RESIDENT_FRAME.originY)
        .setDepth(DEPTH)
        .setLighting(true)
        .setVisible(false);
      this.sprites.push(sprite);
      this.owners.push(null);
      this.current.push('');
      this.depths.push(DEPTH);
      slot = this.sprites.length - 1;
    }
    this.owners[slot] = t;
    this.current[slot] = '';
    t.slot = slot;
    t.behind = 1;
    t.lookAt = 0;
  }

  private release(t: Track): void {
    const slot = t.slot;
    if (slot < 0) return;
    t.slot = -1;
    if (this.owners[slot] === t) this.owners[slot] = null;
    this.sprites[slot]?.setVisible(false);
  }

  private draw(t: Track, slot: number, time: number, dt: number, stepRate: number, motion: boolean, occ: Uint8Array): void {
    const sprite = this.sprites[slot]!;
    const frames = t.frames;
    if (!frames) return;
    const pose = t.pose;
    const p = project(pose.x, pose.y);
    let x = p.x;
    let y = p.y;
    let sx = t.scale;
    let sy = t.scale;
    let rot = 0;
    let frame = 0;
    if (pose.walking && motion) {
      t.step += dt * stepRate;
      const s = Math.sin(t.step);
      const lift = Math.abs(s);
      frame = s > 0 ? 1 : 0;
      // podskok kroku: lekkie rozciągnięcie w górze, spłaszczenie przy lądowaniu
      y -= lift * 5;
      sx *= 1 - lift * 0.04 + 0.02;
      sy *= 1 + lift * 0.06 - 0.03;
      rot = Math.sin(t.step * 0.5) * 0.05;
      // kierunek na ekranie: rzut x ~ (dx − dy)
      const screenDx = pose.dx - pose.dy;
      if (Math.abs(screenDx) > 0.05) t.flip = screenDx < 0;
    } else if (motion) {
      // oddech i rozglądanie się na postoju
      const b = Math.sin(time / 640 + t.id * 1.7) * 0.016;
      sx *= 1 - b * 0.5;
      sy *= 1 + b;
      if (time >= t.lookAt) {
        if (t.lookAt > 0 && hash01(t.id, Math.floor(time / 1000), 15) < 0.45) t.flip = !t.flip;
        t.lookAt = time + 2200 + hash01(t.id, Math.floor(time / 1000), 16) * 4200;
      }
    }
    const since = time - t.cheerAt;
    if (since >= 0 && since < CHEER_MS && motion) {
      // radosny podskok: przysiad → wyskok z rozciągnięciem → lądowanie
      const k = since / CHEER_MS;
      const arc = Math.sin(Math.PI * Math.min(1, k * 1.15));
      y -= arc * 30;
      sx *= 1 + (k < 0.15 ? 0.12 : -0.08 * arc);
      sy *= 1 + (k < 0.15 ? -0.14 : 0.12 * arc);
      rot = 0;
    }
    // za budynkiem: półprzezroczysta (płynnie)
    const xi = Math.floor(pose.x);
    const yi = Math.floor(pose.y);
    const behind = xi >= 0 && yi >= 0 && xi < MAP_W && yi < MAP_H && occ[yi * MAP_W + xi] === 1 ? BEHIND_ALPHA : 1;
    t.behind += (behind - t.behind) * Math.min(1, dt * 8);
    if (!motion) t.behind = behind;

    sprite.setPosition(x, y);
    sprite.setScale(sx, sy);
    sprite.setRotation(rot);
    sprite.setFlipX(t.flip);
    sprite.setAlpha(pose.alpha * t.behind);
    if (!sprite.visible) sprite.setVisible(true);
    const name = frames[frame]!;
    if (this.current[slot] !== name) {
      this.current[slot] = name;
      sprite.setFrame(name);
    }
    const depth = DEPTH + p.y * DEPTH_PER_PX;
    if (Math.abs(depth - this.depths[slot]!) > 2e-6) {
      this.depths[slot] = depth;
      sprite.setDepth(depth);
    }
  }

  // ------------------------------------------------------------ zasłanianie

  /**
   * Kafle, na których stojąca postać jest za bryłą budynku (rysujemy ją półprzezroczyście – postacie są w osobnej
   * warstwie nad budynkami). Liczone raz na zmianę układu obiektów.
   */
  private occlusionMap(): Uint8Array {
    const sig = this.planner.geometry;
    if (this.occlusion && this.occlusionSig === sig) return this.occlusion;
    const occ = new Uint8Array(N);
    const s = this.state;
    if (s) {
      for (const o of s.objects) {
        const def = this.content.buildings[o.type];
        if (!def || !isBox(def) || isFlatModel(def)) continue;
        const [w, h] = def.size;
        // dach dwuspadowy jest węższy niż pełna bryła – zasłaniamy tylko do ~80% wysokości
        const H = (def.art.model ? verticalExtent(def) : WALL + roofHeight(w, h)) * 0.8;
        const L = project(o.x, o.y + h);
        const R = project(o.x + w, o.y);
        const F = project(o.x + w, o.y + h);
        const B = project(o.x, o.y);
        const reach = Math.ceil(H / 45) + 1;
        for (let ty = o.y - reach; ty < o.y + h; ty++) {
          for (let tx = o.x - reach; tx < o.x + w; tx++) {
            if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue;
            if (tx >= o.x && ty >= o.y) continue; // obrys budynku
            const p = project(tx + 0.5, ty + 0.5);
            if (p.x <= L.x + 12 || p.x >= R.x - 12) continue;
            const bottom = p.x <= F.x ? L.y + ((p.x - L.x) / (F.x - L.x)) * (F.y - L.y) : F.y + ((p.x - F.x) / (R.x - F.x)) * (R.y - F.y);
            const top = (p.x <= B.x ? L.y + ((p.x - L.x) / (B.x - L.x)) * (B.y - L.y) : B.y + ((p.x - B.x) / (R.x - B.x)) * (R.y - B.y)) - H;
            // stopy nad dolną krawędzią podstawy i wyraźnie poniżej szczytu bryły → postać (prawie cała) za budynkiem
            if (p.y < bottom - 4 && p.y > top + 40) occ[ty * MAP_W + tx] = 1;
          }
        }
      }
    }
    this.occlusion = occ;
    this.occlusionSig = sig;
    return occ;
  }

  // ------------------------------------------------------------ zapytania

  /** Mieszkaniec pod punktem świata (px) → id. */
  hit(wx: number, wy: number): number | null {
    const pad = HIT_PAD / Math.max(0.05, this.scene.cameras.main.zoom);
    let best: Track | null = null;
    let bestY = -Infinity;
    for (let i = 0; i < this.owners.length; i++) {
      const t = this.owners[i];
      const sp = this.sprites[i];
      if (!t || !sp || !sp.visible || sp.alpha < 0.3) continue;
      const w = RESIDENT_FRAME.w * Math.abs(sp.scaleX);
      const h = RESIDENT_FRAME.h * Math.abs(sp.scaleY);
      const left = sp.x - w / 2 - pad;
      const top = sp.y - h * RESIDENT_FRAME.originY - pad;
      if (wx < left || wx > left + w + pad * 2 || wy < top || wy > top + h + pad * 2) continue;
      if (sp.y > bestY) {
        best = t;
        bestY = sp.y;
      }
    }
    return best?.id ?? null;
  }

  /** Pozycja widocznej postaci w kaflach (ciągła) albo null, gdy mieszkaniec jest w budynku. */
  positionOf(id: number): { x: number; y: number } | null {
    const t = this.tracks.get(id);
    if (!t || !t.pose.visible) return null;
    return { x: t.pose.x, y: t.pose.y };
  }

  /** Radosny podskok postaci (np. po ślubie, narodzinach dziecka w rodzinie). */
  cheer(id: number): void {
    const t = this.tracks.get(id);
    if (!t || !this.motion()) return;
    t.cheerAt = this.scene.time.now;
  }
}

const byScore = (a: Track, b: Track): number => a.score - b.score;
