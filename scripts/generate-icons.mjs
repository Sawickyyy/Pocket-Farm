// Generuje ikony PWA (PNG) bez zewnętrznych zależności: prosty rasteryzator + enkoder PNG (zlib).
// Uruchom: npm run icons  → public/icons/*.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../public/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Kształty jako funkcje odległości ze znakiem (współrzędne 0..1).
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
const ellipse = (cx, cy, rx, ry) => (x, y) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);
const roundRect = (x0, y0, x1, y1, r) => (x, y) => {
  const qx = Math.abs(x - (x0 + x1) / 2) - ((x1 - x0) / 2 - r);
  const qy = Math.abs(y - (y0 + y1) / 2) - ((y1 - y0) / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const leaf = (cx, cy, len, w, angle) => (x, y) => {
  const dx = x - cx;
  const dy = y - cy;
  const u = dx * Math.cos(-angle) - dy * Math.sin(-angle);
  const v = dx * Math.sin(-angle) + dy * Math.cos(-angle);
  const t = clamp01(-v / len);
  const half = w * Math.sin(Math.PI * t);
  return Math.max(Math.abs(u) - half, v > 0 ? v : -v - len);
};

function render(size, { maskable }) {
  const pad = maskable ? 0.14 : 0;
  const layers = [
    // tło
    { sdf: maskable ? () => -1 : roundRect(0, 0, 1, 1, 0.22), color: (x, y) => mix(hex('#7cc35a'), hex('#2f6f32'), y) },
    // grządka
    { sdf: ellipse(0.5, 0.74, 0.34, 0.13), color: () => hex('#6e4626') },
    { sdf: ellipse(0.5, 0.71, 0.3, 0.1), color: () => hex('#9a6636') },
    // łodyga i liście
    { sdf: roundRect(0.485, 0.42, 0.515, 0.72, 0.015), color: () => hex('#3f8a2a') },
    { sdf: leaf(0.5, 0.5, 0.26, 0.09, -0.95), color: () => hex('#8fd16a') },
    { sdf: leaf(0.5, 0.46, 0.3, 0.1, 0.85), color: () => hex('#6cbf3c') },
    // słońce
    { sdf: circle(0.78, 0.22, 0.08), color: () => hex('#ffd75e') },
  ];
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // współrzędne z marginesem bezpiecznym dla ikon maskowalnych
      const nx = (px + 0.5) / size;
      const ny = (py + 0.5) / size;
      const x = (nx - pad) / (1 - pad * 2);
      const y = (ny - pad) / (1 - pad * 2);
      let rgb = [0, 0, 0];
      let alpha = 0;
      const aa = 1.2 / size / (1 - pad * 2);
      layers.forEach((layer, i) => {
        const coverage = clamp01(0.5 - layer.sdf(i === 0 ? nx : x, i === 0 ? ny : y) / aa);
        if (coverage <= 0) return;
        rgb = mix(rgb, layer.color(nx, ny), alpha === 0 ? 1 : coverage);
        alpha = Math.max(alpha, coverage);
      });
      const o = (py * size + px) * 4;
      buf[o] = Math.round(rgb[0]);
      buf[o + 1] = Math.round(rgb[1]);
      buf[o + 2] = Math.round(rgb[2]);
      buf[o + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, buf);
}

const targets = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
  // iOS nie obsługuje przezroczystości w apple-touch-icon – wersja pełna (maskable = pełne tło).
  ['apple-touch-icon.png', 180, { maskable: true }],
];
for (const [name, size, opts] of targets) {
  writeFileSync(new URL(name, OUT), render(size, opts));
  console.log('✓', name);
}

writeFileSync(
  new URL('icon.svg', OUT),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cc35a"/><stop offset="1" stop-color="#2f6f32"/></linearGradient></defs>
  <rect width="100" height="100" rx="22" fill="url(#g)"/>
  <ellipse cx="50" cy="74" rx="34" ry="13" fill="#6e4626"/><ellipse cx="50" cy="71" rx="30" ry="10" fill="#9a6636"/>
  <rect x="48.5" y="42" width="3" height="30" rx="1.5" fill="#3f8a2a"/>
  <path d="M50 50q-20-4-22-22q18 2 22 22z" fill="#8fd16a"/><path d="M50 46q22-6 24-28q-22 4-24 28z" fill="#6cbf3c"/>
  <circle cx="78" cy="22" r="8" fill="#ffd75e"/>
</svg>
`,
);
console.log('✓ icon.svg');
