// Lokalizacja: pliki JSON z płaskimi kluczami, interpolacja {param}, przełączanie w locie.

import en from './en.json';
import pl from './pl.json';

export type Lang = 'pl' | 'en';
export type Dict = Record<string, string>;

export const DICTS: Record<Lang, Dict> = { pl: { ...pl }, en: { ...en } };

// Części słownika (np. osada): src/i18n/parts/<nazwa>.<pl|en>.json – dołączane przy starcie, każdy moduł ma własne pliki.
const PARTS = import.meta.glob<Dict>('./parts/*.json', { eager: true, import: 'default' });
for (const [path, dict] of Object.entries(PARTS)) {
  const m = /\.(pl|en)\.json$/.exec(path);
  if (m) Object.assign(DICTS[m[1] as Lang], dict);
}

let lang: Lang = 'pl';
const listeners = new Set<(l: Lang) => void>();

export function detectLanguage(): Lang {
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'pl';
  return nav.toLowerCase().startsWith('pl') ? 'pl' : 'en';
}

export function setLanguage(next: Lang): void {
  if (next === lang) return;
  lang = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const l of listeners) l(next);
}

export const getLanguage = (): Lang => lang;

export function onLanguageChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key: string, params?: Record<string, string | number>): string {
  const raw = DICTS[lang][key] ?? DICTS.pl[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}

export const has = (key: string): boolean => key in DICTS[lang];

// Skróty dla nazw z danych gry.
export const itemName = (id: string) => t(`item.${id}`);
export const buildingName = (id: string) => t(`building.${id}`);
export const animalName = (id: string) => t(`animal.${id}`);
export const npcName = (id: string) => t(`npc.${id}`);

/** Formatowanie liczb zgodnie z językiem. */
export function fmt(n: number): string {
  return new Intl.NumberFormat(lang === 'pl' ? 'pl-PL' : 'en-GB').format(Math.round(n));
}

/** Tłumaczy statyczny HTML: data-i18n (tekst), data-i18n-aria (aria-label), data-i18n-title. */
export function translateDom(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n!)));
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria!)));
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle!)));
}
