import { h, img } from '../dom';

export function btn(label: string, onClick: () => void, opts: { primary?: boolean; disabled?: boolean | undefined; danger?: boolean; small?: boolean; aria?: string | undefined } = {}): HTMLButtonElement {
  const cls = ['btn', opts.primary !== false && !opts.danger ? 'primary' : '', opts.danger ? 'danger' : '', opts.small ? 'sm' : ''].filter(Boolean).join(' ');
  return h('button', { class: cls, type: 'button', text: label, disabled: opts.disabled, attrs: { 'aria-label': opts.aria }, on: { click: onClick } });
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

export const coins = (n: string | number) => `<span class="price">${n} 🪙</span>`;

export function grid(children: (HTMLElement | null)[], two = false): HTMLElement {
  return h('div', { class: `cards${two ? ' two' : ''}` }, ...children);
}

export function empty(text: string): HTMLElement {
  return h('p', { class: 'empty', text });
}

export function hearts(n: number): string {
  return '♥'.repeat(n) + '♡'.repeat(Math.max(0, 10 - n));
}
