// Generatywna muzyka w Web Audio: skala zależna od sezonu, charakter od pory dnia (dzień: arpeggia, noc: pady i dzwonki).
// Planowanie z wyprzedzeniem (look-ahead), więc dźwięk nie zależy od klatek gry.

import type { Season } from '../content/content';
import type { AudioEngine } from './sfx';

const SCALES: Record<Season, { root: number; steps: number[] }> = {
  spring: { root: 60, steps: [0, 2, 4, 7, 9] }, // C-dur pentatonika
  summer: { root: 62, steps: [0, 2, 4, 5, 7, 9, 11] }, // D-dur
  autumn: { root: 57, steps: [0, 3, 5, 7, 10] }, // a-moll pentatonika
  winter: { root: 64, steps: [0, 2, 3, 5, 7, 9, 10] }, // e dorycka
};
// Stopnie akordów w skali (I–vi–IV–V jako indeksy stopni).
const PROGRESSION = [0, 5, 3, 4];

export function midiToHz(m: number): number {
  return 440 * 2 ** ((m - 69) / 12);
}

/** Nuta stopnia skali (z przenoszeniem oktaw). */
export function degree(season: Season, step: number, octave = 0): number {
  const { root, steps } = SCALES[season];
  const n = steps.length;
  const o = Math.floor(step / n);
  return root + steps[((step % n) + n) % n]! + 12 * (o + octave);
}

export class Music {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private beat = 0;
  private season: Season = 'spring';
  private night = false;
  private enabled = true;
  private seed = 1;

  constructor(private readonly audio: AudioEngine) {}

  setMood(season: Season, night: boolean): void {
    this.season = season;
    this.night = night;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    const bus = this.audio.musicBus;
    const ctx = this.audio.ctx;
    if (bus && ctx) bus.gain.setTargetAtTime(on ? 0.14 : 0, ctx.currentTime, 0.4);
    if (on) this.start();
  }

  start(): void {
    if (this.timer || !this.enabled) return;
    this.timer = setInterval(() => this.schedule(), 60);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private schedule(): void {
    const ctx = this.audio.ctx;
    const bus = this.audio.musicBus;
    if (!ctx || !bus || ctx.state !== 'running' || !this.enabled) return;
    const bpm = this.night ? 64 : 92;
    const eighth = 60 / bpm / 2;
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.25) {
      this.playBeat(ctx, bus, this.nextTime, eighth);
      this.nextTime += eighth;
      this.beat++;
    }
  }

  private playBeat(ctx: AudioContext, bus: GainNode, t: number, eighth: number): void {
    const bar = Math.floor(this.beat / 8);
    const inBar = this.beat % 8;
    const chord = PROGRESSION[bar % PROGRESSION.length]!;
    const s = this.season;
    if (inBar === 0) {
      // Pad: tonika + kwinta akordu, długo wybrzmiewa.
      for (const st of [chord, chord + 2, chord + 4]) this.voice(ctx, bus, t, midiToHz(degree(s, st, -1)), eighth * 8, 'sine', this.night ? 0.16 : 0.1, 0.4);
    }
    if (this.night) {
      if (this.rand() < 0.18) this.voice(ctx, bus, t, midiToHz(degree(s, chord + Math.floor(this.rand() * 5), 1)), 1.6, 'sine', 0.12, 0.005);
    } else {
      const pattern = [0, 2, 4, 2, 5, 4, 2, 4];
      if (inBar % 2 === 0 || this.rand() < 0.4) {
        this.voice(ctx, bus, t, midiToHz(degree(s, chord + pattern[inBar]!, 0)), eighth * 1.6, 'triangle', 0.13, 0.005);
      }
    }
  }

  private voice(ctx: AudioContext, bus: GainNode, t: number, freq: number, dur: number, type: OscillatorType, vol: number, attack: number): void {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}
