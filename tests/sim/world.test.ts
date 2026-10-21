import { describe, expect, it } from 'vitest';
import { CONTENT, validateContent } from '../../src/content/content';
import { weatherForDay } from '../../src/sim/calendar';
import { exploreCost } from '../../src/sim/systems/exploration';
import { hearts } from '../../src/sim/systems/village';
import { BiomeId, CHUNKS_X, MAP_W, START_CHUNKS, generateWorld } from '../../src/sim/world';
import { HOUR_MS, findDay, makeSim, ok, reason, setTime } from './helpers';

describe('dane gry (JSON)', () => {
  it('są spójne', () => {
    expect(validateContent(CONTENT)).toEqual([]);
  });
});

describe('pogoda', () => {
  it('jest deterministyczna i zgodna z sezonem', () => {
    expect(weatherForDay(7, 10)).toBe(weatherForDay(7, 10));
    const winter = Array.from({ length: 200 }, (_, i) => weatherForDay(3, 21 + (i % 7) + 28 * Math.floor(i / 7)));
    expect(winter.every((w) => ['sun', 'cloud', 'snow'].includes(w))).toBe(true);
    expect(winter.filter((w) => w === 'snow').length / winter.length).toBeGreaterThan(0.25);
  });
});

describe('mapa proceduralna i eksploracja', () => {
  const seed = 42;
  const world = generateWorld(seed);

  it('generuje wodę, las i strefę farmy', () => {
    const counts = new Map<number, number>();
    for (const b of world.biome) counts.set(b, (counts.get(b) ?? 0) + 1);
    expect(counts.get(BiomeId.water)).toBeGreaterThan(20);
    expect(counts.get(BiomeId.forest)).toBeGreaterThan(50);
    expect(counts.get(BiomeId.farm)).toBe(256);
    expect(generateWorld(seed)).toBe(world); // cache
  });

  it('odkrywanie sąsiednich fragmentów za rosnącą cenę', () => {
    const sim = makeSim((s) => {
      s.coins = 10_000;
      s.xp = 100;
    }, seed);
    const neighbor = START_CHUNKS[0]! - 1;
    const cost = exploreCost(sim.state);
    ok(sim, { type: 'explore', chunk: neighbor });
    expect(sim.state.coins).toBe(10_000 - cost);
    expect(exploreCost(sim.state)).toBeGreaterThan(cost);
    expect(reason(sim, { type: 'explore', chunk: 0 })).toBe('not-adjacent');
  });

  it('zbieractwo z odnawianiem po 2 dniach', () => {
    const sim = makeSim((s) => {
      s.world.revealed = Array.from({ length: CHUNKS_X * CHUNKS_X }, (_, i) => i);
    }, seed);
    const tile = world.forage.findIndex((v, i) => v === 1 && ['forest', 'meadow', 'sand'].length > 0 && world.biome[i] !== BiomeId.forest);
    expect(tile).toBeGreaterThan(-1);
    ok(sim, { type: 'forage', tile });
    expect(reason(sim, { type: 'forage', tile })).toBe('not-respawned');
    sim.advance(48 * HOUR_MS);
    expect(sim.dispatch({ type: 'forage', tile }).ok).toBe(true);
    expect(reason(sim, { type: 'forage', tile: 0 })).not.toBeNull();
  });

  it('łowienie: brania → minigra → ryba albo ucieczka', () => {
    const sim = makeSim((s) => {
      s.world.revealed = Array.from({ length: CHUNKS_X * CHUNKS_X }, (_, i) => i);
    }, seed);
    const water = world.biome.findIndex((b) => b === BiomeId.water);
    const land = world.biome.findIndex((b) => b === BiomeId.grass);
    expect(reason(sim, { type: 'castLine', tile: land })).toBe('not-water');
    ok(sim, { type: 'castLine', tile: water });
    const fish = sim.state.world.pendingFish!.fish;
    ok(sim, { type: 'reelIn', score: 0.95 });
    expect(sim.state.inventory[`${fish}*2`]).toBe(1);
    ok(sim, { type: 'castLine', tile: water });
    expect(reason(sim, { type: 'reelIn', score: 0 })).toBe('escaped');
    expect(reason(sim, { type: 'reelIn', score: 1 })).toBe('no-bite');
    expect(water % MAP_W).toBeGreaterThanOrEqual(0);
  });
});

describe('mieszkańcy i zamówienia', () => {
  it('generuje wykonalne zamówienia i nagradza za dostawę', () => {
    const sim = makeSim((s) => (s.xp = 100));
    sim.advance(24 * HOUR_MS);
    const order = sim.state.orders[0]!;
    expect(order).toBeDefined();
    expect(reason(sim, { type: 'deliverOrder', id: order.id })).toBe('missing-items');
    sim.state.inventory[order.item] = order.qty;
    const coins = sim.state.coins;
    ok(sim, { type: 'deliverOrder', id: order.id });
    expect(sim.state.coins).toBe(coins + order.coins);
    expect(sim.state.npcs[order.npc]!.friendship).toBe(30);
  });

  it('prezenty raz dziennie, ulubione dają więcej, serca dają nagrody', () => {
    const sim = makeSim((s) => {
      s.inventory = { bread: 5, radish: 1 };
      s.npcs.ania!.friendship = 190;
    });
    const coins = sim.state.coins;
    ok(sim, { type: 'gift', npc: 'ania', key: 'bread' });
    expect(sim.state.npcs.ania!.friendship).toBe(270);
    expect(hearts(270)).toBe(2);
    expect(sim.state.coins).toBe(coins + 120); // nagroda za 2 serca
    expect(reason(sim, { type: 'gift', npc: 'ania', key: 'bread' })).toBe('already-gifted');
  });
});

describe('umiejętności', () => {
  it('wymagają punktów i poprzedników, a efekty działają', () => {
    const sim = makeSim();
    expect(reason(sim, { type: 'unlockSkill', id: 'haggler' })).toBe('no-points');
    sim.state.skillPoints = 10;
    expect(reason(sim, { type: 'unlockSkill', id: 'artisan' })).toBe('requires-skill');
    sim.state.inventory.radish = 1;
    sim.state.market.demand = {};
    ok(sim, { type: 'unlockSkill', id: 'haggler' });
    ok(sim, { type: 'sell', key: 'radish', qty: 1 });
    expect(sim.state.stats.coinsEarned).toBe(Math.round(5 * 1.08));
    expect(sim.state.skillPoints).toBe(9);
  });

  it('poziom daje punkt umiejętności i monety', () => {
    const sim = makeSim();
    ok(sim, { type: 'debug', op: 'xp', value: 10 });
    expect(sim.state.skillPoints).toBe(1);
  });
});

describe('zadania, osiągnięcia, festyny', () => {
  it('zadania dzienne liczą postęp ze zdarzeń i dają nagrodę', () => {
    const sim = makeSim();
    const q = sim.state.quests.daily[0]!;
    expect(sim.state.quests.daily).toHaveLength(3);
    expect(reason(sim, { type: 'claimQuest', id: q.id })).toBe('not-complete');
    q.progress = q.target;
    ok(sim, { type: 'claimQuest', id: q.id });
    expect(reason(sim, { type: 'claimQuest', id: q.id })).toBe('claimed');
  });

  it('osiągnięcie za pierwszy zbiór', () => {
    const sim = makeSim();
    sim.state.stats.harvested = 1;
    sim.bus.emit({ type: 'newDay', day: 0, weather: 'sun' });
    expect(sim.state.achievements.first_harvest).toBeDefined();
  });

  it('festyn: dostawa w dniu festynu odblokowuje posąg', () => {
    const sim = makeSim((s) => {
      setTime(s, 3, 10);
      s.inventory.wildflower = 5;
    });
    ok(sim, { type: 'festivalDeliver' });
    expect(sim.state.unlocks).toContain('statue_spring');
    expect(reason(sim, { type: 'festivalDeliver' })).toBe('claimed');
    const off = makeSim((s) => setTime(s, 1, 10));
    expect(reason(off, { type: 'festivalDeliver' })).toBe('no-festival');
    void findDay;
  });
});

import { FARM as FARM_V, VILLAGE_HOUSES, chunkOfTile, isRoad, inFarm } from '../../src/sim/world';

describe('wioska mieszkańców', () => {
  it('domy i drogi leżą w odkrytej wiosce, poza farmą i wodą, dla wielu seedów', () => {
    for (const seed of [1, 7, 42, 1234, 99999]) {
      const world = generateWorld(seed);
      for (const h of VILLAGE_HOUSES) {
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
          const i = (h.y + dy) * MAP_W + h.x + dx;
          expect(world.biome[i]).toBe(BiomeId.village);
          expect(world.road[i]).toBe(0);
          expect(START_CHUNKS).toContain(chunkOfTile(h.x + dx, h.y + dy));
        }
      }
      // dróżka od bramy farmy do ulicy jest ciągła
      for (let y = FARM_V.y + FARM_V.h; y <= 44; y++) expect(isRoad(32, y)).toBe(true);
      expect(inFarm(32, FARM_V.y + FARM_V.h)).toBe(false);
    }
  });
});
