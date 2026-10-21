// Efekty dźwiękowe syntezowane w Web Audio (zero plików – działa offline) z panoramą stereo wg pozycji na ekranie.
// iOS wymaga utworzenia/wznowienia AudioContext w obsłudze gestu (ekran „Dotknij, aby zagrać”).

export type SfxName =
  | 'till'
  | 'plant'
  | 'water'
  | 'harvest'
  | 'coin'
  | 'levelUp'
  | 'error'
  | 'click'
  | 'unlock'
  | 'animal'
  | 'splash'
  | 'craft'
  | 'build'
  // dźwięki materiałów interfejsu: drewno, papier, płótno, złoto, wosk (ceramika = 'click')
  | 'wood'
  | 'paper'
  | 'cloth'
  | 'gold'
  | 'wax';

/** Dźwięki interfejsu (materiały) – bez napisów, żeby nie zalewać ekranu. */
const UI_SOUNDS = new Set<SfxName>(['click', 'wood', 'paper', 'cloth', 'gold', 'wax']);

/** Pozycja źródła: pan -1..1 (lewo–prawo), gain 0..1 (odległość/poza ekranem). */
export interface Spatial {
  pan: number;
  gain: number;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  sfxBus: GainNode | null = null;
  musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  sfxEnabled = true;
  onCaption: ((name: SfxName) => void) | null = null;

  /** Wywołać synchronicznie w obsłudze pointerup/click. */
  unlock(): void {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
        const master = this.ctx.createGain();
        master.gain.value = 0.9;
        master.connect(this.ctx.destination);
        this.sfxBus = this.ctx.createGain();
        this.sfxBus.gain.value = 0.5;
        this.sfxBus.connect(master);
        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = 0.14;
        this.musicBus.connect(master);
        this.noise = this.makeNoise(this.ctx);
      }
      if (this.ctx.state !== 'running') void this.ctx.resume();
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

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  play(name: SfxName, where: Spatial = { pan: 0, gain: 1 }): void {
    const ctx = this.ctx;
    if (!this.sfxEnabled || !ctx || !this.sfxBus || ctx.state !== 'running' || where.gain <= 0.01) return;
    if (!UI_SOUNDS.has(name)) this.onCaption?.(name);
    const out = ctx.createGain();
    out.gain.value = where.gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, where.pan));
    out.connect(panner).connect(this.sfxBus);
    const t = ctx.currentTime + 0.005;
    switch (name) {
      case 'till':
        this.noiseBurst(out, t, 0.12, 600, 0.6);
        this.tone(out, t, 90, 0.1, 'sine', 0.5, 60);
        break;
      case 'plant':
        this.tone(out, t, 520, 0.08, 'triangle', 0.35, 780);
        break;
      case 'water':
        this.noiseBurst(out, t, 0.25, 2400, 0.35, 'bandpass');
        this.tone(out, t + 0.02, 900, 0.06, 'sine', 0.15, 1300);
        break;
      case 'harvest':
        this.tone(out, t, 660, 0.09, 'triangle', 0.35);
        this.tone(out, t + 0.07, 990, 0.12, 'triangle', 0.3);
        break;
      case 'coin':
        this.tone(out, t, 1320, 0.06, 'square', 0.12);
        this.tone(out, t + 0.06, 1760, 0.14, 'square', 0.12);
        break;
      case 'unlock':
        [523, 659, 784].forEach((f, i) => this.tone(out, t + i * 0.06, f, 0.12, 'triangle', 0.3));
        break;
      case 'levelUp':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(out, t + i * 0.09, f, 0.18, 'triangle', 0.35));
        break;
      case 'error':
        this.tone(out, t, 180, 0.14, 'sawtooth', 0.15, 140);
        break;
      case 'click':
        // ceramika: miękkie „pyk”
        this.tone(out, t, 880, 0.05, 'sine', 0.18, 1320);
        break;
      case 'wood':
        this.tone(out, t, 220, 0.06, 'triangle', 0.25, 160);
        this.noiseBurst(out, t, 0.04, 1800, 0.18, 'bandpass');
        break;
      case 'paper':
        this.noiseBurst(out, t, 0.12, 4200, 0.12, 'highpass');
        break;
      case 'cloth':
        this.noiseBurst(out, t, 0.09, 900, 0.16, 'bandpass');
        break;
      case 'gold':
        this.tone(out, t, 1568, 0.18, 'sine', 0.14);
        this.tone(out, t + 0.05, 2093, 0.22, 'sine', 0.1);
        break;
      case 'wax':
        this.tone(out, t, 140, 0.08, 'sine', 0.3, 90);
        this.noiseBurst(out, t, 0.05, 600, 0.2);
        break;
      case 'animal':
        this.tone(out, t, 260, 0.35, 'sawtooth', 0.12, 200);
        this.tone(out, t, 262, 0.35, 'triangle', 0.1, 190);
        break;
      case 'splash':
        this.noiseBurst(out, t, 0.35, 1200, 0.45, 'bandpass');
        break;
      case 'craft':
        this.tone(out, t, 880, 0.08, 'square', 0.1);
        this.tone(out, t + 0.1, 1175, 0.16, 'triangle', 0.2);
        break;
      case 'build':
        [0, 0.12, 0.24].forEach((d) => this.noiseBurst(out, t + d, 0.06, 900, 0.5));
        break;
    }
  }

  private tone(dest: AudioNode, t: number, freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(dest: AudioNode, t: number, dur: number, freq: number, vol: number, type: BiquadFilterType = 'lowpass'): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(dest);
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
