import type { FailReason } from '../game/logic';

export function formatDuration(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return rest && m < 10 ? `${m} min ${rest} s` : `${Math.round(s / 60)} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h} h ${rm} min` : `${h} h`;
}

const nf = new Intl.NumberFormat('pl-PL');
export const formatNumber = (n: number): string => nf.format(n);

/** Polska odmiana: 1 roślina, 2–4 rośliny, 5+ roślin. */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10;
  const dd = n % 100;
  return d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14) ? few : many;
}

export const FAIL_MESSAGES: Record<FailReason, string> = {
  locked: 'To pole jest zablokowane.',
  'not-adjacent': 'Najpierw odblokuj sąsiednie pole.',
  'already-unlocked': 'To pole jest już Twoje.',
  'already-tilled': 'Pole jest już zaorane – wybierz nasiona.',
  'not-tilled': 'Najpierw zaoraj pole motyką.',
  occupied: 'Tu już coś rośnie.',
  'no-seeds': 'Brak nasion – kup je w sklepie.',
  'nothing-to-water': 'Nie ma czego podlać – najpierw posiej.',
  'already-watered': 'Ta roślina jest już podlana.',
  'nothing-to-harvest': 'Tu nic nie rośnie.',
  'not-ready': 'Jeszcze nie dojrzało.',
  'no-coins': 'Za mało monet.',
  'level-too-low': 'Za niski poziom.',
  'max-level': 'Maksymalny poziom ulepszenia.',
  'nothing-to-sell': 'Nie masz nic do sprzedania.',
  invalid: 'Nie można tego zrobić.',
};
