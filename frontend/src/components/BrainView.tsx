import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Info } from 'lucide-react';
import { createBrain, REGION_INFO, TOOL_WORDS, type Brain, type BrainEvent, type RegionKey } from './brain/brainRenderer';
import { PERSONAS } from '../personas';

// Delamain's brain: a live view of what he is doing, fed by the backend's brain events
// (brain.py, /api/brain/events). Your words fly into Hearing, his leave from Voice, and every
// thought, tool and correction lights the part of the brain that does it.

type Today = {
  heard: number; replies: number; reflexes: number; llm_rounds: number; tokens_in: number; tokens_out: number;
  think_ms: number; tools: Record<string, number>; corrections: number; voice_ms: number; routes: number; reminders: number;
};
type Line = { id: number; t: number; icon: string; text: string; color: string };

const coreOf = (key: unknown) => PERSONAS.find(p => p.key === key) ?? PERSONAS[0];
const clock = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const quote = (s: unknown, n = 70) => {
  const str = String(s ?? '');
  return str.length > n ? `“${str.slice(0, n)}…”` : `“${str}”`;
};
const REFLEX_WORDS: Record<string, string> = { thanks: 'thanks', greeting: 'a greeting', rude: 'an insult', song: 'an insult, with a song', dm_pause: '“pause the game”' };

// One plain-English line per event for the thought stream.
function describe(ev: BrainEvent): Omit<Line, 'id' | 't'> | null {
  const R = REGION_INFO;
  switch (ev.kind) {
    case 'heard': return { icon: '👂', text: `Heard you: ${quote(ev.text)}`, color: R.hearing.color };
    case 'reflex': return { icon: '⚡', text: `Reflex: an instant pre-recorded reply to ${REFLEX_WORDS[String(ev.what)] ?? String(ev.what ?? 'that').replace(/_/g, ' ')}. No language model needed.`, color: R.reflex.color };
    case 'think_start':
      return ev.source === 'scribe'
        ? { icon: '📜', text: 'Writing up the adventure chronicle in the background.', color: R.imagination.color }
        : { icon: '🧠', text: Number(ev.round) > 0 ? `Thinking again (round ${Number(ev.round) + 1}) with what the tools found.` : 'Thinking about your request.', color: R.core.color };
    case 'think_end': {
      if (ev.ok === false) return { icon: '⚠️', text: 'The language model did not answer.', color: '#f87171' };
      const calls = (ev.calls as string[] | undefined) ?? [];
      const toks = ev.completion_tokens ? `${ev.completion_tokens} tokens` : '';
      const secs = ev.ms ? `${(Number(ev.ms) / 1000).toFixed(1)} s` : '';
      const what = calls.length ? `reaching for ${calls.length === 1 ? 'a tool' : `${calls.length} tools`}: ${calls.map(c => TOOL_WORDS[c] ?? c).join(', ')}` : ev.source === 'scribe' ? 'chronicle updated' : 'reply written';
      return { icon: '💭', text: `${what[0].toUpperCase()}${what.slice(1)}${toks || secs ? ` (${[toks, secs].filter(Boolean).join(' · ')})` : ''}.`, color: R.core.color };
    }
    case 'tool_start': {
      const region = (ev.region as Exclude<RegionKey, 'stem'>) ?? 'senses';
      const w = TOOL_WORDS[String(ev.name)] ?? String(ev.name);
      return { icon: '🛠️', text: `${w[0].toUpperCase()}${w.slice(1)}${ev.auto ? ' (automatic search)' : ''}…`, color: R[region]?.color ?? R.senses.color };
    }
    case 'tool_end': return null;
    case 'correction': return {
      icon: '🫢',
      text: ev.reason === 'action' ? `Caught himself promising ${quote(ev.promise, 40)} without doing it. Going back to actually do it.`
        : ev.reason === 'save' ? 'Caught himself claiming to have saved something without saving it. Going back to do it.'
        : 'Started the news without reading the headlines. Going back for them.',
      color: R.conscience.color,
    };
    case 'navigate': return { icon: '🧭', text: `Found ${ev.options} place${ev.options === 1 ? '' : 's'} for your destination.`, color: R.navigation.color };
    case 'voice_start': return null;
    case 'voice_end': return ev.ok === false ? { icon: '⚠️', text: 'Voice synthesis failed.', color: '#f87171' } : { icon: '🎙️', text: `Voice ready (${(Number(ev.ms ?? 0) / 1000).toFixed(1)} s to synthesize).`, color: R.voice.color };
    case 'spoke': {
      const src = String(ev.source ?? '');
      const lead = src === 'greeting' ? 'Greeted you' : src === 'reminder' ? 'Reminder' : src === 'working' ? 'Said, while working' : src === 'canned' ? 'Replied (pre-recorded)' : src === 'error' ? 'Apologised' : 'Said';
      return { icon: '💬', text: `${lead}: ${quote(ev.text, 90)}`, color: coreOf(ev.persona).color };
    }
    case 'core': return { icon: '🔁', text: `Personality core switched to ${coreOf(ev.persona).name}.`, color: coreOf(ev.persona).color };
    case 'clients': return { icon: '🔌', text: `${ev.count} screen${ev.count === 1 ? '' : 's'} connected.`, color: '#64748b' };
    case 'error': return { icon: '⚠️', text: `Something went wrong (${String(ev.message ?? 'error')}). He apologised and you can ask again.`, color: '#f87171' };
    default: return null;
  }
}

// What he is doing right now, in his own register.
function statusLine(phase: string, tool: string | null, core: string): string {
  switch (phase) {
    case 'hearing': return 'Listening.';
    case 'thinking': return 'Considering your request.';
    case 'scribe': return 'Committing the adventure to the chronicle.';
    case 'tool': return tool ? `${tool[0].toUpperCase()}${tool.slice(1)}.` : 'Consulting my instruments.';
    case 'conscience': return 'A moment. I said I would do something; I shall do it now.';
    case 'voice': return 'Composing my voice.';
    case 'speaking': return 'Speaking.';
    default: return `${core} core online. At rest, attentive.`;
  }
}

export function BrainView({ token, onClose }: { token: string; onClose: () => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const brainRef = useRef<Brain | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [today, setToday] = useState<Today | null>(null);
  const [persona, setPersona] = useState<string>('delamain');
  const [phase, setPhase] = useState('idle');
  const [tool, setTool] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [model, setModel] = useState('');
  const [tps, setTps] = useState<number | null>(null);
  const [showKey, setShowKey] = useState(false);
  const lineId = useRef(0);
  const toolsRunning = useRef(new Map<string, string>());

  const push = useCallback((ev: BrainEvent) => {
    const d = describe(ev);
    if (!d) return;
    setLines(ls => [{ id: ++lineId.current, t: Number(ev.t ?? Date.now() / 1000), ...d }, ...ls].slice(0, 80));
  }, []);

  // The canvas renderer lives for as long as the view is open.
  useEffect(() => {
    if (!canvasRef.current || !stageRef.current) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const b = createBrain(canvasRef.current, stageRef.current, { reducedMotion: reduced });
    brainRef.current = b;
    if (location.search.includes('debug')) (window as unknown as { __delamainBrain: Brain }).__delamainBrain = b;
    const id = setInterval(() => setPhase(b.phase()), 250);
    return () => { clearInterval(id); b.destroy(); brainRef.current = null; };
  }, []);

  // The live event feed.
  useEffect(() => {
    const es = new EventSource(`/api/brain/events?token=${encodeURIComponent(token)}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener('snapshot', (e) => {
      const s = JSON.parse((e as MessageEvent).data);
      setToday(s.today);
      setModel(s.llm_model ?? '');
      const p = s.state?.persona ?? 'delamain';
      setPersona(p);
      brainRef.current?.setCore(coreOf(p).color);
      setTps(s.metrics?.tps ?? null);
      lineId.current = 0;
      const recent: Line[] = [];
      for (const ev of (s.recent ?? []) as BrainEvent[]) {
        const d = describe(ev);
        if (d) recent.unshift({ id: ++lineId.current, t: Number(ev.t), ...d });
      }
      setLines(recent.slice(0, 80));
    });
    es.addEventListener('metrics', (e) => {
      const m = JSON.parse((e as MessageEvent).data);
      setTps(m.tps ?? null);
      brainRef.current?.setTps(m.tps ?? null);
    });
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data) as BrainEvent;
      if ((ev.kind === 'core' || ev.kind === 'heard' || ev.kind === 'spoke') && ev.persona) {
        setPersona(String(ev.persona));
        brainRef.current?.setCore(coreOf(ev.persona).color);
      }
      if (ev.kind === 'tool_start') toolsRunning.current.set(String(ev.name), TOOL_WORDS[String(ev.name)] ?? String(ev.name));
      if (ev.kind === 'tool_end') toolsRunning.current.delete(String(ev.name));
      setTool([...toolsRunning.current.values()].pop() ?? null);
      brainRef.current?.event(ev);
      push(ev);
      setToday(t => {
        if (!t) return t;
        const n = { ...t, tools: { ...t.tools } };
        if (ev.kind === 'heard') n.heard++;
        if (ev.kind === 'spoke') n.replies++;
        if (ev.kind === 'reflex') n.reflexes++;
        if (ev.kind === 'correction') n.corrections++;
        if (ev.kind === 'navigate') n.routes++;
        if (ev.kind === 'tool_start') n.tools[String(ev.name)] = (n.tools[String(ev.name)] ?? 0) + 1;
        if (ev.kind === 'think_end') {
          n.llm_rounds++;
          n.tokens_in += Number(ev.prompt_tokens) || 0;
          n.tokens_out += Number(ev.completion_tokens) || 0;
          n.think_ms += Number(ev.ms) || 0;
        }
        if (ev.kind === 'voice_end') n.voice_ms += Number(ev.ms) || 0;
        return n;
      });
    };
    return () => es.close();
  }, [token, push]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const core = coreOf(persona);
  const toolCount = today ? Object.values(today.tools).reduce((a, b) => a + b, 0) : 0;
  const avgThink = today && today.llm_rounds ? today.think_ms / today.llm_rounds / 1000 : null;
  const stats: [string, string][] = today ? [
    ['Heard', String(today.heard)],
    ['Replies', String(today.replies)],
    ['Reflexes', String(today.reflexes)],
    ['Thoughts', String(today.llm_rounds)],
    ['Avg think', avgThink != null ? `${avgThink.toFixed(1)} s` : '—'],
    ['Tokens', today.tokens_out ? `${today.tokens_in.toLocaleString()} → ${today.tokens_out.toLocaleString()}` : '—'],
    ['Tools', String(toolCount)],
    ['Self-corrections', String(today.corrections)],
  ] : [];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-cyber-dark/97 backdrop-blur-sm text-gray-200 font-rajdhani">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-cyber-blue/20 bg-cyber-dark/80">
        <span className="font-mono text-cyber-blue text-sm tracking-[0.25em] hidden sm:inline">DELAMAIN // NEURAL MAP</span>
        <span className="font-mono text-cyber-blue text-sm tracking-[0.2em] sm:hidden">NEURAL MAP</span>
        <span className="flex items-center gap-2 px-2.5 py-1 rounded border text-xs font-bold tracking-wider uppercase"
          style={{ borderColor: `${core.color}80`, color: core.color, background: `${core.color}14` }}>
          <span className="w-2 h-2 rounded-full" style={{ background: core.color, boxShadow: `0 0 8px ${core.color}` }} />
          {core.name}
        </span>
        <span className="flex-1 truncate text-sm text-gray-300 italic">{statusLine(phase, tool, core.name)}</span>
        <span className={`hidden md:inline font-mono text-[11px] ${connected ? 'text-green-400/70' : 'text-cyber-red/80'}`}>
          {connected ? `● live${tps ? ` · ${tps} tok/s` : ''}` : '○ reconnecting'}
        </span>
        <button onClick={() => setShowKey(k => !k)} title="What each region does"
          className={`p-2 rounded-lg transition-colors ${showKey ? 'bg-cyber-blue/20 text-cyber-blue' : 'text-gray-500 hover:text-cyber-blue hover:bg-cyber-gray'}`}>
          <Info size={20} />
        </button>
        <button onClick={onClose} title="Close (Esc)" className="p-2 rounded-lg text-gray-500 hover:text-cyber-red hover:bg-cyber-gray transition-colors">
          <X size={22} />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        {/* The brain */}
        <div ref={stageRef} className="relative flex-1 min-h-[52vh] md:min-h-0">
          <canvas ref={canvasRef} className="block w-full h-full" />
          {showKey && (
            <div className="absolute left-3 top-3 max-w-[340px] p-3 rounded-lg border border-cyber-blue/30 bg-cyber-dark/90 text-sm space-y-1.5 shadow-xl">
              <p className="text-gray-300 leading-snug">Each region lights up when Delamain uses it. The dots stand in for the model's
                weights; tap a region for what it does. Your words fly into <b>Hearing</b>, his leave from <b>Voice</b>.</p>
              {(Object.keys(REGION_INFO) as (keyof typeof REGION_INFO)[]).map(k => (
                <div key={k} className="flex gap-2 items-baseline">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0 translate-y-0.5"
                    style={{ background: k === 'core' ? core.color : REGION_INFO[k].color, boxShadow: `0 0 6px ${k === 'core' ? core.color : REGION_INFO[k].color}` }} />
                  <span className="text-gray-400 leading-snug">{REGION_INFO[k].tip}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Thought stream + today */}
        <aside className="md:w-[380px] shrink-0 flex flex-col min-h-0 border-t md:border-t-0 md:border-l border-cyber-blue/15 bg-cyber-gray/20 max-h-[44vh] md:max-h-none">
          <div className="grid grid-cols-4 gap-px bg-cyber-blue/10 border-b border-cyber-blue/15">
            {stats.map(([k, v]) => (
              <div key={k} className="bg-cyber-dark/80 px-2 py-1.5">
                <div className="font-mono text-[13px] text-white truncate">{v}</div>
                <div className="text-[10px] uppercase tracking-wider text-gray-500 truncate">{k}</div>
              </div>
            ))}
          </div>
          <div className="px-3 pt-2 pb-1 flex items-center justify-between">
            <span className="text-xs font-bold tracking-[0.2em] text-cyber-blue/80 uppercase">Thought stream</span>
            {model && <span className="font-mono text-[10px] text-gray-500 truncate max-w-[60%]">{model}</span>}
          </div>
          <ol className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1.5">
            {lines.length === 0 && <li className="text-sm text-gray-500 italic">Quiet. Speak to Delamain and watch him think.</li>}
            {lines.map(l => (
              <li key={l.id} className="flex gap-2 text-sm leading-snug">
                <span className="shrink-0 w-5 text-center">{l.icon}</span>
                <span className="flex-1 text-gray-300" style={{ borderLeft: `2px solid ${l.color}55`, paddingLeft: 8 }}>{l.text}</span>
                <span className="shrink-0 font-mono text-[10px] text-gray-600 pt-0.5">{clock(l.t)}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
