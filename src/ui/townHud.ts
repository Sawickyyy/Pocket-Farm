// Licznik osady w górnym pasku (mieszkańcy, buźka szczęścia, etap) oraz czyste helpery tekstów:
// komunikaty zdarzeń osady, odznaka kafla w menu, linia raportu po powrocie (docs/plan-osada.md §15).
// Helpery nie dotykają DOM-u – testy: tests/townHud.test.ts.

import { CONTENT, type Content } from '../content/content';
import { buildingName, fmt, getLanguage, has, onLanguageChange, t, type Lang } from '../i18n/i18n';
import type { At, SimEvent } from '../sim/events';
import { activeEvents } from '../sim/systems/settlement/events';
import { averageHappiness } from '../sim/systems/settlement/needs';
import type { GameState } from '../sim/types';
import type { App } from './app';
import { h } from './dom';
import { plural } from './format';
import { proposalTitle } from './settlementText';
import { icEl } from './uiIcons';

// ---------------------------------------------------------------- buźka i stan alarmu

export type Face = 'face-happy' | 'face-ok' | 'face-sad';
export const FACE_HAPPY = 0.6;
export const FACE_OK = 0.4;

/** Buźka dla średniego szczęścia: ≥ 0,6 wesoła, ≥ 0,4 taka sobie, poniżej smutna. */
export const faceFor = (happiness: number): Face => (happiness >= FACE_HAPPY ? 'face-happy' : happiness >= FACE_OK ? 'face-ok' : 'face-sad');

/** Alarm licznika: pożar (czerwona obwódka) > kłopoty (awaria, epidemia, kryzys) > dobre wieści. */
export type TownAlert = 'fire' | 'bad' | 'good' | null;

const BAD_EVENTS = new Set(['breakdown', 'epidemic', 'crisis']);
const GOOD_EVENTS = new Set(['festival', 'harvest', 'richCaravan']);

export function townAlert(s: GameState): TownAlert {
  const sites = Object.values(s.settlement.sites);
  if (sites.some((x) => x.fire > 0)) return 'fire';
  const events = activeEvents(s);
  if (sites.some((x) => x.broken) || events.some((e) => BAD_EVENTS.has(e.kind))) return 'bad';
  return events.some((e) => GOOD_EVENTS.has(e.kind)) ? 'good' : null;
}

/** Licznik widać, gdy osada ma mieszkańców albo choć jeden dom (także w budowie). */
export function townVisible(s: GameState, c: Content = CONTENT): boolean {
  return s.settlement.residents.length > 0 || s.objects.some((o) => c.buildings[o.type]?.kind === 'house');
}

/** Odznaka kafla „Osada” w menu: wnioski rady + złe wydarzenia (płonące i zepsute budynki, epidemie, kryzys). */
export function townTileBadge(s: GameState): { n: number; urgent: boolean } {
  let burning = 0;
  let broken = 0;
  for (const site of Object.values(s.settlement.sites)) {
    if (site.fire > 0) burning++;
    if (site.broken) broken++;
  }
  const other = activeEvents(s).filter((e) => e.kind === 'epidemic' || e.kind === 'crisis').length;
  return { n: s.settlement.proposals.length + burning + broken + other, urgent: burning > 0 };
}

// ---------------------------------------------------------------- nazwy

/** Nazwisko z pełnego imienia („Ala Nowak” → „Nowak”). */
export function surnameOf(name: string): string {
  const i = name.indexOf(' ');
  return i < 0 ? '' : name.slice(i + 1);
}

/** Imię („Ala Nowak” → „Ala”). */
export const givenOf = (name: string): string => name.split(' ')[0] ?? name;

const PL_FAMILY: Record<string, string> = { Sokół: 'Sokołów', Wróbel: 'Wróblów', Stępień: 'Stępniów', Kozioł: 'Kozłów', Kocioł: 'Kotłów' };

/** Rodzina w zdaniu „Przybyła rodzina …”: po polsku dopełniacz liczby mnogiej (Nowak → Nowaków), po angielsku bez zmian. */
export function familyName(surname: string, lang: Lang = getLanguage()): string {
  if (lang !== 'pl' || !surname) return surname;
  const ex = PL_FAMILY[surname];
  if (ex) return ex;
  if (/(sk|ck|dzk)[ia]$/.test(surname)) return `${surname.slice(0, -1)}ich`;
  if (/ek$/.test(surname)) return `${surname.slice(0, -2)}ków`;
  if (/a$/.test(surname)) return `${surname.slice(0, -1)}ów`;
  if (/ń$/.test(surname)) return `${surname.slice(0, -1)}niów`;
  return `${surname}ów`;
}

const people = (n: number): string => plural(n, t('townEvent.people.one', { n }), t('townEvent.people.few', { n }), t('townEvent.people.many', { n }));
const daysWord = (n: number): string => plural(n, t('townEvent.days.one', { n }), t('townEvent.days.few', { n }), t('townEvent.days.many', { n }));

function buildingOf(s: GameState, uid: number): string {
  const o = s.objects.find((x) => x.uid === uid);
  return o ? buildingName(o.type) : t('townEvent.someBuilding');
}

function residentName(s: GameState, id: number): string {
  return givenOf(s.settlement.residents.find((r) => r.id === id)?.name ?? '?');
}

/** „ze Starej Wsi”, „z Nadrzecza” – własna odmiana, gdy jest; inaczej nazwa partnera w nawiasie. */
function caravanFrom(from: string): string {
  return has(`townEvent.from.${from}`) ? t(`townEvent.from.${from}`) : `(${t(`partner.${from}`)})`;
}

// ---------------------------------------------------------------- komunikaty zdarzeń

export interface TownAction {
  label: string;
  /** Kamera na punkt (kafle, środek budynku). */
  focus?: At;
  /** Zakładka arkusza „Osada”. */
  tab?: string;
}

export interface TownToast {
  /** Rodzaj komunikatu (do łączenia i testów). */
  key: string;
  kind: 'info' | 'good' | 'warn';
  text: string;
  action?: TownAction;
  /** Ważność: przy zalewie zostają najważniejsze. */
  prio: number;
}

/** Najwięcej komunikatów osady z jednej paczki zdarzeń (pozostałe trafiają tylko do kroniki). */
export const MAX_TOWN_TOASTS = 3;

/** Zdarzenia osady z komunikatem (tierUp i specialized mają własne „momenty”, produced – nic). */
export const TOWN_TOAST_EVENTS: ReadonlySet<SimEvent['type']> = new Set<SimEvent['type']>([
  'territory', 'constructed', 'arrived', 'left', 'born', 'relation', 'fire', 'fireOut', 'breakdown', 'repaired', 'epidemic',
  'epidemicOver', 'crisis', 'goodEvent', 'caravan', 'caravanLeft', 'traded', 'proposal', 'decided', 'budget', 'unpaid',
]);

type Of<K extends SimEvent['type']> = Extract<SimEvent, { type: K }>;

/**
 * Komunikaty dla paczki zdarzeń osady: podobne łączy (dwie budowy → „Skończone budowy: 2”), sortuje wg ważności
 * i zostawia najwyżej MAX_TOWN_TOASTS. Stan `s` = po zdarzeniach (imiona, nazwy budynków).
 */
export function townToasts(events: readonly SimEvent[], s: GameState): TownToast[] {
  const by = <K extends SimEvent['type']>(type: K): Of<K>[] => events.filter((e): e is Of<K> => e.type === type);
  const out: TownToast[] = [];
  const show = t('townEvent.show');
  const push = (key: string, kind: TownToast['kind'], text: string, prio: number, action?: TownAction) =>
    out.push(action ? { key, kind, text, prio, action } : { key, kind, text, prio });

  const fires = by('fire');
  if (fires.length === 1) push('fire', 'warn', t('townEvent.fire', { building: buildingOf(s, fires[0]!.uid) }), 100, { label: show, focus: fires[0]!.at });
  else if (fires.length > 1) push('fire', 'warn', t('townEvent.fire.many', { n: fires.length }), 100, { label: show, focus: fires[0]!.at });

  const unpaid = by('unpaid').at(-1);
  if (unpaid) push('unpaid', 'warn', t('townEvent.unpaid', { coins: fmt(unpaid.missing) }), 90, { label: t('townEvent.budget'), tab: 'budget' });

  for (const reason of ['unhappy', 'homeless'] as const) {
    const n = by('left')
      .filter((e) => e.reason === reason)
      .reduce((a, e) => a + e.count, 0);
    if (n) push(`left.${reason}`, 'warn', t(`townEvent.left.${reason}.${n === 1 ? 'one' : 'many'}`, { n }), 80);
  }

  const broken = by('breakdown');
  if (broken.length) push('breakdown', 'warn', broken.length === 1 ? t('townEvent.breakdown', { building: buildingOf(s, broken[0]!.uid) }) : t('townEvent.breakdown.many', { n: broken.length }), 70, { label: show, focus: broken[0]!.at });

  const sick = by('epidemic')[0];
  if (sick) push('epidemic', 'warn', t('townEvent.epidemic', { building: buildingOf(s, sick.home) }), 70, { label: show, focus: sick.at });

  const crisis = by('crisis')[0];
  if (crisis) push('crisis', 'warn', t('townEvent.crisis', { days: daysWord(crisis.days) }), 60);

  const out1 = by('fireOut');
  const damaged = out1.find((e) => e.damaged);
  if (damaged) push('fireOut', 'warn', t('townEvent.fireOut.damaged', { building: buildingOf(s, damaged.uid) }), 55, { label: show, focus: damaged.at });
  else if (out1.length) push('fireOut', 'good', t('townEvent.fireOut', { building: buildingOf(s, out1[0]!.uid) }), 55);

  const arrived = by('arrived');
  if (arrived.length === 1) {
    const e = arrived[0]!;
    const member = s.settlement.residents.find((r) => r.family === e.family && !r.child) ?? s.settlement.residents.find((r) => r.family === e.family);
    const surname = member ? surnameOf(member.name) : '';
    push('arrived', 'good', surname ? t('townEvent.arrived', { family: familyName(surname), people: people(e.count) }) : t('townEvent.arrived.anon', { people: people(e.count) }), 50);
  } else if (arrived.length > 1) {
    push('arrived', 'good', t('townEvent.arrived.many', { families: arrived.length, people: people(arrived.reduce((a, e) => a + e.count, 0)) }), 50);
  }

  const weddings = by('relation').filter((e) => e.kind === 'partner');
  if (weddings.length) {
    const w = weddings[0]!;
    push('wedding', 'good', t('townEvent.wedding', { a: residentName(s, w.a), b: residentName(s, w.b) }), 45);
  }

  const born = by('born');
  if (born.length === 1) push('born', 'good', t('townEvent.born', { name: born[0]!.name }), 45);
  else if (born.length > 1) push('born', 'good', t('townEvent.born.many', { n: born.length }), 45);

  const caravan = by('caravan')[0];
  if (caravan) push('caravan', 'good', t('townEvent.caravan', { from: caravanFrom(caravan.from) }), 40, { label: t('townEvent.trade'), tab: 'trade' });

  const proposals = by('proposal');
  if (proposals.length === 1) push('proposal', 'info', t('townEvent.proposal', { title: proposalTitle(proposals[0]!.tpl) }), 35, { label: t('townEvent.council'), tab: 'council' });
  else if (proposals.length > 1) push('proposal', 'info', t('townEvent.proposal.many', { n: proposals.length }), 35, { label: t('townEvent.council'), tab: 'council' });

  for (const e of by('goodEvent')) push(`good.${e.kind}`, 'good', t(`townEvent.good.${e.kind}`), 35);

  const built = by('constructed');
  if (built.length === 1) push('constructed', 'good', t('townEvent.constructed', { building: buildingName(built[0]!.building) }), 30);
  else if (built.length > 1) push('constructed', 'good', t('townEvent.constructed.many', { n: built.length }), 30);

  const repaired = by('repaired');
  if (repaired.length) push('repaired', 'good', repaired.length === 1 ? t('townEvent.repaired', { building: buildingOf(s, repaired[0]!.uid) }) : t('townEvent.repaired.many', { n: repaired.length }), 25);

  const healed = by('epidemicOver')[0];
  if (healed) push('epidemicOver', 'good', t('townEvent.epidemicOver', { building: buildingOf(s, healed.home) }), 25);

  if (by('territory').length) push('territory', 'good', t('townEvent.territory'), 20);

  // Auto-eksport przy przyjeździe karawany (ręczny handel ma odzew w panelu handlu).
  if (caravan) {
    const coins = by('traded')
      .filter((e) => e.dir === 'export')
      .reduce((a, e) => a + e.coins, 0);
    if (coins > 0) push('exported', 'good', t('townEvent.exported', { coins: fmt(coins) }), 20);
  }

  const budget = by('budget').at(-1);
  if (budget && budget.net < 0) push('budget', 'warn', t('townEvent.budget.minus', { coins: fmt(-budget.net) }), 15, { label: t('townEvent.budget'), tab: 'budget' });
  else if (budget && budget.net > 0 && (budget.day + 1) % BUDGET_EVERY === 0) push('budget', 'good', t('townEvent.budget.plus', { coins: fmt(budget.net) }), 15);

  const decided = by('decided').at(-1);
  if (decided) push('decided', 'info', t(decided.approve ? 'townEvent.decided.yes' : 'townEvent.decided.no', { title: proposalTitle(decided.tpl) }), 10);

  const left = by('caravanLeft')[0];
  if (left && !caravan) push('caravanLeft', 'info', t('townEvent.caravanLeft', { from: caravanFrom(left.from) }), 5);

  return out.sort((a, b) => b.prio - a.prio).slice(0, MAX_TOWN_TOASTS);
}

/** Dodatni bilans dnia pokazujemy co tyle dni (ujemny – zawsze). */
export const BUDGET_EVERY = 3;

// ---------------------------------------------------------------- awans etapu

/** Budynki odblokowane na danym etapie (do „momentu” awansu). */
export function tierUnlocks(tier: number, c: Content = CONTENT): string[] {
  return c.buildingList.filter((b) => (b.tier ?? -1) === tier).map((b) => b.id);
}

// ---------------------------------------------------------------- raport po powrocie

/** Krótka linia raportu powrotu o przyjazdach i wyjazdach (pusta lista, gdy nic się nie zmieniło). */
export function townReportLines(r: { arrived?: number; left?: number }): string[] {
  const arrived = r.arrived ?? 0;
  const left = r.left ?? 0;
  if (arrived && left) return [t('report.town.both', { arrived: fmt(arrived), left: fmt(left) })];
  if (arrived) return [t('report.town.arrived', { n: fmt(arrived) })];
  if (left) return [t('report.town.left', { n: fmt(left) })];
  return [];
}

// ---------------------------------------------------------------- licznik w górnym pasku

interface ChipView {
  visible: boolean;
  pop: number;
  face: Face;
  tier: number;
  alert: TownAlert;
}

function chipView(s: GameState): ChipView {
  return {
    visible: townVisible(s),
    pop: s.settlement.residents.length,
    face: faceFor(averageHappiness(s)),
    tier: s.settlement.peakTier,
    alert: townAlert(s),
  };
}

export function mountTownHud(app: App): void {
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;
  const count = h('output', { class: 'town-chip-count' });
  const face = icEl('face-happy', 'town-chip-face');
  const tierNum = h('b', { class: 'town-chip-tier-n' });
  const chip = h(
    'button',
    { class: 'stat town-chip', type: 'button' },
    h('span', { class: 'town-chip-ico' }, icEl('people', 'town-chip-people'), face),
    count,
    h('span', { class: 'town-chip-tier', attrs: { 'aria-hidden': 'true' } }, icEl('crown', 'town-chip-crown'), tierNum),
  );
  chip.hidden = true;
  const coins = topbar.querySelector('.coins');
  if (coins) coins.after(chip);
  else topbar.prepend(chip);
  chip.addEventListener('click', () => {
    app.click();
    app.openSheet('settlement');
  });

  let shown: ChipView | null = null;
  let createdAt = app.store.get().createdAt;

  /** Unosząca się różnica („+3” przyjazd unosi się do licznika, „−1” wypada w dół). */
  const floatDelta = (d: number) => {
    if (app.reducedMotion()) return;
    const el = h('span', { class: `town-chip-delta ${d > 0 ? 'up' : 'down'}`, text: d > 0 ? `+${d}` : `−${-d}`, attrs: { 'aria-hidden': 'true' } });
    chip.append(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 2000);
  };

  const restart = (cls: string) => {
    chip.classList.remove(cls);
    void chip.offsetWidth;
    chip.classList.add(cls);
  };

  const render = (s: GameState, force = false) => {
    const v = chipView(s);
    const prev = shown;
    if (!force && prev && prev.visible === v.visible && prev.pop === v.pop && prev.face === v.face && prev.tier === v.tier && prev.alert === v.alert) return;
    shown = v;
    // Nowy stan gry (import, reset) – bez animacji różnicy.
    const replaced = s.createdAt !== createdAt;
    createdAt = s.createdAt;

    if (chip.hidden === v.visible) {
      chip.hidden = !v.visible;
      if (v.visible && prev && !replaced && !app.reducedMotion()) restart('enter');
    }
    count.textContent = fmt(v.pop);
    face.className = `ic ic-${v.face} town-chip-face`;
    tierNum.textContent = String(v.tier + 1);
    if (v.alert) chip.dataset.alert = v.alert;
    else delete chip.dataset.alert;
    const tierName = t(`tier.${CONTENT.settlement.tiers[v.tier]?.id ?? 'camp'}`);
    const alert = v.alert ? ` ${t(`townHud.alert.${v.alert}`)}` : '';
    chip.setAttribute('aria-label', `${t('townHud.chip', { n: fmt(v.pop), mood: t(`townHud.mood.${v.face.slice(5)}`), tier: v.tier + 1, tierName })}${alert}`);
    chip.title = tierName;

    if (prev && !replaced && v.visible) {
      const d = v.pop - prev.pop;
      if (d) {
        floatDelta(d);
        if (!app.reducedMotion()) restart(d > 0 ? 'bump' : 'drop');
      }
      if (v.tier > prev.tier && !app.reducedMotion()) restart('tier-up');
    }
  };

  render(app.store.get());
  app.store.subscribe((s) => render(s));
  onLanguageChange(() => render(app.store.get(), true));
}
