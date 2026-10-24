"""SQLite database for Delamain — conversation history and reminders."""
import os
import sqlite3
import threading
import time
from pathlib import Path

DB_PATH = Path(os.environ.get("DELAMAIN_DB", Path(__file__).parent / "delamain.db"))

# Older installs also have telemetry and events tables from the retired sunnypilot
# link; they are left alone so existing databases keep working.
_SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        REAL NOT NULL,
    role      TEXT NOT NULL,
    content   TEXT NOT NULL,
    audio_url TEXT,
    persona   TEXT
);

CREATE INDEX IF NOT EXISTS idx_conversations_ts ON conversations(ts);

CREATE TABLE IF NOT EXISTS reminders (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    created   REAL NOT NULL,
    due       REAL NOT NULL,
    message   TEXT NOT NULL,
    delivered REAL
);

CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(due);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


# One shared connection. It is used from the event loop, executor threads and the
# tool calls, so every statement goes through _lock.
_conn: sqlite3.Connection | None = None
_lock = threading.RLock()


def init_db() -> None:
    global _conn
    with _lock:
        _conn = _connect()
        _conn.executescript(_SCHEMA)
        cols = {r["name"] for r in _conn.execute("PRAGMA table_info(conversations)")}
        if "persona" not in cols:  # databases from before personality cores
            _conn.execute("ALTER TABLE conversations ADD COLUMN persona TEXT")
        _conn.commit()


def _db() -> sqlite3.Connection:
    if _conn is None:
        init_db()
    return _conn


# ── Write helpers ─────────────────────────────────────────────────────────────

def log_conversation(role: str, content: str, audio_url: str | None = None, persona: str | None = None) -> None:
    with _lock:
        _db().execute(
            "INSERT INTO conversations(ts,role,content,audio_url,persona) VALUES(?,?,?,?,?)",
            (time.time(), role, content, audio_url, persona),
        )
        _db().commit()


def add_reminder(due: float, message: str) -> int:
    with _lock:
        cur = _db().execute(
            "INSERT INTO reminders(created,due,message) VALUES(?,?,?)", (time.time(), due, message))
        _db().commit()
        return cur.lastrowid


def mark_reminder_delivered(reminder_id: int) -> None:
    with _lock:
        _db().execute("UPDATE reminders SET delivered=? WHERE id=?", (time.time(), reminder_id))
        _db().commit()


def cancel_reminder(reminder_id: int) -> bool:
    with _lock:
        cur = _db().execute("DELETE FROM reminders WHERE id=? AND delivered IS NULL", (reminder_id,))
        _db().commit()
        return cur.rowcount > 0


# ── Query helpers ─────────────────────────────────────────────────────────────

def query_conversations(since: float = 0, limit: int = 200) -> list[dict]:
    with _lock:
        rows = _db().execute(
            "SELECT ts,role,content,audio_url,persona FROM conversations"
            " WHERE ts>=? ORDER BY ts DESC LIMIT ?",
            (since, limit),
        ).fetchall()
    return [dict(r) for r in reversed(rows)]


def pending_reminders() -> list[dict]:
    with _lock:
        rows = _db().execute(
            "SELECT id,due,message FROM reminders WHERE delivered IS NULL ORDER BY due").fetchall()
    return [dict(r) for r in rows]


def recently_delivered_reminders(since: float) -> list[dict]:
    with _lock:
        rows = _db().execute(
            "SELECT id,due,message,delivered FROM reminders WHERE delivered>=? ORDER BY delivered",
            (since,)).fetchall()
    return [dict(r) for r in rows]


def due_reminders(now: float | None = None) -> list[dict]:
    with _lock:
        rows = _db().execute(
            "SELECT id,due,message FROM reminders WHERE delivered IS NULL AND due<=? ORDER BY due",
            (now or time.time(),)).fetchall()
    return [dict(r) for r in rows]
