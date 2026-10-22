// Plan dnia mieszkańców osady dla grafiki (docs/plan-osada.md §15): gdzie jest mieszkaniec o danej godzinie
// i którędy idzie. Czyste funkcje i cache bez Phasera – wynik zależy tylko od id, dnia i układu osady.
// Noc (przed 6:30 i od 21:00) – w domu. Dorosły z działającą pracą: ok. 6:30–7 droga do pracy, 7–17 w pracy
// (czasem krótkie wyjście przed budynek), ok. 17 powrót, wieczorem plac/karczma w zasięgu albo spacer.
// Bezrobotni i dzieci spacerują za dnia (dom, plac, sklep); dzieci chodzą do szkoły 8–13, jeśli jest w zasięgu.

import type { BuildingDef, Content, ServiceKind } from '../content/content';
import { needsRepair } from '../sim/systems/settlement/construction';
import { isBuilt, isOperational } from '../sim/systems/settlement/common';
import { doorTile, findPath, isRoadDef, roadTiles, walkSpeedAt } from '../sim/systems/settlement/roads';
import type { GameState, Resident } from '../sim/types';
import { BiomeId, MAP_H, MAP_W, inField, type WorldMap } from '../sim/world';

export interface Pt {
  x: number;
  y: number;
}

/** Prędkość chodu: kafle na godzinę gry (1 h gry = 60 s, czyli ok. 1,1 kafla/s). */
export const WALK_SPEED = 66;
/** Mnożnik prędkości poza drogami. */
export const OFFROAD_MULT = 0.7;
/** Trasa po drogach wygrywa, dopóki nie jest wolniejsza od przełaju o więcej niż ten mnożnik. */
const ROAD_PREFERENCE = 1 / 0.7;
/** Wyjście z domu rano i powrót przed nocą (godziny gry). */
export const MORNING = 6.5;
export const NIGHTFALL = 21;
/** Pojawianie się i znikanie w drzwiach (h gry ≈ 1,2 s). */
export const FADE_H = 0.02;
/** Limit tras w cache (czyszczony w całości po przekroczeniu). */
const ROUTE_CACHE_MAX = 1500;

const N = MAP_W * MAP_H;
const inMap = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

// ---------------------------------------------------------------- losowość deterministyczna

/** Hash (id, dzień, sól) → [0, 1). */
export function hash01(id: number, day: number, salt: number): number {
  let h = Math.imul(id | 0, 0x9e3779b1) ^ Math.imul((day | 0) + 0x632be5ab, 0x85ebca77) ^ Math.imul((salt | 0) + 0x1b873593, 0xc2b2ae3d);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const mix = (h: number, v: number): number => Math.imul(h ^ (v | 0), 16777619) >>> 0;

const typeIds = new WeakMap<Content, Map<string, number>>();
function typeId(c: Content, type: string): number {
  let m = typeIds.get(c);
  if (!m) {
    m = new Map(Object.keys(c.buildings).map((k, i) => [k, i + 1]));
    typeIds.set(c, m);
  }
  return m.get(type) ?? 0;
}

/** Plac i podobne płaskie budynki – można po nich chodzić i na nich stać. */
const isWalkable = (def: BuildingDef): boolean => def.art.model === 'plaza';
/** Praca pod gołym niebem (pole osady) – pracownicy są widoczni na polu. */
const isOutdoor = (def: BuildingDef): boolean => def.art.model === 'field';

// ---------------------------------------------------------------- trasy

/** Trasa: punkty (środki kafli) i skumulowany czas dojścia (h gry przy prędkości bazowej). */
export interface Route {
  pts: Pt[];
  cum: Float64Array;
  hours: number;
  /** Czy trasa prowadzi drogami (findPath), czy na przełaj. */
  road: boolean;
}

// ---------------------------------------------------------------- plan dnia

export type SegKind = 'inside' | 'stand' | 'walk';
/** Co mieszkaniec robi w danym odcinku (do testów, opisu i ewentualnych dymków). */
export type SegTag = 'home' | 'work' | 'school' | 'fun' | 'market' | 'stroll' | 'break' | 'commute' | 'away';

export interface Segment {
  kind: SegKind;
  /** Godziny dnia (0..24, ułamkowe). */
  t0: number;
  t1: number;
  tag: SegTag;
  /** inside: budynek (null = poza osadą, np. bezdomny nocą). */
  uid: number | null;
  /** stand: punkt (a); walk: początek (a) i koniec (b) w kaflach (ciągłe). */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  route: Route | null;
  fadeIn: boolean;
  fadeOut: boolean;
}

export interface DayPlan {
  day: number;
  segs: Segment[];
}

/** Stan postaci w danej chwili (obiekt wielokrotnego użytku – bez alokacji na klatkę). */
export interface Pose {
  visible: boolean;
  x: number;
  y: number;
  walking: boolean;
  /** Kierunek ruchu w kaflach (jednostkowy, 0 gdy stoi). */
  dx: number;
  dy: number;
  alpha: number;
  tag: SegTag;
  uid: number | null;
  /** Indeks odcinka (podpowiedź dla następnego wyszukiwania). */
  seg: number;
}

export const newPose = (): Pose => ({ visible: false, x: 0, y: 0, walking: false, dx: 0, dy: 0, alpha: 0, tag: 'home', uid: null, seg: 0 });

function segAt(plan: DayPlan, hour: number, hint: number): number {
  const segs = plan.segs;
  const h = segs[hint];
  if (h && hour >= h.t0 && hour < h.t1) return hint;
  const n = segs[hint + 1];
  if (n && hour >= n.t0 && hour < n.t1) return hint + 1;
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid]!.t1 <= hour) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Pozycja mieszkańca o godzinie `hour` wg planu. `still` (ograniczenie ruchu): zamiast chodzić stoi u celu.
 * `lane` – boczne przesunięcie w kaflach (prawa strona kierunku marszu), żeby idący nie nakładali się na siebie.
 */
export function samplePlan(plan: DayPlan, hour: number, out: Pose, still = false, lane = 0): Pose {
  const i = segAt(plan, hour, out.seg);
  const seg = plan.segs[i];
  out.seg = i;
  out.walking = false;
  out.dx = 0;
  out.dy = 0;
  if (!seg || hour < seg.t0 || hour >= seg.t1 || seg.kind === 'inside') {
    out.visible = false;
    out.alpha = 0;
    out.tag = seg?.tag ?? 'home';
    out.uid = seg?.uid ?? null;
    return out;
  }
  out.visible = true;
  out.tag = seg.tag;
  out.uid = null;
  out.alpha = still ? 1 : Math.max(0, Math.min(1, seg.fadeIn ? (hour - seg.t0) / FADE_H : 1, seg.fadeOut ? (seg.t1 - hour) / FADE_H : 1));
  if (seg.kind === 'stand' || !seg.route) {
    out.x = seg.ax;
    out.y = seg.ay;
    return out;
  }
  if (still) {
    out.x = seg.bx;
    out.y = seg.by;
    return out;
  }
  const r = seg.route;
  const pts = r.pts;
  const last = pts.length - 1;
  const span = seg.t1 - seg.t0;
  const tau = span > 0 ? ((hour - seg.t0) / span) * r.hours : 0;
  // odcinek trasy: cum[k] ≤ tau < cum[k+1]
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (r.cum[mid]! <= tau) lo = mid;
    else hi = mid;
  }
  const c0 = r.cum[lo]!;
  const c1 = r.cum[hi]!;
  const f = c1 > c0 ? Math.min(1, Math.max(0, (tau - c0) / (c1 - c0))) : 1;
  const p0 = pts[lo]!;
  const p1 = pts[hi]!;
  const x0 = lo === 0 ? seg.ax : p0.x;
  const y0 = lo === 0 ? seg.ay : p0.y;
  const x1 = hi === last ? seg.bx : p1.x;
  const y1 = hi === last ? seg.by : p1.y;
  let dx = x1 - x0;
  let dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  if (d > 1e-6) {
    dx /= d;
    dy /= d;
  } else {
    dx = 0;
    dy = 0;
  }
  out.walking = true;
  out.dx = dx;
  out.dy = dy;
  out.x = x0 + (x1 - x0) * f;
  out.y = y0 + (y1 - y0) * f;
  if (lane !== 0 && r.hours > 0) {
    // przesunięcie narasta od drzwi i znika u celu (bez skoku przy wejściu/wyjściu)
    const ramp = Math.min(1, (Math.min(tau, r.hours - tau) * WALK_SPEED) / 0.6);
    out.x += -dy * lane * ramp;
    out.y += dx * lane * ramp;
  }
  return out;
}

// ---------------------------------------------------------------- planista

/** Budynek z punktu widzenia mieszkańca: drzwi, środek, obrys, usługa. */
export interface Place {
  uid: number;
  door: Pt;
  cx: number;
  cy: number;
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Po obrysie można chodzić (plac). */
  walkable: boolean;
  /** Praca pod gołym niebem (pole osady). */
  outdoor: boolean;
  kind: ServiceKind | null;
  radius: number;
  /** Działa (ukończony, nieuszkodzony, z obsadą, jeśli ma etaty). */
  working: boolean;
}

class Builder {
  readonly segs: Segment[] = [];
  t = 0;

  constructor(
    private readonly planner: ResidentPlanner,
    /** Mnożnik prędkości mieszkańca. */
    private readonly mult: number,
  ) {}

  private push(kind: SegKind, t1: number, tag: SegTag, uid: number | null, a: Pt, b: Pt, route: Route | null): void {
    this.segs.push({ kind, t0: this.t, t1, tag, uid, ax: a.x, ay: a.y, bx: b.x, by: b.y, route, fadeIn: false, fadeOut: false });
    this.t = t1;
  }

  inside(until: number, uid: number | null, tag: SegTag): void {
    if (until <= this.t) return;
    const last = this.segs[this.segs.length - 1];
    if (last && last.kind === 'inside' && last.uid === uid && last.tag === tag) {
      last.t1 = until;
      this.t = until;
      return;
    }
    this.push('inside', until, tag, uid, ORIGIN, ORIGIN, null);
  }

  stand(until: number, p: Pt, tag: SegTag): void {
    if (until <= this.t) return;
    this.push('stand', until, tag, null, p, p, null);
  }

  /** Czas przejścia a → b (h gry) dla tego mieszkańca. */
  hours(a: Pt, b: Pt): number {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (dist < 0.05) return 0;
    const r = this.planner.route(a, b);
    return Math.max(r.hours, dist / WALK_SPEED) / this.mult;
  }

  walk(a: Pt, b: Pt, tag: SegTag): void {
    const h = this.hours(a, b);
    if (h <= 0) return;
    this.push('walk', this.t + h, tag, null, a, b, this.planner.route(a, b));
  }

  finish(uid: number | null): DayPlan['segs'] {
    this.inside(24, uid, 'home');
    const segs = this.segs;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]!;
      if (s.kind === 'inside') continue;
      s.fadeIn = i === 0 || segs[i - 1]!.kind === 'inside';
      s.fadeOut = i === segs.length - 1 || segs[i + 1]!.kind === 'inside';
    }
    return segs;
  }
}

const ORIGIN: Pt = { x: 0, y: 0 };

/**
 * Planista tras i dni mieszkańców. Trzyma cache tras (klucz: kafel startu | kafel celu, czyszczony przy zmianie
 * sygnatury dróg i przeszkód) oraz budynków (czyszczony przy zmianie stanu budynków lub obsady).
 * Przed użyciem z nowym stanem gry: `refresh(s, c, world)`.
 */
export class ResidentPlanner {
  private s: GameState | null = null;
  private c: Content | null = null;
  private world: WorldMap | null = null;
  private geoSig = -1;
  private townSig = -1;
  private readonly routes = new Map<number, Route>();
  private readonly places = new Map<number, Place | null>();
  private lists: { fun: Place[]; school: Place[]; market: Place[]; sites: Place[] } | null = null;
  private road: Uint8Array | null = null;
  private speed: Float32Array | null = null;
  private blocked: Uint8Array | null = null;
  private readonly workers = new Map<number, number>();
  // bufory BFS na przełaj (wielokrotnego użytku)
  private readonly parent = new Int32Array(N);
  private readonly stamp = new Int32Array(N);
  private readonly queue = new Int32Array(N);
  private gen = 0;
  /** Liczniki do testów i diagnostyki. */
  stats = { routes: 0, plans: 0 };

  /** Sygnatura układu dróg i przeszkód (zmiana = nowe trasy). */
  get geometry(): number {
    return this.geoSig;
  }

  /** Sygnatura osady dla planów (geometria + stan budynków i obsada). */
  get signature(): number {
    return this.townSig;
  }

  get cachedRoutes(): number {
    return this.routes.size;
  }

  /** Przyjmuje nowy stan gry; zwraca true, gdy zmieniła się sygnatura osady (plany do przeliczenia). */
  refresh(s: GameState, c: Content, world: WorldMap): boolean {
    let geo = 2166136261;
    for (const o of s.objects) {
      geo = mix(mix(mix(mix(geo, o.uid), o.x), o.y), typeId(c, o.type));
      if (c.buildings[o.type]?.kind === 'bridge') geo = mix(geo, isBuilt(s, o.uid) ? 1 : 0);
    }
    geo = mix(geo, s.objects.length);
    const workers = this.workers;
    workers.clear();
    for (const r of s.settlement.residents) if (r.job !== null) workers.set(r.job, (workers.get(r.job) ?? 0) + 1);
    let town = geo;
    for (const o of s.objects) {
      const def = c.buildings[o.type];
      if (!def || (!def.jobs && !def.service && def.kind !== 'house')) continue;
      const site = s.settlement.sites[String(o.uid)];
      const state = (isOperational(s, o.uid) ? 1 : 0) | (site && site.built < 1 ? 2 : 0) | (needsRepair(site) ? 4 : 0) | ((workers.get(o.uid) ?? 0) > 0 ? 8 : 0);
      town = mix(mix(town, o.uid), state);
    }
    const geoChanged = geo !== this.geoSig || world !== this.world || c !== this.c;
    this.s = s;
    this.c = c;
    this.world = world;
    if (geoChanged) {
      this.geoSig = geo;
      this.routes.clear();
      this.road = null;
      this.speed = null;
      this.blocked = null;
    }
    const changed = geoChanged || town !== this.townSig;
    if (changed) {
      this.townSig = town;
      this.places.clear();
      this.lists = null;
    }
    return changed;
  }

  private ctx(): { s: GameState; c: Content; world: WorldMap } {
    if (!this.s || !this.c || !this.world) throw new Error('ResidentPlanner: refresh() before use');
    return { s: this.s, c: this.c, world: this.world };
  }

  // ------------------------------------------------------------ mapa przejść

  private grid(): { road: Uint8Array; speed: Float32Array; blocked: Uint8Array } {
    if (this.road && this.speed && this.blocked) return { road: this.road, speed: this.speed, blocked: this.blocked };
    const { s, c, world } = this.ctx();
    const road = roadTiles(s, c, world);
    const speed = new Float32Array(N).fill(OFFROAD_MULT);
    const blocked = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (road[i]) {
        speed[i] = walkSpeedAt(s, c, world, i % MAP_W, Math.floor(i / MAP_W));
        continue;
      }
      if (world.biome[i] === BiomeId.water || inField(i % MAP_W, Math.floor(i / MAP_W))) blocked[i] = 1;
    }
    for (const o of s.objects) {
      const def = c.buildings[o.type];
      if (!def || isRoadDef(def) || isWalkable(def)) continue;
      const [w, h] = def.size;
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const x = o.x + dx;
          const y = o.y + dy;
          if (inMap(x, y) && !road[y * MAP_W + x]) blocked[y * MAP_W + x] = 1;
        }
      }
    }
    this.road = road;
    this.speed = speed;
    this.blocked = blocked;
    return { road, speed, blocked };
  }

  /** Czy kafel jest wolny do chodzenia (droga, trawa; nie budynek, woda ani pole uprawne). */
  walkable(x: number, y: number): boolean {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    return inMap(xi, yi) && !this.grid().blocked[yi * MAP_W + xi];
  }

  /** Prosta a → b nie przechodzi przez zablokowane kafle (poza kaflami końców). */
  private clearLine(ax: number, ay: number, bx: number, by: number, blocked: Uint8Array): boolean {
    const d = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(d / 0.2));
    const fa = Math.floor(ay) * MAP_W + Math.floor(ax);
    const fb = Math.floor(by) * MAP_W + Math.floor(bx);
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const x = Math.floor(ax + (bx - ax) * t);
      const y = Math.floor(ay + (by - ay) * t);
      if (!inMap(x, y)) return false;
      const i = y * MAP_W + x;
      if (i !== fa && i !== fb && blocked[i]) return false;
    }
    return true;
  }

  /** Trasa na przełaj: prosta, gdy nic nie stoi na drodze; inaczej BFS (8 kierunków, bez ścinania rogów) i wygładzenie. */
  private offroad(fx: number, fy: number, tx: number, ty: number): Pt[] {
    const { blocked } = this.grid();
    const a = { x: fx + 0.5, y: fy + 0.5 };
    const b = { x: tx + 0.5, y: ty + 0.5 };
    if (this.clearLine(a.x, a.y, b.x, b.y, blocked)) return [a, b];
    const gen = ++this.gen;
    const { parent, stamp, queue } = this;
    const fi = fy * MAP_W + fx;
    const ti = ty * MAP_W + tx;
    let head = 0;
    let tail = 0;
    stamp[fi] = gen;
    parent[fi] = -1;
    queue[tail++] = fi;
    let hit = false;
    while (head < tail && !hit) {
      const cur = queue[head++]!;
      const cx = cur % MAP_W;
      const cy = (cur - cx) / MAP_W;
      for (let k = 0; k < 8; k++) {
        const dx = DX8[k]!;
        const dy = DY8[k]!;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!inMap(nx, ny)) continue;
        const ni = ny * MAP_W + nx;
        if (stamp[ni] === gen || (ni !== ti && blocked[ni])) continue;
        // po przekątnej tylko, gdy oba kafle boczne są wolne
        if (dx !== 0 && dy !== 0 && (blocked[cy * MAP_W + nx] || blocked[ny * MAP_W + cx])) continue;
        stamp[ni] = gen;
        parent[ni] = cur;
        if (ni === ti) {
          hit = true;
          break;
        }
        queue[tail++] = ni;
      }
    }
    if (!hit) return [a, b];
    const tiles: Pt[] = [];
    for (let i = ti; i >= 0; i = parent[i]!) tiles.push({ x: (i % MAP_W) + 0.5, y: Math.floor(i / MAP_W) + 0.5 });
    tiles.reverse();
    // wygładzenie: zostawiamy tylko punkty, między którymi nie ma prostej
    const out: Pt[] = [tiles[0]!];
    let anchor = tiles[0]!;
    for (let j = 2; j < tiles.length; j++) {
      const p = tiles[j]!;
      if (!this.clearLine(anchor.x, anchor.y, p.x, p.y, blocked)) {
        anchor = tiles[j - 1]!;
        out.push(anchor);
      }
    }
    out.push(tiles[tiles.length - 1]!);
    return out;
  }

  private timed(pts: Pt[], road: boolean, speed: Float32Array): Route {
    const cum = new Float64Array(pts.length);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      let v = OFFROAD_MULT;
      if (road && d <= 1.01) {
        const ia = Math.floor(a.y) * MAP_W + Math.floor(a.x);
        const ib = Math.floor(b.y) * MAP_W + Math.floor(b.x);
        v = ((speed[ia] ?? OFFROAD_MULT) + (speed[ib] ?? OFFROAD_MULT)) / 2;
      }
      cum[i] = cum[i - 1]! + d / (WALK_SPEED * v);
    }
    return { pts, cum, hours: cum[pts.length - 1] ?? 0, road };
  }

  /** Trasa między kaflami punktów a i b (z cache): drogami (findPath), gdy nie nadkłada za dużo, inaczej na przełaj. */
  route(a: Pt, b: Pt): Route {
    const fx = Math.min(MAP_W - 1, Math.max(0, Math.floor(a.x)));
    const fy = Math.min(MAP_H - 1, Math.max(0, Math.floor(a.y)));
    const tx = Math.min(MAP_W - 1, Math.max(0, Math.floor(b.x)));
    const ty = Math.min(MAP_H - 1, Math.max(0, Math.floor(b.y)));
    const key = (fy * MAP_W + fx) * N + ty * MAP_W + tx;
    const hit = this.routes.get(key);
    if (hit) return hit;
    const { s, c, world } = this.ctx();
    const { speed } = this.grid();
    let route: Route;
    if (fx === tx && fy === ty) {
      route = this.timed([{ x: fx + 0.5, y: fy + 0.5 }, { x: tx + 0.5, y: ty + 0.5 }], false, speed);
    } else {
      const off = this.timed(this.offroad(fx, fy, tx, ty), false, speed);
      const tiles = findPath(s, c, world, { x: fx, y: fy }, { x: tx, y: ty });
      const viaRoad = tiles ? this.timed(tiles.map((t) => ({ x: t.x + 0.5, y: t.y + 0.5 })), true, speed) : null;
      route = viaRoad && viaRoad.hours <= off.hours * ROAD_PREFERENCE ? viaRoad : off;
    }
    if (this.routes.size >= ROUTE_CACHE_MAX) this.routes.clear();
    this.routes.set(key, route);
    this.stats.routes++;
    return route;
  }

  // ------------------------------------------------------------ budynki

  place(uid: number): Place | null {
    const cached = this.places.get(uid);
    if (cached !== undefined) return cached;
    const { s, c, world } = this.ctx();
    const o = s.objects.find((v) => v.uid === uid);
    const def = o && c.buildings[o.type];
    let p: Place | null = null;
    if (o && def) {
      const [w, h] = def.size;
      const door = doorTile(s, c, world, uid) ?? { x: o.x, y: o.y + h };
      const slots = def.jobs?.slots ?? 0;
      const working = isOperational(s, uid) && (!slots || (this.workers.get(uid) ?? 0) > 0);
      p = {
        uid,
        door: { x: door.x + 0.5, y: door.y + 0.5 },
        cx: o.x + w / 2,
        cy: o.y + h / 2,
        x0: o.x,
        y0: o.y,
        w,
        h,
        walkable: isWalkable(def),
        outdoor: isOutdoor(def),
        kind: def.service?.kind ?? null,
        radius: def.service?.radius ?? 0,
        working,
      };
    }
    this.places.set(uid, p);
    return p;
  }

  private placeLists(): { fun: Place[]; school: Place[]; market: Place[]; sites: Place[] } {
    if (this.lists) return this.lists;
    const { s, c } = this.ctx();
    const lists = { fun: [] as Place[], school: [] as Place[], market: [] as Place[], sites: [] as Place[] };
    for (const o of s.objects) {
      const def = c.buildings[o.type];
      if (!def) continue;
      const kind = def.service?.kind;
      if (kind === 'fun' || kind === 'school' || kind === 'market') {
        const p = this.place(o.uid);
        if (p?.working) lists[kind].push(p);
      }
      const site = s.settlement.sites[String(o.uid)];
      if (site && (site.built < 1 || needsRepair(site)) && !isRoadDef(def)) {
        const p = this.place(o.uid);
        if (p) lists.sites.push(p);
      }
    }
    lists.sites.sort((a, b) => a.uid - b.uid);
    this.lists = lists;
    return lists;
  }

  /** Działające budynki danej usługi, w których zasięgu jest punkt (środek domu). */
  inRange(kind: 'fun' | 'school' | 'market', at: Pt): Place[] {
    return this.placeLists()[kind].filter((p) => Math.hypot(p.cx - at.x, p.cy - at.y) <= p.radius);
  }

  /** Wolny punkt w pobliżu (spacer): kilka losowych prób, inaczej sam punkt bazowy. */
  near(base: Pt, id: number, day: number, salt: number, radius: number): Pt {
    for (let k = 0; k < 6; k++) {
      const x = Math.floor(base.x + (hash01(id, day, salt * 16 + k * 2) * 2 - 1) * radius);
      const y = Math.floor(base.y + (hash01(id, day, salt * 16 + k * 2 + 1) * 2 - 1) * radius);
      if (this.walkable(x, y) && (x !== Math.floor(base.x) || y !== Math.floor(base.y))) {
        return { x: x + 0.25 + hash01(id, day, salt + 900) * 0.5, y: y + 0.25 + hash01(id, day, salt + 901) * 0.5 };
      }
    }
    return base;
  }

  /** Punkt w obrysie budynku (plac, pole). */
  spotIn(p: Place, id: number, day: number, salt: number): Pt {
    return { x: p.x0 + 0.45 + hash01(id, day, salt) * (p.w - 0.9), y: p.y0 + 0.45 + hash01(id, day, salt + 1) * (p.h - 0.9) };
  }

  // ------------------------------------------------------------ dzień

  /** Plan dnia mieszkańca (deterministyczny dla id, dnia i sygnatury osady). */
  plan(r: Resident, day: number): DayPlan {
    this.stats.plans++;
    const id = r.id;
    const h = (k: number): number => hash01(id, day, k);
    const mult = 0.9 + hash01(id, 0, 77) * 0.2;
    const b = new Builder(this, mult);
    const home = r.home !== null ? this.place(r.home) : null;
    const jobPlace = r.job !== null && !r.child ? this.place(r.job) : null;
    const job = jobPlace && isOperational(this.ctx().s, jobPlace.uid) ? jobPlace : null;
    // bezdomny z pracą „mieszka” przy pracy (nocą niewidoczny); bez pracy – niewidoczny cały dzień
    const base = home ?? job;
    if (!base) {
      b.inside(24, null, 'away');
      return { day, segs: b.finish(null) };
    }
    const baseUid = home ? home.uid : null;
    const center = { x: base.cx, y: base.cy };
    if (job) this.workDay(b, r, day, h, base, baseUid, job, center);
    else if (r.child) this.childDay(b, r, day, h, base, baseUid, center);
    else this.freeDay(b, r, day, h, base, baseUid, center, MORNING + 1 + h(20) * 1.6, NIGHTFALL - 0.45, false);
    return { day, segs: b.finish(baseUid) };
  }

  private workDay(b: Builder, r: Resident, day: number, h: (k: number) => number, base: Place, baseUid: number | null, job: Place, center: Pt): void {
    const { c } = this.ctx();
    const k = c.settlement.constants;
    const start = k.workStart;
    const end = k.workEnd;
    const same = base.uid === job.uid;
    const commute = same ? 0 : b.hours(base.door, job.door);
    // wyjście ok. 6:30–6:51, ale tak, by zdążyć mniej więcej na 7:00
    const leave = Math.max(MORNING - 0.25, Math.min(MORNING + h(1) * 0.35, start + 0.05 - commute));
    b.inside(leave, baseUid, 'home');
    if (!same) b.walk(base.door, job.door, 'commute');
    const off = end + h(2) * 0.4;
    if (job.kind === 'build' && this.placeLists().sites.length) this.builderShift(b, r.id, day, h, job, off);
    else if (job.outdoor) this.fieldShift(b, r.id, day, job, off);
    else {
      if (h(3) < 0.35) {
        // krótkie wyjście przed budynek
        b.inside(Math.max(b.t, 10 + h(4) * 5), job.uid, 'work');
        const p = this.near(job.door, r.id, day, 5, 1.2);
        b.walk(job.door, p, 'break');
        b.stand(b.t + 0.12 + h(6) * 0.2, p, 'break');
        b.walk(p, job.door, 'break');
      }
      b.inside(off, job.uid, 'work');
    }
    if (!same) b.walk(job.door, base.door, 'commute');
    this.evening(b, r, day, h, base, baseUid, center);
  }

  /** Budowlańcy chodzą na place budowy i stoją przy nich (widoczni w pracy). */
  private builderShift(b: Builder, id: number, day: number, h: (k: number) => number, job: Place, off: number): void {
    const sites = this.placeLists().sites.slice(0, 3);
    const site = sites[Math.floor(h(30) * sites.length)] ?? sites[0]!;
    const spot = this.near(site.door, id, day, 31, 1.4);
    b.walk(job.door, spot, 'work');
    const back = b.hours(spot, job.door);
    b.stand(Math.max(b.t, off - back), spot, 'work');
    b.walk(spot, job.door, 'work');
  }

  /** Praca na polu osady: kilka miejsc w obrysie, przejścia między nimi. */
  private fieldShift(b: Builder, id: number, day: number, job: Place, off: number): void {
    let cur = job.door;
    for (let k = 0; k < 6 && b.t < off - 0.3; k++) {
      const p = this.spotIn(job, id, day, 40 + k * 2);
      b.walk(cur, p, 'work');
      cur = p;
      b.stand(Math.min(off - 0.15, b.t + 1.1 + hash01(id, day, 60 + k) * 0.9), p, 'work');
    }
    b.walk(cur, job.door, 'work');
  }

  /** Wieczór: plac/karczma w zasięgu domu albo spacer w okolicy, powrót przed 21:00. */
  private evening(b: Builder, r: Resident, day: number, h: (k: number) => number, base: Place, baseUid: number | null, center: Pt): void {
    b.inside(Math.max(b.t, 17.6 + h(7) * 0.7), baseUid, 'home');
    const roll = h(8);
    const funs = this.inRange('fun', center);
    const fun = funs.length ? funs[Math.floor(h(9) * funs.length)]! : null;
    const limit = NIGHTFALL - 0.08;
    if (fun && roll < 0.55) {
      const spot = fun.walkable ? this.spotIn(fun, r.id, day, 10) : fun.door;
      const go = b.hours(base.door, spot);
      const back = b.hours(spot, base.door);
      if (b.t + go + back + 0.5 > limit) return;
      b.walk(base.door, spot, 'fun');
      const leave = Math.min(limit - back, 19.8 + h(11) * 0.8);
      if (fun.walkable) {
        // na placu: postój, przejście w inne miejsce, postój
        const mid = b.t + (leave - b.t) * (0.35 + h(12) * 0.3);
        b.stand(mid, spot, 'fun');
        const spot2 = this.spotIn(fun, r.id, day, 14);
        const back2 = b.hours(spot2, base.door);
        b.walk(spot, spot2, 'fun');
        b.stand(Math.max(b.t, Math.min(limit - back2, leave)), spot2, 'fun');
        b.walk(spot2, base.door, 'fun');
      } else {
        b.inside(leave, fun.uid, 'fun');
        b.walk(fun.door, base.door, 'fun');
      }
    } else if (roll < 0.85) {
      this.stroll(b, r.id, day, base, Math.min(limit, 19.4 + h(13) * 1.3), 3);
    }
  }

  /** Spacer wokół bazy: 1–3 punkty z postojami, potem powrót do drzwi przed `until`. */
  private stroll(b: Builder, id: number, day: number, base: Place, until: number, radius: number): void {
    let cur = base.door;
    const n = 1 + Math.floor(hash01(id, day, 200 + Math.floor(b.t)) * 3);
    for (let k = 0; k < n; k++) {
      const p = this.near(base.door, id, day, 210 + Math.floor(b.t * 4) + k, radius);
      const go = b.hours(cur, p);
      const back = b.hours(p, base.door);
      if (b.t + go + back + 0.15 > until) break;
      b.walk(cur, p, 'stroll');
      cur = p;
      b.stand(Math.min(until - back, b.t + 0.2 + hash01(id, day, 230 + k) * 0.4), p, 'stroll');
    }
    b.walk(cur, base.door, 'stroll');
  }

  private childDay(b: Builder, r: Resident, day: number, h: (k: number) => number, base: Place, baseUid: number | null, center: Pt): void {
    const schools = this.inRange('school', center);
    const school = schools.length ? schools[Math.floor(h(15) * schools.length)]! : null;
    if (!school) {
      this.freeDay(b, r, day, h, base, baseUid, center, 8 + h(20) * 1.2, NIGHTFALL - 1.3, true);
      return;
    }
    const go = b.hours(base.door, school.door);
    b.inside(Math.max(MORNING + 0.4, 8 - 0.12 - h(16) * 0.3 - go), baseUid, 'home');
    b.walk(base.door, school.door, 'school');
    b.inside(Math.max(b.t, 13 + h(17) * 0.25), school.uid, 'school');
    if (h(18) < 0.5) {
      // po szkole prosto do domu na obiad
      b.walk(school.door, base.door, 'school');
      this.freeDay(b, r, day, h, base, baseUid, center, b.t + 0.6 + h(19) * 0.8, NIGHTFALL - 1.3, true);
    } else {
      this.freeDay(b, r, day, h, base, baseUid, center, b.t, NIGHTFALL - 1.3, true, school.door);
    }
  }

  /**
   * Dzień bez pracy: wyjścia (spacer, plac, sklep, odpoczynek w domu) od `start` do `end`, potem do domu.
   * `from` – gdzie mieszkaniec stoi (domyślnie w domu).
   */
  private freeDay(
    b: Builder,
    r: Resident,
    day: number,
    h: (k: number) => number,
    base: Place,
    baseUid: number | null,
    center: Pt,
    start: number,
    end: number,
    child: boolean,
    from: Pt | null = null,
  ): void {
    if (!from) b.inside(start, baseUid, 'home');
    let cur: Pt | null = from; // null = w domu
    const funs = this.inRange('fun', center).filter((p) => !child || p.walkable);
    const markets = child ? [] : this.inRange('market', center);
    for (let k = 0; k < 8 && b.t < end - 0.4; k++) {
      const roll = h(100 + k);
      const pick = h(120 + k);
      const here = cur ?? base.door;
      let target: Pt;
      let tag: SegTag;
      let indoor: Place | null = null;
      if (roll < 0.3 && funs.length) {
        const f = funs[Math.floor(pick * funs.length)]!;
        tag = 'fun';
        if (f.walkable) target = this.spotIn(f, r.id, day, 140 + k * 2);
        else {
          target = f.door;
          indoor = f;
        }
      } else if (roll < 0.48 && markets.length) {
        const m = markets[Math.floor(pick * markets.length)]!;
        target = m.door;
        indoor = m;
        tag = 'market';
      } else if (roll < 0.85 || cur === null) {
        target = this.near(base.door, r.id, day, 160 + k, child ? 2.5 : 3.5);
        tag = 'stroll';
      } else {
        // odpoczynek w domu
        b.walk(here, base.door, 'stroll');
        cur = null;
        b.inside(Math.min(end, b.t + 0.5 + h(180 + k)), baseUid, 'home');
        continue;
      }
      const go = b.hours(here, target);
      const back = b.hours(target, base.door);
      if (b.t + go + back + 0.25 > end) break;
      b.walk(here, target, tag);
      const stay = Math.min(end - back, b.t + 0.35 + h(190 + k) * (tag === 'stroll' ? 0.5 : 0.9));
      if (indoor) b.inside(stay, indoor.uid, tag);
      else b.stand(stay, target, tag);
      cur = target;
    }
    if (cur) b.walk(cur, base.door, 'stroll');
  }
}

const DX8 = [0, 1, 0, -1, 1, 1, -1, -1] as const;
const DY8 = [-1, 0, 1, 0, -1, 1, 1, -1] as const;
