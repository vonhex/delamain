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
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path

import requests

SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://localhost:8887/search")
VAULT = Path(os.environ.get("OBSIDIAN_VAULT_PATH", "~/Documents/obsidian vault")).expanduser().resolve()
MEMORY_DIR = Path(os.environ.get("DELAMAIN_MEMORY_DIR", str(VAULT / "Delamain" / "Memory"))).expanduser()
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
        resp = requests.get(SEARXNG_URL, params={"q": query, "format": "json", "language": "en"}, timeout=10)
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


NEWS_RSS = os.environ.get("NEWS_RSS_URL", "https://news.google.com/rss")
NEWS_LOCALE = {"hl": "en-US", "gl": "US", "ceid": "US:en"}
NEWS_SECTIONS = {"world", "nation", "business", "technology", "entertainment", "sports", "science", "health"}


def _news_feed(topic: str, area: str) -> str:
    topic = topic.strip().lower()
    if area.strip():
        return f"{NEWS_RSS}/headlines/section/geo/{urllib.parse.quote(area.strip())}"
    if topic in ("tech", "tech news"):
        topic = "technology"
    if topic in NEWS_SECTIONS:
        return f"{NEWS_RSS}/headlines/section/topic/{topic.upper()}"
    if topic and topic not in ("news", "top stories", "headlines", "top"):
        return f"{NEWS_RSS}/search?" + urllib.parse.urlencode({"q": f"{topic} when:1d"})
    return NEWS_RSS


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
    target = (VAULT / rel).resolve()
    if not target.is_relative_to(VAULT) or target == VAULT:
        raise ValueError("That path is outside the vault.")
    if any(part.startswith(".") for part in target.relative_to(VAULT).parts):
        raise ValueError("Hidden folders are not accessible.")
    if for_write and target.is_relative_to(MEMORY_DIR.resolve()):
        raise ValueError("The memory folder is managed by the remember tool.")
    return target


def _notes(folder: Path):
    for p in sorted(folder.rglob("*.md")):
        if not any(part.startswith(".") for part in p.relative_to(VAULT).parts):
            yield p


def list_notes(folder: str = "", limit: int = 50) -> str:
    base = (VAULT / folder.strip().lstrip("/")).resolve() if folder.strip() else VAULT
    if not base.is_relative_to(VAULT) or not base.is_dir():
        return "No such folder in the vault."
    notes = sorted(_notes(base), key=lambda p: p.stat().st_mtime, reverse=True)[: max(1, min(int(limit), 200))]
    return "\n".join(f"{p.relative_to(VAULT)} ({datetime.fromtimestamp(p.stat().st_mtime):%Y-%m-%d})"
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
    for p in _notes(VAULT):
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        m = pattern.search(text)
        if m or pattern.search(p.stem):
            start = max(0, (m.start() if m else 0) - 80)
            snippet = text[start:start + 240].replace("\n", " ").strip()
            hits.append(f"{p.relative_to(VAULT)}: {snippet}")
            if len(hits) >= max(1, min(int(limit), 30)):
                break
    return "\n".join(hits) or f"No notes mention '{query}'."


def write_note(path: str, content: str, overwrite: bool = False) -> str:
    if len(content) > MAX_WRITE_CHARS:
        return "Content too large."
    target = _resolve_note(path, for_write=True)
    if target.exists() and not overwrite:
        return f"{target.relative_to(VAULT)} already exists; use append_to_note or overwrite."
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return f"Saved {target.relative_to(VAULT)}."


def append_to_note(path: str, text: str) -> str:
    if len(text) > MAX_WRITE_CHARS:
        return "Text too large."
    target = _resolve_note(path, for_write=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    existing = target.read_text(encoding="utf-8", errors="replace") if target.exists() else ""
    sep = "" if not existing or existing.endswith("\n") else "\n"
    target.write_text(existing + sep + text.rstrip("\n") + "\n", encoding="utf-8")
    return f"Appended to {target.relative_to(VAULT)}."


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
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    fd = os.open(MEMORY_DIR / ".lock", os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
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
    path = MEMORY_DIR / MEMORY_FILES[category]
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
            path = MEMORY_DIR / name
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
        facts = _facts(MEMORY_DIR / name)
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
    "web_search": web_search, "get_news": get_news, "read_webpage": read_webpage, "list_notes": list_notes,
    "read_note": read_note, "search_notes": search_notes, "write_note": write_note,
    "append_to_note": append_to_note, "remember": remember, "forget": forget,
}


def run_tool(name: str, arguments: str | dict) -> str:
    handler = _HANDLERS.get(name)
    if not handler:
        return f"Unknown tool: {name}"
    try:
        args = json.loads(arguments) if isinstance(arguments, str) else (arguments or {})
        return str(handler(**args))
    except (ValueError, TypeError) as e:
        return f"Tool error: {e}"
    except Exception as e:  # never let a tool failure kill the reply
        return f"Tool failed: {e}"
