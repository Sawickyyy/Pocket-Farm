// Drzewko umiejętności: punkty za poziomy, wymagania z JSON, efekty liczone przez `mod()`.

import type { CommandResult } from '../commands';
import { OK, fail, stat, type Ctx } from '../ctx';
import type { GameState } from '../types';
import type { Content } from '../../content/content';

export function canLearn(s: GameState, c: Content, id: string): CommandResult {
  const def = c.skill[id];
  if (!def) return fail('invalid');
  if (s.skills.includes(id)) return fail('already-have');
  if (!def.requires.every((r) => s.skills.includes(r))) return fail('requires-skill');
  if (s.skillPoints < def.cost) return fail('no-points');
  return { ok: true };
}

export function unlockSkill(ctx: Ctx, id: string): CommandResult {
  const check = canLearn(ctx.s, ctx.c, id);
  if (!check.ok) return check;
  ctx.s.skillPoints -= ctx.c.skill[id]!.cost;
  ctx.s.skills.push(id);
  stat(ctx, 'skills');
  ctx.bus.emit({ type: 'skillUnlocked', id });
  return OK;
}
