// Delamain's brain: a 3D point-cloud brain drawn on a canvas. Nothing is connected by
// lines; every signal is a glowing particle with a comet tail that hops neuron to neuron
// along a real path through the brain, lighting each neuron as it passes.
//
// The renderer is driven by the backend's brain events (brain.py): heard, reflex,
// think_start/think_end, tool_start/tool_end, correction, navigate, voice_start/voice_end,
// spoke, core, clients, error. See BrainView.tsx for the page around it.

export type BrainEvent = { kind: string; t?: number; [k: string]: unknown };

/** A real part of a model, from /api/brain/model (model_map.py). */
export type ModelUnit = { kind: string; layer: number | null; layerTo?: number | null; weights: number;
  tensors: { name: string; shape: number[] }[]; count?: number };
export type ModelInfo = {
  llm?: { file: string; format: string; layers: number; total: number; experts?: number | null; experts_used?: number | null;
    hidden?: number | null; full_attention_layers?: number | null; linear_attention_layers?: number | null; units: ModelUnit[] };
  voice?: { file: string; total: number; blocks: number; units: ModelUnit[] };
  llm_error?: string; voice_error?: string;
};
export type NodePin = { src: 'llm' | 'voice'; unit: ModelUnit; share: number };

/** What he is saying right now and the playback clock behind it (the page's audio element). */
export type SpeechClock = { id: number; text: string; speechAt: number; time: () => number; duration: () => number };

export type RegionKey =
  | 'hearing' | 'core' | 'senses' | 'navigation' | 'plans' | 'imagination'
  | 'memory' | 'voice' | 'reflex' | 'conscience' | 'stem';

type RGB = [number, number, number];

// The other parts are program code, not learned weights: the functions that do their work.
export const NODE_CODE: Partial<Record<RegionKey, [string, string][]>> = {
  hearing: [['speech recognition (in your browser)', 'turns your voice into text before it reaches Delamain'], ['WebSocket "talk" handler', 'receives your words on the server']],
  reflex: [['lines.match()', 'spots everyday phrases such as "thanks" or "how are you"'], ['lines.pick()', "chooses a pre-recorded line in the current core's voice"]],
  senses: [['web_search()', 'searches the web through SearXNG'], ['read_webpage()', 'reads a public web page'], ['get_news()', 'fetches headlines from Google News'], ['get_weather()', 'gets the forecast from Open-Meteo']],
  navigation: [['get_route()', 'driving time and distance from OSRM'], ['geocode_places()', 'finds a destination with OpenStreetMap']],
  plans: [['set_reminder()', 'stores a reminder in the database'], ['list_reminders()', 'reads the pending reminders'], ['cancel_reminder()', 'removes one'], ['reminder loop', 'speaks each reminder when it is due']],
  memory: [['remember()', 'writes a fact to Delamain/Memory in your vault'], ['forget()', 'removes one'], ['write_note()', 'creates a note in your vault'], ['append_to_note()', 'adds to a note'], ['read_note()', 'reads a note'], ['search_notes()', 'searches your notes'], ['memory_context()', 'puts what he remembers into every prompt']],
  imagination: [['list_adventures()', 'the adventure menu'], ['start_adventure()', 'opens a campaign'], ['note_fact()', 'writes a fact into the chronicle'], ['scribe', 'a background model call that updates the chronicle']],
  conscience: [['save check', 'catches "I have saved that" without a save'], ['promise check', 'catches "I shall check" without a tool call'], ['news check', 'catches a bulletin with no headlines']],
  stem: [['WebSocket link', 'carries messages between the page and the server'], ['brain event feed', 'tells this view what he is doing']],
};

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
  fires: number; lastFired: number; lastBy: string;   // what passed through it, for the node inspector
};
type Signal = {
  pts: number[][]; cum: number[]; len: number; s: number; speed: number; c0: RGB; c1: RGB | null;
  tail: number; w: number; alpha: number; hops: number[]; hopS: number[]; hopAt: number;
  onEnd?: () => void; ended?: boolean; why?: string;
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

export type BrainOptions = { reducedMotion?: boolean; onRegionTap?: (r: RegionKey) => void; onNodeSelect?: (id: number | null) => void };

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
    const target = clamp(Math.round((width * height) / 240), 650, 3400);   // big screens get more stars in the brain
    neurons = [];
    const add = (x: number, y: number, z: number, region: RegionKey, shell: boolean, size?: number) =>
      neurons.push({ x, y, z, region, shell, size: size ?? 0.4 + rand() * 0.8, ph: rand() * TAU, energy: 0, lit: null, nb: [],
      fires: 0, lastFired: -1, lastBy: '' });

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
  // A real 3D camera: it orbits the brain (yaw/pitch), flies in and out (dist) and slides sideways
  // (ox/oy, in brain units). Close up, nodes spread apart in depth and anything behind it disappears.
  const FOCAL = 3.4, NEAR = 0.12;
  const cam = { yaw: -0.28, pitch: -0.12, tYaw: 0, tPitch: 0, dragging: false, dist: FOCAL, ox: 0, oy: 0, user: false };
  let vp = { cx: 0, cy: 0, scale: 1, eegTop: 0, eegH: 0, baseCx: 0, baseCy: 0, baseScale: 1 };
  const rot = { cy: 1, sy: 0, cp: 1, sp: 0 };
  const P = [0, 0, 0, 1], P2 = [0, 0, 0];

  function viewport() {
    const eegH = clamp(Math.round(height * 0.12), 36, 66);
    const eegTop = height - eegH, padTop = 30;
    const narrow = width < 700, portrait = height > width * 1.4;
    const availW = width - (narrow ? 20 : 60), availH = eegTop - padTop - 8;
    const wide = width >= 760;
    const scale = Math.min((availW - (wide ? 2 * 150 : 0)) / (portrait ? 2.4 : narrow ? 2.9 : 2.25), availH / 1.85);
    const baseCx = width * 0.5, baseCy = padTop + availH * 0.44;
    vp = { cx: baseCx, cy: baseCy, scale, eegTop, eegH, baseCx, baseCy, baseScale: scale };
  }
  const zoomLevel = () => FOCAL / cam.dist;
  // Fly toward (or back from) the point under the screen position (sx, sy).
  function dolly(sx: number, sy: number, newDist: number) {
    newDist = clamp(newDist, 0.3, 5);
    const s = cam.dist - newDist, k = FOCAL * vp.scale;
    cam.ox += s * (sx - vp.cx) / k;
    cam.oy -= s * (sy - vp.cy) / k;
    cam.dist = newDist;
    if (cam.dist >= FOCAL - 0.01 && !cam.user) { cam.ox *= 0.5; cam.oy *= 0.5; }
    cam.ox = clamp(cam.ox, -1.6, 1.6); cam.oy = clamp(cam.oy, -1.4, 1.4);
  }
  function slide(dx: number, dy: number) {        // drag the view sideways by screen pixels
    const k = FOCAL * vp.scale / Math.max(0.3, cam.dist);
    cam.ox = clamp(cam.ox - dx / k, -1.6, 1.6); cam.oy = clamp(cam.oy + dy / k, -1.4, 1.4);
  }
  function project(x: number, y: number, z: number, out = P) {
    const x1 = x * rot.cy + z * rot.sy, z1 = -x * rot.sy + z * rot.cy;
    const y2 = y * rot.cp - z1 * rot.sp, z2 = y * rot.sp + z1 * rot.cp;
    const depth = cam.dist - z2;
    if (depth < NEAR) { out[0] = NaN; out[1] = NaN; out[2] = z2; out[3] = 0; return out; }   // behind the camera
    const persp = FOCAL / depth;
    out[0] = vp.cx + (x1 - cam.ox) * persp * vp.scale;
    out[1] = vp.cy - (y2 - cam.oy) * persp * vp.scale;
    out[2] = z2;
    out[3] = persp;
    return out;
  }

  /* ── node inspector ─────────────────────────────────────────────────── */
  const same = (a: RGB | null, b: RGB) => !!a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const regionOfColour = (c: RGB | null): RegionKey | null => {
    if (!c) return null;
    if (same(c, st.coreColor)) return 'core';
    for (const k of Object.keys(REGION_INFO) as Exclude<RegionKey, 'stem'>[]) if (k !== 'core' && same(c, colorOf(k))) return k;
    return null;
  };
  const codeOf = (r: RegionKey) => (r === 'stem' ? 'BRAIN STEM' : REGION_INFO[r].code);
  function describeSignal(sg: Signal): string {
    const from = regionOfColour(sg.c0), to = regionOfColour(sg.c1);
    if (same(sg.c0, COL.idle)) return 'background activity while he rests';
    if (from === 'hearing') return to === 'reflex' ? 'your words, recognised as an everyday phrase' : 'your words, heading in to be understood';
    if (from === 'reflex') return 'an instant pre-recorded reply, skipping the model';
    if (from === 'core' && to === 'voice') return 'his reply, on its way to be spoken';
    if (from === 'core' && to) {
      const tool = [...st.activeTools.entries()].find(([, r]) => r === to);
      return tool ? `a request to ${codeOf(to)}: ${TOOL_WORDS[tool[0]] ?? tool[0]}` : `the core reaching into ${codeOf(to)}`;
    }
    if (to === 'core' && from) return from === 'memory' ? 'a thought: memory feeding the cognition core' : `a result from ${codeOf(from)}, back to the core`;
    if (from === 'conscience') return 'a self-check';
    if (from) return `activity inside ${codeOf(from)}`;
    return 'a signal';
  }
  let sel: number | null = null;

  // Pin the core's nodes to the language model's real parts, and the vocoder's to the voice model's,
  // in order from back to front. Bigger parts get more nodes; every part gets at least one; when there
  // are more parts than nodes, neighbouring layers share.
  let model: ModelInfo | null = null;
  const pins = new Map<number, NodePin>();
  const PLUMBING = new Set(['norm', 'mixing', 'other', 'voice_other', 'voice_mel']);
  function mergeLayers(units: ModelUnit[], chunk: number): ModelUnit[] {
    if (chunk <= 1) return units;
    const out: ModelUnit[] = [], at = new Map<string, ModelUnit>();
    for (const u of units) {
      if (u.layer == null) { out.push(u); continue; }
      const key = `${u.kind}:${Math.floor(u.layer / chunk)}`;
      const m = at.get(key);
      if (m) { m.weights += u.weights; m.layerTo = Math.max(m.layerTo ?? m.layer!, u.layer); m.count = (m.count ?? 0) + (u.count ?? 0); }
      else { const c = { ...u, layerTo: u.layer }; at.set(key, c); out.push(c); }
    }
    return out;
  }
  function pinRegion(region: RegionKey, all: ModelUnit[], src: 'llm' | 'voice') {
    const ids = (byRegion[region] ?? []).slice().sort((a, b) => neurons[a].x - neurons[b].x || neurons[b].y - neurons[a].y);
    const N = ids.length;
    if (!N) return;
    let units = all.filter(u => !PLUMBING.has(u.kind) && u.weights > 0);
    for (let chunk = 1; chunk <= 512; chunk *= 2) {
      const m = mergeLayers(units, chunk);
      if (m.length <= N || chunk === 512) { units = m; break; }
    }
    units = units.slice(0, N);
    const counts = units.map(() => 1), rest = N - units.length, tot = units.reduce((a, u) => a + u.weights, 0) || 1;
    const quota = units.map(u => (u.weights / tot) * rest);
    quota.forEach((q, i) => { counts[i] += Math.floor(q); });
    let left = N - counts.reduce((a, b) => a + b, 0);
    const order = quota.map((q, i) => [q - Math.floor(q), i] as const).sort((a, b) => b[0] - a[0]);
    for (const [, i] of order) { if (left <= 0) break; counts[i]++; left--; }
    let k = 0;
    units.forEach((u, i) => { for (let c = 0; c < counts[i] && k < N; c++) pins.set(ids[k++], { src, unit: u, share: counts[i] }); });
  }
  function pinAll() {
    pins.clear();
    if (model?.llm?.units?.length) pinRegion('core', model.llm.units, 'llm');
    if (model?.voice?.units?.length) pinRegion('voice', model.voice.units, 'voice');
  }
  let sx = new Float32Array(0), sy = new Float32Array(0), sr = new Float32Array(0), sz = new Float32Array(0);   // where each node was drawn

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
    if (!cam.dragging && !cam.user) { cam.tYaw *= Math.exp(-dt * 1.5); cam.tPitch *= Math.exp(-dt * 1.5); }
    const sw = cam.user ? 0 : 1;
    cam.yaw += (swayYaw * sw + cam.tYaw - 0.28 - cam.yaw) * Math.min(1, dt * 6);
    cam.pitch += (-0.12 + swayPitch * sw + cam.tPitch - cam.pitch) * Math.min(1, dt * 6);
    if (reduced()) { signals = []; sparks = []; return; }

    const phase = phaseNow();
    st.phase = phase;
    const c = st.carry;
    if (phase === 'idle' || phase === 'listening' || phase === 'speaking') {   // the resting trickle keeps going while a mic is open or he talks
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
        n.fires++; n.lastFired = now(); n.lastBy = sg.why ?? (sg.why = describeSignal(sg));
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
  // dots grow a little with zoom (not fully, so the nodes separate as you zoom in)
  const unit = () => clamp(vp.baseScale / 300, 0.8, 1.6);
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
    const cx = Number.isFinite(P[0]) ? P[0] : vp.cx, cy = Number.isFinite(P[1]) ? P[1] : vp.cy, R = vp.scale * 1.2 * Math.max(1, zoomLevel());
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
    if (sx.length !== neurons.length) { sx = new Float32Array(neurons.length); sy = new Float32Array(neurons.length); sr = new Float32Array(neurons.length); sz = new Float32Array(neurons.length); }
    for (let i = 0; i < neurons.length; i++) {
      const n = neurons[i];
      project(n.x, n.y, n.z);
      const depth = clamp((P[2] + 0.8) / 1.6, 0, 1), e = n.energy;
      let a = 0.11 + depth * 0.3 + (hot[n.region] || 0) * 0.22 + Math.sin(clock * 1.7 + n.ph) * 0.04 + breath * 0.03;
      if (n.region === 'conscience') a *= 0.55 + st.conscience;           // a quiet band until it fires
      const s = (1.5 + n.size * 1.6) * P[3] * u * (1 + e * 0.6);
      sx[i] = P[0]; sy[i] = P[1]; sr[i] = s; sz[i] = P[2];
      if (!(P[3] > 0) || P[0] < -s || P[0] > width + s || P[1] < -s || P[1] > vp.eegTop + s) continue;
      const fade = clamp((cam.dist - P[2] - NEAR) / 0.35, 0, 1);       // ease out as it passes the camera
      ctx.globalAlpha = clamp(a + e * 0.6, 0, 1) * fade;
      const base = n.region === 'core' ? st.coreColor : colorOf(n.region);
      if (s > 3.5 * u) {                               // close up: a sharp circle, not a stretched image (u: big screens draw bigger at rest)
        ctx.fillStyle = `rgb(${base.join(',')})`;
        ctx.beginPath(); ctx.arc(P[0], P[1], s * 0.5, 0, TAU); ctx.fill();
        ctx.globalAlpha *= 0.35;
        ctx.beginPath(); ctx.arc(P[0], P[1], s * 0.85, 0, TAU); ctx.fill();
      } else ctx.drawImage(sprite(base, true), P[0] - s, P[1] - s, s * 2, s * 2);
      if (e > 0.2) {
        const h = Math.min(90, (5 + 9 * e) * P[3] * u);
        ctx.globalAlpha = clamp(e * 0.75, 0, 1);
        ctx.drawImage(sprite(n.lit || base), P[0] - h, P[1] - h, h * 2, h * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawSelection() {
    if (sel == null || !neurons[sel]) return;
    const n = neurons[sel], c = n.region === 'core' ? st.coreColor : colorOf(n.region);
    project(n.x, n.y, n.z);
    const x0 = P[0], y0 = P[1], selS = sr[sel] || 0;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.2;
    for (const j of n.nb) {                       // its connections: the paths signals can hop along
      const m = neurons[j], mc = m.region === 'core' ? st.coreColor : colorOf(m.region);
      project(m.x, m.y, m.z);
      if (!Number.isFinite(x0) || !Number.isFinite(P[0])) continue;   // one end is behind the camera
      const g = ctx.createLinearGradient(x0, y0, P[0], P[1]);
      g.addColorStop(0, `rgba(${c.join(',')},0.8)`); g.addColorStop(1, `rgba(${mc.join(',')},0.6)`);
      ctx.strokeStyle = g;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(P[0], P[1]); ctx.stroke();
      ctx.strokeStyle = `rgba(${mc.join(',')},0.8)`;
      if (P[3] > 0) { ctx.beginPath(); ctx.arc(P[0], P[1], 3 + 2 * P[3], 0, TAU); ctx.stroke(); }
    }
    ctx.globalCompositeOperation = 'source-over';
    if (!Number.isFinite(x0)) return;
    const r = Math.max(7 + 2.5 * Math.sqrt(zoomLevel()), selS * 0.6 + 4) + Math.sin(clock * 5) * 1.5;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x0, y0, r, 0, TAU); ctx.stroke();
    ctx.strokeStyle = `rgba(${c.join(',')},0.9)`;
    ctx.beginPath(); ctx.arc(x0, y0, r + 4, 0, TAU); ctx.stroke();
  }

  const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  function drawSignals() {
    const u = unit() * (width >= 760 ? 1.35 : 1), DOTS = width < 560 ? 9 : 14;   // a big screen has a busier field: bigger comets
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
  // Close up, the nearest big dots get a name: the model part a core/voice dot is pinned to, or the
  // piece of program code another dot stands for.
  const SHORT: Record<string, string> = {
    embedding: 'word lookup', attention: 'attention', linear_attention: 'fast attention', router: 'router', shared: 'shared expert',
    experts: 'experts', ffn: 'feed-forward', output: 'next-word scorer', drafter: 'drafter', voice_text: 'text encoder',
    voice_input: 'audio input', voice_time: 'step timing', voice_block: 'voice block', voice_output: 'sound output',
  };
  function nodeLabel(i: number): string {
    const pin = pins.get(i);
    if (pin) {
      const u = pin.unit, w = SHORT[u.kind] ?? u.kind, p = pin.src === 'llm' ? 'L' : 'B';
      if (u.layer == null) return w;
      return `${p}${u.layer + 1}${u.layerTo != null && u.layerTo !== u.layer ? `–${u.layerTo + 1}` : ''} · ${w}`;
    }
    const list = NODE_CODE[neurons[i].region];
    return list ? list[i % list.length][0] : REGION_INFO[neurons[i].region as Exclude<RegionKey, 'stem'>]?.code ?? '';
  }
  function drawNodeLabels() {
    if (zoomLevel() < 2.2) return;
    const cand: number[] = [];
    for (let i = 0; i < neurons.length; i++) {
      if (i === sel || (sr[i] > 14 && Number.isFinite(sx[i]) && sx[i] > 0 && sx[i] < width && sy[i] > 96 && sy[i] < vp.eegTop - 24)) cand.push(i);
    }
    cand.sort((a, b) => (b === sel ? 1e9 : sr[b]) - (a === sel ? 1e9 : sr[a]));
    const placed: [number, number, number, number][] = [];
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '600 10.5px "Share Tech Mono", ui-monospace, monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let shown = 0;
    for (const i of cand) {
      if (shown >= (width < 700 ? 10 : 24)) break;
      const text = nodeLabel(i);
      if (!text) continue;
      const tw = ctx.measureText(text).width + 10, x = sx[i] + sr[i] * 0.9 + 4, y = sy[i] - 8;
      if (!Number.isFinite(x) || x + tw > width - 4) continue;
      if (x < 160 && y > vp.eegTop - 80) continue;                    // keep clear of the zoom buttons
      if (placed.some(([px, py, pw]) => x < px + pw && x + tw > px && y < py + 16 && y + 16 > py)) continue;
      placed.push([x, y, tw, 16]); shown++;
      const n = neurons[i], c = n.region === 'core' ? st.coreColor : colorOf(n.region);
      const a = i === sel ? 1 : clamp((sr[i] - 14) / 8, 0, 1) * 0.85;
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(6,10,20,0.78)';
      cutRect(x, y, tw, 16, 4); ctx.fill();
      ctx.strokeStyle = `rgba(${c.join(',')},${i === sel ? 0.95 : 0.45})`; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = i === sel ? '#ffffff' : `rgba(${c.join(',')},0.95)`;
      ctx.fillText(text, x + 5, y + 8.5);
    }
    ctx.globalAlpha = 1;
  }
  function drawLabels() {
    const fadeOut = clamp((zoomLevel() - 1.15) / 0.4, 0, 1);    // zoomed in, the region callouts get out of the way
    if (fadeOut >= 1) return;
    const keep = 1 - fadeOut;
    const compact = width < 760;
    const keys = Object.keys(ANCHORS) as Exclude<RegionKey, 'stem'>[];
    ctx.globalCompositeOperation = 'source-over';
    ctx.textBaseline = 'middle';
    // where each region is on screen
    const items = keys.map(k => {
      const [x, y, z] = ANCHORS[k];
      project(x, y, z);
      return { k, ax: P[0], ay: P[1], hot: phaseNowHot(k), c: k === 'core' ? st.coreColor : colorOf(k) };
    }).filter(it => Number.isFinite(it.ax));
    if (compact) {
      ctx.font = '600 9.5px "Share Tech Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      for (const it of items) {
        const [x, y, z] = ANCHORS[it.k];
        project(x, y + (LABEL_DY[it.k] ?? 0.13), z);
        const text = REGION_INFO[it.k].code, tw = ctx.measureText(text).width + 12;
        if (!Number.isFinite(P[0])) continue;
        ctx.globalAlpha = (it.hot ? 1 : 0.75) * keep;
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
        const a = (it.hot ? 1 : 0.55) * keep;
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
    if (tooltip && now() < tooltip.until && fadeOut === 0) {
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
  /* ── the galaxy behind him: a tilted spiral turning slowly, and a field of distant stars ── */
  let galaxy: HTMLCanvasElement | null = null, galaxySize = 0;
  let farStars: { x: number; y: number; r: number; a: number; ph: number; tw: number; c: string }[] = [];
  function buildGalaxy() {
    const rand = rng(4242);
    const S = Math.min(3200, Math.ceil(Math.max(width, height) * 1.9 * dpr));
    if (galaxy && Math.abs(galaxySize - S) / galaxySize < 0.25) return;   // building it takes a moment; small resizes keep it
    galaxySize = S;
    galaxy = document.createElement('canvas');
    galaxy.width = galaxy.height = S;
    const g = galaxy.getContext('2d')!;
    const c = S / 2, R = S * 0.48;
    g.globalCompositeOperation = 'lighter';
    // the halo and the bright core
    const halo = g.createRadialGradient(c, c, 0, c, c, R);
    halo.addColorStop(0, 'rgba(255,236,200,0.55)');
    halo.addColorStop(0.06, 'rgba(255,200,140,0.32)');
    halo.addColorStop(0.2, 'rgba(150,120,255,0.10)');
    halo.addColorStop(0.55, 'rgba(40,80,200,0.05)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = halo; g.fillRect(0, 0, S, S);
    const arms = 4, twist = 3.1;
    const armPoint = (t: number, arm: number, spread: number) => {
      const r = Math.pow(t, 0.85) * R;
      const ang = arm * (Math.PI * 2 / arms) + t * twist * Math.PI + (rand() - 0.5) * spread;
      const jitter = (rand() - 0.5) * R * 0.06 * (0.4 + t);
      return [c + Math.cos(ang) * r + jitter, c + Math.sin(ang) * r + jitter, r / R] as const;
    };
    // dust and gas along the arms
    for (let i = 0; i < 140; i++) {
      const [x, y, f] = armPoint(0.08 + rand() * 0.9, i % arms, 0.5);
      const rad = S * (0.025 + rand() * 0.05) * (1.2 - f * 0.5);
      const hue = [[120, 80, 255], [60, 140, 255], [255, 90, 190], [80, 220, 255]][(rand() * 4) | 0];
      const cloud = g.createRadialGradient(x, y, 0, x, y, rad);
      cloud.addColorStop(0, `rgba(${hue.join(',')},${(0.07 + rand() * 0.06).toFixed(3)})`);
      cloud.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = cloud; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // the stars: warm near the core, blue-white out along the arms
    const N = 9000;
    for (let i = 0; i < N; i++) {
      const inArm = rand() < 0.78;
      const t = inArm ? Math.pow(rand(), 0.7) : Math.pow(rand(), 2.2) * 0.6;
      const [x, y, f] = armPoint(t, (rand() * arms) | 0, inArm ? 0.35 : 6.3);
      const warm = Math.max(0, 1 - f * 2.2);
      const col = `rgba(${Math.round(200 + 55 * warm)},${Math.round(215 + 10 * warm - 20 * warm)},${Math.round(255 - 110 * warm)},`;
      const big = rand() < 0.012;
      const sz = (big ? 1.6 + rand() * 1.6 : 0.5 + rand() * 0.9) * dpr;
      g.fillStyle = col + (big ? 0.95 : 0.25 + rand() * 0.5).toFixed(2) + ')';
      g.beginPath(); g.arc(x, y, sz, 0, Math.PI * 2); g.fill();
      if (big) {
        const gl = g.createRadialGradient(x, y, 0, x, y, sz * 5);
        gl.addColorStop(0, col + '0.35)'); gl.addColorStop(1, col + '0)');
        g.fillStyle = gl; g.fillRect(x - sz * 5, y - sz * 5, sz * 10, sz * 10);
      }
    }
    const fr = rng(77);
    farStars = Array.from({ length: Math.round(width * height / 2600) }, () => ({
      x: fr() * width, y: fr() * height, r: fr() < 0.06 ? 1.3 : 0.6 + fr() * 0.5, a: 0.15 + fr() * 0.55,
      ph: fr() * TAU, tw: 0.4 + fr() * 1.8, c: fr() < 0.2 ? '200,210,255' : fr() < 0.3 ? '255,225,200' : '235,240,255',
    }));
  }
  function drawGalaxy() {
    for (const st0 of farStars) {               // distant stars, twinkling
      if (st0.y > vp.eegTop) continue;
      const a = reduced() ? st0.a : st0.a * (0.65 + 0.35 * Math.sin(clock * st0.tw + st0.ph));
      ctx.fillStyle = `rgba(${st0.c},${a.toFixed(3)})`;
      ctx.fillRect(st0.x + cam.yaw * 6, st0.y, st0.r, st0.r);
    }
    if (!galaxy) return;
    const size = galaxySize / dpr;
    const busy = st.thinking || st.activeTools.size ? 1 : 0;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.8 + busy * 0.15;
    ctx.translate(vp.cx + cam.yaw * 30, vp.cy - vp.scale * 0.05);
    ctx.rotate(-0.42);                          // the disc's tilt on screen
    ctx.scale(1, 0.5 + cam.pitch * 0.12);       // seen at an angle; turning the brain tips it a little
    ctx.rotate(reduced() ? 0.6 : clock * 0.012);
    ctx.drawImage(galaxy, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

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
  function hitNode(mx: number, my: number): number | null {
    let best: number | null = null, bestD = Infinity;
    for (let i = 0; i < sx.length; i++) {
      if (!Number.isFinite(sx[i])) continue;
      const d = Math.hypot(sx[i] - mx, sy[i] - my), lim = Math.max(8, sr[i] * 1.2);
      const score = d / lim - sz[i] * 0.4;            // closer to the camera wins ties
      if (d < lim && score < bestD) { bestD = score; best = i; }
    }
    return best;
  }
  function select(i: number | null) { sel = i; opts.onNodeSelect?.(i); }
  const pointers = new Map<number, { x: number; y: number }>();
  let down: { x: number; y: number; lx: number; ly: number; t: number; moved: boolean; slide: boolean } | null = null;
  let pinch: { d: number; mx: number; my: number; dist: number } | null = null;
  let lastTap = { t: 0, x: 0, y: 0 };
  const local = (e: { clientX: number; clientY: number }) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const onMove = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {                // two fingers: fly in/out toward their middle, and slide
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2 - rect.left, my = (a.y + b.y) / 2 - rect.top;
      slide(mx - pinch.mx, my - pinch.my);
      dolly(mx, my, pinch.dist * pinch.d / Math.max(10, d));
      pinch.mx = mx; pinch.my = my; pinch.d = d; pinch.dist = cam.dist;
      return;
    }
    if (down) {
      const dx = e.clientX - down.lx, dy = e.clientY - down.ly;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true;
      if (!down.moved) return;
      down.lx = e.clientX; down.ly = e.clientY;
      cam.dragging = true; cam.user = true;
      if (down.slide) slide(dx, dy);
      else { cam.tYaw += dx * 0.006; cam.tPitch = clamp(cam.tPitch + dy * 0.005, -1.3, 1.3); }   // turn it any way
    } else if (e.pointerType === 'mouse') {
      const [mx, my] = local(e);
      canvas.style.cursor = hitNode(mx, my) != null ? 'pointer' : 'grab';
      const k = hitRegion(e.clientX, e.clientY);
      if (k && zoomLevel() < 1.2 && (!tooltip || tooltip.key !== k || now() > tooltip.until)) tooltip = { key: k, until: now() + 3 };
    }
  };
  const onDown = (e: PointerEvent) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], rect = canvas.getBoundingClientRect();
      pinch = { d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2 - rect.left, my: (a.y + b.y) / 2 - rect.top, dist: cam.dist };
      if (down) down.moved = true;
      return;
    }
    down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), moved: false, slide: e.button === 2 || e.shiftKey };
  };
  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) { pinch = null; down = null; cam.dragging = false; } return; }
    if (down && !down.moved && performance.now() - down.t < 350) {
      const [mx, my] = local(e), t = performance.now();
      if (t - lastTap.t < 320 && Math.hypot(mx - lastTap.x, my - lastTap.y) < 30) {   // double tap: fly toward it, or back out
        if (cam.dist > 1.2) dolly(mx, my, cam.dist * 0.45); else resetView();
        lastTap.t = 0;
      } else {
        lastTap = { t, x: mx, y: my };
        const node = hitNode(mx, my);
        if (node != null) select(node);
        else {
          if (sel != null) select(null);
          const k = zoomLevel() < 1.2 ? hitRegion(e.clientX, e.clientY) : null;
          if (k) { tooltip = { key: k, until: now() + 3.5 }; opts.onRegionTap?.(k); }
        }
      }
    }
    down = null;
    cam.dragging = false;
  };
  const onLeave = () => { /* the view stays where you left it */ };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const [mx, my] = local(e);
    dolly(mx, my, cam.dist * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));   // ctrlKey: a trackpad pinch
  };
  function resetView() { cam.dist = FOCAL; cam.ox = 0; cam.oy = 0; cam.tYaw = 0; cam.tPitch = 0; cam.user = false; }
  canvas.addEventListener('contextmenu', ev => ev.preventDefault());
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.style.touchAction = 'none';   // the brain handles pinch and drag itself
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
    if (rebuild) { signals = []; build(); pinAll(); if (sel != null) select(null); }
    buildHexGrid();
    buildGalaxy();
  }
  function frame(ts: number) {
    if (document.hidden) { raf = 0; return; }
    // A 144 or 240 Hz screen would draw him that often, all on the CPU: 60 frames a second is plenty
    // while he is busy, and 30 while he rests.
    const busy = st.thinking || st.activeTools.size || st.voicing || st.speaking || st.listening || signals.length > 24;
    if (last && ts - last < (busy ? 1000 / 60 : 1000 / 30) - 2) { raf = requestAnimationFrame(frame); return; }
    const dt = last ? clamp((ts - last) / 1000, 0.001, 0.25) : 0.016;   // a slow or throttled browser still runs at real speed
    last = ts;
    simulate(dt);
    stepEeg(dt);
    rot.cy = Math.cos(cam.yaw); rot.sy = Math.sin(cam.yaw); rot.cp = Math.cos(cam.pitch); rot.sp = Math.sin(cam.pitch);
    viewport();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
    drawGalaxy();
    if (hexGrid) ctx.drawImage(hexGrid, 0, 0, width, height);
    drawBackdrop();
    drawNeurons();
    drawSignals();
    drawSelection();
    drawLabels();
    drawNodeLabels();
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
    /** Zoom by a factor about the middle of the view (the +/− buttons). */
    zoomBy(f: number) { dolly(vp.cx, vp.cy, cam.dist / f); },
    resetView,
    select,
    /** The real model parts to pin the nodes to (from /api/brain/model). */
    setModel(m: ModelInfo | null) { model = m; pinAll(); },
    /** The selected node, for the inspector card. */
    inspect() {
      if (sel == null || !neurons[sel]) return null;
      const n = neurons[sel];
      const nbs: Record<string, number> = {};
      for (const j of n.nb) { const r = neurons[j].region; nbs[r] = (nbs[r] ?? 0) + 1; }
      return { id: sel, region: n.region, energy: +n.energy.toFixed(2), fires: n.fires,
        lastAgo: n.lastFired < 0 ? null : +(now() - n.lastFired).toFixed(1), lastBy: n.lastBy, surface: n.shell,
        neighbours: nbs, links: n.nb.length, total: neurons.length, pin: pins.get(sel) ?? null };
    },
    /** Send a pulse out from the selected node along its connections. */
    ping() {
      if (sel == null) return;
      const from = sel, n = neurons[from], c = n.region === 'core' ? st.coreColor : colorOf(n.region);
      const far = neurons.map((_, j) => j).filter(j => Math.hypot(neurons[j].x - n.x, neurons[j].y - n.y) > 0.35);
      for (let i = 0; i < 5 && far.length; i++) {
        const goal = pick(far), m = neurons[goal];
        makeSignal(walk(from, goal), { c0: c, c1: m.region === 'core' ? st.coreColor : colorOf(m.region), speed: 1.4, tail: 0.3, w: 1.2, why: 'a test pulse you sent from the inspector' });
      }
      n.energy = 1;
    },
    stats: () => ({ zoom: +zoomLevel().toFixed(2), selected: sel, glyphs: glyphs.length, queued: wordQ.length, signals: signals.length, neurons: neurons.length, width, height,
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
      canvas.removeEventListener('wheel', onWheel);
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
  get_calendar: 'checking your calendar', add_calendar_event: 'adding to your calendar', update_calendar_event: 'moving an event',
  delete_calendar_event: 'removing an event',
  get_email: 'checking your email', read_email: 'reading an email', draft_email: 'drafting an email', draft_reply: 'drafting a reply',
  list_adventures: 'opening the adventure book', start_adventure: 'starting an adventure', pause_adventure: 'pausing the adventure',
  end_adventure: 'ending the adventure', note_fact: 'noting a fact for the chronicle',
};

export type Brain = ReturnType<typeof createBrain>;
