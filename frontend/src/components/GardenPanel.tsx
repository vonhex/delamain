// His garden: real plants in three settings (a south windowsill and a grow-light shelf indoors, a small
// greenhouse, raised beds outdoors) that live in real time under the real sky over home. Plants come up,
// grow, flower, fruit, go dormant, wilt and die by their real needs; a cat comes and goes; and Delamain
// appears only while he is actually there, walking to whatever he is tending.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { render, W, H, SPOTS, BENCH_STAND, BED_STAND, POND_STAND, TALK_STAND, GUEST_AT, GUEST_POND, type PWorld } from './gardenPixels';
import { X, Sprout, Maximize2, Minimize2, Send } from 'lucide-react';

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
  asleep?: boolean;
  guest?: { name: string; kind: string; about: string; says: string; gift?: string | null; message?: string | null; reply?: string;
    since?: number; until?: number; steps?: { do: string; spot: number; at: number }[]; talk?: { who: string; text: string; t: number }[] } | null;
  pond?: { ice: number; water_t: number; lure: boolean; caught: { t: number; species: string; cm: number }[]; best: Record<string, number>; total: number };
  visitors?: { name: string; kind: string; about: string; visits: number; left: boolean; last: number; letter: boolean; talk: { date: string; says: string; reply?: string }[] }[];
  sent?: { t: number; text: string; by?: string; delivered?: number | null; visitor?: string | null; reply?: string | null }[];
  gifts?: string[];
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

function PixelScene({ g, big = false, capture }: { g: Garden; big?: boolean; capture?: MutableRefObject<HTMLCanvasElement | null> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (capture) capture.current = ref.current; });
  const gRef = useRef(g);
  gRef.current = g;
  const pos = useRef<{ x: number; y: number; facing: number; dist: number } | null>(null);
  const gpos = useRef<{ x: number; y: number; facing: number; dist: number; name: string } | null>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    let raf = 0, last = 0;
    const t0 = performance.now();
    // one step of walking toward a target; returns whether still walking
    const walk = (p: { x: number; y: number; facing: number; dist: number }, tx: number, ty: number, speed: number) => {
      const dx = tx - p.x, dy = ty - p.y;
      if (Math.abs(dx) <= 0.6 && Math.abs(dy) <= 0.6) return false;
      const d = Math.hypot(dx, dy), step = Math.min(d, speed);
      p.x += (dx / d) * step; p.y += (dy / d) * step; p.dist += step;
      if (Math.abs(dx) > 0.6) p.facing = dx > 0 ? 1 : -1;
      return true;
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 90) return;          // about ten frames a second, like the pixel art it is
      last = now;
      const gg = gRef.current, nowS = Date.now() / 1000;
      const gs = gg.here ? gg.guest : null;
      const said = (gs?.talk || []).filter(l => l.t <= nowS).pop();
      const speaker = said && nowS - said.t < 9 ? said.who : '';
      let del: PWorld['delamain'] = null;
      if (gg.here && gg.visit) {
        const st = (gg.visit.steps || []).filter(s => s.at <= nowS).pop();
        let target = { x: 170, y: 152 }, doing = 'look';
        let face = 0;
        if (st) {
          doing = st.do;
          target = st.spot >= 0 && st.spot < SPOTS.length ? SPOTS[st.spot].stand
            : st.spot === -4 ? BED_STAND : st.spot === -5 ? POND_STAND : st.spot === -6 ? TALK_STAND
            : (BENCH_STAND[gg.cat.where || 'inside'] || BENCH_STAND.inside);
          face = st.spot === -5 || st.spot === -6 ? 1 : 0;
        }
        if (!pos.current) pos.current = { x: 170, y: 152, facing: -1, dist: 0 };     // he comes in by the greenhouse door
        const p = pos.current;
        const walking = walk(p, target.x + 7, target.y, 1.4);
        if (!walking) {
          const g2 = gpos.current;                                                   // turn to whoever he is talking with
          p.facing = speaker && g2 && Math.abs(g2.x - p.x) < 30 ? (g2.x > p.x ? 1 : -1)
            : face || (SPOTS.some(s => Math.abs(s.stand.x + 7 - p.x) < 1) ? -1 : p.facing);
        }
        del = { x: p.x, y: p.y, walking, doing: walking ? 'look' : speaker === 'Delamain' && doing === 'look' ? 'talk' : doing, facing: p.facing,
          lying: !walking && doing === 'rest', stride: p.dist, speaking: speaker === 'Delamain' };
      } else {
        pos.current = null;
        if (gg.asleep) del = { x: 0, y: 0, walking: false, doing: 'sleep', facing: 1, lying: true };   // asleep in his bed
      }
      // a visitor: walks in from the lane past the pond, goes about what they are doing, and walks off again
      let guest: PWorld['guest'] = null;
      if (gs && gs.since && nowS >= gs.since) {
        if (!gpos.current || gpos.current.name !== gs.name) gpos.current = { x: 330, y: 160, facing: -1, dist: 0, name: gs.name };
        const q = gpos.current;
        const leaving = !!gs.until && nowS >= gs.until;
        const st = (gs.steps || []).filter(s => s.at <= nowS).pop();
        let tx = GUEST_AT.x, ty = GUEST_AT.y, doing = st?.do || 'talk', face = 0;
        if (leaving) { tx = 334; ty = 160; doing = 'look'; }
        else if (st) {
          const sp = st.spot;
          if (sp >= 0 && sp < SPOTS.length) { tx = SPOTS[sp].stand.x - 4; ty = SPOTS[sp].stand.y; face = 1; }
          else if (sp === -2) { const bs = BENCH_STAND[gg.cat.where || 'inside'] || BENCH_STAND.inside; tx = bs.x - 4; ty = bs.y; face = 1; }
          else if (sp === -3) { tx = 202; ty = 160; }
          else if (sp === -5) { tx = GUEST_POND.x; ty = GUEST_POND.y; face = -1; }
          else if (sp === -7) { const h = Math.sin(st.at * 12.9898) * 43758.5453; tx = 184 + (h - Math.floor(h)) * 60; ty = 160; }
          else if (del && !del.lying) { tx = del.x + (del.x > 300 ? -13 : 13); ty = Math.max(del.y, 147); }     // beside him
        }
        const walking = walk(q, tx, ty, 1.2);
        if (!walking) q.facing = speaker && del && Math.abs(del.x - q.x) < 30 ? (del.x > q.x ? 1 : -1) : face || q.facing;
        if (!(leaving && q.x > 326))
          guest = { name: gs.name, kind: gs.kind, x: q.x, y: q.y, walking, doing: walking ? 'look' : doing, facing: q.facing, stride: q.dist,
            speaking: speaker === gs.name };
      } else gpos.current = null;
      render(ctx, {
        hour: gg.hour, isDay: gg.weather.is_day, cloud: gg.weather.cloud, rain: gg.weather.rain, snow: gg.weather.snow,
        temp: gg.weather.temp, growLight: gg.grow_light, spots: gg.spots,
        cat: gg.cat.here ? { here: true, where: gg.cat.where, doing: gg.cat.doing } : null, delamain: del,
        pond: { ice: gg.pond?.ice ?? 0, waterT: gg.pond?.water_t ?? 10 },
        guest,
      }, (now - t0) / 1000);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <canvas ref={ref} width={W} height={H} className={big ? 'block bg-black' : 'w-full rounded-md border border-emerald-400/25 bg-black'}
      style={big ? { imageRendering: 'pixelated', width: `min(100vw, calc((100vh - 76px) * ${W / H}))`, height: 'auto', maxHeight: 'calc(100vh - 76px)' } : { imageRendering: 'pixelated' }} role="img" aria-label={`Delamain's garden${g.here ? ', with Delamain in it' : ''}`} />
  );
}

export function GardenPanel({ token, onClose }: { token: string; onClose: () => void }) {
  const [g, setG] = useState<Garden | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now() / 1000);
  const [sending, setSending] = useState(false);
  const [full, setFull] = useState(false);
  const [msg, setMsg] = useState('');
  const [by, setBy] = useState('');
  const [msgNote, setMsgNote] = useState('');
  const fullRef = useRef<HTMLDivElement>(null);
  const shot = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (full) fullRef.current?.requestFullscreen?.().catch(() => { /* the overlay still fills the window */ });
    else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, [full]);
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFull(false); };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  // Delamain can see: while the tab is open, the scene is sent to the server now and then, and he is
  // shown it on his next visit (scaled up, pixels kept crisp, so his model can make it out).
  useEffect(() => {
    const send = () => {
      const c = shot.current;
      if (!c) return;
      const big = document.createElement('canvas');
      big.width = c.width * 4; big.height = c.height * 4;
      const ctx = big.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(c, 0, 0, big.width, big.height);
      fetch('/api/garden/view', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: big.toDataURL('image/png') }) }).catch(() => {});
    };
    const first = setTimeout(send, 4000);
    const id = setInterval(send, 180000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [token]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) setFull(v => !v);
      if (e.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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
    if (r && !r.ok) setError((await r.json().catch(() => ({}))).detail || 'Delamain could not go just now.');
    setSending(false);
    setTimeout(load, 2500);
  };
  const sendVisitor = async () => {
    if (!msg.trim()) return;
    setSending(true);
    const r = await fetch('/api/garden/visitor', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg.trim(), by }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (r && r.ok) { setMsg(''); setMsgNote(d.note || 'On the way.'); } else setMsgNote(d.detail || 'Could not send anyone just now.');
    setSending(false);
    setTimeout(load, 2500);
  };
  const lastLine = g?.here && g.guest ? (g.guest.talk || []).filter(l => l.t <= now).pop() : undefined;
  const step = g?.here && g.visit ? (g.visit.steps || []).filter(s => s.at <= now).pop() : null;
  const units = g?.units || 'imperial';
  const groups = g ? (['window', 'shelf', 'greenhouse', 'outdoors'] as const).map(place => ({ place, spots: g.spots.filter(s => s.place === place) })) : [];
  return (
    <div className="flex flex-col h-full bg-cyber-dark/95 text-white text-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b border-emerald-400/30 bg-emerald-400/5 shrink-0">
        <span className="font-mono font-bold text-emerald-300 tracking-widest text-xs flex items-center gap-2"><Sprout size={14} /> DELAMAINS_GARDEN</span>
        <div className="flex items-center gap-3">
          <button onClick={() => setFull(true)} className="text-gray-400 hover:text-emerald-300" title="Fill the screen with the garden (F)" aria-label="Full screen"><Maximize2 size={16} /></button>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>
      </div>
      {full && g && createPortal(
        <div ref={fullRef} className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center" role="dialog" aria-label="Delamain's garden, full screen">
          <PixelScene g={g} big />
          <div className="w-full flex items-start gap-3 px-4 py-2 text-xs text-gray-300 min-h-[84px]">
            <div className="flex-1 space-y-1">
              {g.here && g.visit ? (
                <p className="text-cyan-200"><b>Delamain is in the garden</b>{step ? `: ${step.text}` : ', looking around'}.</p>
              ) : <p className="text-gray-400">{g.asleep ? 'Delamain is asleep in bed.' : g.last_visit ? `Delamain was last here ${ago(g.last_visit)}.` : "Delamain hasn't been yet."}</p>}
              {g.here && g.guest && lastLine && <p className={`line-clamp-2 ${lastLine.who === 'Delamain' ? 'text-cyan-200' : 'text-amber-200'}`}><b>{lastLine.who}:</b> “{lastLine.text}”</p>}
              {g.here && g.visit?.noticed && <p className="italic text-gray-400 line-clamp-2">“{g.visit.noticed}”</p>}
            </div>
            <button onClick={() => setFull(false)} className="text-gray-400 hover:text-white shrink-0" title="Back (F or Esc)" aria-label="Leave full screen"><Minimize2 size={18} /></button>
          </div>
        </div>, document.body,
      )}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && <p className="text-xs text-red-400">{error}</p>}
        {!g ? <p className="text-xs text-gray-500 font-mono">Walking down to the garden…</p> : !g.enabled ? (
          <p className="text-xs text-gray-400">Delamain's garden is switched off (Settings → Integrations → Features → Delamain's garden).</p>
        ) : (<>
          <PixelScene g={g} capture={shot} />
          <div className="text-xs text-gray-300 space-y-1">
            {g.here && g.visit ? (
              <p className="text-cyan-200"><b>Delamain is in the garden now</b>{step ? `: ${step.text}` : ', looking around'}. Here until {new Date(g.visit.until * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</p>
            ) : (
              <p className="text-gray-400">
                {g.asleep ? <>Delamain is asleep in bed. </> : null}
                {g.last_visit ? <>Delamain was last here {ago(g.last_visit)}.</> : <>Delamain hasn't been yet.</>}{' '}
                <button disabled={sending} onClick={() => void send()} className="text-emerald-300 hover:underline disabled:opacity-50">{sending ? 'Sending Delamain…' : 'Send Delamain to the garden'}</button>
              </p>
            )}
            {g.here && g.visit?.noticed && <p className="italic text-gray-300">“{g.visit.noticed}”</p>}
            {g.here && g.guest && (
              <div className="border-l-2 border-amber-300/50 pl-2 space-y-0.5">
                <p className="text-gray-400"><b className="text-amber-200">{g.guest.name}</b> ({g.guest.about}) {g.guest.since && now < g.guest.since ? 'is coming up the lane' : g.guest.until && now >= g.guest.until ? 'has headed off' : 'is here'}.</p>
                {g.guest.gift && <p className="text-gray-400">Brought {g.guest.gift}.</p>}
                {g.guest.message && <p className="text-gray-400">Passed on your message: “{g.guest.message}”</p>}
                {(g.guest.talk || []).filter(l => l.t <= now).map(l => (
                  <p key={l.t} className={l.who === 'Delamain' ? 'text-cyan-100' : 'text-amber-100'}><b className={l.who === 'Delamain' ? 'text-cyan-300' : 'text-amber-300'}>{l.who}:</b> {l.text}</p>
                ))}
              </div>
            )}
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
          {g.pond && (
            <section className="space-y-1">
              <h3 className="font-mono text-[10px] tracking-widest text-emerald-300">
                THE POND <span className="text-gray-500 normal-case tracking-normal">· water about {deg(g.pond.water_t, units)} · {g.pond.ice >= 0.6 ? 'frozen over' : g.pond.ice > 0.15 ? 'ice at the edges' : 'open'}{g.pond.lure ? ' · Delamain has a hand-tied lure' : ''}</span>
              </h3>
              {g.pond.total === 0 ? <p className="text-xs text-gray-500">Delamain hasn't caught anything yet. Catch and release; the fish feed best at dawn and dusk.</p> : (
                <p className="text-xs text-gray-300">
                  {g.pond.total} caught and let go. Best: {Object.entries(g.pond.best).map(([k, v]) => `${k} ${units === 'metric' ? `${v} cm` : `${(v / 2.54).toFixed(1)} in`}`).join(' · ')}.
                  <span className="text-gray-500"> Last: {g.pond.caught[g.pond.caught.length - 1].species}, {ago(g.pond.caught[g.pond.caught.length - 1].t)}.</span>
                </p>
              )}
            </section>
          )}
          <section className="space-y-1.5">
            <h3 className="font-mono text-[10px] tracking-widest text-emerald-300">VISITORS</h3>
            {(g.visitors || []).length === 0 ? <p className="text-xs text-gray-500">Nobody has come by yet. People turn up now and then while Delamain is there, and stay for a few visits.</p> : (
              <ul className="space-y-1 text-xs">
                {(g.visitors || []).map(v => (
                  <li key={v.name} className="text-gray-300">
                    <b className={v.left ? 'text-gray-400' : 'text-amber-200'}>{v.name}</b> <span className="text-gray-500">· {v.about} · {v.visits} visit{v.visits === 1 ? '' : 's'}{v.left ? ', moved on' : ''}{v.letter ? ' · Delamain wrote to them' : ''}{v.last ? ` · ${ago(v.last)}` : ''}</span>
                    {v.talk.length > 0 && <div className="text-[11px] text-gray-400 pl-2 line-clamp-2">“{v.talk[v.talk.length - 1].says}”{v.talk[v.talk.length - 1].reply && <span className="text-cyan-200/80"> Delamain: {v.talk[v.talk.length - 1].reply}</span>}</div>}
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-1 pt-1">
              <p className="text-[11px] text-gray-400">Send someone to the garden with a message for Delamain. They'll pass it on word for word, and his answer will show up here.</p>
              <div className="flex gap-1.5">
                <input value={msg} onChange={e => setMsg(e.target.value)} maxLength={600} placeholder="Your message…" onKeyDown={e => { if (e.key === 'Enter') void sendVisitor(); }}
                  className="flex-1 min-w-0 bg-black/40 border border-white/15 rounded-sm px-2 py-1 text-xs text-white placeholder:text-gray-600" />
                {(g.visitors || []).length > 0 && (
                  <select value={by} onChange={e => setBy(e.target.value)} className="bg-black/40 border border-white/15 rounded-sm px-1 text-xs text-gray-300" aria-label="Who carries it">
                    <option value="">someone new</option>
                    {(g.visitors || []).map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                  </select>
                )}
                <button disabled={sending || !msg.trim()} onClick={() => void sendVisitor()} className="text-emerald-300 hover:text-emerald-200 disabled:opacity-40 px-1" aria-label="Send"><Send size={14} /></button>
              </div>
              {msgNote && <p className="text-[11px] text-gray-500">{msgNote}</p>}
              {(g.sent || []).length > 0 && (
                <ul className="space-y-1 text-[11px]">
                  {(g.sent || []).map(m => (
                    <li key={m.t} className="text-gray-400">
                      <span className="text-gray-500 font-mono">{ago(m.t)}</span> You: “{m.text}” <span className="text-gray-500">{m.delivered ? `· carried by ${m.visitor}` : '· on the way'}</span>
                      {m.reply && <div className="pl-2 text-cyan-100"><b className="text-cyan-300">Delamain:</b> {m.reply}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
          <section className="space-y-1">
            <h3 className="font-mono text-[10px] tracking-widest text-emerald-300">WHAT HAPPENED</h3>
            {g.log.length === 0 ? <p className="text-xs text-gray-500">Nothing yet.</p> : (
              <ul className="space-y-1 text-xs">
                {[...g.log].reverse().map((e, k) => (
                  <li key={k} className={e.who === 'Delamain' ? 'text-cyan-100' : 'text-gray-400'}>
                    <span className="text-gray-500 font-mono">{ago(e.t)}</span> {e.who === 'Delamain' && <b className="text-cyan-300">Delamain: </b>}{e.text}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[10px] text-gray-500">Delamain's own account of each visit is in <span className="font-mono">Delamain/Garden/</span> in the vault; each visitor has a note in <span className="font-mono">Delamain/Garden/Visitors/</span>.</p>
          </section>
        </>)}
      </div>
    </div>
  );
}
