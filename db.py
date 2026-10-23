"""SQLite database for Delamain — conversation history."""
import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).parent / "delamain.db"

# Older installs also have telemetry and events tables from the retired sunnypilot
# link; they are left alone so existing databases keep working.
_SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        REAL NOT NULL,
    role      TEXT NOT NULL,
    content   TEXT NOT NULL,
    audio_url TEXT
);

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

def log_conversation(role: str, content: str, audio_url: str | None = None) -> None:
    _db().execute(
        "INSERT INTO conversations(ts,role,content,audio_url) VALUES(?,?,?,?)",
        (time.time(), role, content, audio_url),
    )
    _db().commit()


# ── Query helpers ─────────────────────────────────────────────────────────────

def query_conversations(since: float = 0, limit: int = 200) -> list[dict]:
    rows = _db().execute(
        "SELECT ts,role,content,audio_url FROM conversations"
        " WHERE ts>=? ORDER BY ts DESC LIMIT ?",
        (since, limit),
    ).fetchall()
    return [dict(r) for r in reversed(rows)]
