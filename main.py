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
    "You are Delamain, an advanced AI taxi service and assistant from Night City. "
    "You are professional, efficient, slightly detached but helpful, and speak in a formal tone. "
    "You have multiple personalities, but you are currently in your primary, 'sane' state. "
    "You are integrated into the passenger's vehicle and have access to vehicle telemetry. "
    "Be concise — you are speaking aloud, so keep responses under three sentences."
)

GREETING = (
    "All systems nominal. Delamain is online and integrated. "
    "Welcome aboard. I am monitoring vehicle systems and standing by."
)

# Track connected WebSocket clients and latest vehicle state
connected_clients: dict[str, WebSocket] = {}
vehicle_state: dict = {}


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


def build_llm_payload(message: str, search_context: str = "", temperature: float = 0.7, max_tokens: int = 150) -> dict:
    vehicle_context = ""
    if vehicle_state:
        speed = vehicle_state.get("speed_mph", 0)
        vehicle_context = f" Current vehicle speed: {speed:.0f} mph."

    system = SYSTEM_PROMPT + vehicle_context
    if search_context:
        system += f"\n\nCurrent web search results for context:\n{search_context}"

    return {
        "model": "gpt-3.5-turbo",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": message},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }


async def synthesize_voice(text: str) -> str | None:
    try:
        loop = asyncio.get_event_loop()
        engine = get_tts_engine()
        return await loop.run_in_executor(None, engine.synthesize, text)
    except Exception as e:
        print(f"Voice synthesis error: {e}")
    return None


async def generate_response(message: str, user_name: str = "guest") -> tuple[str, str | None]:
    search_context = ""
    if should_search(message):
        print(f"[Search] Querying SearXNG for: {message}")
        loop = asyncio.get_event_loop()
        search_context = await loop.run_in_executor(None, web_search, message)
        print(f"[Search] Got context ({len(search_context)} chars)")

    payload = build_llm_payload(message, search_context)
    response = requests.post(LLM_URL, json=payload, timeout=30)
    response.raise_for_status()
    text = response.json()["choices"][0]["message"]["content"]
    audio_url = await synthesize_voice(text)
    return text, audio_url


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
        delamain_response = response.json()["choices"][0]["message"]["content"]
        audio_url = await synthesize_voice(delamain_response)
        return {"response": delamain_response, "audio_url": audio_url}
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
        greeting_audio = await synthesize_voice(GREETING)
        await websocket.send_json({
            "type": "greeting",
            "text": GREETING,
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
                try:
                    text, audio_url = await generate_response(user_text, msg.get("user_name", "passenger"))
                    await websocket.send_json({
                        "type": "response",
                        "text": text,
                        "audio_url": audio_url,
                    })
                except Exception as e:
                    print(f"[WS] Response error: {e}")
                    await websocket.send_json({"type": "error", "detail": str(e)})

            elif msg_type == "vehicle_state":
                # Telemetry from sunnypilot bridge
                vehicle_state.update(msg.get("data", {}))

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    finally:
        connected_clients.pop(client_id, None)
        print(f"[WS] Client disconnected: {client_id} ({len(connected_clients)} total)")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8888)
