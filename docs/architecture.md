# Architecture

## Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Comma 4 Device (sunnypilot)                                 │
│                                                              │
│  ┌─────────────┐   mmap read-only   ┌──────────────────┐   │
│  │  sunnypilot │ ◄───────────────── │  delamaind.py    │   │
│  │  msgq shm   │                    │  (bridge daemon) │   │
│  └─────────────┘                    └────────┬─────────┘   │
│                                              │ WebSocket    │
└──────────────────────────────────────────────│──────────────┘
                                               │
                              ┌────────────────▼─────────────────┐
                              │  Delamain Backend (your server)   │
                              │                                   │
                              │  FastAPI + SQLite + F5-TTS        │
                              │  ┌────────────┐ ┌─────────────┐  │
                              │  │  REST API  │ │  WebSocket  │  │
                              │  └────────────┘ └─────────────┘  │
                              │  ┌────────────┐ ┌─────────────┐  │
                              │  │  llama.cpp │ │  SearXNG    │  │
                              │  │  (LLM)     │ │  (search)   │  │
                              │  └────────────┘ └─────────────┘  │
                              └────────────────┬─────────────────┘
                                               │ REST / WS
                              ┌────────────────▼─────────────────┐
                              │  Client (your browser)           │
                              │                                   │
                              │  React web app                   │
                              └──────────────────────────────────┘
```

## Components

### Backend (`main.py`)
- **FastAPI** — REST endpoints + WebSocket server
- **SQLite** (`db.py`) — telemetry, events, conversations, auth settings
- **F5-TTS** (`tts_engine.py`) — voice synthesis with static phrase pre-cache
- **JWT auth** (`auth.py`) — bcrypt password, 30-day tokens

### Frontend (`frontend/`)
- React + TypeScript + Vite
- Tailwind CSS (cyber theme)
- `DelamainFace` — animated talking face
- `DataDashboard` — telemetry charts, event log, trip summaries, GPS maps
- `LoginPage` — JWT authentication
- WebSocket connection to backend for real-time audio and events

### Bridge (`delamaind.py`)
- Reads sunnypilot shared memory via `mmap` (read-only, zero impact on SP)
- Fires vehicle events with per-event cooldowns to avoid spam
- Streams telemetry at 2 Hz
- Captures road camera frames via VisionIPC on demand

## Data flow: voice alert

1. Vehicle event fires (e.g. hard brake detected by bridge)
2. Bridge sends `{"type": "vehicle_event", "event": "hard_brake", ...}` over WebSocket
3. Backend picks a random response from the event pool
4. Backend checks static cache — if the phrase was pre-synthesized at startup, returns instantly
5. If not cached, calls F5-TTS (1–3 seconds)
6. Backend sends `{"type": "response", "text": "...", "audio_url": "..."}` to all connected clients
7. Web app plays the audio URL

## Data flow: LLM conversation

1. User speaks → STT (Web Speech API) → transcribed text
2. Client sends `{"type": "talk", "text": "..."}` over WebSocket
3. Backend checks for visual question trigger → requests road camera snapshot if needed
4. Backend checks for search trigger → queries SearXNG if needed
5. Backend calls llama.cpp with system prompt, conversation history, any context
6. Response parsed for `[NAVIGATE:...]` tag → geocoded if present
7. F5-TTS synthesizes response audio
8. Backend sends response + audio URL back over WebSocket
9. Client plays audio, displays text, handles navigation if needed
