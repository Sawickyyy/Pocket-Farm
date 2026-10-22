// Postacie osady: mieszkańcy wg zawodu i wyglądu, dzieci, wóz karawany, cząsteczki ognia.
// STUB – moduł „postacie i ikony” (docs/plan-osada.md §15). Nazwy klatek są kontraktem z warstwą mieszkańców.

import type { Content } from '../../content/content';
import type { Entry } from './atlas';

/** Liczba wariantów wyglądu w atlasie (look mieszkańca % LOOKS). */
export const LOOKS = 4;
/** Mieszkaniec: `res_<zawód|idle>_<look>_<klatka 0|1>`; dziecko: `res_child_<look>_<klatka>`. */
export const residentFrame = (prof: string | null, look: number, f: number): string => `res_${prof ?? 'idle'}_${look % LOOKS}_${f}`;
export const childFrame = (look: number, f: number): string => `res_child_${look % LOOKS}_${f}`;
/** Wóz karawany (klatki kół 0|1). */
export const caravanFrame = (f: number): string => `caravan_${f}`;

/** Klatki atlasu: mieszkańcy, dzieci, wóz, cząsteczki 'p_fire' i 'p_ember'. */
export function characterEntries(c: Content): Entry[] {
  void c;
  return [];
}
