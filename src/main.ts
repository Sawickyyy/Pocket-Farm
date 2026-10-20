import './ui/styles.css';
import Phaser from 'phaser';
import './render/phaserShim';
import { Sfx, type SfxName } from './audio/sfx';
import { createStore } from './core/store';
import { CROPS } from './game/content';
import { GameController } from './game/controller';
import { isReady, type GameEvent } from './game/logic';
import { createInitialState, type GameState } from './game/state';
import { bindPointerInput } from './input/pointerInput';
import { registerPwa } from './pwa/register';
import { FarmScene } from './render/FarmScene';
import { SaveManager, createBrowserBackend, loadSave, requestPersistence } from './save/saveManager';
import { $ } from './ui/dom';
import { FAIL_MESSAGES, formatNumber, plural } from './ui/format';
import { mountHud } from './ui/hud';
import { mountMenu } from './ui/menu';
import { mountShop } from './ui/shop';
import { Toasts } from './ui/toast';

const MAX_DPR = 3;
const dpr = () => Math.min(MAX_DPR, window.devicePixelRatio || 1);
const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = () => reducedMotionQuery.matches;

// ------------------------------------------------------------------ blokady gestów Safari
// Pinch-zoom strony (gesturestart jest specyficzny dla WebKitu) i zoom podwójnym tapnięciem.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
// Multi-touch poza canvasem (np. na paskach) też nie może przybliżać strony.
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false },
);

async function boot(): Promise<void> {
  const startBtn = $<HTMLButtonElement>('#start-btn');
  const startSummary = $('#start-summary');
  const toasts = new Toasts($('#toasts'));
  const sfx = new Sfx();

  // ---------------------------------------------------------------- stan
  const backend = createBrowserBackend();
  const now = Date.now();
  const saved = await loadSave(backend, now);
  const initial: GameState = saved?.state ?? createInitialState(now);
  const store = createStore(initial);
  const controller = new GameController(store);
  const saves = new SaveManager(store, backend);
  saves.start();
  saves.bindLifecycle();
  if (!saved) saves.schedule();

  sfx.enabled = initial.settings.sound;
  store.select((s) => s.settings.sound, (on) => (sfx.enabled = on));
  const click = () => sfx.play('click');

  // ---------------------------------------------------------------- UI HTML
  mountHud(store, controller, click);
  mountShop(store, controller, click);
  let scene: FarmScene | null = null;
  const menu = mountMenu({
    store,
    controller,
    toasts,
    onClick: click,
    onRecenter: () => {
      scene?.cam.fit();
      scene?.applyCamera();
    },
    onImported: () => void saves.flush(true),
  });

  // Zakup pola
  const unlockPop = $('#unlock-pop');
  const unlockText = $('#unlock-text');
  const unlockConfirm = $<HTMLButtonElement>('#unlock-confirm');
  let pendingUnlock: number | null = null;
  unlockConfirm.addEventListener('click', () => {
    if (pendingUnlock !== null) controller.confirmUnlock(pendingUnlock);
    pendingUnlock = null;
    unlockPop.hidePopover();
  });

  // ---------------------------------------------------------------- reakcje na zdarzenia gry
  const SOUND_FOR: Partial<Record<GameEvent['type'], SfxName>> = {
    tilled: 'till',
    planted: 'plant',
    watered: 'water',
    harvested: 'harvest',
    unlocked: 'unlock',
    sold: 'coin',
    boughtSeeds: 'coin',
    boughtUpgrade: 'unlock',
    levelUp: 'levelUp',
  };
  controller.addHooks({
    onEvents(events) {
      scene?.playEvents(events);
      const played = new Set<SfxName>();
      for (const e of events) {
        const snd = SOUND_FOR[e.type];
        if (snd && !played.has(snd)) {
          sfx.play(snd);
          played.add(snd);
        }
        if (e.type === 'levelUp') toasts.show(`Poziom ${e.level}! +${e.reward} monet`, 'good');
        if (e.type === 'sold') toasts.show(`Sprzedano ${e.qty} × ${CROPS[e.crop].name}: +${formatNumber(e.coins)} 🪙`, 'good');
        if (e.type === 'boughtUpgrade') toasts.show('Ulepszenie kupione!', 'good');
      }
    },
    onFail(reason) {
      sfx.play('error');
      toasts.show(FAIL_MESSAGES[reason], 'warn');
    },
    onUnlockRequest(plot, cost) {
      pendingUnlock = plot;
      const coins = store.get().coins;
      unlockText.innerHTML = `Odblokować to pole za <b>${formatNumber(cost)} 🪙</b>?${
        coins < cost ? `<br><small>Brakuje ${formatNumber(cost - coins)} monet.</small>` : ''
      }`;
      unlockConfirm.disabled = coins < cost;
      unlockPop.showPopover();
    },
  });

  // ---------------------------------------------------------------- Phaser
  const gameEl = $('#game');
  const topbar = $('.topbar');
  const toolbar = $('.toolbar-inner');

  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: gameEl,
    backgroundColor: '#4f8a3c',
    banner: false,
    scale: {
      mode: Phaser.Scale.NONE,
      width: Math.round(gameEl.clientWidth * dpr()),
      height: Math.round(gameEl.clientHeight * dpr()),
      autoRound: true,
    },
    // Wejście obsługujemy sami (Pointer Events), dźwięk przez własny Web Audio.
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    audio: { noAudio: true },
    render: { antialias: true, powerPreference: 'high-performance', roundPixels: false },
    // Pętla na requestAnimationFrame – na ekranach ProMotion działa z częstotliwością, na jaką pozwoli Safari.
    fps: { smoothStep: true },
  });

  const syncViewport = () => {
    if (!scene) return;
    const d = dpr();
    const w = Math.max(1, Math.round(gameEl.clientWidth * d));
    const h = Math.max(1, Math.round(gameEl.clientHeight * d));
    if (game.scale.width !== w || game.scale.height !== h) game.scale.resize(w, h);
    const top = topbar.getBoundingClientRect().bottom;
    const bottom = window.innerHeight - toolbar.getBoundingClientRect().top;
    scene.cameras.main.setSize(w, h);
    scene.setViewport({ width: w, height: h, insetTop: top * d, insetBottom: bottom * d });
  };

  game.scene.add('farm', FarmScene, true, {
    store,
    reducedMotion,
    onReady(s: FarmScene) {
      scene = s;
      syncViewport();
      s.cam.fit();
      s.applyCamera();
      bindPointerInput(gameEl, s, controller, dpr, () => sfx.resumeIfNeeded());
    },
  });

  new ResizeObserver(syncViewport).observe(gameEl);
  new ResizeObserver(syncViewport).observe(toolbar);
  window.addEventListener('orientationchange', () => setTimeout(syncViewport, 300));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      sfx.suspend();
    } else {
      sfx.resumeIfNeeded();
      scene?.syncAll();
    }
  });

  registerPwa(toasts, () => saves.flush(true));

  // ---------------------------------------------------------------- ekran startowy
  if (saved) {
    const ready = saved.state.plots.filter((p) => isReady(p.crop, Date.now())).length;
    startSummary.textContent = ready
      ? `Witaj ponownie! Czeka ${ready} ${plural(ready, 'dojrzała roślina', 'dojrzałe rośliny', 'dojrzałych roślin')}.`
      : 'Witaj ponownie na farmie!';
  } else {
    startSummary.textContent = 'Zaoraj, posiej, podlej i zbieraj plony.';
  }
  startBtn.disabled = false;

  const start = () => {
    // Synchronicznie w obsłudze gestu: odblokowanie Web Audio i prośba o trwały magazyn.
    sfx.unlock();
    void requestPersistence().then((p) => menu.setStorageInfo(p));
    const screen = $('#start-screen');
    screen.classList.add('hidden');
    setTimeout(() => screen.remove(), 350);
    sfx.play('plant');
  };
  startBtn.addEventListener('click', start, { once: true });
}

void boot().catch((err) => {
  console.error(err);
  const s = document.getElementById('start-summary');
  if (s) s.textContent = 'Nie udało się uruchomić gry. Odśwież stronę.';
});
