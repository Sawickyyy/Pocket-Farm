// Rejestr ikon interfejsu dla CSS: przy starcie generuje malowane ikony i wstawia arkusz z klasami `.ic-<nazwa>`
// oraz zmiennymi `--icon-<nazwa>`, dzięki czemu HTML (także w napisach z tłumaczeń) używa `<i class="ic ic-coin"></i>`
// bez powtarzania długich adresów data: w każdej karcie.

import { mascotUrl, menuIconUrl, uiIconUrl } from '../render/art/atlas';
import { MASCOT_MOODS, type MascotMood } from '../render/art/mascot';
import { MENU_ICONS } from '../render/art/menuIcons';
import { UI_ICONS } from '../render/art/uiIcons';

let installed = false;

export function installIconStyles(): void {
  if (installed) return;
  installed = true;
  const rules: string[] = [];
  const vars: string[] = [];
  for (const name of UI_ICONS) {
    const url = uiIconUrl(name);
    vars.push(`--icon-${name}:url("${url}")`);
    rules.push(`.ic-${name}{background-image:var(--icon-${name})}`);
  }
  for (const name of MENU_ICONS) {
    vars.push(`--icon-menu-${name}:url("${menuIconUrl(name)}")`);
    rules.push(`.ic-menu-${name}{background-image:var(--icon-menu-${name})}`);
  }
  for (const mood of MASCOT_MOODS) vars.push(`--mascot-${mood}:url("${mascotUrl(mood)}")`);
  const style = document.createElement('style');
  style.id = 'ui-icons';
  style.textContent = `:root{${vars.join(';')}}\n${rules.join('\n')}`;
  document.head.append(style);
}

/** Znacznik ikony do wstawienia w HTML. */
export const ic = (name: string, extra = ''): string => `<i class="ic ic-${name}${extra ? ` ${extra}` : ''}" aria-hidden="true"></i>`;

/** Element ikony do budowania DOM. */
export function icEl(name: string, extra = ''): HTMLElement {
  const el = document.createElement('i');
  el.className = `ic ic-${name}${extra ? ` ${extra}` : ''}`;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/** Element maskotki w danej minie. */
export function mascotEl(mood: MascotMood, cls = ''): HTMLElement {
  const el = document.createElement('i');
  el.className = `mascot ${cls}`.trim();
  el.dataset.mood = mood;
  el.setAttribute('aria-hidden', 'true');
  return el;
}
