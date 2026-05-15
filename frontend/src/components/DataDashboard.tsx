import { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, Activity, Zap, MessageSquare, BarChart2, Route } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import { MapContainer, TileLayer, Polyline, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix leaflet default icon paths broken by bundler
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface TelemetryRow {
  ts: number;
  speed_mph: number;
  cruise_mph: number;
  acc_active: number;
  lead_dist_m: number | null;
  speed_limit_mph: number | null;
}

interface EventRow {
  ts: number;
  event: string;
  data: Record<string, unknown>;
  response: string | null;
}

interface ConversationRow {
  ts: number;
  role: string;
  content: string;
  audio_url: string | null;
}

interface EventCount { event: string; count: number }

interface TripRow {
  start_ts: number;
  end_ts: number;
  duration_min: number;
  avg_speed: number;
  max_speed: number;
  acc_pct: number;
  score: number;
  events: Record<string, number>;
  route: { lat: number; lon: number }[];
  center: { lat: number | null; lon: number | null };
}

type Tab = 'summary' | 'trips' | 'telemetry' | 'events' | 'conversations';

const fmt = (ts: number) => new Date(ts * 1000).toLocaleTimeString();
const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleString();
const fmtDur = (min: number) => min >= 60
  ? `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`
  : `${Math.round(min)}m`;

const EVENT_COLORS: Record<string, string> = {
  lead_car_close: '#f97316',
  lead_car_very_close: '#ef4444',
  acc_engaged: '#22c55e',
  acc_disengaged: '#94a3b8',
  hard_brake: '#f59e0b',
  very_hard_brake: '#dc2626',
  speeding: '#f97316',
  high_speed: '#fb923c',
  stopped_in_traffic: '#64748b',
  seatbelt_off: '#eab308',
};
const EVENT_COLOR_DEFAULT = '#00F3FF';

const scoreColor = (s: number) =>
  s >= 85 ? '#22c55e' : s >= 65 ? '#f59e0b' : '#ef4444';

export function DataDashboard({ token, onClose }: { token: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('summary');
  const [telemetry, setTelemetry] = useState<TelemetryRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [eventCounts, setEventCounts] = useState<EventCount[]>([]);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sinceHours, setSinceHours] = useState(24);

  const since = () => Date.now() / 1000 - sinceHours * 3600;

  const authFetch = useCallback((url: string) =>
    fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then(r => {
      if (r.status === 401) throw new Error('401');
      return r.json();
    }), [token]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = since();
      const [tel, ev, con, ec, tr] = await Promise.all([
        authFetch(`/api/data/telemetry?since=${s}&limit=2000`),
        authFetch(`/api/data/events?since=${s}&limit=500`),
        authFetch(`/api/data/conversations?since=${s}&limit=200`),
        authFetch(`/api/data/event-counts?since=${s}`),
        authFetch(`/api/data/trips?limit=20`),
      ]);
      setTelemetry(tel);
      setEvents(ev);
      setConversations(con);
      setEventCounts(ec);
      setTrips(tr);
    } catch (e) {
      console.error('Data fetch error', e);
    } finally {
      setLoading(false);
    }
  }, [sinceHours, authFetch]);

  useEffect(() => { refresh(); }, [refresh]);

  const telChartData = telemetry.map(r => ({
    time: fmt(r.ts),
    speed: Math.round(r.speed_mph),
    cruise: r.acc_active ? Math.round(r.cruise_mph) : null,
    lead: r.lead_dist_m != null ? Math.round(r.lead_dist_m) : null,
    limit: r.speed_limit_mph ? Math.round(r.speed_limit_mph) : null,
  }));

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'summary', label: 'Summary', icon: <BarChart2 size={14} /> },
    { id: 'trips', label: `Trips (${trips.length})`, icon: <Route size={14} /> },
    { id: 'telemetry', label: 'Telemetry', icon: <Activity size={14} /> },
    { id: 'events', label: `Events (${events.length})`, icon: <Zap size={14} /> },
    { id: 'conversations', label: `Chat (${conversations.length})`, icon: <MessageSquare size={14} /> },
  ];

  return (
    <div className="flex flex-col h-full bg-cyber-dark/95 text-white text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-cyber-blue/30 bg-cyber-blue/5 shrink-0">
        <span className="font-mono font-bold text-cyber-blue tracking-widest text-xs">DATA_EXPLORER</span>
        <div className="flex items-center gap-2">
          <select
            value={sinceHours}
            onChange={e => setSinceHours(Number(e.target.value))}
            className="bg-cyber-gray/40 border border-cyber-blue/20 text-cyber-blue rounded px-1 py-0.5 text-xs"
          >
            <option value={1}>Last 1h</option>
            <option value={6}>Last 6h</option>
            <option value={24}>Last 24h</option>
            <option value={168}>Last 7d</option>
          </select>
          <button
            onClick={refresh}
            className={`p-1 rounded text-cyber-blue hover:bg-cyber-blue/10 ${loading ? 'animate-spin' : ''}`}
          >
            <RefreshCw size={14} />
          </button>
          <button onClick={onClose} className="p-1 rounded text-gray-500 hover:text-white hover:bg-cyber-gray/40">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 px-3 py-1.5 border-b border-cyber-blue/20 shrink-0 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors whitespace-nowrap ${
              tab === t.id
                ? 'bg-cyber-blue/20 text-cyber-blue border border-cyber-blue/40'
                : 'text-gray-400 hover:text-cyber-blue hover:bg-cyber-blue/5'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">
        {tab === 'summary' && (
          <SummaryTab
            telemetry={telemetry}
            eventCounts={eventCounts}
            events={events}
            conversations={conversations}
          />
        )}
        {tab === 'trips' && <TripsTab trips={trips} />}
        {tab === 'telemetry' && <TelemetryTab data={telChartData} raw={telemetry} />}
        {tab === 'events' && <EventsTab events={events} />}
        {tab === 'conversations' && <ConversationsTab conversations={conversations} />}
      </div>
    </div>
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────

function SummaryTab({ telemetry, eventCounts, events, conversations }: {
  telemetry: TelemetryRow[];
  eventCounts: EventCount[];
  events: EventRow[];
  conversations: ConversationRow[];
}) {
  const avgSpeed = telemetry.length
    ? Math.round(telemetry.reduce((s, r) => s + r.speed_mph, 0) / telemetry.length)
    : 0;
  const maxSpeed = telemetry.length
    ? Math.round(Math.max(...telemetry.map(r => r.speed_mph)))
    : 0;
  const accPct = telemetry.length
    ? Math.round(100 * telemetry.filter(r => r.acc_active).length / telemetry.length)
    : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Avg Speed', value: `${avgSpeed} mph` },
          { label: 'Max Speed', value: `${maxSpeed} mph` },
          { label: 'ACC Time', value: `${accPct}%` },
          { label: 'Events', value: events.length },
          { label: 'Chats', value: conversations.filter(c => c.role === 'user').length },
          { label: 'Alerts', value: events.filter(e => ['lead_car_close','lead_car_very_close','hard_brake','very_hard_brake'].includes(e.event)).length },
          { label: 'Data Points', value: telemetry.length },
          { label: 'Event Types', value: eventCounts.length },
        ].map(s => (
          <div key={s.label} className="bg-cyber-gray/20 border border-cyber-blue/10 rounded p-2 text-center">
            <div className="text-cyber-blue font-mono font-bold text-sm">{s.value}</div>
            <div className="text-gray-500 text-xs mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {eventCounts.length > 0 && (
        <div>
          <div className="text-gray-400 mb-1 font-mono">EVENT FREQUENCY</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={eventCounts} layout="vertical" margin={{ left: 30, right: 10 }}>
              <XAxis type="number" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 10 }} />
              <YAxis
                type="category" dataKey="event" width={130}
                tick={{ fill: '#94a3b8', fontSize: 9 }}
                tickFormatter={v => v.replace(/_/g, ' ')}
              />
              <Tooltip
                contentStyle={{ background: '#0d1117', border: '1px solid #00F3FF33', fontSize: 11 }}
                labelStyle={{ color: '#00F3FF' }}
              />
              <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                {eventCounts.map(entry => (
                  <Cell key={entry.event} fill={EVENT_COLORS[entry.event] || EVENT_COLOR_DEFAULT} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {events.length > 0 && (
        <div>
          <div className="text-gray-400 mb-1 font-mono">RECENT EVENTS</div>
          <div className="space-y-1 max-h-40 overflow-auto">
            {events.slice(-10).reverse().map((e, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="text-gray-500 shrink-0 font-mono">{fmt(e.ts)}</span>
                <span
                  className="shrink-0 px-1 rounded text-xs font-mono"
                  style={{ color: EVENT_COLORS[e.event] || EVENT_COLOR_DEFAULT, border: `1px solid ${EVENT_COLORS[e.event] || EVENT_COLOR_DEFAULT}40` }}
                >
                  {e.event.replace(/_/g, ' ')}
                </span>
                <span className="text-gray-300 truncate">{e.response}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Trips ─────────────────────────────────────────────────────────────────────

function TripsTab({ trips }: { trips: TripRow[] }) {
  const [selected, setSelected] = useState<TripRow | null>(null);

  if (!trips.length) return <Empty msg="No trips recorded yet." />;

  if (selected) {
    const hasRoute = selected.route.length >= 2;
    const center: [number, number] = selected.center.lat && selected.center.lon
      ? [selected.center.lat, selected.center.lon]
      : [selected.route[0]?.lat ?? 0, selected.route[0]?.lon ?? 0];
    const polyline: [number, number][] = selected.route.map(p => [p.lat, p.lon]);
    const start = polyline[0];
    const end = polyline[polyline.length - 1];

    return (
      <div className="space-y-3">
        <button
          onClick={() => setSelected(null)}
          className="text-cyber-blue/60 hover:text-cyber-blue text-xs font-mono flex items-center gap-1"
        >
          ← Back to trips
        </button>

        {/* Score + stats */}
        <div className="flex items-center gap-3">
          <div
            className="w-14 h-14 rounded-full border-2 flex items-center justify-center font-mono font-bold text-xl shrink-0"
            style={{ borderColor: scoreColor(selected.score), color: scoreColor(selected.score) }}
          >
            {selected.score}
          </div>
          <div className="grid grid-cols-3 gap-2 flex-1">
            {[
              { label: 'Duration', value: fmtDur(selected.duration_min) },
              { label: 'Avg Speed', value: `${selected.avg_speed} mph` },
              { label: 'Max Speed', value: `${selected.max_speed} mph` },
              { label: 'ACC', value: `${selected.acc_pct}%` },
              { label: 'Start', value: new Date(selected.start_ts * 1000).toLocaleTimeString() },
              { label: 'End', value: new Date(selected.end_ts * 1000).toLocaleTimeString() },
            ].map(s => (
              <div key={s.label} className="bg-cyber-gray/20 border border-cyber-blue/10 rounded p-1.5 text-center">
                <div className="text-cyber-blue font-mono text-xs font-bold">{s.value}</div>
                <div className="text-gray-500 text-[10px]">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Route map */}
        {hasRoute ? (
          <div className="rounded overflow-hidden border border-cyber-blue/20" style={{ height: 260 }}>
            <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }} zoomControl={false}>
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; OpenStreetMap &copy; CARTO'
              />
              <Polyline positions={polyline} color="#00F3FF" weight={3} opacity={0.85} />
              {start && <Marker position={start}><Popup>Start</Popup></Marker>}
              {end && <Marker position={end}><Popup>End</Popup></Marker>}
            </MapContainer>
          </div>
        ) : (
          <div className="h-24 flex items-center justify-center text-gray-600 font-mono text-xs border border-cyber-blue/10 rounded">
            No GPS route data for this trip.
          </div>
        )}

        {/* Events during trip */}
        {Object.keys(selected.events).length > 0 && (
          <div>
            <div className="text-gray-400 mb-1 font-mono">EVENTS DURING TRIP</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(selected.events).sort((a, b) => b[1] - a[1]).map(([ev, n]) => (
                <span
                  key={ev}
                  className="px-2 py-0.5 rounded text-xs font-mono"
                  style={{ color: EVENT_COLORS[ev] || EVENT_COLOR_DEFAULT, border: `1px solid ${EVENT_COLORS[ev] || EVENT_COLOR_DEFAULT}50` }}
                >
                  {ev.replace(/_/g, ' ')} ×{n}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {trips.map((trip, i) => (
        <button
          key={i}
          onClick={() => setSelected(trip)}
          className="w-full text-left border border-cyber-gray/20 rounded p-3 hover:border-cyber-blue/30 bg-cyber-gray/10 hover:bg-cyber-blue/5 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-gray-200 font-mono text-xs">
                {new Date(trip.start_ts * 1000).toLocaleDateString()} — {fmtDur(trip.duration_min)}
              </div>
              <div className="text-gray-500 text-[11px] mt-0.5">
                {new Date(trip.start_ts * 1000).toLocaleTimeString()} → {new Date(trip.end_ts * 1000).toLocaleTimeString()}
                {' · '}{trip.avg_speed} mph avg · {trip.max_speed} mph max
              </div>
            </div>
            <div
              className="w-10 h-10 rounded-full border-2 flex items-center justify-center font-mono font-bold text-sm shrink-0 ml-3"
              style={{ borderColor: scoreColor(trip.score), color: scoreColor(trip.score) }}
            >
              {trip.score}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Telemetry ─────────────────────────────────────────────────────────────────

function TelemetryTab({ data, raw }: { data: ReturnType<typeof Array.prototype.map>; raw: TelemetryRow[] }) {
  if (!data.length) return <Empty msg="No telemetry data in this time range." />;
  return (
    <div className="space-y-4">
      <div>
        <div className="text-gray-400 mb-1 font-mono">SPEED (mph)</div>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data} margin={{ left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="time" stroke="#475569" tick={{ fill: '#64748b', fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis stroke="#475569" tick={{ fill: '#64748b', fontSize: 10 }} />
            <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid #00F3FF33', fontSize: 11 }} />
            <Line type="monotone" dataKey="speed" stroke="#00F3FF" dot={false} strokeWidth={1.5} name="Speed" />
            <Line type="monotone" dataKey="cruise" stroke="#22c55e" dot={false} strokeWidth={1} strokeDasharray="4 2" name="Cruise" />
            <Line type="monotone" dataKey="limit" stroke="#f97316" dot={false} strokeWidth={1} strokeDasharray="2 4" name="Limit" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <div className="text-gray-400 mb-1 font-mono">LEAD DISTANCE (m)</div>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={data} margin={{ left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="time" stroke="#475569" tick={{ fill: '#64748b', fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis stroke="#475569" tick={{ fill: '#64748b', fontSize: 10 }} />
            <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid #00F3FF33', fontSize: 11 }} />
            <Line type="monotone" dataKey="lead" stroke="#f59e0b" dot={false} strokeWidth={1.5} name="Lead dist" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <div className="text-gray-400 mb-1 font-mono">RECENT READINGS</div>
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-gray-500 border-b border-cyber-gray/30">
              <th className="text-left py-1">Time</th>
              <th className="text-right py-1">Speed</th>
              <th className="text-right py-1">Cruise</th>
              <th className="text-right py-1">Lead</th>
              <th className="text-right py-1">Limit</th>
              <th className="text-center py-1">ACC</th>
            </tr>
          </thead>
          <tbody>
            {raw.slice(-20).reverse().map((r, i) => (
              <tr key={i} className="border-b border-cyber-gray/10 hover:bg-cyber-blue/5">
                <td className="py-0.5 text-gray-500">{fmt(r.ts)}</td>
                <td className="py-0.5 text-right text-cyber-blue">{Math.round(r.speed_mph)}</td>
                <td className="py-0.5 text-right text-green-400">{r.acc_active ? Math.round(r.cruise_mph) : '—'}</td>
                <td className="py-0.5 text-right text-amber-400">{r.lead_dist_m != null ? Math.round(r.lead_dist_m) : '—'}</td>
                <td className="py-0.5 text-right text-orange-400">{r.speed_limit_mph ? Math.round(r.speed_limit_mph) : '—'}</td>
                <td className="py-0.5 text-center">{r.acc_active ? <span className="text-green-400">●</span> : <span className="text-gray-600">○</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Events ────────────────────────────────────────────────────────────────────

function EventsTab({ events }: { events: EventRow[] }) {
  const [filter, setFilter] = useState('');
  if (!events.length) return <Empty msg="No events in this time range." />;
  const filtered = filter ? events.filter(e => e.event.includes(filter)) : events;
  const types = [...new Set(events.map(e => e.event))].sort();
  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-center">
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="bg-cyber-gray/40 border border-cyber-blue/20 text-cyber-blue rounded px-2 py-1 text-xs"
        >
          <option value="">All events</option>
          {types.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
        <span className="text-gray-500">{filtered.length} rows</span>
      </div>

      <div className="space-y-1 max-h-[60vh] overflow-auto">
        {[...filtered].reverse().map((e, i) => (
          <div key={i} className="border border-cyber-gray/20 rounded p-2 hover:border-cyber-blue/30 bg-cyber-gray/10">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-gray-500 font-mono text-xs">{fmtDate(e.ts)}</span>
              <span
                className="px-1.5 py-0.5 rounded text-xs font-mono"
                style={{ color: EVENT_COLORS[e.event] || EVENT_COLOR_DEFAULT, border: `1px solid ${EVENT_COLORS[e.event] || EVENT_COLOR_DEFAULT}50` }}
              >
                {e.event.replace(/_/g, ' ')}
              </span>
              {Object.keys(e.data).length > 0 && (
                <span className="text-gray-600 font-mono">
                  {Object.entries(e.data).map(([k, v]) => `${k}=${v}`).join(' ')}
                </span>
              )}
            </div>
            {e.response && (
              <div className="text-gray-300 italic">"{e.response}"</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Conversations ─────────────────────────────────────────────────────────────

function ConversationsTab({ conversations }: { conversations: ConversationRow[] }) {
  if (!conversations.length) return <Empty msg="No conversations in this time range." />;
  return (
    <div className="space-y-2 max-h-[70vh] overflow-auto">
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
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="flex items-center justify-center h-40 text-gray-600 text-xs font-mono">
      {msg}
    </div>
  );
}
