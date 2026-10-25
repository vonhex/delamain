"""Tools Delamain can call through the LLM's native tool calling (OpenAI format).

Web search (SearXNG), reading a web page, the user's Obsidian vault (confined to
the vault), and Delamain's own long-term memory: one Markdown note per topic in
<vault>/Delamain/Memory, a dated bullet per fact, editable in Obsidian.
"""

import fcntl
import ipaddress
import json
import os
import re
import socket
import tempfile
import urllib.parse
from datetime import datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path

import requests

import config

# Search, news, routing, units and the vault come from config (Settings panel, .env or
# defaults) on every call, so a change in Settings takes effect without a restart.
MEMORY_FILES = {
    "you": "About You.md",
    "people": "People.md",
    "places": "Places.md",
    "preferences": "Preferences.md",
    "plans": "Plans.md",
    "self": "Delamain's Notes.md",
}
MEMORY_CONTEXT_CHARS = int(os.environ.get("MEMORY_CONTEXT_CHARS", 8000))
MAX_READ_CHARS = 12000
MAX_WRITE_CHARS = 50000
USER_AGENT = "DelamainAI/1.0"


# ── web ──────────────────────────────────────────────────────────────────────

def web_search(query: str, max_results: int = 6) -> str:
    try:
        resp = requests.get(config.get("searxng_url"), params={"q": query, "format": "json", "language": "en"}, timeout=10)
        resp.raise_for_status()
        results = resp.json().get("results", [])[:max_results]
    except Exception as e:
        return f"Search unavailable: {e}"
    lines = []
    for r in results:
        title, content, url = r.get("title", "").strip(), r.get("content", "").strip(), r.get("url", "")
        if title or content:
            lines.append(f"- {title}: {content} ({url})")
    return "\n".join(lines) or "No results found."


NEWS_LOCALE = {"hl": "en-US", "gl": "US", "ceid": "US:en"}
NEWS_SECTIONS = {"world", "nation", "business", "technology", "entertainment", "sports", "science", "health"}


def _news_feed(topic: str, area: str) -> str:
    topic = topic.strip().lower()
    if area.strip():
        return f"{config.get('news_rss_url')}/headlines/section/geo/{urllib.parse.quote(area.strip())}"
    if topic in ("tech", "tech news"):
        topic = "technology"
    if topic in NEWS_SECTIONS:
        return f"{config.get('news_rss_url')}/headlines/section/topic/{topic.upper()}"
    if topic and topic not in ("news", "top stories", "headlines", "top"):
        return f"{config.get('news_rss_url')}/search?" + urllib.parse.urlencode({"q": f"{topic} when:1d"})
    return config.get("news_rss_url")


def _ago(when: datetime) -> str:
    minutes = max(0, int((datetime.now(when.tzinfo) - when).total_seconds() // 60))
    for size, unit in ((1440, "day"), (60, "hour"), (1, "minute")):
        if minutes >= size or unit == "minute":
            n = minutes // size
            return f"{n} {unit}{'' if n == 1 else 's'} ago"


def get_news(topic: str = "", area: str = "", max_results: int = 8) -> str:
    """Current headlines from Google News: top stories, a section, a search topic, or a town."""
    from email.utils import parsedate_to_datetime
    import xml.etree.ElementTree as ET

    url = _news_feed(topic, area)
    try:
        resp = requests.get(url, params=NEWS_LOCALE, headers={"User-Agent": USER_AGENT}, timeout=10)
        resp.raise_for_status()
        # A news feed never needs a DTD; refusing one rules out entity-expansion tricks.
        if b"<!DOCTYPE" in resp.content[:2048] or b"<!ENTITY" in resp.content:
            raise ValueError("unexpected DTD in feed")
        items = ET.fromstring(resp.content).findall(".//item")
    except Exception:
        # Feed unreachable: fall back to SearXNG's news category.
        return web_search(f"{topic or 'top news'} {area}".strip() + " news", max_results)
    lines = []
    for item in items[:max(1, min(int(max_results), 15))]:
        title = (item.findtext("title") or "").strip()
        source = (item.findtext("source") or "").strip()
        if source and title.endswith(" - " + source):
            title = title[: -len(source) - 3]
        try:
            age = _ago(parsedate_to_datetime(item.findtext("pubDate") or ""))
        except (TypeError, ValueError):
            age = ""
        meta = ", ".join(p for p in (source, age) if p)
        if title:
            lines.append(f"- {title}" + (f" ({meta})" if meta else ""))
    return "\n".join(lines) or "No news found."


# ── places, weather and driving routes ───────────────────────────────────────

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# WMO weather interpretation codes, as Open-Meteo reports them
_WMO = {
    0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "freezing fog",
    51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "freezing drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain",
    71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
    80: "rain showers", 81: "rain showers", 82: "violent rain showers", 85: "snow showers", 86: "heavy snow showers",
    95: "thunderstorms", 96: "thunderstorms with hail", 99: "thunderstorms with hail",
}


def _geocode(place: str, near: dict | None = None) -> tuple[float, float, str] | None:
    """(lat, lon, short name) for a place, preferring results near the passenger."""
    params = {"q": place, "format": "json", "limit": 1, "addressdetails": 1}
    if near and near.get("lat") is not None:
        lat, lon = float(near["lat"]), float(near["lon"])
        params["viewbox"] = f"{lon - 1},{lat + 1},{lon + 1},{lat - 1}"
    resp = requests.get(NOMINATIM_URL, params=params, headers={"User-Agent": USER_AGENT}, timeout=8)
    resp.raise_for_status()
    hits = resp.json()
    if not hits:
        return None
    h = hits[0]
    addr = h.get("address", {})
    town = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("suburb") or ""
    name = h.get("name") or h.get("display_name", "").split(",")[0]
    label = ", ".join(dict.fromkeys(p for p in (name, town, addr.get("state", "")) if p))
    return float(h["lat"]), float(h["lon"]), label


def _here(location: dict | None) -> tuple[float, float] | None:
    if location and location.get("lat") is not None:
        return float(location["lat"]), float(location["lon"])
    return None


def get_weather(place: str = "", location: dict | None = None) -> str:
    """Current conditions plus the next hours and three days for a place or the passenger's position."""
    if place.strip():
        hit = _geocode(place, near=location)
        if not hit:
            return f"Could not find a place called {place}."
        lat, lon, label = hit
    elif (here := _here(location)):
        lat, lon = here
        label = "the passenger's location"
    else:
        return "The passenger's location is unknown; ask which town they mean."
    imperial = config.get("units") != "metric"
    params = {
        "latitude": lat, "longitude": lon, "timezone": "auto", "forecast_days": 3,
        "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,precipitation",
        "hourly": "temperature_2m,precipitation_probability,weather_code",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunset",
        "temperature_unit": "fahrenheit" if imperial else "celsius",
        "wind_speed_unit": "mph" if imperial else "kmh",
    }
    resp = requests.get(OPEN_METEO_URL, params=params, timeout=8)
    resp.raise_for_status()
    d = resp.json()
    deg, wind = ("°F", "mph") if imperial else ("°C", "km/h")
    cur = d["current"]
    lines = [f"Weather for {label}:",
             f"Now: {round(cur['temperature_2m'])}{deg} (feels {round(cur['apparent_temperature'])}{deg}), "
             f"{_WMO.get(cur['weather_code'], 'unknown')}, wind {round(cur['wind_speed_10m'])} {wind} "
             f"gusting {round(cur['wind_gusts_10m'])}."]
    # Next six hours from the current hour onwards
    hourly = d["hourly"]
    start = next((i for i, t in enumerate(hourly["time"]) if t >= cur["time"][:13]), 0)
    nxt = [f"{hourly['time'][i][11:16]} {round(hourly['temperature_2m'][i])}{deg} "
           f"{_WMO.get(hourly['weather_code'][i], '')} {hourly['precipitation_probability'][i]}% rain"
           for i in range(start, min(start + 6, len(hourly["time"])))]
    lines.append("Next hours: " + "; ".join(nxt) + ".")
    daily = d["daily"]
    for i, day in enumerate(("Today", "Tomorrow", "Day after")):
        if i < len(daily["time"]):
            lines.append(f"{day}: high {round(daily['temperature_2m_max'][i])}{deg}, low "
                         f"{round(daily['temperature_2m_min'][i])}{deg}, {_WMO.get(daily['weather_code'][i], '')}, "
                         f"{daily['precipitation_probability_max'][i]}% chance of rain"
                         + (f", sunset {daily['sunset'][i][11:16]}" if i == 0 else "") + ".")
    return "\n".join(lines)


def get_route(destination: str, origin: str = "", location: dict | None = None) -> str:
    """Driving distance and time (no live traffic) from the passenger or a named origin."""
    dest = _geocode(destination, near=location)
    if not dest:
        return f"Could not find {destination}. Search for its address first."
    if origin.strip():
        start = _geocode(origin, near=location)
        if not start:
            return f"Could not find {origin}."
        o_lat, o_lon, o_label = start
    elif (here := _here(location)):
        (o_lat, o_lon), o_label = here, "the passenger's location"
    else:
        return "The passenger's location is unknown; ask where they are starting from."
    url = f"{config.get('osrm_url')}/route/v1/driving/{o_lon},{o_lat};{dest[1]},{dest[0]}"
    resp = requests.get(url, params={"overview": "false"}, headers={"User-Agent": USER_AGENT}, timeout=10)
    resp.raise_for_status()
    routes = resp.json().get("routes") or []
    if not routes:
        return f"No driving route found to {dest[2]}."
    r = routes[0]
    minutes = round(r["duration"] / 60)
    dist = r["distance"] / (1609.344 if config.get("units") != "metric" else 1000)
    unit = "miles" if config.get("units") != "metric" else "km"
    eta = (datetime.now() + timedelta(seconds=r["duration"])).strftime("%-I:%M %p")
    span = f"{minutes // 60} h {minutes % 60} min" if minutes >= 60 else f"{minutes} min"
    return (f"From {o_label} to {dest[2]}: {dist:.1f} {unit}, about {span} by car "
            f"(arriving around {eta}). Typical road speeds, not live traffic; use web_search for current traffic.")


# ── reminders ────────────────────────────────────────────────────────────────

def _when(minutes: float | None, time_of_day: str, date: str) -> datetime | None:
    now = datetime.now()
    if minutes:
        return now + timedelta(minutes=float(minutes))
    if not time_of_day:
        return None
    m = re.fullmatch(r"\s*(\d{1,2}):(\d{2})\s*", time_of_day)
    if not m:
        raise ValueError("time must be HH:MM in 24-hour form, e.g. 17:30")
    day = datetime.strptime(date, "%Y-%m-%d").date() if date else now.date()
    due = datetime.combine(day, datetime.min.time()).replace(hour=int(m[1]), minute=int(m[2]))
    if not date and due <= now:
        due += timedelta(days=1)  # "at 7:00" after seven means tomorrow
    return due


def _spoken_time(due: datetime) -> str:
    now = datetime.now()
    clock = due.strftime("%-I:%M %p")
    if due.date() == now.date():
        return f"today at {clock}"
    if due.date() == (now + timedelta(days=1)).date():
        return f"tomorrow at {clock}"
    return due.strftime("%A %B %-d at ") + clock


def set_reminder(message: str, minutes: float | None = None, time: str = "", date: str = "") -> str:
    import db
    due = _when(minutes, time, date)
    if due is None:
        return "Tool error: give either minutes from now, or a time (HH:MM) with an optional date."
    if due <= datetime.now():
        return "That time has already passed."
    rid = db.add_reminder(due.timestamp(), message.strip())
    return f"Reminder {rid} set for {_spoken_time(due)}: {message.strip()}. I will say it aloud when it is due."


def list_reminders() -> str:
    """Pending reminders, plus those already spoken in the last day."""
    import db
    pending = db.pending_reminders()
    done = db.recently_delivered_reminders((datetime.now() - timedelta(days=1)).timestamp())
    lines = ["Pending:" if pending else "No reminders are pending."]
    lines += [f"- #{r['id']} {_spoken_time(datetime.fromtimestamp(r['due']))}: {r['message']}" for r in pending]
    if done:
        lines.append("Already reminded in the last day:")
        lines += [f"- {datetime.fromtimestamp(r['delivered']).strftime('%-I:%M %p')}: {r['message']}" for r in done]
    return "\n".join(lines)


def cancel_reminder(text: str) -> str:
    """Cancel pending reminders by number ('3') or by words in their message."""
    import db
    rows = db.pending_reminders()
    wanted = text.strip().lstrip("#").lower()
    hits = [r for r in rows if str(r["id"]) == wanted] or [r for r in rows if wanted and wanted in r["message"].lower()]
    if not hits:
        return "No pending reminder matches that."
    for r in hits:
        db.cancel_reminder(r["id"])
    return "Cancelled: " + "; ".join(r["message"] for r in hits)


class _TextExtractor(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "nav", "footer", "header", "form"}

    def __init__(self):
        super().__init__()
        self.parts, self._skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip and data.strip():
            self.parts.append(data.strip())


def _is_public_host(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return False
    return True


def read_webpage(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return "Only public http(s) URLs can be read."
    if not _is_public_host(parsed.hostname):
        return "That address is not on the public internet."
    try:
        resp = requests.get(url, timeout=12, headers={"User-Agent": USER_AGENT}, allow_redirects=True)
        if not _is_public_host(urllib.parse.urlparse(resp.url).hostname or ""):
            return "That page redirected to a private address."
        resp.raise_for_status()
    except Exception as e:
        return f"Could not fetch the page: {e}"
    if "html" not in resp.headers.get("content-type", "html"):
        return resp.text[:MAX_READ_CHARS]
    extractor = _TextExtractor()
    extractor.feed(resp.text)
    text = re.sub(r"\s+", " ", " ".join(extractor.parts))
    return text[:MAX_READ_CHARS] or "The page had no readable text."


# ── Obsidian vault ───────────────────────────────────────────────────────────

def _resolve_note(path: str, *, for_write: bool = False) -> Path:
    rel = (path or "").strip().lstrip("/")
    if not rel:
        raise ValueError("A note path is required.")
    if not rel.lower().endswith(".md"):
        rel += ".md"
    target = (config.vault() / rel).resolve()
    if not target.is_relative_to(config.vault()) or target == config.vault():
        raise ValueError("That path is outside the vault.")
    if any(part.startswith(".") for part in target.relative_to(config.vault()).parts):
        raise ValueError("Hidden folders are not accessible.")
    if for_write and target.is_relative_to(config.memory_dir().resolve()):
        raise ValueError("The memory folder is managed by the remember tool.")
    return target


def _notes(folder: Path):
    for p in sorted(folder.rglob("*.md")):
        if not any(part.startswith(".") for part in p.relative_to(config.vault()).parts):
            yield p


def list_notes(folder: str = "", limit: int = 50) -> str:
    base = (config.vault() / folder.strip().lstrip("/")).resolve() if folder.strip() else config.vault()
    if not base.is_relative_to(config.vault()) or not base.is_dir():
        return "No such folder in the vault."
    notes = sorted(_notes(base), key=lambda p: p.stat().st_mtime, reverse=True)[: max(1, min(int(limit), 200))]
    return "\n".join(f"{p.relative_to(config.vault())} ({datetime.fromtimestamp(p.stat().st_mtime):%Y-%m-%d})"
                     for p in notes) or "No notes found."


def read_note(path: str) -> str:
    target = _resolve_note(path)
    if not target.is_file():
        return f"Note not found: {path}"
    text = target.read_text(encoding="utf-8", errors="replace")
    return text if len(text) <= MAX_READ_CHARS else text[:MAX_READ_CHARS] + "\n[... truncated]"


def search_notes(query: str, limit: int = 10) -> str:
    pattern = re.compile(re.escape(query.strip()), re.IGNORECASE)
    hits = []
    for p in _notes(config.vault()):
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        m = pattern.search(text)
        if m or pattern.search(p.stem):
            start = max(0, (m.start() if m else 0) - 80)
            snippet = text[start:start + 240].replace("\n", " ").strip()
            hits.append(f"{p.relative_to(config.vault())}: {snippet}")
            if len(hits) >= max(1, min(int(limit), 30)):
                break
    return "\n".join(hits) or f"No notes mention '{query}'."


def write_note(path: str, content: str, overwrite: bool = False) -> str:
    if len(content) > MAX_WRITE_CHARS:
        return "Content too large."
    target = _resolve_note(path, for_write=True)
    if target.exists() and not overwrite:
        return f"{target.relative_to(config.vault())} already exists; use append_to_note or overwrite."
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return f"Saved {target.relative_to(config.vault())}."


def append_to_note(path: str, text: str) -> str:
    if len(text) > MAX_WRITE_CHARS:
        return "Text too large."
    target = _resolve_note(path, for_write=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    existing = target.read_text(encoding="utf-8", errors="replace") if target.exists() else ""
    sep = "" if not existing or existing.endswith("\n") else "\n"
    target.write_text(existing + sep + text.rstrip("\n") + "\n", encoding="utf-8")
    return f"Appended to {target.relative_to(config.vault())}."


# ── Delamain's long-term memory: <vault>/Delamain/Memory/<Topic>.md ──────────

_DATE_SUFFIX = re.compile(r" \(\d{4}-\d{2}-\d{2}\)$")


def _bullet_text(line: str) -> str | None:
    """Text of a '- fact (YYYY-MM-DD)' bullet without its date; None if not a bullet.

    String operations plus an anchored, fixed-width regex: linear time on any line.
    """
    s = line.strip()
    if len(s) < 3 or s[0] not in "-*" or not s[1].isspace():
        return None
    return _DATE_SUFFIX.sub("", s[2:].strip()).strip() or None


def _memory_lock():
    """Exclusive lock for read-modify-write of the memory notes (hidden file, ignored by Obsidian)."""
    config.memory_dir().mkdir(parents=True, exist_ok=True)
    fd = os.open(config.memory_dir() / ".lock", os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    fcntl.flock(fd, fcntl.LOCK_EX)
    return fd


def _memory_unlock(fd):
    fcntl.flock(fd, fcntl.LOCK_UN)
    os.close(fd)


def _facts(path: Path) -> list[str]:
    """Bullet facts in a memory note, without their date suffix (edits made in Obsidian included)."""
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        fact = _bullet_text(line)
        if fact:
            out.append(fact)
    return out


def _atomic_write(path: Path, text: str):
    tmp = tempfile.NamedTemporaryFile("w", dir=path.parent, prefix=".mem_", suffix=".tmp", delete=False, encoding="utf-8")
    with tmp:
        tmp.write(text)
    os.replace(tmp.name, path)


def remember(fact: str, category: str = "you") -> str:
    category = category if category in MEMORY_FILES else "you"
    fact = " ".join(fact.split()).rstrip(".") + "."
    if len(fact) < 3:
        return "Nothing to remember."
    path = config.memory_dir() / MEMORY_FILES[category]
    fd = _memory_lock()
    try:
        if any(fact.lower().rstrip(".") == f.lower().rstrip(".") for f in _facts(path)):
            return "Already remembered."
        existing = path.read_text(encoding="utf-8") if path.exists() else f"# {path.stem}\n\n"
        sep = "" if existing.endswith("\n") else "\n"
        _atomic_write(path, existing + sep + f"- {fact} ({datetime.now():%Y-%m-%d})\n")
        return f"Remembered in {path.stem}."
    finally:
        _memory_unlock(fd)


def forget(text: str) -> str:
    """Remove every remembered fact containing *text* (case-insensitive)."""
    needle = text.strip().lower()
    if len(needle) < 3:
        return "Say a little more about what to forget."
    fd = _memory_lock()
    removed = []
    try:
        for name in MEMORY_FILES.values():
            path = config.memory_dir() / name
            if not path.exists():
                continue
            lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
            keep = []
            for line in lines:
                fact = _bullet_text(line)
                if fact and needle in fact.lower():
                    removed.append(fact)
                else:
                    keep.append(line)
            if len(keep) != len(lines):
                _atomic_write(path, "".join(keep))
    finally:
        _memory_unlock(fd)
    return ("Forgot: " + " | ".join(removed)) if removed else f"Nothing remembered matches '{text}'."


def memory_context() -> str:
    """Remembered facts for the system prompt, grouped by topic, newest kept if over budget."""
    sections = []
    for category, name in MEMORY_FILES.items():
        facts = _facts(config.memory_dir() / name)
        if facts:
            sections.append((Path(name).stem, facts))
    text = "\n\n".join(f"{title}:\n" + "\n".join(f"• {f}" for f in facts) for title, facts in sections)
    return text if len(text) <= MEMORY_CONTEXT_CHARS else "…" + text[-MEMORY_CONTEXT_CHARS:]


# ── registry ─────────────────────────────────────────────────────────────────

def _fn(name, description, properties, required):
    return {"type": "function", "function": {"name": name, "description": description, "parameters": {
        "type": "object", "properties": properties, "required": required}}}


TOOL_SCHEMAS = [
    _fn("web_search", "Search the web for current information: weather, traffic, news, scores, opening hours, "
        "prices, places, or any fact you are not certain of.",
        {"query": {"type": "string", "description": "Search query; include the city when relevant."}}, ["query"]),
    _fn("get_news", "Current news headlines. With no arguments: today's top stories. Use when the passenger asks for "
        "the news, headlines, or what is happening, in general, on a subject, or around a place.",
        {"topic": {"type": "string", "description": "Optional: a section (world, nation, business, technology, "
                                                    "entertainment, sports, science, health) or any subject, e.g. 'Tesla'."},
         "area": {"type": "string", "description": "Optional: a town or region for local news, e.g. 'Denver'."}}, []),
    _fn("get_weather", "Current weather and the forecast for the next hours and three days. With no place, it uses "
        "the passenger's current location.",
        {"place": {"type": "string", "description": "Optional town or address, e.g. 'Boulder, Colorado'."}}, []),
    _fn("get_route", "Driving distance, time and arrival estimate to a destination (typical speeds, not live traffic). "
        "Starts from the passenger's location unless an origin is given. For 'nearest' places, web_search first.",
        {"destination": {"type": "string", "description": "Address or place name with its town."},
         "origin": {"type": "string", "description": "Optional starting point; defaults to the passenger's location."}},
        ["destination"]),
    _fn("set_reminder", "Set a spoken reminder or timer. Delamain will say it aloud when it is due. Give minutes from "
        "now ('in 20 minutes', timers), or a 24-hour time with an optional date.",
        {"message": {"type": "string", "description": "What to remind them of, e.g. 'call mom'."},
         "minutes": {"type": "number", "description": "Minutes from now."},
         "time": {"type": "string", "description": "Time of day, HH:MM 24-hour, e.g. '17:30'."},
         "date": {"type": "string", "description": "Optional date YYYY-MM-DD; without it, the next time that hour comes."}},
        ["message"]),
    _fn("list_reminders", "List the reminders that have not gone off yet.", {}, []),
    _fn("cancel_reminder", "Cancel a pending reminder by its number or by words from it.",
        {"text": {"type": "string", "description": "Reminder number or distinctive words, e.g. 'call mom'."}}, ["text"]),
    _fn("read_webpage", "Read the text of a public web page, e.g. a search result, for details.",
        {"url": {"type": "string"}}, ["url"]),
    _fn("list_notes", "List notes in the passenger's Obsidian vault, newest first.",
        {"folder": {"type": "string", "description": "Optional vault-relative folder, e.g. 'Delamain'."}}, []),
    _fn("read_note", "Read a note from the vault.",
        {"path": {"type": "string", "description": "Vault-relative path, e.g. 'Delamain/Shopping list.md'."}}, ["path"]),
    _fn("search_notes", "Search note names and contents in the vault.",
        {"query": {"type": "string"}}, ["query"]),
    _fn("write_note", "Create a new note in the vault (or replace one with overwrite=true).",
        {"path": {"type": "string"}, "content": {"type": "string", "description": "Markdown content."},
         "overwrite": {"type": "boolean"}}, ["path", "content"]),
    _fn("append_to_note", "Append a line or section to a note, creating it if needed. Use for lists, reminders and logs.",
        {"path": {"type": "string"}, "text": {"type": "string"}}, ["path", "text"]),
    _fn("remember", "Store one lasting fact in long-term memory. Keep it to one concise, self-contained sentence "
        "that names who it is about.",
        {"fact": {"type": "string"},
         "category": {"type": "string", "enum": list(MEMORY_FILES),
                      "description": "you = the passenger themselves; people = friends, family, colleagues; places = "
                                     "home, work, favourite spots; preferences = likes, dislikes, habits; plans = upcoming "
                                     "events and intentions; self = your own standing notes."}},
        ["fact", "category"]),
    _fn("forget", "Delete remembered facts that contain the given words, when the passenger asks you to forget something "
        "or a fact is wrong.",
        {"text": {"type": "string", "description": "Distinctive words from the fact to delete."}}, ["text"]),
]

_HANDLERS = {
    "web_search": web_search, "get_news": get_news, "get_weather": get_weather, "get_route": get_route,
    "set_reminder": set_reminder, "list_reminders": list_reminders, "cancel_reminder": cancel_reminder,
    "read_webpage": read_webpage, "list_notes": list_notes,
    "read_note": read_note, "search_notes": search_notes, "write_note": write_note,
    "append_to_note": append_to_note, "remember": remember, "forget": forget,
}


# Tools that need the passenger's browser position get it from the server, never from the model.
_NEEDS_LOCATION = {"get_weather", "get_route"}


def run_tool(name: str, arguments: str | dict, location: dict | None = None) -> str:
    handler = _HANDLERS.get(name)
    if not handler:
        return f"Unknown tool: {name}"
    try:
        args = json.loads(arguments) if isinstance(arguments, str) else (arguments or {})
        args.pop("location", None)
        if name in _NEEDS_LOCATION:
            args["location"] = location
        return str(handler(**args))
    except (ValueError, TypeError) as e:
        return f"Tool error: {e}"
    except Exception as e:  # never let a tool failure kill the reply
        return f"Tool failed: {e}"
