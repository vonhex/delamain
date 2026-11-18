import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { GoogleConnect } from './GoogleConnect';

// Server-side settings (saved in settings.json on the server, ahead of .env), so the
// LLM, search, Obsidian, news, routing and units can be set up without editing files.

interface Field {
  value: string;
  source: 'settings' | 'env' | 'default';
  label: string;
  default: string;
  choices: string[];
  secret?: boolean;   // the server never sends its value back, only whether one is set
  is_set?: boolean;
}

interface Status {
  voice_model: boolean;
  voice_reference: boolean;
  line_clips: number;
  lines: number;
}

export interface IntegrationsHandle {
  save: () => Promise<boolean>;   // false: the server refused a value; the error is shown
}

// Extras that cost model time: turn them off for a small or slow model.
const FEATURES = ['feature_verify', 'feature_recall', 'feature_feelings', 'feature_self_tools', 'feature_news', 'feature_study', 'feature_vision', 'feature_garden',
  'feature_twin', 'feature_journal', 'feature_brief', 'feature_self_review'];
const isOn = (v: string | undefined) => !['0', 'false', 'no', 'off'].includes((v ?? '').trim().toLowerCase());
const isToggle = (f: Field) => f.choices.length === 2 && f.choices.includes('true') && f.choices.includes('false');

const ORDER: { title: string; keys: string[] }[] = [
  { title: 'Language model', keys: ['llm_url', 'llm_model', 'llm_api_key', 'llm_reasoning_effort', 'llm_model_file'] },
  { title: 'You', keys: ['home_address'] },
  { title: 'Features', keys: ['sleep_hours', ...FEATURES] },
  { title: 'Tools', keys: ['tools_enabled', 'searxng_url', 'obsidian_vault_path', 'news_rss_url', 'osrm_url', 'units'] },
  { title: 'Meeting notes', keys: ['meeting_whisper_model', 'meeting_language', 'meeting_keep_audio'] },
  { title: 'Google', keys: ['google_client_id', 'google_client_secret'] },
  { title: 'Insult comeback', keys: ['insult_song_url', 'insult_song_start', 'insult_song_seconds', 'insult_song_chance'] },
];

const HINT: Record<string, string> = {
  feature_verify: 'Before a reply is spoken, the model reads it again for claims it cannot back up. One extra model call per reply',
  sleep_hours: 'He sleeps through these hours: no studying or news, and he dreams and tidies his memory. Message him and he wakes up. "off" keeps him up all night',
  feature_recall: 'Finds what he knows by meaning, not only by name, in his notes and your past conversations. A 130 MB model on the CPU; off, he searches by words only',
  feature_feelings: 'After each reply, a short call decides what he felt; his feelings and mood go into every reply',
  feature_self_tools: 'Offers the model the tools that change his playbook, skills, tasks and knowledge. Small models do better with fewer tools',
  feature_news: 'Every few hours in the day he reads the headlines and keeps what matters',
  feature_study: 'About an hour of reading on a subject he picks, a few times a day, and the long tasks you give him',
  feature_vision: 'When he wonders what something looks like, he finds pictures of it and looks. Turn off if your model cannot read images',
  feature_garden: 'A small greenhouse of his own that grows in real time under your real sky. He visits a few times a day, tends it and feels things about it; watch it in the Garden tab',
  feature_twin: 'An evening session with the other Delamain, who is his therapist: help with his feelings, with notes kept between sessions',
  feature_journal: 'Each night he writes about his day and updates his self-portrait',
  feature_brief: 'From 7am, the first time the app is open: weather, calendar, mail and news',
  feature_self_review: 'After 03:30 he reviews the day and may draft a change to his own code (you approve it)',
  llm_url: 'Ollama, LM Studio, llama.cpp, vLLM or any OpenAI-compatible server with tool calling',
  llm_model: 'As the server lists it at /v1/models; llama.cpp ignores it',
  llm_api_key: 'For hosted or key-protected servers (OpenAI, OpenRouter, llama.cpp --api-key, LiteLLM). Kept on the server, never shown again',
  llm_reasoning_effort: '"none" turns thinking off so the whole reply budget goes to speech',
  llm_model_file: 'Optional. The model file on this computer (a .gguf, or a Halogen .hgn), so the brain view can pin its nodes to the real layers. Found by itself for llama.cpp and Ollama',
  home_address: '"Take me home", the drive time home and the weather there. Shared with your AI model, and with OpenStreetMap when he looks it up',
  searxng_url: 'Web search, and the fallback for news',
  obsidian_vault_path: 'A folder on the server with a .obsidian folder in it; Delamain writes under Delamain/',
  osrm_url: 'Drive times; the public demo server works for light use',
  insult_song_url: 'Now and then, an insult gets a part of this song instead of a comeback',
  insult_song_chance: '0 turns it off; 1 plays it every time',
  google_client_id: 'For Google Calendar. Make one in Google Cloud: see docs/google.md (about 5 minutes)',
  google_client_secret: 'Kept on the server, never shown again',
};

const inputClass = 'w-full bg-cyber-gray/50 border border-cyber-blue/10 rounded-sm p-2 text-sm focus:outline-hidden focus:border-cyber-blue/50';

export const IntegrationsPanel = forwardRef<IntegrationsHandle, { token: string }>(({ token }, ref) => {
  const [fields, setFields] = useState<Record<string, Field> | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/config', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(data => {
        setFields(data.settings);
        setStatus(data.status);
        setValues(Object.fromEntries(Object.entries(data.settings as Record<string, Field>).map(([k, f]) => [k, f.value])));
      })
      .catch(() => setError('Could not load the server settings.'));
  }, [token]);

  const removeSecret = async (key: string) => {
    const r = await fetch('/api/config', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: '' }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { setError(data.detail || 'The server did not accept these settings.'); return; }
    setFields(data.settings);
    setValues(v => ({ ...v, [key]: '' }));
    setError('');
  };

  const saveNow = async () => {
      if (!fields) return true;
      // What the boxes show wins: see typedSettings in App.tsx.
      const typed = Object.fromEntries(Array.from(boxRef.current?.querySelectorAll<HTMLInputElement>('input[name]') ?? [])
        .map(el => [el.name, el.value]));
      const current = { ...values, ...typed };
      const changed = Object.fromEntries(Object.entries(current).filter(([k, v]) => v !== fields[k]?.value));
      if (!Object.keys(changed).length) return true;
      const r = await fetch('/api/config', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(changed),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setError(data.detail || 'The server did not accept these settings.'); return false; }
      setFields(data.settings);
      setStatus(data.status);
      setError('');
      return true;
  };
  useImperativeHandle(ref, () => ({ save: saveNow }));

  if (!fields) {
    return error ? <p className="text-[10px] text-red-400 font-mono">{error}</p>
                 : <p className="text-[10px] text-gray-500 font-mono">Loading server settings…</p>;
  }

  return (
    <div ref={boxRef} className="space-y-4">
      {ORDER.map(group => (
        <div key={group.title} className="space-y-3">
          <div className="text-[10px] text-cyber-blue/60 font-bold uppercase tracking-[0.3em] border-b border-cyber-blue/10 pb-1">
            {group.title}
          </div>
          {group.title === 'Features' && (
            <div className="flex items-center gap-2 text-[9px] text-gray-500">
              <span className="flex-1 leading-relaxed">Each one uses the model. A small or slow model does better with them off; his chat, voice and tools keep working.</span>
              {(['true', 'false'] as const).map(v => (
                <button key={v} type="button"
                  onClick={() => setValues(cur => ({ ...cur, ...Object.fromEntries(FEATURES.filter(k => fields[k]).map(k => [k, v])) }))}
                  className="uppercase tracking-wider px-2 py-1 border border-cyber-blue/20 rounded-sm text-gray-400 hover:text-cyber-blue hover:border-cyber-blue/50">
                  {v === 'true' ? 'All on' : 'All off'}
                </button>
              ))}
            </div>
          )}
          {group.keys.filter(k => fields[k]).map(key => {
            const f = fields[key];
            if (isToggle(f)) {
              const on = isOn(values[key]);
              return (
                <div key={key} className="space-y-1">
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <button type="button" role="switch" aria-checked={on}
                      onClick={() => setValues({ ...values, [key]: on ? 'false' : 'true' })}
                      className={`relative shrink-0 w-9 h-5 rounded-full border transition-colors ${on ? 'bg-cyber-blue/40 border-cyber-blue/70' : 'bg-cyber-gray/50 border-cyber-blue/15'}`}>
                      <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all ${on ? 'left-[18px] bg-cyber-blue' : 'left-0.5 bg-gray-500'}`} />
                    </button>
                    <span className="text-[10px] text-cyber-blue font-bold uppercase tracking-wider">{f.label}</span>
                  </label>
                  {HINT[key] && <p className="text-[9px] text-gray-500 leading-relaxed pl-12">{HINT[key]}</p>}
                </div>
              );
            }
            return (
              <div key={key} className="space-y-1">
                <label className="text-[10px] text-cyber-blue font-bold uppercase tracking-wider">{f.label}</label>
                {f.secret ? (
                  <div className="flex gap-2">
                    <input type="password" name={key} value={values[key]} autoComplete="off"
                      placeholder={f.is_set ? (f.source === 'env' ? 'Set on the server (environment); type one to replace it' : 'Saved; type a new one to replace it') : 'None'}
                      onChange={e => setValues({ ...values, [key]: e.target.value })} className={inputClass} />
                    {f.is_set && f.source === 'settings' && (
                      <button type="button" onClick={() => removeSecret(key)}
                        className="text-[10px] uppercase tracking-wider px-2 border border-cyber-blue/20 rounded-sm text-gray-400 hover:text-red-400 hover:border-red-400/40">
                        Remove
                      </button>
                    )}
                  </div>
                ) : f.choices.length ? (
                  <select value={values[key]} onChange={e => setValues({ ...values, [key]: e.target.value })} className={inputClass}>
                    {f.choices.map(c => <option key={c} value={c}>{c || '(not sent)'}</option>)}
                  </select>
                ) : (
                  <input type="text" name={key} value={values[key]} placeholder={f.default || (key === 'home_address' ? 'e.g. 1600 Pennsylvania Ave NW, Washington, DC' : '')}
                    onChange={e => setValues({ ...values, [key]: e.target.value })} className={inputClass} />
                )}
                {HINT[key] && <p className="text-[9px] text-gray-500 leading-relaxed">{HINT[key]}</p>}
              </div>
            );
          })}
          {group.title === 'Google' && <GoogleConnect token={token} beforeConnect={saveNow} />}
        </div>
      ))}

      {status && (
        <div className="text-[9px] text-gray-500 font-mono leading-relaxed border-t border-cyber-blue/10 pt-2">
          Voice model: {status.voice_model ? 'installed' : 'downloading on first start'} · Voice reference:{' '}
          {status.voice_reference ? 'installed' : <span className="text-red-400">missing</span>} · Lip-synced lines:{' '}
          {status.line_clips}/{status.lines}
        </div>
      )}
      {error && (
        <div className="text-xs text-red-400 font-mono border border-red-400/20 rounded-sm px-3 py-2 bg-red-400/5">{error}</div>
      )}
    </div>
  );
});
