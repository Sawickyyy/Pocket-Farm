// Tryb dla daltonistów: daltonizacja (przesunięcie utraconej informacji o kolorze na widoczne kanały).
// M = I + Shift · (I − Sim). Ta sama macierz trafia do filtra ColorMatrix kamery Phasera i do SVG dla interfejsu HTML.

export type ColorblindMode = 'none' | 'protan' | 'deutan' | 'tritan';
type M3 = [number, number, number, number, number, number, number, number, number];

// Symulacja widzenia (Machado i in., 2009, ciężkość 1.0).
const SIM: Record<Exclude<ColorblindMode, 'none'>, M3> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

// Redystrybucja błędu na kanały widoczne dla danej osoby.
const SHIFT: M3 = [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1];

const mul = (a: M3, b: M3): M3 => {
  const out = new Array(9).fill(0) as M3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] = out[r * 3 + c]! + a[r * 3 + k]! * b[k * 3 + c]!;
  return out;
};

export function daltonizeMatrix(mode: ColorblindMode): M3 {
  const I: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (mode === 'none') return I;
  const sim = SIM[mode];
  const err = I.map((v, i) => v - sim[i]!) as M3;
  const shifted = mul(mode === 'tritan' ? ([1, 0, 0.7, 0, 1, 0.7, 0, 0, 0] as M3) : SHIFT, err);
  return I.map((v, i) => v + shifted[i]!) as M3;
}

/**
 * Bajkowa korekcja kolorów: lekko większe nasycenie i cieplejszy odcień.
 * Nasycenie wokół luminancji Rec.709, potem ciepłe przesunięcie kanałów R/B.
 */
export function gradeMatrix(saturation = 1.14, warmth = 0.04): M3 {
  const lr = 0.2126;
  const lg = 0.7152;
  const lb = 0.0722;
  const s = saturation;
  const sat: M3 = [
    lr * (1 - s) + s, lg * (1 - s), lb * (1 - s),
    lr * (1 - s), lg * (1 - s) + s, lb * (1 - s),
    lr * (1 - s), lg * (1 - s), lb * (1 - s) + s,
  ];
  const warm: M3 = [1 + warmth, 0, 0, 0, 1 + warmth * 0.3, 0, 0, 0, 1 - warmth];
  return mul(warm, sat);
}

/** Macierz 4×5 (wiersze RGBA, ostatnia kolumna = przesunięcie): najpierw korekcja bajkowa, potem daltonizacja. */
export function colorMatrix20(mode: ColorblindMode, grade = false): number[] {
  const d = daltonizeMatrix(mode);
  const m = grade ? mul(d, gradeMatrix()) : d;
  return [m[0], m[1], m[2], 0, 0, m[3], m[4], m[5], 0, 0, m[6], m[7], m[8], 0, 0, 0, 0, 0, 1, 0];
}

/** Ustawia filtr SVG (feColorMatrix) używany przez CSS `filter: url(#cb-filter)` dla interfejsu HTML. */
export function applyHtmlColorblind(mode: ColorblindMode): void {
  const root = document.documentElement;
  const node = document.getElementById('cb-matrix');
  if (node) node.setAttribute('values', colorMatrix20(mode).join(' '));
  root.dataset.colorblind = mode;
}
