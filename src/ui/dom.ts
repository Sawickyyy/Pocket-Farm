export function $<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Brak elementu ${selector}`);
  return el;
}

type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string | undefined;
  text?: string | undefined;
  html?: string | undefined;
  attrs?: Record<string, string | number | boolean | undefined>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
  disabled?: boolean | undefined;
  type?: string | undefined;
}

/** Mały helper do budowania DOM-u bez frameworka. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.html !== undefined) el.innerHTML = props.html;
  if (props.type) el.setAttribute('type', props.type);
  if (props.disabled) (el as HTMLButtonElement).disabled = true;
  for (const [k, v] of Object.entries(props.attrs ?? {})) {
    if (v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const [k, fn] of Object.entries(props.on ?? {})) if (fn) el.addEventListener(k, fn);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'object' ? c : String(c));
  }
  return el;
}

export function img(src: string, cls = 'icon', alt = ''): HTMLImageElement {
  const i = document.createElement('img');
  i.src = src;
  i.className = cls;
  i.alt = alt;
  i.decoding = 'async';
  return i;
}

/** View Transitions z fallbackiem i poszanowaniem ograniczenia ruchu. */
export function withViewTransition(update: () => void, reduced: boolean): void {
  if (!reduced && typeof document.startViewTransition === 'function') document.startViewTransition(update);
  else update();
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
