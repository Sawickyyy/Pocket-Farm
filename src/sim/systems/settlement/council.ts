// Rada osady (docs/plan-osada.md §13–14): codziennie mieszkańcy zgłaszają propozycje wg warunków z `settlement.json`
// (do 3 otwartych naraz), gracz je zatwierdza albo odrzuca (bony na budowę, polityka podatkowa, festyn, dotacje),
// decyzja zmienia nastrój mieszkańców. Tu też specjalizacja osady (etap 4, ratusz) i zmiana nazwy.

import type { Content, ProposalTpl } from '../../../content/content';
import { DAY_MS } from '../../calendar';
import type { CommandResult } from '../../commands';
import { OK, addItem, countItem, fail, rand, type Ctx } from '../../ctx';
import type { GameState, Proposal, Resident } from '../../types';
import {
  activeEvent,
  addBudget,
  chronicle,
  freeHousing,
  hasService,
  isSettlementDef,
  nextId,
  population,
  professionOf,
  storageCap,
  storageUsed,
} from './common';
import { isConnected } from './roads';
import { tierAllows } from './tiers';

// ---------------------------------------------------------------- stałe

/** Szablon rozstrzygnięty w ciągu tylu ostatnich dni nie wraca (wpisy kroniki `decided`). */
export const DECIDED_COOLDOWN_DAYS = 2;
/** Nastrój po decyzji: zatwierdzenie +0,05, odrzucenie −0,05 (do końca następnej doby). */
export const COUNCIL_MOOD = 0.05;
export const COUNCIL_MOOD_DAYS = 1;
/** Działający ratusz zwiększa zniżkę bonu o 10 pkt proc. */
export const HALL_VOUCHER_BONUS = 0.1;
/** Poparcie: 30–70% populacji (min. 1 osoba). */
export const SUPPORT_MIN = 0.3;
export const SUPPORT_SPREAD = 0.4;
/** Warunek `always` (festyn): szansa 25% dziennie przy populacji ≥ 6. */
export const ALWAYS_CHANCE = 0.25;
export const ALWAYS_MIN_POPULATION = 6;
/** Progi warunków (średnie potrzeb mieszkańców). */
export const HUNGRY_FOOD = 0.5;
export const HUNGRY_VILLAGE_FOOD = 0.6;
export const BORED_FUN = 0.45;
export const UNSAFE_SAFETY = 0.5;
export const UNSAFE_TOWN_SAFETY = 0.55;
export const TAX_UNHAPPY_RATE = 0.1;
export const TAX_UNHAPPY_HAPPINESS = 0.5;
export const STORAGE_FULL_SHARE = 0.9;
export const FEW_TOOLS = 3;
export const MIN_CHILDREN = 3;
export const MIN_DISCONNECTED = 2;
/** Specjalizacja od etapu 4 (miasto). */
export const SPECIALIZE_TIER = 4;
/** Nazwa osady: 1–24 znaki po przycięciu. */
export const NAME_MAX = 24;

// ---------------------------------------------------------------- warunki propozycji

interface CouncilStats {
  pop: number;
  kids: number;
  /** Średnie potrzeb i szczęścia (null = pusta osada). */
  avg: { food: number; fun: number; safety: number; happiness: number } | null;
  types: Set<string>;
}

function councilStats(s: GameState): CouncilStats {
  const list = s.settlement.residents;
  let kids = 0;
  let food = 0;
  let fun = 0;
  let safety = 0;
  let happiness = 0;
  for (const r of list) {
    if (r.child) kids++;
    food += r.needs.food;
    fun += r.needs.fun;
    safety += r.needs.safety;
    happiness += r.happiness;
  }
  const n = list.length;
  const avg = n ? { food: food / n, fun: fun / n, safety: safety / n, happiness: happiness / n } : null;
  return { pop: n, kids, avg, types: new Set(s.objects.map((o) => o.type)) };
}

/** Domy i miejsca pracy osady (do nich chodzą mieszkańcy) bez dostępu do drogi. */
export function disconnectedBuildings(ctx: Ctx): number {
  const { s, c } = ctx;
  let n = 0;
  for (const o of s.objects) {
    const def = c.buildings[o.type];
    if (!def || !isSettlementDef(def) || def.kind === 'bridge' || def.kind === 'path') continue;
    if (def.kind !== 'house' && !def.jobs) continue;
    if (!isConnected(ctx, o.uid)) n++;
  }
  return n;
}

/**
 * Sprawdzanie warunków `when` szablonów propozycji (statystyki liczone raz, drogi – leniwie).
 * Uwaga: `always` losuje (`rand`) przy każdym sprawdzeniu.
 */
export function makeConditions(ctx: Ctx): (when: string) => boolean {
  const { s, c } = ctx;
  const st = s.settlement;
  const stats = councilStats(s);
  const { pop, avg, types } = stats;
  const peak = st.peakTier;
  const has = (type: string): boolean => types.has(type);
  let disconnected: number | undefined;
  return (when) => {
    switch (when) {
      case 'noWell':
        return pop >= 2 && !has('well');
      case 'hungry':
        return !!avg && avg.food < HUNGRY_FOOD;
      case 'hungryVillage':
        return peak >= 2 && !!avg && avg.food < HUNGRY_VILLAGE_FOOD && !has('bakery');
      case 'crowded': {
        if (pop < 3) return false;
        let free = 0;
        for (const v of freeHousing(s, c).values()) free += Math.max(0, v);
        return free === 0;
      }
      case 'storageFull':
        return storageUsed(s) >= STORAGE_FULL_SHARE * storageCap(s, c);
      case 'children':
        return peak >= 2 && stats.kids >= MIN_CHILDREN && !has('school');
      case 'bored':
        return peak >= 2 && !!avg && avg.fun < BORED_FUN && !has('plaza');
      case 'unsafe':
        return !!avg && avg.safety < UNSAFE_SAFETY && !has('lantern');
      case 'unsafeTown':
        return peak >= 3 && !!avg && avg.safety < UNSAFE_TOWN_SAFETY && !has('police');
      case 'epidemic':
        return peak >= 3 && !!activeEvent(s, 'epidemic') && !has('clinic');
      case 'noTrade':
        return peak >= 2 && !has('tradepost');
      case 'taxUnhappy':
        return st.taxRate > TAX_UNHAPPY_RATE && !!avg && avg.happiness < TAX_UNHAPPY_HAPPINESS;
      case 'always':
        return pop >= ALWAYS_MIN_POPULATION && rand(s) < ALWAYS_CHANCE;
      case 'craftsmen':
        return countItem(s, 'tools') < FEW_TOOLS && st.residents.some((r) => professionOf(s, c, r) === 'craftsman');
      case 'disconnected':
        return (disconnected ??= disconnectedBuildings(ctx)) >= MIN_DISCONNECTED;
      default:
        return false;
    }
  };
}

// ---------------------------------------------------------------- propozycje

/** Zniżka z bonu rady na budynek danego typu (0..1). */
export function voucherDiscount(s: GameState, type: string, day: number): number {
  const v = s.settlement.vouchers[type];
  return v && v.untilDay >= day ? v.discount : 0;
}

/** Zniżka bonu przyznanego teraz (40%, z działającym ratuszem 50%). */
export function voucherRate(s: GameState, c: Content): number {
  return Math.min(1, c.settlement.constants.voucherDiscount + (hasService(s, c, 'hall') ? HALL_VOUCHER_BONUS : 0));
}

export const proposalTpl = (c: Content, id: string): ProposalTpl | undefined => c.settlement.proposals.find((p) => p.id === id);

/** Szablony rozstrzygnięte w ostatnich dniach (z kroniki). */
function recentlyDecided(s: GameState, day: number): Set<string> {
  const out = new Set<string>();
  for (const e of s.settlement.chronicle) {
    if (e.kind !== 'decided' || day - e.day > DECIDED_COOLDOWN_DAYS) continue;
    const tpl = e.params?.tpl;
    if (tpl !== undefined) out.add(String(tpl));
  }
  return out;
}

/** Propozycja budowy ma sens: budynek odblokowany, nie ma już unikalnego, nie ma ważnego bonu. */
function buildAllowed(s: GameState, c: Content, tpl: ProposalTpl, types: Set<string>, day: number): boolean {
  const def = tpl.building ? c.buildings[tpl.building] : undefined;
  if (!def || !tierAllows(s.settlement.peakTier, def.tier)) return false;
  if (def.unique && types.has(def.id)) return false;
  return voucherDiscount(s, def.id, day) <= 0;
}

function shuffled<T>(s: GameState, list: readonly T[]): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

/** Usuwa wygasłe propozycje i bony. */
function expire(s: GameState, day: number): void {
  const st = s.settlement;
  st.proposals = st.proposals.filter((p) => p.expiresDay >= day);
  for (const type of Object.keys(st.vouchers)) if (st.vouchers[type]!.untilDay < day) delete st.vouchers[type];
}

/** Raz na dobę: wygasanie propozycji i bonów, nowe propozycje wg warunków (emituje `proposal`). */
export function councilDay(ctx: Ctx): void {
  const { s, c } = ctx;
  const st = s.settlement;
  if (st.peakTier < 1) return;
  const day = ctx.cal.day;
  expire(s, day);
  const k = c.settlement.constants;
  if (st.proposals.length >= k.maxProposals) return;
  const cond = makeConditions(ctx);
  const decided = recentlyDecided(s, day);
  const types = new Set(s.objects.map((o) => o.type));
  const pop = population(s);
  while (st.proposals.length < k.maxProposals) {
    let chosen: ProposalTpl | undefined;
    for (const tpl of shuffled(s, c.settlement.proposals)) {
      if (decided.has(tpl.id) || st.proposals.some((p) => p.tpl === tpl.id)) continue;
      if (tpl.kind === 'build' && !buildAllowed(s, c, tpl, types, day)) continue;
      if (cond(tpl.when)) {
        chosen = tpl;
        break;
      }
    }
    if (!chosen) return;
    const p: Proposal = {
      id: nextId(s),
      tpl: chosen.id,
      support: Math.max(1, Math.round(pop * (SUPPORT_MIN + rand(s) * SUPPORT_SPREAD))),
      cost: chosen.kind === 'event' || chosen.kind === 'grant' ? Math.max(0, chosen.cost ?? 0) : 0,
      expiresDay: day + k.proposalDays,
    };
    st.proposals.push(p);
    ctx.bus.emit({ type: 'proposal', id: p.id, tpl: p.tpl });
    chronicle(ctx, 'proposal', { tpl: p.tpl });
  }
}

/** Skutek zatwierdzonej propozycji (koszt już pobrany). */
function applyProposal(ctx: Ctx, tpl: ProposalTpl): void {
  const { s, c } = ctx;
  const st = s.settlement;
  const k = c.settlement.constants;
  switch (tpl.kind) {
    case 'build':
      if (tpl.building) st.vouchers[tpl.building] = { discount: voucherRate(s, c), untilDay: ctx.cal.day + k.voucherDays };
      break;
    case 'policy': {
      const rate = Math.round((st.taxRate + (tpl.value ?? 0)) * 1000) / 1000;
      st.taxRate = Math.max(0, Math.min(k.taxMax, rate));
      break;
    }
    case 'event': {
      // Festyn: trwający przedłużamy zamiast dublować.
      const until = s.clock.simMs + Math.max(0, tpl.days ?? 1) * DAY_MS;
      const cur = activeEvent(s, 'festival');
      if (cur) cur.untilMs = Math.max(cur.untilMs, until);
      else st.events.push({ id: nextId(s), kind: 'festival', untilMs: until });
      break;
    }
    case 'grant':
      if (tpl.item && (tpl.qty ?? 0) > 0) addItem(s, tpl.item, tpl.qty!);
      break;
  }
}

/** Nastrój po decyzji rady; silniejszy trwający nastrój (np. strajk) zostaje. */
function setMood(r: Resident, value: number, untilDay: number, day: number): void {
  const cur = r.mood;
  if (cur.untilDay >= day && Math.abs(cur.value) > Math.abs(value)) return;
  r.mood = { value, untilDay };
}

export function decideProposal(ctx: Ctx, id: number, approve: boolean): CommandResult {
  const { s, c } = ctx;
  const st = s.settlement;
  const day = ctx.cal.day;
  const i = st.proposals.findIndex((p) => p.id === id);
  const p = st.proposals[i];
  if (!p) return fail('invalid');
  if (p.expiresDay < day) return fail('expired');
  const yes = approve === true;
  const tpl = proposalTpl(c, p.tpl);
  if (yes) {
    if (p.cost > 0) {
      if (s.coins < p.cost) return fail('no-coins');
      s.coins -= p.cost;
      addBudget(ctx, 'investments', p.cost);
    }
    if (tpl) applyProposal(ctx, tpl);
  }
  const mood = yes ? COUNCIL_MOOD : -COUNCIL_MOOD;
  for (const r of st.residents) setMood(r, mood, day + COUNCIL_MOOD_DAYS, day);
  st.proposals.splice(i, 1);
  ctx.bus.emit({ type: 'decided', id: p.id, tpl: p.tpl, approve: yes });
  chronicle(ctx, 'decided', { tpl: p.tpl, approve: yes ? 1 : 0 });
  return OK;
}

// ---------------------------------------------------------------- specjalizacja i nazwa

/** Czy można teraz wybrać specjalizację (null = tak, inaczej powód). */
export function specializeBlock(s: GameState, c: Content): 'tier-too-low' | 'already-chosen' | 'needs-townhall' | null {
  if (s.settlement.peakTier < SPECIALIZE_TIER) return 'tier-too-low';
  if (s.settlement.specialization !== null) return 'already-chosen';
  if (!hasService(s, c, 'hall')) return 'needs-townhall';
  return null;
}

/** Specjalizacja osady – raz na grę (etap 4, działający ratusz). */
export function specialize(ctx: Ctx, id: string): CommandResult {
  const { s, c } = ctx;
  const block = specializeBlock(s, c);
  if (block) return fail(block);
  if (!c.settlement.specializations.some((x) => x.id === id)) return fail('invalid');
  s.settlement.specialization = id;
  ctx.bus.emit({ type: 'specialized', id });
  chronicle(ctx, 'specialized', { id });
  return OK;
}

/** Nazwa po oczyszczeniu: bez znaków sterujących i niewidocznych, przycięta, 1–24 znaki (null = niepoprawna). */
export function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const clean = name.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  const len = [...clean].length;
  return len >= 1 && len <= NAME_MAX ? clean : null;
}

export function renameSettlement(ctx: Ctx, name: string): CommandResult {
  const clean = cleanName(name);
  if (clean === null) return fail('invalid');
  if (ctx.s.settlement.name === clean) return OK;
  ctx.s.settlement.name = clean;
  chronicle(ctx, 'renamed', { name: clean });
  return OK;
}
