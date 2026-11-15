// Delamain's core chamber: the mainframe room behind the voice. A tall cognition core in
// the middle (tinted with the active personality core), nine subsystem racks in a horseshoe
// around it, and data packets running along floor conduits between them. Driven by the same
// brain events as the brain view (brain.py), with the same interface as brainRenderer.ts.

import { REGION_INFO, TOOL_WORDS, type BrainEvent, type BrainOptions, type RegionKey, type SpeechClock } from './brainRenderer';

type RGB = [number, number, number];
type Rack = Exclude<RegionKey, 'core' | 'stem'>;
type V3 = [number, number, number];

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const hex = (h: string): RGB => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// The racks stand in a shallow arc behind the core, left to right, all facing it: hearing on the
// far left (your words come in from that side), the voice on the far right (his go out there).
// The simulation engine sits right behind the core.
const RACK_ORDER: Rack[] = ['hearing', 'reflex', 'senses', 'navigation', 'imagination', 'memory', 'plans', 'conscience', 'voice'];
const SPACING = 0.62, RACK_W = 0.42, RACK_H = 1.55, RACK_D = 0.3, CORE_R = 0.3, CORE_H = 2.3;
const CAM_Y = 2.35, CAM_Z = 5.6;

export function createCore(canvas: HTMLCanvasElement, stage: HTMLElement, opts: BrainOptions = {}) {
  const ctx = canvas.getContext('2d')!;
  let width = 800, height = 420, dpr = 1, raf = 0, last = 0, clock = 0;
  const reduced = () => !!opts.reducedMotion;
  const COL: Record<string, RGB> = { red: [251, 113, 133], white: [236, 246, 255] };
  for (const [k, v] of Object.entries(REGION_INFO)) COL[k] = hex(v.color);
  const colorOf = (r: RegionKey): RGB => COL[r] ?? COL.white;

  const glowCache = new Map<string, HTMLCanvasElement>();
  const glow = (rgb: RGB) => {
    const key = rgb.map(Math.round).join(',');
    let c = glowCache.get(key);
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d')!, gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      const [r, gg, b] = rgb.map(Math.round);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, `rgba(${r},${gg},${b},0.95)`);
      gr.addColorStop(0.4, `rgba(${r},${gg},${b},0.3)`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64); glowCache.set(key, c);
    }
    return c;
  };

  /* ── world layout ──────────────────────────────────────────────────── */
  type RackGeo = { key: Rack; pos: V3; inward: V3; side: V3; leds: { r: number; c: number; ph: number; e: number }[]; heat: number };
  const racks: RackGeo[] = RACK_ORDER.map((key, i) => {
    const x = (i - (RACK_ORDER.length - 1) / 2) * SPACING;
    const z = -1.45 + 0.95 * (x / 2.5) ** 2;                 // a shallow arc, bowing toward the viewer at the ends
    const len = Math.hypot(x, z), inward: V3 = [-x / len, 0, -z / len];
    const leds = [];
    for (let r = 0; r < 16; r++) for (let c = 0; c < 4; c++) leds.push({ r, c, ph: Math.random() * TAU, e: 0 });
    return { key, pos: [x, 0, z], inward, side: [-inward[2], 0, inward[0]], leds, heat: 0 };
  });
  const rackOf = (k: Rack) => racks.find(r => r.key === k)!;
  // The floor just in front of a rack, and a point on its front panel
  const rackFoot = (k: Rack): V3 => { const r = rackOf(k), d = RACK_D / 2 + 0.03; return [r.pos[0] + r.inward[0] * d, 0.02, r.pos[2] + r.inward[2] * d]; };
  const rackFace = (k: Rack, h = 0.95): V3 => { const r = rackOf(k), d = RACK_D / 2 + 0.01; return [r.pos[0] + r.inward[0] * d, h, r.pos[2] + r.inward[2] * d]; };
  const CORE_BASE: V3 = [0, 0.02, 0];

  /* ── camera ────────────────────────────────────────────────────────── */
  const cam = { yaw: 0, tYaw: 0, pitch: 0, tPitch: 0, dragging: false };
  let vp = { cx: 0, cy: 0, f: 1, eegTop: 0, eegH: 0 };
  const P = [0, 0, 0];
  function viewport() {
    const eegH = clamp(Math.round(height * 0.12), 36, 66);
    const eegTop = height - eegH;
    // fit about 5.6 units of width and 2.9 of height (floor to the core's crown) into the stage
    const f = Math.min(width * 0.98 * CAM_Z / 5.6, eegTop * 0.92 * CAM_Z / 2.9);
    // lens shift: put the room's middle (y ~ 1.2) a little above the stage's centre
    vp = { cx: width / 2, cy: eegTop * 0.5 - (CAM_Y - 1.2) * (f / (CAM_Z + 0.6)), f, eegTop, eegH };
  }
  // World → screen: orbit the chamber by yaw, look slightly down at it from the front.
  function project(x: number, y: number, z: number, out = P) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
    const camY = CAM_Y + cam.pitch, z2 = CAM_Z - z1;
    const k = vp.f / Math.max(0.3, z2);
    out[0] = vp.cx + x1 * k;
    out[1] = vp.cy - (y - camY) * k;
    out[2] = z2;
    return out;
  }
  const scaleAt = (z: number) => vp.f / Math.max(0.3, z) / 300;

  /* ── packets (data on the conduits) ─────────────────────────────────── */
  type Packet = { path: V3[]; cum: number[]; len: number; s: number; speed: number; c0: RGB; c1: RGB | null; w: number; tail: number; onEnd?: () => void; done?: boolean; alpha: number };
  let packets: Packet[] = [];
  const sparks: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; col: RGB }[] = [];
  const maxPackets = () => (width < 560 ? 50 : 110);
  function curve(a: V3, b: V3, lift = 0, bend = 0.25, n = 16): V3[] {
    // a floor conduit that bows sideways a little (or an overhead cable when lift > 0)
    const mx = (a[0] + b[0]) / 2, mz = (a[2] + b[2]) / 2;
    const px = -(b[2] - a[2]) * bend, pz = (b[0] - a[0]) * bend;
    const c: V3 = [mx + px, Math.max(a[1], b[1]) + lift, mz + pz];
    const pts: V3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1], u * u * a[2] + 2 * u * t * c[2] + t * t * b[2]]);
    }
    return pts;
  }
  function send(path: V3[], o: Partial<Packet> & { c0: RGB }) {
    if (packets.length >= maxPackets()) return;
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]));
    packets.push({ path, cum, len: cum[cum.length - 1], s: 0, speed: 1.6, c1: null, w: 1, tail: 0.35, alpha: 1, ...o });
  }
  const jitter = (): number => (Math.random() - 0.5) * 0.12;
  const toCore = (k: Rack, o: Partial<Packet> = {}) => { const f = rackFoot(k); send(curve(f, [CORE_BASE[0] + jitter(), 0.02, CORE_BASE[2] + jitter()], 0, 0.18 + jitter()), { c0: colorOf(k), c1: st.coreColor, onEnd: () => { st.coreKick = Math.min(1, st.coreKick + 0.25); }, ...o }); };
  const fromCore = (k: Rack, o: Partial<Packet> = {}) => { const f = rackFoot(k); send(curve([jitter(), 0.02, jitter()], f, 0, -0.18 + jitter()), { c0: st.coreColor, c1: colorOf(k), onEnd: () => kickRack(k, 0.5), ...o }); };
  const reflexArc = () => send(curve(rackFace('reflex', RACK_H + 0.05), rackFace('voice', RACK_H + 0.05), 1.15, 0), { c0: colorOf('reflex'), w: 1.3, speed: 2.6, tail: 0.6, onEnd: () => kickRack('voice', 1) });
  function posAt(p: Packet, s: number, out: V3) {
    s = clamp(s, 0, p.len);
    let i = 1;
    while (i < p.cum.length - 1 && p.cum[i] < s) i++;
    const t = (s - p.cum[i - 1]) / (p.cum[i] - p.cum[i - 1] || 1), a = p.path[i - 1], b = p.path[i];
    out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t;
  }
  function burst(at: V3, col: RGB, n: number, spd: number) {
    if (sparks.length > 220) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, b = Math.acos(Math.random() * 2 - 1), v = spd * (0.4 + Math.random() * 0.6);
      sparks.push({ x: at[0], y: at[1], z: at[2], vx: Math.sin(b) * Math.cos(a) * v, vy: Math.cos(b) * v, vz: Math.sin(b) * Math.sin(a) * v, life: 1, col });
    }
  }
  function kickRack(k: Rack, amt: number) {
    const r = rackOf(k);
    r.heat = Math.min(1, r.heat + amt);
    for (let i = 0; i < 10; i++) { const l = r.leds[(Math.random() * r.leds.length) | 0]; l.e = 1; }
  }

  /* ── state ─────────────────────────────────────────────────────────── */
  const st = {
    phase: 'idle', coreColor: hex('#00f0ff'), thinking: 0, scribe: false, tools: new Map<string, Rack>(), voicing: 0,
    speaking: false, speakingUntil: 0, hearingUntil: 0, listening: false, tps: null as number | null,
    conscience: 0, glitch: 0, coreKick: 0, coreSpin: 0, plasma: 0, liveFedAt: -99, liveWords: 0,
    carry: { think: 0, tool: 0, voice: 0, idle: 0, hear: 0 },
  };
  const now = () => performance.now() / 1000;

  /* ── words ─────────────────────────────────────────────────────────── */
  type Glyph = { w: string; x: number; y: number; z: number; vx: number; vy: number; life: number; col: RGB; inbound: boolean; t?: V3 };
  const glyphs: Glyph[] = [];
  const wordQ: { w: string; col: RGB; inbound: boolean }[] = [];
  let wordCool = 0, lane = 0;
  let utter: { id: number; words: { w: string; frac: number; out: boolean }[]; clock: SpeechClock; col: RGB; chars: number } | null = null;
  let speechSynced = false;
  function queueWords(text: string, col: RGB, inbound: boolean) {
    for (const w of text.replace(/[*`#>_[\]]/g, '').split(/\s+/).filter(Boolean).slice(0, inbound ? 14 : 40)) wordQ.push({ w: w.slice(0, 18), col, inbound });
    const cap = inbound ? 14 : 44;
    if (wordQ.length > cap) wordQ.splice(0, wordQ.length - cap);
  }
  function emitOut(w: string, col: RGB, speed: number) {
    const L = [0, 3, 1, 4, 2][lane++ % 5] - 2;
    if (glyphs.length >= (width < 560 ? 10 : 18)) glyphs.shift();
    const at = rackFace('voice', 1.25);
    glyphs.push({ w, col, inbound: false, x: at[0], y: at[1] + L * 0.05, z: at[2], vx: 0.32 * speed, vy: (L * 0.04 + 0.06) * speed, life: 1 });
    burst(at, col, 3, 0.15);
    kickRack('voice', 0.3);
  }
  function emitIn(w: string, col: RGB) {
    const L = [0, 3, 1, 4, 2][lane++ % 5] - 2;
    if (glyphs.length >= (width < 560 ? 10 : 18)) glyphs.shift();
    const t = rackFace('hearing', 1.2);
    glyphs.push({ w, col, inbound: true, x: t[0] - 1.6, y: t[1] + 0.3 + L * 0.08, z: t[2] + 0.4, vx: 0, vy: 0, life: 1, t });
  }

  /* ── events ────────────────────────────────────────────────────────── */
  function event(ev: BrainEvent) {
    const t = now();
    switch (ev.kind) {
      case 'heard':
        st.hearingUntil = t + 1.6;
        if (!reduced() && typeof ev.text === 'string' && t - st.liveFedAt > 15) queueWords(ev.text, colorOf('hearing'), true);
        kickRack('hearing', 1);
        for (let i = 0; i < 5; i++) toCore('hearing', { s: -i * 0.12 });
        break;
      case 'reflex':
        kickRack('reflex', 1);
        burst(rackFace('reflex', 1.0), colorOf('reflex'), 14, 0.3);
        send(curve(rackFoot('hearing'), rackFoot('reflex'), 0, 0.1), { c0: colorOf('hearing'), c1: colorOf('reflex'), speed: 2.4, onEnd: reflexArc });
        flare(ev.what ? `reflex · ${String(ev.what).replace(/_/g, ' ')}` : 'reflex', rackFace('reflex', RACK_H + 0.3), colorOf('reflex'));
        break;
      case 'think_start': st.thinking++; st.scribe = ev.source === 'scribe'; break;
      case 'think_end': {
        st.thinking = Math.max(0, st.thinking - 1);
        if (typeof ev.tps === 'number') st.tps = ev.tps;
        const calls = Array.isArray(ev.calls) ? (ev.calls as string[]) : [];
        const out = Number(ev.completion_tokens) || 0, ms = Number(ev.ms) || 0;
        if (ev.ok !== false && (out || ms)) flare(`${out ? `${out} tokens · ` : ''}${(ms / 1000).toFixed(1)} s · ${ev.source === 'scribe' ? 'chronicle' : calls.length ? `→ ${calls.length} tool${calls.length > 1 ? 's' : ''}` : 'reply'}`, [0, CORE_H + 0.35, 0], st.coreColor);
        if (ev.source === 'scribe') for (let i = 0; i < 5; i++) fromCore('imagination', { s: -i * 0.1 });
        break;
      }
      case 'tool_start': {
        const r = (ev.region as Rack) || 'senses';
        st.tools.set(String(ev.name), r);
        for (let i = 0; i < 5; i++) fromCore(r, { s: -i * 0.1, w: 1.1 });
        flare(TOOL_WORDS[String(ev.name)] || String(ev.name).replace(/_/g, ' '), rackFace(r, RACK_H + 0.3), colorOf(r));
        break;
      }
      case 'tool_end': {
        const r = (ev.region as Rack) || 'senses';
        st.tools.delete(String(ev.name));
        kickRack(r, 1);
        for (let i = 0; i < 6; i++) toCore(r, { s: -i * 0.1, w: 1.1 });
        break;
      }
      case 'correction':
        st.conscience = 1; st.glitch = 1;
        kickRack('conscience', 1);
        burst(rackFace('conscience', 1.0), colorOf('conscience'), 18, 0.35);
        break;
      case 'navigate':
        kickRack('navigation', 1);
        for (let i = 0; i < 6; i++) fromCore('navigation', { s: -i * 0.1 });
        break;
      case 'voice_start': st.voicing++; break;
      case 'voice_end': st.voicing = Math.max(0, st.voicing - 1); break;
      case 'spoke': {
        const text = typeof ev.text === 'string' ? ev.text : '';
        st.speakingUntil = t + clamp(text.length / 15, 1.5, 14);
        if (!reduced() && text && !speechSynced) queueWords(text, st.coreColor, false);
        break;
      }
      case 'error': st.glitch = 1; break;
    }
  }
  const flares: { text: string; at: V3; life: number; col: RGB }[] = [];
  function flare(text: string, at: V3, col: RGB) { flares.push({ text, at: [...at] as V3, life: 1, col }); if (flares.length > 4) flares.shift(); }
  function setCore(color: string) {
    const c = hex(color);
    if (c.join() === st.coreColor.join()) return;
    st.coreColor = c; COL.core = c; st.coreKick = 1;
  }

  /* ── simulation ────────────────────────────────────────────────────── */
  function phaseNow() {
    const t = now();
    if (st.conscience > 0.4) return 'conscience';
    if (st.listening) return 'listening';
    if (st.tools.size) return 'tool';
    if (st.thinking) return st.scribe ? 'scribe' : 'thinking';
    if (st.voicing) return 'voice';
    if (t < st.hearingUntil) return 'hearing';
    if (st.speaking || t < st.speakingUntil) return 'speaking';
    return 'idle';
  }
  const hot = (k: Rack) => {
    const p = st.phase;
    if (k === 'hearing') return p === 'hearing' || p === 'listening';
    if (k === 'voice') return p === 'voice' || p === 'speaking';
    if (k === 'conscience') return st.conscience > 0.3;
    if (k === 'imagination' && p === 'scribe') return true;
    return [...st.tools.values()].includes(k);
  };

  function simulate(dt: number) {
    clock += dt;
    st.phase = phaseNow();
    st.conscience = Math.max(0, st.conscience - dt * 0.35);
    st.glitch = Math.max(0, st.glitch - dt * 2.2);
    st.coreKick = Math.max(0, st.coreKick - dt * 0.9);
    const busy = st.thinking ? 1 : st.phase === 'idle' ? 0.08 : 0.35;
    st.plasma += (busy - st.plasma) * Math.min(1, dt * 2);
    st.coreSpin += dt * (0.25 + st.plasma * 2.2 + st.coreKick);
    if (!cam.dragging) { cam.tYaw *= Math.exp(-dt * 1.5); cam.tPitch *= Math.exp(-dt * 1.5); }
    const sway = reduced() ? 0 : Math.sin(clock * 0.11) * 0.12;
    cam.yaw += (sway + cam.tYaw - cam.yaw) * Math.min(1, dt * 3);
    cam.pitch += (cam.tPitch - cam.pitch) * Math.min(1, dt * 3);

    for (const r of racks) {
      r.heat = Math.max(hot(r.key) ? 0.75 : 0, r.heat - dt * 0.8);
      for (const l of r.leds) l.e *= Math.exp(-dt * 3);
      if (hot(r.key) && !reduced()) {             // a scrolling wave down the LEDs while it works
        const row = Math.floor((clock * 9) % 16);
        for (const l of r.leds) if (l.r === row || Math.random() < dt * 2) l.e = Math.max(l.e, 0.9);
      }
    }
    if (reduced()) { packets = []; return; }

    const c = st.carry;
    if (st.phase === 'idle') {
      c.idle += dt * 0.8;
      while (c.idle >= 1) { c.idle--; const r = racks[(Math.random() * racks.length) | 0].key; (Math.random() < 0.5 ? toCore : fromCore)(r, { alpha: 0.45, w: 0.7, speed: 0.8 }); }
    }
    if (st.phase === 'listening' || st.phase === 'hearing') {
      c.hear += dt * (st.phase === 'hearing' ? 8 : 3);
      while (c.hear >= 1) { c.hear--; toCore('hearing', { speed: 1.4 }); }
    }
    if (st.thinking) {
      c.think += dt * clamp((st.tps ?? 20) / 3, 4, 14);
      while (c.think >= 1) { c.think--; const r: Rack = Math.random() < 0.5 ? 'memory' : (['hearing', 'senses', 'navigation'] as Rack[])[(Math.random() * 3) | 0]; toCore(r, { speed: 1.8 }); }
    }
    if (st.tools.size) {
      c.tool += dt * 6;
      while (c.tool >= 1) { c.tool--; const r = [...st.tools.values()][(Math.random() * st.tools.size) | 0]; (Math.random() < 0.5 ? fromCore : toCore)(r, { speed: 1.9 }); }
    }
    if (st.voicing) { c.voice += dt * 6; while (c.voice >= 1) { c.voice--; fromCore('voice', { speed: 2 }); } }

    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i];
      p.s += p.speed * dt;
      if (!p.done && p.s >= p.len) { p.done = true; p.onEnd?.(); }
      if (p.s - p.tail >= p.len) packets.splice(i, 1);
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.vy -= dt * 0.4; s.life -= dt * 2;
      if (s.life <= 0) sparks.splice(i, 1);
    }
    for (let i = flares.length - 1; i >= 0; i--) { flares[i].life -= dt * 0.33; flares[i].at[1] += dt * 0.08; if (flares[i].life <= 0) flares.splice(i, 1); }

    // his words, timed to the audio
    if (utter) {
      const u = utter, t = u.clock.time();
      let dur = u.clock.duration();
      if (!Number.isFinite(dur) || dur <= 0) dur = u.clock.speechAt + u.chars / 14;
      const span = Math.max(0.5, (dur - u.clock.speechAt) * 0.94);
      const speed = clamp(u.words.length / span / 2.6, 0.7, 1.7);
      let left = 0;
      for (const w of u.words) { if (w.out) continue; if (t >= u.clock.speechAt + w.frac * span) { w.out = true; emitOut(w.w, u.col, speed); } else left++; }
      if (!left || t > dur + 1) utter = null;
    }
    wordCool -= dt;
    if (wordQ.length && wordCool <= 0) {
      const q = wordQ.shift()!;
      if (q.inbound) emitIn(q.w, q.col); else emitOut(q.w, q.col, 1);
      wordCool = 0.15;
    }
    for (let i = glyphs.length - 1; i >= 0; i--) {
      const g = glyphs[i];
      if (g.inbound && g.t) {
        g.x += (g.t[0] - g.x) * Math.min(1, dt * 1.8); g.y += (g.t[1] - g.y) * Math.min(1, dt * 1.8); g.z += (g.t[2] - g.z) * Math.min(1, dt * 1.8);
        if (Math.hypot(g.x - g.t[0], g.y - g.t[1]) < 0.06) { burst(g.t, g.col, 3, 0.12); kickRack('hearing', 0.3); glyphs.splice(i, 1); }
      } else {
        g.x += g.vx * dt; g.y += g.vy * dt; g.life -= dt * 0.4;
        if (g.life <= 0) glyphs.splice(i, 1);
      }
    }
  }

  /* ── drawing ───────────────────────────────────────────────────────── */
  function drawRoom() {
    const g = ctx.createLinearGradient(0, 0, 0, vp.eegTop);
    g.addColorStop(0, '#04060b'); g.addColorStop(0.55, '#070b14'); g.addColorStop(1, '#05070c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, width, vp.eegTop);
    // floor grid
    ctx.lineWidth = 1;
    for (let i = -6; i <= 6; i++) {
      const a = project(i * 0.5, 0, -3.2, [0, 0, 0]), b = project(i * 0.5, 0, 3.2, [0, 0, 0]);
      ctx.strokeStyle = `rgba(0,243,255,${0.05 + (i === 0 ? 0.02 : 0)})`;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      const c = project(-3.2, 0, i * 0.5, [0, 0, 0]), d = project(3.2, 0, i * 0.5, [0, 0, 0]);
      ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.stroke();
    }
    // the core's light on the floor
    const base = project(0, 0, 0, [0, 0, 0]), k = scaleAt(base[2]) * 300;
    const [r, gg, b] = st.coreColor;
    const fg = ctx.createRadialGradient(base[0], base[1], 0, base[0], base[1], k * 1.6);
    fg.addColorStop(0, `rgba(${r},${gg},${b},${(0.18 + st.plasma * 0.2).toFixed(3)})`); fg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.translate(base[0], base[1]); ctx.scale(1, 0.32); ctx.translate(-base[0], -base[1]);
    ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(base[0], base[1], k * 1.6, 0, TAU); ctx.fill(); ctx.restore();
    // conduits: faint channels on the floor from each rack to the core
    for (const rk of racks) {
      const pts = curve(rackFoot(rk.key), CORE_BASE, 0, 0.18, 12);
      ctx.strokeStyle = `rgba(${colorOf(rk.key).join(',')},${(0.12 + rk.heat * 0.35).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach((p, i) => { project(p[0], p[1], p[2]); if (i) ctx.lineTo(P[0], P[1]); else ctx.moveTo(P[0], P[1]); });
      ctx.stroke();
    }
    // the reflex cable overhead
    const arc = curve(rackFace('reflex', RACK_H + 0.05), rackFace('voice', RACK_H + 0.05), 1.15, 0, 24);
    ctx.strokeStyle = `rgba(${colorOf('reflex').join(',')},${(0.12 + rackOf('reflex').heat * 0.4).toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    arc.forEach((p, i) => { project(p[0], p[1], p[2]); if (i) ctx.lineTo(P[0], P[1]); else ctx.moveTo(P[0], P[1]); });
    ctx.stroke();
  }

  // A rack: a dark box facing the core, its front panel full of status LEDs
  function drawRack(rk: RackGeo) {
    const inward = rk.inward, side = rk.side;
    const c = rk.pos, hw = RACK_W / 2, hd = RACK_D / 2;
    // where the camera is, in the room (it orbits by yaw)
    const camW: V3 = [-Math.sin(cam.yaw) * CAM_Z, CAM_Y + cam.pitch, Math.cos(cam.yaw) * CAM_Z];
    const corner = (sx: number, y: number, sz: number): V3 => [c[0] + side[0] * sx * hw + inward[0] * sz * hd, y, c[2] + side[2] * sx * hw + inward[2] * sz * hd];
    const proj = (v: V3) => { const o = [0, 0, 0]; project(v[0], v[1], v[2], o); return o; };
    const col = colorOf(rk.key), heat = rk.heat, isHot = hot(rk.key);
    if (heat > 0.05) {
      const ft = rackFoot(rk.key), fp = proj([ft[0] + inward[0] * 0.25, 0, ft[2] + inward[2] * 0.25]), fs = scaleAt(fp[2]) * 300 * 0.55;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.55 * heat;
      ctx.translate(fp[0], fp[1]); ctx.scale(1, 0.3);
      ctx.drawImage(glow(col), -fs, -fs, fs * 2, fs * 2);
      ctx.restore();
    }
    const faces: { pts: V3[]; shade: number; n: V3; front?: boolean }[] = [
      { pts: [corner(-1, 0, 1), corner(1, 0, 1), corner(1, RACK_H, 1), corner(-1, RACK_H, 1)], shade: 1, n: inward, front: true },
      { pts: [corner(1, 0, 1), corner(1, 0, -1), corner(1, RACK_H, -1), corner(1, RACK_H, 1)], shade: 0.55, n: side },
      { pts: [corner(-1, 0, -1), corner(-1, 0, 1), corner(-1, RACK_H, 1), corner(-1, RACK_H, -1)], shade: 0.55, n: [-side[0], 0, -side[2]] },
      { pts: [corner(-1, RACK_H, 1), corner(1, RACK_H, 1), corner(1, RACK_H, -1), corner(-1, RACK_H, -1)], shade: 0.75, n: [0, 1, 0] },
    ];
    // sides first, then the top, then the front panel on top of them
    faces.sort((a, b) => (a.front ? 1 : 0) - (b.front ? 1 : 0));
    for (const f of faces) {
      const m = f.pts.reduce((acc, q) => [acc[0] + q[0] / 4, acc[1] + q[1] / 4, acc[2] + q[2] / 4], [0, 0, 0]);
      if (f.n[0] * (camW[0] - m[0]) + f.n[1] * (camW[1] - m[1]) + f.n[2] * (camW[2] - m[2]) <= 0) continue;   // facing away
      const p = f.pts.map(proj);
      const base = 14 + f.shade * 12;
      ctx.fillStyle = `rgb(${base},${base + 6},${base + 16})`;
      ctx.beginPath(); p.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = `rgba(${col.join(',')},${(0.22 + heat * 0.75).toFixed(3)})`;
      ctx.lineWidth = isHot ? 1.6 : 1; ctx.stroke();
      if (f.front) {
        // LEDs, laid out on the panel by bilinear interpolation of its corners
        const at = (u: number, v: number) => {
          const x0 = p[0][0] + (p[1][0] - p[0][0]) * u, y0 = p[0][1] + (p[1][1] - p[0][1]) * u;
          const x1 = p[3][0] + (p[2][0] - p[3][0]) * u, y1 = p[3][1] + (p[2][1] - p[3][1]) * u;
          return [x0 + (x1 - x0) * v, y0 + (y1 - y0) * v];
        };
        const s = Math.max(1.2, scaleAt(p[0][2]) * 7);
        ctx.globalCompositeOperation = 'lighter';
        for (const l of rk.leds) {
          const [x, y] = at(0.2 + l.c * 0.2, 0.08 + l.r * 0.05);
          const tw = 0.12 + 0.08 * Math.sin(clock * (1.5 + l.c) + l.ph);
          const e = Math.max(l.e, isHot ? 0.55 : 0);
          ctx.fillStyle = `rgba(${col.join(',')},${clamp(tw + e * 0.85, 0, 1).toFixed(3)})`;
          ctx.fillRect(x - s / 2, y - s / 2, s * 1.6, s * 0.8);
        }
        // a status screen near the top
        const [sx0, sy0] = at(0.15, 0.93), [sx1, sy1] = at(0.85, 0.99);
        ctx.fillStyle = `rgba(${col.join(',')},${(0.15 + heat * 0.5).toFixed(3)})`;
        ctx.fillRect(Math.min(sx0, sx1), Math.min(sy0, sy1), Math.abs(sx1 - sx0), Math.max(2, Math.abs(sy1 - sy0)));
        if (heat > 0.1) {
          const [gx, gy] = at(0.5, 0.5), gs = scaleAt(p[0][2]) * 300 * 0.9 * heat;
          ctx.globalAlpha = 0.6 * heat;
          ctx.drawImage(glow(col), gx - gs, gy - gs * 1.6, gs * 2, gs * 3.2);
          ctx.globalAlpha = 1;
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  // The cognition core: stacked spinning rings around a column of plasma
  function drawCore() {
    const [r, g, b] = st.coreColor, act = st.plasma, kick = st.coreKick;
    const bot = project(0, 0, 0, [0, 0, 0]), top = project(0, CORE_H, 0, [0, 0, 0]);
    const k = scaleAt(bot[2]) * 300, w = CORE_R * k;
    // base plinth
    ctx.fillStyle = '#0b111c';
    ctx.beginPath(); ctx.ellipse(bot[0], bot[1], w * 1.9, w * 0.55, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(${r},${g},${b},0.5)`; ctx.lineWidth = 1.5; ctx.stroke();
    // plasma column
    ctx.globalCompositeOperation = 'lighter';
    const pg = ctx.createLinearGradient(bot[0] - w, 0, bot[0] + w, 0);
    pg.addColorStop(0, `rgba(${r},${g},${b},0)`);
    pg.addColorStop(0.5, `rgba(${r},${g},${b},${(0.25 + act * 0.45 + kick * 0.3).toFixed(3)})`);
    pg.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = pg;
    ctx.fillRect(bot[0] - w * 0.7, top[1], w * 1.4, bot[1] - top[1]);
    // bands of light rising up the column
    for (let i = 0; i < 6; i++) {
      const t = ((st.coreSpin * 0.35 + i / 6) % 1);
      const y = bot[1] + (top[1] - bot[1]) * t;
      ctx.globalAlpha = (0.25 + act * 0.6) * Math.sin(t * Math.PI);
      ctx.drawImage(glow(st.coreColor), bot[0] - w * 1.2, y - w * 0.4, w * 2.4, w * 0.8);
    }
    ctx.globalAlpha = 1;
    // rings
    for (let i = 0; i < 9; i++) {
      const y = 0.25 + i * ((CORE_H - 0.4) / 8);
      const c = project(0, y, 0, [0, 0, 0]), rr = (CORE_R + 0.06 + 0.04 * Math.sin(i * 1.7)) * scaleAt(c[2]) * 300;
      ctx.strokeStyle = `rgba(${r},${g},${b},${(0.35 + act * 0.45 + kick * 0.3).toFixed(3)})`;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([rr * 0.9, rr * 0.35]);
      ctx.lineDashOffset = -(st.coreSpin * (i % 2 ? 40 : -40));
      ctx.beginPath(); ctx.ellipse(c[0], c[1], rr, rr * 0.28, 0, 0, TAU); ctx.stroke();
    }
    ctx.setLineDash([]);
    // crown
    ctx.globalAlpha = 0.5 + act * 0.5;
    const cs = w * (2.2 + act + kick);
    ctx.drawImage(glow(st.coreColor), top[0] - cs, top[1] - cs, cs * 2, cs * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawPackets() {
    ctx.globalCompositeOperation = 'lighter';
    const v: V3 = [0, 0, 0];
    for (const p of packets) {
      if (p.s <= 0) continue;
      const head = Math.min(p.s, p.len), frac = p.s / p.len;
      const rgb = p.c1 ? p.c0.map((c0, i) => Math.round(c0 + (p.c1![i] - c0) * Math.round(frac * 4) / 4)) as RGB : p.c0;
      const spr = glow(rgb);
      for (let k = 9; k >= 0; k--) {
        const s = head - (k / 9) * p.tail;
        if (s < 0) continue;
        posAt(p, s, v); project(v[0], v[1], v[2]);
        const f = 1 - k / 10, sz = (k === 0 ? 7 : 2 + 4 * f) * p.w * scaleAt(P[2]);
        ctx.globalAlpha = clamp(f * f * 0.9 * p.alpha, 0, 1);
        ctx.drawImage(spr, P[0] - sz, P[1] - sz, sz * 2, sz * 2);
      }
    }
    for (const s of sparks) {
      project(s.x, s.y, s.z);
      const sz = (2 + 4 * s.life) * scaleAt(P[2]);
      ctx.globalAlpha = clamp(s.life, 0, 1);
      ctx.drawImage(glow(s.col), P[0] - sz, P[1] - sz, sz * 2, sz * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function cutRect(x: number, y: number, w: number, h: number, c: number) {
    ctx.beginPath(); ctx.moveTo(x + c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + c); ctx.closePath();
  }
  function drawLabels() {
    const compact = width < 760;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    const tags: { key: Exclude<RegionKey, 'stem'>; at: V3 }[] = racks.map(r => ({ key: r.key as Exclude<RegionKey, 'stem'>, at: rackFace(r.key, RACK_H + 0.12) }));
    tags.push({ key: 'core', at: [0, CORE_H + 0.12, 0] });
    ctx.font = `600 ${compact ? 9 : 10.5}px "Share Tech Mono", ui-monospace, monospace`;
    const th = compact ? 15 : 28;
    const placed: { x: number; y: number; w: number }[] = [];
    const boxes = tags.map(t => {
      project(t.at[0], t.at[1], t.at[2]);
      const tw = Math.max(ctx.measureText(REGION_INFO[t.key].code).width, compact ? 0 : 60) + 14;
      const x = clamp(P[0] - tw / 2, 4, width - tw - 4);
      let y = P[1] - th;
      // lift a tag above any it would overlap
      for (let guard = 0; guard < 6; guard++) {
        const hit = placed.find(b => x < b.x + b.w + 3 && x + tw + 3 > b.x && y < b.y + th + 3 && y + th + 3 > b.y);
        if (!hit) break;
        y = hit.y - th - 4;
      }
      placed.push({ x, y, w: tw });
      return { t, x, y, tw, ax: P[0], ay: P[1] };
    });
    for (const { t, x, y, tw, ax, ay } of boxes) {
      const isHot = t.key === 'core' ? !!st.thinking : hot(t.key as Rack), col = t.key === 'core' ? st.coreColor : colorOf(t.key);
      const code = REGION_INFO[t.key].code, sub = REGION_INFO[t.key].label;
      ctx.font = `600 ${compact ? 9 : 10.5}px "Share Tech Mono", ui-monospace, monospace`;
      if (y + th < ay - 4) {   // a lifted tag gets a thin line down to its rack
        ctx.strokeStyle = `rgba(${col.join(',')},0.35)`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + tw / 2, y + th); ctx.lineTo(ax, ay - 2); ctx.stroke();
      }
      ctx.globalAlpha = isHot ? 1 : 0.8;
      ctx.fillStyle = isHot ? 'rgba(6,10,20,0.9)' : 'rgba(6,10,20,0.6)';
      cutRect(x, y, tw, th, 5); ctx.fill();
      ctx.strokeStyle = `rgba(${col.join(',')},${isHot ? 0.95 : 0.4})`; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = isHot ? '#fff' : `rgb(${col.join(',')})`;
      ctx.fillText(code, x + tw / 2, y + (compact ? th / 2 : 9));
      if (!compact) {
        ctx.font = '500 10px Rajdhani, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(203,213,225,0.8)';
        ctx.fillText(sub, x + tw / 2, y + 21);
      }
    }
    ctx.globalAlpha = 1;
    if (tooltip && now() < tooltip.until) {
      const at = tooltip.key === 'core' ? [0, CORE_H * 0.6, 0] : rackFace(tooltip.key as Rack, RACK_H * 0.6);
      project(at[0], at[1], at[2]);
      const text = REGION_INFO[tooltip.key].tip;
      ctx.font = `500 ${compact ? 11 : 12}px Rajdhani, system-ui, sans-serif`;
      const tw = Math.min(width - 24, ctx.measureText(text).width + 22), bx = clamp(P[0] - tw / 2, 12, width - tw - 12), by = clamp(P[1] - 13, 8, vp.eegTop - 40);
      ctx.fillStyle = 'rgba(8,12,24,0.95)'; ctx.strokeStyle = `rgba(${(tooltip.key === 'core' ? st.coreColor : colorOf(tooltip.key)).join(',')},0.8)`;
      cutRect(bx, by, tw, 26, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e2e8f0'; ctx.textAlign = 'left'; ctx.fillText(text, bx + 11, by + 13.5, tw - 22);
    }
  }

  function drawWordsAndFlares() {
    const compact = width < 560;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = `${compact ? '500 11px' : '500 13px'} "Share Tech Mono", ui-monospace, monospace`;
    for (const g of glyphs) {
      project(g.x, g.y, g.z);
      if (P[0] < 4 || P[0] > width - 8 || P[1] < 10 || P[1] > vp.eegTop - 8) continue;
      const a = g.inbound ? 0.9 : clamp(Math.min((1 - g.life) * 8, g.life * 1.2), 0, 0.95);
      const tw = ctx.measureText(g.w).width;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.45;
      ctx.drawImage(glow(g.col), P[0] - 10, P[1] - 14, tw + 20, 28);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = a;
      ctx.fillStyle = `rgb(${g.col.map(v => Math.min(255, v + 40)).join(',')})`;
      ctx.fillText(g.w, P[0], P[1]);
    }
    ctx.textAlign = 'center';
    ctx.font = `${compact ? '600 11px' : '600 13px'} "Share Tech Mono", ui-monospace, monospace`;
    for (const f of flares) {
      project(f.at[0], f.at[1], f.at[2]);
      const tw = ctx.measureText(f.text).width;
      ctx.globalAlpha = clamp(Math.min((1 - f.life) * 6, f.life * 1.4), 0, 1);
      ctx.shadowColor = `rgba(${f.col.join(',')},0.9)`; ctx.shadowBlur = 12;
      ctx.fillStyle = '#ecfeff'; ctx.fillText(f.text, clamp(P[0], tw / 2 + 10, width - tw / 2 - 10), P[1]);
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }

  // EEG strip + hex ticker + glitch: the same instruments as the brain view
  const EEG_N = 320, eeg = { a: new Float32Array(EEG_N), head: 0, acc: 0, spike: 0 };
  const ticker: string[] = [];
  let tickerT = 0;
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
      v += eeg.spike * (Math.random() < 0.5 ? 1 : -1) * 0.7; eeg.spike *= 0.6;
      eeg.a[eeg.head] = clamp(v, -1, 1); eeg.head = (eeg.head + 1) % EEG_N;
    }
  }
  function drawInstruments(dt: number) {
    const top = vp.eegTop, h = vp.eegH, x0 = 12, x1 = width - 12, mid = top + h * 0.55, amp = h * 0.3, p = st.phase;
    const col: RGB = p === 'hearing' || p === 'listening' ? colorOf('hearing') : p === 'speaking' || p === 'voice' ? colorOf('voice') : p === 'conscience' ? colorOf('conscience') : p === 'idle' ? colorOf('memory') : st.coreColor;
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, top, width, h);
    ctx.strokeStyle = 'rgba(0,243,255,0.12)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, top + 0.5); ctx.lineTo(x1, top + 0.5); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < EEG_N; i++) { const x = x0 + (i / (EEG_N - 1)) * (x1 - x0), y = mid - eeg.a[(eeg.head + i) % EEG_N] * amp; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    const gr = ctx.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, `rgba(${col.join(',')},0)`); gr.addColorStop(0.75, `rgba(${col.join(',')},0.55)`); gr.addColorStop(1, `rgba(${col.join(',')},0.95)`);
    ctx.strokeStyle = gr; ctx.lineWidth = 1.4; ctx.shadowColor = `rgba(${col.join(',')},0.8)`; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0;
    tickerT += dt;
    if (!ticker.length || tickerT > (p !== 'idle' ? 0.08 : 0.5)) { tickerT = 0; ticker.push('0123456789ABCDEF'[(Math.random() * 16) | 0] + '0123456789ABCDEF'[(Math.random() * 16) | 0]); if (ticker.length > 64) ticker.shift(); }
    ctx.font = '500 9.5px "Share Tech Mono", ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,243,255,0.55)'; ctx.fillText('CORE TELEMETRY', 12, top + 4);
    ctx.fillStyle = 'rgba(0,243,255,0.22)'; ctx.fillText(ticker.slice(-Math.floor((width * 0.45) / 19)).join(' '), 120, top + 4, width * 0.5);
  }
  function glitch() {
    if (st.glitch <= 0 || reduced()) return;
    for (let i = 0, n = 3 + ((Math.random() * 5) | 0); i < n; i++) {
      const h = 4 + Math.random() * 26, y = Math.random() * vp.eegTop, dx = (Math.random() - 0.5) * 40 * st.glitch;
      ctx.drawImage(canvas, 0, y * dpr, canvas.width, h * dpr, dx, y, width, h);
    }
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.25 * st.glitch;
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 3 * st.glitch, 0, width, height);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  /* ── pointer ───────────────────────────────────────────────────────── */
  let tooltip: { key: Exclude<RegionKey, 'stem'>; until: number } | null = null;
  function hitRegion(cx: number, cy: number): Exclude<RegionKey, 'stem'> | null {
    const rect = canvas.getBoundingClientRect(), mx = cx - rect.left, my = cy - rect.top;
    let best: Exclude<RegionKey, 'stem'> | null = null, bestD = 70;
    const cands: { key: Exclude<RegionKey, 'stem'>; at: V3 }[] = racks.map(r => ({ key: r.key as Exclude<RegionKey, 'stem'>, at: rackFace(r.key, RACK_H / 2) }));
    cands.push({ key: 'core', at: [0, CORE_H / 2, 0] });
    for (const c of cands) { project(c.at[0], c.at[1], c.at[2]); const d = Math.hypot(P[0] - mx, P[1] - my); if (d < bestD) { bestD = d; best = c.key; } }
    return best;
  }
  let down: { x: number; y: number; yaw: number; pitch: number; t: number } | null = null;
  const onMove = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    if (down) {
      cam.dragging = true;
      cam.tYaw = clamp(down.yaw + ((e.clientX - down.x) / rect.width) * 1.6, -0.9, 0.9);
      cam.tPitch = clamp(down.pitch - ((e.clientY - down.y) / rect.height) * 1.2, -0.5, 0.8);
    } else if (e.pointerType === 'mouse') {
      cam.tYaw = ((e.clientX - rect.left) / rect.width - 0.5) * 0.3;
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
    down = null; cam.dragging = false;
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
    width = Math.max(300, Math.floor(rect.width)); height = Math.max(240, Math.floor(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function frame(ts: number) {
    if (document.hidden) { raf = 0; return; }
    const dt = last ? clamp((ts - last) / 1000, 0.001, 0.06) : 0.016;
    last = ts;
    simulate(dt); stepEeg(dt); viewport();
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
    drawRoom();
    // painter's order: racks behind the core first, then the core, then the racks in front
    const depth = (rk: RackGeo) => { project(rk.pos[0], 0.7, rk.pos[2]); return P[2]; };
    project(0, 0.7, 0); const coreZ = P[2];
    const sorted = [...racks].sort((a, b) => depth(b) - depth(a));
    for (const rk of sorted) if (depth(rk) >= coreZ) drawRack(rk);
    drawPackets();
    drawCore();
    for (const rk of sorted) if (depth(rk) < coreZ) drawRack(rk);
    drawLabels();
    drawWordsAndFlares();
    drawInstruments(dt);
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
    speak(clock0: SpeechClock) {
      speechSynced = true;
      if (utter?.id === clock0.id) return;
      const raw = clock0.text.replace(/[*`#>_[\]]/g, '').split(/\s+/).filter(Boolean);
      let total = 0;
      const weights = raw.map(w => { const wt = w.length + 1 + (/[.!?…]$/.test(w) ? 5 : /[,;:—]$/.test(w) ? 3 : 0); total += wt; return wt; });
      let cum = 0, dur = clock0.duration();
      const t0 = clock0.time();
      if (!Number.isFinite(dur) || dur <= 0) dur = clock0.speechAt + clock0.text.length / 14;
      const span = Math.max(0.5, (dur - clock0.speechAt) * 0.94);
      const words = raw.map((w, i) => { const frac = total ? cum / total : 0; cum += weights[i]; return { w: w.slice(0, 18), frac, out: t0 - (clock0.speechAt + frac * span) > 0.8 }; });
      utter = { id: clock0.id, words, clock: clock0, col: st.coreColor, chars: clock0.text.length };
    },
    feedLive(text: string) {
      const words = text.trim().split(/\s+/).filter(Boolean);
      if (words.length < st.liveWords) st.liveWords = 0;
      const fresh = words.slice(st.liveWords);
      st.liveWords = words.length;
      if (fresh.length && !reduced()) { queueWords(fresh.join(' '), colorOf('hearing'), true); st.liveFedAt = now(); }
    },
    phase: () => st.phase,
    stats: () => {
      const leds = racks.reduce((n, r) => n + r.leds.length, 0), lit = racks.reduce((n, r) => n + r.leds.filter(l => l.e > 0.3).length, 0);
      return { glyphs: glyphs.length, queued: wordQ.length, signals: packets.length, neurons: leds, lit, width, height,
        said: utter ? utter.words.filter(w => w.out).length : -1, words: utter ? utter.words.length : 0, audio: utter ? +utter.clock.time().toFixed(2) : null };
    },
    destroy() {
      cancelAnimationFrame(raf); ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp); canvas.removeEventListener('pointerleave', onLeave);
    },
  };
}
