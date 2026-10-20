// Menu: dźwięk, eksport/import zapisu, wyśrodkowanie widoku, informacja o trwałości danych.

import type { Store } from '../core/store';
import type { GameController } from '../game/controller';
import type { GameState } from '../game/state';
import { decodeSave, encodeSave } from '../save/codec';
import { SaveError } from '../save/migrations';
import { $ } from './dom';
import type { Toasts } from './toast';

export interface MenuDeps {
  store: Store<GameState>;
  controller: GameController;
  toasts: Toasts;
  onClick: () => void;
  onRecenter: () => void;
  onImported: () => void;
}

export function mountMenu({ store, controller, toasts, onClick, onRecenter, onImported }: MenuDeps): {
  setStorageInfo: (persisted: boolean) => void;
} {
  const menu = $('#menu');
  const soundBtn = $('#sound-toggle');
  const dialog = $<HTMLDialogElement>('#io-dialog');
  const title = $('#io-title');
  const desc = $('#io-desc');
  const text = $<HTMLTextAreaElement>('#io-text');
  const error = $('#io-error');
  const action = $<HTMLButtonElement>('#io-action');
  let mode: 'export' | 'import' = 'export';

  const renderSound = (on: boolean) => soundBtn.setAttribute('aria-checked', String(on));
  renderSound(store.get().settings.sound);
  store.select((s) => s.settings.sound, renderSound);
  soundBtn.addEventListener('click', () => {
    controller.toggleSound();
    onClick();
  });

  $('#recenter-btn').addEventListener('click', () => {
    onClick();
    onRecenter();
    menu.hidePopover();
  });

  const openDialog = (m: 'export' | 'import') => {
    mode = m;
    error.textContent = '';
    menu.hidePopover();
    if (m === 'export') {
      title.textContent = 'Eksport zapisu';
      desc.textContent = 'Skopiuj ten kod i zachowaj go (np. w Notatkach). Wklejając go w „Importuj zapis” odzyskasz farmę.';
      text.value = encodeSave(store.get());
      text.readOnly = true;
      action.textContent = 'Kopiuj';
    } else {
      title.textContent = 'Import zapisu';
      desc.textContent = 'Wklej kod zapisu. Obecna farma zostanie zastąpiona.';
      text.value = '';
      text.readOnly = false;
      action.textContent = 'Wczytaj';
    }
    dialog.showModal();
    if (m === 'export') {
      text.select();
    } else {
      text.focus();
    }
  };

  $('#export-btn').addEventListener('click', () => {
    onClick();
    openDialog('export');
  });
  $('#import-btn').addEventListener('click', () => {
    onClick();
    openDialog('import');
  });

  action.addEventListener('click', async () => {
    onClick();
    if (mode === 'export') {
      try {
        await navigator.clipboard.writeText(text.value);
        toasts.show('Skopiowano kod zapisu.', 'good');
        dialog.close();
      } catch {
        text.select();
        error.textContent = 'Nie udało się skopiować automatycznie – zaznacz tekst i skopiuj ręcznie.';
      }
      return;
    }
    try {
      const state = decodeSave(text.value, Date.now());
      if (!confirm('Zastąpić obecną farmę wczytanym zapisem?')) return;
      controller.replaceState(state);
      onImported();
      dialog.close();
      toasts.show('Zapis wczytany.', 'good');
    } catch (err) {
      error.textContent = err instanceof SaveError ? err.message : 'Nieprawidłowy kod zapisu.';
    }
  });

  return {
    setStorageInfo(persisted) {
      $('#storage-info').textContent = persisted
        ? 'Dane są przechowywane trwale na tym urządzeniu.'
        : 'Przeglądarka może usunąć dane po dłuższym nieużywaniu – dodaj grę do ekranu początkowego i rób eksport zapisu.';
    },
  };
}
