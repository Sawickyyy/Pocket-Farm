/** Łączne XP potrzebne do osiągnięcia poziomu `level` (poziom 1 = 0 XP). */
export function xpForLevel(level: number): number {
  return 5 * level * (level - 1);
}

export function levelFromXp(xp: number): number {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  return level;
}

/** Postęp w obrębie bieżącego poziomu, 0..1. */
export function levelProgress(xp: number): { level: number; current: number; needed: number; ratio: number } {
  const level = levelFromXp(xp);
  const base = xpForLevel(level);
  const needed = xpForLevel(level + 1) - base;
  const current = xp - base;
  return { level, current, needed, ratio: needed > 0 ? current / needed : 1 };
}

/** Nagroda w monetach za wbicie poziomu. */
export function levelReward(level: number): number {
  return 10 * level;
}
