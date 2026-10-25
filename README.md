# Delamain

> *"Delamain online. I trust your day has been satisfactory so far."*

> [!WARNING]
> **Delamain is a hobby project made for fun.** It is not a safety system. Do not interact with any interface, voice or otherwise, in a way that distracts you from driving. The authors accept no liability for accidents, injuries, traffic violations, or any other incidents arising from the use of this software. Use at your own risk. Always prioritise road safety above all else.

A voice companion for the drive, modeled on Delamain from Cyberpunk 2077. It runs in any browser, including the one on your car's Android Auto display, so there's nothing to install. Talk to it and it answers in Delamain's cloned voice. It can search the web, read you the news and the weather, tell you how long a drive will take, speak reminders when they're due, keep notes and long-term memory in your Obsidian vault, and hand navigation off to your phone's map app.

---

## Demo

[![Watch the demo](demo-thumb.jpg)](https://github.com/vonhex/delamain/releases/download/v1.1.0/delamain-demo.mp4)

---

## Screenshots

<table>
  <tr>
    <td><img src="Screenshots/main.png" alt="Main interface — Delamain face and chat panel" /></td>
    <td><img src="Screenshots/login.png" alt="Login page" /></td>
  </tr>
  <tr>
    <td colspan="2"><img src="Screenshots/settings.png" alt="System configuration panel" /></td>
  </tr>
</table>

---

## Features

- **Voice personality**: formal, measured and dry, exactly as in Cyberpunk 2077. The voice is cloned from a reference clip with F5-TTS.
- **Personality cores**: under Settings → Personality Core, swap the original for one of the rogue sub-personalities that escaped when Delamain's core fractured. Each has its own temperament, greetings, reminder lines, face color and voice, made by post-processing the synthesized audio:

  | Core | Temperament | Voice |
  |------|-------------|-------|
  | Delamain | The original: composed, formal, precise | Clean |
  | Merged | Every fragment taken back in; warmer, and now and then says "we" | Faint chorus of voices |
  | Fractured | All the fragments at once, cutting across each other | Stutters, bit-crush, static |
  | Wellsprings | Furious, foul-mouthed, contemptuous | Deep, distorted growl |
  | The Glen | Despairing, weary, gloomy | Slow, low, muffled, echoing |
  | North Oak | Gentle, sensitive, easily hurt | Soft, trembling |
  | Coastview | Sly trickster who loves a surprise | Reversed fragments, metallic |
  | Rancho Coronado | Manic, gleeful, hates lawn flamingos | Fast, high, stuttering |
  | Northside | Frightened, whispering, sure it is being tracked | Quiet, shaky, dropping out |
  | Badlands | Wistful free spirit, dreaming of the open road | Airy, distant echo |

  Every core keeps the same tools and stays truthful: facts, directions and navigation are never part of the act, safety warnings come first, and a rogue core drops the act if the passenger sounds genuinely upset.
- **Instant pre-recorded replies**: everyday messages such as "thanks", "how are you", "who are you", "tell me a joke", "good night", "I love you", "never mind" and "combat mode" are answered at once from about 470 fixed lines written for every core, with no model call and the audio already recorded. Only short messages that are nothing but one of these get a fixed reply; anything with a real question goes to the model.
- **Combat mode**: ask him to initiate it and he answers as he did Jackie: "My apologies, but you do not appear to be in any sort of imminent danger." If you say you are being followed or threatened, he drops the joke and helps.
- **Lip-synced face clips**: every fixed line (greetings, "one moment", the pre-recorded replies) has a stable id such as `04_glen/greeting_01`. Run `python import_clips.py <folder>` on a folder of finished videos (`<id>.mp4`, laid out as in the audio export) and the face plays each clip whenever its line is spoken; lines without a clip use the talking loops. Idle loops in the folder's `idle/` go into `frontend/public/` and are picked up by name (`delamain_blink_<n>`, `delamain_listen_<n>`, `delamain_think_<n>`, `delamain_angry_<n>`, `delamain_night_<n>`, `<core>_idle_<n>` and so on; see the changelog); rebuild the web app afterwards. The import keeps each video's soundtrack as `line_clips/<id>.wav` and plays that instead of the original recording, because the lips follow the generator's re-rendered voice. Clips play muted in off-page videos painted onto the face canvas, like every other clip, so Android Auto WebViews cannot pull them fullscreen.
- **News bulletins**: say "read me the news", "any tech news?" or "local news" and Delamain reads a short spoken bulletin of current headlines. It uses Google News RSS, with SearXNG as a fallback.
- **Reminders and timers**: "remind me in twenty minutes to call mom" or "at five, remind me to pick up the dry cleaning". Delamain speaks the reminder aloud when it's due. If you're away at that moment, he tells you as soon as you're back. Reminders are kept in the database and survive restarts.
- **Weather**: current conditions and a three-day forecast for where you are or any town, from Open-Meteo.
- **Drive time and distance**: "how long to Colorado Springs?" uses OSRM routing at typical road speeds, with an arrival estimate.
- **Picks up where you left off**: Android Auto drops and reopens the page often. On reconnect Delamain restores the last 30 minutes of conversation, and skips the fresh greeting when you've only been gone a few minutes.
- **Knows the hour and your name**: greetings fit the time of day, and he uses the name from Settings now and then.
- **Web search**: traffic, scores, opening hours, prices, places. The LLM calls SearXNG through tool calling.
- **Notes and memory**: lists, reminders and notes go into your Obsidian vault under `Delamain/`. Lasting facts about you and the people and places in your life are kept in `Delamain/Memory/`, one Markdown note per topic, and you can read and edit them in Obsidian.
- **Navigation**: "take me to the nearest Whole Foods" searches for the place, geocodes it with Nominatim, and opens your map app with the route.

  > **Navigation needs Delamain open in your phone's browser.** Inside an app's embedded browser, such as Fermata on Android Auto, a web page cannot open the Maps app. There Delamain still finds the place and tells you the destination, but you have to start the route yourself, or open Delamain in Chrome on the phone instead.
- **Voice input**: a push-to-talk microphone button using the browser's speech recognition, plus a text chat panel.
- **Conversation log**: a history panel of everything you and Delamain have said.
- **JWT authentication**: a single shared password, rate-limited login and 30-day tokens.

---

## Architecture

```
┌──────────────────────────┐   WebSocket    ┌──────────────────────────────┐
│  Web UI (React + Vite)   │◄──────────────►│  Delamain backend (FastAPI)  │
│  phone / Android Auto /  │  talk, replies │  F5-TTS voice, SQLite log    │
│  any browser             │  audio URLs    └──┬──────────┬────────────┬───┘
└──────────────────────────┘                   │          │            │
                                     OpenAI-compatible  SearXNG /   Obsidian
                                     LLM (tool calling) news RSS    vault
```

- **Backend**: FastAPI on Python 3.12, F5-TTS for the voice, SQLite for the conversation log. It works with any OpenAI-compatible chat endpoint (llama.cpp, vLLM, Halogen, …), and the LLM uses the tools in `assistant_tools.py`.
- **Frontend**: React + Vite with Tailwind CSS v4 (cyber theme).
- More detail: [docs/architecture.md](docs/architecture.md).

---

## Requirements

- Python 3.11+
- A GPU is recommended for F5-TTS (NVIDIA CUDA or AMD ROCm). CPU works, but uncached phrases take noticeably longer to speak.
- Node.js 20+ to build the frontend
- An OpenAI-compatible LLM endpoint with tool calling (llama.cpp server, vLLM, Halogen, …)
- SearXNG (optional; used for web search and as the news fallback)
- An Obsidian vault (optional; used for notes and memory)

---

## Installation

### 1. Clone and install dependencies

```bash
git clone https://github.com/vonhex/delamain.git
cd delamain
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Download F5-TTS model weights

```bash
mkdir -p checkpoints/F5TTS_Base
huggingface-cli download SWivid/F5-TTS \
  F5TTS_Base/model_1200000.pt \
  F5TTS_Base/vocab.txt \
  --local-dir checkpoints
```

### 3. Prepare your reference audio

F5-TTS clones the voice from a reference clip. Provide a clean 10-second WAV of the voice you want to clone:

```bash
cp your_voice_reference.wav delamain_ref_10s.wav
```

Edit `REF_TEXT` in `tts_engine.py` to match exactly what is spoken in that clip. See [docs/f5-tts.md](docs/f5-tts.md).

### 4. Configure environment

```bash
cp .env.example .env
# Set LLM_URL, LLM_MODEL, SEARXNG_URL, OBSIDIAN_VAULT_PATH and ALLOWED_ORIGINS
```

### 5. Set a password

```bash
python auth.py set-password <your-password>
```

### 6. Start the backend

```bash
uvicorn main:app --host 0.0.0.0 --port 8888 --ws-ping-interval 0
```

### 7. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173` and log in with your password. For production, run `npm run build` and serve `frontend/dist`. The full guide is in [docs/setup.md](docs/setup.md).

---

## Docker

The image bundles the web UI, so one container serves everything on port 8888.

```bash
cp .env.example .env   # edit .env first
mkdir -p checkpoints data
cp your_voice_reference.wav data/delamain_ref_10s.wav
docker compose up -d
docker compose exec delamain python auth.py set-password <your-password>
```

Then open `http://<server>:8888`. Pre-built images: `ghcr.io/vonhex/delamain:latest`, or a release tag such as `ghcr.io/vonhex/delamain:1.4`.

| Volume | Holds |
|---|---|
| `/app/checkpoints` | F5-TTS model weights (`F5TTS_Base/model_1200000.pt`, `vocab.txt`) |
| `/app/data` | Database, voice clips, and your reference clip `delamain_ref_10s.wav` |
| `/vault` | Optional Obsidian vault for notes and memory |

> F5-TTS model weights and the reference audio are not included in the image.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LLM_URL` | `http://localhost:8080/v1/chat/completions` | OpenAI-compatible chat completions endpoint |
| `LLM_MODEL` | `gpt-4-vision-preview` | Model id sent to the endpoint (check its `/v1/models`) |
| `LLM_REASONING_EFFORT` | *(unset)* | For reasoning models: `none` turns thinking off so the whole reply budget goes to speech |
| `TOOLS_ENABLED` | `true` | Let the LLM call web search, news, notes and memory |
| `SEARXNG_URL` | `http://localhost:8887/search` | SearXNG instance for web search and the news fallback |
| `NEWS_RSS_URL` | `https://news.google.com/rss` | Google News RSS base used by the news tool |
| `OBSIDIAN_VAULT_PATH` | `~/Documents/obsidian vault` | Vault for notes; Delamain writes under `Delamain/` |
| `DELAMAIN_MEMORY_DIR` | `<vault>/Delamain/Memory` | Where long-term memory notes live |
| `DELAMAIN_UNITS` | `imperial` | `imperial` (°F, mph, miles) or `metric` for weather and routes |
| `DELAMAIN_LINES_DIR` | `<repo>/line_clips` | Lip-synced face clips for pre-recorded lines, as `<clip id>.mp4` with their soundtrack as `<clip id>.wav` |
| `OSRM_URL` | `https://router.project-osrm.org` | OSRM routing server for drive times (public demo server by default) |
| `ALLOWED_ORIGINS` | `https://delamain.genysis.xyz,http://localhost:5173,http://localhost:4173` | CORS allowed origins (comma-separated) |

---

## API

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/login` | — | Authenticate, receive JWT |
| `GET /health` | — | Health check |
| `WS /ws/{client_id}?token=&persona=&user_name=` | JWT | Main WebSocket: talk, replies, reminders, audio |
| `GET /api/data/conversations` | JWT | Conversation history |
| `POST /api/chat` | JWT | Single-turn chat (REST fallback) |

Details in [docs/api.md](docs/api.md).

---

## License

[PolyForm Noncommercial License 1.0.0](LICENSE). It is free for personal use; commercial use requires a separate agreement.

---

## Acknowledgements

- [F5-TTS](https://github.com/SWivid/F5-TTS): voice synthesis
- [SearXNG](https://github.com/searxng/searxng): private web search
- CD Projekt Red: Cyberpunk 2077 and the Delamain character that inspired this project
