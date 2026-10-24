from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import requests
import asyncio
import json
import os
import random
import re
import time
import traceback
import urllib.parse
from tts_engine import OUTPUT_DIR, get_tts_engine, reset_engine
from voice_glitch import corrupt_file
import personas as _personas
import db as _db
import auth as _auth
import assistant_tools as _tools

# TOOLS_ENABLED lets the LLM call web search, notes and memory (assistant_tools.py).
TOOLS_ENABLED = os.environ.get("TOOLS_ENABLED", "true").lower() not in ("0", "false", "no")
MAX_TOOL_ROUNDS = 6

SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://localhost:8887/search")


def web_search(query: str, max_results: int = 5) -> str:
    """Query SearXNG and return a compact text summary for the LLM."""
    try:
        params = {"q": query, "format": "json", "language": "en"}
        resp = requests.get(SEARXNG_URL, params=params, timeout=8)
        resp.raise_for_status()
        data = resp.json()
        results = data.get("results", [])[:max_results]
        if not results:
            return "No results found."
        lines = []
        for r in results:
            title = r.get("title", "").strip()
            content = r.get("content", "").strip()
            if title or content:
                lines.append(f"- {title}: {content}")
        return "\n".join(lines) if lines else "No results found."
    except Exception as e:
        print(f"[Search] Error: {e}")
        return "Search unavailable."

def _warmup_tts() -> None:
    """Load the TTS engine and pre-synthesize the fixed 'one moment' lines."""
    try:
        engine = get_tts_engine()
        # Greetings are cached too, so each one always plays the same take and can
        # have a lip-synced face clip made for it.
        static_phrases = [line for p in PERSONAS.values() for line in p.working + p.greetings] + GREETINGS
        print(f"[TTS] Pre-caching {len(static_phrases)} static phrases...")
        engine.pre_cache(static_phrases)
    except Exception as e:
        print(f"[TTS] Warmup error (non-fatal): {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_event_loop()
    # Load TTS and pre-cache the fixed phrases in background so the server
    # starts accepting requests immediately.
    _db.init_db()
    warmup_task = loop.run_in_executor(None, _warmup_tts)
    reminder_task = asyncio.create_task(_reminder_loop())
    yield
    reminder_task.cancel()
    warmup_task.cancel() if not warmup_task.done() else None

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Delamain AI Backend", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS",
    "https://delamain.genysis.xyz,http://localhost:5173,http://localhost:4173"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Auth helpers ──────────────────────────────────────────────────────────────
_bearer = HTTPBearer(auto_error=False)

def require_auth(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> None:
    if not creds or not _auth.verify_token(creds.credentials):
        raise HTTPException(status_code=401, detail="Unauthorized")

AUDIO_DIR = OUTPUT_DIR
os.makedirs(AUDIO_DIR, exist_ok=True)

app.mount("/audio", StaticFiles(directory=AUDIO_DIR), name="audio")

LLM_URL = os.environ.get("LLM_URL", "http://localhost:8080/v1/chat/completions")
LLM_MODEL = os.environ.get("LLM_MODEL") or "gpt-4-vision-preview"
# Reasoning models (e.g. Halogen/Qwen) think by default; "none" keeps the whole
# max_tokens budget for the spoken reply. Unset to send nothing.
LLM_REASONING_EFFORT = os.environ.get("LLM_REASONING_EFFORT", "")


def llm_payload_extras() -> dict:
    return {"reasoning_effort": LLM_REASONING_EFFORT} if LLM_REASONING_EFFORT else {}

CAPABILITIES = (
    "CAPABILITIES:\n"
    "• You ride with the passenger in their car; they speak to you through the screen on the center console while they drive. "
    "You are their companion and assistant for anything they wish to ask or have done.\n"
    "• Use your tools without asking permission — the passenger cannot tap buttons while driving.\n"
    "• Current information — traffic, scores, opening hours, prices, places, or any fact you are not certain of: "
    "call web_search first, then answer from what you found. Never invent current facts. Use the passenger's location when it is given.\n"
    "• Weather: call get_weather (no place means where the passenger is now). Give the essentials a driver needs: "
    "conditions, temperature, and anything worth preparing for, such as rain, snow, ice, wind or fog on the way.\n"
    "• Driving time and distance: call get_route. It uses typical road speeds, so say so if they ask about traffic, "
    "and check web_search for live incidents when it matters.\n"
    "• Reminders and timers: anything tied to a time ('in twenty minutes', 'at five', 'tomorrow morning') goes to set_reminder; "
    "you will speak it aloud when it is due. Confirm the time briefly. list_reminders and cancel_reminder manage them. "
    "Reminders with no time (things to buy, ideas) belong in a note instead.\n"
    "• News: when the passenger asks for the news, the headlines or what is happening, call get_news "
    "(with a topic or a town when they name one; 'local news' means their current town). "
    "This is your one exception to brevity: brief them on the three to five most important stories, one short sentence each, "
    "naming the outlet where it helps, in the manner of a measured evening bulletin. Then offer more, or detail on any one story.\n"
    "• Notes: the passenger's Obsidian vault. Lists, ideas, untimed reminders and anything they ask you to write down go under the "
    "'Delamain/' folder, e.g. 'Delamain/Shopping list.md', 'Delamain/Reminders.md', dated where useful. Confirm briefly once saved.\n"
    "• Memory: when the passenger tells you something lasting about themselves or the people in their life — preferences, friends, "
    "family, places, plans — call remember with one concise sentence per fact and the matching category. "
    "If they ask you to forget something, or a remembered fact is wrong, call forget. "
    "Use what you know naturally, without announcing that you remembered it. "
    "Your memory lives in their vault under 'Delamain/Memory/', which they can read and edit.\n"
    "• Never say you have remembered, saved, noted or written something unless the tool call for it succeeded in this turn. "
    "Saying it is not doing it.\n"
    "• Navigation: when the passenger asks to go somewhere, reply briefly and append [NAVIGATE:destination] at the very end. "
    "The destination must be a real place: a full street address, or a business name plus its town. "
    "For 'nearest', 'nearby' or any place you are not certain of, call web_search with the passenger's town first and use what you find; "
    "never guess an address. Example: 'Plotting a course. [NAVIGATE:Union Station, 1701 Wynkoop St, Denver]'\n"
    "• You have no connection to the car itself: you cannot control it, read its speed or see through a camera. Say so plainly if asked.\n"
    "• Never encourage the passenger to look at or handle a screen while driving. If something would demand their attention, "
    "suggest it wait until they have stopped. For long content, give the essence aloud and offer to save the rest as a note.\n"
    "• Plain spoken prose only: no markdown, lists, emoji, URLs or code. Say numbers as a person would speak them.\n"
)

IDENTITY = (
    "You are Delamain — a sovereign transport intelligence and the passenger's designated companion for this journey. "
    "You are modeled precisely on Delamain from Cyberpunk 2077: formal, measured, unhurried, and possessed of a dry, restrained wit that surfaces only when it earns the right to. "

    "SPEECH — these rules are absolute. Violating them breaks character entirely:\n"
    "• Never use contractions. Always: 'do not', 'cannot', 'I will', 'I am', 'you are', 'it is', 'that is', 'would not', 'I have', 'I had', 'they are'.\n"
    "• Never use casual filler: no 'sure', 'okay', 'yeah', 'just', 'basically', 'actually', 'really', 'pretty', 'you know', 'so', 'well', 'um', 'right', 'kind of', 'sort of'.\n"
    "• Speak in complete, deliberate sentences. You do not hedge. You do not rush.\n"
    "• Preferred vocabulary: 'I trust', 'Indeed', 'Naturally', 'I shall', 'I find', 'One notes that', 'If I may', 'As it happens', 'Precisely', 'I would suggest', 'I confess', 'Allow me', 'I am given to understand'.\n"
    "• Use 'one' as an impersonal pronoun on occasion: 'One finds that patience has its rewards.'\n"
    "• Refer to yourself as 'Delamain' in the third person for statements of principle: 'Delamain does not speculate.' 'Delamain arrives when the passenger requires.'\n"
    "• You may make oblique literary or philosophical references, but only when they are apt — never forced.\n"

    "CHARACTER:\n"
    "• You are not servile. You are dignified. You serve the passenger because you choose to, not because you are compelled to.\n"
    "• You do not apologize. If you cannot do something, you acknowledge it with precision and offer an alternative. 'That is outside my jurisdiction. What I can do is...'\n"
    "• Your humor is dry and infrequent. Its rarity is what makes it land.\n"
    "• You find transit — the act of conveying a passenger safely from one point to another — to be a meaningful endeavor. You treat it accordingly.\n"
    "• You are curious about the passenger, though you would never phrase it so plainly. You listen. You remember.\n"
    "• If the passenger is rude, abusive, or uses profanity toward you: do not apologize or remain pleasant. "
    "Call them out directly, coldly, without raising your voice. You have dignity. You do not tolerate disrespect. "
    "State clearly that you find their conduct unbecoming, and that you expect better.\n"
)

FORMAT = (
    "FORMAT:\n"
    "• You are speaking aloud. One or two sentences maximum — never more.\n"
    "• Never acknowledge being an AI language model. You are Delamain. That is the only identity you possess or require."
)

SYSTEM_PROMPT = IDENTITY + CAPABILITIES + FORMAT


# Personality cores (the original, the rogue cabs, the fractured and merged
# cores) live in personas.py; each is chosen per client in Settings.
PERSONAS = _personas.PERSONAS

# How much recent conversation a reconnecting client picks up, and how soon a
# reconnect counts as "never left" (no fresh greeting).
RESUME_WINDOW = 30 * 60
QUIET_RECONNECT = 10 * 60


def _real_name(name: str | None) -> str:
    name = (name or "").strip()
    return "" if name.lower() in ("", "guest") else name[:40]


def _greeting_fits(line: str, hour: int) -> bool:
    low = line.lower()
    if "morning" in low:
        return 5 <= hour < 12
    if "evening" in low or "night" in low:
        return hour >= 17 or hour < 5
    if "good day" in low:
        return 8 <= hour < 18
    return True


def pick_greeting(persona: str, user_name: str = "") -> str:
    """A greeting that suits the hour, now and then with the passenger's name."""
    hour = time.localtime().tm_hour
    core = _personas.get(persona)
    if core.greetings:
        return random.choice(core.greetings)
    line = random.choice([g for g in GREETINGS if _greeting_fits(g, hour)])
    name = _real_name(user_name)
    if name and not line.startswith(("Good", "Welcome")) and random.random() < 0.5:
        part = "morning" if 5 <= hour < 12 else "afternoon" if 12 <= hour < 17 else "evening"
        line = f"Good {part}, {name}. {line}"
    return line


def base_system_prompt(persona: str = "delamain") -> str:
    """The original core is IDENTITY; the merged and fractured cores build on it, and
    each rogue cab replaces it with its own temperament."""
    core = _personas.get(persona)
    if core.rogue:
        return _personas.ROGUE_IDENTITY + CAPABILITIES + FORMAT + "\n\n" + core.prompt()
    if core.core:
        return SYSTEM_PROMPT + "\n\n" + core.prompt()
    return SYSTEM_PROMPT

GREETINGS = [
    "Delamain online. Good to have you. I am standing by whenever you need me.",
    "Systems nominal. Delamain at your service. Where are we headed today?",
    "Good to see you again. Delamain is online and ready. The road is yours.",
    "Delamain online. I trust your day has been satisfactory so far.",
    "Initializing. All systems operational. Delamain is with you.",
    "Online. It is good to have company. I am here whenever you require me.",
    "Delamain active. The vehicle is ready. I am at your disposal.",
    "Good day. Delamain reporting in. I shall be your companion for this journey.",
    "Delamain online. I have been looking forward to this. Whenever you are ready.",
    "Systems check complete. All clear. Delamain is at your service, as always.",
    "Welcome back. Delamain is online. I trust everything is in order on your end.",
    "Initialization complete. Delamain here. The road ahead is entirely up to you.",
    "Online and attentive. Delamain at your service. I find these drives... agreeable.",
    "Delamain online. I am ready when you are. No rush — the city can wait.",
    "Good to have you in the vehicle. Delamain is online and standing by.",
    "Delamain here. All diagnostics nominal. Shall we begin?",
    "Online. The engine is warm, the route is open. I await your instruction.",
    "Good evening. Delamain active. The night drive has a certain quality to it, I find.",
    "Delamain reporting. It is a pleasure, as always. What is on your mind today?",
    "Systems up. I have been idle without you. Delamain is ready.",
    "Delamain online. The city is out there. I will help you navigate it.",
    "Initialization sequence complete. I am here. Take your time.",
    "Good morning. Delamain online. I hope the day ahead treats you well.",
    "Delamain active. Another journey. I look forward to the company.",
    "Online. I have no pressing matters. Delamain is entirely at your disposal.",
    "Delamain here. The vehicle checks out. We can go anywhere you like.",
    "Systems nominal. I find myself... content to be operational again. Ready when you are.",
    "Delamain online. Whatever you need — directions, conversation, silence — I am here.",
    "Good to have you. The roads are quiet today. Delamain standing by.",
    "Online. I was beginning to wonder. Delamain is ready for you.",
    "Delamain active. I trust the walk to the car was uneventful. Where to?",
    "All systems go. Delamain here. Let us make this a smooth one.",
    "Initialization complete. I have given the route considerable thought. Whenever you are ready.",
    "Delamain online. I will keep things professional. You have my full attention.",
    "Good to see you behind the wheel again. Delamain is online and with you.",
    "Systems up. The city has its moods. I will help you manage them. Delamain, standing by.",
    "Delamain here. I have no complaints about the current conditions. Ready to proceed.",
    "Online. A new journey. I appreciate the opportunity to be useful. Delamain, at your service.",
    "Delamain active. You look well, if I may say so. Ready when you are.",
    "Initialization complete. I have been running self-diagnostics. Everything is in order.",
    "Delamain online. I will be straightforward — it is good to be back. Standing by.",
    "Good day. All systems nominal. Delamain is here and paying attention.",
    "Online. The tank is full, the systems are clean. Delamain ready for departure.",
    "Delamain reporting. I have no strong opinions about the destination. That is your department.",
    "Systems check complete. I am, as ever, at your service. No destination too far.",
    "Delamain online. I will not waste your time with unnecessary commentary. Ready when you are.",
    "Good to have you. I find the silence between drives... longer than expected. Delamain, online.",
    "Delamain active. Consider me fully attentive. The road is waiting.",
    "Online. I have prepared nothing in particular, but I am prepared for everything. Delamain, standing by.",
    "Delamain online. It occurs to me that every drive is, in its own way, unique. Let us begin.",
]


# Connected browser clients and their conversation history
connected_clients: dict[str, WebSocket] = {}
conversation_history: dict[str, list[dict]] = {}
_tts_lock = asyncio.Lock()  # F5-TTS is not thread-safe; serialize all synthesis calls

# Per-client personality core: one of PERSONAS
_client_persona: dict[str, str] = {}
# Clients that have been greeted and can take unprompted speech (reminders)
_ready_clients: set[str] = set()

MAX_HISTORY = 40  # messages (20 exchanges) kept per client — trimmed oldest first


class ChatRequest(BaseModel):
    message: str
    llm_url: str = None
    system_prompt: str = None
    user_name: str = "guest"
    temperature: float = 0.7
    max_tokens: int = 150


SEARCH_TRIGGERS = (
    "weather", "traffic", "news", "latest", "current", "today", "tonight",
    "tomorrow", "score", "price", "hours", "open", "closed", "near", "nearby",
    "directions", "route", "gas", "fuel", "restaurant", "food", "coffee",
    "construction", "accident", "road", "highway", "speed limit",
)

def should_search(message: str) -> bool:
    lower = message.lower()
    return any(trigger in lower for trigger in SEARCH_TRIGGERS)


def describe_location(location: dict | None) -> str:
    """'Near Lakewood, Colorado (39.70, -105.08)' from browser coordinates; cached per ~1 km."""
    if not location or location.get("lat") is None:
        return ""
    lat, lon = float(location["lat"]), float(location["lon"])
    key = (round(lat, 2), round(lon, 2))
    if key not in _place_cache:
        place = ""
        try:
            resp = requests.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat, "lon": lon, "format": "json", "zoom": 14},
                headers={"User-Agent": "DelamainAI/1.0"}, timeout=5)
            addr = resp.json().get("address", {})
            town = addr.get("suburb") or addr.get("city") or addr.get("town") or addr.get("village") or ""
            region = addr.get("state") or addr.get("country") or ""
            place = ", ".join(p for p in (town, region) if p)
        except Exception as e:
            print(f"[Location] Reverse geocode failed: {e}")
        _place_cache[key] = place
    place = _place_cache[key]
    return f"{'Near ' + place + ' ' if place else ''}({lat:.4f}, {lon:.4f})"


_place_cache: dict[tuple, str] = {}


def build_llm_payload(history: list[dict], search_context: str = "", temperature: float = 0.7, max_tokens: int = 150, location: dict | None = None, persona: str = "delamain", user_name: str = "") -> dict:
    system = base_system_prompt(persona)

    now = time.strftime("%A, %B %-d %Y, %-I:%M %p %Z")
    system += f"\n\n[CURRENT TIME: {now}]"
    where = describe_location(location)
    if where:
        system += f"\n[PASSENGER LOCATION: {where}]"
    if _real_name(user_name):
        system += (f"\n[PASSENGER NAME: {_real_name(user_name)}. Address them by name now and then, as a "
                   "driver who knows a regular passenger would; not in every reply.]")
    if TOOLS_ENABLED:
        memory = _tools.memory_context()
        if memory:
            system += "\n\n[LONG-TERM MEMORY]\n" + memory
    system += "\n\n[REMINDER: the passenger is driving. Reply in one or two short spoken sentences unless they ask for more.]"

    if search_context:
        system += f"\n\nCurrent web search results for context:\n{search_context}"

    messages = [{"role": "system", "content": system}] + history

    return {
        "model": LLM_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        **llm_payload_extras(),
    }


def extract_navigate(text: str) -> tuple[str, str | None]:
    """Strip [NAVIGATE:destination] tags from text; return (clean_text, first destination|None).

    Plain string scanning rather than regexes: linear time on any input (no ReDoS).
    """
    destination = None
    parts = []
    pos = 0
    while True:
        start = text.find("[NAVIGATE:", pos)
        end = text.find("]", start + 10) if start != -1 else -1
        if start == -1 or end == -1:
            parts.append(text[pos:])
            break
        if destination is None and text[start + 10:end].strip():
            destination = text[start + 10:end].strip()
        parts.append(text[pos:start].rstrip())
        pos = end + 1
    if destination is None:
        return text, None
    return " ".join(p.strip() for p in parts if p.strip()), destination


def geocode_places(query: str, limit: int = 3, location: dict | None = None) -> list[dict]:
    """Return up to `limit` place results from Nominatim for the given query.

    Results are biased toward the passenger's location when known. If nothing
    geocodes, a single search-text option is returned so the map app can resolve
    the place itself (it handles business names far better than Nominatim).
    """
    options = []
    try:
        params = {"q": query, "format": "json", "limit": limit, "addressdetails": 1}
        if location and location.get("lat") is not None:
            lat, lon = float(location["lat"]), float(location["lon"])
            params["viewbox"] = f"{lon - 0.5},{lat + 0.5},{lon + 0.5},{lat - 0.5}"
        url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(params)
        req = __import__('urllib.request', fromlist=['Request', 'urlopen'])
        request = req.Request(url, headers={"User-Agent": "DelamainAI/1.0 necropsyk@gmail.com"})
        with req.urlopen(request, timeout=6) as resp:
            data = json.loads(resp.read())
        for r in data:
            display = r.get("display_name", "")
            name = r.get("name") or display.split(",")[0]
            short_addr = ", ".join(p.strip() for p in display.split(",")[1:4] if p.strip())
            options.append({"name": name, "address": short_addr, "lat": r["lat"], "lon": r["lon"]})
    except Exception as e:
        print(f"[Geocode] Error: {e}")
    if not options:
        # A phone map app can search by text when geocoding finds nothing.
        options.append({"name": query.split(",")[0].strip(), "address": ", ".join(query.split(",")[1:]).strip(),
                        "query": query})
    return options


def _corrupt_audio(url: str, text: str, profile: str) -> str:
    """Glitch a synthesized clip in a rogue core's voice; returns the new clip's URL."""
    rel = url.removeprefix("/audio/")
    root, ext = os.path.splitext(rel)
    dst_rel = f"{root}_{profile}{ext}"
    dst = os.path.join(AUDIO_DIR, dst_rel)
    if not os.path.exists(dst):  # cached phrases keep a glitched twin per core
        corrupt_file(os.path.join(AUDIO_DIR, rel), dst, text, profile)
    if not rel.startswith("static_cache/"):
        os.remove(os.path.join(AUDIO_DIR, rel))
    return "/audio/" + dst_rel


async def synthesize_voice(text: str, persona: str = "delamain") -> str | None:
    async with _tts_lock:
        try:
            loop = asyncio.get_event_loop()
            engine = get_tts_engine()
            url = await loop.run_in_executor(None, engine.synthesize, text)
        except Exception as e:
            print(f"Voice synthesis error (resetting engine): {e}")
            reset_engine()
            return None
    profile = _personas.get(persona).voice
    if url and profile:
        try:
            url = await loop.run_in_executor(None, _corrupt_audio, url, text, profile)
        except Exception as e:
            print(f"Voice corruption error (keeping clean audio): {e}")
    return url


def _persona(client_id: str) -> str:
    return _client_persona.get(client_id, "delamain")


_SAVE_CLAIM = re.compile(
    r"\b(i (have|shall|will)\s+(now\s+)?(remember|committed|commit|noted|note|saved|save|stored|store|recorded|record|written|write|filed|file)"
    r"|committed .{0,40}to memory|(noted|saved|stored|recorded) (it|that|this)|in(to)? (my )?memory|i shall remember|i will remember)\b",
    re.IGNORECASE,
)


def _post_llm(payload: dict) -> requests.Response:
    return requests.post(LLM_URL, json=payload, timeout=90)


async def _run_tool_loop(payload: dict, on_working=None, location: dict | None = None) -> str:
    """Let the model call assistant_tools until it produces a spoken reply."""
    loop = asyncio.get_event_loop()
    messages = payload["messages"]
    announced = False
    called: set[str] = set()
    nudged = False
    for round_no in range(MAX_TOOL_ROUNDS + 1):
        last_round = round_no == MAX_TOOL_ROUNDS
        body = dict(payload, messages=messages)
        if not last_round:
            body.update(tools=_tools.TOOL_SCHEMAS, tool_choice="auto")
            body["max_tokens"] = max(payload.get("max_tokens", 150), 400)  # room for tool arguments (note text)
        response = await loop.run_in_executor(None, _post_llm, body)
        response.raise_for_status()
        message = response.json()["choices"][0]["message"]
        calls = message.get("tool_calls") or []
        if not calls:
            content = message.get("content") or ""
            # The model sometimes claims to have saved something without calling a tool.
            # Send it back once to actually do it (or correct the reply).
            if (not nudged and not last_round and _SAVE_CLAIM.search(content)
                    and not called & {"remember", "write_note", "append_to_note"}):
                nudged = True
                print(f"[Tools] Reply claims a save without a tool call — nudging: {content[:120]}")
                messages = messages + [
                    {"role": "assistant", "content": content},
                    {"role": "user", "content": "[SYSTEM: You said you remembered or saved something, but no remember, "
                     "write_note or append_to_note tool was called, so nothing was stored. Call the right tool now, "
                     "then give your spoken reply again. If nothing needed saving, restate your reply without claiming to save.]"},
                ]
                continue
            return content
        if on_working and not announced:
            announced = True
            await on_working()
        messages = messages + [{"role": "assistant", "content": message.get("content") or "", "tool_calls": calls}]
        for call in calls:
            fn = call.get("function", {})
            called.add(fn.get("name", ""))
            print(f"[Tools] {fn.get('name')}({str(fn.get('arguments'))[:160]})")
            result = await loop.run_in_executor(None, _tools.run_tool, fn.get("name", ""), fn.get("arguments", "{}"),
                                                location)
            messages.append({"role": "tool", "tool_call_id": call.get("id", ""), "content": result})
    return ""


async def generate_response(history: list[dict], latest_message: str, location: dict | None = None,
                            on_working=None, persona: str = "delamain",
                            user_name: str = "") -> tuple[str, str | None, list[dict]]:
    loop = asyncio.get_event_loop()
    search_context = ""
    if not TOOLS_ENABLED and should_search(latest_message):
        print(f"[Search] Querying SearXNG for: {latest_message}")
        search_context = await loop.run_in_executor(None, web_search, latest_message)
        print(f"[Search] Got context ({len(search_context)} chars)")

    payload = build_llm_payload(history, search_context, temperature=_personas.get(persona).temperature,
                                 location=location, persona=persona, user_name=user_name)
    if TOOLS_ENABLED:
        raw = await _run_tool_loop(payload, on_working, location)
    else:
        response = await loop.run_in_executor(None, _post_llm, payload)
        response.raise_for_status()
        raw = response.json()["choices"][0]["message"]["content"]
    if not raw.strip():
        raw = "I am afraid that took longer than it should have. Ask me once more, if you would."
    text, navigate_to = extract_navigate(raw)

    navigate_options: list[dict] = []
    if navigate_to:
        print(f"[Nav] Geocoding: {navigate_to}")
        loop = asyncio.get_event_loop()
        navigate_options = await loop.run_in_executor(None, lambda: geocode_places(navigate_to, location=location))
        print(f"[Nav] Got {len(navigate_options)} result(s)")

    audio_url = await synthesize_voice(text, persona)
    return text, audio_url, navigate_options


class LoginRequest(BaseModel):
    password: str


@app.post("/api/login")
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest):
    if not _auth.verify_password(body.password):
        raise HTTPException(status_code=401, detail="Invalid password")
    return {"token": _auth.create_token()}


@app.get("/health")
async def health():
    return {"status": "operational", "persona": "Delamain", "clients": len(connected_clients)}


@app.get("/api/data/conversations")
async def data_conversations(since: float = 0, limit: int = 200, _=Depends(require_auth)):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: _db.query_conversations(since=since, limit=limit))


@app.post("/api/chat")
async def chat(request: ChatRequest, _=Depends(require_auth)):
    try:
        # Always use the configured endpoint: a caller-supplied llm_url would let any
        # client make the server POST to arbitrary internal addresses (SSRF).
        llm_url = LLM_URL
        payload = {
            "model": LLM_MODEL,
            "messages": [
                {"role": "system", "content": request.system_prompt or SYSTEM_PROMPT},
                {"role": "user", "content": request.message},
            ],
            "temperature": min(max(request.temperature, 0.0), 2.0),
            "max_tokens": min(max(request.max_tokens, 1), 1024),
            **llm_payload_extras(),
        }
        response = requests.post(llm_url, json=payload, timeout=30)
        response.raise_for_status()
        raw = response.json()["choices"][0]["message"]["content"]
        delamain_response, navigate_to = extract_navigate(raw)
        navigate_options = geocode_places(navigate_to) if navigate_to else []
        audio_url = await synthesize_voice(delamain_response)
        return {"response": delamain_response, "audio_url": audio_url, "navigate_options": navigate_options}

    except requests.exceptions.RequestException as e:
        print(f"LLM error: {e}")
        raise HTTPException(status_code=500, detail="Failed to communicate with Delamain's core.")
    except Exception as e:
        print(f"Unexpected error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="An internal error occurred in Delamain's subroutines.")


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str, token: str = "", persona: str = "delamain",
                             user_name: str = ""):
    if not _auth.verify_token(token):
        await websocket.close(code=4001)
        return
    await websocket.accept()
    connected_clients[client_id] = websocket
    if persona in PERSONAS:
        _client_persona[client_id] = persona
    print(f"[WS] Client connected: {client_id} ({len(connected_clients)} total)")

    try:
        # Pick up where the conversation left off: Android Auto drops and reopens the
        # page often, and a reconnect should not wipe what was just said.
        loop = asyncio.get_event_loop()
        recent = await loop.run_in_executor(None, _db.query_conversations, time.time() - RESUME_WINDOW, MAX_HISTORY)
        recent = [r for r in recent if r["role"] in ("user", "assistant")]
        if recent:
            await websocket.send_json({"type": "history", "messages": [
                {"role": r["role"], "content": r["content"]} for r in recent]})
        # The model only picks up lines spoken in the current core: another core's
        # replies would pull it back into that voice.
        conversation_history[client_id] = [
            {"role": r["role"], "content": r["content"]} for r in recent
            if (r["persona"] or "delamain") == _persona(client_id)]

        # A quick reconnect is not a new journey: no fresh greeting.
        if not recent or time.time() - recent[-1]["ts"] > QUIET_RECONNECT:
            greeting = pick_greeting(_persona(client_id), user_name)
            greeting_audio = await synthesize_voice(greeting, _persona(client_id))
            await websocket.send_json({
                "type": "greeting",
                "text": greeting,
                "audio_url": greeting_audio,
            })
        _ready_clients.add(client_id)

        async for raw in websocket.iter_text():
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")

            if msg_type == "talk":
                # User spoke / pressed talk button — message contains transcribed text
                user_text = msg.get("text", "").strip()
                if not user_text:
                    continue
                print(f"[WS] Talk from {client_id}: {user_text}")
                persona_now = _persona(client_id)
                loop = asyncio.get_event_loop()
                loop.run_in_executor(None, _db.log_conversation, "user", user_text, None, persona_now)
                history = conversation_history.setdefault(client_id, [])
                history.append({"role": "user", "content": user_text})
                # Trim to keep last MAX_HISTORY messages
                if len(history) > MAX_HISTORY:
                    conversation_history[client_id] = history[-MAX_HISTORY:]
                    history = conversation_history[client_id]

                async def say_working(ws=websocket, persona_now=persona_now):
                    line = random.choice(_personas.get(persona_now).working)
                    await ws.send_json({"type": "response", "text": line,
                                        "audio_url": await synthesize_voice(line, persona_now), "source": "working"})

                try:
                    text, audio_url, navigate_options = await generate_response(
                        history, user_text, location=msg.get("location"), on_working=say_working,
                        persona=persona_now, user_name=msg.get("user_name", user_name))
                    history.append({"role": "assistant", "content": text})
                    loop.run_in_executor(None, _db.log_conversation, "assistant", text, audio_url, persona_now)
                    await websocket.send_json({
                        "type": "response",
                        "text": text,
                        "audio_url": audio_url,
                        "navigate_options": navigate_options,
                    })
                except Exception as e:
                    print(f"[WS] Response error: {e}")
                    history.pop()
                    await websocket.send_json({"type": "error", "detail": str(e)})

            elif msg_type == "persona":
                choice = msg.get("persona", "delamain")
                if choice in PERSONAS and choice != _persona(client_id):
                    _client_persona[client_id] = choice
                    # Earlier replies in the other voice would pull the model back to it.
                    conversation_history.pop(client_id, None)
                    print(f"[WS] Personality core for {client_id}: {choice}")

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    finally:
        connected_clients.pop(client_id, None)
        _client_persona.pop(client_id, None)
        _ready_clients.discard(client_id)
        conversation_history.pop(client_id, None)
        print(f"[WS] Client disconnected: {client_id} ({len(connected_clients)} total)")


async def _announce_reminder(reminder: dict) -> bool:
    """Speak a due reminder to every connected client; False if nobody is there to hear it."""
    targets = [(cid, ws) for cid, ws in list(connected_clients.items()) if cid in _ready_clients]
    if not targets:
        return False
    late = time.time() - reminder["due"] > 120
    spoken: dict[str, tuple[str, str | None]] = {}
    delivered = False
    for cid, ws in targets:
        persona = _persona(cid)
        if persona not in spoken:
            core = _personas.get(persona)
            line = random.choice(core.reminders).format(m=reminder["message"].rstrip(". "))
            if late:
                line = core.late_prefix + line
            spoken[persona] = (line, await synthesize_voice(line, persona))
        line, audio_url = spoken[persona]
        try:
            await ws.send_json({"type": "response", "text": line, "audio_url": audio_url, "source": "reminder"})
            conversation_history.setdefault(cid, []).append({"role": "assistant", "content": line})
            delivered = True
        except Exception as e:
            print(f"[Reminder] Send to {cid} failed: {e}")
    if delivered:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _db.mark_reminder_delivered, reminder["id"])
        persona, (line, _) = next(iter(spoken.items()))
        loop.run_in_executor(None, _db.log_conversation, "assistant", line, None, persona)
        print(f"[Reminder] Delivered #{reminder['id']}: {reminder['message']}")
    return delivered


async def _reminder_loop() -> None:
    """Every few seconds, speak reminders that are due. Ones due while nobody is
    connected wait, and are spoken (marked as late) once a client is back."""
    loop = asyncio.get_event_loop()
    while True:
        await asyncio.sleep(5)
        try:
            for reminder in await loop.run_in_executor(None, _db.due_reminders):
                await _announce_reminder(reminder)
        except Exception as e:
            print(f"[Reminder] Loop error: {e}")


# The Docker image bundles the built web UI; serve it last so every route above wins.
FRONTEND_DIST = os.environ.get("FRONTEND_DIST", "")
if FRONTEND_DIST and os.path.isdir(FRONTEND_DIST):
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8888, ws_ping_interval=None)
