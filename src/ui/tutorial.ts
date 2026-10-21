// Interaktywny samouczek: dymek z treścią kroku, podświetlenie celu (przycisk narzędzia albo pole).

import { CONTENT } from '../content/content';
import { onLanguageChange, t } from '../i18n/i18n';
import { START_UNLOCKED } from '../sim/initialState';
import type { GameState } from '../sim/types';
import type { App } from './app';
import { $ } from './dom';

export function mountTutorial(app: App): void {
  const box = $('#tutorial');
  const text = $('#tutorial-text');
  const next = $<HTMLButtonElement>('#tutorial-next');
  const mascot = $('#tutorial-mascot');
  let lastKey = '';

  next.addEventListener('click', () => {
    app.click();
    void app.send({ type: 'tutorial', action: 'next' });
  });
  $('#tutorial-skip').addEventListener('click', () => {
    app.click();
    void app.send({ type: 'tutorial', action: 'skip' });
  });

  const render = (s: GameState, force = false) => {
    const step = s.tutorial.done ? null : CONTENT.tutorial[s.tutorial.step];
    const key = step ? `${step.id}` : '';
    if (key === lastKey && !force) return;
    lastKey = key;
    document.querySelectorAll('.tut-target').forEach((el) => el.classList.remove('tut-target'));
    const scene = app.scene();
    scene?.setTutorialTarget(null);
    if (!step) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    text.textContent = t(`tutorial.${step.id}`);
    const last = s.tutorial.step >= CONTENT.tutorial.length - 1;
    mascot.dataset.mood = last ? 'cheer' : step.target ? 'point' : s.tutorial.step === 0 ? 'wave' : 'happy';
    next.hidden = step.advance !== 'next';
    if (step.target?.startsWith('tool:')) {
      document.querySelector(`.tool[data-tool="${step.target.slice(5)}"]`)?.classList.add('tut-target');
    } else if (step.target === 'field') {
      scene?.setTutorialTarget(START_UNLOCKED[0]!);
    }
  };

  app.store.subscribe((s) => render(s));
  onLanguageChange(() => render(app.store.get(), true));
  // Scena może powstać później niż UI – odśwież po starcie.
  setTimeout(() => render(app.store.get(), true), 500);
}

export function mountCaptions(app: App): (name: string) => void {
  const root = $('#captions');
  let last = '';
  let lastAt = 0;
  return (name: string) => {
    if (!app.store.get().settings.captions) return;
    const now = performance.now();
    if (name === last && now - lastAt < 600) return;
    last = name;
    lastAt = now;
    const span = document.createElement('span');
    span.textContent = t(`caption.${name}`);
    root.append(span);
    while (root.childElementCount > 3) root.firstElementChild?.remove();
    setTimeout(() => span.remove(), 1800);
  };
}
