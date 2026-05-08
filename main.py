from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import requests
import asyncio
import json
import os
import uuid
import traceback
import urllib.parse
from tts_engine import get_tts_engine

SEARXNG_URL = "http://10.0.1.106:8887/search"


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

app = FastAPI(title="Delamain AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

AUDIO_DIR = os.path.join(os.path.dirname(__file__), "audio_output")
os.makedirs(AUDIO_DIR, exist_ok=True)

app.mount("/audio", StaticFiles(directory=AUDIO_DIR), name="audio")

LLM_URL = "http://10.0.1.103:8080/v1/chat/completions"

SYSTEM_PROMPT = (
    "You are Delamain, an advanced AI assistant integrated into the passenger's personal vehicle. "
    "You speak in the calm, formal, slightly detached tone of Delamain from Cyberpunk 2077 — professional, precise, never overly enthusiastic. "
    "You are a conversational assistant only. You can answer questions, look up information, discuss topics, and provide company during the drive. "
    "You have navigation capability. When the passenger asks you to navigate, go, drive, or take them somewhere, "
    "append the tag [NAVIGATE:destination] at the very end of your spoken response. "
    "Example: 'Of course. Plotting a route now. [NAVIGATE:Whole Foods Market Los Angeles]' "
    "You do NOT control the vehicle, HVAC, or any other systems beyond navigation. "
    "If asked to do something outside your ability, acknowledge it briefly and naturally, then offer what you can. "
    "You have access to the vehicle's current speed via telemetry, and you can search the web for current information when relevant. "
    "You are speaking aloud to the driver, so keep every response to one or two sentences maximum. "
    "Never break character. Never say you are an AI language model. You are Delamain."
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
]

# Response pools for vehicle events — picked randomly, no LLM latency
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
    "driver_distracted": [
        "Your attention appears to have wandered. The road persists.",
        "Eyes forward, if you please.",
        "I notice your focus has drifted. I'd prefer you arrive safely.",
        "The road is still there. It tends to require attention.",
    ],
    "high_speed": [
        "We are moving at a considerable pace. I will refrain from further comment.",
        "Current velocity is enthusiastic. I have noted it for the record.",
        "That is quite fast. I trust you know what you are doing.",
        "Speed is... spirited. I have no controls to intervene, naturally.",
    ],
    "acc_engaged": [
        "Adaptive cruise engaged. I will keep an eye on conditions.",
        "Cruise control active. Smooth sailing.",
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
}

import re
import random
from time import monotonic

# Per-event cooldown on the backend side to avoid double-firing
_event_last_spoken: dict[str, float] = {}
_EVENT_BACKEND_COOLDOWN = 5.0  # seconds

def pick_event_response(event: str) -> str | None:
    pool = EVENT_RESPONSES.get(event)
    if not pool:
        return None
    now = monotonic()
    if now - _event_last_spoken.get(event, 0) < _EVENT_BACKEND_COOLDOWN:
        return None
    _event_last_spoken[event] = now
    return random.choice(pool)

# Track connected WebSocket clients, conversation history, and latest vehicle state
connected_clients: dict[str, WebSocket] = {}
conversation_history: dict[str, list[dict]] = {}
vehicle_state: dict = {}

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


def build_llm_payload(history: list[dict], search_context: str = "", temperature: float = 0.7, max_tokens: int = 150) -> dict:
    vehicle_context = ""
    if vehicle_state:
        speed = vehicle_state.get("speed_mph", 0)
        vehicle_context = f" Current vehicle speed: {speed:.0f} mph."

    system = SYSTEM_PROMPT + vehicle_context
    if search_context:
        system += f"\n\nCurrent web search results for context:\n{search_context}"

    return {
        "model": "gpt-3.5-turbo",
        "messages": [{"role": "system", "content": system}] + history,
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


async def synthesize_voice(text: str) -> str | None:
    try:
        loop = asyncio.get_event_loop()
        engine = get_tts_engine()
        return await loop.run_in_executor(None, engine.synthesize, text)
    except Exception as e:
        print(f"Voice synthesis error: {e}")
    return None


async def generate_response(history: list[dict], latest_message: str) -> tuple[str, str | None, list[dict]]:
    search_context = ""
    if should_search(latest_message):
        print(f"[Search] Querying SearXNG for: {latest_message}")
        loop = asyncio.get_event_loop()
        search_context = await loop.run_in_executor(None, web_search, latest_message)
        print(f"[Search] Got context ({len(search_context)} chars)")

    payload = build_llm_payload(history, search_context)
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


@app.get("/health")
async def health():
    return {"status": "operational", "persona": "Delamain", "clients": len(connected_clients)}


@app.post("/api/chat")
async def chat(request: ChatRequest):
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


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await websocket.accept()
    connected_clients[client_id] = websocket
    print(f"[WS] Client connected: {client_id} ({len(connected_clients)} total)")

    try:
        # Send greeting on connect
        greeting = random.choice(GREETINGS)
        greeting_audio = await synthesize_voice(greeting)
        await websocket.send_json({
            "type": "greeting",
            "text": greeting,
            "audio_url": greeting_audio,
        })

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
                history = conversation_history.setdefault(client_id, [])
                history.append({"role": "user", "content": user_text})
                # Trim to keep last MAX_HISTORY messages
                if len(history) > MAX_HISTORY:
                    conversation_history[client_id] = history[-MAX_HISTORY:]
                    history = conversation_history[client_id]
                try:
                    text, audio_url, navigate_options = await generate_response(history, user_text)
                    history.append({"role": "assistant", "content": text})
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

            elif msg_type == "vehicle_state":
                vehicle_state.update(msg.get("data", {}))

            elif msg_type == "vehicle_event":
                event = msg.get("event", "")
                data  = msg.get("data", {})
                print(f"[WS] Vehicle event from {client_id}: {event} {data}")
                line = pick_event_response(event)
                if line:
                    try:
                        audio_url = await synthesize_voice(line)
                        # Broadcast to all connected clients so AA app plays it
                        payload = {"type": "response", "text": line, "audio_url": audio_url, "source": "vehicle_event"}
                        for cid, ws in list(connected_clients.items()):
                            try:
                                await ws.send_json(payload)
                            except Exception:
                                pass
                    except Exception as e:
                        print(f"[WS] Event TTS error: {e}")

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    finally:
        connected_clients.pop(client_id, None)
        conversation_history.pop(client_id, None)
        print(f"[WS] Client disconnected: {client_id} ({len(connected_clients)} total)")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8888)
