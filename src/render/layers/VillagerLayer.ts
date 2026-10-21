// Mieszkańcy spacerujący po wiosce i farmie. Czysto wizualne (nie wpływają na symulację): za dnia chodzą
// po drzewie dróżek między domami, placem i polem, nocą wracają do domów. Ruch z „aktorstwem”: podskok kroku,
// przechylenie, oddech i mrugnięcia w bezruchu.

import Phaser from 'phaser';
import type { Content } from '../../content/content';
import type { Calendar } from '../../sim/types';
import { FARM, FIELD, VILLAGE_HOUSES, VILLAGE_LANE_X, VILLAGE_STREET_Y } from '../../sim/world';
import { SPRITES_KEY, villagerFrame } from '../art/atlas';
import { project } from '../iso';

interface Node {
  x: number;
  y: number;
  parent: string | null;
}

interface View {
  npc: string;
  sprite: Phaser.GameObjects.Sprite;
  /** Pozycja w kaflach (ciągła). */
  x: number;
  y: number;
  path: { x: number; y: number }[];
  node: string;
  waitUntil: number;
  stepPhase: number;
  blinkAt: number;
  home: boolean;
  speed: number;
  hopAt: number;
}

const SCALE = 0.85;
const lane = VILLAGE_LANE_X + 0.5;
const street = VILLAGE_STREET_Y + 0.5;
const farmEdge = FIELD.y + FIELD.h + 0.6;

/** Drzewo dróżek: każdy węzeł zna rodzica, trasa = w górę do wspólnego przodka i w dół. */
function buildGraph(): Record<string, Node> {
  const g: Record<string, Node> = {
    lane: { x: lane, y: street, parent: null },
    plaza: { x: lane, y: street + 1.6, parent: 'lane' },
    gate: { x: lane, y: FARM.y + FARM.h + 0.5, parent: 'lane' },
    fieldS: { x: lane, y: farmEdge, parent: 'gate' },
    fieldSW: { x: FIELD.x - 1.5, y: farmEdge, parent: 'fieldS' },
    fieldSE: { x: FIELD.x + FIELD.w + 1.5, y: farmEdge, parent: 'fieldS' },
    fieldW: { x: FIELD.x - 1.5, y: FIELD.y + 2, parent: 'fieldSW' },
    fieldE: { x: FIELD.x + FIELD.w + 1.5, y: FIELD.y + 2, parent: 'fieldSE' },
  };
  for (const h of VILLAGE_HOUSES) g[`home_${h.npc}`] = { x: h.x + 1, y: street, parent: 'lane' };
  return g;
}

const GRAPH = buildGraph();

function chain(id: string): string[] {
  const out: string[] = [];
  let cur: string | null = id;
  while (cur) {
    out.push(cur);
    cur = GRAPH[cur]?.parent ?? null;
  }
  return out;
}

function route(from: string, to: string): { x: number; y: number }[] {
  const up = chain(from);
  const down = chain(to);
  const common = up.find((n) => down.includes(n)) ?? 'lane';
  const ids = [...up.slice(0, up.indexOf(common) + 1), ...down.slice(0, down.indexOf(common)).reverse()];
  return ids.slice(1).map((id) => ({ x: GRAPH[id]!.x, y: GRAPH[id]!.y }));
}

export class VillagerLayer {
  private readonly views: View[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    content: Content,
    private readonly motion: () => boolean,
  ) {
    VILLAGE_HOUSES.forEach((h, i) => {
      if (!content.npc[h.npc]) return;
      const start = GRAPH[`home_${h.npc}`]!;
      const sprite = scene.add.sprite(0, 0, SPRITES_KEY, villagerFrame(h.npc, 0)).setOrigin(0.5, 0.9).setScale(SCALE).setDepth(25).setLighting(true);
      sprite.setData('npc', h.npc);
      this.views.push({
        npc: h.npc,
        sprite,
        x: start.x,
        y: start.y + 0.3,
        path: [],
        node: `home_${h.npc}`,
        waitUntil: 1500 + i * 1800,
        stepPhase: 0,
        blinkAt: 2000 + i * 700,
        home: false,
        speed: 1.1 + (i % 2) * 0.25,
        hopAt: -1e9,
      });
    });
  }

  private pickDestination(v: View): string {
    const options = ['plaza', 'fieldS', 'fieldSW', 'fieldSE', 'fieldW', 'fieldE', `home_${v.npc}`, ...VILLAGE_HOUSES.map((h) => `home_${h.npc}`)];
    let next = v.node;
    while (next === v.node) next = options[Math.floor(Math.random() * options.length)]!;
    return next;
  }

  update(time: number, delta: number, cal: Calendar): void {
    const motion = this.motion();
    const dt = Math.min(delta, 100) / 1000;
    for (const v of this.views) {
      const homeId = `home_${v.npc}`;
      // Nocą wszyscy idą do domu i znikają za drzwiami; rano wychodzą.
      if (cal.isNight && !v.home && v.node !== homeId && v.path.length === 0) {
        v.path = route(v.node, homeId);
        v.node = homeId;
      }
      if (v.path.length === 0 && time >= v.waitUntil && !cal.isNight) {
        const dest = this.pickDestination(v);
        v.path = route(v.node, dest);
        v.node = dest;
        if (!motion) {
          const last = v.path[v.path.length - 1];
          if (last) [v.x, v.y] = [last.x, last.y];
          v.path = [];
          v.waitUntil = time + 8000;
        }
      }

      let walking = false;
      const target = v.path[0];
      if (target && motion && time >= v.waitUntil) {
        const dx = target.x - v.x;
        const dy = target.y - v.y;
        const d = Math.hypot(dx, dy);
        const step = v.speed * dt;
        if (d <= step) {
          v.x = target.x;
          v.y = target.y;
          v.path.shift();
          if (!v.path.length) v.waitUntil = time + Phaser.Math.Between(2500, 7000);
        } else {
          v.x += (dx / d) * step;
          v.y += (dy / d) * step;
          walking = true;
          // kierunek na ekranie: rzut x = (tx - ty)
          if (Math.abs(dx - dy) > 0.01) v.sprite.setFlipX(dx - dy < 0);
        }
      }

      const atHome = cal.isNight && v.node === homeId && v.path.length === 0;
      if (atHome !== v.home) {
        v.home = atHome;
        if (motion) this.scene.tweens.add({ targets: v.sprite, alpha: atHome ? 0 : 1, duration: 600 });
        else v.sprite.setAlpha(atHome ? 0 : 1);
      }

      const p = project(v.x, v.y);
      if (walking) {
        v.stepPhase += dt * 9;
        const s = Math.sin(v.stepPhase);
        const frame = s > 0 ? 1 : 0;
        // podskok kroku: lekko rozciągnięty w górze, spłaszczony przy lądowaniu (squash & stretch)
        const lift = Math.abs(s);
        v.sprite.setFrame(villagerFrame(v.npc, frame));
        v.sprite.setPosition(p.x, p.y - lift * 6);
        v.sprite.setScale(SCALE * (1 - lift * 0.04 + 0.03), SCALE * (1 + lift * 0.06 - 0.03));
        v.sprite.setRotation(Math.sin(v.stepPhase * 0.5) * 0.05);
      } else {
        // oddech i mrugnięcia
        const breath = motion ? Math.sin(time / 600 + v.speed * 10) * 0.015 : 0;
        const blink = time >= v.blinkAt && time < v.blinkAt + 140;
        if (time >= v.blinkAt + 140) v.blinkAt = time + Phaser.Math.Between(2200, 5200);
        const hop = time - v.hopAt < 320 ? Math.sin((Math.PI * (time - v.hopAt)) / 320) * 26 : 0;
        v.sprite.setFrame(villagerFrame(v.npc, blink ? 2 : 0));
        v.sprite.setPosition(p.x, p.y - hop);
        v.sprite.setScale(SCALE * (1 - breath * 0.5), SCALE * (1 + breath));
        v.sprite.setRotation(0);
      }
    }
  }

  /** Mieszkaniec pod punktem świata (dotknięcie). */
  hit(wx: number, wy: number): string | null {
    let best: View | null = null;
    for (const v of this.views) {
      if (v.home || v.sprite.alpha < 0.5) continue;
      if (v.sprite.getBounds().contains(wx, wy) && (!best || v.sprite.y > best.sprite.y)) best = v;
    }
    return best?.npc ?? null;
  }

  /** Reakcja na dotknięcie: radosny podskok i zatrzymanie na chwilę. */
  greet(npc: string, time: number): { x: number; y: number } | null {
    const v = this.views.find((x) => x.npc === npc);
    if (!v) return null;
    // zatrzymuje się na chwilę (trasę dokończy później) i podskakuje z radości
    v.waitUntil = Math.max(v.waitUntil, time + 4000);
    if (this.motion()) v.hopAt = time;
    return { x: v.x, y: v.y };
  }
}
