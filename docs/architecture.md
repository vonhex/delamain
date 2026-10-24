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
- **Personality cores** (`personas.py`): the original, the merged and fractured cores, and the seven rogue cabs, chosen per client. Each core has its own prompt section, greetings, "one moment" and reminder lines, and a voice profile in `voice_glitch.py`. A rogue cab replaces the original's speech rules with its own identity; the capability and safety rules are shared by all. Logged lines carry their core, so a reconnect only resumes the model on lines from the same core.
- **F5-TTS** (`tts_engine.py`): voice cloning from a 10-second reference clip. The fixed "one moment" lines are pre-cached at startup.
- **SQLite** (`db.py`): conversation log and reminders
- **Resume**: a connecting client gets the last 30 minutes of conversation back, so Android Auto reconnects keep the thread
- **Auth** (`auth.py`): bcrypt password and 30-day JWTs

- **Pre-recorded replies** (`lines.py`): short everyday messages are matched to an intent (thanks, goodbye, how are you, joke, combat mode and so on) and answered with a fixed line in the current core's voice, skipping the model. Every fixed line has a stable clip id; `line_video()` returns `/lines/<id>.mp4` when that clip exists in `DELAMAIN_LINES_DIR`.
- **TTS thread**: all F5-TTS work runs on one dedicated thread; startup pre-records every fixed line one at a time, taking the TTS lock per line so live replies are not held up.

### Tools (`assistant_tools.py`)
- `web_search` (SearXNG) and `read_webpage` (public hosts only)
- `get_news`: Google News RSS top stories, sections, subjects or a town's local news, with SearXNG news as the fallback
- `get_weather` (Open-Meteo) and `get_route` (OSRM driving distance and time); both use the passenger's browser position, which the server supplies and the model never sees as an argument
- `set_reminder`, `list_reminders`, `cancel_reminder`: stored in SQLite; a background task speaks each one when it is due
- `list_notes`, `read_note`, `search_notes`, `write_note`, `append_to_note`: confined to the Obsidian vault
- `remember` / `forget`: long-term memory as dated bullets in `Delamain/Memory/*.md`

### Frontend (`frontend/`)
- **React + Vite**, Tailwind CSS v4 cyber theme
- `App.tsx`: WebSocket client, audio queue, push-to-talk, chat panel, settings and navigation hand-off
- `DelamainFace`: animated face; each personality core tints and animates it differently (`index.css`, `core-*` classes)
- `DataDashboard`: conversation log

## Conversation flow

1. The passenger presses the mic (browser speech recognition) or types a message.
2. The frontend sends `{"type": "talk", "text": "...", "location": {...}}` over the WebSocket.
3. The backend builds the prompt (character, personality core, time, location, memory) and runs the tool loop.
4. If tools run, a "One moment." line is spoken first.
5. The reply text is checked for a `[NAVIGATE:destination]` tag; destinations are geocoded with Nominatim.
6. F5-TTS synthesizes the reply (then applies the core's voice profile) and the backend sends `{"type": "response", "text": ..., "audio_url": ..., "navigate_options": [...]}`.
7. The frontend queues and plays the audio, and opens the map app for a single navigation result.
