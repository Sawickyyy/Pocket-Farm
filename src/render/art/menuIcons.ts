// Ikony menu „Farma” malowane tym samym pędzlem co świat gry (zamiast emoji): sakiewka, stragan,
// młotek, chatka, zwój, gwiazdka, koszyk, zębatka. Rysowane w kwadracie 128×128.

import { ellipse, rrect, shade, star, type Ctx2D } from './draw';

export const MENU_ICONS = ['market', 'shop', 'build', 'village', 'progress', 'skills', 'inventory', 'settings'] as const;
export type MenuIcon = (typeof MENU_ICONS)[number];

function shadow(ctx: Ctx2D): void {
  ellipse(ctx, 64, 112, 38, 8, 'rgba(60,30,40,0.2)');
}

export function drawMenuIcon(ctx: Ctx2D, name: string): void {
  shadow(ctx);
  switch (name) {
    case 'market': {
      // pękata sakiewka z monetami
      ellipse(ctx, 64, 78, 36, 32, '#c98a4a');
      ellipse(ctx, 52, 68, 12, 14, shade('#c98a4a', 0.18));
      rrect(ctx, 46, 38, 36, 12, 6, '#a86a34');
      ctx.strokeStyle = '#e2486a';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(44, 50);
      ctx.quadraticCurveTo(64, 58, 84, 50);
      ctx.stroke();
      ellipse(ctx, 50, 30, 10, 8, '#c98a4a');
      ellipse(ctx, 78, 30, 10, 8, '#c98a4a');
      for (const [x, y] of [[88, 96], [100, 88], [36, 100]] as const) {
        ellipse(ctx, x, y, 11, 11, '#f2b632');
        ellipse(ctx, x - 2, y - 2, 6, 6, '#ffd75e');
      }
      break;
    }
    case 'shop': {
      // stragan z markizą w paski
      rrect(ctx, 26, 60, 76, 46, 6, '#e8c48a');
      rrect(ctx, 34, 70, 60, 26, 4, '#8a5a34');
      for (const [x, c] of [[40, '#e2486a'], [56, '#f2b632'], [72, '#6cbf3c']] as const) ellipse(ctx, x + 6, 76, 7, 7, c);
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i % 2 ? '#fff6e4' : '#e2486a';
        ctx.beginPath();
        ctx.moveTo(20 + i * 17.6, 36);
        ctx.lineTo(20 + (i + 1) * 17.6, 36);
        ctx.lineTo(20 + (i + 1) * 17.6, 56);
        ctx.quadraticCurveTo(20 + (i + 0.5) * 17.6, 66, 20 + i * 17.6, 56);
        ctx.closePath();
        ctx.fill();
      }
      rrect(ctx, 18, 28, 92, 10, 5, '#c0503a');
      break;
    }
    case 'build': {
      // młotek na skos
      ctx.save();
      ctx.translate(64, 66);
      ctx.rotate(-0.6);
      rrect(ctx, -6, -10, 12, 62, 6, '#b0743f');
      rrect(ctx, -5, -8, 4, 56, 2, shade('#b0743f', 0.25));
      rrect(ctx, -30, -34, 60, 26, 8, '#8f9aa6');
      rrect(ctx, -26, -32, 50, 8, 4, '#c5ced8');
      ctx.restore();
      star(ctx, 98, 30, 10, 4, '#ffd75e');
      break;
    }
    case 'village': {
      // chatka z czerwonym dachem i okienkiem
      rrect(ctx, 32, 58, 64, 48, 6, '#f6e7cf');
      ctx.fillStyle = '#c0503a';
      ctx.beginPath();
      ctx.moveTo(20, 62);
      ctx.quadraticCurveTo(64, 10, 108, 62);
      ctx.closePath();
      ctx.fill();
      rrect(ctx, 56, 78, 18, 28, 9, '#8a5a34');
      ellipse(ctx, 84, 76, 8, 8, '#ffd27a');
      ellipse(ctx, 44, 76, 8, 8, '#ffd27a');
      rrect(ctx, 80, 22, 10, 22, 3, '#9a6a3c');
      break;
    }
    case 'progress': {
      // zwój z pieczęcią
      rrect(ctx, 30, 30, 68, 72, 8, '#fff2d6');
      ellipse(ctx, 30, 36, 8, 10, '#e8cfa0');
      ellipse(ctx, 98, 96, 8, 10, '#e8cfa0');
      ctx.strokeStyle = '#c99a6b';
      ctx.lineWidth = 4;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(42, 48 + i * 12);
        ctx.lineTo(i === 3 ? 66 : 86, 48 + i * 12);
        ctx.stroke();
      }
      ellipse(ctx, 82, 90, 13, 13, '#c4452f');
      star(ctx, 82, 90, 7, 3, '#ffd2c4');
      break;
    }
    case 'skills':
      star(ctx, 64, 62, 46, 20, '#ffd75e');
      star(ctx, 58, 54, 18, 8, '#fff6c4');
      ellipse(ctx, 52, 64, 4, 5, '#4a2e1a');
      ellipse(ctx, 74, 64, 4, 5, '#4a2e1a');
      ellipse(ctx, 46, 74, 5, 3, 'rgba(255,120,140,0.6)');
      ellipse(ctx, 82, 74, 5, 3, 'rgba(255,120,140,0.6)');
      break;
    case 'inventory': {
      // wiklinowy koszyk z jabłkiem i marchewką
      ctx.strokeStyle = '#a8743f';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(64, 64, 30, Math.PI, 0);
      ctx.stroke();
      ellipse(ctx, 50, 62, 13, 13, '#e2486a');
      ellipse(ctx, 46, 58, 4, 4, 'rgba(255,255,255,0.7)');
      ctx.fillStyle = '#ef8326';
      ctx.beginPath();
      ctx.moveTo(70, 50);
      ctx.lineTo(90, 52);
      ctx.lineTo(78, 76);
      ctx.closePath();
      ctx.fill();
      rrect(ctx, 26, 64, 76, 40, 12, '#c98a4a');
      ctx.strokeStyle = '#a8743f';
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(30, 74 + i * 10);
        ctx.lineTo(98, 74 + i * 10);
        ctx.stroke();
      }
      break;
    }
    case 'settings': {
      // drewniana zębatka z kwiatkiem w środku
      ctx.fillStyle = '#b0743f';
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const r = i % 2 ? 34 : 44;
        ctx.lineTo(64 + Math.cos(a) * r, 62 + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ellipse(ctx, 64, 62, 22, 22, '#d9a066');
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ellipse(ctx, 64 + Math.cos(a) * 9, 62 + Math.sin(a) * 9, 7, 7, '#f7a1c4');
      }
      ellipse(ctx, 64, 62, 6, 6, '#ffd75e');
      break;
    }
  }
}
