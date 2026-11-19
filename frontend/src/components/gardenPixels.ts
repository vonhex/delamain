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
  season?: string; seasonProgress?: number; wind?: number; gust?: number; windDir?: number;
  design?: Partial<Design>;
  upkeep?: Partial<Upkeep>;
  tree?: { species: string; size: number } | null;
  room?: { books: { title: string }[]; pins: { colours: number[][] }[] };
  office?: { screen: string | null };
  field?: PField | null;
  wood?: number; stoveLit?: boolean; snowman?: { size: number } | null; firepit?: boolean; feederFill?: number;
  aquarium?: { fish: { species: string; cm: number; name?: string; health?: number }[]; clean: number } | null;
  outfit?: { hat?: string; scarf?: string; coat?: string; boots?: string };
};
export type PField = { stage: string; crop: string | null; frac: number; health: number; weeds: number; tilled: number;
  dormant?: boolean; scarecrow?: { name?: string; down?: boolean } | null };
export type Design = {
  house_wall: string; roof: string; trim: string; door: string; door_colour: string; curtains: string;
  shutters: string; window_box: string; porch_light: string; doormat: string; weathervane: string; chimney: string;
  room_wall: string; floor: string; rug: string; blanket: string; lamp: string; wall_piece: string;
  houseplant: string; attic_lights: string; desk_plant: string;
  path: string; fence: string; greenhouse_frame: string; lights: string; path_lights: string;
  feeder: string; bench: string; arch: string; birdbath: string; gnome: string; mailbox: string;
  wind_chime: string; pond_lilies: string; door_pots: string; sign: string; art: string;
  home_name?: string; farm_name?: string;
};
export type Upkeep = { weeds: Record<string, number>; path_weeds: number; lawn: number; leaves: number; windows: number;
  dust: number; house_paint: number; fence_paint: number; snow_path: number; snow_ground: number };
const DESIGN0: Design = {
  house_wall: 'timber', roof: 'terracotta', trim: 'red', door: 'plank', door_colour: 'match the trim', curtains: 'match the trim',
  shutters: 'none', window_box: 'none', porch_light: 'none', doormat: 'none', weathervane: 'none', chimney: 'stone',
  room_wall: 'plaster', floor: 'oak', rug: 'rust', blanket: 'teal', lamp: 'on', wall_piece: 'none',
  houseplant: 'none', attic_lights: 'none', desk_plant: 'none',
  path: 'gravel', fence: 'weathered', greenhouse_frame: 'white', lights: 'none', path_lights: 'none',
  feeder: 'none', bench: 'none', arch: 'none', birdbath: 'none', gnome: 'none', mailbox: 'none',
  wind_chime: 'none', pond_lilies: 'none', door_pots: 'none', sign: '', art: '',
};
const UPKEEP0: Upkeep = { weeds: {}, path_weeds: 0, lawn: 0.2, leaves: 0, windows: 0, dust: 0, house_paint: 0, fence_paint: 0, snow_path: 0, snow_ground: 0 };
type RGB = [number, number, number];
// The wind this frame, along the screen (km/h; + blows to the right, which is west: the sun rises on the left),
// rising and falling between the steady wind and its gusts. Set at the start of each frame.
let WIND = 0;
function windAt(w: PWorld, t: number): number {
  const sp = w.wind || 0, gu = Math.max(sp, w.gust || sp);
  const g = sp + (gu - sp) * Math.max(0, Math.sin(t * 0.7) * Math.sin(t * 1.9 + 1));
  return Math.sin(((w.windDir ?? 270) * Math.PI) / 180) * g;
}
// How far the wind has carried things since the page opened. Gusts change the wind every frame, so anything it
// moves is moved by adding up small steps (position = time x speed would jump back and forth with each gust).
let CLOUDS = 0, DRIFT = 0, RIPPLE = 0, LAST_T = -1;
function carry(t: number) {
  const dt = LAST_T < 0 ? 0 : Math.max(0, Math.min(0.25, t - LAST_T));
  LAST_T = t;
  CLOUDS += dt * (0.6 + Math.abs(WIND) * 0.05) * (WIND < -1 ? -1 : 1);
  DRIFT += dt * WIND;
  RIPPLE += dt * (1.6 + WIND * 0.15);
}
const windyNow = () => Math.min(1, Math.abs(WIND) / 50);       // 0 still .. 1 a gale

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
const BED = { x0: 39, x1: 63, top: 146 };
const MOON = { x: 236, y: 54 };

// ── cloud & sun shadow helpers ─────────────────────────────────────────────
type CloudPatch = { cx: number; cy: number; seed: number };
type SunShadow = { active: boolean; sx: number; alpha: number; col: RGB };
function activeClouds(w: PWorld): CloudPatch[] {
  const n = Math.round(w.cloud / 14);
  const out: CloudPatch[] = [];
  for (let k = 0; k < n; k++) {
    const speed = 0.5 + hash(k + 3) * 1.2;
    const cx = X0 + ((((hash(k) * (W + 60) + CLOUDS * speed) % (W + 60)) + W + 60) % (W + 60)) - 30;
    const cy = YOFF + 6 + hash(k + 50) * 30;
    out.push({ cx, cy, seed: k });
  }
  return out;
}
function cloudShadowStrength(w: PWorld): number {
  if (!w.isDay || w.cloud < 7) return 0;
  const overcastFade = w.cloud <= 74 ? 1 : Math.max(0, 1 - (w.cloud - 74) / 18);
  return (0.11 + 0.23 * Math.min(1, w.cloud / 74)) * overcastFade;
}
function cloudGrid(clouds: CloudPatch[], sunX: number, yStart: number, yEnd: number, isSky: boolean): Float32Array {
  const hw = W >> 1, hh = H >> 1;
  const g = new Float32Array(hw * hh);
  if (!clouds.length) return g;
  const hy0 = Math.max(0, (yStart - YOFF) >> 1), hy1 = Math.min(hh - 1, (yEnd - YOFF) >> 1);
  const wrapW = W + 60, halfWrap = wrapW * 0.5;
  const items = clouds.map(c => {
    const sx = c.cx + (160 - sunX) * (isSky ? 0.08 : 0.14);
    const sy = isSky ? 84 + hash(c.seed + 61) * 26 : 119 + ((c.cy - YOFF) / 36) * 35;
    const pf = isSky ? 0.45 : Math.max(0.25, Math.min(1.15, (sy - 110) / 48));
    const rx = isSky ? 16 + hash(c.seed + 21) * 12 : (18 + hash(c.seed + 41) * 14) * (0.65 + 0.45 * pf);
    const ry = isSky ? 2.5 + hash(c.seed + 31) * 1.8 : (3.4 + hash(c.seed + 51) * 2.5) * (0.45 + 0.85 * pf);
    return { sx, sy, rx, ry, seed: c.seed };
  });
  for (let hy = hy0; hy <= hy1; hy++) {
    const wy = YOFF + hy * 2 + 0.5;
    for (let hx = 0; hx < hw; hx++) {
      const wx = X0 + hx * 2 + 0.5;
      let acc = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const dy = (wy - it.sy) / it.ry;
        if (dy < -1.1 || dy > 1.1) continue;
        let dx = wx - it.sx;
        dx = (((dx + halfWrap) % wrapW) + wrapW) % wrapW - halfWrap;
        const nx = dx / it.rx;
        const wob = 1 + 0.1 * Math.sin(nx * 3.1 + it.seed);
        const d2 = (nx * nx + dy * dy) / (wob * wob);
        if (d2 < 1) {
          const s = (1 - d2);
          acc = 1 - (1 - acc) * (1 - s * s);
        }
      }
      g[hy * hw + hx] = acc;
    }
  }
  return g;
}
function sampleCloudGrid(g: Float32Array, x: number, y: number): number {
  const hw = W >> 1, hh = H >> 1;
  const fx = Math.max(0, Math.min(hw - 1.001, (x + XOFF) * 0.5));
  const fy = Math.max(0, Math.min(hh - 1.001, (y - YOFF) * 0.5));
  const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy;
  const p = iy * hw + ix;
  const a = g[p] + (g[p + 1] - g[p]) * tx;
  const b = g[p + hw] + (g[p + hw + 1] - g[p + hw]) * tx;
  return a + (b - a) * ty;
}
function sunShadow(w: PWorld, snowCover: boolean): SunShadow {
  if (!w.isDay) return { active: false, sx: 0, alpha: 0, col: [20, 28, 48] };
  const st = Math.max(0, Math.min(1, (w.hour - 6.8) / 10));
  const sx = (0.5 - st) * 2;
  const overcast = Math.max(0, 1 - Math.max(0, w.cloud - 25) / 70);
  const alpha = (0.28 + 0.08 * Math.abs(sx)) * overcast;
  const col: RGB = snowCover ? [76, 112, 166] : (w.hour < 8.5 || w.hour > 15.3) ? [28, 30, 58] : [20, 28, 48];
  return { active: alpha > 0.03, sx, alpha, col };
}
function castSpan(b: Buf, x0: number, x1: number, baseY: number, h: number, sun: SunShadow, opacity = 1) {
  const cy = Math.min(WH - 1, baseY);
  for (let x = x0; x <= x1; x++) b.set(x, cy, [16, 22, 38], 0.22 * opacity);
  if (!sun.active) return;
  const reach = Math.round(sun.sx * h * 0.48);
  const sx0 = reach >= 0 ? x0 : x0 + reach;
  const sx1 = reach >= 0 ? x1 + reach : x1;
  const span = Math.max(1, sx1 - sx0);
  const rows = Math.max(1, Math.min(2, Math.round(h * 0.09)));
  for (let j = 0; j < rows; j++) {
    const yy = baseY + j;
    if (yy >= WH) continue;
    for (let x = sx0; x <= sx1; x++) {
      const f = reach >= 0 ? Math.max(0, (x - x1) / Math.max(1, Math.abs(reach))) : Math.max(0, (x0 - x) / Math.max(1, Math.abs(reach)));
      if (f > 1 || (j > 0 && Math.abs(reach) < 2)) continue;
      const a = sun.alpha * opacity * (1 - f * 0.65) * (j > 0 ? 0.65 : 1);
      if (f > 0.35 && !dith(x, yy, 0.72 - f * 0.35)) continue;
      if (span > 0 && a > 0.02) b.set(x, yy, sun.col, a);
    }
  }
}

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

function sky(b: Buf, w: PWorld, t: number, clouds: CloudPatch[], sunX: number) {
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
  for (const cl of clouds) {
    const cx = cl.cx, cy = cl.cy, k = cl.seed;
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
  // mountains: Colorado Front Range seen from ~40 km across the plains — broad layered massifs,
  // diagonal sun/shade facets, snow on upper slopes & couloirs, and soft atmospheric perspective
  const sea = w.season || 'summer', prog = w.seasonProgress ?? 0.5;
  const horizon = stops[stops.length - 1];
  const skyHaze = mix(horizon, greyC, grey * 0.6);
  const sunDir = !w.isDay ? 1 : (w.hour < 12 ? 1 : -1);
  const goldenSky = w.isDay && (w.hour < 8.5 || w.hour > 15.3);
  type Massif = { cx: number; py: number; ls: number; rs: number; drift: number; seed: number };
  const FAR_MASSIFS: Massif[] = [
    { cx: -14, py: 83, ls: 0.25, rs: 0.23, drift: -0.34, seed: 1.1 },
    { cx: 48, py: 88, ls: 0.22, rs: 0.24, drift: 0.30, seed: 2.3 },
    { cx: 108, py: 80, ls: 0.27, rs: 0.24, drift: -0.32, seed: 3.7 },
    { cx: 156, py: 89, ls: 0.22, rs: 0.22, drift: 0.34, seed: 4.9 },
    { cx: 208, py: 76, ls: 0.25, rs: 0.27, drift: -0.36, seed: 6.1 },
    { cx: 258, py: 86, ls: 0.22, rs: 0.24, drift: 0.32, seed: 7.4 },
    { cx: 302, py: 81, ls: 0.26, rs: 0.24, drift: -0.30, seed: 8.8 },
  ];
  const FOOT_MASSIFS: Massif[] = [
    { cx: -10, py: 103, ls: 0.16, rs: 0.18, drift: 0.38, seed: 1.5 },
    { cx: 76, py: 100, ls: 0.18, rs: 0.16, drift: -0.35, seed: 3.1 },
    { cx: 168, py: 102, ls: 0.15, rs: 0.17, drift: 0.38, seed: 4.4 },
    { cx: 246, py: 98, ls: 0.19, rs: 0.17, drift: -0.35, seed: 5.8 },
    { cx: 316, py: 103, ls: 0.16, rs: 0.18, drift: 0.30, seed: 7.2 },
  ];
  const farBase: RGB = w.isDay ? [92, 110, 142] : [26, 33, 56];
  const farLit0 = mix(farBase, skyHaze, 0.34);
  const farMid0 = mix(farBase, skyHaze, 0.24);
  const farDrk0 = mix(mix(farBase, [24, 34, 60], 0.38), skyHaze, 0.20);
  const farLit = mix(goldenSky ? mix(farLit0, [245, 194, 154], 0.22) : farLit0, skyHaze, grey * 0.45);
  const farMid = mix(farMid0, skyHaze, grey * 0.45);
  const farDrk = mix(farDrk0, skyHaze, grey * 0.45);
  const snowLit0: RGB = w.isDay ? (goldenSky ? [255, 226, 198] : [244, 248, 255]) : [124, 140, 174];
  const snowDrk0: RGB = w.isDay ? (goldenSky ? [188, 174, 208] : [174, 194, 224]) : [78, 92, 126];
  const snowLit = mix(snowLit0, skyHaze, (w.isDay ? 0.16 : 0.12) + grey * 0.42);
  const snowDrk = mix(snowDrk0, skyHaze, (w.isDay ? 0.22 : 0.15) + grey * 0.42);
  const snowLine = sea === 'winter' || w.snow > 0 ? 96 : sea === 'spring' ? 91 : 88;
  const maxSnowDrop = sea === 'winter' || w.snow > 0 ? 21 : 15;
  const mtnTop = new Int16Array(W);
  mtnTop.fill(999);
  for (let x = X0; x < X1; x++) {
    let bestE = 1e9;
    for (let i = 0; i < FAR_MASSIFS.length; i++) {
      const m = FAR_MASSIFS[i], dx = x - m.cx, sl = dx < 0 ? m.ls : m.rs;
      const e = m.py + Math.sqrt(dx * dx * sl * sl + 3.2) - 1.8;
      if (e < bestE) bestE = e;
    }
    const hf = bestE + Math.sin(x * 0.083 + 1.2) * 1.15 + Math.sin(x * 0.175 + 3.7) * 0.55 + Math.sin(x * 0.31 + 0.5) * 0.25;
    const fy = Math.floor(hf);
    if (fy < mtnTop[x - X0]) mtnTop[x - X0] = fy;
    for (let y = fy; y < 122; y++) {
      let bE = 1e9, bI = 0, bDx = 0;
      for (let i = 0; i < FAR_MASSIFS.length; i++) {
        const m = FAR_MASSIFS[i], dy = Math.max(0, y - m.py), dx = x - m.cx - m.drift * dy, sl = dx < 0 ? m.ls : m.rs;
        const e = m.py + Math.sqrt(dx * dx * sl * sl + 3.2) - 1.8;
        if (e < bE) { bE = e; bI = i; bDx = dx; }
      }
      const m = FAR_MASSIFS[bI];
      const ridgeWob = Math.sin((x - y * 0.65) * 0.09 + m.seed) * 3.0 + Math.sin((x + y * 0.72) * 0.16 + m.seed) * 1.3;
      const facet = bDx + ridgeWob;
      const lit = facet * sunDir < 0;
      const crest = Math.abs(facet) < 1.8;
      const dy = Math.max(0, y - m.py);
      const u = bDx + (bDx >= 0 ? -0.78 : 0.78) * dy;
      const gully = Math.sin(u * 0.23 + m.seed * 2.1) * 0.65 + Math.sin(u * 0.41 + m.seed) * 0.35;
      let col = crest ? farMid : lit ? farLit : farDrk;
      if (!crest && gully > 0.35) col = mix(col, farDrk, 0.28);
      else if (lit && gully < -0.35) col = mix(col, farLit, 0.3);
      const snowReach = snowLine + (gully > 0.15 ? gully * 6.5 : gully * 2.5) + (lit ? -1.4 : 1.4);
      const exposedRib = gully < -0.45 && y > hf + 2.5;
      const inSnow = !exposedRib && y < hf + maxSnowDrop && (y < snowReach - 0.8 || (y < snowReach + 0.8 && dith(x, y, 0.5)));
      if (inSnow) col = lit ? snowLit : snowDrk;
      const hazeA = Math.max(0, Math.min(0.45, ((y - 84) / 36) * (w.isDay ? 0.36 : 0.24)));
      b.set(x, y, mix(col, skyHaze, hazeA));
    }
  }
  const nearBase: RGB = w.isDay ? [58, 76, 98] : [18, 24, 40];
  const nearLit = mix(goldenSky ? mix(nearBase, [196, 146, 128], 0.16) : mix(nearBase, skyHaze, 0.24), skyHaze, grey * 0.4);
  const nearDrk = mix(mix(nearBase, [16, 22, 36], 0.36), skyHaze, 0.15 + grey * 0.4);
  for (let x = X0; x < X1; x++) {
    let bestE = 1e9;
    for (let i = 0; i < FOOT_MASSIFS.length; i++) {
      const m = FOOT_MASSIFS[i], dx = x - m.cx, sl = dx < 0 ? m.ls : m.rs;
      const e = m.py + Math.sqrt(dx * dx * sl * sl + 6.0) - 2.45;
      if (e < bestE) bestE = e;
    }
    const hn = bestE + Math.sin(x * 0.07 + 2.1) * 0.9 + Math.sin(x * 0.16) * 0.4;
    const ny = Math.floor(hn);
    if (ny < mtnTop[x - X0]) mtnTop[x - X0] = ny;
    for (let y = ny; y < 122; y++) {
      let bE = 1e9, bI = 0, bDx = 0;
      for (let i = 0; i < FOOT_MASSIFS.length; i++) {
        const m = FOOT_MASSIFS[i], dy = Math.max(0, y - m.py), dx = x - m.cx - m.drift * dy, sl = dx < 0 ? m.ls : m.rs;
        const e = m.py + Math.sqrt(dx * dx * sl * sl + 6.0) - 2.45;
        if (e < bE) { bE = e; bI = i; bDx = dx; }
      }
      const m = FOOT_MASSIFS[bI];
      const facet = bDx + Math.sin((x - y * 0.7) * 0.11 + m.seed) * 2.4;
      const lit = facet * sunDir < 0;
      const dy = Math.max(0, y - m.py);
      const gully = Math.sin((bDx + (bDx >= 0 ? -0.7 : 0.7) * dy) * 0.19 + m.seed);
      let col = Math.abs(facet) < 1.5 ? mix(nearLit, nearDrk, 0.5) : lit ? nearLit : nearDrk;
      if (gully > 0.35) col = mix(col, nearDrk, 0.25);
      if ((sea === 'winter' || w.snow > 0) && y < hn + 2.4 && (gully > 0 || y < hn + 1) && dith(x, y, 0.55)) col = snowDrk;
      const baseMist = y > 106 ? ((y - 106) / 16) * (w.isDay ? 0.24 : 0.16) : 0;
      b.set(x, y, mix(col, skyHaze, baseMist));
    }
  }
  const cloudStr = cloudShadowStrength(w);
  const skyCloud = cloudStr > 0.005 ? cloudGrid(clouds, sunX, 76, 121, true) : null;
  if (skyCloud) {
    for (let y = 76; y < 122; y++) for (let x = X0; x < X1; x++) {
      if (y < mtnTop[x - X0]) continue;
      const a = sampleCloudGrid(skyCloud, x, y) * cloudStr * 0.85;
      if (a > 0.01) b.set(x, y, [24, 34, 62], a);
    }
  }
  // light in the air: toward the sun the air between here and the range scatters it, so the peaks near a low
  // sun go hazy and bright and the light seems to fill the air (and gives the god rays something to stream from)
  if (w.isDay) {
    const st = Math.max(0, Math.min(1, (w.hour - 6.8) / 10));
    const ssx = 60 + st * 220, ssy = 90 - Math.sin(st * Math.PI) * 36;
    const low = 1 - Math.sin(st * Math.PI);                                     // 1 at sunrise and sunset, 0 at noon
    const clear = Math.max(0, 1 - w.cloud / 110);
    const tint: RGB = goldenSky ? [255, 206, 150] : [255, 244, 222];
    const strength = (0.18 + 0.4 * low) * clear;
    if (strength > 0.03) for (let y = 62; y < 120; y++) for (let x = X0; x < X1; x++) {
      const dx = (x - ssx) / (70 + 40 * low), dy = (y - ssy) / 34;
      const a = strength * Math.exp(-(dx * dx + dy * dy)) * (y > 100 ? 1 - (y - 100) / 20 : 1);
      if (a > 0.012) b.set(x, y, tint, a);
    }
    if (low > 0.55 && clear > 0.3) {                                            // the sun's own disc, burning through the ridge
      b.glow(ssx, ssy, 20, [255, 236, 190], 0.35 * clear * low);
      b.disc(ssx, ssy, 2, [255, 250, 225], 0.8 * clear * (low - 0.4));
    }
  }
  // organic varied treeline along the edge of the field, by the season
  for (let cx = X0 - 2; cx < X1 + 3; cx += 4 + Math.floor(hash(cx * 1.73 + 9) * 4)) {
    if (hash(cx * 9.71) < 0.08) continue;
    const which = hash(cx * 3.17 + 5);
    const conifer = which < 0.35;
    const h = 4 + Math.floor(hash(cx * 5.31 + 2) * 6);
    const rw = 2 + Math.floor(hash(cx * 2.47 + 7) * 3);
    const baseY = 115;
    let c: RGB = conifer ? [26, 56, 40] : [38, 68, 44];
    if (sea === 'spring') c = conifer ? [34, 68, 44] : mix([64, 96, 52], [96, 144, 66], prog);
    else if (sea === 'autumn' && !conifer) {
      const aut: RGB = which < 0.55 ? [176, 84, 30] : which < 0.78 ? [196, 146, 40] : [132, 46, 30];
      c = mix([38, 68, 44], aut, Math.min(1, prog * 1.4));
    } else if (sea === 'winter') c = conifer ? [28, 52, 40] : [84, 76, 70];
    if (!w.isDay) c = mix(c, [10, 16, 18], 0.75);
    const cLit = mix(mix(c, [235, 245, 210], 0.16), horizon, 0.22);
    const cMid = mix(c, horizon, 0.25);
    const cDrk = mix(mix(c, [8, 12, 16], 0.22), horizon, 0.25);
    const bare = !conifer && (sea === 'winter' || (sea === 'autumn' && prog > 0.8 && which > 0.55));
    const treeSh = skyCloud ? sampleCloudGrid(skyCloud, cx, baseY - 2) * cloudStr * 0.75 : 0;
    for (let j = 0; j < h; j++) {
      const f = j / Math.max(1, h - 1);
      const half = conifer ? Math.max(0, Math.round(rw * (1 - f * 0.95))) : Math.max(1, Math.round(rw * Math.sin((0.2 + f * 0.72) * Math.PI)));
      for (let i = -half; i <= half; i++) {
        if (bare && !((i === 0 && j < h - 1) || (j > 1 && j % 2 === 0 && Math.abs(i) === 1 && hash(cx + j + i) > 0.35))) continue;
        if (!bare && Math.abs(i) === half && hash(cx * 3 + j * 7 + i) > 0.75) continue;
        const baseCol = (j >= h - 2 && i <= 0) ? cLit : (i > 0 && j < h * 0.6) ? cDrk : cMid;
        const col = treeSh > 0.01 ? mix(baseCol, [24, 34, 62], treeSh) : baseCol;
        b.set(cx + i, baseY - j, col);
        if (sea === 'winter' && conifer && j >= h - 2 && i <= 0 && hash(cx + i + j) > 0.45) {
          const sc = mix(w.isDay ? [210, 224, 238] : [70, 82, 108], horizon, 0.2);
          b.set(cx + i, baseY - j, treeSh > 0.01 ? mix(sc, [24, 34, 62], treeSh) : sc);
        }
      }
    }
  }
  // birds by day, a shooting star now and then by night
  if (w.isDay && w.cloud < 85 && Math.abs(WIND) < 45) for (let k = 0; k < 3; k++) {
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
  const sway = windy && !dead ? Math.sin(t * (1.6 + windyNow() * 2) + seed) * (0.4 + windyNow() * 1.6) + Math.max(-2, Math.min(2, WIND / 25))
    : Math.sin(t * 0.7 + seed) * 0.25;
  const droop = wilt || dead ? 1 : 0;
  const P = (x: number, y: number, c: RGB) => b.set(bx + x + Math.round(sway * (-y) / 16), by + y, c);
  if (s.stage === 'seed') { b.set(bx, by - 1, [120, 90, 60]); b.set(bx - 1, by, [96, 70, 48]); b.set(bx + 1, by, [96, 70, 48]); b.set(bx, by, [214, 199, 161]); return; }
  if (s.stage === 'sprout') {
    P(0, -1, g.D); P(0, -2, g.M); P(-1, -3, g.M); P(-2, -4, g.L); P(1, -3, g.M); P(1, -4, g.L);
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
        const isBase = y === 0 || (y === -1 && Math.abs(x) >= r);
        P(x, y - 1 + droop * (Math.abs(x) > r / 2 ? 1 : 0), isBase ? g.D : curl ? g.L : (x === 0 || Math.abs(x) === Math.round(r / 2)) ? g.D : g.M);
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
      const pHi = mix(petal, [255, 255, 255], 0.35), pLo = mix(petal, [0, 0, 0], 0.3);
      for (let x = -3; x <= 3; x++) { P(x, -1, g.D); if (Math.abs(x) < 3) P(x, -2, g.M); if (Math.abs(x) === 1) P(x, -3, g.L); }
      if (open) for (const [fx, fy] of [[-2, -5], [2, -6]] as const) {
        P(fx - 1, fy, petal); P(fx + 1, fy, petal); P(fx, fy - 1, pHi); P(fx - 1, fy - 1, pHi); P(fx + 1, fy - 1, petal);
        P(fx, fy, centre); P(fx, fy + 1, pLo); P(fx, fy + 2, g.D);
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
      if (open) { const pHi = mix(petal, [255, 255, 255], 0.35); P(0, -h - 1, petal); P(-1, -h - 2, pHi); P(1, -h - 2, petal); P(0, -h - 3, pHi); }
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
  if (snow) for (let i = 1; i < w - 1; i++) if (hash(i + cx) > 0.3) b.set(x + i, y, [224, 234, 244]);
  for (let j = 0; j < 7; j++) for (let i = 0; i < w; i++) {
    const c = j === 0 ? light : j === 3 ? dark : (i === 0 || i === w - 1) ? dark : wood;
    b.set(x + i, y + 2 + j, dith(x + i, y + j, 0.08) ? dark : c);
  }
}

function bedLow(b: Buf, cx: number, y: number, w: number, water: number | undefined, snow: boolean) {
  const x = cx - Math.floor(w / 2);
  soil(b, x + 1, y, w - 2, 1, water);
  if (snow) for (let i = 1; i < w - 1; i++) if (hash(i + cx) > 0.3) b.set(x + i, y, [224, 234, 244]);
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
// 3/4-profile armless torsos facing RIGHT (mirrored via fx() when facing < 0); arms are drawn procedurally
const DEL_PROFILE_UPPER = [
  '.....hhh.....',
  '....hhhhh....',
  '....HvvvV....',
  '....hhhhh....',
  '.....hhh.....',
  '.....nn......',
  '...KkkkRR....',
  '...Kkkktk....',
  '...Kkkkkt....',
  '....Kkkkk....',
  '....Kkkkk....',
  '....Kkkkk....',
  '....Kkkkk....',
  '....Kkkkk....',
  '....kkkkk....',
];
const DEL_CROUCH_UPPER = [
  '......hhh....',
  '.....hhhhh...',
  '.....HvvvV...',
  '.....hhhhh...',
  '.....nn......',
  '...Kkkkkk....',
  '..KkkkkkRk...',
  '..Kkkkkktk...',
  '..Kkkkkkkt...',
  '...Kkkkkkk...',
  '...Kkkkkk....',
  '....kkkkk....',
];
// Figures: an upper body over legs for each pose, facing right, mirrored to face left. l/p = the near
// leg, L/P = the far one (darker), so a stride reads as one leg passing the other. Delamain and his
// visitors are drawn the same way, so they walk, sit and crouch alike.
type Legs = { stand: string[]; contact: string[]; down: string[]; pass: string[]; seat: string[]; crouch: string[] };
type ArmSpec = {
  near: string; far: string; nearHand: string; farHand: string;
  sy: number; crouchSy: number;
  crouchUpper: string[];
  leanRows: number;
};
type Spec = {
  upper: string[]; profileUpper: string[]; legs: Legs; w: number;
  col: Record<string, RGB>; arm: ArmSpec;
  glow?: RGB; pack?: RGB; veil?: boolean;
};
type Fig = NonNullable<PWorld['delamain']>;
const swapLegs = (rows: string[]) => rows.map(r => r.replace(/[lLbBpP]/g, c => ({ l: 'L', L: 'l', b: 'B', B: 'b', p: 'P', P: 'p' } as Record<string, string>)[c]));
const DEL_LEGS: Legs = {
  stand: DEL_IDLE.slice(15),
  contact: [
    '....kkkkk....',
    '....KK.kk....',
    '...LL...ll...',
    '...LL...ll...',
    '..LL.....ll..',
    '.BB......ll..',
    '.........bbb.',
  ],
  down: [
    '....kkkkk....',
    '....KK.kk....',
    '...LL..ll....',
    '...LL..ll....',
    '..LL...ll....',
    '.BB....ll....',
    '.......bbb...',
  ],
  pass: [
    '....kkkkk....',
    '.....kkkk....',
    '.....llLL....',
    '.....ll.LL...',
    '.....ll.BB...',
    '.....ll......',
    '.....bbb.....',
  ],
  seat: [
    '....kkkkk....',
    '....Kllllll..',
    '.......LLll..',
    '.......LLll..',
    '.......BBbbb.',
  ],
  crouch: [
    '...LLkkkk....',
    '..LL...ll....',
    '..LL....ll...',
    '..LL....ll...',
    '..BB...ll....',
    '..B....bbb...',
  ],
};

function applyOutfit(
  rows: string[][], d: Fig, isIdle: boolean, pose: string,
  baseUpperLen: number, upperAt: number, legAt: number,
  HPAD: number, VPAD: number, outfit: NonNullable<PWorld['outfit']>, t: number,
): (RGB | null)[][] {
  const gridH = rows.length, gridW = rows[0].length;
  const ovr: (RGB | null)[][] = Array.from({ length: gridH }, () => Array<RGB | null>(gridW).fill(null));
  const setOvr = (gx: number, gy: number, c: RGB) => {
    if (gy < 0 || gy >= gridH || gx < 0 || gx >= gridW) return;
    const ch = rows[gy][gx];
    if (ch === 'v' || ch === 'V' || ch === 'G') return;
    ovr[gy][gx] = c;
  };

  let headTop = -1;
  for (let gy = 0; gy < gridH && headTop < 0; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const ch = rows[gy][gx];
      if (ch === 'h' || ch === 'H' || ch === 'v' || ch === 'V' || ch === 'G') { headTop = gy; break; }
    }
  }
  if (headTop < 0) return ovr;
  const visRow = (d.doing === 'kite' && !d.walking) ? headTop + 1 : headTop + 2;
  let hx0 = gridW, hx1 = -1;
  const scanRow = Math.min(gridH - 1, headTop + 1);
  for (let gx = 0; gx < gridW; gx++) {
    const ch = rows[scanRow][gx];
    if (ch === 'h' || ch === 'H' || ch === 'v' || ch === 'V' || ch === 'G') {
      if (gx < hx0) hx0 = gx;
      if (gx > hx1) hx1 = gx;
    }
  }
  if (hx1 < hx0) { hx0 = 4 + HPAD; hx1 = 8 + HPAD; }
  const headMid = Math.round((hx0 + hx1) * 0.5);

  let neckRow = visRow + 2, nx0 = headMid, nx1 = headMid;
  for (let gy = visRow + 1; gy < gridH; gy++) {
    let found = false, f0 = gridW, f1 = -1;
    for (let gx = 0; gx < gridW; gx++) if (rows[gy][gx] === 'n') { found = true; if (gx < f0) f0 = gx; if (gx > f1) f1 = gx; }
    if (found) { neckRow = gy; nx0 = f0; nx1 = f1; break; }
  }
  const torsoTop = Math.min(gridH - 1, neckRow + 1);
  const torsoBot = Math.min(gridH - 1, upperAt + baseUpperLen - 1 + VPAD);
  const legTop = Math.min(gridH - 1, legAt + VPAD);

  // 1. Coat (drawn before scarf so scarf sits over collar; navy/teal body & arms remain visible where uncovered)
  const coat = outfit.coat || 'none';
  if (coat === 'wax jacket') {
    const cM: RGB = [88, 96, 56], cL: RGB = [116, 124, 74], cD: RGB = [58, 64, 36], cCol: RGB = [104, 72, 42];
    const endY = Math.min(gridH - 1, legTop);
    for (let gy = 0; gy < gridH; gy++) for (let gx = 0; gx < gridW; gx++) {
      const ch = rows[gy][gx];
      if (ch === 'a') ovr[gy][gx] = cD;
      else if (ch === 'A') ovr[gy][gx] = cM;
      else if (gy >= torsoTop && gy <= endY) {
        if (ch === 'k') ovr[gy][gx] = gy === torsoTop ? cCol : cM;
        else if (ch === 'K') ovr[gy][gx] = cD;
        else if (ch === 'R') ovr[gy][gx] = cL;
        else if (ch === 't') ovr[gy][gx] = gy === torsoTop + 1 ? [21, 94, 117] : cM;
      }
    }
  } else if (coat === 'wool sweater') {
    const cM: RGB = [224, 212, 184], cL: RGB = [242, 234, 212], cD: RGB = [174, 160, 132], cRib: RGB = [192, 178, 148];
    for (let gy = 0; gy < gridH; gy++) for (let gx = 0; gx < gridW; gx++) {
      const ch = rows[gy][gx];
      const knit = (gy - torsoTop) % 2 === 0 && gx % 2 === 0;
      if (ch === 'a') ovr[gy][gx] = cD;
      else if (ch === 'A') ovr[gy][gx] = cM;
      else if (gy >= torsoTop && gy <= torsoBot) {
        if (ch === 'k' || ch === 't') ovr[gy][gx] = gy === torsoBot ? cRib : knit ? cL : cM;
        else if (ch === 'K') ovr[gy][gx] = cD;
        else if (ch === 'R') ovr[gy][gx] = cL;
      }
    }
  } else if (coat === 'rain slicker') {
    const cM: RGB = [242, 192, 28], cL: RGB = [253, 224, 71], cD: RGB = [184, 132, 14], cSnap: RGB = [132, 92, 10];
    const endY = Math.min(gridH - 1, legTop + (pose === 'sit' ? 0 : 1));
    for (let gy = 0; gy < gridH; gy++) for (let gx = 0; gx < gridW; gx++) {
      const ch = rows[gy][gx];
      if (ch === 'a') ovr[gy][gx] = cD;
      else if (ch === 'A') ovr[gy][gx] = cM;
      else if (gy >= torsoTop && gy <= endY) {
        if (ch === 'k' || ch === 't') ovr[gy][gx] = (gy % 2 === 0 && gx === headMid + 1 && gy <= torsoBot) ? cSnap : cM;
        else if (ch === 'K') ovr[gy][gx] = cD;
        else if (ch === 'R') ovr[gy][gx] = cL;
      }
    }
  } else if (coat === 'work apron') {
    const cM: RGB = [148, 104, 62], cL: RGB = [178, 128, 82], cD: RGB = [104, 70, 40], cPkt: RGB = [196, 152, 98];
    const endY = Math.min(gridH - 1, legTop + (pose === 'sit' ? 0 : 1));
    for (let gy = torsoTop; gy <= endY; gy++) {
      const hw = gy < torsoTop + 3 ? 1 : 2;
      for (let gx = headMid - hw; gx <= headMid + hw; gx++) {
        if (gx < 0 || gx >= gridW) continue;
        if (isIdle && gy >= torsoTop + 3 && gy <= torsoBot - 2 && (gx <= 3 + HPAD || gx >= 10 + HPAD)) continue;
        const ch = rows[gy][gx];
        if (ch !== 'k' && ch !== 'K' && ch !== 't' && ch !== 'R') continue;
        if (gy === torsoTop && gx === headMid) continue; // neck opening shows his suit/tie
        if (gy === torsoBot - 1 && Math.abs(gx - headMid) <= 1) ovr[gy][gx] = cPkt;
        else if (gy === endY || gx === headMid - hw) ovr[gy][gx] = cD;
        else if (gx === headMid + hw) ovr[gy][gx] = cL;
        else ovr[gy][gx] = cM;
      }
    }
  }

  // 2. Scarf (wraps neckRow and drapes down front chest)
  const scarf = outfit.scarf || 'none';
  if (scarf !== 'none') {
    const pals: Record<string, [RGB, RGB, RGB]> = {
      red: [[240, 86, 86], [210, 44, 48], [146, 24, 30]],
      mustard: [[246, 198, 68], [222, 162, 24], [162, 108, 12]],
      teal: [[56, 206, 194], [20, 164, 156], [12, 112, 110]],
      plaid: [[188, 42, 46], [36, 98, 56], [236, 224, 196]],
    };
    const pal = pals[scarf];
    if (pal) {
      const scCol = (gx: number, gy: number, tone: 0 | 1 | 2): RGB =>
        scarf === 'plaid' ? pal[((gx + gy) % 3 + 3) % 3] : pal[tone];
      for (let gx = nx0 - 1; gx <= nx1 + 1; gx++) setOvr(gx, neckRow, scCol(gx, neckRow, gx === nx1 + 1 ? 0 : gx === nx0 - 1 ? 2 : 1));
      const flutter = d.walking && Math.floor(t * 6) % 2 === 0 ? -1 : 0;
      setOvr(nx0, neckRow + 1, scCol(nx0, neckRow + 1, 2));
      setOvr(nx1, neckRow + 1, scCol(nx1, neckRow + 1, 0));
      setOvr(nx1 + 1, neckRow + 1, scCol(nx1 + 1, neckRow + 1, 1));
      setOvr(nx1, neckRow + 2, scCol(nx1, neckRow + 2, 1));
      setOvr(nx1 + flutter, neckRow + 3, scCol(nx1, neckRow + 3, 2));
    }
  }

  // 3. Hat (always strictly above visRow so dark head & glowing cyan visor stay unobstructed)
  const hat = outfit.hat || 'none';
  const brimY = Math.min(headTop + 1, visRow - 1);
  if (hat === 'chauffeur cap') {
    const navy: RGB = [24, 34, 58], band: RGB = [14, 20, 38], peak: RGB = [8, 12, 22], gold: RGB = [234, 179, 8];
    for (let gx = hx0; gx <= hx1; gx++) setOvr(gx, brimY, band);
    setOvr(hx1 + 1, brimY, peak); setOvr(hx1 + 2, brimY, peak);
    for (let gx = hx0; gx <= hx1; gx++) setOvr(gx, brimY - 1, gx === hx1 - 1 ? gold : navy);
    for (let gx = hx0; gx <= hx1 - 1; gx++) setOvr(gx, brimY - 2, navy);
  } else if (hat === 'flat cap') {
    const twL: RGB = [132, 98, 64], twM: RGB = [98, 72, 46], twD: RGB = [66, 46, 28];
    for (let gx = hx0; gx <= hx1; gx++) setOvr(gx, brimY, twM);
    setOvr(hx1 + 1, brimY, twD);
    for (let gx = hx0; gx <= hx1 - 1; gx++) setOvr(gx, brimY - 1, gx === hx0 ? twD : twL);
  } else if (hat === 'beanie') {
    const kL: RGB = [224, 106, 86], kM: RGB = [192, 64, 52], kD: RGB = [138, 40, 32], pom: RGB = [242, 234, 222];
    for (let gx = hx0; gx <= hx1; gx++) setOvr(gx, brimY, (gx - hx0) % 2 === 0 ? kL : kM);
    for (let gx = hx0; gx <= hx1; gx++) setOvr(gx, brimY - 1, gx === hx0 ? kD : gx === hx1 ? kM : kL);
    for (let gx = hx0 + 1; gx <= hx1 - 1; gx++) setOvr(gx, brimY - 2, kM);
    setOvr(headMid, brimY - 3, pom);
  } else if (hat === 'straw hat') {
    const stL: RGB = [240, 206, 120], stM: RGB = [206, 164, 76], stD: RGB = [158, 118, 48], rib: RGB = [185, 48, 48];
    for (let gx = hx0 - 1; gx <= hx1 + 2; gx++) setOvr(gx, brimY, (gx === hx0 - 1 || gx === hx1 + 2) ? stM : stL);
    for (let gx = hx0 + 1; gx <= hx1 - 1; gx++) setOvr(gx, brimY - 1, rib);
    for (let gx = hx0 + 1; gx <= hx1 - 1; gx++) setOvr(gx, brimY - 2, gx === hx1 - 1 ? stD : stL);
  } else if (hat === 'wide brim') {
    const flL: RGB = [148, 100, 62], flM: RGB = [114, 74, 44], flD: RGB = [74, 46, 28], bnd: RGB = [176, 136, 72];
    for (let gx = hx0 - 2; gx <= hx1 + 2; gx++) setOvr(gx, brimY, (gx === hx0 - 2 || gx === hx1 + 2) ? flD : gx >= hx1 ? flL : flM);
    for (let gx = hx0 + 1; gx <= hx1 - 1; gx++) setOvr(gx, brimY - 1, bnd);
    for (let gx = hx0 + 1; gx <= hx1 - 1; gx++) setOvr(gx, brimY - 2, gx === hx1 - 1 ? flD : flL);
  }

  // 4. Boots
  const boots = outfit.boots || 'standard';
  if (boots === 'rubber boots' || boots === 'work boots') {
    const bL: RGB = boots === 'rubber boots' ? [54, 136, 68] : [172, 108, 52];
    const bD: RGB = boots === 'rubber boots' ? [32, 88, 44] : [116, 68, 30];
    const cL: RGB = boots === 'rubber boots' ? [212, 224, 174] : [196, 134, 74];
    const cD: RGB = boots === 'rubber boots' ? [154, 170, 124] : [136, 84, 42];
    for (let gy = legTop; gy < gridH; gy++) for (let gx = 0; gx < gridW; gx++) {
      const ch = rows[gy][gx];
      if (ch === 'b') ovr[gy][gx] = bL;
      else if (ch === 'B') ovr[gy][gx] = bD;
      else if ((ch === 'l' || ch === 'L') && gy + 1 < gridH && (rows[gy + 1][gx] === 'b' || rows[gy + 1][gx] === 'B')) {
        ovr[gy][gx] = ch === 'l' ? cL : cD;
      }
    }
  }
  return ovr;
}

function figure(b: Buf, d: Fig, t: number, S: Spec, snowCover = false, sun?: SunShadow, outfit?: PWorld['outfit']) {
  const total = S.upper.length + S.legs.stand.length;
  const stretchPhase = Math.floor(t * 1.2) % 4;
  const stretchDown = d.doing === 'stretch' && stretchPhase >= 2;
  const sitActs = ['sit', 'sit_with_cat', 'write', 'therapy', 'study', 'read', 'news', 'type', 'guitar', 'campfire'];
  const crouchActs = ['plant', 'harvest', 'clear', 'pet_cat', 'weed', 'snowman', 'gather', 'tank'];
  const pose = d.walking ? 'walk' : sitActs.includes(d.doing) ? 'sit' : (crouchActs.includes(d.doing) || stretchDown) ? 'crouch' : 'stand';
  const isIdle = !d.walking && (!d.doing || d.doing === 'idle');
  const isCrouch = pose === 'crouch';
  const walkPhase = ((Math.floor((d.stride ?? t * 11) / 2.1) % 6) + 6) % 6;

  // Shared normalized phase curves for work animations (anticipation -> snap/impact -> follow-through)
  const cyc = (rate: number) => (((t * rate + d.x * 0.07) % 1) + 1) % 1;
  const chopPh = d.doing === 'chop' ? cyc(0.95) : 0;
  const chopStage = chopPh < 0.30 ? 'windup' : chopPh < 0.44 ? 'snap' : chopPh < 0.70 ? 'impact' : 'recover';
  const tillPh = d.doing === 'till' || d.doing === 'hoe' ? cyc(1.0) : 0;
  const tillStage = tillPh < 0.26 ? 'windup' : tillPh < 0.48 ? 'chop' : tillPh < 0.76 ? 'pull' : 'lift';
  const scythePh = d.doing === 'scythe' ? cyc(0.9) : 0;
  const scytheStage = scythePh < 0.28 ? 'windup' : scythePh < 0.56 ? 'sweep' : scythePh < 0.80 ? 'follow' : 'return';
  const hammerPh = d.doing === 'hammer' ? cyc(1.25) : 0;
  const hammerStage = hammerPh < 0.34 ? 'raise' : hammerPh < 0.54 ? 'strike' : hammerPh < 0.76 ? 'rebound' : 'rest';
  const sowPh = d.doing === 'sow' ? cyc(1.05) : 0;
  const sowStage = sowPh < 0.28 ? 'dip' : sowPh < 0.62 ? 'fling' : 'return';
  const rakePh = d.doing === 'rake' || d.doing === 'shovel' ? cyc(1.0) : 0;
  const rakeStage = rakePh < 0.28 ? 'reach' : rakePh < 0.62 ? 'pull' : 'toss';
  const mowPh = d.doing === 'mow' ? cyc(1.4) : 0;
  const fishCyc = d.doing === 'fish' ? (((t + d.x * 0.37) % 12) + 12) % 12 : 99;
  const fishNibble = d.doing === 'fish' && fishCyc >= 1.5 && Math.sin(t * 1.1 + d.x) > 0.75;

  let leanX = !d.walking && ['stars', 'cook', 'mow', 'rake', 'shovel', 'till', 'hoe'].includes(d.doing) ? 1 : 0;
  if (d.doing === 'chop') leanX = chopStage === 'windup' ? -1 : chopStage === 'snap' || chopStage === 'impact' ? 1 : 0;
  else if (d.doing === 'till' || d.doing === 'hoe') leanX = tillStage === 'chop' || tillStage === 'pull' ? 1 : 0;
  else if (d.doing === 'scythe') leanX = scytheStage === 'windup' ? -1 : scytheStage === 'sweep' || scytheStage === 'follow' ? 1 : 0;
  else if (d.doing === 'hammer') leanX = hammerStage === 'strike' ? 1 : 0;
  else if (d.doing === 'sow') leanX = sowStage === 'fling' ? 1 : 0;
  else if (d.doing === 'rake' || d.doing === 'shovel') leanX = rakeStage === 'reach' ? 1 : 0;
  else if (d.doing === 'kite') leanX = -1;
  else if (d.doing === 'fish') leanX = fishCyc < 0.45 || fishNibble ? -1 : fishCyc < 0.8 ? 1 : 0;

  const HPAD = 2, VPAD = 3;
  const gridW = S.w + HPAD * 2, gridH = total + VPAD;
  const rows: string[][] = Array.from({ length: gridH }, () => [...'.'.repeat(gridW)]);
  const put = (src: string[], at: number, shiftX = 0, shiftRows = 0) => src.forEach((r, j) => {
    const sx = j < shiftRows ? shiftX : 0;
    [...r].forEach((ch, i) => {
      const ry = at + j + VPAD, rx = i + sx + HPAD;
      if (ch !== '.' && ry >= 0 && ry < gridH && rx >= 0 && rx < gridW) rows[ry][rx] = ch;
    });
  });

  const baseUpper = isIdle ? S.upper : isCrouch ? S.arm.crouchUpper : S.profileUpper;
  const idleBreath = isIdle && Math.floor(t * 1.1 + d.x * 0.3) % 7 === 0;
  let upperAt = idleBreath ? 1 : 0;
  let legSrc: string[] = S.legs.stand;
  let legAt = S.upper.length;
  let extraRow: string[] | null = null;
  if (pose === 'walk') {
    legSrc = [S.legs.contact, S.legs.down, S.legs.pass, swapLegs(S.legs.contact), swapLegs(S.legs.down), swapLegs(S.legs.pass)][walkPhase];
    upperAt = walkPhase % 3 === 2 ? 0 : 1;
  } else if (pose === 'sit') {
    upperAt = total - S.legs.seat.length - baseUpper.length;
    legSrc = S.legs.seat;
    legAt = total - S.legs.seat.length;
  } else if (d.doing === 'tank') {
    // Low kneel so Delamain clears the attic rafters and peers directly into the tank
    const tankLegs = S.w >= 13
      ? ['...LLkkkk....', '..LL....ll...', '..BB...ll....', '..B....bbb...']
      : ['..LLkkkk...', '.LL....ll..', '.BB...ll...', '.B....bbb..'];
    legSrc = tankLegs;
    legAt = total - tankLegs.length;
    upperAt = total - tankLegs.length - baseUpper.length;
  } else if (isCrouch) {
    upperAt = total - S.legs.crouch.length - baseUpper.length;
    legSrc = S.legs.crouch;
    legAt = total - S.legs.crouch.length;
  } else if (d.doing === 'stretch' && !stretchDown) {
    upperAt = -1;
    legAt = S.upper.length - 1;
    extraRow = [S.w >= 13 ? '....bb.bb....' : '...bb.bb...'];
  } else if (d.doing === 'stars') {
    upperAt = 1;
  } else if (
    (d.doing === 'chop' && chopStage === 'impact') ||
    ((d.doing === 'till' || d.doing === 'hoe') && (tillStage === 'chop' || tillStage === 'pull')) ||
    (d.doing === 'scythe' && scytheStage === 'sweep') ||
    (d.doing === 'hammer' && hammerStage === 'strike') ||
    ((d.doing === 'rake' || d.doing === 'shovel') && rakeStage === 'pull') ||
    (d.doing === 'mow' && mowPh >= 0.5)
  ) {
    upperAt = 1;
  }

  const cx = S.w >> 1;
  const ssy = upperAt + (isCrouch ? S.arm.crouchSy : S.arm.sy);
  const fsx = cx + 2 + leanX, fsy = ssy;
  const nsx = cx - 2 + leanX, nsy = ssy;

  type ArmPose = { fe: [number, number]; fh: [number, number]; ne: [number, number]; nh: [number, number] };
  const armPose = (): ArmPose => {
    const f = (ex: number, ey: number, hx: number, hy: number): { e: [number, number]; h: [number, number] } => ({ e: [fsx + ex, fsy + ey], h: [fsx + hx, fsy + hy] });
    const n = (ex: number, ey: number, hx: number, hy: number): { e: [number, number]; h: [number, number] } => ({ e: [nsx + ex, nsy + ey], h: [nsx + hx, nsy + hy] });
    const mk = (fa: { e: [number, number]; h: [number, number] }, na: { e: [number, number]; h: [number, number] }): ArmPose => ({ fe: fa.e, fh: fa.h, ne: na.e, nh: na.h });
    const r = S.w >= 13 ? 1 : 0;
    if (pose === 'walk' && d.doing === 'climb') {                       // hand over hand on the rungs
      const k = walkPhase % 2;
      return mk(f(0, -3, 1, -7 + k * 3), n(1, -3, 2, -4 - k * 3));
    }
    if (pose === 'walk') {
      const swings: ArmPose[] = [
        mk(f(0, 2, 2, 4 + r), n(1, 3, -1, 5 + r)),
        mk(f(1, 2, 3, 3 + r), n(0, 3, -2, 5 + r)),
        mk(f(0, 3, 0, 4 + r), n(0, 3, 1, 4 + r)),
        mk(f(-1, 3, -2 - r, 5 + r), n(2, 3, 5 + r, 4 + r)),
        mk(f(-2, 3, -3 - r, 5 + r), n(3, 3, 6 + r, 3 + r)),
        mk(f(-1, 3, -1, 4 + r), n(1, 3, 2, 4 + r)),
      ];
      return swings[walkPhase];
    }
    if (d.doing === 'stretch') {
      if (!stretchDown) {
        return stretchPhase === 0
          ? mk(f(1, -3, 1, -8), n(-2, -3, -1, -8))
          : mk(f(2, -4, 0, -9), n(-2, -4, 0, -9));
      }
      const toeY = total - 3 - fsy;
      return mk(f(1, 3, 1, toeY), n(2, 3, 4, toeY));
    }
    if (d.doing === 'stars') return mk(f(2, 1, 3, 0), n(3, 2, 6, 1));
    if (d.doing === 'cook') return mk(f(2, 2, 4, 2), n(3, 2, 6, 1 + (Math.floor(t * 4) % 2)));
    if (d.doing === 'tank') return mk(f(2, 1, 3, 1), n(3, 0, 6, -1));
    if (d.doing === 'pet_cat') return mk(f(1, 3, 2, 5), n(3, 3, 6, 5 + (Math.floor(t * 3) % 2)));
    if (d.doing === 'snowman') {
      const roll = Math.floor(t * 3) % 2;
      return mk(f(1, 2, 3, 3 + roll), n(3, 2, 6, 3 - roll));
    }
    if (isCrouch) return mk(f(1, 3, 3, 5), n(3, 3, 5, 5 + (Math.floor(t * 3) % 2)));
    if (d.doing === 'sit_with_cat') return mk(f(1, 2, 2, 4), n(2, 3, 6 + (Math.floor(t * 1.2) % 2), 4));
    if (d.doing === 'read' || d.doing === 'news') return mk(f(2, 1, 4, 0), n(3, 2, 6, 1));
    if (d.doing === 'write' || d.doing === 'study') return mk(f(2, 2, 4, 2), n(3, 2, 6 + (Math.floor(t * 4) % 2), 2));
    if (d.doing === 'type') {
      const k = Math.floor(t * 8) % 2;
      return mk(f(2, 2, 4, 2 - k), n(3, 2, 6, 1 + k));
    }
    if (d.doing === 'guitar') return mk(f(2, 1, 5, -1), n(2, 3, 4, 3 + (Math.floor(t * 6) % 2)));
    if (d.doing === 'campfire') return mk(f(1, 3, 2, 4), n(2, 2, 6, 2));
    if (pose === 'sit') return mk(f(1, 2, 3, 4), n(2, 3, 4, 4));
    if (d.doing === 'talk') {
      if (d.speaking && Math.floor(t * 0.8 + d.x) % 3 === 0) return mk(f(1, 2, 3, 1), n(2, 1, 5, -1 + (Math.floor(t * 4) % 2)));
      return mk(f(1, 2, 2, 3), n(1, 3, 3, 4));
    }
    if (d.doing === 'water' || d.doing === 'help_water') {
      const tip = Math.sin(t * 2 + d.x) > 0 ? 1 : 0;
      return mk(f(1, 2, 2, 4), n(3, 2, 6, 2 + tip));
    }
    if (d.doing === 'mow') {
      const push = mowPh < 0.5 ? 0 : 1;
      return mk(f(2, 1, 4 + push, 2), n(3, 2, 5 + push, 2));
    }
    if (d.doing === 'rake' || d.doing === 'shovel') {
      if (rakeStage === 'reach') return mk(f(2, 0, 5, 1), n(3, 2, 6, 3));
      if (rakeStage === 'pull') return mk(f(1, 1, 2, 2), n(1, 2, 3, 4));
      return d.doing === 'shovel' ? mk(f(2, 0, 4, 0), n(3, 1, 6, -1)) : mk(f(1, 1, 3, 1), n(2, 2, 5, 2));
    }
    if (d.doing === 'till' || d.doing === 'hoe') {
      if (tillStage === 'windup') return mk(f(1, -2, 2, -4), n(2, -1, 4, -4));
      if (tillStage === 'chop') return mk(f(2, 1, 4, 3), n(3, 2, 6, 4));
      if (tillStage === 'pull') return mk(f(1, 2, 2, 3), n(2, 2, 4, 4));
      return mk(f(2, 0, 3, 1), n(3, 1, 5, 1));
    }
    if (d.doing === 'chop') {
      if (chopStage === 'windup') return mk(f(-1, -3, -2, -5 - r), n(1, -2, 2, -5 - r));
      if (chopStage === 'snap') return mk(f(2, -1, 4, -1), n(3, 0, 6, 0));
      if (chopStage === 'impact') return mk(f(2, 2, 4, 4), n(3, 2, 6, 4));
      return mk(f(1, 0, 2, 1), n(2, 1, 4, 2));
    }
    if (d.doing === 'hammer') {
      if (hammerStage === 'raise') return mk(f(1, 2, 1, 4), n(2, -1, 4, -3 - r));
      if (hammerStage === 'strike') return mk(f(1, 2, 1, 4), n(3, 1, 6, 2));
      if (hammerStage === 'rebound') return mk(f(1, 2, 1, 4), n(2, 0, 5, -1));
      return mk(f(1, 2, 1, 4), n(2, 1, 4, 1));
    }
    if (d.doing === 'scythe') {
      if (scytheStage === 'windup') return mk(f(0, 1, -1, 2), n(0, 2, 0, 3));
      if (scytheStage === 'sweep') return mk(f(2, 2, 5, 2), n(3, 2, 6, 3));
      if (scytheStage === 'follow') return mk(f(2, 0, 4, 0), n(3, 1, 6, 1));
      return mk(f(1, 1, 2, 2), n(1, 2, 3, 3));
    }
    if (d.doing === 'fish') {
      if (fishCyc < 0.45) return mk(f(1, 1, 2, 2), n(0, -1, -2, -3));
      if (fishCyc < 0.80) return mk(f(1, 2, 2, 2), n(3, 0, 6, -1));
      if (fishNibble) return mk(f(1, 2, 2, 2), n(2, 0, 5, -1));
      return mk(f(1, 2, 2, 2), n(3, 1, 6, 1));
    }
    if (d.doing === 'feed') return mk(f(1, 1, 3, -1), n(3, 0, 6, -3));
    if (d.doing === 'kite') return mk(f(2, 0, 4, -2), n(2, 2, 5, 0));
    if (d.doing === 'pick') return mk(f(1, 2, 1, 4), n(2, -1, 6, -4));
    if (d.doing === 'shelf') return mk(f(1, 2, 2, 3), n(2, -1, 6, -3 - (Math.floor(t * 0.8) % 3)));
    if (d.doing === 'tea') return mk(f(1, 2, 2, 4), n(3, 2, 6, 1));
    if (d.doing === 'sow') {
      if (sowStage === 'dip') return mk(f(1, 2, 1, 3), n(0, 2, 1, 4));
      if (sowStage === 'fling') return mk(f(1, 2, 1, 3), n(3, 0, 6, -2));
      return mk(f(1, 2, 1, 3), n(2, 2, 4, 2));
    }
    if (d.doing === 'give') return mk(f(2, 1, 4, 1), n(3, 2, 6, 2));
    if (d.doing === 'sketch') return mk(f(1, 2, 2, 3), n(3, 1, 6, -(Math.floor(t * 3) % 3)));
    if (d.doing === 'hose') return mk(f(2, 2, 3, 2), n(2, 3, 6, 3));
    if (d.doing === 'clean' || d.doing === 'tidy') {
      const a = t * 5;
      return mk(f(1, 2, 1, 4), n(2, 0, 6 + Math.round(Math.cos(a)), -1 + Math.round(Math.sin(a))));
    }
    if (d.doing === 'paint') return mk(f(1, 2, 2, 3), n(2, 1, 6, 1 - (Math.floor(t * 3) % 4)));
    return mk(f(1, 2, 1, 4 + r), n(0, 3, 1, 4 + r));
  };

  const plotArm = (sx: number, sy: number, ex: number, ey: number, hx: number, hy: number, armCh: string, handCh: string) => {
    const seg = (x0p: number, y0p: number, x1p: number, y1p: number, ch: string) => {
      const steps = Math.max(1, Math.abs(x1p - x0p), Math.abs(y1p - y0p));
      for (let i = 0; i <= steps; i++) {
        const px = Math.round(x0p + ((x1p - x0p) * i) / steps) + HPAD;
        const py = Math.round(y0p + ((y1p - y0p) * i) / steps) + VPAD;
        if (py >= 0 && py < gridH && px >= 0 && px < gridW) rows[py][px] = ch;
      }
    };
    seg(sx, sy, ex, ey, armCh);
    seg(ex, ey, hx, hy, armCh);
    const rx = Math.round(hx) + HPAD, ry = Math.round(hy) + VPAD;
    if (ry >= 0 && ry < gridH && rx >= 0 && rx < gridW) rows[ry][rx] = handCh;
  };

  const arms = isIdle ? null : armPose();
  if (arms) plotArm(fsx, fsy, arms.fe[0], arms.fe[1], arms.fh[0], arms.fh[1], S.arm.far, S.arm.farHand);
  put(legSrc, legAt);
  if (extraRow) put(extraRow, total - 1);
  put(baseUpper, upperAt, leanX, S.arm.leanRows);
  if (arms) plotArm(nsx, nsy, arms.ne[0], arms.ne[1], arms.nh[0], arms.nh[1], S.arm.near, S.arm.nearHand);

  // Tilt visor/eyes up 1 row when flying a kite so Delamain watches the sky
  if (d.doing === 'kite' && !d.walking) {
    const rVis = upperAt + 2 + VPAD, rUp = upperAt + 1 + VPAD;
    if (rUp >= 0 && rVis < gridH) {
      for (let x = 0; x < gridW; x++) {
        const ch = rows[rVis][x];
        if (ch === 'v' || ch === 'V') { rows[rUp][x] = ch; rows[rVis][x] = 'h'; }
      }
    }
  }
  if (idleBreath && S.w >= 13 && 13 + VPAD < gridH) {
    rows[13 + VPAD][2 + HPAD] = '.';
    rows[14 + VPAD][2 + HPAD] = 's';
  }

  const blinking = (t * 0.45 + d.x * 0.01) % 7 < 0.06;
  if (!blinking && S.glow) {
    const gl = (((t + d.x * 0.13) % 5.2) + 5.2) % 5.2;
    if (gl < 0.32) {
      const visRow = (d.doing === 'kite' && !d.walking ? upperAt + 1 : upperAt + 2) + VPAD;
      if (visRow >= 0 && visRow < gridH) {
        const cols: number[] = [];
        for (let x = 0; x < gridW; x++) if (rows[visRow][x] === 'v' || rows[visRow][x] === 'V') cols.push(x);
        if (cols.length) rows[visRow][cols[Math.min(cols.length - 1, Math.floor((gl / 0.32) * cols.length))]] = 'G';
      }
    }
  }
  if (blinking) rows.forEach(r => r.forEach((c, i) => { if (c === 'v' || c === 'V') r[i] = 'h'; if (c === 'e') r[i] = 'f'; }));   // a blink
  const sitDrop = pose === 'sit' ? Math.max(0, S.legs.seat.length - 2) : 0;     // seated: the thighs rest on the seat, the shins hang below it
  const x0 = Math.round(d.x) - (S.w >> 1), y0 = Math.round(d.y) - total + sitDrop;
  if (S.glow) b.glow(Math.round(d.x), y0 + 10 + upperAt, 16, S.glow, 0.15 * (0.75 + 0.25 * Math.sin(t * 3)));
  // soft contact AO + sun-aligned cast shadow (suppressed when sitting on elevated furniture)
  if (pose !== 'sit' || d.doing === 'campfire' || d.doing === 'guitar') {
    const sw = pose === 'walk' && walkPhase % 3 === 0 ? (S.w >= 13 ? 9 : 8) : isCrouch ? (S.w >= 13 ? 8 : 7) : (S.w >= 13 ? 7 : 6);
    const footY = Math.min(WH - 1, y0 + total >= WH ? WH - 1 : y0 + total);
    const aoCol: RGB = snowCover ? [76, 112, 166] : [18, 26, 44];
    const cx0 = Math.round(d.x) - (sw >> 1);
    b.rect(cx0 + 1, footY, sw - 2, 1, aoCol, 0.34);
    b.set(cx0, footY, aoCol, 0.15);
    b.set(cx0 + sw - 1, footY, aoCol, 0.15);
    const indoors = (d.x < 81 && d.y <= 158) || (d.x >= 86 && d.x <= 168 && d.y <= 155);
    if (sun?.active && (!indoors || (d.x >= 26 && d.x <= 70 && d.y >= 145))) {
      const reach = Math.round(sun.sx * (indoors ? 2.5 : isCrouch ? 6 : 9));
      const step = reach >= 0 ? 1 : -1;
      const dist = Math.abs(reach);
      for (let i = 1; i <= dist; i++) {
        const f = i / Math.max(1, dist);
        const px = Math.round(d.x) + step * (1 + i);
        const a = sun.alpha * (indoors ? 0.45 : 0.9) * (1 - f * 0.65);
        if (f > 0.35 && !dith(px, footY, 0.72 - f * 0.35)) continue;
        b.set(px, footY, sun.col, a);
        if (i < dist * 0.6 && footY > 116) b.set(px, footY - 1, sun.col, a * 0.45);
      }
    }
  }
  const fx = (x: number) => x0 + (d.facing < 0 ? S.w - 1 - x : x);
  if (S.pack && pose !== 'sit') {
    const ph = isCrouch ? 4 : 6, py0 = y0 + upperAt + (isCrouch ? 5 : 6);
    for (let j = 0; j < ph; j++) for (let i = 0; i < 3; i++) b.set(fx(i), py0 + j, S.pack);
  }
  const hasOutfit = !!outfit && ((outfit.hat && outfit.hat !== 'none') || (outfit.scarf && outfit.scarf !== 'none') || (outfit.coat && outfit.coat !== 'none') || (outfit.boots && outfit.boots !== 'standard'));
  const ovr = hasOutfit && outfit ? applyOutfit(rows, d, isIdle, pose, baseUpper.length, upperAt, legAt, HPAD, VPAD, outfit, t) : null;
  rows.forEach((row, y) => row.forEach((ch, x) => {
    const oc = ovr?.[y][x];
    if (oc) { b.set(fx(x - HPAD), y0 + y - VPAD, oc); return; }
    const c = S.col[ch];
    if (ch !== '.' && c) b.set(fx(x - HPAD), y0 + y - VPAD, c);
  }));
  if (S.veil) {
    const vx0 = isCrouch ? 4 : 3;
    for (let i = vx0; i < vx0 + 5; i++) { b.set(fx(i), y0 + upperAt + 2, [120, 113, 108], 0.55); b.set(fx(i), y0 + upperAt + 3, [120, 113, 108], 0.45); }
  }
  if (pose === 'walk' && (walkPhase === 0 || walkPhase === 3) && d.x >= 168 && d.y >= 156) {
    const sub = (((d.stride ?? t * 11) / 2.1) % 1 + 1) % 1;
    const pc: RGB = snowCover ? [224, 234, 244] : [214, 198, 170];
    b.set(fx(cx - 3), y0 + total - 1 - Math.round(sub * 1.5), pc, 0.45 * (1 - sub * 0.6));
    b.set(fx(cx - 4), y0 + total - 1, pc, 0.3 * (1 - sub * 0.6));
  }

  const dir = d.facing < 0 ? -1 : 1;
  const hand = arms ? { x: fx(arms.nh[0]), y: y0 + arms.nh[1] } : { x: fx(S.w - 2), y: y0 + upperAt + S.arm.sy + 4 };
  const farHand = arms ? { x: fx(arms.fh[0]), y: y0 + arms.fh[1] } : hand;
  if (d.walking) {
    if (d.speaking) {
      const bx = Math.round(d.x) + dir * 4, by = y0 + upperAt - 8;
      for (let j = 0; j < 5; j++) for (let i = -4; i <= 4; i++) if (!((j === 0 || j === 4) && Math.abs(i) === 4)) b.set(bx + i, by + j, [248, 250, 252], 0.92);
      b.set(bx - dir * 2, by + 5, [248, 250, 252], 0.92); b.set(bx - dir * 3, by + 6, [248, 250, 252], 0.8);
      for (let k = 0; k < 3; k++) b.set(bx - 2 + k * 2, by + 2 - (Math.floor(t * 4) % 3 === k ? 1 : 0), [71, 85, 105]);
    }
    return;
  }
  const woodL: RGB = [180, 130, 80], woodD: RGB = [110, 72, 38];
  const steelL: RGB = [226, 232, 240], steelM: RGB = [148, 163, 184], steelD: RGB = [90, 104, 124];
  const shaft = (x0s: number, y0s: number, x1s: number, y1s: number) => {
    b.line(x0s, y0s, x1s, y1s, woodD);
    b.line(x0s, y0s - 1, x1s, y1s - 1, woodL);
  };
  if (d.doing === 'water' || d.doing === 'help_water') {      // shaded 5x4 tin watering can, tipping to pour
    const tip = Math.sin(t * 2 + d.x) > 0 ? 1 : 0, bx = hand.x + (dir < 0 ? -5 : 1), by = hand.y - 2;
    b.set(bx + (dir < 0 ? 5 : -1), by + 1, steelD); b.set(bx + (dir < 0 ? 5 : -1), by + 2, steelM);   // loop handle
    b.rect(bx, by, 5, 4, steelM); b.rect(bx, by, 5, 1, steelL); b.rect(bx, by + 3, 5, 1, steelD);
    const sx0 = bx + (dir < 0 ? 0 : 4), sy0 = by + 2;
    b.line(sx0, sy0, sx0 + dir * 3, sy0 - 3 + tip * 2, steelM);
    b.set(sx0 + dir * 3, sy0 - 4 + tip * 2, steelL); b.set(sx0 + dir * 4, sy0 - 3 + tip * 2, steelL);   // rose head
    if (tip) for (let k = 0; k < 5; k++) {
      const ph = (t * 2.2 + k / 5) % 1;
      b.set(sx0 + dir * (4 + (k % 2)), sy0 - 2 + Math.round(ph * 8), k % 2 ? [125, 211, 252] : [224, 242, 254], 0.9 - ph * 0.4);
    }
  }
  if (d.doing === 'harvest') { b.rect(hand.x - (dir < 0 ? 4 : -1), hand.y + 1, 4, 3, [161, 98, 7]); b.set(hand.x + dir, hand.y, [74, 222, 128]); b.set(hand.x + dir * 2, hand.y, [74, 222, 128]); }
  if (d.doing === 'read') {                                // a book, its pages turning now and then
    const bx = hand.x + dir, by = hand.y - 2;
    b.rect(Math.min(bx, bx + dir * 2), by, 3, 4, [127, 29, 29]); b.set(bx + dir, by + 1, [241, 237, 226]);
    if ((t % 9) < 0.4) b.set(bx + dir * 2, by - 1, [241, 237, 226]);
  }
  if (d.doing === 'news') {                                // a broadsheet held open
    const nx = hand.x + dir * 2, ny = hand.y - 4;
    for (let j = 0; j < 6; j++) for (let i = -2; i <= 2; i++) b.set(nx + i, ny + j, (j % 2 && i !== 0) ? [150, 146, 136] : [232, 228, 216]);
    if (Math.floor(t * 0.3) % 5 === 0) b.set(nx + 3 * dir, ny + 1, [232, 228, 216]);
  }
  if (d.doing === 'study') {                               // an open book on the desk, and notes beside it
    const bx = hand.x + dir * 2, by = hand.y;
    b.rect(Math.min(bx, bx + dir * 3), by, 4, 2, [241, 237, 226]); b.set(bx + dir, by, [100, 100, 110]); b.set(bx + dir * 3, by + 1, [100, 100, 110]);
    if (Math.floor(t * 0.5) % 6 === 0) b.set(bx + dir * 2, by - 1, [241, 237, 226]);
  }
  if (d.doing === 'tea') {                                 // a mug, steaming
    b.rect(hand.x + dir, hand.y - 1, 2, 2, [241, 237, 226]); b.set(hand.x + dir * 3, hand.y, [241, 237, 226]);
    for (let k = 0; k < 3; k++) { const ph = (t * 0.6 + k / 3) % 1; b.set(hand.x + dir + Math.round(Math.sin(t * 2 + k) * 1), hand.y - 2 - ph * 5, [230, 230, 235], 0.5 * (1 - ph)); }
  }
  if (d.doing === 'weed' && Math.floor(t * 2.5) % 2) { b.set(hand.x + dir, hand.y, [110, 74, 42]); b.set(hand.x + dir, hand.y - 1, [86, 140, 46]); b.set(hand.x + dir, hand.y - 2, [163, 230, 53]); }
  if (d.doing === 'write') {                               // pen moving across the page
    const px = hand.x + dir, py = hand.y;
    b.set(px, py, [30, 41, 59]); b.set(px - dir, py - 1, [30, 41, 59]);
  }
  const groundY = Math.round(d.y);
  if (d.doing === 'mow') {                                 // shaded 6x3 red push mower with spoked wheels and T-handle
    const push = mowPh < 0.5 ? 0 : 1;
    const mx = hand.x + dir * (6 + push), my = groundY - 3;
    b.line(farHand.x, farHand.y, hand.x, hand.y, steelL);
    b.line(hand.x, hand.y, mx - dir, my, steelM);
    b.rect(mx - 3, my - 1, 6, 3, [185, 28, 28]); b.rect(mx - 2, my - 1, 4, 1, [220, 38, 38]); b.rect(mx - 3, my + 1, 6, 1, [127, 29, 29]);
    for (const wx of [mx - 2, mx + 2]) {
      b.rect(wx - 1, my, 3, 3, [30, 41, 59]); b.set(wx, my + 1, steelM);
    }
    if (mowPh < 0.7) {
      b.set(mx - dir * 4, my - 1 - (mowPh < 0.35 ? 1 : 0), [134, 239, 172]);
      b.set(mx - dir * 5, my - 2, [74, 170, 60]);
    }
  }
  if (d.doing === 'rake' || d.doing === 'shovel') {        // 2-tone handle + toothed rake or steel scoop
    const reach = rakeStage === 'reach' ? 7 : rakeStage === 'pull' ? 3 : 5;
    const ex = hand.x + dir * reach, ey = d.doing === 'shovel' && rakeStage === 'toss' ? groundY - 4 : groundY - 1;
    b.line(farHand.x, farHand.y, hand.x, hand.y, woodD);
    shaft(hand.x, hand.y, ex, ey);
    if (d.doing === 'rake') {
      b.rect(ex - 2, ey - 1, 5, 1, steelM);
      for (let tx = -2; tx <= 2; tx += 2) b.set(ex + tx, ey, steelL);
      if (rakeStage === 'pull' || rakeStage === 'toss') {
        b.set(ex - dir, ey - 2, [190, 100, 40]); b.set(ex + dir, ey - 3, [214, 150, 50]);
      }
    } else {
      b.rect(ex - 1, ey - 1, 3, 2, steelM); b.rect(ex - 1, ey, 3, 1, steelL);
      if (rakeStage === 'toss') {
        b.set(ex + dir * 2, ey - 2, [224, 234, 244]); b.set(ex + dir * 3, ey - 3, [240, 246, 252]);
      }
    }
  }
  if (d.doing === 'clean' || d.doing === 'tidy') {         // a cloth, or a duster, going round
    const a = t * 5, cx2 = hand.x + dir, cy2 = hand.y + Math.round(Math.sin(a));
    b.rect(cx2, cy2, 2, 2, d.doing === 'clean' ? [242, 242, 238] : [250, 204, 21]);
    if (d.doing === 'tidy' && Math.floor(t * 4) % 3 === 0) b.set(cx2 + dir * 2, cy2 - 1, [200, 196, 190]);
  }
  if (d.doing === 'paint') {                               // brush up and down, the pot at his feet
    b.line(hand.x, hand.y, hand.x + dir, hand.y - 2, woodL); b.set(hand.x + dir, hand.y - 3, [240, 240, 235]);
    b.rect(hand.x - dir * 4, groundY - 3, 3, 3, steelM);
  }
  if (d.doing === 'plant') {
    b.set(hand.x + dir, hand.y, [74, 222, 128]);
    b.set(hand.x + dir, hand.y - 1, [134, 239, 172]);
    if (Math.floor(t * 3) % 2) b.set(hand.x + dir * 2, hand.y - 1, [134, 239, 172]);
    b.set(hand.x + dir, hand.y + 1, [120, 90, 60]);
  }
  if (d.doing === 'fish') {
    const R = 12;
    let ang = 0.95, flying = -1;
    if (fishCyc < 0.45) ang = 0.95 + (2.25 - 0.95) * (fishCyc / 0.45);
    else if (fishCyc < 0.80) ang = 2.25 - (2.25 - 0.42) * ((fishCyc - 0.45) / 0.35);
    else if (fishCyc < 1.50) { ang = 0.42 + (0.95 - 0.42) * ((fishCyc - 0.80) / 0.70); flying = (fishCyc - 0.80) / 0.70; }
    else if (fishNibble) ang = 0.72;
    const midX = hand.x + dir * Math.cos(ang + 0.08) * (R * 0.55), midY = hand.y - Math.sin(ang + 0.08) * (R * 0.55);
    const tipX = hand.x + dir * Math.cos(ang) * R, tipY = hand.y - Math.sin(ang) * R + (fishNibble ? 1 : 0);
    b.line(hand.x, hand.y, midX, midY, woodD);
    b.line(midX, midY, tipX, tipY, woodL);
    b.set(hand.x - dir, hand.y + 1, [180, 140, 90]);                        // cork butt
    if (fishCyc >= 0.80) {
      const restX = tipX + dir * 7, restY = POND.cy - 1;
      const fxp = flying >= 0 ? tipX + (restX - tipX) * flying : restX;
      const fyp = flying >= 0 ? tipY + (restY - tipY) * flying - Math.sin(flying * Math.PI) * 6 : restY + Math.round(Math.sin(t * 2.2) * 0.5) + (fishNibble ? 1 : 0);
      b.line(tipX, tipY, fxp, fyp - 1, [226, 232, 240], 0.5);
      b.set(fxp, fyp - 1, [239, 68, 68]); b.set(fxp, fyp, [248, 250, 252]);
      if (fishNibble && flying < 0) for (let a = 0; a < 8; a++) b.set(fxp + Math.cos(a / 8 * Math.PI * 2) * 3, fyp + 1 + Math.sin(a / 8 * Math.PI * 2), [255, 255, 255], 0.45);
    }
  }
  if (d.doing === 'till' || d.doing === 'hoe') {          // wind-up -> chop -> soil-drag -> lift
    const ex = hand.x + dir * (tillStage === 'windup' ? 3 : tillStage === 'chop' ? 6 : tillStage === 'pull' ? 4 : 5);
    const ey = tillStage === 'windup' ? hand.y - 5 : tillStage === 'chop' || tillStage === 'pull' ? groundY - 1 : hand.y - 2;
    b.line(farHand.x, farHand.y, hand.x, hand.y, woodD);
    shaft(hand.x, hand.y, ex, ey);
    b.rect(ex, ey - 1, 2, 1, steelM); b.set(ex + dir, ey, steelL); b.set(ex + dir, ey + 1, steelL);
    if (tillStage === 'chop' || tillStage === 'pull') {
      const pc: RGB = d.doing === 'hoe' ? [96, 156, 50] : [120, 86, 56];
      b.set(ex + dir * 2, ey - 2, pc); b.set(ex + dir * 3, ey - 3, pc);
      if (tillStage === 'pull') b.set(ex - dir, ey - 1, pc);
    }
  }
  if (d.doing === 'sow') {                                 // dip into hip seed pouch -> wide fling arc of golden seeds
    b.rect(farHand.x - 1, farHand.y, 3, 3, [196, 170, 120]);
    b.rect(farHand.x - 1, farHand.y, 3, 1, [138, 102, 66]);
    if (sowStage === 'fling') {
      const f = (sowPh - 0.28) / 0.34;
      for (let k = 0; k < 6; k++) {
        const s = Math.min(1, f * 0.8 + k * 0.12);
        const sx = hand.x + dir * (1 + s * (4 + (k % 3) * 2));
        const sy = hand.y - 1 - Math.sin(s * Math.PI) * 3 + s * (groundY - hand.y + 1);
        b.set(sx, sy, k % 2 ? [253, 224, 71] : [234, 200, 120], 1 - s * 0.35);
      }
    }
  }
  if (d.doing === 'hose') {                                // brass nozzle + trailing hose + bright spray arc
    b.line(hand.x, hand.y, hand.x - dir * 6, groundY, [42, 102, 52]);
    b.line(hand.x, hand.y - 1, hand.x - dir * 6, groundY - 1, [74, 152, 82]);
    b.set(hand.x + dir, hand.y, [234, 179, 8]);
    for (let k = 0; k < 9; k++) { const ph = (t * 1.8 + k / 9) % 1, px = hand.x + dir * (2 + ph * 9), py = hand.y - 2 + ph * ph * (groundY - hand.y + 3) - ph * 3;
      b.set(px, py, k % 3 === 0 ? [224, 242, 254] : [125, 211, 252], 0.9 - ph * 0.35); }
  }
  if (d.doing === 'scythe') {                              // curved 2px snath + 5px curved steel blade + stalk clippings
    const bx = hand.x + dir * (scytheStage === 'windup' ? -2 : scytheStage === 'sweep' ? 7 : scytheStage === 'follow' ? 6 : 4);
    const by = scytheStage === 'windup' ? groundY - 3 : scytheStage === 'sweep' ? groundY - 1 : scytheStage === 'follow' ? groundY - 4 : groundY - 2;
    b.line(farHand.x, farHand.y, hand.x, hand.y, woodD);
    shaft(hand.x, hand.y, bx, by);
    b.line(bx, by, bx + dir * 4, by - 1, steelM);
    b.line(bx + dir, by + 1, bx + dir * 5, by - 1, steelL);
    if (scytheStage === 'sweep') {
      b.set(bx + dir * 4, by - 3, [234, 200, 100]); b.set(bx + dir * 5, by - 4, [250, 204, 21]); b.set(bx + dir * 2, by - 2, [202, 178, 84]);
    }
  }
  if (d.doing === 'gather') {                              // a basket in front of him, filling
    const bx = Math.round(d.x) + dir * 5;
    b.rect(bx - 1, groundY - 3, 4, 3, [161, 98, 7]); b.set(bx, groundY - 4, [234, 200, 100]);
    if (Math.floor(t * 2) % 2) b.set(hand.x + dir, hand.y, [234, 200, 100]);
  }
  if (d.doing === 'pick') {                                // reaching up into the branches, a basket at his feet
    b.rect(hand.x - dir * 5, groundY - 3, 4, 3, [161, 98, 7]); b.set(hand.x - dir * 4, groundY - 4, [220, 38, 38]); b.set(hand.x - dir * 3, groundY - 4, [220, 38, 38]);
    if (Math.floor(t * 1.5) % 2) b.set(hand.x + dir, hand.y - 1, [220, 38, 38]);
  }
  if (d.doing === 'hammer') {                              // high raise -> fast strike + spark -> rebound -> rest
    const hx2 = hand.x + dir * (hammerStage === 'raise' ? 1 : 4);
    const hy2 = hammerStage === 'raise' ? hand.y - 4 : hammerStage === 'strike' ? hand.y : hammerStage === 'rebound' ? hand.y - 2 : hand.y - 1;
    shaft(hand.x, hand.y, hx2, hy2);
    b.rect(hx2 - 1, hy2 - 1, 4, 2, steelD); b.rect(hx2 - 1, hy2 - 1, 3, 1, steelL);
    if (hammerStage === 'strike') {
      b.set(hx2 + dir * 3, hy2 - 1, [253, 224, 71]); b.set(hx2 + dir * 2, hy2 - 2, [255, 255, 255]);
    }
  }
  if (d.doing === 'chop') {                                // windup -> fast snap blur -> impact hold + flying wood chips
    const ax = chopStage === 'windup' ? hand.x - dir * 2 : chopStage === 'snap' ? hand.x + dir * 4 : chopStage === 'impact' ? hand.x + dir * 5 : hand.x + dir * 3;
    const ay = chopStage === 'windup' ? hand.y - 4 : chopStage === 'snap' ? hand.y - 2 : chopStage === 'impact' ? groundY - 3 : hand.y - 2;
    b.line(farHand.x, farHand.y, hand.x, hand.y, woodD);
    shaft(hand.x, hand.y, ax, ay);
    // Shaded steel axe head
    b.rect(ax - (dir < 0 ? 2 : 0), ay - 1, 2, 2, steelM);
    b.set(ax + (dir < 0 ? -2 : 2), ay - 1, steelL);
    b.set(ax + (dir < 0 ? -2 : 2), ay, steelL);
    b.set(ax + (dir < 0 ? 0 : -1), ay, steelD);
    if (chopStage === 'snap') {
      b.line(hand.x - dir, hand.y - 6, ax, ay - 2, steelL, 0.45);
    } else if (chopStage === 'impact') {
      const f = (chopPh - 0.44) / 0.26;
      for (let k = 0; k < 3; k++) {
        const cx3 = ax + dir * (2 + Math.round(f * 3 + k));
        const cy3 = ay - 1 - Math.round(Math.sin(Math.min(1, f + k * 0.2) * Math.PI) * 3);
        b.set(cx3, cy3, k === 1 ? [224, 190, 128] : [180, 130, 80]);
      }
    }
  }
  if (d.doing === 'feed') {                                // seed poured up into the feeder
    b.rect(hand.x + dir, hand.y - 1, 2, 2, [196, 170, 120]);
    for (let k = 0; k < 3; k++) { const ph = (t * 2 + k / 3) % 1; b.set(hand.x + dir * (1 + Math.round(ph)), hand.y - 2 - ph * 5, [234, 200, 120], 1 - ph * 0.4); }
  }
  if (d.doing === 'kite') {                                // continuous taut string from spool -> guiding hand -> kite
    const sgn = WIND >= 0 ? 1 : -1;
    const pull = Math.sin(t * 2.1) * 1.5;
    const kx = Math.round(farHand.x + sgn * (26 + Math.sin(t * 0.7) * 5 + windyNow() * 6 + pull));
    const ky = Math.round(farHand.y - 31 - Math.sin(t * 1.1) * 4 - windyNow() * 6);
    b.rect(hand.x, hand.y, 2, 2, woodL);                                   // wooden spool in lower hand
    b.line(hand.x, hand.y, farHand.x, farHand.y, [241, 245, 249], 0.85);   // taut line between hands
    let px0 = farHand.x, py0 = farHand.y;
    for (let k = 1; k <= 8; k++) {
      const f = k / 8;
      const px1 = farHand.x + (kx - farHand.x) * f;
      const py1 = farHand.y + (ky - farHand.y) * f + Math.sin(f * Math.PI) * 3;
      b.line(px0, py0, px1, py1, [241, 245, 249], 0.72);
      px0 = px1; py0 = py1;
    }
    for (let j = -2; j <= 2; j++) for (let i = -2 + Math.abs(j); i <= 2 - Math.abs(j); i++) b.set(kx + i, ky + j, i * sgn < 0 ? [220, 38, 38] : [250, 204, 21]);
    for (let k = 1; k < 7; k++) b.set(kx + sgn * k, ky + 2 + Math.round(Math.sin(t * 6 + k) * 1.2), k % 2 ? [37, 99, 235] : [220, 38, 38]);
  }
  if (d.doing === 'snowman') {                             // rolling a ball of snow along
    const r2 = 2 + Math.floor((t * 0.2) % 3);
    for (let j = -r2; j <= r2; j++) for (let i = -r2; i <= r2; i++) if (i * i + j * j <= r2 * r2) b.set(hand.x + dir * (r2 + 1) + i, groundY - r2 + j, j > r2 / 3 || i > r2 / 2 ? [190, 206, 224] : [230, 238, 246]);
  }
  if (d.doing === 'campfire') {                            // a stick held out over the fire
    b.line(hand.x, hand.y, hand.x + dir * 7, hand.y - 3, [120, 84, 50]); b.set(hand.x + dir * 8, hand.y - 3, [236, 214, 120]);
  }
  if (d.doing === 'guitar') {                              // shaded spruce acoustic guitar across his lap + neck + floating notes
    const gx = hand.x - dir * 1, gy = hand.y;
    const xL = Math.min(gx - dir * 3, gx + dir * 2), xR = Math.max(gx - dir * 3, gx + dir * 2);
    // Lower and upper contoured body bouts with dark rim & bright spruce highlight
    b.rect(xL, gy - 1, xR - xL + 1, 3, [196, 122, 48]);
    b.rect(xL + 1, gy - 2, xR - xL - 1, 4, [217, 148, 72]);
    b.rect(xL + 1, gy - 2, xR - xL - 1, 1, [238, 180, 96]);
    b.rect(xL + 1, gy + 1, xR - xL - 1, 1, [92, 44, 16]);
    b.set(gx, gy, [45, 25, 15]);                                           // dark soundhole
    b.set(gx - dir * 2, gy, [236, 214, 160]);                              // bridge / strings
    // Angled neck to fretting hand + headstock
    b.line(gx + dir * 2, gy - 1, farHand.x, farHand.y, [110, 68, 34]);
    b.set(farHand.x + dir, farHand.y - 1, [82, 48, 24]);
    b.set(hand.x, hand.y, S.col[S.arm.nearHand]);                          // strumming hand over strings
    for (let k = 0; k < 2; k++) {
      const ph = (t * 0.4 + k / 2) % 1, nx = gx + dir * 4 + Math.round(Math.sin(t + k * 3) * 1.5), ny = gy - 9 - ph * 11;
      const nc: RGB = [253, 224, 138];
      b.set(nx, ny, nc, 1 - ph); b.set(nx, ny - 1, nc, 1 - ph); b.set(nx + 1, ny - 2, nc, 1 - ph); b.set(nx - 1, ny + 1, nc, 1 - ph);
    }
  }
  if (d.doing === 'sketch') {                              // A-frame tripod easel + framed 7x8 landscape miniature
    const ex = hand.x + dir * 4;
    const cLeft = dir > 0 ? ex : ex - 6;
    const cTop = hand.y - 8;
    b.line(cLeft + 3, cTop - 1, cLeft + 3 - dir * 2, groundY, woodD);      // rear support leg
    b.line(cLeft, groundY, cLeft + 3, cTop - 1, woodL);                    // front left leg
    b.line(cLeft + 6, groundY, cLeft + 3, cTop - 1, woodL);                // front right leg
    b.rect(cLeft, cTop, 7, 8, [180, 138, 86]);                             // oak canvas frame
    b.rect(cLeft + 1, cTop + 1, 5, 6, [244, 240, 230]);                    // canvas ground
    // Tiny real landscape picture (sky, mountain, meadow, tree, sun)
    const stage = Math.floor(t * 0.9) % 4;
    b.rect(cLeft + 1, cTop + 1, 5, 2, [125, 186, 248]);
    b.rect(cLeft + 1, cTop + 4, 5, 3, [86, 152, 62]);
    b.set(cLeft + 2, cTop + 3, [100, 116, 139]); b.set(cLeft + 3, cTop + 2, [148, 163, 184]); b.set(cLeft + 4, cTop + 3, [100, 116, 139]);
    if (stage >= 1) { b.set(cLeft + 2, cTop + 5, [34, 108, 54]); b.set(cLeft + 2, cTop + 4, [21, 83, 45]); }
    if (stage >= 2) { b.set(cLeft + 5, cTop + 1, [250, 204, 21]); }
    if (stage >= 3) { b.set(cLeft + 4, cTop + 5, [220, 68, 56]); }
    b.rect(cLeft - 1, cTop + 8, 9, 1, woodD);                              // wooden tray ledge
    b.set(hand.x + dir, hand.y - 1, woodL); b.set(hand.x + dir * 2, hand.y - 2, [59, 130, 246]);   // brush
  }
  if (d.doing === 'tank') {                                // sprinkling food over the aquarium
    b.set(hand.x + dir, hand.y, [214, 190, 120]);
    if (Math.floor(t * 1.5) % 3 === 0) { const ph = (t * 2.5) % 1; b.set(hand.x + dir, hand.y + 1 + ph * 3, [214, 190, 120], 1 - ph * 0.4); }
  }
  if (d.doing === 'cook') { b.line(hand.x, hand.y, hand.x + dir * 2, hand.y + 2, woodL); b.set(hand.x + dir * 2, hand.y + 2, steelM); }
  if (d.doing === 'give') { b.rect(hand.x + dir, hand.y - 1, 2, 2, [236, 214, 120]); }
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
    ? {
        h: [30, 16, 40], H: [20, 10, 28], G: [255, 255, 255],
        v: mix([232, 121, 249], [253, 230, 255], pulse - 0.5),
        V: mix([245, 208, 254], [255, 255, 255], pulse - 0.5),
        k: [88, 28, 135], K: [58, 18, 92], R: [120, 48, 172],
        t: [232, 121, 249], n: [40, 20, 50],
        s: [107, 33, 168], S: [72, 22, 116], a: [52, 16, 84], A: [100, 36, 152],
        l: [59, 7, 100], L: [40, 4, 70], b: [20, 4, 30], B: [12, 2, 20],
      }
    : {
        h: [15, 23, 42], H: [9, 14, 28], G: [255, 255, 255],
        v: mix([34, 211, 238], [207, 250, 254], pulse - 0.5),
        V: mix([165, 243, 252], [255, 255, 255], pulse - 0.5),
        k: [21, 94, 117], K: [14, 62, 82], R: [32, 132, 156],
        t: [34, 211, 238], n: [30, 41, 59],
        s: [14, 116, 144], S: [9, 76, 98], a: [10, 68, 92], A: [18, 108, 132],
        l: [12, 74, 110], L: [8, 50, 76], b: [2, 6, 23], B: [2, 4, 14],
      };
  return {
    upper: DEL_IDLE.slice(0, 15),
    profileUpper: DEL_PROFILE_UPPER,
    legs: DEL_LEGS,
    w: 13,
    col,
    arm: { near: 'A', far: 'a', nearHand: 's', farHand: 'S', sy: 7, crouchSy: 6, crouchUpper: DEL_CROUCH_UPPER, leanRows: 10 },
    glow: magenta ? [232, 121, 249] : [34, 211, 238],
  };
}

function delamain(b: Buf, d: Fig, t: number, snowCover = false, sun?: SunShadow, outfit?: PWorld['outfit']) {
  figure(b, d, t, delamainSpec(t), snowCover, sun, outfit);
}

function cat(b: Buf, c: NonNullable<PWorld['cat']>, t: number) {
  // a cat about 35 cm high sitting: five pixels, as it should be next to him
  const at = /bed/.test(c.doing || '') ? { x: 57, y: BED.top } : CAT_SPOT[c.where || 'inside'] || CAT_SPOT.inside;
  const fur: RGB = [41, 37, 36], light: RGB = [87, 83, 78], eye: RGB = [250, 204, 21];
  const asleep = /asleep|curled/.test(c.doing || '');
  const x = at.x, y = at.y;
  b.rect(x - 2, y, 5, 1, [16, 22, 36], 0.22);
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
        const cx = x * 2 + i, cy = y * 2 + j, p = (cy * W + cx), q = p * 4;
        const l = (d[q] * 0.3 + d[q + 1] * 0.59 + d[q + 2] * 0.11) / 255;
        const ddx = cx - src.x, ddy = cy - src.y;
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
    const k = Math.max(0, l - 0.92) / 0.08;
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
    let r = d[q] + bl[bq] * 0.5, g = d[q + 1] + bl[bq + 1] * 0.5, bb = d[q + 2] + bl[bq + 2] * 0.5;
    if (grade) { const a = night ? 0.1 : 0.08; r += (grade[0] - r) * a; g += (grade[1] - g) * a; bb += (grade[2] - bb) * a; }
    const vx = (x / W - 0.5) * 2, vy = (y / H - 0.5) * 2, v = 1 - 0.2 * Math.min(1, (vx * vx * 0.6 + vy * vy * 0.9));
    d[q] = r * v; d[q + 1] = g * v; d[q + 2] = bb * v;
  }
}

// ── the pond past the pine, with its jetty ─────────────────────────────────
const POND = { cx: 295, cy: 151, rx: 24, ry: 4 };
function pond(b: Buf, w: PWorld, d: Design, t: number) {
  const { cx, cy, rx, ry } = POND;
  const night = !w.isDay, ice = w.pond.ice, frozen = ice >= 0.6, warm = w.pond.waterT, sea = w.season || 'summer';
  const top = skyStops(w.hour);
  const skyC = mix(top[top.length - 1], top[1], 0.35);
  const snowBank = w.snow > 0 || (w.upkeep?.snow_ground ?? 0) > 0.25;
  for (let y = cy - ry - 3; y <= cy + ry + 3; y++) for (let x = cx - rx - 4; x <= cx + rx + 4; x++) {
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    const ang = Math.atan2(dy * 2.5, dx);
    const wob = 1 + 0.08 * Math.sin(ang * 5 + 1.2) + 0.05 * Math.cos(ang * 3 - 0.7);
    const d = (dx * dx + dy * dy) / (wob * wob);
    const bank = (((x - cx) / (rx + (dy > 0 ? 3.5 : 2.5))) ** 2 + ((y - cy) / (ry + (dy > 0 ? 2.2 : 1.5))) ** 2) / (wob * wob);
    if (d > 1) {
      if (bank <= 1) {
        if (dy < -0.15) {
          const turf: RGB = snowBank ? [196, 212, 230] : dith(x, y, 0.45) ? [82, 126, 54] : [60, 98, 42];
          b.set(x, y, night ? mix(turf, [14, 20, 34], 0.6) : turf);
        } else {
          const mud: RGB = dith(x, y, 0.4) ? [92, 74, 52] : (hash(x * 3 + y) > 0.7 ? [112, 98, 82] : [74, 58, 40]);
          b.set(x, y, night ? [36, 32, 34] : mud);
        }
      }
      continue;
    }
    let c: RGB;
    const rim = d > 1 - ice * 1.4;                                   // ice creeps in from the edges
    if (frozen || rim) {
      c = dith(x, y, 0.3) ? [205, 226, 240] : [228, 239, 247];
      if (frozen && (Math.abs((x - cx) * 0.35 - (y - cy) * 1.6 - 2) < 0.4 || Math.abs((x - cx + 9) * 0.5 + (y - cy) * 1.4) < 0.35)) c = [160, 190, 215];
      if (w.snow > 0 && hash(x * 3.1 + y) > 0.35) c = [224, 234, 244];
      if (night) c = mix(c, [40, 50, 80], 0.55);
    } else {
      const deep = 1 - d;
      const band = Math.sin(y * 2.2 + x * 0.12) > 0.25 ? 0.18 : 0;
      c = night
        ? mix([14, 22, 44], [28, 44, 78], 1 - deep + band * 0.5)
        : mix(mix(skyC, [26, 86, 104], 0.35 + deep * 0.4 - band), [18, 56, 68], dy > 0.15 ? 0.18 : 0);
      const ripple = (((x * 0.5 + y * 3.3 - RIPPLE) % 11) + 11) % 11;
      if (ripple < 1 + windyNow() * 2 && dith(x, y, 0.5)) c = mix(c, [255, 255, 255], (night ? 0.12 : 0.3) + windyNow() * 0.25);   // choppier in the wind
      if (night && Math.abs(x - MOON.x - 58) < 2 + (y - cy + ry) * 0.3 && (y + Math.floor(t * 2)) % 2 === 0) c = mix(c, [230, 230, 200], 0.55);
      if (!night && w.cloud < 70 && hash(x * 7 + Math.floor(t * 3) * 13 + y) > 0.985) c = [255, 252, 230];   // glints
    }
    b.set(x, y, c);
  }
  if (d.pond_lilies === 'yes' && !frozen && ice < 0.3 && sea !== 'winter') {
    const summer = sea === 'summer';
    for (const [lx, ly, fl] of [[302, 152, summer], [310, 150, summer], [287, 154, false], [295, 149, false]] as const) {
      b.set(lx - 1, ly, nightc([52, 120, 60], night, 0.5)); b.set(lx, ly, nightc([74, 150, 70], night, 0.5));
      b.set(lx + 1, ly, nightc([52, 120, 60], night, 0.5)); b.set(lx + 2, ly, nightc([40, 100, 50], night, 0.5));
      if (fl) { b.set(lx, ly - 1, nightc([249, 168, 212], night, 0.45)); b.set(lx + 1, ly - 1, nightc([253, 242, 248], night, 0.45)); }
    }
  }
  for (const [rx0, n] of [[268, 5], [314, 7]] as const) for (let k = 0; k < n; k++) {      // curved reeds and cattails
    const x = rx0 + k + (k > 2 ? 1 : 0), h = 6 + Math.floor(hash(x) * 6);
    const green = warm > 8 && !frozen;
    const baseC: RGB = green ? (k % 2 ? [74, 128, 56] : [48, 92, 42]) : [150, 128, 84];
    const sway = Math.sin(t * 1.3 + x) * (0.4 + windyNow() * 0.9);
    let tipX = x;
    for (let j = 0; j < h; j++) {
      const curve = Math.round(Math.sin(j * 0.35 + k) * 0.7 + (j / h) * sway);
      tipX = x + curve;
      b.set(tipX, cy + 1 - j, night ? mix(baseC, [10, 14, 24], 0.55) : baseC);
    }
    if (k % 3 === 1) {
      b.set(tipX, cy - h, nightc([134, 92, 48], night, 0.5));
      b.set(tipX, cy - h + 1, nightc([101, 67, 33], night, 0.5));
      b.set(tipX, cy - h + 2, nightc([101, 67, 33], night, 0.5));
    }
  }
  // a fish jumps now and then, at dawn and dusk (or rarely in warm sun) when the water is warm enough
  if (!frozen && warm > 12 && (((w.hour >= 5 && w.hour < 9) || (w.hour >= 17 && w.hour < 21)) || (w.isDay && warm > 16))) {
    const period = (w.hour >= 5 && w.hour < 9) || (w.hour >= 17 && w.hour < 21) ? 23 : 37;
    const ph = (t % period) / period, fx = 290 + hash(Math.floor(t / period)) * 18;
    if (ph < 0.05) {
      const f = ph / 0.05, jx = fx + f * 4, jy = cy - Math.sin(f * Math.PI) * 4;
      b.set(jx, jy - 1, [224, 242, 254]); b.set(jx - 1, jy, [160, 180, 190]);
    } else if (ph < 0.2) {
      const r = 1 + (ph - 0.05) * 30;
      for (let a = 0; a < 12; a++) b.set(fx + 4 + Math.cos(a / 12 * Math.PI * 2) * r, cy + Math.sin(a / 12 * Math.PI * 2) * r * 0.3, [255, 255, 255], 0.35 * (1 - (ph - 0.05) / 0.15));
    }
  }
  // the jetty: weathered planks on posts with sunlit rim & water-line shadow
  const wood: RGB = night ? [70, 60, 52] : [150, 128, 104], dark: RGB = night ? [40, 34, 30] : [96, 78, 60];
  const topRim: RGB = night ? [88, 78, 70] : [184, 160, 134];
  for (let x = 263; x <= 286; x++) { b.set(x, 147, x % 3 === 0 ? dark : topRim); b.set(x, 148, x % 4 === 0 ? dark : wood); b.set(x, 149, dark); }
  for (const px of [265, 275, 285]) for (let y = 150; y < 155; y++) b.set(px, y, y >= 152 ? mix(dark, [10, 20, 30], 0.35) : dark);
}

const PATCHWORK: RGB[] = [[184, 72, 58], [44, 128, 120], [208, 152, 42], [68, 86, 148], [218, 200, 168]];

// his bed, under the window: a low frame, a pillow, a blanket
function bedroom(b: Buf, night: boolean, blanket: [RGB, RGB] = [[20, 128, 120], [17, 94, 89]], patchwork = false) {
  const { x0, x1, top } = BED;
  const frame: RGB = night ? [62, 44, 32] : [110, 74, 46], dark: RGB = night ? [40, 28, 22] : [76, 50, 32];
  for (let y = top - 4; y < 150; y++) { b.set(x0, y, dark); b.set(x0 + 1, y, frame); }      // headboard
  b.rect(x0, top - 5, 2, 1, frame);
  for (let y = top + 3; y < 150; y++) { b.set(x1, y, dark); }                                // foot
  b.rect(x0 + 2, top + 3, x1 - x0 - 1, 2, frame);                                           // the frame
  b.set(x0 + 3, 149, dark); b.set(x1 - 1, 149, dark);
  b.rect(x0 + 2, top + 1, x1 - x0 - 2, 2, night ? [170, 170, 176] : [236, 232, 226]);         // sheet
  b.rect(x0 + 2, top - 1, 5, 2, night ? [190, 190, 196] : [250, 248, 244]);                   // pillow
  for (let x = x0 + 8; x < x1; x++) for (let y = top; y < top + 3; y++) {                     // blanket
    const pc = patchwork ? PATCHWORK[(Math.floor((x - x0 - 8) / 3) + (y - top) * 2) % PATCHWORK.length] : ((x + y) % 4 === 0 ? blanket[1] : blanket[0]);
    b.set(x, y, nightc(pc, night, 0.35));
  }
}

function sleeper(b: Buf, t: number, asleep: boolean, blanket: [RGB, RGB] = [[20, 128, 120], [17, 94, 89]], patchwork = false) {
  // lying on his back, head on the pillow, the blanket over him
  const { x0, x1, top } = BED, hx = x0 + 3, hy = top - 3;
  const pulse = asleep ? 0.35 + 0.2 * Math.sin(t * 0.9) : 0.8;
  b.rect(hx, hy, 4, 3, [15, 23, 42]);
  for (let i = 0; i < 4; i++) b.set(hx + i, hy, mix([34, 211, 238], [207, 250, 254], pulse - 0.3), asleep ? 0.6 : 1);   // his visor, dimmed
  b.glow(hx + 2, hy, 6, [34, 211, 238], 0.12 * pulse);
  for (let x = x0 + 8; x < x1; x++) {                                                        // him, under the blanket
    const pc = patchwork ? PATCHWORK[Math.floor((x - x0 - 8) / 3) % PATCHWORK.length] : ((x + Math.floor(t)) % 5 === 0 ? blanket[1] : blanket[0]);
    b.set(x, top - 1, pc);
  }
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
const PERSON_PROFILE_UPPER = [
  '...aaaaa...',
  '..AAAAAAA..',
  '...fffff...',
  '...ffefe...',
  '...fffff...',
  '....ff.....',
  '..KccccR...',
  '..Kccccc...',
  '...Kcccc...',
  '...Kcccc...',
  '...Kcccc...',
  '...ccccc...',
];
const PERSON_CROUCH_UPPER = [
  '....aaaaa..',
  '...AAAAAAA.',
  '....fffff..',
  '....ffefe..',
  '....fffff..',
  '..KcccccR..',
  '.KccccccR..',
  '.Kccccccc..',
  '..Kcccccc..',
  '...ccccc...',
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
  contact: [
    '...ppppp...',
    '...PP.pp...',
    '..PP...pp..',
    '..PP...pp..',
    '.PP.....pp.',
    'BB......pp.',
    '........bbb',
  ],
  down: [
    '...ppppp...',
    '...PP.pp...',
    '..PP..pp...',
    '..PP..pp...',
    '.PP...pp...',
    'BB....pp...',
    '......bbb..',
  ],
  pass: [
    '...ppppp...',
    '....pppp...',
    '....ppPP...',
    '....pp.PP..',
    '....pp.BB..',
    '....pp.....',
    '....bbb....',
  ],
  seat: [
    '...ppppp...',
    '...Ppppppp.',
    '......PPpp.',
    '......PPpp.',
    '......BBbbb',
  ],
  crouch: [
    '..PPpppp...',
    '.PP...pp...',
    '.PP....pp..',
    '.PP....pp..',
    '.BB...pp...',
    '.B....bbb..',
  ],
};
const short = (rows: string[]) => [rows[0], rows[1], rows[rows.length - 3], rows[rows.length - 2], rows[rows.length - 1]];
const shortWalk = (rows: string[]) => [rows[0], rows[2], rows[4], rows[5], rows[6]];
const shortSeat = (rows: string[]) => [rows[0], rows[1], rows[2], rows[4]];
const shortCrouch = (rows: string[]) => [rows[0], rows[1], rows[3], rows[4], rows[5]];

function guest(b: Buf, g: NonNullable<PWorld['guest']>, t: number, snowCover = false, sun?: SunShadow) {
  let seed = 0;
  for (const ch of g.name) seed = (seed * 31 + ch.charCodeAt(0)) % 997;
  if (g.kind === 'ai') { figure(b, g, t, delamainSpec(t, true), snowCover, sun); return; }     // another of his kind: his shape, another colour
  const k = KIND[g.kind] || KIND.gardener;
  const dark = (h: string) => mix(hex(h), [0, 0, 0], 0.35);
  const cHex = hex(k.c), fHex = hex(SKIN[seed % SKIN.length]);
  const col: Record<string, RGB> = {
    a: hex(k.a || SKIN[(seed + 3) % SKIN.length]), f: fHex, F: mix(fHex, [0, 0, 0], 0.25), e: [30, 27, 24],
    c: cHex, K: mix(cHex, [0, 0, 0], 0.3), R: mix(cHex, [255, 255, 255], 0.16),
    u: mix(cHex, [0, 0, 0], 0.3), U: mix(cHex, [255, 255, 255], 0.06),
    p: hex(k.p), P: dark(k.p), b: hex(k.b || '#1c1917'), B: dark(k.b || '#1c1917'),
  };
  if (k.A) col.A = hex(k.A);
  const upper = k.small ? [PERSON[0], ...PERSON.slice(2, 6), ...PERSON.slice(6, 12)] : PERSON.slice(0, 12);
  const profileUpper = k.small ? [PERSON_PROFILE_UPPER[0], ...PERSON_PROFILE_UPPER.slice(2)] : PERSON_PROFILE_UPPER;
  const crouchUpper = k.small ? [PERSON_CROUCH_UPPER[0], ...PERSON_CROUCH_UPPER.slice(2)] : PERSON_CROUCH_UPPER;
  const legs: Legs = k.small
    ? {
        stand: short(PERSON_LEGS.stand),
        contact: shortWalk(PERSON_LEGS.contact),
        down: shortWalk(PERSON_LEGS.down),
        pass: shortWalk(PERSON_LEGS.pass),
        seat: shortSeat(PERSON_LEGS.seat),
        crouch: shortCrouch(PERSON_LEGS.crouch),
      }
    : PERSON_LEGS;
  figure(b, g, t, {
    upper, profileUpper, legs, w: 11, col,
    arm: { near: 'U', far: 'u', nearHand: 'f', farHand: 'F', sy: k.small ? 6 : 7, crouchSy: k.small ? 5 : 6, crouchUpper, leanRows: k.small ? 7 : 8 },
    pack: k.pack ? hex(k.pack) : undefined, veil: g.kind === 'beekeeper',
  }, snowCover, sun);
}

// ── the look of the place (his to choose), and what neglect does to it ────
const WALLS: Record<string, [RGB, RGB]> = {
  timber: [[107, 79, 58], [86, 62, 45]], whitewash: [[222, 215, 200], [196, 188, 172]],
  sage: [[136, 156, 124], [112, 132, 102]], 'slate blue': [[90, 110, 136], [72, 90, 114]],
  ochre: [[190, 146, 70], [160, 120, 54]], brick: [[162, 72, 54], [124, 52, 38]],
  stone: [[136, 134, 128], [96, 94, 88]], log: [[124, 84, 50], [82, 52, 28]],
  'forest green': [[44, 82, 58], [30, 58, 40]], rose: [[196, 126, 132], [164, 98, 104]],
};
const ROOFS: Record<string, [RGB, RGB, RGB]> = {
  terracotta: [[127, 52, 40], [92, 38, 30], [160, 72, 54]],
  slate: [[71, 85, 105], [51, 62, 80], [100, 116, 139]],
  'moss green': [[74, 100, 58], [54, 76, 42], [104, 134, 78]],
  copper: [[170, 96, 52], [134, 70, 36], [208, 136, 86]],
  thatch: [[168, 138, 86], [126, 98, 56], [198, 168, 112]],
  'red tin': [[166, 52, 46], [122, 34, 30], [204, 78, 68]],
  'charcoal shingle': [[54, 58, 66], [36, 40, 46], [78, 84, 94]],
};
const TRIMS: Record<string, [RGB, RGB]> = {
  red: [[185, 28, 28], [127, 29, 29]], navy: [[37, 64, 143], [23, 37, 84]],
  mustard: [[202, 138, 4], [150, 98, 7]], teal: [[15, 118, 110], [17, 84, 79]],
  plum: [[126, 58, 170], [86, 36, 120]], white: [[232, 230, 224], [194, 190, 184]],
  black: [[42, 44, 50], [22, 24, 28]], 'sky blue': [[96, 165, 224], [58, 118, 176]],
};
const ROOMW: Record<string, [RGB, RGB]> = {
  plaster: [[214, 204, 186], [196, 184, 164]], sage: [[150, 170, 140], [130, 150, 120]],
  'wood panel': [[124, 86, 54], [100, 68, 42]], 'deep blue': [[44, 62, 104], [34, 48, 84]],
  terracotta: [[176, 96, 66], [150, 78, 52]], wallpaper: [[206, 198, 178], [184, 172, 150]],
  'forest green': [[44, 78, 56], [32, 58, 42]], cream: [[234, 224, 204], [212, 200, 178]],
};
const RUGS: Record<string, [RGB, RGB, RGB]> = {
  rust: [[154, 52, 18], [180, 83, 9], [120, 53, 15]], indigo: [[55, 48, 163], [90, 82, 220], [40, 36, 120]],
  moss: [[77, 124, 15], [110, 160, 40], [54, 83, 20]], cream: [[224, 214, 190], [246, 236, 214], [196, 184, 158]],
  crimson: [[158, 28, 38], [202, 52, 62], [108, 18, 26]], ochre: [[186, 134, 34], [220, 168, 58], [134, 92, 22]],
  charcoal: [[58, 62, 70], [88, 94, 104], [38, 40, 46]], striped: [[168, 68, 48], [224, 210, 180], [44, 108, 112]],
};
const BLANKETS: Record<string, [RGB, RGB]> = {
  teal: [[20, 128, 120], [17, 94, 89]], mustard: [[202, 138, 4], [161, 98, 7]],
  grey: [[128, 128, 136], [98, 98, 106]], rose: [[219, 112, 147], [180, 84, 118]],
  patchwork: [[184, 72, 58], [52, 124, 116]], navy: [[34, 58, 118], [22, 38, 82]],
  forest: [[34, 92, 54], [22, 64, 36]],
};
const FENCES: Record<string, RGB> = { weathered: [120, 113, 108], white: [236, 236, 232], sage: [134, 160, 120] };
const GH_FRAMES: Record<string, { edge: RGB; body: RGB; night: RGB }> = {
  white: { edge: [224, 232, 236], body: [192, 202, 206], night: [98, 114, 136] },
  green: { edge: [76, 132, 86], body: [46, 94, 58], night: [28, 52, 42] },
  black: { edge: [68, 74, 84], body: [36, 40, 48], night: [20, 24, 34] },
};
const mod = (n: number, m: number) => ((n % m) + m) % m;
function wallPixel(x: number, y: number, style: string, wc: RGB, wd: RGB, y0 = 112): RGB {
  if (style === 'brick') {
    const row = Math.floor(y / 3), bx = x + mod(row, 2) * 3;
    if (mod(y, 3) === 0 || mod(bx, 6) === 0) return mix(wc, [196, 188, 174], 0.55);
    const v = h2(Math.floor(bx / 6), row);
    return v > 0.68 ? wd : v < 0.22 ? mix(wc, [214, 120, 86], 0.25) : wc;
  }
  if (style === 'stone') {
    const row = Math.floor(y / 4), bx = x + row * 3;
    if (mod(y, 4) === 0 || mod(bx, 6) === 0) return mix(wd, [40, 38, 36], 0.45);
    const v = h2(Math.floor(bx / 6), row);
    return v > 0.72 ? mix(wc, [218, 214, 206], 0.28) : v < 0.3 ? wd : wc;
  }
  if (style === 'log') {
    const inLog = mod(y - y0, 4);
    if (inLog === 0) return mix(wd, [32, 20, 12], 0.45);
    if (inLog === 1) return mix(wc, [232, 198, 152], 0.22);
    return inLog === 3 ? wd : wc;
  }
  const dy = y - y0;
  return mod(dy, 6) === 0 || mod(x + Math.floor(dy / 6) * 13, 29) === 0 ? wd : wc;
}
function roofPixel(x: number, y: number, style: string, rr: RGB, rd: RGB, re: RGB): RGB {
  const fy = Math.floor(y);
  if (style === 'thatch') {
    if (mod(fy, 4) === 0 && h2(x, fy) > 0.25) return rd;
    return h2(x, Math.floor(fy / 2)) > 0.72 ? re : h2(x + 9, fy) < 0.28 ? rd : rr;
  }
  if (style === 'red tin') {
    const m = mod(x, 4);
    return m === 0 ? rd : m === 1 ? re : rr;
  }
  if (style === 'charcoal shingle') {
    const row = Math.floor(fy / 2), bx = x + mod(row, 2) * 2;
    if (mod(fy, 2) === 1 && mod(bx, 4) === 0) return rd;
    if (mod(fy, 2) === 0 && h2(Math.floor(bx / 4), row) > 0.68) return re;
    return mod(fy, 2) === 1 ? mix(rr, rd, 0.45) : rr;
  }
  return mod(fy + (mod(x, 4) < 2 ? 0 : 1), 3) === 0 ? rd : rr;
}
function drawFloor(b: Buf, x0: number, x1: number, floorY: number, style: string, night: boolean) {
  for (let y = floorY; y < WH; y++) for (let x = x0; x <= x1; x++) {
    let c: RGB;
    if (style === 'pine') {
      const seam = mod(x, 10) === 0 || y === floorY;
      c = seam ? [92, 66, 38] : h2(Math.floor(x / 10), Math.floor(y / 3)) > 0.65 ? [162, 120, 74] : [144, 104, 62];
    } else if (style === 'dark walnut') {
      const seam = mod(x, 10) === 0 || y === floorY;
      c = seam ? [34, 22, 16] : h2(Math.floor(x / 10), Math.floor(y / 3)) > 0.65 ? [78, 52, 36] : [62, 40, 28];
    } else if (style === 'stone') {
      const row = y >= floorY + 5 ? 1 : 0, bx = x + row * 4;
      const mortar = y === floorY || y === floorY + 5 || mod(bx, 8) === 0;
      c = mortar ? [58, 60, 64] : h2(Math.floor(bx / 8), row) > 0.5 ? [108, 110, 114] : [88, 90, 96];
    } else if (style === 'checkered') {
      if (y === floorY) c = [64, 58, 52];
      else {
        const cell = (Math.floor((x + 48) / 4) + Math.floor((y - floorY) / 2)) & 1;
        c = cell ? [210, 202, 186] : [48, 50, 56];
      }
    } else {
      c = mod(x, 10) === 0 || y === floorY ? [52, 36, 27] : [92, 64, 45];
    }
    b.set(x, y, nightc(c, night, 0.42));
  }
}
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
  U: '101101101101111', V: '101101101101010', W: '101101101111101', X: '101101010101101', Y: '101101010010010',
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

// the house is tall enough for an attic: the roof rises to a 5 m ridge
const roofTop = (x: number) => 80 + Math.abs(x - 39) * 0.75;
export const LADDER_X = 33, LOFT_Y = 112, OFFICE_SEAT = { x: 38, y: 107 };
export const ARMCHAIR = { x: 67, y: 146 };
// the front door, in the wall on the garden side: he goes in and out by it (it swings open as someone passes)
export const DOOR = { x: 79, top: 131, bottom: 157 }, DOOR_IN = { x: 74, y: 157 }, DOOR_OUT = { x: 86, y: 158 };
function frontDoor(b: Buf, d: Design, night: boolean, open: number) {
  const [dc, dd] = d.door_colour === 'match the trim' ? (TRIMS[d.trim] || TRIMS.red)
    : d.door_colour === 'natural wood' ? ([[146, 98, 56], [102, 66, 36]] as [RGB, RGB])
    : (TRIMS[d.door_colour] || TRIMS[d.trim] || TRIMS.red);
  const dl = mix(dc, [255, 255, 255], 0.22);
  const frame: RGB = nightc([74, 50, 34], night, 0.5);
  const glassC: RGB = night ? [253, 220, 130] : [168, 214, 240];
  const style = d.door || 'plank';
  if (style === 'arched') {
    b.rect(DOOR.x - 1, DOOR.top - 2, 3, 1, frame);
    b.rect(DOOR.x - 2, DOOR.top - 1, 5, 1, frame);
  } else {
    b.rect(DOOR.x - 2, DOOR.top - 1, 5, 1, frame);                                 // the lintel
  }
  for (let y = DOOR.top; y <= DOOR.bottom; y++) { b.set(DOOR.x - 2, y, frame); b.set(DOOR.x + 2, y, frame); }
  const h = DOOR.bottom - DOOR.top;
  if (open < 0.5) {                                                                // shut: the door in the wall
    for (let y = DOOR.top; y <= DOOR.bottom; y++) for (let x = DOOR.x - 1; x <= DOOR.x + 1; x++) {
      const dy = y - DOOR.top;
      let c = x === DOOR.x + 1 ? dd : dc;
      if (style === 'arched' && y === DOOR.top && x !== DOOR.x) { b.set(x, y, frame); continue; }
      if (style === 'arched' && x === DOOR.x && (dy === 2 || dy === 3)) c = dl;
      else if (style === 'panelled') {
        if (x === DOOR.x && ((dy >= 2 && dy <= 10) || (dy >= 14 && dy <= 23))) c = (dy === 10 || dy === 23) ? dl : dd;
      } else if (style === 'glass') {
        if (x === DOOR.x && dy >= 2 && dy <= 11) { b.set(x, y, dy === 6 ? dc : glassC); continue; }
        if (x === DOOR.x && dy >= 14 && dy <= 23) c = dy === 23 ? dl : dd;
      } else if (style === 'barn') {
        const zx = DOOR.x - 1 + Math.round((Math.max(0, Math.min(19, dy - 3)) / 19) * 2);
        if (dy === 1 || dy === 2 || dy === h - 2 || dy === h - 1 || (dy >= 3 && dy <= h - 3 && x === zx)) c = dd;
      } else {
        if (dy % 9 === 0 || (x === DOOR.x && dy % 2 === 0)) c = dd;
      }
      b.set(x, y, nightc(c, night, 0.45));
    }
    b.set(DOOR.x - 1, Math.round((DOOR.top + DOOR.bottom) / 2) + 1, [214, 180, 90]);   // the knob
  } else {                                                                         // open: the doorway, and the door swung out
    for (let y = DOOR.top; y <= DOOR.bottom; y++) for (let x = DOOR.x - 1; x <= DOOR.x + 1; x++)
      b.set(x, y, style === 'arched' && y === DOOR.top && x !== DOOR.x ? frame : nightc([60, 42, 30], night, 0.4));
    for (let y = DOOR.top; y <= DOOR.bottom; y++) for (let i = 0; i < 5; i++) {
      const dy = y - DOOR.top, px = DOOR.x + 3 + i, py = y + Math.round(i * 0.4);
      if (style === 'arched' && dy === 0 && (i === 0 || i === 4)) continue;
      let c = i === 4 ? dd : dc;
      if (style === 'arched' && dy >= 1 && dy <= 3 && i >= 1 && i <= 3) c = dy === 1 ? dl : dd;
      else if (style === 'panelled') {
        if (i >= 1 && i <= 3 && ((dy >= 2 && dy <= 10) || (dy >= 14 && dy <= 23))) c = (dy === 10 || dy === 23 || i === 3) ? dl : dd;
      } else if (style === 'glass') {
        if (i >= 1 && i <= 3 && dy >= 2 && dy <= 11) {
          if (i === 2 || dy === 6) b.set(px, py, nightc(dc, night, 0.45));
          else b.set(px, py, glassC, 0.85);
          continue;
        }
        if (i >= 1 && i <= 3 && dy >= 14 && dy <= 23) c = (dy === 23 || i === 3) ? dl : dd;
      } else if (style === 'barn') {
        const zCol = Math.round((1 - Math.max(0, Math.min(19, dy - 3)) / 19) * 4);
        if (dy === 1 || dy === 2 || dy === h - 2 || dy === h - 1 || dy === 12 || (dy >= 3 && dy <= h - 3 && i === zCol)) c = i === zCol ? dl : dd;
      } else {
        if (i === 2 || dy % 9 === 0) c = dd;
      }
      b.set(px, py, nightc(c, night, 0.45));
    }
  }
  b.rect(DOOR.x - 3, DOOR.bottom + 1, 7, 1, nightc([150, 140, 128], night, 0.5));     // the step
}

// the attic office: his terminal and his work, up the ladder
function attic(b: Buf, w: PWorld, d: Design, night: boolean, t: number) {
  const wood: RGB = nightc([139, 90, 43], night), dk: RGB = nightc([96, 60, 28], night);
  b.rect(42, 105, 16, 2, wood); b.rect(43, 107, 1, 5, dk); b.rect(55, 107, 1, 5, dk);        // the desk
  b.rect(34, 106, 6, 1, wood); b.rect(34, 99, 1, 13, dk); b.rect(39, 107, 1, 5, dk);          // the chair: its back behind him, facing the desk
  const screen = w.office?.screen || null;
  for (const [x0, k] of [[44, 0], [49, 1]] as const) {                                         // two screens
    b.rect(x0, 98, 5, 5, [30, 32, 38]); b.set(x0 + 2, 103, [30, 32, 38]); b.rect(x0 + 1, 104, 3, 1, [30, 32, 38]);
    const on = !!screen;
    for (let y = 99; y < 102; y++) for (let x = x0 + 1; x < x0 + 4; x++) {
      let c: RGB = on ? [20, 40, 50] : [14, 16, 20];
      if (on && screen === 'charts') { const col = (x - x0 + k * 3 + Math.floor(t)) % 4; c = (y - 99) === col % 3 ? (col % 2 ? [74, 222, 128] : [248, 113, 113]) : [16, 22, 30]; }
      if (on && screen === 'text') c = (y + Math.floor(t * 2)) % 2 === 0 && hash(x + y + Math.floor(t * 2)) > 0.3 ? [226, 232, 240] : [24, 34, 48];
      if (on && screen === 'code') c = hash(x * 3 + y + Math.floor(t * 3)) > 0.45 ? [74, 222, 128] : [10, 24, 16];
      if (on && screen === 'voice') c = Math.abs(y - 100) <= Math.round(Math.abs(Math.sin(t * 6 + x)) * 1.4) ? [34, 211, 238] : [8, 24, 32];
      b.set(x, y, c);
    }
    if (on) b.glow(x0 + 2, 100, 7, screen === 'voice' ? [34, 211, 238] : screen === 'code' ? [74, 222, 128] : [180, 200, 255], night ? 0.25 : 0.1);
  }
  b.rect(52, 104, 2, 1, [241, 237, 226]);                                                       // a mug
  if (d.desk_plant === 'cactus') {
    b.rect(55, 103, 3, 2, nightc([184, 86, 48], night, 0.45));
    b.rect(56, 99, 1, 4, nightc([64, 152, 74], night, 0.45));
    b.set(55, 100, nightc([46, 122, 56], night, 0.45)); b.set(55, 101, nightc([64, 152, 74], night, 0.45));
    b.set(57, 101, nightc([86, 182, 92], night, 0.45));
    if (w.season === 'spring' || w.season === 'summer') b.set(56, 98, nightc([244, 114, 182], night, 0.4));
  } else if (d.desk_plant === 'bonsai') {
    b.rect(54, 103, 4, 2, nightc([88, 106, 124], night, 0.45));
    b.set(56, 102, nightc([110, 74, 46], night, 0.45)); b.set(55, 101, nightc([96, 62, 36], night, 0.45));
    b.rect(54, 99, 3, 2, nightc([48, 124, 56], night, 0.45)); b.set(54, 99, nightc([86, 168, 84], night, 0.45));
    b.rect(56, 100, 3, 2, nightc([56, 138, 64], night, 0.45)); b.set(57, 100, nightc([92, 178, 88], night, 0.45));
  }
  if (d.attic_lights === 'fairy lights') {
    for (let x = 8; x <= 70; x++) {
      const ly = Math.round(roofTop(x) + 3 + Math.sin((mod(x - 8, 12) / 12) * Math.PI) * 1.4);
      b.set(x, ly, [68, 62, 56], 0.45);
      if (mod(x - 8, 4) === 0 && !night) b.set(x, ly + 1, [253, 230, 158], 0.5);
    }
  }
}

function ladder(b: Buf, night: boolean) {
  const c: RGB = nightc([150, 110, 70], night, 0.5);
  for (let y = 112; y < 150; y++) { b.set(LADDER_X - 2, y, c); b.set(LADDER_X + 1, y, c); if (y % 4 === 0) { b.set(LADDER_X - 1, y, c); b.set(LADDER_X, y, c); } }
}

function armchair(b: Buf, w: PWorld, night: boolean, reading: boolean) {
  const c: RGB = nightc([128, 66, 44], night, 0.4), dk: RGB = nightc([92, 44, 30], night, 0.4);
  b.rect(63, 145, 9, 2, c); b.rect(70, 136, 3, 11, dk); b.rect(63, 142, 2, 3, dk); b.rect(63, 147, 9, 1, dk);
  b.set(64, 148, dk); b.set(64, 149, dk); b.set(71, 148, dk); b.set(71, 149, dk);
  b.rect(74, 143, 4, 1, nightc([110, 74, 46], night)); b.rect(75, 144, 1, 6, nightc([84, 56, 34], night));      // a side table
  const lampOn = reading && (!w.isDay || w.hour > 16.5 || w.cloud > 80);
  b.set(76, 142, [68, 64, 60]); b.set(76, 141, [68, 64, 60]); b.rect(75, 139, 3, 2, lampOn ? [253, 230, 138] : [150, 130, 100]);
  if (lampOn) b.glow(76, 141, 14, [253, 224, 138], night ? 0.3 : 0.15);
  b.rect(74, 142, 1, 1, [241, 237, 226]);
}

// his study: the room built on to the left of the house, with his desk, his pinboard and his books
function study(b: Buf, w: PWorld, d: Design, u: Upkeep, night: boolean, _t: number) {
  const sx0 = -44, sx1 = -1, ceil = 121, floor = 150;
  const [wc, wd] = ROOMW[d.room_wall] || ROOMW.plaster;
  for (let y = ceil; y < floor; y++) for (let x = sx0; x <= sx1; x++) {
    let col = wc;
    if (d.room_wall === 'wood panel' && (y - ceil) % 7 === 0) col = wd;
    else if (d.room_wall === 'wallpaper') {
      const mx = mod(x, 4), my = mod(y - ceil, 6);
      if (mx === 0) col = wd;
      else if (mx === 2 && my === 3) col = mix(wc, [242, 236, 220], 0.4);
      else if (mx === 2 && (my === 2 || my === 4)) col = mix(wc, wd, 0.5);
    } else if (mod(x + y, 23) === 0) col = wd;
    b.set(x, y, nightc(col, night, 0.55));
  }
  b.rect(sx0, ceil, sx1 - sx0 + 1, 1, nightc([74, 50, 34], night));                         // the ceiling
  drawFloor(b, sx0, sx1, floor, d.floor, night);
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
    b.set(x, y, nightc(bare ? [150, 120, 90] : x === x1 ? cd : wallPixel(x, y, d.house_wall, c, cd, y0), night, 0.5));
  }
}

function leanTo(b: Buf, d: Design, snowing: boolean) {
  const [r, rd, re] = ROOFS[d.roof] || ROOFS.terracotta;
  for (let x = -50; x <= 0; x++) {
    const top = 113 + -x * 0.13;
    for (let y = Math.floor(top); y < 121; y++) b.set(x, y, roofPixel(x, y, d.roof, r, rd, re));
    b.set(x, Math.floor(top), re);
    if (snowing) { b.set(x, Math.floor(top) - 1, [240, 244, 250]); b.set(x, Math.floor(top), [218, 228, 240]); }
  }
}

function weathervane(b: Buf, d: Design, night: boolean, t: number) {
  if (!d.weathervane || d.weathervane === 'none') return;
  const cx = 39, baseY = 80;
  const iron: RGB = nightc([62, 66, 76], night, 0.45), brass: RGB = nightc([214, 174, 78], night, 0.4);
  const dir = Math.abs(WIND) > 0.5 ? (WIND > 0 ? 1 : -1) : (Math.sin(t * 0.5) >= 0 ? 1 : -1);
  b.rect(cx, baseY - 10, 1, 10, iron);
  b.rect(cx - 2, baseY - 5, 5, 1, iron);
  const sy = baseY - 11;
  if (d.weathervane === 'arrow') {
    for (let i = -4; i <= 4; i++) b.set(cx + dir * i, sy, brass);
    b.set(cx + dir * 3, sy - 1, brass); b.set(cx + dir * 3, sy + 1, brass);
    b.set(cx - dir * 4, sy - 1, iron); b.set(cx - dir * 4, sy + 1, iron);
  } else if (d.weathervane === 'fish') {
    b.rect(cx - 1, sy - 1, 3, 2, brass);
    b.set(cx + dir * 2, sy, brass); b.set(cx + dir * 3, sy, brass);
    b.set(cx, sy - 2, brass);
    b.set(cx - dir * 2, sy, brass); b.set(cx - dir * 3, sy - 1, brass); b.set(cx - dir * 3, sy + 1, brass);
  } else if (d.weathervane === 'rooster') {
    b.rect(cx - 1, sy - 1, 3, 2, brass);
    b.set(cx + dir * 1, sy - 2, brass); b.set(cx + dir * 2, sy - 3, brass); b.set(cx + dir * 3, sy - 2, brass);
    b.set(cx + dir * 2, sy - 4, nightc([196, 54, 48], night, 0.4));
    b.set(cx - dir * 2, sy - 2, brass); b.set(cx - dir * 3, sy - 3, brass); b.set(cx - dir * 3, sy - 1, brass);
  }
}

function chimney(b: Buf, d: Design, night: boolean) {
  for (let y = 85; y < 98; y++) for (let x = 58; x < 64; x++) {
    let c: RGB;
    if (d.chimney === 'brick') {
      const row = Math.floor(y / 2), bx = x + (row % 2) * 2;
      c = y % 2 === 0 || bx % 4 === 0 ? [188, 180, 168] : (h2(Math.floor(bx / 4), row) > 0.55 ? [144, 58, 42] : [166, 74, 54]);
    } else {
      const row = Math.floor(y / 3), bx = x + row * 2;
      c = y % 3 === 0 || bx % 4 === 0 ? [68, 64, 60] : (h2(Math.floor(bx / 4), row) > 0.5 ? [116, 112, 106] : [92, 88, 84]);
    }
    b.set(x, y, nightc(c, night, 0.45));
  }
  b.rect(57, 83, 8, 2, nightc(d.chimney === 'brick' ? [78, 64, 60] : [68, 64, 60], night, 0.45));
  b.rect(57, 83, 8, 1, nightc([108, 102, 98], night, 0.45));
}

function shutters(b: Buf, d: Design, night: boolean) {
  if (d.shutters !== 'yes') return;
  const [tc, td] = TRIMS[d.trim] || TRIMS.red;
  const hi = mix(tc, [255, 255, 255], 0.14);
  for (const [x0, x1] of [[28, 31], [68, 71]] as [number, number][]) {
    for (let y = 117; y <= 135; y++) for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1 || y === 117 || y === 135;
      const louver = !edge && (y - 117) % 2 === 0;
      b.set(x, y, nightc(edge ? td : louver ? hi : tc, night, 0.42));
    }
  }
}

function drawCurtains(b: Buf, d: Design, night: boolean) {
  const cur = d.curtains || 'match the trim';
  const [cc, cd] = cur === 'match the trim' ? (TRIMS[d.trim] || TRIMS.red) : (TRIMS[cur] || [[220, 220, 214], [180, 180, 174]]);
  const hasShut = d.shutters === 'yes';
  const spans: [number, number][] = hasShut ? [[32, 34], [66, 68]] : [[29, 32], [68, 71]];
  for (const [x0, x1] of spans) for (let y = 115; y < 140; y++) for (let x = x0; x <= x1; x++) {
    if (cur === 'white lace') {
      const mesh = (x + y) % 2 === 0;
      b.set(x, y, nightc(mesh ? [246, 244, 238] : [214, 212, 206], night, 0.35), mesh ? 0.92 : 0.65);
    } else if (cur === 'green check') {
      const g = ((x & 1) ^ (y & 1)) === 0;
      const c: RGB = g ? (y % 2 === 0 ? [58, 128, 72] : [96, 168, 108]) : [234, 238, 228];
      b.set(x, y, nightc(c, night, 0.4));
    } else {
      b.set(x, y, nightc((x + y) % 4 === 0 ? cd : cc, night, 0.4));
    }
  }
}

function windowBox(b: Buf, d: Design, sea: string, snowCover: boolean, night: boolean) {
  if (!d.window_box || d.window_box === 'none') return;
  const wood: RGB = nightc([124, 82, 48], night, 0.45), dk: RGB = nightc([82, 52, 28], night, 0.45), rim: RGB = nightc([158, 110, 68], night, 0.45);
  b.rect(34, 136, 33, 1, nightc([74, 52, 34], night, 0.45));                              // soil line
  b.rect(34, 137, 33, 1, rim); b.rect(34, 138, 33, 2, wood); b.rect(34, 140, 33, 1, dk);   // planter box on the sill line
  for (const bx of [38, 49, 61]) b.rect(bx, 137, 1, 3, dk);                                // slats
  const winter = sea === 'winter';
  const leafL: RGB = nightc(winter ? [72, 106, 70] : [96, 180, 82], night, 0.45);
  const leafD: RGB = nightc(winter ? [44, 72, 46] : [48, 126, 52], night, 0.45);
  const blooms: RGB[] = d.window_box === 'herbs'
    ? (sea === 'summer' ? [[216, 180, 254], [244, 244, 240]] : [])
    : winter ? [[196, 54, 62]] : sea === 'autumn' ? [[234, 118, 24], [250, 204, 21], [190, 48, 62]]
      : [[244, 63, 94], [250, 204, 21], [244, 114, 182], [248, 250, 252]];
  for (let x = 35; x <= 65; x++) {
    const k = hash(x * 3.7 + 19);
    const h = winter ? (k > 0.55 ? 2 : 1) : (d.window_box === 'herbs' ? 3 + Math.floor(k * 3) : 2 + Math.floor(k * 3));
    for (let j = 1; j <= h; j++) b.set(x, 136 - j, (j === h && k > 0.4) ? leafL : leafD);
    if (k > 0.62 && (x % 3 !== 0)) { b.set(x, 137, leafD); if (k > 0.8) b.set(x, 138, leafL); }
    if (blooms.length && k > 0.66) {
      const bc = nightc(blooms[x % blooms.length], night, 0.4);
      b.set(x, 136 - h, bc);
      if (d.window_box === 'flowers' && k > 0.82) b.set(x, 137, bc);
    }
    if (snowCover && k > 0.4) b.set(x, 135, nightc([222, 232, 244], night, 0.4));
  }
}

function houseplant(b: Buf, d: Design, night: boolean) {
  if (!d.houseplant || d.houseplant === 'none') return;
  const cx = 37, yBase = 149;
  const potC: RGB = nightc([186, 112, 74], night, 0.4), potD: RGB = nightc([132, 72, 44], night, 0.4);
  b.rect(cx - 2, yBase - 3, 5, 1, nightc([214, 140, 96], night, 0.4));
  b.rect(cx - 1, yBase - 2, 3, 3, potC); b.set(cx + 1, yBase - 1, potD); b.set(cx + 1, yBase, potD);
  const gL: RGB = nightc([84, 176, 94], night, 0.42), gM: RGB = nightc([44, 132, 64], night, 0.42), gD: RGB = nightc([24, 88, 44], night, 0.42);
  if (d.houseplant === 'fern') {
    for (const [dx, dy, c] of [[-3, -5, gL], [-2, -5, gM], [-1, -4, gD], [0, -4, gM], [1, -4, gD], [2, -5, gM], [3, -5, gL], [-2, -7, gL], [-1, -6, gM], [0, -7, gL], [0, -6, gD], [1, -6, gM], [2, -7, gL]] as const)
      b.set(cx + dx, yBase + dy, c);
  } else if (d.houseplant === 'monstera') {
    for (const [sx, sy] of [[0, -4], [-1, -6], [1, -5], [0, -8]] as const) b.set(cx + sx, yBase + sy, gD);
    b.rect(cx - 3, yBase - 8, 3, 2, gM); b.set(cx - 2, yBase - 8, gL); b.set(cx - 3, yBase - 7, gD);
    b.rect(cx + 1, yBase - 7, 3, 2, gM); b.set(cx + 2, yBase - 7, gL);
    b.rect(cx - 1, yBase - 11, 3, 2, gL); b.set(cx, yBase - 10, gM);
  } else if (d.houseplant === 'fiddle leaf') {
    const stem: RGB = nightc([104, 72, 46], night, 0.42);
    for (let j = 4; j <= 10; j++) b.set(cx, yBase - j, stem);
    b.rect(cx - 2, yBase - 8, 2, 3, gM); b.set(cx - 2, yBase - 8, gL);
    b.rect(cx + 1, yBase - 10, 2, 3, gM); b.set(cx + 1, yBase - 10, gL);
    b.rect(cx - 1, yBase - 13, 3, 3, gL); b.set(cx + 1, yBase - 11, gD);
  }
}

function wallPiece(b: Buf, d: Design, w: PWorld, night: boolean, t: number) {
  const wp = d.wall_piece;
  if (!wp || wp === 'none') return;
  if (wp === 'clock') {
    const wood: RGB = nightc([96, 62, 36], night, 0.42), dk: RGB = nightc([64, 40, 24], night, 0.42);
    b.rect(73, 120, 3, 1, wood); b.rect(72, 121, 5, 12, wood); b.rect(72, 121, 1, 12, dk);
    b.rect(73, 122, 3, 3, nightc([242, 236, 220], night, 0.3));
    const ha = ((w.hour % 12) / 12) * Math.PI * 2 - Math.PI / 2;
    const ma = (w.hour % 1) * Math.PI * 2 - Math.PI / 2;
    b.set(74 + Math.round(Math.cos(ma)), 123 + Math.round(Math.sin(ma)), [80, 84, 96]);
    b.set(74 + Math.round(Math.cos(ha)), 123 + Math.round(Math.sin(ha)), [30, 32, 38]);
    b.set(74, 123, [20, 22, 28]);
    b.rect(73, 127, 3, 5, dk);
    b.set(Math.sin(t * Math.PI) >= 0 ? 74 : 75, 130, nightc([214, 178, 86], night, 0.35));
  } else if (wp === 'map') {
    b.rect(72, 121, 6, 9, nightc([102, 68, 40], night, 0.42));
    b.rect(73, 122, 4, 7, nightc([224, 210, 176], night, 0.4));
    b.set(73, 123, nightc([122, 162, 194], night, 0.4)); b.set(76, 127, nightc([122, 162, 194], night, 0.4));
    b.rect(74, 123, 2, 2, nightc([132, 158, 106], night, 0.4));
    b.rect(73, 126, 2, 2, nightc([180, 144, 90], night, 0.4));
    b.set(75, 125, nightc([202, 54, 48], night, 0.4));
  } else if (wp === 'mirror') {
    const gilt: RGB = nightc([188, 148, 68], night, 0.4), giltD: RGB = nightc([134, 100, 42], night, 0.4);
    const gl: RGB = nightc([164, 196, 216], night, 0.45), glD: RGB = nightc([124, 160, 184], night, 0.45);
    b.rect(73, 121, 4, 12, gilt); b.rect(72, 122, 6, 10, gilt);
    b.rect(76, 122, 1, 10, giltD);
    b.rect(73, 122, 4, 10, gl); b.rect(75, 127, 2, 4, glD);
    const glint: RGB = night ? [210, 226, 244] : [248, 252, 255];
    b.set(74, 123, glint); b.set(73, 124, glint);
    if ((t % 4.5) < 0.35) { b.set(75, 123, [255, 255, 255]); b.set(74, 125, glint); }
  } else if (wp === 'plate rack') {
    const wood: RGB = nightc([110, 74, 46], night, 0.42), dk: RGB = nightc([78, 50, 30], night, 0.42);
    b.rect(72, 121, 1, 12, dk); b.rect(77, 121, 1, 12, dk);
    b.rect(72, 126, 6, 1, wood); b.rect(72, 132, 6, 1, wood);
    const white: RGB = nightc([236, 240, 244], night, 0.38), blue: RGB = nightc([52, 98, 172], night, 0.38), terra: RGB = nightc([196, 96, 68], night, 0.4);
    b.rect(73, 122, 2, 4, white); b.set(73, 123, blue);
    b.rect(75, 123, 2, 3, terra); b.set(76, 124, white);
    b.rect(73, 128, 2, 4, terra); b.set(74, 129, white);
    b.rect(75, 128, 2, 4, white); b.set(76, 130, blue);
  }
}

function porchProps(b: Buf, d: Design, sea: string, night: boolean, t: number, afterDoor: boolean) {
  if (!afterDoor) {
    if (d.door_pots === 'yes') {
      const fl: RGB = sea === 'winter' ? [196, 54, 62] : sea === 'autumn' ? [234, 118, 24] : [244, 63, 94];
      for (const [px, py, h] of [[82, 157, 3], [85, 156, 4]] as const) {
        b.rect(px - 1, py - 2, 3, 1, nightc([206, 108, 66], night, 0.45));
        b.rect(px - 1, py - 1, 3, 2, nightc([164, 72, 40], night, 0.45));
        b.rect(px - 1, py - 2 - h, 3, h, nightc([46, 124, 56], night, 0.45));
        b.set(px, py - 2 - h, nightc([84, 172, 92], night, 0.45));
        if (sea !== 'winter' || px === 85) b.set(px + (px === 82 ? -1 : 1), py - 1 - h, nightc(fl, night, 0.4));
      }
    }
    return;
  }
  if (d.doormat === 'yes') {
    b.rect(79, 158, 5, 2, nightc([142, 98, 48], night, 0.45));
    b.rect(80, 158, 3, 1, nightc([186, 140, 80], night, 0.45));
  }
  if (d.porch_light === 'lantern') {
    const iron: RGB = nightc([46, 50, 58], night, 0.45);
    b.set(82, 124, iron); b.rect(82, 125, 3, 1, iron); b.set(82, 126, iron); b.set(84, 126, iron); b.set(82, 127, iron); b.set(84, 127, iron); b.set(83, 128, iron);
    b.rect(83, 126, 1, 2, night ? [253, 224, 138] : [186, 214, 226]);
  }
  if (d.wind_chime === 'yes') {
    const sw = Math.round(Math.sin(t * 3.5) * (0.3 + windyNow() * 1.5) + Math.max(-2, Math.min(2, WIND / 22)));
    b.set(84, 114, nightc([110, 74, 46], night, 0.45));
    b.rect(83, 115, 3, 1, nightc([138, 96, 58], night, 0.45));
    for (let k = 0; k < 3; k++) {
      const len = k === 1 ? 5 : 4, cx = 83 + k + sw;
      for (let j = 0; j < len; j++) b.set(cx, 116 + j, nightc(k === 1 ? [234, 198, 110] : [206, 212, 220], night, 0.42));
    }
  }
}

function gardenArch(b: Buf, d: Design, sea: string, prog: number, snowCover: boolean, night: boolean) {
  if (!d.arch || d.arch === 'none') return;
  const wood: RGB = nightc([118, 82, 52], night, 0.5), dk: RGB = nightc([78, 52, 32], night, 0.5);
  for (let y = 136; y <= 156; y++) { b.set(169, y, wood); b.set(178, y, dk); }
  for (let x = 169; x <= 178; x++) {
    const dx = x - 173.5;
    const ay = 131 + Math.round(dx * dx * 0.25);
    b.set(x, ay, wood); b.set(x, ay + 1, dk);
  }
  const winter = sea === 'winter';
  const leafC: RGB = nightc(winter ? [88, 66, 48] : sea === 'autumn' ? [156, 120, 50] : [54, 132, 54], night, 0.48);
  const leafL: RGB = nightc(winter ? [110, 86, 66] : sea === 'autumn' ? [184, 96, 42] : [92, 174, 72], night, 0.48);
  const flC: RGB = d.arch === 'clematis' ? [147, 51, 234] : [220, 38, 68];
  const flL: RGB = d.arch === 'clematis' ? [216, 180, 254] : [253, 164, 175];
  const bloom = !winter && (sea === 'summer' || (sea === 'spring' && prog > 0.45) || (sea === 'autumn' && prog < 0.4));
  for (let y = 137; y <= 154; y += 2) {
    for (const px of [169, 178]) {
      const side = px === 169 ? 1 : -1;
      b.set(px + side, y, leafC);
      if (!winter) b.set(px, y - 1, leafL);
      if (bloom && (y + px) % 4 === 1) b.set(px + side, y - 1, nightc(y % 3 === 0 ? flL : flC, night, 0.42));
    }
  }
  for (let x = 169; x <= 178; x++) {
    const dx = x - 173.5;
    const ay = 131 + Math.round(dx * dx * 0.25);
    b.set(x, ay - 1, x % 2 ? leafL : leafC);
    if (snowCover) b.set(x, ay - 2, nightc([222, 232, 244], night, 0.45));
    else if (bloom && x % 2 === 0) b.set(x, ay - 2, nightc(x % 4 === 0 ? flL : flC, night, 0.42));
  }
}

const PATH_LAMP_XS = [176, 204, 226, 245] as const;
function pathLights(b: Buf, night: boolean, glowOnly: boolean) {
  for (const lx of PATH_LAMP_XS) {
    if (!glowOnly) {
      b.rect(lx, 156, 1, 2, nightc([52, 56, 64], night, 0.45));
      b.rect(lx - 1, 155, 3, 1, nightc([74, 78, 88], night, 0.45));
    }
    if (!glowOnly || night) {
      b.set(lx, 156, night ? [254, 243, 168] : [186, 204, 214]);
      if (night && glowOnly) b.glow(lx, 156, 5, [253, 224, 138], 0.24);
    }
  }
}

function birdbath(b: Buf, w: PWorld, sea: string, frosty: boolean, snowCover: boolean, night: boolean, t: number, sun: SunShadow) {
  const cx = 304, yBase = 158;
  castSpan(b, cx - 2, cx + 2, yBase, 8, sun);
  const stL: RGB = nightc([184, 182, 176], night, 0.45), stM: RGB = nightc([144, 142, 138], night, 0.45), stD: RGB = nightc([102, 100, 96], night, 0.45);
  b.rect(cx - 2, yBase, 5, 1, stD); b.rect(cx - 1, yBase - 1, 3, 1, stM);
  b.rect(cx - 1, yBase - 5, 3, 4, stM); b.rect(cx + 1, yBase - 5, 1, 4, stD);
  b.rect(cx - 2, yBase - 6, 5, 1, stD); b.rect(cx - 3, yBase - 7, 7, 1, stM); b.set(cx - 3, yBase - 7, stL);
  const iced = frosty || w.pond.ice >= 0.4 || sea === 'winter';
  b.rect(cx - 2, yBase - 7, 5, 1, nightc(iced ? [212, 232, 246] : [86, 162, 206], night, 0.4));
  if (iced) b.set(cx, yBase - 7, nightc([176, 204, 228], night, 0.4));
  if (snowCover) { b.set(cx - 1, yBase - 8, nightc([224, 234, 244], night, 0.45)); b.set(cx + 1, yBase - 8, nightc([224, 234, 244], night, 0.45)); }
  if (!iced && w.isDay && w.rain <= 0 && w.snow <= 0 && Math.abs(WIND) < 35 && w.temp > 10) {
    const hop = Math.floor(t * 4) % 4 === 0 ? 1 : 0;
    b.set(cx - 2, yBase - 8 - hop, [132, 98, 68]); b.set(cx - 1, yBase - 8 - hop, [132, 98, 68]); b.set(cx - 1, yBase - 9 - hop, [156, 118, 84]);
    if (hop) { b.set(cx, yBase - 9, [224, 242, 254]); b.set(cx + 1, yBase - 8, [125, 211, 252]); }
  }
}

function gnome(b: Buf, snowCover: boolean, night: boolean, sun: SunShadow) {
  const cx = 248, yBase = 155;
  castSpan(b, cx - 1, cx + 1, yBase, 6, sun);
  b.rect(cx - 1, yBase, 3, 1, nightc([48, 34, 24], night, 0.45));
  b.rect(cx - 1, yBase - 2, 3, 2, nightc([37, 99, 185], night, 0.45));
  b.rect(cx - 1, yBase - 3, 3, 1, nightc([244, 244, 248], night, 0.45));
  b.set(cx, yBase - 4, nightc([240, 194, 150], night, 0.45));
  b.rect(cx - 1, yBase - 5, 3, 1, nightc([210, 42, 42], night, 0.45));
  b.set(cx, yBase - 6, nightc(snowCover ? [226, 234, 244] : [210, 42, 42], night, 0.45));
}

function mailbox(b: Buf, snowCover: boolean, night: boolean, sun: SunShadow) {
  const cx = 270, yBase = 157;
  castSpan(b, cx - 1, cx + 1, yBase, 7, sun);
  b.rect(cx, yBase - 4, 1, 5, nightc([110, 74, 46], night, 0.45));
  b.rect(cx - 1, yBase - 6, 4, 2, nightc([62, 96, 128], night, 0.45));
  b.rect(cx, yBase - 7, 2, 1, nightc(snowCover ? [226, 234, 244] : [94, 134, 168], night, 0.45));
  b.set(cx - 1, yBase - 6, nightc([30, 34, 42], night, 0.45));
  b.set(cx + 2, yBase - 7, nightc([220, 48, 48], night, 0.45));
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
    const sway = Math.round(Math.sin(t * 2 + x * 0.4) * windyNow() * 1.5 + Math.max(-2, Math.min(2, WIND / 20)));
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
    const m = 6 + Math.floor(Math.abs(WIND) / 4);
    for (let k = 0; k < m; k++) {
      const life = (t * (0.08 + hash(k) * 0.06) + hash(k + 5)) % 1;
      const x = X0 + hash(k + 11) * W + Math.sin(t * 2 + k) * 4 + life * (WIND || 4) * 2, y = 112 + life * 46 * (1 - windyNow() * 0.5);
      b.set(x, y, nightc(cols[k % 4], night, 0.55), 1 - life * 0.3);
    }
  }
}

// his tree, in the field behind the greenhouse: a sapling that grows over years, by the season
function hisTree(b: Buf, tr: NonNullable<PWorld['tree']>, w: PWorld, night: boolean, t: number, sun: SunShadow) {
  const sea = w.season || 'summer', prog = w.seasonProgress ?? 0.5, sz = Math.max(0.05, tr.size);
  const { x, y } = TREE_AT, hgt = Math.round(10 + sz * 34), r = Math.round(3 + sz * 11), tw = sz > 0.6 ? 2 : 1;
  const birch = tr.species === 'birch';
  const bark: RGB = birch ? [226, 222, 214] : [92, 64, 44];
  const bare = sea === 'winter' || (sea === 'autumn' && prog > 0.85);
  b.rect(x - 1, y, tw + 2, 1, [16, 22, 38], 0.26);
  if (sun.active) {
    const trReach = Math.round(sun.sx * (hgt - r) * 0.42);
    const step = trReach >= 0 ? 1 : -1;
    for (let i = 1; i <= Math.abs(trReach); i++) b.set(x + step * i, y, sun.col, sun.alpha * 0.65);
    const cxSh = Math.round(x + sun.sx * hgt * 0.44);
    const rx = Math.max(2, Math.round(r * (0.78 + Math.abs(sun.sx) * 0.35)));
    const ry = Math.max(1, Math.round(r * 0.2));
    for (let j = -ry; j <= ry; j++) for (let i = -rx; i <= rx; i++) {
      const d = (i * i) / (rx * rx) + (j * j) / (ry * ry);
      if (d <= 1 && (!bare || dith(cxSh + i, y + j, 0.32)) && (d < 0.65 || dith(cxSh + i, y + j, 0.62)))
        b.set(cxSh + i, y + j, sun.col, sun.alpha * (1 - d * 0.45) * 0.8);
    }
  }
  for (let j = 0; j < hgt - r; j++) for (let i = 0; i < tw; i++) b.set(x + i, y - j, nightc(birch && (j + i) % 4 === 0 ? [40, 36, 34] : bark, night, 0.6));
  const cy = y - hgt + r;
  const leafC: RGB = sea === 'spring' ? [120, 176, 70] : sea === 'autumn'
    ? mix([70, 120, 50], hex({ apple: '#d97706', maple: '#dc2626', birch: '#facc15', cherry: '#ea580c' }[tr.species] || '#d97706'), Math.min(1, prog * 1.3))
    : [58, 112, 52];
  if (bare) {                                                // branches against the sky
    for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k - 2) * 0.45; b.line(x, cy + r * 0.3, x + Math.cos(a) * r, cy + Math.sin(a) * r, nightc(bark, night, 0.6)); }
    if (w.snow > 0) for (let k = 0; k < 6; k++) b.set(x - r + hash(k) * r * 2, cy - r * 0.6 + hash(k + 1) * r * 0.5, [224, 234, 244]);
    return;
  }
  const sway = Math.sin(t * (0.9 + windyNow() * 2)) * windyNow() * 1.5 + Math.max(-2.5, Math.min(2.5, WIND / 20));
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

function feeder(b: Buf, w: PWorld, night: boolean, t: number, fill = 1) {
  // hung from a low branch of the pine, with birds coming and going by day
  const fx = 241 + Math.round(Math.sin(t * 2.5) * windyNow() * 2 + WIND / 30), fy = 131;
  b.line(241, 124, fx, fy, [200, 200, 200], 0.6);
  b.rect(fx - 3, fy, 7, 1, nightc([150, 40, 30], night)); b.rect(fx - 2, fy + 1, 5, 3, nightc([139, 90, 43], night)); b.rect(fx - 3, fy + 4, 7, 1, nightc([96, 60, 28], night));
  b.set(fx, fy + 2, nightc([214, 190, 120], night));
  if (fill > 0.05) b.set(fx + 1, fy + 2, nightc([234, 200, 120], night));
  if (!w.isDay || Math.abs(WIND) > 40 || fill < 0.05) return;
  for (let k = 0; k < (fill > 0.3 ? 3 : 1); k++) {
    const ph = (t * 0.15 + k * 0.37) % 1;
    if (ph > 0.7) continue;                                  // away for a while
    const bx = fx - 3 + k * 3 + (ph < 0.1 ? (0.1 - ph) * 40 : 0), by = fy + 4 - (Math.floor(t * 3 + k) % 4 === 0 ? 1 : 0) - (ph < 0.1 ? (0.1 - ph) * 20 : 0);
    const c: RGB = k === 1 ? [190, 60, 40] : [120, 90, 60];
    b.set(bx, by - 1, c); b.set(bx + 1, by - 1, c); b.set(bx, by - 2, c); b.set(bx + (k % 2 ? -1 : 2), by - 2, [30, 30, 30]);
  }
}

function benchByPond(b: Buf, night: boolean, sun: SunShadow) {
  castSpan(b, 290, 299, 157, 6, sun);
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
    const seg = (x - x0) % 16, y = base + Math.round(Math.sin((seg / 16) * Math.PI) * (2 + Math.sin(t * 3 + Math.floor((x - x0) / 16)) * windyNow() * 1.5));
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

// the farm's name, painted on a board at the far edge of the field (over the treeline, behind the scarecrow)
function farmBoard(b: Buf, d: Design, night: boolean, t: number) {
  const txt = (d.farm_name || '').slice(0, 12);
  if (!txt) return;
  const wdt = txt.length * 4 + 5, x0 = Math.min(317 - wdt, Math.round(290 - wdt / 2)), y0 = 113;
  const sway = Math.round(Math.sin(t * 1.3) * windyNow() * 0.6);
  b.rect(x0 + 2, y0 + 9, 1, 4, nightc([96, 60, 28], night)); b.rect(x0 + wdt - 3, y0 + 9, 1, 4, nightc([96, 60, 28], night));
  b.rect(x0 + sway, y0, wdt, 9, nightc([92, 60, 36], night)); b.rect(x0 + 1 + sway, y0 + 1, wdt - 2, 7, nightc([226, 214, 186], night));
  text3(b, x0 + 3 + sway, y0 + 2, txt, nightc([120, 40, 28], night));
}

function signBoard(b: Buf, d: Design, night: boolean, sun: SunShadow) {
  const txt = (d.sign || '').slice(0, 14);
  if (!txt) return;
  const wdt = txt.length * 4 + 5, x0 = Math.round(212 - wdt / 2), y0 = 128;
  castSpan(b, x0 + 1, x0 + wdt - 2, y0 + 14, 15, sun, 0.75);
  b.rect(x0 + 1, y0 + 8, 1, 7, nightc([96, 60, 28], night)); b.rect(x0 + wdt - 2, y0 + 8, 1, 7, nightc([96, 60, 28], night));
  b.rect(x0, y0, wdt, 9, nightc([110, 74, 46], night)); b.rect(x0 + 1, y0 + 1, wdt - 2, 7, nightc([176, 132, 84], night));
  text3(b, x0 + 3, y0 + 2, txt, nightc([60, 36, 20], night));
}


// ── the field behind the house: rows running back to the treeline, his crop in them ──
// Eight rows, the far ones smaller (they are further off). Each crop is drawn by its stage and how far through it.
const FIELD_X0 = 84, FIELD_X1 = 318;
export const FIELD_GATE = { x: 262 };               // between the pine and the pond: the way into the field
const CROP_COL: Record<string, { leaf: RGB; ripe: RGB; dry: RGB; bloom: RGB }> = {
  corn: { leaf: [74, 140, 52], ripe: [214, 190, 90], dry: [176, 150, 96], bloom: [206, 186, 112] },
  'winter wheat': { leaf: [96, 150, 60], ripe: [222, 186, 92], dry: [180, 160, 110], bloom: [170, 190, 110] },
  sunflowers: { leaf: [64, 128, 48], ripe: [120, 84, 40], dry: [140, 110, 70], bloom: [250, 204, 21] },
  pumpkins: { leaf: [60, 130, 56], ripe: [234, 118, 24], dry: [150, 120, 80], bloom: [252, 211, 77] },
  beans: { leaf: [80, 146, 60], ripe: [200, 190, 110], dry: [160, 136, 90], bloom: [240, 240, 250] },
};
function field(b: Buf, w: PWorld, f: PField, night: boolean, t: number, snowCover: boolean) {
  const span = FIELD_X1 - FIELD_X0;
  const worked = f.crop ? 1 : f.stage === 'stubble' ? 1 : Math.min(1, f.tilled);
  const sun = w.hour < 12 ? -1 : 1;                                       // sunflower heads turn east to west through the day
  for (let r = 0; r < 8; r++) {
    const y = 121 + r * 3, sc = 0.45 + 0.55 * (r / 7);
    const depth = 1 - r / 7;
    const depthC = (c: RGB): RGB => {
      if (night) return mix(c, [12, 18, 38], depth * 0.22);
      const cool = mix(c, snowCover ? [164, 188, 222] : [42, 66, 86], depth * 0.24);
      return snowCover ? cool : mix(cool, [255, 240, 195], (1 - depth) * 0.08);
    };
    const rnightc = (c: RGB, k = 0.55): RGB => nightc(depthC(c), night, k);
    // the soil of the row (worked ground left to right as far as he has got)
    for (let x = FIELD_X0; x < FIELD_X0 + span * worked; x++) {
      if (snowCover) { if (dith(x, y, 0.25)) b.set(x, y, rnightc([174, 192, 214], 0.5)); continue; }
      const clod = h2(x, r * 3) > 0.65;
      b.set(x, y, rnightc(clod ? [108, 78, 52] : dith(x, y, 0.45) ? [94, 68, 46] : [76, 52, 34]));
      if (dith(x, y + 1, 0.42)) b.set(x, y + 1, rnightc([108, 80, 54]), 0.45);
    }
    if (!worked) continue;
    const col = f.crop ? CROP_COL[f.crop] || CROP_COL.corn : CROP_COL.corn;
    const sick = Math.max(0, 0.7 - f.health);
    const step = f.crop === 'winter wheat' ? 2 : f.crop === 'sunflowers' ? 5 : f.crop === 'corn' ? 4 : f.crop === 'pumpkins' ? 6 : 5;
    const xEnd = FIELD_X0 + span * worked;
    for (let bx = FIELD_X0 + ((r * 3) % step); bx < xEnd; bx += step) {
      const k = hash(bx * 3.7 + r * 11.3), k2 = hash(bx * 7.1 + r * 5.9);
      const x = Math.min(FIELD_X1 - 1, Math.max(FIELD_X0, bx + Math.round((k - 0.5) * Math.max(1, step - 1.5))));
      const py = y + (k2 > 0.78 && r > 0 ? -1 : k2 < 0.14 && r < 7 ? 1 : 0);
      const sway = (z: number, hgt: number) => Math.round((WIND / 28 + Math.sin(t * 2.2 + x * 0.3 + r) * windyNow() * 0.9) * (z / Math.max(1, hgt)) * (1 + hgt / 10));
      if (f.stage === 'stubble' || (!f.crop && f.stage !== 'grass')) {          // stubble, or weeds in bare ground
        if (f.stage === 'stubble' && k > 0.32) {
          b.set(x, py - 1, rnightc([196, 170, 110]));
          if (sc > 0.65 && k > 0.6) b.set(x + 1, py - 2, rnightc([170, 146, 90]));
        }
        if (h2(x, r) < f.weeds * 0.5) b.set(x, py - 1 - Math.round(f.weeds * 2), rnightc([86, 140, 46]));
        continue;
      }
      if (!f.crop) continue;
      const st = f.stage, fr = f.frac;
      if (st === 'sown') {
        if (!snowCover && k > 0.35) {
          b.set(x, py - 1, rnightc([138, 102, 66]));
          b.set(x + 1, py, rnightc([78, 54, 34]));
          if (k > 0.72) b.set(x + 1, py - 1, rnightc([206, 182, 120]));
        }
        continue;
      }
      if (st === 'sprout') {
        if (snowCover) continue;
        const gL = rnightc([134, 239, 172], 0.5), gM = rnightc([74, 222, 128], 0.5);
        b.set(x, py - 1, gM);
        if (sc > 0.62) { b.set(x - 1, py - 2, gL); b.set(x + 1, py - 2, gM); }
        else b.set(x + (k > 0.5 ? 1 : -1), py - 2, gL);
        continue;
      }
      let leaf: RGB = mix(col.leaf, [190, 170, 90], sick);
      if (st === 'ripe') leaf = mix(leaf, col.ripe, f.crop === 'corn' ? 0.22 : f.crop === 'winter wheat' ? 0.85 : 0.35);
      if (st === 'spent' || st === 'dead') leaf = col.dry;
      if (f.dormant) leaf = mix(leaf, [110, 120, 80], 0.4);
      // the height of this plant (px, at full scale), by crop and stage
      const H: Record<string, number[]> = {     // sprout, young, tall, flower, ripe, spent
        corn: [1, 3 + 5 * fr, 9 + 7 * fr, 16, 16, 14], 'winter wheat': [1, 2 + fr, 4 + 2 * fr, 6, 6, 5],
        sunflowers: [1, 3 + 3 * fr, 7 + 6 * fr, 14, 14, 12], pumpkins: [1, 2 + fr, 3, 3, 3, 2], beans: [1, 5 + 2 * fr, 8 + 2 * fr, 10, 10, 8] };
      const idx = ['sprout', 'young', 'tall', 'flower', 'ripe', 'spent', 'dead'].indexOf(st);
      let hgt = Math.max(1, Math.round((H[f.crop] || H.corn)[Math.min(5, idx)] * sc * (0.8 + k * 0.4)));
      if (st === 'dead') hgt = Math.max(1, Math.round(hgt * 0.45));
      if (snowCover && hgt <= 2) continue;                                     // under the snow
      const c = rnightc(leaf);
      const cd = rnightc(mix(leaf, [0, 0, 0], 0.28));
      const cL = rnightc(mix(leaf, [255, 255, 220], 0.22));

      if (f.crop === 'pumpkins') {                                             // broad trailing vines + blossoms + distance-scaled pumpkins
        const spanV = sc > 0.65 ? 2 : 1;
        for (let i = -spanV; i <= spanV; i++) {
          b.set(x + i, py, Math.abs(i) === spanV ? cd : c);
          if (sc > 0.56 && h2(x + i, r + 2) > 0.42) b.set(x + i, py - 1, (i + r) % 2 ? cL : c);
          if (st !== 'young' && sc > 0.76 && h2(x + i, r + 5) > 0.72) b.set(x + i, py - 2, cL);
        }
        if (st === 'flower' && k > (sc < 0.6 ? 0.65 : 0.5)) {
          b.set(x, py - (sc < 0.56 ? 1 : 2), rnightc(col.bloom, 0.5));
          if (sc > 0.72) b.set(x + 1, py - 2, rnightc([234, 179, 8], 0.5));
        }
        const pChance = sc < 0.56 ? 0.74 : sc < 0.74 ? 0.66 : 0.58;
        if ((st === 'ripe' || st === 'spent' || (st === 'flower' && fr > 0.55)) && k > pChance) {
          const baseP: RGB = st === 'flower' ? [116, 150, 56] : st === 'spent' ? [184, 96, 32] : col.ripe;
          const pM = rnightc(baseP, 0.5), pL = rnightc(mix(baseP, [255, 210, 140], 0.35), 0.5), pD = rnightc(mix(baseP, [60, 20, 8], 0.4), 0.5);
          const stemC = rnightc([64, 112, 42], 0.5);
          if (sc < 0.56) {
            b.set(x, py, pM);
            if (k > 0.85) b.set(x + 1, py, pD);
          } else if (sc < 0.74) {
            b.set(x, py - 1, pL); b.set(x + 1, py - 1, pM);
            b.set(x, py, pM); b.set(x + 1, py, pD);
            if (k > 0.78) b.set(x, py - 2, stemC);
          } else if (sc < 0.88) {
            b.rect(x - 1, py - 1, 3, 2, pM); b.set(x - 1, py - 1, pL); b.set(x + 1, py, pD);
            b.set(x, py - 2, stemC);
          } else {
            b.rect(x - 1, py - 1, 4, 2, pM); b.set(x - 1, py - 1, pL); b.set(x + 1, py - 1, pL);
            b.set(x + 2, py, pD); b.set(x, py, pD);
            b.set(x, py - 2, stemC);
          }
        }
        continue;
      }

      if (f.crop === 'beans') {                                                // wooden bean poles + climbing vine spirals + blossoms & pods
        const poleC = rnightc([120, 84, 50], 0.5), poleD = rnightc([84, 56, 34], 0.5);
        for (let j = 0; j < hgt; j++) {
          const sx = x + sway(j, hgt);
          b.set(sx, py - j, j % 2 ? poleC : poleD);
          if (st !== 'dead' && j > 0) {
            const side = Math.round(Math.sin(j * 1.15 + k * 6));
            b.set(sx + side, py - j, j % 2 ? cL : c);
            if (sc > 0.65 && side !== 0) b.set(sx + side * 2, py - j, cd);
          }
        }
        if (st === 'flower' && hgt > 3) {
          b.set(x - 1, py - Math.round(hgt * 0.65), rnightc(col.bloom, 0.45));
          if (sc > 0.6) b.set(x + 1, py - Math.round(hgt * 0.4), rnightc([254, 240, 138], 0.45));
        }
        if ((st === 'ripe' || st === 'spent') && hgt > 3) {
          const podC = rnightc(st === 'ripe' ? [196, 214, 118] : col.dry, 0.5);
          const py1 = py - Math.round(hgt * 0.55);
          b.set(x + 1, py1, podC); b.set(x + 1, py1 + 1, podC);
          if (sc > 0.65) { b.set(x - 1, py - Math.round(hgt * 0.35), podC); b.set(x - 1, py - Math.round(hgt * 0.35) + 1, podC); }
        }
        continue;
      }

      if (f.crop === 'winter wheat') {                                         // textured stems + 2px drooping wheat-ear heads + wind waves
        if (k < 0.2) continue;
        const wave = ((((x - DRIFT * 0.8 + r * 3) % 22) + 22) % 22) < 3 + windyNow() * 4;
        const stalkC = st === 'ripe' ? rnightc([156, 134, 68]) : c;
        for (let j = 0; j < hgt - 1; j++) b.set(x + sway(j, hgt), py - j, j === 0 ? cd : stalkC);
        const topX = x + sway(hgt, hgt), lean = st === 'ripe' || st === 'spent' ? (WIND < -5 ? -1 : 1) : 0;
        const headBase: RGB = st === 'flower' ? col.bloom : st === 'ripe' ? [240, 212, 118] : st === 'spent' || st === 'dead' ? col.dry : mix(leaf, [220, 236, 150], 0.3);
        const headC = rnightc(wave ? mix(headBase, [255, 250, 220], 0.4) : headBase);
        b.set(topX, py - hgt + 1, headC);
        b.set(topX + lean, py - hgt, wave ? rnightc([253, 236, 160], 0.5) : headC);
        continue;
      }

      // corn and sunflowers: organic stalk, curved leaves, and detailed head/tassel/cob
      const kink = (f.crop === 'corn' && (st === 'spent' || st === 'dead')) ? (k > 0.5 ? 1 : -1) : 0;
      for (let j = 0; j < hgt; j++) {
        const bend = kink && j > hgt * 0.55 ? kink * Math.round((j - hgt * 0.55) * 0.45) : 0;
        const sx = x + sway(j, hgt) + bend;
        b.set(sx, py - j, j % 2 ? c : cd);
        if (j > 0 && j < hgt - 1 && (st === 'dead' ? (j + r + (bx >> 2)) % 4 === 0 && k > 0.45 : (j + r + (bx >> 2)) % 3 === 0) && hgt > 3) {
          const side = (j + (bx >> 2)) % 2 ? 1 : -1;
          b.set(sx + side, py - j, j > hgt * 0.6 ? cL : c);
          if (sc > 0.58 && (f.crop === 'corn' || st === 'young')) b.set(sx + side * 2, py - j + 1, cd);
        }
      }
      if (f.crop === 'corn' && st === 'young' && hgt >= 2) {
        const tx = x + sway(hgt, hgt);
        b.set(tx - 1, py - hgt, cL); b.set(tx + 1, py - hgt, cL);
      }
      const top = x + sway(hgt, hgt) + (kink && hgt > 3 ? kink : 0);
      if (f.crop === 'corn') {
        if ((st === 'flower' || st === 'ripe') && k > (st === 'ripe' ? 0.58 : sc < 0.6 ? 0.55 : 0.45)) {
          const tasC = rnightc(st === 'ripe' ? [184, 158, 92] : [212, 192, 114], 0.5);
          b.set(top, py - hgt, tasC);
          if (sc > 0.65 && hgt > 6) b.set(top, py - hgt - 1, tasC);
          if (sc > 0.78 && k > 0.72) b.set(top + (k > 0.86 ? 1 : -1), py - hgt, tasC);
        }
        if ((st === 'ripe' || st === 'spent' || (st === 'flower' && fr > 0.4)) && hgt > 5) {
          const midY = py - Math.round(hgt * 0.46), midX = x + sway(hgt * 0.46, hgt) + 1;
          const cobL = rnightc(st === 'flower' ? [150, 190, 90] : st === 'spent' ? [196, 170, 96] : [250, 204, 21], 0.5);
          const cobD = rnightc(st === 'flower' ? [108, 148, 62] : st === 'spent' ? [146, 120, 68] : [202, 138, 4], 0.5);
          b.set(midX, midY, cobL); b.set(midX, midY - 1, cobL);
          if (sc > 0.65) { b.set(midX + 1, midY - 1, cobD); b.set(midX + 1, midY - 2, cobL); }
        }
      } else if (f.crop === 'sunflowers' && (st === 'flower' || st === 'ripe' || st === 'spent')) {
        const droop = st !== 'flower';
        const hx = top + (droop ? 1 : sun), hy = py - hgt + (droop ? 2 : 0);
        const pBright = rnightc(st === 'flower' ? [250, 204, 21] : st === 'ripe' ? [202, 146, 46] : col.dry, 0.5);
        const pWarm = rnightc(st === 'flower' ? [234, 179, 8] : [164, 114, 38], 0.5);
        const disc = rnightc([96, 54, 22], 0.5);
        if (sc > 0.68 && st !== 'spent') {
          b.set(hx - 1, hy - 1, pBright); b.set(hx, hy - 1, pWarm); b.set(hx + 1, hy - 1, pBright);
          b.set(hx - 1, hy, pWarm); b.set(hx + 1, hy, pWarm);
          b.set(hx - 1, hy + 1, pBright); b.set(hx, hy + 1, pWarm); b.set(hx + 1, hy + 1, pBright);
          b.set(hx, hy, disc);
        } else if (st !== 'spent') {
          b.set(hx - 1, hy, pBright); b.set(hx + 1, hy, pBright); b.set(hx, hy - 1, pWarm); b.set(hx, hy, disc);
        } else {
          b.set(hx, hy, disc); b.set(hx + 1, hy, rnightc(col.dry, 0.5));
        }
      }
    }
    // weeds coming up between the rows
    if (f.crop && !snowCover) for (let x = FIELD_X0 + 1; x < FIELD_X1; x += 5) if (h2(x, r * 7) < f.weeds * 0.6) {
      const wh = 1 + Math.round(f.weeds * 2 * sc);
      for (let j = 1; j <= wh; j++) b.set(x, y - j, rnightc([96, 156, 50]));
    }
  }
  // crows, when there is seed or ripe grain to steal and nothing to scare them off
  const guarded = f.scarecrow && !f.scarecrow.down;
  if (f.crop && !guarded && w.isDay && ['sown', 'sprout', 'ripe'].includes(f.stage)) for (let k = 0; k < 3; k++) {
    const ph = (t * 0.05 + k * 0.33) % 1;
    const flying = ph > 0.85;
    const cx = 200 + hash(k + Math.floor(t * 0.05 + k * 0.33)) * 100 + (flying ? (ph - 0.85) * 200 : 0);
    const cy = 124 + Math.floor(hash(k + 4) * 6) * 3 - (flying ? (ph - 0.85) * 120 : 0);
    const hop = !flying && Math.floor(t * 3 + k) % 5 === 0 ? 1 : 0;
    const c: RGB = [24, 24, 30];
    b.set(cx, cy - 1 - hop, c); b.set(cx + 1, cy - 1 - hop, c); b.set(cx + 1, cy - 2 - hop, c);
    if (flying) { b.set(cx - 1, cy - 2, c); b.set(cx + 2, cy - 3, c); }
  }
}

export const SCARECROW = { x: 300, y: 141 };
function scarecrow(b: Buf, sc: { name?: string; down?: boolean }, night: boolean, t: number, sun: SunShadow) {
  const { x, y } = SCARECROW;
  const pole: RGB = nightc([120, 84, 50], night, 0.5), poleD: RGB = nightc([84, 56, 34], night, 0.5);
  const coat: RGB = nightc([96, 64, 120], night, 0.5), coatL: RGB = nightc([126, 88, 154], night, 0.5), coatD: RGB = nightc([66, 42, 86], night, 0.5);
  const straw: RGB = nightc([226, 196, 110], night, 0.5), head: RGB = nightc([204, 172, 120], night, 0.5);
  const hat: RGB = nightc([68, 48, 34], night, 0.5), hatD: RGB = nightc([44, 30, 22], night, 0.5);
  if (sc.down) {                                                            // blown over: lying in the rows
    b.rect(x - 7, y + 1, 14, 1, [16, 22, 38], 0.22);
    b.rect(x - 7, y, 14, 1, pole); b.rect(x - 4, y - 1, 5, 2, coat); b.set(x - 5, y - 1, straw);
    b.rect(x + 2, y - 1, 2, 2, head); b.rect(x + 4, y - 2, 3, 2, hat);
    return;
  }
  const sway = Math.round(Math.sin(t * 1.6) * windyNow() * 1.2 + WIND / 40);
  // ground contact AO + sun cast shadow
  castSpan(b, x - 1, x + 1, y + 1, 16, sun, 0.85);
  b.rect(x, y - 13, 1, 14, pole); b.set(x, y, poleD);
  // flared coat with highlight & hem
  for (let row = 0; row < 5; row++) {
    const hw = row >= 3 ? 2 : 1;
    for (let i = -hw; i <= hw; i++) b.set(x + i, y - 10 + row, i < 0 ? coatL : i > 0 ? coatD : coat);
  }
  b.set(x - 1, y - 5, straw); b.set(x + 1, y - 5, straw); b.set(x, y - 11, straw);
  // outstretched sleeves with drooping straw cuffs
  for (let i = -5; i <= 5; i++) {
    const sx = x + i + (Math.abs(i) > 3 ? sway : 0), sy = y - 10 + (Math.abs(i) > 4 ? 1 : 0);
    b.set(sx, sy, Math.abs(i) === 5 ? straw : i < 0 ? coatL : coat);
    if (Math.abs(i) === 5) { b.set(sx, sy + 1, straw); b.set(sx + (i < 0 ? -1 : 1), sy + 1, straw); }
  }
  // expressive head & tilted 6px hat brim
  const hx = x + sway;
  b.rect(hx - 1, y - 14, 3, 3, head);
  b.set(hx - 1, y - 13, nightc([44, 30, 24], night)); b.set(hx + 1, y - 13, nightc([44, 30, 24], night));
  for (let i = -3; i <= 2; i++) b.set(hx + i, y - 15 - (i > 0 ? 1 : 0), i < 0 ? hat : hatD);
  b.rect(hx - 1, y - 17, 3, 2, hat); b.set(hx + 1, y - 17, hatD);
}

export const WOODPILE = { x: 256, y: 158 }, CHOP_BLOCK = { x: 264, y: 158 };
function woodpile(b: Buf, wood: number, night: boolean, chopping: boolean, snowCover: boolean, sun: SunShadow) {
  const end: RGB = nightc([196, 150, 96], night, 0.5), ring: RGB = nightc([150, 104, 60], night, 0.5), bark: RGB = nightc([96, 64, 40], night, 0.5);
  const crevice: RGB = nightc([48, 30, 18], night, 0.5);
  const rows = Math.round(Math.max(0, Math.min(1, wood)) * 4);
  if (rows > 0) {
    castSpan(b, WOODPILE.x - 6, WOODPILE.x + 5, WOODPILE.y, rows * 2, sun);
    b.rect(WOODPILE.x - 6, WOODPILE.y - rows * 2, 12, rows * 2, crevice);
  }
  for (let r = 0; r < rows; r++) for (let i = 0; i < 4 - (r > 2 ? 1 : 0); i++) {
    const lx = WOODPILE.x - 6 + i * 3 + (r % 2), ly = WOODPILE.y - 2 - r * 2;
    b.set(lx, ly, end); b.set(lx + 1, ly, ring); b.set(lx, ly + 1, ring); b.set(lx + 1, ly + 1, bark);
  }
  if (snowCover && rows) b.rect(WOODPILE.x - 6, WOODPILE.y - 2 - rows * 2, 12, 1, [224, 234, 244]);
  // the chopping block, with the shaded steel axe left in it when he is not using it
  castSpan(b, CHOP_BLOCK.x - 2, CHOP_BLOCK.x + 2, CHOP_BLOCK.y, 4, sun);
  b.rect(CHOP_BLOCK.x - 2, CHOP_BLOCK.y - 3, 5, 3, nightc([120, 84, 50], night, 0.5));
  b.rect(CHOP_BLOCK.x + 2, CHOP_BLOCK.y - 2, 1, 2, bark);
  b.rect(CHOP_BLOCK.x - 2, CHOP_BLOCK.y - 3, 5, 1, end);
  if (!chopping) {
    b.line(CHOP_BLOCK.x + 1, CHOP_BLOCK.y - 4, CHOP_BLOCK.x + 4, CHOP_BLOCK.y - 8, nightc([110, 72, 38], night));
    b.line(CHOP_BLOCK.x + 1, CHOP_BLOCK.y - 5, CHOP_BLOCK.x + 4, CHOP_BLOCK.y - 9, nightc([180, 130, 80], night));
    b.set(CHOP_BLOCK.x, CHOP_BLOCK.y - 4, [226, 232, 240]); b.set(CHOP_BLOCK.x + 1, CHOP_BLOCK.y - 4, [148, 163, 184]);
  }
}

// the stove in his study: it burns whenever it is cold and there is wood
function stove(b: Buf, lit: boolean, night: boolean, cooking: boolean, t: number) {
  const iron: RGB = nightc([46, 44, 48], night, 0.3), dk: RGB = [24, 22, 26];
  b.rect(-27, 143, 6, 6, iron); b.rect(-27, 149, 1, 1, dk); b.rect(-22, 149, 1, 1, dk); b.rect(-28, 142, 8, 1, dk);
  b.rect(-25, 121, 1, 21, iron);                                            // the stovepipe, up through the roof
  if (lit) {
    for (let i = 0; i < 3; i++) b.set(-25 + i, 146, (Math.floor(t * 6) + i) % 3 ? [251, 146, 60] : [253, 224, 71]);
    b.glow(-24, 146, 9, [251, 146, 60], night ? 0.3 : 0.12);
  }
  if (cooking) {                                                            // a pot on top, steaming
    b.rect(-26, 140, 4, 2, [70, 74, 82]); b.set(-27, 140, [70, 74, 82]); b.set(-22, 140, [70, 74, 82]);
    for (let k = 0; k < 3; k++) { const ph = (t * 0.7 + k / 3) % 1; b.set(-25 + Math.round(Math.sin(t * 2 + k)), 139 - ph * 6, [230, 230, 235], 0.5 * (1 - ph)); }
  }
}

export const SNOWMAN_AT = { x: 180, y: 160 };
function snowman(b: Buf, size: number, night: boolean, sun: SunShadow) {
  const s = Math.max(0.2, Math.min(1, size)), { x, y } = SNOWMAN_AT;
  const white: RGB = nightc([240, 246, 252], night, 0.4), shade: RGB = nightc([156, 178, 206], night, 0.4);
  const r1 = Math.max(1, Math.round(4 * s)), r2 = Math.max(1, Math.round(3 * s)), r3 = Math.max(1, Math.round(2 * s));
  const lean = s < 0.6 ? 1 : 0;
  castSpan(b, x - r1, x + r1, y - 1, (r1 + r2 + r3) * 2, sun);
  const ball = (cx: number, cy: number, r: number) => { for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r + r * 0.5) b.set(cx + i, cy + j, j > r / 3 || i > r / 2 ? shade : white); };
  ball(x, y - r1, r1); ball(x + lean, y - 2 * r1 - r2 + 1, r2); ball(x + lean * 2, y - 2 * r1 - 2 * r2 - r3 + 2, r3);
  const hy = y - 2 * r1 - 2 * r2 - r3 + 2;
  b.set(x + lean * 2, hy, [20, 20, 24]); b.set(x + lean * 2 + 1, hy + (s > 0.5 ? 1 : 0), [234, 118, 24]);    // an eye, the carrot
  if (s > 0.5) {
    const ay = y - 2 * r1 - r2 + 1;
    b.set(x + lean, ay, [30, 32, 38]); b.set(x + lean, ay + 2, [30, 32, 38]);
    b.line(x - r2, ay, x - r2 - 3, ay - 2, [110, 74, 46]); b.line(x + r2 + 1, ay, x + r2 + 4, ay - 3, [110, 74, 46]);
  }
}

export const FIRE_AT = { x: 281, y: 159 };
function firepit(b: Buf, burning: boolean, night: boolean, t: number, sun: SunShadow) {
  const { x, y } = FIRE_AT;
  castSpan(b, x - 4, x + 4, y, 2, sun, 0.85);
  castSpan(b, x - 11, x - 7, y, 2, sun, 0.85);
  const stL: RGB = nightc([140, 136, 130], night, 0.45), stM: RGB = nightc([96, 92, 88], night, 0.45), stD: RGB = nightc([62, 58, 56], night, 0.45);
  // rounded hearth stone ring
  for (const sx of [-4, -2, 0, 2, 4]) {
    const sy = Math.abs(sx) === 4 ? y - 1 : y;
    b.set(x + sx, sy, stM); b.set(x + sx - 1, sy, stL); b.set(x + sx, sy + 1, stD);
  }
  b.set(x - 5, y, stD); b.set(x + 5, y, stD);
  // log seat with end-grain & shadow
  b.rect(x - 11, y - 1, 5, 2, nightc([110, 74, 46], night, 0.45));
  b.rect(x - 11, y - 1, 5, 1, nightc([142, 98, 62], night, 0.45));
  b.set(x - 7, y - 1, nightc([196, 150, 96], night, 0.45));
  if (!burning) { b.rect(x - 1, y - 1, 3, 1, [54, 50, 48]); return; }
  // glowing ember coal bed
  for (let i = -2; i <= 2; i++) b.set(x + i, y - 1, (i + Math.floor(t * 5)) % 2 ? [220, 38, 38] : [251, 146, 60]);
  for (let k = 0; k < 9; k++) {
    const fx = x - 2 + (k % 5), hh = 2 + Math.floor((Math.sin(t * 9 + k * 1.7) + 1) * 1.6);
    for (let j = 0; j < hh; j++) b.set(fx, y - 1 - j, j === hh - 1 ? [253, 224, 71] : j > hh / 2 ? [251, 146, 60] : [220, 38, 38]);
  }
  for (let k = 0; k < 4; k++) { const ph = (t * 0.5 + k / 4) % 1; b.set(x + Math.sin(t * 3 + k * 2) * 2 + (WIND / 20) * ph * 4, y - 5 - ph * 14, [253, 186, 116], 1 - ph); }
  b.glow(x, y - 3, night ? 22 : 8, [251, 146, 60], night ? 0.35 : 0.12);
}

// the aquarium in the attic, beside his desk: his prize fish, swimming
export const TANK = { x0: 15, x1: 29, top: 101, base: 108 }, TANK_STAND = { x: 32, y: 112 };
const FISH_LOOK: Record<string, [RGB, RGB]> = { bluegill: [[70, 110, 150], [234, 140, 50]], 'green sunfish': [[70, 140, 100], [250, 204, 21]],
  'yellow perch': [[214, 180, 60], [60, 70, 40]], 'largemouth bass': [[110, 130, 70], [40, 50, 30]], 'channel catfish': [[120, 120, 130], [60, 60, 70]] };
function aquarium(b: Buf, aq: NonNullable<PWorld['aquarium']>, night: boolean, t: number) {
  const { x0, x1, top, base } = TANK;
  const wood: RGB = nightc([96, 60, 28], night, 0.4);
  b.rect(x0, base, x1 - x0 + 1, 4, wood); b.rect(x0 + 1, base + 1, x1 - x0 - 1, 2, nightc([120, 80, 42], night, 0.4));   // the stand
  const murk = Math.max(0, 1 - aq.clean);
  for (let y = top; y < base; y++) for (let x = x0; x <= x1; x++) {
    const edge = x === x0 || x === x1 || y === top;
    let c: RGB = edge ? [170, 200, 210] : mix([40, 110, 150], [24, 70, 110], (y - top) / (base - top));
    if (!edge && murk > 0.35) c = mix(c, [80, 110, 50], (murk - 0.35) * 0.9);
    b.set(x, y, edge ? c : nightc(c, night, 0.15), edge ? 0.85 : 1);
  }
  for (let x = x0 + 1; x < x1; x++) b.set(x, base - 1, h2(x, 3) > 0.5 ? [196, 170, 120] : [150, 130, 100]);   // gravel
  for (const px of [x0 + 2, x0 + 3, x1 - 3]) for (let j = 2; j < 5 + (px % 3); j++)                    // weed swaying
    b.set(px + Math.round(Math.sin(t * 1.3 + j * 0.8 + px) * 0.6), base - j, [60, 150, 80]);
  for (let k = 0; k < 3; k++) { const ph = (t * 0.4 + k / 3) % 1; b.set(x1 - 2, base - 2 - ph * (base - top - 3), [210, 235, 245], 0.7 * (1 - ph)); }   // bubbles
  aq.fish.slice(0, 5).forEach((f, i) => {
    const [body, mark] = FISH_LOOK[f.species] || FISH_LOOK.bluegill;
    const len = f.cm > 20 ? 4 : 3, spd = 0.25 + hash(i + 7) * 0.2, sick = (f.health ?? 1) < 0.4;
    const ph = Math.sin(t * spd + i * 2.1), dir = Math.cos(t * spd + i * 2.1) > 0 ? 1 : -1;
    const fx = Math.round((x0 + x1) / 2 + ph * ((x1 - x0) / 2 - len)), fy = top + 2 + Math.round(((i * 37) % 4) + Math.sin(t * 0.7 + i) * (sick ? 0 : 0.8)) + (sick ? 2 : 0);
    for (let k = 0; k < len; k++) b.set(fx - dir * k, fy, k === 1 ? mark : body);
    b.set(fx - dir * len, fy + (Math.floor(t * 4 + i) % 2 ? -1 : 0), body);                           // the tail, flicking
    b.set(fx, fy, mix(body, [255, 255, 255], 0.3));
  });
  b.rect(x0, top - 1, x1 - x0 + 1, 1, [60, 60, 66]);                                                   // the lid, with its lamp
  b.glow((x0 + x1) / 2, top + 3, 12, [120, 200, 240], night ? 0.28 : 0.08);
}

export const TELESCOPE = { x: 214, y: 160 };
function telescope(b: Buf, night: boolean, sun: SunShadow) {
  const { x, y } = TELESCOPE;
  castSpan(b, x - 3, x + 3, y - 1, 20, sun, 0.7);
  const legL: RGB = nightc([120, 126, 138], night, 0.3), legD: RGB = nightc([72, 78, 90], night, 0.3);
  const brassL: RGB = [234, 179, 8], brassD: RGB = [180, 110, 24];
  const tubeL: RGB = [241, 245, 249], tubeD: RGB = [148, 163, 184];
  b.line(x, y - 16, x + 4, y, legD);
  b.line(x, y - 16, x, y, legD);
  b.line(x, y - 16, x - 4, y, legL);
  b.rect(x - 1, y - 17, 3, 2, brassD); b.set(x, y - 17, brassL);
  b.line(x - 4, y - 18, x + 5, y - 24, tubeD);
  b.line(x - 4, y - 19, x + 5, y - 25, tubeL);
  b.set(x + 5, y - 25, brassL); b.set(x + 5, y - 24, brassD);               // brass dew-shield collar
  b.set(x - 5, y - 19, brassL); b.set(x - 5, y - 18, brassD);               // eyepiece
  b.set(x + 6, y - 25, [125, 211, 252]);                                    // objective lens glint
}

function indoorShade(b: Buf, w: PWorld, d: Design, night: boolean, reading: boolean, lightOn: boolean) {
  const ao = (x0: number, y0: number, wdt: number, hgt: number, a: number) => b.rect(x0, y0, wdt, hgt, [12, 10, 20], a);
  // 1. Study interior AO & light falloff (x = -44..-1, y = 121..150)
  ao(-44, 122, 44, 1, 0.20);
  ao(-44, 122, 3, 3, 0.14); ao(-3, 122, 3, 3, 0.14);
  ao(-44, 150, 44, 1, 0.18);
  ao(-44, 148, 3, 2, 0.16); ao(-3, 148, 3, 2, 0.16);
  ao(-40, 142, 10, 2, 0.24); ao(-40, 148, 10, 2, 0.22);
  ao(-26, 149, 4, 1, 0.24);
  for (const sy of [124, 131, 137, 143]) ao(-18, sy, 14, 1, 0.16);

  const studyLamp = d.lamp === 'on' && (night || w.hour < 8 || w.hour > 17 || w.cloud > 75);
  for (let y = 121; y <= 150; y++) for (let x = -44; x <= -1; x++) {
    if (studyLamp && x >= -39 && x <= -36 && y >= 134 && y <= 135) continue;
    if (w.stoveLit && x >= -25 && x <= -23 && y === 146) continue;
    let ill = night ? 0.12 : 0.22;
    if (studyLamp) ill += 0.85 * Math.max(0, 1 - Math.hypot((x + 37) / 22, (y - 136) / 16) * 0.75);
    if (w.stoveLit) ill += 0.55 * Math.max(0, 1 - Math.hypot((x + 24) / 14, (y - 146) / 10));
    if (!night) ill += 0.72 * Math.max(0, 1 - Math.hypot((x + 1) / 36, (y - 138) / 22));
    const dark = (1 - Math.min(1, ill)) * (night ? 0.34 : 0.28);
    if (dark > 0.015) b.set(x, y, [12, 14, 28], dark);
  }

  // 2. Main room interior AO & light falloff (x = 0..77, y = 112..150)
  ao(0, 114, 78, 1, 0.22);
  ao(0, 114, 3, 3, 0.16); ao(75, 114, 3, 3, 0.16);
  ao(0, 150, 78, 1, 0.16);
  ao(0, 148, 3, 2, 0.18); ao(75, 148, 3, 2, 0.18);
  ao(4, 143, 24, 1, 0.24); ao(6, 149, 21, 1, 0.22);
  ao(42, 149, 20, 1, 0.26);
  ao(65, 148, 6, 2, 0.22); ao(74, 144, 4, 1, 0.18); ao(74, 149, 4, 1, 0.22);
  ao(31, 141, 39, 1, 0.16);

  const winVis = w.isDay ? Math.max(0.25, 1 - w.cloud / 120) * (1 - (w.upkeep?.windows ?? 0) * 0.4) : 0;
  const readLamp = reading && (!w.isDay || w.hour > 16.5 || w.cloud > 80);
  for (let y = 112; y <= 150; y++) for (let x = 0; x < 78; x++) {
    if (x >= 34 && x < 67 && y >= 118 && y < 135) continue;
    if (readLamp && x >= 75 && x <= 77 && y >= 139 && y <= 140) continue;
    let ill = night ? 0.14 : 0.22;
    if (winVis > 0) ill += winVis * Math.max(0, 1 - Math.hypot((x - 50) / 46, (y - 128) / 28) * 0.78);
    if (lightOn) ill += 0.85 * Math.max(0, 1 - Math.hypot((x - 16) / 20, (y - 128) / 18));
    if (readLamp) ill += 0.8 * Math.max(0, 1 - Math.hypot((x - 76) / 18, (y - 140) / 14));
    const dark = (1 - Math.min(1, ill)) * (night ? 0.30 : 0.28);
    if (dark > 0.015) b.set(x, y, [14, 14, 28], dark);
  }

  // 3. Attic AO & light falloff (x = 1..77, y = roofTop(x)+3 .. 111)
  ao(4, 109, 6, 3, 0.18); ao(68, 109, 7, 3, 0.18);
  ao(1, 111, 77, 1, 0.14);
  ao(44, 107, 11, 1, 0.20); ao(44, 111, 11, 1, 0.18);
  ao(36, 111, 3, 1, 0.18); ao(15, 111, 15, 1, 0.18);

  const scrOn = !!w.office?.screen;
  for (let x = 1; x < 78; x++) {
    const y0 = Math.ceil(roofTop(x) + 3);
    for (let y = y0; y <= 111; y++) {
      if (x >= TANK.x0 && x <= TANK.x1 && y >= TANK.top && y < TANK.base) continue;
      if (scrOn && ((x >= 45 && x <= 47) || (x >= 50 && x <= 52)) && y >= 99 && y <= 101) continue;
      let ill = 0.18;
      if (w.isDay) ill += Math.max(0.2, 1 - w.cloud / 120) * Math.max(0, 1 - Math.hypot((x - 24) / 36, (y - 92) / 22) * 0.75);
      ill += 0.48 * Math.max(0, 1 - Math.hypot((x - 22) / 18, (y - 104) / 12));
      if (scrOn) ill += 0.65 * Math.max(0, 1 - Math.hypot((x - 48) / 18, (y - 100) / 12));
      const dark = (1 - Math.min(1, ill)) * 0.30;
      if (dark > 0.015) b.set(x, y, [12, 14, 26], dark);
    }
  }
}

// ── the whole frame ────────────────────────────────────────────────────────
export function render(ctx: CanvasRenderingContext2D, w: PWorld, t: number) {
  const b = new Buf();
  WIND = windAt(w, t);
  carry(t);
  const d: Design = { ...DESIGN0, ...(w.design || {}) } as Design;
  const u: Upkeep = { ...UPKEEP0, ...(w.upkeep || {}), weeds: { ...(w.upkeep?.weeds || {}) } } as Upkeep;
  const sea = w.season || 'summer', prog = w.seasonProgress ?? 0.5;
  const st = Math.max(0, Math.min(1, (w.hour - 6.8) / 10));
  const sunX = 60 + st * 220, sunY = 90 - Math.sin(st * Math.PI) * 36, sunVis = w.isDay ? Math.max(0, 1 - w.cloud / 110) : 0;
  const clouds = activeClouds(w);
  sky(b, w, t, clouds, sunX);
  const skyCopy = b.d.slice();
  const glass = new Uint8Array(W * H);
  const snowing = w.snow > 0, raining = w.rain > 0, frosty = w.temp < 0;
  const snowCover = snowing || u.snow_ground > 0.25;
  const night = !w.isDay;
  const sun = sunShadow(w, snowCover);
  // the field to the foothills, then the ground, by the season
  const grass: [RGB, RGB] = sea === 'spring' ? [[118, 170, 60], [92, 150, 30]] : sea === 'summer' ? [[101, 140, 54], [77, 124, 15]]
    : sea === 'autumn' ? [mix([101, 140, 54], [160, 140, 70], prog), mix([77, 124, 15], [130, 112, 50], prog)] : [[138, 128, 82], [118, 110, 70]];
  for (let y = 116; y < WH; y++) {
    const fDepth = Math.max(0, Math.min(1, (150 - y) / 34));
    for (let x = X0; x < X1; x++) {
      let c: RGB;
      if (snowCover) {
        const drift = Math.sin(x * 0.08 + y * 0.35) * 0.5 + 0.5;
        c = drift > 0.65 && dith(x, y, 0.55) ? [222, 232, 244] : dith(x, y, 0.3) ? [196, 212, 230] : [210, 224, 238];
      }
      else if (frosty) c = dith(x, y, 0.55) ? [196, 204, 196] : grass[1];
      else c = dith(x, y, 0.4) ? grass[0] : grass[1];
      if (!night && y < 156) {
        c = mix(c, snowCover ? [174, 196, 224] : [48, 76, 78], fDepth * 0.2);
        if (!snowCover) c = mix(c, [248, 234, 178], (1 - fDepth) * 0.06);
      }
      if (y >= 156) c = mix(c, [74, 54, 36], snowCover ? 0.15 : 0.45);
      if (night) c = mix(c, [24, 30, 52], 0.55);          // moonlight, not daylight
      b.set(x, y, c);
    }
  }
  // wind running through the field: lighter bands of bent grass moving across it
  if (!snowCover && Math.abs(WIND) > 12) {
    const band = 26;
    for (let y = 118; y < 150; y++) for (let x = X0; x < X1; x++) {
      const ph = (((x - DRIFT * 0.6 + y * 0.8) % band) + band) % band;
      if (ph < 3 + windyNow() * 4 && dith(x, y, 0.5)) b.set(x, y, night ? [60, 70, 90] : sea === 'winter' || sea === 'autumn' ? [196, 180, 120] : [150, 190, 90], 0.25 + windyNow() * 0.25);
    }
  }
  if (w.field && w.field.stage !== 'grass') field(b, w, w.field, night, t, snowCover);
  if (w.field?.scarecrow) scarecrow(b, w.field.scarecrow, night, t, sun);
  if (w.tree) hisTree(b, w.tree, w, night, t, sun);
  castSpan(b, 248, 252, 158, 12, sun, 0.85);
  if (sun.active) {
    const tipX = 250 + Math.round(sun.sx * 24);
    const xStart = Math.min(247, tipX), xEnd = Math.max(253, tipX);
    for (let x = xStart; x <= xEnd; x++) {
      const f = sun.sx >= 0 ? Math.max(0, (x - 250) / Math.max(1, tipX - 250)) : Math.max(0, (250 - x) / Math.max(1, 250 - tipX));
      const ry = Math.max(0.5, (1 - f) * 2.2);
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.abs(dy) > ry) continue;
        const yy = 157 + dy;
        if (f > 0.35 && !dith(x, yy, 0.72 - f * 0.4)) continue;
        b.set(x, yy, sun.col, sun.alpha * (1 - f * 0.55) * 0.85);
      }
    }
  }
  // a pine, about 3.5 m: 5 overlapping scalloped bough tiers with lit upper-left rim & dark undersides
  for (let j = 0; j < 44; j++) {
    const tier = Math.floor(j / 8), inTier = j % 8;
    const baseHalf = Math.floor(j / 3.8) + inTier * 0.45;
    const half = Math.max(1, Math.round(baseHalf - (j < 6 ? 0 : tier * 0.4)));
    const lean = Math.round((1 - j / 44) * (WIND / 25 + Math.sin(t * 2.2) * windyNow()));
    for (let i = -half; i <= half; i++) {
      if (Math.abs(i) === half && hash(j * 13 + i * 7) > 0.82) continue;
      const underBough = inTier >= 6;
      const lit = !underBough && i < 0 && inTier <= 2;
      const c: RGB = underBough ? [11, 38, 24] : lit ? [34, 118, 62] : dith(250 + i, 110 + j, 0.35) ? [21, 83, 45] : [16, 62, 36];
      b.set(250 + i + lean, 110 + j, nightc(c, night, 0.55));
    }
    if ((snowing || snowCover) && inTier <= 1 && j > 2) {
      for (let i = -half + 1; i <= half - 1; i++) if (hash(i + j) > 0.25) b.set(250 + i + lean, 110 + j, nightc([224, 234, 244], night, 0.5));
    }
  }
  b.rect(249, 154, 3, 4, nightc([87, 60, 36], night, 0.5));
  b.rect(251, 154, 1, 4, nightc([58, 38, 22], night, 0.5));
  b.rect(248, 158, 5, 1, [16, 22, 38], 0.24);
  if (d.feeder === 'yes') feeder(b, w, night, t, w.feederFill ?? 1);
  pond(b, w, d, t);
  if (d.bench === 'yes') benchByPond(b, night, sun);
  if (d.birdbath === 'yes') birdbath(b, w, sea, frosty, snowCover, night, t, sun);
  const doingNow = (x: PWorld['delamain'] | undefined | null) => (x && !x.walking ? x.doing : '');
  const busy = (what: string) => doingNow(w.delamain) === what;
  woodpile(b, w.wood ?? 0.6, night, busy('chop'), snowCover, sun);
  if (w.firepit || busy('campfire')) firepit(b, busy('campfire'), night, t, sun);
  path(b, d, u, night, t);
  if (u.snow_path > 0.1 || snowCover) for (const [x0, x1] of PATHS) for (let x = x0; x <= x1; x++) for (let y = 157; y < 160; y++)
    if (h2(x, y) < Math.max(u.snow_path, snowCover ? 0.6 : 0)) b.set(x, y, nightc([218, 228, 240], night, 0.45));
  if (sun.active) {
    if (sun.sx > 0.08) {
      const reach = Math.round(sun.sx * 22);
      for (let x = 82; x <= 82 + reach; x++) {
        const f = (x - 82) / Math.max(1, reach);
        const topY = Math.round(153 + f * 5);
        for (let y = topY; y < WH; y++) {
          if (f > 0.35 && !dith(x, y, 0.72 - f * 0.38)) continue;
          b.set(x, y, sun.col, sun.alpha * (1 - f * 0.55) * 0.85);
        }
      }
      const gReach = Math.round(sun.sx * 16);
      for (let x = 169; x <= 169 + gReach; x++) {
        const f = (x - 169) / Math.max(1, gReach);
        const topY = Math.round(152 + f * 6);
        for (let y = topY; y < WH; y++) {
          if (!dith(x, y, 0.55 - f * 0.28)) continue;
          b.set(x, y, sun.col, sun.alpha * (1 - f * 0.55) * 0.48);
        }
      }
    } else if (sun.sx < -0.08) {
      const gReach = Math.round(-sun.sx * 14);
      for (let x = 85 - gReach; x <= 85; x++) {
        const f = (85 - x) / Math.max(1, gReach);
        const topY = Math.round(152 + f * 6);
        for (let y = topY; y < WH; y++) {
          if (!dith(x, y, 0.55 - f * 0.28)) continue;
          b.set(x, y, sun.col, sun.alpha * (1 - f * 0.55) * 0.48);
        }
      }
    }
  }
  if (d.path_lights === 'solar') pathLights(b, night, false);
  if (d.mailbox === 'yes') mailbox(b, snowCover, night, sun);
  // a rain barrel by the greenhouse, and a lamp post on the path
  castSpan(b, 170, 175, 157, 9, sun);
  castSpan(b, 174, 174, 157, 28, sun, 0.65);
  for (let j = 0; j < 9; j++) for (let i = 0; i < 6; i++) b.set(170 + i, 148 + j, j === 2 || j === 6 ? [68, 64, 60] : i === 0 || i === 5 ? [96, 60, 28] : [139, 90, 43]);
  b.rect(170, 147, 6, 1, [61, 50, 40]);
  b.rect(258 - 84, 127, 1, 30, [55, 55, 60]); b.rect(257 - 84, 125, 3, 3, night ? [253, 230, 138] : [120, 120, 125]); b.rect(256 - 84, 124, 5, 1, [55, 55, 60]);
  signBoard(b, d, night, sun);
  farmBoard(b, d, night, t);
  // fence, about 1.1 m, in the colour he chose, worn where the paint has gone
  if (d.fence !== 'none') {
    for (let x = 178; x < 246; x += 8) castSpan(b, x, x + 1, 157, 15, sun, 0.72);
    if (sun.active) {
      const railShift = Math.round(sun.sx * 4);
      for (let x = 178; x < 246; x++) if (dith(x + railShift, 156, 0.45)) b.set(x + railShift, 156, sun.col, sun.alpha * 0.35);
    }
    const fc = FENCES[d.fence] || FENCES.weathered;
    const fcol = (x: number, y: number): RGB => nightc(h2(x, y) < u.fence_paint * 0.8 ? [120, 113, 108] : fc, night, 0.5);
    for (let x = 178; x < 246; x += 8) { for (let y = 143; y < 157; y++) { b.set(x, y, fcol(x, y)); b.set(x + 1, y, fcol(x + 1, y)); } b.set(x, 142, fcol(x, 142)); }
    for (let x = 178; x < 246; x++) { b.set(x, 146, fcol(x, 146)); b.set(x, 151, fcol(x, 151)); }
  }
  if (d.arch && d.arch !== 'none') {
    castSpan(b, 169, 169, 156, 22, sun, 0.7);
    castSpan(b, 178, 178, 156, 22, sun, 0.7);
    gardenArch(b, d, sea, prog, snowCover, night);
  }
  if (d.lights !== 'none') stringLights(b, d, w, t);
  // outdoor beds, 25 cm, with whatever weeds have come up in them
  for (let i = 8; i < 11; i++) {
    castSpan(b, SPOTS[i].x - 10, SPOTS[i].x + 9, SPOTS[i].y + 5, 6, sun, 0.78);
    bedLow(b, SPOTS[i].x, SPOTS[i].y, 20, w.spots[i]?.water, snowCover);
    weedsIn(b, SPOTS[i].x, SPOTS[i].y, 10, u.weeds[String(i)] || 0, night, t, sea);
  }
  if (d.gnome === 'yes') gnome(b, snowCover, night, sun);
  lawn(b, w, u, night, t);
  if (w.snowman) snowman(b, w.snowman.size, night, sun);
  if (busy('stars')) telescope(b, night, sun);
  // ── the greenhouse: 2.2 m walls, a 3.6 m ridge ──
  const gx0 = 86, gx1 = 168, eaveY = 125, peakY = 108, gcx = (gx0 + gx1) / 2;
  const roofAt = (x: number) => (x < gcx ? eaveY - (x - gx0) / (gcx - gx0) * (eaveY - peakY) : peakY + (x - gcx) / (gx1 - gcx) * (eaveY - peakY));
  for (let y = 153; y < WH; y++) for (let x = gx0 + 1; x < gx1; x++) b.set(x, y, dith(x, y, 0.45) ? [168, 162, 158] : [120, 113, 108]);
  for (let i = 5; i < 8; i++) {
    b.rect(SPOTS[i].x - 11, SPOTS[i].y + 9, 22, 1, [16, 22, 38], 0.24);
    bed(b, SPOTS[i].x, SPOTS[i].y, 22, w.spots[i]?.water, false);
    weedsIn(b, SPOTS[i].x, SPOTS[i].y, 11, u.weeds[String(i)] || 0, night, t, 'summer');
  }
  b.rect(159, 153, 8, 1, [16, 22, 38], 0.22);
  b.rect(158, 144, 10, 2, [139, 90, 43]); b.rect(159, 146, 1, 7, [96, 60, 28]); b.rect(166, 146, 1, 7, [96, 60, 28]);   // bench
  // ── the house: a 3 m room under a pitched roof, his study built on to the left ──
  const hx1 = 78, ceil = 112, floor = 150;
  const [wc, wd] = WALLS[d.house_wall] || WALLS.timber;
  for (let y = ceil; y < floor; y++) for (let x = 0; x < hx1; x++) {
    if (x >= 34 && x < 67 && y >= 118 && y < 135) continue;          // the window onto the real sky
    const worn = h2(x, y) < u.house_paint * 0.35;
    b.set(x, y, nightc(worn ? [150, 120, 90] : wallPixel(x, y, d.house_wall, wc, wd, ceil), night, 0.5));
  }
  // the window, grimy if nobody cleans it
  if (u.windows > 0.1) for (let y = 118; y < 135; y++) for (let x = 34; x < 67; x++) if (dith(x, y, 0.3 + u.windows * 0.5)) b.set(x, y, [130, 112, 80], u.windows * 0.4);
  const [rr, rd, re] = ROOFS[d.roof] || ROOFS.terracotta;
  for (let x = -6; x <= hx1 + 6; x++) {                                // the roof, cut away over the attic
    const top = roofTop(x);
    const inside = x > 0 && x < hx1;
    for (let y = Math.floor(top); y < ceil; y++) {
      if (inside && y >= top + 3) { b.set(x, y, nightc((y % 5 === 0) ? [58, 42, 32] : [78, 58, 44], night, 0.5)); continue; }   // the attic's boards
      b.set(x, y, roofPixel(x, y, d.roof, rr, rd, re));
    }
    if (x >= 21 && x <= 26) for (let y = Math.floor(top); y < top + 3; y++) b.set(x, y, night ? [40, 50, 80] : [170, 210, 240]);   // a skylight
    b.set(x, Math.floor(top), re);
    if (snowCover) { b.set(x, Math.floor(top) - 1, [240, 244, 250]); b.set(x, Math.floor(top), [218, 228, 240]); }
    if (u.leaves > 0.4 && h2(x, 3) < u.leaves * 0.3) b.set(x, Math.floor(top) - 1, [180, 96, 40]);
  }
  leanTo(b, d, snowCover);
  study(b, w, d, u, night, t);
  stove(b, !!w.stoveLit, night, busy('cook'), t);
  exteriorWall(b, -48, -45, 119, 160, d, u, night);
  exteriorWall(b, hx1, hx1 + 3, ceil, 160, d, u, night);
  porchProps(b, d, sea, night, t, false);
  {
    const near = (f: PWorld['delamain'] | undefined | null) => !!f && !f.lying && Math.abs(f.x - DOOR.x) < 7 && f.y > 140;
    frontDoor(b, d, night, near(w.delamain) || near(w.guest) || near(w.guest2) ? 1 : 0);
  }
  porchProps(b, d, sea, night, t, true);
  attic(b, w, d, night, t);
  aquarium(b, w.aquarium || { fish: [], clean: 1 }, night, t);            // the tank is always there; empty until he keeps a fish
  chimney(b, d, night);
  if (sun.active) {
    const cr = Math.round(sun.sx * 5);
    for (let y = 89; y < 98; y++) for (let i = 1; i <= Math.abs(cr); i++) {
      const cx = (cr >= 0 ? 64 : 57) + (cr >= 0 ? i : -i);
      if (y >= roofTop(cx) && y < ceil && dith(cx, y, 0.65)) b.set(cx, y, sun.col, sun.alpha * 0.6);
    }
  }
  for (let x = -6; x <= 0; x++) b.set(x, Math.floor(roofTop(x)) + 2, [16, 22, 38], 0.24);
  for (let x = hx1; x <= hx1 + 6; x++) b.set(x, Math.floor(roofTop(x)) + 2, [16, 22, 38], 0.24);
  b.rect(-48, 159, 4, 1, [16, 22, 38], 0.26);
  b.rect(hx1, 159, 4, 1, [16, 22, 38], 0.26);
  b.rect(76, 159, 7, 1, [16, 22, 38], 0.22);
  weathervane(b, d, night, t);
  if (w.stoveLit ?? true) for (let k = 0; k < 8; k++) {                         // and its smoke, drifting (when the stove burns)
    const age = ((t * 0.18 + k / 8) % 1), r = 1 + age * 3.2;
    const px = 61 + age * (4 + WIND * 0.9) + Math.sin(t * 0.9 + k * 2) * 1.5, py = 81 - age * 30 * (1 - windyNow() * 0.7);
    for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r) b.set(px + xx, py + yy, night ? [70, 75, 90] : [226, 232, 240], (1 - age) * 0.32);
  }
  b.rect(0, ceil, hx1, 2, [74, 50, 34]);                                          // ceiling beam
  // the window frames: painted cream, as the house came, until he chooses a trim of his own (red is the old default)
  const [tc, td]: [RGB, RGB] = d.trim && d.trim !== 'red' ? (TRIMS[d.trim] || TRIMS.red) : [[231, 229, 228], [214, 211, 209]];
  const fc = nightc(tc, night, 0.42), fd = nightc(td, night, 0.42);
  for (let x = 33; x < 68; x++) b.set(x, 117, fc);
  for (let y = 117; y < 136; y++) { b.set(33, y, fc); b.set(67, y, fd); b.set(50, y, fc); }
  for (let x = 33; x < 68; x++) b.set(x, 126, fc);
  shutters(b, d, night);
  drawCurtains(b, d, night);
  b.rect(28, 115, 45, 1, nightc([87, 60, 36], night, 0.4));
  b.rect(31, 138, 39, 2, [214, 211, 209]); b.rect(31, 140, 39, 1, [160, 156, 152]);   // the sill, 95 cm
  windowBox(b, d, sea, snowCover, night);
  wallPiece(b, d, w, night, t);
  if (u.dust > 0.7) for (let k = 0; k < 6; k++) b.line(hx1 - 1, ceil + 2 + k, hx1 - 7 + k, ceil + 2, [220, 220, 220], 0.3);
  // the grow-light table, 90 cm, with the lamp hanging from the ceiling
  const lightOn = w.growLight && w.hour >= 6 && w.hour < 20;
  b.rect(3, 140, 27, 2, [139, 90, 43]); b.rect(3, 142, 27, 1, [96, 60, 28]);
  b.rect(4, 143, 2, 7, [96, 60, 28]); b.rect(27, 143, 2, 7, [96, 60, 28]);
  b.rect(8, 114, 1, 8, [68, 64, 60]); b.rect(24, 114, 1, 8, [68, 64, 60]);
  b.rect(5, 122, 23, 2, lightOn ? [245, 208, 254] : [87, 83, 78]); b.rect(5, 121, 23, 1, [68, 64, 60]);
  // the floor and the rug he chose
  drawFloor(b, 0, hx1 - 1, floor, d.floor, night);
  const [ra, rb, rc] = RUGS[d.rug] || RUGS.rust;
  // the rug, lying on the floor in perspective: narrower at the back, a border, a pattern, fringe at the ends
  const RUG_Y0 = 151, RUG_Y1 = 158;
  for (let y = RUG_Y0; y <= RUG_Y1; y++) {
    const f = (y - RUG_Y0) / (RUG_Y1 - RUG_Y0), xl = Math.round(41 - f * 4), xr = Math.round(73 + f * 3);
    for (let x = xl; x <= xr; x++) {
      const border = y === RUG_Y0 || y === RUG_Y1 || x === xl || x === xr, inner = y === RUG_Y0 + 1 || y === RUG_Y1 - 1 || x === xl + 1 || x === xr - 1;
      const u = (x - xl) / (xr - xl), v = f;
      let col: RGB;
      if (d.rug === 'striped') col = border ? rc : Math.floor(u * 9) % 3 === 0 ? ra : Math.floor(u * 9) % 3 === 1 ? rb : rc;
      else {
        const dm = Math.abs(u - 0.5) * 2 + Math.abs(v - 0.5) * 2;                      // a medallion in the middle
        col = border ? rc : inner ? rb : dm < 0.55 ? (dm < 0.25 ? rc : rb) : ((x + y) % 4 === 0 ? mix(ra, rb, 0.4) : ra);
      }
      b.set(x, y, nightc(col, night, 0.35));
    }
    if (y === RUG_Y1) for (let x = xl; x <= xr; x += 2) b.set(x, y + 1, nightc(mix(rc, [240, 230, 210], 0.5), night, 0.35));   // fringe
  }
  for (let x = 41; x <= 73; x += 2) b.set(x, RUG_Y0 - 1, nightc(mix(rc, [240, 230, 210], 0.5), night, 0.35));
  bedroom(b, night, BLANKETS[d.blanket] || BLANKETS.teal, d.blanket === 'patchwork');
  houseplant(b, d, night);
  ladder(b, night);
  armchair(b, w, night, !!w.delamain && ['read', 'news'].includes(w.delamain.doing));
  // pots and plants
  for (let i = 0; i < 5; i++) pot(b, SPOTS[i].x, SPOTS[i].y, w.spots[i]?.water);
  w.spots.forEach((s, i) => { if (SPOTS[i]) plant(b, s, SPOTS[i].x, SPOTS[i].y - 1, SPOTS[i].pot ? 0.6 : 0.9, t, s.place === 'outdoors'); });
  if (d.window_box && d.window_box !== 'none') b.rect(34, 141, 33, 1, [16, 22, 38], 0.22);
  indoorShade(b, w, d, night, !!w.delamain && ['read', 'news'].includes(w.delamain.doing), lightOn);
  if (lightOn) for (let y = 124; y < 141; y++) {
    const f = (y - 124) / 17, half = 12 + f * 4;
    for (let x = Math.round(16 - half); x <= Math.round(16 + half); x++) {
      const edge = 1 - Math.abs(x - 16) / half;
      if (dith(x, y, 0.35 + 0.5 * edge * (1 - f))) b.set(x, y, [240, 171, 252], 0.16 * (1 - f * 0.5));
    }
  }
  // greenhouse frame and glass, in front of what grows inside (grimy glass lets less through)
  const gh = GH_FRAMES[d.greenhouse_frame] || GH_FRAMES.white;
  for (let y = peakY; y < 153; y++) for (let x = gx0; x <= gx1; x++) {
    const top = roofAt(x);
    if (y < top) continue;
    const post = x === gx0 || x === gx1 || (x - gx0) % 20 === 0;
    const edge = Math.abs(y - top) < 1;
    if (post || edge || y === eaveY || y === 140)
      b.set(x, y, night ? gh.night : edge ? gh.edge : gh.body, post || edge ? 0.95 : 0.78);
    else {
      b.set(x, y, [186, 230, 253], 0.1);
      if (u.windows > 0.15 && dith(x, y, 0.4 + u.windows * 0.4)) b.set(x, y, [150, 140, 110], u.windows * 0.3);
      const gy = y - YOFF; if (gy >= 0 && gy < H && u.windows < 0.7) glass[gy * W + x + XOFF] = 1;
      if ((x + y) % 19 === 0 || (x + y + 1) % 19 === 0) b.set(x, y, [224, 242, 254], 0.16);
    }
  }
  if (snowCover) for (let x = gx0; x <= gx1; x++) { const top = roofAt(x); b.set(x, top - 1, [222, 232, 244]); b.set(x, top - 2, [196, 212, 230], 0.7); }
  if (u.leaves > 0.3) for (let x = gx0; x <= gx1; x++) if (h2(x, 8) < u.leaves * 0.35) b.set(x, roofAt(x), [176, 96, 40]);
  b.rect(gcx, peakY + 1, 1, 6, [87, 83, 78]); b.rect(gcx - 1, peakY + 7, 3, 2, night ? [253, 230, 138] : [168, 162, 158]);
  leaves(b, w, u, night, t);
  // drifting cloud shadows (computed on a half-resolution grid) across the field, yard, trees, and roofs
  const cloudStr = cloudShadowStrength(w);
  const overcastDull = w.isDay && w.cloud > 70 ? ((w.cloud - 70) / 30) * (snowCover ? 0.10 : 0.14) : 0;
  if (cloudStr > 0.005 || overcastDull > 0.005) {
    const gndCloud = cloudStr > 0.005 ? cloudGrid(clouds, sunX, 80, 159, false) : null;
    const shCol: RGB = snowCover ? [88, 122, 174] : [22, 34, 62];
    const ovCol: RGB = snowCover ? [164, 184, 214] : [128, 142, 162];
    const buf = b.d;
    for (let y = 80; y < WH; y++) {
      const cy = y - YOFF;
      for (let x = X0; x < X1; x++) {
        if (x >= -44 && x <= -1 && y >= 121 && y < 154) continue;
        if (x >= 0 && x < 78 && y >= 112 && y < 154) continue;
        if (x > 0 && x < 78 && y >= roofTop(x) + 3 && y < 112) continue;
        if (x >= 87 && x <= 167 && y >= roofAt(x) + 1 && y < 153) continue;
        const q = (cy * W + x + XOFF) * 4;
        if (buf[q] === skyCopy[q] && buf[q + 1] === skyCopy[q + 1] && buf[q + 2] === skyCopy[q + 2]) continue;
        if (overcastDull > 0.005) {
          buf[q] += (ovCol[0] - buf[q]) * overcastDull;
          buf[q + 1] += (ovCol[1] - buf[q + 1]) * overcastDull;
          buf[q + 2] += (ovCol[2] - buf[q + 2]) * overcastDull;
        }
        if (gndCloud) {
          const a = sampleCloudGrid(gndCloud, x, y) * cloudStr;
          if (a > 0.008) {
            buf[q] += (shCol[0] - buf[q]) * a;
            buf[q + 1] += (shCol[1] - buf[q + 1]) * a;
            buf[q + 2] += (shCol[2] - buf[q + 2]) * a;
          }
        }
      }
    }
  }
  // light through the house window: shafts onto the floor, with dust turning in them
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
    const studyLit = d.lamp === 'on' || !!w.stoveLit;
    const houseAwake = w.delamain?.doing !== 'sleep';
    const atticLit = !!w.office?.screen || !!(w.aquarium && w.aquarium.fish.length) || busy('type') || busy('tank') || d.attic_lights === 'fairy lights';
    for (let y = YOFF; y < WH; y++) {
      const aboveEave = y < 108;
      for (let x = X0; x < X1; x++) {
        if (aboveEave && !(x < 84 && y >= roofTop(x))) continue;
        if (x >= 34 && x < 67 && y >= 118 && y < 135) { b.set(x, y, [8, 14, 38], 0.42); continue; }
        if (x >= -44 && x <= -1 && y >= 121 && y < 154) {
          b.set(x, y, studyLit ? [22, 16, 28] : [10, 14, 34], studyLit ? 0.18 : 0.44);
        } else if (x >= 0 && x < 78 && y >= 112 && y < 154) {
          b.set(x, y, houseAwake ? [22, 16, 28] : [14, 16, 36], houseAwake ? 0.18 : 0.34);
        } else if (x > 0 && x < 78 && y >= roofTop(x) + 3 && y < 112) {
          b.set(x, y, atticLit ? [14, 18, 38] : [8, 14, 38], atticLit ? 0.24 : 0.46);
        } else if (x >= 87 && x <= 167 && y >= roofAt(x) + 1 && y < 153) {
          b.set(x, y, [12, 18, 36], 0.30);
        } else {
          b.set(x, y, [8, 14, 38], 0.46);
        }
      }
    }
    // warm indoor & hearth bounce pools against the cool sapphire night
    b.glow(gcx, peakY + 9, 22, [253, 224, 138], 0.34);
    cone(b, gcx, peakY + 9, 153, 24, [253, 224, 138], 0.18);
    b.glow(126, 148, 22, [251, 191, 110], 0.14);
    if (houseAwake) {
      b.glow(58, 144, 28, [251, 191, 100], 0.26);
      b.glow(22, 144, 22, [251, 185, 96], 0.16);
    } else {
      b.glow(48, 140, 22, [251, 191, 36], 0.08);
    }
    if (w.delamain && ['read', 'news', 'guitar'].includes(w.delamain.doing)) b.glow(72, 141, 18, [253, 220, 130], 0.26);
    if (d.lamp === 'on') { b.glow(-36, 139, 22, [253, 214, 124], 0.34); cone(b, -37, 136, 150, 11, [253, 220, 130], 0.16); }
    if (lightOn) b.glow(16, 130, 18, [232, 121, 249], 0.24);
    if (d.attic_lights === 'fairy lights') for (let x = 8; x <= 70; x += 4) {
      const ly = Math.round(roofTop(x) + 3 + Math.sin((mod(x - 8, 12) / 12) * Math.PI) * 1.4) + 1;
      const tw = 0.55 + 0.45 * Math.sin(t * 2.6 + x * 0.9);
      b.set(x, ly, [254, 240, 168], tw);
      b.glow(x, ly, 4, [253, 224, 138], 0.22 * tw);
    }
    if (d.porch_light === 'lantern') {
      b.rect(83, 126, 1, 2, [254, 240, 168]);
      b.glow(83, 127, 14, [253, 210, 120], 0.34);
      cone(b, 83, 128, 157, 7, [253, 210, 120], 0.14);
    }
    if (d.path_lights === 'solar') pathLights(b, night, true);
    if (busy('campfire')) {
      b.glow(FIRE_AT.x, FIRE_AT.y - 2, 32, [251, 146, 60], 0.45);
      b.glow(FIRE_AT.x, FIRE_AT.y - 3, 14, [253, 224, 71], 0.24);
    }
    if (w.stoveLit) b.glow(-24, 146, 14, [251, 146, 60], 0.36);
    b.glow(174, 126, 18, [253, 224, 138], 0.36);
    cone(b, 174, 128, 157, 15, [253, 224, 138], 0.15);
    b.glow(174, 155, 10, [253, 210, 120], 0.15);
    if (d.lights !== 'none') stringLights(b, d, w, t);               // the bulbs shine through the dark
    if (w.temp > 14) for (let k = 0; k < 9; k++) {                     // fireflies, on a warm night
      const fx = 180 + hash(k) * 70 + Math.sin(t * 0.7 + k * 3) * 4, fy = 130 + hash(k + 4) * 22 + Math.cos(t * 0.5 + k) * 3;
      const on = Math.sin(t * 1.7 + k * 2.3);
      if (on > 0.2) { b.set(fx, fy, [254, 240, 138], on); b.glow(fx, fy, 3, [254, 240, 138], 0.25 * on); }
    }
    if (w.temp > 8 && !raining && !snowing && Math.abs(WIND) < 25) {  // moths fluttering at the path lamp & lantern
      for (let k = 0; k < 3; k++) {
        const lx = k < 2 ? 174 : gcx, ly = k < 2 ? 126 : peakY + 8;
        const mx = Math.round(lx + Math.cos(t * (2.6 + k * 0.7) + k * 2.1) * (3 + (k % 2)));
        const my = Math.round(ly + Math.sin(t * (3.3 + k * 0.9) + k * 1.4) * 2.5);
        b.set(mx, my, [242, 232, 208], 0.85);
      }
    }
  } else if (w.hour < 8 || w.hour > 16) {
    for (let y = 108; y < WH; y++) for (let x = X0; x < X1; x++) b.set(x, y, [251, 146, 60], 0.06);
  }
  if (w.isDay && !raining && !snowing && w.temp > 10 && Math.abs(WIND) < 28 && (sea === 'spring' || sea === 'summer' || (sea === 'autumn' && prog < 0.6))) {
    const bCols: RGB[] = [[250, 250, 244], [251, 146, 60], [125, 211, 252]];
    for (let k = 0; k < 3; k++) {                                      // butterflies near the outdoor beds
      const bx = Math.round(192 + k * 21 + Math.sin(t * (0.9 + k * 0.25) + k * 2.3) * 9);
      const by = Math.round(142 + Math.sin(t * (1.7 + k * 0.4) + k * 1.1) * 5);
      const bc = bCols[k];
      if (Math.floor(t * 8 + k * 3) % 2 === 0) { b.set(bx - 1, by, bc); b.set(bx + 1, by, bc); b.set(bx, by, [40, 30, 20]); }
      else { b.set(bx, by, bc); b.set(bx, by - 1, mix(bc, [255, 255, 255], 0.3)); }
    }
    if ((sea === 'spring' || sea === 'summer') && w.temp > 12 && Math.abs(WIND) < 24) {
      for (let k = 0; k < 2; k++) {                                    // bees buzzing by the blooms
        const bx = Math.round(198 + k * 32 + Math.cos(t * 2.1 + k * 4) * 7);
        const by = Math.round(145 + Math.sin(t * 3.4 + k * 2) * 3);
        b.set(bx, by, [250, 204, 21]);
        if (Math.floor(t * 14 + k) % 2 === 0) b.set(bx, by - 1, [230, 245, 255], 0.7);
      }
    }
  }
  if (sea === 'summer' && w.isDay && !raining && !snowing && w.pond.ice < 0.3 && w.pond.waterT > 14 && Math.abs(WIND) < 26) {
    const dart = Math.sin(t * 0.9) + Math.sin(t * 1.8) * 0.35;         // summer dragonfly skimming the pond
    const dx = Math.round(295 + dart * 14), dy = Math.round(145 + Math.sin(t * 2.7) * 2);
    const dDir = Math.cos(t * 0.9) >= 0 ? 1 : -1;
    b.set(dx, dy, [56, 189, 248]); b.set(dx - dDir, dy, [20, 184, 166]);
    if (Math.floor(t * 16) % 2 === 0) b.set(dx, dy - 1, [224, 242, 254], 0.75);
  }
  if (w.twin) figure(b, w.twin, t, delamainSpec(t, true), snowCover, sun);
  if (w.guest) guest(b, w.guest, t, snowCover, sun);
  if (w.guest2) guest(b, w.guest2, t, snowCover, sun);
  if (w.delamain?.lying) sleeper(b, t, w.delamain.doing === 'sleep', BLANKETS[d.blanket] || BLANKETS.teal, d.blanket === 'patchwork');
  else if (w.delamain) delamain(b, w.delamain, t, snowCover, sun, w.outfit);
  if (raining || snowing) {
    const n = snowing ? 80 : 56 + Math.min(90, w.rain * 40);
    for (let k = 0; k < n; k++) {
      const x0 = hash(k) * (W + 40), sp = snowing ? 9 + hash(k + 5) * 6 : 120 + hash(k + 5) * 40;
      const y = YOFF + ((hash(k + 9) * H + t * sp) % (H + 10)) - 5;
      const x = X0 + ((((x0 + (snowing ? Math.sin(t + k) * 3 + DRIFT * 0.35 : -y * 0.05 + y * WIND / 40)) % W) + W) % W);
      if (x > -50 && x < 82 && y > 90) continue;                    // not through the house
      if (snowing) b.set(x, y, [255, 255, 255], 0.9);
      else { const sl = Math.max(-1.5, Math.min(1.5, WIND / 30)); b.set(x, y, [147, 197, 253], 0.55); b.set(x - sl * 0.5, y + 1, [147, 197, 253], 0.45); b.set(x - sl, y + 2, [147, 197, 253], 0.3); }
    }
  }
  if (Math.abs(WIND) > 35 && !raining) {         // a hard wind carries grit and bits of leaf across the yard
    const n = Math.floor((Math.abs(WIND) - 35) / 2);
    for (let k = 0; k < n; k++) {
      const x = X0 + ((((hash(k) * W + DRIFT * 3) % W) + W) % W), y = 130 + hash(k + 3) * 28 + Math.sin(t * 3 + k) * 2;
      const c: RGB = snowCover ? [226, 234, 244] : k % 3 ? [170, 150, 110] : [160, 100, 50];
      b.set(x, y, c, 0.7); b.set(x - Math.sign(WIND), y, c, 0.35);
    }
  }
  post(b.d, skyCopy, glass, w, sunX, sunY - YOFF, sunVis);
  ctx.putImageData(new ImageData(b.d, W, H), 0, 0);
}
