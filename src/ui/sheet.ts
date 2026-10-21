// Jeden arkusz (Popover API) na wszystkie panele. Panel przerysowuje się tylko, gdy zmieni się jego
// „sygnatura” danych (a nie przy każdym ticku zegara), a postęp (paski) aktualizuje w miejscu przez `tick`.

import { onLanguageChange, t } from '../i18n/i18n';
import type { GameState } from '../sim/types';
import type { App } from './app';
import { $, h, withViewTransition } from './dom';

export interface SheetDef {
  id: string;
  title(arg: unknown, state: GameState): string;
  tabs?(state: GameState): { id: string; label: string }[];
  render(body: HTMLElement, state: GameState, tab: string, arg: unknown): void;
  /** Dane, od których zależy wygląd; zmiana → przerysowanie. */
  sig?(state: GameState, tab: string, arg: unknown): string;
  /** Aktualizacja w miejscu (np. paski postępu) co tick. */
  tick?(body: HTMLElement, state: GameState, arg: unknown): void;
  /** Panel nadrzędny (przycisk „wstecz”). */
  parent?: string;
}

export class SheetManager {
  private readonly defs = new Map<string, SheetDef>();
  private readonly el = $('#sheet');
  private readonly body = $('#sheet-body');
  private readonly tabsEl = $('#sheet-tabs');
  private readonly titleEl = $('#sheet-title');
  private readonly backBtn = $<HTMLButtonElement>('#sheet-back');
  private current: SheetDef | null = null;
  private arg: unknown = undefined;
  private tab = '';
  private lastSig = '';
  private readonly tabMemory = new Map<string, string>();

  constructor(private readonly app: App) {
    $('#sheet-close').addEventListener('click', () => {
      app.click();
      this.close();
    });
    this.backBtn.addEventListener('click', () => {
      app.click();
      if (this.current?.parent) this.open(this.current.parent);
    });
    this.el.addEventListener('toggle', (e) => {
      if ((e as ToggleEvent).newState === 'closed') this.current = null;
    });
    app.store.subscribe((s) => this.onState(s));
    onLanguageChange(() => this.refresh());
  }

  register(def: SheetDef): void {
    this.defs.set(def.id, def);
  }

  get openId(): string | null {
    return this.current?.id ?? null;
  }

  open(id: string, arg?: unknown, tab?: string): void {
    const def = this.defs.get(id);
    if (!def) return;
    const state = this.app.store.get();
    const tabs = def.tabs?.(state) ?? [];
    this.current = def;
    this.arg = arg;
    this.tab = tab ?? this.tabMemory.get(id) ?? tabs[0]?.id ?? '';
    this.refresh();
    if (!this.el.matches(':popover-open')) this.el.showPopover();
    this.el.scrollTop = 0;
  }

  close(): void {
    if (this.el.matches(':popover-open')) this.el.hidePopover();
    this.current = null;
  }

  refresh(): void {
    const def = this.current;
    if (!def) return;
    const state = this.app.store.get();
    this.titleEl.textContent = def.title(this.arg, state);
    this.backBtn.hidden = !def.parent;
    this.backBtn.setAttribute('aria-label', t('common.close'));
    const tabs = def.tabs?.(state) ?? [];
    this.tabsEl.hidden = tabs.length === 0;
    this.tabsEl.replaceChildren(
      ...tabs.map((tb) =>
        h('button', {
          type: 'button',
          text: tb.label,
          attrs: { role: 'tab', 'aria-selected': String(tb.id === this.tab) },
          on: {
            click: () => {
              if (tb.id === this.tab) return;
              this.app.click();
              this.tab = tb.id;
              this.tabMemory.set(def.id, tb.id);
              withViewTransition(() => this.refresh(), this.app.reducedMotion());
            },
          },
        }),
      ),
    );
    def.render(this.body, state, this.tab, this.arg);
    this.lastSig = def.sig?.(state, this.tab, this.arg) ?? '';
    def.tick?.(this.body, state, this.arg);
  }

  private onState(state: GameState): void {
    const def = this.current;
    if (!def) return;
    const sig = def.sig?.(state, this.tab, this.arg) ?? '';
    if (sig !== this.lastSig) {
      const scroll = this.el.scrollTop;
      this.refresh();
      this.el.scrollTop = scroll;
    } else def.tick?.(this.body, state, this.arg);
  }
}
