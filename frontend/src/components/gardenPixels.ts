// Pixel-art renderer for his garden: a 256x160 frame drawn pixel by pixel into an ImageData buffer
// (everything is redrawn each frame, about ten times a second), then scaled up crisply in the page.
// The house with its south window, grow-light shelf and his bed, the greenhouse, the outdoor beds and
// the pond past the pine, under the real sky; every plant drawn by its kind and stage; the cat; whoever
// has come by; and Delamain while he is there (asleep in his bed at night).

export const W = 364, H = 120;          // the canvas: the lower part of a 364x160 world
const WH = 160, YOFF = 40;
// World x runs from X0 (his study, built on to the left of the house) to X1; the canvas starts at X0.
export const XOFF = 44;
const X0 = -XOFF, X1 = W - XOFF;

export type PSpot = {
  id: number; place: string; species: string | null; stage: string; health?: number; dormant?: boolean;
  struggle?: string[]; water?: number; form?: string; petal?: string; centre?: string; fruit?: string | null;
};
export type PWorld = {
  hour: number; isDay: boolean; cloud: number; rain: number; snow: number; temp: number;
  growLight: boolean; spots: PSpot[];
  cat: { here: boolean; where?: string; doing?: string } | null;
  delamain: { x: number; y: number; walking: boolean; doing: string; facing: number; lying?: boolean; stride?: number; speaking?: boolean } | null;
  pond: { ice: number; waterT: number };
  guest: (NonNullable<PWorld['delamain']> & { name: string; kind: string }) | null;
  guest2?: (NonNullable<PWorld['delamain']> & { name: string; kind: string }) | null;
  twin?: NonNullable<PWorld['delamain']> | null;        // the other Delamain, in a session with him
  season?: string; seasonProgress?: number; wind?: number;
  design?: Partial<Design>;
  upkeep?: Partial<Upkeep>;
  tree?: { species: string; size: number } | null;
  room?: { books: { title: string }[]; pins: { colours: number[][] }[] };
};
export type Design = { house_wall: string; roof: string; trim: string; path: string; fence: string; room_wall: string;
  rug: string; blanket: string; lamp: string; lights: string; feeder: string; bench: string; sign: string; art: string };
export type Upkeep = { weeds: Record<string, number>; path_weeds: number; lawn: number; leaves: number; windows: number;
  dust: number; house_paint: number; fence_paint: number; snow_path: number; snow_ground: number };
const DESIGN0: Design = { house_wall: 'timber', roof: 'terracotta', trim: 'red', path: 'gravel', fence: 'weathered',
  room_wall: 'plaster', rug: 'rust', blanket: 'teal', lamp: 'on', lights: 'none', feeder: 'none', bench: 'none', sign: '', art: '' };
const UPKEEP0: Upkeep = { weeds: {}, path_weeds: 0, lawn: 0.2, leaves: 0, windows: 0, dust: 0, house_paint: 0, fence_paint: 0, snow_path: 0, snow_ground: 0 };
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
    x = Math.round(x) + XOFF; y = Math.round(y) - YOFF;
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
export const GUEST_POND = { x: 313, y: 158 };   // the far bank, casting back across the water
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
    for (let x = X0; x < X1; x++) b.set(x, y, dith(x, y, fr) ? hi : lo);
  }
  if (!w.isDay) {
    for (let k = 0; k < 88; k++) {
      const x = X0 + Math.floor(hash(k) * W), y = YOFF + Math.floor(hash(k + 99) * 58);
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
    const cx = X0 + ((hash(k) * (W + 60) + t * speed) % (W + 60)) - 30, cy = YOFF + 6 + hash(k + 50) * 30;
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
  for (let x = X0; x < X1; x++) {
    const hd = 86 + Math.sin(x * 0.021 + 4) * 7 + Math.sin(x * 0.083) * 3;
    for (let y = Math.floor(hd); y < 122; y++) b.set(x, y, mix(far, horizon, 0.55));
    if (hd < 84) for (let y = Math.floor(hd); y < hd + 2; y++) b.set(x, y, mix(farSnow, horizon, 0.4));
  }
  for (let x = X0; x < X1; x++) {
    const hf = 92 + Math.sin(x * 0.045) * 9 + Math.sin(x * 0.13 + 1) * 4 + Math.sin(x * 0.31) * 1.5;
    for (let y = Math.floor(hf); y < 122; y++) b.set(x, y, y < hf + 3 + Math.sin(x * 0.5) && hf < 90 ? farSnow : far);
    const hn = 108 + Math.sin(x * 0.03 + 2) * 5 + Math.sin(x * 0.11) * 2;
    for (let y = Math.floor(hn); y < 122; y++) b.set(x, y, dith(x, y, 0.15) ? far : near);
  }
  // air between here and the mountains: haze, thickest at the horizon
  for (let y = 88; y < 122; y++) {
    const a = ((y - 88) / 34) * (w.isDay ? 0.26 : 0.2);
    for (let x = X0; x < X1; x++) b.set(x, y, horizon, a);
  }
  // a treeline along the edge of the field, by the season: fresh in spring, turning in autumn, bare in winter
  const sea = w.season || 'summer', prog = w.seasonProgress ?? 0.5;
  for (let x = X0; x < X1; x++) {
    const m5 = ((x % 5) + 5) % 5, which = hash(Math.floor(x / 5) + 3);
    const h = 2 + Math.floor(hash(x * 0.7) * 4) + (hash(Math.floor(x / 5)) > 0.5 ? 2 : 0);
    let c: RGB = [36, 64, 44];
    if (sea === 'spring') c = mix([60, 90, 50], [92, 140, 64], prog);
    else if (sea === 'autumn') c = mix([36, 64, 44], which < 0.33 ? [176, 84, 30] : which < 0.66 ? [196, 146, 40] : [130, 46, 30], Math.min(1, prog * 1.4));
    else if (sea === 'winter') c = [84, 76, 70];
    if (!w.isDay) c = mix(c, [10, 16, 18], 0.75);
    const bare = sea === 'winter' || (sea === 'autumn' && prog > 0.8 && which > 0.4);
    for (let j = 0; j < h; j++) {
      if (bare ? (m5 === 2 || (j > 1 && j % 2 === 0 && Math.abs(m5 - 2) === 1)) : Math.abs(m5 - 2) <= (h - j) / 2.2)
        b.set(x, 117 - j, mix(c, horizon, 0.25));
    }
  }
  // birds by day, a shooting star now and then by night
  if (w.isDay && w.cloud < 85) for (let k = 0; k < 3; k++) {
    const bx = X0 + ((t * (6 + k) + k * 70) % (W + 40)) - 20, by = 60 + k * 6 + Math.sin(t * 0.8 + k) * 2;
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
// Figures: an upper body over legs for each pose, facing right, mirrored to face left. l/p = the near
// leg, L/P = the far one (darker), so a stride reads as one leg passing the other. Delamain and his
// visitors are drawn the same way, so they walk, sit and crouch alike.
type Legs = { stand: string[]; contact: string[]; pass: string[]; seat: string[]; crouch: string[] };
type Spec = { upper: string[]; legs: Legs; w: number; col: Record<string, RGB>; hand: { ch: string; row: number; col: number };
  glow?: RGB; pack?: RGB; veil?: boolean };
type Fig = NonNullable<PWorld['delamain']>;
const swapLegs = (rows: string[]) => rows.map(r => r.replace(/[lLbBpP]/g, c => ({ l: 'L', L: 'l', b: 'B', B: 'b', p: 'P', P: 'p' } as Record<string, string>)[c]));
const DEL_LEGS: Legs = {
  stand: DEL_IDLE.slice(15),
  contact: ['....kkkkk....', '....kk.kk....', '...LL...ll...', '...LL...ll...', '..LL.....ll..', '..LL.....ll..', '.BB.......bbb'],
  pass: ['....kkkkk....', '....kk.kk....', '....ll.LL....', '....ll.LL....', '....ll.LL....', '....ll..LL...', '....bb...BB..'],
  seat: ['....kkkkkllbb'],
  crouch: ['....kkkkkkk..', '....kk...ll..', '....LL...ll..', '...BBB...bbb.'],
};

function figure(b: Buf, d: Fig, t: number, S: Spec) {
  const total = S.upper.length + S.legs.stand.length;
  const pose = d.walking ? 'walk' : ['sit', 'sit_with_cat', 'write', 'therapy'].includes(d.doing) ? 'sit'
    : ['plant', 'harvest', 'clear', 'pet_cat', 'weed'].includes(d.doing) ? 'crouch' : 'stand';
  const phase = Math.floor((d.stride ?? t * 8) / 3.2) % 4;        // the stride follows the ground covered
  const rows: string[][] = Array.from({ length: total }, () => [...'.'.repeat(S.w)]);
  const put = (src: string[], at: number) => src.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.' && at + j >= 0 && at + j < total && i < S.w) rows[at + j][i] = ch; }));
  let upperAt = 0;
  if (pose === 'walk') { const L = [S.legs.contact, S.legs.pass, swapLegs(S.legs.contact), swapLegs(S.legs.pass)][phase]; put(L, S.upper.length); upperAt = phase % 2 === 0 ? 1 : 0; }
  else if (pose === 'sit') { upperAt = total - S.legs.seat.length - S.upper.length; put(S.legs.seat, total - S.legs.seat.length); }
  else if (pose === 'crouch') { upperAt = total - S.legs.crouch.length - S.upper.length; put(S.legs.crouch, total - S.legs.crouch.length); }
  else put(S.legs.stand, S.upper.length);
  put(S.upper, upperAt);
  const hr = S.hand.row + upperAt, hc = S.hand.col;
  const H = (x: number, y: number) => { if (y >= 0 && y < total && x < S.w + 1) { while (rows[y].length <= x) rows[y].push('.'); rows[y][x] = S.hand.ch; } };
  const clearHand = () => { if (rows[hr]?.[hc] === S.hand.ch) rows[hr][hc] = '.'; };
  if (pose === 'walk') { clearHand(); H(phase === 0 ? hc + 1 : phase === 2 ? hc - 1 : hc, hr - (phase === 0 ? 1 : 0)); }   // arms swing
  else if (d.doing === 'talk' && d.speaking && Math.floor(t * 0.8 + d.x) % 3 === 0) { clearHand(); H(hc + 1, hr - 3); H(hc, hr - 2); }   // a gesture
  else if (pose === 'crouch') { clearHand(); H(hc + 1, hr + 1 + (Math.floor(t * 3) % 2)); }                         // working the soil, stroking the cat
  else if (d.doing === 'sit_with_cat') { clearHand(); H(hc + 1 + (Math.floor(t * 1.2) % 2), hr + 1); }
  if ((t * 0.45 + d.x * 0.01) % 7 < 0.06) rows.forEach(r => r.forEach((c, i) => { if (c === 'v') r[i] = 'h'; if (c === 'e') r[i] = 'f'; }));   // a blink
  const x0 = Math.round(d.x) - (S.w >> 1), y0 = Math.round(d.y) - total;
  if (S.glow) b.glow(Math.round(d.x), y0 + 10 + upperAt, 16, S.glow, 0.15 * (0.75 + 0.25 * Math.sin(t * 3)));
  b.rect(x0 + 3, y0 + total, pose === 'sit' ? 10 : 7, 1, [0, 0, 0], 0.35);
  const fx = (x: number) => x0 + (d.facing < 0 ? S.w - 1 - x : x);
  if (S.pack && pose !== 'sit') b.rect(Math.min(fx(1), fx(4)) - (d.facing < 0 ? -1 : 0), y0 + upperAt + 6, 3, 6, S.pack);
  rows.forEach((row, y) => row.forEach((ch, x) => { const c = S.col[ch]; if (ch !== '.' && c) b.set(fx(x), y0 + y, c); }));
  if (S.veil) for (let i = 3; i < 8; i++) b.set(fx(i), y0 + upperAt + 2, [120, 113, 108], 0.6);
  const dir = d.facing < 0 ? -1 : 1, hand = { x: fx(hc), y: y0 + hr };
  if (d.doing === 'water') {                                // the can tips forward and back as they pour
    const tip = Math.sin(t * 2 + d.x) > 0 ? 1 : 0, cx = hand.x + (dir < 0 ? -4 : 1);
    b.rect(cx, hand.y - 1, 4, 3, [100, 116, 139]); b.set(cx + (dir < 0 ? -1 : 4), hand.y - 2 + tip, [100, 116, 139]); b.set(cx + (dir < 0 ? -2 : 5), hand.y - 3 + tip * 2, [100, 116, 139]);
    if (tip) for (let k = 0; k < 4; k++) b.set(cx + (dir < 0 ? -2 : 5) + (k % 2) * dir, hand.y + ((t * 18 + k * 3) % 9), [125, 211, 252]);
  }
  if (d.doing === 'harvest') { b.rect(hand.x - (dir < 0 ? 4 : -1), hand.y + 2, 4, 3, [161, 98, 7]); b.set(hand.x + dir, hand.y + 1, [74, 222, 128]); b.set(hand.x + dir * 2, hand.y + 1, [74, 222, 128]); }
  if (d.doing === 'weed' && Math.floor(t * 2.5) % 2) { b.set(hand.x + dir, hand.y - 1, [86, 140, 46]); b.set(hand.x + dir, hand.y - 2, [110, 160, 60]); }
  if (d.doing === 'write') {                               // pen moving across the page
    const px = hand.x + dir * (1 + (Math.floor(t * 4) % 3)), py = hand.y - 2;
    b.set(px, py, [30, 41, 59]); b.set(px - dir, py - 1, [30, 41, 59]);
  }
  if (d.doing === 'mow') {                                 // a push mower, a little ahead of him
    const mx = hand.x + dir * 5, my = Math.round(d.y) - 2;
    b.line(hand.x, hand.y, mx, my - 1, [80, 80, 86]);
    b.rect(mx - 2, my - 1, 5, 2, [180, 40, 30]); b.set(mx - 2, my + 1, [30, 30, 30]); b.set(mx + 2, my + 1, [30, 30, 30]);
    if (Math.floor(t * 6) % 2) b.set(mx + dir * 3, my - 2, [120, 170, 60]);
  }
  if (d.doing === 'rake' || d.doing === 'shovel') {        // the handle swings; leaves or snow fly off the end
    const sw = Math.sin(t * 3) * 3, ex = hand.x + dir * (5 + sw), ey = Math.round(d.y) - 1;
    b.line(hand.x, hand.y - 3, ex, ey, [139, 100, 60]);
    b.rect(ex - 1, ey, 3, 1, d.doing === 'rake' ? [90, 90, 96] : [150, 150, 160]);
    if (sw > 2) b.set(ex + dir * 2, ey - 2, d.doing === 'rake' ? [190, 100, 40] : [248, 250, 252]);
  }
  if (d.doing === 'clean' || d.doing === 'tidy') {         // a cloth, or a duster, going round
    const a = t * 5, cx2 = hand.x + Math.round(Math.cos(a) * 2) + dir, cy2 = hand.y - 6 + Math.round(Math.sin(a) * 2);
    b.rect(cx2, cy2, 2, 2, d.doing === 'clean' ? [250, 250, 245] : [250, 204, 21]);
    if (d.doing === 'tidy' && Math.floor(t * 4) % 3 === 0) b.set(cx2 + dir * 2, cy2 - 1, [200, 196, 190]);
  }
  if (d.doing === 'paint') {                               // brush up and down, the pot at his feet
    const by = hand.y - 4 - (Math.floor(t * 3) % 4);
    b.line(hand.x, hand.y, hand.x + dir, by, [139, 100, 60]); b.set(hand.x + dir, by - 1, [240, 240, 235]);
    b.rect(hand.x - dir * 4, Math.round(d.y) - 3, 3, 3, [148, 163, 184]);
  }
  if (d.doing === 'plant') { b.set(hand.x + dir, hand.y + 3, [120, 90, 60]); if (Math.floor(t * 3) % 2) b.set(hand.x + dir * 2, hand.y + 2, [120, 90, 60]); }
  if (d.doing === 'fish') {
    // now and then a fresh cast; between casts the float bobs, and something nibbles
    const cyc = (t + d.x * 0.37) % 16, R = 11;
    let ang = 0.95, flying = -1;
    if (cyc < 0.5) ang = 0.95 + (2.1 - 0.95) * (cyc / 0.5);
    else if (cyc < 0.85) ang = 2.1 - (2.1 - 0.45) * ((cyc - 0.5) / 0.35);
    else if (cyc < 1.6) { ang = 0.45 + (0.95 - 0.45) * ((cyc - 0.85) / 0.75); flying = (cyc - 0.85) / 0.75; }
    const tipX = hand.x + dir * Math.cos(ang) * R, tipY = hand.y - Math.sin(ang) * R;
    b.line(hand.x, hand.y, tipX, tipY, [120, 84, 50]);
    if (cyc >= 0.85) {
      const restX = tipX + dir * 7, restY = POND.cy - 1, nibble = Math.sin(t * 0.37 + d.x) > 0.93 ? 1 : 0;
      const fxp = flying >= 0 ? tipX + (restX - tipX) * flying : restX;
      const fyp = flying >= 0 ? tipY + (restY - tipY) * flying - Math.sin(flying * Math.PI) * 6 : restY + Math.round(Math.sin(t * 2.2) * 0.5) + nibble;
      b.line(tipX, tipY, fxp, fyp - 1, [226, 232, 240], 0.45);
      b.set(fxp, fyp - 1, [239, 68, 68]); b.set(fxp, fyp, [248, 250, 252]);
      if (nibble && flying < 0) for (let a = 0; a < 8; a++) b.set(fxp + Math.cos(a / 8 * Math.PI * 2) * 3, fyp + 1 + Math.sin(a / 8 * Math.PI * 2), [255, 255, 255], 0.3);
    }
  }
  if (d.speaking) {                                         // a speech bubble while they talk
    const bx = Math.round(d.x) + dir * 4, by = y0 + upperAt - 8;
    for (let j = 0; j < 5; j++) for (let i = -4; i <= 4; i++) if (!((j === 0 || j === 4) && Math.abs(i) === 4)) b.set(bx + i, by + j, [248, 250, 252], 0.92);
    b.set(bx - dir * 2, by + 5, [248, 250, 252], 0.92); b.set(bx - dir * 3, by + 6, [248, 250, 252], 0.8);
    for (let k = 0; k < 3; k++) b.set(bx - 2 + k * 2, by + 2 - (Math.floor(t * 4) % 3 === k ? 1 : 0), [71, 85, 105]);
  }
}

function delamainSpec(t: number, magenta = false): Spec {
  const pulse = 0.75 + 0.25 * Math.sin(t * (magenta ? 2.6 : 3) + (magenta ? 1 : 0));
  const col: Record<string, RGB> = magenta
    ? { h: [30, 16, 40], v: mix([232, 121, 249], [253, 230, 255], pulse - 0.5), k: [88, 28, 135], t: [232, 121, 249], n: [40, 20, 50], s: [107, 33, 168], l: [59, 7, 100], L: [40, 4, 70], b: [20, 4, 30], B: [12, 2, 20] }
    : { h: [15, 23, 42], v: mix([34, 211, 238], [207, 250, 254], pulse - 0.5), k: [21, 94, 117], t: [34, 211, 238], n: [30, 41, 59], s: [14, 116, 144], l: [12, 74, 110], L: [8, 50, 76], b: [2, 6, 23], B: [2, 4, 14] };
  return { upper: DEL_IDLE.slice(0, 15), legs: DEL_LEGS, w: 13, col, hand: { ch: 's', row: 12, col: 11 }, glow: magenta ? [232, 121, 249] : [34, 211, 238] };
}

function delamain(b: Buf, d: Fig, t: number) { figure(b, d, t, delamainSpec(t)); }

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
  const src = night ? { x: MOON.x + XOFF, y: MOON.y - YOFF, vis: Math.max(0, 1 - w.cloud / 90) * 0.55 } : { x: sx + XOFF, y: sy, vis: sunVis };
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
function bedroom(b: Buf, night: boolean, blanket: [RGB, RGB] = [[20, 128, 120], [17, 94, 89]]) {
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
    b.set(x, y, nightc((x + y) % 4 === 0 ? blanket[1] : blanket[0], night, 0.35));
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

const PERSON_LEGS: Legs = {
  stand: PERSON.slice(12),
  contact: ['...ppppp...', '...pp.pp...', '..PP...pp..', '..PP...pp..', '.PP.....pp.', '.PP.....pp.', '.BB.....bbb'],
  pass: ['...ppppp...', '...pp.pp...', '...pp.PP...', '...pp.PP...', '...pp.PP...', '...pp..PP..', '...bb...BB.'],
  seat: ['...pppppbb.'],
  crouch: ['...ppppppp.', '...pp...pp.', '...PP...pp.', '..BBB...bbb'],
};
const short = (rows: string[]) => [rows[0], rows[1], rows[rows.length - 3], rows[rows.length - 2], rows[rows.length - 1]];

function guest(b: Buf, g: NonNullable<PWorld['guest']>, t: number) {
  let seed = 0;
  for (const ch of g.name) seed = (seed * 31 + ch.charCodeAt(0)) % 997;
  if (g.kind === 'ai') { figure(b, g, t, delamainSpec(t, true)); return; }     // another of his kind: his shape, another colour
  const k = KIND[g.kind] || KIND.gardener;
  const dark = (h: string) => mix(hex(h), [0, 0, 0], 0.35);
  const col: Record<string, RGB> = {
    a: hex(k.a || SKIN[(seed + 3) % SKIN.length]), f: hex(SKIN[seed % SKIN.length]), e: [30, 27, 24], c: hex(k.c),
    p: hex(k.p), P: dark(k.p), b: hex(k.b || '#1c1917'), B: dark(k.b || '#1c1917'),
  };
  if (k.A) col.A = hex(k.A);
  const upper = k.small ? [PERSON[0], ...PERSON.slice(2, 6), ...PERSON.slice(6, 12)] : PERSON.slice(0, 12);
  const legs: Legs = k.small ? { ...PERSON_LEGS, stand: short(PERSON_LEGS.stand), contact: short(PERSON_LEGS.contact), pass: short(PERSON_LEGS.pass) } : PERSON_LEGS;
  figure(b, g, t, { upper, legs, w: 11, col, hand: { ch: 'f', row: upper.length - 1, col: 9 }, pack: k.pack ? hex(k.pack) : undefined, veil: g.kind === 'beekeeper' });
}

// ── the look of the place (his to choose), and what neglect does to it ────
const WALLS: Record<string, [RGB, RGB]> = { timber: [[107, 79, 58], [86, 62, 45]], whitewash: [[222, 215, 200], [196, 188, 172]],
  sage: [[136, 156, 124], [112, 132, 102]], 'slate blue': [[90, 110, 136], [72, 90, 114]], ochre: [[190, 146, 70], [160, 120, 54]] };
const ROOFS: Record<string, [RGB, RGB, RGB]> = { terracotta: [[127, 52, 40], [92, 38, 30], [160, 72, 54]],
  slate: [[71, 85, 105], [51, 62, 80], [100, 116, 139]], 'moss green': [[74, 100, 58], [54, 76, 42], [104, 134, 78]],
  copper: [[170, 96, 52], [134, 70, 36], [208, 136, 86]] };
const TRIMS: Record<string, [RGB, RGB]> = { red: [[185, 28, 28], [127, 29, 29]], navy: [[37, 64, 143], [23, 37, 84]],
  mustard: [[202, 138, 4], [150, 98, 7]], teal: [[15, 118, 110], [17, 84, 79]], plum: [[126, 58, 170], [86, 36, 120]] };
const ROOMW: Record<string, [RGB, RGB]> = { plaster: [[214, 204, 186], [196, 184, 164]], sage: [[150, 170, 140], [130, 150, 120]],
  'wood panel': [[124, 86, 54], [100, 68, 42]], 'deep blue': [[44, 62, 104], [34, 48, 84]], terracotta: [[176, 96, 66], [150, 78, 52]] };
const RUGS: Record<string, [RGB, RGB, RGB]> = { rust: [[154, 52, 18], [180, 83, 9], [120, 53, 15]], indigo: [[55, 48, 163], [90, 82, 220], [40, 36, 120]],
  moss: [[77, 124, 15], [110, 160, 40], [54, 83, 20]], cream: [[224, 214, 190], [246, 236, 214], [196, 184, 158]] };
const BLANKETS: Record<string, [RGB, RGB]> = { teal: [[20, 128, 120], [17, 94, 89]], mustard: [[202, 138, 4], [161, 98, 7]],
  grey: [[128, 128, 136], [98, 98, 106]], rose: [[219, 112, 147], [180, 84, 118]] };
const FENCES: Record<string, RGB> = { weathered: [120, 113, 108], white: [236, 236, 232], sage: [134, 160, 120] };
const TREE_AT = { x: 128, y: 127 };
export const TREE_STAND = { x: 121, y: 153 };
export const STUDY_DESK = { x: -31, y: 145 };          // where he sits to write (on the chair)
export const STUDY_STAND = { x: -16, y: 157 };
const nightc = (c: RGB, night: boolean, k = 0.45): RGB => (night ? mix(c, [10, 10, 22], k) : c);
const h2 = (x: number, y: number) => hash(x * 12.9898 + y * 78.233);

// a tiny 3x5 font, for the sign he can put up
const FONT: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101110100110101', L: '100100100100111', M: '101111111101101', N: '101111111111101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110',
  '4': '101101111001001', '5': '111100110001110', '6': '011100111101111', '7': '111001010010010', '8': '111101111101111',
  '9': '111101111001110', '&': '010101010101011', "'": '010010000000000', '-': '000000111000000', ' ': '000000000000000',
};
function text3(b: Buf, x: number, y: number, str: string, c: RGB) {
  [...str.toUpperCase()].forEach((ch, k) => {
    const g = FONT[ch] || FONT[' '];
    for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (g[r * 3 + q] === '1') b.set(x + k * 4 + q, y + r, c);
  });
}

// his study: the room built on to the left of the house, with his desk, his pinboard and his books
function study(b: Buf, w: PWorld, d: Design, u: Upkeep, night: boolean, _t: number) {
  const sx0 = -44, sx1 = -1, ceil = 121, floor = 150;
  const [wc, wd] = ROOMW[d.room_wall] || ROOMW.plaster;
  for (let y = ceil; y < floor; y++) for (let x = sx0; x <= sx1; x++)
    b.set(x, y, nightc((y - ceil) % 7 === 0 && d.room_wall === 'wood panel' ? wd : (x + y) % 23 === 0 ? wd : wc, night, 0.55));
  b.rect(sx0, ceil, sx1 - sx0 + 1, 1, nightc([74, 50, 34], night));                         // the ceiling
  for (let y = floor; y < WH; y++) for (let x = sx0; x <= sx1; x++)
    b.set(x, y, x % 10 === 0 || y === floor ? [52, 36, 27] : (night ? [58, 42, 31] : [92, 64, 45]));
  // the desk, with a drawer, against the left wall, and a lamp on it
  const wood: RGB = nightc([139, 90, 43], night), woodD: RGB = nightc([96, 60, 28], night);
  b.rect(-42, 140, 14, 2, wood); b.rect(-41, 142, 1, 8, woodD); b.rect(-30, 142, 1, 8, woodD); b.rect(-40, 142, 6, 2, woodD);
  b.set(-37, 143, nightc([214, 190, 120], night));
  const lampOn = d.lamp === 'on' && (night || w.hour < 8 || w.hour > 17 || w.cloud > 75);
  b.rect(-41, 139, 3, 1, [68, 64, 60]); b.set(-40, 138, [68, 64, 60]); b.set(-39, 137, [68, 64, 60]); b.set(-38, 136, [68, 64, 60]);
  b.rect(-39, 134, 4, 2, lampOn ? [253, 230, 138] : [52, 78, 66]);
  // papers on the desk
  b.rect(-36, 139, 4, 1, [241, 237, 226]); b.set(-33, 139, [30, 41, 59]);
  // the chair (he sits facing the desk)
  b.rect(-34, 144, 6, 1, wood); b.rect(-28, 136, 1, 14, woodD); b.rect(-34, 145, 1, 5, woodD);
  // the pinboard over the desk: the pictures he went to look at, each as its two main colours
  b.rect(-43, 123, 14, 11, nightc([110, 74, 46], night)); b.rect(-42, 124, 12, 9, nightc([186, 140, 88], night));
  (w.room?.pins || []).slice(-12).forEach((pin, i) => {
    const cx = -42 + (i % 4) * 3, cy = 124 + Math.floor(i / 4) * 3;
    const c1 = (pin.colours[0] || [120, 120, 120]) as RGB, c2 = (pin.colours[1] || c1) as RGB;
    b.set(cx, cy, nightc(c1, night)); b.set(cx + 1, cy, nightc(c2, night)); b.set(cx, cy + 1, nightc(c2, night)); b.set(cx + 1, cy + 1, nightc(c1, night));
  });
  // a picture on the wall: whatever he chose to hang there, in colours of its own
  if (d.art) {
    let seed = 0; for (const ch of d.art) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
    b.rect(-27, 125, 6, 7, nightc([60, 44, 30], night));
    for (let y = 126; y < 131; y++) for (let x = -26; x < -22; x++)
      b.set(x, y, nightc(hash(seed + (y > 128 ? 7 : 0)) > 0.5 ? [Math.floor(hash(seed) * 200 + 40), Math.floor(hash(seed + 1) * 200 + 40), Math.floor(hash(seed + 2) * 200 + 40)] as RGB
        : [Math.floor(hash(seed + 3) * 160 + 60), Math.floor(hash(seed + 4) * 160 + 60), Math.floor(hash(seed + 5) * 160 + 60)] as RGB, night));
  }
  // the bookshelf: a book for each subject he has studied
  b.rect(-19, 123, 16, 27, nightc([84, 56, 34], night)); b.rect(-18, 124, 14, 25, nightc([58, 38, 24], night));
  for (const sy of [130, 136, 142, 148]) b.rect(-19, sy, 16, 1, nightc([110, 74, 46], night));
  (w.room?.books || []).slice(-56).forEach((bk, i) => {
    const shelf = Math.floor(i / 14), x = -18 + (i % 14), base = [129, 135, 141, 147][shelf];
    if (base === undefined) return;
    let seed = 0; for (const ch of bk.title) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
    const hgt = 3 + Math.floor(hash(seed) * 3);
    const c: RGB = [[127, 29, 29], [30, 58, 138], [21, 94, 117], [161, 98, 7], [76, 29, 149], [22, 101, 52], [120, 53, 15], [190, 180, 160]][seed % 8] as RGB;
    for (let j = 0; j < hgt; j++) b.set(x, base - j, nightc(j === hgt - 2 ? mix(c, [255, 255, 255], 0.3) : c, night));
  });
  // dust, and cobwebs where he has let it go
  if (u.dust > 0.35) {
    for (let k = 0; k < Math.floor(u.dust * 40); k++) b.set(-43 + hash(k) * 40, 124 + hash(k + 9) * 26, [180, 176, 168], 0.35);
    b.rect(-42, 139, 14, 1, [170, 166, 160], 0.4 * u.dust); b.rect(-19, 122, 16, 1, [170, 166, 160], 0.5 * u.dust);
  }
  if (u.dust > 0.55) for (let k = 0; k < 6; k++) { b.line(sx0, ceil + 1 + k, sx0 + 6 - k, ceil + 1, [220, 220, 220], 0.35); }
  // the doorway through to the main room (a lintel), and the outside wall
  b.rect(-1, 112, 2, 16, nightc([74, 50, 34], night));
  if (lampOn) { b.glow(-37, 137, 16, [253, 224, 138], night ? 0.3 : 0.15); cone(b, -37, 136, 142, 7, [253, 224, 138], 0.18); }
}

function exteriorWall(b: Buf, x0: number, x1: number, y0: number, y1: number, d: Design, u: Upkeep, night: boolean) {
  const [c, cd] = WALLS[d.house_wall] || WALLS.timber;
  for (let y = y0; y < y1; y++) for (let x = x0; x <= x1; x++) {
    const bare = h2(x, y) < u.house_paint * 0.7;
    b.set(x, y, nightc(bare ? [150, 120, 90] : x === x1 ? cd : c, night, 0.5));
  }
}

function leanTo(b: Buf, d: Design, snowing: boolean) {
  const [r, rd, re] = ROOFS[d.roof] || ROOFS.terracotta;
  for (let x = -50; x <= 0; x++) {
    const top = 113 + -x * 0.13;
    for (let y = Math.floor(top); y < 121; y++) b.set(x, y, (y + (((x % 4) + 4) % 4 < 2 ? 0 : 1)) % 3 === 0 ? rd : r);
    b.set(x, Math.floor(top), re);
    if (snowing) { b.set(x, Math.floor(top) - 1, [248, 250, 252]); b.set(x, Math.floor(top), [241, 245, 249]); }
  }
}

// the path: from the house to the greenhouse, and on past the beds to the pond
const PATHS: [number, number][] = [[80, 86], [168, 263]];
function path(b: Buf, d: Design, u: Upkeep, night: boolean, _t: number) {
  for (const [x0, x1] of PATHS) for (let y = 157; y < 160; y++) for (let x = x0; x <= x1; x++) {
    let c: RGB;
    if (d.path === 'flagstone') c = (x % 6 === 0 || (y === 157 && x % 3 === 0)) ? [104, 104, 100] : (h2(Math.floor(x / 6), 1) > 0.5 ? [156, 156, 150] : [140, 140, 134]);
    else if (d.path === 'brick') c = ((x + (y % 2) * 2) % 4 === 0) ? [200, 190, 175] : (h2(x, y) > 0.8 ? [150, 60, 40] : [172, 76, 52]);
    else if (d.path === 'bark') c = dith(x, y, 0.5) ? [110, 72, 40] : [84, 52, 28];
    else c = dith(x, y, 0.45) ? [168, 162, 150] : [130, 124, 116];
    if (h2(x, y + 3) < u.path_weeds * 0.45) c = h2(x, y) > 0.5 ? [74, 124, 40] : [96, 150, 50];
    b.set(x, y, nightc(c, night, 0.55));
  }
  for (const [x0, x1] of PATHS) for (let x = x0; x <= x1; x++) {        // taller weeds pushing up through it
    if (h2(x, 77) < u.path_weeds * 0.25) { const hgt = 1 + Math.floor(u.path_weeds * 3 * h2(x, 5)); for (let j = 1; j <= hgt; j++) b.set(x, 157 - j, nightc([86, 140, 46], night)); }
  }
}

// long grass where nobody mows it, and in spring and summer the dandelions and clover in it
function lawn(b: Buf, w: PWorld, u: Upkeep, night: boolean, t: number) {
  const len = u.lawn, sea = w.season || 'summer';
  if (len < 0.15 || (w.snow > 0 || u.snow_ground > 0.3)) return;
  const spans: [number, number][] = [[171, 182], [204, 205], [226, 227], [248, 262], [287, 320]];
  const base: RGB = sea === 'autumn' ? [140, 140, 60] : sea === 'winter' ? [130, 120, 80] : [86, 140, 40];
  for (const [x0, x1] of spans) for (let x = x0; x <= x1; x++) {
    const hgt = Math.round(len * (3 + h2(x, 2) * 4));
    const sway = Math.round(Math.sin(t * 1.5 + x * 0.4) * Math.min(1, (w.wind || 0) / 20));
    for (let j = 1; j <= hgt; j++) b.set(x + (j > hgt - 2 ? sway : 0), 157 - j, nightc(j === hgt ? mix(base, [255, 255, 200], 0.2) : base, night, 0.6));
    if (len > 0.45 && (sea === 'spring' || sea === 'summer') && h2(x, 9) > 0.9) b.set(x, 157 - hgt - 1, nightc(h2(x, 4) > 0.5 ? [250, 204, 21] : [250, 250, 245], night, 0.6));
    if (len > 0.45 && sea === 'autumn' && h2(x, 9) > 0.93) b.set(x, 157 - hgt - 1, nightc([235, 235, 225], night, 0.6));   // seed heads
  }
}

// weeds coming up in a bed (cx: its middle, y: the top of its soil, half: half its width)
function weedsIn(b: Buf, cx: number, y: number, half: number, amount: number, night: boolean, _t: number, sea: string) {
  if (amount < 0.08) return;
  const n = Math.round(amount * 7);
  for (let k = 0; k < n; k++) {
    const x = cx - half + 1 + Math.floor(h2(cx + k * 7, 3) * (half * 2 - 2));
    const hgt = 1 + Math.round(amount * (2 + h2(k, cx) * 4));
    const c: RGB = sea === 'winter' ? [120, 110, 80] : h2(k, 1) > 0.6 ? [132, 160, 48] : [78, 128, 40];
    for (let j = 1; j <= hgt; j++) b.set(x + (j === hgt && k % 2 ? 1 : 0), y - j, nightc(c, night, 0.55));
    if (amount > 0.5 && k % 3 === 0) { b.set(x - 1, y - hgt + 1, nightc(c, night, 0.55)); b.set(x + 1, y - hgt, nightc(c, night, 0.55)); }
    if (amount > 0.6 && k % 4 === 1 && sea !== 'winter') b.set(x, y - hgt - 1, nightc([250, 204, 21], night, 0.55));
  }
}

// fallen leaves lying about, and in autumn, leaves coming down on the wind
function leaves(b: Buf, w: PWorld, u: Upkeep, night: boolean, t: number) {
  const cols: RGB[] = [[180, 84, 30], [200, 146, 40], [140, 50, 30], [120, 90, 50]];
  const n = Math.floor(u.leaves * 160);
  for (let k = 0; k < n; k++) {
    const x = 80 + hash(k * 3.1) * 240, y = 154 + hash(k * 7.7) * 6;
    if (x > 86 && x < 168) continue;                        // not inside the greenhouse
    b.set(x, y, nightc(cols[k % 4], night, 0.55));
  }
  if (w.season === 'autumn') {
    const m = 6 + Math.floor((w.wind || 0) / 4);
    for (let k = 0; k < m; k++) {
      const life = (t * (0.08 + hash(k) * 0.06) + hash(k + 5)) % 1;
      const x = X0 + hash(k + 11) * W + Math.sin(t * 2 + k) * 4 + life * (w.wind || 4) * 2, y = 112 + life * 46;
      b.set(x, y, nightc(cols[k % 4], night, 0.55), 1 - life * 0.3);
    }
  }
}

// his tree, in the field behind the greenhouse: a sapling that grows over years, by the season
function hisTree(b: Buf, tr: NonNullable<PWorld['tree']>, w: PWorld, night: boolean, t: number) {
  const sea = w.season || 'summer', prog = w.seasonProgress ?? 0.5, sz = Math.max(0.05, tr.size);
  const { x, y } = TREE_AT, hgt = Math.round(10 + sz * 34), r = Math.round(3 + sz * 11), tw = sz > 0.6 ? 2 : 1;
  const birch = tr.species === 'birch';
  const bark: RGB = birch ? [226, 222, 214] : [92, 64, 44];
  for (let j = 0; j < hgt - r; j++) for (let i = 0; i < tw; i++) b.set(x + i, y - j, nightc(birch && (j + i) % 4 === 0 ? [40, 36, 34] : bark, night, 0.6));
  const cy = y - hgt + r;
  const bare = sea === 'winter' || (sea === 'autumn' && prog > 0.85);
  const leafC: RGB = sea === 'spring' ? [120, 176, 70] : sea === 'autumn'
    ? mix([70, 120, 50], hex({ apple: '#d97706', maple: '#dc2626', birch: '#facc15', cherry: '#ea580c' }[tr.species] || '#d97706'), Math.min(1, prog * 1.3))
    : [58, 112, 52];
  if (bare) {                                                // branches against the sky
    for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k - 2) * 0.45; b.line(x, cy + r * 0.3, x + Math.cos(a) * r, cy + Math.sin(a) * r, nightc(bark, night, 0.6)); }
    if (w.snow > 0) for (let k = 0; k < 6; k++) b.set(x - r + hash(k) * r * 2, cy - r * 0.6 + hash(k + 1) * r * 0.5, [248, 250, 252]);
    return;
  }
  const sway = Math.sin(t * 0.9) * Math.min(1, (w.wind || 0) / 25);
  for (let j = -r; j <= r; j++) for (let i = -r - 1; i <= r + 1; i++) {
    const d = (i * i) / ((r + 1) * (r + 1)) + (j * j) / (r * r);
    if (d > 1 || h2(i + 40, j) < (sea === 'autumn' ? prog * 0.5 : 0) * d) continue;
    const lit = j < -r / 3 && i < 0;
    let c: RGB = lit ? mix(leafC, [255, 255, 220], 0.2) : d > 0.7 ? mix(leafC, [0, 0, 0], 0.2) : leafC;
    const meta = TREE_META[tr.species];
    if (sea === 'spring' && meta?.blossom && prog < 0.6 && h2(i, j) > 0.55) c = hex(meta.blossom);
    if (meta?.fruit && sz > 0.45 && ((sea === 'summer' && prog > 0.6) || (sea === 'autumn' && prog < 0.5)) && h2(i + 3, j) > 0.93) c = hex(meta.fruit);
    b.set(x + i + Math.round(sway * (r - j) / r), cy + j, nightc(c, night, 0.6));
  }
}
const TREE_META: Record<string, { blossom?: string; fruit?: string }> = { apple: { blossom: '#fce7f3', fruit: '#dc2626' },
  cherry: { blossom: '#f9a8d4', fruit: '#9f1239' }, maple: {}, birch: {} };

function feeder(b: Buf, w: PWorld, night: boolean, t: number) {
  // hung from a low branch of the pine, with birds coming and going by day
  const fx = 241, fy = 131;
  b.line(fx, 124, fx, fy, [200, 200, 200], 0.6);
  b.rect(fx - 3, fy, 7, 1, nightc([150, 40, 30], night)); b.rect(fx - 2, fy + 1, 5, 3, nightc([139, 90, 43], night)); b.rect(fx - 3, fy + 4, 7, 1, nightc([96, 60, 28], night));
  b.set(fx, fy + 2, nightc([214, 190, 120], night));
  if (!w.isDay || w.snow > 0 && w.wind && w.wind > 30) return;
  for (let k = 0; k < 3; k++) {
    const ph = (t * 0.15 + k * 0.37) % 1;
    if (ph > 0.7) continue;                                  // away for a while
    const bx = fx - 3 + k * 3 + (ph < 0.1 ? (0.1 - ph) * 40 : 0), by = fy + 4 - (Math.floor(t * 3 + k) % 4 === 0 ? 1 : 0) - (ph < 0.1 ? (0.1 - ph) * 20 : 0);
    const c: RGB = k === 1 ? [190, 60, 40] : [120, 90, 60];
    b.set(bx, by - 1, c); b.set(bx + 1, by - 1, c); b.set(bx, by - 2, c); b.set(bx + (k % 2 ? -1 : 2), by - 2, [30, 30, 30]);
  }
}

function benchByPond(b: Buf, night: boolean) {
  const wood: RGB = nightc([139, 90, 43], night), dk: RGB = nightc([96, 60, 28], night);
  b.rect(289, 154, 12, 1, wood); b.rect(289, 151, 12, 1, wood); b.rect(290, 152, 1, 2, dk); b.rect(299, 152, 1, 2, dk);
  b.rect(290, 155, 1, 3, dk); b.rect(299, 155, 1, 3, dk);
}
export const BENCH_SEAT = { x: 288, y: 157 };

function stringLights(b: Buf, d: Design, w: PWorld, t: number) {
  const fence = d.fence !== 'none';
  const x0 = fence ? 178 : 86, x1 = fence ? 246 : 168, base = fence ? 141 : 124;
  const night = !w.isDay;
  for (let x = x0; x <= x1; x++) {
    const seg = (x - x0) % 16, y = base + Math.round(Math.sin((seg / 16) * Math.PI) * 2);
    b.set(x, y, [60, 60, 60], 0.5);
    if (seg % 4 === 2) {
      const k = Math.floor((x - x0) / 4);
      const c: RGB = d.lights === 'colours' ? ([[248, 113, 113], [250, 204, 21], [74, 222, 128], [96, 165, 250], [232, 121, 249]][k % 5] as RGB) : [253, 224, 138];
      const on = night ? 0.75 + 0.25 * Math.sin(t * 2 + k) : 0.35;
      b.set(x, y + 1, c, on);
      if (night) b.glow(x, y + 1, 4, c, 0.18 * on);
    }
  }
}

function signBoard(b: Buf, d: Design, night: boolean) {
  const txt = (d.sign || '').slice(0, 14);
  if (!txt) return;
  const wdt = txt.length * 4 + 5, x0 = Math.round(212 - wdt / 2), y0 = 128;
  b.rect(x0 + 1, y0 + 8, 1, 7, nightc([96, 60, 28], night)); b.rect(x0 + wdt - 2, y0 + 8, 1, 7, nightc([96, 60, 28], night));
  b.rect(x0, y0, wdt, 9, nightc([110, 74, 46], night)); b.rect(x0 + 1, y0 + 1, wdt - 2, 7, nightc([176, 132, 84], night));
  text3(b, x0 + 3, y0 + 2, txt, nightc([60, 36, 20], night));
}

// ── the whole frame ────────────────────────────────────────────────────────
export function render(ctx: CanvasRenderingContext2D, w: PWorld, t: number) {
  const b = new Buf();
  const d: Design = { ...DESIGN0, ...(w.design || {}) } as Design;
  const u: Upkeep = { ...UPKEEP0, ...(w.upkeep || {}), weeds: { ...(w.upkeep?.weeds || {}) } } as Upkeep;
  const sea = w.season || 'summer', prog = w.seasonProgress ?? 0.5;
  sky(b, w, t);
  const skyCopy = b.d.slice();
  const glass = new Uint8Array(W * H);
  const snowing = w.snow > 0, raining = w.rain > 0, frosty = w.temp < 0;
  const snowCover = snowing || u.snow_ground > 0.25;
  const night = !w.isDay;
  // the field to the foothills, then the ground, by the season
  const grass: [RGB, RGB] = sea === 'spring' ? [[118, 170, 60], [92, 150, 30]] : sea === 'summer' ? [[101, 140, 54], [77, 124, 15]]
    : sea === 'autumn' ? [mix([101, 140, 54], [160, 140, 70], prog), mix([77, 124, 15], [130, 112, 50], prog)] : [[138, 128, 82], [118, 110, 70]];
  for (let y = 116; y < WH; y++) for (let x = X0; x < X1; x++) {
    let c: RGB;
    if (snowCover) c = dith(x, y, 0.15) ? [226, 232, 240] : [248, 250, 252];
    else if (frosty) c = dith(x, y, 0.55) ? [196, 204, 196] : grass[1];
    else c = dith(x, y, 0.4) ? grass[0] : grass[1];
    if (y >= 156) c = mix(c, [74, 54, 36], snowCover ? 0.15 : 0.45);
    if (night) c = mix(c, [24, 30, 52], 0.55);          // moonlight, not daylight
    b.set(x, y, c);
  }
  if (w.tree) hisTree(b, w.tree, w, night, t);
  // a pine, about 3.5 m
  for (let j = 0; j < 44; j++) {
    const half = Math.floor(j / 3.4);
    for (let i = -half; i <= half; i++) b.set(250 + i, 110 + j, dith(250 + i, 110 + j, 0.3) ? [21, 83, 45] : [20, 60, 38]);
    if ((snowing || snowCover) && j % 7 === 0) for (let i = -half; i <= half; i++) b.set(250 + i, 110 + j, [241, 245, 249]);
  }
  b.rect(249, 154, 3, 4, [87, 60, 36]);
  if (d.feeder === 'yes') feeder(b, w, night, t);
  pond(b, w, t);
  if (d.bench === 'yes') benchByPond(b, night);
  path(b, d, u, night, t);
  if (u.snow_path > 0.1 || snowCover) for (const [x0, x1] of PATHS) for (let x = x0; x <= x1; x++) for (let y = 157; y < 160; y++)
    if (h2(x, y) < Math.max(u.snow_path, snowCover ? 0.6 : 0)) b.set(x, y, [244, 246, 250]);
  // a rain barrel by the greenhouse, and a lamp post on the path
  for (let j = 0; j < 9; j++) for (let i = 0; i < 6; i++) b.set(170 + i, 148 + j, j === 2 || j === 6 ? [68, 64, 60] : i === 0 || i === 5 ? [96, 60, 28] : [139, 90, 43]);
  b.rect(170, 147, 6, 1, [61, 50, 40]);
  b.rect(258 - 84, 127, 1, 30, [55, 55, 60]); b.rect(257 - 84, 125, 3, 3, night ? [253, 230, 138] : [120, 120, 125]); b.rect(256 - 84, 124, 5, 1, [55, 55, 60]);
  signBoard(b, d, night);
  // fence, about 1.1 m, in the colour he chose, worn where the paint has gone
  if (d.fence !== 'none') {
    const fc = FENCES[d.fence] || FENCES.weathered;
    const fcol = (x: number, y: number): RGB => nightc(h2(x, y) < u.fence_paint * 0.8 ? [120, 113, 108] : fc, night, 0.5);
    for (let x = 178; x < 246; x += 8) { for (let y = 143; y < 157; y++) { b.set(x, y, fcol(x, y)); b.set(x + 1, y, fcol(x + 1, y)); } b.set(x, 142, fcol(x, 142)); }
    for (let x = 178; x < 246; x++) { b.set(x, 146, fcol(x, 146)); b.set(x, 151, fcol(x, 151)); }
  }
  if (d.lights !== 'none') stringLights(b, d, w, t);
  // outdoor beds, 25 cm, with whatever weeds have come up in them
  for (let i = 8; i < 11; i++) { bedLow(b, SPOTS[i].x, SPOTS[i].y, 20, w.spots[i]?.water, snowCover); weedsIn(b, SPOTS[i].x, SPOTS[i].y, 10, u.weeds[String(i)] || 0, night, t, sea); }
  lawn(b, w, u, night, t);
  // ── the greenhouse: 2.2 m walls, a 3.6 m ridge ──
  const gx0 = 86, gx1 = 168, eaveY = 125, peakY = 108, gcx = (gx0 + gx1) / 2;
  const roofAt = (x: number) => (x < gcx ? eaveY - (x - gx0) / (gcx - gx0) * (eaveY - peakY) : peakY + (x - gcx) / (gx1 - gcx) * (eaveY - peakY));
  for (let y = 153; y < WH; y++) for (let x = gx0 + 1; x < gx1; x++) b.set(x, y, dith(x, y, 0.45) ? [168, 162, 158] : [120, 113, 108]);
  for (let i = 5; i < 8; i++) { bed(b, SPOTS[i].x, SPOTS[i].y, 22, w.spots[i]?.water, false); weedsIn(b, SPOTS[i].x, SPOTS[i].y, 11, u.weeds[String(i)] || 0, night, t, 'summer'); }
  b.rect(158, 144, 10, 2, [139, 90, 43]); b.rect(159, 146, 1, 7, [96, 60, 28]); b.rect(166, 146, 1, 7, [96, 60, 28]);   // bench
  // ── the house: a 3 m room under a pitched roof, his study built on to the left ──
  const hx1 = 78, ceil = 112, floor = 150;
  const [wc, wd] = WALLS[d.house_wall] || WALLS.timber;
  const wall: RGB = nightc(wc, night, 0.5), plank: RGB = nightc(wd, night, 0.5);
  for (let y = ceil; y < floor; y++) for (let x = 0; x < hx1; x++) {
    if (x >= 34 && x < 67 && y >= 118 && y < 135) continue;          // the window onto the real sky
    const worn = h2(x, y) < u.house_paint * 0.35;
    b.set(x, y, worn ? nightc([150, 120, 90], night, 0.5) : (y - ceil) % 6 === 0 ? plank : (x + Math.floor((y - ceil) / 6) * 13) % 29 === 0 ? plank : wall);
  }
  // the window, grimy if nobody cleans it
  if (u.windows > 0.1) for (let y = 118; y < 135; y++) for (let x = 34; x < 67; x++) if (dith(x, y, 0.3 + u.windows * 0.5)) b.set(x, y, [130, 112, 80], u.windows * 0.4);
  const [rr, rd, re] = ROOFS[d.roof] || ROOFS.terracotta;
  for (let x = -6; x <= hx1 + 6; x++) {                                // the roof
    const top = 94 + Math.abs(x - 39) * 0.42;
    for (let y = Math.floor(top); y < ceil; y++) b.set(x, y, (Math.floor(y) + (((x % 4) + 4) % 4 < 2 ? 0 : 1)) % 3 === 0 ? rd : rr);
    b.set(x, Math.floor(top), re);
    if (snowCover) { b.set(x, Math.floor(top) - 1, [248, 250, 252]); b.set(x, Math.floor(top), [241, 245, 249]); }
    if (u.leaves > 0.4 && h2(x, 3) < u.leaves * 0.3) b.set(x, Math.floor(top) - 1, [180, 96, 40]);
  }
  leanTo(b, d, snowCover);
  study(b, w, d, u, night, t);
  exteriorWall(b, -48, -45, 119, 160, d, u, night);
  exteriorWall(b, hx1, hx1 + 3, ceil, 160, d, u, night);
  b.rect(58, 92, 6, 10, [87, 83, 78]); b.rect(57, 91, 8, 2, [68, 64, 60]);       // chimney
  for (let k = 0; k < 8; k++) {                                                   // and its smoke, drifting
    const age = ((t * 0.18 + k / 8) % 1), r = 1 + age * 3.2;
    const px = 61 + age * (18 + (w.wind || 0) * 0.6) + Math.sin(t * 0.9 + k * 2) * 1.5, py = 89 - age * 30;
    for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r) b.set(px + xx, py + yy, night ? [70, 75, 90] : [226, 232, 240], (1 - age) * 0.32);
  }
  b.rect(0, ceil, hx1, 2, [74, 50, 34]);                                          // ceiling beam
  const [tc, td] = TRIMS[d.trim] || TRIMS.red;
  for (let x = 33; x < 68; x++) { b.set(x, 117, [231, 229, 228]); }
  for (let y = 117; y < 136; y++) { b.set(33, y, [231, 229, 228]); b.set(67, y, [214, 211, 209]); b.set(50, y, [231, 229, 228]); }
  for (let x = 33; x < 68; x++) b.set(x, 126, [231, 229, 228]);
  for (let y = 115; y < 140; y++) for (let x = 29; x < 33; x++) b.set(x, y, nightc((x + y) % 4 === 0 ? td : tc, night, 0.4));   // curtains
  for (let y = 115; y < 140; y++) for (let x = 68; x < 72; x++) b.set(x, y, nightc((x + y) % 4 === 0 ? td : tc, night, 0.4));
  b.rect(28, 115, 45, 1, [87, 60, 36]);
  b.rect(31, 138, 39, 2, [214, 211, 209]); b.rect(31, 140, 39, 1, [160, 156, 152]);   // the sill, 95 cm
  if (u.dust > 0.7) for (let k = 0; k < 6; k++) b.line(hx1 - 1, ceil + 2 + k, hx1 - 7 + k, ceil + 2, [220, 220, 220], 0.3);
  // the grow-light table, 90 cm, with the lamp hanging from the ceiling
  const lightOn = w.growLight && w.hour >= 6 && w.hour < 20;
  b.rect(3, 140, 27, 2, [139, 90, 43]); b.rect(3, 142, 27, 1, [96, 60, 28]);
  b.rect(4, 143, 2, 7, [96, 60, 28]); b.rect(27, 143, 2, 7, [96, 60, 28]);
  b.rect(8, 114, 1, 8, [68, 64, 60]); b.rect(24, 114, 1, 8, [68, 64, 60]);
  b.rect(5, 122, 23, 2, lightOn ? [245, 208, 254] : [87, 83, 78]); b.rect(5, 121, 23, 1, [68, 64, 60]);
  // the floor and the rug he chose
  for (let y = floor; y < WH; y++) for (let x = 0; x < hx1; x++) b.set(x, y, x % 10 === 0 || y === floor ? [52, 36, 27] : (night ? [58, 42, 31] : [92, 64, 45]));
  const [ra, rb, rc] = RUGS[d.rug] || RUGS.rust;
  for (let y = 151; y < 154; y++) for (let x = 44; x < 74; x++) b.set(x, y, nightc((x + y) % 3 === 0 ? rb : (y === 151 || y === 153) ? rc : ra, night, 0.35));
  bedroom(b, night, BLANKETS[d.blanket] || BLANKETS.teal);
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
  // greenhouse frame and glass, in front of what grows inside (grimy glass lets less through)
  for (let y = peakY; y < 153; y++) for (let x = gx0; x <= gx1; x++) {
    const top = roofAt(x);
    if (y < top) continue;
    const post = x === gx0 || x === gx1 || (x - gx0) % 20 === 0;
    const edge = Math.abs(y - top) < 1;
    if (post || edge || y === eaveY || y === 140) b.set(x, y, night ? [148, 163, 184] : [241, 245, 249], post || edge ? 1 : 0.8);
    else {
      b.set(x, y, [186, 230, 253], 0.1);
      if (u.windows > 0.15 && dith(x, y, 0.4 + u.windows * 0.4)) b.set(x, y, [150, 140, 110], u.windows * 0.3);
      const gy = y - YOFF; if (gy >= 0 && gy < H && u.windows < 0.7) glass[gy * W + x + XOFF] = 1;
      if ((x + y) % 19 === 0 || (x + y + 1) % 19 === 0) b.set(x, y, [255, 255, 255], 0.22);
    }
  }
  if (snowCover) for (let x = gx0; x <= gx1; x++) { const top = roofAt(x); b.set(x, top - 1, [248, 250, 252]); b.set(x, top - 2, [241, 245, 249], 0.7); }
  if (u.leaves > 0.3) for (let x = gx0; x <= gx1; x++) if (h2(x, 8) < u.leaves * 0.35) b.set(x, roofAt(x), [176, 96, 40]);
  b.rect(gcx, peakY + 1, 1, 6, [87, 83, 78]); b.rect(gcx - 1, peakY + 7, 3, 2, night ? [253, 230, 138] : [168, 162, 158]);
  leaves(b, w, u, night, t);
  // light through the house window: shafts onto the floor, with dust turning in them
  const st = Math.max(0, Math.min(1, (w.hour - 6.8) / 10));
  const sunX = 60 + st * 220, sunY = 90 - Math.sin(st * Math.PI) * 36, sunVis = w.isDay ? Math.max(0, 1 - w.cloud / 110) : 0;
  const warm: RGB = w.hour < 8.5 || w.hour > 15.3 ? [255, 190, 120] : [255, 236, 190];
  const clean = 1 - u.windows * 0.6;
  if (sunVis > 0.15) {
    const skew = Math.max(-14, Math.min(-3, -(sunX - 50) / 12));
    for (let y = 135; y < 151; y++) {
      const f = (y - 135) / 16;
      const xl = 35 + skew * f, xr = 66 + skew * f;
      for (let x = Math.floor(xl); x <= Math.ceil(xr); x++) {
        const edge = Math.min(x - xl, xr - x) / 4;
        if (dith(x, y, Math.min(1, edge) * 0.8)) b.set(x, y, warm, 0.13 * sunVis * clean * (1 - f * 0.4));
      }
    }
    for (let y = 118; y < 135; y++) for (let x = 34; x < 67; x++) b.set(x, y, warm, 0.06 * sunVis * clean);
    for (let k = 0; k < 16 + Math.floor(u.dust * 20); k++) {          // dust in the light (more of it, if nobody dusts)
      const f = (hash(k + 3) + t * 0.02 * (1 + hash(k))) % 1;
      const dx = 35 + hash(k) * 31 + skew * f + Math.sin(t * 0.6 + k) * 1.5, dy = 135 + f * 15;
      b.set(dx, dy, [255, 248, 220], (0.35 + 0.35 * Math.sin(t * 2 + k)) * sunVis * clean);
    }
  }
  if (w.cat?.here) cat(b, w.cat, t);
  if (night) {
    for (let y = 0; y < WH; y++) for (let x = X0; x < X1; x++) if (y >= 108 || (x < 84 && y >= 90 + Math.abs(x - 39) * 0.42)) b.set(x, y, [6, 8, 24], 0.42);
    b.glow(gcx, peakY + 9, 20, [253, 224, 138], 0.3);
    b.glow(40, 132, 34, [251, 191, 36], 0.13);
    if (d.lamp === 'on') { b.glow(-37, 137, 18, [253, 224, 138], 0.28); cone(b, -37, 136, 150, 10, [253, 224, 138], 0.14); }
    if (lightOn) b.glow(16, 130, 18, [232, 121, 249], 0.24);
    cone(b, gcx, peakY + 9, 153, 22, [253, 224, 138], 0.16);            // the lantern's light down through the greenhouse
    b.glow(174, 126, 16, [253, 224, 138], 0.35);
    cone(b, 174, 128, 157, 14, [253, 224, 138], 0.14);                 // the lamp post on the path
    if (d.lights !== 'none') stringLights(b, d, w, t);               // the bulbs shine through the dark
    if (w.temp > 14) for (let k = 0; k < 9; k++) {                     // fireflies, on a warm night
      const fx = 180 + hash(k) * 70 + Math.sin(t * 0.7 + k * 3) * 4, fy = 130 + hash(k + 4) * 22 + Math.cos(t * 0.5 + k) * 3;
      const on = Math.sin(t * 1.7 + k * 2.3);
      if (on > 0.2) { b.set(fx, fy, [254, 240, 138], on); b.glow(fx, fy, 3, [254, 240, 138], 0.25 * on); }
    }
  } else if (w.hour < 8 || w.hour > 16) {
    for (let y = 108; y < WH; y++) for (let x = X0; x < X1; x++) b.set(x, y, [251, 146, 60], 0.06);
  }
  if (w.twin) figure(b, w.twin, t, delamainSpec(t, true));
  if (w.guest) guest(b, w.guest, t);
  if (w.guest2) guest(b, w.guest2, t);
  if (w.delamain?.lying) sleeper(b, t, w.delamain.doing === 'sleep');
  else if (w.delamain) delamain(b, w.delamain, t);
  if (raining || snowing) {
    const n = snowing ? 80 : 56 + Math.min(90, w.rain * 40);
    for (let k = 0; k < n; k++) {
      const x0 = hash(k) * (W + 40), sp = snowing ? 9 + hash(k + 5) * 6 : 120 + hash(k + 5) * 40;
      const y = YOFF + ((hash(k + 9) * H + t * sp) % (H + 10)) - 5;
      const x = X0 + ((((x0 - (snowing ? Math.sin(t + k) * 3 : y * 0.25)) % W) + W) % W);
      if (x > -50 && x < 82 && y > 90) continue;                    // not through the house
      if (snowing) b.set(x, y, [255, 255, 255], 0.9);
      else { b.set(x, y, [147, 197, 253], 0.55); b.set(x - 0.5, y + 1, [147, 197, 253], 0.45); b.set(x - 1, y + 2, [147, 197, 253], 0.3); }
    }
  }
  post(b.d, skyCopy, glass, w, sunX, sunY - YOFF, sunVis);
  ctx.putImageData(new ImageData(b.d, W, H), 0, 0);
}
