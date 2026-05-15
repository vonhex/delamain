"""SQLite database for Delamain — telemetry, events, conversations."""
import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).parent / "delamain.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS telemetry (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        REAL NOT NULL,
    speed_mph REAL,
    cruise_mph REAL,
    acc_active INTEGER,
    lead_dist_m REAL,
    speed_limit_mph REAL,
    lat       REAL,
    lon       REAL
);

CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         REAL NOT NULL,
    event      TEXT NOT NULL,
    data_json  TEXT,
    response   TEXT
);

CREATE TABLE IF NOT EXISTS conversations (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        REAL NOT NULL,
    role      TEXT NOT NULL,
    content   TEXT NOT NULL,
    audio_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_telemetry_ts   ON telemetry(ts);
CREATE INDEX IF NOT EXISTS idx_events_ts      ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_event   ON events(event);
CREATE INDEX IF NOT EXISTS idx_conversations_ts ON conversations(ts);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


# Module-level single connection (FastAPI runs single-process; writes are
# serialised through the executor thread so no WAL needed).
_conn: sqlite3.Connection | None = None


def init_db() -> None:
    global _conn
    _conn = _connect()
    _conn.executescript(_SCHEMA)
    _conn.commit()


def _db() -> sqlite3.Connection:
    if _conn is None:
        init_db()
    return _conn


# ── Write helpers ─────────────────────────────────────────────────────────────

def log_telemetry(speed_mph: float, cruise_mph: float, acc_active: bool,
                  lead_dist_m: float | None, speed_limit_mph: float | None,
                  lat: float | None = None, lon: float | None = None) -> None:
    _db().execute(
        "INSERT INTO telemetry(ts,speed_mph,cruise_mph,acc_active,lead_dist_m,speed_limit_mph,lat,lon)"
        " VALUES(?,?,?,?,?,?,?,?)",
        (time.time(), speed_mph, cruise_mph, int(acc_active),
         lead_dist_m, speed_limit_mph, lat, lon),
    )
    _db().commit()


def log_event(event: str, data: dict | None, response: str | None) -> None:
    _db().execute(
        "INSERT INTO events(ts,event,data_json,response) VALUES(?,?,?,?)",
        (time.time(), event, json.dumps(data) if data else None, response),
    )
    _db().commit()


def log_conversation(role: str, content: str, audio_url: str | None = None) -> None:
    _db().execute(
        "INSERT INTO conversations(ts,role,content,audio_url) VALUES(?,?,?,?)",
        (time.time(), role, content, audio_url),
    )
    _db().commit()


# ── Query helpers ─────────────────────────────────────────────────────────────

def query_telemetry(since: float = 0, limit: int = 2000) -> list[dict]:
    rows = _db().execute(
        "SELECT ts,speed_mph,cruise_mph,acc_active,lead_dist_m,speed_limit_mph,lat,lon"
        " FROM telemetry WHERE ts>=? ORDER BY ts DESC LIMIT ?",
        (since, limit),
    ).fetchall()
    return [dict(r) for r in reversed(rows)]


def query_events(since: float = 0, limit: int = 500, event: str | None = None) -> list[dict]:
    if event:
        rows = _db().execute(
            "SELECT ts,event,data_json,response FROM events"
            " WHERE ts>=? AND event=? ORDER BY ts DESC LIMIT ?",
            (since, event, limit),
        ).fetchall()
    else:
        rows = _db().execute(
            "SELECT ts,event,data_json,response FROM events"
            " WHERE ts>=? ORDER BY ts DESC LIMIT ?",
            (since, limit),
        ).fetchall()
    result = []
    for r in reversed(rows):
        d = dict(r)
        d["data"] = json.loads(d.pop("data_json")) if d.get("data_json") else {}
        result.append(d)
    return result


def query_conversations(since: float = 0, limit: int = 200) -> list[dict]:
    rows = _db().execute(
        "SELECT ts,role,content,audio_url FROM conversations"
        " WHERE ts>=? ORDER BY ts DESC LIMIT ?",
        (since, limit),
    ).fetchall()
    return [dict(r) for r in reversed(rows)]


def query_event_counts(since: float = 0) -> list[dict]:
    rows = _db().execute(
        "SELECT event, COUNT(*) as count FROM events WHERE ts>=? GROUP BY event ORDER BY count DESC",
        (since,),
    ).fetchall()
    return [dict(r) for r in rows]


def query_trips(limit: int = 20) -> list[dict]:
    """Segment telemetry into trips (gap > 5 min = new trip) and compute drive scores."""
    rows = _db().execute(
        "SELECT ts,speed_mph,cruise_mph,acc_active,lat,lon FROM telemetry ORDER BY ts"
    ).fetchall()
    if not rows:
        return []

    GAP = 300  # 5-minute gap → new trip
    trips: list[list] = []
    current: list = [rows[0]]
    for r in rows[1:]:
        if r["ts"] - current[-1]["ts"] > GAP:
            trips.append(current)
            current = []
        current.append(r)
    if current:
        trips.append(current)

    results = []
    for trip in trips[-limit:]:
        start_ts = trip[0]["ts"]
        end_ts = trip[-1]["ts"]
        duration_min = (end_ts - start_ts) / 60
        if duration_min < 1:
            continue  # skip tiny blips

        speeds = [r["speed_mph"] for r in trip if r["speed_mph"] > 2]
        avg_speed = sum(speeds) / len(speeds) if speeds else 0
        max_speed = max(speeds) if speeds else 0
        acc_pct = 100 * sum(1 for r in trip if r["acc_active"]) // max(len(trip), 1)

        # Events during this trip
        ev_rows = _db().execute(
            "SELECT event, COUNT(*) as n FROM events WHERE ts>=? AND ts<=?"
            " GROUP BY event",
            (start_ts, end_ts),
        ).fetchall()
        ev_counts = {r["event"]: r["n"] for r in ev_rows}

        # Drive score: 100 minus deductions
        score = 100
        score -= min(ev_counts.get("very_hard_brake", 0) * 15, 30)
        score -= min(ev_counts.get("hard_brake", 0) * 5, 20)
        score -= min(ev_counts.get("lead_car_very_close", 0) * 10, 25)
        score -= min(ev_counts.get("lead_car_close", 0) * 3, 15)
        score -= min(ev_counts.get("speeding", 0) * 5, 20)
        score = max(score, 0)

        # Route bounding box for map
        lats = [r["lat"] for r in trip if r["lat"]]
        lons = [r["lon"] for r in trip if r["lon"]]
        route = [{"lat": r["lat"], "lon": r["lon"]} for r in trip if r["lat"] and r["lon"]]

        results.append({
            "start_ts": start_ts,
            "end_ts": end_ts,
            "duration_min": round(duration_min, 1),
            "avg_speed": round(avg_speed, 1),
            "max_speed": round(max_speed, 1),
            "acc_pct": acc_pct,
            "score": score,
            "events": ev_counts,
            "route": route[::max(1, len(route)//200)],  # downsample to ≤200 points
            "center": {
                "lat": (min(lats) + max(lats)) / 2 if lats else None,
                "lon": (min(lons) + max(lons)) / 2 if lons else None,
            },
        })

    return list(reversed(results))
