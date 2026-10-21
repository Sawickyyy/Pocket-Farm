// Komunikaty w stylu książeczki: małe wstążki w kolejce nad paskiem narzędzi (najwyżej dwie naraz)
// i duży baner-wstęga na środku ekranu na ważne chwile (awans, nowa pora roku, osiągnięcie).

export type ToastKind = 'info' | 'warn' | 'good';

export interface ToastAction {
  label: string;
  run: () => void;
}

interface Pending {
  text: string;
  kind: ToastKind;
  action: ToastAction | undefined;
  ms: number;
}

const MAX_VISIBLE = 2;
const MAX_QUEUE = 4;

export class Toasts {
  private lastText = '';
  private lastAt = 0;
  private readonly queue: Pending[] = [];
  private bannerEl: HTMLElement | null = null;
  private bannerTimer = 0;

  constructor(private readonly root: HTMLElement) {}

  show(text: string, kind: ToastKind = 'info', action?: ToastAction, ms = 2200): void {
    // Nie zalewamy ekranu tym samym komunikatem przy szybkim tapaniu.
    const now = performance.now();
    if (text === this.lastText && now - this.lastAt < 1200) return;
    this.lastText = text;
    this.lastAt = now;
    this.queue.push({ text, kind, action, ms });
    // Przy zalewie komunikatów najstarsze zwykłe informacje ustępują nowszym.
    while (this.queue.length > MAX_QUEUE) {
      const i = this.queue.findIndex((p) => !p.action && p.kind === 'info');
      this.queue.splice(i >= 0 ? i : 0, 1);
    }
    this.pump();
  }

  private visibleCount(): number {
    return this.root.querySelectorAll('.toast:not(.leaving)').length;
  }

  private pump(): void {
    while (this.queue.length && this.visibleCount() < MAX_VISIBLE) this.present(this.queue.shift()!);
  }

  private present({ text, kind, action, ms }: Pending): void {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    const span = document.createElement('span');
    span.className = 'toast-text';
    span.textContent = text;
    el.append(span);
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn primary';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        action.run();
        leave();
      });
      el.append(btn);
      ms = Math.max(ms, 8000);
    }
    let gone = false;
    const leave = () => {
      if (gone) return;
      gone = true;
      el.classList.add('leaving');
      setTimeout(() => {
        el.remove();
        this.pump();
      }, 260);
    };
    this.root.append(el);
    setTimeout(leave, ms);
  }

  /**
   * Wstęga na środku ekranu. Kolejne wywołania w trakcie wyświetlania podmieniają treść
   * (np. dwa awanse z rzędu pokazują tylko ostatni poziom) zamiast piętrzyć banery.
   */
  /** `icon` = nazwa malowanej ikony (klasa .ic-<nazwa>). */
  banner(title: string, subtitle = '', icon = 'sparkle', ms = 2600): void {
    clearTimeout(this.bannerTimer);
    let el = this.bannerEl;
    if (!el) {
      el = document.createElement('div');
      el.className = 'banner';
      el.setAttribute('role', 'status');
      el.innerHTML = '<span class="banner-icon" aria-hidden="true"></span><div class="banner-ribbon"><strong></strong><small></small></div><i class="banner-stars" aria-hidden="true"></i>';
      document.body.append(el);
      this.bannerEl = el;
    } else {
      el.classList.remove('show', 'leaving');
      void el.offsetWidth;
    }
    el.querySelector('.banner-icon')!.innerHTML = `<i class="ic ic-${icon}"></i>`;
    el.querySelector('strong')!.textContent = title;
    const small = el.querySelector('small')!;
    small.textContent = subtitle;
    small.hidden = !subtitle;
    el.classList.add('show');
    this.bannerTimer = window.setTimeout(() => {
      el.classList.add('leaving');
      this.bannerTimer = window.setTimeout(() => {
        el.remove();
        if (this.bannerEl === el) this.bannerEl = null;
      }, 320);
    }, ms);
  }
}
