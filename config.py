"""Settings that can be changed from the web UI and are saved on the server.

Each value comes from settings.json (written by the Settings panel) when it is set
there, otherwise from the environment (.env), otherwise the built-in default, so a
fresh install works without a .env and an existing .env keeps working.
"""
import json
import os
import threading
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent
SETTINGS_PATH = Path(os.environ.get(
    "DELAMAIN_SETTINGS",
    Path(os.environ.get("DELAMAIN_DB", BASE_DIR / "delamain.db")).parent / "settings.json"))

# key: (environment variable, default, label shown in the Settings panel)
FIELDS: dict[str, tuple[str, str, str]] = {
    "llm_url": ("LLM_URL", "http://localhost:8080/v1/chat/completions", "LLM endpoint (OpenAI-compatible chat completions)"),
    "llm_model": ("LLM_MODEL", "gpt-4-vision-preview", "Model id"),
    "llm_reasoning_effort": ("LLM_REASONING_EFFORT", "", "Reasoning effort (reasoning models only)"),
    "tools_enabled": ("TOOLS_ENABLED", "true", "Tools: web search, news, weather, routes, notes, memory"),
    "searxng_url": ("SEARXNG_URL", "http://localhost:8887/search", "SearXNG search URL"),
    "obsidian_vault_path": ("OBSIDIAN_VAULT_PATH", "~/Documents/obsidian vault", "Obsidian vault folder"),
    "news_rss_url": ("NEWS_RSS_URL", "https://news.google.com/rss", "News RSS base URL"),
    "osrm_url": ("OSRM_URL", "https://router.project-osrm.org", "OSRM routing server"),
    "units": ("DELAMAIN_UNITS", "imperial", "Units"),
}
URL_FIELDS = {"llm_url", "searxng_url", "news_rss_url", "osrm_url"}
CHOICES = {
    "llm_reasoning_effort": ("", "none", "low", "medium", "high"),
    "tools_enabled": ("true", "false"),
    "units": ("imperial", "metric"),
}

_lock = threading.Lock()
_saved: dict[str, str] | None = None


def _load() -> dict[str, str]:
    global _saved
    if _saved is None:
        try:
            data = json.loads(SETTINGS_PATH.read_text())
            _saved = {k: str(v) for k, v in data.items() if k in FIELDS}
        except (OSError, ValueError):
            _saved = {}
    return _saved


def get(key: str) -> str:
    env, default, _ = FIELDS[key]
    saved = _load().get(key)
    if saved is not None:
        return saved
    value = os.environ.get(env)
    return value if value else default


def flag(key: str) -> bool:
    return get(key).strip().lower() not in ("0", "false", "no", "off")


def vault() -> Path:
    return Path(get("obsidian_vault_path")).expanduser().resolve()


def memory_dir() -> Path:
    override = os.environ.get("DELAMAIN_MEMORY_DIR")
    return Path(override).expanduser() if override else vault() / "Delamain" / "Memory"


def public() -> dict:
    """Every setting with its current value, where it came from, and its choices."""
    saved = _load()
    out = {}
    for key, (env, default, label) in FIELDS.items():
        source = "settings" if key in saved else ("env" if os.environ.get(env) else "default")
        out[key] = {"value": get(key), "source": source, "label": label, "default": default,
                    "choices": list(CHOICES.get(key, ()))}
    return out


def _check(key: str, value: str) -> str:
    value = value.strip()
    if key in URL_FIELDS:
        u = urlparse(value)
        if u.scheme not in ("http", "https") or not u.netloc:
            raise ValueError(f"{FIELDS[key][2]}: enter a full http:// or https:// URL")
    elif key in CHOICES:
        value = value.lower()
        if value not in CHOICES[key]:
            raise ValueError(f"{FIELDS[key][2]}: choose one of {', '.join(c or '(none)' for c in CHOICES[key])}")
    elif key == "obsidian_vault_path":
        # Notes and memory are written inside this folder, so it must be a real vault:
        # an existing folder with Obsidian's .obsidian settings folder in it.
        p = Path(value).expanduser().resolve()
        if not p.is_dir():
            raise ValueError(f"Obsidian vault: {value} is not a folder on the server")
        if not (p / ".obsidian").is_dir():
            raise ValueError(f"Obsidian vault: {value} has no .obsidian folder; open it in Obsidian once first")
    elif key == "llm_model" and not value:
        raise ValueError("Model id: enter a model id")
    return value


def update(values: dict) -> dict:
    """Save the given settings. An empty string for a URL or path resets it to .env or the default."""
    global _saved
    with _lock:
        saved = dict(_load())
        for key, raw in values.items():
            if key not in FIELDS:
                raise ValueError(f"Unknown setting: {key}")
            raw = "" if raw is None else str(raw)
            if raw.strip() == "" and key not in CHOICES:
                saved.pop(key, None)
                continue
            saved[key] = _check(key, raw)
        tmp = SETTINGS_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(saved, indent=1))
        os.chmod(tmp, 0o600)
        tmp.replace(SETTINGS_PATH)
        _saved = saved
    return public()
