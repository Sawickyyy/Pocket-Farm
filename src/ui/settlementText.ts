// Teksty panelu „Osada” jako czyste funkcje (bez DOM): kronika, wydarzenia, propozycje rady, wiek, budżet, nastrój.
// Klucze: 'chronicle.*' (wpisy kroniki), 'town.*' (panel), 'resident.*' (karta mieszkańca).

import { CONTENT, type Content, type ProposalTpl } from '../content/content';
import { buildingName, fmt, has, itemName, t } from '../i18n/i18n';
import { DAY_MS, HOUR_MS } from '../sim/calendar';
import type { BudgetDay, ChronicleEntry, RelationKind, Resident, SettlementEventKind } from '../sim/types';
import { plural } from './format';

// ---------------------------------------------------------------- liczby i czas

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Procent 0..100 z ułamka 0..1 (zaokrąglony). */
export const pct = (v: number): string => `${Math.round(clamp01(v) * 100)}%`;

/** Liczba ze znakiem: „+1 234”, „−56”, „0” (prawdziwy minus U+2212). */
export function signed(n: number): string {
  const r = Math.round(n);
  if (r === 0) return '0';
  return `${r > 0 ? '+' : '−'}${fmt(Math.abs(r))}`;
}

/** Numer dnia dla gracza (dni gry liczone od 0, w interfejsie od 1). */
export const dayText = (day: number): string => t('town.day', { day: day + 1 });

/** Pełna godzina „07:00”. */
export const hourText = (hour: number): string => `${String(((Math.floor(hour) % 24) + 24) % 24).padStart(2, '0')}:00`;

export const dayHourText = (day: number, hour: number): string => t('town.dayHour', { day: day + 1, hour: hourText(hour) });

/** „1 dzień”, „3 dni” / „1 day”, „3 days”. */
export const daysText = (n: number): string => t(n === 1 ? 'town.days.one' : 'town.days.many', { n: fmt(n) });

/** Pozostały czas wydarzenia: godziny (< 1 doby) albo dni. */
export function timeLeftText(ms: number): string {
  if (ms <= 0) return t('town.left.ending');
  if (ms < DAY_MS) return t('town.left.hours', { n: Math.max(1, Math.ceil(ms / HOUR_MS)) });
  return t('town.left.days', { days: daysText(Math.ceil(ms / DAY_MS)) });
}

/** Godzina gry z czasu symulacji (np. odjazd karawany). */
export const hourOfMs = (ms: number): number => Math.floor((ms % DAY_MS) / HOUR_MS);

// ---------------------------------------------------------------- nastrój i szczęście

export type MoodLevel = 'happy' | 'ok' | 'sad';
/** Progi buziek: od 0,6 zadowoleni, poniżej 0,35 smutni (wyjazd grozi poniżej 0,25). */
export const HAPPY_MIN = 0.6;
export const OK_MIN = 0.35;

export const moodLevel = (h: number): MoodLevel => (h >= HAPPY_MIN ? 'happy' : h >= OK_MIN ? 'ok' : 'sad');

/** Nazwa ikony buzi (kontrakt ikon: face-happy, face-ok, face-sad). */
export const faceIcon = (h: number): string => `face-${moodLevel(h)}`;

export const moodLabel = (h: number): string => t(`town.mood.${moodLevel(h)}`);

// ---------------------------------------------------------------- budżet

export const INCOME_FIELDS = ['taxes', 'sales', 'exports'] as const;
export const EXPENSE_FIELDS = ['wages', 'upkeep', 'imports', 'investments'] as const;
export type BudgetLine = (typeof INCOME_FIELDS)[number] | (typeof EXPENSE_FIELDS)[number];

export interface BudgetSummary {
  income: number;
  expense: number;
  net: number;
}

export function budgetSummary(b: BudgetDay | undefined): BudgetSummary {
  if (!b) return { income: 0, expense: 0, net: 0 };
  let income = 0;
  let expense = 0;
  for (const f of INCOME_FIELDS) income += b[f];
  for (const f of EXPENSE_FIELDS) expense += b[f];
  return { income, expense, net: income - expense };
}

/** Suma kilku dni (np. tygodnia). */
export function budgetTotal(days: readonly BudgetDay[]): BudgetSummary {
  const out = { income: 0, expense: 0, net: 0 };
  for (const b of days) {
    const x = budgetSummary(b);
    out.income += x.income;
    out.expense += x.expense;
    out.net += x.net;
  }
  return out;
}

/** Bilans z opisem: „+120 – na plusie”. */
export function balanceText(net: number): string {
  const r = Math.round(net);
  return t(r > 0 ? 'town.balance.plus' : r < 0 ? 'town.balance.minus' : 'town.balance.even', { n: signed(r) });
}

// ---------------------------------------------------------------- mieszkańcy

/** Dni do dorosłości dziecka (0 dla dorosłych). */
export function daysToAdult(r: Resident, day: number, c: Content = CONTENT): number {
  if (!r.child) return 0;
  return Math.max(0, r.bornDay + c.settlement.constants.childDays - day);
}

/** Urodzony w osadzie (a nie przybyły z rodziną). */
export const bornHere = (r: Resident): boolean => r.bornDay >= 0 && r.bornDay >= r.arrivedDay;

/** Wiek: dziecko – ile dni do dorosłości; dorosły – rodem z osady albo przybysz. */
export function ageText(r: Resident, day: number, c: Content = CONTENT): string {
  if (r.child) {
    const n = daysToAdult(r, day, c);
    return n > 1 ? t('resident.age.child', { days: daysText(n) }) : t('resident.age.childSoon');
  }
  return bornHere(r) ? t('resident.age.adultBorn') : t('resident.age.adult');
}

/** Od kiedy w osadzie: dzień narodzin albo przyjazdu. */
export const sinceText = (r: Resident): string => (bornHere(r) ? t('resident.born', { day: r.bornDay + 1 }) : t('resident.arrived', { day: r.arrivedDay + 1 }));

export const relationLabel = (kind: RelationKind): string => t(`resident.rel.${kind}`);

/** Imię bez nazwiska („Ala Nowak” → „Ala”). */
export function givenName(name: string): string {
  const i = name.indexOf(' ');
  return i < 0 ? name : name.slice(0, i);
}

// ---------------------------------------------------------------- wydarzenia (aktywne)

export const GOOD_EVENTS: readonly string[] = ['festival', 'harvest', 'richCaravan'];

/** Tytuł aktywnego wydarzenia; `building` = typ budynku celu (pożar, awaria, epidemia). */
export function eventTitle(kind: SettlementEventKind | string, building?: string): string {
  const key = `town.event.${kind}`;
  if (!has(key)) return t('town.event.other');
  return t(key, { building: building ? buildingName(building) : t('town.event.someBuilding') });
}

export function eventDesc(kind: SettlementEventKind | string): string {
  const key = `town.event.${kind}.desc`;
  return has(key) ? t(key) : '';
}

// ---------------------------------------------------------------- rada

/** Parametry tekstu propozycji z szablonu (procenty, dni, ilości). */
function proposalParams(tpl: ProposalTpl | undefined, c: Content): Record<string, string | number> {
  const k = c.settlement.constants;
  return {
    building: tpl?.building ? buildingName(tpl.building) : '',
    value: Math.round(Math.abs(tpl?.value ?? 0) * 100),
    days: daysText(tpl?.days ?? k.voucherDays),
    item: tpl?.item ? itemName(tpl.item) : '',
    qty: tpl?.qty ?? 0,
    discount: Math.round(k.voucherDiscount * 100),
  };
}

const tplOf = (tplId: string, c: Content): ProposalTpl | undefined => c.settlement.proposals.find((p) => p.id === tplId);

export function proposalTitle(tplId: string, c: Content = CONTENT): string {
  const key = `town.proposal.${tplId}`;
  return has(key) ? t(key, proposalParams(tplOf(tplId, c), c)) : t('town.proposal.other');
}

export function proposalDesc(tplId: string, c: Content = CONTENT): string {
  const key = `town.proposal.${tplId}.desc`;
  return has(key) ? t(key, proposalParams(tplOf(tplId, c), c)) : '';
}

/** Skutek zatwierdzenia: bon na budowę, obniżka podatku, festyn, dotacja; `discount` = bieżąca zniżka bonu (0..1). */
export function proposalEffect(tplId: string, c: Content = CONTENT, discount?: number): string {
  const tpl = tplOf(tplId, c);
  if (!tpl) return '';
  const p = proposalParams(tpl, c);
  if (discount !== undefined) p.discount = Math.round(discount * 100);
  return t(`town.effect.${tpl.kind}`, p);
}

// ---------------------------------------------------------------- kronika

/**
 * Rodzaje wpisów kroniki znane interfejsowi. Pierwsza grupa pochodzi z `chronicle(ctx, …)` w src/sim, reszta
 * odpowiada zdarzeniom osady z src/sim/events.ts (moduły w toku mogą je dopisać) – nieznany rodzaj → tekst ogólny.
 */
export const CHRONICLE_KINDS = [
  'arrived', 'left', 'born', 'grewUp', 'wedding', 'quarrel', 'placed', 'constructed', 'repaired', 'territory', 'tierUp', 'tax', 'unpaid',
  'proposal', 'decided', 'specialized', 'renamed', 'caravan', 'caravanLeft', 'fire', 'fireOut', 'breakdown', 'epidemic', 'epidemicOver',
  'treated', 'crisis', 'goodEvent', 'eventOver',
  'founded', 'friend', 'love', 'festival', 'harvest', 'richCaravan', 'traded', 'budget',
] as const;

/** Flaga w parametrach wpisu (1, '1', 'true', 'yes'). */
const yes = (v: string | number | undefined): boolean => v === 1 || v === '1' || v === 'true' || v === 'yes';

const KIND_ICONS: Record<string, string> = {
  founded: 'townhall',
  arrived: 'people',
  left: 'face-sad',
  born: 'baby',
  grewUp: 'star',
  wedding: 'rings',
  quarrel: 'warning',
  friend: 'smile',
  love: 'heart',
  placed: 'hammer',
  constructed: 'hammer',
  repaired: 'wrench',
  territory: 'map',
  tierUp: 'crown',
  renamed: 'townhall',
  tax: 'scales',
  fire: 'flame',
  fireOut: 'flame',
  breakdown: 'wrench',
  epidemic: 'medkit',
  epidemicOver: 'medkit',
  treated: 'medkit',
  crisis: 'chart',
  goodEvent: 'balloon',
  eventOver: 'scroll',
  festival: 'balloon',
  harvest: 'bread',
  richCaravan: 'wagon',
  caravan: 'wagon',
  caravanLeft: 'wagon',
  traded: 'scales',
  proposal: 'scroll',
  decided: 'scroll',
  budget: 'chart',
  unpaid: 'warning',
  specialized: 'crown',
};

/** Ton wpisu (kolor ikony): dobre wieści, kłopoty, zwykłe. */
const BAD_KINDS = new Set(['left', 'quarrel', 'fire', 'breakdown', 'epidemic', 'crisis', 'unpaid']);
const GOOD_KINDS = new Set(['arrived', 'born', 'grewUp', 'wedding', 'friend', 'love', 'constructed', 'repaired', 'tierUp', 'fireOut', 'epidemicOver', 'treated', 'goodEvent', 'festival', 'harvest', 'richCaravan', 'specialized', 'founded']);

/** Rodzaj wydarzenia w parametrze `kind` (dobre wydarzenie, koniec wydarzenia). */
const subKind = (e: Pick<ChronicleEntry, 'kind' | 'params'>): string | undefined => {
  const k = e.params?.kind;
  return (e.kind === 'goodEvent' || e.kind === 'eventOver') && typeof k === 'string' ? k : undefined;
};

export function chronicleTone(e: Pick<ChronicleEntry, 'kind' | 'params'> | string): 'good' | 'bad' | 'plain' {
  const entry = typeof e === 'string' ? { kind: e } : e;
  if (entry.kind === 'eventOver') return subKind(entry) === 'crisis' ? 'good' : 'plain';
  if (entry.kind === 'fireOut' && yes(entry.params?.damaged)) return 'plain';
  return BAD_KINDS.has(entry.kind) ? 'bad' : GOOD_KINDS.has(entry.kind) ? 'good' : 'plain';
}

/** Ikona wpisu kroniki (wg rodzaju wydarzenia dla `goodEvent`/`eventOver`; nieznany rodzaj → zwój). */
export function chronicleIcon(e: Pick<ChronicleEntry, 'kind' | 'params'> | string): string {
  const entry = typeof e === 'string' ? { kind: e } : e;
  const sub = subKind(entry);
  return (sub && entry.kind === 'goodEvent' ? KIND_ICONS[sub] : undefined) ?? KIND_ICONS[entry.kind] ?? 'scroll';
}

/** Ikona aktywnego wydarzenia. */
export const eventIcon = (kind: string): string => KIND_ICONS[kind] ?? 'warning';

/** Odczyt stanu dla parametrów-identyfikatorów (uid budynku, id mieszkańca); kronika sama jest bezstanowa. */
export interface ChronicleLookup {
  /** uid budynku → typ budynku. */
  building?(uid: number): string | undefined;
  /** id mieszkańca → imię i nazwisko. */
  resident?(id: number): string | undefined;
}

function maybe(prefix: string, id: string | number): string {
  const key = `${prefix}.${id}`;
  return has(key) ? t(key) : String(id);
}

const BUILDING_REFS = ['uid', 'home', 'target'] as const;

/** Parametr wpisu w postaci do wyświetlenia (nazwy budynków, przedmiotów, partnerów, etapów…). */
function formatParam(kind: string, name: string, v: string | number, c: Content, look: ChronicleLookup): string | number {
  switch (name) {
    case 'building':
    case 'type':
      return typeof v === 'string' && has(`building.${v}`) ? buildingName(v) : String(v);
    case 'item':
      return typeof v === 'string' && has(`item.${v}`) ? itemName(v) : String(v);
    case 'from':
    case 'partner':
      return maybe('partner', v);
    case 'tier': {
      const id = typeof v === 'number' ? c.settlement.tiers[v]?.id : v;
      return id ? maybe('tier', id) : String(v);
    }
    case 'spec':
      return maybe('spec', v);
    case 'id':
      return kind === 'specialized' ? maybe('spec', v) : v;
    case 'tpl':
      return proposalTitle(String(v), c);
    case 'a':
    case 'b':
    case 'name':
      return typeof v === 'number' ? (look.resident?.(v) ?? '…') : v;
    case 'days':
      return typeof v === 'number' ? daysText(v) : v;
    case 'net':
      return typeof v === 'number' ? signed(v) : v;
    case 'rate':
      return typeof v === 'number' ? `${v}%` : v;
    case 'count':
    case 'qty':
    case 'cost':
    case 'coins':
    case 'missing':
      return typeof v === 'number' ? fmt(v) : v;
    default:
      return v;
  }
}

/** Wariant tekstu zależny od parametru (np. decided.yes / decided.no, traded.export / traded.import). */
function variantKey(kind: string, p: Record<string, string | number>): string | null {
  const base = `chronicle.${kind}`;
  const tries: string[] = [];
  if (p.dir !== undefined) tries.push(`${base}.${p.dir}`);
  if (p.kind !== undefined) tries.push(`${base}.${p.kind}`);
  if (p.approve !== undefined) tries.push(`${base}.${yes(p.approve) ? 'yes' : 'no'}`);
  if (p.damaged !== undefined && yes(p.damaged)) tries.push(`${base}.damaged`);
  if (p.spread !== undefined && yes(p.spread)) tries.push(`${base}.spread`);
  if (kind === 'left' && (p.reason === undefined || !has(`chronicle.reason.${p.reason}`))) tries.push(`${base}.plain`);
  if (kind === 'arrived' && !p.family) tries.push(`${base}.noname`);
  return tries.find((k) => has(k)) ?? null;
}

/**
 * Tekst wpisu kroniki z parametrami. Nieznany rodzaj → tekst ogólny; gdy brakuje parametru, a jest wariant
 * `.plain` – wariant bez parametrów, inaczej brakujące miejsce zastępuje „…”.
 */
export function chronicleText(e: ChronicleEntry, c: Content = CONTENT, look: ChronicleLookup = {}): string {
  const raw: Record<string, string | number> = { ...(e.params ?? {}) };
  // uid budynku zamiast typu (np. zdarzenia pożaru) → typ z bieżącego stanu
  if (raw.building === undefined) {
    for (const k of BUILDING_REFS) {
      const v = raw[k];
      const type = typeof v === 'number' ? look.building?.(v) : undefined;
      if (type) {
        raw.building = type;
        break;
      }
    }
  }
  const p: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(raw)) p[k] = formatParam(e.kind, k, v, c, look);
  if (typeof raw.count === 'number') p.people = plural(raw.count, t('chronicle.people.one'), t('chronicle.people.few'), t('chronicle.people.many'));
  if (raw.reason !== undefined) p.reason = has(`chronicle.reason.${raw.reason}`) ? t(`chronicle.reason.${raw.reason}`) : String(raw.reason);
  const key = variantKey(e.kind, raw) ?? `chronicle.${e.kind}`;
  if (!has(key)) return t('chronicle.unknown');
  const text = t(key, p);
  if (!/\{\w+\}/.test(text)) return text;
  const plain = `chronicle.${e.kind}.plain`;
  return has(plain) && key !== plain ? t(plain) : text.replace(/\{\w+\}/g, '…');
}
