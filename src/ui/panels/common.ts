import type { MascotMood } from '../../render/art/mascot';
import { h, img } from '../dom';
import { ic, icEl, mascotEl } from '../uiIcons';

export interface BtnOpts {
  primary?: boolean;
  disabled?: boolean | undefined;
  danger?: boolean;
  /** Złoty przycisk nagrody (odbierz, oddaj, sprzedaj wszystko). */
  reward?: boolean;
  small?: boolean;
  aria?: string | undefined;
  /** Malowana ikona przed napisem (albo zamiast niego, gdy napis pusty). */
  icon?: string;
}

export function btn(label: string, onClick: () => void, opts: BtnOpts = {}): HTMLButtonElement {
  const kind = opts.danger ? 'danger' : opts.reward ? 'reward' : opts.primary !== false ? 'primary' : '';
  const cls = ['btn', kind, opts.small ? 'sm' : ''].filter(Boolean).join(' ');
  const b = h('button', { class: cls, type: 'button', disabled: opts.disabled, attrs: { 'aria-label': opts.aria }, on: { click: onClick } });
  if (opts.icon) b.append(icEl(opts.icon));
  if (label) b.append(document.createTextNode(label));
  return b;
}

export function card(icon: string | null, titleHtml: string, descHtml: string, actions: HTMLElement[] = [], opts: { note?: string | undefined; cls?: string | undefined } = {}): HTMLElement {
  const thumb = icon ? h('div', { class: 'thumb' }, img(icon)) : h('div');
  return h(
    'div',
    { class: `card ${opts.cls ?? ''}` },
    thumb,
    h('div', {}, h('h4', { html: titleHtml }), h('p', { html: descHtml }), opts.note ? h('p', { class: 'locked-note', text: opts.note }) : null),
    h('div', { class: 'actions' }, ...actions),
  );
}

export function bar(ratio: number, warn = false, dataKey?: string): HTMLElement {
  const fill = h('i');
  fill.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
  return h('div', { class: `bar${warn ? ' warn' : ''}`, attrs: { 'data-bar': dataKey } }, fill);
}

export function setBar(root: HTMLElement, key: string, ratio: number): void {
  const fill = root.querySelector<HTMLElement>(`[data-bar="${key}"] > i`);
  if (fill) fill.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
}

export const coins = (n: string | number) => `<span class="price">${n}${ic('coin')}</span>`;

export function grid(children: (HTMLElement | null)[], two = false): HTMLElement {
  return h('div', { class: `cards${two ? ' two' : ''}` }, ...children);
}

/** Pusty stan z Kiełkiem zamiast suchego komunikatu. */
export function empty(text: string, mood: MascotMood = 'happy'): HTMLElement {
  return h('div', { class: 'empty' }, mascotEl(mood), h('p', { text }));
}

/** Serduszka przyjaźni jak koraliki na sznurku (HTML). */
export function hearts(n: number, max = 10): string {
  return ic('heart').repeat(Math.max(0, Math.min(max, n))) + ic('heart-empty').repeat(Math.max(0, max - n));
}
