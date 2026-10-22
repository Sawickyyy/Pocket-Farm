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

/** Modele osady leżące płasko na ziemi (pole, plac) i małe obiekty 1×1 (namiot, studnia). */
const FLAT_MODELS = new Set(['field', 'plaza']);
const PROP_HEIGHT: Record<string, number> = { field: 70, plaza: 90, tent: 130, well: 120 };
/** Dodatkowa wysokość ponad dach (wieże, piętra, flagi). */
const EXTRA_HEIGHT: Record<string, number> = { townhouse: 80, townhall: 110, school: 90, firestation: 60, manor: 40, tradepost: 50, police: 30 };

/**
 * Budynki rysowane jako bryły izometryczne zakotwiczone w tylnym narożniku podstawy: domy zwierząt, maszyny
 * i wszystkie budynki osady z modelem (`art.model`) – poza drogami i mostami (to kafle ziemi).
 */
export const isBox = (def: BuildingDef) =>
  def.kind === 'home' || def.kind === 'machine' || (!!def.art.model && def.kind !== 'path' && def.kind !== 'bridge');

export const isFlatModel = (def: BuildingDef) => FLAT_MODELS.has(def.art.model ?? '');

/** Wysokość bryły nad ziemią (ściany + dach + dodatki) w pikselach klatki. */
export function verticalExtent(def: BuildingDef): number {
  const model = def.art.model ?? '';
  const prop = PROP_HEIGHT[model];
  if (prop !== undefined) return prop;
  const [w, h] = def.size;
  return WALL + roofHeight(w, h) + (EXTRA_HEIGHT[model] ?? 0);
}

/** Klatka rusztowania/zgliszcz dla obrysu w×h (te same zasady zakotwiczenia co bryły). */
export const siteVertical = (w: number, h: number) => WALL + 30 + 6 * Math.max(w, h);

export const DECO_ROOF = 64;

/** Wymiary klatki atlasu budynku. */
export function buildingFrameSize(def: BuildingDef): { w: number; h: number } {
  const [w, h] = def.size;
  if (isBox(def)) return boxFrameSize(w, h, def.art.model ? verticalExtent(def) : WALL + roofHeight(w, h));
  return { w: w * TILE, h: h * TILE + DECO_ROOF };
}

/** Wymiary klatki bryły o obrysie w×h i wysokości `vertical` nad ziemią. */
export const boxFrameSize = (w: number, h: number, vertical: number) => ({
  w: Math.ceil((w + h) * ISO_HW) + 4,
  h: Math.ceil((w + h) * ISO_HH + vertical + ISO_PAD),
});

/** Zakotwiczenie bryły o obrysie w×h (tylny narożnik podstawy) – wspólne dla budynków, rusztowań i zgliszcz. */
export function boxPlacement(w: number, h: number, vertical: number, x: number, y: number) {
  const size = boxFrameSize(w, h, vertical);
  const p = project(x, y);
  const topY = vertical + ISO_PAD;
  return { x: p.x, y: p.y, originX: (h * ISO_HW + 2) / size.w, originY: topY / size.h, sortY: project(x + w, y + h).y, scale: 1 };
}

/**
 * Gdzie postawić sprite budynku: pozycja, origin i klucz sortowania głębi.
 * Bryła: punkt zakotwiczenia = górny (tylny) narożnik podstawy. Dekoracja: dół sprite'a w środku podstawy.
 */
export function buildingPlacement(def: BuildingDef, x: number, y: number) {
  const [w, h] = def.size;
  const size = buildingFrameSize(def);
  const front = project(x + w, y + h).y;
  if (isBox(def)) return boxPlacement(w, h, def.art.model ? verticalExtent(def) : WALL + roofHeight(w, h), x, y);
  const c = project(x + w / 2, y + h / 2);
  return { x: c.x, y: c.y, originX: 0.5, originY: (DECO_ROOF + h * TILE - 8) / size.h, sortY: c.y + 1, scale: 1.25 };
}
