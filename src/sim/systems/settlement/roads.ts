// Drogi i dojazd (docs/plan-osada.md §3). STUB – do implementacji w module „teren i drogi”.

import type { Content } from '../../../content/content';
import type { Ctx } from '../../ctx';
import type { GameState } from '../../types';
import { MAP_H, MAP_W, type WorldMap } from '../../world';

/** Mapa kafli drogi (1 = droga): obiekty `kind` path/bridge + drogi wioski (`world.road`). */
export function roadTiles(s: GameState, c: Content, world: WorldMap): Uint8Array {
  void s;
  void c;
  return new Uint8Array(world.road.length || MAP_W * MAP_H);
}

/** Id spójnej składowej sieci dróg dla każdego kafla (−1 = brak drogi). Wynik może być cache'owany. */
export function roadComponents(s: GameState, c: Content, world: WorldMap): Int32Array {
  void s;
  void c;
  void world;
  return new Int32Array(MAP_W * MAP_H).fill(-1);
}

/** Składowe dróg przylegające (4-sąsiedztwo) do obrysu budynku `uid`. */
export function accessOf(s: GameState, c: Content, world: WorldMap, uid: number): number[] {
  void s;
  void c;
  void world;
  void uid;
  return [];
}

/** Czy budynek ma dostęp do jakiejkolwiek drogi. */
export function isConnected(ctx: Ctx, uid: number): boolean {
  void ctx;
  void uid;
  return false;
}

/** Dojazd dom → praca: wspólna składowa dróg albo odległość środków (Manhattan) ≤ 6 (≤ 12 z zajezdnią). */
export function canCommute(ctx: Ctx, homeUid: number, jobUid: number): boolean {
  void ctx;
  void homeUid;
  void jobUid;
  return true;
}

/** Najkrótsza trasa po kaflach drogi między kaflami (dla grafiki); null, gdy brak połączenia. */
export function findPath(s: GameState, c: Content, world: WorldMap, from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number }[] | null {
  void s;
  void c;
  void world;
  void from;
  void to;
  return null;
}
