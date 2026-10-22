import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/content/content';
import { newSite } from '../src/sim/systems/settlement/common';
import { createInitialState } from '../src/sim/initialState';
import type { GameState, Resident } from '../src/sim/types';
import { generateWorld } from '../src/sim/world';
import { FADE_H, MORNING, NIGHTFALL, ResidentPlanner, hash01, newPose, samplePlan, type DayPlan, type Pose, type SegTag } from '../src/render/residentPlan';

const c = CONTENT;
const DAY = 5;

/** Czysty stan: bez obiektów farmy, tylko to, co postawi test (geometria pod kontrolą). */
function town(): { s: GameState; put: (type: string, x: number, y: number) => number; resident: (p: Partial<Resident>) => Resident } {
  const s = createInitialState(1_700_000_000_000, 42);
  s.objects = [];
  s.settlement.residents = [];
  const put = (type: string, x: number, y: number): number => {
    const uid = s.nextUid++;
    s.objects.push({ uid, type, x, y });
    return uid;
  };
  const resident = (p: Partial<Resident>): Resident => {
    const id = s.settlement.nextId++;
    const r: Resident = {
      id,
      name: `R${id}`,
      family: id,
      child: false,
      bornDay: -1,
      home: null,
      job: null,
      needs: { food: 0.8, housing: 0.8, work: 0.8, safety: 0.8, fun: 0.8 },
      happiness: 0.8,
      sadDays: 0,
      homelessDays: 0,
      arrivedDay: 0,
      look: 0,
      meals: { eaten: 0, due: 0, kinds: [] },
      mood: { value: 0, untilDay: -1 },
      ...p,
    };
    s.settlement.residents.push(r);
    return r;
  };
  return { s, put, resident };
}

function line(put: (type: string, x: number, y: number) => number, x0: number, y0: number, x1: number, y1: number, type = 'path'): void {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) put(type, x, y);
}

function planner(s: GameState): ResidentPlanner {
  const p = new ResidentPlanner();
  p.refresh(s, c, generateWorld(s.seed));
  return p;
}

/** Próbki planu co ~36 s gry. */
function scan(plan: DayPlan, from = 0, to = 24, step = 0.01): { t: number; pose: Pose }[] {
  const out: { t: number; pose: Pose }[] = [];
  const pose = newPose();
  for (let t = from; t < to; t += step) {
    samplePlan(plan, t, pose);
    out.push({ t, pose: { ...pose } });
  }
  return out;
}

const tagsOf = (plan: DayPlan): Set<SegTag> => new Set(plan.segs.map((s) => s.tag));
const visibleAt = (plan: DayPlan, t: number): boolean => samplePlan(plan, t, newPose()).visible;

/** Dom (24,24) i warsztat (36,24), oba 2×2, fronty na y = 26. */
function workTown(road: boolean) {
  const t = town();
  const home = t.put('house', 24, 24);
  const job = t.put('workshop', 36, 24);
  if (road) line(t.put, 24, 26, 39, 26);
  return { ...t, home, job };
}

describe('residentPlan: harmonogram dnia', () => {
  it('dorosły z pracą: noc w domu, dojście rano, praca, powrót, noc', () => {
    const { s, home, job, resident } = workTown(true);
    const r = resident({ home, job });
    const plan = planner(s).plan(r, DAY);
    const at = (t: number) => samplePlan(plan, t, newPose());
    // noc: w domu, niewidoczny
    expect(at(2).visible).toBe(false);
    expect(at(2).uid).toBe(home);
    expect(at(6.2).visible).toBe(false);
    expect(at(23).visible).toBe(false);
    // dojście 6:30–7:00 (z rozrzutem), potem w pracy
    const morning = scan(plan, 6, 7.5).filter((x) => x.pose.visible);
    expect(morning.length).toBeGreaterThan(0);
    expect(morning.every((x) => x.pose.tag === 'commute')).toBe(true);
    expect(morning[0]!.t).toBeGreaterThanOrEqual(MORNING - 0.26);
    expect(morning[morning.length - 1]!.t).toBeLessThan(7.3);
    const work = at(8.5);
    expect(work.visible).toBe(false);
    expect(work.tag).toBe('work');
    expect(work.uid).toBe(job);
    // powrót ok. 17:00
    const evening = scan(plan, 16.9, 17.8).filter((x) => x.pose.visible && x.pose.tag === 'commute');
    expect(evening.length).toBeGreaterThan(0);
    expect(evening[0]!.t).toBeGreaterThanOrEqual(17);
    // nocą nigdy na ulicy
    for (const x of scan(plan)) if (x.t < MORNING - 0.26 || x.t >= NIGHTFALL) expect(x.pose.visible, `t=${x.t}`).toBe(false);
  });

  it('idzie do pracy po drodze, zaczyna i kończy w drzwiach', () => {
    const { s, home, job, resident } = workTown(true);
    const p = planner(s);
    const plan = p.plan(resident({ home, job }), DAY);
    const go = plan.segs.find((x) => x.kind === 'walk' && x.tag === 'commute')!;
    expect(go.route?.road).toBe(true);
    expect({ x: go.ax, y: go.ay }).toEqual(p.place(home)!.door);
    expect({ x: go.bx, y: go.by }).toEqual(p.place(job)!.door);
    // w trakcie marszu na drodze y = 26
    const mid = samplePlan(plan, (go.t0 + go.t1) / 2, newPose());
    expect(mid.walking).toBe(true);
    expect(Math.floor(mid.y)).toBe(26);
    expect(mid.dx).toBeCloseTo(1);
  });

  it('wieczorem część idzie na plac w zasięgu, wszyscy wracają przed 21:00', () => {
    const { s, home, job, resident, put } = workTown(true);
    put('plaza', 26, 27);
    const p = planner(s);
    let fun = 0;
    for (let i = 0; i < 30; i++) {
      const plan = p.plan(resident({ home, job }), DAY);
      if (plan.segs.some((x) => x.tag === 'fun' && x.t0 >= 17.4)) fun++;
      for (let t = NIGHTFALL; t < 24; t += 0.05) expect(visibleAt(plan, t)).toBe(false);
    }
    expect(fun).toBeGreaterThan(5);
    expect(fun).toBeLessThan(28);
  });

  it('czasem krótkie wyjście przed budynek pracy', () => {
    const { s, home, job, resident } = workTown(true);
    const p = planner(s);
    let breaks = 0;
    for (let i = 0; i < 40; i++) {
      const plan = p.plan(resident({ home, job }), DAY);
      const b = plan.segs.filter((x) => x.tag === 'break');
      if (!b.length) continue;
      breaks++;
      expect(b[0]!.t0).toBeGreaterThanOrEqual(10);
      expect(b[b.length - 1]!.t1).toBeLessThan(15.8);
    }
    expect(breaks).toBeGreaterThan(4);
    expect(breaks).toBeLessThan(36);
  });

  it('rozłożenie w czasie: różne id wychodzą o różnych porach, deterministycznie', () => {
    const { s, home, job, resident } = workTown(true);
    const p = planner(s);
    const starts = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const r = resident({ home, job });
      const plan = p.plan(r, DAY);
      const first = scan(plan, 6, 7.5, 0.005).find((x) => x.pose.visible)!;
      starts.add(Math.round(first.t * 100));
      // ten sam mieszkaniec i dzień → ten sam plan
      expect(p.plan(r, DAY).segs.map((x) => [x.kind, x.t0, x.t1])).toEqual(plan.segs.map((x) => [x.kind, x.t0, x.t1]));
    }
    expect(starts.size).toBeGreaterThan(10);
    expect(hash01(1, 2, 3)).toBe(hash01(1, 2, 3));
    expect(hash01(1, 2, 3)).not.toBe(hash01(2, 2, 3));
  });

  it('praca nieczynna (awaria) → dzień jak bezrobotny', () => {
    const { s, home, job, resident } = workTown(true);
    s.settlement.sites[String(job)] = { ...newSite(1), broken: true };
    const plan = planner(s).plan(resident({ home, job }), DAY);
    expect(tagsOf(plan).has('work')).toBe(false);
    expect(tagsOf(plan).has('commute')).toBe(false);
  });

  it('bezrobotny spaceruje za dnia, nocą w domu', () => {
    const { s, home, resident } = workTown(true);
    const p = planner(s);
    for (let i = 0; i < 10; i++) {
      const plan = p.plan(resident({ home }), DAY);
      const vis = scan(plan).filter((x) => x.pose.visible);
      expect(vis.length).toBeGreaterThan(0);
      expect(vis.every((x) => x.t >= 7 && x.t < NIGHTFALL)).toBe(true);
      expect(tagsOf(plan).has('work')).toBe(false);
      // spacer w okolicy domu (≤ ~4 kafle od drzwi)
      const door = p.place(home)!.door;
      for (const x of vis) expect(Math.hypot(x.pose.x - door.x, x.pose.y - door.y)).toBeLessThan(5.5);
    }
  });

  it('bezdomny bez pracy jest niewidoczny', () => {
    const { s, resident } = workTown(true);
    const plan = planner(s).plan(resident({}), DAY);
    expect(scan(plan).some((x) => x.pose.visible)).toBe(false);
  });
});

describe('residentPlan: dzieci i szkoła', () => {
  it('dziecko w zasięgu szkoły: 8–13 w szkole, popołudnie na dworze, wcześniej w domu', () => {
    const { s, home, resident, put } = workTown(true);
    const school = put('school', 30, 24);
    resident({ home, job: school }); // nauczyciel – szkoła ma obsadę
    const p = planner(s);
    for (let i = 0; i < 8; i++) {
      const plan = p.plan(resident({ home, child: true }), DAY);
      const at10 = samplePlan(plan, 10, newPose());
      expect(at10.visible).toBe(false);
      expect(at10.tag).toBe('school');
      expect(at10.uid).toBe(school);
      const toSchool = plan.segs.find((x) => x.kind === 'walk' && x.tag === 'school')!;
      expect(toSchool.t1).toBeLessThanOrEqual(8.05);
      expect(toSchool.t0).toBeGreaterThan(MORNING);
      expect(scan(plan, 13.3, 19).some((x) => x.pose.visible)).toBe(true);
      for (let t = NIGHTFALL - 1; t < 24; t += 0.05) expect(visibleAt(plan, t)).toBe(false);
    }
  });

  it('bez nauczyciela albo poza zasięgiem – bez szkoły', () => {
    const { s, home, resident, put } = workTown(true);
    put('school', 30, 24); // brak obsady
    const plan = planner(s).plan(resident({ home, child: true }), DAY);
    expect(tagsOf(plan).has('school')).toBe(false);
    expect(scan(plan, 8, 19).some((x) => x.pose.visible)).toBe(true);

    const far = workTown(true);
    const school = far.put('school', 50, 50);
    far.resident({ home: far.home, job: school });
    expect(tagsOf(planner(far.s).plan(far.resident({ home: far.home, child: true }), DAY)).has('school')).toBe(false);
  });
});

describe('residentPlan: trasy', () => {
  it('po drodze szybciej niż na przełaj, bez drogi – prosta linia', () => {
    const withRoad = workTown(true);
    const without = workTown(false);
    const pr = planner(withRoad.s);
    const po = planner(without.s);
    const a = pr.place(withRoad.home)!.door;
    const b = pr.place(withRoad.job)!.door;
    const road = pr.route(a, b);
    const off = po.route(po.place(without.home)!.door, po.place(without.job)!.door);
    expect(road.road).toBe(true);
    expect(off.road).toBe(false);
    expect(off.pts).toHaveLength(2);
    expect(road.hours).toBeLessThan(off.hours);
    // trasa drogą: kroki co jeden kafel
    for (let i = 1; i < road.pts.length; i++) expect(Math.hypot(road.pts[i]!.x - road.pts[i - 1]!.x, road.pts[i]!.y - road.pts[i - 1]!.y)).toBeCloseTo(1);
  });

  it('kamienna droga przyspiesza marsz', () => {
    const dirt = workTown(false);
    line(dirt.put, 24, 26, 39, 26, 'path');
    const stone = workTown(false);
    line(stone.put, 24, 26, 39, 26, 'road');
    const pd = planner(dirt.s);
    const ps = planner(stone.s);
    const hd = pd.route(pd.place(dirt.home)!.door, pd.place(dirt.job)!.door).hours;
    const hs = ps.route(ps.place(stone.home)!.door, ps.place(stone.job)!.door).hours;
    expect(hs).toBeLessThan(hd * 0.85);
  });

  it('na przełaj omija budynki', () => {
    const { s, home, job, put } = workTown(false);
    const blocker = put('warehouse', 30, 25); // 2×2 na linii y = 26
    const p = planner(s);
    const r = p.route(p.place(home)!.door, p.place(job)!.door);
    expect(r.road).toBe(false);
    expect(r.pts.length).toBeGreaterThan(2);
    // żaden punkt (ani próbka odcinka) nie wchodzi w obrys magazynu
    const o = s.objects.find((x) => x.uid === blocker)!;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1]!;
      const b = r.pts[i]!;
      for (let t = 0; t <= 1; t += 0.05) {
        const x = Math.floor(a.x + (b.x - a.x) * t);
        const y = Math.floor(a.y + (b.y - a.y) * t);
        expect(x >= o.x && x < o.x + 2 && y >= o.y && y < o.y + 2, `${x},${y}`).toBe(false);
      }
    }
  });

  it('cache tras reaguje na nową drogę', () => {
    const { s, home, job, put } = workTown(false);
    const world = generateWorld(s.seed);
    const p = new ResidentPlanner();
    p.refresh(s, c, world);
    const a = p.place(home)!.door;
    const b = p.place(job)!.door;
    const before = p.route(a, b);
    expect(before.road).toBe(false);
    expect(p.route(a, b)).toBe(before); // z cache
    expect(p.cachedRoutes).toBe(1);
    // ten sam stan → bez zmian
    expect(p.refresh(s, c, world)).toBe(false);
    expect(p.route(a, b)).toBe(before);
    line(put, 24, 26, 39, 26);
    expect(p.refresh(s, c, world)).toBe(true);
    expect(p.cachedRoutes).toBe(0);
    const after = p.route(p.place(home)!.door, p.place(job)!.door);
    expect(after.road).toBe(true);
    expect(after).not.toBe(before);
  });

  it('zmiana obsady zmienia sygnaturę planów, ale nie tras', () => {
    const { s, home, job, resident } = workTown(true);
    const world = generateWorld(s.seed);
    const p = new ResidentPlanner();
    p.refresh(s, c, world);
    p.route(p.place(home)!.door, p.place(job)!.door);
    const geo = p.geometry;
    const sig = p.signature;
    resident({ home, job });
    expect(p.refresh(s, c, world)).toBe(true);
    expect(p.geometry).toBe(geo);
    expect(p.signature).not.toBe(sig);
    expect(p.cachedRoutes).toBe(1);
  });
});

describe('residentPlan: próbkowanie', () => {
  it('pojawia się i znika w drzwiach (przenikanie), przy ograniczeniu ruchu stoi u celu', () => {
    const { s, home, job, resident } = workTown(true);
    const plan = planner(s).plan(resident({ home, job }), DAY);
    const go = plan.segs.find((x) => x.kind === 'walk' && x.tag === 'commute')!;
    expect(go.fadeIn).toBe(true);
    expect(samplePlan(plan, go.t0 + FADE_H / 2, newPose()).alpha).toBeCloseTo(0.5, 1);
    expect(samplePlan(plan, (go.t0 + go.t1) / 2, newPose()).alpha).toBe(1);
    const still = samplePlan(plan, go.t0 + (go.t1 - go.t0) * 0.3, newPose(), true);
    expect(still.walking).toBe(false);
    expect(still.x).toBe(go.bx);
    expect(still.y).toBe(go.by);
    expect(still.alpha).toBe(1);
  });

  it('boczne przesunięcie na prawo od kierunku marszu, zero w drzwiach', () => {
    const { s, home, job, resident } = workTown(true);
    const plan = planner(s).plan(resident({ home, job }), DAY);
    const go = plan.segs.find((x) => x.kind === 'walk' && x.tag === 'commute')!;
    const mid = (go.t0 + go.t1) / 2;
    const plain = samplePlan(plan, mid, newPose());
    const lane = samplePlan(plan, mid, newPose(), false, 0.2);
    // marsz w +x → prawa strona to +y
    expect(lane.y - plain.y).toBeCloseTo(0.2);
    const start = samplePlan(plan, go.t0 + 1e-4, newPose(), false, 0.2);
    expect(Math.abs(start.y - go.ay)).toBeLessThan(0.01);
  });
});
