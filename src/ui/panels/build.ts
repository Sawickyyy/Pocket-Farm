// Katalog budowy (kategorie osady i farmy) i panel budynku: farma (zwierzęta, maszyny) oraz budynki osady –
// budowa, stan i naprawa, mieszkańcy, praca, produkcja, magazyn, usługi, wygląd (docs/plan-osada.md §2, §5–§10, §15).

import { CONTENT, type BuildingCategory, type BuildingDef, type Content } from '../../content/content';
import { animalName, buildingName, fmt, itemName, t } from '../../i18n/i18n';
import { animalIconUrl, buildingIconUrl, itemIconUrl } from '../../render/art/atlas';
import { HOUR_MS } from '../../sim/calendar';
import { countItem, levelOf } from '../../sim/ctx';
import { OUTPUT_CAP, outputCount, queueLimit } from '../../sim/systems/processing';
import { REFUND, placeCost } from '../../sim/systems/building';
import {
  centerOf,
  coverageAt,
  freeHousing,
  isHabitable,
  isSettlementDef,
  isWorkHour,
  professionOf,
  residentsAt,
  siteOf,
  staffing,
  storageCap,
  storageUsed,
  wageOf,
  workersAt,
} from '../../sim/systems/settlement/common';
import { builderPower, buildRate, constructionQueue, needsRepair, repairCost } from '../../sim/systems/settlement/construction';
import { voucherDiscount } from '../../sim/systems/settlement/council';
import { animalHomeSick } from '../../sim/systems/settlement/events';
import { tierAllows } from '../../sim/systems/settlement/tiers';
import type { GameState, PlacedObject, Resident, SiteState } from '../../sim/types';
import type { App } from '../app';
import { coverageKindOf, hideCoverage, serviceEffect, showCoverage, styleThumbUrl } from '../buildMode';
import { h } from '../dom';
import { formatDuration, plural } from '../format';
import type { SheetManager } from '../sheet';
import { ic } from '../uiIcons';
import { viewCtx } from '../view';
import { bar, btn, card, coins, empty, grid, hearts, setBar } from './common';

// ---------------------------------------------------------------- czyste pomocniki (testowane)

/** Zakładki katalogu w kolejności (etykiety: category.*). */
export const CATALOG_TABS: readonly BuildingCategory[] = ['housing', 'road', 'work', 'infra', 'service', 'farm', 'deco'];

/** Stare/angielskie nazwy zakładek (np. z innych modułów) → kategoria. */
const TAB_ALIASES: Record<string, BuildingCategory> = { houses: 'housing', roads: 'road', services: 'service', buildings: 'housing' };

export function normalizeTab(tab: string): BuildingCategory {
  return (CATALOG_TABS as readonly string[]).includes(tab) ? (tab as BuildingCategory) : (TAB_ALIASES[tab] ?? 'housing');
}

/** Kategoria budynku; budynki farmy bez kategorii jak dotąd: ozdoby, ścieżki i latarnie → deco, reszta → farm. */
export function categoryOf(def: BuildingDef): BuildingCategory {
  if (def.category) return def.category;
  return def.kind === 'deco' || def.kind === 'path' || def.kind === 'lantern' ? 'deco' : 'farm';
}

/** Katalog pogrupowany wg kategorii; w grupie wg etapu, potem ceny (stabilnie). */
export function catalogGroups(list: readonly BuildingDef[]): Record<BuildingCategory, BuildingDef[]> {
  const out = Object.fromEntries(CATALOG_TABS.map((c) => [c, [] as BuildingDef[]])) as Record<BuildingCategory, BuildingDef[]>;
  list.forEach((def) => out[categoryOf(def)].push(def));
  for (const k of CATALOG_TABS) out[k] = out[k].map((d, i) => ({ d, i })).sort((a, b) => (a.d.tier ?? 0) - (b.d.tier ?? 0) || a.d.cost - b.d.cost || a.i - b.i).map((x) => x.d);
  return out;
}

export interface PriceInfo {
  /** Cena do zapłaty (po bonie rady). */
  cost: number;
  /** Cena katalogowa. */
  base: number;
  discount: number;
}

export function priceInfo(s: GameState, c: Content, type: string, day: number): PriceInfo {
  return { cost: placeCost(s, c, type, day), base: c.buildings[type]?.cost ?? 0, discount: voucherDiscount(s, type, day) };
}

export interface MaterialNeed {
  item: string;
  qty: number;
  have: number;
  missing: boolean;
}

export function materialNeeds(s: GameState, def: BuildingDef): MaterialNeed[] {
  return (def.materials ?? []).map((m) => {
    const have = countItem(s, m.item);
    return { item: m.item, qty: m.qty, have, missing: have < m.qty };
  });
}

export type CatalogLock = { kind: 'festival' } | { kind: 'level'; level: number } | { kind: 'tier'; tier: number } | { kind: 'unique' } | null;

/** Dlaczego budynku nie da się teraz postawić (poza monetami i materiałami). */
export function catalogLock(s: GameState, c: Content, def: BuildingDef): CatalogLock {
  if (def.festival && !s.unlocks.includes(def.id)) return { kind: 'festival' };
  if (levelOf(s.xp) < def.level) return { kind: 'level', level: def.level };
  if (!tierAllows(s.settlement.peakTier, def.tier)) return { kind: 'tier', tier: def.tier ?? 0 };
  if (def.unique && s.objects.some((o) => o.type === def.id)) return { kind: 'unique' };
  void c;
  return null;
}

/** Pozostałe godziny gry do końca budowy (null – gotowe, Infinity – wstrzymana pożarem). */
export function constructionEta(s: GameState, c: Content, uid: number, hour: number, power: number): number | null {
  const site = siteOf(s, uid);
  const o = s.objects.find((v) => v.uid === uid);
  const hours = (o && c.buildings[o.type]?.buildHours) ?? 0;
  if (!site || site.built >= 1 || hours <= 0) return null;
  if (site.fire > 0) return Infinity;
  const first = constructionQueue(s, c)[0] === uid;
  return ((1 - site.built) * hours) / buildRate(c, hour, first ? power : 0);
}

/** Bieżące wyjście produkcji (pora roku dla pól osady; null = przestój). */
export function productionOutput(def: BuildingDef, season: string): string | null {
  const p = def.production;
  if (!p) return null;
  if (p.seasonal) return p.seasonal[season as keyof typeof p.seasonal] ?? null;
  return p.output.item;
}

// ---------------------------------------------------------------- drobne elementy

/** Ikony osady rysuje moduł postaci (nazwy są kontraktem); do czasu narysowania klasa może być pusta. */
type TownIcon = 'people' | 'face-happy' | 'face-ok' | 'face-sad' | 'hammer' | 'road' | 'wagon' | 'flame' | 'wrench' | 'medkit' | 'briefcase' | 'map' | 'palette' | 'crate' | 'townhall' | 'warning' | 'baby';
const townIc = (name: TownIcon): string => ic(name);

const pill = (html: string, cls = ''): string => `<span class="bt-pill${cls ? ` ${cls}` : ''}">${html}</span>`;
const tierName = (tier: number): string => t(`tier.${CONTENT.settlement.tiers[tier]?.id ?? 'camp'}`);
const pct = (v: number): string => `${Math.round(v * 100)}%`;

function placesText(n: number): string {
  return t(plural(n, 'buildTown.places.one', 'buildTown.places.few', 'buildTown.places.many'), { n });
}

function moodOf(r: Resident): 'happy' | 'ok' | 'sad' {
  return r.happiness >= 0.6 ? 'happy' : r.happiness >= 0.35 ? 'ok' : 'sad';
}

/** Definicje: etykieta → wartość (HTML). */
function facts(rows: [string, string][]): HTMLElement {
  const dl = h('dl', { class: 'bt-facts' });
  for (const [k, v] of rows) dl.append(h('dt', { text: k }), h('dd', { html: v }));
  return dl;
}

function section(title: string, icon: string, ...children: (HTMLElement | null)[]): HTMLElement {
  return h('section', { class: 'bt-section' }, h('h3', { html: `${icon}${title}` }), ...children);
}

/** Wiersz mieszkańca z buźką szczęścia – dotknięcie otwiera kartę mieszkańca. */
function personRow(app: App, r: Resident, sub: string): HTMLElement {
  const mood = moodOf(r);
  return h(
    'button',
    {
      class: `bt-person m-ceramic mood-${mood}`,
      type: 'button',
      attrs: { 'aria-label': `${r.name}, ${sub}, ${t(`buildTown.mood.${mood}`)}` },
      on: {
        click: () => {
          app.click();
          app.openSheet('resident', r.id);
        },
      },
    },
    h('span', { class: 'bt-face', html: townIc(mood === 'happy' ? 'face-happy' : mood === 'ok' ? 'face-ok' : 'face-sad') }),
    h('span', { class: 'bt-person-text' }, h('b', { text: r.name }), h('small', { text: sub })),
    h('span', { class: 'bt-chev', attrs: { 'aria-hidden': 'true' } }),
  );
}

function jobLabel(s: GameState, r: Resident): string {
  if (r.child) return t('buildTown.child');
  const p = professionOf(s, CONTENT, r);
  return p ? t(`profession.${p}`) : t('buildTown.unemployed');
}

function homeLabel(s: GameState, r: Resident): string {
  const o = r.home === null ? undefined : s.objects.find((v) => v.uid === r.home);
  return o ? t('buildTown.livesIn', { name: buildingName(o.type) }) : t('buildTown.homeless');
}

// ---------------------------------------------------------------- rejestracja arkuszy

const MATERIAL_ITEMS = [...new Set(CONTENT.buildingList.flatMap((b) => (b.materials ?? []).map((m) => m.item)))];
const GROUPS = catalogGroups(CONTENT.buildingList);

export function registerBuild(app: App, sheets: SheetManager): void {
  // ---------------------------------------------------------- katalog
  sheets.register({
    id: 'build',
    parent: 'hub',
    title: () => t('build.title'),
    tabs: () => CATALOG_TABS.map((c) => ({ id: c, label: t(`category.${c}`) })),
    sig: (s, tab) => {
      const day = viewCtx(s).cal.day;
      const afford = CONTENT.buildingList.map((b) => (s.coins >= placeCost(s, CONTENT, b.id, day) ? 1 : 0)).join('');
      const unique = s.objects.filter((o) => CONTENT.buildings[o.type]?.unique).map((o) => o.type);
      return `${tab}|${day}|${afford}|` + JSON.stringify([s.xp, s.unlocks, s.settlement.peakTier, s.settlement.vouchers, unique, MATERIAL_ITEMS.map((i) => countItem(s, i)), s.objects.length, s.settlement.residents.length]);
    },
    render(body, s, tab) {
      const cat = normalizeTab(tab);
      const day = viewCtx(s).cal.day;
      body.replaceChildren(tabHint(s, cat), grid(GROUPS[cat].map((b) => catalogCard(app, s, b, day)), true));
      // Wybrana zakładka widoczna na wąskim ekranie (pasek zakładek przewija się w poziomie).
      document.querySelector('#sheet-tabs [aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    },
  });

  // ---------------------------------------------------------- panel budynku
  const objectOf = (s: GameState, uid: unknown) => s.objects.find((o) => o.uid === uid);
  let etaKey = '';

  sheets.register({
    id: 'building',
    title: (uid, s) => {
      const o = objectOf(s, uid);
      return o ? buildingName(o.type) : '';
    },
    sig: (s, _tab, uid) => {
      const o = objectOf(s, uid);
      const m = s.machines[String(uid)];
      const animals = s.animals.filter((a) => a.home === uid);
      const site = siteOf(s, Number(uid));
      const cal = viewCtx(s).cal;
      const people = s.settlement.residents.filter((r) => r.home === uid || r.job === uid).map((r) => [r.id, r.name, r.child, r.home, r.job, moodOf(r)]);
      return JSON.stringify([
        o,
        s.coins >= 0 ? Math.floor(s.coins / 10) : 0,
        s.inventory,
        m?.queue.length,
        m?.output,
        animals.map((a) => [a.id, a.ready, a.pettedDay, Math.round(a.hunger * 20), Math.round(a.affection * 20)]),
        s.skills,
        site && [site.built >= 1, site.fire > 0, site.broken, Math.ceil(site.damage * 10), site.repair > 0],
        people,
        animalHomeSick(s, Number(uid)),
        cal.season,
        isWorkHour(CONTENT, cal.hour),
        constructionQueue(s, CONTENT).indexOf(Number(uid)),
        s.objects.length,
        s.settlement.residents.length,
      ]);
    },
    tick(body, s, uid) {
      const m = s.machines[String(uid)];
      m?.queue.forEach((job, i) => {
        const r = CONTENT.recipes[job.recipe];
        if (r) setBar(body, `job${i}`, 1 - job.remainingMs / ((r.minutes / 60) * HOUR_MS));
      });
      for (const a of s.animals.filter((x) => x.home === uid)) {
        setBar(body, `h${a.id}`, a.hunger);
        setBar(body, `p${a.id}`, a.progress);
      }
      const site = siteOf(s, Number(uid));
      if (!site) return;
      setBar(body, 'site-built', site.built);
      setBar(body, 'site-repair', site.repair);
      setBar(body, 'site-damage', site.damage);
      setBar(body, 'prod', site.progress);
      const pctEl = body.querySelector<HTMLElement>('[data-built-pct]');
      if (pctEl) pctEl.textContent = pct(Math.min(0.99, site.built));
      // ETA liczona raz na godzinę gry i przy widocznej zmianie postępu.
      const eta = body.querySelector<HTMLElement>('[data-eta]');
      const key = `${uid}|${Math.floor(s.clock.simMs / HOUR_MS)}|${Math.round(site.built * 100)}`;
      if (eta && key !== etaKey) {
        etaKey = key;
        eta.textContent = etaText(s, Number(uid));
      }
    },
    render(body, s, _tab, uid) {
      etaKey = '';
      hideCoverage(app);
      const o = objectOf(s, uid);
      const def = o && CONTENT.buildings[o.type];
      if (!o || !def) {
        body.replaceChildren(empty(t('fail.invalid'), 'surprised'));
        return;
      }
      const parts: (HTMLElement | null)[] = [];
      const town = isSettlementDef(def);
      if (town) parts.push(statusBanner(app, s, o, def));
      if (def.kind === 'home') {
        if (animalHomeSick(s, o.uid)) parts.push(sickBanner(app, s, o.uid));
        parts.push(...homeView(app, s, o.uid, def.id));
      } else if (def.kind === 'machine') parts.push(...machineView(app, s, o.uid, def.id));
      else if (def.kind === 'sprinkler') parts.push(h('p', { text: t('sprinkler.info', { r: def.radius ?? 1 }) }));
      else if (def.kind === 'lantern') parts.push(h('p', { class: 'hint', text: t('lantern.info') }));
      else if (!town) parts.push(h('p', { text: t('deco.info') }));
      if (town) parts.push(...settlementView(app, s, o, def));

      const people = def.kind === 'house' ? residentsAt(s, o.uid).length : 0;
      const staff = def.jobs ? workersAt(s, o.uid).length : 0;
      parts.push(
        h(
          'div',
          { class: 'row bt-actions' },
          btn(t('build.move'), () => {
            app.click();
            app.closeSheet();
            app.startMove(o.uid);
          }, { primary: false }),
          btn(`${t('build.remove')} (${t('build.refund', { n: Math.floor(def.cost * REFUND) })})`, () => {
            const warn = [people ? t('buildTown.removeHome', { n: people }) : '', staff ? t('buildTown.removeJob', { n: staff }) : ''].filter(Boolean);
            const html = `<b>${buildingName(def.id)}</b> · ${t('build.refund', { n: Math.floor(def.cost * REFUND) })}${warn.map((w) => `<br><span class="q-miss">${w}</span>`).join('')}`;
            app.confirm(t('build.remove'), html, t('build.remove'), () => {
              void app.send({ type: 'remove', uid: o.uid }).then((ok) => ok && app.closeSheet());
            });
          }, { danger: true }),
        ),
      );
      body.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
    },
  });
}

// ---------------------------------------------------------------- katalog: karty

function tabHint(s: GameState, cat: BuildingCategory): HTMLElement {
  let n = 0;
  if (cat === 'housing') for (const v of freeHousing(s, CONTENT).values()) n += Math.max(0, v);
  if (cat === 'work') n = s.settlement.residents.filter((r) => !r.child && r.job === null).length;
  return h('p', { class: 'bt-tabhint', html: `${ic('info')}<span>${t(`buildTown.hint.${cat}`, { n })}</span>` });
}

function catalogCard(app: App, s: GameState, def: BuildingDef, day: number): HTMLElement {
  const lock = catalogLock(s, CONTENT, def);
  const price = priceInfo(s, CONTENT, def.id, day);
  const mats = materialNeeds(s, def);
  const [w, hgt] = def.size;
  const priceHtml =
    def.festival && !def.cost
      ? ic('gift')
      : price.cost < price.base
        ? `<s class="bt-old" aria-label="${t('buildTown.oldPrice', { n: price.base })}">${fmt(price.base)}</s>${coins(fmt(price.cost))}`
        : coins(fmt(price.cost));

  const pills: string[] = [pill(t('build.size', { w, h: hgt }))];
  if (def.capacity) pills.push(pill(t('home.animals', { n: 0, cap: def.capacity })));
  if (def.housing) pills.push(pill(`${townIc('people')}${placesText(def.housing)}`));
  if (def.comfort) pills.push(pill(t('buildTown.stat.comfort', { v: pct(def.comfort) })));
  if (def.jobs) pills.push(pill(`${townIc('briefcase')}${t(`profession.${def.jobs.profession}`)} ×${def.jobs.slots}`));
  const out = productionOutput(def, viewCtx(s).cal.season) ?? def.production?.output.item;
  if (out && def.production) pills.push(pill(out === '@fish' ? t('buildTown.anyFish') : `<img src="${itemIconUrl(out, 48)}" alt="" />${itemName(out)} ×${def.production.output.qty}`));
  if (def.service && def.service.radius > 0) pills.push(pill(t('buildTown.stat.radius', { r: def.service.radius })));
  else if (def.service) pills.push(pill(serviceEffect(def), 'soft'));
  if (def.upkeep) pills.push(pill(`${t('buildTown.stat.upkeep', { n: def.upkeep })}${ic('coin')}`));
  if (def.buildHours) pills.push(pill(`${ic('timer')}${formatDuration(def.buildHours * HOUR_MS)}`));
  if (def.terrain) pills.push(pill(t(`buildTown.terrain.${def.terrain}`), 'warn'));

  const matsHtml = mats.length
    ? `<span class="bt-mats">${mats
        .map(
          (m) =>
            `<span class="bt-mat${m.missing ? ' miss' : ''}" title="${itemName(m.item)}"><img src="${itemIconUrl(m.item, 48)}" alt="${itemName(m.item)}" />${m.missing ? `${Math.min(m.have, 999)}/` : ''}${m.qty}</span>`,
        )
        .join('')}</span>`
    : '';
  const chips = [def.unique ? `<span class="chip">${t('buildTown.unique')}</span>` : '', price.discount > 0 ? `<span class="chip">−${pct(price.discount)}</span>` : ''].join('');
  const note =
    lock?.kind === 'festival'
      ? t('build.festivalOnly')
      : lock?.kind === 'level'
        ? t('shop.fromLevel', { level: lock.level })
        : lock?.kind === 'tier'
          ? t('buildTown.fromTier', { tier: tierName(lock.tier) })
          : lock?.kind === 'unique'
            ? t('buildTown.uniqueBuilt')
            : undefined;
  const canPay = s.coins >= price.cost && !mats.some((m) => m.missing);
  const el = card(
    buildingIconUrl(def.id),
    `${buildingName(def.id)}${chips}`,
    `<span class="bt-price">${priceHtml}${matsHtml}</span><span class="bt-pills">${pills.join('')}</span>`,
    lock
      ? []
      : [
          btn(t('build.place'), () => {
            app.click();
            app.closeSheet();
            app.startBuild(def.id);
          }, { disabled: !canPay }),
        ],
    { note, cls: 'buy bt-card' },
  );
  return el;
}

// ---------------------------------------------------------------- panel budynku osady

function etaText(s: GameState, uid: number): string {
  const ctx = viewCtx(s);
  const hour = ctx.cal.hour;
  const eta = constructionEta(s, CONTENT, uid, hour, builderPower(ctx, hour));
  if (eta === null) return '';
  if (!Number.isFinite(eta)) return t('site.paused');
  return t('site.eta', { time: formatDuration(Math.max(1, eta) * HOUR_MS) });
}

/** Stan budowy, pożaru, awarii i uszkodzeń (z naprawą). */
function statusBanner(app: App, s: GameState, o: PlacedObject, def: BuildingDef): HTMLElement | null {
  const site = siteOf(s, o.uid);
  if (!site) return null;
  if (site.built < 1) return constructionBanner(s, o, def, site);
  const ctr = centerOf(CONTENT, o);
  if (site.fire > 0) {
    const crew = coverageAt(s, CONTENT, 'fire', ctr.x, ctr.y) > 0;
    return h(
      'div',
      { class: 'bt-status is-fire', attrs: { role: 'alert' } },
      h('h4', { html: `${townIc('flame')}${t('site.fire')}` }),
      h('p', { text: t(crew ? 'site.fireCrew' : 'site.fireAlone') }),
      bar(site.damage, true, 'site-damage'),
    );
  }
  if (!needsRepair(site)) return null;
  const broken = site.broken;
  const heavy = site.damage >= 0.5;
  const cost = repairCost(CONTENT, def.id);
  const title = broken ? t('site.broken') : heavy ? t('site.damaged') : t('site.scratched');
  const text = broken ? t('site.brokenText') : heavy ? t(def.kind === 'house' ? 'site.damagedHome' : 'site.damagedText') : t('site.scratchedText');
  return h(
    'div',
    { class: `bt-status ${broken ? 'is-broken' : 'is-damage'}`, attrs: { role: 'status' } },
    h('h4', { html: `${townIc(broken ? 'wrench' : 'warning')}${title}` }),
    h('p', { text }),
    site.damage > 0 ? bar(site.damage, true, 'site-damage') : null,
    site.repair > 0 ? h('p', { class: 'hint', text: t('site.repairing') }) : null,
    site.repair > 0 ? bar(site.repair, false, 'site-repair') : null,
    h(
      'div',
      { class: 'row' },
      btn(`${t('site.repair')} · ${fmt(cost)}`, () => void app.send({ type: 'repair', uid: o.uid }), { reward: true, disabled: s.coins < cost, icon: 'coin' }),
    ),
  );
}

function constructionBanner(s: GameState, o: PlacedObject, def: BuildingDef, site: SiteState): HTMLElement {
  const ctx = viewCtx(s);
  const hour = ctx.cal.hour;
  const yards = s.objects.filter((v) => CONTENT.buildings[v.type]?.service?.kind === 'build');
  const builders = yards.reduce((n, y) => n + workersAt(s, y.uid).length, 0);
  const queue = constructionQueue(s, CONTENT);
  const pos = queue.indexOf(o.uid);
  const crew = !yards.length
    ? t('site.noYard')
    : !builders
      ? t('site.noBuilders')
      : pos > 0
        ? t('site.queued', { n: pos })
        : isWorkHour(CONTENT, hour)
          ? t('site.builders', { n: builders })
          : t('site.buildersOff', { n: builders });
  return h(
    'div',
    { class: 'bt-status is-build', attrs: { role: 'status' } },
    h('h4', { html: `${townIc('hammer')}${t('site.building')} <span class="bt-pct" data-built-pct>${pct(Math.min(0.99, site.built))}</span>` }),
    bar(site.built, false, 'site-built'),
    h('p', { class: 'bt-eta', attrs: { 'data-eta': '' }, text: etaText(s, o.uid) }),
    h('p', { class: 'hint', text: `${crew} ${site.fire > 0 ? t('site.paused') : ''}`.trim() }),
    def.kind === 'house' ? h('p', { class: 'hint', text: t('site.homeSoon', { n: def.housing ?? 0 }) }) : null,
  );
}

function sickBanner(app: App, s: GameState, uid: number): HTMLElement {
  const meds = countItem(s, 'medicine');
  return h(
    'div',
    { class: 'bt-status is-sick', attrs: { role: 'alert' } },
    h('h4', { html: `${townIc('medkit')}${t('buildTown.sick')}` }),
    h('p', { text: t('buildTown.sickText', { n: meds }) }),
    h(
      'div',
      { class: 'row' },
      btn(t('buildTown.treat'), () => void app.send({ type: 'treatAnimals', home: uid }), { disabled: meds < 1, reward: true }),
    ),
  );
}

function settlementView(app: App, s: GameState, o: PlacedObject, def: BuildingDef): HTMLElement[] {
  const out: HTMLElement[] = [];
  const cal = viewCtx(s).cal;

  // dom: mieszkańcy, miejsca, komfort
  if (def.kind === 'house') {
    const people = residentsAt(s, o.uid);
    const rows = people.map((r) => personRow(app, r, jobLabel(s, r)));
    out.push(
      section(
        t('buildTown.residents', { n: people.length, max: def.housing ?? 0 }),
        townIc('people'),
        facts([[t('buildTown.comfort'), `<span class="bt-meter">${bar(def.comfort ?? 0).outerHTML}<b>${pct(def.comfort ?? 0)}</b></span>`]]),
        rows.length ? h('div', { class: 'bt-people' }, ...rows) : h('p', { class: 'hint', text: isHabitable(s, o.uid) ? t('buildTown.homeEmpty') : t('buildTown.homeWaiting') }),
      ),
    );
  }

  // miejsce pracy: obsada, zawód, pensja, pracownicy
  if (def.jobs) {
    const staff = workersAt(s, o.uid);
    const prof = def.jobs.profession;
    const rows = staff.map((r) => personRow(app, r, homeLabel(s, r)));
    out.push(
      section(
        t('buildTown.work', { name: t(`profession.${prof}`) }),
        townIc('briefcase'),
        facts([
          [t('buildTown.staff'), `<span class="bt-meter">${bar(staff.length / def.jobs.slots).outerHTML}<b>${staff.length}/${def.jobs.slots}</b></span>`],
          [t('buildTown.wage'), `${coins(fmt(wageOf(CONTENT, prof)))} ${t('buildTown.perDay')}`],
          [t('buildTown.hours'), t('buildTown.hoursValue', { a: CONTENT.settlement.constants.workStart, b: CONTENT.settlement.constants.workEnd })],
        ]),
        rows.length ? h('div', { class: 'bt-people' }, ...rows) : null,
        staff.length < def.jobs.slots ? h('p', { class: 'hint', text: t('buildTown.vacancy', { n: def.jobs.slots - staff.length }) }) : null,
      ),
    );
  }

  // produkcja osady
  if (def.production) out.push(productionSection(s, o, def, cal.season));
  if (def.autoRecipes?.length) out.push(autoSection(s, o, def));

  // magazyn osady
  const sv = def.service;
  if (sv && (sv.kind === 'storage' || sv.kind === 'hall')) {
    const used = storageUsed(s);
    const cap = storageCap(s, CONTENT);
    out.push(
      section(
        t('buildTown.storage'),
        townIc('crate'),
        h('div', { class: 'bt-meter wide' }, bar(used / Math.max(1, cap), used >= cap), h('b', { text: `${fmt(used)}/${fmt(cap)}` })),
        h('p', { class: 'hint', text: t('buildTown.storageAdds', { n: sv.value ?? 0 }) }),
      ),
    );
  }

  // usługa: efekt, zasięg, mieszkańcy w zasięgu, podgląd na mapie
  if (sv) {
    const kind = coverageKindOf(def);
    const rows: [string, string][] = [];
    if (sv.radius > 0) {
      const ctr = centerOf(CONTENT, o);
      const inRange = s.settlement.residents.filter((r) => {
        const home = r.home === null ? undefined : s.objects.find((v) => v.uid === r.home);
        if (!home) return false;
        const hc = centerOf(CONTENT, home);
        return Math.hypot(hc.x - ctr.x, hc.y - ctr.y) <= sv.radius;
      }).length;
      rows.push([t('buildTown.radius'), t('buildTown.radiusValue', { r: sv.radius })], [t('buildTown.inRange'), String(inRange)]);
    }
    if (def.jobs) rows.push([t('buildTown.power'), pct(staffing(s, CONTENT, o.uid))]);
    const extra: HTMLElement[] = [];
    if (kind && sv.radius > 0) {
      extra.push(
        btn(t('buildTown.showRange'), () => {
          app.click();
          app.closeSheet();
          showCoverage(app, kind, buildingName(def.id));
        }, { primary: false, icon: 'eye' }),
      );
    }
    if (sv.kind === 'trade') extra.push(btn(t('buildTown.openTrade'), () => app.openSheet('settlement', undefined, 'trade'), { icon: 'coin' }));
    if (sv.kind === 'hall') extra.push(btn(t('buildTown.openSettlement'), () => app.openSheet('settlement'), {}));
    if (sv.kind !== 'storage' || rows.length || extra.length) {
      out.push(
        section(
          t(`buildTown.service.${sv.kind}`),
          townIc('map'),
          h('p', { class: 'bt-effect', text: serviceEffect(def) }),
          rows.length ? facts(rows) : null,
          extra.length ? h('div', { class: 'row' }, ...extra) : null,
        ),
      );
    }
  }

  // wygląd
  if ((def.styles ?? 1) > 1) out.push(restyleSection(app, o, def));

  // utrzymanie
  if (def.upkeep) out.push(h('p', { class: 'bt-upkeep', html: `${t('buildTown.upkeep')}: ${coins(fmt(def.upkeep))} ${t('buildTown.perDay')}` }));
  return out;
}

function productionSection(s: GameState, o: PlacedObject, def: BuildingDef, season: string): HTMLElement {
  const p = def.production!;
  const outItem = productionOutput(def, season);
  const staff = workersAt(s, o.uid).length;
  const used = storageUsed(s);
  const cap = storageCap(s, CONTENT);
  const notes: string[] = [];
  if (!outItem) notes.push(t('buildTown.seasonIdle'));
  if (def.jobs && !staff) notes.push(t('buildTown.noStaff'));
  if (used >= cap) notes.push(t('buildTown.storageFull'));
  if (p.limit && outItem && countItem(s, outItem) >= p.limit) notes.push(t('buildTown.limitReached', { n: p.limit }));
  const outHtml = !outItem
    ? `<span class="bt-mat">${t('buildTown.idle')}</span>`
    : outItem === '@fish'
      ? `<span class="bt-mat">${t('buildTown.anyFish')} ×${p.output.qty}</span>`
      : `<span class="bt-mat"><img src="${itemIconUrl(outItem, 48)}" alt="" />${itemName(outItem)} ×${p.output.qty}</span>`;
  const inHtml = p.inputs.length
    ? p.inputs
        .map((i) => {
          const have = countItem(s, i.item);
          return `<span class="bt-mat${have < i.qty ? ' miss' : ''}"><img src="${itemIconUrl(i.item, 48)}" alt="" />${itemName(i.item)} ${Math.min(have, 999)}/${i.qty}</span>`;
        })
        .join('')
    : '';
  const seasonal = p.seasonal
    ? `<p class="hint">${t('buildTown.seasonal', {
        list: Object.entries(p.seasonal)
          .map(([k, v]) => `${t(`season.${k}`)}: ${itemName(v)}`)
          .join(', '),
      })}</p>`
    : '';
  const body = h('div', { class: 'bt-flow', html: `${inHtml ? `${inHtml}<span class="bt-arrow" aria-hidden="true"></span>` : ''}${outHtml}` });
  return section(
    t('buildTown.production'),
    ic('sack'),
    body,
    h('p', { class: 'hint', text: t('buildTown.cycle', { n: p.hours }) }),
    bar(s.settlement.sites[String(o.uid)]?.progress ?? 0, false, 'prod'),
    seasonal ? h('div', { html: seasonal }) : null,
    notes.length ? h('p', { class: 'bt-note', text: notes.join(' ') }) : null,
  );
}

function autoSection(s: GameState, o: PlacedObject, def: BuildingDef): HTMLElement {
  const staff = workersAt(s, o.uid).length;
  const recipes = (def.autoRecipes ?? []).map((id) => CONTENT.recipes[id]).filter((r) => !!r);
  const current = recipes.find((r) => r.inputs.every((i) => countItem(s, i.item) >= i.qty));
  const first = recipes[0];
  let html: string;
  if (!staff) html = `<p class="hint">${t('buildTown.autoNoStaff')}</p>`;
  else if (current) html = `<p>${t('buildTown.autoNow')} <span class="bt-mat"><img src="${itemIconUrl(current.output.item, 48)}" alt="" />${itemName(current.output.item)} ×${current.output.qty}</span></p>`;
  else if (first) {
    const miss = first.inputs.map((i) => `<span class="bt-mat miss"><img src="${itemIconUrl(i.item, 48)}" alt="" />${itemName(i.item)} ${Math.min(countItem(s, i.item), 999)}/${i.qty}</span>`).join('');
    html = `<p>${t('buildTown.autoMissing')} ${miss}</p>`;
  } else html = '';
  const speed = staff ? `<p class="hint">${t('buildTown.autoSpeed', { v: (0.4 + 0.3 * staff).toFixed(1) })}</p>` : '';
  return section(t('buildTown.auto'), townIc('briefcase'), h('div', { class: 'bt-auto', html: html + speed }));
}

function restyleSection(app: App, o: PlacedObject, def: BuildingDef): HTMLElement {
  const n = def.styles ?? 1;
  const current = o.style ?? 0;
  const group = h(
    'div',
    { class: 'bt-styles in-panel', attrs: { role: 'radiogroup', 'aria-label': t('buildTown.style') } },
    ...Array.from({ length: n }, (_, i) =>
      h(
        'button',
        {
          class: 'bt-swatch m-ceramic',
          type: 'button',
          attrs: { role: 'radio', 'aria-checked': String(i === current), 'aria-label': t('buildTown.styleN', { n: i + 1 }) },
          on: {
            click: () => {
              if (i === current) return;
              app.click();
              void app.send({ type: 'restyle', uid: o.uid, style: i });
            },
          },
        },
        h('img', { attrs: { src: styleThumbUrl(def, i), alt: '' } }),
      ),
    ),
  );
  return section(t('buildTown.style'), townIc('palette'), group, h('p', { class: 'hint', text: t('buildTown.restyleFree') }));
}

// ---------------------------------------------------------------- farma (bez zmian)

function homeView(app: App, s: GameState, uid: number, type: string): HTMLElement[] {
  const def = CONTENT.buildings[type]!;
  const animals = s.animals.filter((a) => a.home === uid);
  const cal = viewCtx(s).cal;
  const level = levelOf(s.xp);
  const feedKinds = [...new Set((def.animals ?? []).flatMap((k) => CONTENT.animals[k]?.feed ?? []))];
  const out: HTMLElement[] = [
    h('p', {
      class: 'hint',
      html: `${t('home.animals', { n: animals.length, cap: def.capacity ?? 0 })} · ${t('home.feedHint', {
        items: feedKinds.map((f) => `${itemName(f)} (${countItem(s, f)})`).join(', '),
      })}`,
    }),
  ];
  if (!animals.length) out.push(empty(t('home.empty'), 'point'));
  out.push(
    grid(
      animals.map((a) => {
        const info = h(
          'div',
          {},
          h('h4', { html: `${a.name} · ${animalName(a.kind)}${a.ready ? ` <span class="chip hot">${t('home.ready')}</span>` : ''}` }),
          h('p', { text: t('home.hunger') }),
          bar(a.hunger, a.hunger < 0.2, `h${a.id}`),
          h('p', { class: 'hearts', html: `${t('home.affection')} ${hearts(Math.round(a.affection * 5), 5)}` }),
          bar(a.progress, false, `p${a.id}`),
        );
        return h(
          'div',
          { class: 'card' },
          h('div', { class: 'thumb' }, h('img', { attrs: { src: animalIconUrl(a.kind), alt: '' } })),
          info,
          h(
            'div',
            { class: 'actions' },
            btn(t('home.feed'), () => void app.send({ type: 'feedAnimal', id: a.id }), { small: true, primary: false, disabled: a.hunger > 0.85 }),
            btn(t('home.pet'), () => void app.send({ type: 'petAnimal', id: a.id }), { small: true, primary: false, disabled: a.pettedDay === cal.day }),
            btn(t('home.collect'), () => void app.send({ type: 'collectAnimal', id: a.id }), { small: true, disabled: !a.ready, reward: true }),
          ),
        );
      }),
    ),
  );
  if (animals.length) {
    out.push(
      h(
        'div',
        { class: 'row' },
        btn(t('home.feedAll'), () => void app.send({ type: 'feedAll', home: uid }), { primary: false }),
        btn(t('home.collectAll'), () => void app.send({ type: 'collectAll', home: uid }), { disabled: !animals.some((a) => a.ready), reward: true }),
      ),
    );
  }
  out.push(h('h3', { text: t('home.buy') }));
  out.push(
    grid(
      (def.animals ?? []).map((k) => {
        const ad = CONTENT.animals[k]!;
        const locked = level < ad.level;
        return card(animalIconUrl(k), animalName(k), `${coins(fmt(ad.price))} · ${itemName(ad.product)} / ${ad.produceHours} h`, locked ? [] : [
          btn(t('common.buy'), () => void app.send({ type: 'buyAnimal', kind: k, home: uid }), { disabled: s.coins < ad.price || animals.length >= (def.capacity ?? 0) }),
        ], { note: locked ? t('shop.fromLevel', { level: ad.level }) : undefined });
      }),
    ),
  );
  return out;
}

function machineView(app: App, s: GameState, uid: number, type: string): HTMLElement[] {
  const m = s.machines[String(uid)] ?? { queue: [], output: {} };
  const ctx = viewCtx(s);
  const limit = queueLimit(ctx);
  const recipes = CONTENT.recipeList.filter((r) => r.building === type);
  const outCount = outputCount(m);
  const out: HTMLElement[] = [];

  out.push(h('h3', { text: t('machine.queue', { n: m.queue.length, max: limit }) }));
  if (!m.queue.length) out.push(h('p', { class: 'hint', text: t('machine.idle') }));
  m.queue.forEach((job, i) => {
    const r = CONTENT.recipes[job.recipe];
    if (!r) return;
    out.push(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'thumb' }, h('img', { attrs: { src: itemIconUrl(r.output.item), alt: '' } })),
        h('div', {}, h('h4', { text: `${itemName(r.output.item)} × ${r.output.qty}` }), bar(1 - job.remainingMs / ((r.minutes / 60) * HOUR_MS), false, `job${i}`)),
        h('div'),
      ),
    );
  });

  out.push(
    h(
      'div',
      { class: 'summary-row' },
      h('span', { html: `${t('machine.output', { n: outCount })} / ${OUTPUT_CAP} ${Object.entries(m.output).map(([k, n]) => `${itemName(k)} ×${n}`).join(', ')}` }),
      btn(t('machine.collect'), () => void app.send({ type: 'collectOutput', uid }), { disabled: !outCount, reward: true }),
    ),
  );

  out.push(h('h3', { text: t('machine.recipes') }));
  out.push(
    grid(
      recipes.map((r) => {
        const inputs = r.inputs.map((i) => {
          const have = countItem(s, i.item);
          return `<span class="${have < i.qty ? 'q-miss' : ''}">${itemName(i.item)} ${Math.min(have, 99)}/${i.qty}</span>`;
        });
        const can = r.inputs.every((i) => countItem(s, i.item) >= i.qty) && m.queue.length < limit;
        return card(itemIconUrl(r.output.item), `${itemName(r.output.item)} × ${r.output.qty}`, `${inputs.join(' + ')} · ${ic('timer')} ${formatDuration((r.minutes / 60) * HOUR_MS)}`, [
          btn(t('machine.make'), () => void app.send({ type: 'queueRecipe', uid, recipe: r.id }), { disabled: !can, small: true }),
        ]);
      }),
    ),
  );
  return out;
}

