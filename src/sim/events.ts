import type { Quality, Season, WeatherId } from '../content/content';
import type { RelationKind, ToolId } from './types';

/** Pozycja na mapie (kafle) – do efektów i dźwięku przestrzennego. */
export interface At {
  x: number;
  y: number;
}

export type SimEvent =
  | { type: 'toolSelected'; tool: ToolId }
  | { type: 'tilled'; plot: number; at: At }
  | { type: 'planted'; plot: number; crop: string; at: At }
  | { type: 'watered'; plot: number; at: At }
  | { type: 'fertilized'; plot: number; item: string; at: At }
  | { type: 'harvested'; plot: number; crop: string; quality: Quality; xp: number; at: At }
  | { type: 'cleared'; plot: number; at: At }
  | { type: 'withered'; plot: number; at: At }
  | { type: 'unlocked'; plot: number; cost: number; at: At }
  | { type: 'levelUp'; level: number; reward: number }
  | { type: 'sold'; key: string; qty: number; coins: number }
  | { type: 'bought'; item: string; qty: number; cost: number }
  | { type: 'placed'; uid: number; building: string; at: At }
  | { type: 'moved'; uid: number; at: At }
  | { type: 'removed'; uid: number; refund: number; at: At }
  | { type: 'animalBought'; id: number; kind: string; at: At }
  | { type: 'fed'; id: number; at: At }
  | { type: 'petted'; id: number; at: At }
  | { type: 'animalReady'; id: number }
  | { type: 'collected'; id: number; key: string; at: At }
  | { type: 'queued'; uid: number; recipe: string; at: At }
  | { type: 'crafted'; uid: number; item: string; qty: number; at: At }
  | { type: 'outputCollected'; uid: number; count: number; at: At }
  | { type: 'orderDone'; id: number; npc: string; coins: number }
  | { type: 'gift'; npc: string; reaction: 'love' | 'like' | 'neutral'; points: number }
  | { type: 'heartReward'; npc: string; hearts: number }
  | { type: 'skillUnlocked'; id: string }
  | { type: 'questReady'; id: number }
  | { type: 'questClaimed'; id: number; coins: number }
  | { type: 'achievement'; id: string; coins: number }
  | { type: 'festivalDone'; id: string; unlock: string }
  | { type: 'explored'; chunk: number; cost: number }
  | { type: 'foraged'; tile: number; key: string; at: At }
  | { type: 'bite'; fish: string; difficulty: number; at: At }
  | { type: 'caught'; fish: string; key: string; at: At }
  | { type: 'escaped'; at: At }
  | { type: 'newDay'; day: number; weather: WeatherId }
  | { type: 'season'; season: Season }
  | { type: 'tutorial'; step: number }
  // ---------------------------------------------------------------- osada
  | { type: 'territory'; chunk: number; cost: number }
  | { type: 'constructed'; uid: number; building: string; at: At }
  | { type: 'produced'; uid: number; item: string; qty: number; at: At }
  | { type: 'arrived'; family: number; count: number; home: number; at: At }
  | { type: 'left'; count: number; reason: 'unhappy' | 'homeless' }
  | { type: 'born'; id: number; name: string }
  | { type: 'grewUp'; id: number }
  | { type: 'relation'; kind: RelationKind; a: number; b: number }
  | { type: 'fire'; uid: number; at: At }
  | { type: 'fireOut'; uid: number; damaged: boolean; at: At }
  | { type: 'breakdown'; uid: number; at: At }
  | { type: 'repaired'; uid: number; at: At }
  | { type: 'epidemic'; home: number; at: At }
  | { type: 'epidemicOver'; home: number }
  | { type: 'crisis'; days: number }
  | { type: 'goodEvent'; kind: 'festival' | 'harvest' | 'richCaravan' }
  | { type: 'caravan'; from: string }
  | { type: 'caravanLeft'; from: string }
  | { type: 'traded'; item: string; qty: number; coins: number; dir: 'export' | 'import' }
  | { type: 'proposal'; id: number; tpl: string }
  | { type: 'decided'; id: number; tpl: string; approve: boolean }
  | { type: 'tierUp'; tier: number }
  | { type: 'budget'; day: number; net: number }
  | { type: 'unpaid'; missing: number }
  | { type: 'specialized'; id: string }
  | { type: 'stateReplaced' };

export type SimEventType = SimEvent['type'];
