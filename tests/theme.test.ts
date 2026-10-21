// Strażnik palety: w interfejsie i grafice nie może być fioletu (odcień 240°–320° przy wyraźnym nasyceniu),
// a pary tekst/tło z tokenów muszą mieć kontrast WCAG AA.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(f) ? [p] : [];
  });
}

function hsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  return { h, s, l };
}

export const isPurple = (r: number, g: number, b: number): boolean => {
  const c = hsl(r, g, b);
  return c.s > 0.15 && c.l > 0.06 && c.l < 0.97 && c.h >= 240 && c.h <= 320;
};

function colorsIn(src: string): { text: string; rgb: [number, number, number] }[] {
  const out: { text: string; rgb: [number, number, number] }[] = [];
  for (const m of src.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
    out.push({ text: m[0], rgb: [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)] });
  }
  for (const m of src.matchAll(/0x([0-9a-f]{6})\b/gi)) {
    const hex = m[1]!;
    out.push({ text: m[0], rgb: [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)] });
  }
  for (const m of src.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/gi)) out.push({ text: m[0], rgb: [+m[1]!, +m[2]!, +m[3]!] });
  // trójki kanałów w tablicach (np. kolory oświetlenia [0x52, 0x5c, 0xa8])
  for (const m of src.matchAll(/\[\s*0x([0-9a-f]{2}),\s*0x([0-9a-f]{2}),\s*0x([0-9a-f]{2})\s*\]/gi)) {
    out.push({ text: m[0], rgb: [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] });
  }
  return out;
}

describe('paleta bez fioletu', () => {
  it('pomocnik rozpoznaje fiolet, a róż, błękit i brąz przepuszcza', () => {
    expect(isPurple(0x8f, 0x7a, 0xd6)).toBe(true);
    expect(isPurple(0xb6, 0x9c, 0xff)).toBe(true);
    expect(isPurple(0x3d, 0x3a, 0x8a)).toBe(true);
    expect(isPurple(0xe2, 0x48, 0x6a)).toBe(false);
    expect(isPurple(0x5c, 0xb8, 0xf0)).toBe(false);
    expect(isPurple(0x4a, 0x2e, 0x1a)).toBe(false);
  });

  it('żaden kolor w CSS, HTML ani kodzie rysującym nie jest fioletowy', () => {
    const list = [...files('src', /\.(css|ts|json)$/), 'index.html', 'vite.config.ts'];
    const bad: string[] = [];
    for (const f of list) {
      const src = readFileSync(f, 'utf8');
      for (const c of colorsIn(src)) if (isPurple(...c.rgb)) bad.push(`${f}: ${c.text}`);
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------- kontrast
function tokens(css: string): { light: Record<string, string>; dark: Record<string, string> } {
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
  const dark = css.slice(darkStart, css.indexOf('}\n}', darkStart));
  const read = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6}|var\(--[\w-]+\))/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]));
  // rozwiązanie odwołań var(--x) do wartości szesnastkowych
  const resolve = (v: Record<string, string>) => {
    const out: Record<string, string> = {};
    for (const k of Object.keys(v)) {
      let x = v[k]!;
      for (let i = 0; i < 5 && x.startsWith('var('); i++) x = v[x.slice(6, -1)] ?? x;
      out[k] = x;
    }
    return out;
  };
  const lightRaw = read(root);
  return { light: resolve(lightRaw), dark: resolve({ ...lightRaw, ...read(dark) }) };
}

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

describe('kontrast tokenów (WCAG)', () => {
  const t = tokens(readFileSync('src/ui/theme/tokens.css', 'utf8'));
  for (const [mode, v] of Object.entries(t)) {
    it(`${mode}: tekst na papierze i ceramice ≥ 4,5:1`, () => {
      expect(contrast(v.text!, v.paper!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v.muted!, v.paper!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v.text!, v['paper-hi']!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v.ink!, v.ceram!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v.price!, v['paper-hi']!)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${mode}: pogrubione białe etykiety na kolorze ≥ 3:1`, () => {
      for (const bg of ['leaf-deep', 'terra-deep', 'sky-lo', 'wood-deep', 'wood-lo']) expect(contrast('#ffffff', v[bg]!), bg).toBeGreaterThanOrEqual(3);
    });
  }
});
