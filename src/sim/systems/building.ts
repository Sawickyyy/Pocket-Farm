// Swobodne rozmieszczanie budynków, dróg, płotów i dekoracji na terenie osady (siatka kafli).
// Budynki osady (docs/plan-osada.md §2): etap, materiały, warianty wyglądu, plac budowy, bony rady.

import type { CommandResult } from '../commands';
import { OK, consumeItem, countItem, fail, levelOf, stat, type Ctx } from '../ctx';
import type { GameState, PlacedObject } from '../types';
import { FARM, generateWorld, tileIndex, type WorldMap } from '../world';
import type { Content } from '../../content/content';
import { addBudget, chronicle, isSettlementDef, releaseBuilding, startSite } from './settlement/common';
import { voucherDiscount } from './settlement/council';
import { terrainCheck } from './settlement/territory';
import { tierAllows } from './settlement/tiers';

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

/**
 * Czy wolno postawić budynek w (x, y): teren osady, wymagania terenu, zajętość, etap i unikalność.
 * `world` jest potrzebny do sprawdzenia biomu i drzew (w UI: generateWorld(s.seed)).
 */
export function canPlace(s: GameState, c: Content, type: string, x: number, y: number, ignoreUid = -1, world?: WorldMap): CommandResult {
  const def = c.buildings[type];
  if (!def) return fail('invalid');
  if (!tierAllows(s.settlement.peakTier, def.tier)) return fail('tier-too-low');
  if (def.unique && ignoreUid < 0 && s.objects.some((o) => o.type === type)) return fail('unique');
  const w = world ?? worldOf(s);
  const terrain = terrainCheck(s, w, def, x, y);
  if (terrain) return terrain;
  const [bw, bh] = def.size;
  const occ = occupancy(s, c, ignoreUid);
  for (let dy = 0; dy < bh; dy++) for (let dx = 0; dx < bw; dx++) if (occ.has(tileIndex(x + dx, y + dy))) return fail('blocked');
  return OK;
}

const worldOf = (s: GameState): WorldMap => generateWorld(s.seed);

export function objectAt(s: GameState, c: Content, x: number, y: number): PlacedObject | null {
  const uid = occupancy(s, c).get(tileIndex(x, y));
  return uid === undefined ? null : (s.objects.find((o) => o.uid === uid) ?? null);
}

const center = (c: Content, o: { type: string; x: number; y: number }) => {
  const [w, h] = c.buildings[o.type]?.size ?? [1, 1];
  return { x: o.x + w / 2, y: o.y + h / 2 };
};

/** Cena budynku po bonie rady (docs/plan-osada.md §13). */
export function placeCost(s: GameState, c: Content, type: string, day: number): number {
  const def = c.buildings[type];
  if (!def) return 0;
  return Math.round(def.cost * (1 - voucherDiscount(s, type, day)));
}

export function place(ctx: Ctx, type: string, x: number, y: number, style?: number): CommandResult {
  const { s, c } = ctx;
  const def = c.buildings[type];
  if (!def) return fail('invalid');
  if (def.festival && !s.unlocks.includes(type)) return fail('locked');
  if (levelOf(s.xp) < def.level) return fail('level-too-low');
  const check = canPlace(s, c, type, x, y, -1, ctx.world);
  if (!check.ok) return check;
  const cost = placeCost(s, c, type, ctx.cal.day);
  if (s.coins < cost) return fail('no-coins');
  if (def.materials?.some((m) => countItem(s, m.item) < m.qty)) return fail('missing-items');
  if (style !== undefined && (!Number.isInteger(style) || style < 0 || style >= (def.styles ?? 1))) return fail('invalid');
  s.coins -= cost;
  for (const m of def.materials ?? []) consumeItem(s, m.item, m.qty);
  if (s.settlement.vouchers[type] && cost < def.cost) delete s.settlement.vouchers[type];
  const uid = s.nextUid++;
  const obj: PlacedObject = { uid, type, x, y };
  if (def.styles && def.styles > 1) obj.style = style ?? 0;
  s.objects.push(obj);
  if (def.kind === 'machine') s.machines[String(uid)] = { queue: [], output: {} };
  if (isSettlementDef(def)) {
    addBudget(ctx, 'investments', cost);
    if ((def.buildHours ?? 0) > 0) startSite(s, uid);
    if (def.kind === 'house' || def.service || def.jobs) chronicle(ctx, 'placed', { building: type });
  }
  stat(ctx, 'built');
  ctx.bus.emit({ type: 'placed', uid, building: type, at: center(c, { type, x, y }) });
  return OK;
}

export function move(ctx: Ctx, uid: number, x: number, y: number): CommandResult {
  const { s, c } = ctx;
  const o = s.objects.find((v) => v.uid === uid);
  if (!o) return fail('invalid');
  const check = canPlace(s, c, o.type, x, y, uid, ctx.world);
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
  // Mieszkańcy tracą dom/pracę, budowa i stan znikają.
  releaseBuilding(s, uid);
  delete s.settlement.sites[String(uid)];
  const refund = Math.floor(def.cost * REFUND);
  s.coins += refund;
  ctx.bus.emit({ type: 'removed', uid, refund, at: center(c, o) });
  return OK;
}

export const FARM_RECT = FARM;
