// Panel „Osada”: przegląd, mieszkańcy, budżet, rada, handel, kronika + karta mieszkańca (docs/plan-osada.md §15).
// Arkusze: 'settlement' (zakładki) i 'resident' (arg: id mieszkańca). Widok przebudowuje się tylko przy zmianie
// sygnatury (zaokrąglone dane), a paski i procenty odświeża w miejscu `tick`.

import { CONTENT, NEEDS, parseKey, type CoverageKind, type NeedId } from '../../content/content';
import { buildingName, fmt, itemName, t } from '../../i18n/i18n';
import { buildingIconUrl, itemIconUrl } from '../../render/art/atlas';
import { DAY_MS } from '../../sim/calendar';
import {
  coverageAtHome,
  freeHousing,
  hasService,
  isOperational,
  objectByUid,
  professionOf,
  storageCap,
  storageUsed,
  tierOf,
  wageOf,
  workersAt,
} from '../../sim/systems/settlement/common';
import { priceMult } from '../../sim/systems/settlement/events';
import { foodStock, moodOf } from '../../sim/systems/settlement/needs';
import { arrivalBlock } from '../../sim/systems/settlement/population';
import { partnerOf, relationsOf } from '../../sim/systems/settlement/social';
import { territoryCost, territoryLimit } from '../../sim/systems/settlement/territory';
import type { GameState, Relation, Resident } from '../../sim/types';
import type { App } from '../app';
import { h } from '../dom';
import { keyLabelHtml } from '../format';
import {
  EXPENSE_FIELDS,
  INCOME_FIELDS,
  ageText,
  balanceText,
  budgetSummary,
  chronicleIcon,
  chronicleText,
  dayHourText,
  dayText,
  daysText,
  eventDesc,
  eventIcon,
  eventTitle,
  faceIcon,
  givenName,
  hourOfMs,
  hourText,
  moodLabel,
  moodLevel,
  pct,
  proposalDesc,
  proposalEffect,
  proposalTitle,
  relationLabel,
  signed,
  timeLeftText,
  type BudgetLine,
} from '../settlementText';
import type { SheetManager } from '../sheet';
import { ic, icEl } from '../uiIcons';
import { viewCtx } from '../view';
import { bar, btn, coins, empty, setBar } from './common';

const C = CONTENT;
const ST = C.settlement;

type Tab = 'overview' | 'residents' | 'budget' | 'council' | 'trade' | 'chronicle';
type Filter = 'all' | 'jobless' | 'homeless' | 'sad' | 'kids';

const FILTERS: Filter[] = ['all', 'jobless', 'homeless', 'sad', 'kids'];
const NEED_ICONS: Record<NeedId, string> = { food: 'bread', housing: 'cottage', work: 'briefcase', safety: 'shield', fun: 'balloon' };
const LINE_ICONS: Record<BudgetLine, string> = {
  taxes: 'scales',
  sales: 'bread',
  exports: 'wagon',
  wages: 'briefcase',
  upkeep: 'wrench',
  imports: 'crate',
  investments: 'hammer',
};
const PROPOSAL_ICONS: Record<string, string> = { build: 'hammer', policy: 'scales', event: 'balloon', grant: 'crate' };
/** Towary, którymi interesują się karawany (auto-eksport). */
const TRADE_GOODS = [...new Set(ST.partners.flatMap((p) => p.buys))];
/** Ile sztuk zostaje w magazynie przy auto-eksporcie (docs/plan-osada.md §12). */
const EXPORT_KEEP = 5;

// ---------------------------------------------------------------- stan widoku (nie trafia do zapisu)

const view = {
  renaming: false,
  draft: '',
  filter: 'all' as Filter,
  /** false = najsmutniejsi najpierw. */
  happyFirst: false,
  /** Suwak podatku w ruchu – nie przebudowujemy widoku pod palcem. */
  taxDrag: false,
  taxSig: '',
};

// ---------------------------------------------------------------- zapytania

const residentById = (s: GameState, id: number): Resident | undefined => s.settlement.residents.find((r) => r.id === id);

/** Suma wolnych miejsc w ukończonych domach. */
function freeHomes(s: GameState): number {
  let n = 0;
  for (const v of freeHousing(s, C).values()) n += Math.max(0, v);
  return n;
}

/** Wolne etaty w działających budynkach. */
function freeJobs(s: GameState): number {
  let n = 0;
  for (const o of s.objects) {
    const slots = C.buildings[o.type]?.jobs?.slots ?? 0;
    if (slots > 0 && isOperational(s, o.uid)) n += Math.max(0, slots - workersAt(s, o.uid).length);
  }
  return n;
}

function avgNeeds(s: GameState): Record<NeedId, number> {
  const out = { food: 0, housing: 0, work: 0, safety: 0, fun: 0 } as Record<NeedId, number>;
  const rs = s.settlement.residents;
  if (!rs.length) return out;
  for (const r of rs) for (const n of NEEDS) out[n] += r.needs[n];
  for (const n of NEEDS) out[n] /= rs.length;
  return out;
}

function avgHappiness(s: GameState): number {
  const rs = s.settlement.residents;
  return rs.length ? rs.reduce((a, r) => a + r.happiness, 0) / rs.length : 0;
}

/** Punkty odżywcze zjadane na dobę (posiłki: dorosły 1, dziecko 0,5). */
function dailyFood(s: GameState): number {
  let n = 0;
  for (const r of s.settlement.residents) n += r.child ? 0.5 : 1;
  return n * ST.constants.mealHours.length;
}

const hasHall = (s: GameState): boolean => s.objects.some((o) => C.buildings[o.type]?.service?.kind === 'hall' && isOperational(s, o.uid));
const hasTradepost = (s: GameState): boolean => s.objects.some((o) => C.buildings[o.type]?.service?.kind === 'trade');

function stockOf(s: GameState, item: string): number {
  let n = 0;
  for (const [key, v] of Object.entries(s.inventory)) if (v > 0 && parseKey(key).id === item) n += v;
  return n;
}

const keysOf = (s: GameState, item: string): [string, number][] => Object.entries(s.inventory).filter(([key, v]) => v > 0 && parseKey(key).id === item);

function matchesFilter(r: Resident, f: Filter): boolean {
  switch (f) {
    case 'jobless':
      return !r.child && r.job === null;
    case 'homeless':
      return r.home === null;
    case 'sad':
      return moodLevel(r.happiness) === 'sad';
    case 'kids':
      return r.child;
    default:
      return true;
  }
}

/** Zawód albo „bez pracy” / „dziecko”. */
function roleText(s: GameState, r: Resident): string {
  if (r.child) return t('town.role.child');
  const p = professionOf(s, C, r);
  return p ? t(`profession.${p}`) : t('town.role.jobless');
}

// ---------------------------------------------------------------- małe klocki widoku

/** Ikona z kontraktu z zapasową literą, dopóki ikona nie jest jeszcze narysowana. */
const iconCache = new Map<string, boolean>();
function hasIcon(name: string): boolean {
  let v = iconCache.get(name);
  if (v === undefined) {
    v = typeof document !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue(`--icon-${name}`).trim() !== '';
    iconCache.set(name, v);
  }
  return v;
}

/** Miniatura postaci: kolorowy medalion (wg wyglądu) z ikoną albo inicjałem. */
function avatar(r: Resident, big = false): HTMLElement {
  const icon = r.child ? 'baby' : 'people';
  const el = h('span', { class: `stl-av look-${((r.look % 8) + 8) % 8}${big ? ' big' : ''}${r.child ? ' kid' : ''}`, attrs: { 'aria-hidden': 'true' } });
  if (hasIcon(icon)) el.append(icEl(icon));
  else el.append(h('b', { text: givenName(r.name).slice(0, 1).toUpperCase() }));
  return el;
}

const face = (hp: number): HTMLElement => h('i', { class: `ic ic-${faceIcon(hp)} stl-face ${moodLevel(hp)}`, attrs: { 'aria-hidden': 'true' } });

function section(icon: string, title: string, ...children: (HTMLElement | null)[]): HTMLElement {
  return h('section', { class: 'stl-sec' }, h('h3', { html: `${ic(icon)}<span>${title}</span>` }), ...children);
}

function tile(icon: string, value: string, label: string, sub?: string, cls = ''): HTMLElement {
  return h(
    'div',
    { class: `stl-tile ${cls}` },
    h('span', { class: 'stl-tile-ic', html: ic(icon) }),
    h('b', { class: 'stl-tile-v', text: value }),
    h('span', { class: 'stl-tile-l', text: label }),
    sub ? h('small', { text: sub }) : null,
  );
}

/** Wiersz z paskiem: ikona, nazwa, pasek (klucz do tick) i wartość procentowa. */
function meter(icon: string, label: string, ratio: number, key: string, warnBelow = 0.35, hint?: string | null): HTMLElement {
  return h(
    'div',
    { class: `stl-meter ${moodLevel(ratio)}`, attrs: { 'data-meter': key } },
    h('span', { class: 'stl-meter-l', html: `${ic(icon)}<span>${label}</span>` }),
    h('span', { class: 'stl-meter-v', text: pct(ratio), attrs: { 'data-val': key } }),
    bar(ratio, ratio < warnBelow, key),
    hint ? h('small', { class: 'stl-hint', html: `${ic('warning')}<span>${hint}</span>` }) : null,
  );
}

/** Odświeżenie paska i procentu w miejscu (tick). */
function updateMeter(root: HTMLElement, key: string, ratio: number): void {
  setBar(root, key, ratio);
  const v = root.querySelector<HTMLElement>(`[data-val="${key}"]`);
  const text = pct(ratio);
  if (v && v.textContent !== text) v.textContent = text;
  const m = root.querySelector<HTMLElement>(`[data-meter="${key}"]`);
  if (m) {
    const lvl = moodLevel(ratio);
    if (!m.classList.contains(lvl)) m.classList.remove('happy', 'ok', 'sad'), m.classList.add(lvl);
  }
}

/** Przełącznik (drewniany suwak z gałką) – rola switch. */
function switchRow(content: HTMLElement[], on: boolean, label: string, onToggle: () => void): HTMLElement {
  return h(
    'button',
    { class: 'stl-switch-row', type: 'button', attrs: { role: 'switch', 'aria-checked': String(on), 'aria-label': label }, on: { click: onToggle } },
    ...content,
    h('span', { class: 'switch', attrs: { 'aria-hidden': 'true' } }),
  );
}

function thumb(src: string): HTMLElement {
  return h('span', { class: 'stl-thumb' }, h('img', { attrs: { src, alt: '', width: '40', height: '40', decoding: 'async', loading: 'lazy' } }));
}

// ---------------------------------------------------------------- rejestracja

export function registerSettlement(app: App, sheets: SheetManager): void {
  let tab: Tab = 'overview';
  const refresh = () => sheets.refresh();
  const send = (cmd: Parameters<App['send']>[0]) => void app.send(cmd);

  sheets.register({
    id: 'settlement',
    parent: 'hub',
    title: (_arg, s) => s.settlement.name || t('town.defaultName'),
    tabs: () => [
      { id: 'overview', label: t('town.tab.overview') },
      { id: 'residents', label: t('town.tab.residents') },
      { id: 'budget', label: t('town.tab.budget') },
      { id: 'council', label: t('town.tab.council') },
      { id: 'trade', label: t('town.tab.trade') },
      { id: 'chronicle', label: t('town.tab.chronicle') },
    ],
    sig: (s, tb) => sigFor(s, tb as Tab),
    render(body, s, tb) {
      tab = tb as Tab;
      body.classList.add('stl-body');
      body.dataset.tab = tab;
      if (tab === 'residents') renderResidents(body, s);
      else if (tab === 'budget') renderBudget(body, s);
      else if (tab === 'council') renderCouncil(body, s);
      else if (tab === 'trade') renderTrade(body, s);
      else if (tab === 'chronicle') renderChronicle(body, s);
      else renderOverview(body, s);
      // wybrana zakładka widoczna także na wąskim ekranie (6 zakładek)
      document.querySelector('#sheet-tabs [aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
    tick(body, s) {
      if (!body.classList.contains('stl-body')) return;
      if (tab === 'overview') tickOverview(body, s);
      else if (tab === 'residents') tickResidents(body, s);
    },
  });

  sheets.register({
    id: 'resident',
    parent: 'settlement',
    title: (arg, s) => residentById(s, Number(arg))?.name ?? t('resident.title'),
    sig: (s, _tb, arg) => residentSig(s, Number(arg)),
    render(body, s, _tb, arg) {
      body.classList.remove('stl-body');
      renderResident(body, s, Number(arg));
    },
    tick(body, s, arg) {
      const r = residentById(s, Number(arg));
      if (!r || !body.querySelector('.stl-card')) return;
      updateMeter(body, 'r-happy', r.happiness);
      for (const n of NEEDS) updateMeter(body, `r-${n}`, r.needs[n]);
    },
  });

  // ---------------------------------------------------------- sygnatury

  function sigFor(s: GameState, tb: Tab): string {
    const st = s.settlement;
    const day = viewCtx(s).cal.day;
    switch (tb) {
      case 'residents':
        return `r|${view.filter}|${view.happyFirst}|${st.residents.map((r) => `${r.id}:${r.job ?? '-'}:${r.home ?? '-'}:${r.child ? 1 : 0}:${moodLevel(r.happiness)}`).join(',')}`;
      case 'budget': {
        if (view.taxDrag) return view.taxSig;
        const foods = Object.keys(ST.foods).map((id) => stockOf(s, id)).join(',');
        view.taxSig = `b|${JSON.stringify(st.budget)}|${st.taxRate}|${st.reserved.join(',')}|${foods}|${st.residents.length}|${st.residents.filter((r) => r.job !== null).length}`;
        return view.taxSig;
      }
      case 'council':
        return `c|${JSON.stringify(st.proposals)}|${JSON.stringify(st.vouchers)}|${day}|${s.coins >= 1000 ? 'k' : s.coins}|${st.residents.length}|${hasHall(s)}|${st.peakTier}`;
      case 'trade':
        return `t|${JSON.stringify(st.caravan)}|${st.autoExport.join(',')}|${TRADE_GOODS.map((i) => stockOf(s, i)).join(',')}|${s.coins}|${st.nextCaravanDay}|${hasTradepost(s)}|${priceMult(s)}|${st.reserved.join(',')}`;
      case 'chronicle': {
        const top = st.chronicle[0];
        return `h|${st.chronicle.length}|${top ? `${top.day}:${top.hour}:${top.kind}` : ''}`;
      }
      default: {
        if (view.renaming) return 'o|renaming';
        const hp = avgHappiness(s);
        const events = st.events
          .filter((e) => e.untilMs > s.clock.simMs)
          .map((e) => `${e.kind}:${e.target ?? ''}:${Math.ceil((e.untilMs - s.clock.simMs) / (DAY_MS / 24))}`)
          .join(',');
        return [
          'o',
          st.name,
          st.residents.length,
          st.residents.filter((r) => r.child).length,
          freeHomes(s),
          freeJobs(s),
          st.residents.filter((r) => !r.child && r.job === null).length,
          moodLevel(hp),
          Math.round(foodStock(s, C) / Math.max(1, dailyFood(s))),
          Math.round(storageCap(s, C) / 10),
          events,
          st.territory.length,
          st.bought,
          st.peakTier,
          st.specialization,
          JSON.stringify(st.stats),
          st.foundedDay,
          hasHall(s),
          s.coins >= territoryCost(C, st.bought),
          arrivalBlock(s, C),
        ].join('|');
      }
    }
  }

  function residentSig(s: GameState, id: number): string {
    const r = residentById(s, id);
    if (!r) return 'none';
    const st = s.settlement;
    const rels = relationsOf(s, id).map((x) => `${x.a}-${x.b}:${x.kind}:${Math.round(x.v * 10)}`);
    const fam = st.residents.filter((x) => x.family === r.family && x.id !== id).map((x) => `${x.id}:${x.name}:${x.child ? 1 : 0}`);
    const home = r.home !== null ? objectByUid(s, r.home)?.type : '';
    const job = r.job !== null ? objectByUid(s, r.job)?.type : '';
    const day = viewCtx(s).cal.day;
    // potrzeby zaokrąglone do 10% (podpowiedzi), dokładne wartości odświeża tick
    const needs = NEEDS.map((n) => Math.round(r.needs[n] * 10)).join(',');
    return [id, r.name, r.child, r.home, r.job, home, job, moodLevel(r.happiness), needs, r.sadDays, r.homelessDays, moodOf(r, day), r.mood.untilDay, rels.join(','), fam.join(','), day, partnerOf(s, id)].join('|');
  }

  // ---------------------------------------------------------- przegląd

  function renderOverview(body: HTMLElement, s: GameState): void {
    const st = s.settlement;
    const pop = st.residents.length;
    const kids = st.residents.filter((r) => r.child).length;
    const jobless = st.residents.filter((r) => !r.child && r.job === null).length;
    const hp = avgHappiness(s);
    const parts: HTMLElement[] = [nameBoard(s), tierCard(s)];

    // liczby
    parts.push(
      h(
        'div',
        { class: 'stl-tiles' },
        tile('people', fmt(pop), t('town.stat.residents'), t('town.stat.split', { adults: fmt(pop - kids), kids: fmt(kids) })),
        tile('cottage', fmt(freeHomes(s)), t('town.stat.freeHomes'), freeHomes(s) ? t('town.stat.freeHomesHint') : t('town.stat.noHomes'), freeHomes(s) ? '' : 'warn'),
        tile('briefcase', fmt(freeJobs(s)), t('town.stat.freeJobs'), t('town.stat.jobless', { n: fmt(jobless) }), jobless > 0 && freeJobs(s) === 0 ? 'warn' : ''),
        h(
          'div',
          { class: `stl-tile mood ${moodLevel(hp)}` },
          h('span', { class: 'stl-tile-ic' }, face(pop ? hp : 1)),
          h('b', { class: 'stl-tile-v', text: pop ? pct(hp) : '–', attrs: { 'data-val': 'o-happy' } }),
          h('span', { class: 'stl-tile-l', text: t('town.stat.happiness') }),
          h('small', { text: pop ? moodLabel(hp) : t('town.stat.nobody') }),
        ),
      ),
    );

    // napływ
    const block = arrivalBlock(s, C);
    parts.push(
      h('p', { class: `stl-note ${block ? 'warn' : 'ok'}`, html: `${ic(block ? 'warning' : 'people')}<span>${block ? t(`town.arrival.${block}`) : t('town.arrival.ok', { hour: hourText(ST.constants.arrivalHour) })}</span>` }),
    );

    // potrzeby
    if (pop) {
      const needs = avgNeeds(s);
      parts.push(section('face-happy', t('town.needs'), h('div', { class: 'stl-meters' }, ...NEEDS.map((n) => meter(NEED_ICONS[n], t(`need.${n}`), needs[n], `o-${n}`)))));
    }

    // zapasy
    const food = foodStock(s, C);
    const daily = dailyFood(s);
    const foodDays = daily > 0 ? food / daily : 0;
    const used = storageUsed(s);
    const cap = storageCap(s, C);
    parts.push(
      section(
        'crate',
        t('town.supplies'),
        h(
          'div',
          { class: 'stl-meters' },
          h(
            'div',
            { class: `stl-meter ${foodDays < 1 && pop ? 'sad' : foodDays < 3 && pop ? 'ok' : 'happy'}` },
            h('span', { class: 'stl-meter-l', html: `${ic('bread')}<span>${t('town.food')}</span>` }),
            h('span', { class: 'stl-meter-v', text: pop ? t('town.foodDays', { days: daysText(Math.floor(foodDays)) }) : t('town.foodPoints', { n: fmt(food) }), attrs: { 'data-val': 'o-fooddays' } }),
            bar(Math.min(1, foodDays / 7), pop > 0 && foodDays < 1, 'o-food'),
            h('small', { class: 'stl-sub', text: t('town.foodDetail', { n: fmt(food), daily: fmt(daily) }) }),
          ),
          h(
            'div',
            { class: `stl-meter ${used / cap > 0.95 ? 'sad' : used / cap > 0.8 ? 'ok' : 'happy'}` },
            h('span', { class: 'stl-meter-l', html: `${ic('crate')}<span>${t('town.storage')}</span>` }),
            h('span', { class: 'stl-meter-v', text: `${fmt(used)} / ${fmt(cap)}`, attrs: { 'data-val': 'o-storage-v' } }),
            bar(used / cap, used / cap > 0.95, 'o-storage'),
            used >= cap ? h('small', { class: 'stl-hint', html: `${ic('warning')}<span>${t('town.storageFull')}</span>` }) : null,
          ),
        ),
      ),
    );

    // wydarzenia
    const events = st.events.filter((e) => e.untilMs > s.clock.simMs);
    if (events.length) {
      parts.push(
        section(
          'warning',
          t('town.events'),
          h(
            'div',
            { class: 'stl-list' },
            ...events.map((e) => {
              const type = e.target !== undefined ? objectByUid(s, e.target)?.type : undefined;
              const good = e.kind === 'festival' || e.kind === 'harvest' || e.kind === 'richCaravan';
              return h(
                'div',
                { class: `stl-event ${good ? 'good' : 'bad'}` },
                h('span', { class: 'stl-event-ic', html: ic(eventIcon(e.kind)) }),
                h('div', {}, h('b', { text: eventTitle(e.kind, type) }), h('p', { text: eventDesc(e.kind) })),
                h('small', { text: timeLeftText(e.untilMs - s.clock.simMs) }),
              );
            }),
          ),
        ),
      );
    }

    parts.push(territoryCard(s));
    const spec = specCard(s);
    if (spec) parts.push(spec);
    parts.push(statsCard(s));
    body.replaceChildren(...parts);
  }

  function nameBoard(s: GameState): HTMLElement {
    const st = s.settlement;
    const name = st.name || t('town.defaultName');
    if (view.renaming) {
      const input = h('input', {
        class: 'stl-name-input',
        type: 'text',
        attrs: { value: view.draft, maxlength: 24, 'aria-label': t('town.rename.label'), enterkeyhint: 'done', autocomplete: 'off', spellcheck: 'false' },
        on: {
          input: (e) => (view.draft = (e.target as HTMLInputElement).value),
          keydown: (e) => {
            const k = (e as KeyboardEvent).key;
            if (k === 'Enter') save();
            else if (k === 'Escape') cancel();
          },
        },
      });
      const save = () => {
        const next = view.draft.trim().slice(0, 24);
        view.renaming = false;
        if (next && next !== st.name) send({ type: 'renameSettlement', name: next });
        refresh();
      };
      const cancel = () => {
        view.renaming = false;
        refresh();
      };
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
      return h(
        'div',
        { class: 'stl-board editing' },
        input,
        h('div', { class: 'stl-board-actions' }, btn('', cancel, { primary: false, small: true, aria: t('common.cancel'), icon: 'close' }), btn('', save, { small: true, aria: t('town.rename.save'), icon: 'check' })),
      );
    }
    return h(
      'div',
      { class: 'stl-board' },
      h('span', { class: 'stl-board-ic', html: ic('townhall') }),
      h('h3', { class: 'stl-board-name', text: name }),
      btn(
        '',
        () => {
          app.click();
          view.renaming = true;
          view.draft = st.name;
          refresh();
        },
        { primary: false, small: true, aria: t('town.rename'), icon: 'palette' },
      ),
    );
  }

  function tierCard(s: GameState): HTMLElement {
    const st = s.settlement;
    const pop = st.residents.length;
    const cur = tierOf(C, pop);
    const peak = Math.max(st.peakTier, cur);
    const next = ST.tiers[peak + 1];
    const curDef = ST.tiers[cur]!;
    const steps = h(
      'ol',
      { class: 'stl-steps', attrs: { 'aria-label': t('town.tier.steps') } },
      ...ST.tiers.map((tr, i) =>
        h('li', { class: i <= peak ? (i === cur ? 'on now' : 'on') : '', attrs: { 'aria-current': i === cur ? 'step' : undefined } }, h('span', { text: String(i + 1) }), h('small', { text: t(`tier.${tr.id}`) })),
      ),
    );
    const children: (HTMLElement | null)[] = [
      h('div', { class: 'stl-tier-head' }, h('span', { class: 'stl-ribbon', html: `${ic('crown')}<span>${t(`tier.${curDef.id}`)}</span>` }), h('small', { text: t('town.tier.of', { n: cur + 1, total: ST.tiers.length }) })),
      steps,
    ];
    if (next) {
      const base = ST.tiers[peak]!.min;
      const ratio = (pop - base) / Math.max(1, next.min - base);
      children.push(
        h('p', { class: 'stl-tier-next', html: t('town.tier.next', { n: `<b>${fmt(pop)} / ${fmt(next.min)}</b>`, tier: `<b>${t(`tier.${next.id}`)}</b>` }) }),
        bar(ratio, false, 'o-tier'),
      );
      const unlocks = C.buildingList.filter((b) => b.tier === peak + 1);
      if (unlocks.length)
        children.push(
          h('p', { class: 'stl-sub', text: t('town.tier.unlocks') }),
          h(
            'ul',
            { class: 'stl-unlocks' },
            ...unlocks.map((b) => h('li', {}, h('img', { attrs: { src: buildingIconUrl(b.id, 64), alt: '', width: '36', height: '36', decoding: 'async' } }), h('span', { text: buildingName(b.id) }))),
          ),
        );
      if (peak === 3) children.push(h('p', { class: 'stl-sub', html: `${ic('crown')} ${t('town.tier.specLater')}` }));
    } else children.push(h('p', { class: 'stl-tier-next', text: t('town.tier.max') }));
    return h('div', { class: 'stl-tier' }, ...children);
  }

  function territoryCard(s: GameState): HTMLElement {
    const st = s.settlement;
    const limit = territoryLimit(C, st.peakTier);
    const full = st.territory.length >= limit;
    const cost = territoryCost(C, st.bought);
    return h(
      'div',
      { class: 'stl-row-card' },
      h('span', { class: 'stl-row-ic', html: ic('map') }),
      h(
        'div',
        {},
        h('b', { text: t('town.territory', { n: st.territory.length, max: limit }) }),
        h('p', { html: full ? t('town.territory.full') : `${t('town.territory.next')} ${coins(fmt(cost))}` }),
      ),
      btn(
        t('town.territory.open'),
        () => {
          app.click();
          app.closeSheet();
          app.startTerritory();
        },
        { small: true, icon: 'map' },
      ),
    );
  }

  function specCard(s: GameState): HTMLElement | null {
    const st = s.settlement;
    if (st.specialization) {
      return section(
        'crown',
        t('town.spec.title'),
        h('div', { class: 'stl-spec chosen' }, h('b', { text: t(`spec.${st.specialization}`) }), h('p', { text: t(`town.spec.${st.specialization}.desc`) })),
      );
    }
    if (st.peakTier < 4) return null;
    const hall = hasHall(s);
    return section(
      'crown',
      t('town.spec.choose'),
      h('p', { class: 'stl-sub', text: hall ? t('town.spec.once') : t('fail.needs-townhall') }),
      h(
        'div',
        { class: 'stl-specs' },
        ...ST.specializations.map((sp) =>
          h(
            'div',
            { class: 'stl-spec' },
            h('b', { text: t(`spec.${sp.id}`) }),
            h('p', { text: t(`town.spec.${sp.id}.desc`) }),
            btn(
              t('town.spec.pick'),
              () =>
                app.confirm(t('town.spec.confirm', { spec: t(`spec.${sp.id}`) }), t(`town.spec.${sp.id}.desc`) + `<br><br>${t('town.spec.once')}`, t('town.spec.pick'), () =>
                  send({ type: 'specialize', id: sp.id }),
                ),
              { small: true, disabled: !hall },
            ),
          ),
        ),
      ),
    );
  }

  function statsCard(s: GameState): HTMLElement {
    const st = s.settlement;
    const rows: [string, string][] = [
      [t('town.stats.founded'), st.foundedDay >= 0 ? dayText(st.foundedDay) : t('town.stats.notYet')],
      [t('town.stats.arrived'), fmt(st.stats.arrived)],
      [t('town.stats.left'), fmt(st.stats.left)],
      [t('town.stats.born'), fmt(st.stats.born)],
      [t('town.stats.weddings'), fmt(st.stats.weddings)],
    ];
    return section('chart', t('town.stats'), h('dl', { class: 'stats-grid stl-stats' }, ...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])));
  }

  function tickOverview(body: HTMLElement, s: GameState): void {
    const st = s.settlement;
    if (!st.residents.length) return;
    const needs = avgNeeds(s);
    for (const n of NEEDS) updateMeter(body, `o-${n}`, needs[n]);
    const hp = avgHappiness(s);
    const v = body.querySelector<HTMLElement>('[data-val="o-happy"]');
    if (v && v.textContent !== pct(hp)) v.textContent = pct(hp);
    const food = foodStock(s, C) / Math.max(1, dailyFood(s));
    setBar(body, 'o-food', Math.min(1, food / 7));
    setBar(body, 'o-storage', storageUsed(s) / storageCap(s, C));
    const sv = body.querySelector<HTMLElement>('[data-val="o-storage-v"]');
    const text = `${fmt(storageUsed(s))} / ${fmt(storageCap(s, C))}`;
    if (sv && sv.textContent !== text) sv.textContent = text;
  }

  // ---------------------------------------------------------- mieszkańcy

  function renderResidents(body: HTMLElement, s: GameState): void {
    const all = s.settlement.residents;
    if (!all.length) {
      body.replaceChildren(empty(t('town.res.empty'), 'wave'), h('p', { class: 'hint', text: t('town.res.emptyHint') }));
      return;
    }
    const counts = Object.fromEntries(FILTERS.map((f) => [f, all.filter((r) => matchesFilter(r, f)).length])) as Record<Filter, number>;
    const filters = h(
      'div',
      { class: 'seg stl-filters', attrs: { role: 'group', 'aria-label': t('town.res.filter') } },
      ...FILTERS.map((f) =>
        h(
          'button',
          {
            type: 'button',
            attrs: { 'aria-pressed': String(view.filter === f) },
            on: {
              click: () => {
                app.click();
                view.filter = f;
                refresh();
              },
            },
          },
          h('span', { text: t(`town.res.f.${f}`) }),
          h('small', { text: String(counts[f]) }),
        ),
      ),
    );
    const sortBtn = btn(
      t(view.happyFirst ? 'town.res.sortHappy' : 'town.res.sortSad'),
      () => {
        app.click();
        view.happyFirst = !view.happyFirst;
        refresh();
      },
      { primary: false, small: true, icon: view.happyFirst ? 'face-happy' : 'face-sad', aria: t('town.res.sortAria') },
    );
    const list = all.filter((r) => matchesFilter(r, view.filter)).sort((a, b) => (view.happyFirst ? b.happiness - a.happiness : a.happiness - b.happiness) || a.id - b.id);
    const rows = list.map((r) =>
      h(
        'button',
        {
          class: 'stl-res',
          type: 'button',
          attrs: { 'data-rid': r.id, 'aria-label': `${r.name}, ${roleText(s, r)}, ${t('town.stat.happiness')} ${pct(r.happiness)}` },
          on: {
            click: () => {
              app.click();
              app.openSheet('resident', r.id);
            },
          },
        },
        avatar(r),
        h('span', { class: 'stl-res-main' }, h('b', { text: r.name }), h('small', { class: r.job === null && !r.child ? 'jobless' : '', text: roleText(s, r) + (r.home === null ? ` · ${t('town.role.homeless')}` : '') })),
        h('span', { class: `stl-res-mood ${moodLevel(r.happiness)}` }, face(r.happiness), h('span', { class: 'pct', text: pct(r.happiness) })),
      ),
    );
    body.replaceChildren(
      filters,
      h('div', { class: 'stl-res-bar' }, h('span', { class: 'stl-sub', text: t('town.res.count', { n: list.length, total: all.length }) }), sortBtn),
      rows.length ? h('div', { class: 'stl-ledger' }, ...rows) : empty(t(`town.res.none.${view.filter}`), 'happy'),
    );
  }

  function tickResidents(body: HTMLElement, s: GameState): void {
    const byId = new Map(s.settlement.residents.map((r) => [r.id, r]));
    for (const row of body.querySelectorAll<HTMLElement>('.stl-res')) {
      const r = byId.get(Number(row.dataset.rid));
      const el = row.querySelector<HTMLElement>('.pct');
      if (r && el) {
        const text = pct(r.happiness);
        if (el.textContent !== text) el.textContent = text;
      }
    }
  }

  // ---------------------------------------------------------- budżet

  function renderBudget(body: HTMLElement, s: GameState): void {
    const st = s.settlement;
    const day = viewCtx(s).cal.day;
    const today = st.budget[0]?.day === day ? st.budget[0] : undefined;
    const sum = budgetSummary(today);
    const line = (f: BudgetLine, v: number, neg: boolean) =>
      h('div', { class: 'stl-line' }, h('span', { html: `${ic(LINE_ICONS[f])}<span>${t(`town.budget.${f}`)}</span>` }), h('b', { class: neg ? 'neg' : 'pos', text: v ? signed(neg ? -v : v) : '0' }));
    const receipt = h(
      'div',
      { class: 'stl-receipt' },
      h('h4', { text: t('town.budget.today', { day: day + 1 }) }),
      h('p', { class: 'stl-receipt-h', text: t('town.budget.income') }),
      ...INCOME_FIELDS.map((f) => line(f, today?.[f] ?? 0, false)),
      h('p', { class: 'stl-receipt-h', text: t('town.budget.expense') }),
      ...EXPENSE_FIELDS.map((f) => line(f, today?.[f] ?? 0, true)),
      h('div', { class: `stl-total ${sum.net >= 0 ? 'pos' : 'neg'}` }, h('span', { text: t('town.budget.net') }), h('b', { html: `${signed(sum.net)}${ic('coin')}` })),
      h('p', { class: 'stl-sub', text: balanceText(sum.net) }),
    );

    // wykres 7 dni (od najstarszego)
    const days = [...st.budget].slice(0, 7).reverse();
    const sums = days.map((b) => ({ b, ...budgetSummary(b) }));
    const max = Math.max(1, ...sums.map((x) => Math.max(x.income, x.expense)));
    const week = sums.reduce((a, x) => a + x.net, 0);
    const chart = days.length
      ? h(
          'div',
          { class: 'stl-chart', attrs: { role: 'img', 'aria-label': t('town.budget.chartAria', { n: signed(week) }) } },
          ...sums.map((x) =>
            h(
              'div',
              { class: `stl-col${x.b.day === day ? ' now' : ''}` },
              h('small', { class: `stl-col-net ${x.net >= 0 ? 'pos' : 'neg'}`, text: signed(x.net) }),
              h('div', { class: 'stl-col-up' }, h('i', { attrs: { style: `height:${Math.round((x.income / max) * 100)}%` } })),
              h('div', { class: 'stl-col-down' }, h('i', { attrs: { style: `height:${Math.round((x.expense / max) * 100)}%` } })),
              h('small', { class: 'stl-col-day', text: t('town.budget.dayShort', { day: x.b.day + 1 }) }),
            ),
          ),
        )
      : h('p', { class: 'hint', text: t('town.budget.noHistory') });

    // podatek
    const k = ST.constants;
    const rateText = (r: number) => `${Math.round(r * 100)}%`;
    let taxIncome = 0;
    for (const r of st.residents) {
      if (r.child) continue;
      const p = professionOf(s, C, r);
      taxIncome += st.taxRate * ((p ? wageOf(C, p) : 0) + 10);
    }
    const valueEl = h('b', { class: 'stl-tax-v', text: rateText(st.taxRate) });
    const hintEl = h('small', { class: 'stl-sub', text: t('town.tax.hint', { n: Math.round(st.taxRate * 120), coins: fmt(taxIncome) }) });
    const slider = h('input', {
      type: 'range',
      class: 'stl-tax',
      attrs: { min: 0, max: k.taxMax, step: 0.01, value: st.taxRate, 'aria-label': t('town.tax'), 'aria-valuetext': rateText(st.taxRate) },
      on: {
        input: (e) => {
          view.taxDrag = true;
          const r = Number((e.target as HTMLInputElement).value);
          valueEl.textContent = rateText(r);
          (e.target as HTMLInputElement).setAttribute('aria-valuetext', rateText(r));
          let est = 0;
          for (const x of st.residents) if (!x.child) est += r * (((p) => (p ? wageOf(C, p) : 0))(professionOf(s, C, x)) + 10);
          hintEl.textContent = t('town.tax.hint', { n: Math.round(r * 120), coins: fmt(est) });
        },
        change: (e) => {
          view.taxDrag = false;
          const r = Math.round(Number((e.target as HTMLInputElement).value) * 100) / 100;
          if (r !== st.taxRate) send({ type: 'setTax', rate: r });
        },
      },
    });
    const tax = section(
      'scales',
      t('town.tax'),
      h('div', { class: 'stl-taxbox' }, h('div', { class: 'stl-tax-row' }, h('span', { text: t('town.tax.rate') }), valueEl), slider, h('div', { class: 'stl-tax-scale' }, h('small', { text: '0%' }), h('small', { text: rateText(k.taxMax) })), hintEl),
    );

    // rezerwy jedzenia
    const foods = Object.keys(ST.foods).filter((id) => stockOf(s, id) > 0 || st.reserved.includes(id));
    const reserves = section(
      'bread',
      t('town.reserve'),
      h('p', { class: 'stl-sub', text: t('town.reserve.hint') }),
      foods.length
        ? h(
            'div',
            { class: 'stl-toggles' },
            ...foods.map((id) => {
              const on = st.reserved.includes(id);
              return switchRow(
                [thumb(itemIconUrl(id)), h('span', { class: 'stl-tg-main' }, h('b', { text: itemName(id) }), h('small', { text: t('town.reserve.item', { n: fmt(stockOf(s, id)), v: ST.foods[id] ?? 0 }) }))],
                on,
                `${t('town.reserve.aria')}: ${itemName(id)}`,
                () => {
                  app.click();
                  send({ type: 'toggleReserve', item: id });
                },
              );
            }),
          )
        : h('p', { class: 'hint', text: t('town.reserve.none') }),
    );

    body.replaceChildren(receipt, section('chart', t('town.budget.week'), chart), tax, reserves);
  }

  // ---------------------------------------------------------- rada

  function renderCouncil(body: HTMLElement, s: GameState): void {
    const st = s.settlement;
    const day = viewCtx(s).cal.day;
    const adultsN = Math.max(1, st.residents.filter((r) => !r.child).length);
    const parts: HTMLElement[] = [];
    const open = st.proposals.filter((p) => p.expiresDay >= day);
    if (open.length) {
      parts.push(
        h(
          'div',
          { class: 'stl-scrolls' },
          ...open.map((p) => {
            const tpl = ST.proposals.find((x) => x.id === p.tpl);
            const support = Math.min(1, p.support / adultsN);
            return h(
              'article',
              { class: 'stl-scroll' },
              h('header', {}, h('span', { class: 'stl-scroll-ic', html: ic(PROPOSAL_ICONS[tpl?.kind ?? ''] ?? 'scroll') }), h('h4', { text: proposalTitle(p.tpl) })),
              h('p', { text: proposalDesc(p.tpl) }),
              h('p', { class: 'stl-effect', html: `${ic('sparkle')}<span>${proposalEffect(p.tpl)}</span>` }),
              h('div', { class: 'stl-support' }, h('span', { html: `${ic('people')} ${t('town.council.support', { n: fmt(p.support), pct: pct(support) })}` }), bar(support, support < 0.35)),
              h(
                'footer',
                {},
                h('small', { html: `${p.cost ? `${t('town.council.cost')} ${coins(fmt(p.cost))} · ` : ''}${t('town.council.expires', { day: p.expiresDay + 1 })}` }),
                h(
                  'div',
                  { class: 'stl-actions' },
                  btn(t('town.council.reject'), () => {
                    app.click();
                    send({ type: 'decideProposal', id: p.id, approve: false });
                  }, { primary: false, small: true }),
                  btn(t('town.council.approve'), () => {
                    app.click();
                    send({ type: 'decideProposal', id: p.id, approve: true });
                  }, { small: true, disabled: s.coins < p.cost, icon: 'check' }),
                ),
              ),
            );
          }),
        ),
      );
    } else {
      parts.push(empty(st.peakTier < 1 ? t('town.council.tooSmall') : t('town.council.empty'), 'sleep'));
      if (!hasHall(s)) parts.push(h('p', { class: 'stl-note', html: `${ic('townhall')}<span>${t('fail.needs-townhall')} ${t('town.council.hallHint')}</span>` }));
    }

    const vouchers = Object.entries(st.vouchers).filter(([, v]) => v.untilDay >= day);
    if (vouchers.length) {
      parts.push(
        section(
          'scroll',
          t('town.council.vouchers'),
          h(
            'div',
            { class: 'stl-list' },
            ...vouchers.map(([type, v]) =>
              h(
                'div',
                { class: 'stl-row-card voucher' },
                thumb(buildingIconUrl(type, 64)),
                h('div', {}, h('b', { text: buildingName(type) }), h('p', { text: t('town.council.voucher', { pct: Math.round(v.discount * 100), day: v.untilDay + 1 }) })),
                btn(t('town.council.build'), () => {
                  app.click();
                  app.closeSheet();
                  app.startBuild(type);
                }, { small: true, icon: 'hammer' }),
              ),
            ),
          ),
        ),
      );
    }
    parts.push(h('p', { class: 'hint', text: t('town.council.about') }));
    body.replaceChildren(...parts);
  }

  // ---------------------------------------------------------- handel

  function renderTrade(body: HTMLElement, s: GameState): void {
    const st = s.settlement;
    const cv = st.caravan;
    const mult = priceMult(s);
    const parts: HTMLElement[] = [];
    if (cv) {
      parts.push(
        h(
          'div',
          { class: 'stl-wagon' },
          h('span', { class: 'stl-wagon-ic', html: ic('wagon') }),
          h('div', {}, h('b', { text: t('town.trade.from', { from: t(`partner.${cv.from}`) }) }), h('p', { text: t('town.trade.leaves', { hour: hourText(hourOfMs(cv.leavesAt)) }) })),
        ),
      );
      if (mult < 1) parts.push(h('p', { class: 'stl-note warn', html: `${ic('chart')}<span>${t('town.trade.crisis', { pct: Math.round((1 - mult) * 100) })}</span>` }));

      // sprzedaż do karawany
      const sellRows: HTMLElement[] = [];
      for (const offer of cv.buys) {
        const keys = keysOf(s, offer.item);
        if (!keys.length) {
          sellRows.push(offerRow(offer.item, itemName(offer.item), t('town.trade.buysNone', { price: fmt(offer.price), qty: fmt(offer.qty) }), [], true));
          continue;
        }
        for (const [key, n] of keys) {
          const max = Math.min(n, offer.qty);
          sellRows.push(
            offerRow(
              offer.item,
              keyLabelHtml(key),
              t('town.trade.buysInfo', { price: fmt(offer.price), have: fmt(n), qty: fmt(offer.qty) }) + (st.reserved.includes(offer.item) ? ` · ${t('town.trade.reserved')}` : ''),
              qtyButtons(max, (q) => send({ type: 'caravanSell', key, qty: q }), t('town.trade.sell')),
              false,
              true,
            ),
          );
        }
      }
      parts.push(section('coin', t('town.trade.sellTitle'), h('div', { class: 'stl-list' }, ...sellRows)));

      // zakup od karawany
      parts.push(
        section(
          'crate',
          t('town.trade.buyTitle'),
          h(
            'div',
            { class: 'stl-list' },
            ...cv.sells.map((offer) => {
              const afford = offer.price > 0 ? Math.floor(s.coins / offer.price) : offer.qty;
              const max = Math.min(offer.qty, afford);
              return offerRow(offer.item, itemName(offer.item), t('town.trade.sellsInfo', { price: fmt(offer.price), qty: fmt(offer.qty) }), qtyButtons(max, (q) => send({ type: 'caravanBuy', item: offer.item, qty: q }), t('town.trade.buy')), offer.qty <= 0);
            }),
          ),
        ),
      );
    } else {
      const day = viewCtx(s).cal.day;
      const post = hasTradepost(s);
      let msg: string;
      if (!post) msg = st.peakTier < 2 ? t('town.trade.noPostTier', { tier: t(`tier.${ST.tiers[2]?.id ?? 'village'}`) }) : t('town.trade.noPost');
      else if (st.nextCaravanDay >= day) msg = t('town.trade.next', { day: st.nextCaravanDay + 1, hour: hourText(10), when: st.nextCaravanDay === day ? t('town.trade.today') : daysText(st.nextCaravanDay - day) });
      else msg = t('town.trade.soon');
      parts.push(empty(msg, post ? 'wave' : 'point'));
      if (!post && st.peakTier >= 2)
        parts.push(
          h(
            'div',
            { class: 'row' },
            btn(t('town.trade.buildPost'), () => {
              app.click();
              app.closeSheet();
              app.startBuild('tradepost');
            }, { small: true, icon: 'hammer' }),
          ),
        );
      if (mult < 1) parts.push(h('p', { class: 'stl-note warn', html: `${ic('chart')}<span>${t('town.trade.crisis', { pct: Math.round((1 - mult) * 100) })}</span>` }));
    }

    // auto-eksport
    parts.push(
      section(
        'wagon',
        t('town.export'),
        h('p', { class: 'stl-sub', text: t('town.export.hint', { n: EXPORT_KEEP }) }),
        h(
          'div',
          { class: 'stl-toggles' },
          ...TRADE_GOODS.map((id) => {
            const on = st.autoExport.includes(id);
            const n = stockOf(s, id);
            return switchRow(
              [thumb(itemIconUrl(id)), h('span', { class: 'stl-tg-main' }, h('b', { text: itemName(id) }), h('small', { text: t('town.export.item', { n: fmt(n) }) + (st.reserved.includes(id) ? ` · ${t('town.trade.reserved')}` : '') }))],
              on,
              `${t('town.export.aria')}: ${itemName(id)}`,
              () => {
                app.click();
                send({ type: 'toggleExport', item: id });
              },
            );
          }),
        ),
      ),
    );
    body.replaceChildren(...parts);
  }

  function offerRow(item: string, titleHtml: string, desc: string, actions: HTMLElement[], dim: boolean, html = false): HTMLElement {
    return h(
      'div',
      { class: `stl-offer${dim ? ' dim' : ''}` },
      thumb(itemIconUrl(item)),
      h('div', { class: 'stl-offer-main' }, html ? h('b', { html: titleHtml }) : h('b', { text: titleHtml }), h('p', { html: desc })),
      actions.length ? h('div', { class: 'stl-qty' }, ...actions) : null,
    );
  }

  /** Przyciski ilości: 1, 5, maks. */
  function qtyButtons(max: number, onPick: (q: number) => void, verb: string): HTMLElement[] {
    const mk = (q: number, label: string, primary: boolean) =>
      btn(label, () => {
        app.click();
        onPick(q);
      }, { small: true, primary, disabled: max < q || q <= 0, aria: `${verb}: ${q}` });
    const out = [mk(1, '1', false)];
    if (max > 5) out.push(mk(5, '5', false));
    out.push(mk(Math.max(1, max), t('town.trade.max', { n: fmt(Math.max(0, max)) }), true));
    if (max <= 0) for (const b of out) b.disabled = true;
    return out;
  }

  // ---------------------------------------------------------- kronika

  function renderChronicle(body: HTMLElement, s: GameState): void {
    const list = s.settlement.chronicle;
    if (!list.length) {
      body.replaceChildren(empty(t('town.chronicle.empty'), 'sleep'));
      return;
    }
    const out: HTMLElement[] = [];
    let lastDay = -2;
    let group: HTMLElement | null = null;
    for (const e of list) {
      if (e.day !== lastDay || !group) {
        lastDay = e.day;
        out.push(h('h4', { class: 'stl-chr-day', text: dayText(e.day) }));
        group = h('ol', { class: 'stl-chr' });
        out.push(group);
      }
      group.append(
        h(
          'li',
          { class: `stl-chr-e k-${e.kind}`, attrs: { 'aria-label': `${dayHourText(e.day, e.hour)}: ${chronicleText(e)}` } },
          h('span', { class: 'stl-chr-ic', html: ic(chronicleIcon(e.kind)) }),
          h('time', { text: hourText(e.hour) }),
          h('p', { text: chronicleText(e) }),
        ),
      );
    }
    body.replaceChildren(h('div', { class: 'stl-book' }, ...out));
  }

  // ---------------------------------------------------------- karta mieszkańca

  function renderResident(body: HTMLElement, s: GameState, id: number): void {
    const r = residentById(s, id);
    if (!r) {
      body.replaceChildren(empty(t('resident.gone'), 'sad'));
      return;
    }
    const st = s.settlement;
    const day = viewCtx(s).cal.day;
    const hints = needHints(s, r);
    const mood = moodOf(r, day);
    const homeObj = r.home !== null ? objectByUid(s, r.home) : undefined;
    const jobObj = r.job !== null ? objectByUid(s, r.job) : undefined;
    const prof = professionOf(s, C, r);
    const parts: HTMLElement[] = [];

    // nagłówek: portret, imię, wiek, szczęście
    parts.push(
      h(
        'div',
        { class: 'stl-card' },
        avatar(r, true),
        h(
          'div',
          { class: 'stl-card-main' },
          h('h3', { text: r.name }),
          h('p', { class: 'stl-sub', text: `${roleText(s, r)} · ${ageText(r, day)}` }),
          h('p', { class: 'stl-sub', text: r.bornDay >= 0 ? t('resident.born', { day: r.bornDay + 1 }) : t('resident.arrived', { day: r.arrivedDay + 1 }) }),
          meter(faceIcon(r.happiness), t('town.stat.happiness'), r.happiness, 'r-happy', 0.25),
          mood ? h('p', { class: `stl-mood ${mood > 0 ? 'pos' : 'neg'}`, text: t('resident.mood', { v: signed(mood * 100), day: r.mood.untilDay + 1 }) }) : null,
          r.sadDays > 0 ? h('p', { class: 'stl-hint', html: `${ic('warning')}<span>${t('resident.sadDays', { days: daysText(r.sadDays) })}</span>` }) : null,
          r.home === null && r.homelessDays > 0 ? h('p', { class: 'stl-hint', html: `${ic('warning')}<span>${t('resident.homelessDays', { days: daysText(r.homelessDays) })}</span>` }) : null,
        ),
      ),
    );

    // dom i praca
    const homeRow = h(
      'div',
      { class: 'stl-row-card' },
      h('span', { class: 'stl-row-ic', html: ic('cottage') }),
      h('div', {}, h('b', { text: t('resident.home') }), h('p', { text: homeObj ? buildingName(homeObj.type) : t('resident.noHome') })),
      btn(t('resident.show'), () => {
        app.click();
        app.closeSheet();
        app.scene()?.focusResident(r.id);
      }, { small: true, primary: false, icon: 'map', aria: t('resident.showAria', { name: r.name }) }),
    );
    let workText: string;
    let workSub: string;
    if (r.child) {
      workText = t('resident.work.child');
      workSub = coverageAtHome(s, C, 'school', r) > 0 ? t('resident.work.school') : t('resident.hint.work.school');
    } else if (prof && jobObj) {
      workText = `${t(`profession.${prof}`)} · ${buildingName(jobObj.type)}`;
      workSub = t('resident.work.wage', { n: fmt(wageOf(C, prof)) });
    } else {
      workText = t('town.role.jobless');
      workSub = joblessReason(s, r);
    }
    const workRow = h(
      'div',
      { class: `stl-row-card${!r.child && !prof ? ' warn' : ''}` },
      h('span', { class: 'stl-row-ic', html: ic(r.child ? 'baby' : 'briefcase') }),
      h('div', {}, h('b', { text: workText }), h('p', { html: workSub.includes('<') ? workSub : workSub.replace(/&/g, '&amp;') })),
    );
    parts.push(h('div', { class: 'stl-list' }, homeRow, workRow));

    // potrzeby
    parts.push(section('face-happy', t('town.needs'), h('div', { class: 'stl-meters' }, ...NEEDS.map((n) => meter(NEED_ICONS[n], t(`need.${n}`), r.needs[n], `r-${n}`, 0.35, hints[n])))));

    // rodzina
    const family = st.residents.filter((x) => x.family === r.family && x.id !== r.id);
    const partner = partnerOf(s, r.id);
    if (family.length) {
      parts.push(
        section(
          'people',
          t('resident.family'),
          h(
            'div',
            { class: 'stl-chips' },
            ...family.map((x) =>
              h(
                'button',
                {
                  class: 'stl-chip',
                  type: 'button',
                  on: {
                    click: () => {
                      app.click();
                      app.openSheet('resident', x.id);
                    },
                  },
                },
                avatar(x),
                h('span', {}, h('b', { text: givenName(x.name) }), h('small', { text: t(`resident.kin.${kinOf(r, x, partner)}`) })),
              ),
            ),
          ),
        ),
      );
    }

    // relacje
    const rels = relationsOf(s, r.id)
      .slice()
      .sort((a, b) => relOrder(a) - relOrder(b) || b.v - a.v);
    parts.push(
      section(
        'heart',
        t('resident.relations'),
        rels.length
          ? h(
              'div',
              { class: 'stl-rels' },
              ...rels.map((rel) => {
                const otherId = rel.a === r.id ? rel.b : rel.a;
                const other = residentById(s, otherId);
                return h(
                  'button',
                  {
                    class: `stl-rel ${rel.kind}`,
                    type: 'button',
                    disabled: !other,
                    on: {
                      click: () => {
                        app.click();
                        app.openSheet('resident', otherId);
                      },
                    },
                  },
                  h('span', { class: 'stl-rel-ic', html: ic(rel.kind === 'conflict' ? 'warning' : rel.kind === 'friend' ? 'smile' : rel.kind === 'partner' ? 'rings' : 'heart') }),
                  h('span', { class: 'stl-rel-main' }, h('b', { text: other?.name ?? '…' }), h('small', { text: relationLabel(rel.kind) })),
                  h('span', { class: 'stl-rel-bar' }, bar(Math.min(1, rel.v), rel.kind === 'conflict')),
                );
              }),
            )
          : h('p', { class: 'hint', text: t('resident.noRelations') }),
      ),
    );

    body.replaceChildren(...parts);
  }

  function relOrder(r: Relation): number {
    return r.kind === 'partner' ? 0 : r.kind === 'love' ? 1 : r.kind === 'friend' ? 2 : 3;
  }

  function kinOf(r: Resident, x: Resident, partner: number | null): string {
    if (partner === x.id) return 'partner';
    if (x.child && !r.child) return 'child';
    if (!x.child && r.child) return 'parent';
    if (x.child && r.child) return 'sibling';
    return 'family';
  }

  /** Dlaczego dorosły nie pracuje. */
  function joblessReason(s: GameState, r: Resident): string {
    if (r.home === null) return t('resident.hint.work.homeless');
    if (freeJobs(s) === 0) return t('resident.hint.work.noJobs');
    return t('resident.hint.work.commute');
  }

  /** Podpowiedź, co poprawić, dla potrzeb poniżej 65%. */
  function needHints(s: GameState, r: Resident): Record<NeedId, string | null> {
    const cov = (k: CoverageKind) => coverageAtHome(s, C, k, r);
    const low = (n: NeedId) => r.needs[n] < 0.65;
    const out: Record<NeedId, string | null> = { food: null, housing: null, work: null, safety: null, fun: null };
    if (low('food')) {
      const pop = s.settlement.residents.length;
      out.food = foodStock(s, C) < dailyFood(s) || !pop ? t('resident.hint.food.stock') : t('resident.hint.food.variety');
    }
    if (low('housing')) {
      if (r.home === null) out.housing = t('resident.hint.housing.none');
      else if (cov('water') <= 0) out.housing = t('resident.hint.housing.well');
      else out.housing = t('resident.hint.housing.better');
    }
    if (low('work')) out.work = r.child ? (cov('school') > 0 ? null : t('resident.hint.work.school')) : r.job === null ? joblessReason(s, r) : null;
    if (low('safety')) {
      const miss = (['police', 'light', 'fire', 'clinic'] as const).find((k) => cov(k) <= 0);
      out.safety = miss ? t(`resident.hint.safety.${miss}`) : null;
    }
    if (low('fun')) out.fun = cov('fun') <= 0 ? t('resident.hint.fun.none') : t('resident.hint.fun.deco');
    return out;
  }

  void hasService;
}
