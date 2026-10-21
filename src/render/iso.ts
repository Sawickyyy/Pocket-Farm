// Rzut izometryczny 2:1 (2.5D). Logika gry zostaje na siatce kafli; tu przeliczamy kafle ↔ współrzędne ekranu-świata.
// Ziemia (TilemapGPULayer) dostaje ten sam rzut przez kontenery: obrót o 45° i spłaszczenie Y ×0,5.

import type { BuildingDef } from '../content/content';

/** Bok kwadratowego kafla w teksturze i w „płaskim” świecie. */
export const TILE = 128;
/** Połowa szerokości i wysokości rombu kafla po rzucie. */
export const ISO_HW = TILE / Math.SQRT2;
export const ISO_HH = ISO_HW / 2;

/** Kafel (ciągły) → punkt w świecie ekranowym. */
export function project(tx: number, ty: number): { x: number; y: number } {
  return { x: (tx - ty) * ISO_HW, y: (tx + ty) * ISO_HH };
}

/** Punkt w świecie ekranowym → kafel (ciągły). */
export function unproject(px: number, py: number): { x: number; y: number } {
  const a = px / ISO_HW;
  const b = py / ISO_HH;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** Prostokąt otaczający rzut prostokąta kafli. */
export function projectedBounds(x: number, y: number, w: number, h: number) {
  const pts = [project(x, y), project(x + w, y), project(x + w, y + h), project(x, y + h)];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

// ------------------------------------------------------------------ bryły budynków

/** Wysokość ścian i dachu bryły izometrycznej (px). */
export const WALL = 100;
export const roofHeight = (w: number, h: number) => 60 + 18 * Math.max(w, h);
export const ISO_PAD = 12;

/** Budynki rysowane jako bryły (domy i maszyny); reszta to pionowe sprite'y stojące na kaflu. */
export const isBox = (def: BuildingDef) => def.kind === 'home' || def.kind === 'machine';

export const DECO_ROOF = 64;

/** Wymiary klatki atlasu budynku. */
export function buildingFrameSize(def: BuildingDef): { w: number; h: number } {
  const [w, h] = def.size;
  if (isBox(def)) return { w: Math.ceil((w + h) * ISO_HW) + 4, h: Math.ceil((w + h) * ISO_HH + WALL + roofHeight(w, h) + ISO_PAD) };
  return { w: w * TILE, h: h * TILE + DECO_ROOF };
}

/**
 * Gdzie postawić sprite budynku: pozycja, origin i klucz sortowania głębi.
 * Bryła: punkt zakotwiczenia = górny (tylny) narożnik podstawy. Dekoracja: dół sprite'a w środku podstawy.
 */
export function buildingPlacement(def: BuildingDef, x: number, y: number) {
  const [w, h] = def.size;
  const size = buildingFrameSize(def);
  const front = project(x + w, y + h).y;
  if (isBox(def)) {
    const p = project(x, y);
    const topY = WALL + roofHeight(w, h) + ISO_PAD;
    return { x: p.x, y: p.y, originX: (h * ISO_HW + 2) / size.w, originY: topY / size.h, sortY: front, scale: 1 };
  }
  const c = project(x + w / 2, y + h / 2);
  return { x: c.x, y: c.y, originX: 0.5, originY: (DECO_ROOF + h * TILE - 8) / size.h, sortY: c.y + 1, scale: 1.25 };
}
