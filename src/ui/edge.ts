// Geometria znaczników przy krawędzi ekranu (czysta funkcja – testowalna bez DOM-u).

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Gdzie postawić znacznik celu leżącego poza prostokątem widoku: punkt przecięcia odcinka środek→cel
 * z prostokątem pomniejszonym o margines, oraz kąt strzałki (radiany, 0 = w prawo).
 * Zwraca null, gdy cel jest widoczny.
 */
export function edgePlacement(px: number, py: number, view: Rect, margin: number): { x: number; y: number; angle: number } | null {
  if (px >= view.x0 && px <= view.x1 && py >= view.y0 && py <= view.y1) return null;
  const cx = (view.x0 + view.x1) / 2;
  const cy = (view.y0 + view.y1) / 2;
  const dx = px - cx;
  const dy = py - cy;
  const hw = Math.max(1, (view.x1 - view.x0) / 2 - margin);
  const hh = Math.max(1, (view.y1 - view.y0) / 2 - margin);
  const k = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: cx + dx * k, y: cy + dy * k, angle: Math.atan2(dy, dx) };
}
