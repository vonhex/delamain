# Setup Guide

## 1. Install

```bash
git clone https://github.com/vonhex/delamain.git
cd delamain
./install.sh          # Windows: double-click install.bat
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

## 5. Use it in the car

Open the address in the browser on your phone or on the Android Auto display, log in, and press the mic. The microphone and location only work on a secure (`https://`) page, so use Tailscale (`tailscale serve 8888`) or a Cloudflare Tunnel; see the README. Opening Delamain through either needs no `ALLOWED_ORIGINS` change.

## Your own voice

The Delamain reference clip `delamain_ref_10s.wav` is included. To clone another voice, replace it (or set `DELAMAIN_REF_AUDIO`) with a clean 10-second WAV and edit `REF_TEXT` in `tts_engine.py` to match exactly what is spoken. Delete `audio_output/static_cache/` so the fixed lines are recorded again in the new voice. See [f5-tts.md](f5-tts.md).

## Frontend development

```bash
cd frontend && npm run dev
```

Serves the UI with hot reload on `http://localhost:5173`, proxying the API to the backend on 8888.
