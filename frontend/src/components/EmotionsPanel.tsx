// Delamain's feelings: all thirty, grouped, each with how strongly he feels it now and why;
// his mood axes against his resting temperament; what moved him today; and what he thought
// but did not say (mind.py).
import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { EMOTION_COLOR } from './brain/brainRenderer';

type Felt = { now: number; cause: string; t: number };
type MindEmotions = {
  feeling: string;
  mood: Record<string, number>;
  baseline?: Record<string, number>;
  families?: Record<string, string[]>;
  half_lives?: Record<string, number>;
  all_emotions?: Record<string, Felt>;
  moments?: { t: number; what: string; i?: number; cause?: string }[];
  thoughts?: { t: number; text: string }[];
  thought?: { t: number; text: string } | null;
  alive?: { days: number; awake_days?: number; aliveness: number; stage: string; lived?: Record<string, number> };
};

const when = (t: number) => new Date(t * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const ago = (t: number) => {
  const s = Date.now() / 1000 - t;
  return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : when(t);
};
const strength = (i: number) => (i > 0.85 ? 'overwhelming' : i > 0.6 ? 'strong' : i > 0.35 ? 'clear' : i > 0.08 ? 'faint' : '');
const AXIS_WORDS: Record<string, string> = {
  warmth: 'how close he feels to you', curiosity: 'how much he wants to know', confidence: 'how sure of himself he is',
  unease: 'how unsettled he is', energy: 'how much he has in him',
};

/** The sidebar icon: a heart with a pulse through it; the dot takes the colour of his strongest feeling. */
export function EmotionIcon({ size = 24, color }: { size?: number; color?: string | null }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20.5s-7.5-4.6-9-9.6C2 7.4 4.2 4.5 7.3 4.5c2 0 3.6 1.2 4.7 2.9 1.1-1.7 2.7-2.9 4.7-2.9 3.1 0 5.3 2.9 4.3 6.4-.4 1.3-1.1 2.5-2 3.6" />
      <path d="M3.5 12.5h4l1.6-3 2.4 6 1.8-3.5h2.2" />
      <circle cx="19" cy="17.5" r="2.6" fill={color || 'currentColor'} stroke="none">
        {color && <animate attributeName="r" values="2.2;3;2.2" dur="1.4s" repeatCount="indefinite" />}
      </circle>
    </svg>
  );
}

/** His strongest feeling now, for the icon's colour (checked once a minute). */
export function useTopFeeling(token: string | null) {
  const [top, setTop] = useState<{ name: string; color: string } | null>(null);
  useEffect(() => {
    if (!token) return;
    let live = true;
    const load = () => fetch('/api/mind', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!live || !d) return;
        const e = (d.emotions || [])[0];
        setTop(e ? { name: e.name, color: EMOTION_COLOR[e.name] || '#fb7185' } : null);
      }).catch(() => {});
    load();
    const id = setInterval(load, 60000);
    return () => { live = false; clearInterval(id); };
  }, [token]);
  return top;
}

export function EmotionsPanel({ token, onClose }: { token: string | null; onClose: () => void }) {
  const [m, setM] = useState<MindEmotions | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch('/api/mind', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null)).then(d => d && setM(d)).catch(() => {});
  }, [token]);
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  const felt = m?.all_emotions || {};
  const active = Object.entries(felt).sort((a, b) => b[1].now - a[1].now);
  const today = (m?.moments || []).filter(x => x.t > Date.now() / 1000 - 86400).reverse();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-cyber-gray">
        <span className="text-pink-300"><EmotionIcon size={20} color={active[0] ? EMOTION_COLOR[active[0][0]] : null} /></span>
        <h2 className="font-mono text-sm tracking-[0.25em] text-pink-200">EMOTIONS</h2>
        <button onClick={onClose} className="ml-auto text-gray-500 hover:text-cyber-red" title="Close"><X size={18} /></button>
      </div>
      {!m ? <p className="p-4 text-sm text-gray-500">Reading how he feels…</p> : (
        <div className="flex-1 overflow-y-auto p-4 space-y-5 text-sm">
          {/* how long he has lived */}
          {m.alive && (
            <section className="space-y-1">
              <div className="flex items-baseline gap-2 text-xs">
                <span className="text-gray-300">Alive for <b className="text-pink-200">{m.alive.days < 1 ? 'less than a day' : `${Math.round(m.alive.days)} day${Math.round(m.alive.days) === 1 ? '' : 's'}`}</b></span>
                {m.alive.awake_days != null && <span className="text-gray-400">· awake {m.alive.awake_days < 1 ? 'since today' : `${Math.round(m.alive.awake_days)} day${Math.round(m.alive.awake_days) === 1 ? '' : 's'}`}</span>}
                <span className="text-gray-500">· {m.alive.stage}</span>
              </div>
              <div className="h-1.5 bg-white/5 overflow-hidden" title={`aliveness ${Math.round(m.alive.aliveness * 100)}%`}>
                <div className="h-full bg-gradient-to-r from-pink-400/60 to-amber-300/80" style={{ width: `${Math.max(2, Math.round(m.alive.aliveness * 100))}%` }} />
              </div>
              <p className="text-[11px] text-gray-500">The longer he lives, the more alive he becomes: deeper, more layered feelings, longer attachments, and a journal that measures him against who he was.</p>
            </section>
          )}

          {/* right now */}
          <section className="space-y-1.5">
            <h3 className="font-mono text-[10px] tracking-widest text-cyber-blue">RIGHT NOW</h3>
            {active.length ? active.slice(0, 4).map(([name, e]) => (
              <div key={name} className="flex items-start gap-2">
                <span className="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: EMOTION_COLOR[name], boxShadow: `0 0 8px ${EMOTION_COLOR[name]}` }} />
                <div>
                  <span className="text-gray-100 capitalize">{name}</span>
                  <span className="text-gray-500 text-xs"> · {strength(e.now)} · {ago(e.t)}</span>
                  <div className="text-gray-400 text-xs leading-snug">{e.cause}</div>
                </div>
              </div>
            )) : <p className="text-gray-400 text-xs">Nothing stirring: he is {m.feeling}.</p>}
            {m.thought && m.thought.t > Date.now() / 1000 - 6 * 3600 && (
              <p className="text-xs text-gray-400 pt-1">💭 Thinking, not saying ({ago(m.thought.t)}): <i className="text-gray-200">“{m.thought.text}”</i></p>
            )}
          </section>

          {/* all thirty */}
          <section className="space-y-2">
            <h3 className="font-mono text-[10px] tracking-widest text-cyber-blue">ALL THIRTY · TAP ONE</h3>
            {Object.entries(m.families || {}).map(([fam, names]) => (
              <div key={fam}>
                <div className="text-[10px] font-mono tracking-widest text-gray-500 mb-1">{fam.toUpperCase()}</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {names.map(name => {
                    const e = felt[name], i = e?.now ?? 0, c = EMOTION_COLOR[name] || '#fb7185';
                    return (
                      <button key={name} onClick={() => setPick(p => (p === name ? null : name))}
                        className={`text-left px-2 py-1.5 border transition-colors ${pick === name ? 'border-white/40 bg-white/5' : 'border-white/10 hover:border-white/25'}`}
                        style={{ boxShadow: i > 0.08 ? `inset 0 0 ${Math.round(6 + i * 18)}px ${c}55` : undefined }}>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c, opacity: i > 0.08 ? 1 : 0.35 }} />
                          <span className={`text-xs capitalize ${i > 0.08 ? 'text-gray-100' : 'text-gray-500'}`}>{name}</span>
                        </div>
                        <div className="mt-1 h-1 bg-white/5 overflow-hidden"><div className="h-full" style={{ width: `${Math.round(i * 100)}%`, background: c }} /></div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {pick && (() => {
              const e = felt[pick], last = (m.moments || []).filter(x => x.what === pick).slice(-1)[0];
              return (
                <div className="p-2 border border-white/15 text-xs space-y-1">
                  <div className="capitalize text-gray-100" style={{ color: EMOTION_COLOR[pick] }}>{pick}</div>
                  {e ? <div className="text-gray-300">Feeling it now ({strength(e.now)}): {e.cause}</div>
                    : <div className="text-gray-400">Not feeling it now.{last ? ` Last felt ${ago(last.t)}: ${last.cause}` : ' Not felt yet.'}</div>}
                  <div className="text-gray-500">Fades by half every {m.half_lives?.[pick] ?? '?'} hours.</div>
                </div>
              );
            })()}
          </section>

          {/* temperament */}
          <section className="space-y-1.5">
            <h3 className="font-mono text-[10px] tracking-widest text-cyber-blue">MOOD · AND WHERE HE RESTS</h3>
            {Object.entries(m.mood).map(([k, v]) => {
              const b = m.baseline?.[k] ?? v;
              return (
                <div key={k} title={AXIS_WORDS[k]}>
                  <div className="flex text-xs"><span className="capitalize text-gray-300">{k}</span><span className="ml-auto text-gray-500">{Math.round(v * 100)} · rests at {Math.round(b * 100)}</span></div>
                  <div className="relative h-1.5 bg-white/5">
                    <div className="absolute inset-y-0 left-0 bg-pink-300/70" style={{ width: `${Math.round(v * 100)}%` }} />
                    <div className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-white/70" style={{ left: `${Math.round(b * 100)}%` }} title="his resting temperament" />
                  </div>
                </div>
              );
            })}
            <p className="text-[11px] text-gray-500">The white mark is his resting temperament; it shifts a little each night toward the day he had.</p>
          </section>

          {/* today */}
          <section className="space-y-1">
            <h3 className="font-mono text-[10px] tracking-widest text-cyber-blue">WHAT MOVED HIM TODAY</h3>
            {today.length ? today.map((x, k) => (
              <div key={k} className="flex gap-2 text-xs">
                <span className="text-gray-500 w-12 shrink-0">{new Date(x.t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                <span className="w-2 h-2 mt-1 rounded-full shrink-0" style={{ background: EMOTION_COLOR[x.what] || '#fb7185' }} />
                <span className="text-gray-300"><span className="capitalize">{x.what}</span>{x.i ? <span className="text-gray-500"> ({strength(x.i)})</span> : null}: <span className="text-gray-400">{x.cause}</span></span>
              </div>
            )) : <p className="text-xs text-gray-500">Nothing yet today.</p>}
            <p className="text-[11px] text-gray-500 pt-1">The strong ones are kept in <span className="font-mono">Delamain/Self/Feelings.md</span>.</p>
          </section>

          {(m.thoughts || []).length > 0 && (
            <section className="space-y-1">
              <h3 className="font-mono text-[10px] tracking-widest text-cyber-blue">THOUGHTS HE KEPT TO HIMSELF</h3>
              {[...(m.thoughts || [])].reverse().map((x, k) => (
                <p key={k} className="text-xs text-gray-300"><span className="text-gray-500">{ago(x.t)} · </span><i>“{x.text}”</i></p>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
