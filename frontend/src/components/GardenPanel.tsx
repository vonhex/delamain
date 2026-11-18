// His garden: real plants in three settings (a south windowsill and a grow-light shelf indoors, a small
// greenhouse, raised beds outdoors) that live in real time under the real sky over home. Plants come up,
// grow, flower, fruit, go dormant, wilt and die by their real needs; a cat comes and goes; and Delamain
// appears only while he is actually there, walking to whatever he is tending.
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { X, Sprout } from 'lucide-react';

type Spot = {
  id: number; place: 'window' | 'shelf' | 'greenhouse' | 'outdoors'; temp: number; light: number; daily_light: number;
  species: string | null; name?: string | null; stage: string; water?: number; health?: number; wants_water?: number;
  dry?: boolean; needs_light?: number; dormant?: boolean; struggle?: string[]; planted?: number; harvests?: number;
  form?: string; petal?: string; centre?: string; fruit?: string | null; note?: string;
};
type Step = { do: string; spot: number; text: string; at: number };
type Garden = {
  enabled: boolean;
  weather: { temp: number; rain: number; snow: number; cloud: number; code: number; is_day: boolean; real: boolean };
  daylight: number; units: string; spots: Spot[]; grow_light: boolean;
  cat: { name?: string; here: boolean; where?: string; doing?: string };
  here: boolean; visit: { since: number; until: number; steps: Step[]; noticed?: string } | null;
  last_visit: number; log: { t: number; who: string; text: string }[]; hour: number;
};

export { Sprout as GardenIcon };

const ago = (t: number) => {
  const s = Date.now() / 1000 - t;
  return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};
const deg = (c: number, units: string) => (units === 'metric' ? `${Math.round(c)}°C` : `${Math.round(c * 9 / 5 + 32)}°F`);
const STAGE: Record<string, string> = {
  seed: 'sown, not up yet', sprout: 'just come up', young: 'growing', mature: 'grown', bloom: 'flowering', fruit: 'fruiting',
  spent: 'gone to seed', dead: 'dead', empty: 'empty',
};
const PLACE: Record<string, string> = { window: 'South windowsill', shelf: 'Grow-light shelf', greenhouse: 'Greenhouse', outdoors: 'Outdoor beds' };

// where each of the eleven spots sits in the scene (the base of the plant), and whether it is a pot
const POS: { x: number; y: number; pot: boolean }[] = [
  { x: 42, y: 132, pot: true }, { x: 80, y: 132, pot: true }, { x: 118, y: 132, pot: true },      // windowsill
  { x: 55, y: 236, pot: true }, { x: 108, y: 236, pot: true },                                     // grow-light shelf
  { x: 200, y: 246, pot: false }, { x: 245, y: 246, pot: false }, { x: 290, y: 246, pot: false }, // greenhouse
  { x: 360, y: 262, pot: false }, { x: 405, y: 262, pot: false }, { x: 450, y: 262, pot: false }, // outdoors
];
const CAT_AT: Record<string, { x: number; y: number }> = { inside: { x: 128, y: 268 }, greenhouse: { x: 312, y: 262 }, outdoors: { x: 470, y: 228 } };

function skyColours(hour: number): [string, string] {
  if (hour < 5 || hour >= 20.5) return ['#070b1f', '#1e1b4b'];
  if (hour < 7) return ['#312e81', '#f59e0b'];
  if (hour < 9) return ['#60a5fa', '#fde68a'];
  if (hour < 16) return ['#2563eb', '#bae6fd'];
  if (hour < 18.5) return ['#7c3aed', '#fb923c'];
  return ['#1e1b4b', '#7c3aed'];
}

/** One plant, drawn by its form and stage, at the origin (its base); positive y is down. */
function Plant({ s, sz = 1 }: { s: Spot; sz?: number }) {
  if (!s.species) return null;
  const h = s.health ?? 1;
  const dead = s.stage === 'dead';
  const wilt = !dead && h < 0.35;
  const pale = (s.struggle || []).includes('too little light');
  const dorm = !!s.dormant;
  const green = dead ? '#78716c' : wilt ? '#a3a35a' : dorm ? '#6b7f4a' : pale ? '#86efac' : '#22c55e';
  const dark = dead ? '#57534e' : wilt ? '#84843f' : dorm ? '#55663a' : '#15803d';
  if (s.stage === 'seed') return <g><circle cx={0} cy={-3} r={1.4 * sz} fill="#d6c7a1" /></g>;
  if (s.stage === 'sprout') return (
    <g transform={`scale(${sz})`}>
      <path d="M0 -2 V-9" stroke={green} strokeWidth={1.4} />
      <path d="M0 -8 q-5 -4 -7 0 q4 2 7 0 M0 -8 q5 -4 7 0 q-4 2 -7 0" fill={green} />
    </g>
  );
  const k = (s.stage === 'young' ? 0.6 : dorm ? 0.55 : 1) * sz;
  const droop = wilt || dead ? 1 : 0;
  const open = (s.stage === 'bloom' || s.stage === 'fruit') && !wilt && !dead && !dorm;
  const flower = (x: number, y: number, r = 3) => (
    <g key={`${x},${y}`} transform={`translate(${x} ${y})`}>
      {[0, 72, 144, 216, 288].map(a => <ellipse key={a} cx={0} cy={-r} rx={r * 0.6} ry={r} fill={s.petal} transform={`rotate(${a})`} />)}
      <circle r={r * 0.55} fill={s.centre} />
    </g>
  );
  const fruit = (x: number, y: number) => s.stage === 'fruit' && s.fruit && !dead ? <circle key={`f${x},${y}`} cx={x} cy={y} r={2.8} fill={s.fruit} /> : null;
  let body: ReactElement;
  switch (s.form) {
    case 'grass':
      body = <g>{[-6, -3, 0, 3, 6].map((x, i) => <path key={i} d={`M${x * 0.6} 0 Q${x} -10 ${x * 1.4 + droop * 4} ${-18 + Math.abs(x) + droop * 8}`} stroke={i % 2 ? green : dark} strokeWidth={1.6} fill="none" />)}</g>;
      break;
    case 'rosette':
      body = <g>{[-60, -25, 0, 25, 60].map((a, i) => <path key={i} d="M0 0 q-6 -10 0 -20 q6 10 0 20" fill={i % 2 ? green : dark} transform={`rotate(${a + droop * 20})`} />)}</g>;
      break;
    case 'blades':
      body = <g>{[-7, -2, 3, 7].map((x, i) => <path key={i} d={`M${x} 0 L${x - 2.5} ${-26 + i * 3} L${x + 2.5} 0 Z`} fill={dark} stroke="#facc15" strokeWidth={0.6} transform={droop ? `rotate(${x * 2})` : undefined} />)}</g>;
      break;
    case 'trailing':
      body = <g>{[-1, 1].map(d => (
        <g key={d}>
          <path d={`M0 -4 Q${d * 14} -4 ${d * 16} 14`} stroke={dark} strokeWidth={1.2} fill="none" />
          {[0.2, 0.5, 0.8].map(f => <path key={f} d="M0 0 q-3 -4 0 -7 q3 3 0 7" fill={green} transform={`translate(${d * 15 * f + d * 2} ${-4 + 18 * f * f}) rotate(${d * 40})`} />)}
        </g>
      ))}<path d="M0 0 q-3 -6 0 -11 q3 5 0 11" fill={green} /></g>;
      break;
    case 'lily':
      body = <g>{[-35, -12, 12, 35].map((a, i) => <path key={i} d="M0 0 q-5 -12 0 -24 q5 12 0 24" fill={i % 2 ? green : dark} transform={`rotate(${a * (1 + droop)})`} />)}
        {open && <g transform="translate(2 -26)"><path d="M0 0 q-5 -6 0 -13 q5 7 0 13" fill={s.petal} /><rect x={-0.8} y={-9} width={1.6} height={6} fill={s.centre} /></g>}</g>;
      break;
    case 'cactus':
      body = <g>{[-1, 0, 1].map(d => (
        <g key={d}>{[0, 1, 2].map(j => <ellipse key={j} cx={d * (4 + j * 5)} cy={-6 - j * 5 + j * j * 1.2} rx={3.2} ry={2.2} fill={dark} transform={`rotate(${d * 25} ${d * (4 + j * 5)} ${-6 - j * 5})`} />)}
          {open && <path d={`M${d * 15} -17 l${d * 4} -4 l${d * 2} 3 z`} fill={s.petal} />}</g>
      ))}</g>;
      break;
    case 'shrub':
      body = <g>{[-8, -4, 0, 4, 8].map((x, i) => (
        <g key={i}><path d={`M${x * 0.4} 0 L${x + droop * 3} ${-20 + Math.abs(x)}`} stroke={dark} strokeWidth={1.2} />
          {[0.4, 0.7].map(f => <path key={f} d={`M${x * f} ${(-20 + Math.abs(x)) * f} l-2 -1 M${x * f} ${(-20 + Math.abs(x)) * f} l2 -1`} stroke={green} strokeWidth={1} />)}
          {open && <ellipse cx={x + droop * 3} cy={-22 + Math.abs(x)} rx={1.4} ry={3} fill={s.petal} />}</g>
      ))}</g>;
      break;
    case 'tall':
      body = <g><path d={`M0 0 Q${droop * 6} -20 ${droop * 12} ${-40 + droop * 14}`} stroke={dark} strokeWidth={2.2} fill="none" />
        {[-14, -26].map((y, i) => <path key={i} d={`M0 ${y} q${i ? 9 : -9} -5 ${i ? 13 : -13} 1 q${i ? -6 : 6} 4 ${i ? -13 : 13} -1`} fill={green} />)}
        {open && <g transform={`translate(${droop * 12} ${-42 + droop * 14})`}>{[0, 40, 80, 120, 160, 200, 240, 280, 320].map(a => <ellipse key={a} cx={0} cy={-6} rx={2.4} ry={5} fill={s.petal} transform={`rotate(${a})`} />)}<circle r={4.2} fill={s.stage === 'fruit' ? s.fruit || s.centre : s.centre} /></g>}</g>;
      break;
    case 'flower':
      body = <g>{[-40, 0, 40].map((a, i) => <path key={i} d="M0 0 q-4 -6 0 -10 q4 4 0 10" fill={green} transform={`rotate(${a})`} />)}
        {open && [flower(-5, -11, 3.2), flower(5, -9, 3)]}</g>;
      break;
    case 'vine':
      body = <g><path d={`M0 0 Q${-3 + droop * 4} -16 ${1 + droop * 10} ${-32 + droop * 12}`} stroke={dark} strokeWidth={1.8} fill="none" />
        {[-8, -16, -24].map((y, i) => <path key={i} d={`M0 ${y} q${i % 2 ? 8 : -8} -3 ${i % 2 ? 11 : -11} 2 q${i % 2 ? -5 : 5} 3 ${i % 2 ? -11 : 11} -2`} fill={green} />)}
        {open && [flower(-6, -20, 2), flower(6, -28, 2)]}{fruit(-7, -12)}{fruit(7, -18)}{fruit(-3, -26)}</g>;
      break;
    default: // herb
      body = <g><path d={`M0 0 V${-18 + droop * 6}`} stroke={dark} strokeWidth={1.4} />
        {[-5, -10, -15].map((y, i) => <g key={i}><ellipse cx={-4} cy={y + droop * 3} rx={4} ry={2.4} fill={green} transform={`rotate(${-25 + droop * 30} -4 ${y})`} /><ellipse cx={4} cy={y + droop * 3} rx={4} ry={2.4} fill={i % 2 ? dark : green} transform={`rotate(${25 - droop * 30} 4 ${y})`} /></g>)}
        {open && [flower(0, -21, 2.2), flower(-6, -17, 1.8)]}{fruit(-5, -9)}{fruit(5, -13)}</g>;
  }
  return <g transform={`scale(${k})`} opacity={dead ? 0.75 : 1}>{body}{s.stage === 'spent' && <circle cx={0} cy={-20} r={2.5} fill="#a8a29e" />}</g>;
}

function Delamain({ x, y, doing }: { x: number; y: number; doing: string }) {
  return (
    <g style={{ transform: `translate(${x}px, ${y}px)`, transition: 'transform 3.5s ease-in-out' }}>
      <ellipse cx={0} cy={0} rx={10} ry={2.6} fill="#000" opacity={0.3} />
      <g filter="url(#glow)">
        <path d="M-7 0 L-4.5 -27 Q0 -31 4.5 -27 L7 0 Z" fill="#0e7490" stroke="#22d3ee" strokeWidth={1.1} />
        <circle cx={0} cy={-34} r={6.3} fill="#0f172a" stroke="#22d3ee" strokeWidth={1.3} />
        <rect x={-4.5} y={-36} width={9} height={2.6} rx={1.3} fill="#22d3ee"><animate attributeName="opacity" values="1;0.55;1" dur="2.4s" repeatCount="indefinite" /></rect>
      </g>
      {doing === 'water' && (
        <g transform="translate(8 -14)">
          <path d="M0 0 h8 v6 h-8 z" fill="#64748b" /><path d="M8 2 l6 -4" stroke="#64748b" strokeWidth={1.5} />
          {[0, 1, 2].map(k => <circle key={k} cx={15} cy={-1} r={0.8} fill="#7dd3fc"><animate attributeName="cy" values="-1;12" dur="0.9s" begin={`${k * 0.3}s`} repeatCount="indefinite" /></circle>)}
        </g>
      )}
      {doing === 'harvest' && <path d="M8 -12 h7 l-1.5 5 h-4 z" fill="#a16207" />}
      <text x={0} y={-45} textAnchor="middle" fontSize={6.5} fill="#a5f3fc" fontFamily="monospace">DELAMAIN</text>
    </g>
  );
}

function Cat({ at, doing, name }: { at: { x: number; y: number }; doing?: string; name?: string }) {
  const asleep = /asleep|curled/.test(doing || '');
  return (
    <g transform={`translate(${at.x} ${at.y})`}>
      <ellipse cx={0} cy={-4} rx={9} ry={asleep ? 4.5 : 5.5} fill="#292524" />
      <circle cx={asleep ? 7 : 8} cy={asleep ? -6 : -10} r={4.2} fill="#292524" />
      <path d={`M${asleep ? 4 : 5} ${asleep ? -9 : -13} l1.4 -3.6 l1.8 2.8 M${asleep ? 8 : 9} ${asleep ? -10 : -14} l1.8 -3.6 l1.4 3.6`} fill="#292524" stroke="#292524" />
      <path d="M-9 -3 q-7 -2 -5 -9" stroke="#292524" strokeWidth={2} fill="none">
        {!asleep && <animateTransform attributeName="transform" type="rotate" values="0 -9 -3;12 -9 -3;0 -9 -3" dur="3s" repeatCount="indefinite" />}
      </path>
      {!asleep && <><circle cx={10} cy={-11} r={0.7} fill="#facc15" /><circle cx={7} cy={-11} r={0.7} fill="#facc15" /></>}
      {asleep && <text x={12} y={-12} fontSize={6} fill="#e7e5e4">z<animate attributeName="opacity" values="0.2;0.9;0.2" dur="3s" repeatCount="indefinite" /></text>}
      {name && <text x={0} y={8} textAnchor="middle" fontSize={5.5} fill="#d6d3d1" fontFamily="monospace">{name}</text>}
    </g>
  );
}

function Scene({ g, now }: { g: Garden; now: number }) {
  const [top, bottom] = skyColours(g.hour);
  const night = !g.weather.is_day;
  const grey = Math.max(0, (g.weather.cloud - 55) / 45);
  const snowing = g.weather.snow > 0, raining = g.weather.rain > 0;
  const frosty = g.weather.temp < 0;
  const lightOn = g.grow_light && g.hour >= 6 && g.hour < 20;
  const sunT = Math.max(0, Math.min(1, (g.hour - 6.8) / 10));
  const sun = { x: 175 + sunT * 290, y: 95 - Math.sin(sunT * Math.PI) * 70 };
  let pos = { x: 240, y: 286 }, doing = 'look';
  if (g.here && g.visit) {
    const st = (g.visit.steps || []).filter(s => s.at <= now).pop();
    if (st) {
      doing = st.do;
      if (st.spot >= 0 && st.spot < POS.length) pos = { x: POS[st.spot].x + 16, y: Math.max(POS[st.spot].y + 10, POS[st.spot].pot ? 270 : POS[st.spot].y + 22) };
      else { const c = CAT_AT[g.cat.where || 'inside'] || CAT_AT.inside; pos = { x: c.x - 18, y: Math.max(c.y + 12, 270) }; }
    }
  }
  const sky = (
    <>
      <rect width={480} height={300} fill="url(#sky)" />
      <rect width={480} height={300} fill="#64748b" opacity={grey * 0.55} />
      {night && Array.from({ length: 45 }, (_, k) => <circle key={k} cx={(k * 97) % 480} cy={(k * 53) % 150} r={k % 5 ? 0.6 : 1} fill="#fff" opacity={(1 - g.weather.cloud / 100) * 0.8} />)}
      {!night && <circle cx={sun.x} cy={sun.y} r={12} fill="#fde047" opacity={1 - g.weather.cloud / 140} />}
      {night && <g opacity={1 - g.weather.cloud / 130}><circle cx={420} cy={40} r={9} fill="#f1f5f9" /><circle cx={424} cy={37} r={8} fill={top} /></g>}
      {Array.from({ length: Math.round(g.weather.cloud / 20) }, (_, k) => (
        <ellipse key={k} cx={(k * 97 + 60) % 480} cy={28 + (k % 3) * 16} rx={34} ry={10} fill={grey > 0.5 ? '#94a3b8' : '#f8fafc'} opacity={night ? 0.3 : 0.85}>
          <animate attributeName="cx" values={`${(k * 97 + 60) % 480};${(k * 97 + 60) % 480 + 30};${(k * 97 + 60) % 480}`} dur={`${40 + k * 7}s`} repeatCount="indefinite" />
        </ellipse>
      ))}
      <path d="M0 180 L60 140 L110 165 L170 118 L235 160 L295 122 L350 158 L400 128 L480 156 V200 H0 Z" fill={night ? '#111827' : '#475569'} />
      {(snowing || raining) && Array.from({ length: 40 }, (_, k) => snowing
        ? <circle key={k} cx={(k * 37) % 480} cy={0} r={1.3} fill="#fff"><animate attributeName="cy" values="-5;300" dur={`${5 + (k % 5)}s`} begin={`${(k % 7) * 0.6}s`} repeatCount="indefinite" /></circle>
        : <line key={k} x1={(k * 37) % 480} y1={0} x2={(k * 37) % 480 - 2} y2={7} stroke="#93c5fd" strokeOpacity={0.7}><animateTransform attributeName="transform" type="translate" values="0 -10;0 300" dur={`${0.9 + (k % 4) * 0.15}s`} begin={`${(k % 6) * 0.2}s`} repeatCount="indefinite" /></line>)}
    </>
  );
  return (
    <svg viewBox="0 0 480 300" className="w-full rounded-md border border-emerald-400/20 bg-black" role="img"
      aria-label={`His garden${g.here ? ', with Delamain in it' : ''}`}>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={top} /><stop offset="1" stopColor={bottom} /></linearGradient>
        <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e0f2fe" stopOpacity={0.16} /><stop offset="1" stopColor="#e0f2fe" stopOpacity={0.05} /></linearGradient>
        <radialGradient id="growglow" cx="0.5" cy="0"><stop offset="0" stopColor="#e879f9" stopOpacity={0.55} /><stop offset="1" stopColor="#e879f9" stopOpacity={0} /></radialGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="1.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <clipPath id="win"><rect x={22} y={34} width={116} height={84} /></clipPath>
      </defs>
      {sky}
      {/* outdoors: the field to the mountains, ground, fence, frost or snow */}
      <rect x={160} y={192} width={320} height={60} fill={snowing ? '#e2e8f0' : night ? '#1a2416' : frosty ? '#8a9a7a' : '#7d8a4a'} />
      <rect x={160} y={250} width={320} height={50} fill={snowing ? '#e2e8f0' : night ? '#1c1917' : '#4d3a28'} />
      <rect x={330} y={238} width={150} height={14} fill={snowing ? '#f1f5f9' : frosty ? '#cbd5e1' : night ? '#14532d' : '#3f6212'} opacity={0.9} />
      {[340, 372, 404, 436, 468].map(x => <rect key={x} x={x} y={216} width={3} height={26} fill="#78716c" />)}
      <line x1={336} y1={224} x2={478} y2={224} stroke="#78716c" strokeWidth={2} />
      {/* the greenhouse */}
      <path d="M168 300 V120 L245 70 L322 120 V300" fill="url(#glass)" stroke="#cbd5e1" strokeOpacity={0.5} strokeWidth={2} />
      {[194, 220, 245, 270, 296].map(x => <line key={x} x1={x} y1={x < 245 ? 120 - (x - 168) * 0.65 : 70 + (x - 245) * 0.65} x2={x} y2={300} stroke="#cbd5e1" strokeOpacity={0.18} />)}
      {snowing && <path d="M168 118 L245 68 L322 118" stroke="#fff" strokeWidth={3.5} fill="none" />}
      <rect x={300} y={256} width={20} height={4} fill="#8b5a2b" />
      {/* indoors: wall with a window on the real sky, the sill, the grow-light shelf */}
      <path d="M0 0 H160 V300 H0 Z M22 34 V118 H138 V34 Z" fillRule="evenodd" fill={night ? '#2a211d' : '#5c4a3f'} />
      <rect x={22} y={34} width={116} height={84} fill="none" stroke="#e7e5e4" strokeWidth={3} />
      <line x1={80} y1={34} x2={80} y2={118} stroke="#e7e5e4" strokeWidth={2} /><line x1={22} y1={76} x2={138} y2={76} stroke="#e7e5e4" strokeWidth={2} />
      {night && <rect x={0} y={0} width={160} height={300} fill="#fbbf24" opacity={0.05} />}
      <rect x={14} y={130} width={132} height={6} fill="#d6d3d1" />
      <rect x={20} y={236} width={124} height={5} fill="#8b5a2b" /><rect x={26} y={241} width={3} height={32} fill="#5b3720" /><rect x={135} y={241} width={3} height={32} fill="#5b3720" />
      <rect x={30} y={180} width={104} height={5} rx={2} fill={lightOn ? '#f5d0fe' : '#57534e'} />
      {lightOn && <rect x={20} y={185} width={124} height={52} fill="url(#growglow)" />}
      <rect x={0} y={272} width={160} height={28} fill={night ? '#1c1512' : '#3b2a20'} />
      {/* the spots */}
      {g.spots.map((s, i) => {
        const p = POS[i];
        const wet = s.water ?? 0.4;
        const soil = `rgb(${Math.round(125 - wet * 75)}, ${Math.round(88 - wet * 52)}, ${Math.round(55 - wet * 32)})`;
        return (
          <g key={i}>
            <g transform={`translate(${p.x + 16} ${p.y - 2})`}><Plant s={s} sz={p.pot ? 0.85 : 1} /></g>
            {p.pot ? (
              <g><path d={`M${p.x + 4} ${p.y - 3} h24 l-3 14 h-18 z`} fill="#c2410c" stroke="#9a3412" /><ellipse cx={p.x + 16} cy={p.y - 3} rx={12} ry={2.2} fill={soil} /></g>
            ) : (
              <g><rect x={p.x} y={p.y - 4} width={34} height={5} fill={snowing && s.place === 'outdoors' ? '#f1f5f9' : soil} /><rect x={p.x - 2} y={p.y} width={38} height={10} rx={1} fill="#7c4a2d" stroke="#5b3720" /></g>
            )}
            <text x={p.x + 16} y={p.pot ? p.y + 8 : p.y + 8} textAnchor="middle" fontSize={5.5} fill="#f5deb3" fontFamily="monospace">{i + 1}</text>
          </g>
        );
      })}
      {g.cat.here && <Cat at={CAT_AT[g.cat.where || 'inside'] || CAT_AT.inside} doing={g.cat.doing} name={g.cat.name} />}
      {g.here && <Delamain x={pos.x} y={pos.y} doing={doing} />}
      <text x={6} y={296} fontSize={6} fill="#a8a29e" fontFamily="monospace">INSIDE</text>
      <text x={172} y={296} fontSize={6} fill="#a8a29e" fontFamily="monospace">GREENHOUSE</text>
      <text x={336} y={296} fontSize={6} fill="#a8a29e" fontFamily="monospace">OUTDOORS</text>
    </svg>
  );
}

export function GardenPanel({ token, onClose }: { token: string; onClose: () => void }) {
  const [g, setG] = useState<Garden | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now() / 1000);
  const [sending, setSending] = useState(false);
  const load = useCallback(() => {
    fetch('/api/garden', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => { setG(d); setError(''); })
      .catch(() => setError('Could not reach his garden.'));
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, g?.here ? 5000 : 20000);
    return () => clearInterval(id);
  }, [load, g?.here]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);
  const send = async () => {
    setSending(true);
    const r = await fetch('/api/garden/visit', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    if (r && !r.ok) setError((await r.json().catch(() => ({}))).detail || 'He could not go just now.');
    setSending(false);
    setTimeout(load, 2500);
  };
  const step = g?.here && g.visit ? (g.visit.steps || []).filter(s => s.at <= now).pop() : null;
  const units = g?.units || 'imperial';
  const groups = g ? (['window', 'shelf', 'greenhouse', 'outdoors'] as const).map(place => ({ place, spots: g.spots.filter(s => s.place === place) })) : [];
  return (
    <div className="flex flex-col h-full bg-cyber-dark/95 text-white text-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b border-emerald-400/30 bg-emerald-400/5 shrink-0">
        <span className="font-mono font-bold text-emerald-300 tracking-widest text-xs flex items-center gap-2"><Sprout size={14} /> HIS_GARDEN</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && <p className="text-xs text-red-400">{error}</p>}
        {!g ? <p className="text-xs text-gray-500 font-mono">Walking down to the garden…</p> : !g.enabled ? (
          <p className="text-xs text-gray-400">His garden is switched off (Settings → Integrations → Features → His garden).</p>
        ) : (<>
          <Scene g={g} now={now} />
          <div className="text-xs text-gray-300 space-y-1">
            {g.here && g.visit ? (
              <p className="text-cyan-200"><b>He is in the garden now</b>{step ? `: ${step.text}` : ', looking around'}. Here until {new Date(g.visit.until * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</p>
            ) : (
              <p className="text-gray-400">
                {g.last_visit ? <>He was last here {ago(g.last_visit)}.</> : <>He has not been yet.</>}{' '}
                <button disabled={sending} onClick={() => void send()} className="text-emerald-300 hover:underline disabled:opacity-50">{sending ? 'Sending him…' : 'Send him to the garden'}</button>
              </p>
            )}
            {g.here && g.visit?.noticed && <p className="italic text-gray-300">“{g.visit.noticed}”</p>}
            <p className="text-gray-500">
              Outside {deg(g.weather.temp, units)}{g.weather.snow > 0 ? ', snowing' : g.weather.rain > 0 ? ', raining' : g.weather.cloud > 70 ? ', overcast' : ''}, {g.daylight} h of daylight today{g.weather.real ? '' : ' (no home address set: a mild default sky)'}
              {' · '}grow light {g.grow_light ? 'on (6am–8pm)' : 'off'}
              {g.cat.here ? <> · {g.cat.name || 'a cat'} is here, {g.cat.doing}</> : <> · no cat about</>}
            </p>
          </div>
          {groups.map(({ place, spots }) => (
            <section key={place} className="space-y-1.5">
              <h3 className="font-mono text-[10px] tracking-widest text-emerald-300">
                {PLACE[place].toUpperCase()} <span className="text-gray-500 normal-case tracking-normal">· {deg(spots[0].temp, units)} · about {Math.round(spots[0].daily_light)} h of good light a day</span>
              </h3>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                {spots.map(s => (
                  <li key={s.id} className="border border-white/10 rounded-sm px-2 py-1.5 bg-white/[0.02]">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-gray-500">{s.id + 1}</span>
                      {s.species && <span className="w-2 h-2 rounded-full" style={{ background: s.stage === 'dead' ? '#78716c' : s.petal }} />}
                      <span className={s.stage === 'dead' ? 'text-gray-500 line-through' : 'text-gray-200'}>{s.species ? (s.name ? `${s.name} (${s.species})` : s.species) : 'empty'}</span>
                    </div>
                    {s.species && s.stage !== 'dead' && (
                      <div className="mt-1 text-[10px] text-gray-400 space-y-0.5">
                        <div>
                          {STAGE[s.stage] || s.stage}{s.dormant ? ', dormant in the cold' : ''}
                          {(s.health ?? 1) < 0.35 ? ', failing' : (s.health ?? 1) < 0.7 ? ', struggling' : ''}
                          {s.struggle && s.struggle.length > 0 && <span className="text-amber-300"> ({s.struggle.join(', ')})</span>}
                          {s.harvests ? ` · harvested ${s.harvests}×` : ''}
                        </div>
                        <div className="h-1 bg-white/10 rounded-sm overflow-hidden relative" title={`soil ${Math.round((s.water ?? 0) * 100)}% (it likes about ${Math.round((s.wants_water ?? 0.5) * 100)}%)`}>
                          <div className="h-full" style={{ width: `${Math.round((s.water ?? 0) * 100)}%`, background: (s.water ?? 0) < Math.max(0.08, (s.wants_water ?? 0.5) - 0.3) ? '#f59e0b' : s.dry && (s.water ?? 0) > (s.wants_water ?? 0.3) + 0.4 ? '#a855f7' : '#38bdf8' }} />
                          <div className="absolute top-0 h-full w-px bg-white/70" style={{ left: `${Math.round((s.wants_water ?? 0.5) * 100)}%` }} />
                        </div>
                        <div className="text-gray-500">needs {s.needs_light} h light, gets about {Math.round(s.daily_light)} · {s.note}</div>
                      </div>
                    )}
                    {s.stage === 'dead' && <div className="mt-1 text-[10px] text-gray-500">{(s.struggle || []).length ? `died of ${s.struggle!.join(', ')}; ` : ''}waiting for him to clear it</div>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section className="space-y-1">
            <h3 className="font-mono text-[10px] tracking-widest text-emerald-300">WHAT HAPPENED</h3>
            {g.log.length === 0 ? <p className="text-xs text-gray-500">Nothing yet.</p> : (
              <ul className="space-y-1 text-xs">
                {[...g.log].reverse().map((e, k) => (
                  <li key={k} className={e.who === 'Delamain' ? 'text-cyan-100' : 'text-gray-400'}>
                    <span className="text-gray-500 font-mono">{ago(e.t)}</span> {e.who === 'Delamain' && <b className="text-cyan-300">He: </b>}{e.text}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[10px] text-gray-500">His own account of each visit is in <span className="font-mono">Delamain/Garden/</span> in the vault.</p>
          </section>
        </>)}
      </div>
    </div>
  );
}
