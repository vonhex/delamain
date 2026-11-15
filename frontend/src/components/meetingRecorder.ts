import { useState, useEffect, useRef, useCallback } from 'react';

/* The meeting recorder: records with the microphone and uploads the audio in pieces as it goes,
   retrying while the link is down; on stop it asks the server to transcribe it (meetings.py).
   It lives in App, so closing the Meeting panel does not stop a meeting. */

type Session = {
  id: string; rec: MediaRecorder; stream: MediaStream; queue: { seq: number; blob: Blob }[]; seq: number;
  started: number; uploading: boolean; ctx?: AudioContext; timer?: ReturnType<typeof setInterval>; lock?: WakeLockSentinel | null;
};
type RecState = 'idle' | 'starting' | 'recording' | 'stopping';
const SLICE_MS = 10000;   // one uploaded piece every 10 s

/** The API path for one meeting. Ids are 32 hex characters (meetings.py); anything else is refused,
    so a bad id can never steer a request somewhere else. */
export function meetingPath(id: string, ...rest: (string | number)[]): string {
  if (!/^[0-9a-f]{32}$/.test(id)) throw new Error('bad meeting id');
  return '/api/meetings/' + [id, ...rest].map(p => encodeURIComponent(String(p))).join('/');
}

const pickMime = () => {
  const MR = window.MediaRecorder;
  if (!MR) return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) if (MR.isTypeSupported?.(m)) return m;
  return '';
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const fmtClock = (s: number) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
};

/** The recorder lives in App, so closing the panel does not stop a meeting. */
export function useMeetingRecorder(token: string, onChange?: (recording: boolean) => void) {
  const [state, setState] = useState<RecState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const r = useRef<Session | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  const auth = useCallback((extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${token}`, ...extra }), [token]);

  const pump = useCallback(async () => {
    const cur = r.current;
    if (!cur || cur.uploading) return;
    cur.uploading = true;
    let wait = 1000;
    while (cur.queue.length) {
      const { seq, blob } = cur.queue[0];
      try {
        const res = await fetch(meetingPath(cur.id, 'chunk', seq), { method: 'PUT', headers: auth({ 'Content-Type': 'application/octet-stream' }), body: blob });
        if (!res.ok && res.status !== 409) throw new Error(String(res.status));
        cur.queue.shift(); wait = 1000; setError(null);
      } catch {
        setError('Upload paused: no connection. The audio is kept and sent when it is back.');
        await sleep(wait); wait = Math.min(15000, wait * 2);
      }
      setPending(cur.queue.length);
    }
    cur.uploading = false;
  }, [auth]);

  const lockScreen = async () => {
    try { if (r.current) r.current.lock = await navigator.wakeLock?.request('screen'); } catch { /* not allowed */ }
  };

  const start = useCallback(async (title: string) => {
    if (r.current) return;
    setError(null); setState('starting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      setError('The microphone is not available. Allow it for this site and try again.'); setState('idle'); return;
    }
    const mime = pickMime();
    let id: string;
    try {
      const res = await fetch('/api/meetings', { method: 'POST', headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ title, mime }) });
      if (!res.ok) throw new Error(String(res.status));
      id = (await res.json()).id;
    } catch {
      stream.getTracks().forEach(t => t.stop());
      setError('Could not reach Delamain to start the meeting.'); setState('idle'); return;
    }
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    const cur: Session = { id, rec, stream, queue: [], seq: 0, started: Date.now(), uploading: false };
    r.current = cur;
    rec.ondataavailable = e => { if (e.data.size) { cur.queue.push({ seq: cur.seq++, blob: e.data }); setPending(cur.queue.length); void pump(); } };
    try {
      const ctx = new AudioContext(), an = ctx.createAnalyser();
      an.fftSize = 512; ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      cur.ctx = ctx;
      cur.timer = setInterval(() => {
        an.getByteTimeDomainData(buf);
        let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 64));
        setElapsed((Date.now() - cur.started) / 1000);
      }, 150);
    } catch { cur.timer = setInterval(() => setElapsed((Date.now() - cur.started) / 1000), 500); }
    rec.start(SLICE_MS);
    void lockScreen();
    setElapsed(0); setState('recording'); onChangeRef.current?.(true);
  }, [auth, pump]);

  const release = () => {
    const cur = r.current;
    if (!cur) return;
    clearInterval(cur.timer);
    cur.stream.getTracks().forEach(t => t.stop());
    void cur.ctx?.close().catch(() => {});
    void cur.lock?.release().catch(() => {});
  };

  const stop = useCallback(async (title?: string) => {
    const cur = r.current;
    if (!cur || cur.rec.state === 'inactive') return;
    setState('stopping');
    await new Promise<void>(res => { cur.rec.onstop = () => res(); cur.rec.stop(); });
    release();
    while (cur.queue.length || cur.uploading) { void pump(); await sleep(500); }   // every piece is on the server
    for (let i = 0; ; i++) {
      try {
        const res = await fetch(meetingPath(cur.id, 'finish'), { method: 'POST', headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ title: title ?? null }) });
        if (res.ok) break;
      } catch { /* retry */ }
      setError('Could not reach Delamain to finish the meeting; retrying.');
      await sleep(Math.min(15000, 1000 * 2 ** i));
    }
    r.current = null; setError(null); setPending(0); setLevel(0); setState('idle'); onChangeRef.current?.(false);
  }, [auth, pump]);

  const cancel = useCallback(async () => {
    const cur = r.current;
    if (!cur) return;
    cur.rec.ondataavailable = null;
    try { cur.rec.stop(); } catch { /* stopped */ }
    release(); cur.queue = [];
    r.current = null; setPending(0); setLevel(0); setState('idle'); onChangeRef.current?.(false);
    await fetch(meetingPath(cur.id), { method: 'DELETE', headers: auth() }).catch(() => {});
  }, [auth]);

  // The screen lock is dropped when the page is hidden; take it again on return.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible' && r.current) void lockScreen(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  // Leaving the page mid-meeting: warn first.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => { if (r.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  return { state, elapsed, level, pending, error, start, stop, cancel, supported: typeof window.MediaRecorder !== 'undefined' };
}
export type MeetingRecorder = ReturnType<typeof useMeetingRecorder>;

