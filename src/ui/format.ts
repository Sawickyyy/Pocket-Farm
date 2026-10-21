import { parseKey, type Quality } from '../content/content';
import { getLanguage, itemName, t } from '../i18n/i18n';

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

/** Polska odmiana: 1 roślina, 2–4 rośliny, 5+ roślin (w angielskim: one/other). */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  if (getLanguage() === 'en') return many;
  const d = n % 10;
  const dd = n % 100;
  return d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14) ? few : many;
}

/** Gwiazdki jakości: różna liczba i kolor (czytelne także dla daltonistów). */
export function qualityMark(q: Quality): string {
  return q === 2 ? ' <span class="q2" aria-label="' + t('quality.2') + '">★★</span>' : q === 1 ? ' <span class="q1" aria-label="' + t('quality.1') + '">★</span>' : '';
}

export function keyLabelHtml(key: string): string {
  const { id, q } = parseKey(key);
  return `${itemName(id)}${qualityMark(q)}`;
}

export function keyLabel(key: string): string {
  const { id, q } = parseKey(key);
  return q ? `${itemName(id)} (${t(`quality.${q}`)})` : itemName(id);
}

export function clockText(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m - (m % 10)).padStart(2, '0')}`;
}

export const WEATHER_ICON: Record<string, string> = { sun: '☀️', cloud: '⛅', rain: '🌧️', heat: '🔥', snow: '❄️' };
