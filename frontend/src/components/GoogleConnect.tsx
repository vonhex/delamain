import { useCallback, useEffect, useState } from 'react';

// Connect Google Calendar: the client id and secret above are saved first, then Google's sign-in
// opens in a new window and comes back to /api/google/callback on this same address.

type GStatus = { configured: boolean; connected: boolean; email: string | null; callback_path: string };

export function GoogleConnect({ token, beforeConnect }: { token: string; beforeConnect: () => Promise<boolean> }) {
  const [st, setSt] = useState<GStatus | null>(null);
  const [msg, setMsg] = useState('');
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const refresh = useCallback(() => {
    fetch('/api/google/status', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null)).then(s => s && setSt(s)).catch(() => {});
  }, [token]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {   // the sign-in window says when it is done
    const onMsg = (e: MessageEvent) => { if (e.origin === location.origin && e.data === 'google-connected') { setMsg(''); refresh(); } };
    const onFocus = () => refresh();
    window.addEventListener('message', onMsg); window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('message', onMsg); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  const connect = async () => {
    setMsg('');
    const win = window.open('', '_blank');   // opened now, while the click still counts, so it is not blocked
    if (!(await beforeConnect())) { win?.close(); return; }
    const r = await fetch('/api/google/connect', { method: 'POST', headers: h, body: JSON.stringify({ origin: location.origin }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { win?.close(); setMsg(data.detail || 'Could not start the Google sign-in.'); return; }
    if (win) win.location.href = data.url; else location.href = data.url;
    setMsg('Finish signing in to Google in the window that opened.');
  };
  const disconnect = async () => {
    const r = await fetch('/api/google/disconnect', { method: 'POST', headers: h });
    if (r.ok) setSt(await r.json());
  };

  const redirect = `${location.origin}${st?.callback_path ?? '/api/google/callback'}`;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {st?.connected ? (
          <>
            <span className="text-xs text-green-400 flex-1">Connected{st.email ? ` as ${st.email}` : ''}</span>
            <button type="button" onClick={() => void disconnect()}
              className="text-[10px] uppercase tracking-wider px-3 py-1.5 border border-cyber-blue/20 rounded-sm text-gray-400 hover:text-red-400 hover:border-red-400/40">Disconnect</button>
          </>
        ) : (
          <button type="button" onClick={() => void connect()}
            className="text-[10px] uppercase tracking-wider px-3 py-1.5 border border-cyber-blue/40 rounded-sm text-cyber-blue hover:bg-cyber-blue/10">
            Connect Google Calendar
          </button>
        )}
      </div>
      {msg && <p className="text-[10px] text-amber-300">{msg}</p>}
      <p className="text-[9px] text-gray-500 leading-relaxed">
        Authorised redirect URI to add to the Google client (one per address you open Delamain at):{' '}
        <span className="font-mono text-gray-400 select-all break-all">{redirect}</span>
      </p>
    </div>
  );
}
