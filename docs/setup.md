# Setup Guide

## 1. Install Python dependencies

```bash
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## 2. Download F5-TTS model weights

```bash
mkdir -p checkpoints/F5TTS_Base
pip install huggingface_hub
huggingface-cli download SWivid/F5-TTS \
  F5TTS_Base/model_1200000.pt \
  F5TTS_Base/vocab.txt \
  --local-dir checkpoints
```

## 3. Prepare your voice reference audio

F5-TTS clones voice from a reference clip. You need a clean 10-second WAV file of the voice you want to use.

1. Place it at `delamain_ref_10s.wav` in the project root
2. Edit `REF_TEXT` in `tts_engine.py` to match exactly what is spoken in the clip

For the authentic Cyberpunk 2077 Delamain voice, source a clean audio clip from the game and transcribe it.

## 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Required | Description |
|---|---|---|
| `LLM_URL` | Yes | llama.cpp or OpenAI-compatible endpoint |
| `SEARXNG_URL` | No | SearXNG instance for web search |
| `ALLOWED_ORIGINS` | Yes | Your domain/IP for CORS |

## 5. Set a password

```bash
python auth.py set-password yourpassword
```

Tokens expire after 30 days. To show the current token:

```bash
python auth.py show-token
```

## 6. Start services

**Backend:**
```bash
uvicorn main:app --host 0.0.0.0 --port 8888 --ws-ping-interval 0
```

**Frontend (development):**
```bash
cd frontend && npm install && npm run dev
```

**Frontend (production build):**
```bash
cd frontend && npm run build
# Serve dist/ with nginx or any static file server
```

## 7. Connect sunnypilot bridge

See [sunnypilot-bridge.md](sunnypilot-bridge.md).
