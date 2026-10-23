// HUD osady: buźka, odmiana nazwisk, komunikaty zdarzeń (łączenie, ważność, akcje), odznaka kafla, raport powrotu.

import { afterEach, describe, expect, it } from 'vitest';
import { CONTENT } from '../src/content/content';
import { DICTS, setLanguage, type Lang } from '../src/i18n/i18n';
import type { SimEvent } from '../src/sim/events';
import { createInitialState } from '../src/sim/initialState';
import type { GameState, Resident } from '../src/sim/types';
import {
  MAX_TOWN_TOASTS,
  TOWN_TOAST_EVENTS,
  faceFor,
  familyName,
  tierUnlocks,
  townAlert,
  townReportLines,
  townTileBadge,
  townToasts,
  townVisible,
} from '../src/ui/townHud';

afterEach(() => setLanguage('pl'));

const at = { x: 30, y: 26 };

function resident(id: number, name: string, family: number, child = false): Resident {
  return {
    id,
    name,
    family,
    child,
    bornDay: -1,
    home: 900,
    job: null,
    needs: { food: 0.7, housing: 0.7, work: 0.7, safety: 0.7, fun: 0.7 },
    happiness: 0.7,
    sadDays: 0,
    homelessDays: 0,
    arrivedDay: 0,
    look: 0,
    meals: { eaten: 0, due: 0, kinds: [] },
    mood: { value: 0, untilDay: -1 },
  };
}

function town(): GameState {
  const s = createInitialState(1_700_000_000_000, 42);
  s.objects.push({ uid: 900, type: 'house', x: 25, y: 25 }, { uid: 901, type: 'well', x: 28, y: 25 }, { uid: 902, type: 'tradepost', x: 25, y: 28 });
  s.settlement.residents.push(resident(1, 'Ala Nowak', 7), resident(2, 'Bartek Nowak', 7), resident(3, 'Zosia Nowak', 7, true), resident(4, 'Piotr Kos', 8));
  return s;
}

/** Każda gałąź komunikatów – do sprawdzenia, że nie zostaje surowy klucz w żadnym języku. */
const ALL: SimEvent[] = [
  { type: 'territory', chunk: 29, cost: 300 },
  { type: 'constructed', uid: 900, building: 'house', at },
  { type: 'arrived', family: 7, count: 3, home: 900, at },
  { type: 'left', count: 2, reason: 'unhappy' },
  { type: 'left', count: 1, reason: 'homeless' },
  { type: 'born', id: 3, name: 'Zosia Nowak' },
  { type: 'relation', kind: 'partner', a: 1, b: 4 },
  { type: 'fire', uid: 900, at },
  { type: 'fireOut', uid: 901, damaged: true, at },
  { type: 'breakdown', uid: 901, at },
  { type: 'repaired', uid: 901, at },
  { type: 'epidemic', home: 901, at },
  { type: 'epidemicOver', home: 901 },
  { type: 'crisis', days: 3 },
  { type: 'goodEvent', kind: 'festival' },
  { type: 'goodEvent', kind: 'harvest' },
  { type: 'goodEvent', kind: 'richCaravan' },
  { type: 'caravan', from: 'oldvillage' },
  { type: 'traded', item: 'bread', qty: 4, coins: 60, dir: 'export' },
  { type: 'proposal', id: 1, tpl: 'need_well' },
  { type: 'decided', id: 1, tpl: 'need_well', approve: true },
  { type: 'budget', day: 4, net: -12 },
  { type: 'unpaid', missing: 40 },
  { type: 'caravanLeft', from: 'port' },
];

describe('buźka szczęścia', () => {
  it('progi 0,6 i 0,4', () => {
    expect(faceFor(1)).toBe('face-happy');
    expect(faceFor(0.6)).toBe('face-happy');
    expect(faceFor(0.59)).toBe('face-ok');
    expect(faceFor(0.4)).toBe('face-ok');
    expect(faceFor(0.39)).toBe('face-sad');
    expect(faceFor(0)).toBe('face-sad');
  });
});

describe('nazwy rodzin', () => {
  it('polski dopełniacz liczby mnogiej dla nazwisk z danych gry', () => {
    const cases: Record<string, string> = {
      Nowak: 'Nowaków',
      Kaczmarek: 'Kaczmarków',
      Wieczorek: 'Wieczorków',
      Duda: 'Dudów',
      Sowa: 'Sowów',
      Jeleń: 'Jeleniów',
      Stępień: 'Stępniów',
      Sokół: 'Sokołów',
      Wróbel: 'Wróblów',
      Król: 'Królów',
      Kowalski: 'Kowalskich',
      Kowalska: 'Kowalskich',
    };
    for (const [nom, gen] of Object.entries(cases)) expect(familyName(nom, 'pl')).toBe(gen);
    // każde nazwisko z danych daje sensowną formę (kończy się na -ów/-ich)
    for (const f of CONTENT.settlement.names.family) expect(familyName(f, 'pl')).toMatch(/(ów|ich)$/);
  });

  it('po angielsku bez odmiany', () => {
    expect(familyName('Nowak', 'en')).toBe('Nowak');
  });
});

describe('komunikaty zdarzeń osady', () => {
  it('przybycie rodziny z nazwiskiem i liczbą osób', () => {
    const s = town();
    const [x] = townToasts([{ type: 'arrived', family: 7, count: 3, home: 900, at }], s);
    expect(x?.text).toBe('Przybyła rodzina Nowaków (3 osoby)');
    expect(x?.kind).toBe('good');
    setLanguage('en');
    expect(townToasts([{ type: 'arrived', family: 7, count: 1, home: 900, at }], s)[0]?.text).toBe('The Nowak family has arrived (1 person)');
  });

  it('kilka rodzin naraz łączy się w jeden komunikat', () => {
    const s = town();
    const list = townToasts(
      [
        { type: 'arrived', family: 7, count: 3, home: 900, at },
        { type: 'arrived', family: 8, count: 2, home: 900, at },
      ],
      s,
    );
    expect(list).toHaveLength(1);
    expect(list[0]!.text).toBe('Przybyły nowe rodziny: 2 (5 osób)');
  });

  it('budowy łączone, pożar najważniejszy i z przyciskiem do budynku', () => {
    const s = town();
    const list = townToasts(
      [
        { type: 'constructed', uid: 900, building: 'house', at },
        { type: 'constructed', uid: 901, building: 'well', at },
        { type: 'fire', uid: 900, at },
      ],
      s,
    );
    expect(list.map((x) => x.key)).toEqual(['fire', 'constructed']);
    expect(list[0]!.text).toBe('Pożar! Płonie: Dom');
    expect(list[0]!.kind).toBe('warn');
    expect(list[0]!.action?.focus).toEqual(at);
    expect(list[1]!.text).toBe('Skończone budowy: 2');
  });

  it('najwyżej kilka komunikatów z paczki, najważniejsze zostają', () => {
    const list = townToasts(ALL, town());
    expect(list).toHaveLength(MAX_TOWN_TOASTS);
    expect(list.map((x) => x.key)).toEqual(['fire', 'unpaid', 'left.unhappy']);
    expect(list[1]!.action?.tab).toBe('budget');
  });

  it('wyjazdy z powodem, ślub, narodziny, karawana, rada', () => {
    const s = town();
    const one = (e: SimEvent) => townToasts([e], s)[0]?.text;
    expect(one({ type: 'left', count: 3, reason: 'unhappy' })).toBe('3 mieszkańców wyjechało – było im tu smutno');
    expect(one({ type: 'left', count: 1, reason: 'homeless' })).toBe('Mieszkaniec wyjechał – nie miał gdzie mieszkać');
    expect(one({ type: 'relation', kind: 'partner', a: 1, b: 4 })).toBe('Wesele! Ala i Piotr biorą ślub');
    expect(townToasts([{ type: 'relation', kind: 'friend', a: 1, b: 4 }], s)).toEqual([]);
    expect(one({ type: 'born', id: 3, name: 'Zosia Nowak' })).toBe('W osadzie urodziło się dziecko: Zosia Nowak!');
    expect(one({ type: 'caravan', from: 'oldvillage' })).toBe('Przyjechała karawana ze Starej Wsi');
    expect(townToasts([{ type: 'caravan', from: 'port' }], s)[0]?.action?.tab).toBe('trade');
    expect(one({ type: 'proposal', id: 1, tpl: 'need_well' })).toBe('Rada ma nowy wniosek: Studnia dla osady');
    expect(townToasts([{ type: 'proposal', id: 1, tpl: 'need_well' }], s)[0]?.action?.tab).toBe('council');
    expect(one({ type: 'crisis', days: 3 })).toBe('Kryzys! Ceny niższe o 30% przez 3 dni');
  });

  it('auto-eksport tylko przy przyjeździe karawany', () => {
    const s = town();
    const traded: SimEvent = { type: 'traded', item: 'bread', qty: 4, coins: 60, dir: 'export' };
    expect(townToasts([traded], s)).toEqual([]);
    expect(townToasts([{ type: 'caravan', from: 'port' }, traded], s).map((x) => x.key)).toEqual(['caravan', 'exported']);
  });

  it('budżet: ujemny zawsze, dodatni co kilka dni, produkcja bez komunikatu', () => {
    const s = town();
    expect(townToasts([{ type: 'budget', day: 4, net: -12 }], s)[0]?.text).toBe('Dzień osady na minusie: −12 monet');
    expect(townToasts([{ type: 'budget', day: 3, net: 40 }], s)).toEqual([]);
    expect(townToasts([{ type: 'budget', day: 2, net: 40 }], s)[0]?.kind).toBe('good');
    expect(townToasts([{ type: 'produced', uid: 900, item: 'bread', qty: 1, at }], s)).toEqual([]);
    expect(TOWN_TOAST_EVENTS.has('produced')).toBe(false);
  });

  it('każdy komunikat ma tekst w obu językach (bez surowych kluczy)', () => {
    const s = town();
    for (const lang of ['pl', 'en'] as Lang[]) {
      setLanguage(lang);
      for (const e of ALL) {
        for (const x of townToasts([e], s)) {
          expect(x.text, `${lang} ${e.type}`).not.toMatch(/townEvent\.|\{\w+\}|partner\./);
          if (x.action) expect(x.action.label).not.toMatch(/townEvent\./);
        }
      }
    }
  });
});

describe('stan licznika i kafla', () => {
  it('licznik ukryty bez mieszkańców i domów', () => {
    const s = createInitialState(1_700_000_000_000, 42);
    expect(townVisible(s)).toBe(false);
    s.objects.push({ uid: 900, type: 'tent', x: 25, y: 25 });
    expect(townVisible(s)).toBe(true);
  });

  it('alarm i odznaka: pożar pilny, wnioski rady liczone', () => {
    const s = town();
    expect(townAlert(s)).toBe(null);
    expect(townTileBadge(s)).toEqual({ n: 0, urgent: false });
    s.settlement.proposals.push({ id: 1, tpl: 'need_well', support: 3, cost: 0, expiresDay: 9 });
    s.settlement.sites['901'] = { built: 1, damage: 0, fire: 0, broken: true, progress: 0, repair: 0 };
    expect(townAlert(s)).toBe('bad');
    expect(townTileBadge(s)).toEqual({ n: 2, urgent: false });
    s.settlement.sites['900'] = { built: 1, damage: 0.1, fire: 2, broken: false, progress: 0, repair: 0 };
    expect(townAlert(s)).toBe('fire');
    expect(townTileBadge(s)).toEqual({ n: 3, urgent: true });
  });

  it('odblokowania etapu', () => {
    expect(tierUnlocks(1)).toContain('house');
    expect(tierUnlocks(2)).toContain('townhall');
    expect(tierUnlocks(1)).not.toContain('tent');
  });
});

describe('raport po powrocie', () => {
  it('krótka linia o przyjazdach i wyjazdach', () => {
    expect(townReportLines({ arrived: 0, left: 0 })).toEqual([]);
    expect(townReportLines({ arrived: 5, left: 0 })).toEqual(['Nowi mieszkańcy osady: 5.']);
    expect(townReportLines({ arrived: 0, left: 2 })).toEqual(['Wyjechali z osady: 2.']);
    expect(townReportLines({ arrived: 4, left: 1 })).toEqual(['Osada: przybyło 4, wyjechało 1.']);
    setLanguage('en');
    expect(townReportLines({ arrived: 4, left: 1 })).toEqual(['Town: 4 arrived, 1 left.']);
  });

  it('klucze HUD osady w obu językach', () => {
    const mine = (d: Record<string, string>) => Object.keys(d).filter((k) => /^(townHud|townEvent|report\.town)\./.test(k)).sort();
    expect(mine(DICTS.en)).toEqual(mine(DICTS.pl));
    expect(mine(DICTS.pl).length).toBeGreaterThan(40);
  });
});
