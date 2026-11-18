// His garden: real plants in three settings (a south windowsill and a grow-light shelf indoors, a small
// greenhouse, raised beds outdoors) that live in real time under the real sky over home. Plants come up,
// grow, flower, fruit, go dormant, wilt and die by their real needs; a cat comes and goes; and Delamain
// appears only while he is actually there, walking to whatever he is tending.
import { useCallback, useEffect, useRef, useState } from 'react';
import { render, W, H, SPOTS, BENCH_STAND, type PWorld } from './gardenPixels';
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

function PixelScene({ g }: { g: Garden }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const gRef = useRef(g);
  gRef.current = g;
  const pos = useRef<{ x: number; y: number; facing: number } | null>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    let raf = 0, last = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 90) return;          // about ten frames a second, like the pixel art it is
      last = now;
      const gg = gRef.current;
      let del: PWorld['delamain'] = null;
      if (gg.here && gg.visit) {
        const st = (gg.visit.steps || []).filter(s => s.at <= Date.now() / 1000).pop();
        let target = { x: 170, y: 152 }, doing = 'look';
        if (st) {
          doing = st.do;
          target = st.spot >= 0 && st.spot < SPOTS.length ? SPOTS[st.spot].stand : (BENCH_STAND[gg.cat.where || 'inside'] || BENCH_STAND.inside);
        }
        if (!pos.current) pos.current = { x: 170, y: 152, facing: -1 };     // he comes in by the greenhouse door
        const p = pos.current;
        const tx = target.x + 7, dx = tx - p.x, dy = target.y - p.y;
        const walking = Math.abs(dx) > 0.6 || Math.abs(dy) > 0.6;
        if (walking) {
          const d = Math.hypot(dx, dy), step = Math.min(d, 1.4);
          p.x += (dx / d) * step; p.y += (dy / d) * step;
          if (Math.abs(dx) > 0.6) p.facing = dx > 0 ? 1 : -1;
        } else p.facing = SPOTS.some(s => Math.abs(s.stand.x + 7 - p.x) < 1) ? -1 : p.facing;   // turn to the plant
        del = { x: p.x, y: p.y, walking, doing: walking ? 'look' : doing, facing: p.facing };
      } else pos.current = null;
      render(ctx, {
        hour: gg.hour, isDay: gg.weather.is_day, cloud: gg.weather.cloud, rain: gg.weather.rain, snow: gg.weather.snow,
        temp: gg.weather.temp, growLight: gg.grow_light, spots: gg.spots,
        cat: gg.cat.here ? { here: true, where: gg.cat.where, doing: gg.cat.doing } : null, delamain: del,
      }, (now - t0) / 1000);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <canvas ref={ref} width={W} height={H} className="w-full rounded-md border border-emerald-400/25 bg-black"
      style={{ imageRendering: 'pixelated' }} role="img" aria-label={`His garden${g.here ? ', with Delamain in it' : ''}`} />
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
          <PixelScene g={g} />
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
