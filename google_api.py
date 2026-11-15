"""Google Calendar for Delamain, through the passenger's own Google Cloud OAuth client.

Setup (docs/google.md): create a Web OAuth client in Google Cloud, paste its id and secret in
Settings → Integrations → Google, press Connect, sign in. The refresh token is kept on this
server (in the database, never sent to the browser); access tokens are fetched as needed.

Plain REST over `requests`: no Google client libraries.
"""
import secrets
import threading
import time
import urllib.parse
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import requests

import auth
import config

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
CAL = "https://www.googleapis.com/calendar/v3"
SCOPES = ["openid", "email",
          "https://www.googleapis.com/auth/calendar.readonly",      # see every calendar
          "https://www.googleapis.com/auth/calendar.events"]        # add, move and remove events
CALLBACK_PATH = "/api/google/callback"
NOT_CONNECTED = ("Google Calendar is not connected. Tell the passenger to connect it in Settings → Integrations → "
                 "Google (it takes a minute; see the guide there).")

_lock = threading.Lock()
_pending: dict[str, tuple[str, float]] = {}        # OAuth state -> (redirect uri, expiry)
_access: dict = {"token": "", "until": 0.0}
_calendars: dict = {"list": [], "until": 0.0}
_refs: dict[str, tuple[str, str, str]] = {}        # "E3" -> (calendar id, event id, title), from the last listing


class GoogleError(Exception):
    pass


# ── the account ───────────────────────────────────────────────────────────────

def _client() -> tuple[str, str]:
    return config.get("google_client_id").strip(), config.get("google_client_secret").strip()


def status() -> dict:
    cid, secret = _client()
    return {"configured": bool(cid and secret), "connected": bool(auth._get_setting("google_refresh_token")),
            "email": auth._get_setting("google_email") or None, "callback_path": CALLBACK_PATH}


def auth_url(origin: str) -> str:
    """Where to send the browser to sign in. `origin` is the page's own address (https://host), so
    the redirect comes back the same way, through whatever proxy or domain the page is on."""
    cid, secret = _client()
    if not (cid and secret):
        raise GoogleError("Enter the Google client ID and secret first, and save.")
    o = urllib.parse.urlparse(origin)
    if o.scheme not in ("http", "https") or not o.netloc or o.path not in ("", "/"):
        raise GoogleError("Bad page address.")
    redirect = f"{o.scheme}://{o.netloc}{CALLBACK_PATH}"
    state = secrets.token_urlsafe(24)
    with _lock:
        now = time.time()
        for k in [k for k, (_, exp) in _pending.items() if exp < now]:
            _pending.pop(k, None)
        _pending[state] = (redirect, now + 600)
    return AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": cid, "redirect_uri": redirect, "response_type": "code", "scope": " ".join(SCOPES),
        "access_type": "offline", "prompt": "consent", "include_granted_scopes": "true", "state": state})


def finish_sign_in(code: str, state: str) -> str:
    """The redirect back from Google: swap the code for tokens and keep the refresh token."""
    with _lock:
        entry = _pending.pop(state or "", None)
    if not entry or entry[1] < time.time():
        raise GoogleError("This sign-in link has expired. Press Connect again.")
    cid, secret = _client()
    r = requests.post(TOKEN_URL, data={"code": code, "client_id": cid, "client_secret": secret,
                                       "redirect_uri": entry[0], "grant_type": "authorization_code"}, timeout=20)
    if r.status_code != 200:
        raise GoogleError(f"Google refused the sign-in: {r.text[:200]}")
    tok = r.json()
    if not tok.get("refresh_token"):
        raise GoogleError("Google sent no refresh token. Remove Delamain at myaccount.google.com/permissions and connect again.")
    granted = set(tok.get("scope", "").split())
    if "https://www.googleapis.com/auth/calendar.events" not in granted:
        raise GoogleError("Calendar access was not granted. Connect again and tick the calendar boxes.")
    auth._set_setting("google_refresh_token", tok["refresh_token"])
    with _lock:
        _access.update(token=tok["access_token"], until=time.time() + int(tok.get("expires_in", 3600)) - 60)
        _calendars.update(list=[], until=0.0)
    email = ""
    try:
        email = requests.get(USERINFO_URL, headers={"Authorization": f"Bearer {tok['access_token']}"}, timeout=10).json().get("email", "")
    except Exception:
        pass
    auth._set_setting("google_email", email)
    print(f"[Google] Connected{f' as {email}' if email else ''}")
    return email


def disconnect() -> None:
    token = auth._get_setting("google_refresh_token")
    if token:
        try:
            requests.post(REVOKE_URL, data={"token": token}, timeout=10)
        except Exception:
            pass
    auth._set_setting("google_refresh_token", "")
    auth._set_setting("google_email", "")
    with _lock:
        _access.update(token="", until=0.0)
        _calendars.update(list=[], until=0.0)
        _refs.clear()


def _token() -> str:
    with _lock:
        if _access["token"] and time.time() < _access["until"]:
            return _access["token"]
    refresh = auth._get_setting("google_refresh_token")
    cid, secret = _client()
    if not refresh or not (cid and secret):
        raise GoogleError(NOT_CONNECTED)
    r = requests.post(TOKEN_URL, data={"refresh_token": refresh, "client_id": cid, "client_secret": secret,
                                       "grant_type": "refresh_token"}, timeout=20)
    if r.status_code != 200:
        if "invalid_grant" in r.text:
            auth._set_setting("google_refresh_token", "")
            raise GoogleError("The Google connection has expired or was removed. Tell the passenger to press Connect "
                              "again in Settings → Integrations → Google.")
        raise GoogleError(f"Google sign-in failed: {r.text[:200]}")
    tok = r.json()
    with _lock:
        _access.update(token=tok["access_token"], until=time.time() + int(tok.get("expires_in", 3600)) - 60)
        return _access["token"]


def _api(method: str, path: str, **kw):
    r = requests.request(method, CAL + path, headers={"Authorization": f"Bearer {_token()}"}, timeout=20, **kw)
    if r.status_code == 401:
        with _lock:
            _access.update(token="", until=0.0)
        r = requests.request(method, CAL + path, headers={"Authorization": f"Bearer {_token()}"}, timeout=20, **kw)
    if r.status_code >= 400:
        try:
            msg = r.json().get("error", {}).get("message", r.text)
        except ValueError:
            msg = r.text
        raise GoogleError(f"Google Calendar said: {msg[:200]}")
    return r.json() if r.content else {}


# ── calendars and events ──────────────────────────────────────────────────────

def calendars() -> list[dict]:
    """The calendars shown in the passenger's Google Calendar (the ticked ones)."""
    with _lock:
        if _calendars["list"] and time.time() < _calendars["until"]:
            return _calendars["list"]
    items = _api("GET", "/users/me/calendarList", params={"minAccessRole": "reader"}).get("items", [])
    out = [{"id": c["id"], "name": c.get("summaryOverride") or c.get("summary", ""), "primary": bool(c.get("primary")),
            "tz": c.get("timeZone"), "writable": c.get("accessRole") in ("owner", "writer")}
           for c in items if c.get("selected") or c.get("primary")]
    out.sort(key=lambda c: (not c["primary"], c["name"].lower()))
    with _lock:
        _calendars.update(list=out, until=time.time() + 600)
    return out


def _tz() -> ZoneInfo:
    for c in calendars():
        if c["primary"] and c.get("tz"):
            try:
                return ZoneInfo(c["tz"])
            except Exception:
                break
    return datetime.now().astimezone().tzinfo   # this computer's zone


def _parse_day(s: str | None, tz) -> date:
    s = (s or "").strip().lower()
    today = datetime.now(tz).date()
    if not s or s == "today":
        return today
    if s == "tomorrow":
        return today + timedelta(days=1)
    return date.fromisoformat(s[:10])


def _parse_when(s: str, tz) -> datetime:
    """'2026-11-16T15:00' (local time), with or without seconds or an offset."""
    dt = datetime.fromisoformat(s.strip().replace("Z", "+00:00").replace(" ", "T"))
    return dt.astimezone(tz) if dt.tzinfo else dt.replace(tzinfo=tz)


def _fmt_time(dt: datetime) -> str:
    return dt.strftime("%-I:%M %p").replace(":00 ", " ")


def _describe(ev: dict, tz) -> tuple[datetime, str]:
    s, e = ev.get("start", {}), ev.get("end", {})
    if "date" in s:
        d0, d1 = date.fromisoformat(s["date"]), date.fromisoformat(e.get("date", s["date"])) - timedelta(days=1)
        when = f"{d0:%a %b %-d}" + (f" to {d1:%a %b %-d}" if d1 > d0 else "") + ", all day"
        key = datetime(d0.year, d0.month, d0.day, tzinfo=tz)
    else:
        a, b = _parse_when(s["dateTime"], tz), _parse_when(e.get("dateTime", s["dateTime"]), tz)
        when = f"{a:%a %b %-d}, {_fmt_time(a)}–{_fmt_time(b)}" if a.date() == b.date() else \
            f"{a:%a %b %-d} {_fmt_time(a)} to {b:%a %b %-d} {_fmt_time(b)}"
        key = a
    return key, when


def get_calendar(start_date: str = "", days: int = 1, query: str = "") -> str:
    """Events from start_date for `days` days, across the passenger's calendars."""
    tz = _tz()
    d0 = _parse_day(start_date, tz)
    days = max(1, min(int(days or 1), 31))
    t0 = datetime(d0.year, d0.month, d0.day, tzinfo=tz)
    if d0 == datetime.now(tz).date() and days == 1 and not query:
        t0 = datetime.now(tz) - timedelta(hours=1)          # today: what is left of it (and what just started)
    t1 = datetime(d0.year, d0.month, d0.day, tzinfo=tz) + timedelta(days=days)
    found = []
    for c in calendars():
        params = {"timeMin": t0.isoformat(), "timeMax": t1.isoformat(), "singleEvents": "true",
                  "orderBy": "startTime", "maxResults": 100}
        if query:
            params["q"] = query
        for ev in _api("GET", f"/calendars/{urllib.parse.quote(c['id'], safe='')}/events", params=params).get("items", []):
            if ev.get("status") == "cancelled":
                continue
            key, when = _describe(ev, tz)
            found.append((key, when, ev, c))
    found.sort(key=lambda f: f[0])
    with _lock:
        _refs.clear()
    if not found:
        span = f"{d0:%A %B %-d}" + (f" to {(d0 + timedelta(days=days - 1)):%A %B %-d}" if days > 1 else "")
        return f"Nothing on the calendar for {span}{f' matching {query!r}' if query else ''}."
    lines = []
    for i, (_, when, ev, c) in enumerate(found[:60], 1):
        ref = f"E{i}"
        title = ev.get("summary") or "(no title)"
        with _lock:
            _refs[ref] = (c["id"], ev["id"], title)
        extra = []
        if ev.get("location"):
            extra.append(f"at {ev['location'][:80]}")
        if not c["primary"]:
            extra.append(f"calendar: {c['name']}")
        if ev.get("attendees"):
            extra.append(f"{len(ev['attendees'])} people")
        lines.append(f"[{ref}] {when}: {title}" + (f" ({'; '.join(extra)})" if extra else ""))
    more = f"\n(and {len(found) - 60} more)" if len(found) > 60 else ""
    return "\n".join(lines) + more + f"\n(Times are {datetime.now(tz):%Z}. Use the [E#] reference to move or remove an event.)"


def _pick_calendar(name: str) -> dict:
    cals = calendars()
    if name:
        for c in cals:
            if c["name"].lower() == name.strip().lower():
                if not c["writable"]:
                    raise GoogleError(f"The calendar '{c['name']}' is read-only.")
                return c
        raise GoogleError(f"No calendar named '{name}'. Calendars: " + ", ".join(c["name"] for c in cals if c["writable"]))
    return next((c for c in cals if c["primary"]), cals[0] if cals else {"id": "primary", "name": "primary"})


def _times(start: str, end: str, minutes, all_day: bool, tz) -> dict:
    if all_day:
        d0 = _parse_day(start, tz)
        d1 = _parse_day(end, tz) if end else d0
        return {"start": {"date": d0.isoformat()}, "end": {"date": (d1 + timedelta(days=1)).isoformat()}}
    a = _parse_when(start, tz)
    b = _parse_when(end, tz) if end else a + timedelta(minutes=int(minutes or 60))
    if b <= a:
        raise GoogleError("The event would end before it starts.")
    zone = getattr(tz, "key", None)
    s = {"dateTime": a.isoformat(), **({"timeZone": zone} if zone else {})}
    e = {"dateTime": b.isoformat(), **({"timeZone": zone} if zone else {})}
    return {"start": s, "end": e}


def add_calendar_event(title: str, start: str, end: str = "", duration_minutes: int | None = None,
                       all_day: bool = False, location: str = "", description: str = "", calendar: str = "") -> str:
    tz = _tz()
    cal = _pick_calendar(calendar)
    body = {"summary": title.strip()[:200], **_times(start, end, duration_minutes, all_day, tz)}
    if location:
        body["location"] = location[:300]
    if description:
        body["description"] = description[:4000]
    ev = _api("POST", f"/calendars/{urllib.parse.quote(cal['id'], safe='')}/events", json=body)
    _, when = _describe(ev, tz)
    return f"Added '{ev.get('summary')}' on {when}" + (f" to the {cal['name']} calendar" if not cal.get("primary") else "") + "."


def _ref(ref: str) -> tuple[str, str, str]:
    with _lock:
        hit = _refs.get((ref or "").strip().strip("[]").upper())
    if not hit:
        raise GoogleError("Unknown event reference; call get_calendar first and use its [E#] reference.")
    return hit


def update_calendar_event(ref: str, title: str = "", start: str = "", end: str = "", duration_minutes: int | None = None,
                          location: str | None = None, description: str | None = None) -> str:
    cal_id, ev_id, old = _ref(ref)
    tz = _tz()
    path = f"/calendars/{urllib.parse.quote(cal_id, safe='')}/events/{urllib.parse.quote(ev_id, safe='')}"
    ev = _api("GET", path)
    patch: dict = {}
    if title:
        patch["summary"] = title[:200]
    if start:
        if "date" in ev.get("start", {}) and "T" not in start:
            patch.update(_times(start, end, None, True, tz))
        else:
            if not end and not duration_minutes and "dateTime" in ev.get("start", {}):
                length = _parse_when(ev["end"]["dateTime"], tz) - _parse_when(ev["start"]["dateTime"], tz)
                duration_minutes = int(length.total_seconds() // 60)     # moving keeps its length
            patch.update(_times(start, end, duration_minutes, False, tz))
    elif end or duration_minutes:
        a = ev["start"].get("dateTime")
        if not a:
            raise GoogleError("Give a new start for an all-day event.")
        patch.update(_times(a, end, duration_minutes, False, tz))
    if location is not None:
        patch["location"] = location[:300]
    if description is not None:
        patch["description"] = description[:4000]
    if not patch:
        return "Nothing to change."
    ev = _api("PATCH", path, json=patch)
    _, when = _describe(ev, tz)
    return f"Updated '{ev.get('summary') or old}': now {when}."


def delete_calendar_event(ref: str) -> str:
    cal_id, ev_id, title = _ref(ref)
    _api("DELETE", f"/calendars/{urllib.parse.quote(cal_id, safe='')}/events/{urllib.parse.quote(ev_id, safe='')}")
    with _lock:
        _refs.pop(ref.strip().strip("[]").upper(), None)
    return f"Removed '{title}' from the calendar."


def _safe(fn):
    """Calendar tools answer the model in words, never with an exception."""
    def run(**kw):
        try:
            return fn(**kw)
        except GoogleError as e:
            return str(e)
        except (ValueError, KeyError) as e:
            return f"Could not understand that date or time ({e}). Use YYYY-MM-DD and YYYY-MM-DDTHH:MM."
        except requests.RequestException:
            return "Could not reach Google Calendar just now."
    run.__name__ = fn.__name__
    return run


HANDLERS = {f.__name__: _safe(f) for f in (get_calendar, add_calendar_event, update_calendar_event, delete_calendar_event)}
