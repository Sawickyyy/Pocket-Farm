// Pola uprawne: orka, siew, podlewanie, nawożenie, wzrost (gleba × wilgoć × pora × sezon), jakość plonów, płodozmian.

import type { Quality } from '../../content/content';
import { HOUR_MS } from '../calendar';
import type { CommandResult } from '../commands';
import { OK, addItem, addXp, consumeItem, countItem, fail, mod, rand, stat, type Ctx } from '../ctx';
import type { CropState, GameState, Plot } from '../types';
import { FIELD, plotTile } from '../world';

/** Wysychanie: pełna wilgotność znika po 12 h gry przy słońcu. */
export const DRY_PER_HOUR = 1 / 12;
/** Naturalna regeneracja żyzności ugoru na dobę i jej limit. */
export const FALLOW_REGEN = 0.04;
export const FALLOW_CAP = 0.8;

export const growthRate = (fertility: number): number => 0.6 + 0.8 * fertility;

export function cropStage(crop: CropState): number {
  if (crop.growth >= 1) return 3;
  return Math.min(2, Math.floor(crop.growth * 3));
}

export const isReady = (crop: CropState | null): boolean => !!crop && !crop.withered && crop.growth >= 1;

/** Jakość plonu 0..1 → zwykła/srebrna/złota. */
export function qualityScore(ctx: Ctx, plot: Plot, crop: CropState): number {
  const wet = crop.aliveMs > 0 ? crop.wetMs / crop.aliveMs : 0;
  const weather = crop.aliveMs > 0 ? crop.weatherSum / crop.aliveMs : 0.75;
  return 0.45 * plot.fertility + 0.35 * wet + 0.2 * weather + mod(ctx.s, ctx.c, 'cropQuality');
}

export function qualityTier(score: number): Quality {
  if (score >= 0.85) return 2;
  if (score >= 0.65) return 1;
  return 0;
}

/**
 * Szacowany czas (ms gry = ms rzeczywiste przy 1×) do dojrzenia przy obecnej żyzności, o ile gleba nie wyschnie.
 * null = roślina nie rośnie (sucha gleba, zwiędła) albo już gotowa.
 */
export function cropEtaMs(ctx: Ctx, plot: Plot): number | null {
  const crop = plot.crop;
  const def = crop && ctx.c.crop[crop.id];
  if (!crop || !def || crop.withered || crop.growth >= 1 || plot.moisture <= 0) return null;
  const speed = 1 + mod(ctx.s, ctx.c, 'growthSpeed');
  return ((1 - crop.growth) * def.growMin * HOUR_MS) / (growthRate(plot.fertility) * speed);
}

const at = (plot: number) => {
  const t = plotTile(plot);
  return { x: t.x + 0.5, y: t.y + 0.5 };
};

// ---------------------------------------------------------------- aktualizacja w każdym kroku

export function updateFields(ctx: Ctx, dt: number): void {
  const { s, c, cal } = ctx;
  const weather = c.weather.types[cal.weather];
  const speed = 1 + mod(s, c, 'growthSpeed');
  const sprinkled = sprinklerCoverage(ctx);

  s.plots.forEach((plot, i) => {
    if (!plot.unlocked) return;
    // Wilgotność gleby: deszcz i zraszacz podlewają tylko obsiane grządki – świeżo zaorana ziemia jest sucha.
    if (plot.tilled || plot.crop) {
      if (weather.wet && plot.crop) plot.moisture = 1;
      else plot.moisture = Math.max(0, plot.moisture - (dt / HOUR_MS) * DRY_PER_HOUR * weather.dry);
      if (plot.crop && sprinkled.has(i)) plot.moisture = Math.max(plot.moisture, 0.8);
    } else plot.moisture = 0;
    const crop = plot.crop;
    if (!crop || crop.withered || crop.growth >= 1) return;
    const def = c.crop[crop.id];
    if (!def) return;
    if (def.night && !cal.isNight) return;
    crop.aliveMs += dt;
    crop.weatherSum += weather.quality * dt;
    if (plot.moisture <= 0) return;
    if (plot.moisture > 0.25) crop.wetMs += dt;
    crop.growth = Math.min(1, crop.growth + (dt / (def.growMin * HOUR_MS)) * growthRate(plot.fertility) * speed);
  });
}

/** Nowy dzień: ugór regeneruje żyzność, uprawy spoza sezonu więdną. */
export function fieldsNewDay(ctx: Ctx): void {
  const { s, c, cal } = ctx;
  s.plots.forEach((plot, i) => {
    if (!plot.unlocked) return;
    if (!plot.crop) {
      if (plot.fertility < FALLOW_CAP) plot.fertility = Math.min(FALLOW_CAP, plot.fertility + FALLOW_REGEN);
      return;
    }
    const def = c.crop[plot.crop.id];
    if (def && !plot.crop.withered && !def.seasons.includes(cal.season)) {
      plot.crop.withered = true;
      ctx.bus.emit({ type: 'withered', plot: i, at: at(i) });
    }
  });
}

export function sprinklerCoverage(ctx: Ctx): Set<number> {
  const out = new Set<number>();
  for (const o of ctx.s.objects) {
    const def = ctx.c.buildings[o.type];
    if (def?.kind !== 'sprinkler') continue;
    const r = def.radius ?? 1;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = o.x + dx - FIELD.x;
        const y = o.y + dy - FIELD.y;
        if (x >= 0 && y >= 0 && x < FIELD.w && y < FIELD.h) out.add(y * FIELD.w + x);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- akcje

export function till(ctx: Ctx, i: number): CommandResult {
  const plot = ctx.s.plots[i];
  if (!plot) return fail('invalid');
  if (!plot.unlocked) return fail('locked');
  if (plot.crop?.withered) return clear(ctx, i);
  if (plot.crop) return fail('occupied');
  if (plot.tilled) return fail('already-tilled');
  plot.tilled = true;
  plot.moisture = 0;
  ctx.bus.emit({ type: 'tilled', plot: i, at: at(i) });
  return OK;
}

export function clear(ctx: Ctx, i: number): CommandResult {
  const plot = ctx.s.plots[i];
  if (!plot?.crop?.withered) return fail('invalid');
  plot.crop = null;
  plot.tilled = false;
  plot.moisture = 0;
  ctx.bus.emit({ type: 'cleared', plot: i, at: at(i) });
  return OK;
}

export function plant(ctx: Ctx, i: number, cropId: string): CommandResult {
  const { s, c, cal } = ctx;
  const plot = s.plots[i];
  const def = c.crop[cropId];
  if (!plot || !def) return fail('invalid');
  if (!plot.unlocked) return fail('locked');
  if (plot.crop) return fail('occupied');
  if (!plot.tilled) return fail('not-tilled');
  if (!def.seasons.includes(cal.season)) return fail('out-of-season');
  if ((s.seeds[cropId] ?? 0) <= 0) return fail('no-seeds');
  s.seeds[cropId] = (s.seeds[cropId] ?? 0) - 1;
  plot.crop = { id: cropId, growth: 0, wetMs: 0, aliveMs: 0, weatherSum: 0, plantedAt: s.clock.simMs, withered: false };
  ctx.bus.emit({ type: 'planted', plot: i, crop: cropId, at: at(i) });
  return OK;
}

export function water(ctx: Ctx, i: number): CommandResult {
  const plot = ctx.s.plots[i];
  if (!plot) return fail('invalid');
  if (!plot.unlocked) return fail('locked');
  if (!plot.tilled && !plot.crop) return fail('nothing-to-water');
  if (plot.moisture > 0.9) return fail('already-watered');
  plot.moisture = 1;
  stat(ctx, 'watered');
  ctx.bus.emit({ type: 'watered', plot: i, at: at(i) });
  return OK;
}

export function fertilize(ctx: Ctx, i: number, itemId: string): CommandResult {
  const { s, c } = ctx;
  const plot = s.plots[i];
  const def = c.items[itemId];
  if (!plot || def?.kind !== 'fertilizer') return fail('invalid');
  if (!plot.unlocked) return fail('locked');
  if (plot.fertility >= 0.98) return fail('soil-rich');
  if (countItem(s, itemId) <= 0) return fail('no-fertilizer');
  consumeItem(s, itemId, 1);
  plot.fertility = Math.min(1, plot.fertility + (def.fertility ?? 0.2));
  ctx.bus.emit({ type: 'fertilized', plot: i, item: itemId, at: at(i) });
  return OK;
}

export function harvest(ctx: Ctx, i: number): CommandResult {
  const { s, c } = ctx;
  const plot = s.plots[i];
  if (!plot) return fail('invalid');
  if (!plot.unlocked) return fail('locked');
  if (plot.crop?.withered) return clear(ctx, i);
  if (!plot.crop) return fail('nothing-to-harvest');
  if (!isReady(plot.crop)) return fail('not-ready');
  const crop = plot.crop;
  const def = c.crop[crop.id];
  if (!def) return fail('invalid');

  // Losowy rozrzut ±0.04 – deterministyczny (generator w stanie gry).
  const quality = qualityTier(qualityScore(ctx, plot, crop) + (rand(s) - 0.5) * 0.08);
  addItem(s, crop.id, 1, quality);

  // Płodozmian: ta sama uprawa z rzędu wyjaławia glebę dwa razy szybciej (i coraz mocniej).
  const repeated = plot.lastCrop === crop.id;
  plot.streak = repeated ? plot.streak + 1 : 0;
  const loss = def.soil * (1 + plot.streak) * (1 - mod(s, c, 'soilSaving'));
  plot.fertility = Math.max(0, plot.fertility - loss);
  plot.lastCrop = crop.id;
  plot.crop = null;
  plot.tilled = false;
  plot.moisture = 0;

  stat(ctx, 'harvested');
  if (quality === 2) stat(ctx, 'gold');
  ctx.bus.emit({ type: 'harvested', plot: i, crop: crop.id, quality, xp: def.xp, at: at(i) });
  addXp(ctx, def.xp);
  return OK;
}

/** Tap/przeciągnięcie aktualnym narzędziem. Dojrzałe/zwiędłe rośliny zbiera każde narzędzie poza konewką i nawozem. */
export function useTool(ctx: Ctx, i: number, smart: boolean): CommandResult {
  const { s } = ctx;
  const plot = s.plots[i];
  if (!plot) return fail('invalid');
  if (smart && s.tool !== 'can' && s.tool !== 'fertilizer' && plot.crop && (isReady(plot.crop) || plot.crop.withered)) {
    return harvest(ctx, i);
  }
  switch (s.tool) {
    case 'hoe':
      return till(ctx, i);
    case 'seeds':
      return plant(ctx, i, s.selectedSeed);
    case 'can':
      return water(ctx, i);
    case 'fertilizer':
      return fertilize(ctx, i, s.selectedFertilizer);
    case 'sickle':
      return harvest(ctx, i);
    case 'rod':
      return fail('not-water');
  }
}

// ---------------------------------------------------------------- odblokowywanie pól

export function plotUnlockCost(s: GameState, startUnlocked: number): number {
  const purchased = s.plots.filter((p) => p.unlocked).length - startUnlocked;
  return Math.round((30 * 1.3 ** Math.max(0, purchased)) / 5) * 5;
}

export function fieldNeighbors(i: number): number[] {
  const col = i % FIELD.w;
  const row = Math.floor(i / FIELD.w);
  const out: number[] = [];
  if (col > 0) out.push(i - 1);
  if (col < FIELD.w - 1) out.push(i + 1);
  if (row > 0) out.push(i - FIELD.w);
  if (row < FIELD.h - 1) out.push(i + FIELD.w);
  return out;
}

export const canUnlock = (s: GameState, i: number): boolean =>
  !!s.plots[i] && !s.plots[i]!.unlocked && fieldNeighbors(i).some((n) => s.plots[n]?.unlocked);

export function unlockPlot(ctx: Ctx, i: number, startUnlocked: number): CommandResult {
  const { s } = ctx;
  const plot = s.plots[i];
  if (!plot) return fail('invalid');
  if (plot.unlocked) return fail('already-unlocked');
  if (!canUnlock(s, i)) return fail('not-adjacent');
  const cost = plotUnlockCost(s, startUnlocked);
  if (s.coins < cost) return fail('no-coins');
  s.coins -= cost;
  plot.unlocked = true;
  ctx.bus.emit({ type: 'unlocked', plot: i, cost, at: at(i) });
  return OK;
}
