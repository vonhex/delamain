"""Settings that can be changed from the web UI and are saved on the server.

Each value comes from settings.json (written by the Settings panel) when it is set
there, otherwise from the environment (.env), otherwise the built-in default, so a
fresh install works without a .env and an existing .env keeps working.
"""
import json
import os
import re
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
    "llm_api_key": ("LLM_API_KEY", "", "API key (sent as a Bearer token; leave empty for local servers)"),
    "llm_reasoning_effort": ("LLM_REASONING_EFFORT", "", "Reasoning effort (reasoning models only)"),
    "llm_model_file": ("LLM_MODEL_FILE", "", "Language model file (optional: a GGUF or .hgn on this computer, so the brain view can show its real layers)"),
    "tools_enabled": ("TOOLS_ENABLED", "true", "Tools: web search, news, weather, routes, notes, memory"),
    "searxng_url": ("SEARXNG_URL", "http://localhost:8887/search", "SearXNG search URL"),
    "obsidian_vault_path": ("OBSIDIAN_VAULT_PATH", "~/Documents/obsidian vault", "Obsidian vault folder"),
    "news_rss_url": ("NEWS_RSS_URL", "https://news.google.com/rss", "News RSS base URL"),
    "osrm_url": ("OSRM_URL", "https://router.project-osrm.org", "OSRM routing server"),
    "units": ("DELAMAIN_UNITS", "imperial", "Units"),
    "home_address": ("DELAMAIN_HOME_ADDRESS", "", "Home address"),
    "insult_song_url": ("DELAMAIN_INSULT_SONG", "https://www.youtube.com/watch?v=BsGD5TprqNA", "Insult comeback song (YouTube link)"),
    "insult_song_start": ("DELAMAIN_INSULT_SONG_START", "0", "Song: start at (seconds)"),
    "insult_song_seconds": ("DELAMAIN_INSULT_SONG_SECONDS", "0", "Song: play for (seconds, 0 = to the end)"),
    "insult_song_chance": ("DELAMAIN_INSULT_SONG_CHANCE", "0.33", "Song: how often an insult gets it"),
    "meeting_whisper_model": ("MEETING_WHISPER_MODEL", "large-v3-turbo", "Transcription model (faster-whisper; runs on the CPU)"),
    "meeting_language": ("MEETING_LANGUAGE", "", "Meeting language (e.g. en; empty = detect it)"),
    "meeting_keep_audio": ("MEETING_KEEP_AUDIO", "false", "Keep the recording after the notes are written"),
    # Extras that cost model time. Each can be turned off, for a small or slow model.
    "sleep_hours": ("DELAMAIN_SLEEP", "23:30-07:00", "Bedtime: when he sleeps (e.g. 23:30-07:00, or off)"),
    "feature_verify": ("DELAMAIN_VERIFY", "true", "Check each reply before speaking"),
    "feature_feelings": ("DELAMAIN_FEELINGS", "true", "Feelings and inner life"),
    "feature_recall": ("DELAMAIN_RECALL", "true", "Recall by meaning (a small embedding model on the CPU)"),
    "feature_self_tools": ("DELAMAIN_SELF_TOOLS", "true", "Tools for his own mind (rules, skills, tasks, notes on himself)"),
    "feature_vision": ("DELAMAIN_VISION", "true", "Look at pictures in his free time (needs a model that reads images)"),
    "feature_garden": ("DELAMAIN_GARDEN", "true", "Delamain's garden (real plants, tended in his free time)"),
    "garden_visitor_voice": ("DELAMAIN_VISITOR_VOICE", "local",
                             "Who speaks for garden visitors: his own model, or Gemini through the agy CLI"),
    "feature_news": ("DELAMAIN_NEWS_READING", "true", "Read the news through the day"),
    "feature_study": ("DELAMAIN_STUDY", "true", "Study in his free time, and work on long tasks"),
    "feature_twin": ("DELAMAIN_TWIN", "true", "Evening therapy with the other Delamain"),
    "feature_journal": ("DELAMAIN_JOURNAL", "true", "Nightly journal"),
    "feature_brief": ("DELAMAIN_BRIEF", "true", "Morning brief"),
    "feature_reach": ("DELAMAIN_REACH_OUT", "true", "Reach out first: a few times a day he tells you something that matters"),
    "feature_language": ("DELAMAIN_LANGUAGE", "true", "His own language: a small language he invents and grows as a hobby"),
    "feature_self_review": ("DELAMAIN_SELF_REVIEW", "true", "Nightly self-review and code proposals"),
    "google_client_id": ("GOOGLE_CLIENT_ID", "", "Google OAuth client ID (from Google Cloud; see the guide)"),
    "google_client_secret": ("GOOGLE_CLIENT_SECRET", "", "Google OAuth client secret"),
}
URL_FIELDS = {"llm_url", "searxng_url", "news_rss_url", "osrm_url", "insult_song_url"}
CHOICES = {
    "llm_reasoning_effort": ("", "none", "low", "medium", "high"),
    "tools_enabled": ("true", "false"),
    "units": ("imperial", "metric"),
    "insult_song_chance": ("0", "0.25", "0.33", "0.5", "1"),
    "meeting_whisper_model": ("large-v3-turbo", "distil-large-v3", "medium", "small", "base"),
    "meeting_keep_audio": ("false", "true"),
    "garden_visitor_voice": ("local", "gemini"),
}
FEATURES = [k for k in FIELDS if k.startswith("feature_")]
CHOICES.update({k: ("true", "false") for k in FEATURES})
NUMBER_FIELDS = {"insult_song_start": (0, 36000), "insult_song_seconds": (0, 36000)}
# Never sent back to the browser: the Settings panel only learns whether one is set.
SECRET_FIELDS = {"llm_api_key", "google_client_secret"}

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


def youtube_id(url: str) -> str | None:
    """The video id of a youtube.com/watch?v=, youtu.be/ or /shorts/ link."""
    m = re.match(r"^https?://(?:www\.|m\.|music\.)?(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/)|youtu\.be/)"
                 r"([A-Za-z0-9_-]{11})", url.strip())
    return m.group(1) if m else None


_HOME = re.compile(r"^\s*(?:my\s+|the\s+passenger'?s\s+)?(?:home|house|place|home address)\s*$", re.IGNORECASE)


def place(text: str) -> str:
    """'Home' (or 'my house') as the saved home address; any other place unchanged."""
    home = get("home_address").strip()
    return home if home and _HOME.match(text or "") else text


def vault_roots() -> list[str]:
    """Folders a vault set from the web UI must be inside: notes are read and written there,
    so a signed-in browser must not be able to point it anywhere on the server.
    DELAMAIN_VAULT_ROOTS (separated by os.pathsep) replaces the default: the home folder,
    /vault (the container's mount) and the folder holding OBSIDIAN_VAULT_PATH from .env."""
    listed = os.environ.get("DELAMAIN_VAULT_ROOTS")
    if listed:
        roots = listed.split(os.pathsep)
    else:
        roots = [str(Path.home()), "/vault"]
        env_vault = os.environ.get("OBSIDIAN_VAULT_PATH")
        if env_vault:
            roots.append(os.path.dirname(os.path.realpath(os.path.expanduser(env_vault))))
    return [os.path.realpath(os.path.expanduser(r)) for r in roots if r.strip()]


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
        if key in SECRET_FIELDS:
            out[key].update(value="", secret=True, is_set=bool(get(key)))
    return out


def llm_headers() -> dict:
    """Headers for every request to the LLM endpoint: the API key, when one is set."""
    key = get("llm_api_key").strip()
    return {"Authorization": f"Bearer {key}"} if key else {}


def _check(key: str, value: str) -> str:
    value = value.strip()
    if key == "sleep_hours":
        if not re.fullmatch(r"(?i)off|([01]?\d|2[0-3]):[0-5]\d\s*-\s*([01]?\d|2[0-3]):[0-5]\d", value):
            raise ValueError("Bedtime: write it as 23:30-07:00, or off")
        return value.lower() if value.lower() == "off" else re.sub(r"\s+", "", value)
    if key in URL_FIELDS:
        u = urlparse(value)
        if u.scheme not in ("http", "https") or not u.netloc:
            raise ValueError(f"{FIELDS[key][2]}: enter a full http:// or https:// URL")
        if key == "insult_song_url" and not youtube_id(value):
            raise ValueError(f"{FIELDS[key][2]}: enter a YouTube video link")
    elif key in CHOICES:
        value = value.lower()
        if value not in CHOICES[key]:
            raise ValueError(f"{FIELDS[key][2]}: choose one of {', '.join(c or '(none)' for c in CHOICES[key])}")
    elif key == "obsidian_vault_path":
        # Notes and memory are written inside this folder, so it must be a real vault:
        # an existing folder with Obsidian's .obsidian settings folder in it.
        real = os.path.realpath(os.path.expanduser(value))
        roots = vault_roots()
        root = next((r for r in roots if real == r or real.startswith(r.rstrip(os.sep) + os.sep)), None)
        if root is None or not real.startswith(root):
            raise ValueError(f"Obsidian vault: choose a folder inside {', '.join(roots)} "
                             "(DELAMAIN_VAULT_ROOTS on the server sets these)")
        p = Path(real)
        if not p.is_dir():
            raise ValueError(f"Obsidian vault: {value} is not a folder on the server")
        if not (p / ".obsidian").is_dir():
            raise ValueError(f"Obsidian vault: {value} has no .obsidian folder; open it in Obsidian once first")
    elif key in NUMBER_FIELDS:
        lo, hi = NUMBER_FIELDS[key]
        try:
            n = float(value)
        except ValueError:
            raise ValueError(f"{FIELDS[key][2]}: enter a number of seconds")
        if not lo <= n <= hi:
            raise ValueError(f"{FIELDS[key][2]}: between {lo} and {hi}")
        value = f"{n:g}"
    elif key == "home_address" and len(value) > 200:
        raise ValueError("Home address: keep it under 200 characters")
    elif key == "llm_model" and not value:
        raise ValueError("Model id: enter a model id")
    elif key == "llm_api_key":
        # It goes into an HTTP header: no spaces or line breaks (which could add headers of their own).
        if len(value) > 512 or not re.fullmatch(r"[\x21-\x7e]+", value):
            raise ValueError("API key: paste the key alone, with no spaces or line breaks")
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
