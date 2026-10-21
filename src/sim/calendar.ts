// Czas gry: 1 godzina gry = 1 minuta rzeczywista, doba = 24 min, sezon = 7 dni, rok = 4 sezony.
// Pogoda jest funkcją (seed, dzień) – deterministyczna i znana z góry (prognoza).

import { CONTENT, SEASONS, type Content, type WeatherId } from '../content/content';
import { hashFloat, weightedIndex } from '../core/rng';
import type { Calendar } from './types';

export const HOUR_MS = 60_000;
export const DAY_MS = 24 * HOUR_MS;
export const SEASON_DAYS = 7;
/** Krok symulacji: 10 minut gry. */
export const STEP_MS = 10_000;
/** Maksymalne nadrabianie po powrocie gracza. */
export const MAX_CATCHUP_MS = 24 * 60 * 60 * 1000;
/** Gra startuje o 6:00 pierwszego dnia wiosny. */
export const START_SIM_MS = 6 * HOUR_MS;

export const NIGHT_START = 20;
export const NIGHT_END = 6;

export function weatherForDay(seed: number, day: number, content: Content = CONTENT): WeatherId {
  if (day === 0) return 'sun'; // pierwszy dzień zawsze słoneczny (samouczek)
  const season = SEASONS[Math.floor(day / SEASON_DAYS) % 4]!;
  const table = content.weather.seasons[season];
  const entries = Object.entries(table) as [WeatherId, number][];
  const i = weightedIndex(
    entries.map((e) => e[1]),
    hashFloat(seed, day, 0x77),
  );
  return entries[i]?.[0] ?? 'sun';
}

export function calendarAt(simMs: number, seed: number): Calendar {
  const day = Math.floor(simMs / DAY_MS);
  const seasonIndex = Math.floor(day / SEASON_DAYS) % 4;
  const hour = (simMs % DAY_MS) / HOUR_MS;
  return {
    day,
    dayOfSeason: day % SEASON_DAYS,
    season: SEASONS[seasonIndex]!,
    seasonIndex,
    year: Math.floor(day / (SEASON_DAYS * 4)),
    hour,
    isNight: hour >= NIGHT_START || hour < NIGHT_END,
    weather: weatherForDay(seed, day),
  };
}

/** Jasność dnia 0..1 (0 = głęboka noc) – używana przez oświetlenie i muzykę. */
export function daylight(hour: number): number {
  if (hour >= 7 && hour <= 18) return 1;
  if (hour > 18 && hour < 21) return 1 - (hour - 18) / 3;
  if (hour > 4.5 && hour < 7) return (hour - 4.5) / 2.5;
  return 0;
}
