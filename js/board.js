// Рисунок поля: камуфляж, сетка и два озера, как на бумажном поле «Сражения».
import { SIZE } from './rules.js';

function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function noiseField(n, cells, rand) {
  const g = Array.from({ length: (cells + 1) * (cells + 1) }, rand);
  const s = t => t * t * (3 - 2 * t);
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const fx = x / n * cells, fy = y / n * cells, ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = s(fx - ix), ty = s(fy - iy), w = cells + 1;
    const a = g[iy * w + ix], b = g[iy * w + ix + 1], c = g[(iy + 1) * w + ix], d = g[(iy + 1) * w + ix + 1];
    out[y * n + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }
  return out;
}

export function drawBoard(px) {
  const rand = rng(1812);
  const n = 240;
  const f1 = noiseField(n, 6, rand), f2 = noiseField(n, 13, rand), f3 = noiseField(n, 29, rand);
  const small = document.createElement('canvas');
  small.width = small.height = n;
  const sc = small.getContext('2d');
  const img = sc.createImageData(n, n);
  const palette = [[238, 238, 204], [205, 224, 166], [96, 170, 92], [44, 130, 70]];
  for (let k = 0; k < n * n; k++) {
    const v = f1[k] * .55 + f2[k] * .32 + f3[k] * .13;
    const ci = v < .42 ? 0 : v < .53 ? 1 : v < .62 ? 2 : 3;
    const [r, g, b] = palette[ci];
    img.data.set([r, g, b, 255], k * 4);
  }
  sc.putImageData(img, 0, 0);

  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = true;
  c.drawImage(small, 0, 0, px, px);
  // Смягчить края пятен.
  c.globalAlpha = .35;
  c.filter = 'blur(2px)';
  c.drawImage(cv, 0, 0);
  c.filter = 'none';
  c.globalAlpha = 1;

  const cell = px / SIZE;
  // Озёра
  for (const [r0, c0] of [[4, 2], [4, 6]]) {
    const cx = (c0 + 1) * cell, cy = (r0 + 1) * cell, R = cell * .98;
    c.beginPath();
    const pts = 28;
    for (let k = 0; k <= pts; k++) {
      const a = k / pts * Math.PI * 2;
      const wob = 1 + (rand() - .5) * .12;
      // «Скруглённый квадрат» с волнистым краем
      const sq = 1 / Math.pow(Math.pow(Math.abs(Math.cos(a)), 4) + Math.pow(Math.abs(Math.sin(a)), 4), .25);
      const rr = R * wob * Math.min(sq, 1.25);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      k ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.closePath();
    const grad = c.createRadialGradient(cx, cy, R * .2, cx, cy, R * 1.2);
    grad.addColorStop(0, '#2a46b8');
    grad.addColorStop(1, '#1a2e86');
    c.fillStyle = grad;
    c.fill();
    c.lineWidth = cell * .06;
    c.strokeStyle = '#4f72d6';
    c.stroke();
  }
  // Сетка
  c.strokeStyle = 'rgba(30, 55, 110, .55)';
  c.lineWidth = Math.max(1, px / 600);
  c.beginPath();
  for (let k = 1; k < SIZE; k++) {
    c.moveTo(k * cell, 0); c.lineTo(k * cell, px);
    c.moveTo(0, k * cell); c.lineTo(px, k * cell);
  }
  c.stroke();
  // Средняя линия фронта
  c.strokeStyle = 'rgba(30, 55, 110, .25)';
  c.lineWidth = Math.max(2, px / 300);
  c.beginPath();
  c.moveTo(0, 5 * cell); c.lineTo(px, 5 * cell);
  c.stroke();
  return cv.toDataURL('image/jpeg', .9);
}
