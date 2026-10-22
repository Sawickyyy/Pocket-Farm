// Postacie osady (docs/plan-osada.md §15): mieszkańcy wg zawodu i wyglądu, dzieci, wóz karawany,
// cząsteczki ognia i ikonki sceny (awaria, chore zwierzęta). Styl jak mieszkańcy wioski (villager.ts):
// chibi z dużą głową, okrągłe oczy z blikami, rumieńce – ale mniejsi i ze strojem czytelnym z daleka.
// Nazwy klatek są kontraktem z warstwami ResidentLayer/CaravanLayer i sceną.

import { PROFESSIONS, type Content } from '../../content/content';
import type { Entry } from './atlas';
import { ellipse, rrect, shade, star, type Ctx2D } from './draw';
import { STYLE_NONE } from './palette';

/** Liczba wariantów wyglądu w atlasie (look mieszkańca % LOOKS). */
export const LOOKS = 4;
/** Mieszkaniec: `res_<zawód|idle>_<look>_<klatka 0|1>`; dziecko: `res_child_<look>_<klatka>`. */
export const residentFrame = (prof: string | null, look: number, f: number): string => `res_${prof ?? 'idle'}_${look % LOOKS}_${f}`;
export const childFrame = (look: number, f: number): string => `res_child_${look % LOOKS}_${f}`;
/** Wóz karawany (klatki kół 0|1). */
export const caravanFrame = (f: number): string => `caravan_${f}`;

/**
 * Klatka mieszkańca (także dziecka): rozmiar w px, punkt stóp jako ułamek wysokości (originX = 0,5)
 * i zalecana skala sprite'a w świecie (postać ≈ 75% wysokości mieszkańca wioski).
 */
export const RESIDENT_FRAME = { w: 72, h: 104, originY: 0.93, scale: 0.78 } as const;
/** Dziecko ma tę samą klatkę co dorosły; warstwa skaluje je dodatkowo o CHILD_SCALE. */
export const CHILD_SCALE = 0.72;
/** Wóz z koniem jadący w prawo-dół (oś +x kafli); originY = środek podstawy zaprzęgu (originX = 0,5). */
export const CARAVAN_FRAME = { w: 224, h: 184, originY: 0.75, scale: 1.15 } as const;

/** Zawody w atlasie + 'idle' (bez pracy). */
export const RESIDENT_KINDS: readonly string[] = [...PROFESSIONS, 'idle'];
export const CHARACTER_PARTICLES = ['p_fire', 'p_ember'] as const;
export const SCENE_ICONS = ['icon_wrench', 'icon_sick'] as const;

// ------------------------------------------------------------------ wygląd

type HairStyle = 'short' | 'bun' | 'curly' | 'braids';

interface Look {
  skin: string;
  hair: string;
  style: HairStyle;
  /** Zwykłe ubranie (bez pracy) i ubranko dziecka. */
  shirt: string;
  pants: string;
  kid: string;
  freckles: boolean;
}

const LOOK: readonly Look[] = [
  { skin: '#ffdcc2', hair: '#f2c46a', style: 'short', shirt: '#5cb8f0', pants: '#4a5a6a', kid: '#ffc53d', freckles: false },
  { skin: '#efbb92', hair: '#6a4226', style: 'bun', shirt: '#f0704f', pants: '#6a4a3a', kid: '#5cb8f0', freckles: false },
  { skin: '#b5754e', hair: '#2e221a', style: 'curly', shirt: '#f2b632', pants: '#3f5f7a', kid: '#f2667a', freckles: false },
  { skin: '#ffe3cf', hair: '#d0682e', style: 'braids', shirt: '#5fb57a', pants: '#7a5a3a', kid: '#7cc95a', freckles: true },
];

const lookOf = (look: number): Look => LOOK[((look % LOOKS) + LOOKS) % LOOKS]!;

interface Outfit {
  shirt: string;
  sleeve: string;
  pants: string;
  shoes: string;
}

const SHOES = '#4a2e1a';

function outfitOf(prof: string, look: Look): Outfit {
  switch (prof) {
    case 'farmer':
      return { shirt: '#f6e7c4', sleeve: '#f6e7c4', pants: '#4f86c6', shoes: SHOES };
    case 'baker':
      return { shirt: '#a8d4f0', sleeve: '#a8d4f0', pants: '#6a5a4a', shoes: SHOES };
    case 'lumberjack':
      return { shirt: '#d8402e', sleeve: '#d8402e', pants: '#4a6a8a', shoes: '#5a3a1e' };
    case 'fisher':
      return { shirt: '#ffcc33', sleeve: '#ffcc33', pants: '#4a5a6a', shoes: '#3f6a4a' };
    case 'merchant':
      return { shirt: '#fffaf0', sleeve: '#fffaf0', pants: '#6a4a3a', shoes: SHOES };
    case 'builder':
      return { shirt: '#6a9fd0', sleeve: '#6a9fd0', pants: '#4a5a6a', shoes: '#5a3a1e' };
    case 'craftsman':
      return { shirt: '#eadcbc', sleeve: '#eadcbc', pants: '#5a4a3a', shoes: SHOES };
    case 'teacher':
      return { shirt: '#3f9aa0', sleeve: '#3f9aa0', pants: '#4a5a6a', shoes: SHOES };
    case 'medic':
      return { shirt: '#fbf8f0', sleeve: '#fbf8f0', pants: '#8fc4e6', shoes: '#f2ece0' };
    case 'firefighter':
      return { shirt: '#34506e', sleeve: '#34506e', pants: '#34506e', shoes: '#2a2018' };
    case 'guard':
      return { shirt: '#3a6a9a', sleeve: '#3a6a9a', pants: '#2f4a6a', shoes: '#2a2018' };
    default:
      return { shirt: look.shirt, sleeve: look.shirt, pants: look.pants, shoes: SHOES };
  }
}

// ------------------------------------------------------------------ głowa (lokalnie: środek 0,0, promień 17×16)

const HEAD_RX = 17;
const HEAD_RY = 16;

function eyes(ctx: Ctx2D): void {
  for (const dx of [-6.5, 6.5]) {
    ellipse(ctx, dx, 3, 3.3, 4.3, '#2a1a10');
    ellipse(ctx, dx - 1.1, 1.3, 1.4, 1.6, '#ffffff');
    ellipse(ctx, dx + 1, 4.6, 0.7, 0.7, '#ffffff');
  }
}

function faceDetails(ctx: Ctx2D, look: Look): void {
  eyes(ctx);
  ellipse(ctx, -11.5, 9, 3.4, 2, 'rgba(255,120,140,0.55)');
  ellipse(ctx, 11.5, 9, 3.4, 2, 'rgba(255,120,140,0.55)');
  if (look.freckles) for (const [x, y] of [[-12, 6], [-9.5, 7.5], [9.5, 7.5], [12, 6]] as const) ellipse(ctx, x, y, 0.8, 0.8, 'rgba(170,90,50,0.7)');
  ctx.strokeStyle = '#8a3a3a';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 8, 3, 0.25, Math.PI - 0.25);
  ctx.stroke();
}

/** Włosy z tyłu głowy (kok, loki, warkocze) – pod głową. */
function hairBack(ctx: Ctx2D, look: Look, child: boolean): void {
  const hc = look.hair;
  switch (look.style) {
    case 'bun':
      if (child) ellipse(ctx, 0, -17, 7, 6.5, hc);
      else ellipse(ctx, 10, -15, 7.5, 7, hc);
      ellipse(ctx, child ? -2 : 8, child ? -19 : -17, 2.6, 1.6, shade(hc, 0.3), -0.4);
      break;
    case 'curly':
      for (let i = 0; i <= 6; i++) {
        const a = Math.PI + (i / 6) * Math.PI;
        ellipse(ctx, Math.cos(a) * 17, -2 + Math.sin(a) * 14, 6.5, 6.5, hc);
      }
      ellipse(ctx, -18, 4, 5, 5.5, hc);
      ellipse(ctx, 18, 4, 5, 5.5, hc);
      break;
    case 'braids':
      for (const s of [-1, 1]) {
        if (child) {
          // kucyki odstające na boki
          ellipse(ctx, s * 20, 0, 6, 8, hc, s * 0.5);
          ellipse(ctx, s * 15.5, -5, 2.6, 2.2, '#5fb544');
        } else {
          for (let k = 0; k < 3; k++) ellipse(ctx, s * (14.5 + k * 0.6), 5 + k * 6.5, 4.4, 4.2, k % 2 ? shade(hc, -0.08) : hc);
          ellipse(ctx, s * 16, 24, 2.8, 2.2, '#5fb544');
          ellipse(ctx, s * 16, 27.5, 2.2, 2.6, hc);
        }
      }
      break;
    case 'short':
      break;
  }
}

/** Grzywka i wierzch fryzury – nad głową. */
function hairFront(ctx: Ctx2D, look: Look): void {
  const hc = look.hair;
  ctx.fillStyle = hc;
  switch (look.style) {
    case 'short':
      ctx.beginPath();
      ctx.ellipse(0, -4, 18, 14.5, 0, Math.PI, 0);
      ctx.quadraticCurveTo(13, -5, 8, -9);
      ctx.quadraticCurveTo(4, -3, -1, -8);
      ctx.quadraticCurveTo(-6, -2, -10, -7);
      ctx.quadraticCurveTo(-14, -2, -18, -4);
      ctx.closePath();
      ctx.fill();
      // sterczący kosmyk
      ctx.beginPath();
      ctx.moveTo(-2, -17);
      ctx.quadraticCurveTo(2, -25, 7, -23);
      ctx.quadraticCurveTo(4, -21, 4, -16);
      ctx.closePath();
      ctx.fill();
      ellipse(ctx, -7, -12, 5, 2.2, shade(hc, 0.3), -0.3);
      break;
    case 'curly':
      ctx.beginPath();
      ctx.ellipse(0, -5, 18, 13.5, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      for (const [x, y, r] of [[-13, -6, 5.5], [-5, -9, 6], [4, -9, 6], [12.5, -6, 5.5]] as const) ellipse(ctx, x, y, r, r, hc);
      for (const [x, y] of [[-8, -15], [3, -16], [11, -12]] as const) ellipse(ctx, x, y, 2.4, 1.5, shade(hc, 0.28), -0.4);
      break;
    case 'bun':
    case 'braids':
      // przedziałek na środku, grzywka zaczesana na boki i pasma przy policzkach
      ctx.beginPath();
      ctx.ellipse(0, -4, 18, 14.5, 0, Math.PI, 0);
      ctx.quadraticCurveTo(16, 4, 15, 6);
      ctx.quadraticCurveTo(12, -4, 1, -10);
      ctx.quadraticCurveTo(-12, -4, -15, 6);
      ctx.quadraticCurveTo(-16, 4, -18, -4);
      ctx.closePath();
      ctx.fill();
      ellipse(ctx, -8, -12, 5, 2.2, shade(hc, 0.3), -0.35);
      break;
  }
}

function hat(ctx: Ctx2D, prof: string): void {
  switch (prof) {
    case 'farmer': {
      // słomkowy kapelusz z czerwoną wstążką
      ellipse(ctx, 0, -9, 26, 6.5, '#e2b955');
      ellipse(ctx, 0, -10, 24.5, 5.2, '#f2d27a');
      rrect(ctx, -12.5, -25, 25, 16, 8, '#f4d67a');
      rrect(ctx, -12.5, -14, 25, 4, 2, '#d0503a');
      ctx.strokeStyle = 'rgba(160,110,40,0.45)';
      ctx.lineWidth = 1;
      for (const x of [-7, -1, 5]) {
        ctx.beginPath();
        ctx.moveTo(x, -23);
        ctx.lineTo(x + 1, -15);
        ctx.stroke();
      }
      ellipse(ctx, -6, -21, 4, 1.8, 'rgba(255,250,220,0.75)', -0.2);
      break;
    }
    case 'baker':
      // biały czepek-toczek z bufkami
      ellipse(ctx, -7, -20, 8, 7.5, '#fffdf8');
      ellipse(ctx, 7, -20, 8, 7.5, '#fffdf8');
      ellipse(ctx, 0, -25, 9, 8, '#ffffff');
      rrect(ctx, -13, -16, 26, 7.5, 3.5, '#ffffff');
      ctx.strokeStyle = '#e2d8c6';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-4, -16);
      ctx.quadraticCurveTo(-5, -21, -2, -25);
      ctx.moveTo(5, -16);
      ctx.quadraticCurveTo(6, -21, 3, -25);
      ctx.stroke();
      break;
    case 'lumberjack':
      // musztardowa czapka z pomponem
      ctx.beginPath();
      ctx.ellipse(0, -7, 18, 15.5, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = '#e0a030';
      ctx.fill();
      rrect(ctx, -18.5, -10, 37, 6.5, 3.2, '#c8862a');
      ctx.strokeStyle = 'rgba(140,80,20,0.4)';
      ctx.lineWidth = 1;
      for (const x of [-10, -4, 2, 8]) {
        ctx.beginPath();
        ctx.moveTo(x, -9);
        ctx.lineTo(x + 2, -4);
        ctx.stroke();
      }
      ellipse(ctx, 0, -23, 5.5, 5, '#f6ecd2');
      ellipse(ctx, -6, -16, 4, 2, 'rgba(255,240,200,0.6)', -0.3);
      break;
    case 'fisher':
      // żółty sztormiak z szerokim rondem
      ellipse(ctx, 0, -6, 24, 7, '#e8b326');
      ctx.beginPath();
      ctx.ellipse(0, -7, 18, 15, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = '#ffcf3a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(170,110,10,0.45)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -22);
      ctx.lineTo(0, -8);
      ctx.stroke();
      ellipse(ctx, -7, -15, 4.5, 2.2, 'rgba(255,252,220,0.75)', -0.3);
      break;
    case 'builder':
      // pomarańczowy kask
      rrect(ctx, -21, -10, 42, 5.5, 2.7, '#e87d18');
      ctx.beginPath();
      ctx.ellipse(0, -8.5, 18, 15, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = '#ff9d33';
      ctx.fill();
      rrect(ctx, -2.6, -23, 5.2, 14, 2.6, '#ffbb6a');
      ellipse(ctx, -8, -16, 4, 2.2, 'rgba(255,248,225,0.8)', -0.4);
      break;
    case 'craftsman':
      // opaska na czoło zawiązana z boku
      rrect(ctx, -18, -10.5, 36, 5.5, 2.7, '#3f8fcf');
      ellipse(ctx, 18, -9, 3, 2.6, '#3f8fcf');
      ellipse(ctx, 21, -5, 2, 4, '#3480c0', 0.5);
      ellipse(ctx, 22.5, -9, 2, 3.6, '#3480c0', -0.8);
      break;
    case 'firefighter':
      // czerwony hełm z grzebieniem i złotą odznaką
      ellipse(ctx, 2, -6, 23, 6.5, '#c0342a');
      ctx.beginPath();
      ctx.ellipse(0, -8, 18, 15.5, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = '#e8463a';
      ctx.fill();
      rrect(ctx, -2.6, -24, 5.2, 15, 2.6, '#f26a5a');
      ctx.beginPath();
      ctx.moveTo(-5, -17);
      ctx.lineTo(5, -17);
      ctx.lineTo(5, -12);
      ctx.quadraticCurveTo(0, -7, -5, -12);
      ctx.closePath();
      ctx.fillStyle = '#ffc53d';
      ctx.fill();
      ellipse(ctx, -9, -15, 3.5, 2, 'rgba(255,240,230,0.7)', -0.4);
      break;
    case 'guard':
      // niebieska czapka z daszkiem i odznaką-gwiazdką
      ctx.beginPath();
      ctx.moveTo(-15.5, -8);
      ctx.lineTo(-19, -20);
      ctx.quadraticCurveTo(0, -27, 19, -20);
      ctx.lineTo(15.5, -8);
      ctx.closePath();
      ctx.fillStyle = '#2f5f94';
      ctx.fill();
      rrect(ctx, -16, -12, 32, 5, 2.5, '#1f3f66');
      ellipse(ctx, 0, -7, 14, 4, '#1a3352');
      star(ctx, 0, -17, 4.8, 2.1, '#ffc53d');
      break;
  }
}

function glasses(ctx: Ctx2D): void {
  ctx.strokeStyle = '#3a2412';
  ctx.lineWidth = 1.5;
  for (const dx of [-6.5, 6.5]) {
    ctx.beginPath();
    ctx.arc(dx, 3, 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-1.5, 2.5);
  ctx.quadraticCurveTo(0, 1.2, 1.5, 2.5);
  ctx.stroke();
  ellipse(ctx, -8.5, 0.5, 1.6, 1, 'rgba(255,255,255,0.7)', -0.5);
  ellipse(ctx, 4.5, 0.5, 1.6, 1, 'rgba(255,255,255,0.7)', -0.5);
}

/** Głowa w układzie lokalnym (scale = promień/17). Dzieci bez nakrycia głowy. */
function head(ctx: Ctx2D, look: Look, prof: string | null, cx: number, hy: number, scale: number): void {
  ctx.save();
  ctx.translate(cx, hy);
  ctx.scale(scale, scale);
  hairBack(ctx, look, prof === null);
  ellipse(ctx, 0, 0, HEAD_RX, HEAD_RY, look.skin);
  hairFront(ctx, look);
  faceDetails(ctx, look);
  if (prof === 'teacher') glasses(ctx);
  if (prof) hat(ctx, prof);
  ctx.restore();
}

// ------------------------------------------------------------------ tułów i rekwizyty

function torsoPath(ctx: Ctx2D, cx: number, top: number, bottom: number, wt: number, wb: number): void {
  ctx.beginPath();
  ctx.moveTo(cx - wt, top);
  ctx.quadraticCurveTo(cx - wb - 4, bottom, cx - wb, bottom);
  ctx.lineTo(cx + wb, bottom);
  ctx.quadraticCurveTo(cx + wb + 4, bottom, cx + wt, top);
  ctx.closePath();
}

/** Nakładki stroju na tułów (wywoływane z przycięciem do sylwetki tułowia). */
function torsoOverlay(ctx: Ctx2D, prof: string, cx: number, top: number, bottom: number): void {
  const h = bottom - top;
  switch (prof) {
    case 'farmer': {
      // ogrodniczki: śliniak, szelki i złote guziki
      const denim = '#4f86c6';
      rrect(ctx, cx - 8, top + 8, 16, h, 3, denim);
      ctx.fillStyle = denim;
      ctx.fillRect(cx - 20, bottom - 8, 40, 10);
      ctx.strokeStyle = denim;
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(cx - 7, top + 10);
      ctx.lineTo(cx - 10, top);
      ctx.moveTo(cx + 7, top + 10);
      ctx.lineTo(cx + 10, top);
      ctx.stroke();
      rrect(ctx, cx - 4.5, top + 12, 9, 6, 2, shade(denim, -0.15));
      ellipse(ctx, cx - 6, top + 10, 1.8, 1.8, '#ffc53d');
      ellipse(ctx, cx + 6, top + 10, 1.8, 1.8, '#ffc53d');
      break;
    }
    case 'baker':
      // biały fartuch z oprószoną mąką
      rrect(ctx, cx - 11, top + 5, 22, h, 5, '#ffffff');
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(cx - 8, top + 6);
      ctx.quadraticCurveTo(cx, top - 4, cx + 8, top + 6);
      ctx.stroke();
      rrect(ctx, cx - 14, top + 13, 28, 3, 1.5, '#e9e1d2');
      for (const [x, y] of [[-5, 19], [3, 22], [6, 17]] as const) ellipse(ctx, cx + x, top + y, 1.6, 1.2, '#efe7d8');
      break;
    case 'lumberjack': {
      // koszula w kratę
      ctx.fillStyle = 'rgba(110,24,16,0.55)';
      for (let x = cx - 18; x < cx + 20; x += 8) ctx.fillRect(x, top, 3.2, h);
      for (let y = top + 3; y < bottom; y += 8) ctx.fillRect(cx - 20, y, 40, 3.2);
      ctx.fillStyle = 'rgba(255,220,200,0.25)';
      for (let x = cx - 14; x < cx + 20; x += 8) ctx.fillRect(x, top, 1, h);
      rrect(ctx, cx - 1, top + 2, 2, h - 4, 1, 'rgba(60,20,10,0.35)');
      break;
    }
    case 'fisher':
      // sztormiak: kołnierz, kołki i odblask
      rrect(ctx, cx - 1.4, top + 2, 2.8, h - 2, 1.4, '#e0a820');
      for (const y of [8, 15, 22]) rrect(ctx, cx - 4, top + y, 8, 2.6, 1.3, '#8a5a2e');
      ellipse(ctx, cx - 9, top + 9, 3, 6, 'rgba(255,255,230,0.5)', 0.3);
      break;
    case 'merchant':
      // zielona kamizelka z guzikami
      ctx.fillStyle = '#3f9a5a';
      ctx.beginPath();
      ctx.moveTo(cx - 12, top - 1);
      ctx.lineTo(cx - 2, top + 14);
      ctx.lineTo(cx - 2, bottom + 2);
      ctx.lineTo(cx - 22, bottom + 2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 12, top - 1);
      ctx.lineTo(cx + 2, top + 14);
      ctx.lineTo(cx + 2, bottom + 2);
      ctx.lineTo(cx + 22, bottom + 2);
      ctx.closePath();
      ctx.fill();
      for (const y of [17, 23]) {
        ellipse(ctx, cx - 4.5, top + y, 1.6, 1.6, '#ffc53d');
        ellipse(ctx, cx + 4.5, top + y, 1.6, 1.6, '#ffc53d');
      }
      break;
    case 'builder':
      // pas na narzędzia
      rrect(ctx, cx - 20, bottom - 8, 40, 4.5, 2, '#8a5a2e');
      rrect(ctx, cx + 5, bottom - 6, 7, 7, 2, '#a86a34');
      rrect(ctx, cx - 12, bottom - 6, 6, 6, 2, '#a86a34');
      ellipse(ctx, cx, bottom - 5.8, 2, 1.8, '#c5ced8');
      break;
    case 'craftsman':
      // skórzany fartuch z kieszenią i ołówkiem
      rrect(ctx, cx - 11, top + 4, 22, h + 2, 4, '#9a6236');
      ctx.strokeStyle = '#9a6236';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(cx - 8, top + 5);
      ctx.lineTo(cx - 10, top);
      ctx.moveTo(cx + 8, top + 5);
      ctx.lineTo(cx + 10, top);
      ctx.stroke();
      rrect(ctx, cx - 6, top + 13, 12, 7, 2, '#7e4c28');
      rrect(ctx, cx + 1, top + 8, 2.2, 8, 1, '#f2c232');
      ctx.strokeStyle = 'rgba(255,220,170,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 9, top + 6, 18, h - 4);
      break;
    case 'teacher':
      // sweterek z białym kołnierzykiem
      ctx.fillStyle = '#fffaf0';
      ctx.beginPath();
      ctx.moveTo(cx - 8, top);
      ctx.lineTo(cx, top + 6);
      ctx.lineTo(cx + 8, top);
      ctx.lineTo(cx + 5, top + 5);
      ctx.lineTo(cx, top + 8);
      ctx.lineTo(cx - 5, top + 5);
      ctx.closePath();
      ctx.fill();
      rrect(ctx, cx - 0.8, top + 8, 1.6, h - 8, 0.8, 'rgba(20,70,70,0.45)');
      for (const y of [12, 18, 24]) ellipse(ctx, cx + 3, top + y, 1.3, 1.3, '#f2e3c6');
      break;
    case 'medic':
      // kitel: niebieska koszula w dekolcie, zielony krzyż i stetoskop
      ctx.fillStyle = '#8fc4e6';
      ctx.beginPath();
      ctx.moveTo(cx - 6, top);
      ctx.lineTo(cx, top + 10);
      ctx.lineTo(cx + 6, top);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#d8d0c0';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - 6, top);
      ctx.lineTo(cx, top + 10);
      ctx.lineTo(cx, bottom);
      ctx.moveTo(cx + 6, top);
      ctx.lineTo(cx, top + 10);
      ctx.stroke();
      rrect(ctx, cx + 4.5, top + 9, 3.6, 10, 1, '#2fa65a');
      rrect(ctx, cx + 1.8, top + 11.8, 9, 3.6, 1, '#2fa65a');
      ctx.strokeStyle = '#5a6672';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx - 8, top);
      ctx.quadraticCurveTo(cx - 9, top + 12, cx - 4, top + 16);
      ctx.stroke();
      ellipse(ctx, cx - 4, top + 17, 2.4, 2.4, '#a9b4be');
      break;
    case 'firefighter':
      // pasy odblaskowe
      rrect(ctx, cx - 20, top + 10, 40, 3.4, 1.7, '#ffd23a');
      rrect(ctx, cx - 20, bottom - 8, 40, 3.4, 1.7, '#ffd23a');
      rrect(ctx, cx - 1.2, top + 2, 2.4, h - 2, 1.2, 'rgba(10,20,30,0.4)');
      break;
    case 'guard':
      // pas, złote guziki i odznaka na piersi
      rrect(ctx, cx - 20, bottom - 9, 40, 4, 2, '#2a1e14');
      rrect(ctx, cx - 2.5, bottom - 9.5, 5, 5, 1.2, '#ffc53d');
      for (const y of [7, 13, 19]) ellipse(ctx, cx, top + y, 1.4, 1.4, '#ffc53d');
      star(ctx, cx - 7, top + 9, 3.6, 1.6, '#ffc53d');
      break;
    default:
      // zwykła koszulka z kołnierzykiem
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.moveTo(cx - 7, top);
      ctx.lineTo(cx, top + 6);
      ctx.lineTo(cx + 7, top);
      ctx.closePath();
      ctx.fill();
      break;
  }
}

function handle(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, w: number, col: string): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = col;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,240,210,0.45)';
  ctx.lineWidth = w * 0.3;
  ctx.beginPath();
  ctx.moveTo(x0 - w * 0.2, y0);
  ctx.lineTo(x1 - w * 0.2, y1);
  ctx.stroke();
  ctx.restore();
}

/** Narzędzie w prawej dłoni (rysowane pod dłonią). */
function rightTool(ctx: Ctx2D, prof: string, hx: number, hy: number): void {
  switch (prof) {
    case 'lumberjack':
      handle(ctx, hx - 1, hy + 6, hx + 3, hy - 17, 3.4, '#a86a34');
      ctx.beginPath();
      ctx.moveTo(hx + 2, hy - 21);
      ctx.quadraticCurveTo(hx + 9, hy - 25, hx + 13, hy - 23);
      ctx.quadraticCurveTo(hx + 15, hy - 16, hx + 12, hy - 10);
      ctx.quadraticCurveTo(hx + 7, hy - 12, hx + 3, hy - 13);
      ctx.closePath();
      ctx.fillStyle = '#b9c4ce';
      ctx.fill();
      ctx.strokeStyle = '#eef3f7';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(hx + 13, hy - 22);
      ctx.quadraticCurveTo(hx + 14.5, hy - 16, hx + 12, hy - 11);
      ctx.stroke();
      break;
    case 'fisher':
      handle(ctx, hx - 2, hy + 5, hx + 12, hy - 54, 2.6, '#c98a4a');
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx + 12, hy - 54);
      ctx.quadraticCurveTo(hx + 16, hy - 40, hx + 14, hy - 30);
      ctx.stroke();
      ellipse(ctx, hx + 14, hy - 28, 3, 3, '#f0704f');
      rrect(ctx, hx + 11, hy - 28, 6, 2.2, 1, '#fff6e4');
      ellipse(ctx, hx + 1, hy - 1, 3.2, 3.2, '#8a9aa8');
      break;
    case 'builder':
      handle(ctx, hx, hy + 6, hx + 3, hy - 13, 3.4, '#b0743f');
      rrect(ctx, hx - 4, hy - 19, 15, 7, 2.5, '#8f9aa6');
      rrect(ctx, hx - 3, hy - 18.5, 12, 2.5, 1.2, '#d5dde5');
      break;
  }
}

/** Rekwizyt w lewej dłoni (rysowany pod dłonią). */
function leftProp(ctx: Ctx2D, prof: string, hx: number, hy: number): void {
  switch (prof) {
    case 'teacher':
      rrect(ctx, hx - 6, hy - 12, 11, 15, 2, '#d84a3a');
      rrect(ctx, hx + 3, hy - 11, 2.4, 13, 1, '#fff6e4');
      rrect(ctx, hx - 4, hy - 9, 6, 2, 1, '#ffc53d');
      break;
    case 'baker':
      ellipse(ctx, hx - 1, hy - 4, 8, 5, '#d9902e', -0.5);
      ellipse(ctx, hx - 3, hy - 6, 4, 2, 'rgba(255,230,170,0.7)', -0.5);
      ctx.strokeStyle = '#a8641c';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const t of [-4, 0, 4]) {
        ctx.moveTo(hx - 1 + t - 1.5, hy - 4 + t * 0.5 - 1.5);
        ctx.lineTo(hx - 1 + t + 1.5, hy - 4 + t * 0.5 + 0.5);
      }
      ctx.stroke();
      break;
  }
}

// ------------------------------------------------------------------ mieszkaniec dorosły

/** Dorosły mieszkaniec w klatce 72×104 (stopy w RESIDENT_FRAME.originY). Klatka 0/1 = fazy kroku. */
export function drawResident(ctx: Ctx2D, prof: string, lookIdx: number, f: number, ox = 0, oy = 0): void {
  const look = lookOf(lookIdx);
  const o = outfitOf(prof, look);
  const cx = ox + RESIDENT_FRAME.w / 2;
  const gy = oy + RESIDENT_FRAME.h * RESIDENT_FRAME.originY;
  const step = f === 1 ? 3 : -3;
  const bob = f === 1 ? -1.5 : 0;
  const top = gy - 47 + bob;
  const bottom = gy - 19 + bob;

  ellipse(ctx, cx, gy, 17, 4.5, 'rgba(50,35,20,0.25)');
  // nogi i buciki (rybak w gumowcach)
  const legTop = gy - 22;
  rrect(ctx, cx - 8.5 + step * 0.8, legTop, 7.5, 20, 3.5, o.pants);
  rrect(ctx, cx + 1 - step * 0.8, legTop, 7.5, 20, 3.5, o.pants);
  if (prof === 'fisher') {
    rrect(ctx, cx - 9 + step * 0.8, gy - 11, 8.5, 9, 3, o.shoes);
    rrect(ctx, cx + 0.5 - step * 0.8, gy - 11, 8.5, 9, 3, o.shoes);
  }
  if (prof === 'firefighter') {
    rrect(ctx, cx - 8.5 + step * 0.8, gy - 9, 7.5, 2.6, 1.3, '#ffd23a');
    rrect(ctx, cx + 1 - step * 0.8, gy - 9, 7.5, 2.6, 1.3, '#ffd23a');
  }
  ellipse(ctx, cx - 5 + step * 0.8, gy - 2.5, 6, 3.5, o.shoes);
  ellipse(ctx, cx + 5 - step * 0.8, gy - 2.5, 6, 3.5, o.shoes);

  // tułów: dłuższy płaszcz u rybaka i medyka
  const long = prof === 'fisher' || prof === 'medic';
  const tb = long ? bottom + 6 : bottom;
  torsoPath(ctx, cx, top, tb, 11, long ? 16 : 14.5);
  ctx.fillStyle = o.shirt;
  ctx.fill();
  ctx.save();
  torsoPath(ctx, cx, top, tb, 11, long ? 16 : 14.5);
  ctx.clip();
  rrect(ctx, cx - 20, tb - 4, 40, 6, 2, 'rgba(60,35,20,0.12)');
  torsoOverlay(ctx, prof, cx, top, tb);
  ctx.restore();
  if (prof === 'merchant') {
    // sakiewka przy pasie
    ellipse(ctx, cx - 11, bottom + 1, 5.2, 5.8, '#a8743f');
    rrect(ctx, cx - 14, bottom - 5, 6, 2.6, 1.3, '#7a4a24');
    ellipse(ctx, cx - 9, bottom - 2.5, 2.4, 2.4, '#ffc53d');
    ellipse(ctx, cx - 12.5, bottom - 1, 1.6, 2, 'rgba(255,230,190,0.5)');
  }

  // ręce: wymach przeciwny do nóg
  const swing = step * 0.45;
  const lhx = cx - 16.5;
  const lhy = gy - 30 + bob - swing;
  const rhx = cx + 16.5;
  const rhy = gy - 30 + bob + swing;
  ellipse(ctx, cx - 14.5, gy - 37 + bob - swing, 4.6, 8, o.sleeve, 0.3);
  ellipse(ctx, cx + 14.5, gy - 37 + bob + swing, 4.6, 8, o.sleeve, -0.3);
  if (prof === 'lumberjack') {
    rrect(ctx, cx - 18.5, gy - 37 + bob - swing, 8, 2.6, 1.3, 'rgba(110,24,16,0.55)');
    rrect(ctx, cx + 10.5, gy - 37 + bob + swing, 8, 2.6, 1.3, 'rgba(110,24,16,0.55)');
  }
  if (prof === 'firefighter') {
    rrect(ctx, cx - 19, gy - 34 + bob - swing, 8, 2.6, 1.3, '#ffd23a');
    rrect(ctx, cx + 11, gy - 34 + bob + swing, 8, 2.6, 1.3, '#ffd23a');
  }
  leftProp(ctx, prof, lhx, lhy);
  rightTool(ctx, prof, rhx, rhy);
  ellipse(ctx, lhx, lhy, 4, 4, look.skin);
  ellipse(ctx, rhx, rhy, 4, 4, look.skin);

  head(ctx, look, prof, cx, gy - 63 + bob, 1);
}

// ------------------------------------------------------------------ dziecko

/** Dziecko: ta sama klatka co dorosły, dziecięce proporcje (duża głowa, krótkie nóżki), bez stroju zawodu. */
export function drawChild(ctx: Ctx2D, lookIdx: number, f: number, ox = 0, oy = 0): void {
  const look = lookOf(lookIdx);
  const cx = ox + RESIDENT_FRAME.w / 2;
  const gy = oy + RESIDENT_FRAME.h * RESIDENT_FRAME.originY;
  const step = f === 1 ? 3 : -3;
  const bob = f === 1 ? -2 : 0;
  const top = gy - 36 + bob;
  const bottom = gy - 15 + bob;
  const shorts = shade(look.pants, 0.12);

  ellipse(ctx, cx, gy, 17, 5, 'rgba(50,35,20,0.25)');
  // nóżki z kolanami i trampki
  rrect(ctx, cx - 9 + step, gy - 18, 8, 16, 4, look.skin);
  rrect(ctx, cx + 1 - step, gy - 18, 8, 16, 4, look.skin);
  ellipse(ctx, cx - 5 + step, gy - 2.5, 6.5, 4, '#f2ece0');
  ellipse(ctx, cx + 5 - step, gy - 2.5, 6.5, 4, '#f2ece0');
  rrect(ctx, cx - 10.5 + step, gy - 4.5, 11, 2.4, 1.2, '#e2604a');
  rrect(ctx, cx - 0.5 - step, gy - 4.5, 11, 2.4, 1.2, '#e2604a');
  // spodenki i koszulka z gwiazdką
  rrect(ctx, cx - 15, bottom - 7, 30, 11, 5, shorts);
  torsoPath(ctx, cx, top, bottom, 12, 15);
  ctx.fillStyle = look.kid;
  ctx.fill();
  star(ctx, cx, top + 11, 5.5, 2.4, 'rgba(255,255,240,0.85)');
  // rączki
  const swing = step * 0.6;
  ellipse(ctx, cx - 15.5, gy - 28 + bob - swing, 4.6, 7, look.kid, 0.4);
  ellipse(ctx, cx + 15.5, gy - 28 + bob + swing, 4.6, 7, look.kid, -0.4);
  ellipse(ctx, cx - 18, gy - 22 + bob - swing, 4.2, 4.2, look.skin);
  ellipse(ctx, cx + 18, gy - 22 + bob + swing, 4.2, 4.2, look.skin);

  head(ctx, look, null, cx, gy - 57 + bob, 1.18);
}

// ------------------------------------------------------------------ wóz karawany

type P = { x: number; y: number };

/** Kafle w klatce wozu (u – wzdłuż jazdy, v – w poprzek, z – w górę w px). */
const CK = 46;
const CAR_U = 1.45;
const CAR_V = 0.45;

function poly(ctx: Ctx2D, pts: P[], fill: string, stroke = 'rgba(74,46,26,0.75)', width = 1.6): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (width > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

/** Otoczka wypukła (łańcuch monotoniczny) – sylwetka plandeki z dwóch łuków. */
function hull(pts: P[]): P[] {
  const s = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: P[] = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: P[] = [];
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Koło w płaszczyźnie burty (oś u–z): elipsa z rzutu, szprychy obrócone o fazę. */
function wheel(ctx: Ctx2D, c: P, r: number, phase: number, dark: boolean): void {
  ctx.save();
  ctx.transform(0.72, 0.36, 0, 1, c.x, c.y);
  const tire = dark ? '#3a2616' : '#4a2e1a';
  const rim = dark ? '#8a5a30' : '#c08048';
  ellipse(ctx, 0, 0, r, r, tire);
  ellipse(ctx, 0, 0, r - 3, r - 3, rim);
  ellipse(ctx, 0, 0, r - 6, r - 6, dark ? '#6a4424' : '#9a6236');
  ctx.strokeStyle = rim;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = phase + (i * Math.PI) / 3;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * (r - 4), Math.sin(a) * (r - 4));
  }
  ctx.stroke();
  ellipse(ctx, 0, 0, 3.6, 3.6, dark ? '#5a6672' : '#8f9aa6');
  if (!dark) ellipse(ctx, -r * 0.4, -r * 0.55, r * 0.28, r * 0.12, 'rgba(255,240,210,0.45)', -0.6);
  ctx.restore();
}

/** Skrzynka izometryczna: widoczne wierzch, bok (v+) i przód (u+). */
function crate(ctx: Ctx2D, P3: (u: number, v: number, z: number) => P, u0: number, u1: number, v0: number, v1: number, z0: number, z1: number, col: string): void {
  const side = [P3(u0, v1, z0), P3(u1, v1, z0), P3(u1, v1, z1), P3(u0, v1, z1)];
  const front = [P3(u1, v1, z0), P3(u1, v0, z0), P3(u1, v0, z1), P3(u1, v1, z1)];
  const topF = [P3(u0, v0, z1), P3(u1, v0, z1), P3(u1, v1, z1), P3(u0, v1, z1)];
  poly(ctx, side, col);
  poly(ctx, front, shade(col, -0.16));
  poly(ctx, topF, shade(col, 0.18));
  // deska na skos i listwy
  ctx.strokeStyle = 'rgba(110,64,30,0.7)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  const a = P3(u0, v1, z0 + 2);
  const b = P3(u1, v1, z1 - 2);
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  const c = P3(u1, v1, z0 + 2);
  const d = P3(u1, v0, z1 - 2);
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.stroke();
}

function pony(ctx: Ctx2D, P3: (u: number, v: number, z: number) => P, f: number, layer: 'far' | 'body' | 'near'): void {
  const coat = '#c48a52';
  const mane = '#6b4423';
  const tilt = Math.atan2(0.5, 1);
  const legs = (v: number, phase: number, col: string) => {
    for (const [u, k] of [[1.97, 1], [2.47, -1]] as const) {
      const du = (f === phase ? 0.08 : -0.08) * k;
      const top = P3(u + du * 0.25, v, 30);
      const knee = P3(u + du * 0.7, v, 14);
      const foot = P3(u + du, v, 3);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = col;
      ctx.lineWidth = 7.5;
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(knee.x, knee.y);
      ctx.lineTo(foot.x, foot.y);
      ctx.stroke();
      ctx.restore();
      ellipse(ctx, foot.x + 0.5, foot.y + 1, 5, 3.2, '#4a2e1a');
    }
  };
  if (layer === 'far') {
    legs(0.28, 0, shade(coat, -0.22));
    return;
  }
  if (layer === 'near') {
    legs(0.64, 1, coat);
    return;
  }
  // puszysty ogon
  const tail = P3(1.86, 0.46, 42);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = mane;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(tail.x + 4, tail.y);
  ctx.quadraticCurveTo(tail.x - 10, tail.y + 2, tail.x - 8 + (f ? 3 : -2), tail.y + 22);
  ctx.stroke();
  ctx.restore();
  ellipse(ctx, tail.x - 7 + (f ? 3 : -2), tail.y + 21, 4.5, 6, mane, 0.2);
  // tułów z popręgiem
  const body = P3(2.22, 0.46, 37);
  ellipse(ctx, body.x, body.y, 32, 17, coat, tilt);
  ellipse(ctx, body.x + 2, body.y + 8, 22, 6, 'rgba(110,60,25,0.18)', tilt);
  ellipse(ctx, body.x - 9, body.y - 7, 13, 5, 'rgba(255,236,200,0.45)', tilt);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(body.x, body.y, 32, 17, tilt, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#d0503a';
  ctx.beginPath();
  ctx.moveTo(body.x - 7, body.y - 22);
  ctx.lineTo(body.x - 1, body.y - 22);
  ctx.lineTo(body.x - 4, body.y + 22);
  ctx.lineTo(body.x - 10, body.y + 22);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // szyja i grzywa
  const neck0 = P3(2.52, 0.46, 42);
  const headC = P3(2.84, 0.5, 62);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = coat;
  ctx.lineWidth = 17;
  ctx.beginPath();
  ctx.moveTo(neck0.x, neck0.y);
  ctx.lineTo(headC.x - 3, headC.y + 3);
  ctx.stroke();
  ctx.restore();
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    ellipse(ctx, neck0.x - 9 + (headC.x - neck0.x) * t, neck0.y - 6 + (headC.y - 8 - neck0.y) * t, 5.5, 7, i % 2 ? shade(mane, 0.08) : mane, -0.5);
  }
  // chomąto z dzwoneczkiem
  const collar = P3(2.56, 0.46, 46);
  ctx.save();
  ctx.strokeStyle = '#d0503a';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(collar.x, collar.y, 8, 12, 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  ellipse(ctx, collar.x - 1, collar.y + 11, 3.2, 3.2, '#ffc53d');
  ellipse(ctx, collar.x - 2, collar.y + 10, 1, 1, '#fff6c4');
  // głowa chibi: uszy, grzywka, jasny pysk, oko z blikiem
  for (const [dx, rot, col] of [[-6, -0.45, coat], [4, 0.25, shade(coat, -0.1)]] as const) {
    ctx.beginPath();
    ctx.ellipse(headC.x + dx, headC.y - 14, 3.8, 8, rot, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  }
  ellipse(ctx, headC.x - 6, headC.y - 14, 1.6, 4.6, '#f0b6a0', -0.45);
  ellipse(ctx, headC.x, headC.y, 13.5, 11.5, coat, 0.35);
  ellipse(ctx, headC.x + 9, headC.y + 7, 9, 7.5, '#f0d2a8', 0.55);
  ellipse(ctx, headC.x + 12, headC.y + 7, 1.5, 1.2, '#6b4423');
  ellipse(ctx, headC.x + 8.5, headC.y + 10, 1.5, 1.2, '#6b4423');
  ellipse(ctx, headC.x - 3, headC.y - 10, 6, 4, mane, -0.3);
  ellipse(ctx, headC.x + 1, headC.y - 11, 4, 3.2, shade(mane, 0.1), 0.2);
  ellipse(ctx, headC.x - 2, headC.y - 1, 3, 3.8, '#2a1a10');
  ellipse(ctx, headC.x - 3, headC.y - 2.5, 1.2, 1.3, '#ffffff');
  ellipse(ctx, headC.x - 1.2, headC.y + 0.8, 0.6, 0.6, '#ffffff');
  ellipse(ctx, headC.x - 6.5, headC.y + 4, 3, 1.7, 'rgba(255,120,140,0.5)');
  ellipse(ctx, headC.x - 6, headC.y - 6, 4, 1.8, 'rgba(255,240,215,0.5)', -0.4);
}

/** Kryty wóz z plandeką, skrzyniami i kucykiem, jadący w prawo-dół. Klatka 0/1 = obrót kół i krok konia. */
export function drawCaravan(ctx: Ctx2D, f: number, ox = 0, oy = 0): void {
  const ax = ox + CARAVAN_FRAME.w / 2;
  const ay = oy + CARAVAN_FRAME.h * CARAVAN_FRAME.originY;
  // punkt odniesienia: środek podstawy zaprzęgu (CAR_U, CAR_V) leży w (ax, ay)
  const P3 = (u: number, v: number, z: number): P => ({ x: ax + (u - v - (CAR_U - CAR_V)) * CK, y: ay + (u + v - (CAR_U + CAR_V)) * (CK / 2) - z });
  const phase = f ? Math.PI / 6 : 0;

  // cień pod całym zaprzęgiem
  const sc = P3(1.4, 0.45, 0);
  ellipse(ctx, sc.x, sc.y + 2, 86, 24, 'rgba(50,35,20,0.22)', Math.atan2(0.5, 1));

  // dalsze koła i dalszy dyszel
  wheel(ctx, P3(0.32, -0.02, 19), 19, phase, true);
  wheel(ctx, P3(1.22, -0.02, 16), 16, phase, true);
  const s0 = P3(1.5, 0.2, 22);
  const s1 = P3(2.56, 0.3, 42);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#7a4a24';
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  ctx.moveTo(s0.x, s0.y);
  ctx.lineTo(s1.x, s1.y);
  ctx.stroke();
  ctx.restore();
  pony(ctx, P3, f, 'far');

  // skrzynia wozu
  const zb = 16;
  const zt = 36;
  const L = 1.5;
  const W = 0.86;
  const wood = '#c08048';
  poly(ctx, [P3(0, W, zb), P3(L, W, zb), P3(L, W, zt), P3(0, W, zt)], wood);
  poly(ctx, [P3(L, W, zb), P3(L, 0, zb), P3(L, 0, zt), P3(L, W, zt)], shade(wood, -0.16));
  ctx.strokeStyle = 'rgba(110,64,30,0.6)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (const z of [22.5, 29]) {
    const a = P3(0.03, W, z);
    const b = P3(L, W, z);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    const c = P3(L, W, z);
    const d = P3(L, 0.02, z);
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
  }
  ctx.stroke();
  // jasna listwa górna
  poly(ctx, [P3(0, W, zt - 3), P3(L, W, zt - 3), P3(L, W, zt + 1), P3(0, W, zt + 1)], shade(wood, 0.2), 'rgba(74,46,26,0.6)', 1.2);
  // pokład z przodu (przed plandeką)
  poly(ctx, [P3(1.12, 0, zt), P3(L, 0, zt), P3(L, W, zt), P3(1.12, W, zt)], shade(wood, 0.1));

  // plandeka: otoczka łuku tylnego i przedniego, żebra i ciemne wnętrze z przodu
  const u0 = 0.04;
  const u1 = 1.12;
  const H = 48;
  const arch = (u: number, inset = 0): P[] => {
    const pts: P[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = (i / 16) * Math.PI;
      const v = W / 2 - (W / 2 - inset) * Math.cos(t);
      pts.push(P3(u, v, zt + (H - inset * 40) * Math.sin(t)));
    }
    return pts;
  };
  const canvasCol = '#f6ead2';
  poly(ctx, hull([...arch(u0), ...arch(u1)]), canvasCol, 'rgba(74,46,26,0.75)', 1.8);
  // ciepły cień po stronie dalszej i jasny połysk na wierzchu
  ctx.save();
  ctx.beginPath();
  hull([...arch(u0), ...arch(u1)]).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.clip();
  const ridge0 = P3(u0, W * 0.35, zt + H);
  const ridge1 = P3(u1, W * 0.35, zt + H);
  ctx.strokeStyle = 'rgba(255,255,248,0.75)';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ridge0.x + 6, ridge0.y + 2);
  ctx.lineTo(ridge1.x - 6, ridge1.y + 2);
  ctx.stroke();
  const low0 = P3(u0, W, zt);
  const low1 = P3(u1, W, zt);
  ctx.strokeStyle = 'rgba(160,120,70,0.28)';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(low0.x, low0.y - 3);
  ctx.lineTo(low1.x, low1.y - 3);
  ctx.stroke();
  ctx.restore();
  // żebra (widoczna część łuków)
  ctx.strokeStyle = 'rgba(176,136,86,0.75)';
  ctx.lineWidth = 1.6;
  for (const u of [0.32, 0.6, 0.88]) {
    const pts = arch(u).slice(3);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }
  // łata na plandece
  const pc = P3(0.42, W, zt + 20);
  ctx.save();
  ctx.transform(0.72, 0.36, 0, 1, pc.x, pc.y);
  rrect(ctx, -6, -6, 12, 11, 2, '#e8b03a');
  ctx.strokeStyle = 'rgba(120,70,20,0.6)';
  ctx.setLineDash([2, 2]);
  ctx.lineWidth = 1;
  ctx.strokeRect(-4.5, -4.5, 9, 8);
  ctx.restore();
  ctx.setLineDash([]);
  // przedni otwór plandeki
  poly(ctx, arch(u1), '#e6d6b6', 'rgba(74,46,26,0.75)', 1.6);
  poly(ctx, arch(u1 + 0.001, 0.07), '#5a3a22', 'rgba(74,46,26,0)', 0);

  // skrzynki i worek na przednim pokładzie
  crate(ctx, P3, 1.16, 1.46, 0.06, 0.42, zt, zt + 16, '#d9a066');
  crate(ctx, P3, 1.18, 1.44, 0.46, 0.8, zt, zt + 13, '#e2b070');
  crate(ctx, P3, 1.2, 1.42, 0.12, 0.38, zt + 16, zt + 27, '#cf9658');
  const sack = P3(1.3, 0.64, zt + 19);
  ellipse(ctx, sack.x, sack.y, 7, 7.5, '#e8d2a0');
  ellipse(ctx, sack.x, sack.y - 7, 3.4, 2, '#c9a86a');
  ellipse(ctx, sack.x - 2, sack.y - 2, 2.4, 1.4, 'rgba(255,250,230,0.7)');
  for (const [du, dv, col] of [[0, 0, '#f0704f'], [0.04, 0.08, '#7cc95a'], [0.08, 0.02, '#ffc53d']] as const) {
    const p = P3(1.3 + du, 0.22 + dv, zt + 29);
    ellipse(ctx, p.x, p.y, 3.4, 3.2, col);
    ellipse(ctx, p.x - 1, p.y - 1, 1.1, 0.9, 'rgba(255,255,255,0.7)');
  }

  // koń i bliższy dyszel
  pony(ctx, P3, f, 'body');
  const n0 = P3(1.5, 0.72, 22);
  const n1 = P3(2.56, 0.64, 42);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#8a5a30';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(n0.x, n0.y);
  ctx.lineTo(n1.x, n1.y);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,230,190,0.5)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(n0.x, n0.y - 1.2);
  ctx.lineTo(n1.x, n1.y - 1.2);
  ctx.stroke();
  ctx.restore();
  pony(ctx, P3, f, 'near');

  // bliższe koła
  wheel(ctx, P3(0.32, W + 0.06, 19), 19, phase, false);
  wheel(ctx, P3(1.22, W + 0.06, 16), 16, phase, false);
}

// ------------------------------------------------------------------ cząsteczki i ikonki sceny

/** Płomyk i iskra 32×32 (bez konturu – jak PARTICLES w atlasie). */
export function drawCharacterParticle(ctx: Ctx2D, name: string, cx: number, cy: number): void {
  if (name === 'p_fire') {
    const glow = ctx.createRadialGradient(cx, cy + 4, 0, cx, cy + 4, 15);
    glow.addColorStop(0, 'rgba(255,170,60,0.55)');
    glow.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - 16, cy - 16, 32, 32);
    const flame = (s: number, col: string, dy: number) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy - 14 * s + dy);
      ctx.bezierCurveTo(cx + 4 * s, cy - 6 * s + dy, cx + 10 * s, cy - 2 * s + dy, cx + 9 * s, cy + 5 * s + dy);
      ctx.bezierCurveTo(cx + 8 * s, cy + 11 * s + dy, cx - 8 * s, cy + 11 * s + dy, cx - 9 * s, cy + 5 * s + dy);
      ctx.bezierCurveTo(cx - 10 * s, cy - 1 * s + dy, cx - 3 * s, cy - 4 * s + dy, cx, cy - 14 * s + dy);
      ctx.fillStyle = col;
      ctx.fill();
    };
    flame(1, '#ff7a2a', 0);
    flame(0.7, '#ffb52e', 2.5);
    flame(0.42, '#fff1a8', 5);
    return;
  }
  if (name === 'p_ember') {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 11);
    g.addColorStop(0, 'rgba(255,250,210,1)');
    g.addColorStop(0.25, 'rgba(255,200,80,0.95)');
    g.addColorStop(0.55, 'rgba(255,120,40,0.45)');
    g.addColorStop(1, 'rgba(255,90,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - 16, cy - 16, 32, 32);
  }
}

/** Dymek z ikoną (jak ikonki pól): klucz przy awarii, termometr przy chorych zwierzętach. */
export function drawSceneIcon(ctx: Ctx2D, name: string, cx: number, cy: number): void {
  // dymek z ogonkiem w dół
  ctx.beginPath();
  ctx.ellipse(cx, cy - 4, 30, 27, 0, 0, Math.PI * 2);
  ctx.moveTo(cx - 9, cy + 19);
  ctx.lineTo(cx, cy + 32);
  ctx.lineTo(cx + 9, cy + 19);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,252,242,0.96)';
  ctx.fill();
  ellipse(ctx, cx - 11, cy - 19, 9, 4, 'rgba(255,255,255,0.9)', -0.4);
  if (name === 'icon_wrench') {
    ctx.save();
    ctx.translate(cx, cy - 4);
    ctx.rotate(-Math.PI / 4);
    rrect(ctx, -4.5, -6, 9, 26, 4.5, '#8f9aa6');
    rrect(ctx, -3, -4, 2.4, 22, 1.2, '#d5dde5');
    // łeb klucza z wcięciem w kolorze dymku
    ctx.beginPath();
    ctx.arc(0, -12, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#8f9aa6';
    ctx.fill();
    rrect(ctx, -4.5, -26, 9, 14, 2, '#fffcf2');
    ellipse(ctx, -6, -13, 2.4, 3.6, 'rgba(255,255,255,0.6)', -0.3);
    ctx.restore();
    // czerwony znak „!” w rogu dymku
    ellipse(ctx, cx + 18, cy - 20, 8, 8, '#e8463a');
    rrect(ctx, cx + 16.6, cy - 25.5, 2.8, 7, 1.4, '#ffffff');
    ellipse(ctx, cx + 18, cy - 15.5, 1.6, 1.6, '#ffffff');
    return;
  }
  if (name === 'icon_sick') {
    // termometr z czerwoną bańką i kropla potu
    ctx.save();
    ctx.translate(cx - 3, cy - 3);
    ctx.rotate(0.55);
    rrect(ctx, -6.5, -23, 13, 34, 6.5, '#ffffff');
    ctx.strokeStyle = '#7d8a96';
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ellipse(ctx, 0, 14, 9.5, 9.5, '#7d8a96');
    rrect(ctx, -2.6, -10, 5.2, 22, 2.6, '#e8463a');
    ellipse(ctx, 0, 14, 7.5, 7.5, '#e8463a');
    ellipse(ctx, -2.6, 11.4, 2.4, 2.2, 'rgba(255,230,220,0.85)');
    ctx.strokeStyle = '#7d8a96';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const y of [-17, -12, -7]) {
      ctx.moveTo(2.5, y);
      ctx.lineTo(6.5, y);
    }
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(cx + 15, cy - 22);
    ctx.bezierCurveTo(cx + 23, cy - 12, cx + 21, cy - 6, cx + 15, cy - 6);
    ctx.bezierCurveTo(cx + 9, cy - 6, cx + 7, cy - 12, cx + 15, cy - 22);
    ctx.fillStyle = '#5cb8f0';
    ctx.fill();
    ellipse(ctx, cx + 13, cy - 11, 1.6, 2.4, 'rgba(255,255,255,0.85)');
  }
}

// ------------------------------------------------------------------ atlas

/** Klatki atlasu: mieszkańcy, dzieci, wóz, cząsteczki 'p_fire' i 'p_ember', ikonki 'icon_wrench' i 'icon_sick'. */
export function characterEntries(c: Content): Entry[] {
  void c;
  const { w, h } = RESIDENT_FRAME;
  const out: Entry[] = [];
  for (const prof of RESIDENT_KINDS) {
    for (let look = 0; look < LOOKS; look++) {
      for (const f of [0, 1]) out.push({ name: residentFrame(prof, look, f), w, h, draw: (ctx, x, y) => drawResident(ctx, prof, look, f, x, y), style: { outline: 3, shade: true } });
    }
  }
  // dzieci skalowane o CHILD_SCALE – grubszy kontur, by po zmniejszeniu wyglądał jak u dorosłych
  for (let look = 0; look < LOOKS; look++) {
    for (const f of [0, 1]) out.push({ name: childFrame(look, f), w, h, draw: (ctx, x, y) => drawChild(ctx, look, f, x, y), style: { outline: 4, shade: true } });
  }
  for (const f of [0, 1]) {
    out.push({ name: caravanFrame(f), w: CARAVAN_FRAME.w, h: CARAVAN_FRAME.h, draw: (ctx, x, y) => drawCaravan(ctx, f, x, y), style: { outline: 3, shade: true } });
  }
  for (const p of CHARACTER_PARTICLES) out.push({ name: p, w: 32, h: 32, draw: (ctx, x, y) => drawCharacterParticle(ctx, p, x + 16, y + 16), style: STYLE_NONE });
  for (const icon of SCENE_ICONS) out.push({ name: icon, w: 128, h: 128, draw: (ctx, x, y) => drawSceneIcon(ctx, icon, x + 64, y + 64), style: { outline: 3, shade: false } });
  return out;
}
