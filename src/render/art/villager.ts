// Mieszkańcy wioski: postacie chibi (duża głowa, okrągłe oczy z blikami, rumieńce) w kolorze z npcs.json.
// Dwie klatki chodu (naprzemienne nogi i lekkie podskoczenie) – resztę „aktorstwa” robią tweeny (squash & stretch).

import type { NpcDef } from '../../content/content';
import { ellipse, rrect, shade, type Ctx2D } from './draw';

interface Look {
  hair: string;
  skin: string;
  style: 'pigtails' | 'beard' | 'bun' | 'cap';
}

const LOOKS: Record<string, Look> = {
  ania: { hair: '#f2c46a', skin: '#ffd9c0', style: 'pigtails' },
  bogdan: { hair: '#7a4a2a', skin: '#f2c4a0', style: 'beard' },
  celina: { hair: '#3a2a1e', skin: '#f6d2b8', style: 'bun' },
  darek: { hair: '#c0602a', skin: '#ffd2b0', style: 'cap' },
};

const lookOf = (id: string): Look => LOOKS[id] ?? { hair: '#6a4a2a', skin: '#ffd9c0', style: 'bun' };

function eye(ctx: Ctx2D, x: number, y: number, blink: boolean): void {
  if (blink) {
    ctx.strokeStyle = '#2a1a10';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0.2, Math.PI - 0.2);
    ctx.stroke();
    return;
  }
  ellipse(ctx, x, y, 4.6, 6, '#2a1a10');
  ellipse(ctx, x - 1.5, y - 2.2, 1.9, 2.2, '#ffffff');
  ellipse(ctx, x + 1.4, y + 1.8, 0.9, 0.9, '#ffffff');
}

/** Klatka 0/1 = krok, 2 = mrugnięcie (stoi). */
export function drawVillager(ctx: Ctx2D, npc: NpcDef, frame: number, cx: number, cy: number): void {
  const look = lookOf(npc.id);
  const cloth = npc.color;
  const step = frame === 1 ? 4 : frame === 0 ? -4 : 0;
  const bob = frame === 1 ? -2 : 0;
  const blink = frame === 2;

  ellipse(ctx, cx, cy + 50, 24, 7, 'rgba(50,35,20,0.25)');
  // nogi i buciki
  rrect(ctx, cx - 10 + step, cy + 26, 8, 22, 4, '#4a5a6a');
  rrect(ctx, cx + 2 - step, cy + 26, 8, 22, 4, '#4a5a6a');
  ellipse(ctx, cx - 6 + step, cy + 48, 7, 4, '#4a2e1a');
  ellipse(ctx, cx + 6 - step, cy + 48, 7, 4, '#4a2e1a');
  // tułów (sukienka/kubraczek) – zaokrąglony jak ziarenko
  ctx.beginPath();
  ctx.moveTo(cx - 13, cy + 2 + bob);
  ctx.quadraticCurveTo(cx - 24, cy + 32 + bob, cx - 18, cy + 32 + bob);
  ctx.lineTo(cx + 18, cy + 32 + bob);
  ctx.quadraticCurveTo(cx + 24, cy + 32 + bob, cx + 13, cy + 2 + bob);
  ctx.closePath();
  ctx.fillStyle = cloth;
  ctx.fill();
  rrect(ctx, cx - 14, cy + 22 + bob, 28, 5, 2.5, shade(cloth, -0.2));
  ellipse(ctx, cx - 6, cy + 10 + bob, 4, 6, shade(cloth, 0.25));
  // rączki
  ellipse(ctx, cx - 17, cy + 16 + bob - step * 0.5, 5, 9, shade(cloth, -0.08), 0.3);
  ellipse(ctx, cx + 17, cy + 16 + bob + step * 0.5, 5, 9, shade(cloth, -0.08), -0.3);
  ellipse(ctx, cx - 19, cy + 24 + bob - step * 0.5, 4.5, 4.5, look.skin);
  ellipse(ctx, cx + 19, cy + 24 + bob + step * 0.5, 4.5, 4.5, look.skin);

  // duża głowa
  const hy = cy - 20 + bob;
  if (look.style === 'pigtails') {
    ellipse(ctx, cx - 26, hy + 6, 9, 13, look.hair, 0.3);
    ellipse(ctx, cx + 26, hy + 6, 9, 13, look.hair, -0.3);
    ellipse(ctx, cx - 22, hy - 4, 4, 3, '#e2486a');
    ellipse(ctx, cx + 22, hy - 4, 4, 3, '#e2486a');
  }
  if (look.style === 'bun') ellipse(ctx, cx, hy - 28, 11, 10, look.hair);
  ellipse(ctx, cx, hy, 24, 23, look.skin);
  // włosy (grzywka)
  ctx.beginPath();
  ctx.ellipse(cx, hy - 6, 25, 19, 0, Math.PI, 0);
  ctx.quadraticCurveTo(cx + 10, hy - 2, cx, hy - 10);
  ctx.quadraticCurveTo(cx - 10, hy - 2, cx - 25, hy - 6);
  ctx.closePath();
  ctx.fillStyle = look.hair;
  ctx.fill();
  ellipse(ctx, cx - 9, hy - 16, 7, 3, shade(look.hair, 0.3), -0.3);
  if (look.style === 'cap') {
    ctx.beginPath();
    ctx.ellipse(cx, hy - 10, 25, 16, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = '#3a6a9a';
    ctx.fill();
    ellipse(ctx, cx + 14, hy - 9, 16, 5, '#2f5a84', 0.1);
  }
  if (look.style === 'beard') {
    // słomkowy kapelusz i broda
    ellipse(ctx, cx, hy - 14, 34, 8, '#e8c86a');
    rrect(ctx, cx - 17, hy - 32, 34, 20, 10, '#f2d47a');
    rrect(ctx, cx - 17, hy - 18, 34, 4, 2, '#c0503a');
    ctx.beginPath();
    ctx.ellipse(cx, hy + 10, 18, 13, 0, 0, Math.PI);
    ctx.fillStyle = look.hair;
    ctx.fill();
  }
  eye(ctx, cx - 9, hy + 2, blink);
  eye(ctx, cx + 9, hy + 2, blink);
  ellipse(ctx, cx - 16, hy + 10, 4.5, 2.6, 'rgba(255,120,140,0.55)');
  ellipse(ctx, cx + 16, hy + 10, 4.5, 2.6, 'rgba(255,120,140,0.55)');
  if (look.style !== 'beard') {
    ctx.strokeStyle = '#8a3a3a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, hy + 9, 4, 0.25, Math.PI - 0.25);
    ctx.stroke();
  }
}
