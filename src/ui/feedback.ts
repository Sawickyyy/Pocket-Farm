// Reakcje interfejsu na zdarzenia symulacji: dźwięk (z panoramą wg pozycji na ekranie) i komunikaty.
// Osada: komunikaty zbierane przez chwilę i łączone (townToasts), awans etapu jako duży „moment”.

import { CONTENT, parseKey } from '../content/content';
import { buildingName, fmt, itemName, npcName, t } from '../i18n/i18n';
import type { SfxName } from '../audio/sfx';
import { buildingIconUrl } from '../render/art/atlas';
import type { SimEvent } from '../sim/events';
import type { App } from './app';
import { h, img } from './dom';
import { keyLabel } from './format';
import { TOWN_TOAST_EVENTS, tierUnlocks, townToasts, type TownToast } from './townHud';
import { icEl } from './uiIcons';

const SOUND: Partial<Record<SimEvent['type'], SfxName>> = {
  tilled: 'till',
  planted: 'plant',
  watered: 'water',
  fertilized: 'plant',
  harvested: 'harvest',
  cleared: 'till',
  unlocked: 'unlock',
  sold: 'coin',
  bought: 'coin',
  levelUp: 'levelUp',
  placed: 'build',
  moved: 'build',
  removed: 'build',
  animalBought: 'animal',
  fed: 'plant',
  petted: 'animal',
  collected: 'harvest',
  queued: 'click',
  crafted: 'craft',
  outputCollected: 'coin',
  orderDone: 'coin',
  gift: 'unlock',
  skillUnlocked: 'levelUp',
  questClaimed: 'coin',
  achievement: 'levelUp',
  festivalDone: 'levelUp',
  explored: 'unlock',
  foraged: 'harvest',
  bite: 'splash',
  caught: 'splash',
  escaped: 'error',
  // osada (produced bez dźwięku – za często)
  territory: 'unlock',
  constructed: 'build',
  arrived: 'chime',
  born: 'chime',
  fire: 'alarm',
  fireOut: 'splash',
  breakdown: 'error',
  repaired: 'build',
  epidemic: 'animal',
  epidemicOver: 'unlock',
  crisis: 'error',
  goodEvent: 'unlock',
  caravan: 'caravan',
  traded: 'coin',
  proposal: 'paper',
  decided: 'wax',
  tierUp: 'fanfare',
  unpaid: 'error',
  specialized: 'levelUp',
};

// ---------------------------------------------------------------- osada: komunikaty

/** Zdarzenia osady czekające na wspólny komunikat (zdarzenia z kilku kroków symulacji łączą się w jeden). */
let townBuffer: SimEvent[] = [];
let townTimer = 0;
const TOWN_FLUSH_MS = 350;

function townToastMs(x: TownToast): number {
  return x.kind === 'warn' ? 4200 : 3200;
}

function flushTown(app: App): void {
  townTimer = 0;
  const events = townBuffer;
  townBuffer = [];
  for (const x of townToasts(events, app.store.get())) {
    const a = x.action;
    const focus = a?.focus;
    const run = focus
      ? () => {
          app.closeSheet();
          app.scene()?.focusTile(focus.x - 0.5, focus.y - 0.5);
        }
      : () => app.openSheet('settlement', undefined, a?.tab);
    app.toasts.show(x.text, x.kind, a ? { label: a.label, run } : undefined, townToastMs(x));
  }
}

function queueTown(app: App, e: SimEvent): void {
  townBuffer.push(e);
  if (!townTimer) townTimer = window.setTimeout(() => flushTown(app), TOWN_FLUSH_MS);
}

// ---------------------------------------------------------------- osada: awans etapu

let moment: HTMLElement | null = null;
let momentTimer = 0;
const MOMENT_MS = 5600;
const MAX_UNLOCKS = 8;
const CONFETTI = ['leaf', 'sun', 'sky', 'terra', 'berry'];

/** Duży moment awansu osady: korona, złota wstęga z nazwą etapu, karta nowych budynków i konfetti. */
export function tierMoment(app: App, tier: number): void {
  const def = CONTENT.settlement.tiers[tier];
  if (!def) return;
  // nie nakładamy się na zwykły baner (np. nowy poziom) – poczekamy, aż zejdzie
  if (document.querySelector('.banner.show:not(.leaving):not(.town-moment)')) {
    setTimeout(() => tierMoment(app, tier), 2800);
    return;
  }
  clearTimeout(momentTimer);
  moment?.remove();

  const close = () => {
    clearTimeout(momentTimer);
    el.classList.add('leaving');
    momentTimer = window.setTimeout(() => {
      el.remove();
      if (moment === el) moment = null;
    }, 320);
  };
  const unlocks = tierUnlocks(tier);
  const body = unlocks.length
    ? [
        h('p', { class: 'town-unlocks-title', text: t('townHud.moment.unlocks') }),
        h(
          'ul',
          { class: 'town-unlocks-list' },
          ...unlocks.slice(0, MAX_UNLOCKS).map((id) => h('li', {}, img(buildingIconUrl(id, 96), 'town-unlock-ico'), h('span', { text: buildingName(id) }))),
        ),
        unlocks.length > MAX_UNLOCKS ? h('p', { class: 'town-unlocks-more', text: t('townHud.moment.more', { n: unlocks.length - MAX_UNLOCKS }) }) : null,
      ]
    : [h('p', { class: 'town-unlocks-title', text: t('townHud.moment.spec') })];

  const el = h(
    'div',
    { class: 'banner town-moment', attrs: { role: 'status' } },
    h('span', { class: 'banner-icon', attrs: { 'aria-hidden': 'true' } }, icEl('crown')),
    h(
      'div',
      { class: 'banner-ribbon' },
      h('strong', { text: t('townHud.moment.title', { tier: t(`tier.${def.id}`) }) }),
      h('small', { text: t('townHud.moment.sub', { n: tier + 1, total: CONTENT.settlement.tiers.length }) }),
    ),
    h(
      'div',
      { class: 'town-unlocks m-paper' },
      ...body,
      h(
        'div',
        { class: 'town-unlocks-actions' },
        h('button', {
          class: 'btn primary sm',
          type: 'button',
          text: t('townHud.moment.open'),
          on: {
            click: () => {
              app.click();
              close();
              app.openSheet('settlement');
            },
          },
        }),
        h('button', {
          class: 'btn sm',
          type: 'button',
          text: t('townHud.moment.close'),
          on: {
            click: () => {
              app.click();
              close();
            },
          },
        }),
      ),
    ),
    h('i', { class: 'banner-stars', attrs: { 'aria-hidden': 'true' } }),
    h(
      'span',
      { class: 'town-confetti', attrs: { 'aria-hidden': 'true' } },
      ...Array.from({ length: app.reducedMotion() ? 0 : 18 }, (_, i) => {
        const bit = h('i', { class: `c-${CONFETTI[i % CONFETTI.length]}` });
        bit.style.setProperty('--x', `${Math.round(Math.random() * 100)}%`);
        bit.style.setProperty('--d', `${Math.round(Math.random() * 900)}ms`);
        bit.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
        bit.style.setProperty('--s', (0.7 + Math.random() * 0.6).toFixed(2));
        return bit;
      }),
    ),
  );
  document.body.append(el);
  moment = el;
  void el.offsetWidth;
  el.classList.add('show');
  momentTimer = window.setTimeout(close, MOMENT_MS);
}

export function handleEvents(app: App, events: readonly SimEvent[]): void {
  const played = new Set<SfxName>();
  const sold = { qty: 0, coins: 0, key: '' };
  const scene = app.scene();

  for (const e of events) {
    const snd = e.type === 'relation' && e.kind === 'partner' ? 'chime' : SOUND[e.type];
    if (snd && !played.has(snd)) {
      played.add(snd);
      // Dźwięk przestrzenny: panorama wg pozycji zdarzenia na ekranie, ciszej poza kadrem.
      let where = { pan: 0, gain: 1 };
      if ('at' in e && scene) {
        const p = scene.screenOfTile(e.at);
        const w = scene.cam.viewport.width;
        const hgt = scene.cam.viewport.height;
        const off = p.x < 0 || p.y < 0 || p.x > w || p.y > hgt;
        // alarm pożarowy słychać wyraźnie także poza kadrem
        where = { pan: (p.x / w) * 2 - 1, gain: off && snd !== 'alarm' ? 0.35 : 1 };
      }
      app.audio.play(snd, where);
    }
    if (TOWN_TOAST_EVENTS.has(e.type)) queueTown(app, e);
    switch (e.type) {
      case 'levelUp':
        app.toasts.banner(t('banner.level', { level: e.level }), t('banner.levelReward', { coins: e.reward }), 'star');
        break;
      case 'sold':
        sold.qty += e.qty;
        sold.coins += e.coins;
        sold.key = sold.key && sold.key !== e.key ? '*' : e.key;
        break;
      case 'orderDone':
        app.toasts.show(t('toast.order', { coins: fmt(e.coins) }), 'good');
        break;
      case 'gift':
        app.toasts.show(t(`toast.gift.${e.reaction}`, { npc: npcName(e.npc) }), 'good');
        break;
      case 'heartReward':
        app.toasts.show(t('toast.heart', { npc: npcName(e.npc), n: e.hearts }), 'good');
        break;
      case 'skillUnlocked':
        app.toasts.show(t('toast.skill', { name: t(`skill.${e.id}`) }), 'good');
        break;
      case 'questReady':
        app.toasts.show(t('toast.quest'), 'good');
        break;
      case 'questClaimed':
        app.toasts.show(t('toast.questClaimed', { coins: fmt(e.coins) }), 'good');
        break;
      case 'achievement':
        app.toasts.banner(t('banner.achievement'), `${t(`achievement.${e.id}`)} · +${fmt(e.coins)}`, 'trophy');
        break;
      case 'festivalDone':
        app.toasts.show(t('toast.festival', { name: buildingName(e.unlock) }), 'good');
        break;
      case 'explored':
        app.toasts.show(t('toast.explored'), 'good');
        break;
      case 'caught':
        app.toasts.show(t('toast.caught', { item: keyLabel(e.key) }), 'good');
        break;
      case 'newDay':
        app.toasts.show(t('toast.newDay', { day: e.day + 1, weather: t(`weather.${e.weather}`) }));
        break;
      case 'season':
        app.toasts.banner(t('toast.season', { season: t(`season.${e.season}`) }), '', `s-${e.season}`);
        break;
      case 'withered':
        app.toasts.show(t('toast.withered'), 'warn');
        break;
      case 'placed':
        app.toasts.show(t('toast.placed', { name: buildingName(e.building) }), 'good');
        break;
      case 'bite':
        app.startFishing();
        break;
      case 'crafted':
        app.toasts.show(t('toast.crafted', { item: itemName(e.item) }));
        break;
      case 'tierUp':
        tierMoment(app, e.tier);
        break;
      case 'specialized':
        app.toasts.banner(t('townEvent.specialized'), t(`spec.${e.id}`), 'crown', 3200);
        break;
      default:
        break;
    }
  }
  if (sold.qty) {
    const item = sold.key === '*' ? '…' : itemName(parseKey(sold.key).id);
    app.toasts.show(t('toast.sold', { qty: sold.qty, item, coins: fmt(sold.coins) }), 'good');
  }
}
