// Grafika postaci osady: nazwy klatek (kontrakt z warstwami sceny), rozmiary, ikony interfejsu i menu
// oraz zmieszczenie całego atlasu w limicie 4096×4096 (rysowanie na atrapie canvasu – w Node nie ma DOM).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONTENT, PROFESSIONS } from '../src/content/content';
import {
  CARAVAN_FRAME,
  CHARACTER_PARTICLES,
  CHILD_SCALE,
  LOOKS,
  RESIDENT_FRAME,
  RESIDENT_KINDS,
  SCENE_ICONS,
  caravanFrame,
  characterEntries,
  childFrame,
  residentFrame,
} from '../src/render/art/residents';
import { UI_ICONS, drawUiIcon } from '../src/render/art/uiIcons';
import { MENU_ICONS, drawMenuIcon } from '../src/render/art/menuIcons';
import { ICONS, PARTICLES, drawSpriteAtlas } from '../src/render/art/atlas';

const SETTLEMENT_UI_ICONS = [
  'people', 'face-happy', 'face-ok', 'face-sad', 'hammer', 'road', 'scroll', 'wagon', 'shield', 'flame', 'wrench', 'medkit', 'lamp',
  'balloon', 'bread', 'briefcase', 'map', 'scales', 'palette', 'crown', 'chart', 'baby', 'rings', 'warning', 'crate', 'townhall',
];

// ------------------------------------------------------------ atrapa canvasu 2D

let pixels = 0;

/** Kontekst 2D, który przyjmuje każde wywołanie; getImageData zwraca pusty bufor właściwego rozmiaru. */
function fakeContext(canvas: object): CanvasRenderingContext2D {
  const gradient = { addColorStop() {} };
  const store: Record<string | symbol, unknown> = { canvas };
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'getImageData') {
        return (_x: number, _y: number, w: number, h: number) => {
          pixels += w * h;
          return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
        };
      }
      if (k === 'measureText') return () => ({ width: 0 });
      if (k === 'getLineDash') return () => [];
      return () => gradient;
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function fakeCanvas(): HTMLCanvasElement {
  const c = { width: 300, height: 150 } as { width: number; height: number; getContext?: () => CanvasRenderingContext2D };
  const ctx = fakeContext(c);
  c.getContext = () => ctx;
  return c as unknown as HTMLCanvasElement;
}

const g = globalThis as { document?: unknown };
const hadDocument = 'document' in g;

beforeAll(() => {
  if (!hadDocument) g.document = { createElement: () => fakeCanvas() };
});

afterAll(() => {
  if (!hadDocument) delete g.document;
});

// ------------------------------------------------------------ testy

describe('klatki postaci osady', () => {
  const entries = characterEntries(CONTENT);
  const byName = new Map(entries.map((e) => [e.name, e]));

  it('każdy zawód (i bez pracy) × LOOKS × 2 fazy kroku, dzieci, wóz, cząsteczki i ikonki sceny', () => {
    expect(RESIDENT_KINDS).toEqual([...PROFESSIONS, 'idle']);
    for (const prof of RESIDENT_KINDS) {
      for (let look = 0; look < LOOKS; look++) {
        for (const f of [0, 1]) {
          const e = byName.get(residentFrame(prof, look, f));
          expect(e, residentFrame(prof, look, f)).toBeDefined();
          expect([e!.w, e!.h]).toEqual([RESIDENT_FRAME.w, RESIDENT_FRAME.h]);
        }
      }
    }
    for (let look = 0; look < LOOKS; look++) for (const f of [0, 1]) expect(byName.has(childFrame(look, f))).toBe(true);
    for (const f of [0, 1]) expect([byName.get(caravanFrame(f))?.w, byName.get(caravanFrame(f))?.h]).toEqual([CARAVAN_FRAME.w, CARAVAN_FRAME.h]);
    for (const p of CHARACTER_PARTICLES) expect([byName.get(p)?.w, byName.get(p)?.h, byName.get(p)?.style?.outline]).toEqual([32, 32, 0]);
    for (const icon of SCENE_ICONS) expect([byName.get(icon)?.w, byName.get(icon)?.h]).toEqual([128, 128]);
    expect(CHARACTER_PARTICLES).toEqual(['p_fire', 'p_ember']);
    expect(SCENE_ICONS).toEqual(['icon_wrench', 'icon_sick']);
    expect(entries).toHaveLength(RESIDENT_KINDS.length * LOOKS * 2 + LOOKS * 2 + 2 + 2 + 2);
  });

  it('nazwy są unikalne i nie kolidują z ikonami i cząsteczkami farmy', () => {
    const names = entries.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    const farm = new Set<string>([...ICONS, ...PARTICLES]);
    expect(names.filter((n) => farm.has(n))).toEqual([]);
  });

  it('nazwy klatek odporne na dowolny wygląd, licznik kroków i nieznany zawód', () => {
    expect(residentFrame(null, 0, 0)).toBe('res_idle_0_0');
    expect(residentFrame('farmer', LOOKS + 1, 3)).toBe(residentFrame('farmer', 1, 1));
    expect(residentFrame('farmer', -1, 0)).toBe(residentFrame('farmer', LOOKS - 1, 0));
    expect(residentFrame('astronaut', 2, 0)).toBe(residentFrame('idle', 2, 0));
    expect(childFrame(7, 2)).toBe(childFrame(7 % LOOKS, 0));
    expect(caravanFrame(5)).toBe('caravan_1');
  });

  it('wymiary: mieszkańcy mniejsi od postaci wioski, punkty stóp w klatce', () => {
    // postać wioski: ~93 px od czubka głowy do stóp, w scenie ×0,85 (VillagerLayer);
    // mieszkaniec: ~79 px (głowa w gy−63, promień 16) – na ekranie ma mieć ~70–80% wysokości mieszkańca wioski
    const ratio = (79 * RESIDENT_FRAME.scale) / (93 * 0.85);
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(0.82);
    // stopy mieszczą się w klatce, nad nimi jest miejsce na całą postać
    expect(RESIDENT_FRAME.h * RESIDENT_FRAME.originY).toBeGreaterThan(88);
    for (const o of [RESIDENT_FRAME.originY, CARAVAN_FRAME.originY, CHILD_SCALE]) {
      expect(o).toBeGreaterThan(0);
      expect(o).toBeLessThan(1);
    }
    // oszczędnie: wszystkie klatki postaci < 1/8 powierzchni atlasu 4096×4096
    const area = entries.reduce((a, e) => a + e.w * e.h, 0);
    expect(area).toBeLessThan((4096 * 4096) / 8);
  });

  it('klatki rysują się bez błędów', () => {
    const ctx = fakeCanvas().getContext('2d')!;
    for (const e of entries) expect(() => e.draw(ctx, 0, 0), e.name).not.toThrow();
  });
});

describe('ikony interfejsu i menu osady', () => {
  it('UI_ICONS zawiera ikony osady i każda się rysuje', () => {
    const ctx = fakeCanvas().getContext('2d')!;
    for (const name of SETTLEMENT_UI_ICONS) {
      expect(UI_ICONS, name).toContain(name);
      expect(() => drawUiIcon(ctx, name), name).not.toThrow();
    }
    expect(new Set(UI_ICONS).size).toBe(UI_ICONS.length);
  });

  it('MENU_ICONS zawiera ikonę osady', () => {
    expect(MENU_ICONS).toContain('settlement');
    expect(() => drawMenuIcon(fakeCanvas().getContext('2d')!, 'settlement')).not.toThrow();
  });
});

describe('atlas sprite’ów', () => {
  it('mieści się w 4096×4096, a nazwy klatek są unikalne', () => {
    pixels = 0;
    const { canvas, frames } = drawSpriteAtlas(CONTENT);
    expect(canvas.width).toBeLessThanOrEqual(4096);
    expect(canvas.height).toBeLessThanOrEqual(4096);
    const names = frames.map((f) => f.name);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
    for (const n of [residentFrame('guard', 3, 1), childFrame(0, 0), caravanFrame(1), 'p_fire', 'p_ember', 'icon_wrench', 'icon_sick']) expect(names).toContain(n);
    // każda klatka została narysowana i stylizowana (odczyt sylwetki)
    expect(pixels).toBeGreaterThan(0);
  });
});
