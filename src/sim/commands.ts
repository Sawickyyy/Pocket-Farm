import type { Settings, ToolId } from './types';

/** Komendy wysyłane z interfejsu do symulacji (w Web Workerze). */
export type Command =
  | { type: 'selectTool'; tool: ToolId }
  | { type: 'selectSeed'; crop: string }
  | { type: 'selectFertilizer'; item: string }
  /** Tap na polu (z komunikatem o błędzie) lub przeciągnięcie (`silent`). */
  | { type: 'useTool'; plot: number; silent?: boolean }
  | { type: 'unlockPlot'; plot: number }
  | { type: 'buySeeds'; crop: string; qty: number }
  | { type: 'buyItem'; item: string; qty: number }
  | { type: 'sell'; key: string; qty: number | 'all' }
  | { type: 'sellAll' }
  | { type: 'place'; building: string; x: number; y: number }
  | { type: 'move'; uid: number; x: number; y: number }
  | { type: 'remove'; uid: number }
  | { type: 'buyAnimal'; kind: string; home: number }
  | { type: 'feedAnimal'; id: number }
  | { type: 'feedAll'; home: number }
  | { type: 'petAnimal'; id: number }
  | { type: 'collectAnimal'; id: number }
  | { type: 'collectAll'; home: number }
  | { type: 'queueRecipe'; uid: number; recipe: string }
  | { type: 'collectOutput'; uid: number }
  | { type: 'deliverOrder'; id: number }
  | { type: 'gift'; npc: string; key: string }
  | { type: 'unlockSkill'; id: string }
  | { type: 'claimQuest'; id: number }
  | { type: 'festivalDeliver' }
  | { type: 'explore'; chunk: number }
  | { type: 'forage'; tile: number }
  | { type: 'castLine'; tile: number }
  | { type: 'reelIn'; score: number }
  | { type: 'tutorial'; action: 'next' | 'skip' | 'restart' }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'debug'; op: 'coins' | 'xp' | 'skipHours' | 'timeScale' | 'revealAll' | 'growAll'; value: number };

export type FailReason =
  | 'invalid'
  | 'locked'
  | 'not-adjacent'
  | 'already-unlocked'
  | 'already-tilled'
  | 'not-tilled'
  | 'occupied'
  | 'no-seeds'
  | 'out-of-season'
  | 'already-watered'
  | 'nothing-to-water'
  | 'nothing-to-harvest'
  | 'not-ready'
  | 'soil-rich'
  | 'no-fertilizer'
  | 'no-coins'
  | 'level-too-low'
  | 'nothing-to-sell'
  | 'blocked'
  | 'outside-farm'
  | 'busy'
  | 'full'
  | 'wrong-home'
  | 'no-feed'
  | 'not-hungry'
  | 'already-petted'
  | 'not-ready-animal'
  | 'missing-items'
  | 'queue-full'
  | 'empty'
  | 'expired'
  | 'already-gifted'
  | 'no-points'
  | 'requires-skill'
  | 'already-have'
  | 'not-complete'
  | 'claimed'
  | 'no-festival'
  | 'not-water'
  | 'hidden'
  | 'not-forage'
  | 'not-respawned'
  | 'no-bite'
  | 'escaped';

export type CommandResult = { ok: true } | { ok: false; reason: FailReason };
