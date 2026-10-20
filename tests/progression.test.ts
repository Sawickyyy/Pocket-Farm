import { describe, expect, it } from 'vitest';
import { harvest, plant, till, water } from '../src/game/logic';
import { levelFromXp, levelProgress, levelReward, xpForLevel } from '../src/game/progression';
import { createInitialState } from '../src/game/state';
import { START_UNLOCKED } from '../src/game/content';

describe('poziomy', () => {
  it('krzywa XP jest rosnąca', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(10);
    expect(xpForLevel(3)).toBe(30);
    for (let l = 1; l < 30; l++) expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
  });

  it('levelFromXp i postęp', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(9)).toBe(1);
    expect(levelFromXp(10)).toBe(2);
    expect(levelFromXp(29)).toBe(2);
    expect(levelProgress(20)).toEqual({ level: 2, current: 10, needed: 20, ratio: 0.5 });
  });

  it('zbiór wbija poziom i daje nagrodę w monetach', () => {
    const plot = START_UNLOCKED[0]!;
    let s = { ...createInitialState(0), xp: 9 };
    for (const step of [
      (x: typeof s) => till(x, plot),
      (x: typeof s) => plant(x, plot, 'radish', 0),
      (x: typeof s) => water(x, plot, 0),
    ]) {
      const r = step(s);
      if (!r.ok) throw new Error(r.reason);
      s = r.state;
    }
    const r = harvest(s, plot, 60_000);
    if (!r.ok) throw new Error(r.reason);
    expect(levelFromXp(r.state.xp)).toBe(2);
    expect(r.state.coins).toBe(s.coins + levelReward(2));
    expect(r.events).toContainEqual({ type: 'levelUp', level: 2, reward: levelReward(2) });
  });
});
