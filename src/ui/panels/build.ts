// Katalog budowy i panel budynku (kurnik/obora ze zwierzętami, maszyny z kolejką, pozostałe).

import { CONTENT } from '../../content/content';
import { animalName, buildingName, fmt, itemName, t } from '../../i18n/i18n';
import { animalIconUrl, buildingIconUrl, itemIconUrl } from '../../render/art/atlas';
import { HOUR_MS } from '../../sim/calendar';
import { countItem, levelOf } from '../../sim/ctx';
import { OUTPUT_CAP, outputCount, queueLimit } from '../../sim/systems/processing';
import { REFUND } from '../../sim/systems/building';
import type { GameState } from '../../sim/types';
import type { App } from '../app';
import { h } from '../dom';
import { formatDuration } from '../format';
import type { SheetManager } from '../sheet';
import { viewCtx } from '../view';
import { bar, btn, card, coins, empty, grid, setBar } from './common';

export function registerBuild(app: App, sheets: SheetManager): void {
  // ---------------------------------------------------------- katalog
  sheets.register({
    id: 'build',
    parent: 'hub',
    title: () => t('build.title'),
    tabs: () => [
      { id: 'buildings', label: t('build.buildings') },
      { id: 'deco', label: t('build.deco') },
    ],
    sig: (s, tab) => tab + JSON.stringify([s.coins, s.xp, s.unlocks]),
    render(body, s, tab) {
      const level = levelOf(s.xp);
      const list = CONTENT.buildingList.filter((b) => (tab === 'deco' ? ['deco', 'path', 'lantern'].includes(b.kind) : !['deco', 'path', 'lantern'].includes(b.kind)));
      body.replaceChildren(
        grid(
          list.map((b) => {
            const lockedFest = b.festival && !s.unlocks.includes(b.id);
            const lockedLevel = level < b.level;
            const [w, hgt] = b.size;
            const desc = `${b.cost ? coins(fmt(b.cost)) : '🎁'} · ${t('build.size', { w, h: hgt })}${b.capacity ? ` · ${t('home.animals', { n: 0, cap: b.capacity })}` : ''}`;
            return card(
              buildingIconUrl(b.id),
              buildingName(b.id),
              desc,
              lockedFest || lockedLevel
                ? []
                : [
                    btn(t('build.place'), () => {
                      app.click();
                      app.closeSheet();
                      app.startBuild(b.id);
                    }, { disabled: s.coins < b.cost }),
                  ],
              { note: lockedFest ? t('build.festivalOnly') : lockedLevel ? t('shop.fromLevel', { level: b.level }) : undefined, cls: 'buy' },
            );
          }),
          true,
        ),
      );
    },
  });

  // ---------------------------------------------------------- panel budynku
  const objectOf = (s: GameState, uid: unknown) => s.objects.find((o) => o.uid === uid);

  sheets.register({
    id: 'building',
    title: (uid, s) => {
      const o = objectOf(s, uid);
      return o ? buildingName(o.type) : '';
    },
    sig: (s, _tab, uid) => {
      const o = objectOf(s, uid);
      const m = s.machines[String(uid)];
      const animals = s.animals.filter((a) => a.home === uid);
      return JSON.stringify([
        o,
        s.coins >= 0 ? Math.floor(s.coins / 10) : 0,
        s.inventory,
        m?.queue.length,
        m?.output,
        animals.map((a) => [a.id, a.ready, a.pettedDay, Math.round(a.hunger * 20), Math.round(a.affection * 20)]),
        s.skills,
      ]);
    },
    tick(body, s, uid) {
      const m = s.machines[String(uid)];
      m?.queue.forEach((job, i) => {
        const r = CONTENT.recipes[job.recipe];
        if (r) setBar(body, `job${i}`, 1 - job.remainingMs / ((r.minutes / 60) * HOUR_MS));
      });
      for (const a of s.animals.filter((x) => x.home === uid)) {
        setBar(body, `h${a.id}`, a.hunger);
        setBar(body, `p${a.id}`, a.progress);
      }
    },
    render(body, s, _tab, uid) {
      const o = objectOf(s, uid);
      const def = o && CONTENT.buildings[o.type];
      if (!o || !def) {
        body.replaceChildren(empty(t('fail.invalid')));
        return;
      }
      const parts: (HTMLElement | null)[] = [];
      if (def.kind === 'home') parts.push(...homeView(app, s, o.uid, def.id));
      else if (def.kind === 'machine') parts.push(...machineView(app, s, o.uid, def.id));
      else if (def.kind === 'sprinkler') parts.push(h('p', { text: t('sprinkler.info', { r: def.radius ?? 1 }) }));
      else if (def.kind === 'lantern') parts.push(h('p', { text: t('lantern.info') }));
      else parts.push(h('p', { text: t('deco.info') }));

      parts.push(
        h(
          'div',
          { class: 'row' },
          btn(t('build.move'), () => {
            app.click();
            app.closeSheet();
            app.startMove(o.uid);
          }, { primary: false }),
          btn(`${t('build.remove')} (${t('build.refund', { n: Math.floor(def.cost * REFUND) })})`, () => {
            app.confirm(t('build.remove'), buildingName(def.id), t('build.remove'), () => {
              void app.send({ type: 'remove', uid: o.uid }).then((ok) => ok && app.closeSheet());
            });
          }, { danger: true }),
        ),
      );
      body.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
    },
  });
}

function homeView(app: App, s: GameState, uid: number, type: string): HTMLElement[] {
  const def = CONTENT.buildings[type]!;
  const animals = s.animals.filter((a) => a.home === uid);
  const cal = viewCtx(s).cal;
  const level = levelOf(s.xp);
  const feedKinds = [...new Set((def.animals ?? []).flatMap((k) => CONTENT.animals[k]?.feed ?? []))];
  const out: HTMLElement[] = [
    h('p', {
      class: 'hint',
      html: `${t('home.animals', { n: animals.length, cap: def.capacity ?? 0 })} · ${t('home.feedHint', {
        items: feedKinds.map((f) => `${itemName(f)} (${countItem(s, f)})`).join(', '),
      })}`,
    }),
  ];
  if (!animals.length) out.push(empty(t('home.empty')));
  out.push(
    grid(
      animals.map((a) => {
        const info = h(
          'div',
          {},
          h('h4', { html: `${a.name} · ${animalName(a.kind)}${a.ready ? ` <span class="chip hot">${t('home.ready')}</span>` : ''}` }),
          h('p', { text: t('home.hunger') }),
          bar(a.hunger, a.hunger < 0.2, `h${a.id}`),
          h('p', { text: `${t('home.affection')} ${'♥'.repeat(Math.round(a.affection * 5))}${'♡'.repeat(5 - Math.round(a.affection * 5))}` }),
          bar(a.progress, false, `p${a.id}`),
        );
        return h(
          'div',
          { class: 'card' },
          h('div', { class: 'thumb' }, h('img', { attrs: { src: animalIconUrl(a.kind), alt: '' } })),
          info,
          h(
            'div',
            { class: 'actions' },
            btn(t('home.feed'), () => void app.send({ type: 'feedAnimal', id: a.id }), { small: true, primary: false, disabled: a.hunger > 0.85 }),
            btn(t('home.pet'), () => void app.send({ type: 'petAnimal', id: a.id }), { small: true, primary: false, disabled: a.pettedDay === cal.day }),
            btn(t('home.collect'), () => void app.send({ type: 'collectAnimal', id: a.id }), { small: true, disabled: !a.ready }),
          ),
        );
      }),
    ),
  );
  if (animals.length) {
    out.push(
      h(
        'div',
        { class: 'row' },
        btn(t('home.feedAll'), () => void app.send({ type: 'feedAll', home: uid }), { primary: false }),
        btn(t('home.collectAll'), () => void app.send({ type: 'collectAll', home: uid }), { disabled: !animals.some((a) => a.ready) }),
      ),
    );
  }
  out.push(h('h3', { text: t('home.buy') }));
  out.push(
    grid(
      (def.animals ?? []).map((k) => {
        const ad = CONTENT.animals[k]!;
        const locked = level < ad.level;
        return card(animalIconUrl(k), animalName(k), `${coins(fmt(ad.price))} · ${itemName(ad.product)} / ${ad.produceHours} h`, locked ? [] : [
          btn(t('common.buy'), () => void app.send({ type: 'buyAnimal', kind: k, home: uid }), { disabled: s.coins < ad.price || animals.length >= (def.capacity ?? 0) }),
        ], { note: locked ? t('shop.fromLevel', { level: ad.level }) : undefined });
      }),
    ),
  );
  return out;
}

function machineView(app: App, s: GameState, uid: number, type: string): HTMLElement[] {
  const m = s.machines[String(uid)] ?? { queue: [], output: {} };
  const ctx = viewCtx(s);
  const limit = queueLimit(ctx);
  const recipes = CONTENT.recipeList.filter((r) => r.building === type);
  const outCount = outputCount(m);
  const out: HTMLElement[] = [];

  out.push(h('h3', { text: t('machine.queue', { n: m.queue.length, max: limit }) }));
  if (!m.queue.length) out.push(h('p', { class: 'hint', text: t('machine.idle') }));
  m.queue.forEach((job, i) => {
    const r = CONTENT.recipes[job.recipe];
    if (!r) return;
    out.push(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'thumb' }, h('img', { attrs: { src: itemIconUrl(r.output.item), alt: '' } })),
        h('div', {}, h('h4', { text: `${itemName(r.output.item)} × ${r.output.qty}` }), bar(1 - job.remainingMs / ((r.minutes / 60) * HOUR_MS), false, `job${i}`)),
        h('div'),
      ),
    );
  });

  out.push(
    h(
      'div',
      { class: 'summary-row' },
      h('span', { html: `${t('machine.output', { n: outCount })} / ${OUTPUT_CAP} ${Object.entries(m.output).map(([k, n]) => `${itemName(k)} ×${n}`).join(', ')}` }),
      btn(t('machine.collect'), () => void app.send({ type: 'collectOutput', uid }), { disabled: !outCount }),
    ),
  );

  out.push(h('h3', { text: t('machine.recipes') }));
  out.push(
    grid(
      recipes.map((r) => {
        const inputs = r.inputs.map((i) => {
          const have = countItem(s, i.item);
          return `<span class="${have < i.qty ? 'q-miss' : ''}">${itemName(i.item)} ${Math.min(have, 99)}/${i.qty}</span>`;
        });
        const can = r.inputs.every((i) => countItem(s, i.item) >= i.qty) && m.queue.length < limit;
        return card(itemIconUrl(r.output.item), `${itemName(r.output.item)} × ${r.output.qty}`, `${inputs.join(' + ')} · ⏱ ${formatDuration((r.minutes / 60) * HOUR_MS)}`, [
          btn(t('machine.make'), () => void app.send({ type: 'queueRecipe', uid, recipe: r.id }), { disabled: !can, small: true }),
        ]);
      }),
    ),
  );
  return out;
}
