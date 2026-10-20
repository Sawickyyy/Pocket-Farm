import { registerSW } from 'virtual:pwa-register';
import type { Toasts } from '../ui/toast';

/** Rejestruje service worker (Workbox, precache). Nowa wersja nie przeładowuje gry w trakcie – pytamy gracza. */
export function registerPwa(toasts: Toasts, beforeReload: () => Promise<void>): void {
  if (!('serviceWorker' in navigator)) return;
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      toasts.show('Dostępna nowa wersja gry.', 'info', {
        label: 'Odśwież',
        run: () => void beforeReload().then(() => update(true)),
      });
    },
    onOfflineReady() {
      toasts.show('Gra gotowa do gry offline.', 'good');
    },
    onRegisterError(err: unknown) {
      console.warn('[pwa] rejestracja SW nie powiodła się', err);
    },
  });
}
