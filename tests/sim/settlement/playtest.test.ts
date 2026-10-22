// Symulowana rozgrywka osady: prosty „gracz-bot” buduje według etapów przez 40 dni gry (docs/plan-osada.md §1).
// Test pilnuje balansu (osada rośnie, budżet i szczęście nie zapadają się, stan bez NaN). Raport dzienny:
// PLAYTEST_REPORT=1 npx vitest run tests/sim/settlement/playtest.test.ts

import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/content';
import type { Command } from '../../../src/sim/commands';
import { canPlace } from '../../../src/sim/systems/building';
import { adults, budgetNet, children, freeHousing, objectsOfKind, population, storageCap, storageUsed, tierOf } from '../../../src/sim/systems/settlement/common';
import { averageHappiness, foodStock } from '../../../src/sim/systems/settlement/needs';
import { roadTiles } from '../../../src/sim/systems/settlement/roads';
import { buyableChunks, chunkRect, territoryCost } from '../../../src/sim/systems/settlement/territory';
import type { Simulation } from '../../../src/sim/simulation';
import type { GameState } from '../../../src/sim/types';
import { FIELD, MAP_W, generateWorld, tileIndex, type WorldMap } from '../../../src/sim/world';
import { HOUR_MS, makeSim } from '../helpers';
import { addResident } from './helpers';

const c = CONTENT;
const CENTER = { x: FIELD.x + FIELD.w / 2, y: FIELD.y + FIELD.h / 2 };
/** Dochód z farmy na dobę (gracz sprzedaje plony) i drewno z wycinki, zanim powstanie chata drwala. */
const FARM_INCOME = 260;
const FARM_WOOD = 8;

interface DayLog {
  day: number;
  tier: string;
  pop: string;
  free: number;
  unemployed: number;
  happy: number;
  food: number;
  coins: number;
  net: number;
  money: string;
  storage: string;
  events: string;
  built: string[];
}

const count = (s: GameState, type: string) => s.objects.filter((o) => o.type === type).length;

class Bot {
  readonly world: WorldMap;
  readonly log: DayLog[] = [];
  private built: string[] = [];
  private spine = false;
  private jobTurn = 0;

  constructor(readonly sim: Simulation) {
    this.world = generateWorld(sim.state.seed);
  }

  get s(): GameState {
    return this.sim.state;
  }

  private send(cmd: Command): boolean {
    return this.sim.dispatch(cmd).ok;
  }

  /** Wolne miejsce najbliżej środka osady; przy drogach preferuje kafle przylegające do drogi. */
  private spot(type: string): { x: number; y: number } | null {
    const def = c.buildings[type]!;
    const [w, h] = def.size;
    const roads = roadTiles(this.s, c, this.world);
    const nearRoad = (x: number, y: number) => {
      for (let dx = -1; dx <= w; dx++) {
        for (let dy = -1; dy <= h; dy++) {
          const inside = dx >= 0 && dx < w && dy >= 0 && dy < h;
          const corner = (dx === -1 || dx === w) && (dy === -1 || dy === h);
          const tx = x + dx;
          const ty = y + dy;
          if (inside || corner || tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_W) continue;
          if (roads[tileIndex(tx, ty)]) return true;
        }
      }
      return false;
    };
    let best: { x: number; y: number; d: number } | null = null;
    for (const chunk of this.s.settlement.territory) {
      const r = chunkRect(chunk);
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (!canPlace(this.s, c, type, x, y, -1, this.world).ok) continue;
          let d = Math.abs(x + w / 2 - CENTER.x) + Math.abs(y + h / 2 - CENTER.y);
          if (this.spine && def.kind !== 'path' && !nearRoad(x, y)) d += 40;
          if (!best || d < best.d) best = { x, y, d };
        }
      }
    }
    return best;
  }

  private build(type: string, style?: number): boolean {
    const p = this.spot(type);
    if (!p) return false;
    const cmd: Command = style === undefined ? { type: 'place', building: type, x: p.x, y: p.y } : { type: 'place', building: type, x: p.x, y: p.y, style };
    if (!this.send(cmd)) return false;
    this.built.push(type);
    if (this.spine && c.buildings[type]!.kind !== 'path') this.connect(this.s.nextUid - 1);
    return true;
  }

  /** Dociąga drogę od budynku do najbliższej istniejącej drogi (BFS po wolnych kaflach terenu osady). */
  private connect(uid: number): void {
    const o = this.s.objects.find((v) => v.uid === uid);
    if (!o) return;
    const [w, h] = c.buildings[o.type]!.size;
    const roads = roadTiles(this.s, c, this.world);
    const prev = new Map<number, number>();
    const queue: number[] = [];
    for (let dx = -1; dx <= w; dx++) {
      for (let dy = -1; dy <= h; dy++) {
        const edge = (dx === -1 || dx === w) !== (dy === -1 || dy === h);
        const x = o.x + dx;
        const y = o.y + dy;
        if (!edge || x < 0 || y < 0 || x >= MAP_W || y >= MAP_W) continue;
        const i = tileIndex(x, y);
        if (roads[i]) return; // już przy drodze
        if (canPlace(this.s, c, 'road', x, y, -1, this.world).ok) {
          prev.set(i, -1);
          queue.push(i);
        }
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q]!;
      const x = i % MAP_W;
      const y = Math.floor(i / MAP_W);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_W) continue;
        const j = tileIndex(nx, ny);
        if (prev.has(j)) continue;
        if (roads[j]) {
          // Znaleziono sieć: stawiamy drogę wzdłuż ścieżki.
          for (let k = i; k !== -1; k = prev.get(k)!) this.send({ type: 'place', building: 'road', x: k % MAP_W, y: Math.floor(k / MAP_W) });
          return;
        }
        if (!canPlace(this.s, c, 'road', nx, ny, -1, this.world).ok) continue;
        prev.set(j, i);
        queue.push(j);
      }
    }
  }

  private affordable(type: string, reserve = 150): boolean {
    const def = c.buildings[type]!;
    if ((def.tier ?? 0) > this.s.settlement.peakTier) return false;
    if (def.unique && count(this.s, type) > 0) return false;
    if (def.materials?.some((m) => (this.s.inventory[m.item] ?? 0) < m.qty)) return false;
    return this.s.coins - def.cost >= reserve;
  }

  /** Kręgosłup dróg: wiersz nad polem i kolumna po lewej (od etapu 1). */
  private layRoads(): void {
    const ys = [FIELD.y - 3];
    const xs = [FIELD.x - 3];
    for (const chunk of this.s.settlement.territory) {
      const r = chunkRect(chunk);
      for (const y of ys) for (let x = r.x; x < r.x + r.w; x++) if (canPlace(this.s, c, 'road', x, y, -1, this.world).ok && this.s.coins > 200) this.send({ type: 'place', building: 'road', x, y });
      for (const x of xs) for (let y = r.y; y < r.y + r.h; y++) if (canPlace(this.s, c, 'road', x, y, -1, this.world).ok && this.s.coins > 200) this.send({ type: 'place', building: 'road', x, y });
    }
    this.spine = true;
    for (const o of [...this.s.objects]) if (c.buildings[o.type]!.kind !== 'path') this.connect(o.uid);
  }

  /** Decyzje gracza raz na dobę (rano). */
  act(): void {
    const s = this.s;
    const st = s.settlement;
    const tier = st.peakTier;
    const pop = population(s);
    const free = [...freeHousing(s, c).values()].reduce((a, b) => a + Math.max(0, b), 0);
    const sites = Object.values(st.sites).filter((x) => x.built < 1).length;

    // Rada: przyjmij propozycje, na które stać; naprawy awarii i uszkodzeń.
    for (const p of [...st.proposals]) this.send({ type: 'decideProposal', id: p.id, approve: s.coins > p.cost + 400 });
    for (const [uid, site] of Object.entries(st.sites)) if ((site.broken || site.damage > 0) && site.fire <= 0 && s.coins > 600) this.send({ type: 'repair', uid: Number(uid) });

    if (tier >= 1 && !this.spine) this.layRoads();
    if (!count(s, 'well') && this.affordable('well', 0)) this.build('well');

    // Mieszkania: zawsze mały zapas wolnych miejsc.
    if (free < 3 && sites < 3) {
      const order = ['manor', 'townhouse', 'house', 'hut', 'tent'];
      for (const type of order) {
        if (this.affordable(type, 100) && this.build(type, this.built.length % (c.buildings[type]!.styles ?? 1))) break;
      }
    }
    // Jedzenie: pole osady na ~7 dorosłych i zapas na 3 posiłki na osobę.
    const fields = count(s, 'allotment');
    if ((fields * 7 < adults(s).length + 2 || foodStock(s, c) < pop * 3) && fields < 1 + pop / 6 && this.affordable('allotment')) this.build('allotment');

    const wants: [string, boolean][] = [
      ['builders', tier >= 1 && !count(s, 'builders')],
      ['lumber', tier >= 1 && count(s, 'lumber') < 1 + Math.floor(pop / 40) && (s.inventory.wood ?? 0) < 120],
      ['fishery', tier >= 1 && count(s, 'fishery') < Math.floor(pop / 25)],
      ['warehouse', tier >= 1 && storageUsed(s) > storageCap(s, c) * 0.75],
      ['shop', tier >= 2 && count(s, 'shop') < 1 + Math.floor(pop / 45)],
      ['townhall', tier >= 2],
      ['tradepost', tier >= 2],
      ['sawmill', tier >= 2 && !count(s, 'sawmill')],
      ['tavern', tier >= 2 && !count(s, 'tavern')],
      ['school', tier >= 2 && !count(s, 'school') && children(s).length > 0],
      ['mill', tier >= 2 && !count(s, 'mill')],
      ['grainfield', tier >= 2 && count(s, 'mill') > 0 && count(s, 'grainfield') < 1 + Math.floor(pop / 60)],
      ['bakery', tier >= 2 && count(s, 'mill') > 0 && !count(s, 'bakery')],
      ['plaza', tier >= 2 && !count(s, 'plaza') && pop > 25],
      ['workshop', tier >= 2 && !count(s, 'workshop') && count(s, 'sawmill') > 0],
      ['police', tier >= 3 && !count(s, 'police')],
      ['clinic', tier >= 3 && !count(s, 'clinic')],
      ['firestation', tier >= 3 && !count(s, 'firestation')],
      ['depot', tier >= 3],
    ];
    for (const [type, want] of wants) if (want && sites < 4 && this.affordable(type, 300)) this.build(type);

    // Praca: przy bezrobociu dokładaj miejsca pracy (po kolei z dostępnych).
    const idle = adults(s).filter((r) => r.job === null && r.home !== null).length;
    if (idle > 2 && sites < 4) {
      const jobs = ['allotment', 'fishery', 'lumber', 'grainfield', 'sawmill', 'workshop', 'shop', 'tavern', 'school', 'clinic', 'police'];
      for (let k = 0; k < jobs.length; k++) {
        const type = jobs[(this.jobTurn + k) % jobs.length]!;
        if (this.affordable(type, 300) && this.build(type)) {
          this.jobTurn += k + 1;
          break;
        }
      }
    }

    // Teren: dokup, gdy brakuje miejsca na dom 2×2.
    if (!this.spot('house') || free < 1) {
      const chunks = buyableChunks(s, c);
      const cost = territoryCost(c, st.bought);
      if (chunks.length && s.coins > cost + 400) {
        const near = [...chunks].sort((a, b) => dist(a) - dist(b))[0]!;
        if (this.send({ type: 'buyTerritory', chunk: near })) {
          this.built.push(`chunk${near}`);
          this.spine = false;
        }
      }
    }
  }

  record(): void {
    const s = this.s;
    const st = s.settlement;
    const pop = population(s);
    const workers = adults(s);
    this.log.push({
      day: Math.floor(s.clock.simMs / (24 * HOUR_MS)),
      tier: c.settlement.tiers[st.peakTier]!.id,
      pop: `${workers.length}+${children(s).length}`,
      free: [...freeHousing(s, c).values()].reduce((a, b) => a + Math.max(0, b), 0),
      unemployed: workers.filter((r) => r.job === null).length,
      happy: Math.round(averageHappiness(s) * 100) / 100,
      food: Math.round(foodStock(s, c)),
      coins: Math.round(s.coins),
      net: st.budget[0] ? Math.round(budgetNet(st.budget[0])) : 0,
      money: st.budget[0] ? (['taxes', 'sales', 'exports', 'wages', 'upkeep', 'imports', 'investments'] as const).map((k) => `${k[0]}${Math.round(st.budget[0]![k])}`).join(' ') : '',
      storage: `${storageUsed(s)}/${storageCap(s, c)}`,
      events: st.events.map((e) => e.kind).join(','),
      built: this.built,
    });
    this.built = [];
    expect(Number.isFinite(pop) && Number.isFinite(s.coins) && Number.isFinite(averageHappiness(s) || 0)).toBe(true);
    void tierOf;
    void objectsOfKind;
  }
}

const dist = (chunk: number) => {
  const r = chunkRect(chunk);
  return Math.abs(r.x + r.w / 2 - CENTER.x) + Math.abs(r.y + r.h / 2 - CENTER.y);
};

function play(seed: number, days: number): Bot {
  const sim = makeSim((s) => {
    s.coins = 2500;
    s.xp = 4000;
    s.inventory.wood = 40;
    s.inventory.radish = 20;
  }, seed);
  const bot = new Bot(sim);
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      const hour = Math.floor((sim.state.clock.simMs % (24 * HOUR_MS)) / HOUR_MS);
      if (hour === 8) bot.act();
      if (hour === 20) {
        // Dochód z farmy gracza (sprzedaż plonów) i drewno z wycinki.
        sim.state.coins += FARM_INCOME;
        sim.state.inventory.wood = (sim.state.inventory.wood ?? 0) + FARM_WOOD;
        bot.record();
      }
      sim.advance(HOUR_MS);
    }
  }
  return bot;
}

describe('osada: symulowana rozgrywka', () => {
  it.skipIf(!process.env.PLAYTEST_DIAG)('diagnoza', () => {
    const bot = play(7, Number(process.env.PLAYTEST_DIAG));
    const s = bot.s;
    for (const o of s.objects) {
      const def = c.buildings[o.type]!;
      const site = s.settlement.sites[String(o.uid)];
      const workers = s.settlement.residents.filter((r) => r.job === o.uid).length;
      const homes = s.settlement.residents.filter((r) => r.home === o.uid).length;
      console.log(o.uid, o.type, o.x, o.y, 'built', site?.built, 'prog', site?.progress?.toFixed(2), 'workers', workers, '/', def.jobs?.slots ?? 0, 'res', homes);
    }
    for (const r of s.settlement.residents) console.log(r.id, r.name, r.child ? 'child' : 'adult', 'home', r.home, 'job', r.job, 'needs', JSON.stringify(Object.fromEntries(Object.entries(r.needs).map(([k, v]) => [k, Math.round(v * 100) / 100]))), 'h', r.happiness.toFixed(2), 'meals', JSON.stringify(r.meals));
    console.log(JSON.stringify(s.inventory));
    const free = freeHousing(s, c);
    for (const r of s.settlement.relations.filter((x) => x.kind === 'partner')) {
      const a = s.settlement.residents.find((x) => x.id === r.a);
      const b = s.settlement.residents.find((x) => x.id === r.b);
      console.log('para', r.a, r.b, a?.home, b?.home, 'wolne', a?.home != null ? free.get(a.home) : '-');
    }
  });

  it('bot rozwija osadę przez 40 dni: rośnie, awansuje i nie bankrutuje', () => {
    const bot = play(7, 40);
    if (process.env.PLAYTEST_REPORT) {
      console.log(bot.log.map((l) => `${String(l.day).padStart(3)} ${l.tier.padEnd(7)} pop ${l.pop.padEnd(7)} wolne ${String(l.free).padStart(2)} bezrob ${String(l.unemployed).padStart(2)} szczęście ${l.happy.toFixed(2)} jedzenie ${String(l.food).padStart(4)} monety ${String(l.coins).padStart(6)} bilans ${String(l.net).padStart(5)} [${l.money}] magazyn ${l.storage.padEnd(9)} ${l.events} ${l.built.join(' ')}`).join('\n'));
      console.log(JSON.stringify(bot.s.settlement.stats), bot.s.settlement.chronicle.slice(0, 12).map((e) => `${e.day}:${e.kind}`).join(' '));
    }
    const last = bot.log[bot.log.length - 1]!;
    expect(population(bot.s)).toBeGreaterThanOrEqual(40);
    expect(bot.s.settlement.peakTier).toBeGreaterThanOrEqual(3);
    expect(last.happy).toBeGreaterThan(0.5);
    expect(last.unemployed / adults(bot.s).length).toBeLessThan(0.4);
    expect(bot.log.filter((l) => l.food === 0).length).toBeLessThanOrEqual(3);
    expect(bot.s.coins).toBeGreaterThan(0);
  });

  it.each([1, 2, 3, 4])('inne ziarno (%i): osada staje się wioską i nie głoduje', (seed) => {
    const bot = play(seed, 30);
    const last = bot.log[bot.log.length - 1]!;
    if (process.env.PLAYTEST_REPORT) console.log(seed, JSON.stringify(last), JSON.stringify(bot.s.settlement.stats));
    expect(bot.s.settlement.peakTier).toBeGreaterThanOrEqual(2);
    expect(last.happy).toBeGreaterThan(0.5);
    expect(bot.log.filter((l) => l.food === 0).length).toBeLessThanOrEqual(3);
    expect(bot.s.coins).toBeGreaterThan(0);
  });

  it('wydajność: godzina gry dużej osady mieści się w budżecie', () => {
    const bot = play(7, 40);
    const sim = bot.sim;
    // Dodatkowi mieszkańcy do ~200 (wolne miejsca nie są potrzebne – mierzymy koszt systemów).
    const homes = sim.state.objects.filter((o) => c.buildings[o.type]!.kind === 'house');
    const jobs = sim.state.objects.filter((o) => c.buildings[o.type]!.jobs);
    for (let i = population(sim.state); i < 200; i++) addResident(sim.state, { home: homes[i % homes.length]!.uid, job: i % 3 ? null : jobs[i % jobs.length]!.uid, happiness: 0.6 });
    const t0 = performance.now();
    for (let h = 0; h < 48; h++) sim.advance(HOUR_MS);
    const perHour = (performance.now() - t0) / 48;
    if (process.env.PLAYTEST_REPORT) console.log('ms/godz.', perHour.toFixed(2), 'mieszkańców', population(sim.state), 'obiektów', sim.state.objects.length);
    expect(perHour).toBeLessThan(12);
  });
});

