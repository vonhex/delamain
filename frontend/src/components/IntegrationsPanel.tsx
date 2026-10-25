import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';

// Server-side settings (saved in settings.json on the server, ahead of .env), so the
// LLM, search, Obsidian, news, routing and units can be set up without editing files.

interface Field {
  value: string;
  source: 'settings' | 'env' | 'default';
  label: string;
  default: string;
  choices: string[];
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

const ORDER: { title: string; keys: string[] }[] = [
  { title: 'Language model', keys: ['llm_url', 'llm_model', 'llm_reasoning_effort'] },
  { title: 'Tools', keys: ['tools_enabled', 'searxng_url', 'obsidian_vault_path', 'news_rss_url', 'osrm_url', 'units'] },
  { title: 'Insult comeback', keys: ['insult_song_url', 'insult_song_start', 'insult_song_seconds', 'insult_song_chance'] },
];

const HINT: Record<string, string> = {
  llm_url: 'llama.cpp, vLLM, Halogen or any OpenAI-compatible server with tool calling',
  llm_model: 'As the server lists it at /v1/models; llama.cpp ignores it',
  llm_reasoning_effort: '"none" turns thinking off so the whole reply budget goes to speech',
  searxng_url: 'Web search, and the fallback for news',
  obsidian_vault_path: 'A folder on the server with a .obsidian folder in it; Delamain writes under Delamain/',
  osrm_url: 'Drive times; the public demo server works for light use',
  insult_song_url: 'Now and then, an insult gets a part of this song instead of a comeback',
  insult_song_chance: '0 turns it off; 1 plays it every time',
};

const inputClass = 'w-full bg-cyber-gray/50 border border-cyber-blue/10 rounded-sm p-2 text-sm focus:outline-hidden focus:border-cyber-blue/50';

export const IntegrationsPanel = forwardRef<IntegrationsHandle, { token: string }>(({ token }, ref) => {
  const [fields, setFields] = useState<Record<string, Field> | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

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

  useImperativeHandle(ref, () => ({
    save: async () => {
      if (!fields) return true;
      const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== fields[k]?.value));
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
    },
  }), [fields, values, token]);

  if (!fields) {
    return error ? <p className="text-[10px] text-red-400 font-mono">{error}</p>
                 : <p className="text-[10px] text-gray-500 font-mono">Loading server settings…</p>;
  }

  return (
    <div className="space-y-4">
      {ORDER.map(group => (
        <div key={group.title} className="space-y-3">
          <div className="text-[10px] text-cyber-blue/60 font-bold uppercase tracking-[0.3em] border-b border-cyber-blue/10 pb-1">
            {group.title}
          </div>
          {group.keys.filter(k => fields[k]).map(key => {
            const f = fields[key];
            return (
              <div key={key} className="space-y-1">
                <label className="text-[10px] text-cyber-blue font-bold uppercase tracking-wider">{f.label}</label>
                {f.choices.length ? (
                  <select value={values[key]} onChange={e => setValues({ ...values, [key]: e.target.value })} className={inputClass}>
                    {f.choices.map(c => <option key={c} value={c}>{c || '(not sent)'}</option>)}
                  </select>
                ) : (
                  <input type="text" value={values[key]} placeholder={f.default}
                    onChange={e => setValues({ ...values, [key]: e.target.value })} className={inputClass} />
                )}
                {HINT[key] && <p className="text-[9px] text-gray-500 leading-relaxed">{HINT[key]}</p>}
              </div>
            );
          })}
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
