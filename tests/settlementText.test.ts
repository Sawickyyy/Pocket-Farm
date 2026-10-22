// Teksty panelu „Osada”: kronika (każdy znany rodzaj, pl i en), warianty i zapas, budżet, wiek, czas.

import { afterEach, describe, expect, it } from 'vitest';
import { CONTENT } from '../src/content/content';
import { DICTS, fmt, setLanguage, t, type Lang } from '../src/i18n/i18n';
import { DAY_MS, HOUR_MS } from '../src/sim/calendar';
import type { BudgetDay, ChronicleEntry, Resident } from '../src/sim/types';
import {
  CHRONICLE_KINDS,
  ageText,
  balanceText,
  budgetSummary,
  budgetTotal,
  chronicleIcon,
  chronicleText,
  chronicleTone,
  daysText,
  daysToAdult,
  hourText,
  moodLevel,
  pct,
  proposalDesc,
  proposalEffect,
  proposalTitle,
  signed,
  sinceText,
  timeLeftText,
} from '../src/ui/settlementText';

const MINUS = '−';

afterEach(() => setLanguage('pl'));

/** Parametry jak w wywołaniach `chronicle(ctx, …)` w src/sim (i zdarzeniach osady). */
const SAMPLES: Record<(typeof CHRONICLE_KINDS)[number], Record<string, string | number>> = {
  arrived: { family: 'Nowak', count: 3 },
  left: { count: 2, reason: 'unhappy' },
  born: { name: 'Ala Nowak' },
  grewUp: { name: 'Ala Nowak' },
  wedding: { a: 'Ala Nowak', b: 'Bartek Mazur' },
  quarrel: { a: 'Ala Nowak', b: 'Bartek Mazur' },
  placed: { building: 'house' },
  constructed: { building: 'house' },
  repaired: { building: 'well' },
  territory: { chunk: 29, cost: 300 },
  tierUp: { tier: 2 },
  tax: { rate: 15 },
  unpaid: { missing: 40 },
  proposal: { tpl: 'need_well' },
  decided: { tpl: 'need_well', approve: 1 },
  specialized: { id: 'agri' },
  renamed: { name: 'Słonecznikowo' },
  caravan: { from: 'port' },
  caravanLeft: { from: 'port' },
  fire: { building: 'house' },
  fireOut: { building: 'house', damaged: 0 },
  breakdown: { building: 'mill' },
  epidemic: { building: 'coop', days: 3 },
  epidemicOver: { building: 'coop' },
  treated: { building: 'coop' },
  crisis: { days: 3 },
  goodEvent: { kind: 'festival' },
  eventOver: { kind: 'crisis' },
  founded: {},
  friend: { a: 'Ala Nowak', b: 'Bartek Mazur' },
  love: { a: 'Ala Nowak', b: 'Bartek Mazur' },
  festival: {},
  harvest: {},
  richCaravan: {},
  traded: { item: 'bread', qty: 5, coins: 60, dir: 'export' },
  budget: { net: 120 },
};

const entry = (kind: string, params?: Record<string, string | number>): ChronicleEntry => (params ? { day: 3, hour: 9, kind, params } : { day: 3, hour: 9, kind });

function resident(over: Partial<Resident> = {}): Resident {
  return {
    id: 1,
    name: 'Ala Nowak',
    family: 1,
    child: false,
    bornDay: -1,
    home: null,
    job: null,
    needs: { food: 0.7, housing: 0.7, work: 0.7, safety: 0.7, fun: 0.7 },
    happiness: 0.7,
    sadDays: 0,
    homelessDays: 0,
    arrivedDay: 2,
    look: 0,
    meals: { eaten: 0, due: 0, kinds: [] },
    mood: { value: 0, untilDay: -1 },
    ...over,
  };
}

const day = (over: Partial<BudgetDay> = {}): BudgetDay => ({ day: 4, taxes: 0, sales: 0, exports: 0, wages: 0, upkeep: 0, imports: 0, investments: 0, ...over });

describe('kronika osady', () => {
  for (const lang of ['pl', 'en'] as Lang[]) {
    it(`${lang}: każdy znany rodzaj ma własny tekst z wstawionymi parametrami`, () => {
      setLanguage(lang);
      const unknown = t('chronicle.unknown');
      for (const kind of CHRONICLE_KINDS) {
        const text = chronicleText(entry(kind, SAMPLES[kind]));
        expect(text, kind).not.toBe(unknown);
        expect(text, kind).not.toMatch(/[{}]|…/);
        expect(text.length, kind).toBeGreaterThan(5);
      }
    });
  }

  it('pl: nazwy budynków, przedmiotów, etapów, partnerów i odmiana liczby osób', () => {
    expect(chronicleText(entry('arrived', { family: 'Nowak', count: 3 }))).toBe('Przyjechała rodzina Nowak – 3 osoby.');
    expect(chronicleText(entry('arrived', { family: 'Nowak', count: 1 }))).toBe('Przyjechała rodzina Nowak – 1 osoba.');
    expect(chronicleText(entry('arrived', { family: 'Lis', count: 5 }))).toBe('Przyjechała rodzina Lis – 5 osób.');
    expect(chronicleText(entry('left', { count: 2, reason: 'homeless' }))).toBe('Wyjazd: 2 osoby, powód: brak domu.');
    expect(chronicleText(entry('constructed', { building: 'house' }))).toBe('Ukończono budowę: Dom.');
    expect(chronicleText(entry('tierUp', { tier: 2 }))).toBe('Nowy etap rozwoju: Wieś!');
    expect(chronicleText(entry('caravan', { from: 'oldvillage' }))).toBe('Przyjechała karawana – Stara Wieś.');
    expect(chronicleText(entry('traded', { item: 'bread', qty: 5, coins: 60, dir: 'import' }))).toBe('Kupiono od karawany 5 × Chleb za 60 monet.');
    expect(chronicleText(entry('tax', { rate: 15 }))).toBe('Nowa stawka podatku: 15%.');
    expect(chronicleText(entry('decided', { tpl: 'festival', approve: 0 }))).toBe('Odrzucono wniosek: Festyn w osadzie.');
    expect(chronicleText(entry('specialized', { id: 'trade' }))).toBe('Osada wybrała specjalizację: Kupiecka.');
    expect(chronicleText(entry('epidemic', { building: 'coop', days: 3 }))).toContain('3 dni');
  });

  it('en: the same entries in English', () => {
    setLanguage('en');
    expect(chronicleText(entry('arrived', { family: 'Nowak', count: 3 }))).toBe('The Nowak family moved in – 3 people.');
    expect(chronicleText(entry('arrived', { family: 'Nowak', count: 1 }))).toBe('The Nowak family moved in – 1 person.');
    expect(chronicleText(entry('wedding', { a: 'Ala', b: 'Bartek' }))).toBe('A wedding! Ala and Bartek are now a family.');
    expect(chronicleText(entry('decided', { tpl: 'need_well', approve: 1 }))).toBe('Approved: A well for the settlement.');
    expect(chronicleText(entry('unpaid', { missing: 40 }))).toBe('40 coins short for wages – workers are disappointed.');
    expect(chronicleText(entry('budget', { net: -35 }))).toBe(`Day's balance: ${MINUS}35 coins.`);
  });

  it('warianty zależne od parametrów', () => {
    expect(chronicleText(entry('fireOut', { building: 'house', damaged: 1 }))).toBe('Ugaszono pożar – Dom wymaga naprawy.');
    expect(chronicleText(entry('fireOut', { building: 'house', damaged: 0 }))).toBe('Ugaszono pożar: Dom.');
    expect(chronicleText(entry('fire', { building: 'hut', spread: 1 }))).toContain('przeskoczył');
    expect(chronicleText(entry('goodEvent', { kind: 'harvest' }))).toContain('Urodzaj');
    expect(chronicleText(entry('eventOver', { kind: 'crisis' }))).toContain('Kryzys minął');
    expect(chronicleText(entry('eventOver', { kind: 'storm' }))).toBe('Wydarzenie dobiegło końca.');
    expect(chronicleText(entry('arrived', { count: 2 }))).toBe('Przyjechała nowa rodzina – 2 osoby.');
  });

  it('nieznany rodzaj i brak parametrów: bezpieczny zapas', () => {
    expect(chronicleText(entry('meteor', { size: 3 }))).toBe('W osadzie coś się wydarzyło.');
    expect(chronicleText(entry('treated'))).toBe('Wyleczono zwierzęta.');
    expect(chronicleText(entry('left', { count: 1, reason: 'boredom' }))).toBe('Część mieszkańców wyjechała z osady.');
    expect(chronicleText(entry('wedding', { a: 'Ala' }))).toBe('W osadzie odbył się ślub!');
    // rodzaj bez wariantu `.plain`: brakujący parametr zastępuje wielokropek
    expect(chronicleText(entry('decided', { approve: 1 }))).toBe('Przyjęto wniosek: ….');
    expect(chronicleText(entry('proposal', { tpl: 'nowy_szablon' }))).toBe('Nowy wniosek rady: Wniosek mieszkańców.');
    setLanguage('en');
    expect(chronicleText(entry('meteor'))).toBe('Something happened in the settlement.');
  });

  it('identyfikatory (uid budynku, id mieszkańca) rozwiązuje przekazany odczyt stanu', () => {
    const look = { building: (uid: number) => (uid === 7 ? 'bakery' : undefined), resident: (id: number) => (id === 3 ? 'Ola Kos' : undefined) };
    expect(chronicleText(entry('breakdown', { uid: 7 }), CONTENT, look)).toBe('Awaria: Piekarnia stoi.');
    expect(chronicleText(entry('breakdown', { uid: 99 }), CONTENT, look)).toBe('W osadzie doszło do awarii.');
    expect(chronicleText(entry('friend', { a: 3, b: 4 }), CONTENT, look)).toBe('Ola Kos i … to teraz przyjaciele.');
  });

  it('ikony i ton wpisów', () => {
    expect(chronicleIcon('wedding')).toBe('rings');
    expect(chronicleIcon('meteor')).toBe('scroll');
    expect(chronicleIcon(entry('goodEvent', { kind: 'richCaravan' }))).toBe('wagon');
    expect(chronicleTone('fire')).toBe('bad');
    expect(chronicleTone('born')).toBe('good');
    expect(chronicleTone(entry('eventOver', { kind: 'crisis' }))).toBe('good');
    expect(chronicleTone(entry('fireOut', { damaged: 1 }))).toBe('plain');
  });
});

describe('rada: teksty propozycji', () => {
  for (const lang of ['pl', 'en'] as Lang[]) {
    it(`${lang}: każdy szablon ma tytuł, opis i skutek`, () => {
      setLanguage(lang);
      for (const tpl of CONTENT.settlement.proposals) {
        expect(DICTS[lang][`town.proposal.${tpl.id}`], tpl.id).toBeTruthy();
        expect(proposalTitle(tpl.id), tpl.id).not.toBe(t('town.proposal.other'));
        expect(proposalDesc(tpl.id).length, tpl.id).toBeGreaterThan(10);
        expect(proposalEffect(tpl.id), tpl.id).not.toMatch(/[{}]/);
      }
    });
  }

  it('skutek z bieżącą zniżką i parametrami szablonu', () => {
    expect(proposalEffect('need_well')).toBe('Po przyjęciu: bon −40% na budynek Studnia przez 5 dni');
    expect(proposalEffect('need_well', CONTENT, 0.5)).toContain('−50%');
    expect(proposalEffect('lower_taxes')).toContain('5 pkt');
    expect(proposalEffect('tools_grant')).toBe('Po przyjęciu: dostawa 5 × Narzędzia');
    expect(proposalEffect('festival')).toBe('Po przyjęciu: rozrywka +15% przez 2 dni');
    expect(proposalEffect('nieznany')).toBe('');
  });
});

describe('budżet', () => {
  it('suma przychodów, wydatków i bilans', () => {
    const b = day({ taxes: 30, sales: 12, exports: 50, wages: 40, upkeep: 9, imports: 5, investments: 100 });
    expect(budgetSummary(b)).toEqual({ income: 92, expense: 154, net: -62 });
    expect(budgetSummary(undefined)).toEqual({ income: 0, expense: 0, net: 0 });
    expect(budgetTotal([b, day({ taxes: 70 })])).toEqual({ income: 162, expense: 154, net: 8 });
  });

  it('bilans ze znakiem i opisem (pl/en)', () => {
    expect(signed(120)).toBe('+120');
    expect(signed(-56.4)).toBe(`${MINUS}56`);
    expect(signed(0.3)).toBe('0');
    expect(signed(12345)).toBe(`+${fmt(12345)}`);
    expect(balanceText(120)).toBe('+120 – osada zarabia');
    expect(balanceText(-8)).toBe(`${MINUS}8 – wydatki przewyższają przychody`);
    expect(balanceText(0)).toBe('Wychodzimy na zero');
    setLanguage('en');
    expect(balanceText(15)).toBe('+15 – the settlement is earning');
  });
});

describe('wiek, czas i nastrój', () => {
  const childDays = CONTENT.settlement.constants.childDays;

  it('dziecko: dni do dorosłości; dorosły: przybysz albo rodem z osady', () => {
    const kid = resident({ child: true, bornDay: 5, arrivedDay: 5 });
    expect(daysToAdult(kid, 8)).toBe(childDays - 3);
    expect(ageText(kid, 8)).toBe(`dziecko – dorośnie za ${daysText(childDays - 3)}`);
    expect(ageText(kid, 5 + childDays - 1)).toBe('dziecko – dorośnie jutro');
    expect(daysToAdult(resident(), 8)).toBe(0);
    expect(ageText(resident(), 8)).toBe('osoba dorosła');
    expect(ageText(resident({ bornDay: 1, arrivedDay: 1 }), 30)).toBe('osoba dorosła, rodem z osady');
    // dziecko, które przyjechało z rodziną, nie jest „rodem z osady”
    expect(ageText(resident({ bornDay: 0, arrivedDay: 4 }), 30)).toBe('osoba dorosła');
    expect(sinceText(resident({ arrivedDay: 2 }))).toBe('W osadzie od dnia 3');
    expect(sinceText(resident({ bornDay: 6, arrivedDay: 6 }))).toBe('Na świecie od dnia 7');
    setLanguage('en');
    expect(ageText(kid, 8)).toBe(`child – grows up in ${childDays - 3} days`);
  });

  it('dni, godziny i pozostały czas', () => {
    expect(daysText(1)).toBe('1 dzień');
    expect(daysText(4)).toBe('4 dni');
    expect(hourText(7)).toBe('07:00');
    expect(hourText(18.9)).toBe('18:00');
    expect(timeLeftText(3 * HOUR_MS)).toBe('jeszcze 3 h');
    expect(timeLeftText(2 * DAY_MS)).toBe('jeszcze 2 dni');
    expect(timeLeftText(0)).toBe('dobiega końca');
    setLanguage('en');
    expect(daysText(1)).toBe('1 day');
    expect(timeLeftText(DAY_MS + 1)).toBe('2 days left');
  });

  it('procent i poziom buzi', () => {
    expect(pct(0.456)).toBe('46%');
    expect(pct(1.4)).toBe('100%');
    expect(moodLevel(0.6)).toBe('happy');
    expect(moodLevel(0.4)).toBe('ok');
    expect(moodLevel(0.2)).toBe('sad');
  });
});
