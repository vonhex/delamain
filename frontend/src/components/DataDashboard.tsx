import { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw } from 'lucide-react';

interface ConversationRow {
  ts: number;
  role: string;
  content: string;
  audio_url: string | null;
}

const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleString();

export function DataDashboard({ token, onClose }: { token: string; onClose: () => void }) {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sinceHours, setSinceHours] = useState(24);

  const authFetch = useCallback((url: string) =>
    fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then(r => {
      if (r.status === 401) throw new Error('401');
      return r.json();
    }), [token]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const since = Date.now() / 1000 - sinceHours * 3600;
      setConversations(await authFetch(`/api/data/conversations?since=${since}&limit=200`));
    } catch (e) {
      console.error('Data fetch error', e);
    } finally {
      setLoading(false);
    }
  }, [sinceHours, authFetch]);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh every 20s while the panel is open
  useEffect(() => {
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="flex flex-col h-full bg-cyber-dark/95 text-white text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-cyber-blue/30 bg-cyber-blue/5 shrink-0">
        <span className="font-mono font-bold text-cyber-blue tracking-widest text-xs">CONVERSATION_LOG</span>
        <div className="flex items-center gap-2">
          <select
            value={sinceHours}
            onChange={e => setSinceHours(Number(e.target.value))}
            className="bg-cyber-gray/40 border border-cyber-blue/20 text-cyber-blue rounded-sm px-1 py-0.5 text-xs"
          >
            <option value={1}>Last 1h</option>
            <option value={6}>Last 6h</option>
            <option value={24}>Last 24h</option>
            <option value={168}>Last 7d</option>
          </select>
          <button
            onClick={refresh}
            className={`p-1 rounded-sm text-cyber-blue hover:bg-cyber-blue/10 ${loading ? 'animate-spin' : ''}`}
          >
            <RefreshCw size={14} />
          </button>
          <button onClick={onClose} className="p-1 rounded-sm text-gray-500 hover:text-white hover:bg-cyber-gray/40">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">
        {!conversations.length ? (
          <div className="flex items-center justify-center h-40 text-gray-600 text-xs font-mono">
            No conversations in this time range.
          </div>
        ) : (
          <div className="space-y-2">
            {conversations.map((c, i) => (
              <div key={i} className={`flex gap-2 ${c.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded p-2 text-xs ${
                  c.role === 'user'
                    ? 'bg-cyber-blue/20 border border-cyber-blue/40 text-cyber-blue'
                    : 'bg-cyber-gray/30 border border-cyber-gray/40 text-gray-200'
                }`}>
                  <div className="text-gray-500 font-mono mb-0.5">{fmtDate(c.ts)}</div>
                  <div>{c.content}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
