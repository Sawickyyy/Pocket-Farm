// Drzewa, miejsca zbieractwa, budynki i dekoracje na jednej SpriteGPULayer posortowanej po głębi izometrycznej.
// Osada: warianty wyglądu, rusztowania z rosnącą sylwetką, osmalenie, zgliszcza, migotanie pożaru (animacja w shaderze),
// ikonki awarii i chorych zwierząt. Bufor przebudowujemy tylko, gdy zmieni się tani podpis stanu.

import type Phaser from 'phaser';
import type { BuildingDef, Content } from '../../content/content';
import { animalHomeSick } from '../../sim/systems/settlement/events';
import type { Calendar, GameState, SiteState } from '../../sim/types';
import { MAP_H, MAP_W, VILLAGE_DECO, VILLAGE_HOUSES, chunkOfTile, tileIndex, type WorldMap } from '../../sim/world';
import { SPRITES_KEY, buildingFrame, houseDef, houseFrame, treeFrame } from '../art/atlas';
import { SITE_SIZES, frameFor, ruinFrame, siteFrame } from '../art/settlementArt';
import { boxPlacement, buildingFrameSize, buildingPlacement, isBox, project, siteVertical } from '../iso';

type Anim = Phaser.Types.GameObjects.SpriteGPULayer.MemberAnimation;

interface Item {
  x: number;
  y: number;
  frame: string;
  sortY: number;
  scale: number;
  originX: number;
  originY: number;
  /** Kolor mnożony (osmalenie) albo wypełnienie (sylwetka budowy). */
  tint?: number;
  tintBlend?: number | Anim;
  tintMode?: number;
  alphaTop?: number;
  alphaBottom?: number;
}

/** Prostokąt sprite'a budynku na ekranie-świecie – do trafiania dotykiem w dach/ściany, nie tylko w podstawę. */
export interface HitRect {
  uid: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  sortY: number;
}

/** Budynek z efektem ciągłym (ogień, dym) – emituje go scena, ograniczając liczbę cząsteczek. */
export interface ObjectFx {
  uid: number;
  /** Punkt emisji (px świata): nad dachem bryły albo nad zgliszczami. */
  x: number;
  y: number;
  /** Szerokość bryły – rozrzut płomieni. */
  width: number;
  burning: boolean;
  smoking: boolean;
}

const CAPACITY = 4200;
const TREE_H = 192;
/** Tryby koloru członków SpriteGPULayer (Phaser.TintModes). */
const TINT_MULTIPLY = 0;
const TINT_FILL = 1;

// ---------------------------------------------------------------- czyste helpery (testy: tests/sceneTown.test.ts)

export type LookMode = 'built' | 'site' | 'ruin';

/** Jak narysować obiekt osady w danym stanie budowy/uszkodzenia. */
export interface ObjectLook {
  mode: LookMode;
  /** Klatka bryły (w budowie – sylwetka rosnąca z postępem). */
  frame: string;
  /** Rusztowanie albo zgliszcza: klatka i jej obrys (kafle) z przesunięciem względem narożnika obiektu. */
  overlay: { frame: string; w: number; h: number; dx: number; dy: number } | null;
  /** Postęp budowy 0..1 (1 = gotowe). */
  progress: number;
  /** Osmalenie 0..1 (uszkodzenie poniżej progu zgliszcz). */
  scorch: number;
  burning: boolean;
  broken: boolean;
}

/** Najbliższy rozmiar rusztowania/zgliszcz z SITE_SIZES; przy remisie mniejszy (nie wystaje poza obrys). */
export function nearestSiteSize(w: number, h: number): [number, number] {
  let best: [number, number] = SITE_SIZES[0] ?? [1, 1];
  let bestD = Infinity;
  for (const [sw, sh] of SITE_SIZES) {
    const d = Math.abs(sw - w) + Math.abs(sh - h) + (sw > w || sh > h ? 0.5 : 0);
    if (d < bestD) {
      bestD = d;
      best = [sw, sh];
    }
  }
  return best;
}

/** Wybór klatek obiektu wg stanu placu budowy (`sites[uid]`) i wariantu wyglądu. */
export function objectLook(def: BuildingDef, style: number | undefined, site: SiteState | undefined): ObjectLook {
  const frame = frameFor(def, style);
  const look: ObjectLook = { mode: 'built', frame, overlay: null, progress: 1, scorch: 0, burning: false, broken: false };
  if (!site) return look;
  const [w, h] = def.size;
  const box = () => {
    const [sw, sh] = nearestSiteSize(w, h);
    return { w: sw, h: sh, dx: (w - sw) / 2, dy: (h - sh) / 2 };
  };
  look.burning = site.fire > 0;
  look.broken = site.broken;
  if (site.damage >= 0.5) {
    const b = box();
    look.mode = 'ruin';
    look.overlay = { frame: ruinFrame(b.w, b.h), ...b };
  } else if (site.built < 1) {
    const b = box();
    look.mode = 'site';
    look.progress = Math.max(0, site.built);
    look.overlay = { frame: siteFrame(b.w, b.h), ...b };
  } else if (site.damage > 0) {
    look.scorch = Math.min(1, site.damage / 0.5);
  }
  return look;
}

const mix = (a: number, b: number, t: number): number => {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/** Osmalenie: od lekkiego przyciemnienia do ciemnego, ciepłego brązu (kolor mnożony). */
export const scorchTint = (scorch: number): number => (scorch <= 0 ? 0xffffff : mix(0xffffff, 0x6e5644, 0.25 + 0.6 * Math.min(1, scorch)));
/** Ciepły blask płomieni na bryle (mnożony, migocze przez tintBlend). */
export const FIRE_TINT = 0xffa45c;
/** Kolor sylwetki budynku w budowie (wypełnienie). */
export const SILHOUETTE_TINT = 0xfff1d2;

/** Krycie sylwetki: dół wyraźniejszy, góra „dorasta” wraz z postępem. */
export function silhouetteAlpha(progress: number): { top: number; bottom: number } {
  const p = Math.max(0, Math.min(1, progress));
  return { top: 0.06 + 0.34 * p * p, bottom: 0.22 + 0.33 * p };
}

/** Tani podpis wyglądu obiektu (zmienia się tylko przy widocznej zmianie). */
export function lookSignature(look: ObjectLook): string {
  return `${look.mode}${look.frame}${Math.round(look.progress * 20)}${Math.round(look.scorch * 4)}${look.burning ? 'F' : ''}`;
}

// ---------------------------------------------------------------- warstwa

/** Zapasowe ikonki (gdy atlas nie ma jeszcze klatek modułu postaci). */
const BADGE_FALLBACK: Record<string, string> = { icon_wrench: 'town-badge-wrench', icon_sick: 'town-badge-sick' };

export class ObjectLayer {
  readonly layer: Phaser.GameObjects.SpriteGPULayer;
  private key = '';
  private badgeKey = '';
  private last: { state: GameState; cal: Calendar } | null = null;
  /** Budynki w trakcie animacji postawienia (rysowane osobnym obrazkiem). */
  private readonly popping = new Set<number>();
  hits: HitRect[] = [];
  /** Budynki z ogniem lub dymem (do emisji cząsteczek przez scenę). */
  effects: ObjectFx[] = [];
  /** Domy mieszkańców (stałe) – dotknięcie otwiera wioskę. */
  private readonly houseHits: (Omit<HitRect, 'uid'> & { npc: string })[] = [];
  private readonly badges = new Map<number, Phaser.GameObjects.Image>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: WorldMap,
    private readonly content: Content,
    private readonly motion: () => boolean = () => true,
  ) {
    this.layer = scene.add.spriteGPULayer(SPRITES_KEY, CAPACITY).setDepth(20).setLighting(true);
    this.layer.setAnimationEnabled('Sine.easeInOut', true);
  }

  private hasFrame(name: string): boolean {
    return this.scene.textures.get(SPRITES_KEY).has(name);
  }

  sync(state: GameState, cal: Calendar): void {
    this.last = { state, cal };
    this.syncBadges(state);
    const motion = this.motion();
    const forageKey = Object.entries(state.world.forage)
      .filter(([, d]) => d > cal.day)
      .map(([t]) => t)
      .join(',');
    const sites = state.settlement.sites;
    let objKey = '';
    for (const o of state.objects) {
      objKey += `${o.uid}:${o.type}:${o.x}:${o.y}:${o.style ?? ''}`;
      const site = sites[String(o.uid)];
      const def = site && this.content.buildings[o.type];
      if (def) objKey += lookSignature(objectLook(def, o.style, site));
      objKey += ';';
    }
    const key = `${[...this.popping].join(',')}|${cal.season}|${motion}|${state.world.revealed.length}|${forageKey}|${objKey}`;
    if (key === this.key) return;
    this.key = key;

    const items: Item[] = [];
    const revealed = new Set(state.world.revealed);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = tileIndex(x, y);
        const tree = this.world.trees[i];
        const c = project(x + 0.5, y + 0.5);
        if (tree) {
          items.push({ x: c.x, y: c.y, frame: treeFrame(tree === 1 ? 'oak' : 'pine', cal.season), sortY: c.y, scale: 1.35, originX: 0.5, originY: (TREE_H - 14) / TREE_H });
        } else if (this.world.forage[i] && revealed.has(chunkOfTile(x, y)) && (state.world.forage[String(i)] ?? -1) <= cal.day) {
          items.push({ x: c.x, y: c.y, frame: 'icon_forage', sortY: c.y, scale: 0.8, originX: 0.5, originY: 0.75 });
        }
      }
    }
    this.hits = [];
    this.effects = [];
    for (const o of state.objects) {
      const def = this.content.buildings[o.type];
      if (!def || def.kind === 'path' || def.kind === 'bridge') continue;
      const p = buildingPlacement(def, o.x, o.y);
      const site = sites[String(o.uid)];
      const look = objectLook(def, o.style, site);
      const size = buildingFrameSize(def);
      const x0 = p.x - size.w * p.originX * p.scale;
      const y0 = p.y - size.h * p.originY * p.scale;
      const rect = { uid: o.uid, x0, y0, x1: x0 + size.w * p.scale, y1: y0 + size.h * p.scale, sortY: p.sortY };
      this.hits.push(rect);
      if (look.burning || look.scorch > 0 || look.mode === 'ruin') {
        const c = project(o.x + def.size[0] / 2, o.y + def.size[1] / 2);
        const y = look.mode === 'built' ? rect.y0 + (c.y - rect.y0) * 0.45 : c.y - 50;
        this.effects.push({ uid: o.uid, x: c.x, y, width: rect.x1 - rect.x0, burning: look.burning, smoking: !look.burning });
      }
      if (this.popping.has(o.uid)) continue;
      this.pushLook(items, def, o.x, o.y, look, p, motion);
    }
    this.houseHits.length = 0;
    for (const hs of VILLAGE_HOUSES) {
      const npc = this.content.npc[hs.npc];
      if (!npc) continue;
      const def = houseDef(npc);
      const p = buildingPlacement(def, hs.x, hs.y);
      items.push({ x: p.x, y: p.y, frame: houseFrame(hs.npc), sortY: p.sortY, scale: p.scale, originX: p.originX, originY: p.originY });
      const size = buildingFrameSize(def);
      const x0 = p.x - size.w * p.originX * p.scale;
      const y0 = p.y - size.h * p.originY * p.scale;
      this.houseHits.push({ npc: hs.npc, x0, y0, x1: x0 + size.w * p.scale, y1: y0 + size.h * p.scale, sortY: p.sortY });
    }
    for (const d of VILLAGE_DECO) {
      const def = this.content.buildings[d.type];
      if (!def) continue;
      const p = buildingPlacement(def, d.x, d.y);
      items.push({ x: p.x, y: p.y, frame: buildingFrame(d.type), sortY: p.sortY, scale: p.scale, originX: p.originX, originY: p.originY });
    }
    // Sortowanie stabilne: przy równej głębi sylwetka budowy zostaje przed rusztowaniem.
    items.sort((a, b) => a.sortY - b.sortY);

    if (this.layer.memberCount) this.layer.removeMembers(0, this.layer.memberCount);
    const n = Math.min(items.length, CAPACITY);
    for (let k = 0; k < n; k++) {
      const it = items[k]!;
      if (it.tint === undefined && it.alphaTop === undefined) {
        this.layer.addMember({ x: it.x, y: it.y, frame: it.frame, originX: it.originX, originY: it.originY, scaleX: it.scale, scaleY: it.scale });
        continue;
      }
      const tint = it.tint ?? 0xffffff;
      const top = it.alphaTop ?? 1;
      const bottom = it.alphaBottom ?? 1;
      this.layer.addMember({
        x: it.x,
        y: it.y,
        frame: it.frame,
        originX: it.originX,
        originY: it.originY,
        scaleX: it.scale,
        scaleY: it.scale,
        tintTopLeft: tint,
        tintTopRight: tint,
        tintBottomLeft: tint,
        tintBottomRight: tint,
        tintBlend: it.tintBlend ?? 1,
        tintMode: it.tintMode ?? TINT_MULTIPLY,
        alphaTopLeft: top,
        alphaTopRight: top,
        alphaBottomLeft: bottom,
        alphaBottomRight: bottom,
      });
    }
  }

  /** Członkowie bufora dla jednego obiektu: bryła (lub sylwetka) i rusztowanie/zgliszcza. */
  private pushLook(items: Item[], def: BuildingDef, x: number, y: number, look: ObjectLook, p: ReturnType<typeof buildingPlacement>, motion: boolean): void {
    const base = { x: p.x, y: p.y, sortY: p.sortY, scale: p.scale, originX: p.originX, originY: p.originY };
    const flicker: number | Anim = motion ? { base: 0.25, amplitude: 0.55, duration: 240 + (x * 37 + y * 11) % 120, ease: 'Sine.easeInOut', yoyo: true } : 0.55;
    if (look.mode === 'built') {
      const frame = this.hasFrame(look.frame) ? look.frame : buildingFrame(def.id);
      if (look.burning) items.push({ ...base, frame, tint: mix(FIRE_TINT, scorchTint(look.scorch), 0.4), tintBlend: flicker });
      else if (look.scorch > 0) items.push({ ...base, frame, tint: scorchTint(look.scorch) });
      else items.push({ ...base, frame });
      return;
    }
    const ov = look.overlay;
    if (!ov) return;
    if (look.mode === 'site' && isBox(def) && this.hasFrame(look.frame)) {
      const a = silhouetteAlpha(look.progress);
      items.push({ ...base, frame: look.frame, tint: SILHOUETTE_TINT, tintMode: TINT_FILL, tintBlend: 1, alphaTop: a.top, alphaBottom: a.bottom });
    }
    const sp = boxPlacement(ov.w, ov.h, siteVertical(ov.w, ov.h), x + ov.dx, y + ov.dy);
    const it: Item = { x: sp.x, y: sp.y, frame: ov.frame, sortY: p.sortY, scale: 1, originX: sp.originX, originY: sp.originY };
    if (look.burning) {
      it.tint = FIRE_TINT;
      it.tintBlend = flicker;
    }
    items.push(it);
  }

  // ------------------------------------------------------------- ikonki nad budynkami

  /** Ikonki awarii (klucz) i chorych zwierząt – kilka zwykłych obrazków nad warstwą budynków. */
  private syncBadges(state: GameState): void {
    const wanted = new Map<number, string>();
    for (const o of state.objects) {
      const def = this.content.buildings[o.type];
      if (!def) continue;
      if (state.settlement.sites[String(o.uid)]?.broken) wanted.set(o.uid, 'icon_wrench');
      else if (def.kind === 'home' && animalHomeSick(state, o.uid)) wanted.set(o.uid, 'icon_sick');
    }
    let key = `${this.motion()}`;
    for (const [uid, icon] of wanted) {
      const o = state.objects.find((v) => v.uid === uid)!;
      key += `|${uid}:${icon}:${o.x}:${o.y}`;
    }
    if (key === this.badgeKey) return;
    this.badgeKey = key;
    for (const img of this.badges.values()) {
      this.scene.tweens.killTweensOf(img);
      img.destroy();
    }
    this.badges.clear();
    for (const [uid, icon] of wanted) {
      const o = state.objects.find((v) => v.uid === uid)!;
      const def = this.content.buildings[o.type]!;
      const at = badgeAnchor(def, o.x, o.y);
      const frame = this.badgeFrame(icon);
      // Ikonka atlasu 128×128: ogonek dymku kończy się na 3/4 wysokości klatki – tam jest punkt zaczepienia.
      const img = (frame.key === SPRITES_KEY ? this.scene.add.image(at.x, at.y, SPRITES_KEY, frame.frame) : this.scene.add.image(at.x, at.y, frame.key))
        .setOrigin(0.5, frame.key === SPRITES_KEY ? 0.75 : 1)
        .setScale(frame.key === SPRITES_KEY ? 1.05 : 1.2)
        .setDepth(27);
      if (this.motion()) this.scene.tweens.add({ targets: img, y: at.y - 18, duration: 900, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
      this.badges.set(uid, img);
    }
  }

  private badgeFrame(icon: string): { key: string; frame?: string } {
    if (this.hasFrame(icon)) return { key: SPRITES_KEY, frame: icon };
    const key = BADGE_FALLBACK[icon] ?? 'town-badge-wrench';
    if (!this.scene.textures.exists(key)) this.scene.textures.addCanvas(key, drawBadge(icon === 'icon_sick' ? 'sick' : 'wrench'));
    return { key };
  }

  // ------------------------------------------------------------- animacje

  /**
   * Postawienie budynku z „aktorstwem”: spada z lekkim rozciągnięciem, spłaszcza się przy uderzeniu
   * o ziemię i sprężyście wraca do kształtu (origin w podstawie, więc dół zostaje na miejscu).
   * W budowie spada rusztowanie, po ukończeniu – gotowa bryła.
   */
  bounce(uid: number, state: GameState): void {
    const o = state.objects.find((x) => x.uid === uid);
    const def = o && this.content.buildings[o.type];
    if (!o || !def || def.kind === 'path' || def.kind === 'bridge') return;
    const look = objectLook(def, o.style, state.settlement.sites[String(uid)]);
    let p: { x: number; y: number; originX: number; originY: number; scale: number } = buildingPlacement(def, o.x, o.y);
    let frame = this.hasFrame(look.frame) ? look.frame : buildingFrame(o.type);
    if (look.overlay) {
      const ov = look.overlay;
      p = boxPlacement(ov.w, ov.h, siteVertical(ov.w, ov.h), o.x + ov.dx, o.y + ov.dy);
      frame = ov.frame;
    }
    const sc = p.scale;
    this.popping.add(uid);
    if (this.last) this.sync(this.last.state, this.last.cal);
    const img = this.scene.add
      .image(p.x, p.y - 140, SPRITES_KEY, frame)
      .setOrigin(p.originX, p.originY)
      .setScale(sc * 0.9, sc * 1.12)
      .setAlpha(0.6)
      .setDepth(21)
      .setLighting(true);
    this.scene.tweens.chain({
      targets: img,
      tweens: [
        { y: p.y, alpha: 1, duration: 230, ease: 'Quad.easeIn' },
        { scaleX: sc * 1.14, scaleY: sc * 0.84, duration: 90, ease: 'Quad.easeOut' },
        { scaleX: sc * 0.96, scaleY: sc * 1.05, duration: 130, ease: 'Quad.easeInOut' },
        { scaleX: sc, scaleY: sc, duration: 200, ease: 'Back.easeOut' },
      ],
      onComplete: () => {
        img.destroy();
        this.popping.delete(uid);
        if (this.last) this.sync(this.last.state, this.last.cal);
      },
    });
  }

  // ------------------------------------------------------------- trafienia

  /** Dom mieszkańca pod punktem. */
  houseAt(wx: number, wy: number): string | null {
    let best: (typeof this.houseHits)[number] | null = null;
    for (const r of this.houseHits) {
      if (wx >= r.x0 && wx <= r.x1 && wy >= r.y0 && wy <= r.y1 && (!best || r.sortY > best.sortY)) best = r;
    }
    return best?.npc ?? null;
  }

  /** Budynek pod punktem (najbliższy widza, czyli o największej głębi) – trafia w całą bryłę, także w budowie. */
  hit(wx: number, wy: number): number | null {
    let best: HitRect | null = null;
    for (const r of this.hits) {
      if (wx >= r.x0 && wx <= r.x1 && wy >= r.y0 && wy <= r.y1 && (!best || r.sortY > best.sortY)) best = r;
    }
    return best?.uid ?? null;
  }

  /** Prostokąt bryły budynku (px świata) albo null. */
  rectOf(uid: number): HitRect | null {
    return this.hits.find((r) => r.uid === uid) ?? null;
  }
}

/** Punkt nad dachem budynku (px świata) – miejsce ikonki. */
export function badgeAnchor(def: BuildingDef, x: number, y: number): { x: number; y: number } {
  const p = buildingPlacement(def, x, y);
  const size = buildingFrameSize(def);
  const top = p.y - size.h * p.originY * p.scale;
  const c = project(x + def.size[0] / 2, y + def.size[1] / 2);
  // Klatka ma nad dachem margines (ISO_PAD) – ikonka „siada” tuż nad kalenicą.
  return { x: c.x, y: top + 24 };
}

/** Prosta ikonka w dymku (zastępstwo do czasu narysowania ikon przez moduł postaci). */
function drawBadge(kind: 'wrench' | 'sick'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 84;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  // dymek z ogonkiem
  ctx.fillStyle = '#fff8ea';
  ctx.strokeStyle = '#6b4428';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(42, 40, 34, 0, Math.PI * 2);
  ctx.moveTo(32, 70);
  ctx.lineTo(42, 92);
  ctx.lineTo(52, 70);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff8ea';
  ctx.beginPath();
  ctx.arc(42, 40, 31, 0, Math.PI * 2);
  ctx.fill();
  if (kind === 'wrench') {
    ctx.save();
    ctx.translate(42, 40);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = '#8a97a3';
    ctx.strokeStyle = '#3d4650';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(-5, -6, 10, 30, 4);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -12, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff8ea';
    ctx.fillRect(-4, -26, 8, 14);
    ctx.restore();
  } else {
    ctx.fillStyle = '#3fbf6a';
    ctx.strokeStyle = '#1f6a3a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(35, 20, 14, 40, 3);
    ctx.roundRect(22, 33, 40, 14, 3);
    ctx.fill();
    ctx.stroke();
  }
  return c;
}
