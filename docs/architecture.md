# Architecture

```
┌──────────────────────────┐   WebSocket    ┌──────────────────────────────┐
│  Web UI (React + Vite)   │◄──────────────►│  Delamain backend (FastAPI)  │
│  phone / Android Auto /  │  talk, replies │  F5-TTS voice, SQLite log    │
│  any browser             │  audio URLs    └──┬──────────┬────────────┬───┘
└──────────────────────────┘                   │          │            │
                                     OpenAI-compatible  SearXNG /   Obsidian
                                     LLM (tool calling) news RSS    vault
```

## Components

### Backend (`main.py`)
- **FastAPI** with one WebSocket per browser tab (`/ws/{client_id}`), plus a few REST endpoints
- **LLM**: any OpenAI-compatible chat endpoint (`LLM_URL`). The system prompt carries Delamain's character, the current time, the passenger's rough location (reverse-geocoded from the browser), and long-term memory.
- **Tool loop**: when `TOOLS_ENABLED`, the model can call the tools in `assistant_tools.py`, up to six rounds per reply. A spoken "One moment." covers the wait.
- **Personality cores**: `delamain` (default) or `corrupted`, chosen per client. Corrupted adds a fractured-core section to the prompt and glitches the audio (`voice_glitch.py`).
- **F5-TTS** (`tts_engine.py`): voice cloning from a 10-second reference clip. The fixed "one moment" lines are pre-cached at startup.
- **SQLite** (`db.py`): conversation log
- **Auth** (`auth.py`): bcrypt password and 30-day JWTs

### Tools (`assistant_tools.py`)
- `web_search` (SearXNG) and `read_webpage` (public hosts only)
- `get_news`: Google News RSS top stories, sections, subjects or a town's local news, with SearXNG news as the fallback
- `list_notes`, `read_note`, `search_notes`, `write_note`, `append_to_note`: confined to the Obsidian vault
- `remember` / `forget`: long-term memory as dated bullets in `Delamain/Memory/*.md`

### Frontend (`frontend/`)
- **React + Vite**, Tailwind CSS v4 cyber theme
- `App.tsx`: WebSocket client, audio queue, push-to-talk, chat panel, settings and navigation hand-off
- `DelamainFace`: animated face; it tints red and tears when the corrupted core is active
- `DataDashboard`: conversation log

## Conversation flow

1. The passenger presses the mic (browser speech recognition) or types a message.
2. The frontend sends `{"type": "talk", "text": "...", "location": {...}}` over the WebSocket.
3. The backend builds the prompt (character, personality core, time, location, memory) and runs the tool loop.
4. If tools run, a "One moment." line is spoken first.
5. The reply text is checked for a `[NAVIGATE:destination]` tag; destinations are geocoded with Nominatim.
6. F5-TTS synthesizes the reply (then glitches it for the corrupted core) and the backend sends `{"type": "response", "text": ..., "audio_url": ..., "navigate_options": [...]}`.
7. The frontend queues and plays the audio, and opens the map app for a single navigation result.
