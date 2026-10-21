import { registerSW } from 'virtual:pwa-register';
import { t } from '../i18n/i18n';
import type { Toasts } from '../ui/toast';

/** Rejestruje service worker (Workbox, precache). Nowa wersja nie przeładowuje gry w trakcie – pytamy gracza. */
export function registerPwa(toasts: Toasts, beforeReload: () => Promise<void>): void {
  if (!('serviceWorker' in navigator)) return;
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      toasts.show(t('toast.update'), 'info', {
        label: t('toast.refresh'),
        run: () => void beforeReload().then(() => update(true)),
      });
    },
    onOfflineReady() {
      toasts.show(t('toast.offline'), 'good');
    },
    onRegisterError(err: unknown) {
      console.warn('[pwa] rejestracja SW nie powiodła się', err);
    },
  });
}
