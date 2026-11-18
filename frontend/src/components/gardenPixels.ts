// Pixel-art renderer for his garden: a 256x160 frame drawn pixel by pixel into an ImageData buffer
// (everything is redrawn each frame, about ten times a second), then scaled up crisply in the page.
// The house with its south window, grow-light shelf and his bed, the greenhouse, the outdoor beds and
// the pond past the pine, under the real sky; every plant drawn by its kind and stage; the cat; whoever
// has come by; and Delamain while he is there (asleep in his bed at night).

export const W = 320, H = 120;          // the canvas: the lower part of a 320x160 world
const WH = 160, YOFF = 40;

export type PSpot = {
  id: number; place: string; species: string | null; stage: string; health?: number; dormant?: boolean;
  struggle?: string[]; water?: number; form?: string; petal?: string; centre?: string; fruit?: string | null;
};
export type PWorld = {
  hour: number; isDay: boolean; cloud: number; rain: number; snow: number; temp: number;
  growLight: boolean; spots: PSpot[];
  cat: { here: boolean; where?: string; doing?: string } | null;
  delamain: { x: number; y: number; walking: boolean; doing: string; facing: number; lying?: boolean; stride?: number } | null;
  pond: { ice: number; waterT: number };
  guest: { name: string; kind: string; talking: boolean } | null;
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
// where he goes for the other things he does (x + 7 is where he stands, as for the spots)
export const BED_STAND = { x: 40, y: 157 }, POND_STAND = { x: 271, y: 147 }, TALK_STAND = { x: 172, y: 160 };
export const GUEST_AT = { x: 192, y: 160 };
const BED = { x0: 36, x1: 63, top: 146 };
const MOON = { x: 236, y: 54 };

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
  const base = skyStops(w.hour);
  const stops: RGB[] = [];
  for (let i = 0; i < (base.length - 1) * 4; i++) { const f = i / 4, k = Math.floor(f); stops.push(mix(base[k], base[k + 1], f - k)); }
  stops.push(base[base.length - 1]);
  const grey = Math.max(0, (w.cloud - 50) / 50);
  const greyC: RGB = w.isDay ? [148, 163, 184] : [30, 34, 48];
  for (let y = YOFF; y < 122; y++) {
    const f = ((y - YOFF) / (122 - YOFF)) * (stops.length - 1), k = Math.floor(f), fr = f - k;
    const a = stops[Math.min(k, stops.length - 1)], c = stops[Math.min(k + 1, stops.length - 1)];
    const lo = mix(a, greyC, grey * 0.6), hi = mix(c, greyC, grey * 0.6);
    for (let x = 0; x < W; x++) b.set(x, y, dith(x, y, fr) ? hi : lo);
  }
  if (!w.isDay) {
    for (let k = 0; k < 88; k++) {
      const x = Math.floor(hash(k) * W), y = YOFF + Math.floor(hash(k + 99) * 58);
      const tw = 0.5 + 0.5 * Math.sin(t * (1 + hash(k + 7) * 2) + k);
      b.set(x, y, [255, 255, 240], (1 - w.cloud / 100) * (0.35 + 0.65 * tw));
    }
    const mx = MOON.x, my = MOON.y;   // a crescent moon
    b.glow(mx, my, 14, [200, 210, 255], 0.25 * (1 - w.cloud / 120));
    for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
      if (x * x + y * y <= 36 && (x - 3) * (x - 3) + (y + 2) * (y + 2) > 26) b.set(mx + x, my + y, x < -3 ? [226, 232, 240] : [248, 250, 252]);
    }
  } else {
    const st = Math.max(0, Math.min(1, (w.hour - 6.8) / 10));
    const sx = 60 + st * 220, sy = 90 - Math.sin(st * Math.PI) * 36;
    const vis = 1 - w.cloud / 130;
    b.glow(sx, sy, 16, [255, 240, 180], 0.28 * vis);
    b.disc(sx, sy, 5, [253, 224, 71], vis);
    b.disc(sx - 1, sy - 1, 3, [254, 249, 195], vis);
  }
  // clouds: pixel blobs, lit from above
  const n = Math.round(w.cloud / 14);
  for (let k = 0; k < n; k++) {
    const speed = 1.2 + hash(k + 3) * 1.5;
    const cx = ((hash(k) * (W + 60) + t * speed) % (W + 60)) - 30, cy = YOFF + 6 + hash(k + 50) * 30;
    const golden = w.isDay && (w.hour < 8.5 || w.hour > 15.3);
    const lit: RGB = w.isDay ? (grey > 0.5 ? [203, 213, 225] : golden ? [255, 214, 170] : [248, 250, 252]) : [71, 85, 105];
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
  // mountains: a hazy distant range, the far range with snow, then the near foothills
  const far: RGB = w.isDay ? [100, 116, 139] : [30, 36, 56], farSnow: RGB = w.isDay ? [241, 245, 249] : [120, 130, 160];
  const near: RGB = w.isDay ? [71, 85, 105] : [22, 26, 42];
  const horizon = stops[stops.length - 1];
  for (let x = 0; x < W; x++) {
    const hd = 86 + Math.sin(x * 0.021 + 4) * 7 + Math.sin(x * 0.083) * 3;
    for (let y = Math.floor(hd); y < 122; y++) b.set(x, y, mix(far, horizon, 0.55));
    if (hd < 84) for (let y = Math.floor(hd); y < hd + 2; y++) b.set(x, y, mix(farSnow, horizon, 0.4));
  }
  for (let x = 0; x < W; x++) {
    const hf = 92 + Math.sin(x * 0.045) * 9 + Math.sin(x * 0.13 + 1) * 4 + Math.sin(x * 0.31) * 1.5;
    for (let y = Math.floor(hf); y < 122; y++) b.set(x, y, y < hf + 3 + Math.sin(x * 0.5) && hf < 90 ? farSnow : far);
    const hn = 108 + Math.sin(x * 0.03 + 2) * 5 + Math.sin(x * 0.11) * 2;
    for (let y = Math.floor(hn); y < 122; y++) b.set(x, y, dith(x, y, 0.15) ? far : near);
  }
  // air between here and the mountains: haze, thickest at the horizon
  for (let y = 88; y < 122; y++) {
    const a = ((y - 88) / 34) * (w.isDay ? 0.26 : 0.2);
    for (let x = 0; x < W; x++) b.set(x, y, horizon, a);
  }
  // a treeline along the edge of the field
  const tree: RGB = w.isDay ? [36, 64, 44] : [12, 20, 18];
  for (let x = 0; x < W; x++) {
    const h = 2 + Math.floor(hash(x * 0.7) * 4) + (hash(Math.floor(x / 5)) > 0.5 ? 2 : 0);
    for (let j = 0; j < h; j++) if (Math.abs((x % 5) - 2) <= (h - j) / 2.2) b.set(x, 117 - j, mix(tree, horizon, 0.25));
  }
  // birds by day, a shooting star now and then by night
  if (w.isDay && w.cloud < 85) for (let k = 0; k < 3; k++) {
    const bx = ((t * (6 + k) + k * 70) % (W + 40)) - 20, by = 60 + k * 6 + Math.sin(t * 0.8 + k) * 2;
    const up = Math.floor(t * 5 + k) % 2 === 0;
    const c: RGB = [30, 41, 59];
    b.set(bx, by, c); b.set(bx - 1, by + (up ? -1 : 0), c); b.set(bx + 1, by + (up ? -1 : 0), c);
    b.set(bx - 2, by + (up ? -1 : 1), c); b.set(bx + 2, by + (up ? -1 : 1), c);
  }
  if (!w.isDay && w.cloud < 60) {
    const ph = (t % 19) / 19;
    if (ph < 0.07) {
      const f = ph / 0.07, x0 = 40 + hash(Math.floor(t / 19)) * 150, y0 = 44 + hash(Math.floor(t / 19) + 1) * 20;
      for (let k = 0; k < 9; k++) b.set(x0 + f * 40 - k, y0 + f * 14 - k * 0.35, [255, 255, 255], (1 - k / 9) * (1 - f));
    }
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
// His poses, built from the upper body over different legs. Facing right; mirrored to face left.
// l = the near leg, L = the far leg (darker), so a stride reads as one leg passing the other.
const UPPER = DEL_IDLE.slice(0, 15);
const LEGS: Record<string, string[]> = {
  stand:   DEL_IDLE.slice(15),
  contact: ['....kkkkk....', '....kk.kk....', '...LL...ll...', '...LL...ll...', '..LL.....ll..', '..LL.....ll..', '.BB.......bbb'],
  pass:    ['....kkkkk....', '....kk.kk....', '....ll.LL....', '....ll.LL....', '....ll.LL....', '....ll..LL...', '....bb...BB..'],
};
const swapLegs = (rows: string[]) => rows.map(r => r.replace(/[lLbB]/g, c => ({ l: 'L', L: 'l', b: 'B', B: 'b' } as Record<string, string>)[c]));
const WALK = [LEGS.contact, LEGS.pass, swapLegs(LEGS.contact), swapLegs(LEGS.pass)];
const SEAT = ['....kkkkkllbb'];                                       // sitting on the ground, legs out in front
const CROUCH = ['....kkkkkkk..', '....kk...ll..', '....LL...ll..', '...BBB...bbb.'];   // down on his heels to tend something

function delamain(b: Buf, d: NonNullable<PWorld['delamain']>, t: number) {
  const pose = d.walking ? 'walk' : d.doing === 'sit' || d.doing === 'sit_with_cat' ? 'sit'
    : d.doing === 'plant' || d.doing === 'harvest' || d.doing === 'clear' ? 'crouch' : 'stand';
  // the frame: the stride follows the distance walked, so his feet do not slide
  const phase = Math.floor((d.stride ?? t * 8) / 3.2) % 4;
  const rows: string[][] = Array.from({ length: 22 }, () => [...'.............']);
  const put = (src: string[], at: number) => src.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.' && at + j >= 0 && at + j < 22) rows[at + j][i] = ch; }));
  let upperAt = 0;
  if (pose === 'walk') { put(WALK[phase], 15); upperAt = phase % 2 === 0 ? 1 : 0; }
  else if (pose === 'sit') { put(SEAT, 21); upperAt = 6; }
  else if (pose === 'crouch') { put(CROUCH, 18); upperAt = 3; }
  else put(LEGS.stand, 15);
  put(UPPER, upperAt);
  // hands: where his near hand is depends on what he is doing
  const H = (x: number, y: number) => { if (y >= 0 && y < 22) rows[y][x] = 's'; };
  const clearHand = () => { const y = upperAt + 12; if (y < 22) rows[y][11] = rows[y][11] === 's' ? '.' : rows[y][11]; };
  if (pose === 'walk') {                                    // arms swing against the legs
    clearHand(); const y = upperAt + 12;
    H(phase === 0 ? 12 : phase === 2 ? 10 : 11, y - (phase === 0 ? 1 : 0));
  } else if (d.doing === 'talk' && Math.floor(t * 0.8) % 3 === 0) {   // a gesture now and then as he talks
    clearHand(); H(12, upperAt + 9); H(11, upperAt + 10);
  } else if (pose === 'crouch') {                           // working the soil
    clearHand(); H(12, upperAt + 13 + (Math.floor(t * 3) % 2));
  } else if (d.doing === 'sit_with_cat') {                  // a hand on the cat, stroking
    clearHand(); H(12 + (Math.floor(t * 1.2) % 2), upperAt + 13);
  }
  if (Math.floor(t * 0.45) % 7 === 0 && (t * 0.45) % 1 < 0.08) rows[2] = rows[2].map(c => (c === 'v' ? 'h' : c));   // he blinks
  const x0 = Math.round(d.x) - 6, y0 = Math.round(d.y) - 22;
  const pulse = 0.75 + 0.25 * Math.sin(t * 3);
  b.glow(Math.round(d.x), y0 + 10 + upperAt, 16, [34, 211, 238], 0.15 * pulse);
  const col: Record<string, RGB> = {
    h: [15, 23, 42], v: mix([34, 211, 238], [207, 250, 254], pulse - 0.5), k: [21, 94, 117], t: [34, 211, 238],
    n: [30, 41, 59], s: [14, 116, 144], l: [12, 74, 110], L: [8, 50, 76], b: [2, 6, 23], B: [2, 4, 14],
  };
  b.rect(x0 + 3, y0 + 22, pose === 'sit' ? 10 : 7, 1, [0, 0, 0], 0.35);
  const fx = (x: number) => x0 + (d.facing < 0 ? 12 - x : x);
  rows.forEach((row, y) => row.forEach((ch, x) => { if (ch !== '.') b.set(fx(x), y0 + y, col[ch]); }));
  const dir = d.facing < 0 ? -1 : 1;
  const hand = { x: fx(11), y: y0 + upperAt + 12 };
  if (d.doing === 'water') {                                // the can tips forward and back as he pours
    const tip = Math.sin(t * 2) > 0 ? 1 : 0, cx = hand.x + (dir < 0 ? -4 : 1);
    b.rect(cx, hand.y - 1, 4, 3, [100, 116, 139]); b.set(cx + (dir < 0 ? -1 : 4), hand.y - 2 + tip, [100, 116, 139]); b.set(cx + (dir < 0 ? -2 : 5), hand.y - 3 + tip * 2, [100, 116, 139]);
    if (tip) for (let k = 0; k < 4; k++) b.set(cx + (dir < 0 ? -2 : 5) + (k % 2) * dir, hand.y + ((t * 18 + k * 3) % 9), [125, 211, 252]);
  }
  if (d.doing === 'harvest') { b.rect(hand.x - (dir < 0 ? 4 : -1), hand.y + 2, 4, 3, [161, 98, 7]); b.set(hand.x + dir, hand.y + 1, [74, 222, 128]); b.set(hand.x + dir * 2, hand.y + 1, [74, 222, 128]); }
  if (d.doing === 'plant') { b.set(hand.x + dir, hand.y + 3, [120, 90, 60]); if (Math.floor(t * 3) % 2) b.set(hand.x + dir * 2, hand.y + 2, [120, 90, 60]); }
  if (d.doing === 'fish') {
    // every so often he reels in and casts again; between casts the float bobs, and now and then something nibbles
    const cyc = t % 16, R = 11;
    let ang = 0.95, flying = -1;
    if (cyc < 0.5) ang = 0.95 + (2.1 - 0.95) * (cyc / 0.5);
    else if (cyc < 0.85) { ang = 2.1 - (2.1 - 0.45) * ((cyc - 0.5) / 0.35); }
    else if (cyc < 1.6) { ang = 0.45 + (0.95 - 0.45) * ((cyc - 0.85) / 0.75); flying = (cyc - 0.85) / 0.75; }
    const tipX = hand.x + dir * Math.cos(ang) * R, tipY = hand.y - Math.sin(ang) * R;
    b.line(hand.x, hand.y, tipX, tipY, [120, 84, 50]);
    const restX = tipX + dir * 7, restY = POND.cy - 1;
    if (cyc < 0.85) return;                                  // the line is in the air, too fine to see
    const nibble = Math.sin(t * 0.37) > 0.93 ? 1 : 0;
    const fxp = flying >= 0 ? tipX + (restX - tipX) * flying : restX;
    const fyp = flying >= 0 ? tipY + (restY - tipY) * flying - Math.sin(flying * Math.PI) * 6 : restY + Math.round(Math.sin(t * 2.2) * 0.5) + nibble;
    b.line(tipX, tipY, fxp, fyp - 1, [226, 232, 240], 0.45);
    b.set(fxp, fyp - 1, [239, 68, 68]); b.set(fxp, fyp, [248, 250, 252]);
    if (nibble && flying < 0) for (let a = 0; a < 8; a++) b.set(fxp + Math.cos(a / 8 * Math.PI * 2) * 3, fyp + 1 + Math.sin(a / 8 * Math.PI * 2), [255, 255, 255], 0.3);
  }
}

function cat(b: Buf, c: NonNullable<PWorld['cat']>, t: number) {
  // a cat about 35 cm high sitting: five pixels, as it should be next to him
  const at = /bed/.test(c.doing || '') ? { x: 57, y: BED.top } : CAT_SPOT[c.where || 'inside'] || CAT_SPOT.inside;
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

function cone(b: Buf, cx: number, y0: number, y1: number, half: number, c: RGB, a: number) {
  for (let y = y0; y < y1; y++) {
    const f = (y - y0) / (y1 - y0), hw = 2 + half * f;
    for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
      const e = 1 - Math.abs(x - cx) / hw;
      if (e > 0 && dith(x, y, 0.25 + e * 0.6)) b.set(x, y, c, a * e * (1 - f * 0.5));
    }
  }
}

/** Light in the air: god rays from the sun (or moon) marched through the scene, bloom on what is bright,
 *  the colour of the hour, and a soft vignette. Works on the canvas buffer in place. */
function post(d: Uint8ClampedArray, sky: Uint8ClampedArray, glass: Uint8Array, w: PWorld, sx: number, sy: number, sunVis: number) {
  const hw = W >> 1, hh = H >> 1;
  const night = !w.isDay;
  const src = night ? { x: MOON.x, y: MOON.y - YOFF, vis: Math.max(0, 1 - w.cloud / 90) * 0.55 } : { x: sx, y: sy, vis: sunVis };
  if (src.vis > 0.05) {
    // what lets light through: open sky (the bright part near the light most), half through the glass
    const m = new Float32Array(hw * hh);
    for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
      let v = 0;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const p = ((y * 2 + j) * W + (x * 2 + i)), q = p * 4;
        const l = (d[q] * 0.3 + d[q + 1] * 0.59 + d[q + 2] * 0.11) / 255;
        const ddx = x * 2 + i - src.x, ddy = y * 2 + j - src.y;
        const near = Math.exp(-(ddx * ddx + ddy * ddy) / (2 * 9 * 9));       // the light and its glow
        if (d[q] === sky[q] && d[q + 1] === sky[q + 1] && d[q + 2] === sky[q + 2]) v += near * 0.55 * l + Math.max(0, l - 0.95) * 1.5;
        else if (glass[p]) v += near * 0.5;
      }
      m[y * hw + x] = v / 4;
    }
    const rays = new Float32Array(hw * hh), N = 30, lx = src.x / 2, ly = src.y / 2;
    for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
      const dx = (lx - x) / N * 0.92, dy = (ly - y) / N * 0.92;
      let px = x, py = y, wgt = 1, acc = 0;
      for (let n = 0; n < N; n++) {
        px += dx; py += dy;
        const ix = px | 0, iy = py | 0;
        if (ix >= 0 && iy >= 0 && ix < hw && iy < hh) acc += m[iy * hw + ix] * wgt;
        wgt *= 0.955;
      }
      rays[y * hw + x] = acc / N;
    }
    const col: RGB = night ? [150, 170, 230] : (w.hour < 8.5 || w.hour > 15.3 ? [255, 176, 96] : [255, 232, 180]);
    const exposure = (night ? 0.9 : 1.05) * src.vis;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const r = rays[(y >> 1) * hw + (x >> 1)] * exposure, q = (y * W + x) * 4;
      d[q] += col[0] * r; d[q + 1] += col[1] * r; d[q + 2] += col[2] * r;
    }
  }
  // bloom: what is bright glows into what is around it
  const bw = new Float32Array(hw * hh * 3);
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
    const q = ((y * 2) * W + x * 2) * 4, l = (d[q] * 0.3 + d[q + 1] * 0.59 + d[q + 2] * 0.11) / 255;
    const k = Math.max(0, l - 0.86) / 0.14;
    bw[(y * hw + x) * 3] = d[q] * k; bw[(y * hw + x) * 3 + 1] = d[q + 1] * k; bw[(y * hw + x) * 3 + 2] = d[q + 2] * k;
  }
  const blur = (a: Float32Array, horiz: boolean) => {
    const o = new Float32Array(a.length), R = 3;
    for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) for (let c = 0; c < 3; c++) {
      let sum = 0, n = 0;
      for (let k = -R; k <= R; k++) {
        const xx = horiz ? x + k : x, yy = horiz ? y : y + k;
        if (xx < 0 || yy < 0 || xx >= hw || yy >= hh) continue;
        sum += a[(yy * hw + xx) * 3 + c]; n++;
      }
      o[(y * hw + x) * 3 + c] = sum / n;
    }
    return o;
  };
  const bl = blur(blur(bw, true), false);
  const grade: RGB | null = night ? [70, 90, 160] : (w.hour < 8.5 || w.hour > 15.3) ? [255, 170, 100] : null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const q = (y * W + x) * 4, bq = ((y >> 1) * hw + (x >> 1)) * 3;
    let r = d[q] + bl[bq] * 0.55, g = d[q + 1] + bl[bq + 1] * 0.55, bb = d[q + 2] + bl[bq + 2] * 0.55;
    if (grade) { const a = night ? 0.1 : 0.08; r += (grade[0] - r) * a; g += (grade[1] - g) * a; bb += (grade[2] - bb) * a; }
    const vx = (x / W - 0.5) * 2, vy = (y / H - 0.5) * 2, v = 1 - 0.2 * Math.min(1, (vx * vx * 0.6 + vy * vy * 0.9));
    d[q] = r * v; d[q + 1] = g * v; d[q + 2] = bb * v;
  }
}

// ── the pond past the pine, with its jetty ─────────────────────────────────
const POND = { cx: 295, cy: 151, rx: 24, ry: 4 };
function pond(b: Buf, w: PWorld, t: number) {
  const { cx, cy, rx, ry } = POND;
  const night = !w.isDay, ice = w.pond.ice, frozen = ice >= 0.6, warm = w.pond.waterT;
  const top = skyStops(w.hour);
  const skyC = mix(top[top.length - 1], top[1], 0.35);
  for (let y = cy - ry - 2; y <= cy + ry + 2; y++) for (let x = cx - rx - 3; x <= cx + rx + 3; x++) {
    const dx = (x - cx) / rx, dy = (y - cy) / ry, d = dx * dx + dy * dy;
    const bank = ((x - cx) / (rx + 3)) ** 2 + ((y - cy) / (ry + 2)) ** 2;
    if (d > 1) { if (bank <= 1) b.set(x, y, night ? [38, 34, 34] : dith(x, y, 0.4) ? [92, 74, 52] : [74, 58, 40]); continue; }
    let c: RGB;
    const rim = d > 1 - ice * 1.4;                                   // ice creeps in from the edges
    if (frozen || rim) {
      c = dith(x, y, 0.3) ? [205, 226, 240] : [228, 239, 247];
      if (frozen && (Math.abs((x - cx) * 0.35 - (y - cy) * 1.6 - 2) < 0.4 || Math.abs((x - cx + 9) * 0.5 + (y - cy) * 1.4) < 0.35)) c = [160, 190, 215];
      if (w.snow > 0 && hash(x * 3.1 + y) > 0.35) c = [248, 250, 252];
      if (night) c = mix(c, [40, 50, 80], 0.55);
    } else {
      const deep = 1 - d;
      c = night ? mix([14, 22, 44], [26, 40, 74], 1 - deep) : mix(mix(skyC, [26, 86, 104], 0.35 + deep * 0.4), [20, 60, 70], dy > 0 ? 0.15 : 0);
      const ripple = (x * 0.5 + y * 3.3 + t * 1.6) % 11;
      if (ripple < 1 && dith(x, y, 0.5)) c = mix(c, [255, 255, 255], night ? 0.12 : 0.3);
      if (night && Math.abs(x - MOON.x - 58) < 2 + (y - cy + ry) * 0.3 && (y + Math.floor(t * 2)) % 2 === 0) c = mix(c, [230, 230, 200], 0.55);
      if (!night && w.cloud < 70 && hash(x * 7 + Math.floor(t * 3) * 13 + y) > 0.985) c = [255, 252, 230];   // glints
    }
    b.set(x, y, c);
  }
  if (!frozen && warm > 14) for (const [lx, ly, fl] of [[302, 152, warm > 18], [311, 150, false], [287, 154, false]] as const) {
    b.set(lx - 1, ly, [52, 120, 60]); b.set(lx, ly, [74, 150, 70]); b.set(lx + 1, ly, [52, 120, 60]); b.set(lx + 2, ly, [40, 100, 50]);
    if (fl) { b.set(lx, ly - 1, [249, 168, 212]); b.set(lx + 1, ly - 1, [253, 242, 248]); }
  }
  for (const [rx0, n] of [[268, 5], [314, 7]] as const) for (let k = 0; k < n; k++) {      // reeds and cattails
    const x = rx0 + k + (k > 2 ? 1 : 0), h = 6 + Math.floor(hash(x) * 6);
    const green = warm > 8 && !frozen, c: RGB = green ? [62, 110, 50] : [150, 128, 84], sway = Math.round(Math.sin(t * 1.3 + x) * 0.6);
    for (let j = 0; j < h; j++) b.set(x + (j > h - 3 ? sway : 0), cy + 1 - j, night ? mix(c, [10, 14, 24], 0.55) : c);
    if (k % 3 === 1) { b.set(x + sway, cy - h, [101, 67, 33]); b.set(x + sway, cy - h + 1, [101, 67, 33]); }
  }
  // a fish jumps now and then, at dawn and dusk when the water is warm enough
  if (!frozen && warm > 12 && ((w.hour >= 5 && w.hour < 9) || (w.hour >= 17 && w.hour < 21))) {
    const ph = (t % 23) / 23, fx = 290 + hash(Math.floor(t / 23)) * 18;
    if (ph < 0.05) { const f = ph / 0.05; b.set(fx + f * 4, cy - 1 - Math.sin(f * Math.PI) * 4, [190, 200, 190]); b.set(fx + f * 4 - 1, cy - Math.sin(f * Math.PI) * 4, [150, 160, 150]); }
    else if (ph < 0.2) { const r = 1 + (ph - 0.05) * 30; for (let a = 0; a < 12; a++) b.set(fx + 4 + Math.cos(a / 12 * Math.PI * 2) * r, cy + Math.sin(a / 12 * Math.PI * 2) * r * 0.3, [255, 255, 255], 0.35 * (1 - (ph - 0.05) / 0.15)); }
  }
  // the jetty: grey planks on posts
  const wood: RGB = night ? [70, 60, 52] : [150, 128, 104], dark: RGB = night ? [40, 34, 30] : [96, 78, 60];
  for (let x = 263; x <= 286; x++) { b.set(x, 147, x % 3 === 0 ? dark : mix(wood, [255, 255, 255], 0.12)); b.set(x, 148, wood); b.set(x, 149, dark); }
  for (const px of [265, 275, 285]) for (let y = 150; y < 155; y++) b.set(px, y, dark);
}

// his bed, under the window: a low frame, a pillow, a blanket
function bedroom(b: Buf, night: boolean) {
  const { x0, x1, top } = BED;
  const frame: RGB = night ? [62, 44, 32] : [110, 74, 46], dark: RGB = night ? [40, 28, 22] : [76, 50, 32];
  for (let y = top - 4; y < 150; y++) { b.set(x0, y, dark); b.set(x0 + 1, y, frame); }      // headboard
  b.rect(x0, top - 5, 2, 1, frame);
  for (let y = top + 3; y < 150; y++) { b.set(x1, y, dark); }                                // foot
  b.rect(x0 + 2, top + 3, x1 - x0 - 1, 2, frame);                                           // the frame
  b.set(x0 + 3, 149, dark); b.set(x1 - 1, 149, dark);
  b.rect(x0 + 2, top + 1, x1 - x0 - 2, 2, night ? [170, 170, 176] : [236, 232, 226]);         // sheet
  b.rect(x0 + 2, top - 1, 5, 2, night ? [190, 190, 196] : [250, 248, 244]);                   // pillow
  for (let x = x0 + 8; x < x1; x++) for (let y = top; y < top + 3; y++)                       // blanket, a woven teal
    b.set(x, y, (x + y) % 4 === 0 ? (night ? [16, 70, 80] : [17, 94, 89]) : (night ? [22, 90, 100] : [20, 128, 120]));
}

function sleeper(b: Buf, t: number, asleep: boolean) {
  // lying on his back, head on the pillow, the blanket over him
  const { x0, top } = BED, hx = x0 + 3, hy = top - 3;
  const pulse = asleep ? 0.35 + 0.2 * Math.sin(t * 0.9) : 0.8;
  b.rect(hx, hy, 4, 3, [15, 23, 42]);
  for (let i = 0; i < 4; i++) b.set(hx + i, hy, mix([34, 211, 238], [207, 250, 254], pulse - 0.3), asleep ? 0.6 : 1);   // his visor, dimmed
  b.glow(hx + 2, hy, 6, [34, 211, 238], 0.12 * pulse);
  for (let x = x0 + 8; x < x0 + 24; x++) b.set(x, top - 1, (x + Math.floor(t)) % 5 === 0 ? [14, 116, 110] : [20, 128, 120]);   // him, under the blanket
  b.rect(x0 + 7, top - 1, 1, 2, [21, 94, 117]);
  if (asleep) for (let k = 0; k < 3; k++) {                                               // z z z
    const ph = ((t * 0.35) + k / 3) % 1, zx = hx + 3 + ph * 8 + k, zy = hy - 3 - ph * 12;
    const a = Math.sin(ph * Math.PI) * 0.8;
    b.set(zx, zy, [226, 232, 240], a); b.set(zx + 1, zy, [226, 232, 240], a); b.set(zx + 1, zy + 1, [226, 232, 240], a); b.set(zx, zy + 2, [226, 232, 240], a); b.set(zx + 1, zy + 2, [226, 232, 240], a);
  }
}

// ── whoever has come by ────────────────────────────────────────────────────
const PERSON = [
  '...aaaaa...', '..AAAAAAA..', '...fffff...', '...fefef...', '...fffff...', '....fff....',
  '..ccccccc..', '.ccccccccc.', '.cc.ccc.cc.', '.cc.ccc.cc.', '.cc.ccc.cc.', '.ff.ccc.ff.',
  '...ppppp...', '...pp.pp...', '...pp.pp...', '...pp.pp...', '...pp.pp...', '...pp.pp...', '...bb.bb...',
];
const KIND: Record<string, { a?: string; A?: string; c: string; p: string; b?: string; pack?: string; small?: boolean }> = {
  gardener: { a: '#d6b56d', A: '#c9a24f', c: '#4d7c0f', p: '#6b4f2e' },
  merchant: { a: '#3f3f46', A: '#27272a', c: '#7f1d1d', p: '#44403c', pack: '#92400e' },
  beekeeper: { a: '#f5f5f4', A: '#a8a29e', c: '#f5f5f4', p: '#e7e5e4', b: '#57534e' },
  botanist: { a: '#d4d4d8', c: '#a16207', p: '#57534e' },
  driver: { a: '#1f2937', A: '#111827', c: '#1e3a8a', p: '#111827' },
  child: { a: '#78350f', c: '#f97316', p: '#1d4ed8', small: true },
};
const SKIN = ['#f1c27d', '#c68642', '#8d5524', '#e0ac69', '#ffdbac', '#a86b3c'];

function guest(b: Buf, g: NonNullable<PWorld['guest']>, t: number) {
  const x = GUEST_AT.x, y = GUEST_AT.y;
  let seed = 0;
  for (const ch of g.name) seed = (seed * 31 + ch.charCodeAt(0)) % 997;
  if (g.kind === 'ai') {         // another of his kind: his own shape, another colour
    const frame = DEL_IDLE, x0 = x - 6, y0 = y - frame.length, pulse = 0.75 + 0.25 * Math.sin(t * 2.6 + 1);
    b.glow(x, y0 + 10, 14, [232, 121, 249], 0.14 * pulse);
    const col: Record<string, RGB> = { h: [30, 16, 40], v: mix([232, 121, 249], [253, 230, 255], pulse - 0.5), k: [88, 28, 135], t: [232, 121, 249], n: [40, 20, 50], s: [107, 33, 168], l: [59, 7, 100], b: [20, 4, 30] };
    b.rect(x0 + 3, y0 + frame.length, 7, 1, [0, 0, 0], 0.35);
    frame.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') b.set(x0 + 12 - i, y0 + j, col[ch]); }));
    return;
  }
  const k = KIND[g.kind] || KIND.gardener;
  const rows = k.small ? [PERSON[0], ...PERSON.slice(2, 6), ...PERSON.slice(6, 12), ...PERSON.slice(12, 16), PERSON[18]] : PERSON;
  const x0 = x - 5, y0 = y - rows.length + Math.round(Math.sin(t * 1.1 + seed) * 0.3);
  const skin = hex(SKIN[seed % SKIN.length]);
  const col: Record<string, RGB | null> = {
    a: hex(k.a || SKIN[(seed + 3) % SKIN.length]), A: k.A ? hex(k.A) : null, f: skin, e: [30, 27, 24], c: hex(k.c), p: hex(k.p), b: hex(k.b || '#1c1917'),
  };
  if (k.pack) b.rect(x0 + 8, y0 + 6, 4, 6, hex(k.pack));
  b.rect(x0 + 2, y, 7, 1, [0, 0, 0], 0.35);
  const wave = g.talking && Math.floor(t * 1.5) % 4 === 0;
  rows.forEach((row, j) => [...row].forEach((ch, i) => {
    const c = col[ch];
    if (ch === '.' || !c) return;
    if (wave && ch === 'f' && i === 1 && j > 6) { b.set(x0 + i, y0 + j - 3, c); return; }      // a hand up as they talk
    b.set(x0 + i, y0 + j, c);
  }));
  if (g.kind === 'beekeeper') for (let i = 3; i < 8; i++) b.set(x0 + i, y0 + 2, [120, 113, 108], 0.6);   // the veil
}

// ── the whole frame ────────────────────────────────────────────────────────
export function render(ctx: CanvasRenderingContext2D, w: PWorld, t: number) {
  const b = new Buf();
  sky(b, w, t);
  const skyCopy = b.d.slice();
  const glass = new Uint8Array(W * H);
  const snowing = w.snow > 0, raining = w.rain > 0, frosty = w.temp < 0, cold = w.temp < 6;
  const night = !w.isDay;
  // the field to the foothills, then the ground
  for (let y = 116; y < WH; y++) for (let x = 0; x < W; x++) {
    let c: RGB;
    if (snowing) c = dith(x, y, 0.15) ? [226, 232, 240] : [248, 250, 252];
    else if (cold) c = dith(x, y, 0.35 + (frosty ? 0.2 : 0)) ? (frosty ? [196, 204, 196] : [138, 128, 82]) : [118, 110, 70];
    else c = dith(x, y, 0.4) ? [101, 140, 54] : [77, 124, 15];
    if (y >= 156) c = mix(c, [74, 54, 36], 0.45);
    if (night) c = mix(c, [24, 30, 52], 0.55);          // moonlight, not daylight
    b.set(x, y, c);
  }
  // a pine, about 3.5 m
  for (let j = 0; j < 44; j++) {
    const half = Math.floor(j / 3.4);
    for (let i = -half; i <= half; i++) b.set(250 + i, 110 + j, dith(250 + i, 110 + j, 0.3) ? [21, 83, 45] : [20, 60, 38]);
    if (snowing && j % 7 === 0) for (let i = -half; i <= half; i++) b.set(250 + i, 110 + j, [241, 245, 249]);
  }
  b.rect(249, 154, 3, 4, [87, 60, 36]);
  pond(b, w, t);
  // a rain barrel by the greenhouse, and a lamp post on the path
  for (let j = 0; j < 9; j++) for (let i = 0; i < 6; i++) b.set(170 + i, 148 + j, j === 2 || j === 6 ? [68, 64, 60] : i === 0 || i === 5 ? [96, 60, 28] : [139, 90, 43]);
  b.rect(170, 147, 6, 1, [61, 50, 40]);
  b.rect(258 - 84, 127, 1, 30, [55, 55, 60]); b.rect(257 - 84, 125, 3, 3, night ? [253, 230, 138] : [120, 120, 125]); b.rect(256 - 84, 124, 5, 1, [55, 55, 60]);
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
  for (let k = 0; k < 8; k++) {                                                   // and its smoke, drifting
    const age = ((t * 0.18 + k / 8) % 1), r = 1 + age * 3.2;
    const px = 61 + age * 18 + Math.sin(t * 0.9 + k * 2) * 1.5, py = 89 - age * 30;
    for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r) b.set(px + xx, py + yy, night ? [70, 75, 90] : [226, 232, 240], (1 - age) * 0.32);
  }
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
  bedroom(b, night);
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
      const gy = y - YOFF; if (gy >= 0 && gy < H) glass[gy * W + x] = 1;
      if ((x + y) % 19 === 0 || (x + y + 1) % 19 === 0) b.set(x, y, [255, 255, 255], 0.22);
    }
  }
  if (snowing) for (let x = gx0; x <= gx1; x++) { const top = roofAt(x); b.set(x, top - 1, [248, 250, 252]); b.set(x, top - 2, [241, 245, 249], 0.7); }
  b.rect(gcx, peakY + 1, 1, 6, [87, 83, 78]); b.rect(gcx - 1, peakY + 7, 3, 2, night ? [253, 230, 138] : [168, 162, 158]);
  // light through the house window: shafts onto the floor, with dust turning in them
  const st = Math.max(0, Math.min(1, (w.hour - 6.8) / 10));
  const sunX = 60 + st * 220, sunY = 90 - Math.sin(st * Math.PI) * 36, sunVis = w.isDay ? Math.max(0, 1 - w.cloud / 110) : 0;
  const warm: RGB = w.hour < 8.5 || w.hour > 15.3 ? [255, 190, 120] : [255, 236, 190];
  if (sunVis > 0.15) {
    const skew = Math.max(-14, Math.min(-3, -(sunX - 50) / 12));
    for (let y = 135; y < 151; y++) {
      const f = (y - 135) / 16;
      const xl = 35 + skew * f, xr = 66 + skew * f;
      for (let x = Math.floor(xl); x <= Math.ceil(xr); x++) {
        const edge = Math.min(x - xl, xr - x) / 4;
        if (dith(x, y, Math.min(1, edge) * 0.8)) b.set(x, y, warm, 0.13 * sunVis * (1 - f * 0.4));
      }
    }
    for (let y = 118; y < 135; y++) for (let x = 34; x < 67; x++) b.set(x, y, warm, 0.06 * sunVis);
    for (let k = 0; k < 16; k++) {                                   // dust in the light
      const f = (hash(k + 3) + t * 0.02 * (1 + hash(k))) % 1;
      const dx = 35 + hash(k) * 31 + skew * f + Math.sin(t * 0.6 + k) * 1.5, dy = 135 + f * 15;
      b.set(dx, dy, [255, 248, 220], (0.35 + 0.35 * Math.sin(t * 2 + k)) * sunVis);
    }
  }
  if (w.cat?.here) cat(b, w.cat, t);
  if (night) {
    for (let y = 0; y < WH; y++) for (let x = 0; x < W; x++) if (y >= 108 || (x < 84 && y >= 90 + Math.abs(x - 39) * 0.42)) b.set(x, y, [6, 8, 24], 0.42);
    b.glow(gcx, peakY + 9, 20, [253, 224, 138], 0.3);
    b.glow(40, 132, 34, [251, 191, 36], 0.13);
    if (lightOn) b.glow(16, 130, 18, [232, 121, 249], 0.24);
    cone(b, gcx, peakY + 9, 153, 22, [253, 224, 138], 0.16);            // the lantern's light down through the greenhouse
    b.glow(174, 126, 16, [253, 224, 138], 0.35);
    cone(b, 174, 128, 157, 14, [253, 224, 138], 0.14);                 // the lamp post on the path
    if (w.temp > 14) for (let k = 0; k < 9; k++) {                     // fireflies, on a warm night
      const fx = 180 + hash(k) * 70 + Math.sin(t * 0.7 + k * 3) * 4, fy = 130 + hash(k + 4) * 22 + Math.cos(t * 0.5 + k) * 3;
      const on = Math.sin(t * 1.7 + k * 2.3);
      if (on > 0.2) { b.set(fx, fy, [254, 240, 138], on); b.glow(fx, fy, 3, [254, 240, 138], 0.25 * on); }
    }
  } else if (w.hour < 8 || w.hour > 16) {
    for (let y = 108; y < WH; y++) for (let x = 0; x < W; x++) b.set(x, y, [251, 146, 60], 0.06);
  }
  if (w.guest) guest(b, w.guest, t);
  if (w.delamain?.lying) sleeper(b, t, w.delamain.doing === 'sleep');
  else if (w.delamain) delamain(b, w.delamain, t);
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
  post(b.d, skyCopy, glass, w, sunX, sunY - YOFF, sunVis);
  ctx.putImageData(new ImageData(b.d, W, H), 0, 0);
}
