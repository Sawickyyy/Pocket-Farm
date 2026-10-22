import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../src/core/eventBus';
import { calendarAt } from '../../../src/sim/calendar';
import { makeCtx, type Ctx } from '../../../src/sim/ctx';
import type { SimEvent } from '../../../src/sim/events';
import type { Simulation } from '../../../src/sim/simulation';
import { newSite } from '../../../src/sim/systems/settlement/common';
import { assignJobs, freeJobs, jobSlots, openJobs, unemployed } from '../../../src/sim/systems/settlement/jobs';
import type { GameState, Resident } from '../../../src/sim/types';
import { CONTENT } from '../../../src/content/content';
import { setTime } from '../helpers';
import { addResident, makeTown, placeBuilt, runHours } from './helpers';

// Budynki stawiamy bezpośrednio w stanie (dokładne położenie, bez warunków terenu) na północ od farmy –
// z dala od dróg wioski, więc dojazd zależy tylko od odległości (≤ 8) albo od położonych w teście ścieżek.

/** Stawia gotowy budynek w (x, y); `site: false` = bez stanu budowy (jak budynki farmy). */
function put(s: GameState, type: string, x: number, y: number, site = true): number {
  const uid = s.nextUid++;
  s.objects.push({ uid, type, x, y });
  if (site) s.settlement.sites[String(uid)] = newSite(1);
  return uid;
}

/** Ścieżka (kafle drogi) od (x0, y) do (x1, y) włącznie. */
function pathRow(s: GameState, x0: number, x1: number, y: number): void {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) put(s, 'path', x, y, false);
}

function ctxOf(s: GameState, hour = 8, day = 3): Ctx {
  setTime(s, day, hour);
  return makeCtx(s, new EventBus<SimEvent>(), calendarAt(s.clock.simMs, s.seed));
}

const run = (s: GameState): void => assignJobs(ctxOf(s));
const site = (s: GameState, uid: number) => s.settlement.sites[String(uid)]!;
const jobsOf = (s: GameState): (number | null)[] => s.settlement.residents.map((r) => r.job);

/** Dorosły mieszkaniec w domu `home`. */
const adult = (s: GameState, home: number | null, patch: Partial<Resident> = {}): Resident => addResident(s, { home, ...patch });

describe('osada: przydział pracy', () => {
  it('bezrobotny dorosły dostaje najbliższy budynek z wolnym etatem', () => {
    const s = makeTown().state;
    const tent = put(s, 'tent', 10, 10); // środek (10,5; 10,5)
    const far = put(s, 'allotment', 13, 10); // środek (14,5; 11,5) – 5 kafli
    const near = put(s, 'allotment', 6, 10); // środek (7,5; 11,5) – 4 kafle
    const r = adult(s, tent);
    run(s);
    expect(r.job).toBe(near);
    expect(r.job).not.toBe(far);
  });

  it('remis odległości rozstrzyga mniejszy uid', () => {
    const s = makeTown().state;
    const tent = put(s, 'tent', 10, 10);
    const right = put(s, 'allotment', 12, 9); // środek (13,5; 10,5) – 3 kafle
    put(s, 'allotment', 6, 9); // środek (7,5; 10,5) – 3 kafle
    const r = adult(s, tent);
    run(s);
    expect(r.job).toBe(right);
  });

  it('pierwszeństwo ma najstarszy (najmniejsze id), niezależnie od kolejności w tablicy', () => {
    const s = makeTown().state;
    const tent = put(s, 'tent', 10, 10);
    const mill = put(s, 'mill', 12, 10, false); // 1 etat
    const older = adult(s, tent);
    const younger = adult(s, tent);
    s.settlement.residents.reverse();
    run(s);
    expect(older.job).toBe(mill);
    expect(younger.job).toBeNull();
  });

  it('nie więcej pracowników niż etatów; kolejni szukają dalej', () => {
    const s = makeTown().state;
    const hut = put(s, 'hut', 10, 10); // środek (11; 11)
    const field = put(s, 'allotment', 13, 10); // 3 etaty, 4 kafle
    const mill = put(s, 'mill', 5, 10, false); // 1 etat, 5 kafli
    const rs = [0, 1, 2, 3, 4].map(() => adult(s, hut));
    run(s);
    expect(rs.slice(0, 3).map((r) => r.job)).toEqual([field, field, field]);
    expect(rs[3]!.job).toBe(mill);
    expect(rs[4]!.job).toBeNull();
    expect(freeJobs(s, CONTENT)).toBe(0);
    expect(unemployed(s)).toEqual([rs[4]]);
  });

  it('przydziały są stabilne: bliższy etat nie odbiera pracy', () => {
    const s = makeTown().state;
    const tent = put(s, 'tent', 10, 10);
    const far = put(s, 'allotment', 13, 10);
    const r = adult(s, tent, { job: far });
    const near = put(s, 'allotment', 6, 10);
    run(s);
    run(s);
    expect(r.job).toBe(far);
    expect(freeJobs(s, CONTENT)).toBe(2 + 3);
    // Nowy bezrobotny wybiera bliższy.
    const n = adult(s, tent);
    run(s);
    expect(n.job).toBe(near);
  });

  it('dzieci i bezdomni nie dostają pracy; dziecko traci etat', () => {
    const s = makeTown().state;
    const tent = put(s, 'tent', 10, 10);
    const field = put(s, 'allotment', 12, 10);
    const child = addResident(s, { home: tent, child: true });
    const kid = addResident(s, { home: tent, child: true, job: field });
    const homeless = adult(s, null);
    run(s);
    expect(child.job).toBeNull();
    expect(kid.job).toBeNull();
    expect(homeless.job).toBeNull();
    expect(freeJobs(s, CONTENT)).toBe(3);
  });

  it('bezdomny z pracą zachowuje ją (zwalnia tylko budynek)', () => {
    const s = makeTown().state;
    const field = put(s, 'allotment', 12, 10);
    const r = adult(s, null, { job: field });
    run(s);
    expect(r.job).toBe(field);
  });

  it('zwalnianie: budynek usunięty, w budowie, uszkodzony albo bez etatów', () => {
    const s = makeTown().state;
    const tent = put(s, 'tent', 10, 10);
    const building = put(s, 'allotment', 12, 10);
    const damaged = put(s, 'allotment', 6, 10);
    const scratched = put(s, 'lumber', 10, 6);
    site(s, building).built = 0.6;
    site(s, damaged).damage = 0.5;
    site(s, scratched).damage = 0.49;
    const gone = adult(s, null, { job: 999 });
    const builder = adult(s, null, { job: building });
    const victim = adult(s, null, { job: damaged });
    const lucky = adult(s, null, { job: scratched });
    const odd = adult(s, null, { job: tent }); // namiot nie ma etatów
    run(s);
    expect([gone.job, builder.job, victim.job, odd.job]).toEqual([null, null, null, null]);
    expect(lucky.job).toBe(scratched);
  });

  it('awaria i pożar nie zwalniają, ale nie przyjmują nowych pracowników', () => {
    const s = makeTown().state;
    const tent = put(s, 'tent', 10, 10);
    const broken = put(s, 'allotment', 12, 10);
    const burning = put(s, 'allotment', 6, 10);
    site(s, broken).broken = true;
    site(s, burning).fire = 2;
    const a = adult(s, tent, { job: broken });
    const b = adult(s, tent, { job: burning });
    const seeker = adult(s, tent);
    run(s);
    expect(a.job).toBe(broken);
    expect(b.job).toBe(burning);
    expect(seeker.job).toBeNull();
    expect(freeJobs(s, CONTENT)).toBe(0);
    // Po naprawie i ugaszeniu – etaty znów wolne.
    site(s, broken).broken = false;
    site(s, burning).fire = 0;
    run(s);
    expect(seeker.job).toBe(broken); // remis 4 kafli – mniejszy uid
  });

  it('nadmiar ponad etaty: zwolnieni najnowsi (największe id)', () => {
    const s = makeTown().state;
    const mill = put(s, 'mill', 12, 10, false); // 1 etat
    const field = put(s, 'allotment', 6, 10); // 3 etaty
    const rs = [0, 1, 2].map(() => adult(s, null, { job: mill }));
    const fs = [0, 1, 2, 3, 4].map(() => adult(s, null, { job: field }));
    s.settlement.residents.reverse();
    run(s);
    expect(rs.map((r) => r.job)).toEqual([mill, null, null]);
    expect(fs.map((r) => r.job)).toEqual([field, field, field, null, null]);
  });

  it('brak dojazdu (daleko, bez drogi) – brak pracy', () => {
    const s = makeTown().state;
    const tent = put(s, 'tent', 10, 10);
    put(s, 'allotment', 20, 10); // środek (21,5; 11,5) – 12 kafli
    const r = adult(s, tent);
    run(s);
    expect(r.job).toBeNull();
    expect(freeJobs(s, CONTENT)).toBe(3);
  });

  it('wspólna droga daje dojazd; bliższy budynek bez dojazdu jest pomijany', () => {
    const s = makeTown().state;
    const tent = put(s, 'tent', 10, 10);
    const unreachable = put(s, 'allotment', 10, 18); // środek (11,5; 19,5) – 10 kafli, bez drogi
    const linked = put(s, 'allotment', 20, 10); // 12 kafli, ścieżką y = 9
    pathRow(s, 10, 20, 9);
    const r = adult(s, tent);
    run(s);
    expect(r.job).toBe(linked);
    expect(r.job).not.toBe(unreachable);
  });

  it('brak dojazdu sprawdzany ponownie po zmianie dróg, położenia lub zajezdni', () => {
    const s = makeTown().state;
    const tent = put(s, 'tent', 10, 10);
    const field = put(s, 'allotment', 20, 10); // 12 kafli
    const r = adult(s, tent);
    run(s);
    run(s);
    expect(r.job).toBeNull();
    pathRow(s, 10, 20, 9);
    run(s);
    expect(r.job).toBe(field);

    const s2 = makeTown().state;
    const tent2 = put(s2, 'tent', 10, 10);
    const field2 = put(s2, 'allotment', 20, 10);
    const r2 = adult(s2, tent2);
    run(s2);
    expect(r2.job).toBeNull();
    s2.objects.find((o) => o.uid === field2)!.x = 12; // przesunięcie (komenda move) – 4 kafle
    run(s2);
    expect(r2.job).toBe(field2);

    const s3 = makeTown().state;
    const tent3 = put(s3, 'tent', 10, 10);
    const field3 = put(s3, 'allotment', 18, 10); // 10 kafli: tylko z zajezdnią (≤ 16)
    const r3 = adult(s3, tent3);
    run(s3);
    expect(r3.job).toBeNull();
    put(s3, 'depot', 40, 20);
    run(s3);
    expect(r3.job).toBe(field3);
  });

  it('wolne etaty liczą tylko działające budynki', () => {
    const s = makeTown().state;
    const field = put(s, 'allotment', 12, 10);
    const yard = put(s, 'builders', 6, 10);
    put(s, 'bakery', 16, 10, false); // maszyna farmy z etatami (2)
    adult(s, null, { job: field });
    expect(freeJobs(s, CONTENT)).toBe(2 + 3 + 2);
    site(s, yard).built = 0.5;
    expect(freeJobs(s, CONTENT)).toBe(2 + 2);
    expect([...openJobs(s, CONTENT).keys()]).toEqual([field, field + 2]);
    expect(jobSlots(CONTENT, 'tent')).toBe(0);
    expect(jobSlots(CONTENT, 'school')).toBe(2);
  });

  it('budynek farmy z etatami (młyn) zatrudnia bez stanu budowy', () => {
    const s = makeTown().state;
    const tent = put(s, 'tent', 10, 10);
    const mill = put(s, 'mill', 12, 10, false);
    const r = adult(s, tent);
    run(s);
    expect(r.job).toBe(mill);
  });

  it('determinizm: ten sam stan → te same przydziały', () => {
    const build = (): GameState => {
      const s = makeTown().state;
      const homes = [put(s, 'hut', 8, 4), put(s, 'hut', 14, 4), put(s, 'house', 20, 4), put(s, 'tent', 26, 4)];
      put(s, 'allotment', 8, 8);
      put(s, 'allotment', 14, 8);
      put(s, 'lumber', 20, 8);
      put(s, 'mill', 26, 8, false);
      put(s, 'bakery', 30, 4, false);
      for (let i = 0; i < 16; i++) adult(s, homes[i % homes.length]!);
      return s;
    };
    const a = build();
    const b = build();
    run(a);
    run(b);
    expect(jobsOf(a)).toEqual(jobsOf(b));
    expect(jobsOf(a).filter((j) => j !== null).length).toBe(3 + 3 + 2 + 1 + 2);
  });

  it('w symulacji: przydział co godzinę (settlementHour)', () => {
    const sim: Simulation = makeTown();
    const s = sim.state;
    const tent = placeBuilt(sim, 'tent');
    const field = placeBuilt(sim, 'allotment');
    const r = adult(s, tent);
    runHours(sim, 1);
    expect(r.job).toBe(field);
  });
});
