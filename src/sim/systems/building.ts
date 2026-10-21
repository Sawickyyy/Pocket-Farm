// Swobodne rozmieszczanie budynków, ścieżek, płotów i dekoracji w strefie farmy (siatka kafli).

import type { CommandResult } from '../commands';
import { OK, fail, levelOf, stat, type Ctx } from '../ctx';
import type { GameState, PlacedObject } from '../types';
import { FARM, inFarm, inField, tileIndex } from '../world';
import type { Content } from '../../content/content';

export const REFUND = 0.5;

/** Mapa zajętości: indeks kafla → uid obiektu. */
export function occupancy(s: GameState, c: Content, ignoreUid = -1): Map<number, number> {
  const out = new Map<number, number>();
  for (const o of s.objects) {
    if (o.uid === ignoreUid) continue;
    const [w, h] = c.buildings[o.type]?.size ?? [1, 1];
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.set(tileIndex(o.x + dx, o.y + dy), o.uid);
  }
  return out;
}

export function canPlace(s: GameState, c: Content, type: string, x: number, y: number, ignoreUid = -1): CommandResult {
  const def = c.buildings[type];
  if (!def) return fail('invalid');
  const [w, h] = def.size;
  const occ = occupancy(s, c, ignoreUid);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!inFarm(tx, ty)) return fail('outside-farm');
      if (inField(tx, ty)) return fail('blocked');
      if (occ.has(tileIndex(tx, ty))) return fail('blocked');
    }
  }
  return OK;
}

export function objectAt(s: GameState, c: Content, x: number, y: number): PlacedObject | null {
  const uid = occupancy(s, c).get(tileIndex(x, y));
  return uid === undefined ? null : (s.objects.find((o) => o.uid === uid) ?? null);
}

const center = (c: Content, o: { type: string; x: number; y: number }) => {
  const [w, h] = c.buildings[o.type]?.size ?? [1, 1];
  return { x: o.x + w / 2, y: o.y + h / 2 };
};

export function place(ctx: Ctx, type: string, x: number, y: number): CommandResult {
  const { s, c } = ctx;
  const def = c.buildings[type];
  if (!def) return fail('invalid');
  if (def.festival && !s.unlocks.includes(type)) return fail('locked');
  if (levelOf(s.xp) < def.level) return fail('level-too-low');
  const check = canPlace(s, c, type, x, y);
  if (!check.ok) return check;
  if (s.coins < def.cost) return fail('no-coins');
  s.coins -= def.cost;
  const uid = s.nextUid++;
  s.objects.push({ uid, type, x, y });
  if (def.kind === 'machine') s.machines[String(uid)] = { queue: [], output: {} };
  stat(ctx, 'built');
  ctx.bus.emit({ type: 'placed', uid, building: type, at: center(c, { type, x, y }) });
  return OK;
}

export function move(ctx: Ctx, uid: number, x: number, y: number): CommandResult {
  const { s, c } = ctx;
  const o = s.objects.find((v) => v.uid === uid);
  if (!o) return fail('invalid');
  const check = canPlace(s, c, o.type, x, y, uid);
  if (!check.ok) return check;
  o.x = x;
  o.y = y;
  ctx.bus.emit({ type: 'moved', uid, at: center(c, o) });
  return OK;
}

export function remove(ctx: Ctx, uid: number): CommandResult {
  const { s, c } = ctx;
  const o = s.objects.find((v) => v.uid === uid);
  const def = o && c.buildings[o.type];
  if (!o || !def) return fail('invalid');
  if (s.animals.some((a) => a.home === uid)) return fail('occupied');
  const m = s.machines[String(uid)];
  if (m && (m.queue.length || Object.keys(m.output).length)) return fail('busy');
  s.objects = s.objects.filter((v) => v.uid !== uid);
  delete s.machines[String(uid)];
  const refund = Math.floor(def.cost * REFUND);
  s.coins += refund;
  ctx.bus.emit({ type: 'removed', uid, refund, at: center(c, o) });
  return OK;
}

export const FARM_RECT = FARM;
