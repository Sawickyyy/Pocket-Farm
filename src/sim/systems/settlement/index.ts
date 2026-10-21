// Orkiestracja osady: kolejność systemów co godzinę i co dobę + komendy gracza (docs/plan-osada.md).

import type { Command, CommandResult } from '../../commands';
import { OK, fail, type Ctx } from '../../ctx';
import { assignJobs } from './jobs';
import { constructionHour, repair } from './construction';
import { councilDay, decideProposal, renameSettlement, specialize } from './council';
import { economyDay, economyHour, productionHour, setTax, toggleReserve } from './economy';
import { eventsDay, eventsHour, treatAnimals } from './events';
import { needsDay, needsHour } from './needs';
import { populationDay, populationHour } from './population';
import { socialDay } from './social';
import { buyTerritory } from './territory';
import { updateTier } from './tiers';
import { caravanBuy, caravanSell, toggleExport, tradeHour } from './trade';

/** Pełna godzina gry (`hour` 0..23) – wywoływana przez symulację raz na godzinę. */
export function settlementHour(ctx: Ctx, hour: number): void {
  constructionHour(ctx, hour);
  eventsHour(ctx, hour);
  assignJobs(ctx);
  productionHour(ctx, hour);
  needsHour(ctx, hour);
  economyHour(ctx, hour);
  tradeHour(ctx, hour);
  populationHour(ctx, hour);
  updateTier(ctx);
}

/** Nowa doba (po rozliczeniu farmy). */
export function settlementDay(ctx: Ctx): void {
  economyDay(ctx);
  needsDay(ctx);
  populationDay(ctx);
  socialDay(ctx);
  eventsDay(ctx);
  councilDay(ctx);
  updateTier(ctx);
}

type SettlementCommand = Extract<
  Command,
  {
    type:
      | 'restyle'
      | 'buyTerritory'
      | 'setTax'
      | 'toggleReserve'
      | 'toggleExport'
      | 'decideProposal'
      | 'caravanSell'
      | 'caravanBuy'
      | 'repair'
      | 'treatAnimals'
      | 'specialize'
      | 'renameSettlement';
  }
>;

export const SETTLEMENT_COMMANDS = new Set<Command['type']>([
  'restyle',
  'buyTerritory',
  'setTax',
  'toggleReserve',
  'toggleExport',
  'decideProposal',
  'caravanSell',
  'caravanBuy',
  'repair',
  'treatAnimals',
  'specialize',
  'renameSettlement',
]);

export function settlementCommand(ctx: Ctx, cmd: SettlementCommand): CommandResult {
  switch (cmd.type) {
    case 'restyle':
      return restyle(ctx, cmd.uid, cmd.style);
    case 'buyTerritory':
      return buyTerritory(ctx, cmd.chunk);
    case 'setTax':
      return setTax(ctx, cmd.rate);
    case 'toggleReserve':
      return toggleReserve(ctx, cmd.item);
    case 'toggleExport':
      return toggleExport(ctx, cmd.item);
    case 'decideProposal':
      return decideProposal(ctx, cmd.id, cmd.approve);
    case 'caravanSell':
      return caravanSell(ctx, cmd.key, cmd.qty);
    case 'caravanBuy':
      return caravanBuy(ctx, cmd.item, cmd.qty);
    case 'repair':
      return repair(ctx, cmd.uid);
    case 'treatAnimals':
      return treatAnimals(ctx, cmd.home);
    case 'specialize':
      return specialize(ctx, cmd.id);
    case 'renameSettlement':
      return renameSettlement(ctx, cmd.name);
  }
}

/** Zmiana wyglądu domu (za darmo). */
export function restyle(ctx: Ctx, uid: number, style: number): CommandResult {
  const o = ctx.s.objects.find((x) => x.uid === uid);
  const def = o && ctx.c.buildings[o.type];
  if (!o || !def || !def.styles || def.styles < 2) return fail('invalid');
  if (!Number.isInteger(style) || style < 0 || style >= def.styles) return fail('invalid');
  o.style = style;
  ctx.bus.emit({ type: 'moved', uid, at: { x: o.x + def.size[0] / 2, y: o.y + def.size[1] / 2 } });
  return OK;
}
