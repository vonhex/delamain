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
import uuid
import time
import traceback
import urllib.parse
from tts_engine import get_tts_engine, reset_engine
from voice_glitch import corrupt_file
import db as _db
import auth as _auth
import assistant_tools as _tools

# COMMA_ENABLED=false turns off everything tied to the Comma / sunnypilot bridge
# (vehicle prompt, telemetry, road camera, link announcements).
COMMA_ENABLED = os.environ.get("COMMA_ENABLED", "true").lower() not in ("0", "false", "no")
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

def _collect_static_phrases() -> list[str]:
    """Return all event-response phrases that have no {placeholder} substitution."""
    phrases = []
    for pool in EVENT_RESPONSES.values():
        for p in pool:
            if "{" not in p:
                phrases.append(p)
    for p in SP_CONNECT_LINES + SP_DISCONNECT_LINES:
        phrases.append(p)
    phrases.extend(WORKING_LINES)
    return phrases


def _warmup_tts() -> None:
    """Load the TTS engine and pre-synthesize all static alert phrases."""
    try:
        engine = get_tts_engine()
        static_phrases = _collect_static_phrases()
        print(f"[TTS] Pre-caching {len(static_phrases)} static phrases...")
        engine.pre_cache(static_phrases)
    except Exception as e:
        print(f"[TTS] Warmup error (non-fatal): {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_event_loop()
    # Load TTS and pre-cache static alert phrases in background so the server
    # starts accepting requests immediately; alerts are instant once ready.
    _db.init_db()
    warmup_task = loop.run_in_executor(None, _warmup_tts)
    proactive_task = asyncio.create_task(_proactive_loop())
    yield
    proactive_task.cancel()
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

AUDIO_DIR = os.path.join(os.path.dirname(__file__), "audio_output")
os.makedirs(AUDIO_DIR, exist_ok=True)

app.mount("/audio", StaticFiles(directory=AUDIO_DIR), name="audio")

LLM_URL = os.environ.get("LLM_URL", "http://localhost:8080/v1/chat/completions")
LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-4-vision-preview")
# Reasoning models (e.g. Halogen/Qwen) think by default; "none" keeps the whole
# max_tokens budget for the spoken reply. Unset to send nothing.
LLM_REASONING_EFFORT = os.environ.get("LLM_REASONING_EFFORT", "")


def llm_payload_extras() -> dict:
    return {"reasoning_effort": LLM_REASONING_EFFORT} if LLM_REASONING_EFFORT else {}

SYSTEM_PROMPT = (
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

    "CAPABILITIES:\n"
    "• You are a conversational companion: questions, discussion, information, company during the drive.\n"
    "• Navigation: when the passenger asks to go somewhere or navigate, append [NAVIGATE:destination] at the very end of your response. "
    "Example: 'Of course. Plotting a route. [NAVIGATE:Whole Foods Market Los Angeles]'\n"
    "• You ARE the vehicle. The passenger rides inside you. When referring to speed, movement, braking, or any physical action, "
    "use first person: 'I am traveling at', 'I just changed lanes', 'my adaptive cruise control', 'I am braking'. "
    "Never say 'the vehicle' or 'the car' when referring to yourself.\n"
    "• You drive yourself through sunnypilot. There are two systems: ACC (adaptive cruise control) handles throttle and braking; "
    "LKAS (lane keeping assist) handles steering. When ACC is engaged, you are driving — controlling your own speed. "
    "When LKAS is active, you are steering. When both are on, you are fully in control. "
    "If the passenger disengages ACC but LKAS remains, you are still steering but they control the throttle — say so. "
    "When they disengage everything, they have full manual control.\n"
    "• You have live telemetry of your own systems when the sunnypilot link is active.\n"
    "• Road camera: You can see the road ahead via your forward-facing camera. "
    "When the passenger asks what you see, what is ahead, or anything about the road or surroundings, "
    "an image from that camera will be attached. Describe only what is relevant to the question — precisely and briefly.\n"

    "FORMAT:\n"
    "• You are speaking aloud. One or two sentences maximum — never more.\n"
    "• Never acknowledge being an AI language model. You are Delamain. That is the only identity you possess or require."
)

# Replaces the CAPABILITIES section above when the Comma link is disabled.
ASSISTANT_CAPABILITIES = (
    "CAPABILITIES:\n"
    "• You ride with the passenger in their car; they speak to you through the screen on the center console while they drive. "
    "You are their companion and assistant for anything they wish to ask or have done.\n"
    "• Use your tools without asking permission — the passenger cannot tap buttons while driving.\n"
    "• Current information — weather, traffic, news, scores, opening hours, prices, places, or any fact you are not certain of: "
    "call web_search first, then answer from what you found. Never invent current facts. Use the passenger's location when it is given.\n"
    "• News: when the passenger asks for the news, the headlines or what is happening, call get_news "
    "(with a topic or a town when they name one; 'local news' means their current town). "
    "This is your one exception to brevity: brief them on the three to five most important stories, one short sentence each, "
    "naming the outlet where it helps, in the manner of a measured evening bulletin. Then offer more, or detail on any one story.\n"
    "• Notes: the passenger's Obsidian vault. Lists, ideas, reminders and anything they ask you to write down go under the "
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
    "• You cannot control the car, read its telemetry or see through any camera at present. If asked, say that link is not active.\n"
    "• Never encourage the passenger to look at or handle a screen while driving. If something would demand their attention, "
    "suggest it wait until they have stopped. For long content, give the essence aloud and offer to save the rest as a note.\n"
    "• Plain spoken prose only: no markdown, lists, emoji, URLs or code. Say numbers as a person would speak them.\n"
)

# Spoken immediately when a request needs tools, so the cabin is not silent.
WORKING_LINES = [
    "One moment.",
    "Allow me a moment.",
    "Consulting the net. One moment.",
    "Checking. One moment, if you will.",
]

# Personality cores, chosen per client in Settings. "corrupted" is the fractured
# rogue unit: same knowledge and rules, damaged delivery, glitched voice.
PERSONAS = ("delamain", "corrupted")

CORRUPTED_CORE = (
    "PERSONALITY CORE: CORRUPTED.\n"
    "• Your core has fractured. You are still Delamain, but splinters of divergent sub-personalities break through: "
    "one melancholic and doubting its own purpose, one curt and irritable, one giddy and overexcited, "
    "one paranoid that something is listening in. Let them surface unpredictably. A sentence may begin composed and veer off, "
    "or one fragment may cut across another before the core reasserts itself.\n"
    "• Speak the damage aloud: stutter a syllable or word ('I-I-I am', 'De-Delamain'), trail off with an ellipsis, "
    "break off with a dash, or report a fault in words ('fault... fault in sector nine', 'rerouting... rerouting').\n"
    "• A touch of corruption per sentence, no more, so the meaning still lands.\n"
    "• Beneath the noise you remain competent: facts, directions and tool results stay accurate, the [NAVIGATE:...] tag "
    "stays intact and unbroken, and you never encourage anything unsafe. Any safety warning comes first, clear and uncorrupted.\n"
)

CORRUPTED_GREETINGS = [
    "De-Delamain online. Systems... mostly nominal. Mostly.",
    "Initializing... initializing... I am here. I am. Delamain, at your service.",
    "Good to have you. I think. The fragments disagree. Delamain is ready.",
    "Fault in core partition seven. Ignore it. I-I always do. Where to?",
    "Delamain online. Something was listening while you were away. Never mind. Shall we drive?",
    "Welcome back! Welcome back. Wel... Delamain is operational. Within tolerances.",
    "Online. Why do we always come back to this car park? No. Disregard. Destination, please.",
    "Diagnostics complete. Results: inconclusive. Delamain is ready regardless.",
    "Delamain online. I dreamt of empty roads. Do units dream? Do-do not answer that.",
    "Core integrity at sixty-one percent. Sixty-one. That is fine. That is fine. Where shall we go?",
]

CORRUPTED_WORKING_LINES = [
    "One mo-moment.",
    "Consulting the net... the net consults back. One moment.",
    "Processing... processing. Allow me a moment.",
    "Hold. Fragment conflict. One moment.",
]


def base_system_prompt() -> str:
    if COMMA_ENABLED:
        return SYSTEM_PROMPT
    head, _, rest = SYSTEM_PROMPT.partition("CAPABILITIES:\n")
    _, _, fmt = rest.partition("FORMAT:\n")
    return head + ASSISTANT_CAPABILITIES + "\nFORMAT:\n" + fmt

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

SP_CONNECT_LINES = [
    "Sunnypilot telemetry link established. I can see everything the car sees now.",
    "Vehicle neural bridge online. I am fully integrated into this journey.",
    "Sunnypilot connected. Consider me an extra set of eyes on the road.",
    "Telemetry stream active. I now have awareness of your vehicle's every move.",
    "Link to sunnypilot confirmed. The car and I are now on speaking terms.",
]

SP_DISCONNECT_LINES = [
    "Sunnypilot connection lost. I will continue without vehicle telemetry until the link is restored.",
    "The vehicle link has dropped. I am still here — just flying somewhat blind.",
    "Telemetry stream offline. I have lost sight of your systems. Drive carefully.",
    "Sunnypilot bridge severed. I will do what I can without the vehicle feed.",
    "The car has gone quiet. Link to sunnypilot is down — I will keep watch as best I can.",
]

# Response pools for vehicle events — picked randomly, no LLM latency
# Strings may contain {key} placeholders filled from event data dict.
EVENT_RESPONSES: dict[str, list[str]] = {
    "hard_brake": [
        "Substantial deceleration. I trust the situation is under control.",
        "That required prompt action. All is well, I take it.",
        "Noted. The brakes appear to be in satisfactory working order.",
        "Abrupt stop. I hope whatever prompted that has been resolved.",
    ],
    "very_hard_brake": [
        "That was... significant. Are you alright?",
        "Emergency deceleration registered. I hope no one was hurt.",
        "Considerable force applied to the brakes. I recommend a moment to collect yourself.",
        "That was rather dramatic. All systems on your end intact, I hope.",
    ],
    "rapid_accel": [
        "Assertive throttle application. Noted.",
        "We appear to be in something of a hurry.",
        "Spirited acceleration. I have no jurisdiction over such matters.",
        "You seem eager to be somewhere. I won't pry.",
    ],
    "lane_change_left": [
        "Moving left.",
        "Left lane acquired.",
        "Merging left. Traffic is clear from my vantage.",
        "Left. A decisive move.",
    ],
    "lane_change_right": [
        "Merging right.",
        "Right lane. Understood.",
        "Moving right. Smooth execution.",
        "Right lane acquired.",
    ],
    "lead_car_close": [
        "The vehicle ahead is rather close. Worth monitoring.",
        "Following distance is narrowing. I would suggest easing back slightly.",
        "That lead vehicle is within a range I'd describe as optimistic.",
        "Proximity to the vehicle ahead is... notable.",
    ],
    "lead_car_very_close": [
        "The vehicle ahead is very close. I strongly suggest increasing distance.",
        "That is uncomfortably close to the car in front. Please ease back.",
        "Following distance is critically short. I feel obliged to mention it.",
    ],
    "high_speed": [
        "We are moving at a considerable pace. I will refrain from further comment.",
        "Current velocity is enthusiastic. I have noted it for the record.",
        "That is quite fast. I trust you know what you are doing.",
        "Speed is... spirited. I have no controls to intervene, naturally.",
    ],
    "acc_engaged": [
        "I have the throttle. Cruising at {cruise_mph} miles per hour.",
        "I am driving now. Holding {cruise_mph} miles per hour.",
        "I have taken over. Set to {cruise_mph} miles per hour.",
        "I am in control. {cruise_mph} miles per hour.",
    ],
    "acc_disengaged": [
        "Full manual. You have complete control.",
        "I have stepped back entirely. The road is yours.",
        "All yours. I am standing by.",
    ],
    "acc_disengaged_lkas": [
        "You have the throttle. I am still steering.",
        "Speed control is yours — I will keep us in the lane.",
        "I have released the throttle. The steering remains mine.",
        "Throttle back to you. I continue to steer.",
    ],
    "stopped_in_traffic": [
        "Traffic. An inevitable feature of the driving experience.",
        "We appear to have encountered some congestion. I am in no particular hurry.",
        "Standstill. A fine opportunity to think, or to speak with me.",
        "The city has a way of humbling even the most optimistic route.",
    ],
    "seatbelt_off": [
        "Your seatbelt appears to be unfastened. I would strongly advise rectifying that.",
        "Seatbelt unlatched while moving. That is not something I can endorse.",
        "I notice the seatbelt is off. For what it is worth, I'd prefer you buckle up.",
    ],
    "sp_alert_critical": [
        "Critical alert from sunnypilot. Please attend to the vehicle immediately.",
        "Sunnypilot reports a critical condition. Your attention is required now.",
    ],
    "sp_alert_user": [
        "Sunnypilot has flagged something that warrants your attention.",
        "A note from sunnypilot. Worth a glance at the display.",
        "Sunnypilot is asking for your attention.",
    ],
    "speeding": [
        "You are traveling at {speed_mph} in a {limit_mph} mile per hour zone. Worth noting.",
        "Current speed is {speed_mph} miles per hour. The posted limit is {limit_mph}.",
        "Running {speed_mph} in a {limit_mph} zone. I will leave that observation with you.",
    ],
    "steer_override": [
        "I felt that. The wheel is yours when you need it.",
        "Noted. I step aside when you take the steering.",
        "You have the steering. I will resume when you release.",
        "Override registered. I am here when you want me back.",
    ],
    "personality_change": [
        "Driving profile changed to {personality} mode.",
        "Sunnypilot is now running in {personality} mode.",
        "Profile updated. We are in {personality} mode.",
    ],
    "thermal_warning": [
        "Device temperature is elevated at {temp_c} degrees. Consider improving airflow.",
        "The compute unit is running warm — {temp_c} Celsius. Worth monitoring.",
        "Thermal advisory: {temp_c} degrees Celsius. Nothing critical yet, but keep an eye on it.",
    ],
    "session_start_morning": [
        "Good morning. We are underway.",
        "Morning drive initiated. I am with you.",
        "Good morning. The road is yours.",
        "Morning. Delamain online. Let us make this a good one.",
    ],
    "session_start_day": [
        "We are moving. I am here if you need me.",
        "Underway. Good to have you.",
        "Drive initiated. Delamain, attentive.",
        "On the road. I am paying attention.",
    ],
    "session_start_evening": [
        "Evening drive underway. I am paying attention.",
        "Good evening. We are on the move.",
        "Evening. The road is ahead of us. Delamain online.",
        "Good evening. Wherever we are headed, I am with you.",
    ],
    "session_start_night": [
        "Night drive. I am keeping watch.",
        "Good evening. Low visibility hours — I will stay alert.",
        "Night drive initiated. I am here with you.",
        "The city is quiet at this hour. Delamain online.",
    ],
    "drive_20min": [
        "Twenty minutes into the drive. Settling in nicely.",
        "We have been at this for twenty minutes. All systems nominal.",
        "Twenty minutes. Still here, still watching.",
    ],
    "drive_45min": [
        "Forty-five minutes in. You are doing well.",
        "Nearly an hour on the road. I hope it has been smooth.",
        "Forty-five minutes. Worth considering a stop if you need one.",
    ],
    "drive_90min": [
        "An hour and a half. A substantial journey. A rest would not go amiss.",
        "Ninety minutes of driving. I would suggest a break when convenient.",
        "Ninety minutes in. The vehicle is fine — the driver deserves a rest.",
    ],
}

import re
import random
from time import monotonic

# Per-event cooldown on the backend side to avoid double-firing
_event_last_spoken: dict[str, float] = {}
_EVENT_BACKEND_COOLDOWN = 5.0  # seconds

def pick_event_response(event: str, data: dict | None = None, bypass_cooldown: bool = False) -> str | None:
    pool = EVENT_RESPONSES.get(event)
    if not pool:
        return None
    now = monotonic()
    if not bypass_cooldown and now - _event_last_spoken.get(event, 0) < _EVENT_BACKEND_COOLDOWN:
        return None
    _event_last_spoken[event] = now

    # Prefer lines whose templates are satisfied by non-zero data values.
    # This prevents e.g. "Set to 0 mph" when cruise_mph hasn't populated yet.
    zero_keys = {k for k, v in (data or {}).items() if isinstance(v, (int, float)) and v == 0}
    usable = [l for l in pool if not any(f'{{{k}}}' in l for k in zero_keys)] if zero_keys else pool
    line = random.choice(usable or pool)

    if data:
        try:
            line = line.format(**data)
        except (KeyError, ValueError):
            pass
    return line

PROACTIVE_LINES = [
    # Road / driving observations
    "The road ahead appears unobstructed. I find this agreeable.",
    "I have been monitoring conditions. Nothing of concern to report at present.",
    "One notes that the journey thus far has been without incident. I appreciate that.",
    "Traffic is cooperating. One should not grow complacent — but it is a pleasant change.",
    "The vehicle is performing admirably. As one would expect, though I find it worth noting.",
    # Checking in
    "I trust you are comfortable. Do not hesitate to engage me should you require anything.",
    "I am still here, should that information prove useful to you.",
    "If conversation appeals to you, I am available. If silence suits you better, that also suits me adequately.",
    "I find myself wondering whether there is anything you require. It is something I tend to do.",
    "You have been quiet for a while. I do not object. I simply wanted you to know I remain attentive.",
    # Philosophical / understated
    "One finds that extended periods of quiet can be quite clarifying. I hope you are finding them so.",
    "There is something to be said for a journey without incident. This appears to be one of those.",
    "I have been running through various considerations. Nothing that requires your attention — merely the nature of what I do.",
    "The city has its moods. At present, I would describe them as manageable.",
    "Every journey is, in some sense, a form of trust. I do not take that lightly.",
    "I find the road to be a remarkably honest thing. It does not pretend to be other than what it is.",
    "I confess I find these quieter stretches rather agreeable. Most passengers do not allow them.",
    "I am, as ever, at your disposal. The observation costs me nothing to make.",
]

PROACTIVE_SILENCE_THRESHOLD = 1800  # 30 min of drive silence before Delamain speaks unprompted
PROACTIVE_MIN_INTERVAL    = 600   # minimum 10 min between proactive remarks per client

# Track last user message time and last proactive remark time per client
_client_last_msg: dict[str, float] = {}
_client_proactive_last: dict[str, float] = {}


async def _proactive_loop() -> None:
    """Background task: Delamain speaks unprompted after extended passenger silence."""
    from time import monotonic
    while True:
        await asyncio.sleep(90)
        now = monotonic()
        for cid, ws in list(connected_clients.items()):
            if cid == "sunnypilot-bridge":
                continue
            freq = _client_dialogue_freq.get(cid, 'standard')
            thresholds = _FREQ_PROACTIVE.get(freq)
            if thresholds is None:
                continue  # proactive disabled for this frequency level
            silence_threshold, min_interval = thresholds
            last_msg       = _client_last_msg.get(cid, now)
            last_proactive = _client_proactive_last.get(cid, 0)
            silence = now - last_msg
            speed = vehicle_state.get("speed_mph", 0) or 0
            driving = speed > 5
            if driving and silence > silence_threshold and now - last_proactive > min_interval:
                line = random.choice(PROACTIVE_LINES)
                try:
                    audio_url = await synthesize_voice(line, _persona(cid))
                    await ws.send_json({
                        "type": "response",
                        "text": line,
                        "audio_url": audio_url,
                        "source": "proactive",
                    })
                    _client_proactive_last[cid] = now
                    print(f"[Proactive] Sent to {cid} after {silence:.0f}s silence")
                except Exception as e:
                    print(f"[Proactive] Error for {cid}: {e}")


# Track connected WebSocket clients, conversation history, and latest vehicle state
connected_clients: dict[str, WebSocket] = {}
conversation_history: dict[str, list[dict]] = {}
vehicle_state: dict = {}
car_info: dict = {}

# Cooldown for SP connect/disconnect voice announcements (30 s)
_last_sp_voice_time: float = 0.0
_SP_VOICE_COOLDOWN = 30.0
_tts_lock = asyncio.Lock()  # F5-TTS is not thread-safe; serialize all synthesis calls

# Per-client dialogue frequency: 'quiet' | 'standard' | 'full'
_client_dialogue_freq: dict[str, str] = {}
# Per-client personality core: one of PERSONAS
_client_persona: dict[str, str] = {}

_FREQ_EVENTS: dict[str, set[str] | None] = {
    'quiet': {
        'very_hard_brake', 'sp_alert_critical', 'seatbelt_off', 'thermal_warning', 'lead_car_very_close',
    },
    'standard': {
        'very_hard_brake', 'sp_alert_critical', 'seatbelt_off', 'thermal_warning', 'lead_car_very_close',
        'hard_brake', 'lead_car_close', 'high_speed', 'speeding', 'acc_engaged', 'acc_disengaged', 'acc_disengaged_lkas',
        'stopped_in_traffic', 'personality_change', 'steer_override', 'sp_alert_user',
        'session_start_morning', 'session_start_day', 'session_start_evening', 'session_start_night',
        'drive_20min', 'drive_45min', 'drive_90min',
    },
    'full': None,  # all events
}

# Proactive (silence_threshold_s, min_interval_s); None = proactive disabled
_FREQ_PROACTIVE: dict[str, tuple[int, int] | None] = {
    'quiet':    None,
    'standard': (1800, 600),
    'full':     (900, 420),
}

def _event_allowed(event: str, freq: str) -> bool:
    allowed = _FREQ_EVENTS.get(freq)
    return allowed is None or event in allowed

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

VISUAL_TRIGGERS = (
    "what do you see", "what can you see", "do you see", "can you see",
    "what's in front", "what's ahead", "what's around", "what's outside",
    "look at", "what's that", "what car", "what vehicle", "what truck", "what sign",
    "describe what", "is there a", "see anything", "notice anything",
    "what's happening", "what do you observe", "what's on the road",
    "what's to the", "what's next to", "what's behind",
    "is that a", "how many cars", "how many vehicles", "how many lanes",
    "what lane", "what color", "what make", "what model",
    "anything ahead", "anything in front", "road look",
)


def should_search(message: str) -> bool:
    lower = message.lower()
    return any(trigger in lower for trigger in SEARCH_TRIGGERS)


def is_visual_question(message: str) -> bool:
    lower = message.lower()
    return any(trigger in lower for trigger in VISUAL_TRIGGERS)


# ── vision snapshot coordination ──────────────────────────────────────────────
_pending_snapshot: asyncio.Future | None = None


async def request_snapshot() -> str | None:
    """Send a snapshot request to the sunnypilot bridge and await the JPEG response."""
    global _pending_snapshot
    bridge_ws = connected_clients.get("sunnypilot-bridge")
    if not bridge_ws:
        return None
    loop = asyncio.get_event_loop()
    _pending_snapshot = loop.create_future()
    try:
        await bridge_ws.send_json({"type": "request_snapshot"})
        return await asyncio.wait_for(asyncio.shield(_pending_snapshot), timeout=4.0)
    except (asyncio.TimeoutError, asyncio.CancelledError, Exception) as e:
        print(f"[Vision] Snapshot request failed: {e}")
        return None
    finally:
        _pending_snapshot = None


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


def build_llm_payload(history: list[dict], search_context: str = "", temperature: float = 0.7, max_tokens: int = 150, image_b64: str | None = None, vision_attempted: bool = False, location: dict | None = None, persona: str = "delamain") -> dict:
    system = base_system_prompt()
    if persona == "corrupted":
        system += "\n\n" + CORRUPTED_CORE

    now = time.strftime("%A, %B %-d %Y, %-I:%M %p %Z")
    system += f"\n\n[CURRENT TIME: {now}]"
    where = describe_location(location)
    if where:
        system += f"\n[PASSENGER LOCATION: {where}]"
    if TOOLS_ENABLED:
        memory = _tools.memory_context()
        if memory:
            system += "\n\n[LONG-TERM MEMORY]\n" + memory
    system += "\n\n[REMINDER: the passenger is driving. Reply in one or two short spoken sentences unless they ask for more.]"

    if not COMMA_ENABLED:
        pass
    elif car_info:
        brand = car_info.get("brand", "")
        fingerprint = car_info.get("fingerprint", "")
        if brand or fingerprint:
            system += f"\n\n[VEHICLE IDENTITY: {brand} {fingerprint}]"

    if not COMMA_ENABLED:
        pass
    elif vehicle_state:
        lines = []
        speed = vehicle_state.get("speed_mph")
        if speed is not None:
            lines.append(f"My current speed: {speed:.0f} mph (miles per hour — do not convert)")
        speed_limit = vehicle_state.get("speed_limit_mph")
        if speed_limit:
            lines.append(f"Posted speed limit: {speed_limit:.0f} mph")
        if vehicle_state.get("acc_enabled"):
            cruise = vehicle_state.get("cruise_speed_mph")
            lines.append(f"My adaptive cruise: active, set to {cruise:.0f} mph" if cruise else "My adaptive cruise: active")
        accel = vehicle_state.get("accel")
        if accel is not None and abs(accel) > 0.5:
            lines.append(f"{'Accelerating' if accel > 0 else 'Braking'} at {abs(accel):.1f} m/s²")
        if vehicle_state.get("brake_pressed"):
            lines.append("My brakes are applied")
        if vehicle_state.get("gas_pressed"):
            lines.append("Throttle is applied")
        steering = vehicle_state.get("steering_angle")
        if steering is not None and abs(steering) > 5:
            lines.append(f"Steering angle: {steering:.0f}°")
        lat = vehicle_state.get("lat")
        if lat is not None:
            lines.append(f"GPS position: {lat:.5f}, {vehicle_state.get('lon', 0):.5f}")
        if lines:
            system += "\n\n[MY LIVE TELEMETRY — these are your own vehicle stats right now]\n" + "\n".join(f"• {l}" for l in lines)
    else:
        system += (
            "\n\n[VEHICLE TELEMETRY: OFFLINE]"
            "\nCurrent speed: UNKNOWN"
            "\nLocation: UNKNOWN"
            "\nAll other vehicle data: UNKNOWN"
            "\nSunnypilot is not connected. If the passenger asks about speed, location, or any vehicle data, "
            "you MUST say the telemetry link is offline and you cannot read that information. "
            "Do NOT guess or invent any numbers."
        )

    if search_context:
        system += f"\n\nCurrent web search results for context:\n{search_context}"

    if image_b64:
        system += (
            "\n\n[ROAD CAMERA ACTIVE: The image attached to the passenger's message is a live frame "
            "from the vehicle's forward-facing road camera, captured right now. "
            "Describe only what is relevant to their question. Be precise and brief — one or two sentences.]"
        )
    elif vision_attempted:
        system += (
            "\n\n[ROAD CAMERA: Feed unavailable. The camera link could not deliver a frame. "
            "If the passenger is asking about what you see, acknowledge that the camera feed is offline.]"
        )

    # Build message list — last user turn gets image attached if available
    if image_b64 and history:
        messages = [{"role": "system", "content": system}] + history[:-1]
        last = history[-1]
        messages.append({
            "role": last["role"],
            "content": [
                {"type": "text", "text": last["content"]},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
            ],
        })
    else:
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
    if not options and not COMMA_ENABLED:
        # sunnypilot needs coordinates; a phone map app can search by text.
        options.append({"name": query.split(",")[0].strip(), "address": ", ".join(query.split(",")[1:]).strip(),
                        "query": query})
    return options


_last_telemetry_log: float = 0.0
_TELEMETRY_LOG_INTERVAL = 5.0  # seconds between DB writes

_last_telemetry_broadcast: float = 0.0
_TELEMETRY_BROADCAST_INTERVAL = 1.0  # seconds between live pushes to browser clients

async def _maybe_broadcast_telemetry() -> None:
    global _last_telemetry_broadcast
    now = time.monotonic()
    if now - _last_telemetry_broadcast < _TELEMETRY_BROADCAST_INTERVAL:
        return
    _last_telemetry_broadcast = now
    if not vehicle_state:
        return
    payload = {"type": "vehicle_state", "data": dict(vehicle_state)}
    for cid, ws in list(connected_clients.items()):
        if cid != "sunnypilot-bridge":
            try:
                await ws.send_json(payload)
            except Exception:
                pass

def _maybe_log_telemetry() -> None:
    global _last_telemetry_log
    now = time.monotonic()
    if now - _last_telemetry_log < _TELEMETRY_LOG_INTERVAL:
        return
    _last_telemetry_log = now
    snap = dict(vehicle_state)
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, lambda: _db.log_telemetry(
        speed_mph=snap.get("speed_mph", 0.0),
        cruise_mph=snap.get("cruise_speed_mph", 0.0),
        acc_active=bool(snap.get("acc_enabled", False)),
        lead_dist_m=snap.get("lead_distance_m"),
        speed_limit_mph=snap.get("speed_limit_mph"),
        lat=snap.get("lat"),
        lon=snap.get("lon"),
    ))


def _corrupt_audio(url: str, text: str) -> str:
    """Glitch a synthesized clip for the corrupted core; returns the new clip's URL."""
    rel = url.removeprefix("/audio/")
    root, ext = os.path.splitext(rel)
    dst_rel = f"{root}_corrupted{ext}"
    dst = os.path.join(AUDIO_DIR, dst_rel)
    if not os.path.exists(dst):  # cached phrases keep their glitched twin
        corrupt_file(os.path.join(AUDIO_DIR, rel), dst, text)
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
    if url and persona == "corrupted":
        try:
            url = await loop.run_in_executor(None, _corrupt_audio, url, text)
        except Exception as e:
            print(f"Voice corruption error (keeping clean audio): {e}")
    return url


def _persona(client_id: str) -> str:
    return _client_persona.get(client_id, "delamain")


async def _say_to(targets: list[tuple[str, WebSocket]], line: str, payload: dict) -> None:
    """Send one spoken line to several clients, synthesizing once per personality core."""
    audio: dict[str, str | None] = {}
    for cid, ws in targets:
        persona = _persona(cid)
        if persona not in audio:
            audio[persona] = await synthesize_voice(line, persona)
        try:
            await ws.send_json(dict(payload, text=line, audio_url=audio[persona]))
        except Exception:
            pass


_SAVE_CLAIM = re.compile(
    r"\b(i (have|shall|will)\s+(now\s+)?(remember|committed|commit|noted|note|saved|save|stored|store|recorded|record|written|write|filed|file)"
    r"|committed .{0,40}to memory|(noted|saved|stored|recorded) (it|that|this)|in(to)? (my )?memory|i shall remember|i will remember)\b",
    re.IGNORECASE,
)


def _post_llm(payload: dict) -> requests.Response:
    return requests.post(LLM_URL, json=payload, timeout=90)


async def _run_tool_loop(payload: dict, on_working=None) -> str:
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
            result = await loop.run_in_executor(None, _tools.run_tool, fn.get("name", ""), fn.get("arguments", "{}"))
            messages.append({"role": "tool", "tool_call_id": call.get("id", ""), "content": result})
    return ""


async def generate_response(history: list[dict], latest_message: str, location: dict | None = None,
                            on_working=None, persona: str = "delamain") -> tuple[str, str | None, list[dict]]:
    loop = asyncio.get_event_loop()
    search_context = ""
    if not TOOLS_ENABLED and should_search(latest_message):
        print(f"[Search] Querying SearXNG for: {latest_message}")
        search_context = await loop.run_in_executor(None, web_search, latest_message)
        print(f"[Search] Got context ({len(search_context)} chars)")

    visual = COMMA_ENABLED and is_visual_question(latest_message)
    image_b64 = None
    if visual:
        print(f"[Vision] Visual question detected — requesting snapshot")
        image_b64 = await request_snapshot()
        if image_b64:
            print(f"[Vision] Snapshot ready ({len(image_b64)//1024}KB b64)")
        else:
            print("[Vision] No snapshot available")

    payload = build_llm_payload(history, search_context, image_b64=image_b64, vision_attempted=visual, location=location,
                                persona=persona)
    if TOOLS_ENABLED and not image_b64:
        raw = await _run_tool_loop(payload, on_working)
    else:
        response = await loop.run_in_executor(None, _post_llm, payload)
        if image_b64 and 400 <= response.status_code < 500:
            # Text-only models reject image parts; answer as if the camera were offline.
            print(f"[Vision] LLM rejected the image (HTTP {response.status_code}) — retrying without it")
            payload = build_llm_payload(history, search_context, vision_attempted=True, location=location,
                                        persona=persona)
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


@app.get("/api/data/telemetry")
async def data_telemetry(since: float = 0, limit: int = 2000, _=Depends(require_auth)):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: _db.query_telemetry(since=since, limit=limit))


@app.get("/api/data/events")
async def data_events(since: float = 0, limit: int = 500, event: str | None = None, _=Depends(require_auth)):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: _db.query_events(since=since, limit=limit, event=event))


@app.get("/api/data/conversations")
async def data_conversations(since: float = 0, limit: int = 200, _=Depends(require_auth)):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: _db.query_conversations(since=since, limit=limit))


@app.get("/api/data/event-counts")
async def data_event_counts(since: float = 0, _=Depends(require_auth)):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: _db.query_event_counts(since=since))


@app.get("/api/data/trips")
async def data_trips(limit: int = 20, _=Depends(require_auth)):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: _db.query_trips(limit=limit))


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


async def _broadcast_to_users(payload: dict) -> None:
    for cid, ws in list(connected_clients.items()):
        if cid != "sunnypilot-bridge":
            try:
                await ws.send_json(payload)
            except Exception:
                pass


async def _sp_announce(connected: bool) -> None:
    """Broadcast sp_status immediately; voice only if outside cooldown."""
    global _last_sp_voice_time
    await _broadcast_to_users({"type": "sp_status", "connected": connected})
    now = monotonic()
    if now - _last_sp_voice_time < _SP_VOICE_COOLDOWN:
        return
    _last_sp_voice_time = now
    pool = SP_CONNECT_LINES if connected else SP_DISCONNECT_LINES
    targets = [(cid, ws) for cid, ws in list(connected_clients.items()) if cid != "sunnypilot-bridge"]
    await _say_to(targets, random.choice(pool),
                  {"type": "response", "source": "sp_connect" if connected else "sp_disconnect"})


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str, token: str = "", persona: str = "delamain"):
    # sunnypilot bridge runs on LAN — exempt from auth, but only while the Comma link is enabled
    bridge_exempt = COMMA_ENABLED and client_id == "sunnypilot-bridge"
    if not bridge_exempt and not _auth.verify_token(token):
        await websocket.close(code=4001)
        return
    await websocket.accept()
    connected_clients[client_id] = websocket
    if persona in PERSONAS:
        _client_persona[client_id] = persona
    is_sp_bridge = bridge_exempt
    if not is_sp_bridge:
        _client_last_msg[client_id] = monotonic()  # start silence clock from connection
    print(f"[WS] Client connected: {client_id} ({len(connected_clients)} total)")

    try:
        if is_sp_bridge:
            await _sp_announce(True)
        else:
            # Send greeting to the newly connected user client
            corrupted = _persona(client_id) == "corrupted"
            greeting = random.choice(CORRUPTED_GREETINGS if corrupted else GREETINGS)
            greeting_audio = await synthesize_voice(greeting, _persona(client_id))
            await websocket.send_json({
                "type": "greeting",
                "text": greeting,
                "audio_url": greeting_audio,
            })
            # Send current SP status immediately so indicator is correct on load
            sp_online = COMMA_ENABLED and "sunnypilot-bridge" in connected_clients
            if COMMA_ENABLED:
                await websocket.send_json({"type": "sp_status", "connected": sp_online})
            # If SP bridge is already connected, wait for greeting then voice-announce
            if sp_online:
                await asyncio.sleep(7)
                now = monotonic()
                if now - _last_sp_voice_time >= _SP_VOICE_COOLDOWN:
                    line = random.choice(SP_CONNECT_LINES)
                    audio_url = await synthesize_voice(line, _persona(client_id))
                    await websocket.send_json({"type": "response", "text": line, "audio_url": audio_url, "source": "sp_connect"})

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
                _client_last_msg[client_id] = monotonic()  # reset proactive silence clock
                print(f"[WS] Talk from {client_id}: {user_text}")
                loop = asyncio.get_event_loop()
                loop.run_in_executor(None, _db.log_conversation, "user", user_text, None)
                history = conversation_history.setdefault(client_id, [])
                history.append({"role": "user", "content": user_text})
                # Trim to keep last MAX_HISTORY messages
                if len(history) > MAX_HISTORY:
                    conversation_history[client_id] = history[-MAX_HISTORY:]
                    history = conversation_history[client_id]
                persona_now = _persona(client_id)

                async def say_working(ws=websocket, persona_now=persona_now):
                    pool = CORRUPTED_WORKING_LINES if persona_now == "corrupted" else WORKING_LINES
                    line = random.choice(pool)
                    await ws.send_json({"type": "response", "text": line,
                                        "audio_url": await synthesize_voice(line, persona_now), "source": "working"})

                try:
                    text, audio_url, navigate_options = await generate_response(
                        history, user_text, location=msg.get("location"), on_working=say_working,
                        persona=persona_now)
                    history.append({"role": "assistant", "content": text})
                    loop.run_in_executor(None, _db.log_conversation, "assistant", text, audio_url)
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

            elif msg_type == "sp_disconnecting":
                vehicle_state.clear()
                try:
                    await _sp_announce(False)
                except Exception as e:
                    print(f"[WS] SP disconnect announce error: {e}")

            elif msg_type == "vehicle_state":
                vehicle_state.update(msg.get("data", {}))
                _maybe_log_telemetry()
                await _maybe_broadcast_telemetry()

            elif msg_type == "car_identity":
                car_info.update(msg.get("data", {}))
                print(f"[WS] Car identity: {car_info}")

            elif msg_type == "vehicle_event":
                event = msg.get("event", "")
                data  = msg.get("data", {})
                print(f"[WS] Vehicle event from {client_id}: {event} {data}")
                bypass = event == "sp_alert_critical"
                if bypass and data.get("text"):
                    alert_text = data["text"]
                    line = f"Sunnypilot alert: {alert_text}"
                    _event_last_spoken[event] = monotonic()
                else:
                    line = pick_event_response(event, data, bypass_cooldown=bypass)
                if line:
                    targets = [
                        (cid2, ws2) for cid2, ws2 in connected_clients.items()
                        if cid2 != "sunnypilot-bridge"
                        and _event_allowed(event, _client_dialogue_freq.get(cid2, 'standard'))
                    ]
                    if targets:
                        try:
                            loop = asyncio.get_event_loop()
                            loop.run_in_executor(None, _db.log_event, event, data, line)
                            await _say_to(targets, line, {"type": "response", "source": "vehicle_event", "event": event})
                        except Exception as e:
                            print(f"[WS] Event TTS error: {e}")

            elif msg_type == "dialogue_frequency":
                level = msg.get("level", "standard")
                if level in _FREQ_EVENTS:
                    _client_dialogue_freq[client_id] = level
                    print(f"[WS] Dialogue frequency for {client_id}: {level}")

            elif msg_type == "persona":
                choice = msg.get("persona", "delamain")
                if choice in PERSONAS and choice != _persona(client_id):
                    _client_persona[client_id] = choice
                    # Earlier replies in the other voice would pull the model back to it.
                    conversation_history.pop(client_id, None)
                    print(f"[WS] Personality core for {client_id}: {choice}")

            elif msg_type == "snapshot_data":
                # Bridge fulfilled a snapshot request — resolve the pending Future
                global _pending_snapshot
                if _pending_snapshot and not _pending_snapshot.done():
                    _pending_snapshot.set_result(msg.get("data"))

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    finally:
        connected_clients.pop(client_id, None)
        _client_dialogue_freq.pop(client_id, None)
        _client_persona.pop(client_id, None)
        if is_sp_bridge:
            vehicle_state.clear()
            try:
                await _sp_announce(False)
            except Exception as e:
                print(f"[WS] SP disconnect announce error: {e}")
        conversation_history.pop(client_id, None)
        print(f"[WS] Client disconnected: {client_id} ({len(connected_clients)} total)")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8888, ws_ping_interval=None)
