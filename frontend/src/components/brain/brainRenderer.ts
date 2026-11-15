// Delamain's brain: a 3D point-cloud brain drawn on a canvas. Nothing is connected by
// lines; every signal is a glowing particle with a comet tail that hops neuron to neuron
// along a real path through the brain, lighting each neuron as it passes.
//
// The renderer is driven by the backend's brain events (brain.py): heard, reflex,
// think_start/think_end, tool_start/tool_end, correction, navigate, voice_start/voice_end,
// spoke, core, clients, error. See BrainView.tsx for the page around it.

export type BrainEvent = { kind: string; t?: number; [k: string]: unknown };

/** What he is saying right now and the playback clock behind it (the page's audio element). */
export type SpeechClock = { id: number; text: string; speechAt: number; time: () => number; duration: () => number };

export type RegionKey =
  | 'hearing' | 'core' | 'senses' | 'navigation' | 'plans' | 'imagination'
  | 'memory' | 'voice' | 'reflex' | 'conscience' | 'stem';

type RGB = [number, number, number];

export const REGION_INFO: Record<Exclude<RegionKey, 'stem'>, { code: string; label: string; sub: string; color: string; tip: string }> = {
  hearing:     { code: 'AUDIO INTAKE',   label: 'Hearing',     sub: 'your words in',          color: '#fcd34d', tip: 'Hearing: your words arrive here, transcribed from the microphone.' },
  core:        { code: 'COGNITION CORE', label: 'Core',        sub: 'the model thinking',     color: '#00f0ff', tip: 'Core: the language model thinking. It takes the colour of the active personality core.' },
  senses:      { code: 'OPTIC ARRAY',    label: 'Senses',      sub: 'search · news · weather', color: '#38bdf8', tip: 'Senses: looking at the world: web search, web pages, news and weather.' },
  navigation:  { code: 'NAV-GRID',       label: 'Navigation',  sub: 'routes · places',        color: '#4ade80', tip: 'Navigation: driving routes and finding the places you ask to go.' },
  plans:       { code: 'SCHEDULER',      label: 'Plans',       sub: 'reminders · timers',     color: '#f472b6', tip: 'Plans: reminders and timers he will speak when they are due.' },
  imagination: { code: 'SIM ENGINE',     label: 'Imagination', sub: 'adventures',             color: '#c084fc', tip: 'Imagination: Dungeon Master mode, the adventures and their chronicles.' },
  memory:      { code: 'MEMORY BANKS',   label: 'Memory',      sub: 'facts · notes',          color: '#2dd4bf', tip: 'Memory: what he remembers about you, and your notes in the Obsidian vault.' },
  voice:       { code: 'VOCODER',        label: 'Voice',       sub: 'speech out',             color: '#a5f3fc', tip: 'Voice: synthesizing his spoken reply. His words leave from here.' },
  reflex:      { code: 'REFLEX ARC',     label: 'Reflexes',    sub: 'instant replies',        color: '#fb923c', tip: 'Reflexes: instant pre-recorded replies ("thanks", "how are you") that skip the language model.' },
  conscience:  { code: 'ETHICS DAEMON',  label: 'Conscience',  sub: 'self-check',             color: '#f87171', tip: 'Conscience: flashes when he catches himself promising something he has not done, and goes back to do it.' },
};

const hex = (h: string): RGB => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// Label / tooltip / goal points, in brain space (x back→front, y up, z toward the viewer).
const ANCHORS: Record<Exclude<RegionKey, 'stem'>, [number, number, number]> = {
  hearing:     [0.05, -0.08, 0.62],
  core:        [0.5, 0.36, 0.45],
  senses:      [-0.82, 0.1, 0.42],
  navigation:  [-0.32, 0.28, 0.55],
  plans:       [0.1, 0.62, 0.3],
  imagination: [-0.42, 0.55, 0.3],
  memory:      [0.12, -0.34, 0.55],
  voice:       [0.78, -0.08, 0.42],
  reflex:      [-0.64, -0.56, 0.42],
  conscience:  [0.05, 0.2, 0.1],
};
const LABEL_DY: Partial<Record<RegionKey, number>> = { memory: -0.16, reflex: -0.17, conscience: 0.0, hearing: 0.06 };
const MOUTH: [number, number, number] = [0.84, -0.1, 0.42];
const EAR: [number, number, number] = [0.02, -0.08, 0.66];

type Neuron = {
  x: number; y: number; z: number; region: RegionKey; size: number; ph: number;
  energy: number; lit: RGB | null; nb: number[]; shell: boolean;
};
type Signal = {
  pts: number[][]; cum: number[]; len: number; s: number; speed: number; c0: RGB; c1: RGB | null;
  tail: number; w: number; alpha: number; hops: number[]; hopS: number[]; hopAt: number;
  onEnd?: () => void; ended?: boolean;
};
type Spark = { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; decay: number; col: RGB };
type Glyph = { w: string; x: number; y: number; z: number; vx: number; vy: number; life: number; ph: number; col: RGB; inbound: boolean; tx?: number; ty?: number; tz?: number };
type Flare = { text: string; x: number; y: number; z: number; life: number; col: RGB };

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type BrainOptions = { reducedMotion?: boolean; onRegionTap?: (r: RegionKey) => void };

export function createBrain(canvas: HTMLCanvasElement, stage: HTMLElement, opts: BrainOptions = {}) {
  const ctx = canvas.getContext('2d')!;
  let width = 800, height = 420, dpr = 1, raf = 0, last = 0, clock = 0;
  const reduced = () => !!opts.reducedMotion;

  /* ── colours & sprites ─────────────────────────────────────────────── */
  const COL: Record<string, RGB> = {
    stem: [96, 125, 190], white: [236, 246, 255], red: [251, 113, 133], grey: [100, 116, 139], idle: [92, 140, 225],
  };
  for (const [k, v] of Object.entries(REGION_INFO)) COL[k] = hex(v.color);

  const glowCache = new Map<string, HTMLCanvasElement>();
  const dotCache = new Map<string, HTMLCanvasElement>();
  const sprite = (rgb: RGB, dot = false) => {
    const key = rgb.map(Math.round).join(',');
    const cache = dot ? dotCache : glowCache;
    let c = cache.get(key);
    if (!c) {
      const s = dot ? 16 : 64;
      c = document.createElement('canvas');
      c.width = c.height = s;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      const [r, gg, b] = rgb.map(Math.round);
      if (dot) {
        grad.addColorStop(0, `rgba(${r},${gg},${b},1)`);
        grad.addColorStop(0.45, `rgba(${r},${gg},${b},0.55)`);
      } else {
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.12, `rgba(${r},${gg},${b},0.95)`);
        grad.addColorStop(0.35, `rgba(${r},${gg},${b},0.35)`);
      }
      grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
      cache.set(key, c);
    }
    return c;
  };
  const colorOf = (r: RegionKey): RGB => COL[r];

  /* ── geometry ──────────────────────────────────────────────────────── */
  const sylv = (x: number) => -0.14 + 0.22 * (0.7 - x);
  const gyri = (x: number, y: number, z: number) =>
    Math.sin(7.3 * x + 3 * Math.sin(5.1 * y)) * Math.sin(7.7 * y + 3 * Math.sin(6.3 * z)) * Math.sin(6.1 * z + 2.5 * Math.sin(7.9 * x));
  const cerebrumE = (x: number, y: number, z: number) => ((x - 0.02) / 1.0) ** 2 + ((y - 0.08 - 0.06 * x) / 0.68) ** 2 + (z / 0.74) ** 2;
  const temporalE = (x: number, y: number, z: number) => ((x - 0.18) / 0.56) ** 2 + ((y + 0.3) / 0.22) ** 2 + (z / 0.64) ** 2;
  const cerebellumE = (x: number, y: number, z: number) => ((x + 0.62) / 0.34) ** 2 + ((y + 0.5) / 0.21) ** 2 + (z / 0.56) ** 2;

  function classify(x: number, y: number): RegionKey {
    if (y < sylv(x) && x > -0.35) {
      if (x > 0.55) return 'voice';
      return y > sylv(x) - 0.13 ? 'hearing' : 'memory';     // superior temporal gyrus hears
    }
    if (x > 0.42 && y < 0.12) return 'voice';                 // Broca, front-low
    if (x > -0.12 && x < 0.32 && y > 0.48) return 'plans';    // premotor strip on top
    if (x > -0.12) return 'core';                              // frontal lobe
    if (x < -0.6) return 'senses';                             // occipital
    if (y > 0.4) return 'imagination';                         // precuneus, top-back
    return 'navigation';                                       // parietal
  }

  let neurons: Neuron[] = [];
  let byRegion: Partial<Record<RegionKey, number[]>> = {};

  function build() {
    const rand = rng(8888);
    const target = clamp(Math.round((width * height) / 260), 650, 2100);
    neurons = [];
    const add = (x: number, y: number, z: number, region: RegionKey, shell: boolean, size?: number) =>
      neurons.push({ x, y, z, region, shell, size: size ?? 0.4 + rand() * 0.8, ph: rand() * TAU, energy: 0, lit: null, nb: [] });

    let tries = 0;
    const cerebrumTarget = Math.round(target * 0.76);
    while (neurons.length < cerebrumTarget && tries++ < 200000) {
      const x = rand() * 2.1 - 1.05, y = rand() * 1.4 - 0.62, z = rand() * 1.6 - 0.8;
      const e = cerebrumE(x, y, z), t = temporalE(x, y, z);
      const inCer = e < 1 && y > -0.3, inTemp = t < 1;
      if (!inCer && !inTemp) continue;
      if (Math.abs(z) < 0.035 && y > -0.1) continue;                       // longitudinal fissure
      const shell = (inCer ? e : t) > 0.7;
      if (!shell && rand() > 0.07) continue;
      if (shell && gyri(x, y, z) > 0.32) continue;                          // sulci
      if (shell && x > -0.3 && x < 0.75 && Math.abs(y - sylv(x)) < 0.028) continue;
      add(x, y, z, classify(x, y), shell);
    }
    tries = 0;
    const cb = neurons.length + Math.round(target * 0.12);
    while (neurons.length < cb && tries++ < 60000) {                       // cerebellum: reflexes
      const x = -0.62 + (rand() * 2 - 1) * 0.34, y = -0.5 + (rand() * 2 - 1) * 0.21, z = (rand() * 2 - 1) * 0.56;
      const e = cerebellumE(x, y, z);
      if (e >= 1 || (e < 0.55 && rand() > 0.2) || Math.sin((y + 0.5) * 75 + x * 9) > 0.55) continue;
      add(x, y, z, 'reflex', e > 0.55);
    }
    for (let i = 0, n = Math.round(target * 0.05); i < n; i++) {           // brain stem
      const t = rand(), a = rand() * TAU, r = (0.11 - t * 0.03) * (0.75 + rand() * 0.25);
      add(-0.24 - t * 0.12 + Math.cos(a) * r * 0.6, -0.36 - t * 0.6, Math.sin(a) * r, 'stem', true);
    }
    for (let i = 0, n = Math.round(target * 0.05); i < n; i++) {           // cingulate band: conscience
      const t = rand(), g = () => (rand() + rand() - 1) * 0.03;
      const x = -0.45 + t * 1.0, y = 0.12 + Math.sin(t * Math.PI) * 0.16;
      add(x + g(), y + g(), (rand() < 0.5 ? -1 : 1) * (0.06 + rand() * 0.05), 'conscience', true, 0.7 + rand() * 0.6);
    }
    for (let i = 0, n = Math.round(target * 0.05); i < n; i++) {           // hippocampus curl: memory
      const t = rand(), g = () => (rand() + rand() + rand() - 1.5) * 0.03;
      add(-0.45 + 0.6 * t + g(), -0.2 - 0.1 * Math.sin(Math.PI * t) + g(), 0.3 + 0.04 * Math.sin(t * 5) + g(), 'memory', true, 0.7 + rand() * 0.7);
    }

    byRegion = {};
    neurons.forEach((n, i) => (byRegion[n.region] ||= []).push(i));
    // k nearest neighbours: the hidden wiring signals hop along
    const CELL = 0.12, grid = new Map<number, number[]>();
    const key = (i: number, j: number, k: number) => (i + 64) * 16384 + (j + 64) * 128 + (k + 64);
    neurons.forEach((n, i) => {
      const k = key(Math.floor(n.x / CELL), Math.floor(n.y / CELL), Math.floor(n.z / CELL));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k)!.push(i);
    });
    neurons.forEach((n, i) => {
      const ci = Math.floor(n.x / CELL), cj = Math.floor(n.y / CELL), ck = Math.floor(n.z / CELL);
      const cand: [number, number][] = [];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        for (const j of grid.get(key(ci + a, cj + b, ck + c)) || []) {
          if (j === i) continue;
          const m = neurons[j];
          cand.push([j, (m.x - n.x) ** 2 + (m.y - n.y) ** 2 + (m.z - n.z) ** 2]);
        }
      }
      cand.sort((p, q) => p[1] - q[1]);
      n.nb = cand.slice(0, 8).map(p => p[0]);
    });
  }

  /* ── camera ────────────────────────────────────────────────────────── */
  const cam = { yaw: -0.28, pitch: -0.12, tYaw: 0, tPitch: 0, dragging: false };
  let vp = { cx: 0, cy: 0, scale: 1, eegTop: 0, eegH: 0 };
  const rot = { cy: 1, sy: 0, cp: 1, sp: 0 };
  const P = [0, 0, 0, 1], P2 = [0, 0, 0];

  function viewport() {
    const eegH = clamp(Math.round(height * 0.12), 36, 66);
    const eegTop = height - eegH, padTop = 30;
    const narrow = width < 700, portrait = height > width * 1.4;
    const availW = width - (narrow ? 20 : 60), availH = eegTop - padTop - 8;
    // room on the left for the incoming words and on the right for the outgoing ones
    const wide = width >= 760;
    const scale = Math.min((availW - (wide ? 2 * 150 : 0)) / (portrait ? 2.4 : narrow ? 2.9 : 2.25), availH / 1.85);
    vp = { cx: width * 0.5, cy: padTop + availH * 0.44, scale, eegTop, eegH };
  }
  function project(x: number, y: number, z: number, out = P) {
    const x1 = x * rot.cy + z * rot.sy, z1 = -x * rot.sy + z * rot.cy;
    const y2 = y * rot.cp - z1 * rot.sp, z2 = y * rot.sp + z1 * rot.cp;
    const persp = 3.4 / (3.4 - z2);
    out[0] = vp.cx + x1 * persp * vp.scale;
    out[1] = vp.cy - y2 * persp * vp.scale;
    out[2] = z2;
    out[3] = persp;
    return out;
  }

  /* ── signals ───────────────────────────────────────────────────────── */
  let signals: Signal[] = [], sparks: Spark[] = [];
  const glyphs: Glyph[] = [], flares: Flare[] = [];
  let ripple: { x: number; y: number; z: number; r: number; col: RGB } | null = null;
  const pick = <T,>(a: T[]) => a[(Math.random() * a.length) | 0];
  const randomIn = (r: RegionKey) => { const l = byRegion[r]; return l && l.length ? pick(l) : 0; };
  const maxSignals = () => (width < 560 ? 60 : 130);

  function walk(from: number, goal: number, maxSteps = 40) {
    const path = [from], seen = new Set(path), g = neurons[goal];
    let cur = from;
    for (let s = 0; s < maxSteps; s++) {
      const n = neurons[cur];
      if ((n.x - g.x) ** 2 + (n.y - g.y) ** 2 + (n.z - g.z) ** 2 < 0.012) break;
      let best = -1, bestD = Infinity;
      for (const j of n.nb) {
        if (seen.has(j)) continue;
        const m = neurons[j];
        const d = Math.hypot(m.x - g.x, m.y - g.y, m.z - g.z) + Math.random() * 0.07;
        if (d < bestD) { bestD = d; best = j; }
      }
      if (best < 0) break;
      seen.add(best); path.push(best); cur = best;
    }
    if (path[path.length - 1] !== goal) path.push(goal);
    return path;
  }
  function makeSignal(hops: number[], o: Partial<Signal> & { c0: RGB }) {
    if (signals.length >= maxSignals()) return null;
    const pts: number[][] = [];
    hops.forEach((h, i) => { if (i === 0 || i === hops.length - 1 || i % 2 === 0) { const n = neurons[h]; pts.push([n.x, n.y, n.z]); } });
    if (pts.length < 2) return null;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
    const len = cum[cum.length - 1];
    if (len < 0.02) return null;
    const hopS = hops.map(h => {
      const n = neurons[h];
      let bi = 0, bd = Infinity;
      pts.forEach((p, i) => { const d = (p[0] - n.x) ** 2 + (p[1] - n.y) ** 2 + (p[2] - n.z) ** 2; if (d < bd) { bd = d; bi = i; } });
      return cum[bi];
    });
    const sg: Signal = { pts, cum, len, s: 0, speed: 1.3, c1: null, tail: 0.24, w: 1, alpha: 1, hops, hopS, hopAt: 0, ...o };
    signals.push(sg);
    return sg;
  }
  const spawn = (from: RegionKey, to: RegionKey, o: Partial<Signal> & { c0: RGB }) => makeSignal(walk(randomIn(from), randomIn(to)), o);
  function posAt(sg: Signal, s: number, out = P2) {
    const { pts, cum } = sg;
    s = clamp(s, 0, sg.len);
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1), t2 = t * t, t3 = t2 * t;
    const p0 = pts[Math.max(0, i - 2)], p1 = pts[i - 1], p2 = pts[i], p3 = pts[Math.min(pts.length - 1, i + 1)];
    for (let k = 0; k < 3; k++) {
      out[k] = 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
    }
    return out;
  }
  function burst(x: number, y: number, z: number, col: RGB, n: number, spd: number) {
    if (sparks.length > 240) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, b = Math.acos(Math.random() * 2 - 1), v = spd * (0.4 + Math.random() * 0.6);
      sparks.push({ x, y, z, vx: Math.sin(b) * Math.cos(a) * v, vy: Math.cos(b) * v, vz: Math.sin(b) * Math.sin(a) * v, life: 1, decay: 1.8 + Math.random() * 1.2, col });
    }
  }
  const burstAt = (r: Exclude<RegionKey, 'stem'>, n = 10, spd = 0.25) => { const [x, y, z] = ANCHORS[r]; burst(x, y, z, colorOf(r), n, spd); };
  function lightRegion(r: RegionKey, amt: number, count: number) {
    const l = byRegion[r];
    if (!l) return;
    for (let i = 0; i < count; i++) { const n = neurons[pick(l)]; if (n.energy < amt) { n.energy = amt; n.lit = null; } }
  }

  /* ── state driven by events ───────────────────────────────────────── */
  const st = {
    phase: 'idle' as string, since: 0, coreColor: hex('#00f0ff'), thinking: 0, activeTools: new Map<string, RegionKey>(),
    voicing: 0, speakingUntil: 0, hearingUntil: 0, tps: null as number | null, round: 0, scribe: false,
    conscience: 0, error: 0, glitch: 0, listening: false, speaking: false, liveFedAt: -99, liveWords: 0,
    carry: { think: 0, tool: 0, voice: 0, idle: 0, hear: 0 },
  };
  const wordQ: { w: string; col: RGB; inbound: boolean }[] = [];
  // His words, timed to his actual voice: each word has a moment along the audio (by length,
  // with pauses at commas and full stops) and leaves the vocoder when playback reaches it.
  let utter: { id: number; words: { w: string; frac: number; out: boolean }[]; clock: SpeechClock; col: RGB; chars: number } | null = null;
  let speechSynced = false;
  let wordCool = 0, lane = 0;
  const now = () => performance.now() / 1000;

  function queueWords(text: string, col: RGB, inbound: boolean) {
    const words = text.replace(/[*`#>_[\]]/g, '').split(/\s+/).filter(Boolean).slice(0, inbound ? 14 : 40);
    for (const w of words) wordQ.push({ w: w.slice(0, 18), col, inbound });
    // keep his whole reply (paced out), but never let a backlog grow without end
    const cap = inbound ? 14 : 44;
    if (wordQ.length > cap) wordQ.splice(0, wordQ.length - cap);
  }
  function flare(text: string, at: [number, number, number], col: RGB) {
    flares.push({ text, x: at[0], y: at[1], z: at[2], life: 1, col });
    if (flares.length > 4) flares.shift();
  }

  function event(ev: BrainEvent) {
    const k = ev.kind;
    const t = now();
    switch (k) {
      case 'heard': {
        st.hearingUntil = t + 1.6;
        if (!reduced() && typeof ev.text === 'string' && t - st.liveFedAt > 15) queueWords(ev.text, colorOf('hearing'), true);
        burstAt('hearing', 8, 0.2);
        break;
      }
      case 'reflex': {
        // A reflex arc: cerebellum straight to the voice, the cortex never involved
        burstAt('reflex', 16, 0.3);
        lightRegion('reflex', 0.9, 40);
        for (let i = 0; i < 4; i++) spawn('hearing', 'reflex', { c0: colorOf('hearing'), c1: colorOf('reflex'), speed: 2.4, tail: 0.3, s: -i * 0.05 });
        for (let i = 0; i < 5; i++) spawn('reflex', 'voice', { c0: colorOf('reflex'), speed: 2.6, tail: 0.32, w: 1.2, s: -0.4 - i * 0.05 });
        flare(ev.what ? `reflex · ${String(ev.what).replace(/_/g, ' ')}` : 'reflex', ANCHORS.reflex, colorOf('reflex'));
        break;
      }
      case 'think_start': st.thinking += 1; st.round = Number(ev.round) || 0; st.scribe = ev.source === 'scribe'; break;
      case 'think_end': {
        st.thinking = Math.max(0, st.thinking - 1);
        if (typeof ev.tps === 'number') st.tps = ev.tps;
        const calls = Array.isArray(ev.calls) ? (ev.calls as string[]) : [];
        const out = Number(ev.completion_tokens) || 0, ms = Number(ev.ms) || 0;
        if (ev.ok !== false && (out || ms)) {
          const what = ev.source === 'scribe' ? 'chronicle' : calls.length ? `→ ${calls.length} tool${calls.length > 1 ? 's' : ''}` : 'reply';
          flare(`${out ? `${out} tokens · ` : ''}${(ms / 1000).toFixed(1)} s · ${what}`, ANCHORS.core, st.coreColor);
        }
        if (ev.source === 'scribe') for (let i = 0; i < 6; i++) spawn('core', 'memory', { c0: st.coreColor, c1: colorOf('memory'), speed: 1.2, tail: 0.3, s: -i * 0.08 });
        break;
      }
      case 'tool_start': {
        const region = (ev.region as RegionKey) || 'senses';
        st.activeTools.set(String(ev.name), region);
        for (let i = 0; i < 5; i++) spawn('core', region, { c0: st.coreColor, c1: colorOf(region), speed: 1.8, tail: 0.3, w: 1.1, s: -i * 0.05 });
        flare(TOOL_WORDS[String(ev.name)] || String(ev.name).replace(/_/g, ' '), ANCHORS[region as Exclude<RegionKey, 'stem'>] || ANCHORS.senses, colorOf(region));
        break;
      }
      case 'tool_end': {
        const region = (ev.region as RegionKey) || 'senses';
        st.activeTools.delete(String(ev.name));
        burstAt(region as Exclude<RegionKey, 'stem'>, 10, 0.22);
        for (let i = 0; i < 6; i++) spawn(region, 'core', { c0: colorOf(region), c1: st.coreColor, speed: 1.8, tail: 0.32, w: 1.1, s: -i * 0.05 });
        break;
      }
      case 'correction': {
        st.conscience = 1;
        st.glitch = 1;
        lightRegion('conscience', 1, 999);
        burstAt('conscience', 18, 0.35);
        ripple = { x: ANCHORS.conscience[0], y: ANCHORS.conscience[1], z: 0, r: 0, col: colorOf('conscience') };
        break;
      }
      case 'navigate': {
        burstAt('navigation', 18, 0.32);
        lightRegion('navigation', 0.9, 60);
        for (let i = 0; i < 6; i++) spawn('core', 'navigation', { c0: st.coreColor, c1: colorOf('navigation'), speed: 1.6, tail: 0.3, s: -i * 0.06 });
        break;
      }
      case 'voice_start': st.voicing += 1; break;
      case 'voice_end': st.voicing = Math.max(0, st.voicing - 1); break;
      case 'spoke': {
        const text = typeof ev.text === 'string' ? ev.text : '';
        st.speakingUntil = t + clamp(text.length / 15, 1.5, 14);
        if (!reduced() && text && !speechSynced) queueWords(text, st.coreColor, false);
        break;
      }
      case 'core': {
        if (typeof ev.color === 'string') setCore(ev.color);
        break;
      }
      case 'error': st.error = 1; st.glitch = 1; break;
    }
  }

  function setCore(color: string) {
    const c = hex(color);
    if (c.join() === st.coreColor.join()) return;
    st.coreColor = c;
    COL.core = c;
    if (!reduced()) ripple = { x: ANCHORS.core[0], y: ANCHORS.core[1], z: ANCHORS.core[2], r: 0, col: c };
  }

  /* ── simulation ────────────────────────────────────────────────────── */
  const phaseNow = () => {
    const t = now();
    if (st.conscience > 0.4) return 'conscience';
    if (st.listening) return 'listening';
    if (st.activeTools.size) return 'tool';
    if (st.thinking) return st.scribe ? 'scribe' : 'thinking';
    if (st.voicing) return 'voice';
    if (t < st.hearingUntil) return 'hearing';
    if (st.speaking || t < st.speakingUntil) return 'speaking';
    return 'idle';
  };

  function simulate(dt: number) {
    clock += dt;
    for (const n of neurons) n.energy *= Math.exp(-dt * 3.2);
    st.conscience = Math.max(0, st.conscience - dt * 0.35);
    st.error = Math.max(0, st.error - dt * 0.6);
    st.glitch = Math.max(0, st.glitch - dt * 2.2);
    const swayYaw = reduced() ? 0 : Math.sin(clock * 0.13) * 0.2, swayPitch = reduced() ? 0 : Math.sin(clock * 0.09) * 0.04;
    if (!cam.dragging) { cam.tYaw *= Math.exp(-dt * 1.5); cam.tPitch *= Math.exp(-dt * 1.5); }
    cam.yaw += (swayYaw + cam.tYaw - 0.28 - cam.yaw) * Math.min(1, dt * 4);
    cam.pitch += (-0.12 + swayPitch + cam.tPitch - cam.pitch) * Math.min(1, dt * 4);
    if (reduced()) { signals = []; sparks = []; return; }

    const phase = phaseNow();
    st.phase = phase;
    const c = st.carry;
    if (phase === 'idle') {
      c.idle += dt * (width < 560 ? 1.2 : 2.2);
      while (c.idle >= 1) {
        c.idle--;
        const regs: RegionKey[] = ['core', 'memory', 'navigation', 'senses', 'hearing', 'core'];
        spawn(pick(regs), pick(regs), { c0: COL.idle, speed: 0.32, tail: 0.16, w: 0.7, alpha: 0.55 });
      }
    }
    if (phase === 'listening') {
      lightRegion('hearing', 0.45 + 0.25 * Math.sin(clock * 6), 6);
      c.hear += dt * 5;
      while (c.hear >= 1) { c.hear--; spawn('hearing', 'hearing', { c0: colorOf('hearing'), speed: 0.9, tail: 0.2, w: 0.9 }); }
    }
    if (phase === 'hearing') {
      c.hear += dt * 14;
      while (c.hear >= 1) { c.hear--; spawn('hearing', Math.random() < 0.6 ? 'core' : 'memory', { c0: colorOf('hearing'), c1: st.coreColor, speed: 1.6, tail: 0.26 }); }
    }
    if (st.thinking) {
      // one comet per token at the server's speed when known, else a steady "considering" pace
      const rate = st.scribe ? 8 : clamp(st.tps ?? 24, 8, 36);
      c.think += dt * rate;
      while (c.think >= 1) {
        c.think--;
        const from: RegionKey = st.scribe ? 'imagination' : Math.random() < 0.55 ? 'memory' : pick(['hearing', 'navigation', 'senses'] as RegionKey[]);
        spawn(from, 'core', { c0: st.scribe ? colorOf('imagination') : colorOf(from), c1: st.coreColor, speed: 1.5, tail: 0.28, w: 1.05 });
      }
      lightRegion('core', 0.35, 3);
    }
    if (st.activeTools.size) {
      c.tool += dt * 10;
      while (c.tool >= 1) {
        c.tool--;
        const region = pick([...st.activeTools.values()]);
        if (Math.random() < 0.5) spawn('core', region, { c0: st.coreColor, c1: colorOf(region), speed: 1.7, tail: 0.28 });
        else spawn(region, region, { c0: colorOf(region), speed: 1.2, tail: 0.24 });
      }
      for (const r of st.activeTools.values()) lightRegion(r, 0.5, 4);
    }
    if (st.voicing) {
      c.voice += dt * 12;
      while (c.voice >= 1) { c.voice--; spawn('core', 'voice', { c0: st.coreColor, c1: colorOf('voice'), speed: 1.8, tail: 0.3 }); }
      lightRegion('voice', 0.45, 4);
    }
    if (st.conscience > 0 && Math.random() < dt * 20 * st.conscience) lightRegion('conscience', 0.9 * st.conscience, 6);
    if (st.error > 0 && Math.random() < dt * 30 * st.error) { const n = pick(neurons); n.energy = 0.8; n.lit = COL.red; }

    for (let i = signals.length - 1; i >= 0; i--) {
      const sg = signals[i];
      sg.s += sg.speed * dt;
      while (sg.hopAt < sg.hops.length && sg.hopS[sg.hopAt] <= sg.s) {
        const n = neurons[sg.hops[sg.hopAt]];
        n.energy = Math.min(1, n.energy + 0.75 * sg.w);
        n.lit = sg.c1 && sg.s / sg.len > 0.5 ? sg.c1 : sg.c0;
        sg.hopAt++;
      }
      if (sg.s - sg.tail >= sg.len) { signals.splice(i, 1); continue; }
      if (!sg.ended && sg.s >= sg.len) { sg.ended = true; sg.onEnd?.(); }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vx *= 0.94; p.vy *= 0.94; p.vz *= 0.94;
      p.life -= p.decay * dt;
      if (p.life <= 0) sparks.splice(i, 1);
    }
    if (ripple) {
      ripple.r += dt * 1.6;
      for (const n of neurons) {
        const d = Math.hypot(n.x - ripple.x, n.y - ripple.y, n.z - ripple.z);
        if (Math.abs(d - ripple.r) < 0.06) { n.energy = Math.max(n.energy, 0.7 * (1 - ripple.r / 2.4)); n.lit = ripple.col; }
      }
      if (ripple.r > 2.4) ripple = null;
    }
    for (let i = flares.length - 1; i >= 0; i--) { flares[i].life -= dt * 0.33; flares[i].y += dt * 0.05; if (flares[i].life <= 0) flares.splice(i, 1); }

    // his words, released as the audio reaches them
    if (utter && !reduced()) {
      const u = utter, t = u.clock.time();
      let dur = u.clock.duration();
      if (!Number.isFinite(dur) || dur <= 0) dur = u.clock.speechAt + u.chars / 14;   // length not known yet
      const span = Math.max(0.5, (dur - u.clock.speechAt) * 0.94);                    // a little trailing silence
      const rate = u.words.length / span;                                               // words per second
      const speed = clamp(rate / 2.6, 0.7, 1.7);
      let left = 0;
      for (const w of u.words) {
        if (w.out) continue;
        if (t >= u.clock.speechAt + w.frac * span) { w.out = true; emitOut(w.w, u.col, speed); } else left++;
      }
      if (!left || t > dur + 1) utter = null;
    }

    // words: the passenger's fly in to the ear, Delamain's leave from the voice area
    wordCool -= dt;
    if (wordQ.length && wordCool <= 0) {
      const { w, col, inbound } = wordQ.shift()!;
      const L = [0, 3, 1, 4, 2][lane++ % 5] - 2;
      if (glyphs.length >= (width < 560 ? 10 : 18)) glyphs.shift();
      if (inbound) {
        glyphs.push({ w, col, inbound, x: EAR[0] - 1.25, y: EAR[1] + L * 0.06 - 0.25, z: EAR[2], vx: 0, vy: 0, life: 1, ph: Math.random() * TAU, tx: EAR[0], ty: EAR[1], tz: EAR[2] });
      } else {
        emitOut(w, col, 1);
      }
      wordCool = width < 560 ? 0.2 : 0.15;
    }
    for (let i = glyphs.length - 1; i >= 0; i--) {
      const g = glyphs[i];
      if (g.inbound) {
        // ease toward the ear, then get absorbed with a spark
        g.x += (g.tx! - g.x) * Math.min(1, dt * 1.6);
        g.y += (g.ty! - g.y) * Math.min(1, dt * 1.6);
        if (Math.hypot(g.x - g.tx!, g.y - g.ty!) < 0.05) {
          burst(EAR[0], EAR[1], EAR[2], g.col, 3, 0.12);
          lightRegion('hearing', 0.9, 5);
          glyphs.splice(i, 1);
          continue;
        }
      } else {
        g.x += g.vx * dt;
        g.y += (g.vy + Math.sin(clock * 2.2 + g.ph) * 0.01) * dt;
        g.life -= dt * 0.4;
        if (g.life <= 0) glyphs.splice(i, 1);
      }
    }
  }

  function emitOut(w: string, col: RGB, speed: number) {
    const L = [0, 3, 1, 4, 2][lane++ % 5] - 2;
    if (glyphs.length >= (width < 560 ? 10 : 18)) glyphs.shift();
    const wide = width >= 760;
    glyphs.push({ w, col, inbound: false, x: MOUTH[0] + Math.random() * 0.03, y: MOUTH[1] + L * 0.035, z: MOUTH[2],
      vx: ((wide ? 0.13 : 0.2) + Math.random() * 0.05) * speed, vy: (L * 0.035 + (wide ? -0.13 : -0.01)) * speed,
      life: 1, ph: Math.random() * TAU });
    burst(MOUTH[0], MOUTH[1], MOUTH[2], col, 3, 0.12);
    lightRegion('voice', 1, 4);
  }

  /* ── drawing ───────────────────────────────────────────────────────── */
  const unit = () => clamp(vp.scale / 300, 0.8, 1.6);
  const regionHot = (r: RegionKey) => {
    const p = st.phase;
    if (r === 'core') return st.thinking ? 1 : p === 'hearing' ? 0.4 : 0;
    if (r === 'hearing') return p === 'hearing' || p === 'listening' ? 1 : 0;
    if (r === 'voice') return st.voicing || p === 'speaking' ? 1 : 0;
    if (r === 'conscience') return st.conscience;
    if ([...st.activeTools.values()].includes(r)) return 1;
    if (r === 'imagination' && st.scribe && st.thinking) return 1;
    return 0;
  };

  function drawBackdrop() {
    project(-0.05, 0.02, 0);
    const [cx, cy] = P, R = vp.scale * 1.2;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    const [r, gg, b] = st.coreColor;
    const busy = st.thinking || st.activeTools.size ? 1 : 0;
    g.addColorStop(0, `rgba(${r},${gg},${b},${(0.06 + busy * 0.06).toFixed(3)})`);
    g.addColorStop(0.55, 'rgba(20,40,100,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, vp.eegTop);
  }

  function drawNeurons() {
    const breath = reduced() ? 0.5 : 0.5 + 0.5 * Math.sin(clock * 1.2), u = unit();
    const hot: Partial<Record<RegionKey, number>> = {};
    for (const r of Object.keys(COL)) hot[r as RegionKey] = regionHot(r as RegionKey);
    ctx.globalCompositeOperation = 'lighter';
    for (const n of neurons) {
      project(n.x, n.y, n.z);
      const depth = clamp((P[2] + 0.8) / 1.6, 0, 1), e = n.energy;
      let a = 0.11 + depth * 0.3 + (hot[n.region] || 0) * 0.22 + Math.sin(clock * 1.7 + n.ph) * 0.04 + breath * 0.03;
      if (n.region === 'conscience') a *= 0.55 + st.conscience;           // a quiet band until it fires
      const s = (1.5 + n.size * 1.6) * P[3] * u * (1 + e * 0.6);
      ctx.globalAlpha = clamp(a + e * 0.6, 0, 1);
      const base = n.region === 'core' ? st.coreColor : colorOf(n.region);
      ctx.drawImage(sprite(base, true), P[0] - s, P[1] - s, s * 2, s * 2);
      if (e > 0.2) {
        const h = (5 + 9 * e) * P[3] * u;
        ctx.globalAlpha = clamp(e * 0.75, 0, 1);
        ctx.drawImage(sprite(n.lit || base), P[0] - h, P[1] - h, h * 2, h * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  function drawSignals() {
    const u = unit(), DOTS = width < 560 ? 9 : 14;
    ctx.globalCompositeOperation = 'lighter';
    for (const sg of signals) {
      if (sg.s <= 0) continue;
      const head = Math.min(sg.s, sg.len), frac = sg.s / sg.len;
      const rgb = sg.c1 ? mix(sg.c0, sg.c1, Math.round(clamp((frac - 0.3) * 2.2, 0, 1) * 6) / 6) : sg.c0;
      const spr = sprite(rgb);
      for (let k = DOTS - 1; k >= 0; k--) {           // comet tail: shrinking, fading dots along the curve
        const s = head - (k / (DOTS - 1)) * sg.tail;
        if (s < 0) continue;
        posAt(sg, s);
        project(P2[0], P2[1], P2[2]);
        const f = 1 - k / DOTS, sz = (k === 0 ? 7 : 2 + 4.5 * f) * sg.w * P[3] * u;
        ctx.globalAlpha = clamp(f * f * 0.85 * (P[2] < -0.1 ? 0.55 : 1) * sg.alpha, 0, 1);
        ctx.drawImage(spr, P[0] - sz, P[1] - sz, sz * 2, sz * 2);
      }
    }
    for (const p of sparks) {
      project(p.x, p.y, p.z);
      const sz = (2 + 4 * p.life) * P[3] * u;
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.drawImage(sprite(p.col), P[0] - sz, P[1] - sz, sz * 2, sz * 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawWords() {
    const compact = width < 560;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `${compact ? '500 11px' : '500 13px'} "Share Tech Mono", ui-monospace, monospace`;
    for (const g of glyphs) {
      project(g.x, g.y, g.z);
      if (P[0] > width - 8 || P[0] < 4 || P[1] < 12 || P[1] > vp.eegTop - 8) continue;
      const a = g.inbound ? 0.9 : clamp(Math.min((1 - g.life) * 8, g.life * 1.2), 0, 0.95);
      const born = g.inbound ? 1 : clamp((1 - g.life) * 6, 0, 1);
      const tw = ctx.measureText(g.w).width;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * 0.45;
      ctx.drawImage(sprite(g.col), P[0] - 10, P[1] - 14, tw + 20, 28);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = a;
      ctx.save();
      ctx.translate(P[0], P[1]);
      ctx.scale(0.6 + 0.4 * born, 0.6 + 0.4 * born);
      ctx.fillStyle = `rgb(${g.col.map(v => Math.min(255, Math.round(v + 40))).join(',')})`;
      ctx.fillText(g.w, 0, 0);
      ctx.restore();
    }
    ctx.textAlign = 'center';
    ctx.font = `${compact ? '600 11px' : '600 13px'} "Share Tech Mono", ui-monospace, monospace`;
    for (const f of flares) {
      project(f.x, f.y + 0.2, f.z);
      const a = clamp(Math.min((1 - f.life) * 6, f.life * 1.4), 0, 1);
      const tw = ctx.measureText(f.text).width;
      ctx.globalAlpha = a;
      ctx.shadowColor = `rgba(${f.col.join(',')},0.9)`;
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#ecfeff';
      ctx.fillText(f.text, clamp(P[0], tw / 2 + 10, width - tw / 2 - 10), P[1]);
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  /* ── EEG ───────────────────────────────────────────────────────────── */
  const EEG_N = 320, eeg = { a: new Float32Array(EEG_N), head: 0, acc: 0, spike: 0 };
  function stepEeg(dt: number) {
    eeg.acc += dt;
    while (eeg.acc >= 0.02) {
      eeg.acc -= 0.02;
      const p = st.phase, t = clock;
      let v: number;
      if (p === 'idle') v = Math.sin(t * TAU * 1.1) * 0.16 + Math.sin(t * TAU * 0.35) * 0.08 + (Math.random() - 0.5) * 0.04;
      else if (p === 'hearing' || p === 'listening') v = Math.sin(t * TAU * 4) * 0.4 + (Math.random() - 0.5) * 0.2;
      else if (p === 'speaking' || p === 'voice') v = Math.sin(t * TAU * 6) * 0.35 * (0.6 + 0.4 * Math.sin(t * TAU * 1.3)) + (Math.random() - 0.5) * 0.25;
      else { v = (Math.sin(t * TAU * 7) * 0.4 + (Math.random() - 0.5) * 1.1) * 0.65; if (Math.random() < 0.04) eeg.spike = 1; }
      if (st.conscience > 0.3 && Math.random() < 0.1) eeg.spike = 1;
      v += eeg.spike * (Math.random() < 0.5 ? 1 : -1) * 0.7;
      eeg.spike *= 0.6;
      eeg.a[eeg.head] = clamp(v, -1, 1);
      eeg.head = (eeg.head + 1) % EEG_N;
    }
  }
  function drawEeg() {
    const top = vp.eegTop, h = vp.eegH, x0 = 12, x1 = width - 12, mid = top + h * 0.5, amp = h * 0.34;
    const p = st.phase;
    const col: RGB = p === 'hearing' || p === 'listening' ? colorOf('hearing') : p === 'speaking' || p === 'voice' ? colorOf('voice')
      : p === 'conscience' ? colorOf('conscience') : p === 'idle' ? colorOf('memory') : st.coreColor;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(0,243,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, top + 0.5); ctx.lineTo(x1, top + 0.5); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < EEG_N; i++) {
      const x = x0 + (i / (EEG_N - 1)) * (x1 - x0), y = mid - eeg.a[(eeg.head + i) % EEG_N] * amp;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    const grad = ctx.createLinearGradient(x0, 0, x1, 0);
    grad.addColorStop(0, `rgba(${col.join(',')},0)`);
    grad.addColorStop(0.75, `rgba(${col.join(',')},0.55)`);
    grad.addColorStop(1, `rgba(${col.join(',')},0.95)`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.4;
    ctx.shadowColor = `rgba(${col.join(',')},0.8)`;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /* ── labels + tooltip ──────────────────────────────────────────────── */
  let tooltip: { key: Exclude<RegionKey, 'stem'>; until: number } | null = null;
  function cutRect(x: number, y: number, w: number, h: number, cut: number) {   // an angular HUD tag
    ctx.beginPath();
    ctx.moveTo(x + cut, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h - cut);
    ctx.lineTo(x + w - cut, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + cut); ctx.closePath();
  }
  function drawLabels() {
    const compact = width < 760;
    const keys = Object.keys(ANCHORS) as Exclude<RegionKey, 'stem'>[];
    ctx.globalCompositeOperation = 'source-over';
    ctx.textBaseline = 'middle';
    // where each region is on screen
    const items = keys.map(k => {
      const [x, y, z] = ANCHORS[k];
      project(x, y, z);
      return { k, ax: P[0], ay: P[1], hot: phaseNowHot(k), c: k === 'core' ? st.coreColor : colorOf(k) };
    });
    if (compact) {
      ctx.font = '600 9.5px "Share Tech Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      for (const it of items) {
        const [x, y, z] = ANCHORS[it.k];
        project(x, y + (LABEL_DY[it.k] ?? 0.13), z);
        const text = REGION_INFO[it.k].code, tw = ctx.measureText(text).width + 12;
        ctx.globalAlpha = it.hot ? 1 : 0.75;
        ctx.fillStyle = it.hot ? 'rgba(6,10,20,0.88)' : 'rgba(6,10,20,0.55)';
        cutRect(P[0] - tw / 2, P[1] - 8, tw, 16, 4); ctx.fill();
        ctx.strokeStyle = `rgba(${it.c.join(',')},${it.hot ? 0.9 : 0.35})`; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = it.hot ? '#fff' : `rgba(${it.c.join(',')},0.95)`;
        ctx.fillText(text, P[0], P[1] + 0.5);
      }
    } else {
      // two columns at the sides, like a schematic; nudge apart so nothing overlaps
      const boxW = 176, boxH = 34, gap = 6;
      const left = items.filter(i => i.ax < vp.cx).sort((a, b) => a.ay - b.ay);
      const right = items.filter(i => i.ax >= vp.cx).sort((a, b) => a.ay - b.ay);
      const place = (col: typeof items, x: number) => {
        let lastY = 8 - gap;
        const placed = col.map(it => { const y = Math.max(it.ay - boxH / 2, lastY + gap); lastY = y + boxH; return { ...it, bx: x, by: y }; });
        const overflow = lastY - (vp.eegTop - 8);
        if (overflow > 0) placed.forEach(p2 => { p2.by -= overflow; });
        return placed;
      };
      const margin = Math.max(14, Math.min(60, (width - vp.scale * 2.6) / 2 - boxW - 10));
      const all = [...place(left, margin), ...place(right, width - margin - boxW)];
      for (const it of all) {
        const isLeft = it.bx < vp.cx;
        const ex = isLeft ? it.bx + boxW : it.bx, ey = it.by + boxH / 2;
        const a = it.hot ? 1 : 0.55;
        // leader line with an elbow, and a small diamond on the region
        ctx.globalAlpha = a * 0.7;
        ctx.strokeStyle = `rgba(${it.c.join(',')},${it.hot ? 0.9 : 0.4})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const elbow = isLeft ? ex + 18 : ex - 18;
        ctx.moveTo(ex, ey); ctx.lineTo(elbow, ey); ctx.lineTo(it.ax, it.ay); ctx.stroke();
        ctx.globalAlpha = a;
        ctx.fillStyle = `rgb(${it.c.join(',')})`;
        ctx.beginPath(); ctx.moveTo(it.ax, it.ay - 4); ctx.lineTo(it.ax + 4, it.ay); ctx.lineTo(it.ax, it.ay + 4); ctx.lineTo(it.ax - 4, it.ay); ctx.closePath(); ctx.fill();
        // the tag
        ctx.fillStyle = it.hot ? 'rgba(6,10,20,0.9)' : 'rgba(6,10,20,0.62)';
        cutRect(it.bx, it.by, boxW, boxH, 7); ctx.fill();
        ctx.strokeStyle = `rgba(${it.c.join(',')},${it.hot ? 0.95 : 0.35})`;
        ctx.stroke();
        ctx.fillStyle = `rgb(${it.c.join(',')})`;
        ctx.fillRect(isLeft ? it.bx + boxW - 3 : it.bx, it.by + 6, 3, boxH - 12);   // accent bar on the line side
        ctx.textAlign = 'left';
        ctx.font = '600 11.5px "Share Tech Mono", ui-monospace, monospace';
        ctx.fillStyle = it.hot ? '#ffffff' : `rgba(${it.c.join(',')},0.95)`;
        ctx.fillText(REGION_INFO[it.k].code, it.bx + 10, it.by + 11);
        ctx.font = '500 11px Rajdhani, system-ui, sans-serif';
        ctx.fillStyle = it.hot ? 'rgba(226,232,240,0.95)' : 'rgba(148,163,184,0.85)';
        ctx.fillText(`${REGION_INFO[it.k].label} · ${REGION_INFO[it.k].sub}`, it.bx + 10, it.by + 24, boxW - 18);
        if (it.hot) {   // a live pip on the tag
          ctx.fillStyle = `rgba(${it.c.join(',')},${0.6 + 0.4 * Math.sin(clock * 8)})`;
          ctx.fillRect(isLeft ? it.bx + boxW - 14 : it.bx + boxW - 12, it.by + 8, 5, 5);
        }
      }
    }
    if (tooltip && now() < tooltip.until) {
      const [x, y, z] = ANCHORS[tooltip.key];
      project(x, y + 0.13, z);
      const text = REGION_INFO[tooltip.key].tip;
      ctx.font = `500 ${compact ? 11 : 12}px Rajdhani, system-ui, sans-serif`;
      const tw = Math.min(width - 24, ctx.measureText(text).width + 22);
      const bx = clamp(P[0] - tw / 2, 12, width - tw - 12), by = Math.max(8, P[1] - 42);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(8,12,24,0.95)';
      ctx.strokeStyle = `rgba(${(tooltip.key === 'core' ? st.coreColor : colorOf(tooltip.key)).join(',')},0.8)`;
      cutRect(bx, by, tw, 26, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'left';
      ctx.fillText(text, bx + 11, by + 13.5, tw - 22);
    }
    ctx.globalAlpha = 1;
  }
  const phaseNowHot = (k: RegionKey) => regionHot(k) >= 0.8;

  /* ── cyberpunk dressing: hex grid, hex ticker, glitch ─────────────────── */
  let hexGrid: HTMLCanvasElement | null = null;
  function buildHexGrid() {
    hexGrid = document.createElement('canvas');
    hexGrid.width = Math.ceil(width * dpr); hexGrid.height = Math.ceil(height * dpr);
    const g = hexGrid.getContext('2d')!;
    g.scale(dpr, dpr);
    const r = 16, hh = Math.sqrt(3) * r;
    g.strokeStyle = 'rgba(0,243,255,0.045)';
    g.lineWidth = 1;
    for (let row = 0, y = 0; y < height + hh; row++, y += hh / 2) {
      for (let x = (row % 2) * r * 1.5; x < width + r * 3; x += r * 3) {
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
          if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.closePath(); g.stroke();
      }
    }
    // a soft vignette so the grid fades toward the edges
    const v = g.createRadialGradient(width / 2, height * 0.45, Math.min(width, height) * 0.2, width / 2, height * 0.45, Math.max(width, height) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(5,6,10,0.85)');
    g.fillStyle = v; g.fillRect(0, 0, width, height);
  }
  const HEX = '0123456789ABCDEF';
  const ticker: string[] = [];
  let tickerT = 0;
  function drawTicker(dt: number) {
    tickerT += dt;
    const busy = st.phase !== 'idle';
    if (!ticker.length || tickerT > (busy ? 0.08 : 0.5)) {
      tickerT = 0;
      ticker.push(HEX[(Math.random() * 16) | 0] + HEX[(Math.random() * 16) | 0]);
      if (ticker.length > 64) ticker.shift();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '500 9.5px "Share Tech Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const y = vp.eegTop + 4;
    ctx.fillStyle = 'rgba(0,243,255,0.55)';
    ctx.fillText('NEURAL TELEMETRY', 12, y);
    ctx.fillStyle = 'rgba(0,243,255,0.22)';
    ctx.fillText(ticker.slice(-Math.floor((width * 0.45) / 19)).join(' '), 120, y, width * 0.5);
  }
  function glitch() {
    if (st.glitch <= 0 || reduced()) return;
    const bands = 3 + ((Math.random() * 5) | 0);
    for (let i = 0; i < bands; i++) {
      const h = 4 + Math.random() * 26, y = Math.random() * vp.eegTop, dx = (Math.random() - 0.5) * 40 * st.glitch;
      ctx.drawImage(canvas, 0, y * dpr, canvas.width, h * dpr, dx, y, width, h);
    }
    // a red/cyan split for a moment
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.25 * st.glitch;
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 3 * st.glitch, 0, width, height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function hitRegion(cx: number, cy: number): Exclude<RegionKey, 'stem'> | null {
    const rect = canvas.getBoundingClientRect(), mx = cx - rect.left, my = cy - rect.top;
    let best: Exclude<RegionKey, 'stem'> | null = null, bestD = 60;
    for (const k of Object.keys(ANCHORS) as Exclude<RegionKey, 'stem'>[]) {
      const [x, y, z] = ANCHORS[k];
      project(x, y, z);
      const d = Math.hypot(P[0] - mx, P[1] - my);
      if (d < bestD) { bestD = d; best = k; }
    }
    return best;
  }
  let down: { x: number; y: number; yaw: number; pitch: number; t: number } | null = null;
  const onMove = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    if (down) {
      cam.dragging = true;
      cam.tYaw = clamp(down.yaw + ((e.clientX - down.x) / rect.width) * 1.4, -0.7, 0.7);
      cam.tPitch = clamp(down.pitch + ((e.clientY - down.y) / rect.height) * 0.6, -0.3, 0.3);
    } else if (e.pointerType === 'mouse') {
      cam.tYaw = ((e.clientX - rect.left) / rect.width - 0.5) * 0.35;
      cam.tPitch = ((e.clientY - rect.top) / rect.height - 0.5) * 0.12;
      const k = hitRegion(e.clientX, e.clientY);
      if (k && (!tooltip || tooltip.key !== k || now() > tooltip.until)) tooltip = { key: k, until: now() + 3 };
    }
  };
  const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, yaw: cam.tYaw, pitch: cam.tPitch, t: performance.now() }; };
  const onUp = (e: PointerEvent) => {
    if (down && performance.now() - down.t < 300 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) {
      const k = hitRegion(e.clientX, e.clientY);
      if (k) { tooltip = { key: k, until: now() + 3.5 }; opts.onRegionTap?.(k); }
    }
    down = null;
    cam.dragging = false;
  };
  const onLeave = () => { if (!down) { cam.tYaw = 0; cam.tPitch = 0; } };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.style.touchAction = 'pan-y';
  canvas.style.cursor = 'pointer';

  /* ── loop ──────────────────────────────────────────────────────────── */
  function resize() {
    const rect = stage.getBoundingClientRect();
    const w = Math.max(300, Math.floor(rect.width)), h = Math.max(240, Math.floor(rect.height));
    const rebuild = !neurons.length || Math.abs(w * h - width * height) / (width * height) > 0.35;
    width = w; height = h;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (rebuild) { signals = []; build(); }
    buildHexGrid();
  }
  function frame(ts: number) {
    if (document.hidden) { raf = 0; return; }
    const dt = last ? clamp((ts - last) / 1000, 0.001, 0.06) : 0.016;
    last = ts;
    simulate(dt);
    stepEeg(dt);
    rot.cy = Math.cos(cam.yaw); rot.sy = Math.sin(cam.yaw); rot.cp = Math.cos(cam.pitch); rot.sp = Math.sin(cam.pitch);
    viewport();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
    if (hexGrid) ctx.drawImage(hexGrid, 0, 0, width, height);
    drawBackdrop();
    drawNeurons();
    drawSignals();
    drawLabels();
    drawWords();   // over the tags, so his words stay readable where they cross them
    drawEeg();
    drawTicker(dt);
    glitch();
    raf = requestAnimationFrame(frame);
  }
  const onVis = () => { if (!document.hidden && !raf) { last = 0; raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', onVis);
  const ro = new ResizeObserver(() => resize());
  ro.observe(stage);
  resize();
  raf = requestAnimationFrame(frame);

  return {
    event,
    setCore,
    setTps(tps: number | null) { if (tps) st.tps = tps; },
    setListening(on: boolean) { st.listening = on; if (!on) st.liveWords = 0; },
    setSpeaking(on: boolean) { if (st.speaking && !on) st.speakingUntil = now() + 0.4; st.speaking = on; },
    /** A new utterance and its playback clock: his words leave the vocoder in time with his voice. */
    speak(clock: SpeechClock) {
      speechSynced = true;
      if (utter?.id === clock.id) return;
      const raw = clock.text.replace(/[*`#>_[\]]/g, '').split(/\s+/).filter(Boolean);
      // weight = the word's length, plus a beat for the pause after a comma or a full stop
      let total = 0;
      const weights = raw.map(w => { const wt = w.length + 1 + (/[.!?…]$/.test(w) ? 5 : /[,;:—]$/.test(w) ? 3 : 0); total += wt; return wt; });
      let cum = 0;
      const now0 = clock.time();
      let dur = clock.duration();
      if (!Number.isFinite(dur) || dur <= 0) dur = clock.speechAt + clock.text.length / 14;
      const span = Math.max(0.5, (dur - clock.speechAt) * 0.94);
      const words = raw.map((w, i) => {
        const frac = total ? cum / total : 0;
        cum += weights[i];
        // opened mid-sentence: words already said a while ago are not replayed in a burst
        return { w: w.slice(0, 18), frac, out: now0 - (clock.speechAt + frac * span) > 0.8 };
      });
      utter = { id: clock.id, words, clock, col: st.coreColor, chars: clock.text.length };
    },
    /** The words recognized so far while the mic is open: new ones fly into Hearing as they come. */
    feedLive(text: string) {
      const words = text.trim().split(/\s+/).filter(Boolean);
      if (words.length < st.liveWords) st.liveWords = 0;
      const fresh = words.slice(st.liveWords);
      st.liveWords = words.length;
      if (fresh.length && !reduced()) { queueWords(fresh.join(' '), colorOf('hearing'), true); st.liveFedAt = now(); }
    },
    phase: () => st.phase,
    stats: () => ({ glyphs: glyphs.length, queued: wordQ.length, signals: signals.length, neurons: neurons.length, width, height,
      lit: neurons.reduce((n, x) => n + (x.energy > 0.25 ? 1 : 0), 0),
      said: utter ? utter.words.filter(w => w.out).length : -1, words: utter ? utter.words.length : 0, audio: utter ? +utter.clock.time().toFixed(2) : null }),
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
    },
  };
}

// Plain words for each tool, shown as it runs.
export const TOOL_WORDS: Record<string, string> = {
  web_search: 'searching the web', read_webpage: 'reading a web page', get_news: 'fetching the news',
  get_weather: 'checking the weather', get_route: 'working out the route',
  remember: 'committing to memory', forget: 'forgetting', write_note: 'writing a note', append_to_note: 'adding to a note',
  read_note: 'reading a note', list_notes: 'looking through notes', search_notes: 'searching notes',
  set_reminder: 'setting a reminder', list_reminders: 'checking reminders', cancel_reminder: 'cancelling a reminder',
  list_adventures: 'opening the adventure book', start_adventure: 'starting an adventure', pause_adventure: 'pausing the adventure',
  end_adventure: 'ending the adventure', note_fact: 'noting a fact for the chronicle',
};

export type Brain = ReturnType<typeof createBrain>;
