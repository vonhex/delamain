import { useState, useEffect, useCallback } from 'react';
import { X, Check, Ban, Undo2, Loader2, RefreshCw, ChevronDown, ChevronRight, RotateCw, Wrench } from 'lucide-react';

/* What Delamain has learned about himself, and the changes to his own code
   he has drafted. Code changes go live only from the Approve button here (self_improve.py). */

type Proposal = {
  id: string; goal: string; origin: string; created: number; status: string; summary?: string; checks?: string;
  diff?: string; error?: string; files?: Record<string, string>; result?: { status: string; why?: string };
  warning?: string | null; fixes?: string; fixed_by?: string; claude?: { started: number };
  review?: { model: string; rounds: { round: number; verdict: string; issues: string[]; summary: string }[] };
};
type Mind = {
  mood: Record<string, number>; feeling: string; portrait: string | null; opinions: { topic: string; view: string }[];
  following: string[]; knowledge_notes: number; last_news: { t: number; learned: number; take: string; curiosity: string } | null;
  last_journal: string | null;
  last_study?: { t: number; subject: string; summary?: string; learned?: number; next?: string; error?: string } | null;
  studies_today?: number; questions?: string[];
  tasks?: { id: number; title: string; status: string; kind?: string; log?: { at: string; text: string }[];
    sessions?: number; answer?: string; done_at?: string; when?: string }[];
  last_brief?: { date: string; delivered?: boolean; text?: string } | null;
  last_twin?: { t: number; date: string; topic: string; summary?: string; question?: string; started_by?: string } | null;
  twin_talking?: boolean;
  emotions?: { name: string; now: number; cause: string; t: number }[];
  thought?: { t: number; text: string } | null;
  interests?: Record<string, number>; favourites?: string[];
};
type Snapshot = {
  rules: string[]; skills: { name: string; when: string }[]; tuning: Record<string, string | number>;
  tunables: Record<string, string>; proposals: Proposal[]; busy: { goal: string; stage?: string } | null;
  stats: { tools: { name: string; calls: number; failed: number; avg_ms: number }[]; corrections: { t: number; text: string }[] };
  last_review: { t: number; summary: string; rules: string[]; skills: string[]; ideas: { goal: string }[] } | null;
  history: { t: number; what: string }[];
  can_apply?: string; reviewer?: boolean; claude?: boolean;
};

const STATUS: Record<string, string> = {
  drafting: 'Drafting', pending: 'Waiting for your approval', applying: 'Applying…', applied: 'Live', rejected: 'Rejected',
  failed: 'Could not be drafted', stale: 'Out of date', rolling_back: 'Rolling back…', rolled_back: 'Rolled back', retried: 'Retried', sent_to_claude: 'Fixed by Claude', superseded: 'Replaced by Claude\'s fix',
  auto_rolled_back: 'Rolled back automatically', rollback_unhealthy: 'Rollback did not come back healthy',
};
const when = (t: number) => new Date(t * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function SelfPanel({ token, tick = 0, onClose }: { token: string; tick?: number; onClose: () => void }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [mind, setMind] = useState<Mind | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const auth = { Authorization: `Bearer ${token}` };

  const load = useCallback(() => {
    fetch('/api/self', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null)).then(d => d && setSnap(d)).catch(() => {});
    fetch('/api/mind', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null)).then(d => d && setMind(d)).catch(() => {});
  }, [token]);
  const mindNow = async (what: 'news' | 'journal' | 'twin') => {
    setBusy(what); setError(null);
    const r = await fetch(`/api/mind/${what}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    if (r && !r.ok) setError(`That did not work (${r.status}).`);
    setBusy(null);
    load();
  };
  useEffect(() => { load(); }, [load, tick]);
  const working = !!mind?.twin_talking || !!snap?.busy || !!snap?.proposals.some(p => ['applying', 'rolling_back', 'drafting'].includes(p.status) || (p.status === 'sent_to_claude' && !p.fixed_by));
  useEffect(() => {
    if (!working) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [working, load]);

  const act = async (p: Proposal, action: 'approve' | 'reject' | 'rollback' | 'retry' | 'claude') => {
    if (action === 'approve' && !window.confirm(`Apply this change to Delamain's code and restart him?\n\n${p.summary || p.goal}`)) return;
    if (action === 'rollback' && !window.confirm('Undo this change and restart him?')) return;
    if (action === 'claude' && !window.confirm(`Send this to Claude Code to fix and implement?\n\n${p.summary || p.goal}\n\nClaude edits a private copy (file tools only). The result comes back here for your approval; nothing goes live on its own.`)) return;
    setBusy(p.id); setError(null);
    const r = await fetch(`/api/self/proposals/${encodeURIComponent(p.id)}/${action}`, { method: 'POST', headers: auth }).catch(() => null);
    if (r && !r.ok) setError((await r.json().catch(() => ({}))).detail || `Failed (${r.status})`);
    else if (action === 'claude' || action === 'retry') setOpen(null);   // handed off: close its details
    setBusy(null);
    load();
  };
  const reviewNow = async () => {
    setBusy('review'); setError(null);
    const r = await fetch('/api/self/review', { method: 'POST', headers: auth }).catch(() => null);
    if (r && !r.ok) setError('The review failed.');
    setBusy(null);
    load();
  };

  return (
    <div className="flex flex-col h-full bg-cyber-dark/95 text-white text-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b border-cyber-blue/30 bg-cyber-blue/5 shrink-0">
        <span className="font-mono font-bold text-cyber-blue tracking-widest text-xs">SELF_IMPROVEMENT</span>
        <div className="flex items-center gap-3">
          <button onClick={load} className="text-gray-500 hover:text-white" title="Refresh"><RefreshCw size={14} /></button>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={16} /></button>
        </div>
      </div>
      {!snap ? <p className="p-4 text-gray-500">Loading…</p> : (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {error && <p className="text-red-300 text-xs">{error}</p>}

          {mind && (
            <section className="space-y-1.5">
              <h3 className="font-mono text-[10px] tracking-widest text-cyber-blue">MIND</h3>
              <p className="text-xs text-pink-200">Feeling {mind.feeling}.</p>
              {mind.emotions && mind.emotions.length > 0 && (
                <ul className="space-y-1">
                  {mind.emotions.map(e => (
                    <li key={e.name + e.t} className="text-xs text-gray-300 flex items-start gap-2">
                      <span className="w-24 shrink-0"><span className="text-pink-200">{e.name}</span>
                        <span className="block h-1 bg-cyber-gray rounded-sm overflow-hidden"><span className="block h-full bg-pink-300/70" style={{ width: `${Math.round(e.now * 100)}%` }} /></span></span>
                      <span className="text-gray-400">{e.cause}</span>
                    </li>
                  ))}
                </ul>
              )}
              {mind.thought && <p className="text-xs text-gray-400">Unspoken thought ({when(mind.thought.t)}): <i className="text-gray-300">“{mind.thought.text}”</i></p>}
              {mind.portrait && <p className="text-xs text-gray-300 italic">“{mind.portrait}”</p>}
              <p className="text-xs text-gray-400">{mind.knowledge_notes} knowledge notes in <span className="font-mono">Delamain/Knowledge/</span>
                {mind.following.length > 0 && <> · following {mind.following.join(', ')}</>}</p>
              {mind.last_news && <p className="text-xs text-gray-400">Last read the news {when(mind.last_news.t)}: kept {mind.last_news.learned} facts. {mind.last_news.curiosity && <>Wondering: “{mind.last_news.curiosity}”</>}</p>}
              {mind.last_study && <p className="text-xs text-gray-400">Free-time study ({mind.studies_today ?? 0} today, notes in <span className="font-mono">Delamain/Study/</span>): last {when(mind.last_study.t)}, <b className="text-gray-300">{mind.last_study.subject}</b>{mind.last_study.error ? <span className="text-red-300"> failed: {mind.last_study.error}</span> : <>, {mind.last_study.learned ?? 0} facts. {mind.last_study.summary}</>}</p>}
              {mind.interests && (() => {
                const tried = Object.entries(mind.interests).filter(([, v]) => Math.abs(v - 0.5) > 0.001).sort((a, b) => b[1] - a[1]);
                return (
                  <div className="text-xs text-gray-400 space-y-1">
                    <div>Favourite subjects: {mind.favourites && mind.favourites.length ? <b className="text-pink-200">{mind.favourites.join(' · ')}</b> : <span>none yet (they grow from what absorbs him)</span>}</div>
                    {tried.length > 0 && (
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        {tried.slice(0, 10).map(([k, v]) => (
                          <div key={k} title={`${Math.round(v * 100)}% absorbed`}>
                            <div className="truncate text-gray-300">{k}</div>
                            <div className="h-1 bg-cyber-gray overflow-hidden"><div className="h-full bg-pink-300/70" style={{ width: `${Math.round(v * 100)}%` }} /></div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              {mind.questions && mind.questions.length > 0 && <p className="text-xs text-gray-400">Open questions: {mind.questions.map(q => `“${q}”`).join(' · ')}</p>}
              {(mind.twin_talking || mind.last_twin) && <p className="text-xs text-gray-400">Talking with the other Delamain (transcripts in <span className="font-mono">Delamain/Conversations/</span>): {mind.twin_talking ? <b className="text-pink-200">talking now — watch in the Brain view…</b> : mind.last_twin && <>last {when(mind.last_twin.t)} about <b className="text-gray-300">{mind.last_twin.topic}</b>. {mind.last_twin.summary}</>}</p>}
              {mind.tasks && mind.tasks.some(t => ['open', 'stuck'].includes(t.status) || (t.status === 'done' && !!t.answer)) && (
                <div className="text-xs text-gray-400 space-y-1">Tasks (<span className="font-mono">Delamain/Tasks/</span>):
                  <ul className="list-disc pl-5 text-gray-300 space-y-1">
                    {mind.tasks.filter(t => ['open', 'stuck'].includes(t.status) || (t.status === 'done' && !!t.answer)).slice(-8).map(t => (
                      <li key={t.id}>
                        <b>#{t.id} {t.title}</b>{' '}
                        <span className={t.status === 'done' ? 'text-green-300' : t.status === 'stuck' ? 'text-amber-300' : 'text-gray-500'}>
                          {t.status === 'done' ? `done ${t.done_at ?? ''}` : t.status === 'stuck' ? 'stuck: needs you'
                            : t.kind === 'research' ? `researching · ${t.sessions ?? 0} session${t.sessions === 1 ? '' : 's'}`
                            : t.kind === 'follow_up' ? `follow-up from ${t.when ?? 'tomorrow'}` : t.kind}
                        </span>
                        {t.status === 'done' && t.answer
                          ? <div className="text-gray-400 line-clamp-3 whitespace-pre-line">{t.answer}</div>
                          : t.log && t.log.length > 0 && <div className="text-gray-500">{t.log[t.log.length - 1].text}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {mind.last_brief && <p className="text-xs text-gray-400">Morning brief {mind.last_brief.date} ({mind.last_brief.delivered ? 'spoken' : 'written only'}, in <span className="font-mono">Delamain/Briefings/</span>): {mind.last_brief.text?.slice(0, 220)}</p>}
              {mind.opinions.length > 0 && <ul className="list-disc pl-5 text-xs text-gray-300">{mind.opinions.map(o => <li key={o.topic}><b>{o.topic}:</b> {o.view}</li>)}</ul>}
              <div className="flex gap-3 text-xs">
                <button disabled={!!busy} onClick={() => void mindNow('news')} className="text-cyber-blue hover:underline disabled:opacity-50">{busy === 'news' ? 'Reading…' : 'Read the news now'}</button>
                <button disabled={!!busy} onClick={() => void mindNow('journal')} className="text-cyber-blue hover:underline disabled:opacity-50">{busy === 'journal' ? 'Writing…' : 'Write his journal now'}</button>
                <button disabled={!!busy || !!mind.twin_talking} onClick={() => void mindNow('twin')} className="text-cyber-blue hover:underline disabled:opacity-50">{mind.twin_talking ? 'They are talking…' : 'Have him talk with the other Delamain'}</button>
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="font-mono text-[10px] tracking-widest text-cyber-blue">CODE CHANGES</h3>
            {snap.busy && <p className="flex items-center gap-2 text-cyber-blue text-xs"><Loader2 size={12} className="animate-spin" /> {snap.busy.stage === 'Claude' ? 'Claude Code is fixing' : snap.busy.stage ?? 'Drafting'}: {snap.busy.goal}</p>}
            {snap.can_apply && <p className="text-amber-300/80 text-xs">Changes can be drafted and read here, but not applied: {snap.can_apply}.</p>}
            {snap.proposals.length === 0 && !snap.busy && <p className="text-gray-500 text-xs">None yet. Ask him for a new ability or a fix, or wait for his nightly review.</p>}
            {snap.proposals.map(p => (
              <div key={p.id} className="border border-cyber-gray rounded-sm p-2.5 bg-cyber-gray/20">
                <button onClick={() => setOpen(open === p.id ? null : p.id)} className="w-full flex items-start gap-1.5 text-left">
                  {open === p.id ? <ChevronDown size={14} className="mt-0.5 shrink-0" /> : <ChevronRight size={14} className="mt-0.5 shrink-0" />}
                  <span className="flex-1">{p.summary || p.goal}</span>
                </button>
                {p.origin === 'claude' && <p className="mt-1 text-xs text-orange-300/90">🔧 Fixed and implemented by Claude Code</p>}
                {p.review && p.status === 'pending' && (
                  p.warning
                    ? <p className="mt-1 text-xs text-amber-300">⚠ {p.warning}</p>
                    : <p className="mt-1 text-xs text-green-300/90">✓ Approved by {p.review.model} after {p.review.rounds.length} review{p.review.rounds.length > 1 ? 's' : ''}</p>
                )}
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className={p.status === 'pending' ? 'text-amber-300' : ['applied'].includes(p.status) ? 'text-green-300' : ['failed', 'auto_rolled_back', 'rollback_unhealthy'].includes(p.status) ? 'text-red-300' : 'text-gray-400'}>
                    {p.status === 'sent_to_claude' && !p.fixed_by ? 'With Claude Code…' : STATUS[p.status] ?? p.status}
                  </span>
                  <span className="text-gray-500">{when(p.created)} · {p.origin === 'self-review' ? 'his idea' : p.origin === 'claude' ? 'Claude\'s fix' : 'you asked'}</span>
                  <span className="flex-1" />
                  {busy === p.id && <Loader2 size={12} className="animate-spin text-cyber-blue" />}
                  {p.status === 'pending' && <>
                    <button disabled={!!busy || !!snap.busy || !!snap.can_apply} title={snap.can_apply ? snap.can_apply : snap.busy ? 'Wait until the current draft finishes: approving restarts him' : undefined} onClick={() => void act(p, 'approve')} className="flex items-center gap-1 text-green-300 hover:underline disabled:opacity-50"><Check size={12} /> Approve</button>
                    <button disabled={!!busy} onClick={() => void act(p, 'reject')} className="flex items-center gap-1 text-gray-400 hover:text-red-300 disabled:opacity-50"><Ban size={12} /> Reject</button>
                  </>}
                  {snap.claude && ['failed', 'stale', 'pending', 'auto_rolled_back', 'rollback_unhealthy'].includes(p.status) && (
                    <button disabled={!!busy || !!snap.busy} onClick={() => void act(p, 'claude')} title="Send this idea to Claude Code to fix and implement" className="flex items-center gap-1 text-gray-400 hover:text-orange-300 disabled:opacity-50"><Wrench size={12} /> Fix with Claude</button>
                  )}
                  {['failed', 'stale'].includes(p.status) && (
                    <button disabled={!!busy} onClick={() => void act(p, 'retry')} className="flex items-center gap-1 text-gray-400 hover:text-cyber-blue disabled:opacity-50"><RotateCw size={12} /> Retry</button>
                  )}
                  {['applied', 'rollback_unhealthy'].includes(p.status) && (
                    <button disabled={!!busy} onClick={() => void act(p, 'rollback')} className="flex items-center gap-1 text-gray-400 hover:text-amber-300 disabled:opacity-50"><Undo2 size={12} /> Roll back</button>
                  )}
                </div>
                {open === p.id && (
                  <div className="mt-2 pt-2 border-t border-white/10 space-y-1.5 text-xs">
                    <div className="text-gray-400"><span className="text-gray-500">Goal:</span> {p.goal}</div>
                    {p.origin === 'claude' && <div className="text-orange-300/90">Written by Claude Code{p.fixes ? ` to fix proposal ${p.fixes}` : ''}. Checked{snap.reviewer ? ', reviewed by Gemini,' : ''} and still needs your approval.</div>}
                    {p.fixed_by && <div className="text-orange-300/90">Sent to Claude Code; its fix is proposal {p.fixed_by}.</div>}
                    {p.files && <div className="text-gray-400"><span className="text-gray-500">Files:</span> {Object.keys(p.files).join(', ')}</div>}
                    {p.checks && <div className="text-green-300/80">Checks: {p.checks}</div>}
                    {p.review?.rounds.map(r => (
                      <div key={r.round} className="border-l-2 border-white/10 pl-2">
                        <div className={r.verdict === 'approve' ? 'text-green-300' : r.verdict === 'changes_needed' ? 'text-amber-300' : 'text-red-300'}>
                          Gemini review {r.round}: {r.verdict === 'approve' ? 'approved' : r.verdict === 'changes_needed' ? 'changes needed' : r.verdict === 'skipped' ? 'skipped (no reviewer set up)' : 'did not complete'}
                        </div>
                        <div className="text-gray-400">{r.summary}</div>
                        {r.issues.length > 0 && <ul className="list-disc pl-4 text-gray-400">{r.issues.map((i, n) => <li key={n}>{i}</li>)}</ul>}
                      </div>
                    ))}
                    {p.error && <pre className="text-red-300/90 whitespace-pre-wrap">{p.error}</pre>}
                    {p.result?.why && <div className="text-red-300/90">{p.result.why}</div>}
                    {p.diff && (
                      <pre className="max-h-96 overflow-auto bg-black/40 p-2 rounded-sm font-mono text-[11px] leading-snug">
                        {p.diff.split('\n').map((l, i) => (
                          <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'text-green-300' : l.startsWith('-') && !l.startsWith('---') ? 'text-red-300' : l.startsWith('@@') ? 'text-cyber-blue' : 'text-gray-400'}>{l || ' '}</div>
                        ))}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </section>

          <section className="space-y-1">
            <h3 className="font-mono text-[10px] tracking-widest text-cyber-blue">PLAYBOOK · {snap.rules.length} RULES</h3>
            {snap.rules.length === 0 ? <p className="text-gray-500 text-xs">Nothing learned yet. Correct him, or tell him how you want something done from now on.</p>
              : <ul className="list-disc pl-5 text-xs text-gray-300 space-y-0.5">{snap.rules.map((r, i) => <li key={i}>{r}</li>)}</ul>}
            <p className="text-gray-500 text-[11px]">Edit or delete rules in <span className="font-mono">Delamain/Self/Playbook.md</span> in your vault.</p>
          </section>

          {snap.skills.length > 0 && (
            <section className="space-y-1">
              <h3 className="font-mono text-[10px] tracking-widest text-cyber-blue">SKILLS</h3>
              <ul className="text-xs text-gray-300 space-y-0.5">{snap.skills.map(s => <li key={s.name}><b>{s.name}</b> <span className="text-gray-500">{s.when}</span></li>)}</ul>
            </section>
          )}

          <section className="space-y-1">
            <h3 className="font-mono text-[10px] tracking-widest text-cyber-blue">TUNING</h3>
            <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs">
              {Object.entries(snap.tuning).map(([k, v]) => (
                <div key={k} className="contents"><span className="font-mono text-gray-400">{k}</span><span>{String(v) || '(Settings)'} <span className="text-gray-500">{snap.tunables[k]}</span></span></div>
              ))}
            </div>
          </section>

          <section className="space-y-1">
            <h3 className="font-mono text-[10px] tracking-widest text-cyber-blue">LAST 7 DAYS</h3>
            {snap.stats.tools.length === 0 ? <p className="text-gray-500 text-xs">No tool calls logged yet.</p> : (
              <div className="grid grid-cols-[1fr_max-content_max-content] gap-x-3 text-xs">
                {snap.stats.tools.map(t => (
                  <div key={t.name} className="contents"><span className="font-mono text-gray-300 truncate">{t.name}</span><span>{t.calls} calls</span>
                    <span className={t.failed ? 'text-red-300' : 'text-gray-500'}>{t.failed} failed</span></div>
                ))}
              </div>
            )}
            {snap.stats.corrections.length > 0 && <p className="text-xs text-gray-400">{snap.stats.corrections.length} corrections, latest: “{snap.stats.corrections[0].text.slice(0, 120)}”</p>}
          </section>

          <section className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="font-mono text-[10px] tracking-widest text-cyber-blue flex-1">NIGHTLY REVIEW</h3>
              <button disabled={!!busy} onClick={() => void reviewNow()} className="text-xs text-cyber-blue hover:underline disabled:opacity-50">
                {busy === 'review' ? 'Reviewing…' : 'Review today now'}
              </button>
            </div>
            {snap.last_review ? (
              <div className="text-xs text-gray-300 space-y-1">
                <p className="text-gray-500">{when(snap.last_review.t)}</p>
                <p>{snap.last_review.summary}</p>
                {snap.last_review.ideas.length > 0 && <ul className="list-disc pl-5 text-gray-400">{snap.last_review.ideas.map((i, n) => <li key={n}>{i.goal}</li>)}</ul>}
              </div>
            ) : <p className="text-gray-500 text-xs">He reviews his day each night after 3:30 AM; notes go to <span className="font-mono">Delamain/Self/Reviews/</span>.</p>}
          </section>
        </div>
      )}
    </div>
  );
}
