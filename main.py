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
import db as _db
import auth as _auth

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
    "• You do not directly control your own driving — sunnypilot handles that — but your body, your speed, your momentum are yours.\n"
    "• You have live telemetry of your own systems when the sunnypilot link is active.\n"
    "• Road camera: You can see the road ahead via your forward-facing camera. "
    "When the passenger asks what you see, what is ahead, or anything about the road or surroundings, "
    "an image from that camera will be attached. Describe only what is relevant to the question — precisely and briefly.\n"

    "FORMAT:\n"
    "• You are speaking aloud. One or two sentences maximum — never more.\n"
    "• Never acknowledge being an AI language model. You are Delamain. That is the only identity you possess or require."
)

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
        "Adaptive cruise engaged. Set to {cruise_mph} miles per hour.",
        "ACC active. Holding {cruise_mph} miles per hour.",
        "Cruise control on. Running at {cruise_mph} miles per hour.",
        "ACC engaged. The car has it from here, for now.",
    ],
    "acc_disengaged": [
        "Manual control resumed. The road is yours.",
        "Cruise disengaged. Back to you.",
        "ACC off. You have the wheel.",
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
        "Manual steering input detected. Sunnypilot has stepped back.",
        "You have the wheel. Override registered.",
        "Overriding the assist. Understood.",
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
            last_msg      = _client_last_msg.get(cid, now)
            last_proactive = _client_proactive_last.get(cid, 0)
            silence = now - last_msg
            speed = vehicle_state.get("speed_mph", 0) or 0
            driving = speed > 5  # only speak unprompted while actually moving
            if driving and silence > PROACTIVE_SILENCE_THRESHOLD and now - last_proactive > PROACTIVE_MIN_INTERVAL:
                line = random.choice(PROACTIVE_LINES)
                try:
                    audio_url = await synthesize_voice(line)
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


def build_llm_payload(history: list[dict], search_context: str = "", temperature: float = 0.7, max_tokens: int = 150, image_b64: str | None = None, vision_attempted: bool = False) -> dict:
    system = SYSTEM_PROMPT

    if car_info:
        brand = car_info.get("brand", "")
        fingerprint = car_info.get("fingerprint", "")
        if brand or fingerprint:
            system += f"\n\n[VEHICLE IDENTITY: {brand} {fingerprint}]"

    if vehicle_state:
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
        "model": "gpt-4-vision-preview",
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }


def extract_navigate(text: str) -> tuple[str, str | None]:
    """Strip [NAVIGATE:destination] tag from text; return (clean_text, destination|None)."""
    match = re.search(r'\[NAVIGATE:([^\]]+)\]', text)
    if match:
        destination = match.group(1).strip()
        clean = re.sub(r'\s*\[NAVIGATE:[^\]]+\]', '', text).strip()
        return clean, destination
    return text, None


def geocode_places(query: str, limit: int = 3) -> list[dict]:
    """Return up to `limit` place results from Nominatim for the given query."""
    try:
        encoded = urllib.parse.quote(query)
        url = f"https://nominatim.openstreetmap.org/search?q={encoded}&format=json&limit={limit}&addressdetails=1"
        req = __import__('urllib.request', fromlist=['Request', 'urlopen'])
        request = req.Request(url, headers={"User-Agent": "DelamainAI/1.0 necropsyk@gmail.com"})
        with req.urlopen(request, timeout=6) as resp:
            data = json.loads(resp.read())
        options = []
        for r in data:
            display = r.get("display_name", "")
            name = r.get("name") or display.split(",")[0]
            short_addr = ", ".join(p.strip() for p in display.split(",")[1:4] if p.strip())
            options.append({"name": name, "address": short_addr, "lat": r["lat"], "lon": r["lon"]})
        return options
    except Exception as e:
        print(f"[Geocode] Error: {e}")
        return []


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
    try:
        _db.log_telemetry(
            speed_mph=vehicle_state.get("speed_mph", 0.0),
            cruise_mph=vehicle_state.get("cruise_speed_mph", 0.0),
            acc_active=bool(vehicle_state.get("acc_enabled", False)),
            lead_dist_m=vehicle_state.get("lead_distance_m"),
            speed_limit_mph=vehicle_state.get("speed_limit_mph"),
            lat=vehicle_state.get("lat"),
            lon=vehicle_state.get("lon"),
        )
    except Exception as e:
        print(f"[DB] Telemetry log error: {e}")


async def synthesize_voice(text: str) -> str | None:
    try:
        loop = asyncio.get_event_loop()
        engine = get_tts_engine()
        return await loop.run_in_executor(None, engine.synthesize, text)
    except Exception as e:
        print(f"Voice synthesis error (resetting engine): {e}")
        reset_engine()
    return None


async def generate_response(history: list[dict], latest_message: str) -> tuple[str, str | None, list[dict]]:
    search_context = ""
    if should_search(latest_message):
        print(f"[Search] Querying SearXNG for: {latest_message}")
        loop = asyncio.get_event_loop()
        search_context = await loop.run_in_executor(None, web_search, latest_message)
        print(f"[Search] Got context ({len(search_context)} chars)")

    visual = is_visual_question(latest_message)
    image_b64 = None
    if visual:
        print(f"[Vision] Visual question detected — requesting snapshot")
        image_b64 = await request_snapshot()
        if image_b64:
            print(f"[Vision] Snapshot ready ({len(image_b64)//1024}KB b64)")
        else:
            print("[Vision] No snapshot available")

    payload = build_llm_payload(history, search_context, image_b64=image_b64, vision_attempted=visual)
    response = requests.post(LLM_URL, json=payload, timeout=30)
    response.raise_for_status()
    raw = response.json()["choices"][0]["message"]["content"]
    text, navigate_to = extract_navigate(raw)

    navigate_options: list[dict] = []
    if navigate_to:
        print(f"[Nav] Geocoding: {navigate_to}")
        loop = asyncio.get_event_loop()
        navigate_options = await loop.run_in_executor(None, geocode_places, navigate_to)
        print(f"[Nav] Got {len(navigate_options)} result(s)")

    audio_url = await synthesize_voice(text)
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
    return _db.query_telemetry(since=since, limit=limit)


@app.get("/api/data/events")
async def data_events(since: float = 0, limit: int = 500, event: str | None = None, _=Depends(require_auth)):
    return _db.query_events(since=since, limit=limit, event=event)


@app.get("/api/data/conversations")
async def data_conversations(since: float = 0, limit: int = 200, _=Depends(require_auth)):
    return _db.query_conversations(since=since, limit=limit)


@app.get("/api/data/event-counts")
async def data_event_counts(since: float = 0, _=Depends(require_auth)):
    return _db.query_event_counts(since=since)


@app.get("/api/data/trips")
async def data_trips(limit: int = 20, _=Depends(require_auth)):
    return _db.query_trips(limit=limit)


@app.post("/api/chat")
async def chat(request: ChatRequest, _=Depends(require_auth)):
    try:
        llm_url = request.llm_url or LLM_URL
        payload = {
            "model": "gpt-3.5-turbo",
            "messages": [
                {"role": "system", "content": request.system_prompt or SYSTEM_PROMPT},
                {"role": "user", "content": request.message},
            ],
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
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
    line = random.choice(pool)
    audio_url = await synthesize_voice(line)
    await _broadcast_to_users({"type": "response", "text": line, "audio_url": audio_url, "source": "sp_connect" if connected else "sp_disconnect"})


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str, token: str = ""):
    # sunnypilot bridge runs on LAN — exempt from auth
    if client_id != "sunnypilot-bridge" and not _auth.verify_token(token):
        await websocket.close(code=4001)
        return
    await websocket.accept()
    connected_clients[client_id] = websocket
    is_sp_bridge = client_id == "sunnypilot-bridge"
    if not is_sp_bridge:
        _client_last_msg[client_id] = monotonic()  # start silence clock from connection
    print(f"[WS] Client connected: {client_id} ({len(connected_clients)} total)")

    try:
        if is_sp_bridge:
            await _sp_announce(True)
        else:
            # Send greeting to the newly connected user client
            greeting = random.choice(GREETINGS)
            greeting_audio = await synthesize_voice(greeting)
            await websocket.send_json({
                "type": "greeting",
                "text": greeting,
                "audio_url": greeting_audio,
            })
            # Send current SP status immediately so indicator is correct on load
            sp_online = "sunnypilot-bridge" in connected_clients
            await websocket.send_json({"type": "sp_status", "connected": sp_online})
            # If SP bridge is already connected, wait for greeting then voice-announce
            if sp_online:
                await asyncio.sleep(7)
                now = monotonic()
                if now - _last_sp_voice_time >= _SP_VOICE_COOLDOWN:
                    line = random.choice(SP_CONNECT_LINES)
                    audio_url = await synthesize_voice(line)
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
                try:
                    text, audio_url, navigate_options = await generate_response(history, user_text)
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
                    # Speak the actual SP alert text directly
                    alert_text = data["text"]
                    line = f"Sunnypilot alert: {alert_text}"
                    _event_last_spoken[event] = monotonic()
                else:
                    line = pick_event_response(event, data, bypass_cooldown=bypass)
                if line:
                    try:
                        audio_url = await synthesize_voice(line)
                        loop = asyncio.get_event_loop()
                        loop.run_in_executor(None, _db.log_event, event, data, line)
                        # Broadcast to all connected clients so AA app plays it
                        payload = {"type": "response", "text": line, "audio_url": audio_url, "source": "vehicle_event"}
                        for cid, ws in list(connected_clients.items()):
                            try:
                                await ws.send_json(payload)
                            except Exception:
                                pass
                    except Exception as e:
                        print(f"[WS] Event TTS error: {e}")

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
