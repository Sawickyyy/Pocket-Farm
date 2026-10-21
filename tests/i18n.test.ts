import { describe, expect, it } from 'vitest';
import { CONTENT, PROFESSIONS } from '../src/content/content';
import { DICTS, setLanguage, t } from '../src/i18n/i18n';
import type { FailReason } from '../src/sim/commands';

const FAILS: FailReason[] = [
  'invalid', 'locked', 'not-adjacent', 'already-unlocked', 'already-tilled', 'not-tilled', 'occupied', 'no-seeds',
  'out-of-season', 'already-watered', 'nothing-to-water', 'nothing-to-harvest', 'not-ready', 'soil-rich', 'no-fertilizer',
  'no-coins', 'level-too-low', 'nothing-to-sell', 'blocked', 'outside-farm', 'busy', 'full', 'wrong-home', 'no-feed',
  'not-hungry', 'already-petted', 'not-ready-animal', 'missing-items', 'queue-full', 'empty', 'expired', 'already-gifted',
  'no-points', 'requires-skill', 'already-have', 'not-complete', 'claimed', 'no-festival', 'not-water', 'hidden',
  'not-forage', 'not-respawned', 'no-bite', 'escaped',
  'terrain', 'tier-too-low', 'not-territory-edge', 'max-territory', 'foreign-land', 'unique', 'no-caravan', 'no-stock',
  'not-damaged', 'already-chosen', 'no-medicine', 'not-sick', 'needs-townhall',
];

describe('tłumaczenia', () => {
  it('pl i en mają identyczny zestaw kluczy', () => {
    const pl = Object.keys(DICTS.pl).sort();
    const en = Object.keys(DICTS.en).sort();
    expect(en.filter((k) => !pl.includes(k))).toEqual([]);
    expect(pl.filter((k) => !en.includes(k))).toEqual([]);
  });

  it('każdy element danych gry ma nazwę', () => {
    const required = [
      ...CONTENT.itemList.map((i) => `item.${i.id}`),
      ...CONTENT.buildingList.map((b) => `building.${b.id}`),
      ...CONTENT.animalList.map((a) => `animal.${a.id}`),
      ...CONTENT.npcs.flatMap((n) => [`npc.${n.id}`, `npc.${n.id}.role`]),
      ...CONTENT.skills.flatMap((s) => [`skill.${s.id}`, `skill.${s.id}.desc`]),
      ...CONTENT.quests.map((q) => `quest.${q.id}`),
      ...CONTENT.achievements.map((a) => `achievement.${a.id}`),
      ...CONTENT.festivals.map((f) => `festival.${f.id}`),
      ...CONTENT.tutorial.map((s) => `tutorial.${s.id}`),
      ...FAILS.map((f) => `fail.${f}`),
      ...PROFESSIONS.map((p) => `profession.${p}`),
      ...CONTENT.settlement.tiers.map((t) => `tier.${t.id}`),
      ...CONTENT.settlement.partners.map((p) => `partner.${p.id}`),
      ...CONTENT.settlement.specializations.map((x) => `spec.${x.id}`),
    ];
    expect(required.filter((k) => !(k in DICTS.pl))).toEqual([]);
  });

  it('interpolacja i przełączanie języka', () => {
    setLanguage('en');
    expect(t('quest.harvest', { n: 5 })).toBe('Harvest crops (5)');
    setLanguage('pl');
    expect(t('quest.harvest', { n: 5 })).toBe('Zbierz plony (5)');
    expect(t('missing.key')).toBe('missing.key');
  });
});
