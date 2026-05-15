"""JWT authentication for Delamain.

Single-password model: one shared secret stored hashed in the DB.
Set/change it by running:  python auth.py set-password <newpassword>
"""
import os
import secrets
import sys
import time
from pathlib import Path

import bcrypt as _bcrypt
from jose import JWTError, jwt

import db as _db

# JWT config — secret auto-generated and persisted in the DB settings table
_ALG = "HS256"
_TOKEN_EXPIRE = 60 * 60 * 24 * 30  # 30 days


# ── DB bootstrap for auth settings ────────────────────────────────────────────

_AUTH_SCHEMA = """
CREATE TABLE IF NOT EXISTS auth_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def _ensure_auth_table() -> None:
    _db._db().executescript(_AUTH_SCHEMA)
    _db._db().commit()


def _get_setting(key: str) -> str | None:
    _ensure_auth_table()
    row = _db._db().execute(
        "SELECT value FROM auth_settings WHERE key=?", (key,)
    ).fetchone()
    return row[0] if row else None


def _set_setting(key: str, value: str) -> None:
    _ensure_auth_table()
    _db._db().execute(
        "INSERT INTO auth_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )
    _db._db().commit()


_jwt_secret_cache: str | None = None


def get_jwt_secret() -> str:
    global _jwt_secret_cache
    if _jwt_secret_cache:
        return _jwt_secret_cache
    secret = _get_setting("jwt_secret")
    if not secret:
        secret = secrets.token_hex(32)
        _set_setting("jwt_secret", secret)
    _jwt_secret_cache = secret
    return secret


def get_password_hash() -> str | None:
    return _get_setting("password_hash")


# ── Password management ───────────────────────────────────────────────────────

def set_password(plain: str) -> None:
    hashed = _bcrypt.hashpw(plain.encode(), _bcrypt.gensalt()).decode()
    _set_setting("password_hash", hashed)


def verify_password(plain: str) -> bool:
    hashed = get_password_hash()
    if not hashed:
        return False
    return _bcrypt.checkpw(plain.encode(), hashed.encode())


# ── Token management ──────────────────────────────────────────────────────────

def create_token() -> str:
    payload = {"sub": "delamain", "iat": int(time.time()), "exp": int(time.time()) + _TOKEN_EXPIRE}
    return jwt.encode(payload, get_jwt_secret(), algorithm=_ALG)


def verify_token(token: str) -> bool:
    try:
        jwt.decode(token, get_jwt_secret(), algorithms=[_ALG])
        return True
    except JWTError:
        return False


# ── CLI helper ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    _db.init_db()
    if len(sys.argv) == 3 and sys.argv[1] == "set-password":
        set_password(sys.argv[2])
        print("Password set.")
    elif len(sys.argv) == 2 and sys.argv[1] == "show-token":
        print(create_token())
    else:
        print("Usage: python auth.py set-password <password>")
        print("       python auth.py show-token")
