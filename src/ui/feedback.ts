// Reakcje interfejsu na zdarzenia symulacji: dźwięk (z panoramą wg pozycji na ekranie) i komunikaty.

import { parseKey } from '../content/content';
import { buildingName, fmt, itemName, npcName, t } from '../i18n/i18n';
import type { SfxName } from '../audio/sfx';
import type { SimEvent } from '../sim/events';
import type { App } from './app';
import { keyLabel } from './format';

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
};

export function handleEvents(app: App, events: readonly SimEvent[]): void {
  const played = new Set<SfxName>();
  const sold = { qty: 0, coins: 0, key: '' };
  const scene = app.scene();

  for (const e of events) {
    const snd = SOUND[e.type];
    if (snd && !played.has(snd)) {
      played.add(snd);
      // Dźwięk przestrzenny: panorama wg pozycji zdarzenia na ekranie, ciszej poza kadrem.
      let where = { pan: 0, gain: 1 };
      if ('at' in e && scene) {
        const p = scene.cam.toScreen(e.at.x * 128, e.at.y * 128);
        const w = scene.cam.viewport.width;
        const hgt = scene.cam.viewport.height;
        const off = p.x < 0 || p.y < 0 || p.x > w || p.y > hgt;
        where = { pan: (p.x / w) * 2 - 1, gain: off ? 0.35 : 1 };
      }
      app.audio.play(snd, where);
    }
    switch (e.type) {
      case 'levelUp':
        app.toasts.show(t('toast.levelUp', { level: e.level, coins: e.reward }), 'good');
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
        app.toasts.show(t('toast.achievement', { name: t(`achievement.${e.id}`), coins: fmt(e.coins) }), 'good');
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
        app.toasts.show(t('toast.season', { season: t(`season.${e.season}`) }), 'good');
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
      default:
        break;
    }
  }
  if (sold.qty) {
    const item = sold.key === '*' ? '…' : itemName(parseKey(sold.key).id);
    app.toasts.show(t('toast.sold', { qty: sold.qty, item, coins: fmt(sold.coins) }), 'good');
  }
}
