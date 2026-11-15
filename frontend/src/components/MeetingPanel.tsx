import { useState, useEffect, useCallback } from 'react';
import { X, Circle, Square, Trash2, RotateCcw, FileText, Loader2 } from 'lucide-react';

import { fmtClock, meetingPath, type MeetingRecorder } from './meetingRecorder';

/* Meeting notes: the recorder's controls, and the meetings being written up or done (meetings.py). */

export type Meeting = {
  id: string; title: string; started: number; status: 'recording' | 'queued' | 'transcribing' | 'summarising' | 'done' | 'error';
  progress: number; duration?: number; note?: string; summary?: string; error?: string | null; words?: number; chunks?: number;
};

const STATUS: Record<Meeting['status'], string> = {
  recording: 'Recording', queued: 'Waiting its turn', transcribing: 'Transcribing', summarising: 'Writing the notes', done: 'Notes ready', error: 'Failed',
};

export function MeetingPanel({ token, recorder, update, onClose }: { token: string; recorder: MeetingRecorder; update: Meeting | null; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [list, setList] = useState<Meeting[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());   // gone at once, even before the list reloads
  const busy = recorder.state !== 'idle';

  const refresh = useCallback(() => {
    fetch('/api/meetings', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => (res.ok ? res.json() : [])).then(setList).catch(() => {});
  }, [token]);
  useEffect(() => { refresh(); }, [refresh, recorder.state]);
  // Live progress arrives over the WebSocket; poll gently as well while anything is in progress.
  // A live update replaces its meeting in the list; one for a meeting not listed yet (started on another
  // screen) is added, unless it was just removed here.
  const merged = !update ? list : list.some(m => m.id === update.id) ? list.map(m => (m.id === update.id ? update : m)) : [update, ...list];
  const shown = merged.filter(m => !removed.has(m.id));
  const active = shown.some(m => ['queued', 'transcribing', 'summarising'].includes(m.status));
  useEffect(() => {
    if (!active) return;
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [active, refresh]);

  const act = async (m: Meeting, how: 'retry' | 'forget') => {
    const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (how === 'retry') await fetch(meetingPath(m.id, 'finish'), { method: 'POST', headers: h, body: '{}' }).catch(() => {});
    else {
      setRemoved(s => new Set(s).add(m.id));
      if (open === m.id) setOpen(null);
      await fetch(meetingPath(m.id), { method: 'DELETE', headers: h }).catch(() => {});
    }
    refresh();
  };

  return (
    <div className="flex flex-col h-full bg-cyber-dark/95 text-white text-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b border-cyber-blue/30 bg-cyber-blue/5 shrink-0">
        <span className="font-mono font-bold text-cyber-blue tracking-widest text-xs">MEETING_NOTES</span>
        <button onClick={onClose} className="text-gray-500 hover:text-white" title="Close (a recording keeps going)"><X size={16} /></button>
      </div>

      <div className="p-4 border-b border-cyber-gray space-y-3 shrink-0">
        {!recorder.supported ? (
          <p className="text-gray-400">This browser cannot record audio.</p>
        ) : busy ? (
          <>
            <div className="flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full ${recorder.state === 'recording' ? 'bg-red-500 animate-pulse' : 'bg-gray-500'}`} />
              <span className="font-mono text-2xl tracking-wider">{fmtClock(recorder.elapsed)}</span>
              <div className="flex-1 h-2 bg-cyber-gray rounded-sm overflow-hidden">
                <div className="h-full bg-cyber-blue transition-[width] duration-150" style={{ width: `${Math.round(recorder.level * 100)}%` }} />
              </div>
            </div>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (optional; he will name it otherwise)"
              className="w-full bg-cyber-gray/40 border border-cyber-blue/20 rounded-sm px-2 py-1.5 text-sm focus:outline-none focus:border-cyber-blue" />
            <div className="flex gap-2">
              <button disabled={recorder.state !== 'recording'} onClick={() => void recorder.stop(title.trim() || undefined).then(() => setTitle(''))}
                className="flex-1 flex items-center justify-center gap-2 py-2 bg-cyber-blue/20 border border-cyber-blue text-cyber-blue font-mono text-xs tracking-widest hover:bg-cyber-blue/30 disabled:opacity-50">
                {recorder.state === 'stopping' ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
                {recorder.state === 'stopping' ? 'SENDING THE LAST OF IT…' : 'STOP & WRITE NOTES'}
              </button>
              <button disabled={recorder.state !== 'recording'} onClick={() => { if (confirmDiscard()) void recorder.cancel(); }}
                className="px-3 border border-red-400/40 text-red-300 hover:bg-red-400/10 disabled:opacity-50" title="Discard this recording"><Trash2 size={14} /></button>
            </div>
            <p className="text-gray-500 text-xs">
              Keep this page open; the screen stays on while recording. {recorder.pending > 1 ? `${recorder.pending} pieces waiting to upload. ` : ''}
              Wake word is paused until you stop.
            </p>
          </>
        ) : (
          <>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Meeting title (optional)"
              className="w-full bg-cyber-gray/40 border border-cyber-blue/20 rounded-sm px-2 py-1.5 text-sm focus:outline-none focus:border-cyber-blue" />
            <button onClick={() => void recorder.start(title.trim())}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-red-500/15 border border-red-400/60 text-red-200 font-mono text-xs tracking-widest hover:bg-red-500/25">
              <Circle size={14} className="fill-red-400 text-red-400" /> RECORD A MEETING
            </button>
            <p className="text-gray-500 text-xs leading-snug">
              Transcribed on your own computer, then he writes a summary, decisions and action items into
              <span className="font-mono text-gray-400"> Delamain/Meetings/</span> in your vault. Ask everyone's permission before recording.
            </p>
          </>
        )}
        {recorder.error && <p className="text-amber-300 text-xs">{recorder.error}</p>}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {shown.filter(m => m.status !== 'recording').length === 0 && <p className="text-gray-500 text-xs p-2">No meetings yet.</p>}
        {shown.filter(m => m.status !== 'recording').map(m => (
          <div key={m.id} className="border border-cyber-gray rounded-sm p-2.5 bg-cyber-gray/20">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-cyber-blue shrink-0" />
              <span className="font-semibold truncate flex-1">{m.title || 'Untitled meeting'}</span>
              <span className="text-gray-500 text-xs shrink-0">{new Date(m.started * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs">
              <span className={m.status === 'error' ? 'text-red-300' : m.status === 'done' ? 'text-green-300' : 'text-cyber-blue'}>
                {STATUS[m.status]}{['transcribing', 'summarising'].includes(m.status) && m.progress > 0 ? ` · ${Math.round(m.progress * 100)}%` : ''}
              </span>
              {m.duration ? <span className="text-gray-500">{fmtClock(m.duration)}</span> : null}
              <span className="flex-1" />
              {m.status === 'done' && <button onClick={() => setOpen(open === m.id ? null : m.id)} className="text-cyber-blue hover:underline">{open === m.id ? 'Hide' : 'Show notes'}</button>}
              {m.status === 'error' && <button onClick={() => void act(m, 'retry')} className="flex items-center gap-1 text-cyber-blue hover:underline"><RotateCcw size={12} /> Retry</button>}
              {['done', 'error'].includes(m.status) && <button onClick={() => void act(m, 'forget')} className="text-gray-500 hover:text-red-300" title={m.status === 'done' ? 'Remove from this list (the note stays in your vault)' : 'Delete this recording'}><Trash2 size={12} /></button>}
            </div>
            {['queued', 'transcribing', 'summarising'].includes(m.status) && (
              <div className="mt-1.5 h-1 bg-cyber-gray rounded-sm overflow-hidden">
                <div className="h-full bg-cyber-blue/70 transition-[width]" style={{ width: `${Math.max(3, Math.round(m.progress * 100))}%` }} />
              </div>
            )}
            {m.status === 'error' && m.error && <p className="mt-1 text-red-300/80 text-xs">{m.error}</p>}
            {open === m.id && (
              <div className="mt-2 pt-2 border-t border-white/10 text-gray-300 text-xs leading-relaxed whitespace-pre-wrap">
                {m.note && <div className="font-mono text-gray-500 mb-1.5">{m.note}</div>}
                {(m.summary || '').replace(/^## /gm, '').replace(/\*\*/g, '')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const confirmDiscard = () => window.confirm('Discard this recording? Nothing will be transcribed.');
