export type ToastKind = 'info' | 'warn' | 'good';

export interface ToastAction {
  label: string;
  run: () => void;
}

export class Toasts {
  private lastText = '';
  private lastAt = 0;

  constructor(private readonly root: HTMLElement) {}

  show(text: string, kind: ToastKind = 'info', action?: ToastAction, ms = 2200): void {
    // Nie zalewamy ekranu tym samym komunikatem przy szybkim tapaniu.
    const now = performance.now();
    if (text === this.lastText && now - this.lastAt < 1200) return;
    this.lastText = text;
    this.lastAt = now;

    while (this.root.childElementCount >= 3) this.root.firstElementChild?.remove();
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn primary';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        action.run();
        el.remove();
      });
      el.append(btn);
      ms = Math.max(ms, 8000);
    }
    this.root.append(el);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 260);
    }, ms);
  }
}
