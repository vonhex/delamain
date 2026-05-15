import { useState } from 'react';
import { Terminal, Lock } from 'lucide-react';

interface Props {
  onLogin: (token: string) => void;
}

export function LoginPage({ onLogin }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem('delamain_token', data.token);
        onLogin(data.token);
      } else {
        setError('Access denied. Invalid credentials.');
      }
    } catch {
      setError('Connection error. Backend unreachable.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-cyber-dark flex items-center justify-center p-4 font-rajdhani">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-cyber-blue/10 border border-cyber-blue/30 mb-4">
            <Terminal size={32} className="text-cyber-blue" />
          </div>
          <h1
            className="text-4xl font-bold tracking-[0.4em] text-cyber-blue uppercase"
            style={{ textShadow: '0 0 18px rgba(0,243,255,0.65)' }}
          >
            DELAMAIN
          </h1>
          <p className="text-[10px] tracking-[0.45em] text-cyber-blue/35 uppercase mt-1">Executive Transport Intelligence</p>
        </div>

        {/* Card */}
        <form
          onSubmit={handleSubmit}
          className="bg-cyber-gray/20 border border-cyber-blue/20 rounded-lg p-6 shadow-[0_0_30px_rgba(0,243,255,0.08)]"
        >
          <div className="mb-2">
            <label className="text-[10px] text-cyber-blue font-bold uppercase tracking-wider">
              Authorization Code
            </label>
          </div>
          <div className="relative mb-4">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-cyber-blue/40" />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter access code..."
              autoFocus
              className="w-full bg-cyber-dark border border-cyber-blue/20 rounded pl-9 pr-4 py-3 text-sm text-cyber-blue placeholder-cyber-blue/25 focus:outline-none focus:border-cyber-blue/60 transition-colors"
            />
          </div>

          {error && (
            <div className="mb-4 text-xs text-red-400 font-mono border border-red-400/20 rounded px-3 py-2 bg-red-400/5">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3 bg-cyber-blue/20 border border-cyber-blue/50 text-cyber-blue font-bold tracking-widest uppercase text-sm rounded transition-all hover:bg-cyber-blue/30 hover:shadow-[0_0_16px_rgba(0,243,255,0.25)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Authenticating...' : 'Authenticate'}
          </button>
        </form>

        <p className="text-center text-[10px] text-gray-600 mt-4 font-mono">
          SECURE PROTOCOL · DELAMAIN SYSTEMS
        </p>
      </div>
    </div>
  );
}
