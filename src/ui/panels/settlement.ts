// Panel „Osada”: przegląd, mieszkańcy, budżet, rada, handel, kronika + karta mieszkańca (docs/plan-osada.md §15).
// Arkusze: 'settlement' (zakładki) i 'resident' (arg: id mieszkańca). Widok przebudowuje się tylko przy zmianie
// sygnatury (zaokrąglone dane), a paski i procenty odświeża w miejscu `tick`.

import { CONTENT, NEEDS, parseKey, type BuildingDef, type CoverageKind, type NeedId } from '../../content/content';
import { buildingName, fmt, itemName, t } from '../../i18n/i18n';
import { SPRITES_KEY, buildingIconUrl, itemIconUrl } from '../../render/art/atlas';
import { childFrame, residentFrame } from '../../render/art/residents';
import { HOUR_MS } from '../../sim/calendar';
import { coverageAtHome, freeHousing, hasService, objectByUid, professionOf, residentsAt, storageCap, storageUsed, tierOf, wageOf } from '../../sim/systems/settlement/common';
import { voucherRate } from '../../sim/systems/settlement/council';
import { priceMult } from '../../sim/systems/settlement/events';
import { freeJobs } from '../../sim/systems/settlement/jobs';
import { dailyTaxes } from '../../sim/systems/settlement/economy';
import { TAX_HAPPINESS, averageHappiness, foodStock, moodOf } from '../../sim/systems/settlement/needs';
import { arrivalBlock } from '../../sim/systems/settlement/population';
import { partnerOf, relationsOf } from '../../sim/systems/settlement/social';
import { territoryCost, territoryLimit } from '../../sim/systems/settlement/territory';
import type { GameState, Relation, Resident } from '../../sim/types';
import type { App } from '../app';
import { h } from '../dom';
import { keyLabelHtml } from '../format';
import {
  EXPENSE_FIELDS,
  GOOD_EVENTS,
  INCOME_FIELDS,
  ageText,
  balanceText,
  budgetSummary,
  budgetTotal,
  chronicleIcon,
  chronicleText,
  chronicleTone,
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
  sinceText,
  timeLeftText,
  type BudgetLine,
  type ChronicleLookup,
} from '../settlementText';
import type { SheetManager } from '../sheet';
import { ic, icEl } from '../uiIcons';
import { viewCtx } from '../view';
import { bar, btn, coins, empty, setBar } from './common';

const C = CONTENT;
const ST = C.settlement;

type Tab = 'overview' | 'residents' | 'budget' | 'council' | 'trade' | 'chronicle';
type Filter = 'all' | 'jobless' | 'homeless' | 'sad' | 'kids';

const TABS: Tab[] = ['overview', 'residents', 'budget', 'council', 'trade', 'chronicle'];
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
const REL_ICONS: Record<Relation['kind'], string> = { friend: 'smile', love: 'heart', partner: 'rings', conflict: 'warning' };
/** Towary, którymi interesują się karawany (auto-eksport). */
const TRADE_GOODS = [...new Set(ST.partners.flatMap((p) => p.buys))];
/** Ile sztuk zostaje w magazynie przy auto-eksporcie (docs/plan-osada.md §12). */
const EXPORT_KEEP = 5;
/** Godzina przyjazdu karawany (§12). */
const CARAVAN_HOUR = 10;
/** Maks. długość nazwy osady w polu edycji. */
const NAME_MAX = 24;

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

function avgNeeds(s: GameState): Record<NeedId, number> {
  const out = { food: 0, housing: 0, work: 0, safety: 0, fun: 0 } as Record<NeedId, number>;
  const rs = s.settlement.residents;
  if (!rs.length) return out;
  for (const r of rs) for (const n of NEEDS) out[n] += r.needs[n];
  for (const n of NEEDS) out[n] /= rs.length;
  return out;
}

/** Punkty odżywcze zjadane na dobę (posiłki: dorosły 1, dziecko 0,5). */
function dailyFood(s: GameState): number {
  let n = 0;
  for (const r of s.settlement.residents) n += r.child ? 0.5 : 1;
  return n * ST.constants.mealHours.length;
}

/** Limit mieszkańców (constants.maxPopulation; gdy pola jeszcze nie ma w danych → 250). */
const maxPopulation = (): number => (ST.constants as { maxPopulation?: number }).maxPopulation ?? 250;

const hasHall = (s: GameState): boolean => hasService(s, C, 'hall');
const tradepostBuilt = (s: GameState): boolean => s.objects.some((o) => C.buildings[o.type]?.service?.kind === 'trade');

function stockOf(s: GameState, item: string): number {
  let n = 0;
  for (const [key, v] of Object.entries(s.inventory)) if (v > 0 && parseKey(key).id === item) n += v;
  return n;
}

const keysOf = (s: GameState, item: string): [string, number][] => Object.entries(s.inventory).filter(([key, v]) => v > 0 && parseKey(key).id === item);

const adultsCount = (s: GameState): number => s.settlement.residents.reduce((n, r) => n + (r.child ? 0 : 1), 0);
const joblessCount = (s: GameState): number => s.settlement.residents.reduce((n, r) => n + (!r.child && r.job === null ? 1 : 0), 0);

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

/** Budynek dający usługę danego rodzaju (najniższy etap) – do podpowiedzi „czego brakuje”. */
const providers = new Map<CoverageKind, BuildingDef | null>();
function providerOf(kind: CoverageKind): BuildingDef | null {
  let v = providers.get(kind);
  if (v === undefined) {
    v = C.buildingList.filter((b) => b.service?.kind === kind).sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0))[0] ?? null;
    providers.set(kind, v);
  }
  return v;
}

/** Odczyty stanu dla kroniki (uid budynku → typ, id mieszkańca → imię). */
function lookupFor(s: GameState): ChronicleLookup {
  return {
    building: (uid) => objectByUid(s, uid)?.type,
    resident: (id) => residentById(s, id)?.name,
  };
}

// ---------------------------------------------------------------- małe klocki widoku

// ---------------------------------------------------------------- portrety (z atlasu sceny)

/** Wycinek klatki postaci (72×104) z głową i ramionami; dziecko ma niżej osadzoną głowę. */
const PORTRAIT_CUT = { adult: { x: 0, y: 0, size: 72 }, child: { x: 0, y: 4, size: 72 } } as const;
const PORTRAIT_PX = 96;
/** Klatka → data URL portretu. Wspólny dla wszystkich o tym samym zawodzie i wyglądzie (najwyżej ~60 obrazków). */
const portraits = new Map<string, string>();

/** Portret mieszkańca wycięty z atlasu sceny; null, gdy scena (atlas) nie jest jeszcze gotowa. */
function portraitUrl(app: App, s: GameState, r: Resident): string | null {
  const frame = r.child ? childFrame(r.look, 0) : residentFrame(professionOf(s, C, r), r.look, 0);
  const hit = portraits.get(frame);
  if (hit) return hit;
  const tex = app.scene()?.textures.get(SPRITES_KEY);
  if (!tex?.has(frame)) return null;
  const src = tex.getSourceImage();
  if (!(src instanceof HTMLCanvasElement) && !(src instanceof HTMLImageElement)) return null;
  const f = tex.get(frame);
  const cut = r.child ? PORTRAIT_CUT.child : PORTRAIT_CUT.adult;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PORTRAIT_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(src, f.cutX + cut.x, f.cutY + cut.y, cut.size, cut.size, 0, 0, PORTRAIT_PX, PORTRAIT_PX);
  const url = canvas.toDataURL('image/png');
  portraits.set(frame, url);
  return url;
}

/** Miniatura postaci: kolorowy medalion (kolor wg wyglądu) z portretem albo – bez sceny – ikoną dorosłego/dziecka. */
function avatar(r: Resident, portrait: string | null, big = false): HTMLElement {
  return h(
    'span',
    { class: `stl-av look-${((r.look % 8) + 8) % 8}${big ? ' big' : ''}${r.child ? ' kid' : ''}${portrait ? ' pic' : ''}`, attrs: { 'aria-hidden': 'true' } },
    portrait ? h('img', { attrs: { src: portrait, alt: '', width: '48', height: '48', decoding: 'async' } }) : icEl(r.child ? 'baby' : 'people'),
  );
}

const face = (hp: number): HTMLElement => icEl(faceIcon(hp), `stl-face ${moodLevel(hp)}`);

function section(icon: string, title: string, ...children: (HTMLElement | null)[]): HTMLElement {
  return h('section', { class: 'stl-sec' }, h('h3', { html: `${ic(icon)}<span>${title}</span>` }), ...children);
}

function tile(icon: HTMLElement, value: string, label: string, sub: string, cls = '', valKey?: string): HTMLElement {
  return h(
    'div',
    { class: `stl-tile ${cls}` },
    h('span', { class: 'stl-tile-ic' }, icon),
    h('b', { class: 'stl-tile-v', text: value, attrs: { 'data-val': valKey } }),
    h('span', { class: 'stl-tile-l', text: label }),
    h('small', { text: sub }),
  );
}

/** Wiersz z paskiem: ikona, nazwa, wartość procentowa i pasek (klucz do tick); kolor wg poziomu. */
function meter(icon: string, label: string, ratio: number, key: string, hint?: string | null): HTMLElement {
  return h(
    'div',
    { class: `stl-meter ${moodLevel(ratio)}`, attrs: { 'data-meter': key } },
    h('span', { class: 'stl-meter-l', html: `${ic(icon)}<span>${label}</span>` }),
    h('span', { class: 'stl-meter-v', text: pct(ratio), attrs: { 'data-val': key } }),
    bar(ratio, false, key),
    hint ? h('small', { class: 'stl-hint', html: `${ic('warning')}<span>${hint}</span>` }) : null,
  );
}

function setText(root: HTMLElement, key: string, text: string): void {
  const v = root.querySelector<HTMLElement>(`[data-val="${key}"]`);
  if (v && v.textContent !== text) v.textContent = text;
}

/** Odświeżenie paska, procentu i koloru w miejscu (tick). */
function updateMeter(root: HTMLElement, key: string, ratio: number): void {
  setBar(root, key, ratio);
  setText(root, key, pct(ratio));
  const m = root.querySelector<HTMLElement>(`[data-meter="${key}"]`);
  const lvl = moodLevel(ratio);
  if (m && !m.classList.contains(lvl)) {
    m.classList.remove('happy', 'ok', 'sad');
    m.classList.add(lvl);
  }
}

/** Przełącznik (drewniany suwak z gałką) – rola switch, cały wiersz klikalny. */
function switchRow(content: HTMLElement[], on: boolean, label: string, onToggle: () => void): HTMLElement {
  return h(
    'button',
    { class: 'stl-switch-row', type: 'button', attrs: { role: 'switch', 'aria-checked': String(on), 'aria-label': label }, on: { click: onToggle } },
    ...content,
    h('span', { class: 'switch', attrs: { 'aria-hidden': 'true' } }),
  );
}

function thumb(src: string): HTMLElement {
  return h('span', { class: 'stl-thumb' }, h('img', { attrs: { src, alt: '', width: '40', height: '40', decoding: 'async' } }));
}

const note = (icon: string, text: string, cls = ''): HTMLElement => h('p', { class: `stl-note ${cls}`, html: `${ic(icon)}<span>${text}</span>` });

// ---------------------------------------------------------------- rejestracja

export function registerSettlement(app: App, sheets: SheetManager): void {
  let tab: Tab = 'overview';
  const refresh = () => sheets.refresh();
  const send = (cmd: Parameters<App['send']>[0]) => void app.send(cmd);
  const tap = (fn: () => void) => () => {
    app.click();
    fn();
  };

  const avatarOf = (s: GameState, r: Resident, big = false) => avatar(r, portraitUrl(app, s, r), big);

  /** Zawartość arkusza w jednym korzeniu (arkusz `#sheet-body` jest wspólny dla wszystkich paneli). */
  const mount = (body: HTMLElement, cls: string, parts: (HTMLElement | null)[]) => body.replaceChildren(h('div', { class: `stl ${cls}` }, ...parts));

  sheets.register({
    id: 'settlement',
    parent: 'hub',
    title: (_arg, s) => s.settlement.name || t('town.defaultName'),
    tabs: () => TABS.map((id) => ({ id, label: t(`town.tab.${id}`) })),
    sig: (s, tb) => sigFor(s, tb as Tab),
    render(body, s, tb) {
      tab = TABS.includes(tb as Tab) ? (tb as Tab) : 'overview';
      const parts =
        tab === 'residents'
          ? renderResidents(s)
          : tab === 'budget'
            ? renderBudget(s)
            : tab === 'council'
              ? renderCouncil(s)
              : tab === 'trade'
                ? renderTrade(s)
                : tab === 'chronicle'
                  ? renderChronicle(s)
                  : renderOverview(s);
      mount(body, `stl-${tab}`, parts);
      revealTab();
    },
    tick(body, s) {
      const root = body.querySelector<HTMLElement>(':scope > .stl');
      if (!root) return;
      if (tab === 'overview') tickOverview(root, s);
      else if (tab === 'residents') tickResidents(root, s);
    },
  });

  sheets.register({
    id: 'resident',
    parent: 'settlement',
    title: (arg, s) => residentById(s, Number(arg))?.name ?? t('resident.title'),
    sig: (s, _tb, arg) => residentSig(s, Number(arg)),
    render(body, s, _tb, arg) {
      mount(body, 'stl-person', renderResident(s, Number(arg)));
    },
    tick(body, s, arg) {
      const r = residentById(s, Number(arg));
      const root = body.querySelector<HTMLElement>(':scope > .stl-person');
      if (!r || !root) return;
      updateMeter(root, 'r-happy', r.happiness);
      for (const n of NEEDS) updateMeter(root, `r-${n}`, r.needs[n]);
    },
  });

  /** Wybrana zakładka widoczna w poziomym pasku (6 zakładek nie mieści się na 390 px) – bez przewijania arkusza. */
  function revealTab(): void {
    const bar = document.getElementById('sheet-tabs');
    const sel = bar?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!bar || !sel) return;
    const left = sel.offsetLeft - (bar.clientWidth - sel.offsetWidth) / 2;
    bar.scrollLeft = Math.max(0, left);
  }

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
        view.taxSig = `b|${day}|${JSON.stringify(st.budget)}|${st.taxRate}|${st.reserved.join(',')}|${foods}|${adultsCount(s)}|${joblessCount(s)}`;
        return view.taxSig;
      }
      case 'council':
        return `c|${JSON.stringify(st.proposals)}|${JSON.stringify(st.vouchers)}|${day}|${s.coins >= 1000 ? 'k' : s.coins}|${adultsCount(s)}|${voucherRate(s, C)}|${hasHall(s)}|${st.peakTier}`;
      case 'trade':
        return `t|${JSON.stringify(st.caravan)}|${st.autoExport.join(',')}|${TRADE_GOODS.map((i) => stockOf(s, i)).join(',')}|${s.coins}|${st.nextCaravanDay}|${day}|${tradepostBuilt(s)}|${hasService(s, C, 'trade')}|${priceMult(s)}|${st.reserved.join(',')}`;
      case 'chronicle': {
        const top = st.chronicle[0];
        return `h|${st.chronicle.length}|${top ? `${top.day}:${top.hour}:${top.kind}:${JSON.stringify(top.params ?? {})}` : ''}`;
      }
      default: {
        if (view.renaming) return 'o|renaming';
        const daily = dailyFood(s);
        const events = st.events
          .filter((e) => e.untilMs > s.clock.simMs)
          .map((e) => `${e.kind}:${e.target ?? ''}:${Math.ceil((e.untilMs - s.clock.simMs) / HOUR_MS)}`)
          .join(',');
        return [
          'o',
          st.name,
          st.residents.length,
          adultsCount(s),
          freeHomes(s),
          freeJobs(s, C),
          joblessCount(s),
          moodLevel(averageHappiness(s)),
          daily > 0 ? Math.floor(foodStock(s, C) / daily) : Math.round(foodStock(s, C) / 10),
          storageUsed(s, C) >= storageCap(s, C),
          events,
          st.territory.length,
          st.bought,
          st.peakTier,
          st.specialization,
          JSON.stringify(st.stats),
          st.foundedDay,
          hasHall(s),
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
    const fam = st.residents.filter((x) => x.family === r.family && x.id !== id).map((x) => `${x.id}:${x.child ? 1 : 0}`);
    const home = r.home !== null ? objectByUid(s, r.home)?.type : '';
    const job = r.job !== null ? objectByUid(s, r.job)?.type : '';
    const day = viewCtx(s).cal.day;
    // potrzeby zaokrąglone do 10% (podpowiedzi i kolory), dokładne wartości odświeża tick
    const needs = NEEDS.map((n) => Math.round(r.needs[n] * 10)).join(',');
    return [id, r.name, r.child, r.home, r.job, home, job, moodLevel(r.happiness), needs, r.sadDays, r.homelessDays, moodOf(r, day), r.mood.untilDay, rels.join(','), fam.join(','), day, partnerOf(s, id)].join('|');
  }

  // ---------------------------------------------------------- przegląd

  function renderOverview(s: GameState): HTMLElement[] {
    const st = s.settlement;
    const pop = st.residents.length;
    const adults = adultsCount(s);
    const kids = pop - adults;
    const jobless = joblessCount(s);
    const homes = freeHomes(s);
    const jobs = freeJobs(s, C);
    const hp = averageHappiness(s);
    const parts: HTMLElement[] = [nameBoard(s), tierCard(s)];

    // liczby
    parts.push(
      h(
        'div',
        { class: 'stl-tiles' },
        tile(icEl('people'), fmt(pop), t('town.stat.residents'), t('town.stat.split', { adults: fmt(adults), kids: fmt(kids) })),
        tile(icEl('cottage'), fmt(homes), t('town.stat.freeHomes'), homes ? t('town.stat.freeHomesHint') : t('town.stat.noHomes'), homes ? '' : 'warn'),
        tile(icEl('briefcase'), fmt(jobs), t('town.stat.freeJobs'), t('town.stat.jobless', { n: fmt(jobless) }), jobless > 0 && jobs === 0 ? 'warn' : ''),
        tile(face(pop ? hp : 1), pop ? pct(hp) : '–', t('town.stat.happiness'), pop ? moodLabel(hp) : t('town.stat.nobody'), `mood ${moodLevel(pop ? hp : 1)}`, pop ? 'o-happy' : undefined),
      ),
    );

    // napływ
    const block = arrivalBlock(s, C);
    parts.push(block ? note('warning', t(`town.arrival.${block}`, { max: fmt(maxPopulation()) }), 'warn') : note('people', t('town.arrival.ok', { hour: hourText(ST.constants.arrivalHour) }), 'ok'));

    // potrzeby
    if (pop) {
      const needs = avgNeeds(s);
      parts.push(section('face-happy', t('town.needs'), h('div', { class: 'stl-meters' }, ...NEEDS.map((n) => meter(NEED_ICONS[n], t(`need.${n}`), needs[n], `o-${n}`)))));
    }

    // zapasy
    const food = foodStock(s, C);
    const daily = dailyFood(s);
    const foodDays = daily > 0 ? food / daily : 0;
    const used = storageUsed(s, C);
    const cap = storageCap(s, C);
    const foodLvl = !pop ? 'happy' : foodDays < 1 ? 'sad' : foodDays < 3 ? 'ok' : 'happy';
    const storeLvl = used >= cap ? 'sad' : used / cap > 0.85 ? 'ok' : 'happy';
    parts.push(
      section(
        'crate',
        t('town.supplies'),
        h(
          'div',
          { class: 'stl-meters' },
          h(
            'div',
            { class: `stl-meter ${foodLvl}` },
            h('span', { class: 'stl-meter-l', html: `${ic('bread')}<span>${t('town.food')}</span>` }),
            h('span', { class: 'stl-meter-v', text: pop ? t('town.foodDays', { days: daysText(Math.floor(foodDays)) }) : t('town.foodPoints', { n: fmt(food) }) }),
            bar(pop ? Math.min(1, foodDays / 7) : Math.min(1, food / 100), false, 'o-food'),
            h('small', { class: 'stl-sub', text: pop ? t('town.foodDetail', { n: fmt(food), daily: fmt(daily) }) : t('town.foodNobody') }),
          ),
          h(
            'div',
            { class: `stl-meter ${storeLvl}` },
            h('span', { class: 'stl-meter-l', html: `${ic('crate')}<span>${t('town.storage')}</span>` }),
            h('span', { class: 'stl-meter-v', text: `${fmt(used)} / ${fmt(cap)}`, attrs: { 'data-val': 'o-storage' } }),
            bar(used / cap, false, 'o-storage'),
            used >= cap ? h('small', { class: 'stl-hint', html: `${ic('warning')}<span>${t('town.storageFull')}</span>` }) : h('small', { class: 'stl-sub', text: t('town.storageNote') }),
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
              return h(
                'div',
                { class: `stl-event ${GOOD_EVENTS.includes(e.kind) ? 'good' : 'bad'}` },
                h('span', { class: 'stl-event-ic', html: ic(eventIcon(e.kind)) }),
                h('div', { class: 'stl-event-main' }, h('b', { text: eventTitle(e.kind, type) }), h('p', { text: eventDesc(e.kind) })),
                h('small', { class: 'stl-event-time', text: timeLeftText(e.untilMs - s.clock.simMs) }),
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
    return parts;
  }

  function nameBoard(s: GameState): HTMLElement {
    const st = s.settlement;
    const name = st.name || t('town.defaultName');
    if (view.renaming) {
      const save = () => {
        const next = view.draft.trim().slice(0, NAME_MAX);
        view.renaming = false;
        if (next && next !== st.name) send({ type: 'renameSettlement', name: next });
        refresh();
      };
      const cancel = () => {
        view.renaming = false;
        refresh();
      };
      const input = h('input', {
        class: 'stl-name-input',
        type: 'text',
        attrs: { value: view.draft, maxlength: NAME_MAX, 'aria-label': t('town.rename.label'), enterkeyhint: 'done', autocomplete: 'off', spellcheck: 'false' },
        on: {
          input: (e) => (view.draft = (e.target as HTMLInputElement).value),
          keydown: (e) => {
            const k = (e as KeyboardEvent).key;
            if (k === 'Enter') save();
            else if (k === 'Escape') cancel();
          },
        },
      });
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
      return h(
        'div',
        { class: 'stl-board m-wood editing' },
        input,
        btn('', tap(cancel), { primary: false, small: true, aria: t('common.cancel'), icon: 'close' }),
        btn('', tap(save), { small: true, aria: t('town.rename.save'), icon: 'check' }),
      );
    }
    return h(
      'div',
      { class: 'stl-board m-wood' },
      h('span', { class: 'stl-board-ic', html: ic('townhall') }),
      h('h3', { class: 'stl-board-name', text: name }),
      btn(
        t('town.rename'),
        tap(() => {
          view.renaming = true;
          view.draft = st.name || name;
          refresh();
        }),
        { primary: false, small: true, aria: t('town.rename.label') },
      ),
    );
  }

  function tierCard(s: GameState): HTMLElement {
    const st = s.settlement;
    const pop = st.residents.length;
    const cur = tierOf(C, pop);
    const peak = Math.max(st.peakTier, cur);
    const next = ST.tiers[peak + 1];
    const curId = ST.tiers[cur]?.id ?? 'camp';
    const steps = h(
      'ol',
      { class: 'stl-steps', attrs: { 'aria-label': t('town.tier.steps') } },
      ...ST.tiers.map((tr, i) =>
        h(
          'li',
          { class: i <= peak ? (i === cur ? 'on now' : 'on') : '', attrs: { 'aria-current': i === cur ? 'step' : undefined } },
          h('span', { class: 'stl-peg', text: String(i + 1) }),
          h('small', { text: t(`tier.${tr.id}`) }),
        ),
      ),
    );
    const children: (HTMLElement | null)[] = [
      h('div', { class: 'stl-tier-head' }, h('span', { class: 'stl-ribbon m-cloth', html: `${ic('crown')}<span>${t(`tier.${curId}`)}</span>` }), h('small', { text: t('town.tier.of', { n: cur + 1, total: ST.tiers.length }) + (peak > cur ? ` · ${t('town.tier.peak', { tier: t(`tier.${ST.tiers[peak]?.id ?? 'camp'}`) })}` : '') })),
      steps,
    ];
    if (next) {
      const base = ST.tiers[peak]?.min ?? 0;
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
            ...unlocks.map((b) => h('li', {}, h('img', { attrs: { src: buildingIconUrl(b.id, 64), alt: '', width: '40', height: '40', decoding: 'async' } }), h('span', { text: buildingName(b.id) }))),
          ),
        );
      if (peak + 1 === ST.tiers.length - 1) children.push(h('p', { class: 'stl-sub', html: `${ic('crown')} ${t('town.tier.specLater')}` }));
    } else children.push(h('p', { class: 'stl-tier-next', text: t('town.tier.max') }));
    return h('div', { class: 'stl-tier' }, ...children);
  }

  function territoryCard(s: GameState): HTMLElement {
    const st = s.settlement;
    const limit = territoryLimit(C, st.peakTier);
    const full = st.territory.length >= limit;
    return h(
      'div',
      { class: 'stl-row-card' },
      h('span', { class: 'stl-row-ic', html: ic('map') }),
      h(
        'div',
        { class: 'stl-row-main' },
        h('b', { text: t('town.territory', { n: st.territory.length, max: limit }) }),
        h('p', { html: full ? t('town.territory.full') : `${t('town.territory.next')} ${coins(fmt(territoryCost(C, st.bought)))}` }),
      ),
      btn(
        t('town.territory.open'),
        tap(() => {
          app.closeSheet();
          app.startTerritory();
        }),
        { small: true },
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
    if (st.peakTier < ST.tiers.length - 1) return null;
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
            { class: `stl-spec s-${sp.id}` },
            h('b', { text: t(`spec.${sp.id}`) }),
            h('p', { text: t(`town.spec.${sp.id}.desc`) }),
            btn(
              t('town.spec.pick'),
              tap(() =>
                app.confirm(t('town.spec.confirm', { spec: t(`spec.${sp.id}`) }), `${t(`town.spec.${sp.id}.desc`)}<br><br>${t('town.spec.once')}`, t('town.spec.pick'), () =>
                  send({ type: 'specialize', id: sp.id }),
                ),
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

  function tickOverview(root: HTMLElement, s: GameState): void {
    const st = s.settlement;
    if (!st.residents.length) return;
    const needs = avgNeeds(s);
    for (const n of NEEDS) updateMeter(root, `o-${n}`, needs[n]);
    setText(root, 'o-happy', pct(averageHappiness(s)));
    setBar(root, 'o-food', Math.min(1, foodStock(s, C) / Math.max(1, dailyFood(s)) / 7));
    const used = storageUsed(s, C);
    const cap = storageCap(s, C);
    setBar(root, 'o-storage', used / cap);
    setText(root, 'o-storage', `${fmt(used)} / ${fmt(cap)}`);
  }

  // ---------------------------------------------------------- mieszkańcy

  function renderResidents(s: GameState): HTMLElement[] {
    const all = s.settlement.residents;
    if (!all.length) return [empty(t('town.res.empty'), 'wave'), h('p', { class: 'hint stl-center', text: t('town.res.emptyHint') })];
    const counts = { all: 0, jobless: 0, homeless: 0, sad: 0, kids: 0 } as Record<Filter, number>;
    for (const r of all) for (const f of FILTERS) if (matchesFilter(r, f)) counts[f]++;
    const filters = h(
      'div',
      { class: 'seg stl-filters', attrs: { role: 'group', 'aria-label': t('town.res.filter') } },
      ...FILTERS.map((f) =>
        h(
          'button',
          {
            type: 'button',
            attrs: { 'aria-pressed': String(view.filter === f), 'aria-label': `${t(`town.res.f.${f}`)}: ${counts[f]}` },
            on: {
              click: tap(() => {
                view.filter = f;
                refresh();
              }),
            },
          },
          h('span', { text: t(`town.res.f.${f}`) }),
          h('small', { class: 'stl-count', text: String(counts[f]) }),
        ),
      ),
    );
    const sortBtn = btn(
      t(view.happyFirst ? 'town.res.sortHappy' : 'town.res.sortSad'),
      tap(() => {
        view.happyFirst = !view.happyFirst;
        refresh();
      }),
      { primary: false, small: true, icon: view.happyFirst ? 'face-happy' : 'face-sad', aria: t('town.res.sortAria') },
    );
    const list = all.filter((r) => matchesFilter(r, view.filter)).sort((a, b) => (view.happyFirst ? b.happiness - a.happiness : a.happiness - b.happiness) || a.id - b.id);
    const rows = list.map((r) => {
      const role = roleText(s, r);
      return h(
        'button',
        {
          class: `stl-res ${moodLevel(r.happiness)}`,
          type: 'button',
          attrs: { 'data-rid': r.id, 'aria-label': `${r.name}, ${role}${r.home === null ? `, ${t('town.role.homeless')}` : ''}, ${t('town.stat.happiness')} ${pct(r.happiness)}` },
          on: { click: tap(() => app.openSheet('resident', r.id)) },
        },
        avatarOf(s, r),
        h(
          'span',
          { class: 'stl-res-main' },
          h('b', { text: r.name }),
          h('small', { class: r.job === null && !r.child ? 'jobless' : '', text: role }, r.home === null ? h('em', { text: ` · ${t('town.role.homeless')}` }) : null),
        ),
        h('span', { class: `stl-res-mood ${moodLevel(r.happiness)}` }, face(r.happiness), h('span', { class: 'pct', text: pct(r.happiness) })),
      );
    });
    return [
      filters,
      h('div', { class: 'stl-res-bar' }, h('span', { class: 'stl-sub', text: t('town.res.count', { n: list.length, total: all.length }) }), sortBtn),
      rows.length ? h('div', { class: 'stl-ledger' }, ...rows) : empty(t(`town.res.none.${view.filter}`), 'happy'),
    ];
  }

  function tickResidents(root: HTMLElement, s: GameState): void {
    const byId = new Map(s.settlement.residents.map((r) => [r.id, r]));
    for (const row of root.querySelectorAll<HTMLElement>('.stl-res')) {
      const r = byId.get(Number(row.dataset.rid));
      const el = row.querySelector<HTMLElement>('.pct');
      if (!r || !el) continue;
      const text = pct(r.happiness);
      if (el.textContent !== text) el.textContent = text;
    }
  }

  // ---------------------------------------------------------- budżet

  function renderBudget(s: GameState): HTMLElement[] {
    const st = s.settlement;
    const day = viewCtx(s).cal.day;
    const today = st.budget[0]?.day === day ? st.budget[0] : undefined;
    const sum = budgetSummary(today);
    const line = (f: BudgetLine, v: number, neg: boolean) =>
      h('div', { class: 'stl-line' }, h('span', { class: 'stl-line-l', html: `${ic(LINE_ICONS[f])}<span>${t(`town.budget.${f}`)}</span>` }), h('b', { class: v ? (neg ? 'neg' : 'pos') : 'zero', text: v ? signed(neg ? -v : v) : '0' }));
    const receipt = h(
      'div',
      { class: 'stl-receipt' },
      h('h4', { text: t('town.budget.today', { day: day + 1 }) }),
      h('p', { class: 'stl-receipt-h', text: t('town.budget.income') }),
      ...INCOME_FIELDS.map((f) => line(f, today?.[f] ?? 0, false)),
      h('p', { class: 'stl-receipt-h', text: t('town.budget.expense') }),
      ...EXPENSE_FIELDS.map((f) => line(f, today?.[f] ?? 0, true)),
      h('div', { class: `stl-total ${sum.net > 0 ? 'pos' : sum.net < 0 ? 'neg' : 'zero'}` }, h('span', { text: t('town.budget.net') }), h('b', { html: `${signed(sum.net)}${ic('coin')}` })),
      h('p', { class: 'stl-sub', text: balanceText(sum.net) }),
    );

    // wykres 7 dni (od najstarszego): przychody w górę, wydatki w dół od wspólnej osi
    const days = st.budget.slice(0, 7).reverse();
    const sums = days.map((b) => ({ b, ...budgetSummary(b) }));
    const max = Math.max(1, ...sums.map((x) => Math.max(x.income, x.expense)));
    const week = budgetTotal(days);
    const hgt = (v: number) => `height:${Math.round((v / max) * 100)}%`;
    const chart = days.length
      ? h(
          'div',
          { class: 'stl-chart-wrap' },
          h(
            'div',
            { class: 'stl-chart', attrs: { role: 'img', 'aria-label': t('town.budget.chartAria', { income: fmt(week.income), expense: fmt(week.expense), net: signed(week.net) }) } },
            ...sums.map((x) =>
              h(
                'div',
                { class: `stl-col${x.b.day === day ? ' now' : ''}` },
                h('small', { class: `stl-col-net ${x.net > 0 ? 'pos' : x.net < 0 ? 'neg' : 'zero'}`, text: signed(x.net) }),
                h('div', { class: 'stl-col-up' }, h('i', { attrs: { style: hgt(x.income) } })),
                h('div', { class: 'stl-col-down' }, h('i', { attrs: { style: hgt(x.expense) } })),
                h('small', { class: 'stl-col-day', text: x.b.day === day ? t('town.budget.todayShort') : t('town.budget.dayShort', { day: x.b.day + 1 }) }),
              ),
            ),
          ),
          h(
            'div',
            { class: 'stl-legend' },
            h('span', { class: 'in', text: t('town.budget.legendIn', { n: fmt(week.income) }) }),
            h('span', { class: 'out', text: t('town.budget.legendOut', { n: fmt(week.expense) }) }),
            h('b', { class: week.net >= 0 ? 'pos' : 'neg', text: t('town.budget.legendNet', { n: signed(week.net) }) }),
          ),
        )
      : h('p', { class: 'hint', text: t('town.budget.noHistory') });

    // podatek
    const k = ST.constants;
    const rateText = (r: number) => `${Math.round(r * 100)}%`;
    // wpływ stawki jak w symulacji: szczęście −stawka × TAX_HAPPINESS, wpływy dzienne z dailyTaxes
    const taxAt = (rate: number) => dailyTaxes({ ...s, settlement: { ...st, taxRate: rate } }, C);
    const hintText = (rate: number) => t('town.tax.hint', { n: Math.round(rate * TAX_HAPPINESS * 100), coins: fmt(taxAt(rate)) });
    const valueEl = h('b', { class: 'stl-tax-v', text: rateText(st.taxRate) });
    const hintEl = h('small', { class: 'stl-sub', text: hintText(st.taxRate) });
    const release = () => {
      if (!view.taxDrag) return;
      view.taxDrag = false;
      refresh();
    };
    const slider = h('input', {
      type: 'range',
      class: 'stl-tax',
      attrs: { min: 0, max: k.taxMax, step: 0.01, value: st.taxRate, 'aria-label': t('town.tax'), 'aria-valuetext': rateText(st.taxRate) },
      on: {
        input: (e) => {
          view.taxDrag = true;
          const el = e.target as HTMLInputElement;
          const r = Number(el.value);
          valueEl.textContent = rateText(r);
          el.setAttribute('aria-valuetext', rateText(r));
          hintEl.textContent = hintText(r);
        },
        change: (e) => {
          view.taxDrag = false;
          const r = Math.round(Number((e.target as HTMLInputElement).value) * 100) / 100;
          if (r !== st.taxRate) send({ type: 'setTax', rate: r });
        },
        // puszczenie bez zmiany wartości nie wywołuje `change`
        pointerup: release,
        touchend: release,
        blur: release,
      },
    });
    const tax = section(
      'scales',
      t('town.tax'),
      h(
        'div',
        { class: 'stl-taxbox' },
        h('div', { class: 'stl-tax-row' }, h('span', { text: t('town.tax.rate') }), valueEl),
        slider,
        h('div', { class: 'stl-tax-scale', attrs: { 'aria-hidden': 'true' } }, h('small', { text: '0%' }), h('small', { text: rateText(k.taxMax) })),
        hintEl,
      ),
    );

    // rezerwy jedzenia
    const foods = Object.keys(ST.foods)
      .filter((id) => stockOf(s, id) > 0 || st.reserved.includes(id))
      .sort((a, b) => stockOf(s, b) - stockOf(s, a));
    const reserves = section(
      'bread',
      t('town.reserve'),
      h('p', { class: 'stl-sub', text: t('town.reserve.hint') }),
      foods.length
        ? h(
            'div',
            { class: 'stl-toggles' },
            ...foods.map((id) =>
              switchRow(
                [thumb(itemIconUrl(id)), h('span', { class: 'stl-tg-main' }, h('b', { text: itemName(id) }), h('small', { text: t('town.reserve.item', { n: fmt(stockOf(s, id)), v: ST.foods[id] ?? 0 }) }))],
                st.reserved.includes(id),
                `${t('town.reserve.aria')}: ${itemName(id)}`,
                tap(() => send({ type: 'toggleReserve', item: id })),
              ),
            ),
          )
        : h('p', { class: 'hint', text: t('town.reserve.none') }),
    );

    return [receipt, section('chart', t('town.budget.week'), chart), tax, reserves];
  }

  // ---------------------------------------------------------- rada

  function renderCouncil(s: GameState): HTMLElement[] {
    const st = s.settlement;
    const day = viewCtx(s).cal.day;
    const adults = Math.max(1, adultsCount(s));
    const parts: HTMLElement[] = [];
    const open = st.proposals.filter((p) => p.expiresDay >= day);
    const discount = voucherRate(s, C);
    if (open.length) {
      parts.push(
        h(
          'div',
          { class: 'stl-scrolls' },
          ...open.map((p) => {
            const tpl = ST.proposals.find((x) => x.id === p.tpl);
            const support = Math.min(1, p.support / adults);
            const left = p.expiresDay - day;
            return h(
              'article',
              { class: 'stl-scroll', attrs: { 'aria-label': proposalTitle(p.tpl) } },
              h('header', {}, h('span', { class: 'stl-scroll-ic', html: ic(PROPOSAL_ICONS[tpl?.kind ?? ''] ?? 'scroll') }), h('h4', { text: proposalTitle(p.tpl) })),
              h('p', { class: 'stl-scroll-desc', text: proposalDesc(p.tpl) }),
              h('p', { class: 'stl-effect', html: `${ic('sparkle')}<span>${proposalEffect(p.tpl, C, discount)}</span>` }),
              h(
                'div',
                { class: `stl-support ${moodLevel(support)}` },
                h('span', { html: `${ic('people')}<span>${t('town.council.support', { n: fmt(p.support), total: fmt(adults), pct: pct(support) })}</span>` }),
                bar(support),
              ),
              h(
                'p',
                { class: 'stl-scroll-meta' },
                h('span', { html: p.cost ? `${t('town.council.cost')} ${coins(fmt(p.cost))}` : t('town.council.free') }),
                h('span', { text: left <= 0 ? t('town.council.lastDay') : t('town.council.expires', { day: p.expiresDay + 1 }) }),
              ),
              h(
                'div',
                { class: 'stl-actions' },
                btn(t('town.council.reject'), tap(() => send({ type: 'decideProposal', id: p.id, approve: false })), { primary: false, small: true }),
                btn(t('town.council.approve'), tap(() => send({ type: 'decideProposal', id: p.id, approve: true })), { small: true, disabled: s.coins < p.cost, icon: 'check' }),
              ),
            );
          }),
        ),
      );
    } else {
      parts.push(empty(st.peakTier < 1 ? t('town.council.tooSmall') : t('town.council.empty'), 'sleep'));
      if (!hasHall(s)) parts.push(note('townhall', `${t('fail.needs-townhall')} ${t('town.council.hallHint')}`));
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
                h('div', { class: 'stl-row-main' }, h('b', { text: buildingName(type) }), h('p', { text: t('town.council.voucher', { pct: Math.round(v.discount * 100), day: v.untilDay + 1 }) })),
                btn(
                  t('town.council.build'),
                  tap(() => {
                    app.closeSheet();
                    app.startBuild(type);
                  }),
                  { small: true },
                ),
              ),
            ),
          ),
        ),
      );
    }
    parts.push(h('p', { class: 'hint stl-about', text: t('town.council.about') }));
    return parts;
  }

  // ---------------------------------------------------------- handel

  function renderTrade(s: GameState): HTMLElement[] {
    const st = s.settlement;
    const cv = st.caravan;
    const mult = priceMult(s);
    const parts: HTMLElement[] = [];
    const crisis = mult < 1 ? note('chart', t('town.trade.crisis', { pct: Math.round((1 - mult) * 100) }), 'warn') : null;
    if (cv) {
      parts.push(
        h(
          'div',
          { class: 'stl-wagon' },
          h('span', { class: 'stl-wagon-ic', html: ic('wagon') }),
          h('div', { class: 'stl-row-main' }, h('b', { text: t('town.trade.from', { from: t(`partner.${cv.from}`) }) }), h('p', { text: t('town.trade.leaves', { hour: hourText(hourOfMs(cv.leavesAt)) }) })),
        ),
      );
      if (crisis) parts.push(crisis);

      // sprzedaż do karawany
      const sellRows: HTMLElement[] = [];
      for (const offer of cv.buys) {
        const keys = keysOf(s, offer.item);
        if (!keys.length) {
          sellRows.push(offerRow(offer.item, itemName(offer.item), t('town.trade.buysNone', { price: coins(fmt(offer.price)), qty: fmt(offer.qty) }), [], true));
          continue;
        }
        for (const [key, n] of keys) {
          const max = Math.min(n, offer.qty);
          sellRows.push(
            offerRow(
              offer.item,
              keyLabelHtml(key),
              t('town.trade.buysInfo', { price: coins(fmt(offer.price)), have: fmt(n), qty: fmt(offer.qty) }) + (st.reserved.includes(offer.item) ? ` · ${t('town.trade.reserved')}` : ''),
              qtyButtons(max, (q) => send({ type: 'caravanSell', key, qty: q }), t('town.trade.sell')),
              offer.qty <= 0,
              true,
            ),
          );
        }
      }
      parts.push(section('coin', t('town.trade.sellTitle'), sellRows.length ? h('div', { class: 'stl-list' }, ...sellRows) : h('p', { class: 'hint', text: t('town.trade.nothing') })));

      // zakup od karawany
      parts.push(
        section(
          'crate',
          t('town.trade.buyTitle'),
          cv.sells.length
            ? h(
                'div',
                { class: 'stl-list' },
                ...cv.sells.map((offer) => {
                  const afford = offer.price > 0 ? Math.floor(s.coins / offer.price) : offer.qty;
                  const max = Math.min(offer.qty, afford);
                  return offerRow(
                    offer.item,
                    itemName(offer.item),
                    t('town.trade.sellsInfo', { price: coins(fmt(offer.price)), qty: fmt(offer.qty) }),
                    qtyButtons(max, (q) => send({ type: 'caravanBuy', item: offer.item, qty: q }), t('town.trade.buy')),
                    offer.qty <= 0,
                  );
                }),
              )
            : h('p', { class: 'hint', text: t('town.trade.soldOut') }),
        ),
      );
    } else {
      const day = viewCtx(s).cal.day;
      let msg: string;
      if (!tradepostBuilt(s)) msg = st.peakTier < 2 ? t('town.trade.noPostTier', { tier: t(`tier.${ST.tiers[2]?.id ?? 'village'}`) }) : t('town.trade.noPost');
      else if (!hasService(s, C, 'trade')) msg = t('town.trade.postIdle');
      else if (st.nextCaravanDay >= day) msg = t('town.trade.next', { hour: hourText(CARAVAN_HOUR), when: st.nextCaravanDay === day ? t('town.trade.today') : st.nextCaravanDay === day + 1 ? t('town.trade.tomorrow') : t('town.trade.inDays', { days: daysText(st.nextCaravanDay - day) }) });
      else msg = t('town.trade.soon');
      parts.push(empty(msg, tradepostBuilt(s) ? 'wave' : 'point'));
      if (!tradepostBuilt(s) && st.peakTier >= 2)
        parts.push(
          h(
            'div',
            { class: 'row stl-center' },
            btn(
              t('town.trade.buildPost'),
              tap(() => {
                app.closeSheet();
                app.startBuild('tradepost');
              }),
              { small: true },
            ),
          ),
        );
      if (crisis) parts.push(crisis);
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
            const n = stockOf(s, id);
            return switchRow(
              [
                thumb(itemIconUrl(id)),
                h('span', { class: 'stl-tg-main' }, h('b', { text: itemName(id) }), h('small', { text: t('town.export.item', { n: fmt(n) }) + (st.reserved.includes(id) ? ` · ${t('town.trade.reserved')}` : '') })),
              ],
              st.autoExport.includes(id),
              `${t('town.export.aria')}: ${itemName(id)}`,
              tap(() => send({ type: 'toggleExport', item: id })),
            );
          }),
        ),
      ),
    );
    return parts;
  }

  function offerRow(item: string, title: string, descHtml: string, actions: HTMLElement[], dim: boolean, titleIsHtml = false): HTMLElement {
    return h(
      'div',
      { class: `stl-offer${dim ? ' dim' : ''}` },
      thumb(itemIconUrl(item)),
      h('div', { class: 'stl-offer-main' }, titleIsHtml ? h('b', { html: title }) : h('b', { text: title }), h('p', { html: descHtml })),
      actions.length ? h('div', { class: 'stl-qty' }, ...actions) : null,
    );
  }

  /** Przyciski ilości: 1, 5, maks. */
  function qtyButtons(max: number, onPick: (q: number) => void, verb: string): HTMLElement[] {
    const mk = (q: number, label: string, primary: boolean) => btn(label, tap(() => onPick(q)), { small: true, primary, disabled: max < q || q <= 0, aria: `${verb}: ${q}` });
    const out = [mk(1, '1', false)];
    if (max > 5) out.push(mk(5, '5', false));
    if (max > 1) out.push(mk(max, t('town.trade.max', { n: fmt(max) }), true));
    else out[0] = mk(1, verb, true);
    return out;
  }

  // ---------------------------------------------------------- kronika

  function renderChronicle(s: GameState): HTMLElement[] {
    const list = s.settlement.chronicle;
    if (!list.length) return [empty(t('town.chronicle.empty'), 'sleep')];
    const look = lookupFor(s);
    const out: HTMLElement[] = [];
    let lastDay = Number.NaN;
    let group: HTMLElement | null = null;
    for (const e of list) {
      if (e.day !== lastDay || !group) {
        lastDay = e.day;
        out.push(h('h4', { class: 'stl-chr-day', text: dayText(e.day) }));
        group = h('ol', { class: 'stl-chr' });
        out.push(group);
      }
      const text = chronicleText(e, C, look);
      group.append(
        h(
          'li',
          { class: `stl-chr-e ${chronicleTone(e)}`, attrs: { 'aria-label': `${dayHourText(e.day, e.hour)}: ${text}` } },
          h('span', { class: 'stl-chr-ic', html: ic(chronicleIcon(e)) }),
          h('time', { text: hourText(e.hour) }),
          h('p', { text }),
        ),
      );
    }
    return [h('div', { class: 'stl-book' }, ...out)];
  }

  // ---------------------------------------------------------- karta mieszkańca

  function renderResident(s: GameState, id: number): HTMLElement[] {
    const r = residentById(s, id);
    if (!r) return [empty(t('resident.gone'), 'sad')];
    const st = s.settlement;
    const day = viewCtx(s).cal.day;
    const hints = needHints(s, r);
    const mood = moodOf(r, day);
    const homeObj = r.home !== null ? objectByUid(s, r.home) : undefined;
    const jobObj = r.job !== null ? objectByUid(s, r.job) : undefined;
    const prof = professionOf(s, C, r);
    const parts: HTMLElement[] = [];

    // nagłówek: portret, rola, wiek, szczęście
    parts.push(
      h(
        'div',
        { class: `stl-card ${moodLevel(r.happiness)}` },
        avatarOf(s, r, true),
        h(
          'div',
          { class: 'stl-card-main' },
          h('h3', { text: roleText(s, r) }),
          h('p', { class: 'stl-sub', text: ageText(r, day) }),
          h('p', { class: 'stl-sub', text: sinceText(r) }),
        ),
        h('div', { class: 'stl-card-mood' }, meter(faceIcon(r.happiness), `${t('town.stat.happiness')} · ${moodLabel(r.happiness)}`, r.happiness, 'r-happy')),
        mood ? h('p', { class: `stl-mood ${mood > 0 ? 'pos' : 'neg'}`, text: t(mood > 0 ? 'resident.moodUp' : 'resident.moodDown', { v: signed(mood * 100), day: r.mood.untilDay + 1 }) }) : null,
        r.sadDays > 0 ? h('p', { class: 'stl-hint', html: `${ic('warning')}<span>${t('resident.sadDays', { days: daysText(r.sadDays) })}</span>` }) : null,
        r.home === null && r.homelessDays > 0 ? h('p', { class: 'stl-hint', html: `${ic('warning')}<span>${t('resident.homelessDays', { days: daysText(r.homelessDays) })}</span>` }) : null,
      ),
    );

    // dom i praca
    const homeRow = h(
      'div',
      { class: `stl-row-card${homeObj ? '' : ' warn'}` },
      homeObj ? thumb(buildingIconUrl(homeObj.type, 64)) : h('span', { class: 'stl-row-ic', html: ic('cottage') }),
      h('div', { class: 'stl-row-main' }, h('b', { text: homeObj ? buildingName(homeObj.type) : t('resident.noHome') }), h('p', { text: homeObj ? t('resident.homeBeds', { n: residentsAt(s, homeObj.uid).length, max: C.buildings[homeObj.type]?.housing ?? 0 }) : t('resident.hint.housing.none') })),
      btn(
        t('resident.show'),
        tap(() => {
          app.closeSheet();
          app.scene()?.focusResident(r.id);
        }),
        { small: true, primary: false, aria: t('resident.showAria', { name: r.name }) },
      ),
    );
    let workTitle: string;
    let workSub: string;
    if (r.child) {
      workTitle = t('resident.work.child');
      workSub = coverageAtHome(s, C, 'school', r) > 0 ? t('resident.work.school') : missingText(s, 'school');
    } else if (prof && jobObj) {
      workTitle = `${t(`profession.${prof}`)} · ${buildingName(jobObj.type)}`;
      workSub = t('resident.work.wage', { n: fmt(wageOf(C, prof)) });
    } else {
      workTitle = t('town.role.jobless');
      workSub = joblessReason(s, r);
    }
    const workRow = h(
      'div',
      { class: `stl-row-card${!r.child && !prof ? ' warn' : ''}` },
      jobObj ? thumb(buildingIconUrl(jobObj.type, 64)) : h('span', { class: 'stl-row-ic', html: ic(r.child ? 'baby' : 'briefcase') }),
      h('div', { class: 'stl-row-main' }, h('b', { text: workTitle }), h('p', { html: workSub })),
    );
    parts.push(h('div', { class: 'stl-list' }, homeRow, workRow));

    // potrzeby
    parts.push(section('face-happy', t('resident.needs'), h('div', { class: 'stl-meters' }, ...NEEDS.map((n) => meter(NEED_ICONS[n], t(`need.${n}`), r.needs[n], `r-${n}`, hints[n])))));

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
                { class: 'stl-chip', type: 'button', attrs: { 'aria-label': `${x.name}, ${t(`resident.kin.${kinOf(r, x, partner)}`)}` }, on: { click: tap(() => app.openSheet('resident', x.id)) } },
                avatarOf(s, x),
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
                const strength = Math.min(1, Math.max(0, rel.v));
                return h(
                  'button',
                  {
                    class: `stl-rel ${rel.kind}`,
                    type: 'button',
                    disabled: !other,
                    attrs: { 'aria-label': `${other?.name ?? '…'}: ${relationLabel(rel.kind)}, ${t('resident.strength')} ${pct(strength)}` },
                    on: { click: tap(() => app.openSheet('resident', otherId)) },
                  },
                  h('span', { class: 'stl-rel-ic', html: ic(REL_ICONS[rel.kind]) }),
                  h('span', { class: 'stl-rel-main' }, h('b', { text: other?.name ?? '…' }), h('small', { text: relationLabel(rel.kind) })),
                  h('span', { class: 'stl-rel-bar' }, bar(strength, rel.kind === 'conflict')),
                );
              }),
            )
          : h('p', { class: 'hint', text: t('resident.noRelations') }),
      ),
    );
    return parts;
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

  /** Dlaczego dorosły nie pracuje (praca wymaga domu, wolnego etatu i dojazdu). */
  function joblessReason(s: GameState, r: Resident): string {
    if (r.home === null) return t('resident.hint.work.homeless');
    if (freeJobs(s, C) === 0) return t('resident.hint.work.noJobs');
    return t('resident.hint.work.commute');
  }

  /** „W pobliżu domu brakuje: Studnia” (z etapem, jeśli budynek jest jeszcze zablokowany). */
  function missingText(s: GameState, kind: CoverageKind): string {
    const def = providerOf(kind);
    if (!def) return t('resident.hint.generic');
    const tier = def.tier ?? 0;
    if (tier > s.settlement.peakTier) return t('resident.hint.missingLater', { building: buildingName(def.id), tier: t(`tier.${ST.tiers[tier]?.id ?? 'camp'}`) });
    return t('resident.hint.missing', { building: buildingName(def.id) });
  }

  /** Podpowiedź, co poprawić, dla potrzeb poniżej 65%. */
  function needHints(s: GameState, r: Resident): Record<NeedId, string | null> {
    const cov = (k: CoverageKind) => coverageAtHome(s, C, k, r);
    const low = (n: NeedId) => r.needs[n] < 0.65;
    const out: Record<NeedId, string | null> = { food: null, housing: null, work: null, safety: null, fun: null };
    if (low('food')) out.food = foodStock(s, C) < dailyFood(s) ? t('resident.hint.food.stock') : t('resident.hint.food.variety');
    if (low('housing')) {
      if (r.home === null) out.housing = t('resident.hint.housing.none');
      else if (cov('water') <= 0) out.housing = missingText(s, 'water');
      else out.housing = t('resident.hint.housing.better');
    }
    if (low('work')) out.work = r.child ? (cov('school') > 0 ? null : missingText(s, 'school')) : r.job === null ? joblessReason(s, r) : null;
    if (low('safety')) {
      const miss = (['light', 'police', 'fire', 'clinic'] as const).find((k) => cov(k) <= 0);
      out.safety = miss ? missingText(s, miss) : null;
    }
    if (low('fun')) out.fun = cov('fun') <= 0 ? missingText(s, 'fun') : t('resident.hint.fun.deco');
    return out;
  }
}
