// Ustawienia (dźwięk, muzyka, napisy, język, daltonizm, skala, ruch), eksport/import zapisu, narzędzie debugowania.

import { t } from '../../i18n/i18n';
import { decodeSave, encodeSave } from '../../save/codec';
import { SaveError } from '../../save/migrations';
import type { GameState, Settings } from '../../sim/types';
import type { App } from '../app';
import { $, h } from '../dom';
import type { SheetManager } from '../sheet';
import { icEl } from '../uiIcons';
import { btn } from './common';

declare const __APP_VERSION__: string;

export function registerSettings(app: App, sheets: SheetManager, persisted: () => boolean | null): void {
  const set = (patch: Partial<Settings>) => void app.send({ type: 'settings', patch });

  const labelWithIcon = (label: string, icon: string) => h('span', {}, icEl(icon), h('span', { text: label }));

  const toggle = (label: string, icon: string, on: boolean, patch: (v: boolean) => Partial<Settings>) =>
    h(
      'button',
      {
        class: 'setting',
        type: 'button',
        attrs: { role: 'switch', 'aria-checked': String(on) },
        on: {
          click: () => {
            app.click();
            set(patch(!on));
          },
        },
      },
      labelWithIcon(label, icon),
      h('span', { class: 'switch', attrs: { 'aria-hidden': 'true' } }),
    );

  const segmented = <T extends string>(label: string, icon: string, value: T, options: [T, string][], onPick: (v: T) => void) =>
    h(
      'div',
      { class: options.length > 2 ? 'setting stack' : 'setting', attrs: { role: 'group', 'aria-label': label } },
      labelWithIcon(label, icon),
      h(
        'div',
        { class: 'seg' },
        ...options.map(([v, l]) =>
          h('button', {
            type: 'button',
            text: l,
            attrs: { 'aria-pressed': String(v === value) },
            on: {
              click: () => {
                app.click();
                onPick(v);
              },
            },
          }),
        ),
      ),
    );

  let versionTaps = 0;

  sheets.register({
    id: 'settings',
    title: () => t('settings.title'),
    sig: (s) => JSON.stringify(s.settings) + persisted() + app.debugEnabled(),
    render(body, s: GameState) {
      const st = s.settings;
      const scale = h('input', {
        type: 'range',
        attrs: { min: 0.85, max: 1.4, step: 0.05, value: st.uiScale, 'aria-label': t('settings.uiScale') },
        on: { change: (e) => set({ uiScale: Number((e.target as HTMLInputElement).value) }) },
      });
      const version = h('p', {
        class: 'hint',
        text: t('settings.version', { v: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev' }),
        on: {
          click: () => {
            if (++versionTaps >= 5) {
              app.enableDebug();
              sheets.refresh();
            }
          },
        },
      });
      const p = persisted();
      body.replaceChildren(
        h(
          'div',
          { class: 'settings' },
          toggle(t('settings.sound'), 'bell', st.sound, (v) => ({ sound: v })),
          toggle(t('settings.music'), 'note', st.music, (v) => ({ music: v })),
          toggle(t('settings.captions'), 'captions', st.captions, (v) => ({ captions: v })),
          toggle(t('settings.fx'), 'sparkle', st.fx, (v) => ({ fx: v })),
          toggle(t('settings.dof'), 'camera', st.dof, (v) => ({ dof: v })),
          segmented(t('settings.language'), 'speech', st.language, [['pl', 'PL'], ['en', 'EN']], (v) => set({ language: v })),
          segmented(
            t('settings.colorblind'),
            'eye',
            st.colorblind,
            (['none', 'protan', 'deutan', 'tritan'] as const).map((m) => [m, t(`settings.cb.${m}`)] as [Settings['colorblind'], string]),
            (v) => set({ colorblind: v }),
          ),
          h('label', { class: 'setting' }, labelWithIcon(t('settings.uiScale'), 'magnifier'), scale),
          segmented(
            t('settings.motion'),
            'snail',
            st.reducedMotion,
            [
              ['auto', t('settings.motion.auto')],
              ['on', t('settings.motion.on')],
              ['off', t('settings.motion.off')],
            ],
            (v) => set({ reducedMotion: v }),
          ),
          rowBtn(t('settings.export'), 'jar', () => openIo(app, 'export')),
          rowBtn(t('settings.import'), 'jar-in', () => openIo(app, 'import')),
          rowBtn(t('settings.recenter'), 'compass', () => {
            app.scene()?.cam.fit(true);
            app.closeSheet();
          }),
          rowBtn(t('settings.tutorial'), 'book', () => {
            void app.send({ type: 'tutorial', action: 'restart' });
            app.closeSheet();
          }),
          app.debugEnabled() ? rowBtn(t('settings.debug'), 'ladybug', () => app.openSheet('debug')) : null,
          p === null ? null : h('p', { class: 'hint', text: p ? t('settings.persisted') : t('settings.notPersisted') }),
          version,
        ),
      );
    },
  });

  function rowBtn(label: string, icon: string, run: () => void) {
    return h(
      'button',
      {
        class: 'row-btn',
        type: 'button',
        on: {
          click: () => {
            app.click();
            run();
          },
        },
      },
      labelWithIcon(label, icon),
      icEl('back', 'chev'),
    );
  }

  // ---------------------------------------------------------- debug
  sheets.register({
    id: 'debug',
    parent: 'settings',
    title: () => t('debug.title'),
    sig: (s) => String(s.clock.timeScale),
    tick(body, s) {
      const pre = body.querySelector('pre');
      if (pre && pre.dataset.live === '1') pre.textContent = JSON.stringify({ ...s, plots: `[${s.plots.length}]` }, null, 1).slice(0, 6000);
    },
    render(body, s) {
      const scales = [1, 10, 60, 300];
      const pre = h('pre', { class: 'state', attrs: { 'data-live': '1' } });
      body.replaceChildren(
        h(
          'div',
          { class: 'setting' },
          h('span', { text: t('debug.time') }),
          h(
            'div',
            { class: 'seg' },
            ...scales.map((v) =>
              h('button', {
                type: 'button',
                text: `${v}×`,
                attrs: { 'aria-pressed': String(s.clock.timeScale === v) },
                on: { click: () => void app.send({ type: 'debug', op: 'timeScale', value: v }) },
              }),
            ),
          ),
        ),
        h(
          'div',
          { class: 'row' },
          btn(t('debug.coins'), () => void app.send({ type: 'debug', op: 'coins', value: 1000 }), { small: true }),
          btn(t('debug.xp'), () => void app.send({ type: 'debug', op: 'xp', value: 50 }), { small: true }),
          btn(t('debug.skip1'), () => void app.send({ type: 'debug', op: 'skipHours', value: 1 }), { small: true, primary: false }),
          btn(t('debug.skip6'), () => void app.send({ type: 'debug', op: 'skipHours', value: 6 }), { small: true, primary: false }),
          btn(t('debug.skip24'), () => void app.send({ type: 'debug', op: 'skipHours', value: 24 }), { small: true, primary: false }),
          btn(t('debug.reveal'), () => void app.send({ type: 'debug', op: 'revealAll', value: 0 }), { small: true, primary: false }),
          btn(t('debug.grow'), () => void app.send({ type: 'debug', op: 'growAll', value: 0 }), { small: true, primary: false }),
        ),
        h('p', { class: 'hint', text: t('debug.worker', { mode: app.sim.usesWorker ? 'Web Worker' : 'main thread' }) }),
        h('h3', { text: t('debug.state') }),
        pre,
        btn(t('debug.copy'), () => void navigator.clipboard?.writeText(JSON.stringify(app.store.get(), null, 1)), { primary: false, small: true }),
      );
    },
  });
}

// ---------------------------------------------------------- eksport / import

export function openIo(app: App, mode: 'export' | 'import'): void {
  const dialog = $<HTMLDialogElement>('#io-dialog');
  const text = $<HTMLTextAreaElement>('#io-text');
  const error = $('#io-error');
  const action = $<HTMLButtonElement>('#io-action');
  error.textContent = '';
  app.closeSheet();
  $('#io-title').textContent = t(mode === 'export' ? 'io.export' : 'io.import');
  $('#io-desc').textContent = t(mode === 'export' ? 'io.exportDesc' : 'io.importDesc');
  action.textContent = t(mode === 'export' ? 'io.copy' : 'io.load');
  text.readOnly = mode === 'export';
  text.value = mode === 'export' ? encodeSave(app.store.get()) : '';
  action.onclick = async () => {
    app.click();
    if (mode === 'export') {
      try {
        await navigator.clipboard.writeText(text.value);
        app.toasts.show(t('io.copied'), 'good');
        dialog.close();
      } catch {
        text.select();
        error.textContent = t('io.copyFail');
      }
      return;
    }
    try {
      const state = decodeSave(text.value, Date.now());
      if (!confirm(t('io.confirm'))) return;
      app.sim.replace(state);
      setTimeout(() => void app.flushSave(), 300);
      dialog.close();
      app.toasts.show(t('io.loaded'), 'good');
    } catch (err) {
      error.textContent = err instanceof SaveError ? err.message : t('io.invalid');
    }
  };
  dialog.showModal();
  if (mode === 'export') text.select();
  else text.focus();
}
