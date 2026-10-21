// Deterministyczna losowość: ten sam seed i te same komendy → ten sam wynik symulacji.

/** Miesza dowolną liczbę liczb całkowitych w 32-bitowy hash. */
export function hash32(...nums: number[]): number {
  let h = 0x9e3779b9;
  for (const n of nums) {
    h ^= Math.imul((n | 0) ^ ((n / 4294967296) | 0), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** Hash → liczba z przedziału [0, 1). */
export const hashFloat = (...nums: number[]): number => hash32(...nums) / 4294967296;

/** Krok generatora mulberry32: zwraca [nowy stan, liczba 0..1). */
export function mulberry(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [s, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

/** Losowanie ważone; `weights` muszą być nieujemne. Zwraca indeks albo -1. */
export function weightedIndex(weights: readonly number[], r: number): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return -1;
  let x = r * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i] ?? 0;
    if (x < 0) return i;
  }
  return weights.length - 1;
}
