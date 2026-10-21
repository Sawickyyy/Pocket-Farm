// Postęp: zadania dzienne i tygodniowe, osiągnięcia, statystyki oraz drzewko umiejętności.

import { CONTENT } from '../../content/content';
import { fmt, t } from '../../i18n/i18n';
import { canLearn } from '../../sim/systems/skills';
import { questReward } from '../../sim/systems/progress';
import type { Quest } from '../../sim/types';
import type { App } from '../app';
import { h } from '../dom';
import { ic, icEl } from '../uiIcons';
import type { SheetManager } from '../sheet';
import { viewCtx } from '../view';
import { bar, btn, card, coins, grid } from './common';

export function registerProgress(app: App, sheets: SheetManager): void {
  sheets.register({
    id: 'progress',
    parent: 'hub',
    title: () => t('progress.title'),
    tabs: () => [
      { id: 'quests', label: t('progress.daily') },
      { id: 'achievements', label: t('progress.achievements') },
      { id: 'stats', label: t('progress.stats') },
    ],
    sig: (s, tab) => tab + JSON.stringify([s.quests, s.achievements, tab === 'stats' ? s.stats : 0]),
    render(body, s, tab) {
      const ctx = viewCtx(s);
      if (tab === 'quests') {
        const row = (q: Quest, weekly: boolean) => {
          const r = questReward(ctx, q, weekly);
          const done = q.progress >= q.target;
          const el = card(null, t(`quest.${q.tpl}`, { n: fmt(q.target) }), `${fmt(q.progress)}/${fmt(q.target)} · ${coins(fmt(r.coins))} · +${r.xp} XP`, [
            q.claimed ? icEl('check', 'big') : btn(t('progress.claim'), () => void app.send({ type: 'claimQuest', id: q.id }), { disabled: !done, small: true, reward: true }),
          ], { cls: q.claimed ? 'done' : '' });
          el.querySelector('p')?.after(bar(q.progress / q.target));
          return el;
        };
        body.replaceChildren(
          h('h3', { text: t('progress.daily') }),
          grid(s.quests.daily.map((q) => row(q, false))),
          h('h3', { text: t('progress.weekly') }),
          grid(s.quests.weekly.map((q) => row(q, true))),
        );
        return;
      }
      if (tab === 'achievements') {
        body.replaceChildren(
          grid(
            CONTENT.achievements.map((a) => {
              const done = s.achievements[a.id] !== undefined;
              const cur = Math.min(a.target, s.stats[a.stat] ?? 0);
              const el = card(null, `${ic(done ? 'trophy' : 'lock')} ${t(`achievement.${a.id}`)}`, `${t(`stat.${a.stat}`)}: ${fmt(cur)}/${fmt(a.target)} · ${coins(fmt(a.coins))}`, [], { cls: done ? '' : 'done' });
              el.querySelector('p')?.after(bar(cur / a.target));
              return el;
            }),
            true,
          ),
        );
        return;
      }
      const stats = CONTENT.achievements.map((a) => a.stat).filter((v, i, arr) => arr.indexOf(v) === i);
      body.replaceChildren(
        h('dl', { class: 'stats-grid' }, ...stats.flatMap((k) => [h('dt', { text: t(`stat.${k}`) }), h('dd', { text: fmt(s.stats[k] ?? 0) })])),
      );
    },
  });

  sheets.register({
    id: 'skills',
    parent: 'hub',
    title: () => t('skills.title'),
    sig: (s) => JSON.stringify([s.skills, s.skillPoints]),
    render(body, s) {
      const branches = ['farming', 'husbandry', 'trade'] as const;
      body.replaceChildren(
        h('p', { html: `<b>${t('skills.points', { n: s.skillPoints })}</b> · ${t('skills.hint')}` }),
        h(
          'div',
          { class: 'branches' },
          ...branches.map((b) =>
            h(
              'section',
              {},
              h('h3', { text: t(`branch.${b}`) }),
              grid(
                CONTENT.skills
                  .filter((sk) => sk.branch === b)
                  .map((sk) => {
                    const have = s.skills.includes(sk.id);
                    const check = canLearn(s, CONTENT, sk.id);
                    const req = sk.requires.length ? t('skills.requires', { list: sk.requires.map((r) => t(`skill.${r}`)).join(', ') }) : '';
                    return card(null, `${ic(have ? 'star-gold' : 'star-empty')} ${t(`skill.${sk.id}`)}`, `${t(`skill.${sk.id}.desc`)}${req ? `<br>${req}` : ''}`, [
                      have ? h('span', { text: t('skills.learned') }) : btn(t('skills.learn', { n: sk.cost }), () => void app.send({ type: 'unlockSkill', id: sk.id }), { disabled: !check.ok, small: true }),
                    ], { cls: have ? 'done' : '' });
                  }),
              ),
            ),
          ),
        ),
      );
    },
  });
}
