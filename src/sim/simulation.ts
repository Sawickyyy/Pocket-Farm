// Deterministyczna symulacja: stały krok (10 min gry), rozliczenie dnia, komendy gracza i nadrabianie offline.
// Działa w Web Workerze (sim/worker.ts), a w testach – bezpośrednio.

import { CONTENT, parseKey, type Content } from '../content/content';
import { EventBus } from '../core/eventBus';
import { HOUR_MS, MAX_CATCHUP_MS, STEP_MS, calendarAt } from './calendar';
import type { Command, CommandResult } from './commands';
import { OK, addXp, fail, levelOf, makeCtx, type Ctx } from './ctx';
import type { SimEvent } from './events';
import { START_UNLOCKED } from './initialState';
import * as animals from './systems/animals';
import * as building from './systems/building';
import * as exploration from './systems/exploration';
import * as fields from './systems/fields';
import * as market from './systems/market';
import * as processing from './systems/processing';
import * as progress from './systems/progress';
import * as skills from './systems/skills';
import * as tutorial from './systems/tutorial';
import * as village from './systems/village';
import type { GameState } from './types';
import { CHUNKS_X, CHUNKS_Y } from './world';

export interface CatchUpReport {
  simulatedMs: number;
  days: number;
  harvestReady: number;
  animalProducts: number;
  crafted: number;
  withered: number;
  capped: boolean;
}

export class Simulation {
  readonly bus = new EventBus<SimEvent>();
  private outbox: SimEvent[] = [];
  private ctx: Ctx;
  /** Wyciszenie skrzynki zdarzeń podczas nadrabiania offline (bez efektów dla setek zdarzeń). */
  private muted = false;

  constructor(
    public state: GameState,
    private readonly content: Content = CONTENT,
  ) {
    this.ctx = this.makeCtx();
    this.bus.onAny((e) => {
      if (!this.muted) this.outbox.push(e);
      progress.onProgressEvent(this.ctx, e);
      tutorial.onTutorialEvent(this.ctx, e);
    });
    if (state.lastDay < 0) this.newDay();
  }

  private makeCtx(): Ctx {
    return makeCtx(this.state, this.bus, calendarAt(this.state.clock.simMs, this.state.seed), this.content);
  }

  get calendar() {
    return this.ctx.cal;
  }

  takeEvents(): SimEvent[] {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  replaceState(state: GameState): void {
    this.state = state;
    this.ctx = this.makeCtx();
    if (state.lastDay < 0) this.newDay();
    this.bus.emit({ type: 'stateReplaced' });
  }

  // ---------------------------------------------------------------- czas

  /** Przesuwa symulację o `ms` czasu gry (stałe kroki + reszta w akumulatorze). */
  advance(ms: number): void {
    const clock = this.state.clock;
    clock.accMs += Math.max(0, ms);
    while (clock.accMs >= STEP_MS) {
      clock.accMs -= STEP_MS;
      this.step();
    }
  }

  private step(): void {
    const s = this.state;
    s.clock.simMs += STEP_MS;
    this.ctx = this.makeCtx();
    if (this.ctx.cal.day !== s.lastDay) this.newDay();
    fields.updateFields(this.ctx, STEP_MS);
    animals.updateAnimals(this.ctx, STEP_MS);
    processing.updateProcessing(this.ctx, STEP_MS);
    market.updateMarket(this.ctx, STEP_MS);
  }

  private newDay(): void {
    const s = this.state;
    const ctx = this.ctx;
    const firstDay = s.lastDay < 0;
    s.lastDay = ctx.cal.day;
    if (!firstDay && ctx.cal.dayOfSeason === 0) this.bus.emit({ type: 'season', season: ctx.cal.season });
    fields.fieldsNewDay(ctx);
    market.marketNewDay(ctx);
    village.generateOrders(ctx);
    progress.questsNewDay(ctx);
    this.bus.emit({ type: 'newDay', day: ctx.cal.day, weather: ctx.cal.weather });
  }

  /** Tick w czasie rzeczywistym (z mnożnikiem debugowania). */
  tick(realNow: number): void {
    const clock = this.state.clock;
    if (!clock.lastRealMs) clock.lastRealMs = realNow;
    const dt = Math.min(MAX_CATCHUP_MS, Math.max(0, realNow - clock.lastRealMs));
    clock.lastRealMs = realNow;
    this.advance(dt * clock.timeScale);
  }

  /** Nadrabia czas nieobecności krok po kroku (limit 24 h) i zwraca podsumowanie. */
  catchUp(realNow: number): CatchUpReport | null {
    const clock = this.state.clock;
    if (!clock.lastRealMs) {
      clock.lastRealMs = realNow;
      return null;
    }
    const away = Math.max(0, realNow - clock.lastRealMs);
    const dt = Math.min(MAX_CATCHUP_MS, away);
    clock.lastRealMs = realNow;
    if (dt < STEP_MS) {
      this.advance(dt);
      return null;
    }
    const counts = { animalReady: 0, crafted: 0, withered: 0, newDay: 0 };
    const off = this.bus.onAny((e) => {
      if (e.type in counts) counts[e.type as keyof typeof counts]++;
    });
    this.muted = true;
    this.advance(dt);
    this.muted = false;
    off();
    return {
      simulatedMs: dt,
      days: counts.newDay,
      harvestReady: this.state.plots.filter((p) => fields.isReady(p.crop)).length,
      animalProducts: this.state.animals.filter((a) => a.ready).length,
      crafted: counts.crafted,
      withered: counts.withered,
      capped: away > MAX_CATCHUP_MS,
    };
  }

  // ---------------------------------------------------------------- komendy

  dispatch(cmd: Command): CommandResult {
    this.ctx = this.makeCtx();
    const ctx = this.ctx;
    const s = this.state;
    const c = this.content;
    switch (cmd.type) {
      case 'selectTool':
        s.tool = cmd.tool;
        this.bus.emit({ type: 'toolSelected', tool: cmd.tool });
        return OK;
      case 'selectSeed':
        if (!c.crop[cmd.crop]) return fail('invalid');
        s.selectedSeed = cmd.crop;
        s.tool = 'seeds';
        this.bus.emit({ type: 'toolSelected', tool: 'seeds' });
        return OK;
      case 'selectFertilizer':
        if (c.items[cmd.item]?.kind !== 'fertilizer') return fail('invalid');
        s.selectedFertilizer = cmd.item;
        s.tool = 'fertilizer';
        this.bus.emit({ type: 'toolSelected', tool: 'fertilizer' });
        return OK;
      case 'useTool':
        return fields.useTool(ctx, cmd.plot, !cmd.silent);
      case 'unlockPlot':
        return fields.unlockPlot(ctx, cmd.plot, START_UNLOCKED.length);
      case 'buySeeds': {
        const def = c.crop[cmd.crop];
        if (!def || !Number.isInteger(cmd.qty) || cmd.qty <= 0) return fail('invalid');
        if (levelOf(s.xp) < def.level) return fail('level-too-low');
        const cost = def.seed * cmd.qty;
        if (s.coins < cost) return fail('no-coins');
        s.coins -= cost;
        s.seeds[cmd.crop] = (s.seeds[cmd.crop] ?? 0) + cmd.qty;
        this.bus.emit({ type: 'bought', item: `seed:${cmd.crop}`, qty: cmd.qty, cost });
        return OK;
      }
      case 'buyItem': {
        const price = market.buyPrice(ctx, cmd.item);
        if (price === null || !Number.isInteger(cmd.qty) || cmd.qty <= 0) return fail('invalid');
        const cost = price * cmd.qty;
        if (s.coins < cost) return fail('no-coins');
        s.coins -= cost;
        s.inventory[cmd.item] = (s.inventory[cmd.item] ?? 0) + cmd.qty;
        this.bus.emit({ type: 'bought', item: cmd.item, qty: cmd.qty, cost });
        return OK;
      }
      case 'sell':
        return market.sell(ctx, cmd.key, cmd.qty);
      case 'sellAll':
        return market.sellAll(ctx);
      case 'place':
        return building.place(ctx, cmd.building, cmd.x, cmd.y);
      case 'move':
        return building.move(ctx, cmd.uid, cmd.x, cmd.y);
      case 'remove':
        return building.remove(ctx, cmd.uid);
      case 'buyAnimal':
        return animals.buyAnimal(ctx, cmd.kind, cmd.home);
      case 'feedAnimal':
        return animals.feedAnimal(ctx, cmd.id);
      case 'feedAll':
        return animals.forAllInHome(ctx, cmd.home, animals.feedAnimal);
      case 'petAnimal':
        return animals.petAnimal(ctx, cmd.id);
      case 'collectAnimal':
        return animals.collectAnimal(ctx, cmd.id);
      case 'collectAll':
        return animals.forAllInHome(ctx, cmd.home, animals.collectAnimal);
      case 'queueRecipe':
        return processing.queueRecipe(ctx, cmd.uid, cmd.recipe);
      case 'collectOutput':
        return processing.collectOutput(ctx, cmd.uid);
      case 'deliverOrder':
        return village.deliverOrder(ctx, cmd.id);
      case 'gift':
        return village.gift(ctx, cmd.npc, cmd.key);
      case 'unlockSkill':
        return skills.unlockSkill(ctx, cmd.id);
      case 'claimQuest':
        return progress.claimQuest(ctx, cmd.id);
      case 'festivalDeliver':
        return progress.festivalDeliver(ctx);
      case 'explore':
        return exploration.explore(ctx, cmd.chunk);
      case 'forage':
        return exploration.forage(ctx, cmd.tile);
      case 'castLine':
        return exploration.castLine(ctx, cmd.tile);
      case 'reelIn':
        return exploration.reelIn(ctx, cmd.score);
      case 'tutorial':
        return tutorial.tutorialCommand(ctx, cmd.action);
      case 'settings':
        s.settings = { ...s.settings, ...cmd.patch };
        return OK;
      case 'debug':
        return this.debug(cmd.op, cmd.value);
    }
  }

  private debug(op: Extract<Command, { type: 'debug' }>['op'], value: number): CommandResult {
    const s = this.state;
    switch (op) {
      case 'coins':
        s.coins += value;
        break;
      case 'xp':
        addXp(this.ctx, value);
        break;
      case 'skipHours':
        this.advance(value * HOUR_MS);
        break;
      case 'timeScale':
        s.clock.timeScale = Math.max(0, Math.min(1000, value));
        break;
      case 'revealAll':
        s.world.revealed = Array.from({ length: CHUNKS_X * CHUNKS_Y }, (_, i) => i);
        break;
      case 'growAll':
        for (const p of s.plots) if (p.crop && !p.crop.withered) p.crop.growth = 1;
        break;
    }
    return OK;
  }
}

/** Przedmioty z ekwipunku pogrupowane do UI. */
export function inventoryEntries(s: GameState, c: Content = CONTENT) {
  return Object.entries(s.inventory)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => ({ key, n, ...parseKey(key), def: c.items[parseKey(key).id] }))
    .filter((e) => e.def);
}
