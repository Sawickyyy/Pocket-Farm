import './ui/styles.css';
import Phaser from 'phaser';
import './render/phaserShim';
import { Music } from './audio/music';
import { AudioEngine } from './audio/sfx';
import { createStore } from './core/store';
import { detectLanguage, onLanguageChange, setLanguage, t, translateDom } from './i18n/i18n';
import { bindPointerInput } from './input/pointerInput';
import { registerPwa } from './pwa/register';
import { FarmScene } from './render/FarmScene';
import { applyHtmlColorblind } from './render/colorblind';
import { SaveManager, createBrowserBackend, loadSave, requestPersistence } from './save/saveManager';
import { calendarAt } from './sim/calendar';
import { createSimHost } from './sim/host';
import { createInitialState } from './sim/initialState';
import type { CatchUpReport } from './sim/simulation';
import type { GameState, Settings } from './sim/types';
import type { App } from './ui/app';
import { BuildMode } from './ui/buildMode';
import { $ } from './ui/dom';
import { handleEvents } from './ui/feedback';
import { Fishing } from './ui/fishing';
import { mountHud } from './ui/hud';
import { registerBuild } from './ui/panels/build';
import { registerEconomy } from './ui/panels/economy';
import { registerProgress } from './ui/panels/progress';
import { registerSettings } from './ui/panels/settings';
import { registerVillage } from './ui/panels/village';
import { SheetManager } from './ui/sheet';
import { Toasts } from './ui/toast';
import { mountCaptions, mountTutorial } from './ui/tutorial';

const MAX_DPR = 3;
const dpr = () => Math.min(MAX_DPR, window.devicePixelRatio || 1);
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const DEBUG_KEY = 'pocket-farm:debug';

// ------------------------------------------------------------------ blokady gestów Safari
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false },
);

function reportText(r: CatchUpReport | null, fresh: boolean): string {
  if (fresh) return t('start.new');
  if (!r) return t('start.back');
  const lines = [t('start.back'), t('start.away', { days: r.days })];
  if (r.harvestReady) lines.push(t('start.ready', { n: r.harvestReady }));
  if (r.animalProducts) lines.push(t('start.products', { n: r.animalProducts }));
  if (r.crafted) lines.push(t('start.crafted', { n: r.crafted }));
  if (r.withered) lines.push(t('start.withered', { n: r.withered }));
  if (r.capped) lines.push(t('start.capped'));
  return lines.join('\n');
}

async function boot(): Promise<void> {
  const startBtn = $<HTMLButtonElement>('#start-btn');
  const startSummary = $('#start-summary');
  const toasts = new Toasts($('#toasts'));
  const audio = new AudioEngine();
  const music = new Music(audio);

  // ---------------------------------------------------------------- stan + symulacja w Workerze
  const backend = createBrowserBackend();
  const now = Date.now();
  const saved = await loadSave(backend, now);
  const initial: GameState = saved?.state ?? createInitialState(now);
  if (!saved) initial.settings.language = detectLanguage();
  setLanguage(initial.settings.language);
  translateDom();
  startSummary.textContent = t('start.loading');

  const store = createStore(initial);
  const sim = createSimHost(store, initial);
  const saves = new SaveManager(store, backend);
  saves.start();
  saves.bindLifecycle();

  let scene: FarmScene | null = null;
  let persisted: boolean | null = null;
  const reducedMotion = () => {
    const m = store.get().settings.reducedMotion;
    return m === 'on' || (m === 'auto' && motionQuery.matches);
  };

  // ---------------------------------------------------------------- kontekst UI
  const confirmPop = $('#confirm');
  const confirmYes = $<HTMLButtonElement>('#confirm-yes');
  let onConfirm: (() => void) | null = null;
  confirmYes.addEventListener('click', () => {
    app.click();
    onConfirm?.();
    confirmPop.hidePopover();
  });
  $('#confirm-no').addEventListener('click', () => confirmPop.hidePopover());

  let build!: BuildMode;
  let fishing!: Fishing;
  let sheets!: SheetManager;

  const app: App = {
    store,
    sim,
    toasts,
    audio,
    async send(cmd, silent = false) {
      const r = await sim.dispatch(cmd);
      if (r.ok) {
        saves.schedule();
        return true;
      }
      if (!silent) {
        audio.play('error');
        toasts.show(t(`fail.${r.reason}`), 'warn');
      }
      return false;
    },
    click: () => audio.play('click'),
    scene: () => scene,
    reducedMotion,
    openSheet: (id, arg) => sheets.open(id, arg),
    closeSheet: () => sheets.close(),
    confirm(title, html, yes, fn, disabled = false) {
      $('#confirm-title').textContent = title;
      $('#confirm-text').innerHTML = html;
      confirmYes.textContent = yes;
      confirmYes.disabled = disabled;
      onConfirm = fn;
      confirmPop.showPopover();
    },
    startBuild: (type) => build.start(type),
    startMove: (uid) => build.startMove(uid),
    startFishing() {
      const p = store.get().world.pendingFish;
      if (p) fishing.start(p.difficulty);
    },
    debugEnabled: () => new URLSearchParams(location.search).has('debug') || safeGet(DEBUG_KEY) === '1',
    enableDebug: () => safeSet(DEBUG_KEY, '1'),
    flushSave: () => saves.flush(true),
  };

  sheets = new SheetManager(app);
  registerEconomy(app, sheets);
  registerBuild(app, sheets);
  registerVillage(app, sheets);
  registerProgress(app, sheets);
  registerSettings(app, sheets, () => persisted);
  const hud = mountHud(app);
  build = new BuildMode(app);
  fishing = new Fishing(app);
  mountTutorial(app);
  const caption = mountCaptions(app);
  audio.onCaption = (name) => caption(name);

  // ---------------------------------------------------------------- ustawienia → efekty
  const root = document.documentElement;
  const applySettings = (st: Settings) => {
    setLanguage(st.language);
    root.style.setProperty('--ui-scale', String(st.uiScale));
    root.dataset.motion = st.reducedMotion;
    root.dataset.reduced = String(reducedMotion());
    applyHtmlColorblind(st.colorblind);
    scene?.setPostFx(st.colorblind, st.fx);
    audio.sfxEnabled = st.sound;
    music.setEnabled(st.music);
  };
  applySettings(initial.settings);
  store.select((s) => s.settings, applySettings);
  motionQuery.addEventListener('change', () => (root.dataset.reduced = String(reducedMotion())));
  onLanguageChange(() => translateDom());

  // ---------------------------------------------------------------- zdarzenia symulacji
  sim.onEvents((events) => {
    scene?.playEvents(events);
    handleEvents(app, events);
  });
  sim.onReport((r) => {
    if (r.days > 0 || r.harvestReady) toasts.show(reportText(r, false).split('\n').slice(1).join(' '), 'good', undefined, 5000);
  });

  // ---------------------------------------------------------------- Phaser
  const gameEl = $('#game');
  const topbar = $('.topbar');
  const toolbar = $('.toolbar-inner');
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: gameEl,
    backgroundColor: '#3f7a32',
    banner: false,
    scale: { mode: Phaser.Scale.NONE, width: Math.round(gameEl.clientWidth * dpr()), height: Math.round(gameEl.clientHeight * dpr()), autoRound: true },
    // Wejście obsługujemy sami (Pointer Events), dźwięk – własny Web Audio.
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    audio: { noAudio: true },
    render: { antialias: true, powerPreference: 'high-performance', roundPixels: false, maxLights: 12 },
    fps: { smoothStep: true },
  });

  const syncViewport = () => {
    if (!scene) return;
    const d = dpr();
    const w = Math.max(1, Math.round(gameEl.clientWidth * d));
    const h = Math.max(1, Math.round(gameEl.clientHeight * d));
    if (game.scale.width !== w || game.scale.height !== h) game.scale.resize(w, h);
    const top = $('#clock').getBoundingClientRect().bottom || topbar.getBoundingClientRect().bottom;
    const bottom = window.innerHeight - toolbar.getBoundingClientRect().top;
    scene.setViewport({ width: w, height: h, insetTop: top * d, insetBottom: bottom * d });
  };

  game.scene.add('farm', FarmScene, true, {
    store,
    reducedMotion,
    hudTarget: () => hud.coinTarget(),
    dpr,
    onReady(s: FarmScene) {
      scene = s;
      syncViewport();
      s.cam.fit(false);
      s.applyCamera();
      s.setPostFx(store.get().settings.colorblind, store.get().settings.fx);
      bindPointerInput(gameEl, s, app, build, dpr, () => audio.resumeIfNeeded());
      // Hak dla narzędzi deweloperskich i testów automatycznych (tylko w trybie debugowania).
      if (app.debugEnabled()) Object.assign(window, { __pocketFarm: { app, scene: s, store } });
    },
  });
  new ResizeObserver(syncViewport).observe(gameEl);
  new ResizeObserver(syncViewport).observe(toolbar);

  // Nastrój muzyki wg pory dnia i sezonu.
  setInterval(() => {
    const s = store.get();
    const cal = calendarAt(s.clock.simMs, s.seed);
    music.setMood(cal.season, cal.isNight);
  }, 1000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      sim.pause();
      audio.suspend();
    } else {
      sim.resume();
      audio.resumeIfNeeded();
    }
  });

  registerPwa(toasts, () => saves.flush(true));

  // ---------------------------------------------------------------- ekran startowy
  const report = await sim.ready;
  startSummary.textContent = reportText(report, !saved);
  startBtn.disabled = false;
  startBtn.addEventListener(
    'click',
    () => {
      // Synchronicznie w obsłudze gestu: odblokowanie Web Audio i prośba o trwały magazyn.
      audio.unlock();
      music.start();
      void requestPersistence().then((p) => {
        persisted = p;
        sheets.refresh();
      });
      const screen = $('#start-screen');
      screen.classList.add('hidden');
      setTimeout(() => screen.remove(), 350);
      audio.play('plant');
    },
    { once: true },
  );
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // tryb prywatny
  }
}

void boot().catch((err) => {
  console.error(err);
  const s = document.getElementById('start-summary');
  if (s) s.textContent = t('start.error');
});
