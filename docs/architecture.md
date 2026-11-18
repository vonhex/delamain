# Architecture

```
                    ┌──────────────────────────────────────────────────────────────┐
┌────────────────┐  │  Delamain backend (FastAPI)                                  │
│ Web UI         │  │                                                              │
│ React + Vite   │◄─┤  conversation ─ tool loop ─ check before speaking ─ voice    │
│ phone, desktop,│WS│        │              │                          (F5-TTS)    │
│ car display    │  │   personality      tools: web, news, weather, routes,        │
└────────────────┘  │   cores            reminders, notes, memory, calendar,       │
        ▲           │                    mail, reports, meetings, Dungeon Master   │
        │ SSE       │                                                              │
        └───────────┤  brain.py ── live feed of everything below                   │
                    │  mind.py  ── knowledge, study, news, emotions, journal,      │
                    │              the other Delamain, tasks, morning brief        │
                    │  recall.py ── search by meaning over notes and conversations │
                    │  self_improve.py ── playbook, tuning, nightly review,        │
                    │              code proposals you approve                      │
                    └───┬─────────────────────┬──────────────────────┬────────────┘
                        │                     │                      │
              OpenAI-compatible LLM     SearXNG, news RSS,      Obsidian vault
              with tool calling         weather, routing        (his memory and notes)
```

Everything runs on your own computer. The only outside services are the ones you point him at:
your language model (which can also run locally), web search, and the free weather, news and
routing services.

## Components

### Backend (`main.py`)
- **FastAPI** with one WebSocket per browser tab (`/ws/{client_id}`), plus REST endpoints.
- **LLM**: any OpenAI-compatible chat endpoint (`LLM_URL`). The system prompt carries Delamain's
  character and personality core, the current time, the passenger's rough location
  (reverse-geocoded from the browser), long-term memory, his playbook, his inner state (how he
  feels and why, opinions, what he studied, open tasks) and the knowledge notes that match the
  conversation.
- **Two modes**: drive mode (short, eyes-free replies for the car) and assistant mode (a browser:
  fuller answers and conversation). Both share one prompt, checked so they never drift apart.
- **Tool loop**: when `TOOLS_ENABLED`, the model calls the tools in `assistant_tools.py`, `mind.py`
  and `self_improve.py`, up to six rounds per reply. A spoken "One moment." covers the wait.
- **Honesty guards** in the tool loop: a reply that promises an action, claims a save, or says
  "done" with no tool run is sent back to actually do it; tool calls written into the text are
  run; and before a reply is spoken the model checks its own draft against memory and the
  turn's tool results (`_verify_reply`), rewriting it once if it claims undone work or invents
  facts. See [mind.md](mind.md#honesty).
- **Personality cores** (`personas.py`): the original, the merged and fractured cores, and the
  seven rogue cabs, chosen per client, each with its prompt, lines and voice profile
  (`voice_glitch.py`).
- **F5-TTS** (`tts_engine.py`) clones the voice from a reference clip; `speech_text.py` rewrites
  each reply for speech first (numbers, units, acronyms, `pronunciations.txt`). All synthesis runs
  on one dedicated thread.
- **SQLite** (`db.py`): conversation log and reminders. **Auth** (`auth.py`): bcrypt password and
  30-day JWTs.
- **Resume**: a connecting page gets the last three hours of conversation, so a conversation
  started in the car carries on at the desk or on the phone.
- **Pre-recorded replies** (`lines.py`): short everyday messages are answered with a fixed line in
  the current core's voice, with a lip-synced clip when one exists, skipping the model. "How are
  you", kind words and small talk go to the model instead, so he answers from how he feels.

### Recall (`recall.py`)
An index over his vault notes and the conversation log, rebuilt from them at any time
(`self/recall.sqlite`): passages with a full-text entry (SQLite FTS5) and a vector from a small
embedding model (bge-small through onnxruntime, CPU only, four threads). Searches blend the two.
It feeds the passages that bear on each message into the prompt, picks memories by relevance once
they outgrow their budget, and answers the `search_memory` tool. Updated every five minutes.

### His mind (`mind.py`)
Knowledge notes, news reading, free-time study (rotating areas of life, favourite subjects),
thirty named emotions on top of a five-axis mood, a post-reply appraisal of each conversation, a
nightly journal and self-portrait, opinions, long tasks, the morning brief, and evening talks with
"the other Delamain". Background loops in `main.py` (`_mind_loop`, `_brief_loop`) drive it. It
also serves the vault as a graph of notes for the Brain view. See [mind.md](mind.md).

### Self-improvement (`self_improve.py`)
Playbook rules, skills, bounded self-tuning, an outcome log, the nightly review, and code
proposals: drafted by his own model, checked (compile, import, type check), optionally reviewed,
applied only from your Approve button, with backup and automatic rollback. See
[self-improvement.md](self-improvement.md).

### Brain feed (`brain.py`)
`main.py`, `mind.py` and `self_improve.py` report each step to an in-memory event bus, which
`/api/brain/events` streams to the Brain view over Server-Sent Events. It only records; it never
changes a reply. See [brain.md](brain.md).

### Tools (`assistant_tools.py`, `google_api.py`, `reports.py`, `dungeon.py`)
- `web_search` (SearXNG), `read_webpage` (public hosts only), `get_news` (Google News RSS, SearXNG
  fallback), `get_weather` (Open-Meteo), `get_route` (OSRM)
- `set_reminder`, `list_reminders`, `cancel_reminder`: SQLite, spoken when due
- Obsidian: `list_notes`, `read_note`, `search_notes`, `write_note`, `append_to_note`, and long-term
  memory with `remember` / `forget`
- Google Calendar and Gmail (drafts only): see [google.md](google.md)
- Reports: `write_report` (a full PDF write-up from meeting notes), `remake_report_pdf`,
  `correct_report` (exact name fixes, checked), `note_to_report` (any note into the Reports screen)
- Dungeon Master mode: see [dungeon-master.md](dungeon-master.md)

### Meetings (`meetings.py`)
Recorded in the browser in pieces, transcribed on your computer with Whisper, summarised with what
he already knows from recent conversations, filed in the vault. See [meetings.md](meetings.md).

### Frontend (`frontend/`)
- React + Vite, Tailwind CSS v4 cyber theme.
- `App.tsx`: WebSocket client, audio queue (a line the browser will not play yet waits for your
  first tap instead of playing silently), push-to-talk and wake word, chat panel, settings,
  navigation hand-off, and the sidebar (it scrolls on a short car screen).
- `DelamainFace`: the animated, lip-synced face; each core tints and animates it differently.
- `BrainView` and `brain/brainRenderer.ts`: the brain, its regions, the vault's notes as stars,
  and the note reader.
- `SelfPanel` (self-improvement and the mind at a glance) and `EmotionsPanel` (all thirty feelings,
  his mood against his resting temperament, what moved him today, unspoken thoughts).
- `MeetingPanel`, `DataDashboard`, `IntegrationsPanel`.

## Conversation flow

1. You press the mic (browser speech recognition), say the wake word, or type.
2. The page sends `{"type": "talk", "text": "...", "location": {...}}` over the WebSocket.
3. A short everyday message may get an instant pre-recorded reply. Otherwise the backend builds the
   prompt and runs the tool loop; if tools run, "One moment." is spoken first.
4. The draft reply passes the honesty guards and the check before speaking.
5. A `[NAVIGATE:destination]` tag is geocoded with Nominatim.
6. F5-TTS speaks the reply (then the core's voice profile is applied) and the backend sends
   `{"type": "response", "text": ..., "audio_url": ..., "navigate_options": [...]}`.
7. While it plays, `mind.py` appraises the exchange: a feeling or two, and maybe a thought he keeps
   to himself.
