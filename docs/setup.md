# Setup Guide

## 1. Install

```bash
git clone https://github.com/vonhex/delamain.git
cd delamain
./install.sh          # Windows: run Delamain-Setup-<version>.exe from the release (or double-click install.bat in the zip)
```

The installer brings its own Python (uv), installs PyTorch for your GPU (NVIDIA, AMD or CPU; override with `TORCH_INDEX=<url>`), Delamain's packages and, if needed, a private Node.js, builds the web UI and starts Delamain. Everything stays in this folder; run it again after `git pull` to update. Options: `--no-start`, and `--service` (Linux) to run Delamain as a systemd user service that starts at login.

## 2. Start it

```bash
./start.sh        # Windows: start.bat. PORT=9000 ./start.sh for another port
```

The backend serves the web UI on port 8888. On the first start it also:

- downloads the F5-TTS weights from Hugging Face (`SWivid/F5-TTS`, about 1.3 GB) into `checkpoints/`;
- downloads the lip-synced clips from the repository's `line-clips` release (about 240 MB) into `line_clips/`;
- records every fixed line once in the background, so pre-recorded replies are instant afterwards.

Delamain answers while this runs; lines without their clip yet use the talking loops.

## 3. Choose a password

Open `http://<server>:8888`. A fresh install asks you to choose a password (at least 8 characters). Tokens last 30 days. To change the password later:

```bash
python auth.py set-password <new-password>
```

## 4. Connect your services

Open Settings (the gear) → Integrations:

| Setting | Needed | What it is |
|---|---|---|
| LLM endpoint | Yes | OpenAI-compatible chat completions URL with tool calling (Ollama, LM Studio, llama.cpp, vLLM, …) |
| Model id | Usually | The model the endpoint serves (see its `/v1/models`); llama.cpp ignores it |
| Reasoning effort | No | `none` turns thinking off on reasoning models |
| Tools | No | Web search, news, weather, routes, notes and memory |
| SearXNG search URL | No | Web search, and the news fallback |
| Obsidian vault folder | No | A folder on the server with a `.obsidian` folder in it |
| News RSS, OSRM, units | No | Defaults work |

These are saved in `settings.json` next to the database and take effect at once. The same values can come from environment variables instead (copy `.env.example` to `.env`); a value saved in Settings wins.

## 5. Use it on your phone and in the car

Open the address in the browser on your phone or on the Android Auto display, log in, and press the mic. The microphone and location only work on a secure (`https://`) page, so use Tailscale (`tailscale serve 8888`) or a Cloudflare Tunnel; see the README. Opening Delamain through either needs no `ALLOWED_ORIGINS` change.

## 6. Let him grow

His mind and self-improvement switch themselves on; give them two things:

- **An Obsidian vault** (Settings → Integrations). It is where he keeps what he knows, what he
  studies, his journal and his feelings. Without one he still talks, but forgets.
- **A model with tool calling**, and the patience for background work: he studies, reads the news
  and writes his journal on the same model when nobody is using it. A reasoning model does this
  best; if your server rejects the `reasoning_effort` field, set `DELAMAIN_BACKGROUND_EFFORT=` (empty).

**Running a small model?** Settings → Integrations → **Features** has a switch for each extra that
uses the model: the check before speaking, feelings, his self tools, news reading, study and long
tasks, looking at pictures, the other Delamain, the journal, the morning brief and the nightly self-review. **All off**
leaves a plain, quick assistant with his voice, memory and everyday tools; turn things back on one
at a time as your hardware allows. Changes take effect at once, without a restart.

To let him **apply** the code changes you approve, run him as a service: `./install.sh --service`
(Linux). Optional helpers: the `agy` CLI for a second-opinion review of every change, and
[Claude Code](https://claude.com/claude-code) for the *Fix with Claude* button. See
[mind.md](mind.md) and [self-improvement.md](self-improvement.md).

## Your own voice

The Delamain reference clip `delamain_ref_clean.wav` is included. To clone another voice, replace it (or set `DELAMAIN_REF_AUDIO`) with a clean WAV of a few whole sentences and edit `REF_TEXT` in `tts_engine.py` to match exactly what is spoken. Delete `audio_output/static_cache/` so the fixed lines are recorded again in the new voice. See [f5-tts.md](f5-tts.md).

## Frontend development

```bash
cd frontend && npm run dev
```

Serves the UI with hot reload on `http://localhost:5173`, proxying the API to the backend on 8888.

## Installing by hand

To do what the installer does by hand:

```bash
git clone https://github.com/vonhex/delamain.git
cd delamain
python -m venv venv
source venv/bin/activate
pip install torch torchaudio      # pick the build for your GPU at https://pytorch.org
pip install -r requirements.txt
(cd frontend && npm ci && npm run build)
./start.sh
```

Open `http://localhost:8888`, choose a password, and point Settings → Integrations at your LLM (and SearXNG and Obsidian vault, if you use them). The backend serves the web UI, and the voice model and lip-synced clips download on the first start.

- **Change the password** later with `python auth.py set-password <new-password>`.
- **Environment variables** still work and are used for anything not set in Settings: copy `.env.example` to `.env`. `PORT` changes the port.
- **Your own voice**: replace `delamain_ref_clean.wav` (or set `DELAMAIN_REF_AUDIO`) and edit `REF_TEXT` in `tts_engine.py` to match exactly what is spoken. See [docs/f5-tts.md](f5-tts.md).
- **Frontend development**: `cd frontend && npm run dev` serves the UI with hot reload on `http://localhost:5173`, proxying to the backend.

The full guide is in [docs/setup.md](setup.md).

To make and add more lip-synced clips of your own, see [docs/clips.md](clips.md).

## Docker

The image bundles the web UI, so one container serves everything on port 8888.

```bash
docker compose up -d
```

Then open `http://<server>:8888`, choose a password and fill in Settings → Integrations. A `.env` next to `docker-compose.yml` is optional and sets the same values. In the container, the Obsidian vault is mounted at `/vault` (set `OBSIDIAN_VAULT_PATH` before `docker compose up` to choose the folder on the host). Pre-built images: `ghcr.io/vonhex/delamain:latest`, or a release tag such as `ghcr.io/vonhex/delamain:2.4`.

| Volume | Holds |
|---|---|
| `/app/checkpoints` | F5-TTS model weights, downloaded on first start |
| `/app/data` | Database, settings, recorded audio, the lip-synced clips (downloaded on first start), and his own state in `data/self` |
| `/vault` | Optional Obsidian vault for notes and memory |

For the phone and the car, give the container an `https://` address on your own domain with a tunnel or reverse proxy pointed at `http://<server>:8888` (see the README). The microphone does not work on a plain `http://` address. On Unraid, the same applies: run Cloudflare Tunnel (the `cloudflared` app), Tailscale or your reverse proxy alongside the container and point it at `http://<Unraid IP>:8888`.

## Environment variables

All optional. The ones marked ⚙ can also be set in Settings → Integrations, which takes precedence.

| Variable | Default | Description |
|---|---|---|
| `LLM_URL` ⚙ | `http://localhost:8080/v1/chat/completions` | OpenAI-compatible chat completions endpoint |
| `LLM_MODEL` ⚙ | `gpt-4-vision-preview` | Model id sent to the endpoint (check its `/v1/models`) |
| `LLM_API_KEY` ⚙ | *(unset)* | API key for a hosted or key-protected endpoint, sent as `Authorization: Bearer <key>`. Settings never shows it again once saved |
| `LLM_REASONING_EFFORT` ⚙ | *(unset)* | For reasoning models: `none` turns thinking off so the whole reply budget goes to speech |
| `TOOLS_ENABLED` ⚙ | `true` | Let the LLM call web search, news, notes and memory |
| `SEARXNG_URL` ⚙ | `http://localhost:8887/search` | SearXNG instance for web search and the news fallback |
| `NEWS_RSS_URL` ⚙ | `https://news.google.com/rss` | Google News RSS base used by the news tool |
| `OBSIDIAN_VAULT_PATH` ⚙ | `~/Documents/obsidian vault` | Vault for notes; Delamain writes under `Delamain/` |
| `DM_TRANSCRIPT_CHARS` | `40000` | Dungeon Master mode: how much of the game's transcript (in characters, about 4 a token) goes into every reply on top of the adventure and chronicle. Raise it for a long-context model; see [docs/dungeon-master.md](dungeon-master.md#requirements) |
| `DELAMAIN_VAULT_ROOTS` | your home folder, `/vault`, and the folder holding `OBSIDIAN_VAULT_PATH` | Folders a vault chosen in Settings must be inside (separated by `:` on Linux and macOS, `;` on Windows). A vault set in `.env` is always allowed |
| `DELAMAIN_MEMORY_DIR` | `<vault>/Delamain/Memory` | Where long-term memory notes live |
| `DELAMAIN_HOME_ADDRESS` ⚙ | *(unset)* | Your home address, so "take me home", the drive time home and the weather at home work |
| `DELAMAIN_UNITS` ⚙ | `imperial` | `imperial` (°F, mph, miles) or `metric` for weather and routes |
| `DELAMAIN_LINES_DIR` | `<repo>/line_clips` | Lip-synced face clips for pre-recorded lines, as `<clip id>.mp4` with their soundtrack as `<clip id>.wav` |
| `OSRM_URL` ⚙ | `https://router.project-osrm.org` | OSRM routing server for drive times (public demo server by default) |
| `DELAMAIN_CLIPS_URL` | the `line-clips` release | Where a new install downloads the lip-synced clips from; empty to skip |
| `DELAMAIN_REF_AUDIO` | `delamain_ref_clean.wav` | Reference clip the voice is cloned from |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:4173` | Only needed when a page on another site calls the API (CORS). Opening Delamain directly, or through a tunnel or reverse proxy, works without it |
| `DELAMAIN_ALLOWED_HOSTS` | *(unset)* | Only for the frontend's Vite dev or preview server (`npm run dev`, `npm run preview`) behind your own tunnel: its domain, e.g. `delamain.example.com` (comma-separated). Vite refuses other hostnames. A normal install serves the page on `:8888` and does not need it |
| `TTS_NFE_STEPS` | `32` | F5-TTS steps: fewer is faster, more is clearer |
| `DELAMAIN_PRONUNCIATIONS` | `pronunciations.local.txt` | Your own "Word = respelling" list for words the voice gets wrong (on top of `pronunciations.txt`) |
| `DELAMAIN_VERIFY` ⚙ | `true` | The check before speaking ([mind.md](mind.md#honesty)); `false` turns it off |
| `DELAMAIN_FEELINGS` ⚙ | `true` | Feelings and inner life: the appraisal after each reply, and his mood in every prompt |
| `DELAMAIN_RECALL` ⚙ | `true` | Recall by meaning: a small embedding model on the CPU over his notes and your conversations ([mind.md](mind.md#recall)); `false` searches by words only |
| `DELAMAIN_EMBED_MODEL` | `BAAI/bge-small-en-v1.5` | The embedding model (a Hugging Face repo with `onnx/model.onnx`) |
| `DELAMAIN_SELF_TOOLS` ⚙ | `true` | Offer the model the tools that change his playbook, skills, tasks and knowledge |
| `DELAMAIN_NEWS_READING` ⚙ | `true` | Reading the news through the day |
| `DELAMAIN_STUDY` ⚙ | `true` | Free-time study and long tasks |
| `DELAMAIN_VISION` ⚙ | `true` | Looking at pictures in his free time (needs a model that reads images) |
| `DELAMAIN_TWIN` ⚙ | `true` | Evening therapy with the other Delamain |
| `DELAMAIN_GARDEN` ⚙ | `true` | His garden: real plants he tends in his free time ([mind.md](mind.md#his-garden)) |
| `DELAMAIN_SLEEP` ⚙ | `23:30-07:00` | His bedtime (`HH:MM-HH:MM`), or `off` ([mind.md](mind.md#sleep-and-dreams)) |
| `DELAMAIN_JOURNAL` ⚙ | `true` | The nightly journal |
| `DELAMAIN_BRIEF` ⚙ | `true` | The morning brief |
| `DELAMAIN_SELF_REVIEW` ⚙ | `true` | The nightly self-review and code proposals |
| `DELAMAIN_BACKGROUND_EFFORT` | `high` | `reasoning_effort` for background work (study, journal, reviews, reports); empty for a server that rejects the field |
| `DELAMAIN_SELF_DIR` | `<repo>/self` | His working state: mood, feelings, interests, tasks, proposals ([mind.md](mind.md), [self-improvement.md](self-improvement.md)) |
| `DELAMAIN_SERVICE` | `delamain.service` | The systemd user unit he runs as, so approved code changes can restart him |
| `DELAMAIN_REVIEWER`, `DELAMAIN_REVIEW_MODEL` | `agy` on the PATH | Optional second-opinion review of his code changes |
