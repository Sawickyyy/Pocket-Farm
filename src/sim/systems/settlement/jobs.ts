// Zawody i przydział pracy (docs/plan-osada.md §5): co godzinę zwalniamy pracowników budynków, które przestały
// istnieć lub działać na stałe, a wolne etaty dostają bezrobotni dorośli z domem – najbliższy budynek z dojazdem
// pierwszy. Przydziały są stabilne: nikt nie zmienia pracy na bliższą i nie traci jej bez powodu.

import type { Content } from '../../../content/content';
import type { Ctx } from '../../ctx';
import type { At } from '../../events';
import type { GameState, PlacedObject, Resident } from '../../types';
import { centerOf, isBuilt, isOperational, siteOf } from './common';
import { commuteChecker } from './roads';

/** Liczba etatów budynku danego typu (0 = nie zatrudnia). */
export function jobSlots(c: Content, type: string): number {
  return Math.max(0, c.buildings[type]?.jobs?.slots ?? 0);
}

/**
 * Czy budynek zatrzymuje pracowników: ma etaty, jest ukończony i nieuszkodzony (`damage < 0,5`).
 * Awaria i pożar są chwilowe – nie zwalniają (budynek wtedy tylko nie działa).
 */
export function keepsWorkers(s: GameState, c: Content, o: PlacedObject): boolean {
  if (jobSlots(c, o.type) <= 0 || !isBuilt(s, o.uid)) return false;
  return (siteOf(s, o.uid)?.damage ?? 0) < 0.5;
}

/** Liczba pracowników per uid budynku (jedno przejście po mieszkańcach). */
function workerCounts(s: GameState): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of s.settlement.residents) if (r.job !== null) out.set(r.job, (out.get(r.job) ?? 0) + 1);
  return out;
}

/** Wolne etaty w działających budynkach: uid → wolne (> 0), w kolejności `s.objects`. */
export function openJobs(s: GameState, c: Content): Map<number, number> {
  const counts = workerCounts(s);
  const out = new Map<number, number>();
  for (const o of s.objects) {
    const slots = jobSlots(c, o.type);
    if (slots <= 0 || !isOperational(s, o.uid)) continue;
    const free = slots - (counts.get(o.uid) ?? 0);
    if (free > 0) out.set(o.uid, free);
  }
  return out;
}

/** Suma wolnych etatów w działających budynkach (UI, rada). */
export function freeJobs(s: GameState, c: Content): number {
  let sum = 0;
  for (const n of openJobs(s, c).values()) sum += n;
  return sum;
}

/** Bezrobotni dorośli (z domem i bez) – do UI i rady. */
export function unemployed(s: GameState): Resident[] {
  return s.settlement.residents.filter((r) => !r.child && r.job === null);
}

interface Opening {
  uid: number;
  free: number;
  at: At;
}

/** Kandydat do pracy z odległością od domu; `ok` = dojazd (liczony leniwie i zapamiętany dla domu). */
interface Candidate {
  job: Opening;
  dist: number;
  ok: boolean | undefined;
}

/** Co godzinę: zwalnia pracowników niedziałających budynków i przydziela wolne etaty bezrobotnym dorosłym (z dojazdem). */
export function assignJobs(ctx: Ctx): void {
  const { s, c } = ctx;
  const residents = s.settlement.residents;
  if (!residents.length) return;
  const byUid = new Map<number, PlacedObject>();
  for (const o of s.objects) byUid.set(o.uid, o);

  // Zwalnianie: dzieci, brak budynku, budowa/uszkodzenie, budynek bez etatów.
  const staff = new Map<number, Resident[]>();
  for (const r of residents) {
    if (r.job === null) continue;
    const o = byUid.get(r.job);
    if (r.child || !o || !keepsWorkers(s, c, o)) {
      r.job = null;
      continue;
    }
    const list = staff.get(r.job);
    if (list) list.push(r);
    else staff.set(r.job, [r]);
  }
  // Nadmiar ponad etaty (np. po zmianie danych): zostają najstarsi (najmniejsze id).
  for (const [uid, list] of staff) {
    const slots = jobSlots(c, byUid.get(uid)!.type);
    if (list.length <= slots) continue;
    list.sort((a, b) => a.id - b.id);
    for (const r of list.splice(slots)) r.job = null;
  }

  const seekers = residents.filter((r) => !r.child && r.job === null && r.home !== null);
  if (!seekers.length) return;
  const openings: Opening[] = [];
  let free = 0;
  for (const o of s.objects) {
    const slots = jobSlots(c, o.type);
    if (slots <= 0 || !isOperational(s, o.uid)) continue;
    const n = slots - (staff.get(o.uid)?.length ?? 0);
    if (n <= 0) continue;
    openings.push({ uid: o.uid, free: n, at: centerOf(c, o) });
    free += n;
  }
  if (!openings.length) return;
  seekers.sort((a, b) => a.id - b.id);

  // Kandydaci per dom: posortowani po odległości (Manhattan środków), remis – mniejszy uid. Dojazd sprawdzamy
  // dopiero dla wolnego etatu i zapamiętujemy, więc dom × etat liczy się najwyżej raz na godzinę.
  const commute = commuteChecker(ctx);
  const perHome = new Map<number, Candidate[]>();
  for (const r of seekers) {
    const home = r.home!;
    let list = perHome.get(home);
    if (!list) {
      const ho = byUid.get(home);
      list = [];
      if (ho) {
        const hc = centerOf(c, ho);
        for (const job of openings) list.push({ job, dist: Math.abs(job.at.x - hc.x) + Math.abs(job.at.y - hc.y), ok: undefined });
        list.sort((a, b) => a.dist - b.dist || a.job.uid - b.job.uid);
      }
      perHome.set(home, list);
    }
    for (const cand of list) {
      if (cand.job.free <= 0) continue;
      cand.ok ??= commute(home, cand.job.uid);
      if (!cand.ok) continue;
      r.job = cand.job.uid;
      cand.job.free--;
      free--;
      break;
    }
    if (free <= 0) return;
  }
}
