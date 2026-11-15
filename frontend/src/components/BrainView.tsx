import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { X, Info, Mic, Send, Radio, Maximize2, Minimize2, PanelBottomOpen, ZoomIn, ZoomOut, Crosshair, Zap } from 'lucide-react';
import { createBrain, REGION_INFO, TOOL_WORDS, type Brain, type BrainEvent, type RegionKey, type SpeechClock } from './brain/brainRenderer';
import { PERSONAS } from '../personas';

// Delamain's neural core: a live view of what he is doing, fed by the backend's brain events
// (brain.py, /api/brain/events). Your words fly into the audio intake, his leave from the
// vocoder, and every thought, tool and correction lights the subsystem that does it. You can
// talk to him from here: the mic, the text box and the wake word are the main page's own.

type Today = {
  heard: number; replies: number; reflexes: number; llm_rounds: number; tokens_in: number; tokens_out: number;
  think_ms: number; tools: Record<string, number>; corrections: number; voice_ms: number; routes: number; reminders: number;
};
type Line = { id: number; t: number; icon: string; text: string; color: string };

export type TalkControls = {
  listening: boolean; heardLive: string; speech: SpeechClock | null; talking: boolean; thinking: boolean;
  micSupported: boolean; wakeWord: boolean; wakeBlocked: boolean;
  onMic: () => void; onSend: (text: string) => void; onToggleWake: () => void;
};

const coreOf = (key: unknown) => PERSONAS.find(p => p.key === key) ?? PERSONAS[0];
const clock = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const quote = (s: unknown, n = 70) => {
  const str = String(s ?? '');
  return str.length > n ? `“${str.slice(0, n)}…”` : `“${str}”`;
};
const REFLEX_WORDS: Record<string, string> = { thanks: 'thanks', greeting: 'a greeting', rude: 'an insult', song: 'an insult, with a song', dm_pause: '“pause the game”' };
const tag = (r: keyof typeof REGION_INFO) => REGION_INFO[r].code;

// One plain-English line per event for the thought stream, tagged with the subsystem.
function describe(ev: BrainEvent): Omit<Line, 'id' | 't'> | null {
  const R = REGION_INFO;
  switch (ev.kind) {
    case 'heard': return { icon: '👂', text: `${tag('hearing')} · Heard you: ${quote(ev.text)}`, color: R.hearing.color };
    case 'reflex': return { icon: '⚡', text: `${tag('reflex')} · Instant pre-recorded reply to ${REFLEX_WORDS[String(ev.what)] ?? String(ev.what ?? 'that').replace(/_/g, ' ')}. No language model needed.`, color: R.reflex.color };
    case 'think_start':
      return ev.source === 'scribe'
        ? { icon: '📜', text: `${tag('imagination')} · Writing up the adventure chronicle in the background.`, color: R.imagination.color }
        : { icon: '🧠', text: `${tag('core')} · ${Number(ev.round) > 0 ? `Thinking again (round ${Number(ev.round) + 1}) with what the tools found.` : 'Thinking about your request.'}`, color: R.core.color };
    case 'think_end': {
      if (ev.ok === false) return { icon: '⚠️', text: 'The language model did not answer.', color: '#f87171' };
      const calls = (ev.calls as string[] | undefined) ?? [];
      const toks = ev.completion_tokens ? `${ev.completion_tokens} tokens` : '';
      const secs = ev.ms ? `${(Number(ev.ms) / 1000).toFixed(1)} s` : '';
      const what = calls.length ? `reaching for ${calls.length === 1 ? 'a tool' : `${calls.length} tools`}: ${calls.map(c => TOOL_WORDS[c] ?? c).join(', ')}` : ev.source === 'scribe' ? 'chronicle updated' : 'reply written';
      return { icon: '💭', text: `${tag('core')} · ${what[0].toUpperCase()}${what.slice(1)}${toks || secs ? ` (${[toks, secs].filter(Boolean).join(' · ')})` : ''}.`, color: R.core.color };
    }
    case 'tool_start': {
      const region = (ev.region as Exclude<RegionKey, 'stem'>) ?? 'senses';
      const w = TOOL_WORDS[String(ev.name)] ?? String(ev.name);
      return { icon: '🛠️', text: `${R[region]?.code ?? ''} · ${w[0].toUpperCase()}${w.slice(1)}${ev.auto ? ' (automatic search)' : ''}…`, color: R[region]?.color ?? R.senses.color };
    }
    case 'tool_end': return null;
    case 'correction': return {
      icon: '🫢',
      text: `${tag('conscience')} · ` + (ev.reason === 'action' ? `Caught himself promising ${quote(ev.promise, 40)} without doing it. Going back to actually do it.`
        : ev.reason === 'save' ? 'Caught himself claiming to have saved something without saving it. Going back to do it.'
        : 'Started the news without reading the headlines. Going back for them.'),
      color: R.conscience.color,
    };
    case 'navigate': return { icon: '🧭', text: `${tag('navigation')} · Found ${ev.options} place${ev.options === 1 ? '' : 's'} for your destination.`, color: R.navigation.color };
    case 'voice_start': return null;
    case 'voice_end': return ev.ok === false ? { icon: '⚠️', text: 'Voice synthesis failed.', color: '#f87171' } : { icon: '🎙️', text: `${tag('voice')} · Voice ready (${(Number(ev.ms ?? 0) / 1000).toFixed(1)} s to synthesize).`, color: R.voice.color };
    case 'spoke': {
      const src = String(ev.source ?? '');
      const lead = src === 'greeting' ? 'Greeted you' : src === 'reminder' ? 'Reminder' : src === 'working' ? 'Said, while working' : src === 'canned' ? 'Replied (pre-recorded)' : src === 'error' ? 'Apologised' : 'Said';
      return { icon: '💬', text: `${lead}: ${quote(ev.text, 90)}`, color: coreOf(ev.persona).color };
    }
    case 'core': return { icon: '🔁', text: `Personality core switched to ${coreOf(ev.persona).name}.`, color: coreOf(ev.persona).color };
    case 'clients': return { icon: '🔌', text: `${ev.count} screen${ev.count === 1 ? '' : 's'} linked.`, color: '#64748b' };
    case 'error': return { icon: '⚠️', text: `Fault (${String(ev.message ?? 'error')}). He apologised; ask again.`, color: '#f87171' };
    default: return null;
  }
}

// What he is doing right now, in his own register.
function statusLine(phase: string, tool: string | null, core: string): string {
  switch (phase) {
    case 'listening': return 'Listening. Go on.';
    case 'hearing': return 'Message received.';
    case 'thinking': return 'Considering your request.';
    case 'scribe': return 'Committing the adventure to the chronicle.';
    case 'tool': return tool ? `${tool[0].toUpperCase()}${tool.slice(1)}.` : 'Consulting my instruments.';
    case 'conscience': return 'A moment. I said I would do something; I shall do it now.';
    case 'voice': return 'Composing my voice.';
    case 'speaking': return 'Speaking.';
    default: return `${core} core online. At rest, attentive.`;
  }
}

// Angular HUD corners (written out in full so Tailwind can see them)
const CUT: Record<number, string> = {
  6: '[clip-path:polygon(6px_0,100%_0,100%_calc(100%-6px),calc(100%-6px)_100%,0_100%,0_6px)]',
  8: '[clip-path:polygon(8px_0,100%_0,100%_calc(100%-8px),calc(100%-8px)_100%,0_100%,0_8px)]',
  10: '[clip-path:polygon(10px_0,100%_0,100%_calc(100%-10px),calc(100%-10px)_100%,0_100%,0_10px)]',
};
const cut = (n: 6 | 8 | 10) => CUT[n];

export function BrainView({ token, onClose, talk, face }: { token: string; onClose: () => void; talk: TalkControls; face?: ReactNode }) {
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
  // Full brain: the panels under the mic (numbers, thought stream, face) fold away. Remembered per browser.
  const [full, setFull] = useState(() => { try { return localStorage.getItem('brainFull') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('brainFull', full ? '1' : '0'); } catch { /* private mode */ } }, [full]);
  const [draft, setDraft] = useState('');
  const [hud, setHud] = useState({ signals: 0, lit: 0, neurons: 0, session: 0, zoom: 1 });
  // The node picked in the brain (tap a dot), refreshed live for the inspector card
  type NodeInfo = NonNullable<ReturnType<Brain['inspect']>>;
  const [node, setNode] = useState<NodeInfo | null>(null);
  const nodeRef = useRef<NodeInfo | null>(null);
  useEffect(() => { nodeRef.current = node; });
  const lineId = useRef(0);
  const toolsRunning = useRef(new Map<string, string>());
  const talkRef = useRef(talk);
  useEffect(() => { talkRef.current = talk; });

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
    const opened = Date.now();
    const id = setInterval(() => {
      setPhase(b.phase());
      const s = b.stats();
      setHud({ signals: s.signals, lit: s.lit, neurons: s.neurons, session: Math.floor((Date.now() - opened) / 1000), zoom: s.zoom });
      setNode(b.inspect());
    }, 250);
    return () => { clearInterval(id); b.destroy(); brainRef.current = null; };
  }, []);

  // The mic and the speaker drive the brain directly: listening lights the audio intake,
  // recognized words fly in as you speak, and the vocoder glows exactly while he is heard.
  useEffect(() => { brainRef.current?.setListening(talk.listening); }, [talk.listening]);
  useEffect(() => { brainRef.current?.setSpeaking(talk.talking); }, [talk.talking]);
  useEffect(() => { if (talk.heardLive) brainRef.current?.feedLive(talk.heardLive); }, [talk.heardLive]);
  // his words leave the vocoder in time with his actual voice
  useEffect(() => { if (talk.speech?.text) brainRef.current?.speak(talk.speech); }, [talk.speech]);

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (nodeRef.current) brainRef.current?.select(null); else onClose(); }
      const typingNow = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (!typingNow && (e.key === '+' || e.key === '=')) brainRef.current?.zoomBy(1.4);
      if (!typingNow && (e.key === '-' || e.key === '_')) brainRef.current?.zoomBy(1 / 1.4);
      if (!typingNow && e.key === '0') brainRef.current?.resetView();
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (!typing && (e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) setFull(v => !v);
      // Space opens the mic, unless you are typing
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)
          && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        talkRef.current.onMic();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    talk.onSend(text);
    setDraft('');
  };

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
    ['Self-checks', String(today.corrections)],
  ] : [];

  const regionName = (r: string) => r === 'stem' ? { code: 'BRAIN STEM', label: 'Relay', sub: 'carries signals between the parts', color: '#607dbe' }
    : r === 'core' ? { ...REGION_INFO.core, color: core.color } : REGION_INFO[r as keyof typeof REGION_INFO];
  const load = hud.neurons ? Math.round((hud.lit / hud.neurons) * 100) : 0;
  const wake = !talk.micSupported
    ? { text: 'NO SPEECH RECOGNITION IN THIS BROWSER · TYPE INSTEAD', color: '#64748b' }
    : talk.wakeBlocked
      ? { text: 'WAKE WORD BLOCKED · ALLOW THE MIC FOR THIS SITE', color: '#f87171' }
      : talk.listening
        ? { text: 'MIC OPEN · SPEAK NOW', color: '#fcd34d' }
        : talk.wakeWord
          ? { text: 'WAKE WORD ARMED · SAY “DELAMAIN”', color: '#4ade80' }
          : { text: 'WAKE WORD OFF', color: '#94a3b8' };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#05060a] text-gray-200 font-rajdhani">
      {/* Header */}
      <div className="relative flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 border-b border-cyber-blue/25 bg-[#07090f]">
        <div className="flex flex-col leading-none shrink-0">
          <span className="font-mono text-cyber-blue text-sm tracking-[0.25em]">DELAMAIN<span className="hidden sm:inline"><span className="text-cyber-red">//</span>NEURAL CORE</span></span>
          <span className="hidden sm:block font-mono text-[9px] tracking-[0.3em] text-gray-500 mt-1">SOVEREIGN TRANSPORT INTELLIGENCE · LIVE DIAGNOSTIC</span>
        </div>
        <span className={`flex items-center gap-2 px-2.5 py-1 border text-xs font-bold tracking-wider uppercase shrink-0 ${cut(6)}`}
          style={{ borderColor: `${core.color}90`, color: core.color, background: `${core.color}18` }}>
          <span className="w-2 h-2" style={{ background: core.color, boxShadow: `0 0 8px ${core.color}` }} />
          {core.name}
        </span>
        <span className="flex-1 min-w-0 truncate text-sm text-gray-300 italic">{statusLine(phase, tool, core.name)}</span>
        <span className={`hidden md:inline font-mono text-[11px] ${connected ? 'text-green-400/80' : 'text-cyber-red/90'}`}>
          {connected ? `▮ UPLINK${tps ? ` · ${tps} TOK/S` : ''}` : '▯ RECONNECTING'}
        </span>
        <button onClick={() => setFull(v => !v)} title={full ? 'Show the panels again (F)' : 'Let the brain fill the screen (F)'}
          className={`p-2 rounded transition-colors ${full ? 'bg-cyber-blue/20 text-cyber-blue' : 'text-gray-500 hover:text-cyber-blue hover:bg-cyber-gray'}`}>
          {full ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
        </button>
        <button onClick={() => setShowKey(k => !k)} title="What each subsystem does"
          className={`p-2 rounded transition-colors ${showKey ? 'bg-cyber-blue/20 text-cyber-blue' : 'text-gray-500 hover:text-cyber-blue hover:bg-cyber-gray'}`}>
          <Info size={20} />
        </button>
        <button onClick={onClose} title="Close (Esc)" className="p-2 rounded text-gray-500 hover:text-cyber-red hover:bg-cyber-gray transition-colors">
          <X size={22} />
        </button>
        <div className="absolute left-0 right-0 -bottom-px h-px bg-gradient-to-r from-transparent via-cyber-blue/70 to-transparent" />
      </div>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <div className="flex-1 min-h-0 flex flex-col">
          {/* The neural core */}
          <div ref={stageRef} className="relative flex-1 min-h-[46vh] md:min-h-0 overflow-hidden">
            <canvas ref={canvasRef} className="block w-full h-full" />
            {/* scanlines + HUD corner brackets */}
            <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(0,0,0,0.18)_0px,rgba(0,0,0,0.18)_1px,transparent_1px,transparent_3px)]" />
            {['top-2 left-2 border-t-2 border-l-2', 'top-2 right-2 border-t-2 border-r-2', 'bottom-2 left-2 border-b-2 border-l-2', 'bottom-2 right-2 border-b-2 border-r-2'].map(c => (
              <div key={c} className={`pointer-events-none absolute w-5 h-5 border-cyber-blue/60 ${c}`} />
            ))}
            {/* telemetry */}
            <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-3 hidden lg:flex gap-5 font-mono text-[10px] text-cyber-blue/55 whitespace-nowrap">
              <span>SYNAPTIC LOAD <span className="text-cyber-blue">{String(load).padStart(2, '0')}%</span></span>
              <span>SIGNALS <span className="text-cyber-blue">{hud.signals}</span></span>
              <span>NODES <span className="text-cyber-blue">{hud.neurons.toLocaleString()}</span></span>
              {model && <span className="max-w-[220px] truncate">UPLINK <span className="text-cyber-blue">{model.toUpperCase()}</span></span>}
              <span>SESSION <span className="text-cyber-blue">{String(Math.floor(hud.session / 60)).padStart(2, '0')}:{String(hud.session % 60).padStart(2, '0')}</span></span>
            </div>
            {/* zoom: pinch, scroll, double-tap, or these */}
            <div className="absolute left-4 bottom-[15%] flex items-center gap-1 font-mono text-[10px] text-cyber-blue/80">
              <button onClick={() => brainRef.current?.zoomBy(1.4)} title="Zoom in (+, scroll or pinch)" className="w-8 h-8 flex items-center justify-center border border-cyber-blue/40 bg-[#05060a]/80 hover:border-cyber-blue/80"><ZoomIn size={15} /></button>
              <button onClick={() => brainRef.current?.zoomBy(1 / 1.4)} disabled={hud.zoom <= 1.01} title="Zoom out (−)" className="w-8 h-8 flex items-center justify-center border border-cyber-blue/40 bg-[#05060a]/80 hover:border-cyber-blue/80 disabled:opacity-30"><ZoomOut size={15} /></button>
              {hud.zoom > 1.01 && (
                <button onClick={() => brainRef.current?.resetView()} title="Back to the whole brain (0)" className="h-8 px-2 flex items-center gap-1 border border-cyber-blue/40 bg-[#05060a]/80 hover:border-cyber-blue/80">
                  <Crosshair size={13} /> {hud.zoom.toFixed(1)}×
                </button>
              )}
              {hud.zoom <= 1.01 && !node && <span className="ml-2 hidden sm:inline text-gray-500">PINCH OR SCROLL TO ZOOM · TAP A DOT TO INSPECT IT</span>}
            </div>

            {/* the node inspector */}
            {node && (() => {
              const r = regionName(node.region), firing = node.energy > 0.2;
              const nbs = Object.entries(node.neighbours).sort((a, b) => b[1] - a[1]);
              return (
                <div className={`absolute left-3 sm:left-4 top-9 w-[min(320px,calc(100%-24px))] p-3 border bg-[#05060a]/92 text-sm shadow-xl space-y-1.5 ${cut(10)}`}
                  style={{ borderColor: `${r.color}99` }}>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rotate-45 shrink-0" style={{ background: r.color, boxShadow: `0 0 8px ${r.color}` }} />
                    <span className="font-mono text-xs tracking-[0.2em] text-gray-300">NODE #{node.id}</span>
                    <span className="ml-auto font-mono text-[10px] tracking-[0.15em]" style={{ color: firing ? r.color : '#64748b' }}>
                      {firing ? `◉ FIRING ${Math.round(node.energy * 100)}%` : '○ RESTING'}
                    </span>
                    <button onClick={() => brainRef.current?.select(null)} title="Close (Esc)" className="text-gray-500 hover:text-cyber-red"><X size={15} /></button>
                  </div>
                  <div>
                    <div className="font-mono text-[13px]" style={{ color: r.color }}>{r.code}</div>
                    <div className="text-gray-400 text-xs">{r.label} · {r.sub}</div>
                  </div>
                  <div className="h-1 bg-white/5 overflow-hidden"><div className="h-full transition-all" style={{ width: `${Math.round(node.energy * 100)}%`, background: r.color }} /></div>
                  <div className="text-gray-300 leading-snug">
                    {node.fires ? <>Fired <b className="text-white">{node.fires}</b> time{node.fires === 1 ? '' : 's'} since you opened this view · last <b className="text-white">{node.lastAgo}s</b> ago.</> : 'Has not fired since you opened this view.'}
                  </div>
                  {node.lastBy && <div className="text-gray-400 leading-snug text-xs">Last signal through it: <span className="text-gray-200">{node.lastBy}</span>.</div>}
                  <div className="text-gray-400 leading-snug text-xs">
                    Wired to {node.links} neighbour{node.links === 1 ? '' : 's'}: {nbs.map(([k, v]) => `${v} ${regionName(k).code}`).join(', ')}. Signals hop along these to get around.
                  </div>
                  <div className="hidden sm:block text-gray-500 text-[11px] leading-snug">{node.surface ? 'On the surface of the brain.' : 'Deep inside the brain.'} One of {node.total.toLocaleString()} nodes; each is a stand-in for part of the work this subsystem does, not a literal neuron.</div>
                  <button onClick={() => brainRef.current?.ping()} className="mt-1 flex items-center gap-1.5 px-2.5 py-1 border font-mono text-[10px] tracking-[0.15em] hover:bg-white/5"
                    style={{ borderColor: `${r.color}88`, color: r.color }}>
                    <Zap size={12} /> PING · SEND A PULSE FROM HERE
                  </button>
                </div>
              );
            })()}

            {full && (
              <button onClick={() => setFull(false)} title="Show the numbers and the thought stream again (F)"
                className="absolute right-4 bottom-[15%] flex items-center gap-1.5 px-2.5 py-1.5 border border-cyber-blue/40 bg-[#05060a]/80 font-mono text-[10px] tracking-[0.15em] text-cyber-blue/80 hover:text-cyber-blue hover:border-cyber-blue/80">
                <PanelBottomOpen size={13} /> SHOW PANELS
              </button>
            )}
            {showKey && (
              <div className={`absolute left-1/2 -translate-x-1/2 top-8 w-[min(440px,92%)] p-3 border border-cyber-blue/40 bg-[#05060a]/95 text-sm space-y-1.5 shadow-xl ${cut(10)}`}>
                <p className="text-gray-300 leading-snug">Each subsystem lights up when Delamain uses it. The dots stand in for the model's weights;
                  tap a part for what it does. Your words fly into the <b>audio intake</b>, his leave from the <b>vocoder</b>.</p>
                {(Object.keys(REGION_INFO) as (keyof typeof REGION_INFO)[]).map(k => (
                  <div key={k} className="flex gap-2 items-baseline">
                    <span className="w-2.5 h-2.5 shrink-0 translate-y-0.5 rotate-45"
                      style={{ background: k === 'core' ? core.color : REGION_INFO[k].color, boxShadow: `0 0 6px ${k === 'core' ? core.color : REGION_INFO[k].color}` }} />
                    <span className="text-gray-400 leading-snug"><b className="font-mono text-[11px] text-gray-200">{REGION_INFO[k].code}</b> · {REGION_INFO[k].tip}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Talk to him from here */}
          <div className="shrink-0 border-t border-cyber-blue/25 bg-[#07090f] px-3 py-2 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <button onClick={talk.onMic} disabled={!talk.micSupported}
                title={talk.micSupported ? 'Speak to Delamain (Space)' : 'This browser has no speech recognition'}
                className={`relative shrink-0 h-11 px-4 flex items-center gap-2 font-mono text-xs tracking-[0.2em] uppercase border transition-all disabled:opacity-40 ${cut(8)}
                  ${talk.listening ? 'bg-amber-300/20 border-amber-300 text-amber-200 shadow-[0_0_20px_rgba(252,211,77,0.45)]' : 'bg-cyber-blue/10 border-cyber-blue/50 text-cyber-blue hover:bg-cyber-blue/20'}`}>
                <Mic size={18} className={talk.listening ? 'animate-pulse' : ''} />
                <span className="hidden sm:inline">{talk.listening ? 'Listening' : 'Speak'}</span>
              </button>
              <input value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(); }}
                placeholder={talk.thinking ? 'He is working on it…' : 'Type to Delamain and watch him think…'}
                className="flex-1 min-w-0 h-11 px-3 bg-[#0b0f18] border border-cyber-blue/25 focus:border-cyber-blue/70 outline-none font-mono text-sm text-gray-100 placeholder:text-gray-600" />
              <button onClick={send} disabled={!draft.trim()} title="Send"
                className="shrink-0 h-11 w-11 flex items-center justify-center border border-cyber-blue/50 text-cyber-blue bg-cyber-blue/10 hover:bg-cyber-blue/20 disabled:opacity-30">
                <Send size={18} />
              </button>
            </div>
            <div className="flex items-center gap-3 min-h-[18px]">
              <button onClick={talk.onToggleWake} disabled={!talk.micSupported}
                title="Turn the wake word on or off (the same switch as Settings → Listening)"
                className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.15em] disabled:cursor-default shrink-0" style={{ color: wake.color }}>
                <Radio size={12} className={talk.wakeWord && !talk.wakeBlocked && talk.micSupported ? 'animate-pulse' : ''} />
                {wake.text}
                {talk.micSupported && !talk.wakeBlocked && !talk.listening && <span className="text-gray-500 underline decoration-dotted">{talk.wakeWord ? 'turn off' : 'turn on'}</span>}
              </button>
              {talk.listening && talk.heardLive && (
                <span className="flex-1 truncate font-mono text-[11px] text-amber-200/90">▌{talk.heardLive}</span>
              )}
            </div>
          </div>
        </div>

        {/* Thought stream + today */}
        <aside className={`md:w-[380px] shrink-0 flex-col min-h-0 border-t md:border-t-0 md:border-l border-cyber-blue/20 bg-[#07090f] max-h-[30vh] md:max-h-none ${full ? 'hidden' : 'flex'}`}>
          {/* His face, beside the brain (landscape only; the main page hands it over) */}
          {face && (
            <div className="relative shrink-0 h-[40vh] min-h-[220px] border-b border-cyber-blue/20 bg-black overflow-hidden">
              {face}
              <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(0,0,0,0.16)_0px,rgba(0,0,0,0.16)_1px,transparent_1px,transparent_3px)]" />
              {['top-2 left-2 border-t-2 border-l-2', 'top-2 right-2 border-t-2 border-r-2', 'bottom-2 left-2 border-b-2 border-l-2', 'bottom-2 right-2 border-b-2 border-r-2'].map(c => (
                <div key={c} className={`pointer-events-none absolute w-4 h-4 ${c}`} style={{ borderColor: `${core.color}99` }} />
              ))}
              {/* Readouts stay in the top corner: the face draws its voice waveform along the bottom */}
              <div className="pointer-events-none absolute left-8 top-2.5 font-mono text-[10px] tracking-[0.2em] leading-[1.5]">
                <div style={{ color: `${core.color}cc` }}>VISUAL INTERFACE · {core.name.toUpperCase()}</div>
                <div className="text-cyber-blue/70">
                  {talk.talking ? '◉ TRANSMITTING' : talk.listening ? '◉ RECEIVING' : talk.thinking ? '◌ PROCESSING' : '○ STANDBY'}
                </div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-4 gap-px bg-cyber-blue/10 border-b border-cyber-blue/20">
            {stats.map(([k, v]) => (
              <div key={k} className="bg-[#05060a] px-2 py-1.5">
                <div className="font-mono text-[13px] text-white truncate">{v}</div>
                <div className="text-[10px] uppercase tracking-wider text-gray-500 truncate">{k}</div>
              </div>
            ))}
          </div>
          <div className="px-3 pt-2 pb-1 flex items-center justify-between">
            <span className="flex items-center gap-3">
              <span className="font-mono text-[11px] tracking-[0.25em] text-cyber-blue/80 uppercase">Thought stream</span>
              <button onClick={() => setFull(true)} title="Hide these panels so the brain fills the screen (F)"
                className="font-mono text-[10px] tracking-[0.15em] text-gray-500 hover:text-cyber-blue">▾ HIDE</button>
            </span>
            {model && <span className="font-mono text-[10px] text-gray-500 truncate max-w-[60%]">{model}</span>}
          </div>
          <ol className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1.5">
            {lines.length === 0 && <li className="text-sm text-gray-500 italic">Quiet. Speak to Delamain and watch him think.</li>}
            {lines.map(l => (
              <li key={l.id} className="flex gap-2 text-sm leading-snug">
                <span className="shrink-0 w-5 text-center">{l.icon}</span>
                <span className="flex-1 text-gray-300" style={{ borderLeft: `2px solid ${l.color}66`, paddingLeft: 8 }}>{l.text}</span>
                <span className="shrink-0 font-mono text-[10px] text-gray-600 pt-0.5">{clock(l.t)}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
