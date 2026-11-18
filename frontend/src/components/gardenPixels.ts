// Pixel-art renderer for his garden: a 256x160 frame drawn pixel by pixel into an ImageData buffer
// (everything is redrawn each frame, about ten times a second), then scaled up crisply in the page.
// The house with its south window and grow-light shelf, the greenhouse, and the outdoor beds, under
// the real sky; every plant drawn by its kind and stage; the cat; and Delamain while he is there.

export const W = 256, H = 120;          // the canvas: the lower part of a 256x160 world
const WH = 160, YOFF = 40;

export type PSpot = {
  id: number; place: string; species: string | null; stage: string; health?: number; dormant?: boolean;
  struggle?: string[]; water?: number; form?: string; petal?: string; centre?: string; fruit?: string | null;
};
export type PWorld = {
  hour: number; isDay: boolean; cloud: number; rain: number; snow: number; temp: number;
  growLight: boolean; spots: PSpot[];
  cat: { here: boolean; where?: string; doing?: string } | null;
  delamain: { x: number; y: number; walking: boolean; doing: string; facing: number } | null;
};
type RGB = [number, number, number];

const hex = (h: string): RGB => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
const dith = (x: number, y: number, t: number) => t > BAYER[((y & 3) << 2) | (x & 3)];
const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

class Buf {
  d = new Uint8ClampedArray(W * H * 4);
  set(x: number, y: number, c: RGB, a = 1) {
    x = Math.round(x); y = Math.round(y) - YOFF;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4, d = this.d;
    if (a >= 1) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; return; }
    d[i] += (c[0] - d[i]) * a; d[i + 1] += (c[1] - d[i + 1]) * a; d[i + 2] += (c[2] - d[i + 2]) * a; d[i + 3] = 255;
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c, a);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  disc(cx: number, cy: number, r: number, c: RGB, a = 1) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) this.set(cx + x, cy + y, c, a);
  }
  glow(cx: number, cy: number, r: number, c: RGB, a: number) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = Math.sqrt(x * x + y * y) / r;
      if (d < 1) this.set(cx + x, cy + y, c, a * (1 - d) * (1 - d));
    }
  }
}

// ── layout, at one scale: about 8 cm a pixel (Delamain is 22 px, 1.8 m) ─────
// plant base = top of the soil; stand = where his feet are when he tends it
export const FLOOR = { house: 150, greenhouse: 153, outdoors: 157 };
export const SPOTS: { x: number; y: number; pot: boolean; stand: { x: number; y: number } }[] = [
  { x: 40, y: 133, pot: true, stand: { x: 40, y: 157 } }, { x: 50, y: 133, pot: true, stand: { x: 50, y: 157 } },
  { x: 60, y: 133, pot: true, stand: { x: 60, y: 157 } },
  { x: 10, y: 134, pot: true, stand: { x: 11, y: 157 } }, { x: 22, y: 134, pot: true, stand: { x: 23, y: 157 } },
  { x: 100, y: 145, pot: false, stand: { x: 100, y: 159 } }, { x: 126, y: 145, pot: false, stand: { x: 126, y: 159 } },
  { x: 152, y: 145, pot: false, stand: { x: 152, y: 159 } },
  { x: 193, y: 150, pot: false, stand: { x: 193, y: 160 } }, { x: 215, y: 150, pot: false, stand: { x: 215, y: 160 } },
  { x: 237, y: 150, pot: false, stand: { x: 237, y: 160 } },
];
export const CAT_SPOT: Record<string, { x: number; y: number }> = {
  inside: { x: 64, y: 152 }, greenhouse: { x: 164, y: 143 }, outdoors: { x: 224, y: 141 },
};
export const BENCH_STAND: Record<string, { x: number; y: number }> = {
  inside: { x: 54, y: 157 }, greenhouse: { x: 154, y: 159 }, outdoors: { x: 214, y: 160 },
};

// ── the sky ────────────────────────────────────────────────────────────────
function skyStops(hour: number): RGB[] {
  const P = (...c: string[]) => c.map(hex);
  if (hour < 5 || hour >= 20.5) return P('#05061a', '#0b1030', '#141a45', '#1f2557');
  if (hour < 6.5) return P('#1e1b4b', '#4c1d95', '#be4b6b', '#f59e0b');
  if (hour < 8.5) return P('#3b82f6', '#7cb3f5', '#f9c784', '#fde68a');
  if (hour < 16) return P('#1d4ed8', '#3b82f6', '#7cc0f7', '#cbe9fb');
  if (hour < 17.5) return P('#3b4fc4', '#7c6be0', '#f08a5d', '#fbbf72');
  return P('#1b1446', '#3b1f6e', '#7a3474', '#c2575f');
}

function sky(b: Buf, w: PWorld, t: number) {
  const stops = skyStops(w.hour);
  const grey = Math.max(0, (w.cloud - 50) / 50);
  const greyC: RGB = w.isDay ? [148, 163, 184] : [30, 34, 48];
  for (let y = YOFF; y < 122; y++) {
    const f = ((y - YOFF) / (122 - YOFF)) * (stops.length - 1), k = Math.floor(f), fr = f - k;
    const a = stops[Math.min(k, stops.length - 1)], c = stops[Math.min(k + 1, stops.length - 1)];
    const lo = mix(a, greyC, grey * 0.6), hi = mix(c, greyC, grey * 0.6);
    for (let x = 0; x < W; x++) b.set(x, y, dith(x, y, fr) ? hi : lo);
  }
  if (!w.isDay) {
    for (let k = 0; k < 70; k++) {
      const x = Math.floor(hash(k) * W), y = YOFF + Math.floor(hash(k + 99) * 58);
      const tw = 0.5 + 0.5 * Math.sin(t * (1 + hash(k + 7) * 2) + k);
      b.set(x, y, [255, 255, 240], (1 - w.cloud / 100) * (0.35 + 0.65 * tw));
    }
    const mx = 210, my = 54;   // a crescent moon
    b.glow(mx, my, 14, [200, 210, 255], 0.25 * (1 - w.cloud / 120));
    for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
      if (x * x + y * y <= 36 && (x - 3) * (x - 3) + (y + 2) * (y + 2) > 26) b.set(mx + x, my + y, x < -3 ? [226, 232, 240] : [248, 250, 252]);
    }
  } else {
    const st = Math.max(0, Math.min(1, (w.hour - 6.8) / 10));
    const sx = 60 + st * 180, sy = 90 - Math.sin(st * Math.PI) * 36;
    const vis = 1 - w.cloud / 130;
    b.glow(sx, sy, 22, [255, 240, 180], 0.35 * vis);
    b.disc(sx, sy, 5, [253, 224, 71], vis);
    b.disc(sx - 1, sy - 1, 3, [254, 249, 195], vis);
  }
  // clouds: pixel blobs, lit from above
  const n = Math.round(w.cloud / 14);
  for (let k = 0; k < n; k++) {
    const speed = 1.2 + hash(k + 3) * 1.5;
    const cx = ((hash(k) * (W + 60) + t * speed) % (W + 60)) - 30, cy = YOFF + 6 + hash(k + 50) * 30;
    const lit: RGB = w.isDay ? (grey > 0.5 ? [203, 213, 225] : [248, 250, 252]) : [71, 85, 105];
    const shade: RGB = w.isDay ? (grey > 0.5 ? [148, 163, 184] : [203, 213, 225]) : [51, 65, 85];
    const parts = [[0, 0, 6], [-7, 2, 4], [7, 2, 5], [3, -3, 4], [-3, -2, 3]];
    for (const [dx, dy, r] of parts) {
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r) continue;
        const px = cx + dx * (1 + hash(k) * 0.4) + x, py = cy + dy + y;
        b.set(px, py, y > r * 0.3 || (y > 0 && dith(px, py, 0.5)) ? shade : lit, w.isDay ? 1 : 0.85);
      }
    }
  }
  // mountains: the far range with snow, then the near foothills
  const far: RGB = w.isDay ? [100, 116, 139] : [30, 36, 56], farSnow: RGB = w.isDay ? [241, 245, 249] : [120, 130, 160];
  const near: RGB = w.isDay ? [71, 85, 105] : [22, 26, 42];
  for (let x = 0; x < W; x++) {
    const hf = 92 + Math.sin(x * 0.045) * 9 + Math.sin(x * 0.13 + 1) * 4 + Math.sin(x * 0.31) * 1.5;
    for (let y = Math.floor(hf); y < 122; y++) b.set(x, y, y < hf + 3 + Math.sin(x * 0.5) && hf < 90 ? farSnow : far);
    const hn = 108 + Math.sin(x * 0.03 + 2) * 5 + Math.sin(x * 0.11) * 2;
    for (let y = Math.floor(hn); y < 122; y++) b.set(x, y, dith(x, y, 0.15) ? far : near);
  }
}

// ── plants ─────────────────────────────────────────────────────────────────
function greens(s: PSpot): { L: RGB; M: RGB; D: RGB } {
  const P = (l: string, m: string, d: string) => ({ L: hex(l), M: hex(m), D: hex(d) });
  if (s.stage === 'dead') return P('#a8a29e', '#78716c', '#57534e');
  if ((s.health ?? 1) < 0.35) return P('#d9f99d', '#a3a35a', '#65652e');
  if (s.dormant) return P('#a3a37a', '#7c7c52', '#57573a');
  if ((s.struggle || []).includes('too little light')) return P('#d9f99d', '#a3e6a0', '#6abf76');
  if (s.form === 'rosette') return P('#7fae6a', '#4f7f5c', '#2f5544');
  if (s.form === 'blades') return P('#4a8a4a', '#2f6b3a', '#1a4a2a');
  if (s.form === 'shrub') return P('#9fbf8f', '#6f8f6a', '#4a6a4a');
  return P('#6ee77a', '#2fbf55', '#15803d');
}

function plant(b: Buf, s: PSpot, bx: number, by: number, scale: number, t: number, windy: boolean) {
  if (!s.species || s.stage === 'empty') return;
  const g = greens(s);
  const seed = s.id * 13.7;
  const dead = s.stage === 'dead';
  const wilt = !dead && (s.health ?? 1) < 0.35;
  const open = (s.stage === 'bloom' || s.stage === 'fruit') && !dead && !wilt && !s.dormant;
  const petal = hex(s.petal || '#ffffff'), centre = hex(s.centre || '#facc15');
  const fruitC = s.fruit ? hex(s.fruit) : null;
  const k = (s.stage === 'young' ? 0.6 : s.dormant ? 0.55 : 1) * scale;
  const sway = windy && !dead ? Math.sin(t * 1.6 + seed) * 0.9 : Math.sin(t * 0.7 + seed) * 0.25;
  const droop = wilt || dead ? 1 : 0;
  const P = (x: number, y: number, c: RGB) => b.set(bx + x + Math.round(sway * (-y) / 16), by + y, c);
  if (s.stage === 'seed') { b.set(bx, by - 1, [120, 90, 60]); b.set(bx - 1, by, [96, 70, 48]); b.set(bx + 1, by, [96, 70, 48]); b.set(bx, by, [214, 199, 161]); return; }
  if (s.stage === 'sprout') {
    P(0, -1, g.M); P(0, -2, g.M); P(0, -3, g.M); P(-1, -4, g.L); P(-2, -4, g.L); P(1, -4, g.L); P(2, -5, g.L);
    return;
  }
  const S = (n: number) => Math.max(2, Math.round(n * k));
  switch (s.form) {
    case 'grass': {
      const n = s.species === 'microgreens' ? 7 : 4;
      for (let i = 0; i < n; i++) {
        const x0 = Math.round((i - (n - 1) / 2) * (s.species === 'microgreens' ? 1 : 2));
        const h = S((s.species === 'microgreens' ? 5 : 11) + hash(seed + i) * 3);
        for (let y = 1; y <= h; y++) P(x0 + (droop && y > h / 2 ? Math.round((y - h / 2) / 2) : 0) + (y > h * 0.7 && i % 2 ? 1 : 0), -y, y > h - 2 ? g.L : i % 2 ? g.M : g.D);
        if (s.species === 'microgreens' && !dead) { P(x0 - 1, -h, g.L); P(x0 + 1, -h, g.L); }
      }
      break;
    }
    case 'rosette': {
      const r = S(6);
      for (let y = -r; y <= 0; y++) for (let x = -r - 1; x <= r + 1; x++) {
        const d = (x * x) / ((r + 1) * (r + 1)) + (y * y) / (r * r);
        if (d > 1) continue;
        const curl = hash(seed + x * 3 + y * 7) > 0.75;
        P(x, y - 1 + droop * (Math.abs(x) > r / 2 ? 1 : 0), curl ? g.L : (x === 0 || Math.abs(x) === Math.round(r / 2)) ? g.D : g.M);
      }
      break;
    }
    case 'blades': {
      const xs = [-3, -1, 1, 3];
      xs.forEach((x0, i) => {
        const h = S(12 + (i % 2) * 3);
        for (let y = 1; y <= h; y++) {
          const x = x0 + (droop ? Math.round(y / 4) * Math.sign(x0) : 0);
          P(x, -y, y % 3 === 0 ? g.L : g.D);
          if (y < h - 1 && !dead) P(x + (x0 < 0 ? -1 : 1), -y, [202, 178, 60]);
        }
      });
      break;
    }
    case 'trailing': {
      for (const dir of [-1, 1]) {
        for (let j = 0; j < S(10); j++) {
          const x = dir * (3 + Math.round(j * 0.35)), y = -2 + j;
          P(x, y, j % 2 ? g.M : g.D);
          if (j % 2 === 0) { P(x + dir, y, g.L); P(x + dir, y - 1, g.M); }
        }
      }
      for (let y = 1; y <= S(5); y++) { P(0, -y, g.M); if (y % 2) { P(-1, -y, g.L); P(1, -y - 1, g.L); } }
      break;
    }
    case 'lily': {
      for (const [dx, h] of [[-3, 8], [-1, 10], [1, 11], [3, 8]] as const) {
        const hh = S(h);
        for (let y = 1; y <= hh; y++) P(dx + Math.round((droop ? y / 3 : y / 8) * Math.sign(dx)), -y, y > hh - 3 ? g.L : g.M);
      }
      if (open) { const y0 = -S(13); P(0, y0, petal); P(0, y0 - 1, petal); P(1, y0, petal); P(0, y0 - 2, petal); P(1, y0 + 1, centre); P(0, y0 + 1, g.D); P(0, y0 + 2, g.D); }
      break;
    }
    case 'cactus': {
      for (const dir of [-1, 0, 1]) {
        let x = 0, y = -1;
        for (let seg = 0; seg < 3; seg++) {
          for (let j = 0; j < 3; j++) { P(x, y, j === 1 ? g.L : g.D); P(x + (dir || 1), y, g.M); y -= 1; x += dir; }
          y += droop;
        }
        if (open) { P(x, y, petal); P(x + dir, y - 1, petal); P(x, y - 1, centre); }
      }
      break;
    }
    case 'shrub': {
      for (let i = -3; i <= 3; i++) {
        const h = S(9 + (3 - Math.abs(i)) * 1.3);
        for (let y = 1; y <= h; y++) {
          const x = i + (droop && y > 3 ? Math.sign(i || 1) : 0) + (y > h / 2 && i !== 0 ? Math.sign(i) : 0);
          P(x, -y, y % 2 ? g.M : g.D);
          if (y % 3 === 0) P(x + (i < 0 ? -1 : 1), -y, g.L);
        }
        if (open) { const tip = -h - 1; P(i + Math.sign(i), tip, petal); P(i + Math.sign(i), tip - 1, petal); if (i % 2) P(i + Math.sign(i), tip - 2, mix(petal, [255, 255, 255], 0.3)); }
      }
      break;
    }
    case 'tall': {
      const h = S(24);
      for (let y = 1; y <= h; y++) P(Math.round(droop * y / 5), -y, g.D);
      for (const [yy, dir] of [[7, -1], [12, 1], [17, -1]] as const) {
        const y = -Math.round(yy * k);
        for (let j = 1; j <= 4; j++) { P(dir * j, y - Math.round(j / 2) + droop * j, j === 4 ? g.L : g.M); P(dir * j, y - Math.round(j / 2) + 1 + droop * j, g.D); }
      }
      if (open || s.stage === 'fruit' || s.stage === 'spent') {
        const cx = Math.round(droop * h / 5), cy = -h - 3;
        for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
          const d = x * x + y * y;
          if (d <= 4) P(cx + x, cy + y, s.stage === 'fruit' || s.stage === 'spent' ? hex('#57341f') : centre);
          else if (d <= 16 && s.stage !== 'spent' && (x + y) % 2 === 0) P(cx + x, cy + y, petal);
          else if (d <= 13 && s.stage !== 'spent') P(cx + x, cy + y, mix(petal, [180, 120, 0], 0.25));
        }
      }
      break;
    }
    case 'flower': {
      for (let x = -3; x <= 3; x++) { P(x, -1, g.D); if (Math.abs(x) < 3) P(x, -2, g.M); if (Math.abs(x) === 1) P(x, -3, g.L); }
      if (open) for (const [fx, fy] of [[-2, -5], [2, -6]] as const) {
        P(fx - 1, fy, petal); P(fx + 1, fy, petal); P(fx, fy - 1, petal); P(fx - 1, fy - 1, petal); P(fx + 1, fy - 1, petal);
        P(fx, fy, centre); P(fx, fy + 1, mix(petal, [0, 0, 0], 0.3)); P(fx, fy + 2, g.D);
      }
      break;
    }
    case 'vine': {
      const h = S(18);
      for (let y = 1; y <= h + 2; y++) P(3, -y, hex('#8b6b3d'));                       // the stake
      for (let y = 1; y <= h; y++) {
        const x = Math.round(Math.sin(y * 0.6) * 1.2) + Math.round(droop * y / 5);
        P(x, -y, g.D);
        if (y % 3 === 0) { P(x - 1, -y, g.M); P(x - 2, -y + 1, g.L); P(x + 1, -y - 1, g.M); P(x + 2, -y - 1, g.L); }
      }
      if (open) { P(-1, -h + 2, petal); P(1, -h + 5, petal); }
      if (s.stage === 'fruit' && fruitC && !dead) for (const [fx, fy] of [[-2, -6], [1, -10], [-1, -13]] as const) {
        P(fx, fy, fruitC); P(fx + 1, fy, fruitC); P(fx, fy + 1, fruitC); P(fx + 1, fy + 1, mix(fruitC, [0, 0, 0], 0.25)); P(fx, fy - 1, g.D);
      }
      break;
    }
    default: {   // herb: a bushy stem with leaf pairs
      const h = S(12);
      for (let y = 1; y <= h; y++) P(Math.round(droop * y / 4), -y, g.D);
      for (let y = 2; y <= h; y += 2) {
        const off = Math.round(droop * y / 4), sag = droop;
        P(off - 1, -y + sag, g.M); P(off - 2, -y + sag, g.L); P(off - 2, -y - 1 + sag * 2, g.M);
        P(off + 1, -y + sag, g.M); P(off + 2, -y + sag, g.L); P(off + 2, -y - 1 + sag * 2, g.M);
        if (y > 3 && y < h - 1) { P(off - 3, -y + 1 + sag, g.M); P(off + 3, -y + 1 + sag, g.M); }
      }
      if (open) { P(0, -h - 1, petal); P(-1, -h - 2, petal); P(1, -h - 2, petal); P(0, -h - 3, petal); }
      if (s.stage === 'fruit' && fruitC && !dead) { P(-3, -5, fruitC); P(-3, -4, fruitC); P(3, -7, fruitC); P(3, -6, fruitC); P(-2, -9, fruitC); }
    }
  }
}

function pot(b: Buf, x: number, y: number, water: number | undefined) {
  // a 40 cm pot: rim, then a tapering body, sitting on whatever is under it (y = soil top)
  const clay: RGB = [194, 88, 46], dark: RGB = [146, 60, 30], rim: RGB = [222, 120, 70];
  for (let i = -4; i <= 4; i++) b.set(x + i, y + 1, i > 2 ? dark : rim);
  for (let j = 0; j < 4; j++) {
    const half = 3 - Math.floor(j / 2);
    for (let i = -half; i <= half; i++) b.set(x + i, y + 2 + j, i >= half - 1 ? dark : clay);
  }
  soil(b, x - 3, y, 7, 1, water);
}

function soil(b: Buf, x: number, y: number, w: number, h: number, water: number | undefined) {
  const wet = water ?? 0.35;
  const c: RGB = [Math.round(125 - wet * 78), Math.round(90 - wet * 55), Math.round(58 - wet * 34)];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) b.set(x + i, y + j, dith(x + i, y + j, 0.2) ? mix(c, [0, 0, 0], 0.2) : c);
}

function bed(b: Buf, cx: number, y: number, w: number, water: number | undefined, snow: boolean) {
  const x = cx - Math.floor(w / 2);
  const wood: RGB = [139, 90, 43], dark: RGB = [96, 60, 28], light: RGB = [176, 122, 66];
  soil(b, x + 1, y, w - 2, 2, water);
  if (snow) for (let i = 1; i < w - 1; i++) if (hash(i + cx) > 0.3) b.set(x + i, y, [241, 245, 249]);
  for (let j = 0; j < 7; j++) for (let i = 0; i < w; i++) {
    const c = j === 0 ? light : j === 3 ? dark : (i === 0 || i === w - 1) ? dark : wood;
    b.set(x + i, y + 2 + j, dith(x + i, y + j, 0.08) ? dark : c);
  }
}

function bedLow(b: Buf, cx: number, y: number, w: number, water: number | undefined, snow: boolean) {
  const x = cx - Math.floor(w / 2);
  soil(b, x + 1, y, w - 2, 1, water);
  if (snow) for (let i = 1; i < w - 1; i++) if (hash(i + cx) > 0.3) b.set(x + i, y, [241, 245, 249]);
  for (let j = 0; j < 4; j++) for (let i = 0; i < w; i++) b.set(x + i, y + 1 + j, j === 0 ? [176, 122, 66] : (i === 0 || i === w - 1 || j === 3) ? [96, 60, 28] : [139, 90, 43]);
}

// ── sprites ────────────────────────────────────────────────────────────────
const DEL_IDLE = [
  '.....hhh.....',
  '....hhhhh....',
  '....vvvvv....',
  '....hhhhh....',
  '.....hhh.....',
  '......n......',
  '...kkkkkkk...',
  '..kkktkkkkk..',
  '..kkkktkkkk..',
  '..kk.kkkk.kk.',
  '..kk.kkkk.kk.',
  '..kk.kkkk.kk.',
  '..s..kkkk..s.',
  '....kkkkk....',
  '....kkkkk....',
  '....kk.kk....',
  '....kk.kk....',
  '....ll.ll....',
  '....ll.ll....',
  '....ll.ll....',
  '....ll.ll....',
  '....bb.bb....',
];
const DEL_WALK = [
  ...DEL_IDLE.slice(0, 15),
  '....kk.kk....',
  '...kk...kk...',
  '...ll...ll...',
  '..ll.....ll..',
  '..ll.....ll..',
  '.ll.......ll.',
  '.bb.......bb.',
];

function delamain(b: Buf, d: NonNullable<PWorld['delamain']>, t: number) {
  const frame = d.walking && Math.floor(t * 6) % 2 ? DEL_WALK : DEL_IDLE;
  const x0 = Math.round(d.x) - 6, y0 = Math.round(d.y) - frame.length;
  const pulse = 0.75 + 0.25 * Math.sin(t * 3);
  b.glow(Math.round(d.x), y0 + 10, 16, [34, 211, 238], 0.15 * pulse);
  const col: Record<string, RGB> = {
    h: [15, 23, 42], v: mix([34, 211, 238], [207, 250, 254], pulse - 0.5), k: [21, 94, 117], t: [34, 211, 238],
    n: [30, 41, 59], s: [14, 116, 144], l: [12, 74, 110], b: [2, 6, 23],
  };
  b.rect(x0 + 3, y0 + frame.length, 7, 1, [0, 0, 0], 0.35);
  frame.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    b.set(x0 + (d.facing < 0 ? 12 - x : x), y0 + y, col[ch]);
  }));
  const hand = { x: x0 + (d.facing < 0 ? 1 : 11), y: y0 + 12 };
  if (d.doing === 'water') {
    const dir = d.facing < 0 ? -1 : 1, cx = hand.x + (dir < 0 ? -4 : 1);
    b.rect(cx, hand.y - 1, 4, 3, [100, 116, 139]); b.set(cx + (dir < 0 ? -1 : 4), hand.y - 2, [100, 116, 139]); b.set(cx + (dir < 0 ? -2 : 5), hand.y - 3, [100, 116, 139]);
    for (let k = 0; k < 3; k++) b.set(cx + (dir < 0 ? -2 : 5), hand.y - 2 + ((t * 18 + k * 4) % 10), [125, 211, 252]);
  }
  if (d.doing === 'harvest') { b.rect(hand.x - 1, hand.y, 4, 3, [161, 98, 7]); b.set(hand.x, hand.y - 1, [74, 222, 128]); b.set(hand.x + 1, hand.y - 1, [74, 222, 128]); }
}

function cat(b: Buf, c: NonNullable<PWorld['cat']>, t: number) {
  // a cat about 35 cm high sitting: five pixels, as it should be next to him
  const at = CAT_SPOT[c.where || 'inside'] || CAT_SPOT.inside;
  const fur: RGB = [41, 37, 36], light: RGB = [87, 83, 78], eye: RGB = [250, 204, 21];
  const asleep = /asleep|curled/.test(c.doing || '');
  const x = at.x, y = at.y;
  if (asleep) {
    for (let i = -3; i <= 3; i++) for (let j = -2; j <= 0; j++) if (!(Math.abs(i) === 3 && j === -2)) b.set(x + i, y + j, j === -2 ? light : fur);
    b.set(x + 2, y - 3, fur); b.set(x + 4, y - 3, fur); b.rect(x + 2, y - 2, 3, 2, fur);
    b.set(x - 4, y, fur); b.set(x - 4, y - 1, fur);
    const z = Math.floor(t * 1.5) % 3;
    b.set(x + 5 + z, y - 5 - z, [226, 232, 240], 0.8);
  } else {
    const rows = ['k.k.', 'kkk.', 'yky.', 'kkkk', 'kkkk'];
    rows.forEach((r, j) => [...r].forEach((ch, i) => {
      if (ch === '.') return;
      b.set(x + i - 2, y - rows.length + j, ch === 'y' ? (Math.floor(t * 0.7) % 7 === 0 ? fur : eye) : j === 3 ? light : fur);
    }));
    const swish = Math.round(Math.sin(t * 2.4) * 1.5);
    for (let j = 0; j < 4; j++) b.set(x + 2 + Math.round(j / 2) + (j > 1 ? swish : 0), y - 1 - j, fur);
  }
}

// ── the whole frame ────────────────────────────────────────────────────────
export function render(ctx: CanvasRenderingContext2D, w: PWorld, t: number) {
  const b = new Buf();
  sky(b, w, t);
  const snowing = w.snow > 0, raining = w.rain > 0, frosty = w.temp < 0, cold = w.temp < 6;
  const night = !w.isDay;
  // the field to the foothills, then the ground
  for (let y = 116; y < WH; y++) for (let x = 0; x < W; x++) {
    let c: RGB;
    if (snowing) c = dith(x, y, 0.15) ? [226, 232, 240] : [248, 250, 252];
    else if (cold) c = dith(x, y, 0.35 + (frosty ? 0.2 : 0)) ? (frosty ? [196, 204, 196] : [138, 128, 82]) : [118, 110, 70];
    else c = dith(x, y, 0.4) ? [101, 140, 54] : [77, 124, 15];
    if (y >= 156) c = mix(c, [74, 54, 36], 0.45);
    b.set(x, y, c);
  }
  // a pine, about 3.5 m
  for (let j = 0; j < 44; j++) {
    const half = Math.floor(j / 3.4);
    for (let i = -half; i <= half; i++) b.set(250 + i, 110 + j, dith(250 + i, 110 + j, 0.3) ? [21, 83, 45] : [20, 60, 38]);
    if (snowing && j % 7 === 0) for (let i = -half; i <= half; i++) b.set(250 + i, 110 + j, [241, 245, 249]);
  }
  b.rect(249, 154, 3, 4, [87, 60, 36]);
  // fence, about 1.1 m
  for (let x = 178; x < 246; x += 8) { b.rect(x, 143, 2, 14, [120, 113, 108]); b.set(x, 142, [150, 143, 138]); }
  b.rect(178, 146, 68, 1, [120, 113, 108]); b.rect(178, 151, 68, 1, [120, 113, 108]);
  // outdoor beds, 25 cm
  for (let i = 8; i < 11; i++) bedLow(b, SPOTS[i].x, SPOTS[i].y, 20, w.spots[i]?.water, snowing);
  // ── the greenhouse: 2.2 m walls, a 3.6 m ridge ──
  const gx0 = 86, gx1 = 168, eaveY = 125, peakY = 108, gcx = (gx0 + gx1) / 2;
  const roofAt = (x: number) => (x < gcx ? eaveY - (x - gx0) / (gcx - gx0) * (eaveY - peakY) : peakY + (x - gcx) / (gx1 - gcx) * (eaveY - peakY));
  for (let y = 153; y < WH; y++) for (let x = gx0 + 1; x < gx1; x++) b.set(x, y, dith(x, y, 0.45) ? [168, 162, 158] : [120, 113, 108]);
  for (let i = 5; i < 8; i++) bed(b, SPOTS[i].x, SPOTS[i].y, 22, w.spots[i]?.water, false);
  b.rect(158, 144, 10, 2, [139, 90, 43]); b.rect(159, 146, 1, 7, [96, 60, 28]); b.rect(166, 146, 1, 7, [96, 60, 28]);   // bench
  // ── the house: a 3 m room under a pitched roof ──
  const hx1 = 78, ceil = 112, floor = 150;
  const wall: RGB = night ? [58, 44, 36] : [107, 79, 58], plank: RGB = night ? [44, 33, 27] : [86, 62, 45];
  for (let y = ceil; y < floor; y++) for (let x = 0; x < hx1; x++) {
    if (x >= 34 && x < 67 && y >= 118 && y < 135) continue;          // the window onto the real sky
    b.set(x, y, (y - ceil) % 6 === 0 ? plank : (x + Math.floor((y - ceil) / 6) * 13) % 29 === 0 ? plank : wall);
  }
  for (let x = -6; x <= hx1 + 6; x++) {                                // the roof
    const top = 94 + Math.abs(x - 39) * 0.42;
    for (let y = Math.floor(top); y < ceil; y++) b.set(x, y, (Math.floor(y) + (x % 4 < 2 ? 0 : 1)) % 3 === 0 ? [92, 38, 30] : [127, 52, 40]);
    b.set(x, Math.floor(top), [160, 72, 54]);
    if (snowing) { b.set(x, Math.floor(top) - 1, [248, 250, 252]); b.set(x, Math.floor(top), [241, 245, 249]); }
  }
  b.rect(58, 92, 6, 10, [87, 83, 78]); b.rect(57, 91, 8, 2, [68, 64, 60]);       // chimney
  b.rect(0, ceil, hx1, 2, [74, 50, 34]);                                          // ceiling beam
  b.rect(hx1, ceil, 2, floor - ceil, [41, 30, 24]);
  for (let x = 33; x < 68; x++) { b.set(x, 117, [231, 229, 228]); }
  for (let y = 117; y < 136; y++) { b.set(33, y, [231, 229, 228]); b.set(67, y, [214, 211, 209]); b.set(50, y, [231, 229, 228]); }
  for (let x = 33; x < 68; x++) b.set(x, 126, [231, 229, 228]);
  for (let y = 115; y < 140; y++) for (let x = 29; x < 33; x++) b.set(x, y, (x + y) % 4 === 0 ? [127, 29, 29] : [185, 28, 28]);   // curtains
  for (let y = 115; y < 140; y++) for (let x = 68; x < 72; x++) b.set(x, y, (x + y) % 4 === 0 ? [127, 29, 29] : [185, 28, 28]);
  b.rect(28, 115, 45, 1, [87, 60, 36]);
  b.rect(31, 138, 39, 2, [214, 211, 209]); b.rect(31, 140, 39, 1, [160, 156, 152]);   // the sill, 95 cm
  // the grow-light table, 90 cm, with the lamp hanging from the ceiling
  const lightOn = w.growLight && w.hour >= 6 && w.hour < 20;
  b.rect(3, 140, 27, 2, [139, 90, 43]); b.rect(3, 142, 27, 1, [96, 60, 28]);
  b.rect(4, 143, 2, 7, [96, 60, 28]); b.rect(27, 143, 2, 7, [96, 60, 28]);
  b.rect(8, 114, 1, 8, [68, 64, 60]); b.rect(24, 114, 1, 8, [68, 64, 60]);
  b.rect(5, 122, 23, 2, lightOn ? [245, 208, 254] : [87, 83, 78]); b.rect(5, 121, 23, 1, [68, 64, 60]);
  // the floor and a rug
  for (let y = floor; y < WH; y++) for (let x = 0; x < hx1; x++) b.set(x, y, x % 10 === 0 || y === floor ? [52, 36, 27] : (night ? [58, 42, 31] : [92, 64, 45]));
  for (let y = 151; y < 154; y++) for (let x = 44; x < 74; x++) b.set(x, y, (x + y) % 3 === 0 ? [180, 83, 9] : (y === 151 || y === 153) ? [120, 53, 15] : [154, 52, 18]);
  // pots and plants
  for (let i = 0; i < 5; i++) pot(b, SPOTS[i].x, SPOTS[i].y, w.spots[i]?.water);
  w.spots.forEach((s, i) => { if (SPOTS[i]) plant(b, s, SPOTS[i].x, SPOTS[i].y - 1, SPOTS[i].pot ? 0.6 : 0.9, t, s.place === 'outdoors'); });
  if (lightOn) for (let y = 124; y < 141; y++) {
    const f = (y - 124) / 17, half = 12 + f * 4;
    for (let x = Math.round(16 - half); x <= Math.round(16 + half); x++) {
      const edge = 1 - Math.abs(x - 16) / half;
      if (dith(x, y, 0.35 + 0.5 * edge * (1 - f))) b.set(x, y, [240, 171, 252], 0.16 * (1 - f * 0.5));
    }
  }
  // greenhouse frame and glass, in front of what grows inside
  for (let y = peakY; y < 153; y++) for (let x = gx0; x <= gx1; x++) {
    const top = roofAt(x);
    if (y < top) continue;
    const post = x === gx0 || x === gx1 || (x - gx0) % 20 === 0;
    const edge = Math.abs(y - top) < 1;
    if (post || edge || y === eaveY || y === 140) b.set(x, y, night ? [148, 163, 184] : [241, 245, 249], post || edge ? 1 : 0.8);
    else {
      b.set(x, y, [186, 230, 253], 0.1);
      if ((x + y) % 19 === 0 || (x + y + 1) % 19 === 0) b.set(x, y, [255, 255, 255], 0.22);
    }
  }
  if (snowing) for (let x = gx0; x <= gx1; x++) { const top = roofAt(x); b.set(x, top - 1, [248, 250, 252]); b.set(x, top - 2, [241, 245, 249], 0.7); }
  b.rect(gcx, peakY + 1, 1, 6, [87, 83, 78]); b.rect(gcx - 1, peakY + 7, 3, 2, night ? [253, 230, 138] : [168, 162, 158]);
  if (w.cat?.here) cat(b, w.cat, t);
  if (night) {
    for (let y = 0; y < WH; y++) for (let x = 0; x < W; x++) if (y >= 108 || (x < 84 && y >= 90 + Math.abs(x - 39) * 0.42)) b.set(x, y, [6, 8, 24], 0.42);
    b.glow(gcx, peakY + 9, 20, [253, 224, 138], 0.3);
    b.glow(40, 132, 34, [251, 191, 36], 0.13);
    if (lightOn) b.glow(16, 130, 18, [232, 121, 249], 0.24);
  } else if (w.hour < 8 || w.hour > 16) {
    for (let y = 108; y < WH; y++) for (let x = 0; x < W; x++) b.set(x, y, [251, 146, 60], 0.06);
  }
  if (w.delamain) delamain(b, w.delamain, t);
  if (raining || snowing) {
    const n = snowing ? 70 : 50 + Math.min(80, w.rain * 40);
    for (let k = 0; k < n; k++) {
      const x0 = hash(k) * (W + 40), sp = snowing ? 9 + hash(k + 5) * 6 : 120 + hash(k + 5) * 40;
      const y = YOFF + ((hash(k + 9) * H + t * sp) % (H + 10)) - 5;
      const x = (x0 - (snowing ? Math.sin(t + k) * 3 : y * 0.25)) % W;
      if (x < 82 && y > 90) continue;                    // not through the house
      if (snowing) b.set(x, y, [255, 255, 255], 0.9);
      else { b.set(x, y, [147, 197, 253], 0.55); b.set(x - 0.5, y + 1, [147, 197, 253], 0.45); b.set(x - 1, y + 2, [147, 197, 253], 0.3); }
    }
  }
  ctx.putImageData(new ImageData(b.d, W, H), 0, 0);
}
