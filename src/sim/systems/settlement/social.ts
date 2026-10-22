// Relacje społeczne: przyjaźnie, miłość, śluby, konflikty (docs/plan-osada.md §11).

import { rand, type Ctx } from '../../ctx';
import type { GameState, Relation, RelationKind, Resident } from '../../types';
import { centerOf, chronicle, coverageAtHome, freeHousing, objectByUid } from './common';

/** Kontakt sąsiedzki: środki domów w odległości Czebyszewa ≤ 4 kafle. */
export const NEIGHBOR_DISTANCE = 4;
export const FRIEND_CHANCE = 0.15;
export const FRIEND_STEP = 0.2;
/** Przyjaźń bez kontaktu (nie współpracownicy, nie sąsiedzi) słabnie o tyle dziennie. */
export const FRIEND_FADE = 0.05;
export const LOVE_MIN = 0.6;
export const LOVE_CHANCE = 0.1;
export const LOVE_STEP = 0.25;
/** Konflikty: sąsiedzi o szczęściu poniżej progu. */
export const CONFLICT_MOOD = 0.35;
export const CONFLICT_CHANCE = 0.1;
/** Mnożnik szansy konfliktu przy pokryciu posterunku. */
export const CONFLICT_POLICE = 0.5;
export const CONFLICT_STEP = 0.3;
/** Konflikt gaśnie, gdy oboje mają szczęście ≥ progu. */
export const CONFLICT_CALM = 0.5;
export const CONFLICT_FADE = 0.1;

const key = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);
/** Zaokrąglenie wartości relacji (bez dryfu 0,1 + 0,2). */
const round = (v: number): number => Math.round(v * 1000) / 1000;

/** Stan jednej doby relacji: indeksy, liczniki, pokrycie posterunku (liczone leniwie). */
interface SocialDay {
  ctx: Ctx;
  index: Map<string, Relation>;
  count: Map<number, number>;
  partnered: Set<number>;
  inLove: Set<number>;
  policed: Map<number, boolean>;
}

/** Raz na dobę: nowe i rosnące relacje, śluby (wspólny dom), konflikty. Emituje `relation`. */
export function socialDay(ctx: Ctx): void {
  const { s, c } = ctx;
  const st = s.settlement;
  const rs = [...st.residents].sort((x, y) => x.id - y.id);
  const byId = new Map(rs.map((r) => [r.id, r]));
  // Relacje osób, których już nie ma, znikają.
  st.relations = st.relations.filter((r) => r.a !== r.b && byId.has(r.a) && byId.has(r.b));
  if (rs.length < 2) return;

  const d: SocialDay = { ctx, index: new Map(), count: new Map(), partnered: new Set(), inLove: new Set(), policed: new Map() };
  for (const rel of st.relations) {
    d.index.set(key(rel.a, rel.b), rel);
    d.count.set(rel.a, (d.count.get(rel.a) ?? 0) + 1);
    d.count.set(rel.b, (d.count.get(rel.b) ?? 0) + 1);
    if (rel.kind === 'partner') d.partnered.add(rel.a).add(rel.b);
    if (rel.kind === 'love') d.inLove.add(rel.a).add(rel.b);
  }

  // 1. Miłość rośnie (bez losowania), przy v ≥ 1 – ślub. Nowe zakochania liczą się od jutra.
  for (const rel of st.relations) {
    if (rel.kind !== 'love') continue;
    const a = byId.get(rel.a)!;
    const b = byId.get(rel.b)!;
    if (d.partnered.has(a.id) || d.partnered.has(b.id)) {
      rel.kind = 'friend'; // ktoś już ma partnera – zostaje przyjaźń
      d.inLove.delete(a.id);
      d.inLove.delete(b.id);
      continue;
    }
    rel.v = round(rel.v + LOVE_STEP);
    if (rel.v >= 1) wed(d, rel, a, b);
  }

  // 2. Kontakty: współpracownicy i sąsiedzi (bez członków tej samej rodziny), pary po id rosnąco.
  const n = rs.length;
  const hx = new Float64Array(n).fill(NaN);
  const hy = new Float64Array(n).fill(NaN);
  const centers = new Map<number, { x: number; y: number } | null>();
  for (let i = 0; i < n; i++) {
    const home = rs[i]!.home;
    if (home === null) continue;
    let ctr = centers.get(home);
    if (ctr === undefined) {
      const o = objectByUid(s, home);
      ctr = o ? centerOf(c, o) : null;
      centers.set(home, ctr);
    }
    if (ctr) {
      hx[i] = ctr.x;
      hy[i] = ctr.y;
    }
  }
  const contact = new Set<string>();
  for (let i = 0; i < n; i++) {
    const a = rs[i]!;
    for (let j = i + 1; j < n; j++) {
      const b = rs[j]!;
      if (a.family === b.family) continue;
      // NaN (bezdomny) daje false.
      const near = Math.max(Math.abs(hx[i]! - hx[j]!), Math.abs(hy[i]! - hy[j]!)) <= NEIGHBOR_DISTANCE;
      if (!near && (a.job === null || a.job !== b.job)) continue;
      const k = key(a.id, b.id);
      contact.add(k);
      meet(d, a, b, near, d.index.get(k));
    }
  }

  // 3. Wygasanie: konflikty przy dobrym szczęściu, przyjaźnie bez kontaktu.
  st.relations = st.relations.filter((rel) => {
    if (rel.kind === 'conflict') {
      const a = byId.get(rel.a)!;
      const b = byId.get(rel.b)!;
      if (a.happiness >= CONFLICT_CALM && b.happiness >= CONFLICT_CALM) rel.v = round(rel.v - CONFLICT_FADE);
      return rel.v > 0;
    }
    if (rel.kind === 'friend') {
      if (!contact.has(key(rel.a, rel.b))) rel.v = round(rel.v - FRIEND_FADE);
      return rel.v > 0;
    }
    return true;
  });
}

/** Spotkanie pary w kontakcie (a.id < b.id): nowa relacja albo rozwój istniejącej. */
function meet(d: SocialDay, a: Resident, b: Resident, near: boolean, rel: Relation | undefined): void {
  const { s } = d.ctx;
  const quarrelsome = near && a.happiness < CONFLICT_MOOD && b.happiness < CONFLICT_MOOD;
  if (!rel) {
    const max = d.ctx.c.settlement.constants.maxRelations;
    if ((d.count.get(a.id) ?? 0) >= max || (d.count.get(b.id) ?? 0) >= max) return;
    if (quarrelsome && rand(s) < conflictChance(d, a, b)) add(d, a, b, 'conflict', CONFLICT_STEP);
    else if (rand(s) < FRIEND_CHANCE) add(d, a, b, 'friend', FRIEND_STEP);
    return;
  }
  if (rel.kind === 'friend') {
    if (rand(s) < FRIEND_CHANCE) rel.v = Math.min(1, round(rel.v + FRIEND_STEP));
    if (rel.v >= LOVE_MIN && canFallInLove(d, a, b) && rand(s) < LOVE_CHANCE) {
      rel.kind = 'love';
      d.inLove.add(a.id).add(b.id);
      d.ctx.bus.emit({ type: 'relation', kind: 'love', a: rel.a, b: rel.b });
    }
  } else if (rel.kind === 'conflict' && quarrelsome && rand(s) < conflictChance(d, a, b)) {
    const before = rel.v;
    rel.v = Math.min(1, round(rel.v + CONFLICT_STEP));
    if (before < 1 && rel.v >= 1) chronicle(d.ctx, 'quarrel', { a: a.name, b: b.name });
  }
}

/** Dorośli z różnych rodzin, oboje bez partnera i bez innej miłości. */
function canFallInLove(d: SocialDay, a: Resident, b: Resident): boolean {
  return !a.child && !b.child && a.family !== b.family && !d.partnered.has(a.id) && !d.partnered.has(b.id) && !d.inLove.has(a.id) && !d.inLove.has(b.id);
}

/** 0,1, połowa przy pokryciu posterunku w domu któregokolwiek z pary. */
function conflictChance(d: SocialDay, a: Resident, b: Resident): number {
  return CONFLICT_CHANCE * (isPoliced(d, a) || isPoliced(d, b) ? CONFLICT_POLICE : 1);
}

function isPoliced(d: SocialDay, r: Resident): boolean {
  let v = d.policed.get(r.id);
  if (v === undefined) {
    v = coverageAtHome(d.ctx.s, d.ctx.c, 'police', r) > 0;
    d.policed.set(r.id, v);
  }
  return v;
}

function add(d: SocialDay, a: Resident, b: Resident, kind: RelationKind, v: number): void {
  const rel: Relation = { a: Math.min(a.id, b.id), b: Math.max(a.id, b.id), kind, v };
  d.ctx.s.settlement.relations.push(rel);
  d.index.set(key(rel.a, rel.b), rel);
  d.count.set(a.id, (d.count.get(a.id) ?? 0) + 1);
  d.count.set(b.id, (d.count.get(b.id) ?? 0) + 1);
  d.ctx.bus.emit({ type: 'relation', kind, a: rel.a, b: rel.b });
}

/**
 * Ślub: b (i dzieci rodziny b, jeśli nie zostaje w niej inny dorosły) przechodzi do rodziny a.
 * Przeprowadzka: do domu a, jeśli ma miejsce dla przenoszonych; inaczej a (+ jego dzieci) do domu b; inaczej osobno.
 */
function wed(d: SocialDay, rel: Relation, a: Resident, b: Resident): void {
  const { ctx } = d;
  const { s, c } = ctx;
  const st = s.settlement;
  rel.kind = 'partner';
  rel.v = 1;
  d.inLove.delete(a.id);
  d.inLove.delete(b.id);
  d.partnered.add(a.id).add(b.id);

  const kidsOf = (p: Resident): Resident[] => {
    const otherAdult = st.residents.some((x) => x.family === p.family && !x.child && x.id !== p.id);
    return otherAdult ? [] : st.residents.filter((x) => x.family === p.family && x.child);
  };
  const aKids = kidsOf(a);
  const bKids = kidsOf(b);
  b.family = a.family;
  for (const k of bKids) k.family = a.family;

  const free = freeHousing(s, c);
  if (!moveInto(free, a.home, [b, ...bKids])) moveInto(free, b.home, [a, ...aKids]);

  st.stats.weddings++;
  ctx.bus.emit({ type: 'relation', kind: 'partner', a: rel.a, b: rel.b });
  chronicle(ctx, 'wedding', { a: a.name, b: b.name });
}

/** Przenosi `movers` do mieszkalnego domu `home`, jeśli zmieszczą się wszyscy (kto już tam mieszka, nie zajmuje miejsca). */
function moveInto(free: Map<number, number>, home: number | null, movers: Resident[]): boolean {
  if (home === null) return false;
  const room = free.get(home);
  if (room === undefined) return false; // nie jest ukończonym, mieszkalnym domem
  const moving = movers.filter((m) => m.home !== home);
  if (moving.length > room) return false;
  for (const m of moving) {
    m.home = home;
    m.homelessDays = 0;
  }
  free.set(home, room - moving.length);
  return true;
}

// ---------------------------------------------------------------- zapytania

export function relationsOf(s: GameState, id: number): Relation[] {
  return s.settlement.relations.filter((r) => r.a === id || r.b === id);
}

/** Relacja między dwojgiem mieszkańców (kolejność id dowolna). */
export function relationBetween(s: GameState, x: number, y: number): Relation | undefined {
  const a = Math.min(x, y);
  const b = Math.max(x, y);
  return s.settlement.relations.find((r) => r.a === a && r.b === b);
}

export function partnerOf(s: GameState, id: number): number | null {
  const r = s.settlement.relations.find((x) => x.kind === 'partner' && (x.a === id || x.b === id));
  return r ? (r.a === id ? r.b : r.a) : null;
}

/** Wpływ relacji na szczęście: +0,03/przyjaciel (max 0,09), +0,05 partner, −0,05/konflikt. */
export function relationBonus(s: GameState, id: number): number {
  let friends = 0;
  let bonus = 0;
  for (const r of s.settlement.relations) {
    if (r.a !== id && r.b !== id) continue;
    if (r.kind === 'friend') friends++;
    else if (r.kind === 'partner') bonus += 0.05;
    else if (r.kind === 'conflict') bonus -= 0.05;
  }
  return bonus + Math.min(0.09, friends * 0.03);
}

/** Usuwa relacje mieszkańca (wyjazd). */
export function dropRelations(s: GameState, id: number): void {
  s.settlement.relations = s.settlement.relations.filter((r) => r.a !== id && r.b !== id);
}
