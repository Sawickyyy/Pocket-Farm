// Efekty dźwiękowe syntezowane w Web Audio – zero plików audio, działa offline.
// iOS wymaga utworzenia/wznowienia AudioContext w obsłudze gestu użytkownika (ekran „Dotknij, aby zagrać”).

export type SfxName = 'till' | 'plant' | 'water' | 'harvest' | 'coin' | 'levelUp' | 'error' | 'click' | 'unlock';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;

  /** Wywołać synchronicznie w obsłudze pointerup/click. */
  unlock(): void {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        this.noise = this.makeNoise(this.ctx);
      }
      if (this.ctx.state !== 'running') void this.ctx.resume();
      // Cichy bufor – klasyczny sposób na pełne odblokowanie audio w Safari.
      const src = this.ctx.createBufferSource();
      src.buffer = this.ctx.createBuffer(1, 1, 22050);
      src.connect(this.ctx.destination);
      src.start(0);
    } catch (err) {
      console.warn('[audio] Web Audio niedostępne', err);
    }
  }

  /** Po powrocie do aplikacji iOS potrafi zostawić kontekst w stanie „interrupted”. */
  resumeIfNeeded(): void {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
  }

  suspend(): void {
    if (this.ctx?.state === 'running') void this.ctx.suspend();
  }

  play(name: SfxName): void {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || !this.master || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.005;
    switch (name) {
      case 'till':
        this.noiseBurst(t, 0.12, 600, 0.6);
        this.tone(t, 90, 0.1, 'sine', 0.5, 60);
        break;
      case 'plant':
        this.tone(t, 520, 0.08, 'triangle', 0.35, 780);
        break;
      case 'water':
        this.noiseBurst(t, 0.25, 2400, 0.35, 'bandpass');
        this.tone(t + 0.02, 900, 0.06, 'sine', 0.15, 1300);
        break;
      case 'harvest':
        this.tone(t, 660, 0.09, 'triangle', 0.35);
        this.tone(t + 0.07, 990, 0.12, 'triangle', 0.3);
        break;
      case 'coin':
        this.tone(t, 1320, 0.06, 'square', 0.12);
        this.tone(t + 0.06, 1760, 0.14, 'square', 0.12);
        break;
      case 'unlock':
        [523, 659, 784].forEach((f, i) => this.tone(t + i * 0.06, f, 0.12, 'triangle', 0.3));
        break;
      case 'levelUp':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(t + i * 0.09, f, 0.18, 'triangle', 0.35));
        break;
      case 'error':
        this.tone(t, 180, 0.14, 'sawtooth', 0.15, 140);
        break;
      case 'click':
        this.tone(t, 1200, 0.03, 'sine', 0.15);
        break;
    }
  }

  private tone(t: number, freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(t: number, dur: number, freq: number, vol: number, type: BiquadFilterType = 'lowpass'): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t);
    src.stop(t + dur);
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
}
