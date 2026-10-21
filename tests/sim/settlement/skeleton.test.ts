import { describe, expect, it } from 'vitest';
import { CONTENT, validateContent } from '../../../src/content/content';
import { loadFromUnknown } from '../../../src/save/migrations';
import { canPlace } from '../../../src/sim/systems/building';
import { coverageAt, isBuilt, storageCap, tierOf } from '../../../src/sim/systems/settlement/common';
import { buyableChunks, territoryCost } from '../../../src/sim/systems/settlement/territory';
import { SAVE_VERSION } from '../../../src/sim/types';
import { FARM } from '../../../src/sim/world';
import { addResident, freeSpot, makeTown, ok, placeBuilt } from './helpers';

describe('osada: szkielet', () => {
  it('dane osady są spójne', () => {
    expect(validateContent(CONTENT)).toEqual([]);
  });

  it('etapy według populacji', () => {
    expect(tierOf(CONTENT, 0)).toBe(0);
    expect(tierOf(CONTENT, 4)).toBe(1);
    expect(tierOf(CONTENT, 16)).toBe(2);
    expect(tierOf(CONTENT, 51)).toBe(3);
    expect(tierOf(CONTENT, 150)).toBe(4);
  });

  it('budowa tylko na terenie osady, z etapem i unikalnością', () => {
    const sim = makeTown(() => {}, 42, 0);
    const s = sim.state;
    expect(canPlace(s, CONTENT, 'tent', FARM.x - 1, FARM.y).ok).toBe(false);
    expect(canPlace(s, CONTENT, 'house', FARM.x, FARM.y)).toEqual({ ok: false, reason: 'tier-too-low' });
    s.settlement.peakTier = 4;
    placeBuilt(sim, 'townhall');
    const spot = freeSpot(s, 'warehouse');
    expect(canPlace(s, CONTENT, 'townhall', spot.x, spot.y)).toEqual({ ok: false, reason: 'unique' });
  });

  it('dom powstaje jako budowa, pobiera materiały i zapisuje inwestycję', () => {
    const sim = makeTown();
    const s = sim.state;
    const wood = s.inventory.wood!;
    const spot = freeSpot(s, 'house');
    ok(sim, { type: 'place', building: 'house', x: spot.x, y: spot.y, style: 2 });
    const o = s.objects.at(-1)!;
    expect(o.style).toBe(2);
    expect(isBuilt(s, o.uid)).toBe(false);
    expect(s.inventory.wood).toBe(wood - 12);
    expect(s.settlement.budget[0]!.investments).toBe(320);
    ok(sim, { type: 'restyle', uid: o.uid, style: 1 });
    expect(o.style).toBe(1);
  });

  it('kupno terenu: odkryty, przy granicy, rosnąca cena, limit etapu', () => {
    const sim = makeTown((st) => {
      st.world.revealed = Array.from({ length: 64 }, (_, i) => i);
    }, 42, 1);
    const s = sim.state;
    const options = buyableChunks(s, CONTENT);
    expect(options.length).toBeGreaterThan(0);
    expect(options).not.toContain(43); // Stara Wieś
    const coins = s.coins;
    ok(sim, { type: 'buyTerritory', chunk: options[0]! });
    expect(s.coins).toBe(coins - territoryCost(CONTENT, 0));
    expect(territoryCost(CONTENT, 1)).toBeGreaterThan(territoryCost(CONTENT, 0));
    ok(sim, { type: 'buyTerritory', chunk: buyableChunks(s, CONTENT)[0]! });
    expect(sim.dispatch({ type: 'buyTerritory', chunk: buyableChunks(s, CONTENT)[0]! })).toEqual({ ok: false, reason: 'max-territory' });
  });

  it('pokrycie usług i magazyn', () => {
    const sim = makeTown();
    const s = sim.state;
    const well = placeBuilt(sim, 'well');
    const o = s.objects.find((x) => x.uid === well)!;
    expect(coverageAt(s, CONTENT, 'water', o.x, o.y)).toBe(1);
    expect(coverageAt(s, CONTENT, 'water', o.x + 20, o.y)).toBe(0);
    const before = storageCap(s, CONTENT);
    placeBuilt(sim, 'warehouse');
    expect(storageCap(s, CONTENT)).toBe(before + 300);
  });

  it('migracja v3 → v4 dodaje pustą osadę i naprawia odwołania', () => {
    const sim = makeTown();
    const uid = placeBuilt(sim, 'tent');
    const r = addResident(sim.state, { home: uid, job: 999 });
    const v3 = JSON.parse(JSON.stringify(sim.state)) as Record<string, any>;
    v3.version = 3;
    delete v3.settlement;
    const fresh = loadFromUnknown(v3, 0);
    expect(fresh.version).toBe(SAVE_VERSION);
    expect(fresh.settlement.residents).toEqual([]);
    expect(fresh.settlement.territory).toEqual([27, 28, 35, 36]);
    const v4 = JSON.parse(JSON.stringify(sim.state));
    const loaded = loadFromUnknown(v4, 0);
    const lr = loaded.settlement.residents.find((x) => x.id === r.id)!;
    expect(lr.home).toBe(uid);
    expect(lr.job).toBeNull();
  });
});
